import type {OperatingMode} from './catalog/schema.js';

/**
 * Narrowband tonal source-level reference (dB re 1 µPa @ 1 m in ~1 Hz).
 *
 * INVENTED teaching ranges (not measured spectra). Relative line `power` weights
 * (e.g. 0.25/(h²) for blade rate) multiply this reference in linear space via
 * fillTonals when Signature.tonalRefDb is set — so tonals are independent of the
 * broadband continuum levelDb (Urick/Ross: machinery tonals are specified as
 * narrowband levels, not fractions of total radiated noise).
 *
 * Quieting tier: gen2 older/louder, gen4 quieter modern. Mode: snorting/surfaced
 * diesels raise machinery tonals further (public literature: snorting vs battery
 * can differ by tens of dB — Ross / Urick radiated-noise chapters; fictional magnitudes).
 */
export type QuietingTier = 'gen2' | 'gen3' | 'gen4';

/** Extra dB on top of the state-adjusted broadband levelDb for power=1 tonals. */
export function tonalRefOffsetDb(tier: QuietingTier = 'gen3', mode: OperatingMode | string = 'BATT'): number {
  const tierDb = tier === 'gen2' ? 8 : tier === 'gen3' ? 4 : 2;
  const m = String(mode);
  // SNORK/SURF already boost levelDb; keep a solid tonal offset so fundamentals clear ambient.
  const modeDb = m === 'SNORK' ? 6 : m === 'SURF' ? 4 : m === 'D/E' ? 3 : m === 'NUC' ? 4 : 5;
  return 26 + tierDb + modeDb;
}

export function tonalRefDbFor(
  levelDb: number,
  mode: OperatingMode | string,
  tier: QuietingTier = 'gen3',
): number {
  return levelDb + tonalRefOffsetDb(tier, mode);
}
