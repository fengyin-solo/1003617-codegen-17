import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import {
  assertEquipmentMutable,
  assertTeamMutable,
  recordEquipmentIssue,
  runBatchAction,
  submitDrillPlan,
} from './drill-plan'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

function farmOf(row: EntryRow): string {
  return String(row['所属林场'] ?? row['保管林场'] ?? row['储备林场'] ?? '').trim()
}

// 统一写入口的权限护栏：只读账号一律拒绝；林场值班员只能改归属本林场的数据。
function assertWritePermission(key: string, row: EntryRow, action: string): ActionResult | null {
  const session = useSessionStore()
  if (!session.canWrite) {
    return { ok: false, message: `只读查看员不能执行「${action}」，如需操作请切换为可写身份` }
  }
  const actor = session.actor()
  if (actor.role === 'admin') {
    return null
  }
  // 演练/排班/火情等没有明确林场归属的协同单据，以创建时登记的来源为准，这里不卡林场。
  const farmless = ['drill', 'drillplan', 'duty', 'firereport', 'weather', 'drone']
  if (farmless.includes(key)) {
    // 筹备批次有独立的归属（可能是跨林场混合），交给批次领域自己判。
    if (key !== 'drillplan') {
      return null
    }
  }
  const farm = farmOf(row)
  if (farm && farm !== actor.forestFarm) {
    return {
      ok: false,
      message: `越权操作：该${MODULE_BY_KEY.get(key)?.entity ?? '记录'}归属「${farm}」，${actor.forestFarm}账号不能执行「${action}」`,
    }
  }
  return null
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)

  // 演练筹备批次的三个动作由批次领域编排（联动多模块 + 事务回退），不走通用流转。
  if (key === 'drillplan') {
    if (action === '提交筹备') {
      return submitDrillPlan(id)
    }
    if (action === '确认实施' || action === '提交总结') {
      return runBatchAction(id, action)
    }
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const permissionDenied = assertWritePermission(key, rows[index], action)
  if (permissionDenied) {
    return permissionDenied
  }

  // 装备：领用动作联动写领用清单与演练占用台账；占用中禁止送检/报废。
  if (key === 'equipment') {
    if (action === '领用装备') {
      return recordEquipmentIssue(id)
    }
    const occupied = assertEquipmentMutable(id)
    if (occupied) {
      return occupied
    }
  }

  // 扑火队伍：处于演练值班调整期间不能再下达出动。
  if (key === 'fireteam' && action === '下达出动') {
    const locked = assertTeamMutable(id)
    if (locked) {
      return locked
    }
  }

  // 林区道路：批次管制中的道路只能由演练总结解除，通用动作不能改其通行状态。
  // 该归属保护必须先于「状态重复」判断，否则恰好点成禁止通行时会被幂等提示掩盖。
  if (key === 'forestroad') {
    const controlBatch = String(rows[index]['管制批次'] ?? '').trim()
    if (controlBatch) {
      return {
        ok: false,
        message: `道路正按批次「${controlBatch}」执行临时管制，需随演练提交总结解除，不能直接「${action}」`,
      }
    }
  }

  // 演练记录：被批次联动生成的记录只能随批次流转，历史记录主题等字段也不在通用动作里改动。
  // 同样先于状态重复判断，保证只读归属始终受控。
  if (key === 'drill') {
    const linked = String(rows[index]['关联批次'] ?? '').trim()
    if (linked) {
      return {
        ok: false,
        message: `该演练记录由批次「${linked}」联动生成，请在演练筹备批次中推进，历史演练记录保持原主题不单独改写`,
      }
    }
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
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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
