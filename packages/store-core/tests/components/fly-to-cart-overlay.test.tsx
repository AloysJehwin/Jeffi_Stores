import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { render } from '@testing-library/react'
import { FlyToCartProvider } from '@/contexts/FlyToCartContext'

// An always-mounted overlay portal broke hydration and covered the whole storefront.
describe('FlyToCartProvider overlay', () => {
  it('adds nothing to <body> while no flight is in progress', () => {
    render(
      <FlyToCartProvider>
        <p>page</p>
      </FlyToCartProvider>
    )
    expect(document.body.querySelector('.fixed[aria-hidden="true"]')).toBeNull()
  })

  it('server-renders only its children', () => {
    expect(
      renderToString(
        <FlyToCartProvider>
          <p>page</p>
        </FlyToCartProvider>
      )
    ).toBe('<p>page</p>')
  })
})
