/**
 * RepoPulse API 服务。
 *
 * 生产模式（npm start）：同时托管 dist/ 静态资源与 /api 接口，单端口即可演示。
 * 开发模式（npm run dev）：只提供 /api，前端由 Vite 提供并代理到这里。
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeRepository } from './lib/analyze.mjs'
import { aiProviderName } from './lib/ai.mjs'
import { BadInput, RepoAccessError } from './lib/util.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const DEMO_DIR = path.join(ROOT, 'demo', 'reports')
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const MAX_CONCURRENT = 2
const VERSION = '1.0.0'

/** 离线示例报告：预生成快照，断网也能看完整界面 */
let demoCache = null
async function loadDemoReports() {
  if (demoCache) return demoCache
  const { readdir, readFile } = await import('node:fs/promises')
  let names = []
  try {
    names = (await readdir(DEMO_DIR)).filter((n) => n.endsWith('.json'))
  } catch {
    names = []
  }
  const reports = {}
  for (const name of names) {
    try {
      const raw = await readFile(path.join(DEMO_DIR, name), 'utf8')
      const report = JSON.parse(raw)
      report.meta = { ...report.meta, demo: true }
      reports[name.replace(/\.json$/, '')] = report
    } catch {
      /* 跳过损坏的示例文件 */
    }
  }
  demoCache = reports
  return reports
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

let active = 0
const waiting = []

function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => waiting.push(resolve))
}

function release() {
  const next = waiting.shift()
  if (next) {
    next()
    return
  }
  active = Math.max(0, active - 1)
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(body)
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new BadInput('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new BadInput('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  const file = path.join(DIST, rel)
  if (!file.startsWith(DIST)) {
    res.writeHead(403)
    res.end('Forbidden')
    return true
  }
  try {
    const info = await stat(file)
    if (info.isFile()) {
      const ext = path.extname(file).toLowerCase()
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      })
      createReadStream(file).pipe(res)
      return true
    }
  } catch {
    /* fallthrough */
  }
  // SPA 回退
  try {
    const index = path.join(DIST, 'index.html')
    const info = await stat(index)
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': info.size, 'Cache-Control': 'no-cache' })
    createReadStream(index).pipe(res)
    return true
  } catch {
    return false
  }
}

const server = http.createServer(async (req, res) => {
  const started = Date.now()
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    })
    res.end()
    return
  }

  try {
    if (pathname === '/api/health') {
      json(res, 200, {
        ok: true,
        name: 'RepoPulse',
        version: VERSION,
        aiProvider: aiProviderName(),
        node: process.version,
        uptime: Math.round(process.uptime()),
      })
      return
    }

    if (pathname === '/api/cache' && req.method === 'GET') {
      const { cacheStats } = await import('./lib/repo.mjs')
      json(res, 200, await cacheStats())
      return
    }

    if (pathname === '/api/cache/clean' && req.method === 'POST') {
      const body = await readBody(req)
      const { clearCache } = await import('./lib/repo.mjs')
      const result = await clearCache({ includeReports: !!body?.includeReports })
      console.log(`[cache] 已清理，释放 ${(result.freedBytes / 1024 / 1024).toFixed(1)}MB`)
      json(res, 200, result)
      return
    }

    if (pathname === '/api/demo' && req.method === 'GET') {
      const reports = await loadDemoReports()
      const demos = Object.entries(reports).map(([id, r]) => ({
        id,
        slug: r.meta.repo.slug,
        score: r.score.total,
        grade: r.score.grade,
        gradeLabel: r.score.gradeLabel,
        commitShort: r.meta.commitShort,
        analyzedAt: r.meta.analyzedAt,
        riskTotal: r.risk.total,
        counts: r.risk.counts,
      }))
      json(res, 200, { demos })
      return
    }

    if (pathname.startsWith('/api/demo/') && req.method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/api/demo/'.length))
      const reports = await loadDemoReports()
      const report = reports[id]
      if (!report) {
        json(res, 404, { error: '示例报告不存在' })
        return
      }
      json(res, 200, report)
      return
    }

    if (pathname === '/api/check-update' && req.method === 'POST') {
      const body = await readBody(req)
      const { parseRepoUrl } = await import('./lib/util.mjs')
      const { resolveHead } = await import('./lib/repo.mjs')
      const repo = parseRepoUrl(body?.url)
      const head = await resolveHead(repo)
      json(res, 200, {
        latest: head.sha,
        latestShort: head.sha.slice(0, 8),
        branch: head.branch,
        hasUpdate: !body?.commit || head.sha !== body.commit,
      })
      return
    }

    if (pathname === '/api/analyze' && req.method === 'POST') {
      const body = await readBody(req)
      const target = body?.url
      if (!target) throw new BadInput('请提供仓库地址 url')
      await acquire()
      try {
        const report = await analyzeRepository(target, { refresh: !!body.refresh })
        report.meta.durationMs = Date.now() - started
        console.log(
          `[analyze] ${report.meta.repo.slug}@${report.meta.commitShort} score=${report.score.total} ` +
            `risks=${report.risk.total} ${report.meta.durationMs}ms cached=${report.meta.cached}`,
        )
        json(res, 200, report)
      } finally {
        release()
      }
      return
    }

    if (pathname === '/api/analyze' && req.method === 'GET') {
      json(res, 405, { error: '请使用 POST /api/analyze，body: {"url":"https://github.com/owner/repo"}' })
      return
    }

    if (pathname.startsWith('/api/')) {
      json(res, 404, { error: '接口不存在' })
      return
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const served = await serveStatic(req, res, pathname)
      if (served) return
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('前端资源未构建。开发模式请访问 Vite 端口，或先执行 npm run build。')
      return
    }

    json(res, 405, { error: '不支持的请求方法' })
  } catch (error) {
    const status = error instanceof BadInput ? 400 : error instanceof RepoAccessError ? 422 : 500
    if (status === 500) console.error('[error]', error)
    json(res, status, {
      error: error?.message || '分析失败',
      hint: error?.hint || (status === 500 ? '请查看服务端日志，或稍后重试。' : undefined),
    })
  }
})

server.requestTimeout = 300_000
server.headersTimeout = 60_000

server.listen(PORT, HOST, () => {
  console.log(`RepoPulse API 已启动: http://${HOST}:${PORT}`)
  console.log(`  AI 通道: ${aiProviderName() || '未配置（使用内置规则引擎）'}`)
  console.log(`  静态资源: ${DIST}`)
  // 启动时清理过期源码快照（默认 TTL 7 天）
  import('./lib/repo.mjs')
    .then(({ cleanupExpiredSources }) => cleanupExpiredSources())
    .then((result) => {
      if (result.removed > 0) {
        console.log(
          `  已清理 ${result.removed} 份过期源码快照（${(result.bytes / 1024 / 1024).toFixed(1)}MB，TTL ${result.ttlDays} 天）`,
        )
      }
    })
    .catch(() => {})
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n正在关闭服务…')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000)
  })
}
