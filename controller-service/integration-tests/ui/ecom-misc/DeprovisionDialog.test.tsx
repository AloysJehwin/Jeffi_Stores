import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DeprovisionDialog, { type KeepChoice } from '@controller/components/admin/ecom/DeprovisionDialog'

// Uses the real kit Dialog + FormButton. The dialog forces an explicit Keep/Delete for each of the
// three items before the destructive button enables, and reports the KeepChoice to onConfirm.

describe('DeprovisionDialog', () => {
  it('renders nothing visible when closed', () => {
    render(<DeprovisionDialog open={false} slug="acme" retentionDays={30} onClose={() => {}} onConfirm={async () => {}} />)
    expect(screen.queryByText(/Deprovision "acme"\?/)).not.toBeInTheDocument()
  })

  it('renders the three keep/delete items and a disabled confirm until all chosen', () => {
    render(<DeprovisionDialog open slug="acme" retentionDays={30} onClose={() => {}} onConfirm={async () => {}} />)
    expect(screen.getByText('Deprovision "acme"?')).toBeInTheDocument()
    expect(screen.getByText('Database')).toBeInTheDocument()
    expect(screen.getByText('Media files')).toBeInTheDocument()
    expect(screen.getByText('Configuration')).toBeInTheDocument()
    // Confirm button disabled before any choice.
    expect(screen.getByRole('button', { name: 'Deprovision' })).toBeDisabled()
    expect(screen.getByText(/Pick Keep or Delete for each item/)).toBeInTheDocument()
  })

  it('shows the stop-and-deprovision wording while a build runs', () => {
    render(<DeprovisionDialog open slug="acme" retentionDays={30} building onClose={() => {}} onConfirm={async () => {}} />)
    expect(screen.getByText('Stop and deprovision "acme"?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop & deprovision' })).toBeInTheDocument()
  })

  it('enables and submits the KeepChoice once every item is set', async () => {
    const onConfirm = vi.fn<(keep: KeepChoice) => Promise<void>>().mockResolvedValue(undefined)
    render(<DeprovisionDialog open slug="acme" retentionDays={30} onClose={() => {}} onConfirm={onConfirm} />)

    // Keep database, delete the other two. Three "Keep" + three "Delete" radios, one pair per item.
    const keepRadios = screen.getAllByRole('radio', { name: 'Keep for the owner' })
    const deleteRadios = screen.getAllByRole('radio', { name: 'Delete now' })
    fireEvent.click(keepRadios[0]) // database: keep
    fireEvent.click(deleteRadios[1]) // media: delete
    fireEvent.click(deleteRadios[2]) // config: delete

    const confirm = screen.getByRole('button', { name: 'Deprovision' })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onConfirm).toHaveBeenCalledWith({ database: true, media: false, config: false })
  })

  it('shows retention wording once at least one item is kept', () => {
    render(<DeprovisionDialog open slug="acme" retentionDays={45} onClose={() => {}} onConfirm={async () => {}} />)
    const keepRadios = screen.getAllByRole('radio', { name: 'Keep for the owner' })
    const deleteRadios = screen.getAllByRole('radio', { name: 'Delete now' })
    fireEvent.click(keepRadios[0])
    fireEvent.click(deleteRadios[1])
    fireEvent.click(deleteRadios[2])
    expect(screen.getByText(/stays for 45 days/)).toBeInTheDocument()
  })
})
