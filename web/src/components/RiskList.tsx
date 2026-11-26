import { useMemo, useState } from 'react'
import type { Finding, Severity } from '../types'
import { SEVERITY_META, SeverityChip } from './ui'

const FILTERS: Array<{ key: Severity | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'critical', label: '严重' },
  { key: 'high', label: '高危' },
  { key: 'medium', label: '中危' },
  { key: 'low', label: '低危' },
]

export function RiskList({
  findings,
  counts,
  compact = false,
}: {
  findings: Finding[]
  counts?: Record<Severity, number>
  compact?: boolean
}) {
  const [filter, setFilter] = useState<Severity | 'all'>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const list = useMemo(() => {
    const base = filter === 'all' ? findings : findings.filter((f) => f.severity === filter)
    return compact ? base.slice(0, 5) : base
  }, [findings, filter, compact])

  const countOf = (key: Severity | 'all') => {
    if (key === 'all') return findings.length
    return counts?.[key] ?? findings.filter((f) => f.severity === key).length
  }

  return (
    <div className="risk-list">
      {!compact && (
        <div className="filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`filter-btn ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="filter-count">{countOf(f.key)}</span>
            </button>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty">没有命中该级别的风险项 🎉</div>
      ) : (
        <ul className="risk-items">
          {list.map((f) => {
            const isOpen = openId === f.id
            return (
              <li key={f.id} className={`risk-item ${isOpen ? 'open' : ''}`}>
                <button type="button" className="risk-head" onClick={() => setOpenId(isOpen ? null : f.id)}>
                  <SeverityChip severity={f.severity} />
                  <span className="risk-title">{f.title}</span>
                  {f.file && (
                    <code className="risk-file">
                      {f.file}
                      {f.line ? `:${f.line}` : ''}
                    </code>
                  )}
                  {f.confidence === 'low' && <span className="tag tag-dim">低置信</span>}
                  <span className={`risk-caret ${isOpen ? 'up' : ''}`}>⌄</span>
                </button>
                {isOpen && (
                  <div className="risk-body">
                    <p className="risk-detail">{f.detail}</p>
                    {f.evidence && (
                      <div className="evidence">
                        <span className="evidence-label">证据</span>
                        <code className="evidence-text">{f.evidence}</code>
                      </div>
                    )}
                    {f.suggestion && (
                      <p className="risk-suggestion">
                        <span className="suggestion-label">整改建议</span>
                        {f.suggestion}
                      </p>
                    )}
                    <div className="risk-meta">
                      <span>维度：{f.dimension}</span>
                      <span>类别：{f.category}</span>
                      <span>置信度：{f.confidence === 'high' ? '高' : f.confidence === 'medium' ? '中' : '低'}</span>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {compact && findings.length > 5 && (
        <p className="muted small">仅展示前 5 项，完整清单见「风险清单」页签（共 {findings.length} 项）</p>
      )}
    </div>
  )
}

export function SeveritySummary({ counts }: { counts: Record<Severity, number> }) {
  const order: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
  return (
    <div className="severity-summary">
      {order.map((sev) => (
        <div key={sev} className={`sev-card ${SEVERITY_META[sev].className}`}>
          <div className="sev-num">{counts?.[sev] || 0}</div>
          <div className="sev-label">{SEVERITY_META[sev].label}</div>
        </div>
      ))}
    </div>
  )
}
