import forge from 'node-forge'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const CERTS_DIR = path.join(process.cwd(), 'certs')

interface CertificateResult {
  p12Buffer: Buffer
  p12Password: string
  serialNumber: string
  expiresAt: Date
  downloadToken: string
}

/**
 * Generate a client certificate for an admin user, signed by the existing CA.
 */
export async function generateClientCertificate(
  adminUsername: string,
  adminId: string
): Promise<CertificateResult> {
  // Read CA key and cert
  const caCertPem = fs.readFileSync(path.join(CERTS_DIR, 'ca-cert.pem'), 'utf8')
  const caKeyPem = fs.readFileSync(path.join(CERTS_DIR, 'ca-key.pem'), 'utf8')

  const caCert = forge.pki.certificateFromPem(caCertPem)
  const caKey = forge.pki.privateKeyFromPem(caKeyPem)

  // Generate a new key pair for the client
  const keys = forge.pki.rsa.generateKeyPair(4096)

  // Create the client certificate
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey

  // Serial number from random bytes
  const serialHex = crypto.randomBytes(16).toString('hex')
  cert.serialNumber = serialHex

  // Validity: 365 days
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
  cert.validity.notBefore = now
  cert.validity.notAfter = expiresAt

  // Subject
  cert.setSubject([
    { name: 'commonName', value: adminUsername },
    { name: 'organizationName', value: 'Jeffi Stores' },
    { shortName: 'OU', value: 'Admin' },
    { name: 'countryName', value: 'IN' },
    { name: 'stateOrProvinceName', value: 'Chhattisgarh' },
    { name: 'localityName', value: 'Raipur' },
  ])

  // Issuer from CA
  cert.setIssuer(caCert.subject.attributes)

  // Extensions
  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: false,
    },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      clientAuth: true,
    },
    {
      name: 'subjectKeyIdentifier',
    },
    {
      name: 'authorityKeyIdentifier',
      keyIdentifier: true,
      authorityCertIssuer: true,
      serialNumber: true,
    },
  ])

  // Sign with CA private key
  cert.sign(caKey, forge.md.sha256.create())

  // Create PKCS12 with random password
  const p12Password = crypto.randomBytes(8).toString('hex') // 16 char hex password
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert, caCert], p12Password, {
    algorithm: '3des',
    friendlyName: `${adminUsername}-admin-cert`,
  })
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes()
  const p12Buffer = Buffer.from(p12Der, 'binary')

  // One-time download token
  const downloadToken = crypto.randomUUID()

  return {
    p12Buffer,
    p12Password,
    serialNumber: serialHex,
    expiresAt,
    downloadToken,
  }
}
