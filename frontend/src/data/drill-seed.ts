import type { DrillBatch, EquipmentRequisition } from './drill-types'
import type { DrillStoreShape } from './drill-store'

// 结构化种子：两场同主题历史批次（对应台账里的 DRIL-2025-018 / DRIL-2026-006），
// 供新建批次时按「同主题最近一次」兼容缺装备明细；装备领用账里另有一张
// 来自火情报告模块的占用单，用于演示跨模块占用联动。

const historicalBatches: DrillBatch[] = [
  {
    id: 1,
    批次编号: 'DRB-2025-018',
    演练编号: 'DRIL-2025-018',
    演练主题: '春季扑火实战演练',
    筹备日期: '2025-04-08',
    实施日期: '2025-04-16',
    总结日期: '2025-04-18',
    目标参演人数: 60,
    allowMixedForest: true,
    teams: [
      { teamRowId: 1, 队伍编号: 'FIRE-0001', 队伍名称: '青松林场扑火一队', 所属林场: '青松林场', 队员人数: 30 },
      { teamRowId: 2, 队伍编号: 'FIRE-0002', 队伍名称: '白桦林场扑火一队', 所属林场: '白桦林场', 队员人数: 25 },
    ],
    equipmentNeeds: [
      { equipmentRowId: 1, 装备编号: 'EQUI-0001', 装备名称: '风力灭火机', 装备类型: '灭火机具', 保管林场: '青松林场', quantity: 1, satisfied: 1, shortage: 0, inherited: false },
      { equipmentRowId: 2, 装备编号: 'EQUI-0002', 装备名称: '高压消防水泵', 装备类型: '供水设备', 保管林场: '白桦林场', quantity: 1, satisfied: 1, shortage: 0, inherited: false },
      { equipmentRowId: 4, 装备编号: 'EQUI-0004', 装备名称: '灭火水枪', 装备类型: '灭火机具', 保管林场: '青松林场', quantity: 1, satisfied: 1, shortage: 0, inherited: false },
      { equipmentRowId: 8, 装备编号: 'EQUI-0008', 装备名称: '对讲机', 装备类型: '通讯设备', 保管林场: '白桦林场', quantity: 1, satisfied: 1, shortage: 0, inherited: false },
    ],
    dutyAdjustments: [
      { key: '1-1', teamRowId: 1, 队伍名称: '青松林场扑火一队', dutyRowId: 1, 值勤日期: '2025-04-16', 值勤时段: '07:00-19:00', 值勤岗位: '春季扑火实战演练参演' },
      { key: '1-2', teamRowId: 2, 队伍名称: '白桦林场扑火一队', dutyRowId: 2, 值勤日期: '2025-04-16', 值勤时段: '07:00-19:00', 值勤岗位: '春季扑火实战演练参演' },
    ],
    roadNotices: [
      { key: '1-1', roadRowId: 1, 道路名称: '青松林场北线防火路', 管制日期: '2025-04-16', 管制时段: '06:30-12:00', 管制原因: '春季扑火实战演练', 提醒内容: '演练车队通行，社会车辆请绕行青松检查站南侧便道' },
    ],
    status: '已总结',
    参演人数: 55,
    参演人数缺口: 5,
    装备缺口总数: 0,
    owner: '值班管理员',
    ownerForest: '全局',
    createdAt: '2025-04-06T09:00:00.000Z',
    submittedAt: '2025-04-08T10:00:00.000Z',
    submitToken: 'seed-batch-1',
  },
  {
    id: 2,
    批次编号: 'DRB-2026-006',
    演练编号: 'DRIL-2026-006',
    演练主题: '春季扑火实战演练',
    筹备日期: '2026-04-02',
    实施日期: '2026-04-10',
    总结日期: '2026-04-12',
    目标参演人数: 70,
    allowMixedForest: true,
    teams: [
      { teamRowId: 1, 队伍编号: 'FIRE-0001', 队伍名称: '青松林场扑火一队', 所属林场: '青松林场', 队员人数: 30 },
      { teamRowId: 4, 队伍编号: 'FIRE-0004', 队伍名称: '青松林场扑火二队', 所属林场: '青松林场', 队员人数: 18 },
      { teamRowId: 6, 队伍编号: 'FIRE-0006', 队伍名称: '红松林场扑火二队', 所属林场: '红松林场', 队员人数: 15 },
    ],
    equipmentNeeds: [
      { equipmentRowId: 1, 装备编号: 'EQUI-0001', 装备名称: '风力灭火机', 装备类型: '灭火机具', 保管林场: '青松林场', quantity: 1, satisfied: 1, shortage: 0, inherited: true },
      { equipmentRowId: 4, 装备编号: 'EQUI-0004', 装备名称: '灭火水枪', 装备类型: '灭火机具', 保管林场: '青松林场', quantity: 1, satisfied: 1, shortage: 0, inherited: true },
      { equipmentRowId: 6, 装备编号: 'EQUI-0006', 装备名称: '消防水带', 装备类型: '供水设备', 保管林场: '红松林场', quantity: 1, satisfied: 1, shortage: 0, inherited: false },
      { equipmentRowId: 8, 装备编号: 'EQUI-0008', 装备名称: '对讲机', 装备类型: '通讯设备', 保管林场: '白桦林场', quantity: 1, satisfied: 1, shortage: 0, inherited: true },
      { equipmentRowId: 9, 装备编号: 'EQUI-0009', 装备名称: '防火服套装', 装备类型: '防护装备', 保管林场: '红松林场', quantity: 1, satisfied: 1, shortage: 0, inherited: false },
      { equipmentRowId: 10, 装备编号: 'EQUI-0010', 装备名称: '高压消防水泵', 装备类型: '供水设备', 保管林场: '青松林场', quantity: 1, satisfied: 0, shortage: 1, inherited: true },
    ],
    dutyAdjustments: [
      { key: '2-1', teamRowId: 1, 队伍名称: '青松林场扑火一队', dutyRowId: 1, 值勤日期: '2026-04-10', 值勤时段: '07:00-19:00', 值勤岗位: '春季扑火实战演练参演' },
      { key: '2-4', teamRowId: 4, 队伍名称: '青松林场扑火二队', dutyRowId: 2, 值勤日期: '2026-04-10', 值勤时段: '07:00-19:00', 值勤岗位: '春季扑火实战演练参演' },
      { key: '2-6', teamRowId: 6, 队伍名称: '红松林场扑火二队', dutyRowId: 3, 值勤日期: '2026-04-10', 值勤时段: '07:00-19:00', 值勤岗位: '春季扑火实战演练参演' },
    ],
    roadNotices: [
      { key: '2-4', roadRowId: 4, 道路名称: '青松林场南线主干道', 管制日期: '2026-04-10', 管制时段: '06:30-13:00', 管制原因: '春季扑火实战演练', 提醒内容: '演练车队集结通行，请社会车辆避开通行高峰' },
    ],
    status: '已总结',
    参演人数: 63,
    参演人数缺口: 7,
    装备缺口总数: 1,
    owner: '值班管理员',
    ownerForest: '全局',
    createdAt: '2026-03-30T09:00:00.000Z',
    submittedAt: '2026-04-02T10:30:00.000Z',
    submitToken: 'seed-batch-2',
  },
]

const seedRequisitions: EquipmentRequisition[] = [
  // 上一批演练的历史领用，已归还，不再占用。
  ...historicalBatches.flatMap((batch) =>
    batch.equipmentNeeds
      .filter((need) => need.satisfied > 0)
      .map((need, index) => ({
        id: batch.id * 100 + index + 1,
        source: '演练批次' as const,
        sourceRef: batch.批次编号,
        batchId: batch.id,
        equipmentRowId: need.equipmentRowId,
        装备编号: need.装备编号,
        装备名称: need.装备名称,
        quantity: need.satisfied,
        领用日期: batch.实施日期,
        用途: `${batch.演练主题}参演`,
        领用人: batch.owner,
        归属林场: need.保管林场,
        status: '已归还' as const,
      })),
  ),
  // 别的模块（火情报告）开的领用清单，占用中：演练选装备时必须算进去。
  {
    id: 901,
    source: '火情报告',
    sourceRef: 'FIREREP-2026-031',
    equipmentRowId: 5,
    装备编号: 'EQUI-0005',
    装备名称: '风力灭火机',
    quantity: 1,
    领用日期: '2026-10-01',
    用途: '东沟火情扑救领用',
    领用人: '白桦林场扑火一队',
    归属林场: '白桦林场',
    status: '占用中',
  },
]

export const SEED_DRILL_STORE: DrillStoreShape = {
  batches: historicalBatches,
  submittedTokens: historicalBatches.map((batch) => batch.submitToken),
}

export const SEED_REQUISITIONS: EquipmentRequisition[] = seedRequisitions
