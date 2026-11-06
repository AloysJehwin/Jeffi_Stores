import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import glob from 'fast-glob'

// The ecom API is the control plane. Middleware limits it to the platform administrator, but its log
// mode lets cert-carrying calls through, so every route checks for itself too.
const GUARD = /\b(isPlatformAdmin|requireAdminScope|hasScope|ecomOverviewGet)\(/

describe('ecom admin routes guard themselves', () => {
  const files = glob.sync('controller-service/src/app/api/\\(admin\\)/admin/ecom/**/route.ts', { cwd: process.cwd() })

  it('finds the ecom routes', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('every route calls a platform or scope guard', () => {
    const unguarded = files.filter(f => !GUARD.test(fs.readFileSync(path.join(process.cwd(), f), 'utf8')))
    expect(unguarded).toEqual([])
  })
})
