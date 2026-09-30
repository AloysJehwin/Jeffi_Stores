import 'server-only'
import { queryOne } from '@/lib/db'
import { EMPTY_REVIEW_SUMMARY, toReviewSummary, type ReviewSummary } from '@/components/visitor/pdp/review-summary'

/** Average and count of approved reviews only; a failure hides the summary instead of failing the page. */
export async function getApprovedReviewSummary(productId: string): Promise<ReviewSummary> {
  try {
    const row = await queryOne<{ total: number; average: number | null }>(
      `SELECT COUNT(rating)::int AS total, AVG(rating)::float8 AS average
       FROM product_reviews
       WHERE product_id = $1 AND is_approved = true`,
      [productId],
    )
    return toReviewSummary(row)
  } catch (err) {
    console.error('[pdp] review summary', err)
    return EMPTY_REVIEW_SUMMARY
  }
}
