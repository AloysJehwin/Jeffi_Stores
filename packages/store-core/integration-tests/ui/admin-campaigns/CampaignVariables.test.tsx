import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))

import CampaignVariables from '@/components/admin/campaigns/CampaignVariables'

describe('CampaignVariables', () => {
  it('flags a required variable until the message uses it', () => {
    const { rerender } = render(<CampaignVariables kind="abandoned_cart" channel="email" text="Hello" />)
    expect(screen.getByText(/This campaign fills/)).toBeInTheDocument()
    const cta = screen.getByRole('button', { name: /\{ctaUrl\}/ })
    expect(cta.className).toContain('text-red-700')
    expect(cta).toHaveTextContent('required')
    rerender(<CampaignVariables kind="abandoned_cart" channel="email" text="Go to {ctaUrl}" />)
    expect(screen.getByRole('button', { name: /\{ctaUrl\}/ }).className).toContain('text-green-700')
  })

  it('shows the short-form set for sms without required flags', () => {
    render(<CampaignVariables kind="abandoned_cart" channel="sms" text="" />)
    expect(screen.getByRole('button', { name: /\{headline\}/ })).toBeInTheDocument()
    expect(screen.queryByText('required')).not.toBeInTheDocument()
  })

  it('copies a variable and toasts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<CampaignVariables kind="birthday" channel="email" text="" />)
    fireEvent.click(screen.getByRole('button', { name: /\{firstName\}/ }))
    expect(writeText).toHaveBeenCalledWith('{firstName}')
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Copied {firstName}', 'success'))
  })
})
