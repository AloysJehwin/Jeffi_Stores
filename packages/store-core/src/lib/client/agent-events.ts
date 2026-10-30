import { useEffect, useRef } from 'react'

// The admin agent announces a change the admin approved, so whatever page is on screen reloads.
const EVENT = 'admin-agent:changed'

export function announceAgentChange(kinds: string[]) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { kinds } }))
}

/** Runs `onChange` after an approved agent change. */
export function useAgentChanges(onChange: () => void) {
  const ref = useRef(onChange)
  ref.current = onChange
  useEffect(() => {
    const fn = () => ref.current()
    window.addEventListener(EVENT, fn)
    return () => window.removeEventListener(EVENT, fn)
  }, [])
}
