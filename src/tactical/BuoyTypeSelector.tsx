import type { DropKind } from './drop'

/** Existing DATUM form styling; manual placement only. AUTO keeps its planner-selected types. */
export function BuoyTypeSelector({ value, onChange, disabled = false }: {
  value: DropKind; onChange: (kind: DropKind) => void; disabled?: boolean
}) {
  return <label className="drop-type">
    <select aria-label="Buoy type for manual placement" value={value} disabled={disabled}
      onChange={(e) => { const kind = e.target.value; if (kind === 'omni' || kind === 'difar' || kind === 'bt') onChange(kind) }}>
      <option value="omni">OMNI</option>
      <option value="difar">DIRECTIONAL (DIFAR)</option>
      <option value="bt">BT (SSP)</option>
      <option value="active" disabled>ACTIVE (DICASS) · S · not yet implemented</option>
    </select>
  </label>
}
