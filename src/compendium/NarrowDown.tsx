import { NARROW_FAMILIES, NARROW_MODES, type NarrowForm } from './narrow'

type Field = Exclude<keyof NarrowForm, 'gridHz' | 'mode' | 'lineFamilies'>
const NUMS: { k: Field; label: string; hint: string }[] = [
  { k: 'csrHz', label: 'CSR HZ', hint: 'crank shaft rate' },
  { k: 'cfrHz', label: 'CFR HZ', hint: 'cylinder firing rate' },
  { k: 'psrHz', label: 'PSR HZ', hint: 'propeller shaft rate' },
  { k: 'blades', label: 'BLADES', hint: 'BR ÷ PSR' },
  { k: 'efrToCsr', label: 'EFR ÷ CSR', hint: 'engine firing ÷ crank' },
  { k: 'gearRatio', label: 'GEAR', hint: 'CSR ÷ PSR' },
  { k: 'msrToMotorShaft', label: 'SLOTS', hint: 'MSR ÷ motor shaft' },
  { k: 'tpk', label: 'TPK', hint: 'shaft RPM per knot' },
  { k: 'turbineRateHz', label: 'TURBINE HZ', hint: 'turbine rate' },
  { k: 'reductionRatio', label: 'REDUCTION', hint: 'turbine ÷ PSR' },
  { k: 'gearMeshHz', label: 'MESH HZ', hint: 'gear mesh' },
  { k: 'turboGenHz', label: 'TG HZ', hint: 'turbo-generator' },
  { k: 'hydpHz', label: 'HYDP HZ', hint: 'hydraulic plant' },
  { k: 'edaCfrMultiples', label: 'EDA × CFR', hint: 'e.g. 10.5, 27.75' },
  { k: 'srcHz', label: 'SRC HZ', hint: 'SRC line, source frame' },
  { k: 'srcKts', label: 'SRC KT', hint: 'est. speed (optional)' },
  { k: 'swathLoHz', label: 'SWATH LO HZ', hint: 'band low edge' },
  { k: 'swathHiHz', label: 'SWATH HI HZ', hint: 'band high edge' },
  { k: 'swathKts', label: 'SWATH KT', hint: 'est. speed (optional)' },
]

/** Observation form only. Matching is the Physicist's matchClasses; this panel holds no logic and no truth. */
export function NarrowDown({ f, set, hide, setHide, count, onClear }: {
  f: NarrowForm; set: (f: NarrowForm) => void; hide: boolean; setHide: (v: boolean) => void; count: number; onClear: () => void
}) {
  const tick = (fam: NarrowForm['lineFamilies'][number]) =>
    set({ ...f, lineFamilies: f.lineFamilies.includes(fam) ? f.lineFamilies.filter((x) => x !== fam) : [...f.lineFamilies, fam] })
  return (
    <aside className="cmp-narrow" aria-label="Narrow down" data-testid="narrow-down">
      <h3>NARROW DOWN <span className="readout">{count} KEYS</span></h3>
      <label>GRID
        <div className="seg" role="group" aria-label="Grid">
          {(['', '50', '60'] as const).map((g) => <button key={g} aria-pressed={f.gridHz === g} onClick={() => set({ ...f, gridHz: g })}>{g ? `${g} HZ` : 'ANY'}</button>)}
        </div>
      </label>
      <label>MODE
        <select value={f.mode} onChange={(e) => set({ ...f, mode: e.target.value as NarrowForm['mode'] })} aria-label="Mode">
          <option value="">ANY</option>
          {NARROW_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <fieldset><legend>LINES SEEN</legend>
        {NARROW_FAMILIES.map((fam) => (
          <button key={fam} className="chip" aria-pressed={f.lineFamilies.includes(fam)} onClick={() => tick(fam)}>{fam}</button>
        ))}
      </fieldset>
      <div className="cmp-narrow-nums">
        {NUMS.map(({ k, label, hint }) => (
          <label key={k} title={hint}>{label}
            <input inputMode="decimal" value={f[k]} placeholder={hint} aria-label={label} onChange={(e) => set({ ...f, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <label className="cmp-narrow-hide"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> HIDE RULED-OUT</label>
      <button className="btn" onClick={onClear}>Clear keys</button>
      <p className="cmp-foot">Enter source-frame values (correct for Doppler first). Score is how many of your keys agree, not a probability.</p>
    </aside>
  )
}
