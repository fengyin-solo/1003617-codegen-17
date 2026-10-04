<template>
  <section class="page" data-module="drillplan">
    <header class="page-head">
      <div>
        <h2>应急演练筹备批次</h2>
        <p class="page-desc">
          按演练主题多选参演队伍与所需装备，整组排定筹备、实施、总结日期；提交一次性生成值班调整、装备领用清单与道路管制提醒，任一环节失败全部回退。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="!canWrite" @click="openCreate">新增筹备批次</button>
        <button class="btn" type="button" @click="exportRows">导出筹备批次清单</button>
      </div>
    </header>

    <p class="identity-bar" :class="{ readonly: !canWrite }">
      当前身份：<strong>{{ store.roleLabel }}</strong> · {{ identityScope }}
      <span v-if="!canWrite">（只读：所有提交、领用与流转均受控禁用）</span>
      <span v-else-if="store.role === 'admin'">（可跨林场混合编组）</span>
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ gap: item.warn }">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>演练主题</span>
        <input v-model="filters['演练主题']" placeholder="按演练主题检索" />
      </label>
      <label class="filter-item">
        <span>归属林场</span>
        <input v-model="filters['归属林场']" placeholder="按归属林场检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="String(row.id)">
          <tr :class="{ expanded: expandedId === row.id }">
            <td v-for="column in columns" :key="column">
              <button v-if="column === '批次编号'" class="link" type="button" @click="toggleDetail(row.id)">
                {{ row[column] }}
              </button>
              <span v-else-if="column === '提交批次'" :title="String(row[column] ?? '')">
                {{ shortToken(String(row[column] ?? '')) }}
              </span>
              <span v-else :class="{ 'gap-text': column === '人数缺口' && toNum(row[column]) > 0 }">
                {{ column === '管制道路' && !row[column] ? '不安排管制' : (row[column] ?? '—') }}
              </span>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-if="String(row.status) === '待提交'"
                class="link"
                type="button"
                :disabled="!canWrite"
                @click="editDraft(row)"
              >
                编辑
              </button>
              <button
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                :disabled="!canWrite"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <button class="link" type="button" @click="toggleDetail(row.id)">
                {{ expandedId === row.id ? '收起单据' : '联动单据' }}
              </button>
            </td>
          </tr>
          <tr v-if="expandedId === row.id" class="detail-row">
            <td :colspan="columns.length + 2">
              <div class="detail-grid">
                <article class="detail-card">
                  <h4>扑火队伍值班调整（{{ detailOf(row).duties.length }}）</h4>
                  <p v-if="!detailOf(row).duties.length" class="muted">提交筹备后整组生成</p>
                  <ul v-else>
                    <li v-for="item in detailOf(row).duties" :key="item.id">
                      {{ item['排班编号'] }} · {{ item['值勤人员'] }} · {{ item['值勤日期'] }} ·
                      {{ item.status }}
                    </li>
                  </ul>
                </article>
                <article class="detail-card">
                  <h4>消防装备领用清单（{{ detailOf(row).issues.length }}）</h4>
                  <p v-if="!detailOf(row).issues.length" class="muted">提交筹备后整组生成</p>
                  <ul v-else>
                    <li v-for="item in detailOf(row).issues" :key="item.id">
                      {{ item['领用单号'] }} · {{ item['装备名称'] }} · {{ item['领用单位'] }} ·
                      {{ item.status }}
                    </li>
                  </ul>
                </article>
                <article class="detail-card">
                  <h4>演练占用登记（{{ detailOf(row).occupies.length }}）</h4>
                  <p v-if="!detailOf(row).occupies.length" class="muted">随领用清单同步登记</p>
                  <ul v-else>
                    <li v-for="item in detailOf(row).occupies" :key="item.id">
                      {{ item['占用编号'] }} · {{ item['装备名称'] }} · {{ item['占用类型'] }} ·
                      {{ item.status }}
                    </li>
                  </ul>
                </article>
                <article class="detail-card">
                  <h4>林区道路临时管制提醒（{{ detailOf(row).notices.length }}）</h4>
                  <p v-if="!detailOf(row).notices.length" class="muted">未安排管制道路 / 提交后生成</p>
                  <ul v-else>
                    <li v-for="item in detailOf(row).notices" :key="item.id">
                      {{ item['提醒编号'] }} · {{ item['道路名称'] }} · {{ item['管制日期'] }} ·
                      {{ item.status }}
                    </li>
                  </ul>
                </article>
              </div>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无筹备批次，可先新增一批演练筹备</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条筹备批次</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="ledger-panel">
      <h3>装备占用台账（演练 + 其他模块领用联动，单一事实源）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>占用编号</th>
            <th>装备名称</th>
            <th>占用类型</th>
            <th>来源单号</th>
            <th>关联批次</th>
            <th>占用开始</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in occupies" :key="item.id">
            <td>{{ item['占用编号'] }}</td>
            <td>{{ item['装备名称'] }}</td>
            <td>{{ item['占用类型'] }}</td>
            <td>{{ item['来源单号'] }}</td>
            <td>{{ item['关联批次'] || '—' }}</td>
            <td>{{ item['占用开始'] }}</td>
            <td>{{ item.status }}</td>
            <td>
              <button
                v-if="String(item.status) === '占用中' && String(item['来源模块']) !== 'drillplan'"
                class="link"
                type="button"
                :disabled="!canWrite"
                @click="release(item)"
              >
                释放占用
              </button>
              <span v-else-if="String(item.status) === '占用中'" class="muted">随演练总结释放</span>
              <span v-else class="muted">已闭环</span>
            </td>
          </tr>
          <tr v-if="!occupies.length">
            <td colspan="8" class="empty-state">当前没有装备占用记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 新增/编辑筹备批次弹窗 -->
    <div v-if="modalOpen" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <header class="modal-head">
          <h3>{{ form.id ? '编辑筹备批次草稿' : '新增应急演练筹备批次' }}</h3>
          <button class="btn ghost" type="button" @click="closeModal">关闭</button>
        </header>

        <div class="modal-body">
          <div class="form-grid">
            <label class="form-item span-2">
              <span>演练主题</span>
              <input v-model="form.theme" list="drill-themes" placeholder="输入或选择历史主题" />
              <datalist id="drill-themes">
                <option v-for="theme in themes" :key="theme" :value="theme" />
              </datalist>
            </label>
            <div class="form-item span-2 inherit-line">
              <button class="btn" type="button" @click="inheritTheme">按同主题最近一次演练继承所需装备</button>
              <span v-if="prefill.sourceCode" class="inherit-msg">
                继承自 {{ prefill.sourceCode }}：已带出 {{ prefill.equipmentIds.length }} 件可用装备
                <em v-if="prefill.occupiedNames.length" class="warn-text">；占用中：{{ prefill.occupiedNames.join('、') }}</em>
                <em v-if="prefill.missingNames.length" class="warn-text">；库存缺失：{{ prefill.missingNames.join('、') }}</em>
              </span>
            </div>

            <label class="form-item">
              <span>筹备开始</span>
              <input v-model="form.prepareDate" type="date" />
            </label>
            <label class="form-item">
              <span>实施日期</span>
              <input v-model="form.executeDate" type="date" />
            </label>
            <label class="form-item">
              <span>总结日期</span>
              <input v-model="form.summaryDate" type="date" />
            </label>
            <label class="form-item">
              <span>目标参演人数</span>
              <input v-model.number="form.targetHeadcount" type="number" min="0" />
            </label>
          </div>

          <div class="headcount-bar">
            去重后参演队伍 <strong>{{ selectedTeams.length }}</strong> 支 ·
            参演人数 <strong>{{ headcount }}</strong> ·
            目标 <strong>{{ form.targetHeadcount }}</strong> ·
            <strong :class="gap > 0 ? 'gap-text' : 'ok-text'">
              {{ gap > 0 ? `人数缺口 ${gap} 人` : '人数已达标' }}
            </strong>
            · 归属：<strong>{{ ownershipLabel }}</strong>
            <em v-if="mixedFarms && store.role !== 'admin'" class="warn-text">跨林场混合编组仅管理员可提交</em>
          </div>

          <fieldset class="pick-block">
            <legend>参演队伍（多选，重复勾选自动去重；{{ store.role === 'admin' ? '允许跨林场混合' : '仅显示归属本林场队伍' }}）</legend>
            <div v-for="farm in teamGroups" :key="farm.name" class="pick-group">
              <h5>{{ farm.name }}</h5>
              <div class="pick-list">
                <label v-for="team in farm.items" :key="team.id" class="pick-chip" :class="{ disabled: !team.pickable }">
                  <input
                    type="checkbox"
                    :checked="form.teamIds.includes(team.id)"
                    :disabled="!team.pickable"
                    @change="toggleNumber(form.teamIds, team.id)"
                  />
                  <span>{{ team.name }}（{{ team.members }}人）</span>
                  <em v-if="team.reason" class="warn-text">{{ team.reason }}</em>
                </label>
              </div>
            </div>
          </fieldset>

          <fieldset class="pick-block">
            <legend>所需装备（多选；已被演练或其他模块领用占用的装备不可选）</legend>
            <div v-for="farm in equipmentGroups" :key="farm.name" class="pick-group">
              <h5>{{ farm.name }}</h5>
              <div class="pick-list">
                <label v-for="equip in farm.items" :key="equip.id" class="pick-chip" :class="{ disabled: !equip.pickable }">
                  <input
                    type="checkbox"
                    :checked="form.equipmentIds.includes(equip.id)"
                    :disabled="!equip.pickable"
                    @change="toggleNumber(form.equipmentIds, equip.id)"
                  />
                  <span>{{ equip.name }}</span>
                  <em v-if="equip.reason" class="warn-text">{{ equip.reason }}</em>
                </label>
              </div>
            </div>
          </fieldset>

          <fieldset class="pick-block">
            <legend>林区道路临时管制提醒（多选，可不安排）</legend>
            <div class="pick-list">
              <label v-for="road in roads" :key="road.id" class="pick-chip" :class="{ disabled: !road.pickable }">
                <input
                  type="checkbox"
                  :checked="form.roadIds.includes(road.id)"
                  :disabled="!road.pickable"
                  @change="toggleNumber(form.roadIds, road.id)"
                />
                <span>{{ road.name }}（{{ road.farm }}）</span>
                <em v-if="road.reason" class="warn-text">{{ road.reason }}</em>
              </label>
            </div>
          </fieldset>

          <p v-if="modalMessage" class="error-text" role="alert">{{ modalMessage }}</p>
        </div>

        <footer class="modal-foot">
          <span class="muted">提交将原子生成值班调整、领用清单、管制提醒；校验不过或落库失败整体回退。</span>
          <span>
            <button class="btn" type="button" @click="saveDraftOnly">暂存草稿</button>
            <button class="btn primary" type="button" @click="saveAndSubmit">提交筹备</button>
          </span>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  batchDetail,
  historicalThemes,
  ISSUE_KEY,
  listLedger,
  NOTICE_KEY,
  OCCUPY_KEY,
  planOptions,
  prefillEquipmentByTheme,
  releaseOccupation,
  saveDrillPlanDraft,
  submitDrillPlan,
  type BatchDetail,
  type PlanOption,
} from '@/api/drill-plan'
import { listRows } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()
const canWrite = computed(() => store.canWrite)
const identityScope = computed(() =>
  store.role === 'admin' ? '全部林场' : store.role === 'viewer' ? '只读查看' : store.forestFarm,
)

const meta = moduleMeta('drillplan')
const columns = ["批次编号", "演练主题", "归属林场", "参演队伍", "参演人数", "目标人数", "人数缺口", "所需装备", "筹备开始", "实施日期", "总结日期", "管制道路", "提交批次"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const expandedId = ref<number | null>(null)
const filters = ref<Record<string, string>>({})
const detailCache = ref<Record<number, BatchDetail>>({})

const occupies = ref<EntryRow[]>([])
const themes = ref<string[]>([])

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '筹备批次', value: rows.value.length, warn: false },
  { label: '筹备中', value: rows.value.filter((row) => ['待提交', '筹备中'].includes(String(row.status))).length, warn: false },
  { label: '人数缺口合计', value: rows.value.reduce((sum, row) => sum + toNum(row['人数缺口']), 0), warn: true },
  { label: '装备占用中', value: occupies.value.filter((row) => String(row.status) === '占用中').length, warn: false },
])

function toNum(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function shortToken(token: string): string {
  if (!token) {
    return '—'
  }
  return token.length > 14 ? `${token.slice(0, 13)}…` : token
}

function actionsFor(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待提交':
      return ['提交筹备']
    case '筹备中':
      return ['确认实施']
    case '已实施':
      return ['提交总结']
    default:
      return []
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

function release(row: EntryRow) {
  errorMessage.value = ''
  const result = releaseOccupation(Number(row.id))
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

function toggleNumber(bucket: number[], id: number) {
  const index = bucket.indexOf(id)
  // 重复加入同一队伍/装备不得重复计数：勾选集合天然去重。
  if (index >= 0) {
    bucket.splice(index, 1)
  } else {
    bucket.push(id)
  }
}

type ModalForm = {
  id: number
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

const emptyForm = (): ModalForm => ({
  id: 0,
  theme: '',
  teamIds: [],
  equipmentIds: [],
  roadIds: [],
  prepareDate: '',
  executeDate: '',
  summaryDate: '',
  targetHeadcount: 30,
  requestToken: createToken(),
})

function createToken(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID()
  }
  return `PLAN-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const modalOpen = ref(false)
const modalMessage = ref('')
const form = reactive<ModalForm>(emptyForm())
const options = ref<{ teams: PlanOption[]; equipment: PlanOption[]; roads: PlanOption[] }>({
  teams: [],
  equipment: [],
  roads: [],
})
const prefill = ref<ReturnType<typeof prefillEquipmentByTheme>>(
  prefillEquipmentByTheme(''),
)

// 已被进行中批次占用值班的队伍不允许重复报名；待提交草稿不锁定（与服务端活跃判定一致）。
const lockedTeamIds = computed(
  () =>
    new Set(
      rows.value
        .filter((row) => ['筹备中', '已实施'].includes(String(row.status)) && Number(row.id) !== form.id)
        .flatMap((row) => String(row['参演队伍ID'] ?? '').split('、').map(Number).filter(Boolean)),
    ),
)

type GroupedOption = PlanOption & { pickable: boolean; reason: string }

const teamGroups = computed(() => groupByFarm(options.value.teams.map((item) => {
  const reasons: string[] = []
  if (['已出动', '扑救中'].includes(item.status)) {
    reasons.push(`状态为「${item.status}」`)
  }
  if (lockedTeamIds.value.has(item.id) && !form.teamIds.includes(item.id)) {
    reasons.push('已在其他批次值班')
  }
  return { ...item, pickable: reasons.length === 0, reason: reasons.join('，') }
})))

const equipmentGroups = computed(() => groupByFarm(options.value.equipment.map((item) => {
  const reasons: string[] = []
  if (item.status !== '可用') {
    reasons.push(`状态为「${item.status}」`)
  }
  if (item.status === '可用' && occupiedEquipmentIds().has(item.id)) {
    reasons.push('已被领用占用')
  }
  return { ...item, pickable: reasons.length === 0, reason: reasons.join('，') }
})))

function occupiedEquipmentIds(): Set<number> {
  return new Set(
    listLedger(OCCUPY_KEY)
      .filter((row) => String(row.status) === '占用中')
      .map((row) => Number(row['装备编号-id'])),
  )
}

const roads = computed<GroupedOption[]>(() =>
  options.value.roads.map((item) => {
    const blocked = ['正在施工', '禁止通行'].includes(item.status)
    return { ...item, pickable: !blocked, reason: blocked ? `当前「${item.status}」` : '' }
  }),
)

function groupByFarm(items: GroupedOption[]): { name: string; items: GroupedOption[] }[] {
  const map = new Map<string, GroupedOption[]>()
  for (const item of items) {
    const key = item.farm || '未归属林场'
    if (!map.has(key)) {
      map.set(key, [])
    }
    map.get(key)!.push(item)
  }
  return [...map.entries()].map(([name, groupItems]) => ({ name, items: groupItems }))
}

const selectedTeams = computed(() => options.value.teams.filter((item) => form.teamIds.includes(item.id)))
const headcount = computed(() =>
  // 多选集合已去重，人数按队伍一次性汇总，不存在重复计数。
  selectedTeams.value.reduce((sum, item) => sum + item.members, 0),
)
const gap = computed(() => Math.max(0, form.targetHeadcount - headcount.value))
const teamFarms = computed(() => [...new Set(selectedTeams.value.map((item) => item.farm).filter(Boolean))])
const mixedFarms = computed(() => teamFarms.value.length > 1)
const ownershipLabel = computed(() => {
  if (!selectedTeams.value.length) {
    return '待选择队伍'
  }
  return mixedFarms.value ? `跨林场混合（${teamFarms.value.join('、')}）` : teamFarms.value[0]
})

function openCreate() {
  Object.assign(form, emptyForm())
  modalMessage.value = ''
  prefill.value = prefillEquipmentByTheme('')
  refreshOptions()
  modalOpen.value = true
}

function editDraft(row: EntryRow) {
  Object.assign(form, {
    ...emptyForm(),
    id: Number(row.id),
    theme: String(row['演练主题'] ?? ''),
    teamIds: String(row['参演队伍ID'] ?? '').split('、').map(Number).filter(Boolean),
    equipmentIds: String(row['所需装备ID'] ?? '').split('、').map(Number).filter(Boolean),
    roadIds: String(row['管制道路ID'] ?? '').split('、').map(Number).filter(Boolean),
    prepareDate: String(row['筹备开始'] ?? ''),
    executeDate: String(row['实施日期'] ?? ''),
    summaryDate: String(row['总结日期'] ?? ''),
    targetHeadcount: toNum(row['目标人数']),
    requestToken: String(row['提交批次'] || createToken()),
  })
  modalMessage.value = ''
  prefill.value = prefillEquipmentByTheme(form.theme)
  refreshOptions()
  modalOpen.value = true
}

function refreshOptions() {
  options.value = planOptions()
  themes.value = historicalThemes()
  occupies.value = listLedger(OCCUPY_KEY)
}

function inheritTheme() {
  if (!form.theme.trim()) {
    modalMessage.value = '请先填写或选择演练主题'
    return
  }
  prefill.value = prefillEquipmentByTheme(form.theme)
  if (!prefill.value.sourceCode) {
    modalMessage.value = `没有找到主题为「${form.theme}」的历史演练，无法继承装备明细`
    return
  }
  // 合并而非覆盖：已经手动勾上的装备保留，继承结果同样去重。
  form.equipmentIds = [...new Set([...form.equipmentIds, ...prefill.value.equipmentIds])]
  modalMessage.value = ''
}

function closeModal() {
  modalOpen.value = false
  reload()
}

function buildDraftPayload() {
  return {
    id: form.id || undefined,
    theme: form.theme,
    teamIds: [...new Set(form.teamIds)],
    equipmentIds: [...new Set(form.equipmentIds)],
    roadIds: [...new Set(form.roadIds)],
    prepareDate: form.prepareDate,
    executeDate: form.executeDate,
    summaryDate: form.summaryDate,
    targetHeadcount: Number.isFinite(form.targetHeadcount) ? Number(form.targetHeadcount) : 0,
    requestToken: form.requestToken,
  }
}

function saveDraftOnly() {
  modalMessage.value = ''
  const result = saveDrillPlanDraft(buildDraftPayload())
  if (!result.ok) {
    modalMessage.value = result.message
    return
  }
  if (result.planId) {
    form.id = result.planId
  }
  modalMessage.value = result.message
  reload()
}

function saveAndSubmit() {
  modalMessage.value = ''
  const draft = saveDrillPlanDraft(buildDraftPayload())
  if (!draft.ok || !draft.planId) {
    // 草稿阶段任一校验失败：没有任何单据落库，直接提示。
    modalMessage.value = draft.message
    return
  }
  form.id = draft.planId
  const submitted = submitDrillPlan(draft.planId)
  if (!submitted.ok) {
    // 提交失败：三环节全部回退，草稿保留，用户调整后可原样再次提交（同凭证只生效一次）。
    modalMessage.value = submitted.message
    reload()
    return
  }
  modalOpen.value = false
  errorMessage.value = ''
  reload()
}

function toggleDetail(id: number) {
  expandedId.value = expandedId.value === id ? null : id
}

function detailOf(row: EntryRow): {
  duties: EntryRow[]
  issues: EntryRow[]
  occupies: EntryRow[]
  notices: EntryRow[]
} {
  const detail = batchDetail(Number(row.id))
  if (!detail) {
    return { duties: [], issues: [], occupies: [], notices: [] }
  }
  const byId = (list: EntryRow[], ids: number[]) => list.filter((item) => ids.includes(Number(item.id)))
  return {
    duties: byId(listRows('duty'), detail.dutyIds),
    issues: byId(listLedger(ISSUE_KEY), detail.issueIds),
    occupies: byId(listLedger(OCCUPY_KEY), detail.occupyIds),
    notices: byId(listLedger(NOTICE_KEY), detail.noticeIds),
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    occupies.value = listLedger(OCCUPY_KEY)
    themes.value = historicalThemes()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '筹备批次列表读取失败'
  }
}

onMounted(reload)
</script>
