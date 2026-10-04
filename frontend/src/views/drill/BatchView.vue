<template>
  <section class="page" data-module="drill-batch">
    <header class="page-head">
      <div>
        <h2>应急演练筹备批次</h2>
        <p class="page-desc">
          按演练主题多选参演队伍与所需装备，整组安排筹备、实施、总结，自动展示参演人数与装备缺口；
          提交时联动生成值班调整、装备领用清单、道路管制提醒，任一环节失败全部回退。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetDemo">重置演示数据</button>
        <RouterLink class="btn" to="/drill">返回演练台账</RouterLink>
      </div>
    </header>

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 权限只读提示 -->
    <p v-if="store.isReadOnly" class="badge-readonly">当前身份为安全观察员：全部数据只读，不能新建、提交或推进批次。</p>

    <!-- ========================= 新建批次 ========================= -->
    <div v-if="activeTab === 'create'">
      <div class="panel-card">
        <h3>① 演练主题与整组安排</h3>
        <div class="form-grid">
          <label class="form-field">
            <span>演练主题</span>
            <select v-model="form.theme" @change="onThemeChange">
              <option value="" disabled>请选择主题</option>
              <option v-for="theme in themes" :key="theme" :value="theme">{{ theme }}</option>
            </select>
          </label>
          <label class="form-field">
            <span>筹备日期</span>
            <input v-model="form.prepareDate" type="date" />
          </label>
          <label class="form-field">
            <span>实施日期</span>
            <input v-model="form.execDate" type="date" />
          </label>
          <label class="form-field">
            <span>总结日期</span>
            <input v-model="form.summaryDate" type="date" />
          </label>
          <label class="form-field">
            <span>目标参演人数</span>
            <input v-model.number="form.targetHeadcount" type="number" min="0" />
          </label>
          <label class="form-field">
            <span>跨林场队伍混合</span>
            <select v-model="form.allowMixed">
              <option :value="true">允许跨林场混编（联合演练）</option>
              <option :value="false">仅限单一林场队伍</option>
            </select>
          </label>
        </div>
        <p v-if="compatible.sourceRef" class="summary-line" style="margin-top:8px">
          <span class="tag ok">同主题兼容</span>
          已找到同主题最近一次演练「{{ compatible.sourceRef }}」（{{ compatible.sourceDate }}），可一键带出其装备明细。
        </p>
      </div>

      <div class="panel-card">
        <div class="detail-head">
          <h3>② 多选参演队伍（重复勾选同一队伍不重复计数）</h3>
          <span class="summary-line">
            去重后队伍 <strong class="ok-num">{{ selectedTeams.length }}</strong> 支 ·
            参演人数合计 <strong class="ok-num">{{ headcount }}</strong> / 目标
            <strong>{{ form.targetHeadcount }}</strong> ·
            人数缺口
            <strong :class="headcountGap > 0 ? 'gap-num' : 'ok-num'">{{ headcountGap }}</strong>
            <span v-if="forestTag" class="tag" :class="forestTag.mixed ? 'mixed' : 'same'">{{ forestTag.label }}</span>
          </span>
        </div>
        <div class="check-list">
          <label v-for="team in teamOptions" :key="team.id" class="check-item">
            <input type="checkbox" :value="Number(team.id)" v-model="form.teamIds" />
            <span>
              {{ team.队伍名称 }}
              <span class="meta">（编号 {{ team.队伍编号 }} · {{ team.所属林场 }} · 队长 {{ team.队长姓名 }}
              · {{ team.队员人数 }} 人 · 当前：{{ team.status }}）</span>
              <span v-if="isDeployed(team.status)" class="tag short">出动中</span>
            </span>
          </label>
        </div>
      </div>

      <div class="panel-card">
        <div class="detail-head">
          <h3>③ 多选所需装备（占用 = 演练领用 + 其他模块领用 + 台账已领用）</h3>
          <button class="btn small" type="button" :disabled="!form.theme" @click="applyCompatible">
            按同主题最近一次带出装备
          </button>
        </div>
        <div class="check-list">
          <label v-for="eq in equipmentOptions" :key="eq.id" class="check-item">
            <input type="checkbox" :value="Number(eq.id)" v-model="form.equipmentIds" />
            <span>
              {{ eq.装备名称 }}
              <span class="meta">（{{ eq.装备编号 }} · {{ eq.装备类型 }} · {{ eq.规格型号 }} · 保管：{{ eq.保管林场 }}
              · 台账状态：{{ eq.status }}）</span>
              <span v-if="occupancyOf(Number(eq.id)).total > 0" class="tag short">
                已占用 {{ occupancyOf(Number(eq.id)).total }}
                <template v-if="occupancyOf(Number(eq.id)).external.length">（含其他模块）</template>
              </span>
              <span v-else-if="eq.status === '可用'" class="tag ok">可领用</span>
              <span v-else class="tag short">{{ eq.status }}</span>
            </span>
          </label>
        </div>
        <p v-if="previewShortage > 0" class="summary-line" style="margin-top:8px">
          <span class="tag short">装备缺口</span>按当前库存预计缺 <strong class="gap-num">{{ previewShortage }}</strong>
          件（缺口会记录并提示，不阻断提交；装备已报废/检修或队伍异常会阻断并整体回退）。
        </p>
      </div>

      <div class="panel-card">
        <h3>④ 临时管制道路（仅发提醒；施工/封闭道路无法管制，会导致提交回退）</h3>
        <div class="check-list">
          <label v-for="road in roadOptions" :key="road.id" class="check-item">
            <input type="checkbox" :value="Number(road.id)" v-model="form.roadIds" />
            <span>
              {{ road.道路名称 }}
              <span class="meta">（{{ road.道路编号 }} · {{ road.起点位置 }} → {{ road.终点位置 }} · 当前：{{ road.status }}）</span>
              <span v-if="isBlockedRoad(road.status)" class="tag short">不可管制</span>
            </span>
          </label>
        </div>
      </div>

      <p v-if="message" :class="messageOk ? 'summary-line ok-num' : 'error-text'">{{ message }}</p>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetForm">清空表单</button>
        <button class="btn" type="button" :disabled="store.isReadOnly" @click="saveDraft">生成待提交批次</button>
        <button class="btn primary" type="button" :disabled="store.isReadOnly || !draftReady" @click="submitDraft">
          提交筹备（联动三环节，失败全回退）
        </button>
      </div>
    </div>

    <!-- ========================= 批次列表 ========================= -->
    <div v-if="activeTab === 'list'">
      <div v-if="lastStages" class="panel-card">
        <h3>最近一次提交的联动产物</h3>
        <div class="flow-box">
          <div class="flow-step">
            <strong>扑火队伍值班调整（{{ lastStages.值班调整.length }}）</strong>
            <div v-for="item in lastStages.值班调整" :key="item.key">{{ item.队伍名称 }} · {{ item.值勤日期 }} · {{ item.值勤岗位 }}</div>
          </div>
          <div class="flow-step">
            <strong>消防装备领用清单（{{ lastStages.装备领用.length }}）</strong>
            <div v-for="item in lastStages.装备领用" :key="item.id">{{ item.装备名称 }} ×{{ item.quantity }} · {{ item.用途 }}</div>
          </div>
          <div class="flow-step">
            <strong>林区道路临时管制提醒（{{ lastStages.道路管制.length }}）</strong>
            <div v-for="item in lastStages.道路管制" :key="item.key">{{ item.道路名称 }} · {{ item.管制日期 }} · {{ item.提醒内容 }}</div>
          </div>
        </div>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>批次编号</th><th>演练主题</th><th>三阶段日期</th><th>参演队伍（去重）</th>
            <th>参演人数/目标/缺口</th><th>装备缺口</th><th>归属</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="batch in batches" :key="batch.id">
            <td>{{ batch.批次编号 }}</td>
            <td>{{ batch.演练主题 }}</td>
            <td class="muted">筹 {{ batch.筹备日期 }}<br />施 {{ batch.实施日期 }}<br />结 {{ batch.总结日期 }}</td>
            <td>{{ batch.teams.length }} 支<span class="muted">（{{ batch.teams.map((t) => t.队伍名称).join('、') }}）</span></td>
            <td>
              <span class="ok-num">{{ batch.参演人数 }}</span>/{{ batch.目标参演人数 }}
              <span :class="batch.参演人数缺口 > 0 ? 'gap-num' : 'muted'">缺 {{ batch.参演人数缺口 }}</span>
            </td>
            <td>
              <span :class="batch.装备缺口总数 > 0 ? 'gap-num' : 'ok-num'">{{ batch.装备缺口总数 }}</span>
            </td>
            <td>
              {{ batch.owner }}<br /><span class="muted">{{ batch.ownerForest }}</span>
              <span v-if="!store.canWriteBatch(batch.ownerForest)" class="tag readonly">只读</span>
            </td>
            <td>{{ batch.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openDetail(batch.id)">明细</button>
              <button
                v-if="batch.status === '待提交'"
                class="link"
                type="button"
                :disabled="!store.canWriteBatch(batch.ownerForest)"
                @click="submitExisting(batch.id)"
              >提交</button>
              <button
                v-if="batch.status === '筹备中'"
                class="link"
                type="button"
                :disabled="!store.canAdvance"
                @click="advance(batch.id, '已实施')"
              >完成演练</button>
              <button
                v-if="batch.status === '已实施'"
                class="link"
                type="button"
                :disabled="!store.canAdvance"
                @click="advance(batch.id, '已总结')"
              >提交总结</button>
            </td>
          </tr>
          <tr v-if="!batches.length">
            <td colspan="9" class="empty-state">暂无筹备批次</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ========================= 批次明细 ========================= -->
    <div v-if="activeTab === 'detail' && currentBatch" class="panel-card">
      <div class="detail-head">
        <h3>{{ currentBatch.批次编号 }} · {{ currentBatch.演练主题 }}</h3>
        <button class="btn small" type="button" @click="activeTab = 'list'">返回列表</button>
      </div>
      <p class="summary-line">
        状态：{{ currentBatch.status }} ｜ 归属：{{ currentBatch.owner }}（{{ currentBatch.ownerForest }}）｜
        跨林场混编：{{ currentBatch.allowMixedForest ? '允许' : '不允许' }}
      </p>
      <p class="summary-line">
        参演（去重计数）：<strong class="ok-num">{{ currentBatch.参演人数 }}</strong> /
        目标 {{ currentBatch.目标参演人数 }}，
        人数缺口 <strong :class="currentBatch.参演人数缺口 > 0 ? 'gap-num' : 'ok-num'">{{ currentBatch.参演人数缺口 }}</strong>；
        装备缺口 <strong :class="currentBatch.装备缺口总数 > 0 ? 'gap-num' : 'ok-num'">{{ currentBatch.装备缺口总数 }}</strong>
      </p>

      <h3 class="muted" style="font-size:13px">参演队伍</h3>
      <table class="sub-table">
        <thead><tr><th>队伍编号</th><th>队伍名称</th><th>所属林场</th><th>队员人数</th></tr></thead>
        <tbody>
          <tr v-for="team in currentBatch.teams" :key="team.teamRowId">
            <td>{{ team.队伍编号 }}</td><td>{{ team.队伍名称 }}</td><td>{{ team.所属林场 }}</td><td>{{ team.队员人数 }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="muted" style="font-size:13px">所需装备明细（含同主题继承标记与缺口）</h3>
      <table class="sub-table">
        <thead><tr><th>装备编号</th><th>装备名称</th><th>类型</th><th>申请</th><th>满足</th><th>缺口</th><th>来源</th></tr></thead>
        <tbody>
          <tr v-for="need in currentBatch.equipmentNeeds" :key="need.equipmentRowId">
            <td>{{ need.装备编号 }}</td><td>{{ need.装备名称 }}</td><td>{{ need.装备类型 }}</td>
            <td>{{ need.quantity }}</td><td>{{ need.satisfied }}</td>
            <td :class="need.shortage > 0 ? 'gap-num' : ''">{{ need.shortage }}</td>
            <td><span class="tag" :class="need.inherited ? 'ok' : 'same'">{{ need.inherited ? '同主题继承' : '本次新增' }}</span></td>
          </tr>
        </tbody>
      </table>

      <h3 class="muted" style="font-size:13px">扑火队伍值班调整</h3>
      <table class="sub-table">
        <thead><tr><th>队伍</th><th>值勤日期</th><th>时段</th><th>岗位</th></tr></thead>
        <tbody>
          <tr v-for="item in currentBatch.dutyAdjustments" :key="item.key">
            <td>{{ item.队伍名称 }}</td><td>{{ item.值勤日期 }}</td><td>{{ item.值勤时段 }}</td><td>{{ item.值勤岗位 }}</td>
          </tr>
          <tr v-if="!currentBatch.dutyAdjustments.length"><td colspan="4" class="empty-state">待提交后生成</td></tr>
        </tbody>
      </table>

      <h3 class="muted" style="font-size:13px">林区道路临时管制提醒</h3>
      <table class="sub-table">
        <thead><tr><th>道路</th><th>管制日期</th><th>时段</th><th>提醒内容</th></tr></thead>
        <tbody>
          <tr v-for="item in currentBatch.roadNotices" :key="item.key">
            <td>{{ item.道路名称 }}</td><td>{{ item.管制日期 }}</td><td>{{ item.管制时段 }}</td><td>{{ item.提醒内容 }}</td>
          </tr>
          <tr v-if="!currentBatch.roadNotices.length"><td colspan="4" class="empty-state">未选择道路</td></tr>
        </tbody>
      </table>
    </div>

    <!-- ===================== 装备占用账（数据流） ===================== -->
    <div v-if="activeTab === 'occupancy'">
      <div class="panel-card">
        <h3>演练 ↔ 装备 数据流</h3>
        <div class="flow-box">
          <div class="flow-step"><strong>① 来源台账</strong>消防装备的「可用/已领用/检修/报废」是库存底座。</div>
          <div class="flow-step"><strong>② 演练批次</strong>提交筹备时按批次生成领用清单，写入占用账并占用库存。</div>
          <div class="flow-step"><strong>③ 其他模块联动</strong>火情报告等模块开具的领用清单同样写入占用账。</div>
          <div class="flow-step"><strong>④ 缺口反算</strong>新建/提交批次时占用账参与可领数量计算，缺口实时展示。</div>
        </div>
      </div>

      <div class="panel-card">
        <h3>其他模块开具装备领用清单（联动加入演练占用，重复只计一次）</h3>
        <div class="form-grid">
          <label class="form-field"><span>来源模块</span>
            <select v-model="external.source">
              <option value="火情报告">火情报告</option>
              <option value="其他模块">其他模块</option>
            </select>
          </label>
          <label class="form-field"><span>来源单号</span><input v-model="external.sourceRef" placeholder="如 FIREREP-2026-032" /></label>
          <label class="form-field"><span>装备</span>
            <select v-model.number="external.equipmentRowId">
              <option :value="0" disabled>请选择</option>
              <option v-for="eq in equipmentOptions" :key="eq.id" :value="Number(eq.id)">{{ eq.装备名称 }}（{{ eq.装备编号 }}）</option>
            </select>
          </label>
          <label class="form-field"><span>用途</span><input v-model="external.purpose" placeholder="如 西坡火情扑救" /></label>
          <label class="form-field"><span>领用人</span><input v-model="external.taker" /></label>
          <label class="form-field"><span>领用日期</span><input v-model="external.date" type="date" /></label>
        </div>
        <p v-if="externalMessage" class="error-text" style="margin-top:6px">{{ externalMessage }}</p>
        <div class="page-actions" style="margin-top:8px">
          <button class="btn primary" type="button" :disabled="store.isReadOnly" @click="addExternal">登记外部领用（幂等）</button>
        </div>
      </div>

      <table class="data-table">
        <thead>
          <tr><th>单号</th><th>来源</th><th>装备</th><th>数量</th><th>用途</th><th>领用人</th><th>归属林场</th><th>日期</th><th>状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in requisitions" :key="item.id">
            <td>{{ item.sourceRef }}</td>
            <td><span class="tag" :class="item.source === '演练批次' ? 'ok' : 'mixed'">{{ item.source }}</span></td>
            <td>{{ item.装备名称 }}（{{ item.装备编号 }}）</td>
            <td>{{ item.quantity }}</td><td>{{ item.用途 }}</td><td>{{ item.领用人 }}</td>
            <td>{{ item.归属林场 }}</td><td>{{ item.领用日期 }}</td><td>{{ item.status }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useSessionStore } from '@/stores/session'
import { listEntries } from '@/api/local-service'
import {
  advanceBatch,
  createBatch,
  equipmentOccupancy,
  latestCompatibleNeeds,
  listBatches,
  listRequisitions,
  registerExternalRequisition,
  submitBatch,
  type Actor,
} from '@/api/drill-batch'
import { resetDrillData } from '@/data/drill-store'
import type { DrillBatch, DutyAdjustment, EquipmentRequisition, RoadNotice } from '@/data/drill-types'
import type { EntryRow } from '@/data/types'

type SubmitStages = {
  值班调整: DutyAdjustment[]
  装备领用: EquipmentRequisition[]
  道路管制: RoadNotice[]
}

const store = useSessionStore()

const themes = ['春季扑火实战演练', '夏季雷击火应急演练', '秋季联防联合演练', '冬季装具拉动演练']
const tabs = [
  { key: 'create', label: '新建筹备批次' },
  { key: 'list', label: '批次列表与提交' },
  { key: 'detail', label: '批次明细' },
  { key: 'occupancy', label: '装备占用与数据流' },
] as const

const activeTab = ref<(typeof tabs)[number]['key']>('create')
const teamOptions = ref<EntryRow[]>([])
const equipmentOptions = ref<EntryRow[]>([])
const roadOptions = ref<EntryRow[]>([])
const batches = ref<DrillBatch[]>([])
const requisitions = ref<EquipmentRequisition[]>([])
const currentBatchId = ref<number | null>(null)
const message = ref('')
const messageOk = ref(false)
const lastStages = ref<SubmitStages | null>(null)
const externalMessage = ref('')

const form = reactive({
  theme: '春季扑火实战演练',
  prepareDate: '2026-10-10',
  execDate: '2026-10-18',
  summaryDate: '2026-10-20',
  targetHeadcount: 80,
  allowMixed: true,
  teamIds: [] as number[],
  equipmentIds: [] as number[],
  roadIds: [] as number[],
})

const external = reactive({
  source: '火情报告' as '火情报告' | '其他模块',
  sourceRef: '',
  equipmentRowId: 0,
  purpose: '',
  taker: '',
  date: new Date().toISOString().slice(0, 10),
})

const currentBatch = computed(() =>
  currentBatchId.value === null ? undefined : batches.value.find((item) => item.id === currentBatchId.value),
)

const selectedTeams = computed(() => {
  const unique = new Set(form.teamIds)
  return teamOptions.value.filter((team) => unique.has(Number(team.id)))
})
const headcount = computed(() =>
  selectedTeams.value.reduce((sum, team) => sum + Number(team.队员人数 || 0), 0),
)
const headcountGap = computed(() => Math.max(0, Number(form.targetHeadcount || 0) - headcount.value))
const forestTag = computed(() => {
  const forests = new Set(selectedTeams.value.map((team) => String(team.所属林场)))
  if (forests.size === 0) return null
  return forests.size > 1
    ? { mixed: true, label: `跨林场联合（${Array.from(forests).join('、')}）` }
    : { mixed: false, label: `单一林场（${Array.from(forests)[0]}）` }
})

const compatible = ref<{ sourceRef: string; sourceDate: string; needs: { equipmentRowId: number; quantity: number }[] }>({
  sourceRef: '',
  sourceDate: '',
  needs: [],
})

const previewShortage = computed(() => {
  const unique = new Set(form.equipmentIds)
  let shortage = 0
  for (const id of unique) {
    const occ = equipmentOccupancy(id)
    const eq = equipmentOptions.value.find((item) => Number(item.id) === id)
    if (!eq || ['待检修', '已报废'].includes(String(eq.status)) || occ.total >= 1) shortage += 1
  }
  return shortage
})

const draftReady = computed(() => batches.value.some((batch) => batch.status === '待提交'))

function actor(): Actor {
  return { roleKey: store.roleKey, operator: store.operator, forest: store.forest }
}
function isDeployed(status: string) {
  return ['已出动', '扑救中'].includes(status)
}
function isBlockedRoad(status: string) {
  return ['正在施工', '禁止通行'].includes(status)
}
function occupancyOf(id: number) {
  return equipmentOccupancy(id)
}

function refreshBase() {
  teamOptions.value = listEntries('fireteam').items
  equipmentOptions.value = listEntries('equipment').items
  roadOptions.value = listEntries('forestroad').items
}
function refreshBatches() {
  batches.value = listBatches()
  requisitions.value = listRequisitions()
}
function onThemeChange() {
  compatible.value = latestCompatibleNeeds(form.theme)
}
function applyCompatible() {
  compatible.value = latestCompatibleNeeds(form.theme)
  if (!compatible.value.needs.length) {
    setMessage('同主题没有找到可兼容的历史装备明细', false)
    return
  }
  form.equipmentIds = Array.from(new Set(compatible.value.needs.map((item) => item.equipmentRowId)))
  setMessage(`已带出「${compatible.value.sourceRef}」的 ${form.equipmentIds.length} 项装备（提交时标记为同主题继承）`, true)
}

function buildDraft() {
  return {
    演练主题: form.theme,
    筹备日期: form.prepareDate,
    实施日期: form.execDate,
    总结日期: form.summaryDate,
    目标参演人数: Number(form.targetHeadcount || 0),
    allowMixedForest: form.allowMixed,
    teamRowIds: form.teamIds,
    equipmentSelections: Array.from(new Set(form.equipmentIds)).map((id) => ({ equipmentRowId: id, quantity: 1 })),
    roadRowIds: form.roadIds,
  }
}

function saveDraft() {
  message.value = ''
  try {
    const batch = createBatch(buildDraft(), actor())
    refreshBatches()
    setMessage(`已生成待提交批次 ${batch.批次编号}（参演 ${batch.参演人数} 人，人数缺口 ${batch.参演人数缺口}，装备缺口 ${batch.装备缺口总数}）`, true)
  } catch (error) {
    setMessage(error instanceof Error ? error.message : '生成批次失败', false)
  }
}

function submitDraft() {
  // 列表按 id 倒序，第一条即最新草稿；不同草稿请在列表里逐条提交。
  const draft = batches.value.find((item) => item.status === '待提交' && item.owner === actor().operator)
    ?? batches.value.find((item) => item.status === '待提交')
  if (!draft) {
    setMessage('请先生成待提交批次', false)
    return
  }
  doSubmit(draft.id)
}

function submitExisting(id: number) {
  doSubmit(id)
}

function doSubmit(id: number) {
  const result = submitBatch(id, actor())
  refreshBatches()
  if (result.ok) {
    if (result.stages) {
      lastStages.value = {
        值班调整: result.stages.值班调整,
        装备领用: result.stages.装备领用,
        道路管制: result.stages.道路管制,
      }
    }
    setMessage(result.message, true)
    activeTab.value = 'list'
  } else {
    setMessage(result.message, false)
  }
}

function advance(id: number, to: '已实施' | '已总结') {
  const result = advanceBatch(id, to, actor())
  refreshBatches()
  setMessage(result.message, result.ok)
}

function openDetail(id: number) {
  currentBatchId.value = id
  activeTab.value = 'detail'
}

function addExternal() {
  externalMessage.value = ''
  try {
    registerExternalRequisition({
      source: external.source,
      sourceRef: external.sourceRef.trim(),
      equipmentRowId: external.equipmentRowId,
      quantity: 1,
      领用日期: external.date,
      用途: external.purpose.trim(),
      领用人: external.taker.trim(),
      actor: actor(),
    })
    refreshBatches()
    externalMessage.value = '外部领用已登记，演练装备占用已同步（同单重复登记被幂等拦截）'
  } catch (error) {
    externalMessage.value = error instanceof Error ? error.message : '登记失败'
  }
}

function resetForm() {
  form.teamIds = []
  form.equipmentIds = []
  form.roadIds = []
  message.value = ''
}

function setMessage(text: string, ok: boolean) {
  message.value = text
  messageOk.value = ok
}

function resetDemo() {
  resetDrillData()
  refreshBase()
  refreshBatches()
  setMessage('演示数据已重置', true)
}

onMounted(() => {
  refreshBase()
  refreshBatches()
  compatible.value = latestCompatibleNeeds(form.theme)
})
</script>
