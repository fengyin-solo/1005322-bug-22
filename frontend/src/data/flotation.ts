import { listRows, saveRows } from './local-store'
import type { EntryRow } from './types'

// 浮选样品的领域逻辑：批量登记、重量口径版本、送检台账回写。
// 读写都落在 local-store 这一份数据上，列表、详情、导出看到的自然是同一份。

/** 样品重量口径：口径调整后新登记样品用新版，历史样品保留登记时那一版的取值，不重算。 */
export type WeightCaliber = {
  version: string
  name: string
  desc: string
  effectiveFrom: string
}

export const WEIGHT_CALIBERS: WeightCaliber[] = [
  { version: '2025版', name: '湿重', desc: '浮选前原状土样直接称重', effectiveFrom: '2025-01-01' },
  { version: '2026版', name: '干重', desc: '阴干后去除容器的净重', effectiveFrom: '2026-10-01' },
]

export type FlotationDraft = {
  样品编号: string
  采样单位: string
  样品重量: string
  浮选日期: string
  炭屑含量: string
  炭化种子数: string
  送检去向: string
}

export type BatchFailure = { index: number; reason: string }

export type BatchResult = {
  ok: boolean
  added: number
  merged: number
  skipped: number
  failure: BatchFailure | null
}

export type DatingSyncResult = { 送检编号: string; created: boolean }

// 未提交成功的登记批次也存在本地，刷新或误关页面后打开登记框能接着填。
const DRAFT_STORAGE_KEY = 'archaeology-field:flotation-drafts'

// 判重与展示都按这份字段清单，和 modules.ts 里的浮选字段保持一致。
const BUSINESS_FIELDS = [
  '样品编号',
  '采样单位',
  '样品重量',
  '重量口径',
  '浮选日期',
  '炭屑含量',
  '炭化种子数',
  '送检去向',
  '样品状态',
]

export function todayString(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function weightCaliberOn(date: string): WeightCaliber {
  let picked = WEIGHT_CALIBERS[0]
  for (const caliber of WEIGHT_CALIBERS) {
    if (caliber.effectiveFrom <= date) {
      picked = caliber
    }
  }
  return picked
}

export function currentWeightCaliber(): WeightCaliber {
  return weightCaliberOn(todayString())
}

export function caliberTag(caliber: WeightCaliber): string {
  return `${caliber.version}·${caliber.name}`
}

/** 详情里的重量说明：历史样品沿用登记时那一版口径的取值，口径调整后不重算。 */
export function describeRowWeight(row: EntryRow): string {
  const weight = row['样品重量']
  const tag = String(row['重量口径'] ?? '').trim()
  if (weight === undefined || weight === '') {
    return '样品重量未登记'
  }
  if (!tag) {
    return `样品重量 ${weight} kg：登记时未记录口径，沿用当时取值，不重算。`
  }
  const caliber = WEIGHT_CALIBERS.find((item) => caliberTag(item) === tag)
  const desc = caliber ? `（${caliber.desc}）` : ''
  return `样品重量 ${weight} kg：按 ${tag}${desc} 口径登记，口径调整后沿用当时取值，不重算。`
}

export function blankDraft(): FlotationDraft {
  return {
    样品编号: '',
    采样单位: '',
    样品重量: '',
    浮选日期: todayString(),
    炭屑含量: '',
    炭化种子数: '',
    送检去向: '',
  }
}

function parseWeight(input: string): number | null {
  const text = input.trim().replace(/(公斤|千克|kg)$/i, '')
  if (!text) {
    return null
  }
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  return Math.round(value * 1000) / 1000
}

function parseSeedCount(input: string): number | null {
  const text = input.trim().replace(/(粒|颗)$/, '')
  if (!text) {
    return null
  }
  const value = Number(text)
  if (!Number.isInteger(value) || value < 0) {
    return null
  }
  return value
}

export function validateDraft(draft: FlotationDraft): string | null {
  if (!draft.样品编号.trim()) {
    return '样品编号不能为空'
  }
  if (parseWeight(draft.样品重量) === null) {
    return '样品重量需为大于 0 的数字（单位 kg，可写作 18.5 或 18.5kg）'
  }
  if (parseSeedCount(draft.炭化种子数) === null) {
    return '炭化种子数需为不小于 0 的整数'
  }
  return null
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function sameRecord(a: EntryRow, b: EntryRow): boolean {
  return BUSINESS_FIELDS.every((field) => String(a[field] ?? '') === String(b[field] ?? ''))
}

function buildRecord(draft: FlotationDraft, rows: EntryRow[], existing: EntryRow | null): EntryRow {
  return {
    id: existing ? Number(existing.id) : nextId(rows),
    status: existing ? String(existing.status) : '待浮选',
    pending: existing ? Boolean(existing.pending) : true,
    abnormal: existing ? Boolean(existing.abnormal) : false,
    样品编号: draft.样品编号.trim(),
    采样单位: draft.采样单位.trim(),
    样品重量: parseWeight(draft.样品重量) ?? 0,
    // 合并已有记录时沿用首次登记的口径与取值，不按新口径重算
    重量口径: existing ? String(existing['重量口径'] ?? '') : caliberTag(currentWeightCaliber()),
    浮选日期: draft.浮选日期.trim(),
    炭屑含量: draft.炭屑含量.trim(),
    炭化种子数: parseSeedCount(draft.炭化种子数) ?? 0,
    送检去向: draft.送检去向.trim(),
    样品状态: existing ? String(existing['样品状态'] ?? '在库') : '在库',
  }
}

/**
 * 批量登记浮选样品。
 * 每条校验通过就立刻落库再处理下一条：中断时已成功的记录保留；
 * 重新提交按样品编号去重（内容相同跳过、不同合并），从失败那条接着走，已成功的不会重来；
 * 同一份样品重复提交只落一条。
 */
export function registerFlotationBatch(drafts: FlotationDraft[]): BatchResult {
  let added = 0
  let merged = 0
  let skipped = 0
  let working = [...listRows('flotation')]
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]
    const reason = validateDraft(draft)
    if (reason) {
      return { ok: false, added, merged, skipped, failure: { index, reason } }
    }
    const sampleNo = draft.样品编号.trim()
    const existingIndex = working.findIndex(
      (row) => String(row['样品编号'] ?? '').trim() === sampleNo,
    )
    const existing = existingIndex >= 0 ? working[existingIndex] : null
    const record = buildRecord(draft, working, existing)
    if (existing && sameRecord(existing, record)) {
      skipped += 1
      continue
    }
    const next =
      existingIndex >= 0
        ? working.map((row, position) => (position === existingIndex ? record : row))
        : [...working, record]
    try {
      saveRows('flotation', next)
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知原因'
      return {
        ok: false,
        added,
        merged,
        skipped,
        failure: { index, reason: `写入本地存储失败：${detail}` },
      }
    }
    working = next
    if (existing) {
      merged += 1
    } else {
      added += 1
    }
  }
  return { ok: true, added, merged, skipped, failure: null }
}

export function loadDraftBatch(): FlotationDraft[] | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as FlotationDraft[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

export function saveDraftBatch(drafts: FlotationDraft[]): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts))
}

export function clearDraftBatch(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.removeItem(DRAFT_STORAGE_KEY)
}

/**
 * 浮选出结果后回写送检台账（测年送检模块）：
 * 按样品来源里的样品编号找到已有送检单则更新，找不到就补建一条，
 * 同一份样品重复回写也只落一条。
 */
export function syncFlotationResultToDating(sample: EntryRow): DatingSyncResult {
  const rows = listRows('dating')
  const sampleNo = String(sample['样品编号'] ?? '').trim() || `样品#${sample.id}`
  const today = todayString()
  const lab = String(sample['送检去向'] ?? '').trim()
  const index = rows.findIndex((row) => String(row['样品来源'] ?? '').includes(sampleNo))
  if (index >= 0) {
    const current = rows[index]
    const updated: EntryRow = {
      ...current,
      // 样品没填送检去向时保留台账里已有的实验室，不用空值覆盖
      承接实验室: lab || String(current['承接实验室'] ?? '') || '待定实验室',
      报告收到日: today,
      送检状态: '已出报告',
      status: '已出报告',
      pending: false,
    }
    const next = [...rows]
    next[index] = updated
    saveRows('dating', next)
    return { 送检编号: String(current['送检编号']), created: false }
  }
  const id = nextId(rows)
  const 送检编号 = `DATI-${String(id).padStart(4, '0')}`
  const record: EntryRow = {
    id,
    status: '已出报告',
    pending: false,
    abnormal: false,
    送检编号,
    样品来源: `浮选样品 ${sampleNo}`,
    承接实验室: lab || '待定实验室',
    测年方法: '炭化植物遗存分析',
    送检日期: String(sample['浮选日期'] ?? '').trim() || today,
    校正年代: '待实验室出具',
    报告收到日: today,
    送检状态: '已出报告',
  }
  saveRows('dating', [...rows, record])
  return { 送检编号, created: true }
}
