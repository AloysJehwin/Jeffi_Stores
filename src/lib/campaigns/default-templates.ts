// Default subject + HTML body for each built-in scenario, used when seeding a campaign row. Same inline-
// styled visual language as the existing stored templates. Product scenarios use {itemsHtml} (gallery with
// thumbnails) or {productCard} (single hero card); incentive scenarios include a coupon box around
// {couponCode}. renderTemplate() does a plain {var} replace — unknown/empty vars collapse to '', so an
// unattached coupon just leaves an empty box (same behaviour as the winback templates).

const greeting = `<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p>`
const h2 = (t: string) => `<h2 style="font-size:22px;color:#1a3a4a;margin:0 0 12px;">${t}</h2>`
const p = (t: string) => `<p style="color:#555;line-height:1.6;margin:0 0 12px;">${t}</p>`
const couponBox = `<p style="background:#fff7ed;border:1px dashed #e07b3f;border-radius:6px;padding:14px 20px;text-align:center;margin:0 0 16px;font-family:ui-monospace,monospace;font-size:18px;color:#1a3a4a;font-weight:700;letter-spacing:1px;">{couponCode}</p>`
const cta = (label: string) =>
  `<p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">${label}</a></p>`

export interface BuiltinTemplate {
  subject: string
  body: string
}

export const BUILTIN_TEMPLATES: Record<string, BuiltinTemplate> = {
  viewed_product: {
    subject: 'Still thinking about it, {firstName}?',
    body: greeting + h2('Still thinking it over?') + p('You were looking at this recently. Here it is again.') + '{itemsHtml}' + cta('Take another look'),
  },
  viewed_category: {
    subject: 'Picks from what you were browsing, {firstName}',
    body: greeting + h2('More from what caught your eye') + p('You browsed a few of these. A closer look might help you decide.') + '{itemsHtml}' + cta('Keep browsing'),
  },
  high_value_cart: {
    subject: 'Your cart is waiting, {firstName}',
    body: greeting + h2('You left {itemCount} item(s) behind') + p('We saved your cart for you — complete your order before anything sells out.') + '{itemsHtml}' + couponBox + cta('Complete your order'),
  },
  cart_price_drop: {
    subject: 'Good news — a price drop in your cart',
    body: greeting + h2('The price just dropped') + p('Something in your cart is now cheaper than when you added it.') + '{itemsHtml}' + cta('Check out now'),
  },
  wishlist_reminder: {
    subject: 'Still on your wishlist, {firstName}',
    body: greeting + h2('Your wishlist is waiting') + p('These are still available. Grab them before they go.') + '{itemsHtml}' + cta('View your wishlist'),
  },
  replenishment: {
    subject: 'Time to reorder, {firstName}?',
    body: greeting + h2('Running low?') + p('If you are getting close to the end, now is a good time to restock.') + '{itemsHtml}' + cta('Reorder now'),
  },
  subscription_renewal: {
    subject: 'Your subscription renews soon, {firstName}',
    body: greeting + h2('A heads-up on your subscription') + p('Your subscription is coming up for renewal. No action needed unless you want to make a change.') + '{itemsHtml}' + cta('Manage subscription'),
  },
  back_in_stock_wishlist: {
    subject: '{productName} is back in stock!',
    body: greeting + h2('Back in stock') + p('{productName} from your wishlist is available again. It may not last long.') + '{productCard}' + cta('Shop it now'),
  },
  review_photo_followup: {
    subject: 'Add a photo to your review, {firstName}',
    body: greeting + h2('Help other shoppers') + p('Thanks for reviewing {productName}. A quick photo makes your review far more helpful.') + '{productCard}' + cta('Add a photo'),
  },
  first_purchase_nudge: {
    subject: 'A little something to get you started, {firstName}',
    body: greeting + h2('Welcome — here is a treat') + p('You signed up but have not placed your first order yet. Here is {discountPercent}% off to get you going.') + couponBox + cta('Start shopping'),
  },
  second_purchase_nudge: {
    subject: 'Come back for more, {firstName}',
    body: greeting + h2('We hope you loved your first order') + p('Here is a little something for your next one.') + couponBox + cta('Shop again'),
  },
  signup_anniversary: {
    subject: 'Happy anniversary with us, {firstName}!',
    body: greeting + h2('It has been a year (or more)') + p('Thanks for being with us. Here is a token of our appreciation.') + couponBox + cta('Treat yourself'),
  },
  birthday: {
    subject: 'Happy birthday, {firstName}!',
    body: greeting + h2('Happy birthday from all of us') + p('Celebrate with a little gift from us — {discountPercent}% off your next order.') + couponBox + cta('Claim your gift'),
  },
  referral_invite: {
    subject: 'Share the love, {firstName} — you both save',
    body: greeting + h2('Refer a friend') + p('Invite a friend and you both get a reward on your next order.') + couponBox + cta('Refer a friend'),
  },
  loyalty_tier_upgrade: {
    subject: 'You reached {tier}, {firstName}!',
    body: greeting + h2('Welcome to {tier}') + p('You now have {points} points. Enjoy your new perks — starting with this.') + couponBox + cta('See your perks'),
  },
}

export function getBuiltinTemplate(kind: string): BuiltinTemplate | null {
  return BUILTIN_TEMPLATES[kind] ?? null
}
