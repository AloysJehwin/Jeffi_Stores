const cluster = require('cluster')
const os = require('os')

const WORKERS = process.env.WEB_CONCURRENCY
  ? parseInt(process.env.WEB_CONCURRENCY)
  : Math.max(2, os.cpus().length)

if (cluster.isPrimary) {
  for (let i = 0; i < WORKERS; i++) {
    cluster.fork()
  }

  cluster.on('exit', () => {
    cluster.fork()
  })
} else {
  require('./server.js')
}
