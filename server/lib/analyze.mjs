/**
 * 分析编排：仓库 → 源码 → 文件集 → 六类规则 → 评分 → 风险清单 → AI 建议。
 */
import { generateAiAdvice } from './ai.mjs'
import { ensureSource, findLatestCachedReport, readCachedReport, resolveHead, writeCachedReport } from './repo.mjs'
import { analyzeDeps } from './rules/deps.mjs'
import { analyzeHygiene } from './rules/hygiene.mjs'
import { analyzePaths } from './rules/paths.mjs'
import { analyzeReadme } from './rules/readme.mjs'
import { analyzeScripts } from './rules/scripts.mjs'
import { analyzeSecrets } from './rules/secrets.mjs'
import { analyzeWindows } from './rules/windows.mjs'
import { buildHighlights, computeScore } from './score.mjs'
import { parseRepoUrl, SEVERITY_ORDER } from './util.mjs'
import { collectFiles } from './walk.mjs'

export const SCHEMA_VERSION = 7
const MAX_RISK_ITEMS = 120

function pickRootPackageJson(files) {
  const file = files.find((f) => !f.path.includes('/') && /^package\.json$/i.test(f.name))
  if (!file?.text) return { path: null, json: null }
  try {
    return { path: file.path, json: JSON.parse(file.text) }
  } catch {
    return { path: file.path, json: null }
  }
}

function pickReadmeText(files) {
  const file =
    files.find((f) => !f.path.includes('/') && /^readme\.(md|markdown|mdx|rst|txt|adoc)$/i.test(f.name)) ||
    files.find((f) => !f.path.includes('/') && /^readme$/i.test(f.name))
  return { path: file?.path || null, text: file?.text || '' }
}

function buildDirSummary(files) {
  const map = new Map()
  for (const f of files) {
    const top = f.path.includes('/') ? f.path.split('/')[0] : '(根目录)'
    map.set(top, (map.get(top) || 0) + 1)
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
}

function dedupeFindings(findings) {
  const seen = new Set()
  const out = []
  for (const f of findings) {
    const key = `${f.dimension}|${f.title}|${f.file}|${f.line}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

/** 网络失败时，用历史缓存报告兜底，并明确标注「可能不是最新」 */
function staleReport(cached, error, repo) {
  const reason = [error?.message, error?.hint].filter(Boolean).join('：')
  return {
    ...cached,
    meta: {
      ...cached.meta,
      cached: true,
      stale: true,
      staleReason: reason || '网络异常，已回退到最近一次缓存报告',
      requestedAt: new Date().toISOString(),
      requestRepo: repo.slug,
    },
  }
}

export async function analyzeRepository(input, { refresh = false, withAi = true } = {}) {
  const startedAt = Date.now()
  const repo = parseRepoUrl(input)

  let head
  try {
    head = await resolveHead(repo)
  } catch (error) {
    const stale = await findLatestCachedReport(repo)
    if (stale) return staleReport(stale, error, repo)
    throw error
  }

  if (!refresh) {
    const cached = await readCachedReport(repo, head.sha)
    if (cached && cached.schemaVersion === SCHEMA_VERSION) {
      return {
        ...cached,
        meta: { ...cached.meta, cached: true, analyzedAt: cached.meta.analyzedAt },
      }
    }
  }

  let source
  try {
    source = await ensureSource(repo, head.sha)
  } catch (error) {
    const sameCommit = await readCachedReport(repo, head.sha)
    if (sameCommit && sameCommit.schemaVersion === SCHEMA_VERSION) return staleReport(sameCommit, error, repo)
    const stale = await findLatestCachedReport(repo)
    if (stale) return staleReport(stale, error, repo)
    throw error
  }
  const { files, stats } = await collectFiles(source.dir)

  const pkg = pickRootPackageJson(files)
  const readme = pickReadmeText(files)

  // 库（SDK/工具包）没有 start/dev 脚本是正常的，不能按「应用」的标准扣分。
  const pkgJson = pkg.json
  const hasIndexEntry = files.some(
    (f) => f.path === 'index.js' || f.path === 'lib/index.js' || f.path === 'src/index.js',
  )
  const isLibrary = !!(
    pkgJson &&
    !pkgJson.private &&
    !pkgJson.bin &&
    !pkgJson.scripts?.start &&
    !pkgJson.scripts?.dev &&
    !pkgJson.scripts?.serve &&
    (pkgJson.main ||
      pkgJson.exports ||
      pkgJson.module ||
      pkgJson.types ||
      Array.isArray(pkgJson.files) ||
      hasIndexEntry)
  )

  const ctx = {
    repo,
    files,
    stats,
    packageJson: pkg.json,
    packageJsonPath: pkg.path,
    readmeText: readme.text,
    readmePath: readme.path,
    isLibrary,
  }

  const readmeResult = analyzeReadme(ctx)
  const depsResult = analyzeDeps(ctx)
  const scriptsResult = analyzeScripts(ctx)
  const windowsResult = analyzeWindows(ctx)
  const pathsResult = analyzePaths(ctx)
  const secretsResult = analyzeSecrets(ctx)
  const hygieneResult = analyzeHygiene(ctx)

  const portabilityScore = Math.round(windowsResult.score * 0.45 + pathsResult.score * 0.55)
  const parts = {
    docs: readmeResult.score,
    deps: depsResult.score,
    scripts: scriptsResult.score,
    portability: portabilityScore,
    security: secretsResult.score,
    hygiene: hygieneResult.score,
  }
  const score = computeScore(parts)

  const rawFindings = dedupeFindings([
    ...readmeResult.findings,
    ...depsResult.findings,
    ...scriptsResult.findings,
    ...windowsResult.findings,
    ...pathsResult.findings,
    ...secretsResult.findings,
    ...hygieneResult.findings,
  ]).sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))

  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const f of rawFindings) counts[f.severity] = (counts[f.severity] || 0) + 1

  const allRisks = rawFindings.slice(0, MAX_RISK_ITEMS)
  const depsCount = (depsResult.ecosystems || []).reduce((n, e) => n + (e.deps || 0) + (e.devDeps || 0), 0)

  const report = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      repo: {
        owner: repo.owner,
        name: repo.repo,
        slug: repo.slug,
        host: repo.host,
        provider: repo.provider,
        webUrl: repo.webUrl,
        cloneUrl: repo.cloneUrl,
      },
      branch: head.branch,
      commit: head.sha,
      commitShort: head.sha.slice(0, 8),
      commitUrl: repo.provider === 'github' ? `${repo.webUrl}/commit/${head.sha}` : repo.webUrl,
      analyzedAt: new Date().toISOString(),
      durationMs: 0,
      source: { strategy: source.strategy, cached: !!source.cached, via: head.via },
      cached: false,
      scanner: { name: 'RepoPulse', version: '1.0.0', schemaVersion: SCHEMA_VERSION },
    },
    score: { ...score, highlights: buildHighlights(parts, rawFindings) },
    stats: {
      files: stats.totalFiles,
      textFiles: stats.textFiles,
      sizeBytes: stats.totalBytes,
      truncated: stats.truncated,
      skippedDirs: stats.skippedDirs,
      readmeChars: readmeResult.meta.chars,
      depsCount,
      ecosystems: (depsResult.ecosystems || []).map((e) => e.name),
      windowsScripts: windowsResult.stats.total,
      pathHits: pathsResult.stats.total,
      pathFiles: pathsResult.stats.files,
      secretHits: secretsResult.stats.total,
      critical: counts.critical,
      high: counts.high,
      medium: counts.medium,
      low: counts.low,
      riskTotal: rawFindings.length,
    },
    risk: {
      counts,
      total: rawFindings.length,
      top: allRisks.slice(0, 12),
      all: allRisks,
    },
    sections: {
      readme: readmeResult,
      deps: depsResult,
      scripts: scriptsResult,
      windows: windowsResult,
      paths: pathsResult,
      secrets: secretsResult,
      hygiene: hygieneResult,
    },
    scan: {
      dirs: buildDirSummary(files),
      files: files.slice(0, 600).map((f) => ({ path: f.path, kind: f.kind, size: f.size })),
    },
    ai: null,
  }

  report.meta.durationMs = Date.now() - startedAt
  report.ai = withAi
    ? await generateAiAdvice(report)
    : { enabled: false, source: 'disabled', provider: 'none', note: '本次未生成 AI 建议' }

  await writeCachedReport(repo, head.sha, report).catch(() => {})
  return report
}

export async function getCachedOnly(input) {
  const repo = parseRepoUrl(input)
  const head = await resolveHead(repo)
  const cached = await readCachedReport(repo, head.sha)
  return cached && cached.schemaVersion === SCHEMA_VERSION ? cached : null
}
