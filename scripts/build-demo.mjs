#!/usr/bin/env node
/**
 * 生成离线示例报告（demo/reports/*.json）。
 *
 * 用途：评审 / 用户没有梯子、或 GitHub 临时不可达时，页面仍能一键打开完整报告，
 * 保证「零网络也能看到全部功能」。
 *
 *   node scripts/build-demo.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { analyzeRepository } from '../server/lib/analyze.mjs'

const REPOS = [
  { id: 'express', url: 'https://github.com/expressjs/express' },
  { id: 'redis-windows', url: 'https://github.com/redis-windows/redis-windows' },
  { id: 'leaky-repo', url: 'https://github.com/Plazmaz/leaky-repo' },
]

const outDir = path.join(process.cwd(), 'demo', 'reports')
await mkdir(outDir, { recursive: true })

for (const item of REPOS) {
  process.stdout.write(`生成 ${item.id} … `)
  const report = await analyzeRepository(item.url, { refresh: true })
  // 控制体积：文件清单与命中明细各截断一部分，统计值保持完整
  report.scan.files = report.scan.files.slice(0, 200)
  report.sections.paths.hits = report.sections.paths.hits.slice(0, 200)
  report.sections.secrets.hits = report.sections.secrets.hits.slice(0, 80)
  report.meta.demo = true
  report.meta.demoNote = '离线示例报告：预生成快照，不会实时更新'
  const json = JSON.stringify(report)
  await writeFile(path.join(outDir, `${item.id}.json`), json, 'utf8')
  console.log(`✓ score=${report.score.total} ${report.score.grade} commit=${report.meta.commitShort} ${(json.length / 1024).toFixed(0)}KB`)
}
console.log('\n完成，输出目录：demo/reports')
