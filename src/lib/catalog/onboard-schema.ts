import { z } from 'zod'

/**
 * Onboarding payload validation.
 *
 * Lives here rather than in the route because a Next route module may only export handlers,
 * and this schema decides whether a store can go live at all — it needs to be testable.
 */
export const OnboardSchema = z
  .object({
    // Step 0 — Plan
    planSlug: z.enum(['basic', 'growth', 'pro', 'enterprise']),
    billingInterval: z.enum(['monthly', 'yearly']).default('monthly'),
    // Step 1 — Store
    displayName: z.string().min(1).max(200),
    slug: z.string().min(3).max(63),
    productCategories: z.string().optional(),
    // Step 2 — Business
    // The owner's own name. Sign-in only supplies the name on their email account, which is not
    // necessarily what belongs on the admin access certificate.
    ownerName: z.string().trim().min(2, 'Enter your full name').max(200),
    businessName: z.string().min(1).max(200),
    businessType: z.enum(['proprietor', 'partnership', 'pvt_ltd', 'llp', 'other']),
    pan: z.string().min(10).max(10),
    businessAddress: z.string().min(5),
    // Step 3 — GST
    gstNumber: z.string().min(15).max(15),
    gstCertS3Key: z.string().optional(),
    // Step 4 — Warehouse (optional)
    dailyPayout: z.boolean().optional(),
    ownDelhivery: z.boolean().optional(),
    // Own-Delhivery token (only meaningful when ownDelhivery). Sent once to the submit route and
    // encrypted there — never round-trips the cleartext draft, like the Razorpay secret.
    delhiveryToken: z.string().optional(),
    warehouse: z
      .object({
        // 6 digits when given. A malformed pincode is worse than none: it reaches Razorpay and
        // Delhivery as if it were real.
        originPincode: z
          .string()
          .regex(/^\d{6}$/, 'Pincode must be 6 digits')
          .optional(),
        pickupLocation: z.string().optional(),
        sellerName: z.string().optional(),
        sellerAddress: z.string().optional(),
        sellerPhone: z.string().optional(),
      })
      .optional(),
    // Step 5 — Bank
    ownRazorpay: z.boolean().optional(),
    // Own-Razorpay creds (only meaningful when ownRazorpay). key_secret/webhook_secret are sent
    // once to the submit route and encrypted there — they never round-trip the cleartext draft.
    razorpayKeyId: z.string().optional(),
    razorpayKeySecret: z.string().optional(),
    razorpayWebhookSecret: z.string().optional(),
    // Restore-on-re-onboard — owner opted to restore a prior deprovisioned store's data.
    restorePreviousData: z.boolean().optional(),
    // Step 6 — Branding & legals
    mobile: z.string().optional(),
    logoS3Key: z.string().optional(),
    sealS3Key: z.string().optional(),
    legalsAccepted: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    // A store cannot go live without a pincode we can give Razorpay and Delhivery.
    //
    // Both fields were loose enough to let a store through with neither: businessAddress only
    // had min(5), so "fgugcijhvb" passed, and originPincode was optional with no format check.
    // Razorpay then rejected the linked account with "The postal code must be an integer", which
    // aborted the stakeholder and settlement bank too — the store went live unable to be paid.
    // Failing here, against the field the owner can actually fix, beats failing at Razorpay.
    const fromWarehouse = d.warehouse?.originPincode
    const fromAddress = d.businessAddress.match(/\b(\d{6})\b/)?.[1]
    if (!fromWarehouse && !fromAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['warehouse', 'originPincode'],
        message: 'A 6-digit pincode is required — add it here or include it in the business address',
      })
    }

    // Collecting on your own Razorpay account needs the keys to collect with.
    if (d.ownRazorpay && (!d.razorpayKeyId?.trim() || !d.razorpayKeySecret?.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['razorpayKeySecret'],
        message: 'Razorpay Key ID and Key Secret are required to collect on your own account',
      })
    }

    // Shipping on your own Delhivery account needs the token to sign shipment calls with.
    if (d.ownDelhivery && !d.delhiveryToken?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['delhiveryToken'],
        message: 'A Delhivery API token is required to ship on your own account',
      })
    }
  })
