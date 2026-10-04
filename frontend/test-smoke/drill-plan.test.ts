/* 演练筹备批次领域逻辑冒烟测试（node + esbuild，内存 localStorage）。 */
import { __setActor, type Actor } from '@/stores/session'
import { listRows } from '@/data/local-store'
import {
  ISSUE_KEY,
  NOTICE_KEY,
  OCCUPY_KEY,
  PLAN_KEY,
  batchDetail,
  historicalThemes,
  isEquipmentOccupied,
  planOptions,
  prefillEquipmentByTheme,
  recordEquipmentIssue,
  releaseOccupation,
  runBatchAction,
  saveDrillPlanDraft,
  submitDrillPlan,
} from '@/api/drill-plan'
import { runAction } from '@/api/local-service'

const admin: Actor = { name: '总指挥', role: 'admin', forestFarm: '' }
const qsl: Actor = { name: '青松岭林场值班员', role: 'operator', forestFarm: '青松岭林场' }
const bhp: Actor = { name: '白桦坡林场值班员', role: 'operator', forestFarm: '白桦坡林场' }
const viewer: Actor = { name: '值班观察员', role: 'viewer', forestFarm: '' }

let passed = 0
let failed = 0

function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${extra}`)
  }
}

function rowByCode(key: string, field: string, code: string) {
  return listRows(key).find((r) => String(r[field]) === code)
}

// ---- t1：同主题最近一次演练兼容继承装备明细 ----
__setActor(admin)
console.log('t1 同主题最近一次演练装备兼容继承')
const prefill = prefillEquipmentByTheme('秋季林区地表火扑救演练')
check('找到最近一次已总结同主题演练 DRIL-0004', prefill.sourceCode === 'DRIL-0004', prefill.sourceCode)
check('继承明细包含4类装备', prefill.inheritedNames.length === 4, String(prefill.inheritedNames))
// 二号扑火工具/防护包被 DRILP-0002 演练占用，对讲机被其他模块领用占用 → 均不可带出
check('占用中装备被识别(2件)', prefill.occupiedNames.length === 2, prefill.occupiedNames.join(','))
// 高压细水雾灭火机(id1)与风力灭火机(id2)当前可用 → 带出；同名报废/占用件不选
check('仅继承本林场可用装备(id1、id2)', prefill.equipmentIds.join() === '1,2', prefill.equipmentIds.join())
// 白桦坡值班员视角：防护包归属本林场但被占用 → 占用；细水雾/风力灭火机跨林场不可见 → 缺装备
__setActor(bhp)
const prefillBhp = prefillEquipmentByTheme('秋季林区地表火扑救演练')
check('他林场视角同名件计为缺失', prefillBhp.missingNames.includes('高压细水雾灭火机'), prefillBhp.missingNames.join(','))
__setActor(admin)
check('历史主题列表含3个主题', historicalThemes().length >= 3, String(historicalThemes()))

// ---- t2：管理员新建跨林场混合批次草稿 + 人数缺口 + 去重 ----
console.log('t2 跨林场混合批次草稿/人数缺口/重复队伍不重复计数')
const token = 'TEST-TOKEN-A'
let r = saveDrillPlanDraft({
  theme: '秋季林区地表火扑救演练',
  teamIds: [1, 5, 1], // 重复 id1
  equipmentIds: [1, 1], // 重复装备
  roadIds: [1, 5],
  prepareDate: '2026-10-05',
  executeDate: '2026-10-20',
  summaryDate: '2026-10-22',
  targetHeadcount: 60,
  requestToken: token,
})
check('草稿保存成功', r.ok, r.message)
const planId = r.planId!
const plan = listRows(PLAN_KEY).find((x) => Number(x.id) === planId)!
check('重复队伍去重为2支', String(plan['参演队伍ID']) === '1、5', String(plan['参演队伍ID']))
check('重复装备去重为1件', String(plan['所需装备ID']) === '1', String(plan['所需装备ID']))
check('参演人数=24+22=46', Number(plan['参演人数']) === 46, String(plan['参演人数']))
check('人数缺口=60-46=14', Number(plan['人数缺口']) === 14, String(plan['人数缺口']))
check('归属标记为跨林场混合', plan['归属林场'] === '跨林场混合', String(plan['归属林场']))

// ---- t3：林场值班员不能跨林场混合、不能越权动他场资源 ----
console.log('t3 越权与混合编组受控')
__setActor(qsl)
r = saveDrillPlanDraft({
  theme: '越权混合测试',
  teamIds: [1, 5],
  equipmentIds: [],
  roadIds: [],
  prepareDate: '2026-10-05',
  executeDate: '2026-10-26',
  summaryDate: '2026-10-28',
  targetHeadcount: 10,
  requestToken: 'TEST-DENY-MIX',
})
check('值班员跨林场混合被拒绝', !r.ok && r.message.includes('跨林场混合'), r.message)
r = saveDrillPlanDraft({
  theme: '越权装备测试',
  teamIds: [1],
  equipmentIds: [7], // 红松口装备
  roadIds: [],
  prepareDate: '2026-10-05',
  executeDate: '2026-10-26',
  summaryDate: '2026-10-28',
  targetHeadcount: 10,
  requestToken: 'TEST-DENY-EQUIP',
})
check('值班员选他场装备被拒绝', !r.ok && r.message.includes('越权'), r.message)
// 值班员选项范围只含本林场
const opt = planOptions()
check('值班员只见本林场队伍(2支)', opt.teams.length === 2 && opt.teams.every((t) => t.farm === '青松岭林场'), String(opt.teams.length))
// 值班员不能推进管理员建的跨林场批次
r = submitDrillPlan(planId)
check('值班员提交跨林场批次被拒', !r.ok && r.message.includes('越权'), r.message)
// 只读账号
__setActor(viewer)
r = saveDrillPlanDraft({
  theme: '只读测试', teamIds: [1], equipmentIds: [], roadIds: [],
  prepareDate: '2026-10-05', executeDate: '2026-10-26', summaryDate: '2026-10-28',
  targetHeadcount: 10, requestToken: 'TEST-VIEWER',
})
check('只读账号保存被拒绝', !r.ok && r.message.includes('只读'), r.message)
r = runAction('equipment', 1, '领用装备')
check('只读账号装备领用被拒绝', !r.ok && r.message.includes('只读'), r.message)

// ---- t4：占用冲突导致三环节全部回退（不落任何单据）----
console.log('t4 提交环节失败整体回退')
__setActor(admin)
const dutyBefore = listRows('duty').length
const issueBefore = listRows(ISSUE_KEY).length
const occupyBefore = listRows(OCCUPY_KEY).length
const noticeBefore = listRows(NOTICE_KEY).length
// 给草稿加入一支已在 DRILP-0002 值班的队伍(3)和一件已占用装备(4)
saveDrillPlanDraft({
  theme: '秋季林区地表火扑救演练',
  teamIds: [1, 3], // 队伍3已被批次0002锁定
  equipmentIds: [1, 4], // 装备4演练占用中
  roadIds: [3], // 道路3已在管制
  prepareDate: '2026-10-05',
  executeDate: '2026-10-20',
  summaryDate: '2026-10-22',
  targetHeadcount: 60,
  requestToken: token,
  id: planId,
})
r = submitDrillPlan(planId)
check('提交被中止并提示回退', !r.ok && r.message.includes('全部环节回退'), r.message)
check('值班调整未新增', listRows('duty').length === dutyBefore)
check('领用清单未新增', listRows(ISSUE_KEY).length === issueBefore)
check('占用台账未新增', listRows(OCCUPY_KEY).length === occupyBefore)
check('管制提醒未新增', listRows(NOTICE_KEY).length === noticeBefore)
check('草稿仍为待提交可修改', String(listRows(PLAN_KEY).find((x) => Number(x.id) === planId)!.status) === '待提交')

// ---- t5：修复后正常提交：一次联动生成三类单据 + 演练记录 ----
console.log('t5 正常提交原子联动')
saveDrillPlanDraft({
  theme: '秋季林区地表火扑救演练',
  teamIds: [1, 5],
  equipmentIds: [1, 7],
  roadIds: [1, 5],
  prepareDate: '2026-10-05',
  executeDate: '2026-10-20',
  summaryDate: '2026-10-22',
  targetHeadcount: 60,
  requestToken: token,
  id: planId,
})
r = submitDrillPlan(planId)
check('提交成功', r.ok, r.message)
const detail = batchDetail(planId)!
check('生成2条值班调整', detail.dutyIds.length === 2, String(detail.dutyIds))
check('生成2条领用清单', detail.issueIds.length === 2)
check('同步2条演练占用', detail.occupyIds.length === 2)
check('生成2条道路管制提醒', detail.noticeIds.length === 2)
check('生成1条联动演练记录', detail.drillRecordId > 0, String(detail.drillRecordId))
check('批次状态=筹备中', String(detail.plan.status) === '筹备中')
const linkedDrill = listRows('drill').find((x) => Number(x.id) === detail.drillRecordId)!
check('联动演练记录=筹备中', String(linkedDrill.status) === '筹备中')
check('联动演练主题=主题', String(linkedDrill['演练主题']) === '秋季林区地表火扑救演练')
check('装备1变为已领用', String(rowByCode('equipment', '装备编号', 'EQUI-0001')!.status) === '已领用')
check('装备7变为已领用', String(rowByCode('equipment', '装备编号', 'EQUI-0007')!.status) === '已领用')
check('道路1变为禁止通行', String(rowByCode('forestroad', '道路编号', 'FORE-0001')!.status) === '禁止通行')
check('队伍值班状态已调整', String(rowByCode('fireteam', '队伍编号', 'FIRE-0001')!['值班状态']).includes(token === '' ? '' : 'DRILP'))

// ---- t6：重复提交只生效一次 ----
console.log('t6 重复提交幂等')
const dutyCount = listRows('duty').length
r = submitDrillPlan(planId)
check('重复提交幂等返回', r.ok && r.message.includes('重复提交只生效一次'), r.message)
check('幂等提交不再生成单据', listRows('duty').length === dutyCount)

// ---- t7：其他模块装备领用联动进入演练占用 ----
console.log('t7 消防装备模块领用联动占用')
// 装备2 可用 → 青松岭值班员领用本林场装备
__setActor(qsl)
r = recordEquipmentIssue(2)
check('本林场装备领用成功', r.ok, r.message)
check('领用同步占用台账', isEquipmentOccupied(2))
const newIssue = listRows(ISSUE_KEY).find((x) => String(x['装备编号']) === 'EQUI-0002')
check('领用清单来源标记equipment', String(newIssue!['来源模块']) === 'equipment')
const newOccupy = listRows(OCCUPY_KEY).find((x) => Number(x['装备编号-id']) === 2)
check('占用类型为其他模块领用', String(newOccupy!['占用类型']) === '其他模块领用')
// 管理员再想把装备2纳入新演练 → 被占拒绝
__setActor(admin)
r = saveDrillPlanDraft({
  theme: '占用冲突演练', teamIds: [1], equipmentIds: [2], roadIds: [],
  prepareDate: '2026-11-01', executeDate: '2026-11-10', summaryDate: '2026-11-12',
  targetHeadcount: 10, requestToken: 'TEST-OCC-CONFLICT',
})
check('草稿阶段不拦截占用(延迟到提交)', r.ok, r.message)
r = submitDrillPlan(r.planId!)
check('提交时占用冲突回退', !r.ok && r.message.includes('占用'), r.message)
// 重复领用装备2（同林场身份）→ 占用拦截，只计一次
r = recordEquipmentIssue(2)
check('重复领用只计一次', !r.ok && r.message.includes('占用'), r.message)
// 白桦坡值班员想领用青松岭装备2 → 越权拒绝
__setActor(bhp)
r = recordEquipmentIssue(2)
check('跨林场领用被拒绝', !r.ok && r.message.includes('越权'), r.message)
// 青松岭释放占用 → 装备回到可用，单据闭环
__setActor(qsl)
const occupy2 = listRows(OCCUPY_KEY).find((x) => Number(x['装备编号-id']) === 2)!.id
r = releaseOccupation(Number(occupy2))
check('非演练占用可释放', r.ok, r.message)
check('释放后装备恢复可用', String(rowByCode('equipment', '装备编号', 'EQUI-0002')!.status) === '可用')
check('重复释放幂等', releaseOccupation(Number(occupy2)).ok)

// ---- t8：实施/总结全链路 + 通用动作防护 + 历史记录主题不变 ----
console.log('t8 实施与总结联动闭环')
__setActor(admin)
const histThemeBefore = String(rowByCode('drill', '演练编号', 'DRIL-0001')!['演练主题'])
// 联动演练记录不能在通用页单独推进
r = runAction('drill', Number(linkedDrill.id), '开始筹备')
check('联动演练记录通用动作被拦', !r.ok && r.message.includes('联动'), r.message)
// 值班中的队伍不能下达出动
r = runAction('fireteam', 1, '下达出动')
check('演练值班队伍禁止下达出动', !r.ok && r.message.includes('演练值班'), r.message)
// 占用装备不能送检/报废
r = runAction('equipment', 1, '送检登记')
check('占用装备禁止送检', !r.ok && r.message.includes('占用'), r.message)
// 管制道路不能通用封闭
r = runAction('forestroad', 1, '封闭道路')
check('管制道路通用动作被拦', !r.ok && r.message.includes('临时管制'), r.message)
// 确认实施
r = runBatchAction(planId, '确认实施')
check('确认实施成功', r.ok, r.message)
check('队伍转已出动', String(rowByCode('fireteam', '队伍编号', 'FIRE-0001')!.status) === '已出动')
check('联动演练转已实施', String(listRows('drill').find((x) => Number(x.id) === detail.drillRecordId)!.status) === '已实施')
// 提交总结
r = runBatchAction(planId, '提交总结')
check('提交总结成功', r.ok, r.message)
const d2 = batchDetail(planId)!
check('批次已总结', String(d2.plan.status) === '已总结')
check('装备1恢复可用', String(rowByCode('equipment', '装备编号', 'EQUI-0001')!.status) === '可用')
check('装备7恢复可用', String(rowByCode('equipment', '装备编号', 'EQUI-0007')!.status) === '可用')
check('道路1恢复正常通行', String(rowByCode('forestroad', '道路编号', 'FORE-0001')!.status) === '正常通行')
check('道路5恢复正常通行', String(rowByCode('forestroad', '道路编号', 'FORE-0005')!.status) === '正常通行')
check('领用清单全部归还', listRows(ISSUE_KEY).filter((x) => d2.issueIds.includes(Number(x.id))).every((x) => String(x.status) === '已归还'))
check('占用台账全部释放', listRows(OCCUPY_KEY).filter((x) => d2.occupyIds.includes(Number(x.id))).every((x) => String(x.status) === '已释放'))
check('管制提醒全部解除', listRows(NOTICE_KEY).filter((x) => d2.noticeIds.includes(Number(x.id))).every((x) => String(x.status) === '已解除'))
check('队伍归位在营待命', String(rowByCode('fireteam', '队伍编号', 'FIRE-0001')!.status) === '在营待命')
check('联动演练记录已总结', String(listRows('drill').find((x) => Number(x.id) === d2.drillRecordId)!.status) === '已总结')
check('历史演练记录保持原主题', String(rowByCode('drill', '演练编号', 'DRIL-0001')!['演练主题']) === histThemeBefore)

// ---- t9：种子批次0002 数据自洽 ----
console.log('t9 种子筹备批次自洽')
const seedPlan = rowByCode(PLAN_KEY, '批次编号', 'DRILP-0002')!
check('种子批次为筹备中', String(seedPlan.status) === '筹备中')
const sd = batchDetail(Number(seedPlan.id))!
check('种子批次值班调整1条', sd.dutyIds.length === 1)
check('种子批次领用清单2条', sd.issueIds.length === 2)
check('种子批次管制提醒1条', sd.noticeIds.length === 1)
check('种子批次演练记录=5', sd.drillRecordId === 5)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (typeof globalThis !== 'undefined') {
  const g = globalThis as unknown as { __FAIL_COUNT__?: number }
  g.__FAIL_COUNT__ = failed
}
