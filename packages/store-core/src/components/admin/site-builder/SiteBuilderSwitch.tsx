'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Blocks, Radio } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import { api } from '@/components/admin/kit/core'

/**
 * Which builder customers see. `target` is the builder this control belongs to: "Make … live" switches to it (the
 * other one keeps its work). `setup` (Site Builder not started yet) brings today's homepage layouts over without
 * changing what customers see.
 */
export default function SiteBuilderSwitch({ target, live, setup = false }: { target: 'site' | 'homepage'; live: boolean; setup?: boolean }) {
  const canWrite = useCanWrite('settings:write')
  const router = useRouter()
  const { showToast, showConfirm } = useToast()
  const [busy, setBusy] = useState(false)
  if (!canWrite) return null

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true)
    const { ok, data } = await api<{ imported?: number; error?: string }>('/api/admin/site-builder', { method: 'POST', json: body })
    setBusy(false)
    if (!ok) return showToast(data.error || 'Could not switch', 'error')
    showToast(done, 'success')
    router.refresh()
  }

  async function makeLive() {
    const name = target === 'site' ? 'Site Builder' : 'the Homepage builder'
    const ok = await showConfirm({
      title: `Make ${name} live?`,
      message: `Customers see the pages from ${name} from now on. The other builder keeps its work, and you can switch back any time.`,
      confirmText: 'Make live',
    })
    if (ok) await send({ enabled: target === 'site' }, `${target === 'site' ? 'Site Builder' : 'The Homepage builder'} is live`)
  }

  if (setup) {
    return (
      <div className="rounded-xl border border-border-default bg-surface-elevated p-6 space-y-4 max-w-2xl">
        <div className="flex items-start gap-3">
          <span className="p-2 rounded-lg bg-accent-500/10 text-accent-600">
            <Blocks className="w-5 h-5" />
          </span>
          <div className="space-y-1">
            <p className="text-base font-semibold text-foreground">Build your site from blocks</p>
            <p className="text-sm text-foreground-muted">
              Lay out every page for desktop, phone browsers and the app separately, edit blocks in a live preview, start from
              templates, set your own colours and fonts, and let AI build or correct pages. Setting it up copies your current
              homepage layouts in; customers keep seeing the Homepage builder until you make Site Builder live.
            </p>
          </div>
        </div>
        <button type="button" disabled={busy} onClick={() => send({ setup: true }, 'Site Builder is ready to edit')} className="inline-flex items-center gap-1.5 px-4 h-control text-sm font-medium rounded-lg bg-accent-500 text-white disabled:opacity-50">
          {busy ? 'Setting up…' : 'Set up Site Builder'}
        </button>
      </div>
    )
  }

  if (live) return null
  return (
    <button type="button" disabled={busy} onClick={makeLive} className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-lg border border-accent-500 text-accent-600 hover:bg-accent-500/10 disabled:opacity-50">
      <Radio className="w-4 h-4" /> Make {target === 'site' ? 'Site Builder' : 'Homepage builder'} live
    </button>
  )
}
