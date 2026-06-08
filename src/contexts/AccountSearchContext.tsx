'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface AccountSearchCtx {
  query: string
  suggestions: string[]
  placeholder: string
  setQuery: (q: string) => void
  register: (opts: { suggestions: string[]; placeholder: string }) => void
  clear: () => void
}

const Ctx = createContext<AccountSearchCtx>({
  query: '',
  suggestions: [],
  placeholder: 'Search…',
  setQuery: () => {},
  register: () => {},
  clear: () => {},
})

export function AccountSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQueryState] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [placeholder, setPlaceholder] = useState('Search…')

  const setQuery = useCallback((q: string) => setQueryState(q), [])

  const register = useCallback(({ suggestions: s, placeholder: p }: { suggestions: string[]; placeholder: string }) => {
    setSuggestions(s)
    setPlaceholder(p)
    setQueryState('')
  }, [])

  const clear = useCallback(() => {
    setSuggestions([])
    setPlaceholder('Search…')
    setQueryState('')
  }, [])

  return (
    <Ctx.Provider value={{ query, suggestions, placeholder, setQuery, register, clear }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAccountSearch() {
  return useContext(Ctx)
}
