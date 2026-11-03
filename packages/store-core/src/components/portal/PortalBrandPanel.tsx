import CheckMark from '@/components/ui/CheckMark'

export interface BrandPanelProps {
  badge: string
  heading: string
  points: string[]
  footnote?: string
}

// Desktop-only value panel (left half of the split sign-in screen).
export default function PortalBrandPanel({ badge, heading, points, footnote }: BrandPanelProps) {
  return (
    <div className="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-accent-600 to-primary-600 text-white p-12">
      <div
        aria-hidden
        className="absolute inset-0 opacity-10 bg-[linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] bg-[size:40px_40px]"
      />
      <span className="relative flex items-center gap-2 font-bold text-lg">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/20 backdrop-blur text-white">
          J
        </span>
        {badge}
      </span>
      <div className="relative">
        <h2 className="text-4xl font-extrabold leading-tight">{heading}</h2>
        <ul className="mt-8 space-y-3">
          {points.map(p => (
            <li key={p} className="flex items-center gap-3 text-white/90">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/20">
                <CheckMark className="w-3 h-3 text-white" />
              </span>
              {p}
            </li>
          ))}
        </ul>
      </div>
      {footnote && <p className="relative text-sm text-white/70">{footnote}</p>}
    </div>
  )
}
