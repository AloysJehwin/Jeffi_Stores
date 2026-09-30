import { UserPlus, Settings2, Rocket } from 'lucide-react'
import type { ComponentType } from 'react'

interface Step {
  n: number
  title: string
  copy: string
  icon: ComponentType<{ className?: string }>
}

const STEPS: Step[] = [
  {
    n: 1,
    title: 'Sign up',
    copy: 'Create your account in minutes — no card, no setup fee.',
    icon: UserPlus,
  },
  {
    n: 2,
    title: 'We set up your store',
    copy: 'Your own subdomain with storefront and admin, plus payments, delivery and GST configured for you.',
    icon: Settings2,
  },
  {
    n: 3,
    title: 'Start selling',
    copy: 'Add your products, hit publish and go live to customers.',
    icon: Rocket,
  },
]

export default function HowItWorks() {
  return (
    <section className="w-full px-6 lg:px-12 py-16 bg-surface-elevated border-y border-border-default">
      <div className="text-center mb-12">
        <p className="ecom-accent-text font-semibold text-sm uppercase tracking-widest">How it works</p>
        <h2 className="text-4xl lg:text-5xl font-extrabold mt-3 text-foreground">Live in three steps</h2>
      </div>

      <ol className="relative grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-6 w-full">
        <span
          aria-hidden
          className="hidden md:block absolute top-7 left-[16.666%] right-[16.666%] h-px border-border-default border-t"
        />
        {STEPS.map(s => {
          const Icon = s.icon
          return (
            <li
              key={s.n}
              className="relative rounded-2xl border border-border-default bg-surface p-6 text-center shadow-sm shadow-black/[0.04]"
            >
              <span className="ecom-accent-bg relative z-10 mx-auto flex h-14 w-14 items-center justify-center rounded-full text-xl font-extrabold text-white">
                {s.n}
              </span>
              <div className="ecom-accent-text mt-4 flex items-center justify-center gap-2">
                <Icon className="h-5 w-5" />
                <h3 className="text-lg font-bold text-foreground">{s.title}</h3>
              </div>
              <p className="mt-2 text-sm text-foreground-secondary">{s.copy}</p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
