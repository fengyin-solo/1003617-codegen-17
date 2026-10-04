import { defineStore } from 'pinia'

// 身份角色：管理员可跨林场混合组队；林场值班员只能操作归属本林场的数据；只读查看员没有任何写权限。
export type RoleKey = 'admin' | 'operator' | 'viewer'

export type Actor = {
  name: string
  role: RoleKey
  forestFarm: string
}

export const ROLE_LABELS: Record<RoleKey, string> = {
  admin: '管理员',
  operator: '林场值班员',
  viewer: '只读查看员',
}

// 演练筹备里允许选择的三个林场，与扑火队伍/装备的「所属林场」取值保持一致。
export const FOREST_FARMS = ['青松岭林场', '白桦坡林场', '红松口林场']

type SessionState = {
  operator: string
  role: RoleKey
  forestFarm: string
  shiftLabel: string
  scope: string
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    operator: '总指挥',
    role: 'admin',
    forestFarm: '',
    shiftLabel: '白班 08:00-20:00',
    scope: '森林防火巡护管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isReadOnly: (state) => state.role === 'viewer',
    canWrite(state): boolean {
      return state.role !== 'viewer' && state.operator.length > 0
    },
    roleLabel: (state) => ROLE_LABELS[state.role],
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchSession(role: RoleKey, forestFarm = '') {
      this.role = role
      if (role === 'admin') {
        this.operator = '总指挥'
        this.forestFarm = ''
      } else if (role === 'operator') {
        this.role = 'operator'
        this.forestFarm = forestFarm || FOREST_FARMS[0]
        this.operator = `${this.forestFarm}值班员`
      } else {
        this.operator = '值班观察员'
        this.forestFarm = ''
      }
    },
    setForestFarm(forestFarm: string) {
      this.forestFarm = forestFarm
      if (this.role === 'operator') {
        this.operator = `${forestFarm}值班员`
      }
    },
    actor(): Actor {
      return { name: this.operator, role: this.role, forestFarm: this.forestFarm }
    },
  },
})
