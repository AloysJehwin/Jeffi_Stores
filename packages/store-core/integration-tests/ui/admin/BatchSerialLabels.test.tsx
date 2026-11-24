import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/admin/BatchSerialLabelPicker', () => ({
  default: ({ mode, labelSizes }: any) => (
    <div data-testid="picker">
      {mode}:{labelSizes.length}
    </div>
  ),
}))

import BatchSerialLabels from '@/components/admin/BatchSerialLabels'
import { LABEL_SIZES } from '@/lib/documents/label-sizes'

describe('BatchSerialLabels', () => {
  it('defaults to the built-in label sizes', () => {
    render(<BatchSerialLabels mode="batch" />)
    expect(screen.getByTestId('picker')).toHaveTextContent(`batch:${LABEL_SIZES.length}`)
  })

  it('passes custom sizes and mode through', () => {
    render(<BatchSerialLabels mode="serial" labelSizes={[LABEL_SIZES[0]]} />)
    expect(screen.getByTestId('picker')).toHaveTextContent('serial:1')
  })
})
