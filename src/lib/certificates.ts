import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execSync } from 'child_process'
import os from 'os'

const CERTS_DIR = path.join(process.cwd(), 'certs')

interface CertificateResult {
  p12Buffer: Buffer
  p12Password: string
  serialNumber: string
  expiresAt: Date
  downloadToken: string
}

export async function generateClientCertificate(
  adminUsername: string,
  _adminId: string
): Promise<CertificateResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-'))
  const keyPath = path.join(tmpDir, 'client-key.pem')
  const csrPath = path.join(tmpDir, 'client.csr')
  const certPath = path.join(tmpDir, 'client-cert.pem')
  const extPath = path.join(tmpDir, 'ext.cnf')
  const p12Path = path.join(tmpDir, 'client.p12')
  const caKeyPath = path.join(CERTS_DIR, 'ca-key.pem')
  const caCertPath = path.join(CERTS_DIR, 'ca-cert.pem')

  const serialHex = crypto.randomBytes(16).toString('hex')
  const p12Password = crypto.randomBytes(8).toString('hex')
  const downloadToken = crypto.randomUUID()

  try {
    execSync(`openssl genrsa -out ${keyPath} 4096 2>/dev/null`)

    const subject = `/C=IN/ST=Chhattisgarh/L=Raipur/O=Jeffi Stores/OU=Admin/CN=${adminUsername}`
    execSync(`openssl req -new -key ${keyPath} -out ${csrPath} -subj '${subject}' 2>/dev/null`)

    fs.writeFileSync(extPath, [
      'basicConstraints = CA:FALSE',
      'keyUsage = digitalSignature, keyEncipherment',
      'extendedKeyUsage = clientAuth',
      'subjectKeyIdentifier = hash',
      'authorityKeyIdentifier = keyid,issuer',
    ].join('\n'))

    execSync(
      `openssl x509 -req -days 365 -in ${csrPath} ` +
      `-CA ${caCertPath} -CAkey ${caKeyPath} -CAcreateserial ` +
      `-out ${certPath} -extfile ${extPath} -set_serial 0x${serialHex} 2>/dev/null`
    )

    execSync(
      `openssl pkcs12 -export -out ${p12Path} ` +
      `-inkey ${keyPath} -in ${certPath} -certfile ${caCertPath} ` +
      `-name '${adminUsername}-admin-cert' -passout pass:${p12Password} 2>/dev/null`
    )

    const p12Buffer = fs.readFileSync(p12Path)

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

    return {
      p12Buffer,
      p12Password,
      serialNumber: serialHex,
      expiresAt,
      downloadToken,
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
