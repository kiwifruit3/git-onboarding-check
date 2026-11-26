/**
 * 依赖清单与锁文件分析。
 */
import { makeFinding, scoreFromChecks } from './_common.mjs'

const ECOSYSTEMS = [
  {
    id: 'node',
    name: 'Node.js',
    manifests: ['package.json'],
    locks: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'bun.lockb'],
  },
  {
    id: 'python',
    name: 'Python',
    manifests: ['requirements.txt', 'pyproject.toml', 'pipfile', 'setup.py', 'setup.cfg', 'environment.yml'],
    locks: ['poetry.lock', 'pipfile.lock', 'uv.lock'],
  },
  { id: 'go', name: 'Go', manifests: ['go.mod'], locks: ['go.sum'] },
  { id: 'rust', name: 'Rust', manifests: ['cargo.toml'], locks: ['cargo.lock'] },
  { id: 'java', name: 'Java', manifests: ['pom.xml', 'build.gradle', 'build.gradle.kts'], locks: [] },
  { id: 'php', name: 'PHP', manifests: ['composer.json'], locks: ['composer.lock'] },
  { id: 'ruby', name: 'Ruby', manifests: ['gemfile'], locks: ['gemfile.lock'] },
  { id: 'dotnet', name: '.NET', manifests: [], patterns: [/\.(csproj|fsproj|vbproj|sln)$/i], locks: ['packages.lock.json'] },
  { id: 'dart', name: 'Dart / Flutter', manifests: ['pubspec.yaml'], locks: ['pubspec.lock'] },
]

function findManifest(files, eco) {
  const names = new Set(eco.manifests.map((n) => n.toLowerCase()))
  const rootHit = files.find((f) => !f.path.includes('/') && names.has(f.name.toLowerCase()))
  if (rootHit) return rootHit
  if (eco.patterns) return files.find((f) => eco.patterns.some((re) => re.test(f.name))) || null
  return files.find((f) => names.has(f.name.toLowerCase())) || null
}

function findLock(files, eco) {
  const names = new Set(eco.locks.map((n) => n.toLowerCase()))
  return files.find((f) => names.has(f.name.toLowerCase())) || null
}

function inspectNode(manifest, pkgJson) {
  const deps = Object.keys(pkgJson?.dependencies || {})
  const devDeps = Object.keys(pkgJson?.devDependencies || {})
  const all = { ...(pkgJson?.dependencies || {}), ...(pkgJson?.devDependencies || {}) }
  const unpinned = []
  for (const [name, range] of Object.entries(all)) {
    const value = String(range)
    if (value === '*' || /^latest$/i.test(value) || /^>=\s*0(\.0)*$/.test(value) || value.trim() === '') {
      unpinned.push({ name, range: value })
    }
  }
  return { deps, devDeps, unpinned, valid: !!pkgJson }
}

function inspectRequirements(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  const unpinned = lines.filter((l) => !/[=<>~!]=?/.test(l) && !/^-/.test(l))
  return { count: lines.length, unpinned }
}

export function analyzeDeps(ctx) {
  const findings = []
  const checks = []
  const ecosystems = []
  const pkg = ctx.packageJson

  for (const eco of ECOSYSTEMS) {
    const manifest = findManifest(ctx.files, eco)
    if (!manifest) continue
    const lock = findLock(ctx.files, eco)
    const entry = {
      id: eco.id,
      name: eco.name,
      manifest: manifest.path,
      lockfile: lock ? lock.path : null,
      deps: 0,
      devDeps: 0,
      unpinned: [],
      valid: true,
    }

    if (eco.id === 'node') {
      if (!pkg) {
        entry.valid = false
        findings.push(
          makeFinding({
            dimension: 'deps',
            category: 'deps',
            severity: 'high',
            title: 'package.json 无法解析',
            detail: 'package.json 存在但 JSON 解析失败，依赖无法安装。',
            file: manifest.path,
            suggestion: '修复 JSON 语法（常见问题：多余逗号、注释）。',
          }),
        )
      } else {
        const info = inspectNode(manifest, pkg)
        entry.deps = info.deps.length
        entry.devDeps = info.devDeps.length
        entry.unpinned = info.unpinned.slice(0, 12)
        if (info.unpinned.length) {
          findings.push(
            makeFinding({
              dimension: 'deps',
              category: 'deps',
              severity: 'medium',
              title: `存在 ${info.unpinned.length} 个未锁定版本范围的依赖`,
              detail: '使用 * 或 latest 会导致不同时间安装出不同版本，接入环境不可复现。',
              file: manifest.path,
              evidence: info.unpinned.map((d) => `${d.name}: ${d.range}`).join('，').slice(0, 200),
              suggestion: '改为明确的语义化版本范围（如 ^1.2.3），并提交 lockfile。',
            }),
          )
        }
      }
    } else if (eco.id === 'python' && manifest.text) {
      if (/requirements\.txt$/i.test(manifest.name)) {
        const info = inspectRequirements(manifest.text)
        entry.deps = info.count
        entry.unpinned = info.unpinned.slice(0, 12)
        if (info.unpinned.length) {
          findings.push(
            makeFinding({
              dimension: 'deps',
              category: 'deps',
              severity: 'medium',
              title: `requirements.txt 中有 ${info.unpinned.length} 个依赖未固定版本`,
              file: manifest.path,
              evidence: info.unpinned.slice(0, 5).join('，'),
              suggestion: '使用 == 固定版本，或用 pip-tools / uv 生成锁文件。',
            }),
          )
        }
      }
    } else if (eco.id === 'go' && manifest.text) {
      entry.deps = (manifest.text.match(/^\s*[a-z0-9.-]+\.[a-z]{2,}\/\S+\s+v/gm) || []).length
    } else if (manifest.text) {
      entry.deps = (manifest.text.match(/^\s*["']?[\w@/.-]+["']?\s*[:=]/gm) || []).length
    }

    if (eco.locks.length && !lock && eco.id !== 'java') {
      const libraryRelaxed = ctx.isLibrary && eco.id === 'node'
      findings.push(
        makeFinding({
          dimension: 'deps',
          category: 'deps',
          severity: libraryRelaxed ? 'low' : eco.id === 'node' ? 'high' : 'medium',
          title: libraryRelaxed ? '库项目未提交锁文件（影响较小）' : `缺少锁文件（${eco.name}）`,
          detail: libraryRelaxed
            ? '这是可被依赖的库，使用方会自行锁定版本，因此未提交 lockfile 影响有限；但仓库自身开发环境仍不可复现。'
            : '只有依赖清单、没有锁文件，不同机器安装出的依赖树可能不同，接入时容易出现「我这儿能跑」。',
          file: manifest.path,
          suggestion: `提交 ${eco.locks[0]} 到仓库，并在 CI 中使用 npm ci / pip install -r 等可复现安装方式。`,
        }),
      )
    }

    ecosystems.push(entry)
  }

  const hasManifest = ecosystems.length > 0
  const hasLock = ecosystems.some((e) => e.lockfile)
  const unpinnedTotal = ecosystems.reduce((n, e) => n + e.unpinned.length, 0)

  checks.push({ key: 'manifest', label: '存在依赖清单', ok: hasManifest, weight: 45 })
  checks.push({ key: 'lock', label: '存在锁文件', ok: hasLock, weight: 25 })
  checks.push({ key: 'pinned', label: '依赖版本已固定/约束', ok: hasManifest && unpinnedTotal === 0, weight: 15 })
  checks.push({
    key: 'devSplit',
    label: '区分运行时与开发依赖',
    ok: ecosystems.some((e) => e.devDeps > 0) || ecosystems.some((e) => e.id !== 'node'),
    weight: 5,
  })
  checks.push({
    key: 'declared',
    label: '依赖数量与项目规模匹配',
    ok: hasManifest && ecosystems.some((e) => e.deps > 0),
    weight: 10,
  })

  if (!hasManifest) {
    findings.push(
      makeFinding({
        dimension: 'deps',
        category: 'deps',
        severity: 'medium',
        title: '未发现依赖清单',
        detail: '根目录没有 package.json / requirements.txt / go.mod 等文件，无法一键还原依赖。',
        suggestion: '按技术栈补充依赖清单，并在 README 中写明安装命令。',
      }),
    )
  }

  return { score: scoreFromChecks(checks), checks, ecosystems, findings }
}
