/**
 * Windows 专用脚本检测：.bat / .cmd / .ps1 / .vbs
 */
import { makeFinding, scoreFromChecks, trimEvidence } from './_common.mjs'

const WIN_EXT = new Set(['bat', 'cmd', 'ps1', 'psm1', 'vbs'])

const PENALTY = { bat: 8, cmd: 8, ps1: 4, psm1: 4, vbs: 7 }

function firstMeaningfulLine(text) {
  if (!text) return ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^(@echo off|@?rem\b|::|#|#requires|param\()/i.test(line)) continue
    return line.slice(0, 160)
  }
  return ''
}

export function analyzeWindows(ctx) {
  const findings = []
  const scripts = []
  const readme = (ctx.readmeText || '').toLowerCase()

  for (const file of ctx.files) {
    if (!WIN_EXT.has(file.ext)) continue
    const base = file.name.toLowerCase()
    const stem = base.replace(/\.[^.]+$/, '')
    const unixEquivalent = ctx.files.find((f) => {
      if (!['sh', 'bash', 'zsh', 'ps1'].includes(f.ext) && f.ext !== 'py') return false
      if (f.path === file.path) return false
      const fStem = f.name.toLowerCase().replace(/\.[^.]+$/, '')
      const sameDir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) === (file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '') : !f.path.includes('/')
      return fStem === stem && sameDir
    })
    scripts.push({
      path: file.path,
      ext: file.ext,
      size: file.size,
      firstLine: firstMeaningfulLine(file.text),
      referencedInReadme: readme.includes(base),
      hasUnixEquivalent: !!unixEquivalent,
    })
  }

  scripts.sort((a, b) => a.path.localeCompare(b.path))
  const byExt = scripts.reduce((acc, s) => {
    acc[s.ext] = (acc[s.ext] || 0) + 1
    return acc
  }, {})
  const referenced = scripts.filter((s) => s.referencedInReadme)
  const windowsOnly = scripts.length > 0 && scripts.every((s) => !s.hasUnixEquivalent)

  let penalty = 0
  for (const s of scripts) penalty += PENALTY[s.ext] || 6
  if (referenced.length) penalty += 15
  if (windowsOnly && scripts.length >= 2) penalty += 10

  const checks = [
    { key: 'none', label: '不存在 Windows 专用脚本', ok: scripts.length === 0, weight: 60 },
    { key: 'notRequired', label: '接入步骤不依赖 Windows 脚本', ok: referenced.length === 0, weight: 25 },
    { key: 'crossPlatform', label: '提供跨平台等价脚本', ok: scripts.length === 0 || !windowsOnly, weight: 15 },
  ]

  const score = scripts.length === 0 ? 100 : Math.max(0, Math.round(scoreFromChecks(checks) - penalty / 2))

  if (referenced.length) {
    findings.push(
      makeFinding({
        dimension: 'portability',
        category: 'windows',
        severity: 'high',
        title: `README 的接入步骤依赖 Windows 脚本（${referenced.length} 个）`,
        detail: `文档中直接要求执行 ${referenced.map((s) => s.path).slice(0, 3).join('、')}，macOS / Linux 用户无法按文档完成接入。`,
        file: referenced[0].path,
        evidence: trimEvidence(referenced[0].firstLine, 140),
        suggestion: '补充跨平台启动方式（npm scripts / Makefile / 容器），并在 README 中区分 Windows 与 *nix 步骤。',
      }),
    )
  }
  if (scripts.length && windowsOnly) {
    findings.push(
      makeFinding({
        dimension: 'portability',
        category: 'windows',
        severity: 'medium',
        title: '仓库只有 Windows 脚本，没有等价跨平台入口',
        detail: `共 ${scripts.length} 个 Windows 脚本（${Object.entries(byExt)
          .map(([k, v]) => `.${k}×${v}`)
          .join('，')}），且未找到同名 .sh / Node 脚本。`,
        suggestion: '把脚本逻辑迁移到 Node（node scripts/xxx.mjs）或同时提供 .sh 版本。',
      }),
    )
  }
  if (byExt.vbs) {
    findings.push(
      makeFinding({
        dimension: 'portability',
        category: 'windows',
        severity: 'medium',
        title: '仓库包含 VBScript 脚本',
        detail: `发现 ${byExt.vbs} 个 .vbs 文件。VBScript 在现代 Windows 中已默认禁用，且常被用于静默启动，存在安全审查风险。`,
        file: scripts.find((s) => s.ext === 'vbs')?.path,
        suggestion: '改用 PowerShell 7 或 Node 脚本替代。',
      }),
    )
  }
  if (byExt.ps1 && !ctx.files.some((f) => /^README/i.test(f.name) && /executionpolicy|ExecutionPolicy/i.test(f.text || ''))) {
    findings.push(
      makeFinding({
        dimension: 'portability',
        category: 'windows',
        severity: 'low',
        title: 'PowerShell 脚本未说明执行策略',
        detail: `发现 ${byExt.ps1} 个 .ps1 脚本，但文档未提示 ExecutionPolicy 相关设置，首次执行可能被系统拦截。`,
        file: scripts.find((s) => s.ext === 'ps1')?.path,
        suggestion: '在文档中说明 `Set-ExecutionPolicy -Scope Process Bypass` 等前置步骤。',
      }),
    )
  }

  return {
    score,
    checks,
    scripts,
    stats: { total: scripts.length, byExt, referencedCount: referenced.length, windowsOnly },
    findings,
  }
}
