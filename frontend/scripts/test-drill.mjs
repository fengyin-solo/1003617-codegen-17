// 核心编排逻辑自测：用内存 localStorage 垫片在 Node 下验证关键不变量。
// 运行：node --experimental-vm-modules 不依赖；通过 esbuild 即时打包后执行。
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const testCode = `
import { listRows } from '@/data/local-store'
import { resetDrillData } from '@/data/drill-store'
import {
  createBatch, submitBatch, advanceBatch, listBatches, listRequisitions,
  registerExternalRequisition, latestCompatibleNeeds, equipmentOccupancy,
} from '@/api/drill-batch'

let pass = 0, fail = 0
function check(name, cond, extra='') {
  if (cond) { pass++; console.log('  ✅', name) }
  else { fail++; console.log('  ❌', name, extra) }
}
const commander = { roleKey: 'commander', operator: '值班管理员', forest: '全局' }
const forester = { roleKey: 'forester', operator: '青松林场值班员', forest: '青松林场' }
const observer = { roleKey: 'observer', operator: '观察员', forest: '全局' }

const base = {
  筹备日期: '2026-10-10', 实施日期: '2026-10-18', 总结日期: '2026-10-20',
  目标参演人数: 40, allowMixedForest: true, roadRowIds: [1],
}

// 1. 同主题最近一次兼容
const compat = latestCompatibleNeeds('春季扑火实战演练')
check('同主题最近一次=DRIL-2026-006（2026-04-10）', compat.sourceRef === 'DRB-2026-006' && compat.sourceDate === '2026-04-10', JSON.stringify(compat.sourceRef))
check('兼容明细带出6项装备', compat.needs.length === 6, String(compat.needs.length))

// 2. 去重计数：队伍1重复加入两次
const b1 = createBatch({
  ...base, 演练主题: '夏季雷击火应急演练',
  teamRowIds: [1, 1, 4], equipmentSelections: [{equipmentRowId:1,quantity:1}],
}, commander)
check('重复加入同一队伍只计一支', b1.teams.length === 2, String(b1.teams.length))
check('去重后参演人数=30+18=48', b1.参演人数 === 48, String(b1.参演人数))
check('目标40无人数缺口', b1.参演人数缺口 === 0, String(b1.参演人数缺口))
check('草稿不产生值班/领用/管制记录', b1.dutyAdjustments.length === 0)

// 3. 人数缺口
const b2 = createBatch({
  ...base, 演练主题: '冬季装具拉动演练', 目标参演人数: 100,
  teamRowIds: [6], equipmentSelections: [{equipmentRowId:9,quantity:1}],
}, commander)
check('单队15人目标100缺口85', b2.参演人数 === 15 && b2.参演人数缺口 === 85, String(b2.参演人数缺口))

// 4. 提交成功联动三环节
const dutyBefore = listRows('duty').length
const reqBefore = listRequisitions().length
const drillBefore = listRows('drill').length
const r1 = submitBatch(b1.id, commander)
check('提交成功', r1.ok, r1.message)
check('生成2条值班调整', r1.stages.值班调整.length === 2)
check('生成领用清单', r1.stages.装备领用.length >= 1)
check('生成1条道路管制', r1.stages.道路管制.length === 1)
check('值勤排班台账+2', listRows('duty').length === dutyBefore + 2)
check('领用账增加', listRequisitions().length >= reqBefore + 1)
check('演练台账新增1条', listRows('drill').length === drillBefore + 1)

// 5. 幂等：重复提交只生效一次
const dutyAfterFirst = listRows('duty').length
const r2 = submitBatch(b1.id, commander)
check('重复提交返回幂等提示', r2.ok && /已提交过/.test(r2.message), r2.message)
check('重复提交不新增值班记录', listRows('duty').length === dutyAfterFirst)

// 6. 事务回退：选施工道路(3)提交必须失败且无任何台账变化
const b3 = createBatch({
  ...base, 演练主题: '秋季联防联合演练', roadRowIds: [3],
  teamRowIds: [1], equipmentSelections: [{equipmentRowId:4,quantity:1}],
}, commander)
const before = { duty: listRows('duty').length, req: listRequisitions().length, drill: listRows('drill').length }
const r3 = submitBatch(b3.id, commander)
check('施工道路导致提交失败', !r3.ok && /回退/.test(r3.message), r3.message)
check('回退后值班台账不变', listRows('duty').length === before.duty)
check('回退后领用账不变', listRequisitions().length === before.req)
check('回退后演练台账不变', listRows('drill').length === before.drill)
const b3again = listBatches().find(b => b.id === b3.id)
check('回退后批次仍是待提交', b3again.status === '待提交', b3again.status)

// 7. 出动中队伍阻断回退
let blocked = false
try {
  createBatch({ ...base, 演练主题: '夏季雷击火应急演练', teamRowIds: [2], equipmentSelections: [] }, commander)
} catch (e) { blocked = /出动|扑救/.test(e.message) }
check('已出动队伍不能编入（环节失败）', blocked)

// 8. 跨林场混合开关：关闭混合选跨林场队伍报错
let mixBlocked = false
try {
  createBatch({ ...base, 演练主题: '夏季雷击火应急演练', allowMixedForest: false, teamRowIds: [1,2], equipmentSelections: [] }, commander)
} catch (e) { mixBlocked = /跨林场/.test(e.message) }
check('关闭混合时跨林场被拒', mixBlocked)

// 9. 其他模块领用联动占用 + 幂等
registerExternalRequisition({ source: '火情报告', sourceRef: 'FIREREP-T-1', equipmentRowId: 4, quantity:1, 领用日期:'2026-10-05', 用途:'测试火情', 领用人:'测试', actor: commander })
check('外部领用计入占用', equipmentOccupancy(4).total === 1 && equipmentOccupancy(4).external.length === 1)
let extDup = false
try {
  registerExternalRequisition({ source: '火情报告', sourceRef: 'FIREREP-T-1', equipmentRowId: 4, quantity:1, 领用日期:'2026-10-05', 用途:'测试火情', 领用人:'测试', actor: commander })
} catch (e) { extDup = /重复|只计一次/.test(e.message) }
check('外部领用重复报名只计一次', extDup)

// 10. 外部占用导致演练选该装备产生缺口
const b4 = createBatch({ ...base, 演练主题: '冬季装具拉动演练', teamRowIds: [1], equipmentSelections: [{equipmentRowId:4,quantity:1}] }, commander)
check('被占用装备在新批次里记1件缺口', b4.equipmentNeeds[0].shortage === 1, String(b4.equipmentNeeds[0].shortage))

// 11. 权限：观察员只读
let obsBlocked = false
try { createBatch({ ...base, 演练主题: '冬季装具拉动演练', teamRowIds: [1], equipmentSelections: [] }, observer) }
catch (e) { obsBlocked = /只读/.test(e.message) }
check('观察员不能新建批次', obsBlocked)

// 12. 越权：青松林场值班员不能编入白桦队伍(2)
let crossBlocked = false
try { createBatch({ ...base, 演练主题: '夏季雷击火应急演练', allowMixedForest: true, teamRowIds: [1,2], equipmentSelections: [] }, forester) }
catch (e) { crossBlocked = /越权/.test(e.message) }
check('林场值班员不能跨林场编队（越权拦截）', crossBlocked)
// 值班员本林场批次可提交
const b5 = createBatch({ ...base, 演练主题: '夏季雷击火应急演练', allowMixedForest: false, teamRowIds: [1,4], equipmentSelections: [] }, forester)
const r5 = submitBatch(b5.id, forester)
check('林场值班员提交本林场批次成功', r5.ok, r5.message)
// 值班员不能提交全局(指挥中心)批次
const r5b = submitBatch(b2.id, forester)
check('林场值班员提交他人/全局批次被拒', !r5b.ok && /越权/.test(r5b.message), r5b.message)
// 值班员不能推进阶段
const adv = advanceBatch(b5.id, '已实施', forester)
check('林场值班员不能推进演练阶段', !adv.ok)
// 指挥中心可推进
const adv2 = advanceBatch(b5.id, '已实施', commander)
check('指挥中心推进到已实施', adv2.ok, adv2.message)
const adv3 = advanceBatch(b5.id, '已总结', commander)
check('指挥中心推进到已总结', adv3.ok)
const adv4 = advanceBatch(b5.id, '已总结', commander)
check('不能重复/越级推进', !adv4.ok)

// 13. 历史演练原主题不被改动
const legacyThemes = listRows('drill').filter(r => [1,2,3].includes(Number(r.id))).map(r => r.演练主题)
check('历史3条演练记录保持原主题', JSON.stringify(legacyThemes) === JSON.stringify(['应急演练样例1','应急演练样例2','应急演练样例3']), JSON.stringify(legacyThemes))

console.log('\\n结果：通过 ' + pass + '，失败 ' + fail)
if (fail > 0) process.exit(1)
`

// 内存 localStorage 垫片
const shim = `
globalThis.__ls = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (globalThis.__ls.has(k) ? globalThis.__ls.get(k) : null),
    setItem: (k, v) => globalThis.__ls.set(k, String(v)),
    removeItem: (k) => globalThis.__ls.delete(k),
  },
}
`

const dir = mkdtempSync(join(tmpdir(), 'drill-test-'))
const entry = join(dir, 'entry.ts')
writeFileSync(entry, shim + testCode)

const outfile = join(dir, 'bundle.mjs')
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: { '@': join(process.cwd(), 'src') },
})
await import(pathToFileURL(outfile).href)
