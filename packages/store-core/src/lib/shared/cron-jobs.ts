// Single source of truth for the in-app scheduler (src/instrumentation.ts), the run recorder
// (/api/internal/cron-record) and the admin status page (/api/admin/cron/status). A job that is
// scheduled but missing here is rejected by the recorder with 400 and its history is lost.

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export interface CronJob {
  id: string
  name: string
  path: string
  method: 'GET' | 'POST'
  intervalMs: number
  intervalLabel: string
  /** First run after boot; staggered so a cold instance does not fire everything at once. */
  startDelayMs: number
  /** Redis lock TTL, slightly shorter than the interval so it expires before the next tick. */
  lockTtlMs: number
  /**
   * Plan scope a TENANT must hold for this job to run against its store; null = platform-only
   * (control-plane / infra jobs). Drives the per-tenant fan-out.
   */
  tenantScope: string | null
  /** Only from the k8s CronJobs, never the in-process scheduler (the feed pushes ran from a host crontab before). */
  k8sOnly?: boolean
}

export const CRON_JOBS: readonly CronJob[] = [
  {
    id: 'delhivery_sync',
    name: 'Delhivery status sync',
    path: '/api/admin/delhivery/sync-statuses',
    method: 'POST',
    intervalMs: 10 * MIN,
    intervalLabel: 'every 10 min',
    startDelayMs: 30 * SEC,
    lockTtlMs: 10 * MIN - 30 * SEC,
    tenantScope: 'delhivery:read',
  },
  {
    id: 'cancel_stale_orders',
    name: 'Cancel stale orders',
    path: '/api/cron/cancel-stale-orders',
    method: 'GET',
    intervalMs: MIN,
    intervalLabel: 'every 1 min',
    startDelayMs: 45 * SEC,
    lockTtlMs: MIN - 5 * SEC,
    tenantScope: 'orders:read',
  },
  {
    id: 'sweep_auto_tasks',
    name: 'Sweep auto tasks',
    path: '/api/cron/sweep-auto-tasks',
    method: 'GET',
    intervalMs: 30 * MIN,
    intervalLabel: 'every 30 min',
    startDelayMs: 90 * SEC,
    lockTtlMs: 30 * MIN - 30 * SEC,
    tenantScope: 'tasks:read',
  },
  {
    id: 'dispatch_mailer',
    name: 'Dispatch mailer',
    path: '/api/cron/dispatch-mailer',
    method: 'GET',
    intervalMs: MIN,
    intervalLabel: 'every 1 min',
    startDelayMs: 60 * SEC,
    lockTtlMs: MIN - 5 * SEC,
    tenantScope: 'mailer:read',
  },
  {
    id: 'run_campaigns',
    name: 'Run campaigns',
    path: '/api/cron/run-campaigns',
    method: 'GET',
    intervalMs: 30 * MIN,
    intervalLabel: 'every 30 min',
    startDelayMs: 120 * SEC,
    lockTtlMs: 30 * MIN - 30 * SEC,
    tenantScope: 'campaigns:read',
  },
  {
    id: 'compute_health',
    name: 'Compute store health',
    path: '/api/cron/compute-health',
    method: 'GET',
    intervalMs: 30 * MIN,
    intervalLabel: 'every 30 min',
    startDelayMs: 150 * SEC,
    lockTtlMs: 30 * MIN - 30 * SEC,
    tenantScope: 'crm:read',
  },
  {
    id: 'daily_briefing',
    name: 'Daily ops email',
    path: '/api/cron/daily-briefing',
    method: 'GET',
    intervalMs: HOUR,
    intervalLabel: 'hourly (sends at the hour set in Site Controls)',
    startDelayMs: 3 * MIN,
    lockTtlMs: HOUR - MIN,
    tenantScope: 'dashboard:read',
  },
  {
    id: 'provisioning_worker',
    name: 'Provisioning worker',
    path: '/api/internal/provisioning/worker',
    method: 'GET',
    intervalMs: 45 * SEC,
    intervalLabel: 'every 45 s',
    startDelayMs: 90 * SEC,
    lockTtlMs: 45 * SEC - 5 * SEC,
    tenantScope: null,
  },
  {
    id: 'import_worker',
    name: 'Bulk import worker',
    path: '/api/internal/import/worker',
    method: 'GET',
    intervalMs: 45 * SEC,
    intervalLabel: 'every 45 s',
    startDelayMs: 105 * SEC,
    lockTtlMs: 45 * SEC - 5 * SEC,
    tenantScope: null,
  },
  {
    // Moves customer domains along TXT check → certificate → live (lib/domains/verify-cron.ts).
    id: 'custom_domain_verify',
    name: 'Custom domain verification',
    path: '/api/internal/domains/verify-cron',
    method: 'POST',
    intervalMs: 10 * MIN,
    intervalLabel: 'every 10 min',
    startDelayMs: 150 * SEC,
    lockTtlMs: 10 * MIN - 30 * SEC,
    tenantScope: null,
  },
  {
    // Bought domains: wallet charge → registration → DNS → certificates (lib/domains/orders.ts).
    id: 'domain_orders',
    name: 'Domain purchases',
    path: '/api/internal/domains/orders-cron',
    method: 'POST',
    intervalMs: 5 * MIN,
    intervalLabel: 'every 5 min',
    startDelayMs: 165 * SEC,
    lockTtlMs: 5 * MIN - 30 * SEC,
    tenantScope: null,
  },
  {
    // Yearly renewals of bought domains from the wallet; unpaid ones expire (lib/domains/renewal.ts).
    id: 'domain_renew',
    name: 'Renew bought domains',
    path: '/api/internal/domains/renew-cron',
    method: 'POST',
    intervalMs: DAY,
    intervalLabel: 'every 24 h',
    startDelayMs: 255 * SEC,
    lockTtlMs: HOUR,
    tenantScope: null,
  },
  {
    // Daily S3 dump of each database on a store's own server, checked hourly (lib/provisioning/node-db-backup.ts).
    id: 'node_db_backup',
    name: 'Store server database backups',
    path: '/api/internal/tenants/backup-node-dbs',
    method: 'POST',
    intervalMs: HOUR,
    intervalLabel: 'hourly (each store database once a day)',
    startDelayMs: 285 * SEC,
    lockTtlMs: HOUR - MIN,
    tenantScope: null,
  },
  {
    id: 'provisioning_reconcile',
    name: 'Provisioning drift sweep',
    path: '/api/internal/provisioning/reconcile',
    method: 'POST',
    intervalMs: HOUR,
    intervalLabel: 'every 1 h',
    startDelayMs: 210 * SEC,
    lockTtlMs: HOUR - MIN,
    tenantScope: null,
  },
  {
    // Platform job: one run walks every tenant on auto-renew (charges are control-plane wallet debits).
    id: 'ad_free_renew',
    name: 'Renew ad-free add-on',
    path: '/api/cron/ad-free-renew',
    method: 'POST',
    intervalMs: DAY,
    intervalLabel: 'every 24 h',
    startDelayMs: 240 * SEC,
    lockTtlMs: HOUR,
    tenantScope: null,
  },
  {
    // Platform job, like ad_free_renew: one run walks every tenant on auto-renew.
    id: 'messaging_addon_renew',
    name: 'Renew SMS & WhatsApp add-on',
    path: '/api/cron/messaging-addon-renew',
    method: 'POST',
    intervalMs: DAY,
    intervalLabel: 'every 24 h',
    startDelayMs: 250 * SEC,
    lockTtlMs: HOUR,
    tenantScope: null,
  },
  {
    id: 'publish_social_posts',
    name: 'Publish social posts',
    path: '/api/cron/publish-social-posts',
    method: 'GET',
    intervalMs: MIN,
    intervalLabel: 'every 1 min',
    startDelayMs: 240 * SEC,
    lockTtlMs: MIN - 5 * SEC,
    tenantScope: 'campaigns:read',
  },
  {
    id: 'customer_notes_digest',
    name: 'Customer notes digest',
    path: '/api/cron/customer-notes-digest',
    method: 'GET',
    intervalMs: DAY,
    intervalLabel: 'every 24 h',
    startDelayMs: 200 * SEC,
    lockTtlMs: DAY - MIN,
    tenantScope: 'customers:read',
  },
  {
    id: 'loyalty_reconcile',
    name: 'Loyalty points',
    path: '/api/cron/loyalty-reconcile',
    method: 'GET',
    intervalMs: 30 * MIN,
    intervalLabel: 'every 30 min',
    startDelayMs: 165 * SEC,
    lockTtlMs: 30 * MIN - 30 * SEC,
    tenantScope: 'campaigns:read',
  },
  {
    id: 'sweep_idle_sessions',
    name: 'Sweep idle admin sessions',
    path: '/api/cron/sweep-sessions',
    method: 'GET',
    intervalMs: 5 * MIN,
    intervalLabel: 'every 5 min',
    startDelayMs: 75 * SEC,
    lockTtlMs: 5 * MIN - 30 * SEC,
    tenantScope: 'dashboard:read',
  },
  {
    id: 'embed_sync',
    name: 'Product embeddings sync',
    path: '/api/cron/embed-sync',
    method: 'GET',
    intervalMs: 30 * MIN,
    intervalLabel: 'every 30 min',
    startDelayMs: 180 * SEC,
    lockTtlMs: 30 * MIN - 30 * SEC,
    tenantScope: 'ai:storefront',
  },
  {
    id: 'google_ads_sync',
    name: 'Google Ads nightly sync',
    path: '/api/cron/google-ads-sync',
    method: 'GET',
    intervalMs: DAY,
    intervalLabel: 'every 24 h',
    startDelayMs: 270 * SEC,
    lockTtlMs: DAY - MIN,
    tenantScope: 'google_ads:read',
  },
  {
    id: 'google_ads_refresh',
    name: 'Google Ads intraday refresh',
    path: '/api/cron/google-ads-refresh',
    method: 'GET',
    intervalMs: 3 * HOUR,
    intervalLabel: 'every 3 h',
    startDelayMs: 300 * SEC,
    lockTtlMs: 3 * HOUR - MIN,
    tenantScope: 'google_ads:read',
  },
  {
    id: 'google_ads_conversions',
    name: 'Google Ads conversion uploads',
    path: '/api/cron/google-ads-conversions',
    method: 'GET',
    intervalMs: 30 * MIN,
    intervalLabel: 'every 30 min',
    startDelayMs: 330 * SEC,
    lockTtlMs: 30 * MIN - 30 * SEC,
    tenantScope: 'google_ads:read',
  },
  {
    id: 'google_ads_audiences',
    name: 'Google Ads Customer Match lists',
    path: '/api/cron/google-ads-audiences',
    method: 'GET',
    intervalMs: DAY,
    intervalLabel: 'every 24 h',
    startDelayMs: 345 * SEC,
    lockTtlMs: DAY - MIN,
    tenantScope: 'google_ads:read',
  },
  {
    id: 'google_ads_digest',
    name: 'Google Ads weekly digest',
    path: '/api/cron/google-ads-digest',
    method: 'GET',
    intervalMs: 7 * DAY,
    intervalLabel: 'every 7 days',
    startDelayMs: 360 * SEC,
    lockTtlMs: DAY - MIN,
    tenantScope: 'google_ads:read',
  },
  {
    id: 'gmc_reports',
    name: 'Google Merchant reports and account',
    path: '/api/cron/gmc-reports',
    method: 'GET',
    intervalMs: DAY,
    intervalLabel: 'every 24 h',
    startDelayMs: 375 * SEC,
    lockTtlMs: DAY - MIN,
    tenantScope: 'merchant_sync:read',
  },
  {
    id: 'gmc_status_refresh',
    name: 'Google Merchant product status refresh',
    path: '/api/cron/gmc-status-refresh',
    method: 'GET',
    intervalMs: 6 * HOUR,
    intervalLabel: 'every 6 h',
    startDelayMs: 390 * SEC,
    lockTtlMs: 6 * HOUR - MIN,
    tenantScope: 'merchant_sync:read',
  },
  {
    id: 'amazon_pricing',
    name: 'Amazon Buy Box and repricer',
    path: '/api/cron/amazon-pricing',
    method: 'GET',
    intervalMs: HOUR,
    intervalLabel: 'every 1 h',
    startDelayMs: 405 * SEC,
    lockTtlMs: HOUR - MIN,
    tenantScope: 'amazon:read',
  },
  {
    id: 'amazon_fees',
    name: 'Amazon fee estimates',
    path: '/api/cron/amazon-fees',
    method: 'GET',
    intervalMs: DAY,
    intervalLabel: 'every 24 h',
    startDelayMs: 420 * SEC,
    lockTtlMs: DAY - MIN,
    tenantScope: 'amazon:read',
  },
  {
    id: 'amazon_status',
    name: 'Amazon listing status refresh',
    path: '/api/cron/amazon-status',
    method: 'GET',
    intervalMs: 6 * HOUR,
    intervalLabel: 'every 6 h',
    startDelayMs: 435 * SEC,
    lockTtlMs: 6 * HOUR - MIN,
    tenantScope: 'amazon:read',
  },
  {
    id: 'amazon_orders',
    name: 'Amazon order import',
    path: '/api/cron/amazon-orders',
    method: 'GET',
    intervalMs: 15 * MIN,
    intervalLabel: 'every 15 min',
    startDelayMs: 450 * SEC,
    lockTtlMs: 15 * MIN - 30 * SEC,
    tenantScope: 'amazon:read',
  },
  {
    id: 'amazon_stock',
    name: 'Amazon stock push',
    path: '/api/cron/amazon-stock',
    method: 'GET',
    intervalMs: 15 * MIN,
    intervalLabel: 'every 15 min',
    startDelayMs: 465 * SEC,
    lockTtlMs: 15 * MIN - 30 * SEC,
    tenantScope: 'amazon:read',
  },
  {
    id: 'amazon_reports',
    name: 'Amazon sales, traffic and settlement reports',
    path: '/api/cron/amazon-reports',
    method: 'GET',
    intervalMs: 6 * HOUR,
    intervalLabel: 'every 6 h',
    startDelayMs: 480 * SEC,
    lockTtlMs: 6 * HOUR - MIN,
    tenantScope: 'amazon:read',
  },
  {
    // Nightly feed pushes (admin routes; the route takes the cron bearer, middleware lets it through).
    id: 'merchant_sync',
    name: 'Google Merchant feed sync',
    path: '/api/admin/merchant/sync',
    method: 'GET',
    intervalMs: DAY,
    intervalLabel: 'daily',
    startDelayMs: 720 * SEC,
    lockTtlMs: DAY - MIN,
    tenantScope: 'merchant_sync:read',
    k8sOnly: true,
  },
  {
    id: 'amazon_sync',
    name: 'Amazon catalog feed sync',
    path: '/api/admin/merchant/amazon/sync',
    method: 'GET',
    intervalMs: DAY,
    intervalLabel: 'daily',
    startDelayMs: 735 * SEC,
    lockTtlMs: DAY - MIN,
    tenantScope: 'amazon:read',
    k8sOnly: true,
  },
  {
    id: 'amazon_ads_sync',
    name: 'Amazon Ads sync and reports',
    path: '/api/cron/amazon-ads-sync',
    method: 'GET',
    intervalMs: 3 * HOUR,
    intervalLabel: 'every 3 h',
    startDelayMs: 495 * SEC,
    lockTtlMs: 3 * HOUR - MIN,
    tenantScope: 'amazon_ads:read',
  },
  {
    id: 'meta_ads_sync',
    name: 'Meta Ads sync',
    path: '/api/cron/meta-ads-sync',
    method: 'GET',
    intervalMs: 3 * HOUR,
    intervalLabel: 'every 3 h',
    startDelayMs: 510 * SEC,
    lockTtlMs: 3 * HOUR - MIN,
    tenantScope: 'meta_ads:read',
  },
  {
    id: 'social_insights',
    name: 'Social post metrics and alerts',
    path: '/api/cron/social-insights',
    method: 'GET',
    intervalMs: 6 * HOUR,
    intervalLabel: 'every 6 h',
    startDelayMs: 540 * SEC,
    lockTtlMs: 6 * HOUR - MIN,
    tenantScope: 'social:read',
  },
  {
    id: 'social_inbox',
    name: 'Social comments and reviews',
    path: '/api/cron/social-inbox',
    method: 'GET',
    intervalMs: 15 * MIN,
    intervalLabel: 'every 15 min',
    startDelayMs: 555 * SEC,
    lockTtlMs: 15 * MIN - 30 * SEC,
    tenantScope: 'social:read',
  },
  {
    id: 'social_autopost',
    name: 'Social auto-post rules',
    path: '/api/cron/social-autopost',
    method: 'GET',
    intervalMs: 15 * MIN,
    intervalLabel: 'every 15 min',
    startDelayMs: 570 * SEC,
    lockTtlMs: 15 * MIN - 30 * SEC,
    tenantScope: 'social:write',
  },
  {
    id: 'meta_capi',
    name: 'Meta Conversions API purchases',
    path: '/api/cron/meta-capi',
    method: 'GET',
    intervalMs: 15 * MIN,
    intervalLabel: 'every 15 min',
    startDelayMs: 525 * SEC,
    lockTtlMs: 15 * MIN - 30 * SEC,
    tenantScope: 'meta_ads:read',
  },
  {
    id: 'prune_push_devices',
    name: 'Prune stale push devices',
    path: '/api/cron/prune-push-devices',
    method: 'GET',
    intervalMs: 7 * DAY,
    intervalLabel: 'every 7 days',
    startDelayMs: 585 * SEC,
    lockTtlMs: DAY - MIN,
    tenantScope: 'dashboard:read',
  },
  {
    id: 'support_away_notify',
    name: 'Support replies the customer has not seen',
    path: '/api/cron/support-away-notify',
    method: 'GET',
    intervalMs: MIN,
    intervalLabel: 'every 1 min',
    startDelayMs: 75 * SEC,
    lockTtlMs: MIN - 5 * SEC,
    tenantScope: 'customers:read',
  },
  {
    id: 'drive_purge_trash',
    name: 'Empty Drive trash (30 days)',
    path: '/api/cron/drive-purge-trash',
    method: 'GET',
    intervalMs: DAY,
    intervalLabel: 'daily',
    startDelayMs: 615 * SEC,
    lockTtlMs: DAY - MIN,
    tenantScope: 'dashboard:read',
  },
  {
    id: 'razorpay_settlements',
    name: 'Razorpay settlements sync',
    path: '/api/cron/razorpay-settlements',
    method: 'GET',
    intervalMs: 6 * HOUR,
    intervalLabel: 'every 6 h',
    startDelayMs: 630 * SEC,
    lockTtlMs: 6 * HOUR - 5 * MIN,
    tenantScope: 'financial:read',
  },
  {
    id: 'razorpay_sweep',
    name: 'Razorpay missed-payment sweep',
    path: '/api/cron/razorpay-sweep',
    method: 'GET',
    intervalMs: 15 * MIN,
    intervalLabel: 'every 15 min',
    startDelayMs: 645 * SEC,
    lockTtlMs: 15 * MIN - 30 * SEC,
    tenantScope: 'orders:read',
  },
  {
    id: 'upi_sweep',
    name: 'UPI missed-payment sweep',
    path: '/api/cron/upi-sweep',
    method: 'GET',
    intervalMs: 10 * MIN,
    intervalLabel: 'every 10 min',
    startDelayMs: 660 * SEC,
    lockTtlMs: 10 * MIN - 30 * SEC,
    tenantScope: 'orders:read',
  },
  {
    // PhonePe Autopay: notify >= 24 h before each due date, debit on it, mint the cycle's order.
    id: 'subscription_renewals',
    name: 'UPI Autopay subscription renewals',
    path: '/api/cron/subscription-renewals',
    method: 'GET',
    intervalMs: 30 * MIN,
    intervalLabel: 'every 30 min',
    startDelayMs: 690 * SEC,
    lockTtlMs: 30 * MIN - 30 * SEC,
    tenantScope: 'orders:read',
  },
  {
    id: 'myntra_sync',
    name: 'Myntra orders, listings, stock and alerts',
    path: '/api/cron/myntra-sync',
    method: 'GET',
    intervalMs: 10 * MIN,
    intervalLabel: 'every 10 min',
    startDelayMs: 750 * SEC,
    lockTtlMs: 10 * MIN - 30 * SEC,
    tenantScope: 'myntra:read',
  },
  {
    id: 'ajio_sync',
    name: 'AJIO orders, listings, stock and alerts',
    path: '/api/cron/ajio-sync',
    method: 'GET',
    intervalMs: 10 * MIN,
    intervalLabel: 'every 10 min',
    startDelayMs: 765 * SEC,
    lockTtlMs: 10 * MIN - 30 * SEC,
    tenantScope: 'ajio:read',
  },
  {
    // Platform jobs over every Route store's ledger (control plane).
    id: 'reconcile_settlements',
    name: 'Reconcile Route transfers',
    path: '/api/cron/reconcile-settlements',
    method: 'GET',
    intervalMs: 30 * MIN,
    intervalLabel: 'every 30 min',
    startDelayMs: 660 * SEC,
    lockTtlMs: 30 * MIN - 30 * SEC,
    tenantScope: null,
  },
  {
    id: 'retry_reversals',
    name: 'Retry Route reversals',
    path: '/api/cron/retry-reversals',
    method: 'GET',
    intervalMs: HOUR,
    intervalLabel: 'hourly',
    startDelayMs: 675 * SEC,
    lockTtlMs: HOUR - MIN,
    tenantScope: null,
  },
  {
    id: 'wallet_drift',
    name: 'Wallet drift check',
    path: '/api/cron/wallet-drift',
    method: 'GET',
    intervalMs: DAY,
    intervalLabel: 'daily',
    startDelayMs: 690 * SEC,
    lockTtlMs: DAY - MIN,
    tenantScope: null,
  },
  {
    // Platform job: nightly sum of every tenant's S3 bucket, drives the storage.s3Gb cap guard.
    id: 's3_usage',
    name: 'Tenant S3 bucket usage',
    path: '/api/cron/s3-usage',
    method: 'GET',
    intervalMs: DAY,
    intervalLabel: 'every 24 h',
    startDelayMs: 705 * SEC,
    lockTtlMs: HOUR,
    tenantScope: null,
  },
  {
    id: 'ai_health',
    name: 'AI platform health',
    path: '/api/internal/ai/health',
    method: 'GET',
    intervalMs: 5 * MIN,
    intervalLabel: 'every 5 min',
    startDelayMs: 135 * SEC,
    lockTtlMs: 5 * MIN - 30 * SEC,
    tenantScope: null,
  },
]

export const CRON_JOB_IDS: readonly string[] = CRON_JOBS.map(j => j.id)

export function isCronJobId(id: unknown): id is string {
  return typeof id === 'string' && CRON_JOB_IDS.includes(id)
}

/** The store jobs a plan's scopes grant (what the fan-out runs for that store). */
export function storeCronJobs(scopes: { has(scope: string): boolean }): CronJob[] {
  return CRON_JOBS.filter(j => j.tenantScope !== null && scopes.has(j.tenantScope))
}

/** Store jobs that are admin API routes: the cron bearer passes the admin gate for these (middleware). */
export const CRON_ADMIN_PATHS: readonly string[] = CRON_JOBS.filter(j => j.tenantScope !== null && j.path.startsWith('/api/admin/')).map(j => j.path)

/** Reachability check on a store's admin service (connect_crons). */
export const CRON_PING_PATH = '/api/cron/ping'

// IN_PROCESS_CRON=false hands scheduling to Kubernetes CronJobs (deploy/k8s), so pods never self-schedule.
export function inProcessCronEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.IN_PROCESS_CRON !== 'false'
}

// Daily jobs fire at a fixed IST time under k8s instead of a few minutes after every restart.
const DAILY_AT_IST: Record<string, string> = {
  customer_notes_digest: '30 9',
  // After midnight in the account zone so yesterday is final in Google Ads.
  google_ads_sync: '30 4',
  // After the nightly sync, so lists are built from the same day's orders.
  google_ads_audiences: '0 6',
  // Early morning IST, so a lapsing month is charged before most store traffic.
  ad_free_renew: '0 5',
  messaging_addon_renew: '10 5',
  domain_renew: '20 5',
  drive_purge_trash: '15 3',
  wallet_drift: '45 3',
  s3_usage: '30 2',
  merchant_sync: '15 23',
  amazon_sync: '45 23',
}

// Weekly jobs: minute hour * * day-of-week (IST).
const WEEKLY_AT_IST: Record<string, string> = {
  google_ads_digest: '0 9 * * 1',
  prune_push_devices: '30 3 * * 0',
}

// Cron expression (evaluated in Asia/Kolkata) for a job's k8s CronJob. Sub-minute jobs round up to 1m.
export function cronSchedule(job: CronJob): string {
  const mins = Math.max(1, Math.round(job.intervalMs / MIN))
  if (mins >= 7 * 24 * 60) return WEEKLY_AT_IST[job.id] ?? '0 3 * * 1'
  if (mins >= 24 * 60) return `${DAILY_AT_IST[job.id] ?? '0 3'} * * *`
  if (mins >= 60) {
    const hours = Math.round(mins / 60)
    const minute = Math.round(job.startDelayMs / MIN) % 60
    return hours === 1 ? `${minute} * * * *` : `${minute} */${hours} * * *`
  }
  return mins === 1 ? '* * * * *' : `*/${mins} * * * *`
}
