/**
 * Sonya's RES row period: P = max(2 s, T/4) with T = 32/2^(n−1) s.
 * RES 1 is 8 s, RES 2 is 4 s, RES 3–9 are 2 s. LSTI does not change P.
 */
export function sonyaResRowPeriodS(res: number): number {
  const t = 32 / 2 ** (res - 1)
  return Math.max(2, t / 4)
}

export type RowPeriodStream = { rowRateHz?: number; res?: number } | null | undefined

/**
 * Row period in seconds for a gram stream.
 *
 * Prefers the engine's reported `rowRateHz`. Uses Sonya's RES formula only when
 * the engine does not report a rate (missing, zero, or non-finite) and a RES
 * level is known. LSTI does not change P.
 *
 * TODO: switch to the stream config (`rowRateHz`, `rowPhaseS`) once Sonya's
 * `setViewRes` / `drainHistory` API lands.
 */
export function rowPeriodS(stream?: RowPeriodStream, res?: number, ifUnlabelledS = 2): number {
  const hz = stream?.rowRateHz
  if (typeof hz === 'number' && Number.isFinite(hz) && hz > 1e-12) return 1 / hz
  const n = stream?.res ?? res
  if (typeof n === 'number' && n >= 1 && n <= 9) return sonyaResRowPeriodS(n)
  return ifUnlabelledS
}

/** Reciprocal of `rowPeriodS` — Hz used by history, gestures, cuts and HORZ. */
export function rowRateHz(stream?: RowPeriodStream, res?: number, ifUnlabelledS = 2): number {
  return 1 / rowPeriodS(stream, res, ifUnlabelledS)
}
