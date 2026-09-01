'use client'

import { useState } from 'react'

interface SubdomainEntry {
  label: string
  url: string
  available: boolean
  note?: string
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button onClick={copy}
      className="ml-2 text-xs px-2 py-0.5 rounded border border-border-default text-foreground-muted hover:bg-surface-secondary transition-colors flex-shrink-0">
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

export default function SubdomainList({ slug, plan, maxCustomDomains, rdsReady }: {
  slug: string
  plan: string | null
  maxCustomDomains: number
  rdsReady: boolean
}) {
  const p = plan ?? 'basic'

  const subdomains: SubdomainEntry[] = [
    {
      label: 'Storefront',
      url: `${slug}.jeffistores.in`,
      available: rdsReady,
      note: rdsReady ? undefined : 'Available once provisioned',
    },
    {
      label: 'Admin panel',
      url: `admin-${slug}.jeffistores.in`,
      available: rdsReady,
      note: rdsReady ? undefined : 'Available once provisioned',
    },
    {
      label: 'GST invoices',
      url: `invoice-${slug}.jeffistores.in`,
      available: true,
      note: undefined,
    },
    {
      label: 'Purchase orders',
      url: `purchaseorder-${slug}.jeffistores.in`,
      available: ['growth', 'pro', 'enterprise'].includes(p),
      note: ['growth', 'pro', 'enterprise'].includes(p) ? undefined : 'Growth plan and above',
    },
    {
      label: 'Quotations',
      url: `quotation-${slug}.jeffistores.in`,
      available: ['growth', 'pro', 'enterprise'].includes(p),
      note: ['growth', 'pro', 'enterprise'].includes(p) ? undefined : 'Growth plan and above',
    },
    {
      label: 'Review forms',
      url: `forms-${slug}.jeffistores.in`,
      available: ['pro', 'enterprise'].includes(p),
      note: ['pro', 'enterprise'].includes(p) ? undefined : 'Pro plan and above',
    },
    {
      label: 'B2B portal',
      url: `${slug}.business.jeffistores.in`,
      available: ['pro', 'enterprise'].includes(p),
      note: ['pro', 'enterprise'].includes(p) ? undefined : 'Pro plan and above',
    },
  ]

  return (
    <div className="space-y-2">
      {subdomains.map((s) => (
        <div key={s.label} className={`flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm ${s.available ? 'border-border-default bg-surface' : 'border-border-default/40 bg-surface-secondary/30 opacity-60'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.available ? 'bg-green-500' : 'bg-foreground-muted/30'}`} />
            <span className="text-foreground-muted w-28 flex-shrink-0 text-xs">{s.label}</span>
            <span className={`font-mono text-xs truncate ${s.available ? 'text-foreground' : 'text-foreground-muted'}`}>{s.url}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            {s.note && <span className="text-xs text-foreground-muted hidden sm:inline">{s.note}</span>}
            {s.available && <CopyButton text={`https://${s.url}`} />}
          </div>
        </div>
      ))}

      {maxCustomDomains > 0 && (
        <div className="px-4 py-2.5 rounded-xl border border-dashed border-border-default bg-surface text-sm text-foreground-muted">
          Up to <span className="font-medium text-foreground">{maxCustomDomains}</span> custom domain{maxCustomDomains > 1 ? 's' : ''} available — configure in store settings.
        </div>
      )}
      {maxCustomDomains === 0 && (
        <div className="px-4 py-2 text-xs text-foreground-muted">
          Custom domains available on Pro plan and above.
        </div>
      )}
    </div>
  )
}
