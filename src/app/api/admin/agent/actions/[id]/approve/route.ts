import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany, queryOne, withTransaction, getClient } from '@/lib/db'
import { sendTestCampaignEmail } from '@/lib/automation-emails'
import { sendOrderDelayNotification, sendProductAnnouncementEmail, sendQuotationFinalizedEmail, transporter } from '@/lib/email'
import { VARIANT_MIN_PRICE_SQL } from '@/lib/queries'
import { logActivity } from '@/lib/activity'
import { logStockMovement } from '@/lib/inventory'
import type { CampaignKind } from '@/lib/marketing'

const APPROVE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || `http://localhost:${process.env.PORT || 3000}`

async function callInternalApi(
  cookieHeader: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; ok: boolean; data: any }> {
  const res = await fetch(new URL(path, APPROVE_ORIGIN).toString(), {
    method,
    headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data: any
  try { data = await res.json() } catch { data = await res.text().catch(() => null) }
  return { status: res.status, ok: res.ok, data }
}

export const dynamic = 'force-dynamic'

interface AgentAction {
  id: string
  admin_id: string
  conversation_id: string
  kind: string
  payload: any
  status: string
}

async function executeAction(action: AgentAction, cookieHeader: string): Promise<{ result: any; error: string | null }> {
  switch (action.kind) {
    case 'send_test_email': {
      const { campaignKind, toEmail } = action.payload
      const r = await sendTestCampaignEmail(campaignKind as CampaignKind, toEmail)
      if (!r.ok) return { result: null, error: r.reason || 'Send failed' }
      return { result: { sentTo: toEmail, campaign: campaignKind }, error: null }
    }
    case 'toggle_campaign_enabled': {
      const { campaignKind, enabled } = action.payload
      const updated = await queryOne(
        `UPDATE campaigns SET enabled = $1, updated_at = NOW() WHERE kind = $2 RETURNING kind, name, enabled`,
        [!!enabled, campaignKind]
      )
      if (!updated) return { result: null, error: 'Campaign not found' }
      return { result: updated, error: null }
    }
    case 'mark_order_shipped': {
      const { orderId, awbNumber } = action.payload
      const updated = await queryOne(
        `UPDATE orders
         SET status = 'shipped', shipped_at = COALESCE(shipped_at, NOW()),
             awb_number = COALESCE($2, awb_number), updated_at = NOW()
         WHERE id = $1::uuid AND status NOT IN ('shipped','delivered','cancelled')
         RETURNING id::text, order_number, status, awb_number`,
        [orderId, awbNumber || null]
      )
      if (!updated) return { result: null, error: 'Order not found or already shipped/delivered/cancelled' }
      return { result: updated, error: null }
    }
    case 'send_order_delay_email': {
      const { customerEmail, customerName, orderNumber, delayDays, reason } = action.payload
      if (!customerEmail || !orderNumber || !delayDays || !reason) {
        return { result: null, error: 'Missing required fields in payload' }
      }
      const r = await sendOrderDelayNotification({
        toEmail: customerEmail,
        customerName: customerName || 'there',
        orderNumber,
        delayDays: Number(delayDays),
        reason: String(reason),
      })
      if (!r.success) return { result: null, error: 'Send failed' }
      return { result: { sentTo: customerEmail, orderNumber, delayDays, messageId: r.messageId }, error: null }
    }
    case 'send_product_announcement_email': {
      const { productIds, audience, testEmail, subject, intro } = action.payload as {
        productIds: string[]; audience: string; testEmail: string | null; subject: string; intro: string
      }
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return { result: null, error: 'productIds missing' }
      }
      const products = await queryMany<{
        id: string; name: string; slug: string; price: string; short_description: string | null; primary_image_url: string | null
      }>(
        `SELECT p.id::text, p.name, p.slug,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.short_description,
                (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS primary_image_url
           FROM products p WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
        [productIds]
      )
      if (products.length === 0) return { result: null, error: 'No active products resolved' }

      let recipients: { email: string; name: string }[] = []
      if (audience === 'test_only') {
        if (!testEmail) return { result: null, error: 'testEmail missing' }
        recipients = [{ email: testEmail, name: 'there' }]
      } else if (audience === 'all_opted_in') {
        recipients = await queryMany(
          `SELECT email, COALESCE(NULLIF(TRIM(first_name || ' ' || COALESCE(last_name,'')), ''), email) AS name
             FROM users WHERE email IS NOT NULL AND marketing_opt_out IS NOT TRUE`
        ) as any
      } else if (audience === 'recent_buyers') {
        recipients = await queryMany(
          `SELECT DISTINCT u.email, COALESCE(NULLIF(TRIM(u.first_name || ' ' || COALESCE(u.last_name,'')), ''), u.email) AS name
             FROM users u JOIN orders o ON o.user_id = u.id
            WHERE u.email IS NOT NULL AND u.marketing_opt_out IS NOT TRUE
              AND o.created_at > NOW() - INTERVAL '90 days'`
        ) as any
      } else {
        return { result: null, error: `Unknown audience: ${audience}` }
      }

      let sent = 0, failed = 0
      for (const r of recipients) {
        const out = await sendProductAnnouncementEmail({
          toEmail: r.email, customerName: r.name, subject, intro, products,
        })
        if (out.success) sent++; else failed++
      }
      return {
        result: { audience, recipients: recipients.length, sent, failed, productCount: products.length },
        error: failed > 0 && sent === 0 ? `All ${failed} sends failed` : null,
      }
    }
    case 'call_admin_api': {
      const { method, path, body } = action.payload as { method: string; path: string; body: string | null }
      const FORBIDDEN_PATH_RE = /^\/api\/admin\/(agent\/|team\b|admins\b|auth\b|settings\/admins)/
      if (!path?.startsWith('/api/admin/') || FORBIDDEN_PATH_RE.test(path)) {
        return { result: null, error: 'Path not permitted at execution time' }
      }
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return { result: null, error: 'Method not permitted at execution time' }
      }
      const origin = process.env.NEXT_PUBLIC_SITE_URL || `http://localhost:${process.env.PORT || 3000}`
      const url = new URL(path, origin).toString()
      try {
        const res = await fetch(url, {
          method,
          headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
          body: body || undefined,
        })
        let parsed: unknown
        try { parsed = await res.json() } catch { parsed = await res.text().catch(() => null) }
        return {
          result: { method, path, status: res.status, ok: res.ok, body: parsed },
          error: res.ok ? null : `Upstream returned ${res.status}`,
        }
      } catch (err: any) {
        return { result: null, error: String(err?.message || 'API call failed') }
      }
    }

    case 'create_quotation': {
      const { customerEmail, consigneeName, notes, items } = action.payload as {
        customerEmail: string; consigneeName: string; notes: string | null;
        items: { productId: string; name: string; sku: string; hsnCode: string | null;
                 gstRate: number; quantity: number; unitPrice: number; lineAmount: number }[]
      }
      if (!Array.isArray(items) || items.length === 0) return { result: null, error: 'items missing' }
      const subtotal = items.reduce((s, i) => s + i.lineAmount, 0)
      const cgst = items.reduce((s, i) => s + i.lineAmount * i.gstRate / 200, 0)
      const sgst = cgst
      const total = Math.round(subtotal + cgst + sgst)
      const now = new Date()
      const m = now.getMonth(), y = now.getFullYear()
      const fyStart = m >= 3 ? y : y - 1
      const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`
      const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][m]
      const prefix = `QT/${fy}/${mon}/`
      try {
        const out = await withTransaction(async (client) => {
          const seqRow = await client.query<{ max_seq: string | null }>(
            `SELECT MAX(CAST(split_part(quote_number, '/', 4) AS INTEGER)) AS max_seq
               FROM quotations WHERE quote_number LIKE $1`,
            [prefix + '%']
          )
          const seq = (parseInt(seqRow.rows[0]?.max_seq || '0') || 0) + 1
          const quoteNumber = `${prefix}${seq}`
          const qt = await client.query<{ id: string; quote_number: string; view_token: string }>(
            `INSERT INTO quotations (quote_number, quote_date, status, consignee_name, consignee_addr1, consignee_state,
                                     consignee_email, buyer_same, notes, subtotal, cgst_amount, sgst_amount, total_amount, created_by)
             VALUES ($1,$2,'draft',$3,'','Chhattisgarh',$4,TRUE,$5,$6,$7,$8,$9,$10::uuid)
             RETURNING id::text, quote_number, view_token::text`,
            [quoteNumber, now.toISOString().slice(0, 10), consigneeName || customerEmail,
             customerEmail, notes, subtotal, cgst, sgst, total, action.admin_id]
          )
          const qid = qt.rows[0].id
          for (let idx = 0; idx < items.length; idx++) {
            const it = items[idx]
            await client.query(
              `INSERT INTO quotation_items (quotation_id, position, description, hsn_code, gst_rate,
                                             quantity, unit, rate, discount_pct, amount, product_id)
               VALUES ($1,$2,$3,$4,$5,$6,'PCS',$7,0,$8,$9::uuid)`,
              [qid, idx, it.name, it.hsnCode, it.gstRate, it.quantity, it.unitPrice, it.lineAmount, it.productId]
            )
          }
          return { id: qid, quote_number: qt.rows[0].quote_number, view_token: qt.rows[0].view_token }
        })
        return { result: { quotationId: out.id, quoteNumber: out.quote_number, total, viewToken: out.view_token }, error: null }
      } catch (err: any) {
        return { result: null, error: String(err?.message || 'Quotation create failed') }
      }
    }
    case 'send_quotation_email': {
      const { quoteNumber, toEmail, consigneeName, totalAmount, viewToken } = action.payload as {
        quoteNumber: string; toEmail: string; consigneeName: string; totalAmount: number; viewToken: string
      }
      if (!toEmail || !quoteNumber) return { result: null, error: 'Missing recipient or quote number' }
      try {
        const viewUrl = `https://quotation.jeffistores.in/${viewToken}`
        await sendQuotationFinalizedEmail(toEmail, consigneeName || '', quoteNumber, Number(totalAmount), viewUrl)
        return { result: { sentTo: toEmail, quoteNumber }, error: null }
      } catch (err: any) {
        return { result: null, error: String(err?.message || 'Send failed') }
      }
    }
    case 'mark_invoice_paid': {
      const { orderId, paymentMode, paidAt } = action.payload as {
        orderId: string; paymentMode: string; paidAt: string | null
      }
      const updated = await queryOne<{ id: string; invoice_number: string; payment_status: string; invoice_date: string | null }>(
        `UPDATE orders
            SET payment_status = 'paid',
                invoice_date = COALESCE($2::date, invoice_date),
                notes = COALESCE(notes, '') ||
                        CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END ||
                        'Marked paid via ' || $3 || ' on ' || COALESCE($2::text, CURRENT_DATE::text),
                updated_at = NOW()
          WHERE id = $1::uuid AND invoice_number IS NOT NULL
            AND payment_status NOT IN ('paid','refunded')
          RETURNING id::text, invoice_number, payment_status, invoice_date`,
        [orderId, paidAt || null, paymentMode]
      )
      if (!updated) return { result: null, error: 'Invoice not found, already paid, or refunded' }
      return { result: { ...updated, paymentMode }, error: null }
    }
    case 'update_order_status': {
      const { orderId, newStatus, awbNumber } = action.payload as {
        orderId: string; newStatus: string; awbNumber: string | null
      }
      const ALLOWED = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']
      if (!ALLOWED.includes(newStatus)) return { result: null, error: 'Invalid status' }
      const tsCol =
        newStatus === 'confirmed' ? 'confirmed_at' :
        newStatus === 'shipped'   ? 'shipped_at'   :
        newStatus === 'delivered' ? 'delivered_at' :
        newStatus === 'cancelled' ? 'cancelled_at' : null
      const setParts = [`status = $2`, `updated_at = NOW()`]
      const params: any[] = [orderId, newStatus]
      if (tsCol) setParts.push(`${tsCol} = COALESCE(${tsCol}, NOW())`)
      if (newStatus === 'shipped' && awbNumber) {
        params.push(awbNumber)
        setParts.push(`awb_number = COALESCE(awb_number, $${params.length})`)
      }
      const updated = await queryOne(
        `UPDATE orders SET ${setParts.join(', ')} WHERE id = $1::uuid RETURNING id::text, order_number, status, awb_number`,
        params
      )
      if (!updated) return { result: null, error: 'Order not found' }
      return { result: updated, error: null }
    }

    case 'create_coupon': {
      const { code, discountType, discountValue, validUntil, minPurchaseAmount, usageLimit, description } = action.payload as {
        code: string; discountType: string; discountValue: number;
        validUntil: string | null; minPurchaseAmount: number | null;
        usageLimit: number | null; description: string | null;
      }
      if (!code || !discountType || !discountValue) return { result: null, error: 'Missing required coupon fields in payload' }
      try {
        const inserted = await queryOne<{ id: string; code: string }>(
          `INSERT INTO coupons (code, description, discount_type, discount_value,
                                min_purchase_amount, max_discount_amount, usage_limit, usage_limit_per_user,
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
    case 'update_campaign_template': {
      const { campaignKind, newSubject, newBody } = action.payload as {
        campaignKind: string; newSubject: string | null; newBody: string | null;
      }
      if (!campaignKind) return { result: null, error: 'campaignKind missing' }
      if (newSubject === null && newBody === null) return { result: null, error: 'No fields to update' }
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
      return { result: { kind: updated.kind, name: updated.name, subjectChanged: newSubject !== null, bodyChanged: newBody !== null }, error: null }
    }
    case 'send_mailer_broadcast': {
      const { audience, testEmail, subject, body, fromName } = action.payload as {
        audience: 'all_opted_in' | 'recent_buyers' | 'test_only';
        testEmail: string | null; subject: string; body: string; fromName: string;
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
            from: fromHeader, to: r.email, subject,
            html: personalised,
            text: personalised.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
          })
          sent++
        } catch { failed++ }
      }
      return { result: { audience, recipients: recipients.length, sent, failed }, error: failed > 0 && sent === 0 ? `All ${failed} sends failed` : null }
    }
    case 'generate_personalized_coupon': {
      const { userId, customerEmail, discountType, discountValue, daysValid, campaign, validUntil } = action.payload as {
        userId: string; customerEmail: string; discountType: string; discountValue: number;
        daysValid: number; campaign: string; validUntil: string;
      }
      if (!userId || !discountType || !discountValue) return { result: null, error: 'Missing required fields in payload' }
      const prefix = (campaign || 'OFFER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'OFFER'
      const random = Math.random().toString(36).slice(2, 8).toUpperCase()
      const code = `${prefix}-${random}`
      try {
        const inserted = await queryOne<{ id: string; code: string }>(
          `INSERT INTO coupons (code, description, discount_type, discount_value,
                                min_purchase_amount, max_discount_amount,
                                usage_limit, usage_limit_per_user, valid_from, valid_until, is_active,
                                auto_generated, generated_for_user_id, generated_for_campaign)
           VALUES ($1, $2, $3, $4, 0, NULL, 1, 1, NOW(), $5, TRUE, TRUE, $6::uuid, $7)
           RETURNING id::text, code`,
          [code, `Auto-generated for ${campaign}`, discountType, discountValue, validUntil, userId, campaign]
        )
        if (!inserted) return { result: null, error: 'Insert returned no row' }
        return { result: { id: inserted.id, code: inserted.code, userId, customerEmail, discountType, discountValue, daysValid }, error: null }
      } catch (err: any) {
        if (err?.code === '23505') return { result: null, error: 'Coupon code collision (rare) — retry the action' }
        return { result: null, error: String(err?.message || 'Insert failed') }
      }
    }

    case 'create_product': {
      const { name, sku, slug, basePrice, brandId, categoryId, shortDescription, weightGrams, gstPercentage } = action.payload as {
        name: string; sku: string; slug: string; basePrice: number;
        brandId: string | null; categoryId: string | null;
        shortDescription: string | null; weightGrams: number; gstPercentage: number;
      }
      if (!name || !sku || !slug || !Number.isFinite(basePrice) || basePrice < 0) return { result: null, error: 'Invalid product payload' }
      const dup = await queryOne<{ id: string }>(`SELECT id FROM products WHERE sku = $1 LIMIT 1`, [sku])
      if (dup) return { result: null, error: `SKU "${sku}" already exists` }
      const created = await queryOne<{ id: string; name: string; sku: string }>(
        `INSERT INTO products (name, slug, sku, base_price, mrp, gst_percentage, short_description,
                               brand_id, category_id, weight_grams, inventory_quantity, low_stock_threshold,
                               is_active, is_featured, has_variants)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7::uuid, $8::uuid, $9, 0, 10, TRUE, FALSE, FALSE)
         RETURNING id::text, name, sku`,
        [name, slug, sku, basePrice, gstPercentage, shortDescription, brandId, categoryId, weightGrams]
      )
      if (!created) return { result: null, error: 'Insert failed' }
      return { result: created, error: null }
    }
    case 'update_product': {
      const { productId, changes } = action.payload as { productId: string; changes: Record<string, unknown> }
      const ALLOWED = new Set(['name', 'base_price', 'short_description', 'is_featured', 'is_active', 'brand_id', 'category_id', 'gst_percentage'])
      const sets: string[] = []
      const params: unknown[] = []
      for (const [k, v] of Object.entries(changes || {})) {
        if (!ALLOWED.has(k)) continue
        params.push(v === '' ? null : v)
        sets.push(k === 'brand_id' || k === 'category_id' ? `${k} = $${params.length}::uuid` : `${k} = $${params.length}`)
      }
      if (sets.length === 0) return { result: null, error: 'No valid fields to update' }
      params.push(productId)
      const updated = await queryOne(
        `UPDATE products SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}::uuid
         RETURNING id::text, name, is_active, is_featured`,
        params
      )
      if (!updated) return { result: null, error: 'Product not found' }
      return { result: updated, error: null }
    }
    case 'adjust_inventory': {
      const { productId, delta, reason } = action.payload as { productId: string; delta: number; reason: string }
      if (!Number.isInteger(delta) || delta === 0) return { result: null, error: 'Invalid delta' }
      const client = await getClient()
      try {
        await client.query('BEGIN')
        const cur = await client.query<{ inventory_quantity: number }>(
          `SELECT inventory_quantity FROM products WHERE id = $1::uuid FOR UPDATE`, [productId]
        )
        if (cur.rows.length === 0) { await client.query('ROLLBACK'); return { result: null, error: 'Product not found' } }
        const current = Number(cur.rows[0].inventory_quantity || 0)
        const computed = current + delta
        if (computed < 0) { await client.query('ROLLBACK'); return { result: null, error: `Adjustment would drop stock to ${computed}` } }
        await client.query(`UPDATE products SET inventory_quantity = $1, updated_at = NOW() WHERE id = $2::uuid`, [computed, productId])
        await logStockMovement(client, {
          productId, variantId: null, transactionType: 'adjustment',
          quantityChange: delta, referenceType: 'manual', referenceId: productId,
          notes: `Agent adjustment: ${reason}`,
        })
        await client.query('COMMIT')
        return { result: { productId, previous: current, delta, current: computed }, error: null }
      } catch (e: any) {
        try { await client.query('ROLLBACK') } catch {}
        return { result: null, error: e?.message || 'Adjustment failed' }
      } finally { client.release() }
    }
    case 'set_product_featured': {
      const { productId, featured, limit } = action.payload as { productId: string; featured: boolean; limit: number }
      const lim = typeof limit === 'number' && limit > 0 ? limit : 6
      if (featured) {
        const cur = await queryOne<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM products WHERE is_featured = TRUE AND id <> $1::uuid`, [productId]
        )
        if ((cur?.n || 0) >= lim) return { result: null, error: `Featured limit (${lim}) reached. Unfeature one first.` }
      }
      const updated = await queryOne(
        `UPDATE products SET is_featured = $1, updated_at = NOW() WHERE id = $2::uuid
         RETURNING id::text, name, is_featured`,
        [!!featured, productId]
      )
      if (!updated) return { result: null, error: 'Product not found' }
      return { result: updated, error: null }
    }
    case 'create_brand': {
      const { name, slug, logoUrl } = action.payload as { name: string; slug: string; logoUrl: string | null }
      if (!name || !slug) return { result: null, error: 'name and slug required' }
      const dup = await queryOne<{ id: string }>(
        `SELECT id FROM brands WHERE slug = $1 OR LOWER(name) = LOWER($2) LIMIT 1`, [slug, name]
      )
      if (dup) return { result: null, error: `Brand with slug "${slug}" or matching name already exists` }
      const created = await queryOne(
        `INSERT INTO brands (name, slug, logo_url, is_active) VALUES ($1, $2, $3, TRUE)
         RETURNING id::text, name, slug, logo_url, is_active`,
        [name, slug, logoUrl]
      )
      if (!created) return { result: null, error: 'Insert failed' }
      return { result: created, error: null }
    }
    case 'create_category': {
      const { name, slug, parentId } = action.payload as { name: string; slug: string; parentId: string | null }
      if (!name || !slug) return { result: null, error: 'name and slug required' }
      if (parentId) {
        const parent = await queryOne(`SELECT id FROM categories WHERE id = $1::uuid`, [parentId])
        if (!parent) return { result: null, error: 'Parent category not found' }
      }
      const dup = await queryOne<{ id: string }>(`SELECT id FROM categories WHERE slug = $1 LIMIT 1`, [slug])
      if (dup) return { result: null, error: `Category slug "${slug}" already exists` }
      const created = await queryOne(
        `INSERT INTO categories (name, slug, parent_category_id, is_active, display_order)
         VALUES ($1, $2, $3::uuid, TRUE, 0)
         RETURNING id::text, name, slug, parent_category_id::text AS parent_id, is_active`,
        [name, slug, parentId]
      )
      if (!created) return { result: null, error: 'Insert failed' }
      return { result: created, error: null }
    }

    case 'add_customer_note': {
      const { customerId, body } = action.payload as { customerId: string; body: string; isPrivate?: boolean }
      const text = String(body || '').trim()
      if (!customerId || !text) return { result: null, error: 'customerId and body required' }
      if (text.length > 2000) return { result: null, error: 'body too long (max 2000 chars)' }
      await query(`INSERT INTO customer_notes (user_id, body, admin_id) VALUES ($1::uuid, $2, $3::uuid)`,
        [customerId, text, action.admin_id])
      await logActivity({ userId: customerId, actorId: action.admin_id, kind: 'note_added',
        summary: text.length > 120 ? text.slice(0, 120) + '…' : text }).catch(() => {})
      return { result: { customerId, length: text.length }, error: null }
    }
    case 'add_customer_tag': {
      const { customerId, tagSlug } = action.payload as { customerId: string; tagSlug: string }
      const slug = String(tagSlug || '').trim().toLowerCase()
      if (!customerId || !slug) return { result: null, error: 'customerId and tagSlug required' }
      await query(`INSERT INTO customer_tags (user_id, tag, created_by) VALUES ($1::uuid, $2, $3::uuid)
        ON CONFLICT (user_id, tag) DO NOTHING`, [customerId, slug, action.admin_id])
      await logActivity({ userId: customerId, actorId: action.admin_id, kind: 'tag_added',
        summary: `Tag "${slug}" added`, metadata: { tag: slug, via: 'agent' } }).catch(() => {})
      return { result: { customerId, tag: slug }, error: null }
    }
    case 'remove_customer_tag': {
      const { customerId, tagSlug } = action.payload as { customerId: string; tagSlug: string }
      const slug = String(tagSlug || '').trim().toLowerCase()
      if (!customerId || !slug) return { result: null, error: 'customerId and tagSlug required' }
      const r = await query(`DELETE FROM customer_tags WHERE user_id = $1::uuid AND tag = $2`, [customerId, slug])
      await logActivity({ userId: customerId, actorId: action.admin_id, kind: 'tag_removed',
        summary: `Tag "${slug}" removed`, metadata: { tag: slug, via: 'agent' } }).catch(() => {})
      return { result: { customerId, tag: slug, removed: r.rowCount ?? 0 }, error: null }
    }
    case 'create_customer_task': {
      const { customerId, title, dueAt, assignedToAdminId, priority } = action.payload as {
        customerId: string; title: string; dueAt: string | null; assignedToAdminId: string | null; priority: string
      }
      const t = String(title || '').trim().slice(0, 255)
      if (!customerId || !t) return { result: null, error: 'customerId and title required' }
      const validPriorities = ['low', 'medium', 'high', 'urgent']
      const pr = validPriorities.includes(priority) ? priority : 'medium'
      const assignee = assignedToAdminId || action.admin_id
      const inserted = await queryOne<{ id: string }>(
        `INSERT INTO customer_tasks (user_id, created_by, assigned_to, title, due_date, priority)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6) RETURNING id::text`,
        [customerId, action.admin_id, assignee, t, dueAt || null, pr]
      )
      if (!inserted) return { result: null, error: 'Insert failed' }
      await logActivity({ userId: customerId, actorId: action.admin_id, kind: 'task_created',
        referenceId: inserted.id, referenceType: 'customer_tasks', summary: `Task created: ${t}`,
        metadata: { priority: pr, due_date: dueAt || null, via: 'agent' } }).catch(() => {})
      return { result: { taskId: inserted.id, customerId, title: t, priority: pr }, error: null }
    }
    case 'close_customer_task': {
      const { taskId, resolution } = action.payload as { taskId: string; resolution: string | null }
      if (!taskId) return { result: null, error: 'taskId required' }
      const task = await queryOne<{ id: string; user_id: string; title: string; status: string; description: string | null }>(
        `SELECT id::text, user_id::text, title, status, description FROM customer_tasks WHERE id = $1::uuid LIMIT 1`,
        [taskId]
      )
      if (!task) return { result: null, error: 'Task not found' }
      if (task.status === 'completed' || task.status === 'cancelled') return { result: null, error: `Task already ${task.status}` }
      const r = String(resolution || '').trim().slice(0, 500)
      const newDesc = r ? (task.description ? `${task.description}\n\n--- Resolution ---\n${r}` : `Resolution: ${r}`) : task.description
      await query(
        `UPDATE customer_tasks SET status = 'completed', completed_at = NOW(), completed_by = $1::uuid,
            description = $2, updated_at = NOW() WHERE id = $3::uuid`,
        [action.admin_id, newDesc, taskId]
      )
      await logActivity({ userId: task.user_id, actorId: action.admin_id, kind: 'task_completed',
        referenceId: taskId, referenceType: 'customer_tasks', summary: `Task completed: ${task.title}`,
        metadata: r ? { resolution: r, via: 'agent' } : { via: 'agent' } }).catch(() => {})
      return { result: { taskId, customerId: task.user_id, title: task.title }, error: null }
    }
    case 'toggle_marketing_opt_out': {
      const { customerId, optOut } = action.payload as { customerId: string; optOut: boolean }
      if (!customerId) return { result: null, error: 'customerId required' }
      const updated = await queryOne<{ id: string; email: string; marketing_opt_out: boolean }>(
        `UPDATE users SET marketing_opt_out = $1, updated_at = NOW() WHERE id = $2::uuid
         RETURNING id::text, email, marketing_opt_out`,
        [!!optOut, customerId]
      )
      if (!updated) return { result: null, error: 'Customer not found' }
      await logActivity({ userId: customerId, actorId: action.admin_id,
        kind: optOut ? 'marketing_opted_out' : 'marketing_opted_in',
        summary: optOut ? 'Marketing emails disabled' : 'Marketing emails enabled',
        metadata: { via: 'agent' } }).catch(() => {})
      return { result: updated, error: null }
    }
    case 'create_tag_definition': {
      const { slug, color } = action.payload as { slug: string; color: string }
      if (!slug) return { result: null, error: 'slug required' }
      const safeColor = String(color || 'accent').trim().slice(0, 20)
      const maxOrder = await queryOne<{ sort_order: number }>(
        `SELECT sort_order FROM customer_tag_definitions ORDER BY sort_order DESC LIMIT 1`
      )
      const nextOrder = (maxOrder?.sort_order ?? 0) + 10
      try {
        await query(`INSERT INTO customer_tag_definitions (tag, color, sort_order, created_by)
          VALUES ($1, $2, $3, $4::uuid)`, [slug, safeColor, nextOrder, action.admin_id])
      } catch (e: any) {
        if (e?.code === '23505') return { result: null, error: 'Tag already exists' }
        return { result: null, error: e?.message || 'Insert failed' }
      }
      return { result: { slug, color: safeColor, sort_order: nextOrder }, error: null }
    }

    case 'create_pickup_request': {
      const { orderIds, pickupDate, orderCount } = action.payload as {
        orderIds: string[]; pickupDate: string; orderCount: number
      }
      if (!Array.isArray(orderIds) || orderIds.length === 0) return { result: null, error: 'orderIds missing' }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(pickupDate || ''))) return { result: null, error: 'invalid pickupDate' }
      const r = await callInternalApi(cookieHeader, 'POST', '/api/admin/delhivery/pickup-request', { orderIds, pickupDate })
      if (!r.ok) return { result: null, error: r.data?.error || `Delhivery pickup-request failed (HTTP ${r.status})` }
      return { result: { pickupId: r.data?.pickupId, pickupDate: r.data?.pickupDate, orderCount: r.data?.orderCount ?? orderCount, awbs: r.data?.awbs || [] }, error: null }
    }
    case 'sync_delhivery_statuses': {
      const cron = process.env.CRON_SECRET
      if (!cron) return { result: null, error: 'CRON_SECRET not configured' }
      const url = new URL('/api/admin/delhivery/sync-statuses', APPROVE_ORIGIN).toString()
      const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${cron}`, 'Content-Type': 'application/json' } })
      let data: any
      try { data = await res.json() } catch { data = null }
      if (!res.ok) return { result: null, error: data?.error || `Sync failed (HTTP ${res.status})` }
      return { result: { total: data?.total ?? 0, synced: data?.synced ?? 0, errors: data?.errors?.length ?? 0, rvpReceived: data?.rvp?.received ?? 0 }, error: null }
    }
    case 'pay_payable': {
      const { payableId, expenseNumber, supplierName, amount, paymentMode, paidAt, transactionRef } = action.payload as {
        payableId: string; expenseNumber: string; supplierName: string;
        amount: number; paymentMode: string; paidAt: string; transactionRef: string | null
      }
      if (!payableId || typeof amount !== 'number' || amount <= 0) return { result: null, error: 'invalid payableId/amount in payload' }
      const r = await callInternalApi(cookieHeader, 'POST', `/api/admin/financial/payables/${encodeURIComponent(payableId)}/pay`, {
        amount, payment_date: paidAt, payment_method: paymentMode, reference: transactionRef || null,
        notes: `Paid via admin agent (${expenseNumber} – ${supplierName})`,
      })
      if (!r.ok) return { result: null, error: r.data?.error || `Pay payable failed (HTTP ${r.status})` }
      return { result: { payableId, expenseNumber, supplierName, amount, paymentMode, paidAt,
        newStatus: r.data?.new_status, totalPaid: r.data?.total_paid }, error: null }
    }
    case 'export_gstr1': {
      const { month, from, to, format, rowCount } = action.payload as {
        month: string; from: string; to: string; format: 'json' | 'csv'; rowCount: number
      }
      if (!from || !to) return { result: null, error: 'from/to missing in payload' }
      const fmt = format === 'csv' ? 'csv' : 'json'
      const url = `/api/admin/gst/gstr1?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=${fmt}`
      const res = await fetch(new URL(url, APPROVE_ORIGIN).toString(), { method: 'GET', headers: { Cookie: cookieHeader } })
      if (!res.ok) {
        let err: any = null
        try { err = await res.json() } catch {}
        return { result: null, error: err?.error || `GSTR-1 export failed (HTTP ${res.status})` }
      }
      if (fmt === 'csv') {
        const csv = await res.text()
        return { result: { month, format: 'csv', rowCount, filename: `GSTR1_${from}_to_${to}.csv`,
          contentType: 'text/csv', contentBase64: Buffer.from(csv, 'utf8').toString('base64'),
          sizeBytes: Buffer.byteLength(csv, 'utf8') }, error: null }
      }
      const data = await res.json()
      return { result: { month, format: 'json', rowCount, summary: data?.summary,
        b2bCount: data?.b2b?.length || 0, b2cCount: data?.b2c?.length || 0, hsnSummary: data?.hsnSummary }, error: null }
    }

    default:
      return { result: null, error: `Unknown action kind: ${action.kind}` }
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const action = await queryOne<AgentAction>(
    `SELECT id::text, admin_id::text, conversation_id::text, kind, payload, status
     FROM admin_agent_actions WHERE id = $1::uuid LIMIT 1`,
    [params.id]
  )
  if (!action) return NextResponse.json({ error: 'Action not found' }, { status: 404 })
  if (action.admin_id !== admin.adminId) return NextResponse.json({ error: 'Not your action' }, { status: 403 })
  if (action.status !== 'proposed') {
    return NextResponse.json({ error: `Action already ${action.status}` }, { status: 400 })
  }

  await query(
    `UPDATE admin_agent_actions SET status = 'approved', decided_at = NOW(), decided_by_admin_id = $1
     WHERE id = $2::uuid`,
    [admin.adminId, params.id]
  )

  const cookieHeader = req.headers.get('cookie') || ''
  const { result, error } = await executeAction(action, cookieHeader)

  await query(
    `UPDATE admin_agent_actions
     SET status = $1, executed_at = NOW(), result = $2::jsonb, error = $3
     WHERE id = $4::uuid`,
    [error ? 'failed' : 'executed', JSON.stringify(result || {}), error, params.id]
  )

  if (error) return NextResponse.json({ ok: false, error, status: 'failed' }, { status: 500 })
  return NextResponse.json({ ok: true, result, status: 'executed' })
}
