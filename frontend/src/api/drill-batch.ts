import { listRows } from '@/data/local-store'
import {
  commitAll,
  loadDrillStore,
  loadRequisitions,
  nextBatchId,
  nextRequisitionId,
} from '@/data/drill-store'
import type { EntryRow } from '@/data/types'
import type {
  BatchDraftInput,
  BatchSubmitResult,
  DrillBatch,
  DutyAdjustment,
  EquipmentNeed,
  EquipmentRequisition,
  RequisitionSource,
  RoadNotice,
  TeamEntry,
} from '@/data/drill-types'

/**
 * 应急演练筹备批次编排服务。
 * 数据流：扑火队伍 / 消防装备 / 林区道路（来源台账）
 *   → 筹备批次（选人、选装备、排三阶段、算缺口）
 *   → 提交（单事务联动写入）值勤排班、装备领用账、道路管制提醒、演练台账
 * 装备领用账同时被别的模块写入，演练选装备时把这些外部占用一并算进缺口。
 */

const DRILL = 'drill'
const FIRETEAM = 'fireteam'
const EQUIPMENT = 'equipment'
const FORESTROAD = 'forestroad'
const DUTY = 'duty'

const UNUSABLE_EQUIPMENT_STATUS = ['待检修', '已报废']
const BLOCKED_ROAD_STATUS = ['正在施工', '禁止通行']
const DEPLOYED_TEAM_STATUS = ['已出动', '扑救中']

export type Actor = {
  roleKey: 'commander' | 'forester' | 'observer'
  operator: string
  forest: string
}

export class ServiceError extends Error {}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextEntryId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

function assertWritable(actor: Actor): void {
  if (actor.roleKey === 'observer') {
    throw new ServiceError('当前角色为只读观察员，不能进行筹备操作')
  }
}

/* ------------------------------------------------------------------ */
/* 装备占用：演练批次领用 + 别的模块领用 + 台账上已领用 的装备共同占用 */
/* ------------------------------------------------------------------ */

/** 装备台账里状态为「已领用」但尚未在占用账登记的，折算成外部占用（兼容既有数据）。 */
export function equipmentOccupiedCount(
  equipmentRowId: number,
  requisitions: EquipmentRequisition[],
  equipmentRows: EntryRow[],
  excludeBatchId?: number,
): number {
  let count = requisitions
    .filter(
      (item) =>
        item.status === '占用中' &&
        item.equipmentRowId === equipmentRowId &&
        // 只排除「同一批次自己」的占用；外部领用 batchId 为空，必须保留计入。
        !(excludeBatchId !== undefined && item.batchId === excludeBatchId),
    )
    .reduce((sum, item) => sum + item.quantity, 0)
  const row = equipmentRows.find((item) => Number(item.id) === equipmentRowId)
  if (row && String(row.status) === '已领用') {
    const registered = requisitions.some(
      (item) =>
        item.status === '占用中' &&
        item.equipmentRowId === equipmentRowId &&
        !(excludeBatchId !== undefined && item.batchId === excludeBatchId),
    )
    if (!registered) count += 1
  }
  return count
}

/** 单件装备当前可占用数量：台账总量（这里每件装备一行）减去既有占用。 */
function availableQuantity(
  equipmentRowId: number,
  requisitions: EquipmentRequisition[],
  equipmentRows: EntryRow[],
): number {
  const row = equipmentRows.find((item) => Number(item.id) === equipmentRowId)
  if (!row || UNUSABLE_EQUIPMENT_STATUS.includes(String(row.status))) {
    return 0
  }
  const occupied = equipmentOccupiedCount(equipmentRowId, requisitions, equipmentRows)
  return Math.max(0, 1 - occupied)
}

function buildEquipmentNeed(
  equipmentRowId: number,
  quantity: number,
  requisitions: EquipmentRequisition[],
  equipmentRows: EntryRow[],
  inherited: boolean,
): EquipmentNeed {
  const row = equipmentRows.find((item) => Number(item.id) === equipmentRowId)
  if (!row) {
    throw new ServiceError(`所选装备（编号 ${equipmentRowId}）不存在，无法编制领用清单`)
  }
  const want = Math.max(1, num(quantity, 1))
  const usable = UNUSABLE_EQUIPMENT_STATUS.includes(String(row.status)) ? 0 : 1
  const available = usable === 0 ? 0 : availableQuantity(equipmentRowId, requisitions, equipmentRows)
  const satisfied = Math.min(want, available)
  return {
    equipmentRowId,
    装备编号: String(row.装备编号 ?? ''),
    装备名称: String(row.装备名称 ?? ''),
    装备类型: String(row.装备类型 ?? ''),
    保管林场: String(row.保管林场 ?? ''),
    quantity: want,
    satisfied,
    shortage: want - satisfied,
    inherited,
  }
}

/* ------------------------------------------------------------------ */
/* 同主题最近一次兼容：先用结构化历史批次，再回退台账里的历史演练记录 */
/* ------------------------------------------------------------------ */

export function latestCompatibleNeeds(theme: string): {
  needs: { equipmentRowId: number; quantity: number }[]
  sourceRef: string
  sourceDate: string
} {
  const trimmed = theme.trim()
  const store = loadDrillStore()
  const sameThemeBatches = store.batches
    .filter((batch) => batch.演练主题 === trimmed)
    .sort((a, b) => (a.实施日期 < b.实施日期 ? 1 : -1))
  const latestBatch = sameThemeBatches[0]
  if (latestBatch && latestBatch.equipmentNeeds.length) {
    return {
      sourceRef: latestBatch.批次编号,
      sourceDate: latestBatch.实施日期,
      needs: latestBatch.equipmentNeeds.map((item) => ({
        equipmentRowId: item.equipmentRowId,
        quantity: item.quantity,
      })),
    }
  }
  // 回退：没有结构化批次时，从台账历史演练的「使用装备」文本里解析装备名称。
  const drills = listRows(DRILL)
    .filter((row) => String(row.演练主题) === trimmed)
    .sort((a, b) => String(a.演练日期) < String(b.演练日期) ? 1 : -1)
  const latestDrill = drills[0]
  if (!latestDrill) {
    return { needs: [], sourceRef: '', sourceDate: '' }
  }
  const text = String(latestDrill.使用装备 ?? '')
  const equipmentRows = listRows(EQUIPMENT)
  const needs: { equipmentRowId: number; quantity: number }[] = []
  for (const row of equipmentRows) {
    if (text.includes(String(row.装备名称))) {
      needs.push({ equipmentRowId: Number(row.id), quantity: 1 })
    }
  }
  return { needs, sourceRef: String(latestDrill.演练编号), sourceDate: String(latestDrill.演练日期) }
}

/* ------------------------------------------------------------------ */
/* 队伍：跨林场混合开关 + 按队伍行 id 去重，重复加入不重复计数 */
/* ------------------------------------------------------------------ */

function buildTeams(input: BatchDraftInput, actor: Actor): TeamEntry[] {
  const teamRows = listRows(FIRETEAM)
  // Set 去重：同一队伍重复勾选/重复加入，只计一次。
  const uniqueIds = Array.from(new Set(input.teamRowIds.map((id) => Number(id))))
  if (uniqueIds.length === 0) {
    throw new ServiceError('至少选择一支参演队伍')
  }
  const teams = uniqueIds.map((teamRowId): TeamEntry => {
    const row = teamRows.find((item) => Number(item.id) === teamRowId)
    if (!row) {
      throw new ServiceError(`所选扑火队伍（编号 ${teamRowId}）不存在`)
    }
    return {
      teamRowId,
      队伍编号: String(row.队伍编号 ?? ''),
      队伍名称: String(row.队伍名称 ?? ''),
      所属林场: String(row.所属林场 ?? ''),
      队员人数: num(row.队员人数),
    }
  })
  const forests = new Set(teams.map((team) => team.所属林场))
  // 是否跨林场混合由筹备人在表单上决定；关闭混合时必须同林场。
  if (!input.allowMixedForest && forests.size > 1) {
    throw new ServiceError(
      `本批次不允许跨林场混合参演，但所选队伍分属 ${Array.from(forests).join('、')}`,
    )
  }
  // 林场值班员只能调动本林场队伍；指挥中心可跨林场混编。
  if (actor.roleKey === 'forester') {
    const outside = teams.filter((team) => team.所属林场 !== actor.forest)
    if (outside.length) {
      throw new ServiceError(
        `越权：${outside.map((team) => team.队伍名称).join('、')}不属于${actor.forest}，不能编入本批次`,
      )
    }
  }
  // 已出动 / 扑救中的队伍无法再排参演值班（该环节必须失败回退）。
  const deployed = teams.filter((team) => {
    const row = teamRows.find((item) => Number(item.id) === team.teamRowId)
    return row && DEPLOYED_TEAM_STATUS.includes(String(row.status))
  })
  if (deployed.length) {
    throw new ServiceError(
      `${deployed.map((team) => team.队伍名称).join('、')}正处于出动/扑救状态，无法调整参演值班，请改派待命队伍`,
    )
  }
  return teams
}

function buildRoadNotices(input: BatchDraftInput): RoadNotice[] {
  if (input.roadRowIds.length === 0) {
    return []
  }
  const roadRows = listRows(FORESTROAD)
  const controlTime = input.roadControlTime || '06:30-13:00'
  return Array.from(new Set(input.roadRowIds.map((id) => Number(id)))).map((roadRowId) => {
    const row = roadRows.find((item) => Number(item.id) === roadRowId)
    if (!row) {
      throw new ServiceError(`所选林区道路（编号 ${roadRowId}）不存在`)
    }
    return {
      key: `draft-${roadRowId}`,
      roadRowId,
      道路名称: String(row.道路名称 ?? ''),
      管制日期: input.实施日期,
      管制时段: controlTime,
      管制原因: input.演练主题.trim(),
      提醒内容: `${input.演练主题.trim()}车队通行，请社会车辆按现场指引绕行`,
    }
  })
}

function validateDates(input: BatchDraftInput): void {
  if (!input.演练主题.trim()) {
    throw new ServiceError('请选择演练主题')
  }
  if (!input.筹备日期 || !input.实施日期 || !input.总结日期) {
    throw new ServiceError('请整组填写筹备、实施、总结三个日期')
  }
  if (input.筹备日期 > input.实施日期) {
    throw new ServiceError('筹备日期不能晚于实施日期')
  }
  if (input.实施日期 > input.总结日期) {
    throw new ServiceError('总结日期不能早于实施日期')
  }
}

/* ------------------------------------------------------------------ */
/* 新建批次（草稿）：只在批次账里落一条「待提交」，不动任何联动台账 */
/* ------------------------------------------------------------------ */

export function createBatch(input: BatchDraftInput, actor: Actor): DrillBatch {
  assertWritable(actor)
  validateDates(input)
  const teams = buildTeams(input, actor)
  const equipmentRows = listRows(EQUIPMENT)
  const requisitions = loadRequisitions()
  const equipmentNeeds = input.equipmentSelections.map((selection) =>
    buildEquipmentNeed(
      selection.equipmentRowId,
      selection.quantity,
      requisitions,
      equipmentRows,
      false,
    ),
  )
  const headcount = teams.reduce((sum, team) => sum + team.队员人数, 0)
  const target = Math.max(0, num(input.目标参演人数))
  const roadNotices = buildRoadNotices(input)
  const store = loadDrillStore()
  const id = nextBatchId(store.batches)
  const batch: DrillBatch = {
    id,
    批次编号: `DRB-${today().replace(/-/g, '')}-${String(id).padStart(3, '0')}`,
    演练编号: `DRIL-${today().replace(/-/g, '')}-${String(id).padStart(3, '0')}`,
    演练主题: input.演练主题.trim(),
    筹备日期: input.筹备日期,
    实施日期: input.实施日期,
    总结日期: input.总结日期,
    目标参演人数: target,
    allowMixedForest: input.allowMixedForest,
    teams,
    equipmentNeeds,
    dutyAdjustments: [],
    roadNotices,
    status: '待提交',
    参演人数: headcount,
    参演人数缺口: Math.max(0, target - headcount),
    装备缺口总数: equipmentNeeds.reduce((sum, item) => sum + item.shortage, 0),
    owner: actor.operator,
    ownerForest: actor.roleKey === 'forester' ? actor.forest : '全局',
    createdAt: new Date().toISOString(),
    submittedAt: '',
    submitToken: `token-${Date.now()}-${id}`,
  }
  const nextStore = clone(store)
  nextStore.batches.unshift(batch)
  commitAll({ drill: nextStore })
  return batch
}

/* ------------------------------------------------------------------ */
/* 提交筹备：三环节单事务，任一失败全部回退；重复提交只生效一次 */
/* ------------------------------------------------------------------ */

export function submitBatch(batchId: number, actor: Actor): BatchSubmitResult {
  assertWritable(actor)
  const store = loadDrillStore()
  const batch = store.batches.find((item) => item.id === batchId)
  if (!batch) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的筹备批次` }
  }
  if (actor.roleKey === 'forester' && batch.ownerForest !== actor.forest) {
    return { ok: false, message: '越权拦截：该批次不属于你所在林场，只读不可提交' }
  }
  // 幂等：同一批次重复提交只生效一次。
  if (batch.status !== '待提交') {
    return {
      ok: true,
      message: `批次 ${batch.批次编号} 已提交过（${batch.submittedAt || batch.status}），重复提交不重复生效`,
      batch,
    }
  }
  if (store.submittedTokens.includes(batch.submitToken)) {
    return { ok: false, message: '该筹备请求已生效，请勿重复提交' }
  }

  // —— 全程在内存快照上操作，任何一步抛错都不会落盘，实现整体回退。 ——
  try {
    const entriesNow: Record<string, EntryRow[]> = {
      [FIRETEAM]: clone(listRows(FIRETEAM)),
      [EQUIPMENT]: clone(listRows(EQUIPMENT)),
      [FORESTROAD]: clone(listRows(FORESTROAD)),
      [DUTY]: clone(listRows(DUTY)),
      [DRILL]: clone(listRows(DRILL)),
    }
    const requisitionsNow = clone(loadRequisitions())
    const nextStore = clone(store)
    const target = nextStore.batches.find((item) => item.id === batchId) as DrillBatch

    // 重新校验三阶段日期与队伍（提交前可能已有队伍被派出）。
    validateDates({
      演练主题: target.演练主题,
      筹备日期: target.筹备日期,
      实施日期: target.实施日期,
      总结日期: target.总结日期,
      目标参演人数: target.目标参演人数,
      allowMixedForest: target.allowMixedForest,
      teamRowIds: target.teams.map((team) => team.teamRowId),
      equipmentSelections: [],
      roadRowIds: target.roadNotices.map((notice) => notice.roadRowId),
    })
    const teamRows = entriesNow[FIRETEAM]
    for (const team of target.teams) {
      const row = teamRows.find((item) => Number(item.id) === team.teamRowId)
      if (!row) throw new ServiceError(`参演队伍「${team.队伍名称}」已不存在，提交取消`)
      if (DEPLOYED_TEAM_STATUS.includes(String(row.status))) {
        throw new ServiceError(`参演队伍「${team.队伍名称}」已出动，值班调整无法生成，整体回退`)
      }
    }

    /* 环节一：扑火队伍值班调整 → 值勤排班台账 */
    const dutyRows = entriesNow[DUTY]
    const adjustments: DutyAdjustment[] = []
    target.teams.forEach((team, index) => {
      const dutyId = nextEntryId(dutyRows) + index
      const adjustment: DutyAdjustment = {
        key: `${batchId}-${team.teamRowId}`,
        teamRowId: team.teamRowId,
        队伍名称: team.队伍名称,
        dutyRowId: dutyId,
        值勤日期: target.实施日期,
        值勤时段: '07:00-19:00',
        值勤岗位: `${target.演练主题}参演`,
      }
      adjustments.push(adjustment)
      dutyRows.push({
        id: dutyId,
        status: '已调班',
        pending: true,
        abnormal: false,
        排班编号: `DUTY-DRILL-${String(dutyId).padStart(4, '0')}`,
        值勤日期: target.实施日期,
        值勤时段: '07:00-19:00',
        值勤岗位: `${target.演练主题}参演`,
        值勤人员: team.队伍名称,
        接班人员: '原值班组',
        交接记录: `为批次 ${target.批次编号} 参演临时调班`,
        排班状态: '已调班',
      })
    })

    /* 环节二：消防装备领用清单 → 装备占用账；按当前库存重算缺口 */
    const equipmentRowsNow = entriesNow[EQUIPMENT]
    const rebuiltNeeds: EquipmentNeed[] = []
    const newRequisitions: EquipmentRequisition[] = []
    let requisitionId = nextRequisitionId(requisitionsNow)
    for (const need of target.equipmentNeeds) {
      const rebuilt = buildEquipmentNeed(
        need.equipmentRowId,
        need.quantity,
        [...requisitionsNow, ...newRequisitions],
        equipmentRowsNow,
        need.inherited,
      )
      rebuiltNeeds.push(rebuilt)
      if (rebuilt.satisfied > 0) {
        const requisition: EquipmentRequisition = {
          id: requisitionId++,
          source: '演练批次',
          sourceRef: target.批次编号,
          batchId: target.id,
          equipmentRowId: rebuilt.equipmentRowId,
          装备编号: rebuilt.装备编号,
          装备名称: rebuilt.装备名称,
          quantity: rebuilt.satisfied,
          领用日期: target.实施日期,
          用途: `${target.演练主题}参演`,
          领用人: actor.operator,
          归属林场: rebuilt.保管林场,
          status: '占用中',
        }
        newRequisitions.push(requisition)
      }
    }
    requisitionsNow.push(...newRequisitions)

    /* 环节三：林区道路临时管制提醒（不封路，只发提醒；施工/封闭道路无法管制） */
    const roadRows = entriesNow[FORESTROAD]
    const notices: RoadNotice[] = target.roadNotices.map((notice, index) => {
      const row = roadRows.find((item) => Number(item.id) === notice.roadRowId)
      if (!row) throw new ServiceError(`管制道路「${notice.道路名称}」已不存在，提交取消`)
      if (BLOCKED_ROAD_STATUS.includes(String(row.status))) {
        throw new ServiceError(
          `道路「${notice.道路名称}」当前${row.status}，无法实施临时管制，整体回退`,
        )
      }
      return { ...clone(notice), key: `${batchId}-${notice.roadRowId}-${index}` }
    })

    /* 联动写演练台账：新增一条演练记录（历史演练记录的主题绝不改动） */
    const drillRows = entriesNow[DRILL]
    const drillId = nextEntryId(drillRows)
    drillRows.unshift({
      id: drillId,
      status: '筹备中',
      pending: true,
      abnormal: false,
      演练编号: target.演练编号,
      演练主题: target.演练主题,
      参演队伍: target.teams.map((team) => team.队伍名称).join('、'),
      演练日期: target.实施日期,
      参演人数: target.参演人数,
      使用装备:
        rebuiltNeeds.map((need) => need.装备名称).join('、') +
        (target.装备缺口总数 > 0 ? '（存在装备缺口，见批次明细）' : ''),
      演练评价: '',
      演练状态: '筹备中',
    })

    // 更新批次本体。
    target.dutyAdjustments = adjustments
    target.roadNotices = notices
    target.equipmentNeeds = rebuiltNeeds
    target.装备缺口总数 = rebuiltNeeds.reduce((sum, item) => sum + item.shortage, 0)
    target.status = '筹备中'
    target.submittedAt = new Date().toISOString()
    nextStore.submittedTokens.push(target.submitToken)

    // 单事务提交：entries / drill / requisitions 一次落盘，任一环节在此前抛错都不会走到这里。
    commitAll({
      entries: {
        ...allEntrySnapshot(),
        [FIRETEAM]: entriesNow[FIRETEAM],
        [EQUIPMENT]: entriesNow[EQUIPMENT],
        [FORESTROAD]: entriesNow[FORESTROAD],
        [DUTY]: entriesNow[DUTY],
        [DRILL]: entriesNow[DRILL],
      },
      drill: nextStore,
      requisitions: requisitionsNow,
    })

    return {
      ok: true,
      message: `批次 ${target.批次编号} 筹备提交成功：${adjustments.length} 条值班调整、${newRequisitions.length} 条装备领用、${notices.length} 条道路管制提醒已联动生成`,
      batch: target,
      stages: {
        值班调整: adjustments,
        装备领用: newRequisitions,
        道路管制: notices,
      },
    }
  } catch (error) {
    // 未落盘即回退：返回失败信息，调用方提示「全部回退」。
    const message = error instanceof Error ? error.message : '筹备提交失败'
    return { ok: false, message: `${message}；三个环节已全部回退，未产生任何值班、领用或管制记录` }
  }
}

/** 取全量台账快照用于整包提交（保证未触及的模块数据不丢）。 */
function allEntrySnapshot(): Record<string, EntryRow[]> {
  const keys = [
    'patrol', 'firewatch', 'lookout', 'firebreak', FIRETEAM, EQUIPMENT, 'weather',
    'firereport', 'drone', 'campaign', 'checkpoint', DUTY, 'supply', FORESTROAD,
    'firebelt', DRILL, 'burnpermit', 'treegrowth',
  ]
  return Object.fromEntries(keys.map((key) => [key, clone(listRows(key))]))
}

/* ------------------------------------------------------------------ */
/* 阶段推进：完成演练 / 提交总结；越权与只读在服务层拦截并同步台账 */
/* ------------------------------------------------------------------ */

export function advanceBatch(
  batchId: number,
  to: '已实施' | '已总结',
  actor: Actor,
): BatchSubmitResult {
  if (actor.roleKey !== 'commander') {
    return { ok: false, message: '只有指挥中心可以推进演练阶段' }
  }
  const store = loadDrillStore()
  const batch = store.batches.find((item) => item.id === batchId)
  if (!batch) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的筹备批次` }
  }
  const order: DrillBatch['status'][] = ['待提交', '筹备中', '已实施', '已总结']
  const currentIndex = order.indexOf(batch.status)
  const targetIndex = order.indexOf(to)
  if (currentIndex < 0 || targetIndex <= currentIndex) {
    return { ok: false, message: `批次当前为「${batch.status}」，不能推进到「${to}」` }
  }
  const nextStore = clone(store)
  const targetBatch = nextStore.batches.find((item) => item.id === batchId) as DrillBatch
  targetBatch.status = to

  // 同步台账里对应演练记录的状态（只改本批次生成的那条，历史记录保持原主题）。
  const drillRows = clone(listRows(DRILL))
  const linked = drillRows.find((row) => String(row.演练编号) === targetBatch.演练编号)
  if (linked) {
    linked.status = to
    linked.演练状态 = to
    linked.pending = to !== '已总结'
    if (to === '已总结') {
      linked.演练评价 = linked.演练评价 || '演练已按计划完成并总结归档'
    }
  }
  commitAll({ entries: { ...allEntrySnapshot(), [DRILL]: drillRows }, drill: nextStore })
  return { ok: true, message: `批次 ${batch.批次编号} 已推进到「${to}」`, batch: targetBatch }
}

/* ------------------------------------------------------------------ */
/* 别的模块的装备领用清单：联动加入演练占用账（幂等，按来源+装备去重） */
/* ------------------------------------------------------------------ */

export function registerExternalRequisition(input: {
  source: RequisitionSource
  sourceRef: string
  equipmentRowId: number
  quantity: number
  领用日期: string
  用途: string
  领用人: string
  actor: Actor
}): EquipmentRequisition {
  assertWritable(input.actor)
  if (!input.sourceRef.trim()) {
    throw new ServiceError('来源单号不能为空，无法登记其他模块的装备领用')
  }
  const equipmentRows = listRows(EQUIPMENT)
  const row = equipmentRows.find((item) => Number(item.id) === input.equipmentRowId)
  if (!row) {
    throw new ServiceError(`装备（编号 ${input.equipmentRowId}）不存在，不能开具领用清单`)
  }
  const requisitions = loadRequisitions()
  // 幂等：同一来源单对同一装备重复开具，只计一次。
  const duplicated = requisitions.find(
    (item) =>
      item.status === '占用中' &&
      item.source === input.source &&
      item.sourceRef === input.sourceRef &&
      item.equipmentRowId === input.equipmentRowId,
  )
  if (duplicated) {
    throw new ServiceError(`来源单 ${input.sourceRef} 已领用「${row.装备名称}」，重复报名只计一次`)
  }
  const occupied = equipmentOccupiedCount(input.equipmentRowId, requisitions, equipmentRows)
  if (occupied >= 1) {
    throw new ServiceError(`「${row.装备名称}」已被占用（含演练/其他模块领用），库存不足`)
  }
  const requisition: EquipmentRequisition = {
    id: nextRequisitionId(requisitions),
    source: input.source,
    sourceRef: input.sourceRef,
    equipmentRowId: input.equipmentRowId,
    装备编号: String(row.装备编号 ?? ''),
    装备名称: String(row.装备名称 ?? ''),
    quantity: Math.max(1, num(input.quantity, 1)),
    领用日期: input.领用日期 || today(),
    用途: input.用途,
    领用人: input.领用人 || input.actor.operator,
    归属林场: String(row.保管林场 ?? ''),
    status: '占用中',
  }
  commitAll({ requisitions: [...requisitions, requisition] })
  return requisition
}

/* ------------------------------------------------------------------ */
/* 查询：批次列表 / 详情 / 占用明细，供页面展示数据流与缺口 */
/* ------------------------------------------------------------------ */

export function listBatches(): DrillBatch[] {
  return loadDrillStore().batches
}

export function getBatch(batchId: number): DrillBatch | undefined {
  return loadDrillStore().batches.find((item) => item.id === batchId)
}

export function listRequisitions(): EquipmentRequisition[] {
  return loadRequisitions()
}

/** 某件装备的占用构成：演练批次领用 + 其他模块领用（+台账已领用折算）。 */
export function equipmentOccupancy(equipmentRowId: number): {
  total: number
  drill: EquipmentRequisition[]
  external: EquipmentRequisition[]
  ledgerCheckedOut: boolean
} {
  const requisitions = loadRequisitions()
  const active = requisitions.filter(
    (item) => item.status === '占用中' && item.equipmentRowId === equipmentRowId,
  )
  const drill = active.filter((item) => item.source === '演练批次')
  const external = active.filter((item) => item.source !== '演练批次')
  const row = listRows(EQUIPMENT).find((item) => Number(item.id) === equipmentRowId)
  const ledgerCheckedOut = !!row && String(row.status) === '已领用' && active.length === 0
  return { total: active.length + (ledgerCheckedOut ? 1 : 0), drill, external, ledgerCheckedOut }
}
