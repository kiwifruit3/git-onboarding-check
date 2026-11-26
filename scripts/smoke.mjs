#!/usr/bin/env node
/**
 * 命令行体检（也用于开发期回归）：
 *   node scripts/smoke.mjs https://github.com/owner/repo [--refresh] [--json]
 */
import path from 'node:path'
import { loadDotEnv } from '../server/lib/env.mjs'
import { analyzeRepository } from '../server/lib/analyze.mjs'

loadDotEnv(path.resolve(process.cwd(), '.env'))

const args = process.argv.slice(2)
const url = args.find((a) => !a.startsWith('--'))
const refresh = args.includes('--refresh')
const asJson = args.includes('--json')

if (!url) {
  console.error('用法: node scripts/smoke.mjs <仓库地址> [--refresh] [--json]')
  process.exit(1)
}

const started = Date.now()
try {
  const report = await analyzeRepository(url, { refresh })
  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    const { meta, score, stats, risk } = report
    console.log(`\n仓库   ${meta.repo.slug}`)
    console.log(`分支   ${meta.branch}  提交 ${meta.commitShort}  来源 ${meta.source.strategy}${meta.cached ? ' (缓存)' : ''}`)
    console.log(`文件   ${stats.files} 个（文本 ${stats.textFiles}）  体积 ${(stats.sizeBytes / 1024).toFixed(0)} KB`)
    console.log(`耗时   ${Date.now() - started}ms\n`)
    console.log(`就绪度 ${score.total}/100  等级 ${score.grade} ${score.gradeLabel}`)
    for (const d of score.dimensions) {
      console.log(`  ${d.label.padEnd(6, '　')} ${String(d.score).padStart(3)}  ×${String(d.weight).padStart(2)}%`)
    }
    console.log(`\n风险   ${risk.total} 项（严重 ${risk.counts.critical} / 高危 ${risk.counts.high} / 中危 ${risk.counts.medium} / 低危 ${risk.counts.low}）`)
    for (const item of risk.top.slice(0, 8)) {
      console.log(`  [${item.severity}] ${item.title} ${item.file ? `— ${item.file}${item.line ? ':' + item.line : ''}` : ''}`)
    }
    console.log('')
  }
} catch (error) {
  console.error('分析失败:', error.message)
  if (error.hint) console.error('提示:', error.hint)
  process.exit(1)
}
