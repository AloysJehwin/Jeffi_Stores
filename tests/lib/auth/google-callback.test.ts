import { describe, it, expect, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { CALLBACK_SCRIPT } from '@/lib/auth/google-callback-html'

function run(hash: string, opener: any = null) {
  const replace = vi.fn(), close = vi.fn(), el = { textContent: '' }, timers: (() => void)[] = []
  const window: any = { opener, close }
  runInNewContext(CALLBACK_SCRIPT, {
    window, location: { hash: `#${hash}`, replace }, document: { getElementById: () => el },
    setTimeout: (f: () => void) => timers.push(f), URL, URLSearchParams, decodeURIComponent,
  })
  return { replace, close, el, flush: () => timers.forEach(f => f()) }
}
const st = (s: string) => `state=${encodeURIComponent(s)}&access_token=tok`

describe('Google callback page', () => {
  it('sends a same-tab sign-in straight back, even when the tab has an opener', () => {
    const opener = { closed: false, postMessage: vi.fn() }
    const r = run(st(`n1|${encodeURIComponent('https://admin.jeffistores.in/admin/login?redirect=/admin')}`), opener)
    expect(opener.postMessage).not.toHaveBeenCalled()
    expect(r.replace).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/admin\.jeffistores\.in\/admin\/login\?redirect=\/admin#state=.*access_token=tok/))
  })
  it('posts a popup sign-in to the opener and falls back if the window stays open', () => {
    const opener = { closed: false, postMessage: vi.fn() }
    const r = run(st(`p.n2|${encodeURIComponent('https://jeffistores.in/login')}`), opener)
    expect(opener.postMessage).toHaveBeenCalledWith({ source: 'jeffi-google-oauth', accessToken: 'tok', error: null }, '*')
    expect(r.close).toHaveBeenCalled(); expect(r.replace).not.toHaveBeenCalled()
    r.flush(); expect(r.replace).toHaveBeenCalled()
  })
  it('never redirects to a foreign host', () => {
    const r = run(st(`n3|${encodeURIComponent('https://evil.example/login')}`))
    expect(r.replace).not.toHaveBeenCalled(); expect(r.el.textContent).toMatch(/incomplete/)
    expect(run(st('n4|//evil.example')).replace).not.toHaveBeenCalled()
  })
  it('keeps a same-site path', () => {
    expect(run(st('n5|/login')).replace).toHaveBeenCalledWith(expect.stringMatching(/^\/login#/))
  })
})

describe('Google callback safety net', () => {
  it('retries and offers a Continue link if the tab is still on the page', () => {
    const replace = vi.fn(), assign = vi.fn(), timers: (() => void)[] = []
    const link: any = { setAttribute: vi.fn() }, msg: any = { innerHTML: '', textContent: '' }
    runInNewContext(CALLBACK_SCRIPT, {
      window: { opener: null }, location: { hash: '#state=' + encodeURIComponent('n|' + encodeURIComponent('http://admin-acme.localhost:3000/login')) + '&access_token=t', replace, assign },
      document: { getElementById: (id: string) => (id === 'c' ? link : msg) },
      setTimeout: (f: () => void) => timers.push(f), URL, URLSearchParams, decodeURIComponent,
    })
    expect(replace).toHaveBeenCalledTimes(1)
    timers.forEach(f => f())
    expect(assign).toHaveBeenCalledWith(replace.mock.calls[0][0])
    expect(msg.innerHTML).toMatch(/Continue signing in/)
    expect(link.setAttribute).toHaveBeenCalledWith('href', replace.mock.calls[0][0])
  })
})
