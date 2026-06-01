# Marketing approve-route cases

Add these `case` blocks to the `switch (action.kind)` in
`src/app/api/admin/agent/actions/[id]/approve/route.ts`.

Required imports at top of that file:

```ts
import { transporter } from '@/lib/email'
```

(`query`, `queryOne`, `queryMany` are already imported.)

---

## case 'create_coupon'

```ts
case 'create_coupon': {
  const { code, discountType, discountValue, validUntil, minPurchaseAmount, usageLimit, description } = action.payload as {
    code: string; discountType: string; discountValue: number;
    validUntil: string | null; minPurchaseAmount: number | null;
    usageLimit: number | null; description: string | null;
  }
  if (!code || !discountType || !discountValue) {
    return { result: null, error: 'Missing required coupon fields in payload' }
  }
  try {
    const inserted = await queryOne<{ id: string; code: string }>(
      `INSERT INTO coupons
         (code, description, discount_type, discount_value,
          min_purchase_amount, max_discount_amount,
          usage_limit, usage_limit_per_user,
          valid_from, valid_until, is_active, auto_generated)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, NULL, NOW(), $7, TRUE, FALSE)
       RETURNING id::text, code`,
      [code, description, discountType, discountValue, minPurchaseAmount, usageLimit, validUntil]
    )
    if (!inserted) return { result: null, error: 'Insert returned no row' }
    return { result: { id: inserted.id, code: inserted.code }, error: null }
  } catch (err: any) {
    if (err?.code === '23505') return { result: null, error: 'Coupon code already exists' }
    return { result: null, error: String(err?.message || 'Insert failed') }
  }
}
```

---

## case 'update_campaign_template'

```ts
case 'update_campaign_template': {
  const { campaignKind, newSubject, newBody } = action.payload as {
    campaignKind: string; newSubject: string | null; newBody: string | null;
  }
  if (!campaignKind) return { result: null, error: 'campaignKind missing' }
  if (newSubject === null && newBody === null) {
    return { result: null, error: 'No fields to update' }
  }
  const sets: string[] = ['updated_at = NOW()']
  const vals: any[] = []
  let i = 1
  if (newSubject !== null) { sets.push(`subject_template = $${i++}`); vals.push(newSubject.slice(0, 500)) }
  if (newBody !== null) { sets.push(`body_template = $${i++}`); vals.push(newBody.slice(0, 50000)) }
  vals.push(campaignKind)
  const updated = await queryOne<{ kind: string; name: string }>(
    `UPDATE campaigns SET ${sets.join(', ')} WHERE kind = $${i} RETURNING kind, name`,
    vals
  )
  if (!updated) return { result: null, error: 'Campaign not found' }
  return {
    result: {
      kind: updated.kind, name: updated.name,
      subjectChanged: newSubject !== null, bodyChanged: newBody !== null,
    },
    error: null,
  }
}
```

---

## case 'send_mailer_broadcast'

```ts
case 'send_mailer_broadcast': {
  const { audience, testEmail, subject, body, fromName } = action.payload as {
    audience: 'all_opted_in' | 'recent_buyers' | 'test_only';
    testEmail: string | null;
    subject: string;
    body: string;
    fromName: string;
  }
  if (!subject || !body) return { result: null, error: 'subject and body required' }

  let recipients: { email: string; name: string }[] = []
  if (audience === 'test_only') {
    if (!testEmail) return { result: null, error: 'testEmail missing' }
    recipients = [{ email: testEmail, name: 'there' }]
  } else if (audience === 'all_opted_in') {
    recipients = await queryMany<{ email: string; name: string }>(
      `SELECT email, COALESCE(NULLIF(TRIM(first_name || ' ' || COALESCE(last_name,'')), ''), email) AS name
         FROM users WHERE email IS NOT NULL AND marketing_opt_out IS NOT TRUE`
    )
  } else if (audience === 'recent_buyers') {
    recipients = await queryMany<{ email: string; name: string }>(
      `SELECT DISTINCT u.email, COALESCE(NULLIF(TRIM(u.first_name || ' ' || COALESCE(u.last_name,'')), ''), u.email) AS name
         FROM users u JOIN orders o ON o.user_id = u.id
        WHERE u.email IS NOT NULL AND u.marketing_opt_out IS NOT TRUE
          AND o.created_at > NOW() - INTERVAL '90 days'`
    )
  } else {
    return { result: null, error: `Unknown audience: ${audience}` }
  }

  const fromHeader = `"${(fromName || 'Jeffi Stores').replace(/"/g, '')}" <${process.env.SES_FROM_EMAIL}>`
  let sent = 0, failed = 0
  for (const r of recipients) {
    try {
      const personalised = body.replace(/\{firstName\}/g, r.name.split(' ')[0] || 'there')
      await transporter.sendMail({
        from: fromHeader,
        to: r.email,
        subject,
        html: personalised,
        text: personalised.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      })
      sent++
    } catch {
      failed++
    }
  }
  return {
    result: { audience, recipients: recipients.length, sent, failed },
    error: failed > 0 && sent === 0 ? `All ${failed} sends failed` : null,
  }
}
```

---

## case 'generate_personalized_coupon'

```ts
case 'generate_personalized_coupon': {
  const { userId, customerEmail, discountType, discountValue, daysValid, campaign, validUntil } = action.payload as {
    userId: string; customerEmail: string; discountType: string; discountValue: number;
    daysValid: number; campaign: string; validUntil: string;
  }
  if (!userId || !discountType || !discountValue) {
    return { result: null, error: 'Missing required fields in payload' }
  }
  const prefix = (campaign || 'OFFER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'OFFER'
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  const code = `${prefix}-${random}`
  try {
    const inserted = await queryOne<{ id: string; code: string }>(
      `INSERT INTO coupons
         (code, description, discount_type, discount_value,
          min_purchase_amount, max_discount_amount,
          usage_limit, usage_limit_per_user,
          valid_from, valid_until, is_active,
          auto_generated, generated_for_user_id, generated_for_campaign)
       VALUES ($1, $2, $3, $4, 0, NULL, 1, 1, NOW(), $5, TRUE, TRUE, $6::uuid, $7)
       RETURNING id::text, code`,
      [code, `Auto-generated for ${campaign}`, discountType, discountValue, validUntil, userId, campaign]
    )
    if (!inserted) return { result: null, error: 'Insert returned no row' }
    return {
      result: {
        id: inserted.id, code: inserted.code, userId, customerEmail,
        discountType, discountValue, daysValid,
      },
      error: null,
    }
  } catch (err: any) {
    if (err?.code === '23505') {
      return { result: null, error: 'Coupon code collision (rare) — retry the action' }
    }
    return { result: null, error: String(err?.message || 'Insert failed') }
  }
}
```
