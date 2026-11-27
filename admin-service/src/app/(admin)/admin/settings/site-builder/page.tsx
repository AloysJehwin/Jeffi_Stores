import { PageHeader } from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'
import { queryOne } from '@/lib/shared/db'
import { getHost } from '@/lib/tenancy/get-host'
import { getHomepagePlan } from '@/lib/catalog/homepage-plan'
import { loadHeroData, loadSectionOptions } from '@/lib/catalog/homepage-editor-options'
import { listCustomPages, listSiteDrafts, siteBuilderEnabled, siteEditorEnabled } from '@/lib/site/store'
import { getOnboardingBuild } from '@/lib/site/onboarding-build'
import SiteBuilderEditor from '@/components/admin/site-builder/SiteBuilderEditor'
import SiteBuilderSwitch from '@/components/admin/site-builder/SiteBuilderSwitch'
import { storeHasApp } from '@/lib/site/app-surface'
import SiteBuilderTabs from '@/components/admin/site-builder/SiteBuilderTabs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SiteBuilderPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const params = await searchParams
  const host = await getHost()
  const [live, started, drafts, hero, plan, customPages, aiBuild, visual, hasApp] = await Promise.all([
    siteBuilderEnabled(),
    queryOne<{ n: string }>(`SELECT count(*) AS n FROM site_pages`).then(r => Number(r?.n ?? 0) > 0).catch(() => false),
    listSiteDrafts(),
    loadHeroData(),
    getHomepagePlan(),
    listCustomPages(),
    getOnboardingBuild(),
    siteEditorEnabled(),
    storeHasApp(),
  ])
  const options = started ? await loadSectionOptions(hero.categoryOptions, hero.brandOptions) : null

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader
        title="Site Builder"
        description="Every customer page, laid out per device from blocks. Changes are saved as a draft and go live when you publish."
      />
      <SiteBuilderTabs active="site" live={live ? 'site' : 'homepage'} siteHref={ap('/admin/settings/site-builder', host)} homepageHref={ap('/admin/settings/homepage', host)} siteStarted={started} />
      {aiBuild && (
        <div className="rounded-xl border border-accent-500/40 bg-surface-elevated px-4 py-3 text-sm">
          {aiBuild.status === 'done' && (
            <>
              <p className="font-semibold text-foreground">Your AI-built site</p>
              <p className="text-foreground-secondary mt-0.5">
                The AI built your first site in the {aiBuild.style} style: {aiBuild.pages} pages{aiBuild.pictures ? ` and ${aiBuild.pictures} pictures` : ''}. Change anything in a draft below, or ask the AI to rewrite a page or a block.
              </p>
            </>
          )}
          {aiBuild.status === 'running' && <p className="text-foreground-secondary">The AI is building your first site: {aiBuild.step ?? 'working'}…</p>}
          {aiBuild.status === 'failed' && <p className="text-foreground-secondary">The AI could not finish your first site. Build one below with “Redesign my whole site with AI”, or start from a template.</p>}
        </div>
      )}
      {started && !live && (
        <p className="text-sm text-foreground-muted">Customers see the Block builder. Publishing here saves your Site builder pages; they reach customers when you make Site builder live.</p>
      )}
      {started && options ? (
        <SiteBuilderEditor
          options={options}
          planTypes={plan.types}
          business={plan.business}
          initialDraftId={params.draft && /^[0-9a-f-]{36}$/.test(params.draft) ? params.draft : null}
          live={live}
          customPages={customPages}
          drafts={drafts}
          visual={visual}
          hasApp={hasApp}
        />
      ) : (
        <SiteBuilderSwitch target="site" live={false} setup />
      )}
    </div>
  )
}
