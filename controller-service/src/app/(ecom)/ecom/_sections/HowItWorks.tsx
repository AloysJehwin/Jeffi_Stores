import { UserPlus, Settings2, Rocket } from 'lucide-react'
import type { ComponentType } from 'react'
import { Eyebrow, Display, NumberBadge } from '../_ui'

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
    <section className="w-full px-4 sm:px-6 lg:px-12 py-12 sm:py-20">
      <Eyebrow>How it works</Eyebrow>
      <Display className="mt-3 text-3xl sm:text-4xl lg:text-5xl">Live in three steps</Display>
      <ol className="mt-8 sm:mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-10 md:gap-8 w-full">
        {STEPS.map((s, i) => (
          <li key={s.n} className="flex items-start gap-4 md:block">
            <NumberBadge n={s.n} tone={i === 2 ? 'sage' : 'peach'} className="shrink-0 max-md:w-12 max-md:h-12 max-md:text-lg" />
            <div className="min-w-0">
              <h3 className="font-display font-black text-xl sm:text-2xl text-foreground mt-2.5 md:mt-6">{s.title}</h3>
              <p className="mt-2 md:mt-3 text-base text-foreground-secondary leading-relaxed">{s.copy}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
