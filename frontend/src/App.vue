<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">森林防火巡护管理系统</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向森林火险监测、巡护任务调度、防火设施维护与应急响应指挥的林区防火管理平台。</span>
        <span class="head-user">
          <label class="switch-item">
            身份
            <select :value="store.role" @change="switchRole(($event.target as HTMLSelectElement).value)">
              <option value="admin">管理员（可跨林场混合）</option>
              <option value="operator">林场值班员</option>
              <option value="viewer">只读查看员</option>
            </select>
          </label>
          <label v-if="store.role === 'operator'" class="switch-item">
            归属林场
            <select :value="store.forestFarm" @change="store.setForestFarm(($event.target as HTMLSelectElement).value)">
              <option v-for="farm in farms" :key="farm" :value="farm">{{ farm }}</option>
            </select>
          </label>
          当前值班：{{ store.operator }} · {{ store.shiftLabel }}
        </span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore, FOREST_FARMS, type RoleKey } from '@/stores/session'

const store = useSessionStore()
const farms = FOREST_FARMS

function switchRole(value: string) {
  store.switchSession(value as RoleKey)
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "巡护任务", path: "/patrol" }, { label: "火险监测", path: "/firewatch" }, { label: "瞭望台管理", path: "/lookout" }, { label: "防火隔离带", path: "/firebreak" }, { label: "扑火队伍", path: "/fireteam" }, { label: "消防装备", path: "/equipment" }, { label: "气象观测", path: "/weather" }, { label: "火情报告", path: "/firereport" }, { label: "无人机巡查", path: "/drone" }, { label: "防火宣传", path: "/campaign" }, { label: "防火检查站", path: "/checkpoint" }, { label: "值勤排班", path: "/duty" }, { label: "物资储备", path: "/supply" }, { label: "林区道路", path: "/forestroad" }, { label: "防火林带", path: "/firebelt" }, { label: "应急演练", path: "/drill" }, { label: "演练筹备批次", path: "/drillplan" }, { label: "焚烧审批", path: "/burnpermit" }, { label: "林木生长", path: "/treegrowth" }]
</script>
