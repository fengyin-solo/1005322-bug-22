/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 浮选样品批量登记草稿：页面收集到的都是字符串，校验与归一化由数据层完成。
export type FlotationDraft = {
  样品编号: string
  采样单位: string
  样品重量: string
  浮选日期: string
  炭屑含量: string
  炭化种子数: string
  送检去向: string
}

// 批量登记里每条草稿的处理结果：created 新增 / existed 库内已有跳过 /
// duplicated 同批重复跳过 / failed 校验失败并在这一条中断。
export type FlotationBatchItem = {
  index: number
  样品编号: string
  outcome: 'created' | 'existed' | 'duplicated' | 'failed'
  message: string
}

export type FlotationBatchResult = {
  ok: boolean
  total: number
  created: number
  existed: number
  duplicated: number
  failedIndex: number | null
  items: FlotationBatchItem[]
}
