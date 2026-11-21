// A per-pod cap on how often one store can send documents to the automatic check (each one is an OCR call).

const hits = new Map<string, number[]>()

/** True when `key` is still under `max` calls in the last `windowMs`; records the call when it is. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs)
  if (recent.length >= max) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k)
  return true
}
