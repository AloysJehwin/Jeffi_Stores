'use client'

import { motion } from 'motion/react'

const ACCENT = '#2563eb'
const TRACK = '#cbd5e1'
const IDLE = '#94a3b8'

interface TimelineStep {
  label: string
  at: string
  done: boolean
}

interface ShipmentMapProps {
  stage: string
  timeline: TimelineStep[]
  awb?: string
  reduced?: boolean
}

const STAGES = ['created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'] as const
type Stage = (typeof STAGES)[number]

const STAGE_LABELS: Record<Stage, string> = {
  created: 'Placed',
  picked_up: 'Packed',
  in_transit: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
}

const TIMELINE_STEPS: { key: Stage; label: string }[] = STAGES.map((key) => ({
  key,
  label: STAGE_LABELS[key],
}))

// Cubic path from warehouse (left) to destination (right) as an S-curve.
const ROUTE_D = 'M 34 118 C 130 40, 250 190, 366 96'
// Sampled points along ROUTE_D, one per stage, for placing courier + stops.
const STOPS: { x: number; y: number }[] = [
  { x: 34, y: 118 },
  { x: 128, y: 84 },
  { x: 200, y: 118 },
  { x: 292, y: 128 },
  { x: 366, y: 96 },
]

function stageIndex(stage: string): number {
  const i = STAGES.indexOf(stage as Stage)
  return i < 0 ? 0 : i
}

function progressForStage(idx: number): number {
  return STAGES.length <= 1 ? 1 : idx / (STAGES.length - 1)
}

export default function ShipmentMap({ stage, timeline, awb, reduced }: ShipmentMapProps) {
  const currentIdx = stageIndex(stage)
  const progress = progressForStage(currentIdx)
  const delivered = currentIdx >= STAGES.length - 1

  const atFor = (label: string): string => {
    const match = timeline.find((t) => t.label.toLowerCase() === label.toLowerCase())
    return match?.at ?? ''
  }
  const doneFor = (idx: number): boolean => idx <= currentIdx

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <span className="ecom-accent-bg inline-flex h-7 items-center rounded-md px-2 text-xs font-semibold text-white">
            Delhivery
          </span>
          <span className="text-xs font-medium text-slate-500">Surface Express</span>
        </div>
        {awb ? (
          <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] font-semibold text-slate-700">
            AWB {awb}
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-[1.4fr_1fr]">
        <div className="relative min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white">
          <svg
            viewBox="0 0 400 200"
            preserveAspectRatio="xMidYMid meet"
            className="h-full w-full"
            role="img"
            aria-label="Delivery route from warehouse to destination"
          >
            <path
              d={ROUTE_D}
              fill="none"
              stroke={TRACK}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray="2 8"
            />
            <motion.path
              d={ROUTE_D}
              fill="none"
              stroke={ACCENT}
              strokeWidth={3}
              strokeLinecap="round"
              initial={reduced ? false : { pathLength: 0 }}
              animate={{ pathLength: progress }}
              transition={reduced ? { duration: 0 } : { duration: 1.1, ease: 'easeInOut' }}
            />

            {STOPS.map((pt, i) => {
              const active = doneFor(i)
              return (
                <g key={STAGES[i]}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={5}
                    fill={active ? ACCENT : '#ffffff'}
                    stroke={active ? ACCENT : TRACK}
                    strokeWidth={2}
                  />
                </g>
              )
            })}

            <WarehousePin x={STOPS[0].x} y={STOPS[0].y} />
            <DestinationPin x={STOPS[STAGES.length - 1].x} y={STOPS[STAGES.length - 1].y} active={delivered} />

            {reduced ? (
              <CourierDot x={STOPS[currentIdx].x} y={STOPS[currentIdx].y} pulse={false} />
            ) : (
              <motion.g
                animate={{
                  x: [STOPS[Math.max(0, currentIdx - 1)].x, STOPS[currentIdx].x],
                  y: [STOPS[Math.max(0, currentIdx - 1)].y, STOPS[currentIdx].y],
                }}
                transition={{ duration: 1.1, ease: 'easeInOut' }}
              >
                <CourierDot x={0} y={0} pulse={!delivered} />
              </motion.g>
            )}
          </svg>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            <span>Warehouse</span>
            <span>{STAGE_LABELS[STAGES[currentIdx]]}</span>
            <span>Destination</span>
          </div>
        </div>

        <ol className="flex min-h-0 flex-col justify-between gap-1 overflow-hidden">
          {TIMELINE_STEPS.map((step, i) => {
            const done = doneFor(i)
            const isCurrent = i === currentIdx && !delivered
            const at = atFor(step.label)
            return (
              <li key={step.key} className="flex items-start gap-3">
                <div className="flex flex-col items-center self-stretch">
                  <span className="relative flex h-5 w-5 items-center justify-center">
                    {isCurrent && !reduced ? (
                      <motion.span
                        className="absolute inset-0 rounded-full"
                        style={{ backgroundColor: ACCENT }}
                        animate={{ opacity: [0.5, 0], scale: [1, 1.9] }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
                      />
                    ) : null}
                    <span
                      className="relative h-3 w-3 rounded-full border-2"
                      style={{
                        backgroundColor: done ? ACCENT : '#ffffff',
                        borderColor: done ? ACCENT : IDLE,
                      }}
                    />
                  </span>
                  {i < TIMELINE_STEPS.length - 1 ? (
                    <span
                      className="w-0.5 flex-1"
                      style={{ backgroundColor: i < currentIdx ? ACCENT : TRACK }}
                    />
                  ) : null}
                </div>
                <div className="pb-2">
                  <p
                    className="text-sm font-semibold leading-tight"
                    style={{ color: done ? '#0f172a' : IDLE }}
                  >
                    {step.label}
                  </p>
                  <p className="text-[11px] leading-tight text-slate-400">
                    {done ? at || 'Completed' : isCurrent ? 'In progress' : 'Pending'}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

function CourierDot({ x, y, pulse }: { x: number; y: number; pulse: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {pulse ? (
        <motion.circle
          r={9}
          fill={ACCENT}
          opacity={0.25}
          animate={{ r: [8, 15], opacity: [0.3, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
        />
      ) : null}
      <circle r={8} fill="#ffffff" stroke={ACCENT} strokeWidth={2} />
      <g transform="translate(-5 -4)" fill={ACCENT}>
        <rect x={0} y={2} width={6} height={5} rx={1} />
        <path d="M6 3 h2.4 l1.6 2 v2 h-4 z" />
        <circle cx={2.2} cy={7.6} r={1.1} fill="#ffffff" stroke={ACCENT} strokeWidth={0.8} />
        <circle cx={7.8} cy={7.6} r={1.1} fill="#ffffff" stroke={ACCENT} strokeWidth={0.8} />
      </g>
    </g>
  )
}

function WarehousePin({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x - 9} ${y - 22})`} fill={ACCENT}>
      <path d="M0 8 L9 2 L18 8 V16 H0 Z" opacity={0.9} />
      <rect x={6} y={10} width={6} height={6} fill="#ffffff" />
    </g>
  )
}

function DestinationPin({ x, y, active }: { x: number; y: number; active: boolean }) {
  const fill = active ? ACCENT : IDLE
  return (
    <g transform={`translate(${x} ${y - 24})`}>
      <path
        d="M0 0 C7 0 11 5 11 10 C11 16 0 24 0 24 C0 24 -11 16 -11 10 C-11 5 -7 0 0 0 Z"
        fill={fill}
      />
      <circle cx={0} cy={10} r={4} fill="#ffffff" />
    </g>
  )
}
