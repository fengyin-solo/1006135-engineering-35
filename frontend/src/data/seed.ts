import seedRows from './seed-rows.json'
import { buildInitialDataset } from './kernel.js'
import type { EntryRow } from './types'

// 样例单一真源是 seed-rows.json：Node 的准备/恢复脚本与浏览器都读它，不分两份。
// 地表沉降样例不单独维护，由共享内核按建筑监测样例同源派生，两处条数始终一致。
const rawSeed = seedRows as unknown as Record<string, EntryRow[]>

function buildSeed(): Record<string, EntryRow[]> {
  const { dataset } = buildInitialDataset(rawSeed)
  return dataset
}

// 示例数据：首次打开时播种，之后浏览器里的改动优先，重置才会回到这份。
export const SEED_ROWS: Record<string, EntryRow[]> = buildSeed()
