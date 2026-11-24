import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))
vi.mock('@/components/visitor/site/code/parts/chrome/client', () => ({
  MenuButtonPart: ({ from }: any) => <button data-testid="menu" data-from={from}>menu</button>,
}))

import { NavList, FooterColumns, SocialIcons, SOCIAL_LABEL } from '@/components/visitor/site/code/parts/chrome/static'

const links = [{ label: 'Shop', href: '/products' }, { label: 'About', href: '/about' }]

describe('NavList', () => {
  it('lists the links in a main nav with a phone menu button by default', () => {
    render(<NavList links={links} />)
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Shop' })).toHaveAttribute('href', '/products')
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about')
    expect(screen.getByTestId('menu')).toHaveAttribute('data-from', 'lg')
  })

  it('passes the breakpoint to the menu button', () => {
    render(<NavList links={links} from="md" />)
    expect(screen.getByTestId('menu')).toHaveAttribute('data-from', 'md')
  })

  it('has no menu button when the links scroll, show or hide', () => {
    const { rerender } = render(<NavList links={links} mobile="scroll" />)
    expect(screen.queryByTestId('menu')).toBeNull()
    expect(screen.getByRole('navigation')).toHaveClass('overflow-x-auto')
    rerender(<NavList links={links} mobile="show" />)
    expect(screen.queryByTestId('menu')).toBeNull()
    rerender(<NavList links={links} mobile="hide" />)
    expect(screen.getByRole('link', { name: 'Shop' })).toBeInTheDocument()
    expect(screen.queryByTestId('menu')).toBeNull()
  })

  it('draws the design\'s own items instead of plain links', () => {
    render(<NavList links={links} items={[<b key="1">Custom one</b>, <b key="2">Custom two</b>]} mobile="show" />)
    expect(screen.getByText('Custom one')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('FooterColumns', () => {
  const columns = [
    { title: 'Help', links: [{ label: 'Shipping', href: '/shipping' }] },
    { title: 'Company', links: [{ label: 'Careers', href: '/careers' }, { label: 'Press', href: '/press' }] },
  ]

  it('renders a labelled nav per column', () => {
    render(<FooterColumns columns={columns} />)
    expect(screen.getByRole('navigation', { name: 'Help' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Careers' })).toHaveAttribute('href', '/careers')
    expect(screen.getByText('Company')).toBeInTheDocument()
  })

  it('sizes the grid by the number of columns', () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ title: `C${i}`, links: [] }))
    const { container, rerender } = render(<FooterColumns columns={many} />)
    expect(container.firstChild).toHaveClass('sm:grid-cols-4')
    rerender(<FooterColumns columns={columns} />)
    expect(container.firstChild).toHaveClass('grid-cols-2')
    expect(container.firstChild).not.toHaveClass('sm:grid-cols-4')
  })

  it('draws items instead of the default columns, or nothing when empty', () => {
    const { container, rerender } = render(<FooterColumns columns={columns} items={[<i key="a">A</i>, <i key="b">B</i>]} />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).toBeNull()
    rerender(<FooterColumns columns={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('SocialIcons', () => {
  const social = [{ network: 'instagram', href: 'https://instagram.com/jeffi' }, { network: 'whatsapp', href: 'https://wa.me/1' }] as any

  it('links to each profile in a new tab with the network as its name', () => {
    render(<SocialIcons links={social} />)
    const ig = screen.getByRole('link', { name: SOCIAL_LABEL.instagram })
    expect(ig).toHaveAttribute('href', 'https://instagram.com/jeffi')
    expect(ig).toHaveAttribute('target', '_blank')
    expect(ig).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeInTheDocument()
  })

  it('draws inert icons, with no links, for the studio preview', () => {
    render(<SocialIcons links={social} inert />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getAllByRole('presentation').length).toBeGreaterThanOrEqual(2)
  })

  it('draws items instead, and nothing for no links', () => {
    const { container, rerender } = render(<SocialIcons links={social} items={[<i key="1">one</i>, <i key="2">two</i>]} />)
    expect(screen.getByText('one')).toBeInTheDocument()
    rerender(<SocialIcons links={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws a glyph for every supported network', () => {
    const all = ['instagram', 'facebook', 'youtube', 'x', 'linkedin', 'pinterest', 'whatsapp'].map(network => ({ network, href: `https://${network}.test` })) as any
    const { container } = render(<SocialIcons links={all} />)
    expect(container.querySelectorAll('a svg')).toHaveLength(7)
  })
})
