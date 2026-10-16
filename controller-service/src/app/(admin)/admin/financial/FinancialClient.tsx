'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { Tabs } from '@/components/admin/channels/ui'
import type { Tab } from './_components/shared'
import { OverviewTab } from './_components/OverviewTab'
import { ReceivablesTab } from './_components/ReceivablesTab'
import { PayablesTab } from './_components/PayablesTab'
import { TransactionsTab } from './_components/TransactionsTab'
import { PLTab } from './_components/PLTab'
import { CashflowTab } from './_components/CashflowTab'
import { CodRemittanceTab } from './_components/CodRemittanceTab'
import { MessagingTab } from './_components/MessagingTab'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'receivables', label: 'Receivables' },
  { key: 'payables', label: 'Payables' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'pl', label: 'P&L' },
  { key: 'cashflow', label: 'Cashflow' },
  { key: 'cod_remittance', label: 'COD Remittance' },
  { key: 'messaging', label: 'Messaging' },
]

export default function FinancialClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const tabParam = searchParams.get('tab') as Tab | null
  const validTabs: Tab[] = [
    'overview',
    'receivables',
    'payables',
    'transactions',
    'pl',
    'cashflow',
    'cod_remittance',
    'messaging',
  ]
  const [tab, setTab] = useState<Tab>(tabParam && validTabs.includes(tabParam) ? tabParam : 'overview')

  const now = new Date()
  const fyStart = now.getMonth() >= 3 ? `${now.getFullYear()}-04-01` : `${now.getFullYear() - 1}-04-01`
  const fyEnd = now.getMonth() >= 3 ? `${now.getFullYear() + 1}-03-31` : `${now.getFullYear()}-03-31`

  const [allData, setAllData] = useState<Record<string, any>>({})
  const loaded = useRef(false)

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true

    fetch('/api/admin/financial/payables/sync-payouts', { method: 'POST' }).catch(() => {})

    Promise.allSettled([
      fetch('/api/admin/financial/receivables').then(r => r.json()),
      fetch('/api/admin/financial/payables').then(r => r.json()),
      fetch('/api/admin/financial/transactions').then(r => r.json()),
      fetch(`/api/admin/financial/pl?from=${fyStart}&to=${fyEnd}`).then(r => r.json()),
      fetch(`/api/admin/financial/cashflow?from=${fyStart}&to=${fyEnd}`).then(r => r.json()),
    ]).then(results => {
      const [rec, pay, txn, pl, cf] = results
      setAllData({
        receivables: rec.status === 'fulfilled' && !rec.value?.error ? rec.value : null,
        payables: pay.status === 'fulfilled' && !pay.value?.error ? pay.value : null,
        transactions: txn.status === 'fulfilled' && !txn.value?.error ? txn.value : null,
        pl: pl.status === 'fulfilled' ? pl.value : null,
        cashflow: cf.status === 'fulfilled' ? cf.value : null,
      })
    })
  }, [])

  function handleTabChange(key: Tab) {
    setTab(key)
    router.push(ap(`/admin/financial?tab=${key}`), { scroll: false })
  }

  return (
    <div className="space-y-4">
      <Tabs tabs={TABS.map(t => ({ id: t.key, label: t.label }))} value={tab} onChange={handleTabChange} />

      <div>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'receivables' && <ReceivablesTab initialData={allData.receivables ?? null} />}
        {tab === 'payables' && <PayablesTab initialData={allData.payables ?? null} />}
        {tab === 'transactions' && <TransactionsTab initialData={allData.transactions ?? null} />}
        {tab === 'pl' && <PLTab initialData={allData.pl ?? null} />}
        {tab === 'cashflow' && <CashflowTab initialData={allData.cashflow ?? null} />}
        {tab === 'cod_remittance' && <CodRemittanceTab />}
        {tab === 'messaging' && <MessagingTab />}
      </div>
    </div>
  )
}
