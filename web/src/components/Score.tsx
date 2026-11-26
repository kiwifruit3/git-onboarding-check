import type { Dimension } from '../types'
import { scoreColor, scoreTone } from './ui'

export function ScoreRing({
  score,
  grade,
  gradeLabel,
  size = 190,
}: {
  score: number
  grade: string
  gradeLabel: string
  size?: number
}) {
  const R = 56
  const C = 2 * Math.PI * R
  const dash = (Math.max(0, Math.min(100, score)) / 100) * C
  const color = scoreColor(score)
  const id = `ring-${Math.round(score)}`
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 140 140" width={size} height={size} role="img" aria-label={`接入就绪度 ${score} 分`}>
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx="70" cy="70" r={R} fill="none" stroke="#eef2f7" strokeWidth="11" />
        <circle
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C}`}
          transform="rotate(-90 70 70)"
          className="ring-progress"
        />
      </svg>
      <div className="ring-center">
        <div className={`ring-score ${scoreTone(score)}`}>{score}</div>
        <div className="ring-unit">/ 100</div>
        <div className="ring-grade" style={{ color }}>
          {grade} · {gradeLabel}
        </div>
      </div>
    </div>
  )
}

export function DimensionBars({ dimensions }: { dimensions: Dimension[] }) {
  return (
    <div className="dims">
      {dimensions.map((d) => (
        <div className="dim" key={d.key} title={d.hint}>
          <div className="dim-head">
            <span className="dim-label">{d.label}</span>
            <span className="dim-weight">权重 {d.weight}%</span>
            <span className="dim-score" style={{ color: scoreColor(d.score) }}>
              {d.score}
            </span>
          </div>
          <div className="dim-track">
            <div
              className="dim-fill"
              style={{ width: `${Math.max(2, d.score)}%`, background: scoreColor(d.score) }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
