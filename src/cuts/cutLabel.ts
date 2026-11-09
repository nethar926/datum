import { listCutsForPicker } from './api'

/** Picker-order title: "Cut N" matching CutPicker numbering (DEMON lesson first). */
export function cutPickerTitle(cutId: string | null | undefined): string {
  if (!cutId) return 'Cuts'
  const i = listCutsForPicker().findIndex((c) => c.id === cutId)
  return i >= 0 ? `Cut ${i + 1}` : 'Cuts'
}

/** 1-based picker index, or -1 when unknown. */
export function cutPickerIndex(cutId: string | null | undefined): number {
  if (!cutId) return -1
  return listCutsForPicker().findIndex((c) => c.id === cutId)
}
