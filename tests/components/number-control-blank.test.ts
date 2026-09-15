import { describe, it, expect } from 'vitest'

// Models NumberControl's string-draft state machine: the field holds a string so it can be
// genuinely empty mid-edit, and reverts to the last committed value if left blank on blur.
function makeControl(initial: number) {
  let value = String(initial)
  let saved = String(initial)
  let dirty = false
  const patched: number[] = []

  return {
    get shown() { return value },
    get patched() { return patched },
    type(next: string) { value = next; dirty = true },
    blur(ok = true) {
      if (value.trim() === '') { value = saved; dirty = false; return }
      if (!dirty) return
      const parsed = parseFloat(value)
      if (!Number.isFinite(parsed)) { value = saved; dirty = false; return }
      patched.push(parsed)
      dirty = false
      if (ok) { value = String(parsed); saved = String(parsed) } else { value = saved }
    },
  }
}

describe('NumberControl blank-while-typing', () => {
  it('shows an empty field after deleting the last digit', () => {
    const c = makeControl(0)
    c.type('')
    expect(c.shown).toBe('')
  })

  it('does not resurrect a 0 while typing a new value', () => {
    const c = makeControl(0)
    c.type('')
    c.type('5')
    c.type('50')
    expect(c.shown).toBe('50')
  })

  it('reverts to the previous value when left blank on blur', () => {
    const c = makeControl(200)
    c.type('')
    c.blur()
    expect(c.shown).toBe('200')
    expect(c.patched).toEqual([])
  })

  it('commits a typed value on blur', () => {
    const c = makeControl(200)
    c.type('350')
    c.blur()
    expect(c.shown).toBe('350')
    expect(c.patched).toEqual([350])
  })

  it('reverts to the last committed value when the save fails', () => {
    const c = makeControl(200)
    c.type('350')
    c.blur(false)
    expect(c.shown).toBe('200')
  })

  it('allows clearing a 0 and entering a value without fighting the placeholder', () => {
    const c = makeControl(0)
    c.type('')
    c.type('2000')
    c.blur()
    expect(c.shown).toBe('2000')
    expect(c.patched).toEqual([2000])
  })

  it('ignores a non-numeric draft on blur', () => {
    const c = makeControl(50)
    c.type('abc')
    c.blur()
    expect(c.shown).toBe('50')
    expect(c.patched).toEqual([])
  })
})
