import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// HeroSlidesBySurface: thin wrapper. Shows a device note and passes HeroSlideManager only the
// slides of the editing surface (rowSurface default = 'web'). We mock the manager to read back
// the props it receives.
const managerProps = vi.fn<(...a: any[]) => any>()
vi.mock('@/components/admin/HeroSlideManager', () => ({
  default: (props: any) => {
    managerProps(props)
    return <div data-testid="mgr">{props.initialSlides.map((s: any) => s.id).join(',')}</div>
  },
}))

import HeroSlidesBySurface from '@/components/admin/homepage/HeroSlidesBySurface'

const slide = (id: string, surface?: string | null) => ({ id, surface }) as any

describe('HeroSlidesBySurface (render + surface filter)', () => {
  // Required pass-through option props (forwarded to the mocked manager; empty is fine for these tests).
  const opts = { categoryOptions: [], brandOptions: [], gradeOptions: [], materialOptions: [] }
  it('defaults to web: names Desktop web and keeps only web slides (missing/other surface = web)', () => {
    render(
      <HeroSlidesBySurface
        {...opts}
        initialSlides={[slide('a'), slide('b', 'app'), slide('c', 'web'), slide('d', 'bogus')]}
      />
    )
    expect(screen.getByText(/Desktop web only/)).toBeInTheDocument()
    // a (undefined) and d (unknown) fall back to 'web'; c is web; b is app -> dropped.
    expect(managerProps.mock.calls[0][0].surface).toBeUndefined()
    expect(screen.getByTestId('mgr')).toHaveTextContent('a,c,d')
  })

  it('app surface names "App" and passes only app slides through', () => {
    render(
      <HeroSlidesBySurface
        {...opts}
        surface="app"
        initialSlides={[slide('a', 'web'), slide('b', 'app'), slide('c', 'app')]}
      />
    )
    expect(screen.getByText(/App only/)).toBeInTheDocument()
    expect(screen.getByTestId('mgr')).toHaveTextContent('b,c')
  })

  it('web_mobile names "Mobile web"', () => {
    render(<HeroSlidesBySurface {...opts} surface="web_mobile" initialSlides={[slide('m', 'web_mobile')]} />)
    expect(screen.getByText(/Mobile web only/)).toBeInTheDocument()
    expect(screen.getByTestId('mgr')).toHaveTextContent('m')
  })

  it('forwards the rest of the props unchanged to the manager', () => {
    render(<HeroSlidesBySurface {...opts} surface="app" initialSlides={[]} />)
    expect(managerProps).toHaveBeenLastCalledWith(expect.objectContaining({ surface: 'app' }))
  })
})
