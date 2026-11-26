/**
 * 硬编码路径检测：Windows 盘符、macOS / Linux 家目录、UNC 共享、系统绝对路径、file:// 协议。
 */
import { makeFinding, sortFindings } from './_common.mjs'

const RULES = [
  {
    id: 'windows-drive',
    label: 'Windows 盘符绝对路径',
    // 前面不能是字母/数字，避免把 https:// 里的 s:/ 误判
    re: /(?<![A-Za-z0-9_])[A-Za-z]:[\\/][^\s"'`<>|,;)]*/g,
    severity: 'high',
    docSeverity: 'medium',
    hint: '改为相对路径 / 环境变量 / path.join(__dirname, ...)',
  },
  {
    id: 'windows-unc',
    label: 'UNC 网络共享路径',
    re: /\\\\[A-Za-z0-9._-]+\\[^\s"'`<>|]*/g,
    severity: 'high',
    docSeverity: 'low',
    hint: '网络共享路径不可移植，改为配置项',
  },
  {
    id: 'mac-home',
    label: 'macOS 用户目录绝对路径',
    re: /\/Users\/[A-Za-z0-9._-]+(?:\/[^\s"'`<>|,;)]*)?/g,
    severity: 'high',
    docSeverity: 'medium',
    hint: '改为 os.homedir() / ~ 展开 / 环境变量',
  },
  {
    id: 'linux-home',
    label: 'Linux 用户目录绝对路径',
    re: /\/home\/[A-Za-z0-9._-]+(?:\/[^\s"'`<>|,;)]*)?/g,
    severity: 'high',
    docSeverity: 'medium',
    hint: '改为 $HOME / 环境变量',
  },
  {
    id: 'posix-system',
    label: '系统级绝对路径',
    re: /(?<![A-Za-z0-9_.-])\/(?:opt|usr\/local|var\/www|srv|mnt|Volumes)\/[^\s"'`<>|,;)]*/g,
    severity: 'medium',
    docSeverity: 'low',
    hint: '部署路径应通过配置注入',
  },
  {
    id: 'file-url',
    label: 'file:// 本地文件 URL',
    re: /file:\/\/\/[^\s"'`<>|,;)]*/g,
    severity: 'medium',
    docSeverity: 'low',
    hint: '改为相对路径或运行时配置',
  },
]

const PREFILTER = /[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|\/(?:opt|usr\/local|var\/www|srv|mnt|Volumes)\/|file:\/\/\//
const MAX_HITS = 600
const MAX_HITS_PER_FILE = 25
const TEST_PATH_RE = /(^|\/)(tests?|spec|__tests__|fixtures?|testdata|test-data|examples?|samples?|mocks?|e2e|benchmarks?)\//i
const TEST_FILE_RE = /(^|\/)[^/]*(_test\.(go|py|rb|java|kt|cs)|\.test\.(js|ts|jsx|tsx)|\.spec\.(js|ts|jsx|tsx)|Test\.(java|cs|kt))$/i

function isTestPath(p) {
  return TEST_PATH_RE.test(p) || TEST_FILE_RE.test(p)
}

function severityFor(rule, file) {
  if (isTestPath(file.path)) return 'low'
  if (['bat', 'cmd', 'ps1', 'psm1', 'vbs'].includes(file.ext)) return 'high'
  if (file.kind === 'doc') return rule.docSeverity || 'low'
  if (file.kind === 'code' || file.kind === 'config') return rule.severity
  return rule.severity
}

/** 排除 JS 转义序列（\\u003c 之类）被误判成 UNC 路径 */
function isEscapedNoise(ruleId, value) {
  if (ruleId !== 'windows-unc') return false
  return /^\\\\[ux][0-9a-f]/i.test(value) || /\\\\[nrtbfv0]/.test(value)
}

const SEV_WEIGHT = { critical: 30, high: 12, medium: 5, low: 1, info: 0 }

export function analyzePaths(ctx) {
  const hits = []
  const findings = []
  let truncated = false

  for (const file of ctx.files) {
    if (!file.text || hits.length >= MAX_HITS) {
      if (hits.length >= MAX_HITS) truncated = true
      continue
    }
    if (file.kind === 'lock' || file.kind === 'minified') continue
    if (!PREFILTER.test(file.text)) continue

    const lines = file.text.split(/\r\n|\r|\n/)
    let fileHits = 0
    for (let i = 0; i < lines.length && fileHits < MAX_HITS_PER_FILE; i += 1) {
      const line = lines[i]
      if (!PREFILTER.test(line)) continue
      for (const rule of RULES) {
        rule.re.lastIndex = 0
        let m
        while ((m = rule.re.exec(line)) !== null) {
          const value = m[0].trim()
          if (!value || value.length < 3) continue
          if (isEscapedNoise(rule.id, value)) continue
          hits.push({
            file: file.path,
            line: i + 1,
            match: value.slice(0, 200),
            rule: rule.id,
            ruleLabel: rule.label,
            severity: severityFor(rule, file),
            confidence: isTestPath(file.path) ? 'low' : 'high',
          })
          fileHits += 1
          if (fileHits >= MAX_HITS_PER_FILE) break
        }
        if (fileHits >= MAX_HITS_PER_FILE) break
      }
    }
    if (hits.length >= MAX_HITS) {
      truncated = true
      break
    }
  }

  // 按文件聚合
  const byFile = new Map()
  for (const hit of hits) {
    const cur = byFile.get(hit.file) || { path: hit.file, count: 0, worst: 'low', rules: new Set() }
    cur.count += 1
    cur.rules.add(hit.ruleLabel)
    if (SEV_WEIGHT[hit.severity] > SEV_WEIGHT[cur.worst]) cur.worst = hit.severity
    byFile.set(hit.file, cur)
  }
  const files = [...byFile.values()]
    .map((f) => ({ path: f.path, count: f.count, worst: f.worst, rules: [...f.rules] }))
    .sort((a, b) => SEV_WEIGHT[b.worst] - SEV_WEIGHT[a.worst] || b.count - a.count)

  let penalty = 0
  for (const hit of hits) penalty += SEV_WEIGHT[hit.severity]
  const score = Math.max(0, 100 - Math.min(100, penalty / 3))

  for (const f of files.slice(0, 12)) {
    const sample = hits.find((h) => h.file === f.path)
    findings.push(
      makeFinding({
        dimension: 'portability',
        category: 'path',
        severity: f.worst,
        title: `${f.path} 存在 ${f.count} 处硬编码路径`,
        detail: `命中规则：${f.rules.join('、')}。换一台机器 / 换一个用户目录就会失效。`,
        file: f.path,
        line: sample?.line || 0,
        evidence: sample ? `${sample.line}: ${sample.match}` : '',
        suggestion: '统一改为相对路径或从环境变量/配置文件读取，并在 README 说明需要的目录变量。',
      }),
    )
  }

  const stats = {
    total: hits.length,
    files: files.length,
    byRule: RULES.map((r) => ({ id: r.id, label: r.label, count: hits.filter((h) => h.rule === r.id).length })).filter(
      (r) => r.count > 0,
    ),
    truncated,
  }

  return { score: Math.round(score), hits: hits.slice(0, MAX_HITS), files, stats, findings: sortFindings(findings) }
}
