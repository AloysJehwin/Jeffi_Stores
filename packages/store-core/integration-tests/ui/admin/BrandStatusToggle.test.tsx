import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let canWrite = true
vi.mock('@/contexts/AdminScopesContext', () => ({
  RequireWrite: ({ children }: any) => (canWrite ? <>{children}</> : null),
}))

import BrandStatusToggle from '@/components/admin/BrandStatusToggle'

const brand = {
  name: 'Acme',
  slug: 'acme',
  description: null,
  website: null,
  is_active: true,
  return_allowed: true,
  return_window_days: 7,
  replacement_allowed: false,
  replacement_window_days: 0,
}

describe('BrandStatusToggle', () => {
  beforeEach(() => {
    canWrite = true
  })

  it('shows Active/Inactive from the brand', () => {
    const first = render(<BrandStatusToggle brandId="b1" brandData={brand} />)
    expect(screen.getByRole('button', { name: 'Active' })).toBeInTheDocument()
    first.unmount()
    render(<BrandStatusToggle brandId="b1" brandData={{ ...brand, is_active: false }} />)
    expect(screen.getByRole('button', { name: 'Inactive' })).toBeInTheDocument()
  })

  it('PATCHes the brand with the flipped flag', async () => {
    const f = vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', f)
    render(<BrandStatusToggle brandId="b1" brandData={brand} />)
    fireEvent.click(screen.getByRole('button', { name: 'Active' }))
    expect(await screen.findByRole('button', { name: 'Inactive' })).toBeInTheDocument()
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/admin/brands/b1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toMatchObject({ name: 'Acme', slug: 'acme', is_active: false, return_window_days: 7 })
  })

  it('reverts when the server rejects', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockResolvedValue({ ok: false }))
    render(<BrandStatusToggle brandId="b1" brandData={brand} />)
    fireEvent.click(screen.getByRole('button', { name: 'Active' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Active' })).toBeEnabled())
  })

  it('reverts when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => any>().mockRejectedValue(new Error('x')))
    render(<BrandStatusToggle brandId="b1" brandData={brand} />)
    fireEvent.click(screen.getByRole('button', { name: 'Active' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Active' })).toBeEnabled())
  })

  it('is hidden without brands:write', () => {
    canWrite = false
    const { container } = render(<BrandStatusToggle brandId="b1" brandData={brand} />)
    expect(container.firstChild).toBeNull()
  })
})
