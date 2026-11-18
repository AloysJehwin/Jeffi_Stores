import { randomUUID } from 'crypto'
import { query, queryOne } from '@/lib/shared/db'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { isPlatformOwner } from '@/lib/integrations/owner'
import { getWalletBalance } from '@/lib/payments/wallet'
import {
  estimateGeneration,
  PaidGenerationError,
  runFreeGeneration,
  runPaidGeneration,
  siteRegenCapInr,
  type PaidGenerationResult,
} from '@/lib/ai/paid-generation'
import { STUDIO_BUDGET_INR } from './studio/ai'
import {
  activeRedesign,
  beatRedesign,
  bindRedesign,
  claimRedesign,
  noteRedesignCharge,
  redesignInDraft,
  releaseRedesign,
  resumableRedesign,
  startRedesignDraft,
  type RedesignInput,
  type RedesignResult,
} from './studio/redesign'

// Site Builder's "Redesign my whole site with AI", on every plan: the AI Site Studio's pipeline into a new draft
// (lib/site/studio/redesign.ts). A store's first full AI generation is free: the onboarding studio's site once
// installed, or the go-live build from the owner's brief (lib/site/onboarding-build.ts), or else the first one here,
// platform-funded on the studio's free budget. Later ones are charged to the AI wallet (lib/ai/paid-generation.ts): the
// cap held while it runs, the AI stopped at cap / margin of provider cost, the hold trued up to cost × margin. Whether
// the free one is used sits in the store's site_settings; one build runs per store at a time.

const FREE_KEY = 'site_ai_free_used_at'
const FREE_NOTE = 'When this store used its free full AI site generation'
// Stores whose first site was built before FREE_KEY existed: the onboarding build's state says it finished.
const ONBOARDING_KEY = 'site_ai_build'
const ONBOARDING_DONE = '%"status":"done"%'
// A ready-made theme installed at onboarding (onboarding-build.ts) used no AI, so it is not the free generation.
const ONBOARDING_THEME = '%"theme":true%'

/** True when this store has had its free full generation. */
export async function siteFreeGenerationUsed(): Promise<boolean> {
  const row = await queryOne<{ used: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM site_settings WHERE key = $1 OR (key = $2 AND value LIKE $3 AND value NOT LIKE $4)) AS used`,
    [FREE_KEY, ONBOARDING_KEY, ONBOARDING_DONE, ONBOARDING_THEME]
  )
  return !!row?.used
}

/** Marks the free generation used (the onboarding site is live); a no-op once marked. */
export async function markFreeSiteGenerationUsed(): Promise<void> {
  await query(
    `INSERT INTO site_settings (key, value, data_type, description, updated_at) VALUES ($1, $2, 'string', $3, now())
     ON CONFLICT (key) DO NOTHING`,
    [FREE_KEY, new Date().toISOString(), FREE_NOTE]
  )
}

// Takes the free generation for one build, or null when it is used (as siteFreeGenerationUsed reads it): two builds at
// once can't both get it. The value is this claim, so a release removes only it.
async function claimFreeGeneration(): Promise<string | null> {
  const row = await queryOne<{ value: string }>(
    `INSERT INTO site_settings (key, value, data_type, description, updated_at)
     SELECT $1::varchar, $2::text, 'string', $3::text, now()
      WHERE NOT EXISTS (SELECT 1 FROM site_settings WHERE key = $4 AND value LIKE $5 AND value NOT LIKE $6)
     ON CONFLICT (key) DO NOTHING
     RETURNING value`,
    [FREE_KEY, new Date().toISOString(), FREE_NOTE, ONBOARDING_KEY, ONBOARDING_DONE, ONBOARDING_THEME]
  )
  return row?.value ?? null
}

async function releaseFreeGeneration(claim: string): Promise<void> {
  await query(`DELETE FROM site_settings WHERE key = $1 AND value = $2`, [FREE_KEY, claim])
}

export interface SiteGenerationQuote {
  /** The next build is free: the store's first, or the platform's own store. */
  free: boolean
  /** The most a paid build charges (₹); this much is held while it runs. */
  capInr: number
  /** A typical charge (₹). */
  range: { lowInr: number; highInr: number }
  balanceInr: number
  /** What the wallet lacks to hold the cap; 0 when a paid build can start. */
  shortInr: number
}

/** What the next whole-site build costs this store, for the button. */
export async function siteGenerationQuote(): Promise<SiteGenerationQuote> {
  const tenantId = await resolveTenantId()
  const capInr = siteRegenCapInr()
  const { lowInr, highInr } = estimateGeneration('store_site', { capInr })
  const base = { capInr, range: { lowInr, highInr } }
  if (!tenantId || isPlatformOwner(tenantId) || !(await siteFreeGenerationUsed())) return { ...base, free: true, balanceInr: 0, shortInr: 0 }
  const w = await getWalletBalance(tenantId)
  return { ...base, free: false, balanceInr: w.balance, shortInr: Math.max(0, Math.round((capInr + w.minBalance - w.balance) * 100) / 100) }
}

/** What a finished build cost, kept beside its progress (lib/site/studio/redesign.ts noteRedesignCharge). */
export type SiteGenerationCharge = { free: true } | { free: false; chargedInr: number; capInr: number }

/** A build that did not start: another one of this store is running (busy), or a stopped one has nothing left to do. */
export class SiteGenerationRefused extends Error {
  readonly status = 409
  constructor(
    readonly code: 'busy' | 'not_resumable',
    message: string,
    readonly draftId: string | null = null
  ) {
    super(message)
    this.name = 'SiteGenerationRefused'
  }

  body() {
    return { error: this.message, code: this.code, draftId: this.draftId }
  }
}

/**
 * Starts a whole-site redesign into a new draft (or, with `resume`, carries a stopped one on in its own draft) and
 * returns once the draft exists; the build runs on in the background, recording its progress and then its charge on
 * the draft. A resumed free build stays free on what is left of its budget. Throws, with nothing created:
 * SiteGenerationRefused (409) while another build of the store runs; PaidGenerationError when a paid build can't hold
 * its cap (402 wallet_low), or is paid but the owner wasn't shown its price (409 price_changed: `acceptPaid` is false,
 * e.g. someone else took the free one meanwhile).
 */
export async function startSiteGeneration(
  input: RedesignInput,
  adminId: string | null,
  opts: { acceptPaid?: boolean; resume?: string } = {}
): Promise<{ draftId: string; free: boolean; capInr: number }> {
  const tenantId = await resolveTenantId()
  const platform = !tenantId || isPlatformOwner(tenantId)
  const capInr = siteRegenCapInr()
  const resumed = opts.resume ? await resumableRedesign(opts.resume) : null
  if (opts.resume && !resumed) throw new SiteGenerationRefused('not_resumable', 'That build has nothing left to carry on with.', opts.resume)
  const run = await claimRedesign(resumed?.draftId)
  if (!run) throw new SiteGenerationRefused('busy', 'A redesign of your site is already running.', (await activeRedesign().catch(() => null))?.draftId ?? null)
  let claim: string | null = null
  try {
    if (!platform && !resumed?.freeBudgetInr) claim = await claimFreeGeneration()
  } catch (err) {
    await releaseRedesign(run).catch(() => {})
    throw err
  }
  const free = platform || !!resumed?.freeBudgetInr || !!claim
  if (!free && !opts.acceptPaid) {
    await releaseRedesign(run).catch(() => {})
    throw new PaidGenerationError('price_changed', 'This build is charged to your AI wallet: check the price and start again.', 0, 0, capInr)
  }
  let opened!: (draftId: string) => void
  const draft = new Promise<string>(resolve => (opened = resolve))
  // The draft is made once the wallet hold (if any) is taken.
  const build = async () => {
    const draftId = resumed?.draftId ?? (await startRedesignDraft(adminId))
    await bindRedesign(run, draftId).catch(() => {})
    opened(draftId)
    return { draftId, build: await redesignInDraft(draftId, input, adminId, { free, resume: !!resumed, heartbeat: () => beatRedesign(run) }) }
  }
  const job: Promise<PaidGenerationResult<{ draftId: string; build: RedesignResult }>> = free
    ? runFreeGeneration('site-builder', resumed?.freeBudgetInr || STUDIO_BUDGET_INR(), build).then(r => ({ ...r, chargedInr: 0 }))
    : runPaidGeneration({ tenantId: tenantId!, capInr, ref: `site:${randomUUID()}`, label: 'Site redesign (Site Builder)' }, build)
  void job
    .then(
      async ({ result, costInr, chargedInr }) => {
        // The AI failed before spending anything: the free generation is still there.
        if (claim && costInr === 0 && !result.build.ok) await releaseFreeGeneration(claim).catch(() => {})
        const charge: SiteGenerationCharge = free ? { free: true } : { free: false, chargedInr, capInr }
        await noteRedesignCharge(result.draftId, charge)
      },
      async err => {
        // Refused, or failed before the draft opened: nothing ran.
        if (claim) await releaseFreeGeneration(claim).catch(() => {})
        if (!(err instanceof PaidGenerationError)) console.error('[site-generation]', err)
      }
    )
    .catch(err => console.error('[site-generation] charge note', err))
    .finally(() => releaseRedesign(run).catch(() => {}))
  return { draftId: await Promise.race([draft, job.then(() => draft)]), free, capInr }
}
