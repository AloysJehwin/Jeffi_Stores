import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const buildHomeModel = vi.hoisted(() => vi.fn())
const getPublishedTheme = vi.hoisted(() => vi.fn())

vi.mock('@/lib/catalog/homepage-model', () => ({
  buildHomeModel,
  toHomeModelJson: (m: object) => ({ ...m, json: true }),
}))
vi.mock('@/lib/site/store', () => ({ getPublishedTheme }))
vi.mock('@jeffi/site-blocks', () => ({
  themeCssVars: () => ({ '--c-primary': '#111', '--radius-md': '8px', '--font-body': 'serif' }),
}))

import { GET, OPTIONS } from '@storefront/app/api/(public)/home/route'

const get = (qs = '') => GET(new NextRequest(`http://localhost/api/home${qs}`))

describe('/api/home', () => {
  beforeEach(() => {
    buildHomeModel.mockResolvedValue({ sections: [] })
    getPublishedTheme.mockResolvedValue(null)
  })

  it('OPTIONS answers 204', async () => {
    expect((await OPTIONS()).status).toBe(204)
  })

  it('defaults to the web surface and flags a legacy app build when no surface is sent', async () => {
    const res = await get()
    expect(buildHomeModel).toHaveBeenCalledWith(expect.objectContaining({ surface: 'web', legacyClient: true }))
    expect(await res.json()).toEqual({ sections: [], json: true, theme: null })
    expect(res.headers.get('cache-control')).toContain('s-maxage=120')
  })

  it('serves the app surface and exposes only colour and radius theme vars', async () => {
    getPublishedTheme.mockResolvedValue({ any: 'theme' })
    const res = await get('?surface=app')
    expect(buildHomeModel).toHaveBeenCalledWith(expect.objectContaining({ surface: 'app', legacyClient: false }))
    expect((await res.json()).theme).toEqual({ vars: { '--c-primary': '#111', '--radius-md': '8px' } })
    expect(getPublishedTheme).toHaveBeenCalledWith('store')
  })

  it('uses the business theme for the business audience, falling back to the store theme', async () => {
    getPublishedTheme.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce({ t: 1 })
    const res = await get('?audience=business')
    expect(getPublishedTheme).toHaveBeenNthCalledWith(1, 'business')
    expect(getPublishedTheme).toHaveBeenNthCalledWith(2, 'store')
    expect((await res.json()).theme).not.toBeNull()
  })

  it('surfaces a model build failure', async () => {
    buildHomeModel.mockRejectedValue(new Error('db'))
    await expect(get()).rejects.toThrow('db')
  })
})
