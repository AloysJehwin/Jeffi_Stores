import { z } from 'zod'
import { ComputeSpecSchema } from '@controller/lib/compute/schema'
import { ADDON_IDS } from '@/lib/billing/addons'
import { ContactSchema } from '@controller/lib/domains/contact'
import { STORE_SOCIAL_LABELS, STORE_SOCIAL_NETWORKS, socialUrl, whatsappDigits, type StoreSocialNetwork } from '@/lib/catalog/store-socials'
import { categoryList, complianceProblem } from '@controller/lib/catalog/compliance'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?\d{8,15}$/

/**
 * Onboarding payload validation.
 *
 * Lives here rather than in the route because a Next route module may only export handlers,
 * and this schema decides whether a store can go live at all — it needs to be testable.
 */
export const OnboardSchema = z
  .object({
    // Plan
    planSlug: z.enum(['basic', 'growth', 'pro', 'enterprise']),
    billingInterval: z.enum(['monthly', 'yearly']).default('monthly'),
    // Server size, when owners choose it (COMPUTE_SPEC_ENABLED); otherwise the plan's default applies later.
    compute: ComputeSpecSchema.optional(),
    extraServices: z.array(z.enum(['messaging', 'documents'])).default([]),
    // Add-ons to switch on from the wallet once the store is live (lib/billing/requested-addons.ts).
    addons: z.array(z.enum(ADDON_IDS)).max(ADDON_IDS.length).default([]),
    // Store
    displayName: z.string().min(1).max(200),
    slug: z.string().min(3).max(63),
    productCategories: z.string().optional(),
    // What the generated site shows (tenant_kyc.store_profile → site_settings at provisioning).
    tagline: z.string().trim().max(120).optional(),
    about: z.string().trim().max(600).optional(),
    contact: z
      .object({
        phone: z.string().trim().max(20).optional(),
        whatsapp: z.string().trim().max(40).optional(),
        email: z.string().trim().max(200).optional(),
        address: z.string().trim().max(300).optional(),
        city: z.string().trim().max(80).optional(),
        state: z.string().trim().max(80).optional(),
        pincode: z.string().trim().max(10).optional(),
      })
      .optional(),
    socials: z.record(z.string(), z.string().max(300)).optional(),
    // Licences & certificates (lib/catalog/compliance.ts): the answers, and each required document's upload.
    compliance: z
      .object({
        answers: z.record(z.string(), z.boolean()).default({}),
        docs: z
          .record(
            z.string(),
            z.object({
              s3Key: z.string().min(1).max(512),
              fileName: z.string().max(255).optional(),
              number: z.string().trim().max(64).optional(),
              expiresOn: z.string().max(10).optional(),
            })
          )
          .default({}),
      })
      .optional(),
    // Business
    // The owner's own name. Sign-in only supplies the name on their email account, which is not
    // necessarily what belongs on the admin access certificate.
    ownerName: z.string().trim().min(2, 'Enter your full name').max(200),
    businessName: z.string().min(1).max(200),
    businessType: z.enum(['proprietor', 'partnership', 'pvt_ltd', 'llp', 'other']),
    pan: z.string().min(10).max(10),
    businessAddress: z.string().min(5),
    // GST. Optional, as in the wizard: registration is not required below the turnover threshold.
    gstNumber: z
      .string()
      .trim()
      .default('')
      .refine(v => v === '' || v.length === 15, 'GSTIN must be 15 characters, or leave it blank'),
    gstCertS3Key: z.string().optional(),
    // Warehouse (optional)
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
    // Bank
    ownRazorpay: z.boolean().optional(),
    // Own-Razorpay creds (only meaningful when ownRazorpay). key_secret/webhook_secret are sent
    // once to the submit route and encrypted there — they never round-trip the cleartext draft.
    razorpayKeyId: z.string().optional(),
    razorpayKeySecret: z.string().optional(),
    razorpayWebhookSecret: z.string().optional(),
    // Restore-on-re-onboard — owner opted to restore a prior deprovisioned store's data.
    restorePreviousData: z.boolean().optional(),
    // What to bring back from the archive a deprovision kept for this owner.
    restore: z
      .object({ archiveId: z.string().uuid(), database: z.boolean(), media: z.boolean(), config: z.boolean() })
      .optional(),
    // Branding & legals (the logo is uploaded in the Store step)
    mobile: z.string().optional(),
    logoS3Key: z.string().optional(),
    sealS3Key: z.string().optional(),
    legalsAccepted: z.boolean().optional(),
    // A domain to buy from the wallet once the store is approved (lib/domains/orders.ts requestDomain).
    domain: z.object({ name: z.string().min(3).max(253), contact: ContactSchema }).optional(),
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

    // The store's contacts and social links go on its site as they are, so each must be usable.
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })
    const c = d.contact ?? {}
    if (c.email && !EMAIL.test(c.email)) issue(['contact', 'email'], 'Enter a valid email for your store')
    if (c.phone && !PHONE.test(c.phone.replace(/[\s-]/g, ''))) issue(['contact', 'phone'], 'Enter a valid phone number for your store')
    if (c.whatsapp && whatsappDigits(c.whatsapp) === null) issue(['contact', 'whatsapp'], 'Enter a valid WhatsApp number')
    if (c.pincode && !/^\d{6}$/.test(c.pincode)) issue(['contact', 'pincode'], 'The PIN code must be 6 digits')
    for (const [network, value] of Object.entries(d.socials ?? {})) {
      if (!(STORE_SOCIAL_NETWORKS as readonly string[]).includes(network)) issue(['socials', network], 'Unknown social network')
      else if (socialUrl(network as StoreSocialNetwork, value) === null)
        issue(['socials', network], `Enter your ${STORE_SOCIAL_LABELS[network as StoreSocialNetwork]} profile link or handle`)
    }

    // Licences: checked again here against the categories (the wizard checks as the owner types).
    const licences = complianceProblem(categoryList(d.productCategories), d.compliance ?? { answers: {}, docs: {} })
    if (licences) issue(['compliance'], `Licences & certificates: ${licences}`)
  })
