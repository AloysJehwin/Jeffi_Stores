import { useEffect, useRef, useState } from 'react'

/** True for 500ms after `count` rises, to drive the cart badge's add-to-cart pulse. */
export function useCartPulse(count: number): boolean {
  const [pulse, setPulse] = useState(false)
  const prev = useRef(count)
  useEffect(() => {
    if (count > prev.current) {
      setPulse(true)
      const t = setTimeout(() => setPulse(false), 500)
      prev.current = count
      return () => clearTimeout(t)
    }
    prev.current = count
  }, [count])
  return pulse
}
