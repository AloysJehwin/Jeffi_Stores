'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/admin/channels/ui'

export interface SiteControlsTab {
  id: string
  label: string
  content: React.ReactNode
}

// Inactive panels stay mounted (hidden) so KeyboardShortcutControl keeps its conflict registry.
export default function SiteControlsTabs({ tabs }: { tabs: SiteControlsTab[] }) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const requested = sp.get('tab')
  const active = tabs.some(t => t.id === requested) ? (requested as string) : tabs[0]?.id
  const set = (id: string) => {
    const next = new URLSearchParams(sp.toString())
    next.set('tab', id)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }
  return (
    <div className="space-y-6">
      <Tabs tabs={tabs.map(t => ({ id: t.id, label: t.label }))} value={active} onChange={set} />
      {tabs.map(t => (
        <div key={t.id} role="tabpanel" className={t.id === active ? 'space-y-6' : 'hidden'}>
          {t.content}
        </div>
      ))}
    </div>
  )
}
