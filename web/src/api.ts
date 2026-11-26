import type { Report } from './types'

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
