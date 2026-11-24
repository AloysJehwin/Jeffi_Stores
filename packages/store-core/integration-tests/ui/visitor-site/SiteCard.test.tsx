import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const interp = vi.hoisted(() => ({ makeEnv: vi.fn(), renderNode: vi.fn() }))

vi.mock('@/components/visitor/site/code/interpret', () => ({
  makeEnv: interp.makeEnv,
  renderNode: interp.renderNode,
}))
vi.mock('@/lib/site/code/allow', () => ({ inertCss: (css: string) => css }))
vi.mock('@/components/visitor/site/code/common/tiles', () => ({
  ProductTile: ({ product }: any) => <div data-testid="tile">{product.name}</div>,
}))

import { SiteCardView, SiteCardStyles, ProductItem, CardSamples } from '@/components/visitor/site/code/common/SiteCard'

const card = { id: 'card1', css: '.c{color:red}', ast: { tag: 'div' } } as any
const product = (over: any = {}) => ({ id: 'p1', slug: 'drill', name: 'Drill', ...over }) as any
const data = (products: any[] = []) => ({ products: vi.fn().mockResolvedValue(products) }) as any

beforeEach(() => {
  interp.makeEnv.mockReset().mockImplementation((o: any) => ({ vars: new Map(), opts: o }))
  interp.renderNode.mockReset().mockImplementation((_ast: unknown, env: any) => <span data-testid="card-body">{env.vars.size} vars</span>)
})

describe('SiteCardView', () => {
  it('draws the card AST with the product bound, its stretched-link wrapper and styles', async () => {
    const node = await SiteCardView({ card, product: product(), data: data(), priority: true })
    const { container } = render(node)
    expect(container.querySelector('[data-site-card="card1"]')).toHaveClass('relative')
    expect(screen.getByTestId('card-body')).toHaveTextContent('1 vars')
    expect(interp.makeEnv).toHaveBeenCalledWith(expect.objectContaining({ sectionId: 'card1', priority: true }))
    expect(container.querySelector('style')).toBeInTheDocument()
  })
})

describe('SiteCardStyles', () => {
  it('emits the card styles when forced for the root layout', () => {
    const { container } = render(<SiteCardStyles card={card} always />)
    expect(container.querySelector('style')!.innerHTML).toContain('color:red')
  })

  it('emits nothing for a card with no css', () => {
    const { container } = render(<SiteCardStyles card={{ ...card, css: '' }} always />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ProductItem', () => {
  it('uses the store tile when the site has no card', () => {
    render(<ProductItem product={product()} card={null} data={data()} />)
    expect(screen.getByTestId('tile')).toHaveTextContent('Drill')
  })

  it('renders nothing for something that is not a product', () => {
    const { container } = render(<ProductItem product={{ id: 'x' } as any} card={null} data={data()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws the site card when there is one', () => {
    const el: any = ProductItem({ product: product(), card, data: data() })
    expect(el.type).toBe(SiteCardView)
    expect(el.props.card).toBe(card)
  })
})

describe('CardSamples', () => {
  it('draws the card once per featured product', async () => {
    const node: any = await CardSamples({ card, data: data([product({ id: 'a' }), product({ id: 'b' })]) })
    expect(node.props.children).toHaveLength(2)
    expect(node.props.children[0].props.priority).toBe(true)
    expect(node.props.children[1].props.priority).toBe(false)
  })

  it('falls back to a stand-in product, with inert buttons, when the catalogue is empty or fails', async () => {
    const empty: any = await CardSamples({ card, data: data([]) })
    expect(empty.props.children).toHaveLength(1)
    expect(empty.props.children[0].props.product.name).toBe('Your product name')
    expect(empty.props.children[0].props.data.sample).toBe(true)
    const failing = { products: vi.fn().mockRejectedValue(new Error('x')) } as any
    const failed: any = await CardSamples({ card, data: failing })
    expect(failed.props.children[0].props.product.id).toBe('sample-card')
  })
})
