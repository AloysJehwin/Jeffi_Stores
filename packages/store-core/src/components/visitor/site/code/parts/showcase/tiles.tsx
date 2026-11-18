import { Quote, Star } from 'lucide-react'
import type { FaqView, ServiceView, StatView, TestimonialView, WorkView } from '@/lib/showcase/views'
import Accordion, { AccordionItem } from '../../islands/Accordion'
import { CodeImage, CodeLink } from '../../common/tiles'

// Server renderers behind the Showcase parts (lib/site/code/parts/showcase.tsx), used when a section draws an item
// without its own render function. Every class is literal, so the apps' Tailwind build has it.

export function ServiceCard({ s, aspect, priority }: { s: ServiceView; aspect?: string; priority?: boolean }) {
  return (
    <article className="ui-card flex h-full flex-col overflow-hidden rounded-xl border border-border-default bg-surface-elevated text-foreground">
      {s.image && <CodeImage src={s.image} alt={s.title} aspect={aspect ?? '4:3'} sizes="(min-width: 768px) 33vw, 100vw" priority={priority} />}
      <div className="flex flex-1 flex-col gap-2 p-5">
        <h3 className="ui-heading font-display text-lg font-semibold">{s.title}</h3>
        {s.description && <p className="text-base text-foreground-secondary">{s.description}</p>}
        {s.price && <p className="mt-auto pt-2 text-sm font-semibold text-primary-700">{s.price}</p>}
      </div>
    </article>
  )
}

export function WorkTile({ w, aspect, priority }: { w: WorkView; aspect?: string; priority?: boolean }) {
  const body = (
    <figure className="group relative overflow-hidden rounded-[var(--radius-card,0.75rem)] bg-surface-secondary">
      <CodeImage src={w.image} alt={w.title || 'Our work'} aspect={aspect ?? '1:1'} sizes="(min-width: 768px) 33vw, 50vw" priority={priority} className="transition-transform duration-500 group-hover:scale-[1.03]" />
      {(w.title || w.description) && (
        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-white">
          {w.title && <span className="block text-sm font-semibold">{w.title}</span>}
          {w.description && <span className="mt-0.5 block text-xs text-white/80">{w.description}</span>}
        </figcaption>
      )}
    </figure>
  )
  return w.link ? (
    <CodeLink href={w.link} target="_blank" className="block">
      {body}
    </CodeLink>
  ) : (
    body
  )
}

export function TestimonialCard({ t }: { t: TestimonialView }) {
  return (
    <figure className="ui-card flex h-full flex-col rounded-xl border border-border-default bg-surface-elevated p-6 text-foreground">
      <Quote aria-hidden className="h-6 w-6 text-accent-500" />
      {t.rating != null && (
        <div className="mt-3 flex gap-0.5 text-accent-500" aria-label={`${t.rating} out of 5`}>
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} aria-hidden className={`h-4 w-4 ${i < t.rating! ? 'fill-current' : 'opacity-30'}`} />
          ))}
        </div>
      )}
      <blockquote className="mt-3 flex-1 text-base text-foreground-secondary">“{t.quote}”</blockquote>
      <figcaption className="mt-5 flex items-center gap-3">
        {t.avatar ? (
          <CodeImage src={t.avatar} alt="" aspect="1:1" sizes="40px" className="h-10 w-10 rounded-full" />
        ) : (
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 font-semibold text-primary-700">
            {t.initial}
          </span>
        )}
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{t.name}</span>
          {t.source && <span className="block text-xs text-foreground-muted">{t.source}</span>}
        </span>
      </figcaption>
    </figure>
  )
}

export function StatTile({ s }: { s: StatView }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="ui-heading font-display text-4xl font-bold text-primary-700 md:text-5xl">{s.value}</span>
      <span className="text-sm text-foreground-secondary">{s.label}</span>
    </div>
  )
}

export function FaqList({ faqs, multiple, defaultOpen, className }: { faqs: FaqView[]; multiple: boolean; defaultOpen: boolean; className?: string }) {
  return (
    <Accordion multiple={multiple} defaultOpen={defaultOpen} className={className}>
      {faqs.map((f, i) => (
        <AccordionItem key={i} title={f.question} first={i === 0}>
          <p className="whitespace-pre-line">{f.answer}</p>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
