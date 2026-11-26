import { useEffect } from 'react'
import type { HistoryItem } from '../types'
import { Icon, scoreColor } from './ui'

function formatTime(iso: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function formatBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function HistoryPanel({
  items,
  loading,
  onClose,
  onOpen,
  onDelete,
  onClear,
}: {
  items: HistoryItem[]
  loading: boolean
  onClose: () => void
  onOpen: (item: HistoryItem) => void
  onDelete: (item: HistoryItem) => void
  onClear: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const totalBytes = items.reduce((n, i) => n + i.reportBytes + i.sourceBytes, 0)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="历史记录">
        <header className="modal-head">
          <div>
            <h3>历史记录</h3>
            <p className="muted small">
              本地保存的体检报告，共 {items.length} 条 · 占用 {formatBytes(totalBytes)}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="history-list">
          {loading ? (
            <div className="empty">加载中…</div>
          ) : items.length === 0 ? (
            <div className="empty">
              还没有历史记录。
              <br />
              在上方输入一个仓库地址体检一次，报告会自动保存在本地。
            </div>
          ) : (
            items.map((item) => (
              <div className="history-row" key={item.id}>
                <span
                  className="history-grade"
                  style={{
                    color: scoreColor(item.score ?? 0),
                    background: `${scoreColor(item.score ?? 0)}14`,
                  }}
                >
                  {item.grade || '?'}
                </span>
                <div className="history-main">
                  <div className="history-title">
                    <b>{item.slug}</b>
                    <code className="mono">{item.commitShort}</code>
                  </div>
                  <div className="history-meta">
                    <span>{formatTime(item.analyzedAt)}</span>
                    <span className="dot" />
                    <span>{item.score ?? '-'} 分</span>
                    <span className="dot" />
                    <span>{item.riskTotal} 项风险</span>
                    <span className="dot" />
                    <span>{item.hasSource ? `源码快照 ${formatBytes(item.sourceBytes)}` : '无源码快照'}</span>
                  </div>
                </div>
                <div className="history-actions">
                  <button type="button" className="btn-ghost" onClick={() => onOpen(item)}>
                    查看
                  </button>
                  <button type="button" className="btn-ghost danger" onClick={() => onDelete(item)}>
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <footer className="modal-foot">
          <span className="muted small">
            <Icon name="warning" size={13} /> 删除记录会同时删除对应的源码快照
          </span>
          <button type="button" className="btn-ghost danger" onClick={onClear} disabled={!items.length}>
            清空全部
          </button>
        </footer>
      </div>
    </div>
  )
}
