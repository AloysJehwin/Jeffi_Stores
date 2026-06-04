import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { transporter } from '@/lib/email'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { scopeKey, scopeLabel, pagePath } = body

    if (!scopeKey || !pagePath) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const superAdmins = await queryMany<{ email: string; first_name: string | null }>(
      `SELECT u.email, u.first_name
       FROM admins a
       JOIN users u ON u.id = a.user_id
       WHERE a.role = 'super_admin' AND a.is_active = TRUE AND u.email IS NOT NULL`,
      []
    )

    if (superAdmins.length === 0) {
      return NextResponse.json({ ok: true })
    }

    const requesterName = admin.first_name && admin.last_name
      ? `${admin.first_name} ${admin.last_name}`
      : admin.username
    const toEmails = superAdmins.map(r => r.email).join(', ')

    await transporter.sendMail({
      from: `"Jeffi Admin" <${process.env.SES_ADMIN_FROM_EMAIL || process.env.SES_FROM_EMAIL}>`,
      to: toEmails,
      subject: `Access Request: ${requesterName} needs "${scopeLabel || scopeKey}" scope`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><style>
          body { font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .card { background: #f9f9f9; border-radius: 8px; padding: 24px; border: 1px solid #e0e0e0; }
          .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
          .value { font-size: 15px; font-weight: 600; margin-bottom: 16px; }
          .badge { display: inline-block; background: #fef3c7; color: #92400e; padding: 2px 10px; border-radius: 9999px; font-size: 13px; font-weight: 600; }
          .footer { font-size: 11px; color: #aaa; margin-top: 24px; }
        </style></head>
        <body>
          <div class="card">
            <h2 style="margin:0 0 20px;font-size:18px;">Scope Access Request</h2>
            <div class="label">Requested by</div>
            <div class="value">${requesterName} <span style="font-weight:400;color:#888;">(${admin.username})</span></div>
            <div class="label">Requires scope</div>
            <div class="value"><span class="badge">${scopeLabel || scopeKey}</span></div>
            <div class="label">Attempted page</div>
            <div class="value" style="font-family:monospace;font-size:13px;">${pagePath}</div>
            <p style="margin-top:16px;font-size:14px;">To grant access, go to <strong>Team Members</strong> in the admin panel and edit this admin's permissions.</p>
          </div>
          <div class="footer">This is an automated notification from Jeffi Stores admin panel.</div>
        </body>
        </html>
      `,
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
