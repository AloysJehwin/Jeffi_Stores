// Opening hours as the owner types them ("Mon–Sat: 10am–8pm, Sun: closed", one per line or comma-separated), read as
// rows. Pure: the contact block and the code parts' store data read one shape.

export interface HoursRow {
  label: string
  value: string
}

export function parseHours(text: string): HoursRow[] {
  return text
    .split(/\r?\n|,\s*(?=[A-Za-z][^,:]*:)/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const i = l.indexOf(':')
      return i > 0 ? { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : { label: l, value: '' }
    })
}

/** The links a store's phone number and address open: `tel:` without spaces, and a map search. */
export const phoneUrl = (phone: string) => (phone.trim() ? `tel:${phone.replace(/\s+/g, '')}` : '')
export const mapsUrl = (address: string) => (address.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '')
