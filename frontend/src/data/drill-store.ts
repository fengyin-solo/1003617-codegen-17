import type { DrillBatch, EquipmentRequisition } from './drill-types'
import { SEED_DRILL_STORE, SEED_REQUISITIONS } from './drill-seed'
import { syncEntriesCache } from './local-store'
import type { EntryRow } from './types'

// 批次与装备领用账是强关系数据，和通用台账（forest-fire-patrol:entries）分开存。
const BATCH_KEY = 'forest-fire-patrol:drill-batches'
const REQUISITION_KEY = 'forest-fire-patrol:equipment-requisitions'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

export type DrillStoreShape = {
  batches: DrillBatch[]
  /** 已生效的提交令牌：重复提交只生效一次。 */
  submittedTokens: string[]
}

export function loadDrillStore(): DrillStoreShape {
  return read<DrillStoreShape>(BATCH_KEY, SEED_DRILL_STORE)
}

export function saveDrillStore(store: DrillStoreShape): void {
  write(BATCH_KEY, store)
}

export function loadRequisitions(): EquipmentRequisition[] {
  return read<EquipmentRequisition[]>(REQUISITION_KEY, SEED_REQUISITIONS)
}

export function saveRequisitions(rows: EquipmentRequisition[]): void {
  write(REQUISITION_KEY, rows)
}

/**
 * 一次性提交多个存储键，模拟后端「单事务」：调用方先在内存快照上改完，
 * 全部成功才在这里落盘；任何一步抛错都不会调用本函数，旧数据原样保留，
 * 从而实现「任一环节失败，全部回退」。
 */
export function commitAll(payload: {
  entries?: Record<string, EntryRow[]>
  drill?: DrillStoreShape
  requisitions?: EquipmentRequisition[]
}): void {
  const pending: { key: string; value: string }[] = []
  if (payload.entries) {
    pending.push({ key: 'forest-fire-patrol:entries', value: JSON.stringify(payload.entries) })
  }
  if (payload.drill) {
    pending.push({ key: BATCH_KEY, value: JSON.stringify(payload.drill) })
  }
  if (payload.requisitions) {
    pending.push({ key: REQUISITION_KEY, value: JSON.stringify(payload.requisitions) })
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    if (payload.entries) syncEntriesCache(payload.entries)
    return
  }
  // 先序列化全部内容（这一步可能因循环引用等抛错），任何一个失败都不写盘 → 整体回退。
  const serialized = pending.map((item) => ({ ...item }))
  // JSON 已在构造 pending 时生成；这里再统一写入，写循环本身不做可能抛错的转换。
  serialized.forEach((item) => window.localStorage.setItem(item.key, item.value))
  // 同步通用台账内存缓存，保证提交后页面读到的是新数据。
  if (payload.entries) syncEntriesCache(payload.entries)
}

export function nextBatchId(batches: DrillBatch[]): number {
  return batches.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

export function nextRequisitionId(rows: EquipmentRequisition[]): number {
  return rows.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

export function resetDrillData(): void {
  write(BATCH_KEY, clone(SEED_DRILL_STORE))
  write(REQUISITION_KEY, clone(SEED_REQUISITIONS))
}
