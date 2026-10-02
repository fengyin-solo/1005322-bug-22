import { MODULE_BY_KEY } from '@/data/modules'
import {
  buildFlotationRow,
  buildLedgerRow,
  fieldText,
  validateDraft,
} from '@/data/flotation'
import {
  allRows,
  listLedger,
  listRows,
  resetRows,
  saveLedger,
  saveRows,
} from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  FlotationBatchResult,
  FlotationDraft,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const FLOTATION_KEY = 'flotation'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 详情读取与列表共用同一份本地存储，列表显示什么，详情就取到什么。
export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 浮选样品批量登记：
// - 每条草稿校验通过后立刻整行落库（重量、种子数随其余字段一次写全），
//   中断也不会丢掉已经成功的记录；
// - 库内已存在相同样品编号的记录直接跳过（重复提交只落一条），
//   同批草稿里再次出现同样编号也只保留第一次；
// - 整批重提时已经成功的记录都走跳过分支，从失败那一条之后继续，不重来。
export function registerFlotationBatch(drafts: FlotationDraft[]): FlotationBatchResult {
  const result: FlotationBatchResult = {
    ok: true,
    total: drafts.length,
    created: 0,
    existed: 0,
    duplicated: 0,
    failedIndex: null,
    items: [],
  }
  const createdCodes = new Set<string>()
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]
    const code = draft.样品编号.trim()
    const problem = validateDraft(draft)
    if (problem) {
      result.ok = false
      result.failedIndex = index
      result.items.push({
        index,
        样品编号: code,
        outcome: 'failed',
        message: problem,
      })
      break
    }
    // 同批草稿里再次出现同样编号：先判批内重复，再查库内是否已存在，
    // 两种情况都只保留第一次成功落库的那一条。
    if (createdCodes.has(code)) {
      result.duplicated += 1
      result.items.push({
        index,
        样品编号: code,
        outcome: 'duplicated',
        message: `样品「${code}」在本批中重复出现，只保留第一条`,
      })
      continue
    }
    const rows = listRows(FLOTATION_KEY)
    if (rows.some((row) => fieldText(row, '样品编号') === code)) {
      result.existed += 1
      result.items.push({
        index,
        样品编号: code,
        outcome: 'existed',
        message: `样品「${code}」已登记，本次提交跳过，不重复落库`,
      })
      continue
    }
    const row = buildFlotationRow(nextId(rows), draft, '待浮选')
    // 逐条即时持久化：后面任何一条失败或操作中断，前面成功的都还在。
    saveRows(FLOTATION_KEY, [...rows, row])
    createdCodes.add(code)
    result.created += 1
    result.items.push({
      index,
      样品编号: code,
      outcome: 'created',
      message: `样品「${code}」登记成功`,
    })
  }
  return result
}

// 浮选送检台账读取：台账为空时页面据此给出空态说明。
export function listFlotationLedger(): EntryRow[] {
  return listLedger()
}

// 浮选完成回写台账：按样品编号幂等 upsert，重复确认完成也只保留一条。
// 已存在的台账行沿用历史重量及其口径版本，不用当前口径重算。
function upsertFlotationLedger(sample: EntryRow): void {
  const ledger = listLedger()
  const code = fieldText(sample, '样品编号')
  const index = ledger.findIndex((row) => fieldText(row, '样品编号') === code)
  if (index >= 0) {
    return
  }
  const row = buildLedgerRow(nextId(ledger), sample)
  saveLedger([...ledger, row])
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 浮选样品的末态有「已完成 / 已废弃」两个，单独按业务状态判定待处理标记。
  if (key === FLOTATION_KEY) {
    updated.pending = target === '待浮选' || target === '浮选中'
  }
  // 样品状态展示字段与流转状态保持同一份值，列表和详情不会各说各话。
  if (meta.fields.includes('样品状态')) {
    updated.样品状态 = target
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  // 浮选出结果（确认完成）后把这条样品回写到送检台账，重复操作幂等不重复写。
  if (key === FLOTATION_KEY && target === '已完成') {
    upsertFlotationLedger(updated)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value)
  // 含逗号、引号、换行时按 CSV 规范加引号并转义，保证列不错位、值不丢失。
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.map(csvCell).join(',')]
  for (const row of listRows(key)) {
    // 与列表、详情同一套字段取值，登记清单上看得到的值导出同样在列。
    const values = [row.id, ...meta.fields.map((field) => fieldText(row, field)), row.status]
    lines.push(values.map(csvCell).join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
