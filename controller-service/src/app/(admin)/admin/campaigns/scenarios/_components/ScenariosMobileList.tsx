'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Power, Plus, Settings, Trash2 } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useHasScope } from '@/contexts/AdminScopesContext'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'
import type { Scenario } from '../ScenariosListClient'

interface Props {
  scenarios: Scenario[]
  busy: string | null
  onToggle: (s: Scenario) => void | Promise<void>
  onRemove: (s: Scenario) => void | Promise<void>
}

export default function ScenariosMobileList({ scenarios, busy, onToggle, onRemove }: Props) {
  const router = useRouter()
  const canWrite = useHasScope('campaigns:write')
  const [selected, setSelected] = useState<Scenario | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function close() {
    setActionsOpen(false)
    setSelected(null)
  }

  function buildActions(s: Scenario): MobileAction[] {
    const actions: MobileAction[] = []
    if (canWrite && s.type === 'custom') {
      actions.push({
        key: 'toggle',
        label: s.enabled ? 'Pause' : 'Activate',
        icon: <Power className="w-4 h-4" />,
        disabled: busy === s.kind,
        onSelect: () => {
          onToggle(s)
          close()
        },
      })
    }
    if (canWrite) {
      actions.push({
        key: 'new',
        label: 'New campaign',
        icon: <Plus className="w-4 h-4" />,
        onSelect: () => router.push(ap(`/admin/campaigns/new?scenario=${s.kind}`)),
      })
    }
    actions.push({
      key: 'configure',
      label: 'Configure',
      icon: <Settings className="w-4 h-4" />,
      onSelect: () => router.push(ap(`/admin/campaigns/scenarios/${s.kind}`)),
    })
    if (canWrite && s.type === 'custom' && s.stats.campaigns_count === 0) {
      actions.push({
        key: 'delete',
        label: 'Delete scenario',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        disabled: busy === s.kind,
        onSelect: () => {
          onRemove(s)
          close()
        },
      })
    }
    return actions
  }

  return (
    <>
      <div className="space-y-3">
        {scenarios.map(s => (
          <MobileListCard key={s.kind} ariaLabel={`Open ${s.name}`} onTap={() => setSelected(s)}>
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground truncate">{s.name}</span>
                <span
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${s.type === 'custom' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'}`}
                >
                  {s.type === 'custom' ? 'Custom' : 'Built-in'}
                </span>
                {s.type === 'custom' && (
                  <span
                    className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${s.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}
                  >
                    {s.enabled ? 'Active' : 'Paused'}
                  </span>
                )}
              </div>
              <p className="text-xs text-foreground-muted">
                {s.stats.campaigns_count} campaign{s.stats.campaigns_count === 1 ? '' : 's'}
              </p>
              {s.description && <p className="text-xs text-foreground-muted line-clamp-1">{s.description}</p>}
            </div>
          </MobileListCard>
        ))}
      </div>

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        subtitle={selected ? (selected.type === 'custom' ? 'Custom scenario' : 'Built-in scenario') : undefined}
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
        {selected && (
          <div className="px-5 py-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {selected.kind}
              </span>
              <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-secondary-100 text-secondary-700 dark:bg-secondary-900/40 dark:text-secondary-300">
                {selected.stats.campaigns_count} campaign{selected.stats.campaigns_count === 1 ? '' : 's'}
              </span>
            </div>
            {selected.description && <p className="text-sm text-foreground-secondary">{selected.description}</p>}
          </div>
        )}
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
