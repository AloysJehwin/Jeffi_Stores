export interface ReviewSummary {
  average: number
  total: number
}

export const EMPTY_REVIEW_SUMMARY: ReviewSummary = { average: 0, total: 0 }

export function toReviewSummary(row: { total?: unknown; average?: unknown } | null | undefined): ReviewSummary {
  const total = Math.max(0, Math.trunc(Number(row?.total) || 0))
  const average = row?.average == null ? NaN : Number(row.average)
  if (total === 0 || !Number.isFinite(average)) return EMPTY_REVIEW_SUMMARY
  return { average: Math.round(Math.min(5, Math.max(1, average)) * 10) / 10, total }
}
