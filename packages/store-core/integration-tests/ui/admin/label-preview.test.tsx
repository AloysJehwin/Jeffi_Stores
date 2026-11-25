import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  BarcodePlaceholder,
  BatchSerialPreview,
  LabelPreview,
  PriceBlock,
  QRPlaceholder,
  fmtPrice,
} from '@/components/admin/label-preview'
import { LABEL_SIZES } from '@/lib/documents/label-sizes'

const product = {
  name: 'Blue Shirt',
  variant_name: 'Large',
  sku: 'SH-001',
  brand_name: 'Acme',
  mrp: 200,
  price_ex_gst: 100,
  gst_percentage: 18,
}

const spec = (size: string) => LABEL_SIZES.find(s => s.size === size)!

describe('fmtPrice', () => {
  it('formats whole rupees and blanks empty values', () => {
    expect(fmtPrice(1299.6)).toBe('Rs. 1300')
    expect(fmtPrice(0)).toBe('')
    expect(fmtPrice(null)).toBe('')
    expect(fmtPrice(undefined)).toBe('')
  })
})

describe('PriceBlock', () => {
  const base = { mainSize: 10, subSize: 6, gap: 1 }

  it('shows GST-inclusive price, ex-GST and a struck MRP', () => {
    render(<PriceBlock exGst={100} mrp={200} gstPct={18} {...base} />)
    expect(screen.getByText('Rs. 118.00')).toBeInTheDocument()
    expect(screen.getByText('Rs. 236.00')).toHaveStyle({ textDecoration: 'line-through' })
    expect(screen.getByText('ex. GST Rs. 100.00')).toBeInTheDocument()
  })

  it('hides ex-GST when there is no GST and MRP when it equals the price', () => {
    render(<PriceBlock exGst={100} mrp={100} gstPct={0} {...base} />)
    expect(screen.getByText('Rs. 100.00')).toBeInTheDocument()
    expect(screen.queryByText(/ex\. GST/)).toBeNull()
    expect(screen.getAllByText(/Rs\./)).toHaveLength(1)
  })

  it('renders nothing without a price', () => {
    const { container } = render(<PriceBlock exGst={0} mrp={null} gstPct={18} {...base} />)
    expect(container.firstChild).toBeNull()
    const second = render(<PriceBlock exGst={null} mrp={null} gstPct={18} {...base} />)
    expect(second.container.firstChild).toBeNull()
  })
})

describe('BarcodePlaceholder / QRPlaceholder', () => {
  it('draws the barcode caption truncated to 16 characters', () => {
    const { container } = render(<BarcodePlaceholder width={100} height={30} text="ABCDEFGHIJKLMNOPQRSTUV" />)
    expect(container.querySelector('text')).toHaveTextContent('ABCDEFGHIJKLMNOP')
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(5)
  })

  it('draws a square QR of the requested size', () => {
    const { container } = render(<QRPlaceholder size={42} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('width', '42')
    expect(svg).toHaveAttribute('height', '42')
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(20)
  })
})

describe('LabelPreview', () => {
  it.each(['30x20', '80x20', '30x50', '40x60', '50x50', 'shelf-card'])('renders the %s layout with product, variant, SKU barcode and price', size => {
    const { container } = render(<LabelPreview size={spec(size)} product={product} scale={3} showPrice />)
    expect(screen.getByText('Blue Shirt')).toBeInTheDocument()
    expect(screen.getByText('Large')).toBeInTheDocument()
    expect(screen.getByText('Rs. 118.00')).toBeInTheDocument()
    expect(container.querySelector('svg text')).toHaveTextContent('SH-001')
  })

  it.each(['30x20', '80x20', '30x50', '40x60', '50x50', 'shelf-card'])('hides the price on %s when showPrice is off', size => {
    render(<LabelPreview size={spec(size)} product={product} scale={3} showPrice={false} />)
    expect(screen.queryByText(/Rs\./)).toBeNull()
  })

  it('shows the SKU and brand text on the larger layouts', () => {
    render(<LabelPreview size={spec('50x50')} product={product} scale={3} showPrice />)
    expect(screen.getByText('SKU: SH-001')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
  })

  it('sizes the label from the spec and scale', () => {
    const { container } = render(<LabelPreview size={spec('40x60')} product={product} scale={2} showPrice />)
    const el = container.firstChild as HTMLElement
    expect(el.style.width).toBe(`${Math.round(spec('40x60').widthPt * 2)}px`)
    expect(el.style.height).toBe(`${Math.round(spec('40x60').heightPt * 2)}px`)
  })

  it('falls back to placeholder content without a product and omits the price', () => {
    const { container } = render(<LabelPreview size={spec('40x60')} product={null} scale={3} showPrice />)
    expect(screen.getByText('Product Name')).toBeInTheDocument()
    expect(container.querySelector('svg text')).toHaveTextContent('SKU-001')
    expect(screen.queryByText(/Rs\./)).toBeNull()
  })

  it('derives the ex-GST price from the base price when none is given', () => {
    render(<LabelPreview size={spec('40x60')} product={{ name: 'X', sku: 'X1', base_price: 118, gst_percentage: 18 }} scale={3} showPrice />)
    expect(screen.getByText('Rs. 118.00')).toBeInTheDocument()
  })

  it('renders nothing for an unknown size', () => {
    const { container } = render(<LabelPreview size={{ ...spec('40x60'), size: 'weird' as any }} product={product} scale={3} showPrice />)
    expect(container.firstChild).toBeNull()
  })
})

describe('BatchSerialPreview', () => {
  const size = spec('40x60')

  it('batch mode lists LOT, EXP and QTY and uses the lot as barcode text', () => {
    const { container } = render(
      <BatchSerialPreview
        size={size}
        mode="batch"
        scale={3}
        batch={{ productName: 'Syrup', variantName: '100ml', sku: 'SY-1', lotNumber: 'LOT-7', expiryDate: '2027-01-02', quantity: 24 }}
      />
    )
    expect(screen.getByText('Syrup')).toBeInTheDocument()
    expect(screen.getByText('100ml')).toBeInTheDocument()
    expect(screen.getByText('LOT: LOT-7')).toBeInTheDocument()
    expect(screen.getByText('EXP: 2027-01-02')).toBeInTheDocument()
    expect(screen.getByText('QTY: 24')).toBeInTheDocument()
    expect(container.querySelector('svg text')).toHaveTextContent('LOT-7')
  })

  it('batch mode without data falls back to placeholders', () => {
    const { container } = render(<BatchSerialPreview size={size} mode="batch" scale={3} batch={null} />)
    expect(screen.getByText('Product Name')).toBeInTheDocument()
    expect(screen.queryByText(/^LOT:/)).toBeNull()
    expect(container.querySelector('svg text')).toHaveTextContent('LOT')
  })

  it('batch mode barcodes the SKU when there is no lot', () => {
    const { container } = render(<BatchSerialPreview size={size} mode="batch" scale={3} batch={{ productName: 'P', sku: 'SKU-9' }} />)
    expect(container.querySelector('svg text')).toHaveTextContent('SKU-9')
  })

  it('serial mode lists SKU, LOT and a bold serial number', () => {
    const { container } = render(
      <BatchSerialPreview size={size} mode="serial" scale={3} serial={{ productName: 'Laptop', sku: 'LP-1', serialNumber: 'SN-123', lotNumber: 'L9' }} />
    )
    expect(screen.getByText('SKU: LP-1')).toBeInTheDocument()
    expect(screen.getByText('LOT: L9')).toBeInTheDocument()
    expect(screen.getByText('S/N: SN-123')).toHaveStyle({ fontWeight: 700 })
    expect(container.querySelector('svg text')).toHaveTextContent('SN-123')
  })

  it('serial mode without data shows a dash and the S/N caption', () => {
    const { container } = render(<BatchSerialPreview size={size} mode="serial" scale={3} serial={null} />)
    expect(screen.getByText('S/N: —')).toBeInTheDocument()
    expect(container.querySelector('svg text')).toHaveTextContent('S/N')
  })
})
