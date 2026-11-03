import { trace } from '@opentelemetry/api'

// OpenTelemetry tracing → Coroot. Off unless an OTLP traces endpoint is configured (set only in
// the k8s manifests), so local dev and tests export nothing. Sampling comes from the standard
// OTEL_TRACES_SAMPLER / OTEL_TRACES_SAMPLER_ARG env vars.

export function otelEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (
    !!(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT) && env.OTEL_SDK_DISABLED !== 'true'
  )
}

export function otelOptions(env: Record<string, string | undefined> = process.env) {
  return {
    serviceName: env.OTEL_SERVICE_NAME || 'jeffi-storefront',
    attributes: {
      'deployment.environment': env.NODE_ENV || 'development',
      'service.version': env.NEXT_PUBLIC_APP_VERSION || 'unknown',
      'vcs.revision': env.NEXT_PUBLIC_GIT_SHA || 'unknown',
    },
    // Host identifies the tenant; unlike x-tenant-* it is not a client-assertable claim.
    attributesFromHeaders: { 'http.host': 'host' },
  }
}

const NO_TRACE = '0'.repeat(32)

/** Trace id of the current request (also for unsampled requests), or null outside a request. */
export function currentTraceId(): string | null {
  const id = trace.getActiveSpan()?.spanContext().traceId
  return id && id !== NO_TRACE ? id : null
}

/** Prefix server log lines with the request's trace id, so a trace id from a response header
 * finds the matching logs (Coroot Logs search). No-op when the line is not inside a request. */
export function installTraceLogPrefix(target: Pick<Console, 'log' | 'info' | 'warn' | 'error'> = console): void {
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = target[level].bind(target)
    target[level] = (...args: unknown[]) => {
      const id = currentTraceId()
      return id ? original(`[trace=${id}]`, ...args) : original(...args)
    }
  }
}
