import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EntityProfileFields from '@/components/admin/EntityProfileFields'
import type { FieldSpec } from '@/lib/catalog/entity-fields'

const specs: FieldSpec[] = [
  { key: 'name', label: 'Display name', kind: 'text', section: 'main', max: 40, hint: 'Shown to buyers' },
  { key: 'site', label: 'Website', kind: 'url', section: 'main' },
  { key: 'about', label: 'About', kind: 'longtext', section: 'main', max: 200 },
  { key: 'active', label: 'Active', kind: 'bool', section: 'main', fallback: true },
  { key: 'accent', label: 'Accent colour', kind: 'color', section: 'main' },
  { key: 'returns', label: 'Returns', kind: 'tristate', section: 'main' },
  { key: 'tags', label: 'Tags', kind: 'list', section: 'main' },
  { key: 'age', label: 'Founded', kind: 'int', section: 'main', min: 1900 },
  { key: 'social', label: 'Social', kind: 'links', section: 'main', subkeys: ['twitter', 'instagram'] },
  { key: 'other', label: 'Other section field', kind: 'text', section: 'other' },
]

function renderIn(values?: Record<string, any> | null, section = 'main') {
  return render(
    <form data-testid="f">
      <EntityProfileFields specs={specs} section={section} values={values} />
    </form>
  )
}

describe('EntityProfileFields', () => {
  it('renders only the fields of the requested section', () => {
    renderIn()
    expect(screen.getByLabelText('Display name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Other section field')).toBeNull()
    expect(screen.getByText('Shown to buyers')).toBeInTheDocument()
  })

  it('renders the other section on request', () => {
    renderIn(null, 'other')
    expect(screen.getByLabelText('Other section field')).toBeInTheDocument()
    expect(screen.queryByLabelText('Display name')).toBeNull()
  })

  it('prefills values and applies input attributes', () => {
    renderIn({ name: 'Acme', site: 'https://a.test', about: 'Hi', tags: ['a', 'b'], age: 1999 })
    const name = screen.getByLabelText('Display name') as HTMLInputElement
    expect(name).toHaveValue('Acme')
    expect(name).toHaveAttribute('maxlength', '40')
    expect(screen.getByLabelText('Website')).toHaveAttribute('type', 'url')
    expect(screen.getByLabelText('About')).toHaveValue('Hi')
    expect(screen.getByLabelText('Tags')).toHaveValue('a, b')
    expect(screen.getByLabelText('Founded')).toHaveValue(1999)
  })

  it('serialises every field under its spec key', () => {
    renderIn({
      name: 'Acme',
      active: false,
      accent: '#112233',
      returns: true,
      social: { twitter: 'https://t.test/a' },
    })
    const fd = new FormData(screen.getByTestId('f') as HTMLFormElement)
    expect(fd.get('name')).toBe('Acme')
    expect(fd.get('active')).toBe('false')
    expect(fd.get('accent')).toBe('#112233')
    expect(fd.get('returns')).toBe('true')
    expect(fd.get('social.twitter')).toBe('https://t.test/a')
    expect(fd.get('social.instagram')).toBe('')
  })

  it('bool fields fall back to the spec default and toggle the hidden value', () => {
    renderIn()
    const sw = screen.getByRole('switch', { name: 'Active' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(new FormData(screen.getByTestId('f') as HTMLFormElement).get('active')).toBe('false')
  })

  it('tristate defaults to the empty Default option', () => {
    renderIn()
    expect(screen.getByLabelText('Returns')).toHaveValue('')
  })

  it('colour text input drives the swatch and accepts typing', () => {
    renderIn({ accent: '#ff0000' })
    const text = screen.getByLabelText('Accent colour') as HTMLInputElement
    fireEvent.change(text, { target: { value: '#00ff00' } })
    expect(text).toHaveValue('#00ff00')
    expect(screen.getByLabelText('Accent colour picker')).toHaveValue('#00ff00')
  })

  it('an invalid colour shows a black swatch', () => {
    renderIn({ accent: 'nope' })
    expect(screen.getByLabelText('Accent colour picker')).toHaveValue('#000000')
  })

  it('renders one url input per link subkey', () => {
    renderIn()
    expect(screen.getByLabelText('Social: twitter')).toHaveAttribute('placeholder', 'Twitter URL')
    expect(screen.getByLabelText('Social: instagram')).toBeInTheDocument()
  })
})
