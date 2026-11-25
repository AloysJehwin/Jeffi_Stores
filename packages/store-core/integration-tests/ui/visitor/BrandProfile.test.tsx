import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import {
  Paragraphs,
  brandSocialLinks,
  brandAccent,
  countryName,
  BrandBanner,
  BrandAccentBar,
  BrandFacts,
  BrandSocialLinks,
  BrandStory,
  BrandWarrantyService,
  SeoContent,
} from '@/components/visitor/brand/BrandProfile'

const brand = (over: Record<string, any> = {}) => ({ name: 'Halo', ...over }) as any

describe('helpers', () => {
  it('brandSocialLinks keeps only http(s) links, from an object or JSON string, in a fixed order', () => {
    const links = brandSocialLinks({ youtube: 'https://yt.test/h', instagram: 'http://ig.test/h', x: 'javascript:alert(1)', facebook: '' })
    expect(links).toEqual([['Instagram', 'http://ig.test/h'], ['YouTube', 'https://yt.test/h']])
    expect(brandSocialLinks('{"linkedin":"https://li.test/h"}')).toEqual([['LinkedIn', 'https://li.test/h']])
    expect(brandSocialLinks('not json')).toEqual([])
    expect(brandSocialLinks(null)).toEqual([])
  })

  it('brandAccent accepts only #rgb / #rrggbb', () => {
    expect(brandAccent('#abc')).toBe('#abc')
    expect(brandAccent(' #A1B2C3 ')).toBe('#A1B2C3')
    expect(brandAccent('red')).toBeNull()
    expect(brandAccent('#abcd')).toBeNull()
    expect(brandAccent('url(x)')).toBeNull()
    expect(brandAccent(undefined)).toBeNull()
  })

  it('countryName resolves ISO codes and rejects anything else', () => {
    expect(countryName('in')).toBe('India')
    expect(countryName('JP')).toBe('Japan')
    expect(countryName('IND')).toBeNull()
    expect(countryName('')).toBeNull()
    expect(countryName(null)).toBeNull()
  })
})

describe('Paragraphs / SeoContent', () => {
  it('splits on blank lines and drops empties', () => {
    const { container } = render(<Paragraphs text={'First\n\n  \n\nSecond line\nstill second'} className="x" />)
    expect(container.querySelectorAll('p')).toHaveLength(2)
    expect(container.firstChild).toHaveClass('x')
  })

  it('renders nothing for blank text', () => {
    expect(render(<Paragraphs text="   " />).container).toBeEmptyDOMElement()
    expect(render(<Paragraphs text={null} />).container).toBeEmptyDOMElement()
    expect(render(<SeoContent text="" />).container).toBeEmptyDOMElement()
  })

  it('SeoContent shows its copy', () => {
    render(<SeoContent text="Buy Halo online." />)
    expect(screen.getByText('Buy Halo online.')).toBeInTheDocument()
  })
})

describe('BrandBanner', () => {
  it('renders a responsive picture using the desktop source from 768px', () => {
    const { container } = render(<BrandBanner brand={brand({ banner_desktop_url: 'https://c.test/d.jpg', banner_mobile_url: '/m.jpg' })} />)
    expect(container.querySelector('source')).toHaveAttribute('srcset', 'https://c.test/d.jpg')
    expect(screen.getByAltText('Halo')).toHaveAttribute('src', '/m.jpg')
  })

  it('falls back to the desktop image when there is no mobile one, and to nothing without either', () => {
    render(<BrandBanner brand={brand({ banner_desktop_url: '/d.jpg' })} />)
    expect(screen.getByAltText('Halo')).toHaveAttribute('src', '/d.jpg')
    expect(render(<BrandBanner brand={brand()} />).container).toBeEmptyDOMElement()
  })
})

describe('BrandAccentBar', () => {
  it('draws a coloured bar only for a valid colour', () => {
    const { container } = render(<BrandAccentBar color="#ff0000" />)
    expect((container.firstChild as HTMLElement).getAttribute('style')).toContain('#ff0000')
    expect(render(<BrandAccentBar color="red" />).container).toBeEmptyDOMElement()
  })
})

describe('BrandFacts', () => {
  it('lists founded year, headquarters and country of origin', () => {
    render(<BrandFacts brand={brand({ founded_year: 1998, headquarters: 'Pune', country_of_origin: 'IN' })} />)
    expect(screen.getByText('Founded').nextSibling).toHaveTextContent('1998')
    expect(screen.getByText('Headquarters').nextSibling).toHaveTextContent('Pune')
    expect(screen.getByText('Country of origin').nextSibling).toHaveTextContent('India')
  })

  it('skips a malformed year and renders nothing when no fact is left', () => {
    render(<BrandFacts brand={brand({ founded_year: '98', headquarters: 'Pune' })} />)
    expect(screen.queryByText('Founded')).not.toBeInTheDocument()
    expect(render(<BrandFacts brand={brand({ founded_year: 'x' })} />).container).toBeEmptyDOMElement()
  })
})

describe('BrandSocialLinks', () => {
  it('opens each link safely in a new tab', () => {
    render(<BrandSocialLinks brand={brand({ social_links: { instagram: 'https://ig.test/h' } })} />)
    const a = screen.getByRole('link', { name: 'Instagram' })
    expect(a).toHaveAttribute('href', 'https://ig.test/h')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders nothing without valid links', () => {
    expect(render(<BrandSocialLinks brand={brand({ social_links: { x: 'ftp://nope' } })} />).container).toBeEmptyDOMElement()
  })
})

describe('BrandStory', () => {
  it('shows the story under an "About <brand>" heading', () => {
    render(<BrandStory brand={brand({ story: 'Founded in a garage.' })} />)
    expect(screen.getByRole('heading', { name: 'About Halo' })).toBeInTheDocument()
    expect(screen.getByText('Founded in a garage.')).toBeInTheDocument()
    expect(render(<BrandStory brand={brand({ story: ' ' })} />).container).toBeEmptyDOMElement()
  })
})

describe('BrandWarrantyService', () => {
  it('renders nothing when there is no warranty or service info', () => {
    expect(render(<BrandWarrantyService brand={brand()} />).container).toBeEmptyDOMElement()
  })

  it('formats warranty in years or months with its type', () => {
    const a = render(<BrandWarrantyService brand={brand({ default_warranty_months: 24, default_warranty_type: 'on_site' })} />)
    expect(screen.getByText('2 years on site')).toBeInTheDocument()
    a.unmount()
    const b = render(<BrandWarrantyService brand={brand({ default_warranty_months: 12 })} />)
    expect(screen.getByText('1 year')).toBeInTheDocument()
    b.unmount()
    render(<BrandWarrantyService brand={brand({ default_warranty_months: 6 })} />)
    expect(screen.getByText('6 months')).toBeInTheDocument()
  })

  it('links phone, email, support url and catalogue, ignoring non-http urls, and shows terms', () => {
    render(
      <BrandWarrantyService
        brand={brand({
          service_phone: '+91 98765 43210',
          service_email: 'help@halo.test',
          service_url: 'https://halo.test/support',
          catalogue_pdf_url: 'javascript:x',
          warranty_terms: 'Covers defects.\n\nNot water damage.',
        })}
      />
    )
    expect(screen.getByRole('heading', { name: 'Warranty & service' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+91 98765 43210' })).toHaveAttribute('href', 'tel:+919876543210')
    expect(screen.getByRole('link', { name: 'help@halo.test' })).toHaveAttribute('href', 'mailto:help@halo.test')
    expect(screen.getByRole('link', { name: 'https://halo.test/support' })).toHaveAttribute('target', '_blank')
    expect(screen.queryByText('Download PDF')).not.toBeInTheDocument()
    expect(screen.getByText('Not water damage.')).toBeInTheDocument()
  })
})
