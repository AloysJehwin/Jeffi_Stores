'use client'

import type { StaffNoteDraft } from './useStaffNoteDraft'

export default function StaffNoteSaved({ d, wide = false }: { d: StaffNoteDraft; wide?: boolean }) {
  return (
    <div className={wide ? 'max-w-md' : ''}>
      <h1 className="text-2xl font-bold">Saved</h1>
      <p className="text-sm text-foreground-secondary mt-2">
        The note is now on {d.customer?.name}&apos;s profile{d.shared ? ' and shared with them' : ''}.
      </p>
      {d.done && d.done.warnings.length > 0 && (
        <ul className="mt-3 text-xs text-amber-700 dark:text-amber-300 list-disc pl-4 space-y-1">{d.done.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      <div className="mt-8 space-y-3">
        <button type="button" onClick={() => d.reset(true)} className="w-full py-3 rounded-xl bg-accent-500 hover:bg-accent-600 text-white font-semibold">Add another for {d.customer?.name}</button>
        <button type="button" onClick={() => d.reset(false)} className="w-full py-3 rounded-xl border border-border-secondary font-semibold">New customer</button>
      </div>
    </div>
  )
}
