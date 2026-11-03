import { escapeLike, type FieldKeys, type FieldSql, type FilterEntity } from '@jeffi/list-filters'
import { REVIEW_ALIASES, REVIEW_FIELDS } from '../fields/reviews'
import { col, ist, nullableTs, yesNo } from './shared'

type ReviewKey = FieldKeys<typeof REVIEW_FIELDS>

const HAS_IMAGES = 'cardinality(pr.image_urls) > 0'
const TAGS = "jsonb_array_elements_text(CASE WHEN jsonb_typeof(pr.tags) = 'array' THEN pr.tags ELSE '[]'::jsonb END) t(tag)"

const SQL: Record<ReviewKey, FieldSql> = {
  // Bound as booleans, as the list's API always has.
  approval: {
    kind: 'custom',
    build: (q, bind) =>
      q.filter === 'pending' || q.filter === 'approved'
        ? `COALESCE(pr.is_approved, false) = ${bind(q.filter === 'approved')}`
        : null,
  },
  rating: { kind: 'enum', expr: 'pr.rating', cast: 'int' },
  verified: { kind: 'bool', expr: 'COALESCE(pr.is_verified_purchase, false)' },
  has_images: { kind: 'bool', expr: HAS_IMAGES },
  tag: { kind: 'values', lateral: { from: TAGS, link: 'TRUE', expr: 't.tag' } },
  product: { kind: 'values', lateral: { from: 'products p', link: 'p.id = pr.product_id', expr: 'p.name' } },
  brand: {
    kind: 'values',
    lateral: { from: 'products p JOIN brands b ON b.id = p.brand_id', link: 'p.id = pr.product_id', expr: 'b.name' },
  },
  created: { kind: 'date', expr: 'pr.created_at' },
}

export const REVIEWS_ENTITY: FilterEntity<ReviewKey> = {
  key: 'reviews',
  scope: 'reviews:read',
  noun: 'Reviews',
  root: 'product_reviews',
  alias: 'pr',
  fields: REVIEW_FIELDS,
  sql: SQL,
  period: 'created',
  aliases: REVIEW_ALIASES,
  search: {
    param: 'q',
    build: (q, idx) => {
      const p = `$${idx}`
      return {
        clause: `(pr.title ILIKE ${p} OR pr.comment ILIKE ${p}
          OR EXISTS (SELECT 1 FROM products p WHERE p.id = pr.product_id AND p.name ILIKE ${p})
          OR EXISTS (SELECT 1 FROM users u WHERE u.id = pr.user_id
            AND (u.first_name ILIKE ${p} OR u.last_name ILIKE ${p} OR u.email ILIKE ${p})))`,
        params: [`%${escapeLike(q.trim())}%`],
        nextIdx: idx + 1,
      }
    },
  },
  facets: true,
  export: {
    columns: [
      col('date', 'Date', ist('pr.created_at')),
      col('product', 'Product', '(SELECT p.name FROM products p WHERE p.id = pr.product_id)'),
      col(
        'brand',
        'Brand',
        '(SELECT b.name FROM products p JOIN brands b ON b.id = p.brand_id WHERE p.id = pr.product_id)'
      ),
      col('rating', 'Rating', 'pr.rating'),
      col('title', 'Title', 'pr.title'),
      col('comment', 'Review', 'pr.comment'),
      col(
        'reviewer',
        'Reviewer',
        "(SELECT NULLIF(btrim(concat(u.first_name, ' ', u.last_name)), '') FROM users u WHERE u.id = pr.user_id)"
      ),
      col('approved', 'Approved', yesNo('COALESCE(pr.is_approved, false)')),
      col('verified', 'Verified purchase', yesNo('COALESCE(pr.is_verified_purchase, false)')),
      col('photos', 'Photos', 'cardinality(pr.image_urls)'),
      col('tags', 'Tags', `(SELECT string_agg(t.tag, ', ') FROM ${TAGS})`),
      col('order', 'Order no', '(SELECT o.order_number FROM orders o WHERE o.id = pr.order_id)'),
    ],
    keyset: [nullableTs('pr.created_at'), 'pr.id'],
  },
}
