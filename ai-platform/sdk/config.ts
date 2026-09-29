// SDK config — the ONLY thing the app needs to know is where the gateway is.
// Host/model/provider selection all live behind the gateway, so migrating to cloud
// is a single URL change here.

export interface SdkConfig {
  gatewayUrl: string
  requestTimeoutMs: number
  healthTimeoutMs: number
}

export function loadConfig(overrides?: Partial<SdkConfig>): SdkConfig {
  const gatewayUrl = (overrides?.gatewayUrl || process.env.AI_GATEWAY_URL || 'http://localhost:8080').replace(/\/$/, '')
  return {
    gatewayUrl,
    // Long: the gateway may hold the connection open while a queued job runs.
    requestTimeoutMs: overrides?.requestTimeoutMs ?? (Number(process.env.AI_GATEWAY_TIMEOUT_MS) || 130_000),
    healthTimeoutMs: overrides?.healthTimeoutMs ?? (Number(process.env.AI_GATEWAY_HEALTH_TIMEOUT_MS) || 2_000),
  }
}
