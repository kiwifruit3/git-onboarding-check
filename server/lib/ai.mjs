/**
 * AI 接入建议。
 *
 * 默认使用内置「规则引擎 + 模板」生成建议（无需任何 API Key，离线可用）；
 * 若配置了 OPENAI_API_KEY / DEEPSEEK_API_KEY / DASHSCOPE_API_KEY，则额外调用大模型，
 * 用结构化的扫描结果作为上下文，生成更自然的风险解读与接入步骤。
 */
import { SEVERITY_LABEL } from './util.mjs'

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

function detectProvider() {
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      name: 'deepseek',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    }
  }
  if (process.env.DASHSCOPE_API_KEY) {
    return {
      name: 'dashscope',
      baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: process.env.DASHSCOPE_API_KEY,
      model: process.env.DASHSCOPE_MODEL || 'qwen-plus',
    }
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      name: 'openai',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    }
  }
  return null
}

export function aiProviderName() {
  return detectProvider()?.name || null
}

function installCommand(report) {
  const ecos = report.sections?.deps?.ecosystems || []
  if (ecos.some((e) => e.id === 'node')) return 'npm install（或 pnpm / yarn install）'
  if (ecos.some((e) => e.id === 'python')) return 'pip install -r requirements.txt'
  if (ecos.some((e) => e.id === 'go')) return 'go mod download'
  if (ecos.some((e) => e.id === 'rust')) return 'cargo build'
  if (ecos.some((e) => e.id === 'java')) return 'mvn install / gradle build'
  if (ecos.some((e) => e.id === 'php')) return 'composer install'
  return '按 README 说明安装依赖'
}

function startCommand(report) {
  const scripts = report.sections?.scripts?.entries || []
  const preferred = scripts.find((s) => /^(start|dev|serve|run|preview)$/.test(s.name))
  if (preferred) return preferred.command
  const makeRun = scripts.find((s) => /^make (run|dev|start)$/.test(s.name))
  if (makeRun) return makeRun.command
  const docker = report.sections?.scripts?.docker
  if (docker?.compose) return 'docker compose up'
  // 库项目通常没有启动脚本，别硬拿 lint/test 当启动命令
  return '按 README 说明启动（库项目可直接按示例引用）'
}

/** 无需 API Key 的本地建议生成 */
export function buildHeuristicAdvice(report) {
  const { score, risk, sections, meta } = report
  const top = (risk?.top || []).slice(0, 5)
  const advice = []

  for (const item of top) {
    advice.push({
      title: item.title,
      detail: `${item.detail}${item.file ? `（${item.file}${item.line ? `:${item.line}` : ''}）` : ''}`,
      severity: item.severity,
      dimension: item.dimension,
      action: item.suggestion,
    })
  }

  const steps = [
    `克隆仓库并切到 ${meta.commitShort || 'HEAD'}：git clone ${meta.repo.cloneUrl}`,
    `安装依赖：${installCommand(report)}`,
  ]
  const envExample = sections?.hygiene?.meta?.envExample
  if (envExample) steps.push(`复制配置样例：cp ${envExample} .env，并按需填写（不要提交真实密钥）`)
  else if ((sections?.secrets?.stats?.envFiles || []).length) steps.push('仓库中存在 .env，接入前请向负责人申请独立的环境变量，不要复用仓库内的配置')
  steps.push(`启动：${startCommand(report)}`)
  const testEntry = (sections?.scripts?.entries || []).find((s) => /test/.test(s.name))
  steps.push(testEntry ? `验证：${testEntry.command}` : '验证：按 README 手动走一遍核心功能，确认无报错')

  const worst = top[0]
  const verdict = `${meta.repo.slug} 的接入就绪度为 ${score.total}/100（${score.grade} · ${score.gradeLabel}）。${
    worst ? `最需要优先处理的是「${worst.title}」。` : '基础扫描未发现阻塞性问题。'
  }`

  return {
    enabled: false,
    source: 'local-rules',
    provider: '内置规则引擎',
    model: 'heuristic-v1',
    generatedAt: new Date().toISOString(),
    verdict,
    summary:
      score.total >= 70
        ? '整体具备接入条件。建议按下方步骤先跑通一次完整流程，再处理风险清单中的中低危项。'
        : '接入前建议先完成风险清单中的高优先级整改，尤其是安全与跨平台相关问题，否则接入方会在环境准备阶段被阻塞。',
    advice,
    steps,
  }
}

function buildPrompt(report) {
  const compact = {
    repo: report.meta.repo.slug,
    commit: report.meta.commitShort,
    score: { total: report.score.total, grade: report.score.grade, dimensions: report.score.dimensions },
    stats: report.stats,
    findings: (report.risk?.all || []).slice(0, 20).map((f) => ({
      severity: f.severity,
      dimension: f.dimension,
      title: f.title,
      detail: f.detail,
      file: f.file,
      line: f.line,
      suggestion: f.suggestion,
    })),
    readme: { exists: !!report.sections?.readme?.meta?.path, chars: report.sections?.readme?.meta?.chars },
    ecosystems: report.sections?.deps?.ecosystems,
    scripts: report.sections?.scripts?.entries?.slice(0, 10),
    windowsScripts: report.sections?.windows?.scripts?.map((s) => s.path),
  }
  return [
    {
      role: 'system',
      content:
        '你是资深研发效能与开源治理顾问。基于给定的仓库静态扫描结果，用简体中文输出接入建议。只输出 JSON，不要 markdown 代码块，结构为：{"verdict": string, "summary": string, "advice": [{"title": string, "detail": string, "severity": "critical|high|medium|low", "action": string}], "steps": string[]}。advice 最多 5 条，steps 3-6 条，必须具体到文件或命令，不要编造扫描结果中没有的问题。',
    },
    { role: 'user', content: JSON.stringify(compact) },
  ]
}

async function callLlm(provider, report) {
  const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.2,
      max_tokens: 1200,
      messages: buildPrompt(report),
    }),
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LLM 调用失败 HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content || ''
  const cleaned = content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const parsed = JSON.parse(cleaned)
  return {
    enabled: true,
    source: 'llm',
    provider: provider.name,
    model: provider.model,
    generatedAt: new Date().toISOString(),
    verdict: String(parsed.verdict || '').slice(0, 400),
    summary: String(parsed.summary || '').slice(0, 800),
    advice: (Array.isArray(parsed.advice) ? parsed.advice : []).slice(0, 6).map((a) => ({
      title: String(a?.title || '').slice(0, 120),
      detail: String(a?.detail || '').slice(0, 400),
      severity: SEVERITY_RANK[a?.severity] !== undefined ? a.severity : 'medium',
      action: String(a?.action || '').slice(0, 400),
    })),
    steps: (Array.isArray(parsed.steps) ? parsed.steps : []).slice(0, 8).map((s) => String(s).slice(0, 300)),
  }
}

export async function generateAiAdvice(report) {
  const heuristic = buildHeuristicAdvice(report)
  const provider = detectProvider()
  if (!provider) return { ...heuristic, note: '未配置大模型 API Key，当前建议由内置规则引擎生成。' }
  try {
    const result = await callLlm(provider, report)
    return {
      ...result,
      note: `已调用 ${provider.name} / ${provider.model} 生成建议，仅供参考，请结合代码实际复核。`,
    }
  } catch (error) {
    return { ...heuristic, error: String(error?.message || error).slice(0, 300) }
  }
}

export { SEVERITY_LABEL }
