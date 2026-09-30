import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { recomputeHealth, getHealth } from '@/lib/customer-health'
import { createAutoTask, completeAutoTask } from '@/lib/auto-tasks'

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 200

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const users = await queryMany<{ id: string }>(
    `
    SELECT u.id
    FROM users u
    LEFT JOIN customer_health ch ON ch.user_id = u.id
    WHERE u.is_active = TRUE AND u.is_guest = FALSE
      AND (ch.last_computed_at IS NULL OR ch.last_computed_at < NOW() - INTERVAL '24 hours')
    ORDER BY ch.last_computed_at NULLS FIRST
    LIMIT $1
  `,
    [BATCH_SIZE]
  )

  let processed = 0
  let dropTasksCreated = 0
  let recoveredTasksCompleted = 0
  const errors: string[] = []

  for (const user of users) {
    try {
      const before = await getHealth(user.id)
      const after = await recomputeHealth(user.id)
      if (!after) continue
      processed++

      const beforeScore = before?.score ?? null
      const afterScore = after.score

      const crossedDownTo40 = (beforeScore == null || beforeScore >= 40) && afterScore < 40
      const crossedDownTo25 = (beforeScore == null || beforeScore >= 25) && afterScore < 25
      const recoveredAbove50 = beforeScore != null && beforeScore < 50 && afterScore >= 50
      const rapidDecline = after.trend_delta_30d <= -20

      if (crossedDownTo25 || rapidDecline) {
        const created = await createAutoTask({
          userId: user.id,
          sourceKind: 'save_customer',
          sourceRefId: user.id,
          title: rapidDecline
            ? `Save customer — health dropped ${Math.abs(after.trend_delta_30d)} points in 30 days`
            : `Save at-risk customer — health critical (${afterScore})`,
          description: `Health: ${afterScore}/100. Risk: ${after.churn_risk}. Recency ${after.recency_score}, Frequency ${after.frequency_score}, Monetary ${after.monetary_score}.`,
          priority: 'urgent',
          dueInDays: 0,
        })
        if (created) dropTasksCreated++
      } else if (crossedDownTo40) {
        const created = await createAutoTask({
          userId: user.id,
          sourceKind: 'save_customer',
          sourceRefId: user.id,
          title: `Save at-risk customer — health declining (${afterScore})`,
          description: `Health dropped to ${afterScore}/100 (${after.churn_risk}). Reach out before they churn.`,
          priority: 'high',
          dueInDays: 3,
        })
        if (created) dropTasksCreated++
      }

      if (recoveredAbove50) {
        await completeAutoTask('save_customer', user.id)
        recoveredTasksCompleted++
      }
    } catch (err: any) {
      errors.push(`${user.id}: ${err.message}`)
    }
  }

  return NextResponse.json({
    success: true,
    processed,
    dropTasksCreated,
    recoveredTasksCompleted,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
  })
}
