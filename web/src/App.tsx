import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyze, cleanCache, getCacheStats, getDemo, health, listDemos } from './api'
import { ReportView } from './components/Report'
import { Icon, scoreColor } from './components/ui'
import type { CacheStats, DemoSummary, Report } from './types'

const EXAMPLES = [
  { label: 'expressjs/express', url: 'https://github.com/expressjs/express' },
  { label: 'redis-windows/redis-windows', url: 'https://github.com/redis-windows/redis-windows' },
  { label: 'octocat/Hello-World', url: 'https://github.com/octocat/Hello-World' },
]

const STAGES = [
  '解析仓库地址',
  '读取 HEAD commit',
  '拉取源码快照',
  '遍历文件树',
  '执行规则扫描（6 类）',
  '计算就绪度评分',
  '生成风险清单与建议',
]

export default function App() {
  const [input, setInput] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null)
  const [aiInfo, setAiInfo] = useState<{ aiProvider: string | null; version: string } | null>(null)
  const [demos, setDemos] = useState<DemoSummary[]>([])
  const [cache, setCache] = useState<CacheStats | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const lastUrl = useRef('')

  useEffect(() => {
    health()
      .then(setAiInfo)
      .catch(() => setAiInfo(null))
    listDemos()
      .then(setDemos)
      .catch(() => setDemos([]))
    getCacheStats()
      .then(setCache)
      .catch(() => setCache(null))
  }, [])

  const refreshCache = useCallback(() => {
    getCacheStats()
      .then(setCache)
      .catch(() => setCache(null))
  }, [])

  const doCleanCache = useCallback(async () => {
    if (!window.confirm('将删除本机缓存的所有仓库源码快照（报告会保留）。确定继续？')) return
    setCleaning(true)
    try {
      const next = await cleanCache(false)
      setCache(next)
    } catch {
      /* 忽略，下次刷新会重新拉取 */
    } finally {
      setCleaning(false)
    }
  }, [])

  useEffect(() => {
    if (!loading) return
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 200)
    return () => window.clearInterval(timer)
  }, [loading])

  const run = useCallback(async (url: string, refresh = false) => {
    const target = url.trim()
    if (!target) return
    lastUrl.current = target
    setError(null)
    setElapsed(0)
    if (refresh) setRefreshing(true)
    else setLoading(true)
    try {
      const data = await analyze(target, refresh)
      setReport(data)
      setInput(target)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: any) {
      setError({ message: err?.message || '分析失败', hint: err?.hint })
    } finally {
      setLoading(false)
      setRefreshing(false)
      refreshCache()
    }
  }, [])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    run(input)
  }

  const loadDemo = useCallback(async (id: string) => {
    try {
      const data = await getDemo(id)
      setError(null)
      setReport(data)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: any) {
      setError({ message: err?.message || '示例报告加载失败' })
    }
  }, [])

  const stageIndex = useMemo(() => {
    const idx = Math.min(STAGES.length - 1, Math.floor(elapsed / 1400))
    return idx
  }, [elapsed])

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="pulse" size={20} />
            </span>
            <div className="brand-text">
              <b>RepoPulse</b>
              <span>Git 仓库接入体检</span>
            </div>
          </div>
          <div className="topbar-right">
            <span className={`ai-state ${aiInfo?.aiProvider ? 'on' : ''}`}>
              <Icon name="spark" size={14} />
              {aiInfo?.aiProvider ? `AI 通道 · ${aiInfo.aiProvider}` : 'AI：内置规则引擎'}
            </span>
            <a className="gh-link" href="https://github.com/kiwifruit3/git-onboarding-check" target="_blank" rel="noreferrer">
              <Icon name="github" size={16} /> 源码
            </a>
          </div>
        </div>
      </header>

      <main className="main">
        <section className={`hero ${report ? 'compact' : ''}`}>
          <div className="hero-glow" aria-hidden />
          <div className="hero-inner">
            <span className="kicker">GIT ONBOARDING CHECK · 48H CHALLENGE</span>
            <h1>
              给一个仓库链接，
              <br />
              10 秒看清它<em>能不能接</em>。
            </h1>
            <p className="hero-sub">
              自动检查 README 完整度、依赖与启动脚本、Windows 专用脚本、硬编码绝对路径、密钥泄露风险，
              输出<strong>接入就绪度评分</strong>与<strong>可执行的整改清单</strong>。
            </p>

            <form className="search" onSubmit={onSubmit}>
              <span className="search-icon">
                <Icon name="github" size={18} />
              </span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="粘贴公开仓库地址，例如 https://github.com/owner/repo"
                spellCheck={false}
                autoComplete="off"
                aria-label="Git 仓库地址"
              />
              <button type="submit" disabled={loading || !input.trim()}>
                {loading ? '体检中…' : '开始体检'}
                {!loading && <Icon name="arrow" size={16} />}
              </button>
            </form>

            <div className="examples">
              <span>试试：</span>
              {EXAMPLES.map((e) => (
                <button key={e.url} type="button" onClick={() => run(e.url)} disabled={loading}>
                  {e.label}
                </button>
              ))}
            </div>

            {demos.length > 0 && (
              <div className="demo-strip">
                <span className="demo-strip-label">
                  <Icon name="doc" size={13} /> 离线示例（无需网络）
                </span>
                {demos.map((d) => (
                  <button key={d.id} type="button" className="demo-chip" onClick={() => loadDemo(d.id)} disabled={loading}>
                    <span className="demo-chip-name">{d.slug}</span>
                    <span className="demo-chip-score" style={{ color: scoreColor(d.score) }}>
                      {d.score}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <ul className="features">
              <li>
                <Icon name="doc" size={15} /> README / 依赖 / 启动脚本
              </li>
              <li>
                <Icon name="windows" size={15} /> .bat .cmd .ps1 .vbs
              </li>
              <li>
                <Icon name="path" size={15} /> 盘符 / 用户目录 绝对路径
              </li>
              <li>
                <Icon name="key" size={15} /> sk- / AKID / Bearer / 私钥
              </li>
            </ul>
          </div>
        </section>

        {loading && <LoadingPanel url={lastUrl.current} stage={stageIndex} elapsed={elapsed} />}

        {error && (
          <section className="card error-card">
            <div className="error-head">
              <Icon name="warning" size={20} />
              <div>
                <h3>{error.message}</h3>
                {error.hint && <p>{error.hint}</p>}
              </div>
            </div>
            <div className="error-actions">
              <button type="button" className="btn-ghost" onClick={() => run(lastUrl.current)}>
                <Icon name="refresh" size={15} /> 重试
              </button>
              <span className="muted small">仅支持公开仓库；私有仓库需要授权后才能访问。</span>
            </div>
            {demos.length > 0 && (
              <div className="error-demos">
                <span className="muted small">网络不通？可以先看离线示例报告（本地数据，不联网）：</span>
                <div className="error-demo-list">
                  {demos.map((d) => (
                    <button key={d.id} type="button" className="demo-chip" onClick={() => loadDemo(d.id)}>
                      <span className="demo-chip-name">{d.slug}</span>
                      <span className="demo-chip-score" style={{ color: scoreColor(d.score) }}>
                        {d.score}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {!loading && report && (
          <ReportView
            report={report}
            refreshing={refreshing}
            onRefresh={() => run(lastUrl.current, true)}
            onAnalyze={(url) => run(url)}
          />
        )}

        {!loading && !report && !error && <HowItWorks />}
      </main>

      <footer className="footer">
        <span>
          RepoPulse · 静态扫描，不上传代码 · 评分模型与规则说明见 <code className="mono">README.md</code>
        </span>
        <span className="footer-meta">
          Node.js + React · 静态扫描 · 零外部 CDN 依赖
          {cache && cache.totalBytes > 0 && (
            <span className="cache-info">
              {' · '}本地缓存 {formatBytes(cache.totalBytes)}（源码快照 {cache.sources} 份 / 报告 {cache.reports} 份）
              <button type="button" className="link-btn" onClick={doCleanCache} disabled={cleaning}>
                {cleaning ? '清理中…' : '清理代码快照'}
              </button>
            </span>
          )}
        </span>
      </footer>
    </div>
  )
}

function formatBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function LoadingPanel({ url, stage, elapsed }: { url: string; stage: number; elapsed: number }) {
  const pct = Math.min(96, Math.round((1 - Math.exp(-elapsed / 6000)) * 100))
  return (
    <section className="card loading-card">
      <div className="loading-head">
        <div className="spinner" />
        <div>
          <h3>正在体检 {url.replace(/^https?:\/\//, '')}</h3>
          <p className="muted small">首次分析需要拉取源码快照，通常 3–20 秒</p>
        </div>
        <span className="elapsed">{(elapsed / 1000).toFixed(1)}s</span>
      </div>
      <div className="progress">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <ul className="stages">
        {STAGES.map((s, i) => (
          <li key={s} className={i < stage ? 'done' : i === stage ? 'active' : ''}>
            <span className="stage-dot" />
            {s}
            {i < stage && <span className="stage-ok">✓</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function HowItWorks() {
  const items = [
    {
      icon: 'doc',
      title: '文档与可运行性',
      text: 'README 章节覆盖、依赖清单与锁文件、启动/构建/测试入口，判断「拿到能不能跑」。',
    },
    {
      icon: 'windows',
      title: 'Windows 脚本',
      text: '识别 .bat/.cmd/.ps1/.vbs，检查 README 是否依赖它们、是否存在跨平台等价入口。',
    },
    {
      icon: 'path',
      title: '硬编码路径',
      text: '扫描 Windows 盘符、macOS/Linux 用户目录、UNC 共享与 file:// 路径，定位到具体文件与行号。',
    },
    {
      icon: 'key',
      title: '密钥泄露',
      text: 'sk-、AKID、Bearer、私钥、.env 入库与高熵字符串，证据自动脱敏展示。',
    },
  ]
  return (
    <section className="how">
      <h2>体检覆盖什么</h2>
      <div className="how-grid">
        {items.map((it) => (
          <div className="how-card" key={it.title}>
            <span className="how-icon">
              <Icon name={it.icon} size={20} />
            </span>
            <h3>{it.title}</h3>
            <p>{it.text}</p>
          </div>
        ))}
      </div>
      <div className="how-steps">
        <div>
          <span className="step-no">01</span> 输入公开仓库地址
        </div>
        <div>
          <span className="step-no">02</span> 自动拉取并静态扫描
        </div>
        <div>
          <span className="step-no">03</span> 输出评分与整改清单
        </div>
      </div>
    </section>
  )
}
