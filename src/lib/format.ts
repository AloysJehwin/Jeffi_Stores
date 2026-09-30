export function humanizeLabel(raw: string): string {
  if (!raw) return raw
  const tokens = raw.split(/[_\s-]+/).filter(Boolean)
  if (tokens.length === 0) return raw
  const humanized = tokens
    .map(token => {
      if (/^[A-Z0-9]+$/.test(token)) return token
      if (/\d/.test(token)) return token
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
    })
    .join(' ')
  return humanized || raw
}

export function formatINR(n: number, fractionDigits = 2): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: fractionDigits,
  }).format(n)
}

export function formatDate(s: string, empty = '—'): string {
  if (!s) return empty
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function numberToWords(num: number): string {
  if (num === 0) return 'Zero'
  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ]
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  function convertGroup(n: number): string {
    if (n === 0) return ''
    if (n < 20) return ones[n]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convertGroup(n % 100) : '')
  }

  const crore = Math.floor(num / 10000000)
  const lakh = Math.floor((num % 10000000) / 100000)
  const thousand = Math.floor((num % 100000) / 1000)
  const remainder = Math.floor(num % 1000)
  const paise = Math.round((num - Math.floor(num)) * 100)

  let result = ''
  if (crore > 0) result += convertGroup(crore) + ' Crore '
  if (lakh > 0) result += convertGroup(lakh) + ' Lakh '
  if (thousand > 0) result += convertGroup(thousand) + ' Thousand '
  if (remainder > 0) result += convertGroup(remainder)

  result = result.trim()
  if (paise > 0) result += ' and ' + convertGroup(paise) + ' paise'
  return result
}

export const ADMIN_INPUT_CLASS =
  'w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors placeholder:text-foreground-muted'
