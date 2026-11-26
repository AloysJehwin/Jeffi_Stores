import { Check, Minus } from 'lucide-react'
import type { SecretGroup, SecretRow } from './model'
import { Panel } from './parts'

// Flagship only: which secret names the providers read and whether each is set. Never a value.

const GROUPS: { id: SecretGroup; label: string; store: string }[] = [
  { id: 'ai', label: 'AI', store: 'jeffi/ai-gateway/production' },
  { id: 'messaging', label: 'Messaging', store: 'jeffi/production' },
  { id: 'calling', label: 'Calling', store: 'jeffi/production' },
  { id: 'voice', label: 'Call voice', store: 'jeffi/production' },
]

export default function SecretsStatus({ secrets }: { secrets: SecretRow[] }) {
  const set = secrets.filter(s => s.present).length
  return (
    <Panel
      id="providers-secrets"
      title="Secrets"
      description="Names and presence only; values never leave the secret store. Add or rotate a key there, then test it here."
      actions={
        secrets.length > 0 && (
          <span className={`text-xs tabular-nums ${set === secrets.length ? 'text-foreground-muted' : 'text-amber-700 dark:text-amber-400'}`}>
            {set} of {secrets.length} set
          </span>
        )
      }
    >
      {!secrets.length ? (
        <p className="text-sm text-foreground-muted">No secret status was reported.</p>
      ) : (
        <div className="space-y-4">
          {GROUPS.map(g => {
            const rows = secrets.filter(s => s.group === g.id)
            if (!rows.length) return null
            return (
              <div key={g.id}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{g.label}</h4>
                  <span className="truncate font-mono text-[11px] text-foreground-muted">{g.store}</span>
                </div>
                <ul aria-label={`${g.label} secrets`} className="divide-y divide-border-default rounded-lg border border-border-default">
                  {rows.map(s => (
                    <li key={s.name} className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span className={`min-w-0 truncate font-mono text-xs ${s.present ? 'text-foreground' : 'text-foreground-muted'}`}>{s.name}</span>
                      {s.present ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-green-700 dark:text-green-400">
                          <Check aria-hidden className="h-3 w-3" />
                          Set
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                          <Minus aria-hidden className="h-3 w-3" />
                          Missing
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
