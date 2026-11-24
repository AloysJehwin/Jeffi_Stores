import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KybBadge, kybBlock, KybBlocked, type KybBlock, type KybReadiness } from '@controller/components/admin/ecom/tabs/KybGate'

// ActionButton needs the write-scope + confirm contexts; allow writes and auto-confirm so clicks run.
vi.mock('@/contexts/AdminScopesContext', () => ({ useCanWrite: () => true }))
vi.mock('@/contexts/ConfirmContext', () => ({ useConfirm: () => () => Promise.resolve(true) }))

describe('kybBlock', () => {
  it('parses a 409 with canForce into a block, keeping only non-empty service lists', () => {
    const b = kybBlock(409, { canForce: true, error: 'Incomplete', missing: { store: [{ item: 'pan', label: 'PAN' }], messaging: [] } })
    expect(b).not.toBeNull()
    expect(b!.error).toBe('Incomplete')
    expect(Object.keys(b!.missing)).toEqual(['store'])
  })
  it('returns null for any answer that is not a forceable 409', () => {
    expect(kybBlock(200, { canForce: true })).toBeNull()
    expect(kybBlock(409, { canForce: false })).toBeNull()
    expect(kybBlock(409, null)).toBeNull()
  })
})

describe('KybBadge (states)', () => {
  const r = (over: Partial<KybReadiness>): KybReadiness => ({ ready: false, verified: false, todo: [], ...over })
  it('renders nothing without readiness', () => {
    const { container } = render(<KybBadge readiness={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('shows the verified label when everything is checked', () => {
    render(<KybBadge readiness={r({ ready: true, verified: true })} />)
    expect(screen.getByText('KYB verified')).toBeInTheDocument()
  })
  it('shows the complete label when ready but not verified', () => {
    render(<KybBadge readiness={r({ ready: true })} />)
    expect(screen.getByText('KYB complete')).toBeInTheDocument()
  })
  it('counts the to-do items when incomplete', () => {
    render(<KybBadge readiness={r({ todo: [{ label: 'PAN' }, { label: 'GST' }] })} />)
    expect(screen.getByText('KYB: 2 to do')).toBeInTheDocument()
  })
})

describe('KybBlocked (render + actions)', () => {
  const block: KybBlock = {
    error: 'KYB incomplete for this store',
    missing: { store: [{ item: 'pan', label: 'PAN card', problem: 'not uploaded' }], messaging: [{ item: 'use', label: 'Use case' }] },
  }

  it('lists each missing item under its mapped service label', () => {
    render(<KybBlocked block={block} onForce={async () => {}} onCancel={() => {}} />)
    expect(screen.getByText('The KYB isn’t complete for Online store and Messaging API.')).toBeInTheDocument()
    expect(screen.getByText('Online store')).toBeInTheDocument()
    expect(screen.getByText('Messaging API')).toBeInTheDocument()
    expect(screen.getByText('PAN card: not uploaded')).toBeInTheDocument()
    expect(screen.getByText('Use case')).toBeInTheDocument()
  })

  it('invokes onCancel from the Keep in review button', () => {
    const onCancel = vi.fn<(...a: any[]) => any>()
    render(<KybBlocked block={block} onForce={async () => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Keep in review' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('invokes onForce from the confirmed danger button, using the custom label', async () => {
    const onForce = vi.fn<(...a: any[]) => any>().mockResolvedValue(undefined)
    render(<KybBlocked block={block} onForce={onForce} onCancel={() => {}} forceLabel="Force approve" />)
    fireEvent.click(screen.getByRole('button', { name: 'Force approve' }))
    await vi.waitFor(() => expect(onForce).toHaveBeenCalledTimes(1))
  })
})
