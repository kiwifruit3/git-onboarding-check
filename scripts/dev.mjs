#!/usr/bin/env node
/**
 * 开发模式启动器：同时拉起 API 服务（8787）与 Vite 前端（5273）。
 * 直接调用 node 执行 bin 脚本，避免 Windows 下 .cmd / .ps1 的执行策略问题。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')

if (!existsSync(viteBin)) {
  console.error('\n[dev] 未找到 vite，请先执行: npm install\n')
  process.exit(1)
}

const children = []

function launch(name, args, color) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  })
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `
  const pipe = (stream, target) => {
    let buffer = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) target.write(prefix + line + '\n')
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${prefix}进程退出，code=${code}`)
    }
    shutdown()
  })
  children.push(child)
  return child
}

let closing = false
function shutdown() {
  if (closing) return
  closing = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(0), 300)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

launch('api', [path.join(root, 'server', 'index.mjs')], '36')
launch('web', [viteBin], '35')

console.log('\n  RepoPulse 开发模式')
console.log('  ─────────────────────────────')
console.log('  前端  http://127.0.0.1:5273')
console.log('  接口  http://127.0.0.1:8787/api/health\n')
