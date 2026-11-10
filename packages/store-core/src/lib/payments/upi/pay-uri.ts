const cleanTn = (s: string) => s.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 40) || 'Payment'

/** upi://pay deep link for a UPI ID; works in every UPI app and as a QR. */
export function upiPayUri(p: { vpa: string; payeeName: string; amountPaise: number; reference: string }): string {
  const q = new URLSearchParams({ pa: p.vpa, pn: p.payeeName.slice(0, 50), am: (p.amountPaise / 100).toFixed(2), cu: 'INR', tn: cleanTn(p.reference) })
  return `upi://pay?${q.toString()}`
}
