import 'server-only'
import { queryOne } from '@/lib/shared/db'
import {
  sendAuditedMail,
  mailShell,
  customerMailFromAsync,
  currentBrandNameAsync,
  storeContactLine,
  storeAddressLine,
  storeBaseUrlAsync,
  escapeHtml,
} from './shared'

// Transactional: it reports a change to the customer's own points balance, so like an order-status
// email it is not subject to the marketing opt-out.
export async function sendReferralRewardEmail(userId: string, points: number) {
  const user = await queryOne<{ email: string; first_name: string | null }>(
    `SELECT email, first_name FROM users WHERE id = $1 AND is_active = TRUE AND is_guest = FALSE`,
    [userId]
  )
  if (!user?.email) return { success: false, error: 'no_recipient' }

  const [baseUrl, contactLine, from, brand, address] = await Promise.all([
    storeBaseUrlAsync(),
    storeContactLine(),
    customerMailFromAsync(),
    currentBrandNameAsync(),
    storeAddressLine(),
  ])
  const name = escapeHtml(user.first_name || 'there')
  const pts = points.toLocaleString('en-IN')
  const subject = `You earned ${pts} points for referring a friend`
  const html = mailShell({
    brand,
    kicker: 'Referral reward',
    title: `You earned ${pts} points`,
    preheader: `Your friend's first order arrived. ${pts} points are in your account.`,
    content: `
      <p>Hello ${name},</p>
      <p>A friend you invited to ${escapeHtml(brand)} just received their first order, so we have added
      <strong>${pts} points</strong> to your rewards.</p>
      <p>Keep sharing your link to earn more.</p>

      <div class="cta">
        <a href="${baseUrl}/account/referrals" class="button" style="color:#ffffff;">
          See your referrals
        </a>
      </div>
    `,
    footerLines: [address, contactLine],
  })

  try {
    const info = await sendAuditedMail({
      from,
      to: user.email,
      subject,
      html,
      kind: 'referral_reward',
      templateName: 'referral_reward',
      userId,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}
