/**
 * 密钥与敏感信息检测。
 * 规则参考 GitHub Secret Scanning / gitleaks 的常见模式，并针对「接入体检」场景做降噪：
 *  - 占位符（your-key / xxx / <token> / process.env）直接跳过；
 *  - 测试与示例目录降置信度，不计满权重；
 *  - 证据统一脱敏后再返回前端。
 */
import { maskSecret, shannonEntropy } from '../util.mjs'
import { makeFinding, sortFindings } from './_common.mjs'

const PATTERNS = [
  {
    id: 'private-key',
    label: '私钥内容',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    severity: 'critical',
    suggestion: '立即吊销并轮换该密钥，用 git filter-repo 清理历史，改由环境变量或密钥管理服务注入。',
  },
  {
    id: 'anthropic',
    label: 'Anthropic API Key',
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
    severity: 'critical',
  },
  {
    id: 'openai',
    label: 'OpenAI 兼容 API Key',
    re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
    severity: 'critical',
  },
  {
    id: 'aws',
    label: 'AWS Access Key ID',
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    severity: 'critical',
  },
  {
    id: 'tencent',
    label: '腾讯云 SecretId（AKID）',
    re: /\bAKID[A-Za-z0-9]{13,40}\b/,
    severity: 'critical',
  },
  {
    id: 'github',
    label: 'GitHub Token',
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/,
    severity: 'critical',
  },
  {
    id: 'gitlab',
    label: 'GitLab Token',
    re: /\bglpat-[A-Za-z0-9_-]{20,}\b/,
    severity: 'critical',
  },
  {
    id: 'stripe',
    label: 'Stripe Key',
    re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
    severity: 'critical',
  },
  {
    id: 'google',
    label: 'Google API Key',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
    severity: 'high',
  },
  {
    id: 'slack',
    label: 'Slack Token',
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    severity: 'high',
  },
  {
    id: 'db-url',
    label: '数据库连接串含明文密码',
    re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|clickhouse):\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/,
    severity: 'critical',
  },
  {
    id: 'bearer',
    label: 'Bearer Token',
    re: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
    severity: 'high',
  },
  {
    id: 'jwt',
    label: 'JWT Token',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    severity: 'medium',
  },
  {
    id: 'generic-assign',
    label: '疑似硬编码凭据',
    re: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?key|auth[_-]?token|password|passwd)\s*[:=]\s*['"`]([^'"`\s]{8,})['"`]/i,
    severity: 'high',
    group: 1,
    confidence: 'medium',
  },
]

const PREFILTER =
  /sk-|AKID|AKIA|Bearer|BEGIN [A-Z ]*PRIVATE KEY|ghp_|gho_|ghu_|ghs_|github_pat_|glpat-|AIza|xox[baprs]-|eyJ|mongodb|postgres|mysql:|redis:|amqp|password|passwd|secret|api[_-]?key|apikey|token|BEGIN OPENSSH/i

const PLACEHOLDER =
  /(example|sample|dummy|placeholder|your[_-]?|xxx+|abc123|123456|1234|000000|changeme|redacted|fake|mock|demo|test[_-]?key|notarealkey|<[^>]{1,40}>|\$\{|\{\{|process\.env|os\.environ|ENV\[|getenv|import\.meta\.env|YOUR_|xyz)/i

/** 扫描器规则定义文件里的示例字符串，不是真实凭据 */
const RULE_DEF_RE =
  /regexp\.|MustCompile|new RegExp|RegExp\(|SecretGroup|RuleID|Keywords:|Allowlist|allowlist|Pattern:\s|regex:\s|pattern:\s/i

/** 常见的「已知非密钥」标注，尊重这些显式声明 */
const ALLOWLIST_RE =
  /gitleaks:allow|nosec|noinspection|allowlist secret|pragma: allowlist|secret-scan:\s*ignore|skip\s*secret/i

const SECRET_FILE_RE = /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$|\.(pem|key|pfx|p12|jks|keystore)$/i
const ENV_FILE_RE = /(^|\/)\.env(\.(local|development|dev|production|prod|test|staging))?$/i
const SAFE_ENV_RE = /(^|\/)\.env\.(example|sample|template|dist)$/i
const TEST_DIR_RE = /(^|\/)(tests?|spec|__tests__|fixtures?|testdata|test-data|examples?|samples?|mocks?|docs?)\//i
const TEST_FILE_RE = /(^|\/)[^/]*(_test\.(go|py|rb|java|kt|cs)|\.test\.(js|ts|jsx|tsx)|\.spec\.(js|ts|jsx|tsx)|Test\.(java|cs|kt))$/i

const SEV_WEIGHT = { critical: 45, high: 22, medium: 8, low: 2, info: 0 }

function confidenceFactor(confidence) {
  // 低置信命中（测试 fixture / 规则样例）不计入评分，只作为人工复核线索
  if (confidence === 'low') return 0
  if (confidence === 'medium') return 0.7
  return 1
}

function isPlaceholder(value, line) {
  return PLACEHOLDER.test(value) || PLACEHOLDER.test(line.slice(0, 160))
}

export function analyzeSecrets(ctx) {
  const hits = []
  const findings = []
  const readmeText = ctx.readmeText || ''

  // 1) 内容级规则扫描
  for (const file of ctx.files) {
    if (!file.text) continue
    if (file.kind === 'lock' || file.kind === 'minified') continue
    if (!PREFILTER.test(file.text)) continue

    // 整个文件就是「密钥扫描规则定义」时，里面的示例字符串一律按样例数据处理
    const isRuleDefFile = RULE_DEF_RE.test(file.text)
    const lines = file.text.split(/\r\n|\r|\n/)
    const fileIsTest = TEST_DIR_RE.test(file.path) || TEST_FILE_RE.test(file.path)
    const treatAsFixture = fileIsTest || isRuleDefFile
    for (let i = 0; i < lines.length && hits.length < 200; i += 1) {
      const line = lines[i]
      if (!PREFILTER.test(line)) continue
      if (ALLOWLIST_RE.test(line)) continue
      if (RULE_DEF_RE.test(line)) continue
      const claimed = []
      for (const pattern of PATTERNS) {
        pattern.re.lastIndex = 0
        const m = pattern.re.exec(line)
        if (!m) continue
        const rawValue = pattern.group ? m[pattern.group] : m[0]
        const spanStart = pattern.group ? m.index + m[0].indexOf(rawValue) : m.index
        const spanEnd = spanStart + rawValue.length
        if (claimed.some(([s, e]) => spanStart < e && spanEnd > s)) continue
        if (isPlaceholder(rawValue, line)) continue
        // 私钥必须真的带着 base64 主体，否则只是规则里的文件头
        if (pattern.id === 'private-key') {
          const body = lines.slice(i, i + 10).join('\n')
          if (!/[A-Za-z0-9+/]{40,}/.test(body)) continue
        }
        claimed.push([spanStart, spanEnd])

        const confidence = treatAsFixture ? 'low' : pattern.confidence === 'medium' ? 'medium' : 'high'
        // 测试/样例/规则定义文件里的「密钥」几乎都是 fixture，降级为低危 + 低置信，交由人工复核
        const severity = treatAsFixture ? 'low' : pattern.severity

        hits.push({
          file: file.path,
          line: i + 1,
          rule: pattern.id,
          ruleLabel: pattern.label,
          severity,
          confidence,
          masked: maskSecret(rawValue),
          context: line.trim().slice(0, 200),
          suggestion: pattern.suggestion || '移除硬编码密钥，改用环境变量 / 密钥管理服务，并轮换已泄露的凭据。',
        })
        break
      }
    }
  }

  // 2) 私钥/证书文件
  const isFixturePath = (p) => TEST_DIR_RE.test(p) || TEST_FILE_RE.test(p)
  const secretFiles = ctx.files.filter((f) => SECRET_FILE_RE.test(f.path) && !f.path.includes('node_modules'))
  const realSecretFiles = secretFiles.filter((f) => !isFixturePath(f.path))
  for (const file of secretFiles.slice(0, 10)) {
    const fixture = isFixturePath(file.path)
    hits.push({
      file: file.path,
      line: 0,
      rule: 'secret-file',
      ruleLabel: '密钥/证书文件入库',
      severity: fixture ? 'low' : 'critical',
      confidence: fixture ? 'low' : 'medium',
      masked: file.name,
      context: `${file.path}（${file.size} 字节）${fixture ? '，位于测试/样例目录' : ''}`,
      suggestion: '从仓库移除该文件并加入 .gitignore；若已推送，轮换对应密钥。',
    })
  }

  // 3) .env 入库
  const envFiles = ctx.files.filter((f) => ENV_FILE_RE.test(f.path) && !SAFE_ENV_RE.test(f.path))
  const realEnvFiles = envFiles.filter((f) => !isFixturePath(f.path))
  for (const file of envFiles.slice(0, 10)) {
    const fixture = isFixturePath(file.path)
    const pairs = (file.text || '')
      .split(/\r?\n/)
      .filter((l) => /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S+/.test(l.trim()))
    const meaningful = pairs.filter((l) => !isPlaceholder(l.split('=').slice(1).join('='), l))
    hits.push({
      file: file.path,
      line: 0,
      rule: 'env-committed',
      ruleLabel: '.env 环境变量文件已提交',
      severity: fixture ? 'low' : meaningful.length ? 'critical' : 'medium',
      confidence: fixture ? 'low' : meaningful.length ? 'high' : 'medium',
      masked: `${pairs.length} 个变量`,
      context: meaningful.slice(0, 3).map((l) => l.split('=')[0] + '=***').join('，') || '仅包含占位值',
      suggestion: '删除仓库中的 .env，改为提交 .env.example，并在 .gitignore 中忽略 .env*。',
    })
  }

  // 4) 高熵字符串兜底
  const entropyHits = []
  for (const file of ctx.files) {
    if (!file.text || entropyHits.length >= 40) continue
    if (!['code', 'config'].includes(file.kind)) continue
    const lines = file.text.split(/\r\n|\r|\n/)
    for (let i = 0; i < lines.length && entropyHits.length < 40; i += 1) {
      const line = lines[i]
      if (!/(?:key|secret|token|passw|credential|private)/i.test(line)) continue
      const m = line.match(/['"`]([A-Za-z0-9_\-+/=.]{24,120})['"`]/)
      if (!m) continue
      const value = m[1]
      if (isPlaceholder(value, line)) continue
      if (shannonEntropy(value) < 4.3) continue
      if (hits.some((h) => h.file === file.path && h.line === i + 1)) continue
      entropyHits.push({
        file: file.path,
        line: i + 1,
        rule: 'high-entropy',
        ruleLabel: '高熵字符串（疑似密钥）',
        severity: 'medium',
        confidence: 'low',
        masked: maskSecret(value),
        context: line.trim().slice(0, 200),
        suggestion: '确认是否为真实密钥；若是，改为环境变量注入。',
      })
    }
  }
  hits.push(...entropyHits)

  // 5) 命中密度异常的文件：通常是扫描器规则库 / 测试语料，降级为「待人工复核」
  const density = new Map()
  for (const hit of hits) {
    if (hit.rule === 'secret-file' || hit.rule === 'env-committed') continue
    const key = `${hit.file}::${hit.rule}`
    density.set(key, (density.get(key) || 0) + 1)
  }
  for (const hit of hits) {
    const key = `${hit.file}::${hit.rule}`
    if ((density.get(key) || 0) >= 5) {
      hit.severity = 'low'
      hit.confidence = 'low'
      hit.corpus = true
    }
  }

  // 6) .gitignore 覆盖情况
  const gitignore = ctx.files.find((f) => !f.path.includes('/') && /^\.gitignore$/i.test(f.name))
  const gitignoreText = gitignore?.text || ''
  const ignoresEnv = /(^|\n)\s*\.env(\*|\.|\b)/.test(gitignoreText)
  const ignoresKeys = /(^|\n)\s*\*?\.(pem|key|p12|pfx)\b|(^|\n)\s*id_rsa/.test(gitignoreText)
  if (realEnvFiles.length && !ignoresEnv) {
    findings.push(
      makeFinding({
        dimension: 'security',
        category: 'secret',
        severity: 'high',
        title: '.env 已入库且未被 .gitignore 忽略',
        detail: '仓库中存在 .env 文件，但 .gitignore 没有忽略规则，后续提交会持续泄露配置与密钥。',
        file: gitignore ? '.gitignore' : '.env',
        suggestion: '在 .gitignore 中加入 `.env` 与 `.env.*`（保留 .env.example），并清理已提交内容。',
      }),
    )
  }
  if (!gitignore) {
    findings.push(
      makeFinding({
        dimension: 'hygiene',
        category: 'secret',
        severity: 'medium',
        title: '仓库缺少 .gitignore',
        detail: '没有 .gitignore，node_modules、构建产物、.env 等容易被误提交。',
        suggestion: '补充 .gitignore（可使用 github/gitignore 模板）。',
      }),
    )
  } else if (!ignoresEnv && !envFiles.length && readmeText.toLowerCase().includes('.env')) {
    findings.push(
      makeFinding({
        dimension: 'security',
        category: 'secret',
        severity: 'medium',
        title: '.gitignore 未忽略 .env 文件',
        detail: 'README 提到需要配置 .env，但 .gitignore 中没有对应忽略规则，存在误提交风险。',
        file: '.gitignore',
        suggestion: '在 .gitignore 中加入 `.env` 与 `.env.*`。',
      }),
    )
  }
  if (!ignoresKeys && secretFiles.length === 0) {
    // 仅提示，不单独成风险项
  }

  // 6) 聚合风险项（按文件）
  const grouped = new Map()
  for (const hit of hits) {
    const key = `${hit.file}::${hit.rule}`
    const cur = grouped.get(key)
    if (cur) {
      cur.count += 1
      cur.lines.push(hit.line)
      if (SEV_WEIGHT[hit.severity] > SEV_WEIGHT[cur.severity]) cur.severity = hit.severity
    } else {
      grouped.set(key, { ...hit, count: 1, lines: [hit.line] })
    }
  }
  for (const item of [...grouped.values()].slice(0, 20)) {
    const corpusNote = item.corpus ? '该文件命中密度异常（≥5 处同类），通常是测试 fixture 或扫描器规则样例数据。' : ''
    findings.push(
      makeFinding({
        dimension: 'security',
        category: 'secret',
        severity: item.severity,
        title: `${item.ruleLabel}${item.count > 1 ? `（${item.count} 处）` : ''}${item.corpus ? ' · 疑似样例数据' : ''}`,
        detail: `在 ${item.file} 第 ${item.lines.slice(0, 5).join('、')} 行附近发现疑似敏感信息。${corpusNote}${
          item.confidence === 'low' ? '置信度较低，需人工复核。' : ''
        }`,
        file: item.file,
        line: item.line,
        evidence: `脱敏后：${item.masked}　上下文：${item.context}`.slice(0, 260),
        suggestion: item.suggestion,
        confidence: item.confidence,
      }),
    )
  }

  let penalty = 0
  for (const hit of hits) {
    penalty += SEV_WEIGHT[hit.severity] * confidenceFactor(hit.confidence)
  }
  const score = Math.max(0, Math.round(100 - Math.min(100, penalty)))

  const checks = [
    { key: 'noHardcoded', label: '未发现硬编码密钥', ok: hits.filter((h) => h.confidence !== 'low').length === 0, weight: 55 },
    { key: 'noEnv', label: '未提交 .env 文件', ok: realEnvFiles.length === 0, weight: 25 },
    { key: 'noKeyFiles', label: '未提交私钥/证书文件', ok: realSecretFiles.length === 0, weight: 10 },
    { key: 'gitignore', label: '.gitignore 覆盖敏感文件', ok: !!gitignore && (ignoresEnv || !realEnvFiles.length), weight: 10 },
  ]

  return {
    score,
    checks,
    hits: hits.slice(0, 120),
    stats: {
      total: hits.length,
      critical: hits.filter((h) => h.severity === 'critical').length,
      high: hits.filter((h) => h.severity === 'high').length,
      reviewNeeded: hits.filter((h) => h.confidence === 'low').length,
      envFiles: envFiles.map((f) => f.path),
      secretFiles: secretFiles.map((f) => f.path),
      byRule: Object.entries(
        hits.reduce((acc, h) => {
          acc[h.ruleLabel] = (acc[h.ruleLabel] || 0) + 1
          return acc
        }, {}),
      ).map(([label, count]) => ({ label, count })),
    },
    findings: sortFindings(findings),
  }
}
