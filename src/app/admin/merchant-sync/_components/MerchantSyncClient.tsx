'use client'

import { useState } from 'react'
import GoogleMerchantPanel from './GoogleMerchantPanel'
import AmazonMerchantPanel from './AmazonMerchantPanel'

type Tab = 'google' | 'amazon'

const TABS: { key: Tab; label: string }[] = [
  { key: 'google', label: 'Google Merchant' },
  { key: 'amazon', label: 'Amazon Merchant' },
]

export default function MerchantSyncClient() {
  const [tab, setTab] = useState<Tab>('google')

  return (
    <div className="space-y-5">
      <div className="flex border-b border-border-default gap-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${tab === t.key ? 'border-secondary-500 dark:border-secondary-400 text-secondary-500 dark:text-secondary-400' : 'border-transparent text-foreground-secondary hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>
        {tab === 'google' && <GoogleMerchantPanel />}
        {tab === 'amazon' && <AmazonMerchantPanel />}
      </div>
    </div>
  )
}
