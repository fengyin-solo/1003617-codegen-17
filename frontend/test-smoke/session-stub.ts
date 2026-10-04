// 测试用会话桩：替换 pinia store，便于在 node 下切换身份验证权限/越权。
export type RoleKey = 'admin' | 'operator' | 'viewer'
export type Actor = { name: string; role: RoleKey; forestFarm: string }

let current: Actor = { name: '总指挥', role: 'admin', forestFarm: '' }

export function __setActor(actor: Actor) {
  current = actor
}

export const FOREST_FARMS = ['青松岭林场', '白桦坡林场', '红松口林场']

export function useSessionStore() {
  return {
    actor: () => current,
    get role() {
      return current.role
    },
    get canWrite() {
      return current.role !== 'viewer' && current.name.length > 0
    },
  }
}
