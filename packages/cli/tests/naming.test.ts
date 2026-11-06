import { describe, expect, it } from 'vitest'
import { assignCommandNames, type NamingRoute } from '../src/naming'

const r = (method: string, path: string, host: NamingRoute['host'] = 'admin'): NamingRoute => ({
  key: `${host} ${method} ${path}`,
  host,
  method,
  segments: path.split('/').filter(Boolean),
})

const names = (routes: NamingRoute[], fixed?: Record<string, string>) => {
  const m = assignCommandNames(routes, fixed)
  return Object.fromEntries(routes.map(x => [`${x.method} ${x.segments.join('/')}`, m.get(x.key)]))
}

describe('assignCommandNames', () => {
  it('names collections, items, singletons and sub-paths', () => {
    expect(
      names([
        r('GET', 'brands'),
        r('POST', 'brands'),
        r('GET', 'brands/{id}'),
        r('PATCH', 'brands/{id}'),
        r('DELETE', 'brands/{id}'),
        r('POST', 'orders/{id}/cancel'),
        r('GET', 'orders/overview'),
        r('GET', 'settings'),
        r('PUT', 'settings'),
      ])
    ).toEqual({
      'GET brands': 'brands list',
      'POST brands': 'brands create',
      'GET brands/{id}': 'brands get',
      'PATCH brands/{id}': 'brands update',
      'DELETE brands/{id}': 'brands delete',
      'POST orders/{id}/cancel': 'orders cancel',
      'GET orders/overview': 'orders overview',
      'GET settings': 'settings get',
      'PUT settings': 'settings update',
    })
  })

  it('suffixes several methods on one sub-path, the GET keeps the plain name', () => {
    expect(names([r('GET', 'customers/{id}/notes'), r('POST', 'customers/{id}/notes'), r('PATCH', 'customers/{id}/notes'), r('DELETE', 'customers/{id}/notes')])).toEqual({
      'GET customers/{id}/notes': 'customers notes',
      'POST customers/{id}/notes': 'customers notes-create',
      'PATCH customers/{id}/notes': 'customers notes-update',
      'DELETE customers/{id}/notes': 'customers notes-delete',
    })
  })

  it('gives the deeper of two same-named paths a -by-<param> suffix', () => {
    expect(names([r('POST', 'products/draft'), r('POST', 'products/{id}/draft')])).toEqual({
      'POST products/draft': 'products draft',
      'POST products/{id}/draft': 'products draft-by-id',
    })
  })

  it('falls back to the raw method, then a number', () => {
    expect(names([r('PUT', 'a/{id}/x'), r('PATCH', 'a/{id}/x'), r('GET', 'a/{id}/x')])).toEqual({
      'GET a/{id}/x': 'a x',
      'PUT a/{id}/x': 'a x-update-put',
      'PATCH a/{id}/x': 'a x-update-patch',
    })
    const fixed = names([r('GET', 'a/b')], { 'admin GET a/c': 'a b' })
    expect(fixed['GET a/b']).toBe('a b-2')
  })

  it('namespaces platform and storefront routes and keeps overrides', () => {
    const routes = [r('GET', 'customers/{id}/provisioning', 'platform'), r('POST', 'brands', 'storefront'), r('GET', 'brands')]
    expect(names(routes, { 'admin GET brands': 'brands everything' })).toEqual({
      'GET customers/{id}/provisioning': 'platform customers provisioning',
      'POST brands': 'storefront brands create',
      'GET brands': 'brands everything',
    })
  })
})
