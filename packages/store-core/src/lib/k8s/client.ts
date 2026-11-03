import 'server-only'
import fs from 'node:fs'
import https from 'node:https'

// Minimal in-cluster Kubernetes API client (ServiceAccount token + cluster CA). Server-side apply
// keeps every write idempotent, which the provisioning engine's retry model requires.

const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount'
const FIELD_MANAGER = 'jeffi-provisioner'

export interface K8sObject {
  apiVersion: string
  kind: string
  metadata: { name: string; namespace?: string; labels?: Record<string, string>; annotations?: Record<string, string> }
  [k: string]: unknown
}

export class K8sError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

// kind → [api base, plural, namespaced]
const RESOURCES: Record<string, [string, string, boolean]> = {
  Namespace: ['/api/v1', 'namespaces', false],
  Node: ['/api/v1', 'nodes', false],
  Secret: ['/api/v1', 'secrets', true],
  Service: ['/api/v1', 'services', true],
  ServiceAccount: ['/api/v1', 'serviceaccounts', true],
  ResourceQuota: ['/api/v1', 'resourcequotas', true],
  PersistentVolumeClaim: ['/api/v1', 'persistentvolumeclaims', true],
  Pod: ['/api/v1', 'pods', true],
  Deployment: ['/apis/apps/v1', 'deployments', true],
  PodDisruptionBudget: ['/apis/policy/v1', 'poddisruptionbudgets', true],
  HorizontalPodAutoscaler: ['/apis/autoscaling/v2', 'horizontalpodautoscalers', true],
  NetworkPolicy: ['/apis/networking.k8s.io/v1', 'networkpolicies', true],
  IngressRoute: ['/apis/traefik.io/v1alpha1', 'ingressroutes', true],
  Certificate: ['/apis/cert-manager.io/v1', 'certificates', true],
  ConfigMap: ['/api/v1', 'configmaps', true],
}

export function resourcePath(kind: string, name?: string, namespace?: string): string {
  const r = RESOURCES[kind]
  if (!r) throw new Error(`k8s: unsupported kind ${kind}`)
  const [base, plural, namespaced] = r
  const ns = namespaced ? `/namespaces/${encodeURIComponent(namespace || 'default')}` : ''
  return `${base}${ns}/${plural}${name ? `/${encodeURIComponent(name)}` : ''}`
}

export function inCluster(): boolean {
  return !!process.env.KUBERNETES_SERVICE_HOST && fs.existsSync(`${SA_DIR}/token`)
}

function request(method: string, path: string, body?: string, contentType = 'application/json'): Promise<unknown> {
  const host = process.env.KUBERNETES_SERVICE_HOST
  const port = Number(process.env.KUBERNETES_SERVICE_PORT || 443)
  if (!host) return Promise.reject(new Error('k8s: not running in a cluster (KUBERNETES_SERVICE_HOST unset)'))
  const token = fs.readFileSync(`${SA_DIR}/token`, 'utf8').trim()
  const ca = fs.readFileSync(`${SA_DIR}/ca.crt`)
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port,
        path,
        method,
        ca,
        timeout: 30_000,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      res => {
        let data = ''
        res.on('data', c => (data += c))
        res.on('end', () => {
          const status = res.statusCode || 0
          let parsed: any = data
          try {
            parsed = data ? JSON.parse(data) : null
          } catch {}
          if (status >= 200 && status < 300) return resolve(parsed)
          reject(new K8sError(status, `k8s ${method} ${path}: ${status} ${parsed?.message || data.slice(0, 200)}`))
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error(`k8s ${method} ${path}: timeout`)))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

/** Server-side apply (create-or-update, idempotent). */
export function apply(obj: K8sObject): Promise<unknown> {
  const path = `${resourcePath(obj.kind, obj.metadata.name, obj.metadata.namespace)}?fieldManager=${FIELD_MANAGER}&force=true`
  return request('PATCH', path, JSON.stringify(obj), 'application/apply-patch+yaml')
}

export async function get<T = any>(kind: string, name: string, namespace?: string): Promise<T | null> {
  try {
    return (await request('GET', resourcePath(kind, name, namespace))) as T
  } catch (e) {
    if (e instanceof K8sError && e.status === 404) return null
    throw e
  }
}

export async function list<T = any>(kind: string, namespace?: string, labelSelector?: string): Promise<T[]> {
  const q = labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : ''
  const res = (await request('GET', resourcePath(kind, undefined, namespace) + q)) as { items?: T[] }
  return res?.items ?? []
}

/** Every namespace's objects of a namespaced kind. */
export async function listAll<T = any>(kind: string, labelSelector?: string): Promise<T[]> {
  const [base, plural] = RESOURCES[kind] ?? []
  if (!base) throw new Error(`k8s: unsupported kind ${kind}`)
  const q = labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : ''
  const res = (await request('GET', `${base}/${plural}${q}`)) as { items?: T[] }
  return res?.items ?? []
}

/** Delete; already-gone is success. */
export async function remove(kind: string, name: string, namespace?: string): Promise<void> {
  try {
    await request('DELETE', resourcePath(kind, name, namespace))
  } catch (e) {
    if (!(e instanceof K8sError && e.status === 404)) throw e
  }
}

export function patchMerge(
  kind: string,
  name: string,
  namespace: string | undefined,
  patch: unknown
): Promise<unknown> {
  return request('PATCH', resourcePath(kind, name, namespace), JSON.stringify(patch), 'application/merge-patch+json')
}
