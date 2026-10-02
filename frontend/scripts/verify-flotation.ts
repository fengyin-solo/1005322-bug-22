import assert from 'node:assert'

import {
  exportEntries,
  getEntry,
  listEntries,
  listFlotationLedger,
  registerFlotationBatch,
  runAction,
} from '../src/api/local-service'
import { weightOf } from '../src/data/flotation'

let pass = 0
function check(name: string, fn: () => void) {
  fn()
  pass += 1
  console.log(`✓ ${name}`)
}

const d = (
  样品编号: string,
  样品重量: string,
  炭化种子数: string,
  extra: Record<string, string> = {},
) => ({
  样品编号,
  采样单位: extra['采样单位'] ?? 'H1',
  样品重量,
  浮选日期: '2026-10-02',
  炭屑含量: extra['炭屑含量'] ?? '',
  炭化种子数,
  送检去向: extra['送检去向'] ?? '植物考古实验室',
})

// 1. 台账初始为空（空态）
check('送检台账初始为空', () => {
  assert.strictEqual(listFlotationLedger().length, 0)
})

// 2. 批量登记：前三条合法，第四条种子数非法 -> 中断在第 4 条，前 3 条已落库
const first = registerFlotationBatch([
  d('FLOT-T01', '10.5', '3'),
  d('FLOT-T02', '8', '0'),
  d('FLOT-T03', '12.25', '120'),
  d('FLOT-T04', '9', '三颗'),
])
check('批量登记在失败行中断且成功行已落库', () => {
  assert.strictEqual(first.ok, false)
  assert.strictEqual(first.failedIndex, 3)
  assert.strictEqual(first.created, 3)
  const codes = listEntries('flotation').items.map((r) => r['样品编号'])
  assert.deepStrictEqual(
    ['FLOT-T01', 'FLOT-T02', 'FLOT-T03'].every((c) => codes.includes(c)),
    true,
  )
  assert.ok(!codes.includes('FLOT-T04'))
})

// 3. 整批重提（修正后）：前三条已存在自动跳过，第四条新增 -> 不重录成功项
const retry = registerFlotationBatch([
  d('FLOT-T01', '10.5', '3'),
  d('FLOT-T02', '8', '0'),
  d('FLOT-T03', '12.25', '120'),
  d('FLOT-T04', '9', '7'),
])
check('断点续录：已成功的跳过，从失败条继续', () => {
  assert.strictEqual(retry.ok, true)
  assert.strictEqual(retry.existed, 3)
  assert.strictEqual(retry.created, 1)
  const codes = listEntries('flotation').items.map((r) => r['样品编号'])
  assert.strictEqual(codes.filter((c) => c === 'FLOT-T01').length, 1)
  assert.ok(codes.includes('FLOT-T04'))
})

// 4. 批内重复编号只落一条
const dup = registerFlotationBatch([
  d('FLOT-D01', '5', '1'),
  d('FLOT-D01', '6', '2'),
  d('FLOT-D02', '7', '3'),
])
check('同批重复样品只落一条', () => {
  assert.strictEqual(dup.created, 2)
  assert.strictEqual(dup.duplicated, 1)
  const t01 = listEntries('flotation').items.filter((r) => r['样品编号'] === 'FLOT-D01')
  assert.strictEqual(t01.length, 1)
  // 第一条的值生效
  assert.strictEqual(String(t01[0]['样品重量']), '5')
})

// 5. 重量、种子数一次写全，且列表/详情同一来源
check('重量与炭化种子数落库完整、列表详情一致、导出有值', () => {
  const row = listEntries('flotation', { 样品编号: 'FLOT-T01' }).items[0]
  assert.strictEqual(String(row['样品重量']), '10.5')
  assert.strictEqual(String(row['炭化种子数']), '3')
  assert.strictEqual(String(row['送检去向']), '植物考古实验室')
  assert.ok(String(row['重量口径版本']).includes('湿重口径'))
  const detail = getEntry('flotation', Number(row.id))
  assert.strictEqual(detail, row) // 同一份存储对象
  assert.strictEqual(weightOf(detail), '10.5')
  const csv = exportEntries('flotation').content
  assert.ok(csv.includes('FLOT-T01'))
  const line = csv.split('\n').find((l) => l.includes('FLOT-T01'))!
  assert.ok(line.includes('10.5') && line.includes(',3,'))
})

// 6. 历史样品重量沿用旧口径原值，不重算
check('历史样品重量保留登记时口径的值', () => {
  const old = listEntries('flotation', { 样品编号: 'FLOT-0003' }).items[0]
  assert.strictEqual(weightOf(old), '15')
  assert.strictEqual(String(old['重量口径版本']), '2025 试称量口径')
})

// 7. 确认完成 -> 回写台账（含重量与口径版本），重复确认幂等一条
const target = listEntries('flotation', { 样品编号: 'FLOT-T01' }).items[0]
check('浮选出结果后回写送检台账且幂等', () => {
  const r1 = runAction('flotation', Number(target.id), '确认完成')
  assert.strictEqual(r1.ok, true)
  assert.strictEqual(target['样品状态'] !== undefined, true)
  const done = getEntry('flotation', Number(target.id))!
  assert.strictEqual(done['样品状态'], '已完成')
  assert.strictEqual(done['status'], '已完成')
  assert.strictEqual(done['pending'], false)
  let ledger = listFlotationLedger()
  assert.strictEqual(ledger.length, 1)
  assert.strictEqual(String(ledger[0]['样品编号']), 'FLOT-T01')
  assert.strictEqual(String(ledger[0]['样品重量']), '10.5')
  assert.ok(String(ledger[0]['重量口径版本']).includes('湿重口径'))
  assert.strictEqual(String(ledger[0]['炭化种子数']), '3')
  // 已完成再确认（动作本身拒绝重复状态流转；即便再次进入也不会多台账行）
  runAction('flotation', Number(target.id), '确认完成')
  ledger = listFlotationLedger()
  assert.strictEqual(ledger.length, 1)
})

// 8. 筛选无结果 / 无数据场景的空态由 items.length 表达
check('筛选无匹配返回空集合', () => {
  assert.strictEqual(listEntries('flotation', { 样品编号: '不存在的编号XYZ' }).items.length, 0)
  assert.strictEqual(getEntry('flotation', 999999), undefined)
})

console.log(`\n全部 ${pass} 组校验通过`)
