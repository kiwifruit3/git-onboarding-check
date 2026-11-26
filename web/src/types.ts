export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type Confidence = 'high' | 'medium' | 'low'

export interface Dimension {
  key: string
  label: string
  hint: string
  weight: number
  score: number
  weighted: number
}

export interface Finding {
  id: string
  dimension: string
  category: string
  severity: Severity
  title: string
  detail: string
  file: string
  line: number
  evidence: string
  suggestion: string
  confidence: Confidence
}

export interface Check {
  key: string
  label: string
  ok: boolean
  weight: number
}

export interface WindowsScript {
  path: string
  ext: string
  size: number
  firstLine: string
  referencedInReadme: boolean
  hasUnixEquivalent: boolean
}

export interface PathHit {
  file: string
  line: number
  match: string
  rule: string
  ruleLabel: string
  severity: Severity
  confidence: Confidence
}

export interface SecretHit {
  file: string
  line: number
  rule: string
  ruleLabel: string
  severity: Severity
  confidence: Confidence
  masked: string
  context: string
  suggestion: string
}

export interface Ecosystem {
  id: string
  name: string
  manifest: string
  lockfile: string | null
  deps: number
  devDeps: number
  unpinned: Array<{ name: string; range: string }>
  valid: boolean
}

export interface ScriptEntry {
  name: string
  command: string
  source: string
}

export interface AdviceItem {
  title: string
  detail: string
  severity: Severity
  dimension?: string
  action?: string
}

export interface AiAdvice {
  enabled: boolean
  source: string
  provider: string
  model?: string
  generatedAt?: string
  verdict: string
  summary: string
  advice: AdviceItem[]
  steps: string[]
  note?: string
  error?: string
}

export interface DemoSummary {
  id: string
  slug: string
  score: number
  grade: string
  gradeLabel: string
  commitShort: string
  analyzedAt: string
  riskTotal: number
  counts: Record<Severity, number>
}

export interface Report {
  schemaVersion: number
  meta: {
    repo: { owner: string; name: string; slug: string; host: string; provider: string; webUrl: string; cloneUrl: string }
    branch: string
    commit: string
    commitShort: string
    commitUrl: string
    analyzedAt: string
    durationMs: number
    source: { strategy: string; cached: boolean; via: string }
    cached: boolean
    stale?: boolean
    staleReason?: string
    demo?: boolean
    demoNote?: string
    scanner: { name: string; version: string; schemaVersion: number }
  }
  score: {
    total: number
    grade: string
    gradeLabel: string
    tone: string
    verdict: string
    dimensions: Dimension[]
    highlights: Array<{ label: string; detail: string }>
  }
  stats: {
    files: number
    textFiles: number
    sizeBytes: number
    truncated: boolean
    skippedDirs?: number
    ignored?: number
    ignorePatterns?: string[]
    readmeChars: number
    depsCount: number
    ecosystems: string[]
    windowsScripts: number
    pathHits: number
    pathFiles: number
    secretHits: number
    critical: number
    high: number
    medium: number
    low: number
    riskTotal: number
  }
  risk: {
    counts: Record<Severity, number>
    total: number
    top: Finding[]
    all: Finding[]
  }
  sections: {
    readme: {
      score: number
      checks: Check[]
      meta: {
        path: string | null
        chars: number
        headings: number
        codeBlocks: number
        images: number
        badges: number
        language: string
        sections: Record<string, boolean>
      }
      findings: Finding[]
    }
    deps: { score: number; checks: Check[]; ecosystems: Ecosystem[]; findings: Finding[] }
    scripts: {
      score: number
      checks: Check[]
      entries: ScriptEntry[]
      docker: { dockerfile: string | null; compose: string | null }
      findings: Finding[]
    }
    windows: {
      score: number
      checks: Check[]
      scripts: WindowsScript[]
      stats: { total: number; byExt: Record<string, number>; referencedCount: number; windowsOnly: boolean }
      findings: Finding[]
    }
    paths: {
      score: number
      hits: PathHit[]
      files: Array<{ path: string; count: number; worst: Severity; rules: string[] }>
      stats: { total: number; files: number; byRule: Array<{ id: string; label: string; count: number }>; truncated: boolean }
      findings: Finding[]
    }
    secrets: {
      score: number
      checks: Check[]
      hits: SecretHit[]
      stats: {
        total: number
        critical: number
        high: number
        reviewNeeded: number
        envFiles: string[]
        secretFiles: string[]
        byRule: Array<{ label: string; count: number }>
      }
      findings: Finding[]
    }
    hygiene: {
      score: number
      checks: Check[]
      meta: Record<string, string | null>
      findings: Finding[]
    }
  }
  scan: {
    dirs: Array<{ name: string; count: number }>
    files: Array<{ path: string; kind: string; size: number }>
  }
  ai: AiAdvice | null
}
