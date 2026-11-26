/**
 * 文件遍历与分类。
 * 目标：在可控内存/时间下，拿到「值得扫描」的文本文件全集。
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  'third_party',
  '3rdparty',
  'dist',
  'build',
  'out',
  'output',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  'target',
  'obj',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  'coverage',
  '.nyc_output',
  '.cache',
  '.idea',
  '.vscode',
  '.gradle',
  'Pods',
  '.terraform',
  'logs',
  'tmp',
  'temp',
])

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'tif', 'tiff', 'psd',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'avi',
  'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war', 'whl', 'egg', 'so', 'dylib',
  'dll', 'exe', 'bin', 'dat', 'db', 'sqlite', 'sqlite3', 'pdf', 'doc', 'docx', 'xls',
  'xlsx', 'ppt', 'pptx', 'class', 'pyc', 'pyd', 'o', 'a', 'lib', 'wasm', 'node',
])

const CODE_EXT = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'py', 'go', 'java',
  'kt', 'kts', 'cs', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'rb', 'php', 'rs', 'swift', 'dart',
  'scala', 'pl', 'lua', 'r', 'jl', 'ex', 'exs', 'clj', 'groovy', 'sh', 'bash', 'zsh', 'fish',
  'ps1', 'psm1', 'bat', 'cmd', 'vbs', 'vb', 'sql', 'proto', 'graphql', 'gql',
])

const DOC_EXT = new Set(['md', 'markdown', 'mdx', 'rst', 'txt', 'adoc', 'asciidoc', 'org', 'textile'])

const CONFIG_EXT = new Set([
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config', 'env',
  'xml', 'properties', 'gradle', 'plist', 'editorconfig', 'npmrc', 'nvmrc', 'htaccess',
])

const LOCK_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'bun.lockb',
  'go.sum', 'cargo.lock', 'poetry.lock', 'pipfile.lock', 'composer.lock', 'gemfile.lock',
  'packages.lock.json', 'flake.lock', 'pubspec.lock', 'mix.lock',
])

const MAX_FILES = 12_000
const MAX_TEXT_BYTES = 512 * 1024
const MAX_TOTAL_TEXT_BYTES = 48 * 1024 * 1024

export function fileKind(relPath) {
  const base = path.posix.basename(relPath).toLowerCase()
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : ''
  if (LOCK_FILES.has(base)) return 'lock'
  if (/\.min\.(js|css)$/.test(base) || base.endsWith('.map')) return 'minified'
  if (base === '.gitignore' || base === '.gitattributes' || base === '.dockerignore' || base === '.npmignore') {
    return 'meta'
  }
  if (/^(dockerfile|makefile|procfile|jenkinsfile|vagrantfile|justfile|cmakelists\.txt)$/.test(base)) return 'config'
  if (base.startsWith('.env')) return 'config'
  if (DOC_EXT.has(ext)) return 'doc'
  if (CODE_EXT.has(ext)) return 'code'
  if (CONFIG_EXT.has(ext)) return 'config'
  if (BINARY_EXT.has(ext)) return 'binary'
  return 'other'
}

function isBinaryBuffer(buf) {
  const limit = Math.min(buf.length, 8000)
  for (let i = 0; i < limit; i += 1) {
    if (buf[i] === 0) return true
  }
  return false
}

/**
 * @returns {{files: Array, stats: object}}
 */
export async function collectFiles(root) {
  const files = []
  const stack = ['']
  let totalBytes = 0
  let textBytes = 0
  let skippedDirs = 0
  let truncated = false

  while (stack.length) {
    const relDir = stack.pop()
    let entries
    try {
      entries = await readdir(path.join(root, relDir), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true
        break
      }
      const name = entry.name
      const rel = relDir ? `${relDir}/${name}` : name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name.toLowerCase())) {
          skippedDirs += 1
          continue
        }
        stack.push(rel)
        continue
      }
      if (!entry.isFile()) continue

      let size = 0
      try {
        size = (await stat(path.join(root, rel))).size
      } catch {
        continue
      }
      totalBytes += size
      const kind = fileKind(rel)
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''

      const file = {
        path: rel,
        name,
        ext,
        kind,
        size,
        text: null,
        hash: '',
        lines: 0,
      }

      const scannable =
        size <= MAX_TEXT_BYTES &&
        kind !== 'binary' &&
        kind !== 'minified' &&
        !/\.(lock)$/i.test(name) &&
        textBytes < MAX_TOTAL_TEXT_BYTES

      if (scannable) {
        try {
          const buf = await readFile(path.join(root, rel))
          if (!isBinaryBuffer(buf)) {
            file.text = buf.toString('utf8')
            file.lines = file.text.split('\n').length
            file.hash = createHash('sha256').update(buf).digest('hex')
            textBytes += buf.length
          }
        } catch {
          /* 忽略单个文件读取失败 */
        }
      }
      files.push(file)
    }
    if (files.length >= MAX_FILES) {
      truncated = true
      break
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path))

  return {
    files,
    stats: {
      totalFiles: files.length,
      textFiles: files.filter((f) => f.text).length,
      totalBytes,
      textBytes,
      skippedDirs,
      truncated,
    },
  }
}

/** 按文件名查找（大小写不敏感），返回第一个匹配 */
export function findByName(files, names) {
  const set = new Set(names.map((n) => n.toLowerCase()))
  return files.find((f) => set.has(f.name.toLowerCase()) && !f.path.includes('/')) || null
}

/** 按文件名查找（含子目录） */
export function findAllByName(files, names) {
  const set = new Set(names.map((n) => n.toLowerCase()))
  return files.filter((f) => set.has(f.name.toLowerCase()))
}

/** 按扩展名过滤 */
export function byExt(files, exts) {
  const set = new Set(exts.map((e) => e.toLowerCase()))
  return files.filter((f) => set.has(f.ext))
}
