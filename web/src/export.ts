import type { Report, Severity } from './types'

const SEV_LABEL: Record<Severity, string> = {
  critical: '严重',
  high: '高危',
  medium: '中危',
  low: '低危',
  info: '提示',
}

function pct(n: number) {
  return `${n}%`
}

export function reportToMarkdown(r: Report): string {
  const { meta, score, risk, sections, stats, ai } = r
  const lines: string[] = []
  const push = (...s: string[]) => lines.push(...s)

  push(`# 仓库接入体检报告 · ${meta.repo.slug}`, '')
  push(`> 由 RepoPulse v${meta.scanner.version} 生成 · 基于 commit \`${meta.commit}\`（分支 ${meta.branch}）`, '')
  push('| 项目 | 值 |', '| --- | --- |')
  push(`| 仓库 | [${meta.repo.slug}](${meta.repo.webUrl}) |`)
  push(`| Commit | [${meta.commitShort}](${meta.commitUrl}) |`)
  push(`| 分析时间 | ${new Date(meta.analyzedAt).toLocaleString('zh-CN', { hour12: false })} |`)
  push(`| 扫描文件 | ${stats.files} 个（文本 ${stats.textFiles}，${(stats.sizeBytes / 1024).toFixed(0)} KB） |`)
  push(`| 接入就绪度 | **${score.total}/100 · ${score.grade} ${score.gradeLabel}** |`)
  push('')

  push('## 评分维度', '', '| 维度 | 得分 | 权重 |', '| --- | ---: | ---: |')
  for (const d of score.dimensions) push(`| ${d.label} | ${d.score} | ${pct(d.weight)} |`)
  push('')

  push('## 风险概览', '')
  push(
    `严重 ${risk.counts.critical} · 高危 ${risk.counts.high} · 中危 ${risk.counts.medium} · 低危 ${risk.counts.low} · 提示 ${risk.counts.info}`,
    '',
  )
  push('| # | 级别 | 问题 | 位置 | 建议 |', '| ---: | --- | --- | --- | --- |')
  risk.all.slice(0, 30).forEach((f, i) => {
    const pos = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '—'
    push(`| ${i + 1} | ${SEV_LABEL[f.severity]} | ${f.title} | \`${pos}\` | ${f.suggestion.replace(/\n/g, ' ')} |`)
  })
  if (risk.all.length > 30) push('', `> 仅列出前 30 项，完整清单共 ${risk.all.length} 项。`)
  push('')

  if (sections.windows.stats.total > 0) {
    push('## Windows 专用脚本', '', '| 文件 | 类型 | README 引用 | 跨平台等价 |', '| --- | --- | --- | --- |')
    for (const s of sections.windows.scripts) {
      push(`| \`${s.path}\` | .${s.ext} | ${s.referencedInReadme ? '是' : '否'} | ${s.hasUnixEquivalent ? '有' : '无'} |`)
    }
    push('')
  }

  if (sections.paths.stats.total > 0) {
    push('## 硬编码路径（按规则统计）', '')
    for (const rule of sections.paths.stats.byRule) push(`- ${rule.label}：${rule.count} 处`)
    push('')
  }

  if (sections.secrets.stats.total > 0) {
    push('## 敏感信息（证据已脱敏）', '', '| 规则 | 文件 | 置信度 |', '| --- | --- | --- |')
    for (const h of sections.secrets.hits.slice(0, 20)) {
      push(`| ${h.ruleLabel} | \`${h.file}${h.line ? `:${h.line}` : ''}\` | ${h.confidence} |`)
    }
    push('')
  }

  push('## 依赖与启动', '')
  if (sections.deps.ecosystems.length) {
    push('| 生态 | 清单 | 锁文件 | 依赖数 |', '| --- | --- | --- | ---: |')
    for (const e of sections.deps.ecosystems) {
      push(`| ${e.name} | \`${e.manifest}\` | ${e.lockfile ? `\`${e.lockfile}\`` : '缺失'} | ${e.deps + e.devDeps} |`)
    }
  } else {
    push('未识别到依赖清单。')
  }
  push('')
  if (sections.scripts.entries.length) {
    push('启动入口：')
    for (const e of sections.scripts.entries.slice(0, 10)) push(`- \`${e.command}\`（${e.source}）`)
    push('')
  }

  if (ai) {
    push('## AI 接入建议', '', `**${ai.verdict}**`, '', ai.summary, '')
    ai.advice?.forEach((a, i) => push(`${i + 1}. **${a.title}**（${SEV_LABEL[a.severity]}）：${a.detail}`, a.action ? `   - 建议动作：${a.action}` : ''))
    if (ai.steps?.length) {
      push('', '接入步骤：')
      ai.steps.forEach((s, i) => push(`${i + 1}. \`${s}\``))
    }
    push('')
  }

  push('---', '', `> 报告基于 commit \`${meta.commit}\` 的静态扫描生成。规则命中不代表一定存在问题，请结合业务上下文复核。`)
  return lines.join('\n')
}

export function downloadFile(filename: string, content: string, type = 'text/markdown;charset=utf-8') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
