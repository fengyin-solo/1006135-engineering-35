// 建筑监测与地表沉降共用的统计口径：两张页面上的卡片数字都从这里算，
// 读同一份清单，不再在两个 .vue 里各写一份硬编码。
import { readNumeric } from './range'
import type { EntryRow } from './types'

export type StatCard = { label: string; value: number }

type CountSpec = { label: string; kind: 'count'; statuses?: string[] }
type MaxSpec = { label: string; kind: 'max'; field: string }
type MetricSpec = CountSpec | MaxSpec

export const MODULE_METRICS: Record<string, MetricSpec[]> = {
  // 建筑监测：监测中 / 已报警 / 待布点，三个状态分别一张卡。
  building: [
    { label: '监测中对象', kind: 'count', statuses: ['监测中'] },
    { label: '报警对象', kind: 'count', statuses: ['已报警'] },
    { label: '待布点对象', kind: 'count', statuses: ['待布点'] },
  ],
  // 地表沉降：与建筑监测同源后，按沉降侧的状态名统计；第三张卡取最大累计沉降。
  settlement: [
    { label: '正常测点', kind: 'count', statuses: ['正常', '待复核', '已稳定'] },
    { label: '预警测点', kind: 'count', statuses: ['预警'] },
    { label: '最大累计沉降', kind: 'max', field: '累计沉降' },
  ],
}

export function moduleStats(moduleKey: string, rows: EntryRow[]): StatCard[] {
  const specs = MODULE_METRICS[moduleKey] ?? []
  return specs.map((spec) => {
    if (spec.kind === 'max') {
      let max = 0
      for (const row of rows) {
        const num = readNumeric(row[spec.field])
        if (num !== null && num > max) {
          max = num
        }
      }
      return { label: spec.label, value: Number(max.toFixed(2)) }
    }
    if (spec.statuses) {
      const wanted = new Set(spec.statuses)
      return { label: spec.label, value: rows.filter((row) => wanted.has(String(row.status))).length }
    }
    return { label: spec.label, value: rows.length }
  })
}
