/**
 * AI 通道的运行时配置（网页端「AI 设置」写入）。
 *
 * 保存位置：项目根目录 .cache/ai-config.json（.cache 已被 .gitignore 忽略，不会提交）
 * 优先级：网页配置 > 环境变量 / .env
 *
 * 注意：Key 以明文保存在本机文件里（和 .env 一样），接口只返回打码后的值。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const CONFIG_PATH = process.env.REPOPULSE_AI_CONFIG || path.join(process.cwd(), '.cache', 'ai-config.json')

let runtime = null
let loaded = false

export function configPath() {
  return CONFIG_PATH
}

export function loadAiConfig() {
  if (loaded) return runtime
  loaded = true
  try {
    if (existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
      if (parsed && typeof parsed === 'object') runtime = parsed
    }
  } catch {
    runtime = null
  }
  return runtime
}

function normalize(input = {}) {
  const provider = String(input.provider || 'custom').trim().slice(0, 40) || 'custom'
  const baseUrl = String(input.baseUrl || '').trim().replace(/\/+$/, '').slice(0, 300)
  const apiKey = String(input.apiKey || '').trim().slice(0, 400)
  const model = String(input.model || '').trim().slice(0, 120)
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Base URL 必须以 http(s):// 开头')
  if (!apiKey) throw new Error('API Key 不能为空')
  if (!model) throw new Error('模型名不能为空')
  return { provider, baseUrl, apiKey, model, savedAt: new Date().toISOString() }
}

export function saveAiConfig(input) {
  const clean = normalize(input)
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(clean, null, 2), { encoding: 'utf8', mode: 0o600 })
  runtime = clean
  loaded = true
  return clean
}

export function clearAiConfig() {
  try {
    rmSync(CONFIG_PATH, { force: true })
  } catch {
    /* 忽略 */
  }
  runtime = null
  loaded = true
}

/** 只暴露打码后的 Key，接口绝不返回完整值 */
export function maskApiKey(key) {
  const value = String(key || '')
  if (value.length <= 8) return value ? '****' : ''
  return `${value.slice(0, 6)}****${value.slice(-4)}`
}

export function publicAiConfig() {
  const cfg = loadAiConfig()
  if (!cfg?.apiKey) return { configured: false, source: 'none', provider: null, model: null, baseUrl: null, keyMasked: null }
  return {
    configured: true,
    source: 'ui',
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    keyMasked: maskApiKey(cfg.apiKey),
    savedAt: cfg.savedAt || null,
  }
}
