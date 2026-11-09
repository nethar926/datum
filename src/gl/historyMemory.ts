/**
 * Steady-state history-ring memory for the live gram (scroll-back).
 *
 * Current storage (do not change without Lead approval):
 *   GPU: WebGL2 R16F ring textures (2 B/sample) in WaterfallRenderer
 *        — band/legacy: 2N power (raw + normalized) + N DIFAR bearing rings
 *        — RES: N power + N bearing rings
 *        — handoff pending bank doubles the live set while active
 *   CPU: LevelHistory Float32 for the on-screen stream only (4 B/sample)
 *
 * Bands ELF/VLF/LF/MF and NB/BB are exclusive (one LOFAR family at a time).
 * DEMON is a separate Gram (512 bins, no res → 2N + N rings).
 * Field cap matches SimHost.MAX_FIELD_BUOYS (= 32).
 *
 * 2026-11-08 measure: 1,800 rows (15 min × 2 Hz) in the CURRENT format exceeds
 * the ~256 MB GPU soft ceiling for a full 32-buoy band field — ring bump held.
 * Format options if we revisit: Uint8 quantized dB, drop unused DEMON bearing
 * rings, lazy per-band allocation, CPU-only cold history beyond the visible window.
 * Never downsample / decimate old rows.
 */

/** Must match SimHost.MAX_FIELD_BUOYS (engine bench budget). */
export const HISTORY_FIELD_BUOYS = 32

/** Bytes per sample in the live GPU ring (R16F). */
export const GPU_BYTES_PER_SAMPLE = 2
/** Bytes per sample in LevelHistory (Float32). */
export const CPU_BYTES_PER_SAMPLE = 4

/** Soft ceiling used for the 15-min ring-bump go/no-go (Lead). */
export const HISTORY_BUDGET_GPU_MB = 256
export const HISTORY_BUDGET_CPU_MB = 256

/** Default live LOFAR row rate (Hz); 15 min × 2 = 1,800 rows. */
export const DEFAULT_ROW_RATE_HZ = 2
export const SCROLL_BACK_HISTORY_ROWS = 15 * 60 * DEFAULT_ROW_RATE_HZ // 1800
export const CURRENT_HISTORY_ROWS = 600
export const CURRENT_DEMON_HISTORY_ROWS = 500

export type LofarHistoryMode = 'band' | 'res'

export function powerTexturesFor(mode: LofarHistoryMode, buoyCount: number): number {
  return mode === 'band' ? buoyCount * 2 : buoyCount
}

/** Live GPU ring textures for one LOFAR WaterfallRenderer (power + DIFAR bearing). */
export function liveLofarTextures(mode: LofarHistoryMode, buoyCount: number): number {
  return powerTexturesFor(mode, buoyCount) + buoyCount
}

export function ringBytes(bins: number, rows: number, bytesPerSample: number): number {
  return bins * rows * bytesPerSample
}

export function estimateLofarGpuBytes(opts: {
  rows: number
  bins: number
  buoys?: number
  mode: LofarHistoryMode
  /** Count the handoff pending bank (peak). Default: steady live only. */
  includePending?: boolean
}): number {
  const N = opts.buoys ?? HISTORY_FIELD_BUOYS
  const live = liveLofarTextures(opts.mode, N) * ringBytes(opts.bins, opts.rows, GPU_BYTES_PER_SAMPLE)
  return opts.includePending ? live * 2 : live
}

/** DEMON Gram: no res → band-style 2N power + N bearing rings (bearing unused but allocated). */
export function estimateDemonGpuBytes(opts: {
  rows: number
  bins?: number
  buoys?: number
  includePending?: boolean
}): number {
  return estimateLofarGpuBytes({
    rows: opts.rows,
    bins: opts.bins ?? 512,
    buoys: opts.buoys,
    mode: 'band',
    includePending: opts.includePending,
  })
}

/** LevelHistory for the on-screen stream only. */
export function estimateLevelHistoryCpuBytes(rows: number, bins: number): number {
  return ringBytes(bins, rows, CPU_BYTES_PER_SAMPLE)
}

export const bytesToMb = (b: number): number => b / (1000 * 1000)

/** True when a proposed LOFAR ring stays under the GPU soft ceiling (steady, no pending). */
export function lofarGpuWithinBudget(
  rows: number, bins: number, mode: LofarHistoryMode, buoys = HISTORY_FIELD_BUOYS,
): boolean {
  return bytesToMb(estimateLofarGpuBytes({ rows, bins, buoys, mode })) <= HISTORY_BUDGET_GPU_MB
}
