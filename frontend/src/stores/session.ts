import { defineStore } from 'pinia'

// 权限模型：三类角色，最小可用授权。
// - 指挥中心：可建批、可提交、可推进本批次；
// - 林场值班员：只能操作归属本林场的批次（只读其它林场）；
// - 观察员：全局只读。
export type RoleKey = 'commander' | 'forester' | 'observer'

export type RoleProfile = {
  key: RoleKey
  label: string
  forest: string
}

const ROLE_PRESETS: RoleProfile[] = [
  { key: 'commander', label: '指挥中心值班员', forest: '全局' },
  { key: 'forester', label: '青松林场值班员', forest: '青松林场' },
  { key: 'observer', label: '安全观察员', forest: '全局' },
]

type SessionState = {
  operator: string
  shiftLabel: string
  scope: string
  roleKey: RoleKey
  roleLabel: string
  forest: string
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '森林防火巡护管理系统',
    roleKey: 'commander',
    roleLabel: ROLE_PRESETS[0].label,
    forest: ROLE_PRESETS[0].forest,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isReadOnly: (state) => state.roleKey === 'observer',
    roles: () => ROLE_PRESETS,
    /** 是否允许新建/提交筹备批次。 */
    canPrepare: (state) => state.roleKey === 'commander' || state.roleKey === 'forester',
    /** 是否允许推进演练阶段（完成演练、提交总结）。 */
    canAdvance: (state) => state.roleKey === 'commander',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchRole(key: RoleKey) {
      const profile = ROLE_PRESETS.find((item) => item.key === key) ?? ROLE_PRESETS[0]
      this.roleKey = profile.key
      this.roleLabel = profile.label
      this.forest = profile.forest
      this.operator = profile.label
    },
    /**
     * 越权判定：林场值班员只能写归属本林场的批次；指挥中心可跨林场；
     * 观察员一律只读。批次 ownerForest 为「全局」时视为指挥中心名下，
     * 林场值班员只读。
     */
    canWriteBatch(batchOwnerForest: string): boolean {
      if (this.roleKey === 'observer') return false
      if (this.roleKey === 'commander') return true
      return this.roleKey === 'forester' && batchOwnerForest === this.forest
    },
  },
})
