'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Power } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import SupplierMobileCardBody from './SupplierMobileCardBody'
import SupplierMobileDetailBody from './SupplierMobileDetailBody'

type Supplier = {
  id: string
  name: string
  gstin: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  payment_terms: number
  is_active: boolean
  po_count: number
  address: string | null
  notes: string | null
  bank_name: string | null
  account_number: string | null
  ifsc: string | null
  upi_id: string | null
}

interface Props {
  suppliers: Supplier[]
  canWrite: boolean
  onToggleActive: (supplier: Supplier) => void | Promise<void>
}

export default function SuppliersMobileList({ suppliers, canWrite, onToggleActive }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Supplier | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function buildActions(supplier: Supplier): MobileAction[] {
    const actions: MobileAction[] = [
      {
        key: 'view',
        label: 'View supplier',
        icon: <Eye className="w-4 h-4" />,
        onSelect: () => router.push(ap(`/admin/suppliers/${supplier.id}`)),
      },
    ]
    if (canWrite) {
      actions.push({
        key: 'active',
        label: supplier.is_active ? 'Deactivate' : 'Activate',
        icon: <Power className="w-4 h-4" />,
        onSelect: () => {
          setSelected(null)
          onToggleActive(supplier)
        },
      })
    }
    return actions
  }

  return (
    <>
      {suppliers.map(supplier => (
        <MobileListCard
          key={supplier.id}
          ariaLabel={`Open ${supplier.name}`}
          onTap={() => setSelected(supplier)}
        >
          <SupplierMobileCardBody supplier={supplier} />
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        subtitle={selected?.gstin}
        footer={
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
          >
            Actions
          </button>
        }
      >
        {selected && <SupplierMobileDetailBody supplier={selected} />}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected?.name}
        actions={selected ? buildActions(selected) : []}
      />
    </>
  )
}
