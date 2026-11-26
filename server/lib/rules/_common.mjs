/**
 * 规则公共工具：统一的 finding 结构与打分辅助。
 */
import { clamp, SEVERITY_ORDER } from '../util.mjs'

let seq = 0

/**
 * @param {object} input
 * @param {'docs'|'deps'|'scripts'|'portability'|'security'|'hygiene'} input.dimension
 */
export function makeFinding(input) {
  seq += 1
  return {
    id: input.id || `f-${Date.now().toString(36)}-${seq}`,
    dimension: input.dimension,
    category: input.category,
    severity: input.severity || 'medium',
    title: input.title,
    detail: input.detail || '',
    file: input.file || '',
    line: input.line || 0,
    evidence: input.evidence || '',
    suggestion: input.suggestion || '',
    confidence: input.confidence || 'high',
  }
}

export function sortFindings(findings) {
  return findings.sort((a, b) => {
    const s = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    if (s !== 0) return s
    return a.file.localeCompare(b.file)
  })
}

export function scoreFromChecks(checks) {
  const total = checks.reduce((sum, c) => sum + c.weight, 0)
  if (!total) return 0
  const earned = checks.reduce((sum, c) => sum + (c.ok ? c.weight : 0), 0)
  return clamp(Math.round((earned / total) * 100), 0, 100)
}

export function countBySeverity(findings) {
  const out = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const f of findings) out[f.severity] = (out[f.severity] || 0) + 1
  return out
}

/** 从文本中截取指定行的片段，用于证据展示 */
export function lineAt(text, line) {
  if (!text) return ''
  const lines = text.split(/\r\n|\r|\n/)
  const raw = lines[Math.max(0, line - 1)] || ''
  return raw.trim().slice(0, 240)
}

export function trimEvidence(value, max = 120) {
  const s = String(value).replace(/\s+/g, ' ')
  return s.length > max ? `${s.slice(0, max)}…` : s
}
