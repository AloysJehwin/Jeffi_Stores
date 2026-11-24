import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import CopyLinkButton from '@/components/admin/CopyLinkButton'

describe('CopyLinkButton', () => {
  it('shows the url and copies it to the clipboard', async () => {
    const writeText = vi.fn<(...a: any[]) => any>().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { container } = render(<CopyLinkButton url="https://shop.test/p/1" />)
    expect(screen.getByText('https://shop.test/p/1')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Copy link'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://shop.test/p/1'))
    await waitFor(() => expect(container.querySelector('.text-green-500')).not.toBeNull())
  })

  it('reverts the copied tick after a delay', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn<(...a: any[]) => any>().mockResolvedValue(undefined) } })
    const st = vi.spyOn(globalThis, 'setTimeout')
    const { container } = render(<CopyLinkButton url="u" />)
    fireEvent.click(screen.getByTitle('Copy link'))
    await waitFor(() => expect(container.querySelector('.text-green-500')).not.toBeNull())
    const call = st.mock.calls.find(c => c[1] === 2500)!
    act(() => (call[0] as () => void)())
    expect(container.querySelector('.text-green-500')).toBeNull()
  })

  it('does not show the tick when the clipboard write fails', async () => {
    const writeText = vi.fn<(...a: any[]) => any>().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { container } = render(<CopyLinkButton url="u" />)
    fireEvent.click(screen.getByTitle('Copy link'))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(container.querySelector('.text-green-500')).toBeNull()
  })
})
