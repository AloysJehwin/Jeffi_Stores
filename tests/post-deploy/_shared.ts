// Shared helpers for the post-deploy smoke. Read-only: GET and page loads only.
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { expectPageVisible, watchPageErrors } from '../ui-kit/visible'

/** Opens `target` (a path on the base URL, or a full URL) and asserts a person would see it. */
export async function expectLivePage(page: Page, target: string): Promise<void> {
  const errors = watchPageErrors(page)
  const res = await page.goto(target, { waitUntil: 'load' })
  expect(res?.status(), `${target} status`).toBeLessThan(400)
  await expect(page).toHaveTitle(/.+/)
  await expectPageVisible(page)
  expect(errors()).toEqual([])
}

/** GET url: status below 400, and when `sha` is non-empty the body reports that commit. */
export async function expectHealthy(request: APIRequestContext, url: string, sha = process.env.RELEASE_SHA): Promise<string> {
  const res = await request.get(url, { timeout: 30_000 })
  expect(res.status(), `${url} status`).toBeLessThan(400)
  const body = await res.text()
  if (sha) expect(body, `${url} commit`).toContain(`"commit":"${sha}"`)
  return body
}

/** The first visible input on a login page is usable. */
export async function expectUsableInput(page: Page): Promise<void> {
  const input = page.locator('input:not([type=hidden]):not([type=checkbox])').first()
  await expect(input).toBeVisible()
  await expect(input).toBeEnabled()
}
