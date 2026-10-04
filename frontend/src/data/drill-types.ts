/** 应急演练筹备批次的结构化领域模型。
 * 通用台账仍走 EntryRow；批次及其联动产物（值班调整 / 装备领用 / 道路管制）
 * 是强关系数据，单独结构化存放，避免把关系硬塞进字符串字段。 */

export type BatchStatus = '待提交' | '筹备中' | '已实施' | '已总结'

export type BatchStage = '筹备' | '实施' | '总结'

export type RequisitionSource = '演练批次' | '火情报告' | '其他模块'

export type RequisitionStatus = '占用中' | '已归还'

/** 参演队伍条目：同一队伍重复加入只保留一条（按队伍行 id 去重）。 */
export type TeamEntry = {
  teamRowId: number
  队伍编号: string
  队伍名称: string
  所属林场: string
  队员人数: number
}

/** 所需装备明细：数量 = 申请量，满足量 = 当下可占用的数量，缺口写进 shortage。 */
export type EquipmentNeed = {
  equipmentRowId: number
  装备编号: string
  装备名称: string
  装备类型: string
  保管林场: string
  quantity: number
  satisfied: number
  shortage: number
  /** 该明细是否由同主题历史演练兼容继承而来。 */
  inherited: boolean
}

/** 扑火队伍值班调整，由提交筹备联动生成，落在值勤排班台账里。 */
export type DutyAdjustment = {
  key: string
  teamRowId: number
  队伍名称: string
  dutyRowId: number
  值勤日期: string
  值勤时段: string
  值勤岗位: string
}

/** 林区道路临时管制提醒，由提交筹备联动生成。 */
export type RoadNotice = {
  key: string
  roadRowId: number
  道路名称: string
  管制日期: string
  管制时段: string
  管制原因: string
  提醒内容: string
}

/** 装备领用清单条目，演练批次与别的模块共用一张占用账。 */
export type EquipmentRequisition = {
  id: number
  source: RequisitionSource
  /** 来源单号：演练批次号 / 火情报告号等，用于按单核对。 */
  sourceRef: string
  batchId?: number
  equipmentRowId: number
  装备编号: string
  装备名称: string
  quantity: number
  领用日期: string
  用途: string
  领用人: string
  归属林场: string
  status: RequisitionStatus
}

export type DrillBatch = {
  id: number
  批次编号: string
  演练编号: string
  演练主题: string
  /** 整组安排的三个阶段日期。 */
  筹备日期: string
  实施日期: string
  总结日期: string
  /** 参演人数目标：用于计算缺口。 */
  目标参演人数: number
  allowMixedForest: boolean
  teams: TeamEntry[]
  equipmentNeeds: EquipmentNeed[]
  dutyAdjustments: DutyAdjustment[]
  roadNotices: RoadNotice[]
  status: BatchStatus
  /** 去重后的实际参演人数（各队伍队员人数之和）。 */
  参演人数: number
  参演人数缺口: number
  装备缺口总数: number
  owner: string
  ownerForest: string
  createdAt: string
  submittedAt: string
  /** 幂等令牌：同一令牌（即重复提交）只生效一次。 */
  submitToken: string
}

export type BatchDraftInput = {
  演练主题: string
  筹备日期: string
  实施日期: string
  总结日期: string
  目标参演人数: number
  allowMixedForest: boolean
  /** 允许同一 id 重复出现，服务层按 id 去重，重复加入不重复计数。 */
  teamRowIds: number[]
  equipmentSelections: { equipmentRowId: number; quantity: number }[]
  /** 临时管制涉及的林区道路（行 id）。 */
  roadRowIds: number[]
  /** 管制时段，默认 06:30-13:00；管制提醒在提交时联动生成。 */
  roadControlTime?: string
}

export type BatchSubmitResult = {
  ok: boolean
  message: string
  batch?: DrillBatch
  /** 事务三个环节的落地情况，任一失败全部回退，这里只在成功时给出。 */
  stages?: {
    值班调整: DutyAdjustment[]
    装备领用: EquipmentRequisition[]
    道路管制: RoadNotice[]
  }
}
