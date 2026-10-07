'use client'

import { useEffect, useState } from 'react'
import { TEMPLATE_VARS } from '@/lib/shared/template-vars'

// Structurally identical to TemplateVariableDef in src/lib/templates/variables-shared.ts; `section`
// lets a caller file its own tokens (e.g. campaign tokens) under a custom picker heading.
export interface ComposerVariable {
  key: string
  label: string
  description: string
  group: 'customer' | 'store' | 'date' | 'order' | 'custom'
  sample: string
  builtIn: boolean
  section?: string
}

export const GROUP_LABELS: Record<ComposerVariable['group'], string> = {
  customer: 'Customer',
  store: 'Store',
  date: 'Date',
  order: 'Order',
  custom: 'Custom',
}

const FALLBACK: ComposerVariable[] = TEMPLATE_VARS.map(v => ({ ...v, builtIn: true }))

let cache: Promise<ComposerVariable[]> | null = null

export function loadTemplateVariables(): Promise<ComposerVariable[]> {
  if (!cache) {
    cache = fetch('/api/admin/template-variables', { credentials: 'include' })
      .then(async res => {
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as { variables?: ComposerVariable[] }
        return Array.isArray(data.variables) && data.variables.length ? data.variables : FALLBACK
      })
      .catch(() => {
        cache = null
        return FALLBACK
      })
  }
  return cache
}

export function resetTemplateVariablesCache() {
  cache = null
}

export function useTemplateVariables(extra?: ComposerVariable[]): ComposerVariable[] {
  const [vars, setVars] = useState<ComposerVariable[]>(FALLBACK)
  useEffect(() => {
    let alive = true
    loadTemplateVariables().then(v => alive && setVars(v))
    return () => {
      alive = false
    }
  }, [])
  if (!extra?.length) return vars
  const seen = new Set(extra.map(v => v.key))
  return [...extra, ...vars.filter(v => !seen.has(v.key))]
}

export interface VariableSection {
  title: string
  vars: ComposerVariable[]
}

export function groupVariables(vars: ComposerVariable[], query = ''): VariableSection[] {
  const q = query.trim().toLowerCase()
  const hits = q ? vars.filter(v => [v.key, v.label, v.description].some(s => s.toLowerCase().includes(q))) : vars
  const sections = new Map<string, ComposerVariable[]>()
  for (const v of hits) {
    const title = v.section || GROUP_LABELS[v.group] || 'Other'
    sections.set(title, [...(sections.get(title) || []), v])
  }
  return [...sections].map(([title, list]) => ({ title, vars: list }))
}
