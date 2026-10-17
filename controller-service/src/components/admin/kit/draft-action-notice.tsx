'use client'

import { DraftNotice, type DraftNoticeState } from './draft'

// Thin client wrapper so server pages can render a DraftNotice whose Discard
// invokes a server action. The action may take FormData (with `intent=discard`
// set) or no args — pick with `kind`.

export type DraftDiscardAction =
  | ((formData: FormData) => Promise<void>)
  | (() => Promise<void>)

export interface DraftActionNoticeProps {
  state?: DraftNoticeState
  action?: DraftDiscardAction
  /** If 'form', calls action(FormData with intent=discard). If 'noArg', calls action(). */
  kind?: 'form' | 'noArg'
  intent?: string
}

export function DraftActionNotice({
  state = 'draft',
  action,
  kind = 'form',
  intent = 'discard',
}: DraftActionNoticeProps) {
  const onDiscard = action
    ? () => {
        if (kind === 'noArg') {
          void (action as () => Promise<void>)()
        } else {
          const fd = new FormData()
          fd.set('intent', intent)
          void (action as (fd: FormData) => Promise<void>)(fd)
        }
      }
    : undefined
  return <DraftNotice state={state} onDiscard={onDiscard} />
}
