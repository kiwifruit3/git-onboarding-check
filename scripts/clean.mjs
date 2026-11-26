#!/usr/bin/env node
/**
 * 清理本地缓存。
 *
 *   node scripts/clean.mjs          # 只删源码快照与临时文件（报告保留，仍可离线查看）
 *   node scripts/clean.mjs --all    # 连报告一起删（完全清空）
 */
import { cacheStats, clearCache } from '../server/lib/repo.mjs'

const includeReports = process.argv.includes('--all')
const before = await cacheStats()

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`
console.log(`缓存目录：${before.dir}`)
console.log(
  `清理前：源码快照 ${before.sources} 份（${mb(before.srcBytes)}），报告 ${before.reports} 份（${(before.reportBytes / 1024).toFixed(0)} KB）`,
)

const result = await clearCache({ includeReports })
console.log(`已释放：${mb(result.freedBytes)}${includeReports ? '（含报告）' : '（报告保留，仍可离线查看）'}`)
console.log(`清理后：源码快照 ${result.after.sources} 份，报告 ${result.after.reports} 份`)
