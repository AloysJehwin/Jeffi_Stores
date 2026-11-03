import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Mirrors the listener installed by NumberInputWheelGuard. A focused <input type="number">
// natively increments on wheel scroll, silently editing the value while the user scrolls the page.
function onWheel(e: Event) {
  const el = e.target as HTMLElement | null
  if (!el || el !== document.activeElement) return
  if (el.tagName !== 'INPUT') return
  if ((el as HTMLInputElement).type !== 'number') return
  el.blur()
}

function wheel() {
  return new WheelEvent('wheel', { bubbles: true, deltaY: 100 })
}

describe('NumberInputWheelGuard', () => {
  let num: HTMLInputElement
  let text: HTMLInputElement

  beforeEach(() => {
    document.body.innerHTML = `
      <input id="num" type="number" value="5" />
      <input id="text" type="text" value="hi" />
    `
    num = document.getElementById('num') as HTMLInputElement
    text = document.getElementById('text') as HTMLInputElement
    document.addEventListener('wheel', onWheel, { passive: true })
  })

  afterEach(() => {
    document.removeEventListener('wheel', onWheel)
    document.body.innerHTML = ''
  })

  it('blurs a focused number input on wheel so the value cannot change', () => {
    num.focus()
    expect(document.activeElement).toBe(num)

    num.dispatchEvent(wheel())

    expect(document.activeElement).not.toBe(num)
  })

  it('leaves a focused text input alone', () => {
    text.focus()
    text.dispatchEvent(wheel())
    expect(document.activeElement).toBe(text)
  })

  it('ignores wheel over an unfocused number input', () => {
    text.focus()
    num.dispatchEvent(wheel())
    expect(document.activeElement).toBe(text)
  })
})
