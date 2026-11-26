/**
 * 工程规范（卫生度）：.gitignore / LICENSE / CI / .env.example
 */
import { makeFinding, scoreFromChecks } from './_common.mjs'

export function analyzeHygiene(ctx) {
  const findings = []
  const files = ctx.files
  const gitignore = files.find((f) => !f.path.includes('/') && /^\.gitignore$/i.test(f.name))
  const license = files.find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f.name))
  const ci =
    files.find((f) => /^\.github\/workflows\/.+\.ya?ml$/i.test(f.path)) ||
    files.find((f) => /^\.(gitlab-ci|travis)\.ya?ml$/i.test(f.path)) ||
    files.find((f) => /^(jenkinsfile|azure-pipelines\.ya?ml|\.drone\.ya?ml)$/i.test(f.name)) ||
    files.find((f) => /^bitbucket-pipelines\.ya?ml$/i.test(f.name))
  const envExample = files.find((f) => /(^|\/)\.env\.(example|sample|template)$/i.test(f.path))
  const editorconfig = files.find((f) => !f.path.includes('/') && /^\.editorconfig$/i.test(f.name))
  const lintConfig = files.find((f) =>
    /(^|\/)(\.eslintrc(\.(js|cjs|json|ya?ml))?|eslint\.config\.(js|mjs|cjs)|\.prettierrc(\.(js|json|ya?ml))?|prettier\.config\.(js|mjs|cjs)|\.stylelintrc|ruff\.toml|\.flake8|pylintrc|\.golangci\.ya?ml)$/i.test(
      f.path,
    ),
  )

  const needsEnv = !!ctx.readmeText && /\.env|环境变量|environment variable/i.test(ctx.readmeText)
  const checks = [
    { key: 'gitignore', label: '存在 .gitignore', ok: !!gitignore, weight: 30 },
    { key: 'license', label: '存在开源许可证', ok: !!license, weight: 30 },
    { key: 'ci', label: '存在 CI 配置', ok: !!ci, weight: 25 },
    { key: 'envExample', label: '提供 .env.example 配置样例', ok: !!envExample || !needsEnv, weight: 15 },
  ]

  if (!license) {
    findings.push(
      makeFinding({
        dimension: 'hygiene',
        category: 'hygiene',
        severity: 'low',
        title: '缺少开源许可证',
        detail: '仓库没有 LICENSE 文件，接入方在法务上无法确认可用范围。',
        suggestion: '按需添加 MIT / Apache-2.0 等许可证文件，并在 README 中注明。',
      }),
    )
  }
  if (!ci) {
    findings.push(
      makeFinding({
        dimension: 'hygiene',
        category: 'hygiene',
        severity: 'info',
        title: '未配置 CI',
        detail: '没有找到 GitHub Actions / GitLab CI 等流水线配置，接入后无法自动验证构建是否健康。',
        suggestion: '添加最小 CI：安装依赖 + 构建 + 测试。',
      }),
    )
  }
  if (needsEnv && !envExample) {
    findings.push(
      makeFinding({
        dimension: 'hygiene',
        category: 'hygiene',
        severity: 'medium',
        title: '文档要求配置环境变量，但缺少 .env.example',
        detail: 'README 提到需要环境变量/配置文件，仓库却没有可参考的样例文件，新人不知道该填哪些键。',
        suggestion: '提供 .env.example，列出所有必需的键与取值说明（不含真实值）。',
      }),
    )
  }

  return {
    score: scoreFromChecks(checks),
    checks,
    meta: {
      gitignore: gitignore?.path || null,
      license: license?.path || null,
      ci: ci?.path || null,
      envExample: envExample?.path || null,
      editorconfig: editorconfig?.path || null,
      lintConfig: lintConfig?.path || null,
    },
    findings,
  }
}
