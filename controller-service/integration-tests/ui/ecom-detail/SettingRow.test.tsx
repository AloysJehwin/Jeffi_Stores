import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SettingRow from '@controller/components/admin/ecom/detail/SettingRow'

describe('SettingRow (render + branches)', () => {
  it('renders title, value, hint and the control child', () => {
    render(
      <SettingRow title="UPI collection" value="On" hint="UPI goes straight to the store">
        <button>Turn off</button>
      </SettingRow>
    )
    expect(screen.getByText('UPI collection')).toBeInTheDocument()
    expect(screen.getByText('On')).toBeInTheDocument()
    expect(screen.getByText('UPI goes straight to the store')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument()
  })

  it('omits value and hint when not given', () => {
    render(
      <SettingRow title="Bare">
        <span>control</span>
      </SettingRow>
    )
    expect(screen.getByText('Bare')).toBeInTheDocument()
    expect(screen.getByText('control')).toBeInTheDocument()
    // Only the title paragraph; no value/hint lines.
    expect(screen.queryByText('On')).toBeNull()
  })
})
