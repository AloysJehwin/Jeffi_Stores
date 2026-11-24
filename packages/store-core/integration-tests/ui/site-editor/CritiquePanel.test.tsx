import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CritiquePanel from '@/components/site-editor/CritiquePanel'
import type { TreeFinding } from '@/lib/site/code/tree-critique'

const contrast: TreeFinding = {
  code: 'contrast' as any,
  severity: 'error',
  block: 'a',
  id: 'e2',
  message: 'Text is hard to read on this background.',
  fix: { ops: [{ op: 'noop' } as any] },
}
const long: TreeFinding = {
  code: 'long' as any,
  severity: 'warn',
  block: 'a',
  id: 'e3',
  message: 'This heading is too long.',
  fix: { shorten: { fieldId: 'e3.0', text: 'A very long heading' } },
}
const unfixable: TreeFinding = { code: 'alt' as any, severity: 'warn', block: 'b', id: 'e9', message: 'Picture has no description.' }

const base = { canWrite: true, canShorten: true, busy: false, onShow: vi.fn(), onFix: vi.fn() }

describe('CritiquePanel', () => {
  it('says all is well when there are no findings', () => {
    render(<CritiquePanel {...base} findings={[]} />)
    expect(screen.getByText(/Nothing to fix/)).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('lists each finding with Show, and Fix or Shorten with AI where one exists', () => {
    const onShow = vi.fn()
    const onFix = vi.fn()
    render(<CritiquePanel {...base} onShow={onShow} onFix={onFix} findings={[contrast, long, unfixable]} />)
    expect(screen.getByRole('list', { name: 'What to fix' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Show' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: /Fix|Shorten with AI/ })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: 'Show' })[2])
    expect(onShow).toHaveBeenCalledWith(unfixable)
    fireEvent.click(screen.getByRole('button', { name: 'Fix' }))
    expect(onFix).toHaveBeenCalledWith(contrast)
    fireEvent.click(screen.getByRole('button', { name: 'Shorten with AI' }))
    expect(onFix).toHaveBeenLastCalledWith(long)
  })

  it('hides fixes without write access, and the AI shortening when it is unavailable', () => {
    const { rerender } = render(<CritiquePanel {...base} canWrite={false} findings={[contrast, long]} />)
    expect(screen.queryByRole('button', { name: 'Fix' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Shorten with AI' })).toBeNull()
    rerender(<CritiquePanel {...base} canShorten={false} findings={[contrast, long]} />)
    expect(screen.getByRole('button', { name: 'Fix' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Shorten with AI' })).toBeNull()
  })

  it('disables fixes while busy and treats an empty op list as unfixable', () => {
    const empty: TreeFinding = { ...contrast, id: 'x', fix: { ops: [] } }
    render(<CritiquePanel {...base} busy findings={[contrast, empty]} />)
    const fixes = screen.getAllByRole('button', { name: 'Fix' })
    expect(fixes).toHaveLength(1)
    expect(fixes[0]).toBeDisabled()
  })
})
