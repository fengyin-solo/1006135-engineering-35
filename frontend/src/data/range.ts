// 范围校验共享实现：准备阶段与构建期 check:seed 脚本共用同一套规则（range-rules.json）。
// 页面只读展示，不在这里拦；越限记录统一在“准备样例”阶段报出来。
import rulesJson from './range-rules.json'
import type { EntryRow, RangeRule, RangeRules, RangeViolation } from './types'

export const RANGE_RULES = rulesJson as unknown as RangeRules

// 从“12.4mm”“-3.6 m”这类带单位的写法里取数值；取不到就视为缺值，不参与范围判断。
export function readNumeric(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (value === null || value === undefined) {
    return null
  }
  const matched = String(value).match(/-?\d+(?:\.\d+)?/)
  if (!matched) {
    return null
  }
  const num = Number(matched[0])
  return Number.isFinite(num) ? num : null
}

export function checkRange(rule: RangeRule, value: unknown): string | null {
  const num = readNumeric(value)
  if (num === null) {
    return `不是可识别的数值：「${value === undefined || value === null ? '' : String(value)}」`
  }
  const unit = rule.unit ?? ''
  if (num < rule.min) {
    return `${num}${unit} 低于下限 ${rule.min}${unit}`
  }
  if (num > rule.max) {
    return `${num}${unit} 超过上限 ${rule.max}${unit}`
  }
  return null
}

export function rangeRulesFor(moduleKey: string): Record<string, RangeRule> {
  return RANGE_RULES[moduleKey] ?? {}
}

export function validateRow(moduleKey: string, row: EntryRow): RangeViolation[] {
  const violations: RangeViolation[] = []
  for (const [field, rule] of Object.entries(rangeRulesFor(moduleKey))) {
    const reason = checkRange(rule, row[field])
    if (reason) {
      violations.push({
        module: moduleKey,
        id: row.id,
        field,
        value: row[field] === undefined || row[field] === null ? '' : String(row[field]),
        rule,
        reason,
      })
    }
  }
  return violations
}
