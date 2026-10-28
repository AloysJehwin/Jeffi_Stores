/** An admin-set banner shape in `maxWidth`: the exact ratio, narrowed rather than taller than `maxHeight`. */
export function shapeBox(maxWidth: number, aspect: number, maxHeight: number): { width: number; height: number } {
  const height = Math.min(maxWidth / aspect, maxHeight)
  return { width: Math.round(height * aspect), height: Math.round(height) }
}

/** Below this the copy on a shaped banner drops its extras (eyebrow, subtitle) so the shape holds. */
export const SHAPE_COMPACT_H = 240
