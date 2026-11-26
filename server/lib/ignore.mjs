/**
 * .repopulseignore 支持：被忽略的文件不参与规则扫描。
 *
 * 语法（够用即可，不追求完整 gitignore 语义）：
 *   demo/            忽略整个目录（任意层级同名目录）
 *   vendor/          同上
 *   *.min.js         忽略任意层级的匹配文件
 *   docs/**          按路径前缀/通配忽略
 *   fixtures/seed.json  精确路径
 *   # 开头为注释
 */
export function parseIgnore(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

function globMatch(pattern, value) {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '.')}$`)
  return re.test(value)
}

function globToRe(pattern) {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${body}$`)
}

function matchesOne(rawPattern, relPath) {
  let pattern = rawPattern.replace(/^\.\//, '')
  const dirOnly = pattern.endsWith('/')
  if (dirOnly) pattern = pattern.slice(0, -1)
  if (!pattern) return false

  const segs = relPath.split('/')

  // 不含斜杠：匹配任意层级下的同名文件 / 目录
  if (!pattern.includes('/')) {
    if (dirOnly) {
      return segs.slice(0, -1).some((seg) => globMatch(pattern, seg))
    }
    return segs.some((seg) => globMatch(pattern, seg))
  }

  // 含斜杠：按完整路径匹配，或目录前缀
  if (globToRe(pattern).test(relPath)) return true
  if (dirOnly && relPath.startsWith(`${pattern}/`)) return true
  return false
}

/** 返回命中的规则（用于报告里说明为什么被忽略），未命中返回 null */
export function matchIgnore(patterns, relPath) {
  for (const pattern of patterns) {
    if (matchesOne(pattern, relPath)) return pattern
  }
  return null
}
