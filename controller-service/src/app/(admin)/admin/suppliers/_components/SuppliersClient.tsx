'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { canonicalQuery } from '@jeffi/list-filters/client'
import { Plus } from 'lucide-react'
import { TabAction, TabActionsHost, Tabs } from '@/components/admin/kit/core'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import { tabHref } from '@/lib/admin/filter-url'
import { SUPPLIER_FIELDS, SUPPLIER_LIST_PRESET } from '@/lib/filters/fields/suppliers'
import SuppliersOverview from './SuppliersOverview'
import SuppliersTab from './SuppliersTab'
import PageDrafts from '@/components/admin/drafts/PageDrafts'

type Tab = 'overview' | 'suppliers'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'suppliers', label: 'Suppliers' },
]

export default function SuppliersClient() {
  const sp = useSearchParams()
  const router = useRouter()
  const listQuery = canonicalQuery(sp, SUPPLIER_FIELDS, { omit: ['from', 'to'] })
  const tab: Tab = sp.get('tab') === 'suppliers' || (!sp.get('tab') && listQuery) ? 'suppliers' : 'overview'

  // Tabs keep the filters; the list opens on active suppliers unless filters came along.
  const go = (t: Tab) => {
    const href = tabHref('/admin/suppliers', t, sp, SUPPLIER_FIELDS)
    router.push(ap(t === 'suppliers' && !listQuery ? `${href}&${SUPPLIER_LIST_PRESET}` : href), { scroll: false })
  }

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
        {tab === 'overview' ? (
          <SuppliersOverview />
        ) : (
          <>
            <PageDrafts type="supplier" />
            <SuppliersTab />
          </>
        )}
      </div>
    </TabActionsHost>
  )
}
