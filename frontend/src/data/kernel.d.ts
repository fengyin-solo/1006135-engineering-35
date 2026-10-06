import type { EntryRow, ModuleMeta } from './types'

export const KERNEL_VERSION: number

export const NUMERIC_FIELDS: Record<string, string[]>
export const FIELD_RULES: Array<{
  module: string
  field: string
  min: number
  max: number
}>
export const SETTLEMENT_STATUS_BY_BUILDING: Record<string, string>

export type RangeViolation = {
  module: string
  id: number
  field: string
  value: string | number
  min?: number
  max?: number
  reason: 'out-of-range' | 'not-a-number'
}

export type MergeResult = {
  dataset: Record<string, EntryRow[]>
  added: Array<{ module: string; id: number }>
  violations: RangeViolation[]
}

export function normalizeId(value: unknown, fallback: number): number
export function normalizeRows(
  moduleKey: string,
  rows: EntryRow[],
  seedRows?: EntryRow[],
): EntryRow[]
export function deriveSettlement(buildingRow: EntryRow, seq: number): EntryRow
export function reconcileSettlement(dataset: Record<string, EntryRow[]>): EntryRow[]
export function validateRanges(dataset: Record<string, EntryRow[]>): RangeViolation[]
export function normalizeDataset(
  input: Record<string, EntryRow[]>,
  seed: Record<string, EntryRow[]>,
): { dataset: Record<string, EntryRow[]>; violations: RangeViolation[] }
export function buildInitialDataset(seed: Record<string, EntryRow[]>): {
  dataset: Record<string, EntryRow[]>
  violations: RangeViolation[]
}
export function mergeSamplesIntoDataset(
  current: Record<string, EntryRow[]> | null | undefined,
  seed: Record<string, EntryRow[]>,
): MergeResult
export function metricValue(meta: ModuleMeta, rows: EntryRow[], label: string): number
export function computeStats(
  meta: ModuleMeta,
  rows: EntryRow[],
): Array<{ label: string; value: number }>
