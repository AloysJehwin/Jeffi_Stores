'use client'

import { useState } from 'react'
import { ExternalLink, Image as ImageIcon, LayoutTemplate, Store } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import PageHeader from '../../_components/PageHeader'
import { Segmented } from '../../../_ui'
import { noteCls, secondaryBtn } from '../../../onboard/ui'
import type { StudioView } from '../../../onboard/_studio/api'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import type { ClientSite } from '@controller/lib/showcase-builder/site'
import BusinessFields from '../../../onboard/showcase/_builder/BusinessFields'
import ContentFields from '../../../onboard/showcase/_builder/ContentFields'
import ShowcaseStudio from '../../../onboard/showcase/_builder/ShowcaseStudio'
import ThemesEntry from '../../../onboard/showcase/_builder/ThemesEntry'
import ShowcaseThemes from '../../../onboard/_studio/ShowcaseThemes'
import PublishPanel from '../../../onboard/showcase/_builder/PublishPanel'
import { detailsProblem } from '../../../onboard/showcase/_builder/model'
import { useShowcaseDetails } from '../../../onboard/showcase/_builder/useShowcaseDetails'

// The dashboard's Showcase editor. Design: the studio in Showcase mode (live preview, the section outline to drag,
// the picked section's words and pictures, AI changes, "Design this page again" charged to the wallet). Details and
// Content: the same fields as the signup, saved to the site as they change. Publish puts design changes live.

type Tab = 'design' | 'details' | 'content'

export default function ShowcaseEditor({ owner, initialSite, siteUrl }: { owner: { email: string }; initialSite: ClientSite; siteUrl: string }) {
  const { showToast } = useToast()
  const d = useShowcaseDetails(initialSite, owner.email)
  const [tab, setTab] = useState<Tab>('design')
  const [studio, setStudio] = useState<StudioView | null>(null)
  // Applying a theme replaces the page: the studio remounts to load it.
  const [studioKey, setStudioKey] = useState(0)
  const site = d.site ?? initialSite
  const problem = detailsProblem(d.form, d.slug.state === 'ok')
  const page = studio?.session?.pages?.[SHOWCASE_PAGE_KEY]
  const ready = (!!page && page.sections.length > 0 && studio?.session?.status !== 'building') || (!studio && site.hasPage)
  const c = d.form.content
  const hasContent = c.services.length + c.work.length + c.reviews.length + c.stats.length + c.faqs.length > 0
  const live = site.status !== 'draft'

  return (
    <>
      <PageHeader
        eyebrow="Showcase"
        title="Edit your site"
        description={
          live
            ? 'Changes to your details and content show on your site within a minute. Design changes go live when you publish them.'
            : 'Your site is a draft: design it, then publish it to put it live.'
        }
        actions={
          live && (
            <a href={siteUrl} target="_blank" rel="noopener noreferrer" className={secondaryBtn}>
              Open site <ExternalLink className="h-4 w-4" />
            </a>
          )
        }
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Tab>
          ariaLabel="What to edit"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'design', label: 'Design', icon: LayoutTemplate },
            { value: 'details', label: 'Details', icon: Store },
            { value: 'content', label: 'Content', icon: ImageIcon },
          ]}
        />
        <span className="text-xs text-foreground-muted" aria-live="polite">
          {d.saveError && d.saveError.field !== 'slug' ? <span className="text-[#8a2e1f]">{d.saveError.error}</span> : d.saving ? 'Saving…' : d.dirty ? 'Unsaved changes' : 'All changes saved'}
        </span>
      </div>

      <div className="space-y-4">
        {/* The studio stays mounted while the owner edits details, so its preview and outline keep their place. */}
        <div hidden={tab !== 'design'} className="space-y-4">
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
          <ShowcaseStudio key={studioKey} businessName={d.form.business.name} logoUrl={d.form.business.logo || null} hasContent={hasContent} onView={setStudio} />
          <PublishPanel
            site={site}
            ready={ready}
            blocker={problem}
            siteUrl={siteUrl}
            onPublished={p => {
              d.setSite(p.site)
              showToast(p.first ? 'Your site is live.' : 'Your changes are live.', 'success')
            }}
          />
        </div>
        {tab === 'details' && (
          <>
            {problem && <p className={`${noteCls} org-peach text-foreground`}>{problem}</p>}
            <BusinessFields form={d.form} setForm={d.setForm} slug={d.slug} slugLocked={live} slugTouched onSlugTouched={() => {}} />
          </>
        )}
        {tab === 'content' && <ContentFields form={d.form} setForm={d.setForm} />}
      </div>
    </>
  )
}
