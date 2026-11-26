import type { ReactNode } from 'react'
import type { Check, Severity } from '../types'

export const SEVERITY_META: Record<Severity, { label: string; className: string; order: number }> = {
  critical: { label: '严重', className: 'sev-critical', order: 0 },
  high: { label: '高危', className: 'sev-high', order: 1 },
  medium: { label: '中危', className: 'sev-medium', order: 2 },
  low: { label: '低危', className: 'sev-low', order: 3 },
  info: { label: '提示', className: 'sev-info', order: 4 },
}

export function SeverityChip({ severity, small = false }: { severity: Severity; small?: boolean }) {
  const meta = SEVERITY_META[severity] || SEVERITY_META.info
  return <span className={`chip ${meta.className} ${small ? 'chip-sm' : ''}`}>{meta.label}</span>
}

export function scoreTone(score: number): string {
  if (score >= 85) return 'tone-great'
  if (score >= 70) return 'tone-good'
  if (score >= 55) return 'tone-warn'
  if (score >= 40) return 'tone-bad'
  return 'tone-worst'
}

export function scoreColor(score: number): string {
  if (score >= 85) return '#10b981'
  if (score >= 70) return '#22c55e'
  if (score >= 55) return '#f59e0b'
  if (score >= 40) return '#f97316'
  return '#ef4444'
}

export function CheckList({ checks }: { checks: Check[] }) {
  if (!checks?.length) return <p className="muted">暂无检查项</p>
  return (
    <ul className="check-list">
      {checks.map((c) => (
        <li key={c.key} className={c.ok ? 'ok' : 'fail'}>
          <span className="check-icon" aria-hidden>
            {c.ok ? (
              <svg viewBox="0 0 20 20" width="16" height="16">
                <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" width="16" height="16">
                <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <span className="check-label">{c.label}</span>
          <span className="check-weight">{c.weight}%</span>
        </li>
      ))}
    </ul>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="mono">{children}</code>
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'pulse':
      return (
        <svg {...common}>
          <path d="M3 12h3.5l2.5-7 4 14 2.6-7H21" />
        </svg>
      )
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5.5c0 4.3-2.9 7.7-7 9.5-4.1-1.8-7-5.2-7-9.5V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      )
    case 'windows':
      return (
        <svg {...common}>
          <path d="M3 5.5l8-1.2v7.2H3V5.5zM13 4l8-1.2v8.7h-8V4zM3 13.2h8v7.2l-8-1.2v-6zM13 13.2h8v8.7L13 20.7v-7.5z" />
        </svg>
      )
    case 'path':
      return (
        <svg {...common}>
          <path d="M4 6h6l2 3h8" />
          <path d="M4 6v12h16V9" />
          <circle cx="9" cy="15" r="1.6" />
        </svg>
      )
    case 'key':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="4" />
          <path d="M11 11l9 9M17 17l2-2M14 14l2-2" />
        </svg>
      )
    case 'doc':
      return (
        <svg {...common}>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4M10 12h6M10 16h6" />
        </svg>
      )
    case 'package':
      return (
        <svg {...common}>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
          <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
        </svg>
      )
    case 'play':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8.5l6 3.5-6 3.5v-7z" />
        </svg>
      )
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
          <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
        </svg>
      )
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 10-2.3 5.7" />
          <path d="M20 5v6h-6" />
        </svg>
      )
    case 'gear':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.6V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.6 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
        </svg>
      )
    case 'commit':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M3 12h5.8M15.2 12H21" />
        </svg>
      )
    case 'arrow':
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      )
    case 'warning':
      return (
        <svg {...common}>
          <path d="M12 4l9 16H3L12 4z" />
          <path d="M12 10v4M12 17.2v.1" />
        </svg>
      )
    case 'github':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 015 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.35 4.8-4.58 5.05.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.03 10.03 0 0022 12.25C22 6.58 17.52 2 12 2z" />
        </svg>
      )
    default:
      return null
  }
}
