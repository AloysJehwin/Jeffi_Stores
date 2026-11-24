import { UserPlus, Settings2, Rocket } from 'lucide-react'
import type { ComponentType } from 'react'
import { Eyebrow, Display, NumberBadge } from '../_ui'
import { fromLabel } from './plan-facts'

interface Step {
  n: number
  title: string
  copy: string
  icon: ComponentType<{ className?: string }>
}

// Step 1 names the lowest plan price when it can be computed.
function steps(fromInr: number | null): Step[] {
  return [
    {
      n: 1,
      title: 'Sign up',
      copy: `Create your account, add your business details and pick a plan${fromInr ? `, from ${fromLabel(fromInr)}` : ''}.`,
      icon: UserPlus,
    },
    {
      n: 2,
      title: 'We review and set up your store',
      copy: 'We check your details, then set up your subdomain, storefront and admin, with payments, delivery and GST configured.',
      icon: Settings2,
    },
    {
      n: 3,
      title: 'Start selling',
      copy: 'Your store goes live 1–2 business days after review. Add your products and start taking orders.',
      icon: Rocket,
    },
  ]
}

export default function HowItWorks({ fromInr }: { fromInr: number | null }) {
  return (
    <section className="w-full px-4 sm:px-6 lg:px-12 py-12 sm:py-20">
      <Eyebrow>How it works</Eyebrow>
      <Display className="mt-3 text-3xl sm:text-4xl lg:text-5xl">Live in three steps</Display>
      <ol className="mt-8 sm:mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-10 md:gap-8 w-full">
        {steps(fromInr).map((s, i) => (
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
