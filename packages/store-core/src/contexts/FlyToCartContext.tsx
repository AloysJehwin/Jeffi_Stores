'use client'

import { createContext, useCallback, useContext, useRef, useState, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CART_GLYPH } from '@/components/visitor/site/code/parts/chrome/marks'

interface Flight {
  id: number
  from: { x: number; y: number }
  to: { x: number; y: number }
}

interface FlyToCartContextType {
  /** The cart icon registers its element here so flights know where to land. */
  setCartTarget: (el: HTMLElement | null) => void
  /** Fire a dot from the origin element towards the cart icon. No-op under reduced motion. */
  flyToCart: (origin: HTMLElement | null) => void
}

const FlyToCartContext = createContext<FlyToCartContextType | null>(null)

const centerOf = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function FlyToCartProvider({ children }: { children: ReactNode }) {
  const prefersReduced = useReducedMotion()
  const cartTarget = useRef<HTMLElement | null>(null)
  const nextId = useRef(0)
  const [flights, setFlights] = useState<Flight[]>([])

  const setCartTarget = useCallback((el: HTMLElement | null) => {
    cartTarget.current = el
  }, [])

  const flyToCart = useCallback(
    (origin: HTMLElement | null) => {
      if (prefersReduced || !origin || !cartTarget.current) return
      // The cart icon is hidden on phones (it rides the menu button); skip rather than fly off-screen.
      if (cartTarget.current.offsetParent === null) return
      const id = nextId.current++
      setFlights(prev => [...prev, { id, from: centerOf(origin), to: centerOf(cartTarget.current!) }])
    },
    [prefersReduced]
  )

  const done = useCallback((id: number) => {
    setFlights(prev => prev.filter(f => f.id !== id))
  }, [])

  return (
    <FlyToCartContext.Provider value={{ setCartTarget, flyToCart }}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-[70]" aria-hidden="true">
            <AnimatePresence>
              {flights.map(f => (
                <motion.div
                  key={f.id}
                  initial={{ x: f.from.x, y: f.from.y, scale: 1, opacity: 1 }}
                  animate={{
                    x: [f.from.x, f.from.x, f.to.x],
                    y: [f.from.y, f.from.y - 48, f.to.y],
                    scale: [1, 1, 0.4],
                    opacity: [1, 1, 0.2],
                  }}
                  transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1], times: [0, 0.3, 1] }}
                  onAnimationComplete={() => done(f.id)}
                  className="absolute -ml-4 -mt-4 flex h-8 w-8 items-center justify-center rounded-full bg-accent-500 text-white shadow-lg"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={CART_GLYPH} />
                  </svg>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>,
          document.body
        )}
    </FlyToCartContext.Provider>
  )
}

/** The fly-to-cart controls, or null outside a FlyToCartProvider (previews, business portal). */
export function useFlyToCart() {
  return useContext(FlyToCartContext)
}
