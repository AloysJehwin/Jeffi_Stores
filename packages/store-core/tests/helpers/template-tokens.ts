import { expect } from 'vitest'
import { NextRequest } from 'next/server'
import { BUILTIN_VARIABLE_KEYS } from '@/lib/templates/variables'

// Shared by the no-raw-tokens checks in store-core, admin-service and storefront-service.
export const IDENTITY = { name: 'Acme Tools', email: 'hi@acme.in', phone: '+91 90000 11111', web: 'acme.in', logoUrl: '', emailAccent: '' }

// Any token (either syntax, any case) whose key is registered.
export function registeredLeaks(s: string | undefined): string[] {
  if (!s) return []
  const keys = [...BUILTIN_VARIABLE_KEYS, 'support_hours']
  return [...s.matchAll(/\{\{?\s*([a-z_][a-z0-9_]*)\s*\}?\}/gi)]
    .map(m => m[1].toLowerCase())
    .filter(k => keys.includes(k))
}
export function expectClean(...parts: Array<string | undefined>) {
  for (const p of parts) expect(registeredLeaks(p)).toEqual([])
}

// What the composer can produce: both syntaxes, the old styled chip, &nbsp; padding and a custom var.
export const COMPOSED =
  '<p>Hi {customer_first_name}, {{ store_name }} here.</p>' +
  '<p><span style="font-family:ui-monospace,monospace;border:1px solid #a78bfa;">{store_web}</span>&nbsp;' +
  '{{&nbsp;store_phone&nbsp;}} {Store_Email} {support_hours} {date} {current_year}</p>'
export const COMPOSED_SUBJECT = '{customer_first_name}, news from {{store_name}}'

export const SUPPORT_HOURS_VAR = { id: 'c1', key: 'support_hours', label: 'Hours', description: '', value: '9-6', is_enabled: true }

export const jsonRequest = (body: unknown) =>
  new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
