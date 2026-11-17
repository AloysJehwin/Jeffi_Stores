'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import OnboardShell from '../OnboardShell'
import PageHeader from '../../dashboard/_components/PageHeader'
import { ghostBtn, noteCls, primaryBtn, secondaryBtn } from '../ui'
import type { RailStep } from '../steps'
import type { StudioView } from '../_studio/api'
import { SHOWCASE_HOST_PREFIX, SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import type { ClientSite } from '@controller/lib/showcase-builder/site'
import BusinessFields from './_builder/BusinessFields'
import ContentFields from './_builder/ContentFields'
import ShowcaseStudio from './_builder/ShowcaseStudio'
import ThemesEntry from './_builder/ThemesEntry'
import ShowcaseThemes from '../_studio/ShowcaseThemes'
import PublishPanel, { type Published } from './_builder/PublishPanel'
import { detailsProblem } from './_builder/model'
import { useShowcaseDetails } from './_builder/useShowcaseDetails'

// The Showcase signup: Details (the business, how people reach it, what the page shows), then the site (the AI studio
// in Showcase mode, ready-made themes later) and Publish. Everything autosaves to the draft site and the studio
// session, so the owner can leave and come back to the same place.

const STEPS: RailStep[] = [
  { label: 'Details', icon: 'workspace', desc: 'Your business' },
  { label: 'Your site', icon: 'site', desc: 'Designed live by AI' },
]

const hasAnyContent = (c: ClientSite['content'] | undefined) => !!c && (c.services.length + c.work.length + c.reviews.length + c.stats.length + c.faqs.length > 0)

export default function ShowcaseOnboard({
  owner,
  initialSite,
  siteUrl,
}: {
  owner: { email: string; name: string | null }
  initialSite: ClientSite | null
  /** Where the site opens once published (null until it has an address). */
  siteUrl: string | null
}) {
  const { showToast } = useToast()
  const d = useShowcaseDetails(initialSite, owner.email)
  const slugOk = d.slug.state === 'ok'
  const problem = detailsProblem(d.form, slugOk)
  const [step, setStep] = useState(() => (initialSite && !detailsProblem(d.form, true) ? 1 : 0))
  const [slugTouched, setSlugTouched] = useState(!!initialSite)
  const [continuing, setContinuing] = useState(false)
  const [studio, setStudio] = useState<StudioView | null>(null)
  // Bumped when a ready-made theme becomes the page, so the studio reloads it.
  const [studioKey, setStudioKey] = useState(0)
  const [published, setPublished] = useState<Published | null>(null)
  const top = useRef<HTMLDivElement>(null)

  // Braces: scrollIntoView returns a Promise in newer browsers, and an effect may only return a clean-up.
  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' })
  }, [step, published])

  async function next() {
    if (problem) return showToast(problem, 'error')
    setContinuing(true)
    const ok = await d.saveNow()
    setContinuing(false)
    if (!ok) return showToast(d.saveError?.error ?? 'Your details could not be saved. Try again.', 'error')
    setStep(1)
  }

  const page = studio?.session?.pages?.[SHOWCASE_PAGE_KEY]
  const ready = (!!page && page.sections.length > 0 && studio?.session?.status !== 'building') || (!studio && !!d.site?.hasPage)
  const host = d.form.slug ? `${SHOWCASE_HOST_PREFIX}${d.form.slug}.jeffistores.in` : 'Your Showcase'
  const site = d.site

  return (
    <OnboardShell
      owner={owner}
      heading={d.form.business.name.trim() || 'Your Showcase'}
      subheading={host}
      steps={STEPS}
      current={published ? STEPS.length : step}
      groupTitle="Showcase"
      onSelect={i => setStep(i)}
      saving={d.saving}
    >
      <div ref={top} className="w-full scroll-mt-24">
        {published ? (
          <div className="mx-auto max-w-xl py-6 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 org-sage-text" />
            <h1 className="mt-4 font-display text-3xl font-black text-foreground">{published.first ? 'Your site is live' : 'Your changes are live'}</h1>
            <p className="mt-2 text-sm text-foreground-secondary">
              <a href={published.url} target="_blank" rel="noopener noreferrer" className="font-mono text-foreground underline">
                {published.url.replace(/^https?:\/\//, '')}
              </a>
              {published.first ? '. Share it anywhere: enquiries from its form come to you as leads.' : '.'}
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <a href={published.url} target="_blank" rel="noopener noreferrer" className={primaryBtn}>
                Open your site <ExternalLink className="h-4 w-4" />
              </a>
              {published.site.tenantId ? (
                <a href="/dashboard/showcase/edit" className={secondaryBtn}>
                  Go to your dashboard
                </a>
              ) : (
                <button type="button" onClick={() => setPublished(null)} className={secondaryBtn}>
                  Keep editing
                </button>
              )}
            </div>
          </div>
        ) : step === 0 ? (
          <>
            <PageHeader eyebrow="Showcase" title="Your business" description="What your page says about you. Only the name, the address and one way to reach you are needed now; add the rest whenever you like." />
            <BusinessFields form={d.form} setForm={d.setForm} slug={d.slug} slugLocked={!!site && site.status !== 'draft'} slugTouched={slugTouched} onSlugTouched={() => setSlugTouched(true)} />
            <h2 className="mb-1 mt-10 font-display text-xl font-black text-foreground">What your page shows</h2>
            <p className="mb-4 text-sm text-foreground-secondary">All optional, and you can add them later. The AI designs a section for each one you fill in.</p>
            <ContentFields form={d.form} setForm={d.setForm} />
            <div className="sticky bottom-0 z-10 -mx-1 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border-default bg-surface px-1 py-4">
              <p className="min-w-0 text-xs text-foreground-muted" aria-live="polite">
                {d.saveError && d.saveError.field !== 'slug' ? <span className="text-[#8a2e1f]">{d.saveError.error}</span> : d.saving ? 'Saving…' : site ? 'Saved' : problem ?? ''}
              </p>
              <button type="button" onClick={next} disabled={continuing} className={primaryBtn}>
                {continuing ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Continue <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </>
        ) : (
          <>
            <PageHeader eyebrow="Showcase" title="Your site" description="Design your page with AI: it is built around your details, your work and what clients say. Your first design is free." />
            <div className="space-y-4">
              <ThemesEntry>
                <ShowcaseThemes
                  name={d.form.business.name.trim() || 'Your business'}
                  view={studio}
                  onApplied={v => {
                    setStudio(v)
                    setStudioKey(k => k + 1)
                  }}
                />
              </ThemesEntry>
              <ShowcaseStudio key={studioKey} businessName={d.form.business.name} logoUrl={d.form.business.logo || null} hasContent={hasAnyContent(d.form.content)} onView={setStudio} />
              <PublishPanel site={site} ready={ready} blocker={problem} siteUrl={siteUrl} onPublished={p => setPublished(p)} />
              {problem && <p className={`${noteCls} org-peach text-foreground`}>{problem} Go back to Details to finish them.</p>}
            </div>
            <div className="mt-6">
              <button type="button" onClick={() => setStep(0)} className={ghostBtn}>
                <ArrowLeft className="h-4 w-4" /> Details
              </button>
            </div>
          </>
        )}
      </div>
    </OnboardShell>
  )
}
