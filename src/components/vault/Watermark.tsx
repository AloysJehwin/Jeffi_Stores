'use client'

// A tiled, translucent identity watermark laid over protected content. It won't survive a
// determined screenshot editor, but it makes casual re-sharing traceable and visibly deters it.

export interface WatermarkInfo {
  buyer: string
  store: string
  timestamp: string
}

export default function Watermark({ info }: { info: WatermarkInfo }) {
  const label = `${info.buyer} · ${info.store} · ${info.timestamp}`
  const cell = (
    <span className="select-none whitespace-nowrap text-[11px] font-medium text-white/35">{label}</span>
  )
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      style={{ mixBlendMode: 'difference' }}
    >
      <div
        className="grid h-full w-full"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', alignContent: 'start', gap: '96px 24px', transform: 'rotate(-28deg) scale(1.6)' }}
      >
        {Array.from({ length: 120 }).map((_, i) => (
          <div key={i} className="flex justify-center">{cell}</div>
        ))}
      </div>
    </div>
  )
}
