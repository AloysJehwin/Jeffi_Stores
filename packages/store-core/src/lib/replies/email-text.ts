// The new part of an emailed reply: everything above the quoted message and the signature.

const CUT: RegExp[] = [
  /^on\b.{0,200}\bwrote:\s*$/i, // Gmail / Apple Mail
  /^-{2,}\s*original message\s*-{2,}/i, // Outlook
  /^-{2,}\s*forwarded message\s*-{2,}/i,
  /^_{8,}\s*$/, // Outlook's rule above the header block
  /^from:\s.+$/i, // header block (checked with the next lines below)
  /^-- ?$/, // signature delimiter
  /^sent from my (iphone|ipad|android|phone|mobile|samsung|galaxy)/i,
  /^get outlook for /i,
]

export function topReply(text: string, max = 4000): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (l.startsWith('>')) break
    // "On Tue, 29 Oct 2026 at 10:02, Store <reply+…>" wrapped onto a second "wrote:" line.
    if (/^on\b/i.test(l) && /^wrote:\s*$/i.test(lines[i + 1]?.trim() ?? '')) break
    if (CUT.some(re => re.test(l))) {
      if (/^from:/i.test(l) && !/^(sent|date|to|subject):/i.test(lines[i + 1]?.trim() ?? '')) {
        out.push(lines[i])
        continue
      }
      break
    }
    out.push(lines[i])
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}
