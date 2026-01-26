const { createServer } = require('https')
const { parse } = require('url')
const next = require('next')
const fs = require('fs')
const path = require('path')

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = 3443 // HTTPS port

// Paths to your certificates
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'certs', 'server-key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'certs', 'server-cert.pem')),
  ca: fs.readFileSync(path.join(__dirname, 'certs', 'ca-cert.pem')),
  requestCert: true, // Request client certificate (optional, won't block non-admin pages)
  rejectUnauthorized: false, // Don't reject if no cert provided (middleware will enforce for admin)
}

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  createServer(httpsOptions, async (req, res) => {
    try {
      // Add certificate headers for middleware to check
      const clientCert = req.socket.getPeerCertificate()
      
      if (req.client.authorized) {
        req.headers['x-client-cert'] = 'PRESENT'
        req.headers['x-client-cert-verified'] = 'SUCCESS'
        req.headers['x-client-dn'] = clientCert.subject ? 
          Object.entries(clientCert.subject).map(([k, v]) => `${k}=${v}`).join(',') : 
          'UNKNOWN'
      } else {
        req.headers['x-client-cert-verified'] = 'FAILED'
      }

      const parsedUrl = parse(req.url, true)
      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error('Error occurred handling', req.url, err)
      res.statusCode = 500
      res.end('internal server error')
    }
  })
    .once('error', (err) => {
      console.error(err)
      process.exit(1)
    })
    .listen(port, () => {
      console.log(`\n🔒 HTTPS Server ready on https://${hostname}:${port}`)
      console.log(`📜 Client certificate required for admin access`)
      console.log(`📁 Import certs/client-cert.p12 into your browser\n`)
    })
})
