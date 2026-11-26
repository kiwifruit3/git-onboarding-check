/**
 * README 完整度分析。
 * 只做「接入视角」的检查：新人拿到仓库，能否照着文档把项目跑起来。
 */
import { makeFinding, scoreFromChecks, trimEvidence } from './_common.mjs'

const README_RE = /^readme(\.(md|markdown|mdx|rst|txt|adoc))?$/i

const SECTION_PATTERNS = {
  install: /(^|\n)#{1,4}[^\n]*?(安装|部署步骤|install|installation|setup|getting started|快速开始|快速上手|quick ?start)/i,
  usage: /(^|\n)#{1,4}[^\n]*?(使用|用法|运行|usage|how to (use|run)|run(ning)? the|启动|跑起来)/i,
  env: /(^|\n)#{1,4}[^\n]*?(环境|前置|依赖要求|prerequisites?|requirements|system requirements|技术栈|tech stack)/i,
  config: /(^|\n)#{1,4}[^\n]*?(配置|环境变量|config|configuration|environment variables?|settings|\.env)/i,
  screenshot: /(^|\n)#{1,4}[^\n]*?(截图|效果图|演示|screenshot|demo|preview|showcase|界面)/i,
  license: /(^|\n)#{1,4}[^\n]*?(许可证|开源协议|license|licence)/i,
  contributing: /(^|\n)#{1,4}[^\n]*?(贡献|参与开发|contribut)/i,
  structure: /(^|\n)#{1,4}[^\n]*?(目录结构|项目结构|structure|folder layout)/i,
}

function pickReadme(files) {
  const rootOnes = files.filter((f) => !f.path.includes('/') && README_RE.test(f.name))
  if (rootOnes.length) {
    const order = ['readme.md', 'readme.markdown', 'readme.mdx', 'readme.rst', 'readme.txt', 'readme.adoc', 'readme']
    return rootOnes.sort((a, b) => {
      const ia = order.indexOf(a.name.toLowerCase())
      const ib = order.indexOf(b.name.toLowerCase())
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })[0]
  }
  return files.find((f) => /(^|\/)docs?\/readme\.(md|markdown|rst|txt)$/i.test(f.path)) || null
}

export function analyzeReadme(ctx) {
  const findings = []
  const readme = pickReadme(ctx.files)
  const checks = []

  if (!readme || !readme.text) {
    findings.push(
      makeFinding({
        dimension: 'docs',
        category: 'readme',
        severity: 'high',
        title: '仓库缺少 README',
        detail: '根目录未找到 README.md / README.rst 等说明文件，新人无法了解项目用途与启动方式。',
        suggestion: '补充 README.md，至少包含：项目简介、环境要求、安装步骤、启动命令、配置项说明。',
      }),
    )
    return {
      score: 0,
      checks: [{ key: 'exists', label: '存在 README', ok: false, weight: 25 }],
      meta: { path: null, chars: 0, headings: 0, codeBlocks: 0, images: 0, language: 'unknown', sections: {} },
      findings,
    }
  }

  const text = readme.text
  const lower = text.toLowerCase()
  const chars = text.replace(/\s/g, '').length
  const headings = (text.match(/^#{1,4}\s+\S/gm) || []).length
  const codeBlocks = Math.floor((text.match(/```/g) || []).length / 2)
  const images = (text.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length + (text.match(/<img\s/gi) || []).length
  const badges = (text.match(/img\.shields\.io|badge\.svg/gi) || []).length
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const language = chineseChars / Math.max(1, chars) > 0.08 ? 'zh' : 'en'

  const sections = {}
  for (const [key, re] of Object.entries(SECTION_PATTERNS)) sections[key] = re.test(text)
  if (images > 0) sections.screenshot = true
  if (/```(bash|sh|shell|zsh|powershell|cmd)/i.test(text)) sections.install = sections.install || true

  checks.push({ key: 'exists', label: '存在 README', ok: true, weight: 25 })
  checks.push({ key: 'length', label: '正文 ≥ 600 字', ok: chars >= 600, weight: 10 })
  checks.push({ key: 'lengthPlus', label: '正文 ≥ 1500 字（较完整）', ok: chars >= 1500, weight: 5 })
  checks.push({ key: 'install', label: '包含安装步骤', ok: sections.install, weight: 10 })
  checks.push({ key: 'usage', label: '包含使用/运行说明', ok: sections.usage, weight: 10 })
  checks.push({ key: 'env', label: '说明环境与前置依赖', ok: sections.env, weight: 8 })
  checks.push({ key: 'config', label: '说明配置项/环境变量', ok: sections.config, weight: 8 })
  checks.push({ key: 'codeBlocks', label: '提供可复制的命令示例（≥2 段）', ok: codeBlocks >= 2, weight: 8 })
  checks.push({ key: 'screenshot', label: '有截图或演示', ok: sections.screenshot || images > 0, weight: 5 })
  checks.push({ key: 'license', label: '声明开源许可证', ok: sections.license, weight: 6 })
  checks.push({ key: 'contributing', label: '包含贡献指南', ok: sections.contributing, weight: 5 })

  const score = scoreFromChecks(checks)

  if (chars < 600) {
    findings.push(
      makeFinding({
        dimension: 'docs',
        category: 'readme',
        severity: 'medium',
        title: 'README 内容过短',
        detail: `README 仅 ${chars} 个有效字符（建议 ≥ 600），难以支撑新人独立接入。`,
        file: readme.path,
        evidence: trimEvidence(text, 120),
        suggestion: '补充项目背景、技术栈、目录结构、启动与调试步骤。',
      }),
    )
  }
  if (!sections.install) {
    findings.push(
      makeFinding({
        dimension: 'docs',
        category: 'readme',
        severity: 'medium',
        title: 'README 未说明安装步骤',
        detail: '没有找到「安装 / Install / 快速开始」等章节。',
        file: readme.path,
        suggestion: '增加一节安装说明，写清楚依赖版本、安装命令与预期输出。',
      }),
    )
  }
  if (!sections.usage) {
    findings.push(
      makeFinding({
        dimension: 'docs',
        category: 'readme',
        severity: 'medium',
        title: 'README 未说明如何运行',
        detail: '没有找到「使用 / Usage / 运行」等章节，新人不知道启动命令是什么。',
        file: readme.path,
        suggestion: '补充启动命令（如 npm run dev / python main.py）与访问地址。',
      }),
    )
  }
  if (!sections.env) {
    findings.push(
      makeFinding({
        dimension: 'docs',
        category: 'readme',
        severity: 'low',
        title: 'README 未说明环境要求',
        detail: '缺少 Node / Python / JDK 等运行时版本要求。',
        file: readme.path,
        suggestion: '注明运行时版本、系统要求与必要的外部服务。',
      }),
    )
  }
  if (/TODO|待补充|coming soon|施工中|WIP/i.test(text) && chars < 1500) {
    findings.push(
      makeFinding({
        dimension: 'docs',
        category: 'readme',
        severity: 'low',
        title: 'README 存在未完成标记',
        detail: '文档中出现 TODO / 待补充 等占位内容。',
        file: readme.path,
        evidence: trimEvidence(text.match(/.{0,40}(TODO|待补充|coming soon|WIP).{0,40}/i)?.[0] || '', 120),
        suggestion: '补齐占位章节，或删除未完成内容避免误导。',
      }),
    )
  }

  return {
    score,
    checks,
    meta: {
      path: readme.path,
      chars,
      headings,
      codeBlocks,
      images,
      badges,
      language,
      sections,
      hasStructure: sections.structure,
    },
    findings,
  }
}
