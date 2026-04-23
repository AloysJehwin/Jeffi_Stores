import http from 'http'

const EC2_HOST = process.env.EC2_HOST
const EC2_PORT = process.env.EC2_PORT || '80'

export const handler = async (event) => {
  const { requestContext, headers: reqHeaders, body, isBase64Encoded, rawPath, rawQueryString } = event

  const clientCert = requestContext?.authentication?.clientCert
  const certCN = clientCert?.subjectDN
    ? (clientCert.subjectDN.match(/CN=([^,]+)/)?.[1] || '').trim()
    : ''
  const certSerial = clientCert?.serialNumber || ''

  const path = rawPath + (rawQueryString ? `?${rawQueryString}` : '')
  const method = requestContext?.http?.method || 'GET'

  const originalHost = reqHeaders['host'] || reqHeaders['Host'] || 'admin.jeffistores.in'

  const proxyHeaders = { ...reqHeaders }
  delete proxyHeaders['host']
  proxyHeaders['host'] = originalHost
  proxyHeaders['x-forwarded-host'] = originalHost
  proxyHeaders['x-forwarded-proto'] = 'https'
  proxyHeaders['x-client-cert-cn'] = certCN
  proxyHeaders['x-client-cert-serial'] = certSerial

  const requestBody = body
    ? (isBase64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body))
    : undefined

  return new Promise((resolve) => {
    const req = http.request({
      hostname: EC2_HOST,
      port: parseInt(EC2_PORT),
      path,
      method,
      headers: proxyHeaders,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks)
        const contentType = res.headers['content-type'] || ''
        const isText = /text|json|html|xml|javascript|css/.test(contentType)

        const responseHeaders = {}
        for (const [key, value] of Object.entries(res.headers)) {
          if (key === 'transfer-encoding') continue
          if (key === 'location' && value) {
            const loc = Array.isArray(value) ? value[0] : value
            responseHeaders[key] = loc
              .replace(`http://${EC2_HOST}:${EC2_PORT}`, `https://${originalHost}`)
              .replace(`http://${EC2_HOST}`, `https://${originalHost}`)
            continue
          }
          if (Array.isArray(value)) {
            responseHeaders[key] = value.join(', ')
          } else {
            responseHeaders[key] = value
          }
        }

        resolve({
          statusCode: res.statusCode,
          headers: responseHeaders,
          body: isText ? responseBody.toString('utf-8') : responseBody.toString('base64'),
          isBase64Encoded: !isText,
        })
      })
    })

    req.on('error', () => {
      resolve({
        statusCode: 502,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Bad Gateway' }),
      })
    })

    if (requestBody) req.write(requestBody)
    req.end()
  })
}
