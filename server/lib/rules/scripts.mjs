/**
 * 启动脚本 / 可运行性分析。
 * 判定标准：新人拿到仓库后，是否存在一条「装完依赖就能跑起来」的明确路径。
 */
import { makeFinding, scoreFromChecks, trimEvidence } from './_common.mjs'

const RUN_SCRIPT_NAMES = ['start', 'dev', 'serve', 'run', 'preview']
const WIN_REF_RE = /(?:^|[\s"'&|(])([^\s"'&|()]+\.(?:bat|cmd|ps1|vbs))\b/gi

function parseMakefile(text) {
  const targets = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):(?!=)/)
    if (m && !m[1].startsWith('.')) targets.push(m[1])
  }
  return targets
}

export function analyzeScripts(ctx) {
  const findings = []
  const checks = []
  const entries = []
  const windowsRefs = []
  const pkg = ctx.packageJson
  const scripts = pkg?.scripts || {}

  for (const [name, command] of Object.entries(scripts)) {
    entries.push({ name, command: String(command), source: 'package.json' })
    const matches = String(command).match(WIN_REF_RE)
    if (matches) windowsRefs.push({ script: name, command: String(command), files: matches.map((m) => m.replace(/^[\s"'&|(]+/, '')) })
  }

  const makefile = ctx.files.find((f) => !f.path.includes('/') && /^makefile$/i.test(f.name))
  const makeTargets = makefile?.text ? parseMakefile(makefile.text) : []
  for (const t of makeTargets.slice(0, 12)) entries.push({ name: `make ${t}`, command: `make ${t}`, source: 'Makefile' })

  const dockerfile = ctx.files.find((f) => !f.path.includes('/') && /^dockerfile$/i.test(f.name))
  const compose = ctx.files.find((f) => !f.path.includes('/') && /^docker-compose\.ya?ml$/i.test(f.name))
  const procfile = ctx.files.find((f) => !f.path.includes('/') && /^procfile$/i.test(f.name))
  if (dockerfile) entries.push({ name: 'docker build', command: 'docker build -t app .', source: 'Dockerfile' })
  if (compose) entries.push({ name: 'docker compose up', command: 'docker compose up', source: compose.name })
  if (procfile?.text) {
    for (const line of procfile.text.split(/\r?\n/).slice(0, 5)) {
      if (line.includes(':')) entries.push({ name: line.split(':')[0], command: line.slice(line.indexOf(':') + 1).trim(), source: 'Procfile' })
    }
  }
  // Windows 脚本本身也是启动入口（可移植性问题由 windows 规则单独扣分）
  const winScripts = ctx.files.filter((f) => ['bat', 'cmd', 'ps1', 'psm1', 'vbs'].includes(f.ext)).slice(0, 6)
  for (const s of winScripts) entries.push({ name: s.name, command: s.path, source: 'Windows 脚本' })

  const hasRunScript = RUN_SCRIPT_NAMES.some((n) => scripts[n])
  const hasDev = !!(scripts.dev || scripts.serve || scripts.watch || makeTargets.includes('dev') || makeTargets.includes('run'))
  const hasBuild = !!(scripts.build || makeTargets.includes('build'))
  const hasTest = !!(scripts.test || makeTargets.includes('test') || ctx.files.some((f) => /(^|\/)(jest|vitest|pytest)\.config\./i.test(f.path)))
  const hasEntry = hasRunScript || makeTargets.length > 0 || !!compose || !!procfile || winScripts.length > 0
  const libraryEntry = !!(ctx.isLibrary && (hasBuild || hasTest))
  const readme = ctx.readmeText || ''
  const installDocumented = /\b(npm (i|install|ci)|yarn( install)?|pnpm (i|install)|bun install|pip3? install|poetry install|uv sync|go mod download|cargo (build|fetch)|mvn (install|package)|gradle (build|assemble)|composer install|bundle install|dotnet restore)\b/i.test(
    readme,
  )
  const runDocumented = /\b(npm run (dev|start)|yarn (dev|start)|pnpm (dev|start)|python3? [\w./-]+\.py|go run|docker compose up|cargo run|mvn (spring-boot:)?run|make (run|dev|start))\b/i.test(
    readme,
  )

  checks.push({ key: 'run', label: '存在明确的启动入口', ok: hasEntry || libraryEntry, weight: 40 })
  checks.push({ key: 'dev', label: '提供开发/调试脚本', ok: hasDev, weight: 15 })
  checks.push({ key: 'build', label: '提供构建脚本', ok: hasBuild, weight: 10 })
  checks.push({ key: 'test', label: '提供测试脚本', ok: hasTest, weight: 10 })
  checks.push({ key: 'docker', label: '提供容器化运行方式', ok: !!(dockerfile || compose), weight: 10 })
  checks.push({ key: 'installDoc', label: 'README 写明安装命令', ok: installDocumented, weight: 10 })
  checks.push({ key: 'runDoc', label: 'README 写明启动命令', ok: runDocumented, weight: 5 })

  if (!hasEntry && !libraryEntry) {
    findings.push(
      makeFinding({
        dimension: 'scripts',
        category: 'script',
        severity: 'high',
        title: '未找到明确的启动入口',
        detail: 'package.json 没有 start/dev 脚本，也没有 Makefile / Dockerfile / Procfile 等可执行入口。',
        suggestion: '补充 npm scripts.start 或 Makefile，并在 README 中给出一条可直接复制的启动命令。',
      }),
    )
  }
  if (!hasTest) {
    findings.push(
      makeFinding({
        dimension: 'scripts',
        category: 'script',
        severity: 'low',
        title: '没有测试脚本',
        detail: '未发现 test 脚本或测试框架配置，接入后难以验证改动是否正确。',
        suggestion: '补充最小可运行的测试命令（哪怕只覆盖核心路径）。',
      }),
    )
  }
  if (!installDocumented && readme) {
    findings.push(
      makeFinding({
        dimension: 'scripts',
        category: 'script',
        severity: 'medium',
        title: 'README 未给出安装命令',
        detail: '文档里没有出现 npm install / pip install 等依赖安装命令。',
        suggestion: '在「安装」章节写明完整命令与镜像源说明。',
      }),
    )
  }

  for (const ref of windowsRefs.slice(0, 5)) {
    findings.push(
      makeFinding({
        dimension: 'portability',
        category: 'windows',
        severity: 'high',
        title: `npm 脚本 "${ref.script}" 依赖 Windows 批处理文件`,
        detail: '脚本内部调用了 .bat/.cmd/.ps1，macOS / Linux 上无法执行，接入方会被卡住。',
        file: 'package.json',
        evidence: trimEvidence(ref.command, 140),
        suggestion: '改用跨平台的 Node 脚本（node scripts/xxx.mjs）或提供 .sh 等价脚本。',
      }),
    )
  }

  return {
    score: scoreFromChecks(checks),
    checks,
    entries: entries.slice(0, 30),
    docker: { dockerfile: dockerfile?.path || null, compose: compose?.path || null },
    windowsRefs,
    findings,
  }
}
