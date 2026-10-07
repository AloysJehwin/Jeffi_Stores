// Default subject + HTML body for each built-in scenario, used when seeding a campaign row. Same inline-
// styled visual language as the existing stored templates. Product scenarios use {itemsHtml} (gallery with
// thumbnails) or {productCard} (single hero card); incentive scenarios include a coupon box around
// {couponCode}. Coupon and discount copy sits in {#if couponCode} / {#if discountPercent} blocks, so a
// campaign without a coupon (or with 0%) mails neither an empty box nor "0% off".

const greeting = `<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p>`
const h2 = (t: string) => `<h2 style="font-size:22px;color:#1a3a4a;margin:0 0 12px;">${t}</h2>`
const p = (t: string) => `<p style="color:#555;line-height:1.6;margin:0 0 12px;">${t}</p>`
const legacyCouponBox = `<p style="background:#fff7ed;border:1px dashed #e07b3f;border-radius:6px;padding:14px 20px;text-align:center;margin:0 0 16px;font-family:ui-monospace,monospace;font-size:18px;color:#1a3a4a;font-weight:700;letter-spacing:1px;">{couponCode}</p>`
const couponBox = `{#if couponCode}${legacyCouponBox}{/if}`
// Same look as the coupon box, for templates that hand out a link instead of a code.
const linkBox = `<p style="background:#fff7ed;border:1px dashed #e07b3f;border-radius:6px;padding:14px 20px;text-align:center;margin:0 0 16px;font-family:ui-monospace,monospace;font-size:15px;color:#1a3a4a;font-weight:700;word-break:break-all;">{shareUrl}</p>`
const cta = (label: string) =>
  `<p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">${label}</a></p>`

export interface BuiltinTemplate {
  subject: string
  body: string
}

export const BUILTIN_TEMPLATES: Record<string, BuiltinTemplate> = {
  viewed_product: {
    subject: 'Still thinking about it, {firstName}?',
    body:
      greeting +
      h2('Still thinking it over?') +
      p('You were looking at this recently. Here it is again.') +
      '{itemsHtml}' +
      cta('Take another look'),
  },
  viewed_category: {
    subject: 'Picks from what you were browsing, {firstName}',
    body:
      greeting +
      h2('More from what caught your eye') +
      p('You browsed a few of these. A closer look might help you decide.') +
      '{itemsHtml}' +
      cta('Keep browsing'),
  },
  high_value_cart: {
    subject: 'Your cart is waiting, {firstName}',
    body:
      greeting +
      h2('You left {itemCount} item(s) behind') +
      p('We saved your cart for you — complete your order before anything sells out.') +
      '{itemsHtml}' +
      couponBox +
      cta('Complete your order'),
  },
  cart_price_drop: {
    subject: 'Good news — a price drop in your cart',
    body:
      greeting +
      h2('The price just dropped') +
      p('Something in your cart is now cheaper than when you added it.') +
      '{itemsHtml}' +
      cta('Check out now'),
  },
  wishlist_reminder: {
    subject: 'Still on your wishlist, {firstName}',
    body:
      greeting +
      h2('Your wishlist is waiting') +
      p('These are still available. Grab them before they go.') +
      '{itemsHtml}' +
      cta('View your wishlist'),
  },
  replenishment: {
    subject: 'Time to reorder, {firstName}?',
    body:
      greeting +
      h2('Running low?') +
      p('If you are getting close to the end, now is a good time to restock.') +
      '{itemsHtml}' +
      cta('Reorder now'),
  },
  subscription_renewal: {
    subject: 'Your subscription renews soon, {firstName}',
    body:
      greeting +
      h2('A heads-up on your subscription') +
      p('Your subscription is coming up for renewal. No action needed unless you want to make a change.') +
      '{itemsHtml}' +
      cta('Manage subscription'),
  },
  back_in_stock_wishlist: {
    subject: '{productName} is back in stock!',
    body:
      greeting +
      h2('Back in stock') +
      p('{productName} from your wishlist is available again. It may not last long.') +
      '{productCard}' +
      cta('Shop it now'),
  },
  review_photo_followup: {
    subject: 'Add a photo to your review, {firstName}',
    body:
      greeting +
      h2('Help other shoppers') +
      p('Thanks for reviewing {productName}. A quick photo makes your review far more helpful.') +
      '{productCard}' +
      cta('Add a photo'),
  },
  first_purchase_nudge: {
    subject: 'A little something to get you started, {firstName}',
    body:
      greeting +
      h2('Welcome — here is a treat') +
      p(
        'You signed up but have not placed your first order yet.{#if discountPercent} Here is {discountPercent}% off to get you going.{/if}'
      ) +
      couponBox +
      cta('Start shopping'),
  },
  second_purchase_nudge: {
    subject: 'Come back for more, {firstName}',
    body:
      greeting +
      h2('We hope you loved your first order') +
      `{#if couponCode}${p('Here is a little something for your next one.')}{/if}` +
      couponBox +
      cta('Shop again'),
  },
  signup_anniversary: {
    subject: 'Happy anniversary with us, {firstName}!',
    body:
      greeting +
      h2('It has been a year (or more)') +
      p('Thanks for being with us.{#if couponCode} Here is a token of our appreciation.{/if}') +
      couponBox +
      cta('Treat yourself'),
  },
  birthday: {
    subject: 'Happy birthday, {firstName}!',
    body:
      greeting +
      h2('Happy birthday from all of us') +
      p(
        'We hope your day is a great one.{#if discountPercent} Celebrate with a little gift from us — {discountPercent}% off your next order.{/if}'
      ) +
      couponBox +
      cta('Claim your gift'),
  },
  birthday_collect: {
    subject: "When's your birthday, {firstName}?",
    body:
      greeting +
      h2('Let us celebrate with you') +
      p('Tell us your birthday and we will send you a treat every year. It takes one tap, and no sign-in is needed.') +
      cta('Add my birthday'),
  },
  referral_invite: {
    subject: 'Refer a friend, earn {rewardPoints} points',
    body:
      greeting +
      h2('Know someone who would love us?') +
      p(
        'Share your personal link. When a friend signs up with it and their first order is delivered, you get {rewardPoints} points.'
      ) +
      linkBox +
      cta('Share your link'),
  },
  loyalty_tier_upgrade: {
    subject: 'You reached {tier}, {firstName}!',
    body:
      greeting +
      h2('Welcome to {tier}') +
      p('You now have {points} points. Enjoy your new perks{#if couponCode} — starting with this{/if}.') +
      couponBox +
      cta('See your perks'),
  },
  loyalty_points_reminder: {
    subject: 'You have {points} points waiting, {firstName}',
    body:
      greeting +
      h2('Your points are ready to spend') +
      p('You have {points} points — turn them into a coupon worth up to ₹{pointsWorth} off your next order.') +
      cta('Redeem your points'),
  },
}

// Defaults that shipped earlier and were later replaced. A stored campaign whose subject and body still
// match one of these exactly was never edited, so it is safe to move it onto the current default.
export const RETIRED_BUILTIN_TEMPLATES: Record<string, BuiltinTemplate[]> = {
  // Rendered an empty coupon box and "0% off" copy when the campaign had no coupon.
  high_value_cart: [
    {
      subject: 'Your cart is waiting, {firstName}',
      body:
        greeting +
        h2('You left {itemCount} item(s) behind') +
        p('We saved your cart for you — complete your order before anything sells out.') +
        '{itemsHtml}' +
        legacyCouponBox +
        cta('Complete your order'),
    },
  ],
  first_purchase_nudge: [
    {
      subject: 'A little something to get you started, {firstName}',
      body:
        greeting +
        h2('Welcome — here is a treat') +
        p('You signed up but have not placed your first order yet. Here is {discountPercent}% off to get you going.') +
        legacyCouponBox +
        cta('Start shopping'),
    },
  ],
  second_purchase_nudge: [
    {
      subject: 'Come back for more, {firstName}',
      body:
        greeting +
        h2('We hope you loved your first order') +
        p('Here is a little something for your next one.') +
        legacyCouponBox +
        cta('Shop again'),
    },
  ],
  signup_anniversary: [
    {
      subject: 'Happy anniversary with us, {firstName}!',
      body:
        greeting +
        h2('It has been a year (or more)') +
        p('Thanks for being with us. Here is a token of our appreciation.') +
        legacyCouponBox +
        cta('Treat yourself'),
    },
  ],
  birthday: [
    {
      subject: 'Happy birthday, {firstName}!',
      body:
        greeting +
        h2('Happy birthday from all of us') +
        p('Celebrate with a little gift from us — {discountPercent}% off your next order.') +
        legacyCouponBox +
        cta('Claim your gift'),
    },
  ],
  loyalty_tier_upgrade: [
    {
      subject: 'You reached {tier}, {firstName}!',
      body:
        greeting +
        h2('Welcome to {tier}') +
        p('You now have {points} points. Enjoy your new perks — starting with this.') +
        legacyCouponBox +
        cta('See your perks'),
    },
  ],
  // Promised a coupon "you both" get; the referral program pays the referrer in points instead.
  referral_invite: [
    {
      subject: 'Share the love, {firstName} — you both save',
      body:
        greeting +
        h2('Refer a friend') +
        p('Invite a friend and you both get a reward on your next order.') +
        legacyCouponBox +
        cta('Refer a friend'),
    },
  ],
  // Showed an empty coupon box (the points are the reward) and dropped the rupee sign.
  loyalty_points_reminder: [
    {
      subject: 'You have {points} points waiting, {firstName}',
      body:
        greeting +
        h2('Your points are ready to spend') +
        p('You have {points} points — turn them into a coupon worth up to {pointsWorth} off your next order.') +
        legacyCouponBox +
        cta('Redeem your points'),
    },
  ],
}

// Discount for campaigns whose default template shows a coupon. Used when a campaign has no
// discount_percent of its own, so a coupon is auto-created instead of mailing an empty box.
export const DEFAULT_COUPON_DISCOUNT: Record<string, number> = {
  first_purchase_nudge: 10,
  second_purchase_nudge: 10,
  birthday: 15,
  signup_anniversary: 10,
  loyalty_tier_upgrade: 10,
  high_value_cart: 5,
  winback_90: 10,
  winback_180: 15,
}

export function getBuiltinTemplate(kind: string): BuiltinTemplate | null {
  return BUILTIN_TEMPLATES[kind] ?? null
}
