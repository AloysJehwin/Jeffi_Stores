import * as React from 'react'
import { z } from 'zod'
import { defineCodeComponent } from '../registry'
import { AddressFormPart, ContactFormPart, DeliveryOptionsPart, OrderSummaryPart, PaymentStepPart } from '@/components/visitor/site/code/parts/checkout/parts'
import TrustBadges, { DEFAULT_TRUST_BADGES, TRUST_ICONS, type TrustIcon } from '@/components/visitor/site/code/parts/checkout/TrustBadges'
import { previewLines } from '@/components/visitor/site/code/parts/cart/demo'
import { cls, settings } from './cart'

// The checkout page's parts (Part C), over the page's one checkout state (mounted by the storefront checkout page).
// Validation, address and delivery rules, the coupon, totals and the Razorpay / UPI / COD flow are the store's own and
// unchanged; the design only places them. PaymentStep is the one part that pays: locked, no settings, once per page.

const reactCache = (React as unknown as { cache?: <F extends (...a: never[]) => unknown>(fn: F) => F }).cache
const paymentSlot = typeof reactCache === 'function' ? reactCache((): { used: boolean } => ({ used: false })) : null

/** The first PaymentStep on a page renders; a second one in the same request renders nothing. */
function claimPaymentStep(): boolean {
  let slot: { used: boolean } | null = null
  try {
    slot = paymentSlot?.() ?? null
  } catch {
    slot = null
  }
  if (!slot) return true
  if (slot.used) return false
  slot.used = true
  return true
}

defineCodeComponent({
  name: 'ContactForm',
  pages: ['checkout'],
  props: z.object({}),
  describe: "The shopper's contact details for the order (name, email, phone), read-only, with Change back to the review step.",
  render: async (props, ctx) => <ContactFormPart className={cls(props.className)} demo={(await previewLines(ctx.data)).length > 0} />,
})

defineCodeComponent({
  name: 'AddressForm',
  pages: ['checkout'],
  props: z.object({}),
  describe: 'The delivery address chosen on the review step, with a Change link; includes its own "Delivery Address" heading.',
  render: async (props, ctx) => <AddressFormPart className={cls(props.className)} demo={(await previewLines(ctx.data)).length > 0} />,
})

const DeliveryOptionsProps = z.object({ notes: z.boolean().default(true).describe('include the order notes field') })

defineCodeComponent({
  name: 'DeliveryOptions',
  pages: ['checkout'],
  props: DeliveryOptionsProps,
  describe: "Delivery for the chosen address (the store's rate, free or paid, and any COD fee), then the order notes field.",
  render: async (props, ctx) => {
    const s = settings(DeliveryOptionsProps, props)
    return <DeliveryOptionsPart notes={s.notes} className={cls(props.className)} demo={(await previewLines(ctx.data)).length > 0} />
  },
})

const OrderSummaryProps = z.object({ items: z.boolean().default(true).describe('list the items above the totals') })

defineCodeComponent({
  name: 'OrderSummary',
  pages: ['checkout'],
  props: OrderSummaryProps,
  describe: 'The items being bought and the totals (subtotal, GST, coupon, delivery, COD fee, total); style the box around it.',
  render: async (props, ctx) => {
    const s = settings(OrderSummaryProps, props)
    return <OrderSummaryPart items={s.items} className={cls(props.className)} demo={await previewLines(ctx.data)} />
  },
})

const TrustBadgesProps = z.object({
  items: z
    .array(
      z.object({
        icon: z.enum(Object.keys(TRUST_ICONS) as [TrustIcon, ...TrustIcon[]]),
        title: z.string().trim().min(1).max(40),
        text: z.string().trim().max(60).optional(),
      })
    )
    .min(1)
    .max(6)
    .optional()
    .describe('default: secure checkout, easy returns, genuine products, support'),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(2),
})

defineCodeComponent({
  name: 'TrustBadges',
  pages: ['checkout', 'cart'],
  props: TrustBadgesProps,
  describe: 'Reassurance badges (icon, title, line); the store\'s four by default.',
  render: props => {
    const s = settings(TrustBadgesProps, props)
    return <TrustBadges items={s.items ?? DEFAULT_TRUST_BADGES} columns={s.columns} className={cls(props.className)} />
  },
})

defineCodeComponent({
  name: 'PaymentStep',
  pages: ['checkout'],
  required: ['checkout'],
  props: z.object({}).strict(),
  describe: "LOCKED, exactly once: the store's payment choices, the place-order / pay button and the payment flow. No props; place it, don't restyle it.",
  render: async (_props, ctx) => (claimPaymentStep() ? <PaymentStepPart demo={await previewLines(ctx.data)} /> : null),
})
