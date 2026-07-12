'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, ReactNode } from 'react'

export default function NavigationLoader({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, setPending] = useState(false)
  const prevKey = useRef<string>('')

  useEffect(() => {
    const key = pathname + '?' + searchParams.toString()
    if (prevKey.current && prevKey.current !== key) {
      setPending(false)
    }
    prevKey.current = key
  }, [pathname, searchParams])

  useEffect(() => {
    const handleStart = () => setPending(true)
    const handleStop = () => setPending(false)
    window.addEventListener('__nav_start', handleStart)
    window.addEventListener('__nav_stop', handleStop)
    return () => {
      window.removeEventListener('__nav_start', handleStart)
      window.removeEventListener('__nav_stop', handleStop)
    }
  }, [])

  return (
    <div className="relative">
      {pending && (
        <div className="absolute inset-0 z-10 rounded-lg pointer-events-none">
          <div className="h-full w-full rounded-lg bg-surface/40 animate-pulse" />
        </div>
      )}
      <div className={pending ? 'opacity-50 transition-opacity duration-150' : 'transition-opacity duration-150'}>
        {children}
      </div>
    </div>
  )
}
