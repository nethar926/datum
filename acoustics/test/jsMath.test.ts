import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jsSin, jsCos, jsTanh, jsExp, jsLog, jsLog10, jsAtan2, nativeMath } from '../src/jsMath.js';
import { mulberry32 } from '../src/prng.js';

const GOLD = new URL('../../ios/DatumAcoustics/Fixtures/golden/libm.json', import.meta.url);

function fnv(a: number[]): number {
  let h = 0x811c9dc5;
  const buf = new ArrayBuffer(8);
  const f64 = new Float64Array(buf);
  const u8 = new Uint8Array(buf);
  for (const v of a) {
    f64[0] = v;
    for (let i = 0; i < 8; i++) { h ^= u8[i]!; h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return h >>> 0;
}

function inputs(): { xs: number[]; pos: number[] } {
  const r = mulberry32(99);
  const n = 4000;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = r();
    xs.push(i % 4 === 0 ? (u - 0.5) * 14 : i % 4 === 1 ? (u - 0.5) * 1e3 : i % 4 === 2 ? u * 7 : (u - 0.5) * 0.02);
  }
  return { xs, pos: xs.map((x) => Math.abs(x) + 1e-9) };
}

describe('jsMath fdlibm ports', () => {
  it('matches committed libm.json hashes for sin/cos/tanh/log10/atan2/exp/log', () => {
    const g = JSON.parse(readFileSync(GOLD, 'utf8')) as { jsmath: Record<string, number> };
    const { xs, pos } = inputs();
    const n = xs.length;
    const o: Record<string, number[]> = {
      xs, pos,
      sin: xs.map(jsSin),
      cos: xs.map(jsCos),
      tanh: xs.map(jsTanh),
      log10: pos.map(jsLog10),
      atan2: xs.map((x, i) => jsAtan2(x, xs[(i + 7) % n]!)),
      exp: xs.map((x) => jsExp(x / 50)),
      log: pos.map(jsLog),
    };
    for (const [k, v] of Object.entries(o)) {
      expect(fnv(v), k).toBe(g.jsmath[k]);
    }
  });

  it('agrees with the captured native Math.* (Node 24 / V8 fdlibm) bit-for-bit', () => {
    const { xs, pos } = inputs();
    const n = xs.length;
    const pairs: [string, number[], number[]][] = [
      ['sin', xs.map(jsSin), xs.map(nativeMath.sin)],
      ['cos', xs.map(jsCos), xs.map(nativeMath.cos)],
      ['tanh', xs.map(jsTanh), xs.map(nativeMath.tanh)],
      ['log10', pos.map(jsLog10), pos.map(nativeMath.log10)],
      ['exp', xs.map((x) => jsExp(x / 50)), xs.map((x) => nativeMath.exp(x / 50))],
      ['log', pos.map(jsLog), pos.map(nativeMath.log)],
      ['atan2', xs.map((x, i) => jsAtan2(x, xs[(i + 7) % n]!)), xs.map((x, i) => nativeMath.atan2(x, xs[(i + 7) % n]!))],
    ];
    for (const [k, a, b] of pairs) {
      let bad = 0;
      for (let i = 0; i < a.length; i++) {
        if (!(a[i] === b[i] || (Number.isNaN(a[i]!) && Number.isNaN(b[i]!)))) bad++;
      }
      expect(bad, k).toBe(0);
    }
  });
});
