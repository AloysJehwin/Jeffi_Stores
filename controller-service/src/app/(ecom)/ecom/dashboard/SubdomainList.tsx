'use client'

import { useState } from 'react'
import Link from 'next/link'

interface SubdomainEntry {
  label: string
  url: string
  available: boolean
  /** Why it isn't live yet; with `upgrade`, it links to Plan & servers, where the plan changes. */
  note?: string
  upgrade?: boolean
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
    <button
      onClick={copy}
      className="text-xs px-2 py-0.5 rounded border border-border-default text-foreground-secondary hover:bg-surface-secondary transition-colors flex-shrink-0"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

// Hosts per plan tier, as provisioning creates them (lib/provisioning/steps.ts tenantHostnames).
const GROW = ['growth', 'pro', 'enterprise']
const PRO = ['pro', 'enterprise']

export default function SubdomainList({ slug, plan, rdsReady }: { slug: string; plan: string | null; rdsReady: boolean }) {
  const p = plan ?? 'basic'
  // The store's own hosts (storefront, admin, its invoice portal) come up with the store.
  const store = (label: string, url: string): SubdomainEntry => ({ label, url, available: rdsReady, note: rdsReady ? undefined : 'Available once your store is set up' })
  const tier = (label: string, url: string, tiers: string[], note: string): SubdomainEntry =>
    tiers.includes(p) ? store(label, url) : { label, url, available: false, note, upgrade: true }

  const subdomains: SubdomainEntry[] = [
    store('Storefront', `${slug}.jeffistores.in`),
    store('Admin panel', `admin-${slug}.jeffistores.in`),
    store('GST invoices', `invoice-${slug}.jeffistores.in`),
    tier('Purchase orders', `purchaseorder-${slug}.jeffistores.in`, GROW, 'Grow plan and above'),
    tier('Quotations', `quotation-${slug}.jeffistores.in`, GROW, 'Grow plan and above'),
    tier('Review forms', `forms-${slug}.jeffistores.in`, GROW, 'Grow plan and above'),
    tier('B2B portal', `${slug}.business.jeffistores.in`, PRO, 'Pro plan and above'),
  ]

  return (
    <ul className="space-y-2">
      {subdomains.map(s => (
        <li
          key={s.label}
          className={`flex flex-col gap-1.5 px-4 py-2.5 rounded-xl border text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${s.available ? 'border-border-default bg-surface' : 'border-border-default/60 bg-surface-secondary/40'}`}
        >
          <div className="flex items-start gap-3 min-w-0 sm:items-center">
            <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 sm:mt-0 ${s.available ? 'ecom-accent-bg' : 'bg-foreground-muted/50'}`} />
            <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
              <span className="text-foreground-secondary text-xs font-medium sm:w-28 sm:flex-shrink-0">{s.label}</span>
              <span className={`font-mono text-xs break-all ${s.available ? 'text-foreground' : 'text-foreground-secondary'}`}>{s.url}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-5 sm:pl-0 sm:flex-shrink-0 sm:justify-end">
            {s.note &&
              (s.upgrade ? (
                <Link href="/dashboard/compute" className="text-xs text-foreground-secondary underline underline-offset-2 hover:text-foreground">
                  {s.note}
                </Link>
              ) : (
                <span className="text-xs text-foreground-secondary">{s.note}</span>
              ))}
            {s.available && <CopyButton text={`https://${s.url}`} />}
          </div>
        </li>
      ))}
    </ul>
  )
}
