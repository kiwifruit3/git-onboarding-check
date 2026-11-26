/**
 * 接入就绪度评分模型。
 *
 * 总分 = Σ(维度得分 × 权重)，权重之和为 100。
 * 权重设计依据「接入方视角的阻塞程度」：
 *  - 密钥安全与跨平台兼容最容易导致「拿到就出事」，权重最高；
 *  - 文档/依赖/启动脚本决定「能不能跑起来」；
 *  - 工程规范属于锦上添花。
 */
export const DIMENSIONS = [
  { key: 'docs', label: '文档完备度', weight: 15, hint: 'README 能否让新人独立跑起来' },
  { key: 'deps', label: '依赖可复现', weight: 15, hint: '依赖清单 + 锁文件是否齐全' },
  { key: 'scripts', label: '启动脚本', weight: 15, hint: '是否有明确的安装/启动/构建入口' },
  { key: 'portability', label: '跨平台友好', weight: 25, hint: 'Windows 专用脚本与硬编码路径' },
  { key: 'security', label: '密钥安全', weight: 25, hint: '密钥、私钥、.env 是否泄露' },
  { key: 'hygiene', label: '工程规范', weight: 5, hint: '.gitignore / LICENSE / CI / 配置样例' },
]

export const GRADES = [
  { min: 85, grade: 'A', label: '可直接接入', tone: 'great', verdict: '工程状态健康，按 README 即可完成接入，建议关注少量低危项。' },
  { min: 70, grade: 'B', label: '小改后可接入', tone: 'good', verdict: '整体可用，存在若干中低风险项，建议接入前先完成风险清单中的高优先级整改。' },
  { min: 55, grade: 'C', label: '需要整改', tone: 'warn', verdict: '存在影响接入效率的问题（文档/依赖/平台差异），建议整改后再交给接入方。' },
  { min: 40, grade: 'D', label: '风险较高', tone: 'bad', verdict: '多个关键项缺失或存在安全隐患，直接接入大概率踩坑，建议先做专项整改。' },
  { min: 0, grade: 'E', label: '不建议直接接入', tone: 'worst', verdict: '存在严重阻塞项（安全泄露 / 完全无法启动），不建议在整改前接入。' },
]

export function gradeFor(total) {
  return GRADES.find((g) => total >= g.min) || GRADES[GRADES.length - 1]
}

/**
 * @param {object} parts 各维度原始分
 */
export function computeScore(parts) {
  const dimensions = DIMENSIONS.map((dim) => {
    const raw = Math.max(0, Math.min(100, Math.round(Number(parts[dim.key]) || 0)))
    return {
      key: dim.key,
      label: dim.label,
      hint: dim.hint,
      weight: dim.weight,
      score: raw,
      weighted: Math.round(raw * dim.weight) / 100,
    }
  })
  const total = Math.round(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) / 100)
  const grade = gradeFor(total)
  return { total, grade: grade.grade, gradeLabel: grade.label, tone: grade.tone, verdict: grade.verdict, dimensions }
}

export function buildHighlights(parts, findings) {
  const items = []
  if (parts.docs >= 80) items.push({ label: '文档完备', detail: 'README 结构完整，包含安装与运行说明' })
  if (parts.deps >= 80) items.push({ label: '依赖可复现', detail: '依赖清单与锁文件齐全，版本约束明确' })
  if (parts.scripts >= 80) items.push({ label: '启动路径清晰', detail: '存在明确的安装/启动/构建脚本' })
  if (parts.portability >= 85) items.push({ label: '跨平台友好', detail: '未发现 Windows 专用脚本或硬编码绝对路径' })
  if (parts.security >= 90) items.push({ label: '未发现密钥泄露', detail: '扫描未命中硬编码密钥、私钥或 .env 入库' })
  if (parts.hygiene >= 80) items.push({ label: '工程规范齐全', detail: '.gitignore / LICENSE / CI 配置完备' })
  if (!items.length && findings.length === 0) items.push({ label: '未发现明显问题', detail: '基础扫描未命中风险规则' })
  return items.slice(0, 4)
}
