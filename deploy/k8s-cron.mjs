// k8s CronJob entrypoint: call one cron route on the in-cluster app, then record the run so
// /api/admin/cron/status keeps working. Usage: node deploy/k8s-cron.mjs <jobId> <METHOD> <path>
const [jobId, method, path] = process.argv.slice(2)
const base = process.env.CRON_TARGET || 'http://jeffi-stores-controller-service.jeffi.svc.cluster.local:3000'
const headers = { Host: process.env.CRON_HOST || 'jeffistores.in', Authorization: `Bearer ${process.env.CRON_SECRET}` }
const timeoutMs = Number(process.env.CRON_TIMEOUT_MS || 290_000)

async function record(ok, errorMsg, detail) {
  try {
    await fetch(`${base}/api/internal/cron-record`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, ok, errorMsg, detail }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {}
}

if (!jobId || !method || !path || !process.env.CRON_SECRET) {
  console.error('usage: k8s-cron.mjs <jobId> <METHOD> <path> (CRON_SECRET required)')
  process.exit(2)
}

// A new pod joins the k3s network-policy allow-list a moment after it starts, so the first
// connection can be dropped; retry connection errors (not HTTP errors) briefly.
// The fan-out endpoint reads the jobId from the POST body (one CronJob drives all tenants for a job).
// CRON_BODY (JSON) is for one-off release calls (deploy/k8s/db/lib.sh in_cluster).
const callBody = process.env.CRON_BODY || (path === '/api/cron/fanout' ? JSON.stringify({ jobId }) : undefined)
const callHeaders = callBody ? { ...headers, 'Content-Type': 'application/json' } : headers

async function call() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(`${base}${path}`, { method, headers: callHeaders, body: callBody, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      if (attempt >= 5 || err?.name === 'TimeoutError') throw err
      await new Promise(r => setTimeout(r, attempt * 1000))
    }
  }
}

try {
  const res = await call()
  let body
  try {
    body = await res.json()
  } catch {}
  await record(res.ok, res.ok ? undefined : `HTTP ${res.status}`, body)
  if (process.env.CRON_VERBOSE) console.log(JSON.stringify(body, null, 2))
  console.log(`${jobId} ${res.status}`)
  process.exit(res.ok ? 0 : 1)
} catch (err) {
  await record(false, err?.message || 'fetch failed')
  console.error(`${jobId} failed: ${err?.message}`)
  process.exit(1)
}
