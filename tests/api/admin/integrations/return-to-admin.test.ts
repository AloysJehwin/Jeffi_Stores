import { describe, it, expect } from 'vitest'
import { returnToAdmin } from '@/lib/shared/oauth-state'

describe('returnToAdmin', () => {
  it('serves a no-store page that navigates onward instead of a cross-site redirect', async () => {
    const url = 'https://admin.example.com/admin/data-source?tab=google_sheet&connected=google_sheets'
    const res = returnToAdmin(url)
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const html = await res.text()
    expect(html).toContain(`location.replace(${JSON.stringify(url)})`)
    expect(html).toContain(
      'content="0;url=https://admin.example.com/admin/data-source?tab=google_sheet&amp;connected=google_sheets"'
    )
  })

  it('escapes the url so an error message cannot break out into markup or script', async () => {
    const html = await returnToAdmin('https://a.example/x?error="><script>alert(1)</script>').text()
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('\\u003cscript>alert(1)\\u003c/script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
