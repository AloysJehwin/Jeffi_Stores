// Entry for each Next app's image (deploy/next-app.Dockerfile copies it beside the app's standalone server.js).
const cluster = require('cluster')
const os = require('os')

const WORKERS = process.env.WEB_CONCURRENCY ? parseInt(process.env.WEB_CONCURRENCY) : Math.max(2, os.cpus().length)

// One worker (k8s pods scale by replicas): run the server in-process, no fork/IPC layer.
if (WORKERS <= 1) {
  require('./server.js')
} else if (cluster.isPrimary) {
  let shuttingDown = false

  for (let i = 0; i < WORKERS; i++) {
    cluster.fork()
  }

  cluster.on('exit', () => {
    if (!shuttingDown) cluster.fork()
  })

  const shutdown = signal => {
    if (shuttingDown) return
    shuttingDown = true
    for (const w of Object.values(cluster.workers)) w?.process.kill(signal)
    setTimeout(() => process.exit(0), 25_000).unref()
    cluster.on('exit', () => {
      if (Object.keys(cluster.workers).length === 0) process.exit(0)
    })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
} else {
  require('./server.js')
}
