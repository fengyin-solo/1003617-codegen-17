// 用 esbuild 把测试与领域代码打包到临时文件执行：别名把 pinia 会话换成可切换身份的桩。
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const root = path.dirname(fileURLToPath(import.meta.url))
const outfile = path.join(root, '.smoke-bundle.mjs')

// node 环境的 localStorage 内存垫片：首次读取即播种种子数据。
const preamble = `
const __mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (__mem.has(k) ? __mem.get(k) : null),
  setItem: (k, v) => __mem.set(k, String(v)),
  removeItem: (k) => __mem.delete(k),
};
globalThis.crypto.randomUUID = () => 'TEST-UUID-' + Math.random().toString(16).slice(2);
`

await build({
  entryPoints: [path.join(root, 'drill-plan.test.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  alias: {
    // 更具体的别名写前面：会话桩替换 pinia store，其余 @ 路径回到 src。
    '@/stores/session': path.join(root, 'session-stub.ts'),
    '@': path.join(root, '..', 'src'),
  },
  banner: { js: preamble },
  logLevel: 'silent',
})

await import(outfile)
const failed = (globalThis).__FAIL_COUNT__ ?? 0
fs.rmSync(outfile, { force: true })
process.exit(failed > 0 ? 1 : 0)
