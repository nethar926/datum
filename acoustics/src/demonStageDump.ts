/**
 * Opt-in per-stage DEMON hashes, matching Swift DemonStageDump (same FNV-1a and JSON shape).
 * DEMON_STAGE_DUMP=<cut>:<row>  (or =1 for cut-cut-brindleflux-snork:804).
 * DEMON_STAGE_DUMP_PATH overrides the output file (default demon-stage-dump.json).
 * No-op when the env is unset — production values are unchanged.
 */
/** Node env / fs without @types/node: the FE app tsconfig only includes vite/client, and its node:fs shim has no writeFileSync. */
type NodeProcess = {
  env?: Record<string, string | undefined>;
  getBuiltinModule?: (id: string) => unknown;
};
type NodeFs = {writeFileSync: (path: string, data: string) => void};

function nodeProcess(): NodeProcess | undefined {
  return (globalThis as typeof globalThis & {process?: NodeProcess}).process;
}

function envVar(name: string): string | undefined {
  return nodeProcess()?.env?.[name];
}

function hasWriteFileSync(mod: unknown): mod is NodeFs {
  return typeof mod === 'object' && mod !== null && 'writeFileSync' in mod
    && typeof (mod as {writeFileSync: unknown}).writeFileSync === 'function';
}

function writeTextFileSync(path: string, data: string): void {
  const mod = nodeProcess()?.getBuiltinModule?.('node:fs');
  if (!hasWriteFileSync(mod)) {
    throw new Error(`DEMON_STAGE_DUMP cannot write ${path}: Node fs is unavailable`);
  }
  mod.writeFileSync(path, data);
}

export const DEMON_STAGE_DUMP_DEFAULT = 'cut-cut-brindleflux-snork:804';

export let currentCut: string | undefined;
export let currentCutId: string | undefined;
export function setDemonStageDumpCut(name?: string, cutId?: string): void {
  currentCut = name;
  currentCutId = cutId;
}

function parse(raw: string | undefined): {cut: string; row: number} | undefined {
  if (!raw || raw === '0') return undefined;
  const s = raw === '1' ? DEMON_STAGE_DUMP_DEFAULT : raw;
  const i = s.lastIndexOf(':');
  if (i < 0) return undefined;
  const row = Number(s.slice(i + 1));
  if (!Number.isInteger(row)) return undefined;
  return {cut: s.slice(0, i), row};
}

const parsed = parse(envVar('DEMON_STAGE_DUMP'));
const outPath = envVar('DEMON_STAGE_DUMP_PATH') ?? 'demon-stage-dump.json';
let emitted = false;

export const demonStageDumpEnabled = !!parsed;

function normalize(s: string): string {
  const t = s.toLowerCase();
  return t.startsWith('cut-cut-') ? 'cut-' + t.slice('cut-cut-'.length) : t;
}

export function demonStageDumpMatches(row: number): boolean {
  if (!parsed || emitted || row !== parsed.row) return false;
  const names = [currentCut, currentCutId].filter((x): x is string => !!x);
  if (names.length === 0) return true;
  const w = normalize(parsed.cut);
  return names.some((n) => normalize(n) === w);
}

export function hashF32(a: ArrayLike<number>): {hash: number; sum: number} {
  const buf = a instanceof Float32Array
    ? a
    : Float32Array.from(a as ArrayLike<number>);
  const u = new Uint32Array(buf.buffer, buf.byteOffset, buf.length);
  let h = 0x811c9dc5, sum = 0;
  for (let i = 0; i < buf.length; i++) {
    h ^= Number.isNaN(buf[i]) ? 0x7fc00000 : u[i];
    h = Math.imul(h, 0x01000193) >>> 0;
    if (!Number.isNaN(buf[i])) sum += buf[i];
  }
  return {hash: h >>> 0, sum};
}

export function hashF64(a: ArrayLike<number>): {hash: number; sum: number} {
  const buf = a instanceof Float64Array
    ? a
    : Float64Array.from(a as ArrayLike<number>);
  const nanBits = new Uint8Array(new Float64Array([NaN]).buffer); // 0x7ff8000000000000 LE
  let h = 0x811c9dc5, sum = 0;
  const tmp = new Float64Array(1);
  const bytes = new Uint8Array(tmp.buffer);
  for (let i = 0; i < buf.length; i++) {
    const src = Number.isNaN(buf[i]) ? nanBits : (tmp[0] = buf[i], bytes);
    for (let k = 0; k < 8; k++) {
      h ^= src[k];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    if (!Number.isNaN(buf[i])) sum += buf[i];
  }
  return {hash: h >>> 0, sum};
}

function hexF32(a: ArrayLike<number>, head = 4, tail = 2): {head: string[]; tail: string[]} {
  const buf = a instanceof Float32Array ? a : Float32Array.from(a as ArrayLike<number>);
  const u = new Uint32Array(buf.buffer, buf.byteOffset, buf.length);
  const hx = (i: number) => '0x' + (Number.isNaN(buf[i]) ? 0x7fc00000 : u[i]).toString(16).padStart(8, '0');
  const n = buf.length;
  return {head: Array.from({length: Math.min(head, n)}, (_, i) => hx(i)),
          tail: Array.from({length: Math.max(0, n - Math.max(head, n - tail))}, (_, j) => hx(Math.max(head, n - tail) + j))};
}

function hexF64(a: ArrayLike<number>, head = 4, tail = 2): {head: string[]; tail: string[]} {
  const buf = a instanceof Float64Array ? a : Float64Array.from(a as ArrayLike<number>);
  const tmp = new Float64Array(1);
  const view = new DataView(tmp.buffer);
  const hx = (i: number) => {
    tmp[0] = Number.isNaN(buf[i]) ? NaN : buf[i];
    const hi = view.getUint32(4, true); // careful: we want the raw bits as 16 hex digits LE MSB on the left like Swift %016llx (host bitPattern, big-endian hex of the 64-bit int)
    // Swift String(format: "0x%016llx", bitPattern) is the 64-bit integer in big-endian hex (numerical),
    // which for IEEE is sign+exp in the high bits: e.g. 0x3ff0000000000000 for 1.0.
    // DataView getUint32: byte 0-3 are the low half on LE. bitPattern = hi_word << 32 | lo_word
    // On LE memory, bytes [0..7] = lo32 le then hi32 le. bitPattern = uint64 LE interpreted as number.
    const lo = view.getUint32(0, true);
    const hi2 = view.getUint32(4, true);
    const s = (hi2.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0'));
    return '0x' + s;
  };
  const n = buf.length;
  const t0 = Math.max(head, n - tail);
  return {head: Array.from({length: Math.min(head, n)}, (_, i) => hx(i)),
          tail: Array.from({length: Math.max(0, n - t0)}, (_, j) => hx(t0 + j))};
}

export type StageDump = {name: string; hash: number; n: number; sum: number; head: string[]; tail: string[]};

export function stageF32(name: string, a: ArrayLike<number>): StageDump {
  const {hash, sum} = hashF32(a);
  const {head, tail} = hexF32(a);
  return {name, hash, n: a.length, sum, head, tail};
}
export function stageF64(name: string, a: ArrayLike<number>): StageDump {
  const {hash, sum} = hashF64(a);
  const {head, tail} = hexF64(a);
  return {name, hash, n: a.length, sum, head, tail};
}

export function emitDemonStageDump(row: number, stages: StageDump[], extras: Record<string, string | number | boolean>): void {
  if (emitted) return;
  emitted = true;
  const body = {
    cut: currentCut ?? parsed?.cut ?? '',
    cutId: currentCutId ?? '',
    row,
    stages: Object.fromEntries(stages.map((s) => [s.name, {hash: s.hash, n: s.n, sum: s.sum, head: s.head, tail: s.tail}])),
    extras,
  };
  writeTextFileSync(outPath, JSON.stringify(body, (_key, v) => {
    if (typeof v === 'number' && !Number.isFinite(v)) return v > 0 ? 1e999 : v < 0 ? -1e999 : null;
    return v;
  }, 2) + '\n');
  console.error(`DEMON_STAGE_DUMP wrote ${outPath} cut=${body.cut} row=${row}`);
}
