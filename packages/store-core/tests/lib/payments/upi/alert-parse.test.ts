import { describe, it, expect } from 'vitest'
import {
  alertAddress,
  alertFingerprint,
  bankDomainOf,
  parseAlertAddress,
  parseBankAlert,
  parseGmailForwardingConfirmation,
  trustBankMail,
} from '@/lib/payments/upi/alert-parse'

const SECRET = 'test-secret'
const DOMAIN = 'reply.jeffistores.in'

describe('alert address', () => {
  it('round-trips a store slug and rejects a wrong token, domain or missing secret', () => {
    const addr = alertAddress('Acme-Tools', SECRET, DOMAIN)!
    expect(addr).toMatch(/^upi\+acme-tools\.[a-f0-9]{12}@reply\.jeffistores\.in$/)
    expect(parseAlertAddress(addr, SECRET, DOMAIN)).toEqual({ slug: 'acme-tools' })
    expect(parseAlertAddress(`Bank Alerts <${addr}>`, SECRET, DOMAIN)).toEqual({ slug: 'acme-tools' })
    expect(parseAlertAddress(addr.replace('acme-tools', 'other'), SECRET, DOMAIN)).toBeNull()
    expect(parseAlertAddress(addr, 'another-secret', DOMAIN)).toBeNull()
    expect(parseAlertAddress(addr.replace(DOMAIN, 'evil.example'), SECRET, DOMAIN)).toBeNull()
    expect(parseAlertAddress('reply+acme.abcdefghjkmnpqrstuvw@reply.jeffistores.in', SECRET, DOMAIN)).toBeNull()
    expect(alertAddress('acme', '', DOMAIN)).toBeNull()
    expect(parseAlertAddress(addr, '', DOMAIN)).toBeNull()
  })
})

describe('bankDomainOf', () => {
  it('knows the listed banks, their subdomains and *.bank.in', () => {
    expect(bankDomainOf('alerts@hdfcbank.net')).toBe('hdfcbank.net')
    expect(bankDomainOf('custcomm.icicibank.com')).toBe('icicibank.com')
    expect(bankDomainOf('alerts.sbi.co.in')).toBe('sbi.co.in')
    expect(bankDomainOf('noreply@alerts.hdfc.bank.in')).toBe('hdfc.bank.in')
    expect(bankDomainOf('sbi.bank.in')).toBe('sbi.bank.in')
  })
  it('is not fooled by look-alikes', () => {
    expect(bankDomainOf('hdfcbank.net.evil.com')).toBeNull()
    expect(bankDomainOf('nothdfcbank.net')).toBeNull()
    expect(bankDomainOf('gmail.com')).toBeNull()
    expect(bankDomainOf('bank.in')).toBeNull()
    expect(bankDomainOf(null)).toBeNull()
  })
})

describe('trustBankMail', () => {
  it('trusts a bank whose own DKIM signature verifies', () => {
    expect(trustBankMail({ fromDomain: 'hdfcbank.net', dkim: [{ domain: 'hdfcbank.net', result: 'pass' }] })).toEqual({ trusted: true, bankDomain: 'hdfcbank.net', via: 'dkim' })
    expect(trustBankMail({ fromDomain: 'alerts.icicibank.com', dkim: [{ domain: 'icicibank.com', result: 'pass' }] }).trusted).toBe(true)
  })
  it('trusts Gmail attesting the bank DKIM in a passing ARC chain', () => {
    const arc = { result: 'pass', sealDomain: 'google.com', dkim: [{ domain: 'sbi.co.in', result: 'pass' }] }
    expect(trustBankMail({ fromDomain: 'alerts.sbi.co.in', dkim: [{ domain: 'sbi.co.in', result: 'fail' }], arc })).toEqual({ trusted: true, bankDomain: 'sbi.co.in', via: 'arc' })
  })
  it('refuses everything else', () => {
    // not a bank
    expect(trustBankMail({ fromDomain: 'gmail.com', dkim: [{ domain: 'gmail.com', result: 'pass' }] }).trusted).toBe(false)
    // a bank From signed by someone else
    expect(trustBankMail({ fromDomain: 'hdfcbank.net', dkim: [{ domain: 'evil.com', result: 'pass' }] }).trusted).toBe(false)
    // another bank's signature
    expect(trustBankMail({ fromDomain: 'hdfcbank.net', dkim: [{ domain: 'icicibank.com', result: 'pass' }] }).trusted).toBe(false)
    expect(trustBankMail({ fromDomain: 'hdfcbank.net', dkim: [{ domain: 'hdfcbank.net', result: 'fail' }] }).trusted).toBe(false)
    // ARC that failed, or sealed by someone other than Google, or attesting another domain
    const dkim = [{ domain: 'hdfcbank.net', result: 'pass' }]
    expect(trustBankMail({ fromDomain: 'hdfcbank.net', dkim: [], arc: { result: 'fail', sealDomain: 'google.com', dkim } }).trusted).toBe(false)
    expect(trustBankMail({ fromDomain: 'hdfcbank.net', dkim: [], arc: { result: 'pass', sealDomain: 'evil.com', dkim } }).trusted).toBe(false)
    expect(trustBankMail({ fromDomain: 'hdfcbank.net', dkim: [], arc: { result: 'pass', sealDomain: 'google.com', dkim: [{ domain: 'evil.com', result: 'pass' }] } }).trusted).toBe(false)
  })
})

describe('parseBankAlert', () => {
  const credit = (text: string, bankDomain?: string) => parseBankAlert({ subject: 'Transaction alert', text, bankDomain })

  it('HDFC credit', () => {
    const r = credit('Dear Customer, Rs.500.00 is successfully credited to your account **1234 by VPA payer.name@okaxis JOHN DOE on 10-11-26. Your UPI transaction reference number is 431234567890. Thank you for banking with us.', 'hdfcbank.net')
    expect(r).toEqual({ kind: 'credit', amountPaise: 50000, utr: '431234567890', senderVpa: 'payer.name@okaxis' })
  })
  it('ICICI credit', () => {
    const r = credit('Dear Customer, your ICICI Bank Account XX123 has been credited with INR 1,500.00 on 10-Nov-26. Info: UPI/431234567891/payer@oksbi/Payment. The Available Balance is INR 20,000.50.', 'icicibank.com')
    expect(r).toEqual({ kind: 'credit', amountPaise: 150000, utr: '431234567891', senderVpa: 'payer@oksbi' })
  })
  it('SBI credit', () => {
    const r = credit('Dear Customer, Your a/c no. XX1234 is credited by Rs.250.00 on 10-11-26 by a/c linked to VPA payer@ybl (UPI Ref no 431234567892). -SBI', 'sbi.co.in')
    expect(r).toEqual({ kind: 'credit', amountPaise: 25000, utr: '431234567892', senderVpa: 'payer@ybl' })
  })
  it('Axis credit', () => {
    const r = credit('INR 750.00 credited to A/c no. XX1234 on 10-11-26 at 12:00:00 IST. Info - UPI/P2A/431234567893/JOHN DOE/Axis Bank. Avl Bal INR 9,000.00', 'axisbank.com')
    expect(r).toMatchObject({ kind: 'credit', amountPaise: 75000, utr: '431234567893' })
  })
  it('Kotak credit', () => {
    const r = credit('Received Rs.300.00 in your Kotak Bank AC X1234 from payer@okhdfcbank on 10-11-26. UPI Ref:431234567894.', 'kotak.com')
    expect(r).toEqual({ kind: 'credit', amountPaise: 30000, utr: '431234567894', senderVpa: 'payer@okhdfcbank' })
  })
  it('generic fallback for a bank without its own pattern', () => {
    const r = credit('Your A/C XXXX1234 is credited with Rs 999.50 on 10/11/26 from payer@paytm. UPI Ref No 431234567895. Bal Rs 12,345.00 - Federal Bank', 'federalbank.co.in')
    expect(r).toEqual({ kind: 'credit', amountPaise: 99950, utr: '431234567895', senderVpa: 'payer@paytm' })
    expect(credit('₹1,00,000 has been deposited in your account. RRN: 431234567896')).toMatchObject({ kind: 'credit', amountPaise: 10000000, utr: '431234567896' })
  })
  it('ignores debits, including ones that mention the payee being credited', () => {
    expect(credit('Dear Customer, Rs.500.00 has been debited from account **1234 to VPA shop@okaxis on 10-11-26. Your UPI transaction reference number is 431234567890.', 'hdfcbank.net').kind).toBe('debit')
    const sbi = credit('Dear UPI user A/C X1234 debited by 100.0 on date 10Nov26 trf to SHOP and credited to shop@ybl Refno 431234567890.', 'sbi.co.in')
    expect(sbi).toEqual({ kind: 'debit', amountPaise: null, utr: null, senderVpa: null })
  })
  it('treats mail that is not an alert as unknown', () => {
    expect(parseBankAlert({ subject: 'Your statement is ready', text: 'Download your monthly statement.' }).kind).toBe('unknown')
  })
  it('does not take an email address for a UPI ID', () => {
    const r = credit('Rs 10.00 credited to your account from payer@ybl. Queries: write to support@hdfcbank.com. UPI Ref 431234567897')
    expect(r.senderVpa).toBe('payer@ybl')
  })
})

describe('gmail forwarding confirmation', () => {
  it('extracts the code and link', () => {
    const r = parseGmailForwardingConfirmation({
      from: 'forwarding-noreply@google.com',
      subject: '(#123456789) Gmail Forwarding Confirmation - Receive Mail from owner@gmail.com',
      text: 'owner@gmail.com has requested to automatically forward mail to your email address.\nConfirmation code: 123456789\n\nTo allow owner@gmail.com to automatically forward mail to your address, please click the link below to confirm the request:\n\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ8abc%5D-xyz\n',
    })
    expect(r).toEqual({ code: '123456789', link: 'https://mail-settings.google.com/mail/vf-%5BANGjdJ8abc%5D-xyz' })
  })
  it('is only for Gmail’s own sender', () => {
    expect(parseGmailForwardingConfirmation({ from: 'someone@gmail.com', subject: 'Confirmation code: 123456', text: '' })).toBeNull()
  })
})

describe('alertFingerprint', () => {
  const base = { receivingVpa: 'Shop@okhdfc', amountPaise: 5000, utr: '431234567890', at: new Date('2026-11-10T10:01:00Z') }
  it('is the same for a re-forward inside the 10-minute bucket and differs otherwise', () => {
    expect(alertFingerprint(base)).toBe(alertFingerprint({ ...base, receivingVpa: 'shop@okhdfc', at: new Date('2026-11-10T10:08:00Z') }))
    expect(alertFingerprint(base)).not.toBe(alertFingerprint({ ...base, amountPaise: 5001 }))
    expect(alertFingerprint(base)).not.toBe(alertFingerprint({ ...base, utr: null }))
    expect(alertFingerprint(base)).not.toBe(alertFingerprint({ ...base, at: new Date('2026-11-10T10:31:00Z') }))
  })
})
