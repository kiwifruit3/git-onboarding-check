/**
 * 轻量 .env 加载器（零依赖）。
 *
 * 用途：把 API Key 写在项目根目录的 .env 里（该文件已在 .gitignore 中），
 * 而不是写进 .env.example 或代码里——避免误提交泄露。
 *
 * 已存在的环境变量优先级更高（不会被 .env 覆盖）。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

function parseEnv(text) {
  const out = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    out[match[1]] = value
  }
  return out
}

/**
 * @param {string} [file] .env 路径，默认项目根目录
 * @returns {boolean} 是否成功加载
 */
export function loadDotEnv(file = path.resolve(process.cwd(), '.env')) {
  if (!existsSync(file)) return false
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(file)
      return true
    }
  } catch {
    /* 回退到手动解析 */
  }
  try {
    const parsed = parseEnv(readFileSync(file, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in process.env)) process.env[key] = value
    }
    return true
  } catch {
    return false
  }
}
