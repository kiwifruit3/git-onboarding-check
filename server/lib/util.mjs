/**
 * 通用工具：仓库地址解析、进程调用、脱敏、熵计算。
 */
import { spawn } from 'node:child_process'

export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
export const SEVERITY_LABEL = { critical: '严重', high: '高危', medium: '中危', low: '低危', info: '提示' }

export class BadInput extends Error {
  constructor(message) {
    super(message)
    this.name = 'BadInput'
    this.statusCode = 400
  }
}

export class RepoAccessError extends Error {
  constructor(message, hint = '') {
    super(message)
    this.name = 'RepoAccessError'
    this.statusCode = 422
    this.hint = hint
  }
}

function buildRepo(host, owner, repo, cloneUrl) {
  const provider = /github\./i.test(host)
    ? 'github'
    : /gitlab\./i.test(host)
      ? 'gitlab'
      : /gitee\./i.test(host)
        ? 'gitee'
        : 'generic'
  return {
    host,
    owner,
    repo,
    provider,
    cloneUrl,
    webUrl: `https://${host}/${owner}/${repo}`,
    slug: `${owner}/${repo}`,
  }
}

/**
 * 解析用户输入，支持：
 *   https://github.com/owner/repo(.git)
 *   git@github.com:owner/repo.git
 *   owner/repo（默认 GitHub）
 *   GitLab 多级 namespace
 */
export function parseRepoUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new BadInput('请输入一个公开仓库地址')
  let s = raw.trim()
  if (s.length > 500) throw new BadInput('仓库地址过长')

  if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = `https://github.com/${s}`

  const scp = s.match(/^git@([\w.-]+):(.+?)(?:\.git)?$/)
  if (scp) {
    const segs = scp[2].split('/').filter(Boolean)
    if (segs.length < 2) throw new BadInput('地址中缺少 owner/repo')
    const owner = segs.slice(0, -1).join('/')
    const repo = segs[segs.length - 1].replace(/\.git$/i, '')
    return buildRepo(scp[1].toLowerCase(), owner, repo, `git@${scp[1]}:${owner}/${repo}.git`)
  }

  let u
  try {
    u = new URL(s)
  } catch {
    throw new BadInput('无法识别的地址，示例：https://github.com/owner/repo')
  }
  if (!/^https?:$/.test(u.protocol)) throw new BadInput('仅支持 http(s) 或 git@ 形式的仓库地址')

  const host = u.hostname.toLowerCase()
  const segs = u.pathname.split('/').filter(Boolean).map((x) => decodeURIComponent(x))
  if (segs.length < 2) throw new BadInput('地址中缺少 owner/repo，示例：https://github.com/owner/repo')

  let owner
  let repo
  if (/gitlab/i.test(host) && segs.length > 2) {
    owner = segs.slice(0, -1).join('/')
    repo = segs[segs.length - 1]
  } else {
    owner = segs[0]
    repo = segs[1]
  }
  repo = repo.replace(/\.git$/i, '')

  if (!/^[\w.-]+$/.test(owner.replace(/\//g, ''))) throw new BadInput('owner 名称非法')
  if (!/^[\w.-]+$/.test(repo)) throw new BadInput('仓库名非法')

  return buildRepo(host, owner, repo, `https://${host}/${owner}/${repo}.git`)
}

/** 调用外部命令，返回 { code, stdout, stderr }，不会抛出（除非超时）。 */
export function runCommand(command, args, { cwd, timeout = 60_000, maxBuffer = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawnSafe(command, args, cwd)
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err?.message || err) })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer = null

    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d) => {
      if (stdout.length < maxBuffer) stdout += d
    })
    child.stderr?.on('data', (d) => {
      if (stderr.length < maxBuffer) stderr += d
    })
    child.on('error', (err) => finish({ code: -1, stdout, stderr: stderr + String(err?.message || err) }))
    child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr }))

    if (timeout > 0) {
      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {}
        finish({ code: -1, stdout, stderr: stderr + '\n[timeout] 命令执行超时' })
      }, timeout)
    }
  })
}

function spawnSafe(command, args, cwd) {
  return spawn(command, args, { cwd, windowsHide: true })
}

/** 计算字符串香农熵（用于识别随机密钥） */
export function shannonEntropy(str) {
  if (!str) return 0
  const map = new Map()
  for (const ch of str) map.set(ch, (map.get(ch) || 0) + 1)
  let h = 0
  for (const count of map.values()) {
    const p = count / str.length
    h -= p * Math.log2(p)
  }
  return h
}

/** 敏感信息脱敏：保留头尾，中间打码 */
export function maskSecret(value) {
  const s = String(value)
  if (s.length <= 8) return '*'.repeat(s.length)
  const head = s.slice(0, Math.min(6, Math.floor(s.length / 3)))
  const tail = s.slice(-4)
  return `${head}${'*'.repeat(Math.max(3, s.length - head.length - tail.length))}${tail}`
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 把多行文本按行切分并保留行号 */
export function splitLines(text) {
  return text.split(/\r\n|\r|\n/)
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

export function shortSha(sha) {
  return typeof sha === 'string' ? sha.slice(0, 8) : ''
}
