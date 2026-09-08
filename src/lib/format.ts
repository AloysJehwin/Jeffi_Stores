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
