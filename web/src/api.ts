import type { CacheStats, DemoSummary, HistoryItem, Report } from './types'

export interface ApiError extends Error {
  hint?: string
}

export async function analyze(url: string, refresh = false): Promise<Report> {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, refresh }),
  })
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw Object.assign(new Error('服务端返回了无法解析的内容'), { hint: text.slice(0, 200) })
  }
  if (!res.ok) {
    const error = new Error(data?.error || `请求失败（HTTP ${res.status}）`) as ApiError
    error.hint = data?.hint
    throw error
  }
  return data as Report
}

export async function health(): Promise<{ ok: boolean; aiProvider: string | null; version: string }> {
  const res = await fetch('/api/health')
  return res.json()
}

export async function checkUpdate(
  url: string,
  commit: string,
): Promise<{ latest: string; latestShort: string; branch: string; hasUpdate: boolean }> {
  const res = await fetch('/api/check-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, commit }),
  })
  if (!res.ok) throw new Error('检查更新失败')
  return res.json()
}

/** 离线示例报告（本地预生成，不依赖网络） */
export async function listDemos(): Promise<DemoSummary[]> {
  try {
    const res = await fetch('/api/demo')
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data?.demos) ? data.demos : []
  } catch {
    return []
  }
}

export async function getDemo(id: string): Promise<Report> {
  const res = await fetch(`/api/demo/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error('示例报告加载失败')
  return res.json()
}

/** 本地缓存占用（源码快照 + 报告） */
export async function getCacheStats(): Promise<CacheStats | null> {
  try {
    const res = await fetch('/api/cache')
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function cleanCache(includeReports = false): Promise<CacheStats | null> {
  const res = await fetch('/api/cache/clean', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeReports }),
  })
  if (!res.ok) throw new Error('清理失败')
  const data = await res.json()
  return data?.after ?? null
}

/* ---------------- 历史记录 ---------------- */

export async function getHistory(): Promise<HistoryItem[]> {
  try {
    const res = await fetch('/api/history')
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data?.items) ? data.items : []
  } catch {
    return []
  }
}

export async function getHistoryReport(id: string): Promise<Report> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error('记录不存在或已被删除')
  return res.json()
}

export async function deleteHistory(id: string): Promise<{ freedBytes: number }> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('删除失败')
  return res.json()
}

export async function clearHistory(): Promise<{ freedBytes: number }> {
  const res = await fetch('/api/history/clear', { method: 'POST' })
  if (!res.ok) throw new Error('清空失败')
  return res.json()
}

/* ---------------- AI 通道配置 ---------------- */

export interface AiConfigStatus {
  configured: boolean
  source: 'ui' | 'env' | 'none'
  provider: string | null
  model: string | null
  baseUrl: string | null
  keyMasked: string | null
  savedAt?: string | null
  ok?: boolean
  error?: string
}

export interface AiConfigInput {
  provider: string
  baseUrl: string
  model: string
  apiKey?: string
}

export interface AiTestResult {
  ok: boolean
  status?: number
  latencyMs: number
  model?: string
  reply?: string
  error?: string
}

async function jsonOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `请求失败（HTTP ${res.status}）`)
  return data
}

export async function getAiConfig(): Promise<AiConfigStatus> {
  try {
    const res = await fetch('/api/ai/config')
    if (!res.ok) return { configured: false, source: 'none', provider: null, model: null, baseUrl: null, keyMasked: null }
    return await res.json()
  } catch {
    return { configured: false, source: 'none', provider: null, model: null, baseUrl: null, keyMasked: null }
  }
}

export async function saveAiConfig(input: AiConfigInput): Promise<AiConfigStatus> {
  const res = await fetch('/api/ai/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return jsonOrThrow(res)
}

export async function clearAiConfig(): Promise<AiConfigStatus> {
  const res = await fetch('/api/ai/config', { method: 'DELETE' })
  return jsonOrThrow(res)
}

export async function testAiConnection(input: AiConfigInput): Promise<AiTestResult> {
  const res = await fetch('/api/ai/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return jsonOrThrow(res)
}
