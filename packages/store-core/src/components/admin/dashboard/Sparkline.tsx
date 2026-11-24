'use client'

import { useId } from 'react'
import { acc, linePath, svgId } from './viz'

export interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  ariaLabel?: string
  className?: string
}

/** Tiny accent line with a faint area, no axes. */
export function Sparkline({ values, width = 96, height = 32, ariaLabel = 'Trend', className = '' }: SparklineProps) {
  const id = svgId(useId())
  const pts = values.filter(v => isFinite(v))
  if (pts.length < 2) {
    return (
      <svg role="img" aria-label={`${ariaLabel}: no data`} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className}>
        <line x1="0" x2={width} y1={height - 2} y2={height - 2} stroke="var(--color-border)" strokeDasharray="3 3" />
      </svg>
    )
  }
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const pad = 3
  const xy: [number, number][] = pts.map((v, i) => [(i / (pts.length - 1)) * width, pad + (height - pad * 2) * (1 - (v - min) / span)])
  const line = linePath(xy)
  return (
    <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={`overflow-visible ${className}`}>
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={acc(500)} stopOpacity=".18" />
          <stop offset="1" stopColor={acc(500)} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path data-spark="area" d={`${line} L${width} ${height} L0 ${height} Z`} fill={`url(#sp-${id})`} />
      <path data-spark="line" d={line} fill="none" stroke={acc(600)} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="2" fill={acc(600)} />
    </svg>
  )
}
