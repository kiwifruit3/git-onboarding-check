#!/usr/bin/env node
/**
 * 规则单测：在临时目录构造一个「问题仓库」，断言六类规则都能命中预期问题。
 * 不依赖网络，可放进 CI。
 *
 *   node scripts/test-rules.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { analyzeDeps } from '../server/lib/rules/deps.mjs'
import { analyzeHygiene } from '../server/lib/rules/hygiene.mjs'
import { analyzePaths } from '../server/lib/rules/paths.mjs'
import { analyzeReadme } from '../server/lib/rules/readme.mjs'
import { analyzeScripts } from '../server/lib/rules/scripts.mjs'
import { analyzeSecrets } from '../server/lib/rules/secrets.mjs'
import { analyzeWindows } from '../server/lib/rules/windows.mjs'
import { computeScore } from '../server/lib/score.mjs'
import { collectFiles } from '../server/lib/walk.mjs'

const README = `# Demo App

一个用于测试接入体检规则的小项目。

## 环境要求

Node.js >= 18

## 安装

\`\`\`bash
npm install
\`\`\`

## 使用

\`\`\`bash
npm run dev
\`\`\`

## 配置

复制 .env.example 为 .env 后填写。

## License

MIT
`

const PACKAGE_JSON = JSON.stringify(
  {
    name: 'demo-app',
    version: '1.0.0',
    scripts: { start: 'node index.js', test: 'node test.js' },
    dependencies: { express: '^4.18.0', lodash: '*' },
  },
  null,
  2,
)

const APP_JS = `const baseDir = "C:\\\\Users\\\\alice\\\\projects\\\\demo";
const apiKey = "sk-proj-9fK2mQ7pLx4vN8sR3tY6wB1cD5gH0jZ";
module.exports = { baseDir, apiKey };
`

const WINDOWS_BAT = '@echo off\r\ncd /d D:\\work\\demo\r\nnpm run dev\r\n'

const ENV_FILE = 'OPENAI_API_KEY=sk-proj-Zzzz1111Yyyy2222Xxxx3333Wwww4444\n'

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures += 1
    console.error(`  ✗ ${name}\n    ${error.message}`)
  }
}

const root = await mkdtemp(path.join(os.tmpdir(), 'repopulse-test-'))
try {
  await mkdir(path.join(root, 'src'), { recursive: true })
  await mkdir(path.join(root, 'scripts'), { recursive: true })
  await writeFile(path.join(root, 'README.md'), README)
  await writeFile(path.join(root, 'package.json'), PACKAGE_JSON)
  await writeFile(path.join(root, 'src', 'app.js'), APP_JS)
  await writeFile(path.join(root, 'scripts', 'start.bat'), WINDOWS_BAT)
  await writeFile(path.join(root, '.env'), ENV_FILE)
  await writeFile(path.join(root, '.gitignore'), 'node_modules/\n')
  await writeFile(path.join(root, 'index.js'), 'console.log("hi")\n')

  const { files, stats } = await collectFiles(root)
  const readmeFile = files.find((f) => f.name === 'README.md')
  const ctx = {
    files,
    stats,
    packageJson: JSON.parse(PACKAGE_JSON),
    packageJsonPath: 'package.json',
    readmeText: readmeFile?.text || '',
    readmePath: 'README.md',
    isLibrary: false,
  }

  console.log(`\n临时仓库：${root}\n文件数：${files.length}\n`)

  console.log('README 规则')
  const readme = analyzeReadme(ctx)
  check('能识别 README 并给出章节覆盖', () => {
    assert.ok(readme.meta.path === 'README.md')
    assert.ok(readme.meta.sections.install, '应识别安装章节')
    assert.ok(readme.meta.sections.usage, '应识别使用章节')
    assert.ok(readme.score >= 60, `README 得分应 >= 60，实际 ${readme.score}`)
  })

  console.log('依赖规则')
  const deps = analyzeDeps(ctx)
  check('识别 Node 依赖清单并提示未锁定版本', () => {
    assert.equal(deps.ecosystems[0].id, 'node')
    assert.ok(deps.findings.some((f) => f.title.includes('未锁定')), '应提示 lodash: * 未锁定')
    assert.ok(deps.findings.some((f) => f.title.includes('锁文件')), '应提示缺少锁文件')
  })

  console.log('启动脚本规则')
  const scripts = analyzeScripts(ctx)
  check('识别 start 入口且不误报「缺少启动入口」', () => {
    assert.ok(scripts.entries.some((e) => e.name === 'start'))
    assert.ok(!scripts.findings.some((f) => f.title.includes('未找到明确的启动入口')))
  })

  console.log('Windows 脚本规则')
  const windows = analyzeWindows(ctx)
  check('识别 .bat 并判定无跨平台等价脚本', () => {
    assert.equal(windows.stats.total, 1)
    assert.equal(windows.stats.byExt.bat, 1)
    assert.equal(windows.stats.windowsOnly, true)
    assert.ok(windows.findings.some((f) => f.title.includes('只有 Windows 脚本')))
  })

  console.log('硬编码路径规则')
  const paths = analyzePaths(ctx)
  check('命中 C:\\Users\\alice 与 D:\\work', () => {
    const normalized = paths.hits.map((h) => h.match.replace(/\\\\/g, '\\'))
    assert.ok(paths.stats.total >= 2, `应至少命中 2 处，实际 ${paths.stats.total}`)
    assert.ok(normalized.some((m) => m.startsWith('C:\\Users\\alice')), `未命中 C:\\Users\\alice：${normalized.join(' | ')}`)
    assert.ok(normalized.some((m) => m.startsWith('D:\\work')), `未命中 D:\\work：${normalized.join(' | ')}`)
  })

  console.log('密钥规则')
  const secrets = analyzeSecrets(ctx)
  check('命中硬编码 sk- 密钥与 .env 入库', () => {
    assert.ok(secrets.hits.some((h) => h.rule === 'openai'), '应命中 OpenAI Key')
    assert.ok(secrets.hits.some((h) => h.rule === 'env-committed'), '应命中 .env 入库')
    assert.ok(
      secrets.hits.every((h) => !h.masked.includes('9fK2mQ7pLx4vN8sR3tY6wB1cD5gH0jZ')),
      '证据必须脱敏，不能包含完整密钥',
    )
    assert.ok(
      secrets.hits.every((h) => !h.context.includes('9fK2mQ7pLx4vN8sR3tY6wB1cD5gH0jZ')),
      '上下文必须脱敏，导出报告不能泄露原始密钥',
    )
  })

  console.log('工程规范规则')
  const hygiene = analyzeHygiene(ctx)
  check('识别 .gitignore 与缺失的 LICENSE / CI', () => {
    assert.ok(hygiene.meta.gitignore === '.gitignore')
    assert.equal(hygiene.meta.license, null)
    assert.ok(hygiene.findings.some((f) => f.title.includes('许可证')))
  })

  console.log('评分模型')
  check('权重合计为 100 且能算出等级', () => {
    const score = computeScore({
      docs: readme.score,
      deps: deps.score,
      scripts: scripts.score,
      portability: Math.round(windows.score * 0.45 + paths.score * 0.55),
      security: secrets.score,
      hygiene: hygiene.score,
    })
    const weightSum = score.dimensions.reduce((n, d) => n + d.weight, 0)
    assert.equal(weightSum, 100)
    assert.ok(score.total >= 0 && score.total <= 100)
    assert.ok(['A', 'B', 'C', 'D', 'E'].includes(score.grade))
    assert.ok(score.dimensions.length === 6)
  })

  console.log('')
  if (failures) {
    console.error(`✗ ${failures} 项断言失败`)
    process.exitCode = 1
  } else {
    console.log('✓ 全部规则断言通过')
  }
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
