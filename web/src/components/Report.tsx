import { useState } from 'react'
import type { Report } from '../types'
import { checkUpdate } from '../api'
import { downloadFile, reportToMarkdown } from '../export'
import { RiskList, SeveritySummary } from './RiskList'
import { DimensionBars, ScoreRing } from './Score'
import { CheckList, Empty, Icon, SeverityChip, scoreColor, scoreTone } from './ui'

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'risks', label: '风险清单' },
  { key: 'windows', label: 'Windows 脚本' },
  { key: 'paths', label: '硬编码路径' },
  { key: 'secrets', label: '密钥风险' },
  { key: 'deps', label: '依赖与启动' },
  { key: 'docs', label: '文档与规范' },
  { key: 'ai', label: 'AI 建议' },
  { key: 'files', label: '文件扫描' },
]

export function ReportView({
  report,
  onRefresh,
  onAnalyze,
  refreshing,
}: {
  report: Report
  onRefresh: () => void
  onAnalyze: (url: string) => void
  refreshing: boolean
}) {
  const [tab, setTab] = useState('overview')
  const [updateInfo, setUpdateInfo] = useState<{ latestShort: string; hasUpdate: boolean } | null>(null)
  const [checking, setChecking] = useState(false)
  const { meta, score, stats, risk, sections, ai, scan } = report

  const doCheckUpdate = async () => {
    setChecking(true)
    try {
      const result = await checkUpdate(meta.repo.webUrl, meta.commit)
      setUpdateInfo(result)
    } catch {
      setUpdateInfo(null)
    } finally {
      setChecking(false)
    }
  }

  const tabCount: Record<string, number> = {
    risks: risk.total,
    windows: sections.windows.stats.total,
    paths: sections.paths.stats.total,
    secrets: sections.secrets.stats.total,
  }

  return (
    <div className="report">
      <div className="repo-head card">
        <div className="repo-id">
          <span className="repo-badge">
            <Icon name="github" size={22} />
          </span>
          <div className="repo-titles">
            <h2>
              <span className="muted">{meta.repo.owner} / </span>
              {meta.repo.name}
            </h2>
            <div className="repo-meta">
              <a href={meta.repo.webUrl} target="_blank" rel="noreferrer">
                仓库主页
              </a>
              <span className="dot" />
              <span>分支 {meta.branch}</span>
              <span className="dot" />
              <a href={meta.commitUrl} target="_blank" rel="noreferrer" className="commit-link">
                <Icon name="commit" size={14} />
                {meta.commitShort}
              </a>
              <span className="dot" />
              <span>分析于 {formatTime(meta.analyzedAt)}</span>
              <span className="dot" />
              <span>耗时 {(meta.durationMs / 1000).toFixed(1)}s</span>
              {meta.cached && <span className="tag">命中缓存</span>}
            </div>
          </div>
        </div>
        <div className="repo-actions">
          {updateInfo && (
            <span className={`badge ${updateInfo.hasUpdate ? 'warn' : ''}`}>
              {updateInfo.hasUpdate ? `远端有新提交 ${updateInfo.latestShort}` : '已是最新提交'}
            </span>
          )}
          <button type="button" className="btn-ghost" onClick={doCheckUpdate} disabled={checking || meta.demo}>
            {checking ? '检查中…' : '检查更新'}
          </button>
          {meta.demo ? (
            <button type="button" className="btn-ghost primary" onClick={() => onAnalyze(meta.repo.webUrl)}>
              <Icon name="play" size={15} /> 在线分析此仓库
            </button>
          ) : (
            <button type="button" className="btn-ghost primary" onClick={onRefresh} disabled={refreshing}>
              <Icon name="refresh" size={16} />
              {refreshing ? '重新体检中…' : '重新体检'}
            </button>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => downloadFile(`${meta.repo.name}-${meta.commitShort}-report.md`, reportToMarkdown(report))}
          >
            导出 Markdown
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() =>
              downloadFile(`${meta.repo.name}-${meta.commitShort}-report.json`, JSON.stringify(report, null, 2), 'application/json')
            }
          >
            JSON
          </button>
        </div>
      </div>

      {meta.stale && (
        <div className="banner banner-warn">
          <Icon name="warning" size={16} />
          <div>
            <b>无法获取最新数据，当前展示的是历史缓存报告</b>
            <span>{meta.staleReason || '已回退到最近一次分析结果，commit 可能不是最新。'}</span>
          </div>
        </div>
      )}

      {meta.demo && (
        <div className="banner banner-demo">
          <Icon name="doc" size={16} />
          <div>
            <b>离线示例报告</b>
            <span>{meta.demoNote || '预生成快照，不会实时更新；可直接体验全部功能。'}</span>
          </div>
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {tabCount[t.key] ? <span className="tab-count">{tabCount[t.key]}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <Overview report={report} onJump={setTab} />
      )}
      {tab === 'risks' && (
        <section className="card">
          <SectionHead title="风险清单" desc="按严重程度排序，点击条目查看证据与整改建议" />
          <RiskList findings={risk.all} counts={risk.counts} />
        </section>
      )}
      {tab === 'windows' && <WindowsTab report={report} />}
      {tab === 'paths' && <PathsTab report={report} />}
      {tab === 'secrets' && <SecretsTab report={report} />}
      {tab === 'deps' && <DepsTab report={report} />}
      {tab === 'docs' && <DocsTab report={report} />}
      {tab === 'ai' && <AiTab report={report} />}
      {tab === 'files' && <FilesTab report={report} />}

      <p className="disclaimer">
        报告基于 commit <code className="mono">{meta.commitShort}</code> 的静态扫描生成（{meta.scanner.name} v
        {meta.scanner.version}）。规则命中不代表一定有问题，请结合业务上下文复核。
      </p>
    </div>
  )
}

function SectionHead({ title, desc, right }: { title: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <h3>{title}</h3>
        {desc && <p className="muted small">{desc}</p>}
      </div>
      {right}
    </div>
  )
}

function Overview({ report, onJump }: { report: Report; onJump: (key: string) => void }) {
  const { score, stats, risk, sections, ai } = report
  const kpis = [
    {
      key: 'risks',
      icon: 'warning',
      label: '风险总数',
      value: risk.total,
      sub: `严重 ${stats.critical} · 高危 ${stats.high}`,
      tone: risk.total > 0 ? 'bad' : 'good',
    },
    {
      key: 'windows',
      icon: 'windows',
      label: 'Windows 脚本',
      value: stats.windowsScripts,
      sub: sections.windows.stats.windowsOnly ? '无跨平台等价入口' : '存在跨平台入口',
      tone: stats.windowsScripts > 0 ? 'warn' : 'good',
    },
    {
      key: 'paths',
      icon: 'path',
      label: '硬编码路径',
      value: stats.pathHits,
      sub: `分布在 ${stats.pathFiles} 个文件`,
      tone: stats.pathHits > 0 ? 'warn' : 'good',
    },
    {
      key: 'secrets',
      icon: 'key',
      label: '敏感信息',
      value: stats.secretHits,
      sub: `严重 ${sections.secrets.stats.critical} · 待复核 ${sections.secrets.stats.reviewNeeded}`,
      tone: sections.secrets.stats.critical > 0 ? 'bad' : stats.secretHits > 0 ? 'warn' : 'good',
    },
    {
      key: 'deps',
      icon: 'package',
      label: '依赖规模',
      value: stats.depsCount,
      sub: stats.ecosystems.join(' / ') || '未识别技术栈',
      tone: 'neutral',
    },
    {
      key: 'files',
      icon: 'doc',
      label: '扫描文件',
      value: stats.files,
      sub: `${formatBytes(stats.sizeBytes)} · 文本 ${stats.textFiles}`,
      tone: 'neutral',
    },
  ]

  return (
    <div className="overview">
      <section className="card score-card">
        <div className="score-main">
          <ScoreRing score={score.total} grade={score.grade} gradeLabel={score.gradeLabel} />
          <div className="score-copy">
            <div className="score-kicker">接入就绪度评分</div>
            <h3 className={`verdict ${scoreTone(score.total)}`}>{score.gradeLabel}</h3>
            <p className="verdict-text">{score.verdict}</p>
            {score.highlights?.length > 0 && (
              <ul className="highlights">
                {score.highlights.map((h) => (
                  <li key={h.label}>
                    <span className="hl-dot" />
                    <b>{h.label}</b>
                    <span>{h.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="score-side">
          <DimensionBars dimensions={score.dimensions} />
        </div>
      </section>

      <div className="kpi-grid">
        {kpis.map((k) => (
          <button key={k.key} type="button" className={`kpi ${k.tone}`} onClick={() => onJump(k.key)}>
            <span className="kpi-icon">
              <Icon name={k.icon} size={18} />
            </span>
            <span className="kpi-body">
              <span className="kpi-value">{k.value}</span>
              <span className="kpi-label">{k.label}</span>
              <span className="kpi-sub">{k.sub}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="two-col">
        <section className="card">
          <SectionHead
            title="主要风险"
            desc="优先级最高的前 5 项"
            right={
              <button type="button" className="link-btn" onClick={() => onJump('risks')}>
                查看全部 {risk.total} 项 <Icon name="arrow" size={14} />
              </button>
            }
          />
          <RiskList findings={risk.all} compact />
        </section>

        <section className="card">
          <SectionHead title="严重程度分布" desc="点击维度可查看明细" />
          <SeveritySummary counts={risk.counts} />
          <div className="mini-lists">
            <div className="mini-list">
              <h4>风险集中的维度</h4>
              {Object.entries(
                risk.all.reduce<Record<string, number>>((acc, f) => {
                  acc[f.dimension] = (acc[f.dimension] || 0) + 1
                  return acc
                }, {}),
              )
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([dim, count]) => (
                  <div className="mini-row" key={dim}>
                    <span>{dimensionLabel(dim)}</span>
                    <span className="mini-bar">
                      <i style={{ width: `${Math.min(100, (count / Math.max(1, risk.total)) * 100 * 3)}%` }} />
                    </span>
                    <b>{count}</b>
                  </div>
                ))}
              {risk.total === 0 && <Empty>未发现风险项</Empty>}
            </div>
          </div>
        </section>
      </div>

      <section className="card ai-teaser">
        <div className="ai-teaser-head">
          <span className="ai-badge">
            <Icon name="spark" size={15} /> AI 接入建议
          </span>
          <span className="muted small">{ai?.source === 'llm' ? `${ai.provider} · ${ai.model}` : '内置规则引擎生成（可配置大模型）'}</span>
        </div>
        <p className="ai-verdict">{ai?.verdict || '暂无建议'}</p>
        <button type="button" className="link-btn" onClick={() => onJump('ai')}>
          查看完整建议与接入步骤 <Icon name="arrow" size={14} />
        </button>
      </section>
    </div>
  )
}

function dimensionLabel(key: string) {
  const map: Record<string, string> = {
    docs: '文档完备度',
    deps: '依赖可复现',
    scripts: '启动脚本',
    portability: '跨平台友好',
    security: '密钥安全',
    hygiene: '工程规范',
  }
  return map[key] || key
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function WindowsTab({ report }: { report: Report }) {
  const { windows } = report.sections
  const { stats, scripts } = windows
  return (
    <section className="card">
      <SectionHead
        title="Windows 专用脚本"
        desc=".bat / .cmd / .ps1 / .vbs 在 macOS 与 Linux 上无法直接执行，是接入阻塞的高发点"
        right={
          <div className="head-badges">
            <span className="badge">共 {stats.total} 个</span>
            {stats.windowsOnly && <span className="badge warn">缺少跨平台等价脚本</span>}
          </div>
        }
      />
      {stats.total === 0 ? (
        <Empty>未发现 Windows 专用脚本 ✅</Empty>
      ) : (
        <>
          <div className="stat-chips">
            {Object.entries(stats.byExt).map(([ext, count]) => (
              <span key={ext} className="stat-chip">
                .{ext} × {count}
              </span>
            ))}
            <span className="stat-chip">README 引用 {stats.referencedCount} 个</span>
          </div>
          <Table head={['文件', '类型', '大小', 'README 引用', '跨平台等价', '首行内容']}>
            {scripts.map((s) => (
              <tr key={s.path}>
                <td>
                  <code className="mono">{s.path}</code>
                </td>
                <td>
                  <span className="tag">{s.ext}</span>
                </td>
                <td>{formatBytes(s.size)}</td>
                <td>{s.referencedInReadme ? <span className="yes">是</span> : <span className="no">否</span>}</td>
                <td>{s.hasUnixEquivalent ? <span className="yes">有</span> : <span className="no">无</span>}</td>
                <td className="clip">
                  <code className="mono">{s.firstLine || '—'}</code>
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <div className="sub-block">
        <h4>检查项</h4>
        <CheckList checks={windows.checks} />
      </div>
      {windows.findings.length > 0 && (
        <div className="sub-block">
          <h4>相关风险</h4>
          <RiskList findings={windows.findings} />
        </div>
      )}
    </section>
  )
}

function PathsTab({ report }: { report: Report }) {
  const { paths } = report.sections
  return (
    <section className="card">
      <SectionHead
        title="硬编码绝对路径"
        desc="盘符路径、/Users/、/home/、UNC 共享等，换机器即失效"
        right={<span className="badge">共 {paths.stats.total} 处</span>}
      />
      {paths.stats.total === 0 ? (
        <Empty>未发现硬编码路径 ✅</Empty>
      ) : (
        <>
          <div className="stat-chips">
            {paths.stats.byRule.map((r) => (
              <span key={r.id} className="stat-chip">
                {r.label} × {r.count}
              </span>
            ))}
          </div>
          <Table head={['文件:行', '命中内容', '规则', '级别']}>
            {paths.hits.slice(0, 80).map((h, i) => (
              <tr key={`${h.file}-${h.line}-${i}`}>
                <td>
                  <code className="mono">
                    {h.file}:{h.line}
                  </code>
                </td>
                <td className="clip">
                  <code className="mono hit">{h.match}</code>
                </td>
                <td>{h.ruleLabel}</td>
                <td>
                  <SeverityChip severity={h.severity} small />
                </td>
              </tr>
            ))}
          </Table>
          {paths.hits.length > 80 && <p className="muted small">仅展示前 80 条，共 {paths.hits.length} 条</p>}
        </>
      )}
      {paths.findings.length > 0 && (
        <div className="sub-block">
          <h4>按文件聚合</h4>
          <RiskList findings={paths.findings} />
        </div>
      )}
    </section>
  )
}

function SecretsTab({ report }: { report: Report }) {
  const { secrets } = report.sections
  return (
    <section className="card">
      <SectionHead
        title="密钥与敏感信息"
        desc="证据已脱敏展示；命中不代表一定泄露，请结合上下文复核"
        right={<span className="badge">共 {secrets.stats.total} 处</span>}
      />
      <div className="stat-chips">
        <span className="stat-chip">严重 {secrets.stats.critical}</span>
        <span className="stat-chip">高危 {secrets.stats.high}</span>
        <span className="stat-chip">待人工复核 {secrets.stats.reviewNeeded}</span>
        <span className="stat-chip">.env 入库 {secrets.stats.envFiles.length}</span>
        <span className="stat-chip">私钥/证书 {secrets.stats.secretFiles.length}</span>
      </div>
      {secrets.hits.length === 0 ? (
        <Empty>未发现敏感信息泄露 ✅</Empty>
      ) : (
        <Table head={['规则', '文件:行', '脱敏证据', '置信度', '级别']}>
          {secrets.hits.slice(0, 60).map((h, i) => (
            <tr key={`${h.file}-${h.line}-${i}`}>
              <td>{h.ruleLabel}</td>
              <td>
                <code className="mono">
                  {h.file}
                  {h.line ? `:${h.line}` : ''}
                </code>
              </td>
              <td className="clip">
                <code className="mono hit">{h.masked}</code>
              </td>
              <td>{h.confidence === 'high' ? '高' : h.confidence === 'medium' ? '中' : '低'}</td>
              <td>
                <SeverityChip severity={h.severity} small />
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className="sub-block">
        <h4>检查项</h4>
        <CheckList checks={secrets.checks} />
      </div>
      {secrets.findings.length > 0 && (
        <div className="sub-block">
          <h4>相关风险</h4>
          <RiskList findings={secrets.findings} />
        </div>
      )}
    </section>
  )
}

function DepsTab({ report }: { report: Report }) {
  const { deps, scripts } = report.sections
  return (
    <>
      <section className="card">
        <SectionHead title="依赖清单" desc="清单 + 锁文件是可复现安装的前提" />
        {deps.ecosystems.length === 0 ? (
          <Empty>未识别到依赖清单</Empty>
        ) : (
          <Table head={['生态', '依赖清单', '锁文件', '运行时依赖', '开发依赖', '未锁定']}>
            {deps.ecosystems.map((e) => (
              <tr key={e.id}>
                <td>
                  <b>{e.name}</b>
                </td>
                <td>
                  <code className="mono">{e.manifest}</code>
                </td>
                <td>
                  {e.lockfile ? <span className="yes">{e.lockfile}</span> : <span className="no">缺失</span>}
                </td>
                <td>{e.deps}</td>
                <td>{e.devDeps}</td>
                <td>{e.unpinned.length}</td>
              </tr>
            ))}
          </Table>
        )}
        <div className="sub-block">
          <h4>检查项</h4>
          <CheckList checks={deps.checks} />
        </div>
      </section>

      <section className="card">
        <SectionHead title="启动脚本" desc="新人能否找到一条明确的运行路径" />
        {scripts.entries.length === 0 ? (
          <Empty>未发现可执行入口</Empty>
        ) : (
          <Table head={['入口', '命令', '来源']}>
            {scripts.entries.map((e, i) => (
              <tr key={`${e.name}-${i}`}>
                <td>
                  <b>{e.name}</b>
                </td>
                <td className="clip">
                  <code className="mono">{e.command}</code>
                </td>
                <td>
                  <span className="tag">{e.source}</span>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="sub-block">
          <h4>检查项</h4>
          <CheckList checks={scripts.checks} />
        </div>
        {(deps.findings.length > 0 || scripts.findings.length > 0) && (
          <div className="sub-block">
            <h4>相关风险</h4>
            <RiskList findings={[...deps.findings, ...scripts.findings]} />
          </div>
        )}
      </section>
    </>
  )
}

function DocsTab({ report }: { report: Report }) {
  const { readme, hygiene } = report.sections
  const meta = readme.meta
  return (
    <>
      <section className="card">
        <SectionHead title="README 完整度" desc="安装、运行、环境、配置四件事是否讲清楚" />
        <div className="stat-chips">
          <span className="stat-chip">文件 {meta.path || '未找到'}</span>
          <span className="stat-chip">有效字符 {meta.chars}</span>
          <span className="stat-chip">标题 {meta.headings}</span>
          <span className="stat-chip">代码块 {meta.codeBlocks}</span>
          <span className="stat-chip">图片 {meta.images}</span>
          <span className="stat-chip">语言 {meta.language === 'zh' ? '中文' : '英文'}</span>
        </div>
        <div className="sub-block">
          <h4>章节覆盖</h4>
          <div className="section-tags">
            {Object.entries(meta.sections || {}).map(([key, ok]) => (
              <span key={key} className={`tag ${ok ? 'tag-ok' : 'tag-miss'}`}>
                {sectionLabel(key)} {ok ? '✓' : '✗'}
              </span>
            ))}
          </div>
        </div>
        <div className="sub-block">
          <h4>检查项</h4>
          <CheckList checks={readme.checks} />
        </div>
      </section>

      <section className="card">
        <SectionHead title="工程规范" desc=".gitignore / LICENSE / CI / 配置样例" />
        <Table head={['项目', '状态']}>
          {[
            ['gitignore', '.gitignore'],
            ['license', 'LICENSE'],
            ['ci', 'CI 配置'],
            ['envExample', '.env.example'],
            ['editorconfig', '.editorconfig'],
            ['lintConfig', 'Lint 配置'],
          ].map(([key, label]) => (
            <tr key={key}>
              <td>{label}</td>
              <td>
                {hygiene.meta[key] ? <span className="yes">{hygiene.meta[key]}</span> : <span className="no">缺失</span>}
              </td>
            </tr>
          ))}
        </Table>
        <div className="sub-block">
          <h4>检查项</h4>
          <CheckList checks={hygiene.checks} />
        </div>
        {[...readme.findings, ...hygiene.findings].length > 0 && (
          <div className="sub-block">
            <h4>相关风险</h4>
            <RiskList findings={[...readme.findings, ...hygiene.findings]} />
          </div>
        )}
      </section>
    </>
  )
}

function sectionLabel(key: string) {
  const map: Record<string, string> = {
    install: '安装',
    usage: '使用',
    env: '环境',
    config: '配置',
    screenshot: '截图',
    license: '许可证',
    contributing: '贡献',
    structure: '目录结构',
  }
  return map[key] || key
}

function AiTab({ report }: { report: Report }) {
  const ai = report.ai
  if (!ai) return <section className="card"><Empty>暂无 AI 建议</Empty></section>
  return (
    <section className="card ai-card">
      <SectionHead
        title="AI 接入建议"
        desc={ai.note || ''}
        right={
          <span className={`badge ${ai.source === 'llm' ? 'badge-ai' : ''}`}>
            <Icon name="spark" size={13} /> {ai.source === 'llm' ? `${ai.provider} · ${ai.model}` : '内置规则引擎'}
          </span>
        }
      />
      <blockquote className="ai-verdict-block">{ai.verdict}</blockquote>
      <p className="ai-summary">{ai.summary}</p>
      {ai.error && <p className="ai-error">大模型调用失败，已回退到内置建议：{ai.error}</p>}

      {ai.advice?.length > 0 && (
        <div className="ai-advice">
          {ai.advice.map((a, i) => (
            <div className="ai-advice-item" key={i}>
              <div className="ai-advice-head">
                <span className="ai-index">{String(i + 1).padStart(2, '0')}</span>
                <b>{a.title}</b>
                <SeverityChip severity={a.severity} small />
              </div>
              <p>{a.detail}</p>
              {a.action && (
                <p className="ai-action">
                  <span>建议动作</span>
                  {a.action}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {ai.steps?.length > 0 && (
        <div className="ai-steps">
          <h4>接入步骤</h4>
          <ol>
            {ai.steps.map((s, i) => (
              <li key={i}>
                <code className="mono">{s}</code>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}

function FilesTab({ report }: { report: Report }) {
  const { scan, stats } = report
  return (
    <section className="card">
      <SectionHead
        title="文件扫描"
        desc={`共扫描 ${stats.files} 个文件，已跳过 node_modules / dist / vendor 等目录${
          stats.ignored ? `；.repopulseignore 忽略 ${stats.ignored} 个文件` : ''
        }`}
      />
      <div className="stat-chips">
        {scan.dirs.map((d) => (
          <span key={d.name} className="stat-chip">
            {d.name} <b>{d.count}</b>
          </span>
        ))}
      </div>
      <Table head={['文件', '类型', '大小']}>
        {scan.files.slice(0, 150).map((f) => (
          <tr key={f.path}>
            <td>
              <code className="mono">{f.path}</code>
            </td>
            <td>
              <span className={`tag kind-${f.kind}`}>{f.kind}</span>
            </td>
            <td>{formatBytes(f.size)}</td>
          </tr>
        ))}
      </Table>
      {scan.files.length > 150 && <p className="muted small">仅展示前 150 个文件</p>}
    </section>
  )
}

export { scoreColor }
