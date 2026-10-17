'use client'

import { useState } from 'react'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { Download, FileText } from 'lucide-react'
import { useActionToast } from '@/components/admin/kit/toast'

export default function GenerateInvoiceButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false)
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null)
  const toast = useActionToast()

  const handleGenerate = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/invoice`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to generate invoice')
        return
      }
      setInvoiceNumber(data.invoiceNumber)
      toast.success(`Invoice ${data.invoiceNumber} generated.`)
    } catch {
      toast.error('Failed to generate invoice')
    } finally {
      setLoading(false)
    }
  }

  if (invoiceNumber) {
    return (
      <a
        href={`/api/orders/${orderId}/invoice`}
        target="_blank"
        rel="noopener noreferrer"
        className="control-md border border-border-default bg-surface-elevated text-foreground hover:bg-surface-secondary"
        title={`Invoice ${invoiceNumber}`}
      >
        <Download className="h-4 w-4" />
        Invoice
      </a>
    )
  }

  return (
    <RequireWrite scope="orders:write">
      <button type="button" onClick={handleGenerate} disabled={loading} className="control-md bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:opacity-50">
        <FileText className="h-4 w-4" />
        {loading ? 'Generating...' : 'Generate Invoice'}
      </button>
    </RequireWrite>
  )
}
