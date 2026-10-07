import { queryMany, queryOne } from '@/lib/shared/db'

export interface UpcomingBirthday {
  userId: string
  name: string
  email: string | null
  nextBirthday: string
}

export interface BirthdayProgramStats {
  customers: number
  withBirthday: number
  next30Days: number
  upcoming: UpcomingBirthday[]
}

// Retail customers the Birthday campaigns can reach: real, active accounts that are not approved businesses.
const RETAIL_CUSTOMER_SQL = `
  u.is_active = TRUE
  AND u.is_guest = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM business_profiles bp WHERE bp.user_id = u.id AND bp.approval_status = 'approved'
  )
`

// The next birthday on or after today. Adding whole years to 29 Feb lands on 28 Feb in other years.
const NEXT_BIRTHDAY_SQL = `
  (u.date_of_birth + ((EXTRACT(YEAR FROM age(CURRENT_DATE - 1, u.date_of_birth))::int + 1) * INTERVAL '1 year'))::date
`

export async function getBirthdayProgramStats(limit = 8): Promise<BirthdayProgramStats> {
  const [counts, upcoming] = await Promise.all([
    queryOne<{ customers: number; with_birthday: number; next_30_days: number }>(
      `SELECT COUNT(*)::int AS customers,
              COUNT(u.date_of_birth)::int AS with_birthday,
              COUNT(*) FILTER (
                WHERE u.date_of_birth IS NOT NULL AND ${NEXT_BIRTHDAY_SQL} < CURRENT_DATE + 30
              )::int AS next_30_days
         FROM users u
        WHERE ${RETAIL_CUSTOMER_SQL}`
    ),
    queryMany<{
      user_id: string
      first_name: string | null
      last_name: string | null
      email: string | null
      next_birthday: string
    }>(
      `SELECT u.id::text AS user_id, u.first_name, u.last_name, u.email,
              to_char(${NEXT_BIRTHDAY_SQL}, 'YYYY-MM-DD') AS next_birthday
         FROM users u
        WHERE ${RETAIL_CUSTOMER_SQL}
          AND u.date_of_birth IS NOT NULL
          AND ${NEXT_BIRTHDAY_SQL} < CURRENT_DATE + 30
        ORDER BY ${NEXT_BIRTHDAY_SQL}, u.first_name
        LIMIT $1`,
      [limit]
    ),
  ])
  return {
    customers: counts?.customers ?? 0,
    withBirthday: counts?.with_birthday ?? 0,
    next30Days: counts?.next_30_days ?? 0,
    upcoming: upcoming.map(row => ({
      userId: row.user_id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || 'Customer',
      email: row.email,
      nextBirthday: row.next_birthday,
    })),
  }
}
