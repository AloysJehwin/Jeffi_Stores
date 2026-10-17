'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { TabAction, TabActionsHost, Tabs } from '@/components/admin/kit/core'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import SuppliersOverview from './SuppliersOverview'
import SuppliersTab from './SuppliersTab'

type Tab = 'overview' | 'suppliers'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'suppliers', label: 'Suppliers' },
]

export default function SuppliersClient() {
  const sp = useSearchParams()
  const router = useRouter()
  const tab: Tab = sp.get('tab') === 'suppliers' ? 'suppliers' : 'overview'

  const go = (t: Tab) => router.push(ap(`/admin/suppliers?tab=${t}`), { scroll: false })

  return (
    <TabActionsHost>
      <div className="space-y-5">
        <Tabs
          tabs={TABS}
          value={tab}
          onChange={go}
          actions={
            <RequireWrite scope="inventory">
              <TabAction href={ap('/admin/suppliers/new')} icon={<Plus className="w-4 h-4" />} label="New supplier" />
            </RequireWrite>
          }
        />
        {tab === 'overview' ? <SuppliersOverview /> : <SuppliersTab />}
      </div>
    </TabActionsHost>
  )
}
