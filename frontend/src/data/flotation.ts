import type { EntryRow, FlotationDraft } from './types'

// 浮选样品的业务规则集中在这一处，页面和本地服务都只调用，不各自写判断。

// 独立的浮选送检台账持久化键，和业务记录分开存，互不影响。
export const FLOTATION_LEDGER_KEY = 'archaeology-field:flotation-ledger'

// 样品重量口径：登记时把当时的口径版本盖到记录上。之后口径再怎么调整，
// 读历史样品都只认落库时的原值（weightOf），不按新口径重算。
export const WEIGHT_RULE_VERSION = '2026-10 湿重口径'

export const FLOTATION_FIELDS = [
  '样品编号',
  '采样单位',
  '样品重量',
  '浮选日期',
  '炭屑含量',
  '炭化种子数',
  '送检去向',
  '样品状态',
  '重量口径版本',
] as const

// 送检台账字段：台账只关心样品去向和浮选结果。
export const LEDGER_FIELDS = [
  '台账编号',
  '样品编号',
  '采样单位',
  '样品重量',
  '重量口径版本',
  '炭屑含量',
  '炭化种子数',
  '送检去向',
  '完成日期',
] as const

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function fieldText(row: EntryRow | undefined, field: string): string {
  if (!row) {
    return ''
  }
  const value = row[field]
  return value === undefined || value === null ? '' : String(value)
}

// 样品重量取值：历史样品沿用登记那一版口径下的落库值，一律不重算。
export function weightOf(row: EntryRow | undefined): string {
  return fieldText(row, '样品重量')
}

// 校验一条登记草稿。样品编号、样品重量、炭化种子数必须一次填全，
// 重量为非负数值、种子数为非负整数；其余字段允许为空。
export function validateDraft(draft: FlotationDraft): string {
  const code = draft.样品编号.trim()
  if (!code) {
    return '样品编号不能为空'
  }
  const weight = draft.样品重量.trim()
  if (!weight) {
    return `样品「${code}」的样品重量未填写`
  }
  if (!/^\d+(\.\d+)?$/.test(weight)) {
    return `样品「${code}」的样品重量必须是非负数值`
  }
  const seeds = draft.炭化种子数.trim()
  if (!seeds) {
    return `样品「${code}」的炭化种子数未填写`
  }
  if (!/^\d+$/.test(seeds)) {
    return `样品「${code}」的炭化种子数必须是非负整数`
  }
  return ''
}

// 构造浮选样品记录：样品重量、炭化种子数与其余字段同一条记录一次写全，
// 重量同时盖上当前口径版本戳，历史值之后不再换算。
export function buildFlotationRow(
  id: number,
  draft: FlotationDraft,
  status: string,
): EntryRow {
  return {
    id,
    status,
    pending: status !== '已完成' && status !== '已废弃',
    abnormal: false,
    样品编号: draft.样品编号.trim(),
    采样单位: draft.采样单位.trim(),
    样品重量: draft.样品重量.trim(),
    浮选日期: draft.浮选日期.trim() || today(),
    炭屑含量: draft.炭屑含量.trim(),
    炭化种子数: Number(draft.炭化种子数.trim()),
    送检去向: draft.送检去向.trim(),
    样品状态: status,
    重量口径版本: WEIGHT_RULE_VERSION,
  }
}

// 浮选完成后回写送检台账时构造的台账记录（独立于业务记录）。
// 重量直接沿用业务记录里登记那一版的值，不按当前口径重新计算。
export function buildLedgerRow(id: number, source: EntryRow): EntryRow {
  return {
    id,
    status: '已回写',
    pending: false,
    abnormal: false,
    台账编号: `SEND-${String(id).padStart(4, '0')}`,
    样品编号: fieldText(source, '样品编号'),
    采样单位: fieldText(source, '采样单位'),
    样品重量: weightOf(source),
    重量口径版本: fieldText(source, '重量口径版本'),
    炭屑含量: fieldText(source, '炭屑含量'),
    炭化种子数: fieldText(source, '炭化种子数'),
    送检去向: fieldText(source, '送检去向'),
    完成日期: today(),
  }
}
