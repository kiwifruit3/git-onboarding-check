/**
 * 仓库获取层。
 *
 * 设计取舍（见 README「更新跟踪」）：
 *  - 不依赖 GitHub REST API（匿名 60 次/小时，实测极易 403 限流）；
 *  - 用 `git ls-remote` 拿默认分支与 HEAD commit，再按 commit 下载源码包；
 *  - 源码包拿不到时回退到 `git clone --depth 1`；
 *  - 所有产物按 commit SHA 落到本地缓存目录，天然支持「同一 commit 不重算」。
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import net from 'node:net'
import { Readable, Transform } from 'node:stream'
import * as tarLib from 'tar'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { RepoAccessError, runCommand } from './util.mjs'

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
const CACHE_ROOT = process.env.CHECK_CACHE_DIR || path.join(process.cwd(), '.cache')
const SOURCE_TTL_DAYS = 7
const KEEP_SOURCES_PER_REPO = 4

export function cacheRoot() {
  return CACHE_ROOT
}

async function git(args, { timeout = 60_000 } = {}) {
  return runCommand('git', args, { timeout })
}

function looksLikeProxyFailure(text) {
  return /127\.0\.0\.1|proxy|ECONNREFUSED|Could not connect|Failed to connect/i.test(text || '')
}

function tcpProbe(host, port, timeout = 400) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function probeProxyUrl(value) {
  if (!value) return false
  try {
    const u = new URL(value.includes('://') ? value : `http://${value}`)
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
    return await tcpProbe(u.hostname, port, 350)
  } catch {
    return false
  }
}

/** 读取 Windows 系统代理（WinINET），很多公司网络只在这个位置配置了可用代理 */
async function readSystemProxy() {
  if (process.platform !== 'win32') return null
  const res = await runCommand(
    'reg',
    ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'],
    { timeout: 4_000 },
  )
  if (res.code !== 0) return null
  const m = res.stdout.match(/ProxyServer\s+REG_SZ\s+(\S+)/)
  if (!m) return null
  const parts = m[1].split(';')
  const picked =
    parts.find((p) => p.startsWith('https=')) || parts.find((p) => p.startsWith('http=')) || parts[0]
  const addr = picked.replace(/^https?=/, '')
  return /^[\w.-]+:\d+$/.test(addr) ? `http://${addr}` : null
}

/**
 * 选择可用的 git 代理。
 * 实测环境里经常出现：git 全局配置了一个已经失效的 127.0.0.1 代理，
 * 而系统代理（Clash 等）才是真正可用的。这里按「环境变量 → git config → 系统代理 → 直连」探测。
 */
let proxyPromise = null
export function getProxyChoice() {
  if (!proxyPromise) {
    proxyPromise = (async () => {
      if (process.env.REPOPULSE_NO_PROXY === '1') return { url: '', source: 'direct(env)' }
      const candidates = []
      const envProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
      if (envProxy) candidates.push({ url: envProxy, source: 'env' })
      if (process.env.REPOPULSE_PROXY) candidates.push({ url: process.env.REPOPULSE_PROXY, source: 'env' })
      const cfg = await git(['config', '--get', 'http.proxy'], { timeout: 4_000 })
      if (cfg.stdout.trim()) candidates.push({ url: cfg.stdout.trim(), source: 'git-config' })
      const sys = await readSystemProxy()
      if (sys) candidates.push({ url: sys, source: 'system' })
      for (const candidate of candidates) {
        if (await probeProxyUrl(candidate.url)) return candidate
      }
      return { url: '', source: 'direct' }
    })()
  }
  return proxyPromise
}

function proxyArgs(proxyUrl) {
  if (proxyUrl) return ['-c', `http.proxy=${proxyUrl}`, '-c', `https.proxy=${proxyUrl}`]
  return ['-c', 'http.proxy=', '-c', 'https.proxy=']
}

/** 使用选定的代理执行 git；失败时换另一种模式再试一次。 */
async function gitWithProxyFallback(args, opts) {
  const proxy = await getProxyChoice()
  const primary = await git([...proxyArgs(proxy.url), ...args], opts)
  if (primary.code === 0) return { ...primary, via: proxy.source }
  const fallbackArgs = proxy.url ? args : [...proxyArgs(''), ...args]
  const fallback = await git(fallbackArgs, opts)
  return { ...fallback, via: proxy.url ? 'direct' : proxy.source }
}

/**
 * 解析仓库当前 HEAD。
 * @returns {{sha: string, branch: string, via: string}}
 */
export async function resolveHead(repo) {
  const res = await gitWithProxyFallback(['ls-remote', '--symref', repo.cloneUrl, 'HEAD'], { timeout: 25_000 })
  if (res.code !== 0) {
    const apiResult = await resolveHeadViaApi(repo)
    if (apiResult) return apiResult
    const proxy = await getProxyChoice()
    const hint = /not found|does not exist|repository .* not found|Repository not found/i.test(res.stderr)
      ? '仓库不存在或不是公开仓库（本工具只支持公开仓库）。'
      : `无法连接代码托管平台（当前代理策略：${proxy.source}${proxy.url ? ` ${proxy.url}` : ''}）。` +
        '请检查网络，或用 REPOPULSE_PROXY=http://127.0.0.1:7890 指定可用代理。'
    throw new RepoAccessError('读取仓库 HEAD 失败', hint)
  }

  const lines = res.stdout.split(/\r?\n/).filter(Boolean)
  let branch = ''
  let sha = ''
  for (const line of lines) {
    const ref = line.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/)
    if (ref) branch = ref[1]
    const head = line.match(/^([0-9a-f]{40})\s+HEAD$/)
    if (head) sha = head[1]
  }
  if (!sha) throw new RepoAccessError('仓库为空或 HEAD 无法解析', '请确认仓库至少有一次提交。')
  return { sha, branch: branch || 'HEAD', via: `ls-remote(${res.via})` }
}

/** 兜底：带 token 时走 GitHub API（匿名时通常已被限流，故不作为首选）。 */
async function resolveHeadViaApi(repo) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!token || repo.provider !== 'github') return null
  const headers = { 'User-Agent': 'repo-pulse', Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` }
  try {
    const metaRes = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    })
    if (!metaRes.ok) return null
    const meta = await metaRes.json()
    const commitRes = await fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(meta.default_branch)}`,
      { headers, signal: AbortSignal.timeout(15_000) },
    )
    if (!commitRes.ok) return null
    const commit = await commitRes.json()
    return { sha: commit.sha, branch: meta.default_branch, via: 'github-api' }
  } catch {
    return null
  }
}

function archiveUrl(repo, sha) {
  if (repo.provider === 'github') return `https://codeload.github.com/${repo.owner}/${repo.repo}/tar.gz/${sha}`
  if (repo.provider === 'gitlab') return `https://${repo.host}/${repo.owner}/${repo.repo}/-/archive/${sha}/${repo.repo}-${sha}.tar.gz`
  if (repo.provider === 'gitee') return `https://${repo.host}/${repo.owner}/${repo.repo}/repository/archive/${sha}.tar.gz`
  return null
}

export function sourceDirFor(repo, sha) {
  const safe = `${repo.provider}-${repo.owner.replace(/\//g, '~')}-${repo.repo}-${sha.slice(0, 12)}`.replace(
    /[^\w.~-]/g,
    '_',
  )
  return path.join(CACHE_ROOT, 'src', safe)
}

export function reportPathFor(repo, sha) {
  const safe = `${repo.provider}-${repo.owner.replace(/\//g, '~')}-${repo.repo}-${sha}`.replace(/[^\w.~-]/g, '_')
  return path.join(CACHE_ROOT, 'reports', `${safe}.json`)
}

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** 清掉同一仓库的旧源码目录，只保留最近 N 份，避免磁盘膨胀。 */
async function pruneSources(repo) {
  const dir = path.join(CACHE_ROOT, 'src')
  const prefix = `${repo.provider}-${repo.owner.replace(/\//g, '~')}-${repo.repo}-`.replace(/[^\w.~-]/g, '_')
  let entries
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  const mine = []
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue
    const full = path.join(dir, name)
    try {
      const info = await stat(full)
      mine.push({ full, mtime: info.mtimeMs })
    } catch {}
  }
  mine.sort((a, b) => b.mtime - a.mtime)
  for (const stale of mine.slice(KEEP_SOURCES_PER_REPO)) {
    await rm(stale.full, { recursive: true, force: true }).catch(() => {})
  }
}

async function downloadViaFetch(url, file) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'repo-pulse', Accept: '*/*' },
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`下载源码包失败 HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > MAX_ARCHIVE_BYTES) throw new Error(`仓库过大（${(declared / 1024 / 1024).toFixed(1)}MB），已跳过`)

  let received = 0
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length
      if (received > MAX_ARCHIVE_BYTES) {
        cb(new Error('仓库体积超出限制'))
        return
      }
      cb(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(res.body), counter, createWriteStream(file))
  return received
}

async function downloadViaCurl(url, file, proxyUrl) {
  const res = await runCommand(
    'curl',
    ['-L', '--silent', '--show-error', '--max-time', '150', '--proxy', proxyUrl, '-o', file, url],
    { timeout: 170_000 },
  )
  if (res.code !== 0) throw new Error(`下载源码包失败（curl）：${res.stderr.slice(0, 200)}`)
  const info = await stat(file)
  if (!info.size) throw new Error('下载的源码包为空')
  if (info.size > MAX_ARCHIVE_BYTES) throw new Error('仓库体积超出限制')
  return info.size
}

async function downloadArchive(url, file) {
  try {
    return await downloadViaFetch(url, file)
  } catch (fetchError) {
    const proxy = await getProxyChoice()
    if (!proxy.url) throw fetchError
    return downloadViaCurl(url, file, proxy.url)
  }
}

/**
 * 解压前先检查条目，拒绝绝对路径、../ 穿越与符号链接；
 * 使用纯 JS 的 tar 实现，避免 Windows 自带 bsdtar 在中文/emoji 文件名上失败。
 */
async function safeExtract(archive, dest) {
  const entries = []
  await tarLib.t({
    file: archive,
    onentry: (entry) => {
      entries.push({ path: entry.path, type: entry.type })
    },
  })
  const skipped = new Set()
  for (const entry of entries) {
    const p = entry.path
    if (!p || p.startsWith('/') || p.startsWith('\\') || p.includes('..') || /^[A-Za-z]:/.test(p)) {
      throw new Error('源码包包含非法路径，已中止解压')
    }
    if (entry.type === 'SymbolicLink' || entry.type === 'Link') skipped.add(p)
  }
  await mkdir(dest, { recursive: true })
  await tarLib.x({
    file: archive,
    cwd: dest,
    strip: 1,
    filter: (p) => !skipped.has(p) && !p.split('/').includes('..'),
  })
  return entries.length
}

async function fetchViaArchive(repo, sha, dest) {
  const url = archiveUrl(repo, sha)
  if (!url) throw new Error('该托管平台不支持源码包直下')
  await mkdir(dest, { recursive: true })
  const archive = path.join(CACHE_ROOT, 'tmp', `${Date.now()}-${Math.random().toString(16).slice(2)}.tar.gz`)
  await mkdir(path.dirname(archive), { recursive: true })
  try {
    const bytes = await downloadArchive(url, archive)
    await safeExtract(archive, dest)
    return { strategy: 'archive', bytes, url }
  } finally {
    await rm(archive, { force: true }).catch(() => {})
  }
}

async function fetchViaClone(repo, dest) {
  await mkdir(path.dirname(dest), { recursive: true })
  const res = await gitWithProxyFallback(
    ['clone', '--depth', '1', '--single-branch', '--no-tags', repo.cloneUrl, dest],
    { timeout: 180_000 },
  )
  if (res.code !== 0) throw new Error(`git clone 失败：${res.stderr.split('\n').slice(-3).join(' ').slice(0, 300)}`)
  await rm(path.join(dest, '.git'), { recursive: true, force: true }).catch(() => {})
  return { strategy: 'clone', bytes: 0 }
}

/**
 * 确保 commit 对应的源码已落地，返回目录与获取方式。
 */
export async function ensureSource(repo, sha) {
  const dest = sourceDirFor(repo, sha)
  if (await exists(path.join(dest, '.ready'))) {
    return { dir: dest, strategy: 'cache', cached: true }
  }
  await rm(dest, { recursive: true, force: true }).catch(() => {})

  let result
  try {
    result = await fetchViaArchive(repo, sha, dest)
  } catch (archiveError) {
    await rm(dest, { recursive: true, force: true }).catch(() => {})
    try {
      result = await fetchViaClone(repo, dest)
    } catch (cloneError) {
      throw new RepoAccessError(
        '获取仓库源码失败',
        `源码包：${archiveError.message}；克隆：${cloneError.message}。请确认仓库为公开仓库且网络可达。`,
      )
    }
  }

  await mkdir(dest, { recursive: true })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path.join(dest, '.ready'), String(Date.now()), 'utf8')
  pruneSources(repo).catch(() => {})
  return { dir: dest, strategy: result.strategy, bytes: result.bytes || 0, cached: false }
}

export async function readCachedReport(repo, sha) {
  const file = reportPathFor(repo, sha)
  if (!(await exists(file))) return null
  try {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function writeCachedReport(repo, sha, report) {
  const file = reportPathFor(repo, sha)
  await mkdir(path.dirname(file), { recursive: true })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(file, JSON.stringify(report), 'utf8')
}

export { SOURCE_TTL_DAYS }
