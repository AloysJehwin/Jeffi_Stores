import Link from 'next/link'
import { queryMany, queryCount } from '@/lib/db'
import Pagination from '@/components/admin/Pagination'
import DeleteCampaignButton from '@/components/admin/DeleteCampaignButton'
import DispatchCampaignButton from '@/components/admin/DispatchCampaignButton'
import AdminFilters from '@/components/admin/AdminFilters'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 20

const TEMPLATE_LABELS: Record<string, string> = {
  review_form_share: 'Review Form Share',
  promotion: 'Promotion',
  event: 'Event',
  announcement: 'Announcement',
  custom: 'Custom',
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-yellow-100 text-yellow-700',
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-600',
}

interface Campaign {
  id: string
  title: string
  template_key: string
  subject: string
  audience_type: string
  recipient_count: number | null
  status: string
  scheduled_at: string | null
  sent_at: string | null
  created_at: string
}

export default async function MailerPage({ searchParams }: { searchParams: { page?: string; search?: string } }) {
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))
  const search = searchParams.search?.trim() || ''
  const offset = (page - 1) * PAGE_SIZE

  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  if (search) {
    conditions.push(`(title ILIKE $${i} OR subject ILIKE $${i})`)
    params.push(`%${search}%`)
    i++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  let campaigns: Campaign[] = []
  let total = 0
  let migrationPending = false

  try {
    ;[campaigns, total] = await Promise.all([
      queryMany<Campaign>(
        `SELECT id, title, template_key, subject, audience_type, recipient_count, status, scheduled_at, sent_at, created_at
         FROM email_campaigns ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
        [...params, PAGE_SIZE, offset]
      ),
      queryCount(`SELECT COUNT(*) FROM email_campaigns ${where}`, params),
    ])
  } catch {
    migrationPending = true
  }

  const buildUrl = (p: number) => {
    const qs = new URLSearchParams()
    if (search) qs.set('search', search)
    if (p > 1) qs.set('page', String(p))
    const s = qs.toString()
    return `/admin/mailer${s ? `?${s}` : ''}`
  }

  if (migrationPending) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Mailer</h1>
            <p className="text-foreground-secondary mt-1 text-sm">Create and send email campaigns to your customers</p>
          </div>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-6 max-w-xl">
          <h2 className="font-semibold text-amber-800 dark:text-amber-300 mb-2">Database migration required</h2>
          <p className="text-sm text-amber-700 dark:text-amber-400 mb-3">
            The <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">email_campaigns</code> table does not exist yet. Run the migration on your production database:
          </p>
          <pre className="bg-amber-100 dark:bg-amber-900/40 rounded-lg px-4 py-3 text-xs font-mono text-amber-900 dark:text-amber-200 overflow-x-auto">
            psql $DATABASE_URL -f database/migrations/mailer.sql
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Mailer</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Create and send email campaigns to your customers</p>
        </div>
        <Link href="/admin/mailer/new" className="bg-accent-500 hover:bg-accent-600 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center text-sm sm:text-base">
          New Campaign
        </Link>
      </div>

      <AdminFilters filters={[]} searchPlaceholder="Search by title or subject..." />

      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary">
              <tr>
                {['Title', 'Template', 'Audience', 'Recipients', 'Status', 'Date', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {campaigns.map(c => (
                <tr key={c.id} className="hover:bg-surface-secondary/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/admin/mailer/${c.id}`} className="font-medium text-foreground hover:text-accent-500 transition-colors">{c.title}</Link>
                    <p className="text-xs text-foreground-muted truncate max-w-[200px]">{c.subject}</p>
                  </td>
                  <td className="px-4 py-3 text-foreground-secondary">{TEMPLATE_LABELS[c.template_key] || c.template_key}</td>
                  <td className="px-4 py-3 capitalize text-foreground-secondary">{c.audience_type.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-foreground-secondary">{c.recipient_count ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium capitalize ${STATUS_STYLES[c.status] || 'bg-gray-100 text-gray-600'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-secondary text-xs">
                    {c.status === 'scheduled' && c.scheduled_at
                      ? `Scheduled ${new Date(c.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}`
                      : c.sent_at
                      ? new Date(c.sent_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
                      : new Date(c.created_at).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {(c.status === 'draft' || c.status === 'scheduled') && (
                        <DispatchCampaignButton id={c.id} />
                      )}
                      <Link href={`/admin/mailer/${c.id}`} className="text-accent-500 hover:underline text-sm">View</Link>
                      {c.status !== 'sending' && <DeleteCampaignButton id={c.id} title={c.title} />}
                    </div>
                  </td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-foreground-muted">No campaigns yet. <Link href="/admin/mailer/new" className="text-accent-500 hover:underline">Create your first one.</Link></td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden divide-y divide-border-default">
          {campaigns.map(c => (
            <div key={c.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/admin/mailer/${c.id}`} className="font-medium text-foreground">{c.title}</Link>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 capitalize ${STATUS_STYLES[c.status] || 'bg-gray-100 text-gray-600'}`}>
                  {c.status}
                </span>
              </div>
              <p className="text-xs text-foreground-muted">{TEMPLATE_LABELS[c.template_key]} · {c.audience_type.replace('_', ' ')}</p>
              {c.recipient_count != null && <p className="text-xs text-foreground-muted">{c.recipient_count} recipients</p>}
              <div className="flex gap-3 pt-1">
                {(c.status === 'draft' || c.status === 'scheduled') && <DispatchCampaignButton id={c.id} />}
                <Link href={`/admin/mailer/${c.id}`} className="text-xs text-accent-500 hover:underline">View</Link>
                {c.status !== 'sending' && <DeleteCampaignButton id={c.id} title={c.title} />}
              </div>
            </div>
          ))}
          {campaigns.length === 0 && <p className="p-6 text-center text-foreground-muted text-sm">No campaigns yet.</p>}
        </div>
      </div>

      <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
    </div>
  )
}
