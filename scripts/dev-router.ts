// Local stand-in for the ingress: one port (3000) in front of the Next dev servers, routing by host and
// path with the table the apps gate on (packages/store-core/src/lib/service-routing.ts). Run by
// `npm run dev`; `*.localhost:3000` URLs work as before. WebSockets (HMR) are piped through too.
import http from 'node:http'
import net from 'node:net'
import { ASSET_PREFIX, routeFor, type AppName } from '../packages/store-core/src/lib/service-routing'

export const DEV_PORTS: Record<AppName, number> = { storefront: 3010, admin: 3011, business: 3012, controller: 3013 }
const PORT = Number(process.env.DEV_ROUTER_PORT || 3000)

function target(req: http.IncomingMessage) {
  const app = routeFor(req.headers.host || 'localhost', (req.url || '/').split('?')[0])
  return { app, port: DEV_PORTS[app] }
}

const down = (app: AppName) => `${app} isn't running on :${DEV_PORTS[app]}. Start it with npm run dev:${app}, or everything with npm run dev.\n`

// An app's asset prefix (/_controller, /_admin, /_business) is stripped before it reaches the app, as the
// ingress does in production (Next doesn't serve prefixed paths there, and its middleware would rewrite
// them). HMR's WebSocket keeps it: Next expects it there.
function upstreamPath(app: AppName, url = '/') {
  const prefix = app === 'storefront' ? null : ASSET_PREFIX[app]
  return prefix && url.startsWith(prefix + '/') ? url.slice(prefix.length) : url
}

const server = http.createServer((req, res) => {
  const { app, port } = target(req)
  const upstream = http.request({ host: '127.0.0.1', port, method: req.method, path: upstreamPath(app, req.url), headers: req.headers }, up => {
    res.writeHead(up.statusCode || 502, up.headers)
    up.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
    res.end(down(app))
  })
  req.pipe(upstream)
})

server.on('upgrade', (req, socket, head) => {
  const { port } = target(req)
  const upstream = net.connect(port, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
    upstream.write(lines.join('\r\n') + '\r\n\r\n')
    if (head.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
})

server.listen(PORT, () => {
  const apps = Object.entries(DEV_PORTS).map(([a, p]) => `${a} :${p}`).join(', ')
  process.stdout.write(`[dev-router] :${PORT} → ${apps}\n`)
})
