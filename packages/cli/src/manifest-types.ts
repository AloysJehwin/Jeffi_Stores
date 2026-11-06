import type { HostClass } from './naming'

export type JsonSchema = Record<string, unknown>

export interface ManifestRoute {
  /** `<host> <METHOD> <path>` */
  id: string
  host: HostClass
  method: string
  /** Path on the app, `{param}` placeholders, e.g. /api/admin/products/{id}. */
  path: string
  /** Path on the public API host; null when the gateway doesn't serve the route. */
  gatewayPath: string | null
  file: string
  pathParams: { name: string; catchAll: boolean; optional: boolean }[]
  query: string[]
  /** One entry per `query` name: JSON Schema of the value (string unless the handler converts it). */
  queryParams?: QueryParam[]
  scope: string | null
  scopeSource: 'literal' | 'path' | null
  scopes: string[]
  /** auth: the route authenticates itself; delegated: an imported helper does; cron; none. */
  guard: 'auth' | 'delegated' | 'cron' | 'none'
  platform: 'admin' | 'owner' | null
  /** JSON Schema of the body, `{ raw: true }` when it isn't statically known, null when none is read. */
  body: JsonSchema | null
  /** Where `body` came from: a zod schema, inference from the handler, or overrides.json. */
  bodySource?: 'zod' | 'inferred' | 'override'
  /** Set whenever `body` is a schema. multipart/form-data: properties are form fields, files have format binary. */
  bodyContentType?: 'application/json' | 'multipart/form-data'
  /** Other accepted encodings of the same body (a route reading JSON or multipart by content type). */
  bodyAlternatives?: { contentType: 'application/json' | 'multipart/form-data'; schema: JsonSchema }[]
  /** A write that deliberately reads no body. */
  noBody?: boolean
  /** A write whose body couldn't be determined; `body` is `{ raw: true, description: <reason> }`. */
  bodyUnknown?: boolean
  summary: string | null
  command: string
  hidden?: boolean
}

export interface QueryParam {
  name: string
  required?: boolean
  schema: JsonSchema
}

export interface Manifest {
  version: 1
  manifestHash: string
  routes: ManifestRoute[]
}

export interface RouteOverride {
  command?: string
  summary?: string
  hidden?: boolean
  query?: string[]
  /** Replaces the inferred entry of the same name (or adds one). */
  queryParams?: QueryParam[]
  body?: JsonSchema | null
  bodyContentType?: 'application/json' | 'multipart/form-data'
  noBody?: boolean
  bodyUnknown?: boolean
  /** Why the body is unknown (with bodyUnknown). */
  reason?: string
}

export interface Overrides {
  routes: Record<string, RouteOverride>
}
