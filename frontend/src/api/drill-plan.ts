import { listRows, commitAll } from '@/data/local-store'
import { useSessionStore, type Actor } from '@/stores/session'
import type { ActionResult, EntryRow } from '@/data/types'

// 演练筹备批次是唯一允许跨表编排的领域：一次提交会联动以下模块/台账。
export const PLAN_KEY = 'drillplan'
const TEAM_KEY = 'fireteam'
const EQUIP_KEY = 'equipment'
const ROAD_KEY = 'forestroad'
const DUTY_KEY = 'duty'
const DRILL_KEY = 'drill'
// 三本联动台账：装备领用清单、演练占用台账（单一事实源）、道路管制提醒。
export const ISSUE_KEY = 'equipissue'
export const OCCUPY_KEY = 'equipoccupy'
export const NOTICE_KEY = 'roadnotice'

const ACTIVE_PLAN_STATUSES = ['筹备中', '已实施']
const TEAM_BUSY_STATUSES = ['已出动', '扑救中']
const ROAD_BLOCKED_STATUSES = ['正在施工', '禁止通行']

export type DrillPlanInput = {
  id?: number
  theme: string
  teamIds: number[]
  equipmentIds: number[]
  roadIds: number[]
  prepareDate: string
  executeDate: string
  summaryDate: string
  targetHeadcount: number
  requestToken: string
}

export type PlanOption = {
  id: number
  name: string
  farm: string
  members: number
  status: string
  extra: string
}

export type EquipmentPrefill = {
  theme: string
  sourceCode: string
  equipmentIds: number[]
  inheritedNames: string[]
  occupiedNames: string[]
  missingNames: string[]
}

export type BatchDetail = {
  plan: EntryRow
  teamIds: number[]
  equipmentIds: number[]
  roadIds: number[]
  dutyIds: number[]
  issueIds: number[]
  occupyIds: number[]
  noticeIds: number[]
  drillRecordId: number
}

function currentActor(): Actor {
  return useSessionStore().actor()
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

function toInt(value: unknown): number {
  const parsed = Number(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function parseIdList(value: unknown): number[] {
  return String(value ?? '')
    .split(/[、,，]/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
}

function joinNames(rows: EntryRow[], nameField: string): string {
  return rows.map((row) => String(row[nameField] ?? '')).filter(Boolean).join('、')
}

function today(): string {
  return new Date().toISOString().slice(0,10)
}

// 只读账号在任何写入口都会被拦下；林场值班员只能操作归属本林场的数据；
// 跨林场混合批次只有管理员能建、能推进。
function assertWritable(actor: Actor): ActionResult | null {
  if (actor.role === 'viewer') {
    return fail('当前身份为只读查看员，不能进行任何登记、提交或状态流转操作')
  }
  if (!actor.name.trim()) {
    return fail('缺少值班操作人，禁止匿名提交筹备批次')
  }
  return null
}

function farmOf(row: EntryRow): string {
  return String(row['所属林场'] ?? row['保管林场'] ?? '').trim()
}

function assertSameFarm(actor: Actor, farm: string, label: string): ActionResult | null {
  if (actor.role === 'admin') {
    return null
  }
  if (farm && farm !== actor.forestFarm) {
    return fail(`越权操作：${label}归属「${farm}」，${actor.forestFarm || '本林场'}账号不能动用`)
  }
  return null
}

function activePlans(): EntryRow[] {
  return listRows(PLAN_KEY).filter((row) => ACTIVE_PLAN_STATUSES.includes(String(row.status)))
}

function planContainsTeam(plan: EntryRow, teamId: number): boolean {
  return parseIdList(plan['参演队伍ID']).includes(teamId)
}

function teamLockedByOtherPlan(teamId: number, selfPlanId?: number): EntryRow | undefined {
  return activePlans().find(
    (plan) => Number(plan.id) !== selfPlanId && planContainsTeam(plan, teamId),
  )
}

function activeOccupancy(equipmentId: number): EntryRow | undefined {
  return listRows(OCCUPY_KEY).find(
    (row) => String(row.status) === '占用中' && Number(row['装备编号-id']) === equipmentId,
  )
}

export function isEquipmentOccupied(equipmentId: number): boolean {
  return activeOccupancy(equipmentId) !== undefined
}

// 选择项按权限过滤：林场值班员只能看到本林场队伍/装备/道路，管理员可跨林场混合编组。
export function planOptions(actor: Actor = currentActor()): {
  teams: PlanOption[]
  equipment: PlanOption[]
  roads: PlanOption[]
} {
  const inScope = (row: EntryRow): boolean =>
    actor.role === 'admin' ? true : farmOf(row) === actor.forestFarm
  return {
    teams: listRows(TEAM_KEY)
      .filter(inScope)
      .map((row) => ({
        id: Number(row.id),
        name: String(row['队伍名称'] ?? ''),
        farm: farmOf(row),
        members: toInt(row['队员人数']),
        status: String(row.status ?? ''),
        extra: String(row['值班状态'] ?? ''),
      })),
    equipment: listRows(EQUIP_KEY)
      .filter(inScope)
      .map((row) => ({
        id: Number(row.id),
        name: String(row['装备名称'] ?? ''),
        farm: farmOf(row),
        members: 0,
        status: String(row.status ?? ''),
        extra: String(row['装备类型'] ?? ''),
      })),
    roads: listRows(ROAD_KEY)
      .filter(inScope)
      .map((row) => ({
        id: Number(row.id),
        name: String(row['道路名称'] ?? ''),
        farm: String(row['所属林场'] ?? ''),
        members: 0,
        status: String(row.status ?? ''),
        extra: String(row['道路编号'] ?? ''),
      })),
  }
}

// 旧演练缺装备明细时，按同主题、最近一次、已进入历史的演练兼容继承装备需求。
export function prefillEquipmentByTheme(
  theme: string,
  actor: Actor = currentActor(),
): EquipmentPrefill {
  const empty: EquipmentPrefill = {
    theme,
    sourceCode: '',
    equipmentIds: [],
    inheritedNames: [],
    occupiedNames: [],
    missingNames: [],
  }
  const trimmed = theme.trim()
  if (!trimmed) {
    return empty
  }
  const history = listRows(DRILL_KEY)
    .filter(
      (row) =>
        String(row['演练主题'] ?? '').trim() === trimmed &&
        ['已实施', '已总结', '已归档'].includes(String(row.status)) &&
        String(row['使用装备'] ?? '').trim() !== '',
    )
    .sort((a, b) => Number(b.id) - Number(a.id))
  const source = history[0]
  if (!source) {
    return empty
  }
  const names = String(source['使用装备'] ?? '')
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
  // 继承只能落在当前身份有权使用的林场范围内，避免把他林场同名装备带进批次。
  const inScope = (row: EntryRow): boolean => {
    if (actor.role === 'admin') {
      return true
    }
    return farmOf(row) === actor.forestFarm
  }
  const allEquipment = listRows(EQUIP_KEY)
  const equipmentIds: number[] = []
  const occupiedNames: string[] = []
  const missingNames: string[] = []
  for (const name of names) {
    const matches = allEquipment.filter(
      (row) => String(row['装备名称'] ?? '') === name && inScope(row),
    )
    const available = matches.find((row) => String(row.status) === '可用' && !activeOccupancy(Number(row.id)))
    if (available) {
      equipmentIds.push(Number(available.id))
      continue
    }
    // 本林场有同名件但不可用/被占用 → 占用；根本没有同名件 → 缺装备明细。
    if (matches.length > 0) {
      occupiedNames.push(name)
    } else {
      missingNames.push(name)
    }
  }
  return {
    theme: trimmed,
    sourceCode: String(source['演练编号'] ?? ''),
    equipmentIds,
    inheritedNames: names,
    occupiedNames,
    missingNames,
  }
}

export function historicalThemes(): string[] {
  const seen = new Set<string>()
  for (const row of listRows(DRILL_KEY)) {
    const theme = String(row['演练主题'] ?? '').trim()
    if (theme) {
      seen.add(theme)
    }
  }
  return [...seen]
}

function planHeadcount(teamRows: EntryRow[]): number {
  // 重复加入同一队伍不得重复计数：以队伍 id 去重后再汇总队员人数。
  return teamRows.reduce((sum, row) => sum + toInt(row['队员人数']), 0)
}

// 保存待提交草稿（整组安排）。只写批次自身，不产生任何联动单据。
export function saveDrillPlanDraft(
  input: DrillPlanInput,
  actor: Actor = currentActor(),
): ActionResult & { planId?: number } {
  const denied = assertWritable(actor)
  if (denied) {
    return denied
  }
  const theme = input.theme.trim()
  const errors: string[] = []
  if (!theme) {
    errors.push('演练主题不能为空')
  }
  if (!input.prepareDate || !input.executeDate || !input.summaryDate) {
    errors.push('筹备、实施、总结三个日期必须整组排定')
  } else if (input.prepareDate > input.executeDate || input.executeDate > input.summaryDate) {
    errors.push('日期顺序应为：筹备开始 ≤ 实施日期 ≤ 总结日期')
  }
  if (input.targetHeadcount < 0) {
    errors.push('目标参演人数不能为负数')
  }
  const teamIds = [...new Set(input.teamIds)]
  const equipmentIds = [...new Set(input.equipmentIds)]
  const roadIds = [...new Set(input.roadIds)]
  if (teamIds.length === 0) {
    errors.push('至少多选一支参演队伍')
  }

  const plans = listRows(PLAN_KEY)
  // 重复提交只生效一次：同一提交凭证再次保存直接回到原批次，不会生成第二张草稿。
  const tokenPlan = plans.find((row) => String(row['提交批次'] ?? '') === input.requestToken)
  if (input.requestToken && tokenPlan && Number(tokenPlan.id) !== input.id) {
    return { ok: true, message: '同凭证筹备批次已存在，重复保存只生效一次', planId: Number(tokenPlan.id) }
  }

  const teams = listRows(TEAM_KEY)
  const teamRows = teamIds
    .map((id) => teams.find((row) => Number(row.id) === id))
    .filter((row): row is EntryRow => Boolean(row))
  if (teamRows.length !== teamIds.length) {
    errors.push('部分参演队伍不存在或已被移除')
  }
  const farms = [...new Set(teamRows.map(farmOf).filter(Boolean))]
  const ownerFarm = farms.length > 1 ? '跨林场混合' : farms[0] ?? ''
  if (farms.length > 1 && actor.role !== 'admin') {
    // 不同林场队伍允许混合，但混合编组的决定权收归管理员。
    errors.push(`所选队伍分属${farms.join('、')}，跨林场混合编组仅管理员可安排`)
  }
  for (const row of teamRows) {
    const farmBlock = assertSameFarm(actor, farmOf(row), `队伍「${row['队伍名称']}」`)
    if (farmBlock) {
      errors.push(farmBlock.message)
    }
  }

  const equipment = listRows(EQUIP_KEY)
  const equipRows = equipmentIds
    .map((id) => equipment.find((row) => Number(row.id) === id))
    .filter((row): row is EntryRow => Boolean(row))
  if (equipRows.length !== equipmentIds.length) {
    errors.push('部分所需装备不存在或已被移除')
  }
  for (const row of equipRows) {
    const farmBlock = assertSameFarm(actor, farmOf(row), `装备「${row['装备名称']}」`)
    if (farmBlock) {
      errors.push(farmBlock.message)
    }
  }

  const roads = listRows(ROAD_KEY)
  const roadRows = roadIds
    .map((id) => roads.find((row) => Number(row.id) === id))
    .filter((row): row is EntryRow => Boolean(row))
  if (roadRows.length !== roadIds.length) {
    errors.push('部分管制道路不存在或已被移除')
  }

  if (errors.length > 0) {
    return fail(errors.join('；'))
  }

  const headcount = planHeadcount(teamRows)
  const gap = Math.max(0, input.targetHeadcount - headcount)
  const existing = input.id ? plans.find((row) => Number(row.id) === input.id) : undefined
  if (existing && String(existing.status) !== '待提交') {
    return fail('该批次已提交筹备，不能再修改草稿；如需调整请走实施/总结流转')
  }
  const ownerBlock = existing ? assertOwnership(actor, existing) : null
  if (ownerBlock) {
    return ownerBlock
  }
  const planId = existing ? Number(existing.id) : nextId(plans)
  const code = existing ? String(existing['批次编号']) : `DRILP-${String(planId).padStart(4, '0')}`
  const row: EntryRow = {
    id: planId,
    status: '待提交',
    pending: true,
    abnormal: false,
    '批次编号': code,
    '演练主题': theme,
    '归属林场': ownerFarm,
    '参演队伍': joinNames(teamRows, '队伍名称'),
    '参演人数': headcount,
    '目标人数': input.targetHeadcount,
    '人数缺口': gap,
    '所需装备': joinNames(equipRows, '装备名称'),
    '筹备开始': input.prepareDate,
    '实施日期': input.executeDate,
    '总结日期': input.summaryDate,
    '管制道路': joinNames(roadRows, '道路名称'),
    '提交批次': input.requestToken,
    // 以下为内部联动字段，不在页面列中展示。
    '参演队伍ID': teamIds.join('、'),
    '所需装备ID': equipmentIds.join('、'),
    '管制道路ID': roadIds.join('、'),
    '创建人': actor.name,
    '值班调整ID': existing?.['值班调整ID'] ?? '',
    '领用清单ID': existing?.['领用清单ID'] ?? '',
    '管制提醒ID': existing?.['管制提醒ID'] ?? '',
    '占用台账ID': existing?.['占用台账ID'] ?? '',
    '演练记录ID': existing?.['演练记录ID'] ?? '',
  }
  const nextPlans = existing
    ? plans.map((item) => (Number(item.id) === planId ? row : item))
    : [...plans, row]
  commitAll({ [PLAN_KEY]: nextPlans })
  return { ok: true, message: existing ? '筹备批次草稿已更新' : '筹备批次草稿已登记，提交后联动生效', planId }
}

function assertOwnership(actor: Actor, plan: EntryRow): ActionResult | null {
  if (actor.role === 'admin') {
    return null
  }
  const owner = String(plan['归属林场'] ?? '')
  if (owner === '跨林场混合' || owner !== actor.forestFarm) {
    return fail(`越权操作：批次「${plan['批次编号']}」归属${owner || '其他林场'}，本林场账号不能操作`)
  }
  return null
}

// 提交筹备：先把三个环节的校验全部跑完，任一环节不通过就一张单据都不落；
// 全部通过后用单次原子提交写齐 6 类数据，落库失败也按快照整体回退。
export function submitDrillPlan(planId: number, actor: Actor = currentActor()): ActionResult {
  const denied = assertWritable(actor)
  if (denied) {
    return denied
  }
  const plans = listRows(PLAN_KEY)
  const plan = plans.find((row) => Number(row.id) === planId)
  if (!plan) {
    return fail(`没有找到编号为 ${planId} 的演练筹备批次`)
  }
  if (String(plan.status) !== '待提交') {
    // 重复提交只生效一次：已提交批次再次提交直接幂等返回。
    return { ok: true, message: `批次「${plan['批次编号']}」已是「${plan.status}」，重复提交只生效一次` }
  }
  const ownerBlock = assertOwnership(actor, plan)
  if (ownerBlock) {
    return ownerBlock
  }

  const teamIds = parseIdList(plan['参演队伍ID'])
  const equipmentIds = parseIdList(plan['所需装备ID'])
  const roadIds = parseIdList(plan['管制道路ID'])
  const code = String(plan['批次编号'])
  const errors: string[] = []

  // 环节一：扑火队伍值班调整前置校验。
  const teams = listRows(TEAM_KEY)
  const teamRows = teamIds.map((id) => teams.find((row) => Number(row.id) === id))
  if (teamRows.some((row) => !row)) {
    errors.push('参演队伍存在缺失，值班调整无法整组生成')
  }
  for (const row of teamRows) {
    if (!row) {
      continue
    }
    if (TEAM_BUSY_STATUSES.includes(String(row.status))) {
      errors.push(`队伍「${row['队伍名称']}」当前为「${row.status}」，不能安排演练值班调整`)
    }
    const locker = teamLockedByOtherPlan(Number(row.id), Number(plan.id))
    if (locker) {
      errors.push(`队伍「${row['队伍名称']}」已被批次「${locker['批次编号']}」占用值班，重复报名只计一次`)
    }
  }

  // 环节二：消防装备领用清单 + 演练占用前置校验。
  const equipment = listRows(EQUIP_KEY)
  const equipRows = equipmentIds.map((id) => equipment.find((row) => Number(row.id) === id))
  if (equipRows.some((row) => !row)) {
    errors.push('所需装备存在缺失，领用清单无法整组生成')
  }
  for (const row of equipRows) {
    if (!row) {
      continue
    }
    if (String(row.status) !== '可用') {
      errors.push(`装备「${row['装备名称']}」当前为「${row.status}」，不能纳入领用清单`)
      continue
    }
    const occupancy = activeOccupancy(Number(row.id))
    if (occupancy) {
      errors.push(
        `装备「${row['装备名称']}」已被${String(occupancy['占用类型'])}（${String(occupancy['来源单号'])}）占用，不能重复领用`,
      )
    }
  }

  // 环节三：林区道路临时管制提醒前置校验。
  const roads = listRows(ROAD_KEY)
  const roadRows = roadIds.map((id) => roads.find((row) => Number(row.id) === id))
  if (roadRows.some((row) => !row)) {
    errors.push('管制道路存在缺失，临时管制提醒无法整组生成')
  }
  for (const row of roadRows) {
    if (!row) {
      continue
    }
    if (ROAD_BLOCKED_STATUSES.includes(String(row.status))) {
      errors.push(`道路「${row['道路名称']}」当前为「${row.status}」，不能再叠加临时管制`)
    }
  }

  if (errors.length > 0) {
    return fail(`筹备提交已中止，全部环节回退未落任何单据：${errors.join('；')}`)
  }

  // 校验全部通过后，在内存中整组造单，最后一次原子提交。
  const duties = [...listRows(DUTY_KEY)]
  const issues = [...listRows(ISSUE_KEY)]
  const occupies = [...listRows(OCCUPY_KEY)]
  const notices = [...listRows(NOTICE_KEY)]
  const drills = [...listRows(DRILL_KEY)]

  const dutyIds: number[] = []
  for (const row of teamRows as EntryRow[]) {
    const dutyId = nextId(duties)
    dutyIds.push(dutyId)
    duties.push({
      id: dutyId,
      status: '已确认',
      pending: false,
      abnormal: false,
      '排班编号': `DUTY-${String(dutyId).padStart(4, '0')}`,
      '值勤日期': String(plan['实施日期']),
      '值勤时段': `${plan['筹备开始']} 至 ${plan['总结日期']}`,
      '值勤岗位': `应急演练保障（${code}）`,
      '值勤人员': String(row['队伍名称']),
      '接班人员': String(row['队长姓名'] ?? ''),
      '交接记录': `值班调整：常态值班转演练值班，随批次${code}联动生成`,
      '排班状态': '已确认',
      '来源类型': '演练值班调整',
      '关联批次': code,
    })
    row['值班状态'] = `演练值班·${code}`
  }

  const issueIds: number[] = []
  const occupyIds: number[] = []
  for (const row of equipRows as EntryRow[]) {
    const issueId = nextId(issues)
    const issueCode = `ISSU-${String(issueId).padStart(4, '0')}`
    issueIds.push(issueId)
    issues.push({
      id: issueId,
      status: '领用中',
      pending: true,
      abnormal: false,
      '领用单号': issueCode,
      '装备编号': String(row['装备编号']),
      '装备名称': String(row['装备名称']),
      '装备类型': String(row['装备类型'] ?? ''),
      '保管林场': farmOf(row),
      '领用单位': String(plan['归属林场']),
      '来源模块': PLAN_KEY,
      '关联批次': code,
      '领用人': actor.name,
      '领用日期': today(),
      '归还日期': '',
    })
    const occupyId = nextId(occupies)
    occupyIds.push(occupyId)
    occupies.push({
      id: occupyId,
      status: '占用中',
      pending: true,
      abnormal: false,
      '占用编号': `OCCU-${String(occupyId).padStart(4, '0')}`,
      '装备编号': String(row['装备编号']),
      '装备编号-id': Number(row.id),
      '装备名称': String(row['装备名称']),
      '占用类型': '演练领用',
      '来源单号': issueCode,
      '来源模块': PLAN_KEY,
      '关联批次': code,
      '占用开始': today(),
      '占用结束': '',
      '说明': `随批次${code}提交筹备自动登记`,
    })
    row.status = '已领用'
    row.pending = true
  }

  const noticeIds: number[] = []
  for (const row of roadRows as EntryRow[]) {
    const noticeId = nextId(notices)
    noticeIds.push(noticeId)
    notices.push({
      id: noticeId,
      status: '管制中',
      pending: true,
      abnormal: false,
      '提醒编号': `ROAD-${String(noticeId).padStart(4, '0')}`,
      '道路编号': String(row['道路编号']),
      '道路名称': String(row['道路名称']),
      '管制日期': String(plan['实施日期']),
      '解除日期': '',
      '关联批次': code,
      '管制说明': `林区道路临时管制提醒：${row['道路名称']}于${plan['实施日期']}演练实施期间禁止社会车辆通行`,
    })
    row.status = '禁止通行'
    row.pending = true
    row['管制批次'] = code
  }

  // 同步生成一条正式演练记录；历史演练记录的主题等字段在任何环节都不会被改写。
  const drillId = nextId(drills)
  drills.push({
    id: drillId,
    status: '筹备中',
    pending: true,
    abnormal: false,
    '演练编号': `DRIL-${String(drillId).padStart(4, '0')}`,
    '演练主题': String(plan['演练主题']),
    '参演队伍': String(plan['参演队伍']),
    '演练日期': String(plan['实施日期']),
    '参演人数': Number(plan['参演人数']),
    '使用装备': String(plan['所需装备']),
    '演练评价': '',
    '演练状态': '筹备中',
    '关联批次': code,
  })

  const submittedPlan: EntryRow = {
    ...plan,
    status: '筹备中',
    pending: true,
    '值班调整ID': dutyIds.join('、'),
    '领用清单ID': issueIds.join('、'),
    '管制提醒ID': noticeIds.join('、'),
    '占用台账ID': occupyIds.join('、'),
    '演练记录ID': drillId,
  }
  try {
    commitAll({
      [PLAN_KEY]: plans.map((row) => (Number(row.id) === Number(plan.id) ? submittedPlan : row)),
      [TEAM_KEY]: teams,
      [EQUIP_KEY]: equipment,
      [ROAD_KEY]: roads,
      [DUTY_KEY]: duties,
      [ISSUE_KEY]: issues,
      [OCCUPY_KEY]: occupies,
      [NOTICE_KEY]: notices,
      [DRILL_KEY]: drills,
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : '筹备提交落库失败，已整体回退')
  }
  return {
    ok: true,
    message: `批次「${code}」筹备已提交：联动值班调整 ${dutyIds.length} 条、装备领用 ${issueIds.length} 条、道路管制提醒 ${noticeIds.length} 条`,
  }
}

// 批次后续流转：确认实施 / 提交总结。同样一次性联动所有单据，失败整体回退。
export function runBatchAction(
  planId: number,
  action: '确认实施' | '提交总结',
  actor: Actor = currentActor(),
): ActionResult {
  const denied = assertWritable(actor)
  if (denied) {
    return denied
  }
  const plans = listRows(PLAN_KEY)
  const plan = plans.find((row) => Number(row.id) === planId)
  if (!plan) {
    return fail(`没有找到编号为 ${planId} 的演练筹备批次`)
  }
  const ownerBlock = assertOwnership(actor, plan)
  if (ownerBlock) {
    return ownerBlock
  }
  const code = String(plan['批次编号'])
  if (action === '确认实施' && String(plan.status) !== '筹备中') {
    return fail(`批次「${code}」当前为「${plan.status}」，只有筹备中的批次才能确认实施`)
  }
  if (action === '提交总结' && String(plan.status) !== '已实施') {
    return fail(`批次「${code}」当前为「${plan.status}」，只有已实施的批次才能提交总结`)
  }

  const teams = [...listRows(TEAM_KEY)]
  const equipment = [...listRows(EQUIP_KEY)]
  const roads = [...listRows(ROAD_KEY)]
  const duties = [...listRows(DUTY_KEY)]
  const issues = [...listRows(ISSUE_KEY)]
  const occupies = [...listRows(OCCUPY_KEY)]
  const notices = [...listRows(NOTICE_KEY)]
  const drills = [...listRows(DRILL_KEY)]
  const teamIds = parseIdList(plan['参演队伍ID'])
  const equipmentIds = parseIdList(plan['所需装备ID'])
  const roadIds = parseIdList(plan['管制道路ID'])
  const dutyIds = parseIdList(plan['值班调整ID'])
  const issueIds = parseIdList(plan['领用清单ID'])
  const occupyIds = parseIdList(plan['占用台账ID'])
  const noticeIds = parseIdList(plan['管制提醒ID'])
  const drillRecordId = Number(plan['演练记录ID'])

  if (action === '确认实施') {
    for (const id of teamIds) {
      const row = teams.find((item) => Number(item.id) === id)
      if (row) {
        row.status = '已出动'
        row['出动状态'] = `演练出动·${code}`
      }
    }
    for (const id of dutyIds) {
      const row = duties.find((item) => Number(item.id) === id)
      if (row) {
        row.status = '值勤中'
      }
    }
    const drill = drills.find((item) => Number(item.id) === drillRecordId)
    if (drill) {
      drill.status = '已实施'
      drill['演练状态'] = '已实施'
    }
    const updated: EntryRow = { ...plan, status: '已实施' }
    commitAll({
      [PLAN_KEY]: plans.map((row) => (Number(row.id) === planId ? updated : row)),
      [TEAM_KEY]: teams,
      [DUTY_KEY]: duties,
      [DRILL_KEY]: drills,
    })
    return { ok: true, message: `批次「${code}」已确认实施，参演队伍转入演练出动，值班调整同步值勤中` }
  }

  // 提交总结：归还装备、解除道路管制、队伍收队、单据闭环，只动本批次联动生成的数据。
  for (const id of teamIds) {
    const row = teams.find((item) => Number(item.id) === id)
    if (row) {
      row.status = '在营待命'
      row['值班状态'] = '常态值班'
      row['出动状态'] = '在营待命'
    }
  }
  for (const id of dutyIds) {
    const row = duties.find((item) => Number(item.id) === id)
    if (row) {
      row.status = '已交接'
      row.pending = false
    }
  }
  for (const id of equipmentIds) {
    const row = equipment.find((item) => Number(item.id) === id)
    if (row) {
      row.status = '可用'
      row.pending = true
    }
  }
  for (const id of issueIds) {
    const row = issues.find((item) => Number(item.id) === id)
    if (row) {
      row.status = '已归还'
      row.pending = false
      row['归还日期'] = today()
    }
  }
  for (const id of occupyIds) {
    const row = occupies.find((item) => Number(item.id) === id)
    if (row) {
      row.status = '已释放'
      row.pending = false
      row['占用结束'] = today()
    }
  }
  for (const id of roadIds) {
    const row = roads.find((item) => Number(item.id) === id)
    if (row) {
      row.status = '正常通行'
      row['管制批次'] = ''
    }
  }
  for (const id of noticeIds) {
    const row = notices.find((item) => Number(item.id) === id)
    if (row) {
      row.status = '已解除'
      row.pending = false
      row['解除日期'] = today()
    }
  }
  const drill = drills.find((item) => Number(item.id) === drillRecordId)
  if (drill) {
    drill.status = '已总结'
    drill.pending = false
    drill['演练状态'] = '已总结'
    drill['演练评价'] = `按批次${code}完成筹备、实施与总结，装备已归还、道路管制已解除。`
  }
  const updated: EntryRow = { ...plan, status: '已总结', pending: false }
  try {
    commitAll({
      [PLAN_KEY]: plans.map((row) => (Number(row.id) === planId ? updated : row)),
      [TEAM_KEY]: teams,
      [EQUIP_KEY]: equipment,
      [ROAD_KEY]: roads,
      [DUTY_KEY]: duties,
      [ISSUE_KEY]: issues,
      [OCCUPY_KEY]: occupies,
      [NOTICE_KEY]: notices,
      [DRILL_KEY]: drills,
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : '总结提交落库失败，已整体回退')
  }
  return { ok: true, message: `批次「${code}」已提交总结，值班归位、装备归还、道路解除管制，全部联动单据闭环` }
}

// 其他模块（消防装备页）执行「领用装备」时，同样在领用清单登记并同步进演练占用台账：
// 装备一旦在别处领用，演练筹备就选不到它，杜绝同一装备两边重复计数。
export function recordEquipmentIssue(
  equipmentId: number,
  actor: Actor = currentActor(),
): ActionResult {
  const denied = assertWritable(actor)
  if (denied) {
    return denied
  }
  const equipment = [...listRows(EQUIP_KEY)]
  const row = equipment.find((item) => Number(item.id) === equipmentId)
  if (!row) {
    return fail(`没有找到编号为 ${equipmentId} 的消防装备`)
  }
  const farmBlock = assertSameFarm(actor, farmOf(row), `装备「${row['装备名称']}」`)
  if (farmBlock) {
    return farmBlock
  }
  const occupancy = activeOccupancy(equipmentId)
  if (occupancy) {
    return fail(
      `装备「${row['装备名称']}」已被${String(occupancy['占用类型'])}（${String(occupancy['来源单号'])}）占用，重复领用只计一次`,
    )
  }
  if (String(row.status) !== '可用') {
    return fail(`装备「${row['装备名称']}」当前为「${row.status}」，只有可用装备能领用`)
  }
  const issues = [...listRows(ISSUE_KEY)]
  const occupies = [...listRows(OCCUPY_KEY)]
  const issueId = nextId(issues)
  const issueCode = `ISSU-${String(issueId).padStart(4, '0')}`
  issues.push({
    id: issueId,
    status: '领用中',
    pending: true,
    abnormal: false,
    '领用单号': issueCode,
    '装备编号': String(row['装备编号']),
    '装备名称': String(row['装备名称']),
    '装备类型': String(row['装备类型'] ?? ''),
    '保管林场': farmOf(row),
    '领用单位': actor.forestFarm || '防火指挥部',
    '来源模块': EQUIP_KEY,
    '关联批次': '',
    '领用人': actor.name,
    '领用日期': today(),
    '归还日期': '',
  })
  const occupyId = nextId(occupies)
  occupies.push({
    id: occupyId,
    status: '占用中',
    pending: true,
    abnormal: false,
    '占用编号': `OCCU-${String(occupyId).padStart(4, '0')}`,
    '装备编号': String(row['装备编号']),
    '装备编号-id': equipmentId,
    '装备名称': String(row['装备名称']),
    '占用类型': '其他模块领用',
    '来源单号': issueCode,
    '来源模块': EQUIP_KEY,
    '关联批次': '',
    '占用开始': today(),
    '占用结束': '',
    '说明': '由消防装备模块领用联动登记，演练筹备同步视为占用',
  })
  row.status = '已领用'
  row.pending = true
  commitAll({ [EQUIP_KEY]: equipment, [ISSUE_KEY]: issues, [OCCUPY_KEY]: occupies })
  return { ok: true, message: `装备「${row['装备名称']}」已领用，领用清单与演练占用台账已同步登记` }
}

// 占用中的装备禁止送检/报废，必须先释放占用，避免演练物资在占用期间被改状态。
export function assertEquipmentMutable(equipmentId: number): ActionResult | null {
  const occupancy = activeOccupancy(equipmentId)
  if (occupancy) {
    return fail(
      `装备正被${String(occupancy['占用类型'])}（${String(occupancy['来源单号'])}）占用，需先释放占用才能变更状态`,
    )
  }
  return null
}

// 演练值班调整期间，队伍不能再被下达出动，避免一套人马两条任务线。
export function assertTeamMutable(teamId: number): ActionResult | null {
  const lockers = activePlans().filter((plan) => planContainsTeam(plan, teamId))
  const locker = lockers[0]
  if (locker) {
    return fail(`队伍已随批次「${locker['批次编号']}」进入演练值班调整，不能再下达出动`)
  }
  return null
}

// 释放非演练来源的占用（装备模块领用的归还入口）；演练占用只能由提交总结统一释放。
export function releaseOccupation(occupyId: number, actor: Actor = currentActor()): ActionResult {
  const denied = assertWritable(actor)
  if (denied) {
    return denied
  }
  const occupies = [...listRows(OCCUPY_KEY)]
  const occupy = occupies.find((row) => Number(row.id) === occupyId)
  if (!occupy) {
    return fail(`没有找到编号为 ${occupyId} 的装备占用记录`)
  }
  if (String(occupy.status) !== '占用中') {
    return { ok: true, message: '该占用已释放，重复操作只生效一次' }
  }
  if (String(occupy['来源模块']) === PLAN_KEY) {
    return fail('演练占用由批次「提交总结」统一归还，不能单独释放')
  }
  const equipment = [...listRows(EQUIP_KEY)]
  const issues = [...listRows(ISSUE_KEY)]
  const equipCode = String(occupy['装备编号'])
  const equipRow = equipment.find((row) => String(row['装备编号']) === equipCode)
  const farmBlock = equipRow ? assertSameFarm(actor, farmOf(equipRow), `装备「${equipRow['装备名称']}」`) : null
  if (farmBlock) {
    return farmBlock
  }
  const issueCode = String(occupy['来源单号'])
  const issue = issues.find((row) => String(row['领用单号']) === issueCode)
  if (issue) {
    issue.status = '已归还'
    issue.pending = false
    issue['归还日期'] = today()
  }
  if (equipRow) {
    equipRow.status = '可用'
  }
  occupy.status = '已释放'
  occupy.pending = false
  occupy['占用结束'] = today()
  commitAll({ [OCCUPY_KEY]: occupies, [ISSUE_KEY]: issues, [EQUIP_KEY]: equipment })
  return { ok: true, message: `装备「${occupy['装备名称']}」占用已释放，领用清单同步闭环` }
}

export function batchDetail(planId: number): BatchDetail | null {
  const plan = listRows(PLAN_KEY).find((row) => Number(row.id) === planId)
  if (!plan) {
    return null
  }
  return {
    plan,
    teamIds: parseIdList(plan['参演队伍ID']),
    equipmentIds: parseIdList(plan['所需装备ID']),
    roadIds: parseIdList(plan['管制道路ID']),
    dutyIds: parseIdList(plan['值班调整ID']),
    issueIds: parseIdList(plan['领用清单ID']),
    occupyIds: parseIdList(plan['占用台账ID']),
    noticeIds: parseIdList(plan['管制提醒ID']),
    drillRecordId: Number(plan['演练记录ID']) || 0,
  }
}

export function listLedger(key: string): EntryRow[] {
  return listRows(key)
}
