export type Section = { heading: string; body: string | string[] }

export type Policy = {
  slug: string
  title: string
  description: string
  lastUpdated: string
  sections: Section[]
}

// Bump this version (and the lastUpdated date on relevant policies) whenever
// the privacy policy or T&C changes in a way that requires re-acceptance.
// Users whose users.policies_accepted_version != POLICY_VERSION will be asked
// to re-accept on next sign-in or first page load.
export const POLICY_VERSION = '2026-06-23'

// Slugs whose acceptance is gated by POLICY_VERSION.
export const CONSENT_POLICIES = ['privacy-policy', 'terms-and-conditions'] as const

export const policies: Policy[] = [
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    description: 'What we collect, why we collect it, how long we keep it, and your rights over your data.',
    lastUpdated: '14 Jun 2026',
    sections: [
      {
        heading: '1. The short version',
        body: [
          'We collect what we need to run your account, fulfil your orders, file GST, and keep our platform secure — nothing more.',
          'We do not sell your data. Ever.',
          'Third parties only see what they need to do their job (Razorpay sees payment context; Delhivery sees the shipping label; AWS hosts the data; Google sign-in sees your email if you choose it).',
          'You can ask us to export, correct, or delete your data anytime by writing to support@jeffistores.in.',
        ],
      },
      {
        heading: '2. Who we are',
        body: 'Jeffi Stores is operated from Raipur, Chhattisgarh, India. When this policy says "we", "us", or "Jeffi Stores", we mean the entity running jeffistores.in (and the business.jeffistores.in / admin.jeffistores.in subdomains). The data controller is Jeffi Stores; the GSTIN, registered address and grievance officer details are listed in the Grievance Redressal page.',
      },
      {
        heading: '3. Information you give us directly',
        body: [
          'Account: name, email, phone (mobile OTP is the primary auth), avatar (optional), and password if you set one.',
          'For business accounts: company name, GSTIN, business address, industry, and the contact person.',
          'Orders: shipping and billing addresses (with PIN code), GSTIN if you want a tax invoice, and any notes you add to the order.',
          'Support: anything you type in the chatbox, send by email, or share on a phone call (which we do not record by default).',
          'Reviews: the rating, photos, and text you submit alongside a review form.',
        ],
      },
      {
        heading: '4. Information we collect automatically',
        body: [
          'Cart and browsing: products you view, items in your cart, search queries, and category filters — used to keep your session, recover an abandoned cart, and personalise recommendations.',
          'Device and connection: IP address, user-agent, approximate location (city-level), referrer, and the time of each visit — used for security and fraud detection.',
          'Cookies and similar: a session cookie for sign-in, a session id cookie for guest carts, and a theme preference. We do not run advertising trackers.',
          'Analytics: aggregated page views, conversion events, and click events via Google Analytics 4 / Google Tag Manager. We do not use Analytics for cross-site advertising.',
          'AI assistant: the prompt you type, the products our model retrieves to answer it, and a thumbs-up / thumbs-down rating if you give one. We do not link these prompts to your name in our analytics dashboards.',
        ],
      },
      {
        heading: '5. Why we use it',
        body: [
          'To run your account: sign you in, persist your cart, send transactional emails (OTP, order, invoice, RFQ updates).',
          'To fulfil orders: print invoices and packing slips, generate Delhivery shipping labels, and track delivery status.',
          'To comply with Indian tax law: store invoice copies and GST data per the GST rules (typically 8 financial years).',
          'To prevent fraud and abuse: rate-limit suspicious sign-in attempts, flag risky payment patterns, log admin activity.',
          'To improve the product: aggregate, anonymised analytics. We never act on individual records here.',
          'To communicate, when you ask: order confirmations and shipping updates are mandatory. Marketing emails are opt-in (and there is an unsubscribe link in every email we send).',
          'To deliver business-customer features: discount tiers, RFQ negotiations, and credit-limit decisions for approved business accounts.',
        ],
      },
      {
        heading: '6. How long we keep it',
        body: [
          'Account profile: while your account is active, plus 30 days after you close it (a window for account-recovery requests).',
          'Order history and invoices: 8 financial years from the order date — required by GST law.',
          'Payment metadata (Razorpay reference IDs, last 4 of card): 18 months for chargeback handling.',
          'Failed sign-in logs: 90 days, then aggregated and deleted.',
          'Anonymised analytics: indefinitely. These do not identify you.',
          'Backups: rolling 7-day window. Backups age out automatically.',
        ],
      },
      {
        heading: '7. Who we share it with',
        body: [
          'Razorpay (payments): order amount, your name, email, phone, and the order id. Razorpay is PCI-DSS Level 1 — they store your card data, not us.',
          'Delhivery (shipping): the recipient name, full shipping address, phone, and weight/dimensions of the package.',
          'Amazon Web Services (hosting): all of our application data sits in AWS RDS, S3, and EC2 in their us-east-1 region. AWS is bound by their Data Processing Addendum.',
          'Google (sign-in, Maps autocomplete, Analytics): your email and Google id when you choose Google sign-in; address autocomplete queries when you type in an address field.',
          'OpenAI / our self-hosted models (AI assistant): the prompt you type. We do not send your account email or phone to the model.',
          'SES (email): the recipient address and the email body. Standard email delivery.',
          'Tax authorities: invoice and GSTIN data when filing GSTR-1 / GSTR-3B / e-invoicing.',
          'Law enforcement: only when compelled by valid Indian legal process. We will tell you if we are required to share and the law lets us.',
        ],
      },
      {
        heading: '8. Where it is stored',
        body: 'Right now, in AWS US-East-1 (Northern Virginia). India does not currently require local hosting for ecommerce data, but we monitor the DPDP Act rules and will move to in-region hosting if and when required. Any cross-border transfer relies on the AWS Data Processing Addendum and the Indian Data Protection rules.',
      },
      {
        heading: '9. Your rights',
        body: [
          'Access — request a copy of your data.',
          'Correction — fix anything wrong in your profile or address book directly, or write to us for changes outside the UI.',
          'Deletion — close your account and ask us to delete data older than the legal retention windows above.',
          'Withdraw marketing consent — every marketing email has an unsubscribe link, and your account preferences page lets you opt out.',
          'Portability — get a JSON export of your orders and addresses.',
          'Complain — you can write to our grievance officer (see Grievance Redressal) or, in India, escalate to the relevant data protection regulator.',
        ],
      },
      {
        heading: '10. Cookies',
        body: 'We use only first-party functional cookies (session, cart, theme) plus Google Analytics. We do not run advertising or cross-site cookies. You can clear cookies in your browser; some features (sign-in, cart) will need to be re-set.',
      },
      {
        heading: '11. Children',
        body: 'The platform is intended for users aged 18 and above. We do not knowingly collect data from minors. If you believe a child has created an account, write to support@jeffistores.in and we will close it.',
      },
      {
        heading: '12. Updates to this policy',
        body: 'When we change this policy, we update the version and date at the top, and ask you to re-accept the next time you sign in or open the site. Material changes (new third-party data sharing, new categories of data we collect) will additionally be emailed to you.',
      },
      {
        heading: '13. Contact',
        body: 'Privacy questions: support@jeffistores.in. Grievance officer: see the Grievance Redressal policy. Postal: Jeffi Stores, Raipur, Chhattisgarh.',
      },
    ],
  },
  {
    slug: 'terms-and-conditions',
    title: 'Terms & Conditions',
    description: 'The rules of using Jeffi Stores — accounts, orders, payments, returns, and what we expect from each other.',
    lastUpdated: '23 Jun 2026',
    sections: [
      {
        heading: '1. Accepting these terms',
        body: 'By creating an account, placing an order, or otherwise using jeffistores.in (and our subdomains), you accept these terms and our Privacy Policy. If you do not agree, please do not use the platform.',
      },
      {
        heading: '2. Eligibility',
        body: [
          'You must be at least 18 years old.',
          'For business accounts you must be authorised to bind the business and provide a valid GSTIN.',
          'You must provide accurate name, address, phone, and email — fraudulent details may cause your order to be cancelled and your account suspended.',
        ],
      },
      {
        heading: '3. Your account',
        body: [
          'You are responsible for keeping your sign-in credentials safe. We use OTP-based sign-in by default to reduce password risk, but if you set a password, do not share it.',
          'Tell us immediately at support@jeffistores.in if you suspect unauthorised access.',
          'We may suspend or close accounts that violate these terms, attempt to abuse coupons or RFQ flows, or use the site to harm other users or our infrastructure.',
        ],
      },
      {
        heading: '4. Catalog, prices, and stock',
        body: [
          'All prices are in Indian Rupees and inclusive of GST unless stated otherwise.',
          'We try hard to keep stock and prices accurate, but the canonical record is the order confirmation. Where a price is shown that is obviously a system error (e.g. a 99% mismatch from MRP), we may decline the order and refund.',
          'Product images are illustrative. Industrial parts may vary slightly in finish or branding from photo to photo; the SKU and HSN code are the source of truth.',
        ],
      },
      {
        heading: '5. Orders, payments, and invoicing',
        body: [
          'An order placed online is an offer to buy. We accept the order when we dispatch it (or, for business credit orders, when we issue the invoice).',
          'We accept Razorpay (cards/UPI/netbanking), UPI QR, bank transfer, and approved-business credit terms.',
          'Tax invoices are emailed and available in your account. Provide a valid GSTIN at checkout if you want input tax credit on the invoice.',
          'For business RFQs: a quoted price is valid for the period stated on the quotation; after that we may revise it based on stock and input cost.',
        ],
      },
      {
        heading: '5a. Bank Offers & Cashback',
        body: [
          'We display bank-specific offers (cashback, instant discounts, no-cost EMI) on product pages as a convenience to you. These offers are sourced from Razorpay\'s partner banks and are subject to each bank\'s terms and conditions.',
          'Jeffi Stores does not guarantee the availability, accuracy, or continued validity of any bank offer shown. Offer eligibility (minimum purchase, card type, issuing bank) is determined solely by the respective bank.',
          'Cashback and instant discounts are applied by your bank at the time of transaction settlement — they do not reduce the amount you pay at checkout. Jeffi Stores is not a party to the cashback arrangement between you and your bank.',
          'No-cost EMI is facilitated by the card-issuing bank. The interest component is subvented by the bank; Jeffi Stores does not subsidise or guarantee this.',
          'For any dispute or non-credit of a bank offer, contact your card-issuing bank directly using the number on the back of your card.',
        ],
      },
      {
        heading: '6. Cancellation, returns, refunds',
        body: 'See the dedicated Cancellation Policy and Return & Refund Policy. In short: cancellable until dispatch; returnable for manufacturing defects or wrong-item shipped within 7 days of delivery; refunds settle to the original payment method within 7 working days of pickup confirmation.',
      },
      {
        heading: '7. Use of the platform',
        body: [
          'No scraping, automated probing, or denial-of-service activity.',
          'No reverse-engineering the API or attempting to access data that is not yours.',
          'No reselling Jeffi-Stores-only-priced products (business discount catalog) on other marketplaces — abuse will result in account termination.',
          'Reviews and submissions must be your own work and not contain illegal, defamatory, or infringing content.',
        ],
      },
      {
        heading: '8. Intellectual property',
        body: 'Site content, layout, brand marks, and Jeffi-Stores-authored product descriptions belong to Jeffi Stores. Manufacturer brand marks belong to their respective owners. Nothing here grants you a licence to use these marks beyond browsing and ordering.',
      },
      {
        heading: '9. Liability',
        body: [
          'We do not guarantee uninterrupted availability — we run at normal SaaS uptime and may schedule maintenance.',
          'Our liability for any single order is capped at the order value. We are not liable for indirect or consequential losses.',
          'Manufacturer warranty applies as marked on the product detail page. We facilitate warranty claims but the manufacturer remains the warranty principal.',
        ],
      },
      {
        heading: '10. Changes',
        body: 'We update these terms from time to time. When we make material changes (anything that affects your rights, pricing, or how we use your data), we ask you to re-accept the next time you sign in. Continued use after that is acceptance.',
      },
      {
        heading: '11. Governing law',
        body: 'Indian law. Disputes go to the courts in Raipur, Chhattisgarh.',
      },
      {
        heading: '12. Contact',
        body: 'For account, order, or terms-related queries write to support@jeffistores.in. Grievance officer details are in the Grievance Redressal policy.',
      },
    ],
  },
  {
    slug: 'return-refund-policy',
    title: 'Return & Refund Policy',
    description: 'Our policy on returns, refunds, and defective product claims.',
    lastUpdated: '14 May 2026',
    sections: [
      {
        heading: '1. Returns — Defective Products Only',
        body: [
          'We accept returns only for products that are defective, damaged in transit, or not as described.',
          'The defect must be reported within 7 days of delivery.',
          'Provide photographs or video clearly showing the defect along with your order number.',
          'The product must be in its original, unused condition and packaging.',
        ],
      },
      {
        heading: '2. Monthly Return & Replacement Limit',
        body: [
          'Each customer is allowed a maximum of 1 return or replacement request per calendar month.',
          'This limit applies across all orders — regardless of the reason or the type of request (refund or replacement).',
          'The limit resets on the 1st of each month.',
          'Requests that are rejected by our team do not count toward this limit.',
          'This policy exists because every return pickup (RVP) incurs a logistics cost that we bear on your behalf, and we want to keep prices fair for all customers.',
        ],
      },
      {
        heading: '3. No Exchange Policy',
        body: 'We do not offer product exchanges. Please review product specifications carefully before ordering. Defective items will be refunded or replaced subject to the monthly limit above.',
      },
      {
        heading: '4. Non-Returnable Items',
        body: [
          'Products that have been used, installed, or altered in any way.',
          'Products returned without original packaging.',
          'Custom or special-order items.',
          'Products reported after the 7-day return window.',
          'Consumable items (e.g. cutting discs, abrasives) once opened.',
        ],
      },
      {
        heading: '5. Return Process',
        body: [
          'Step 1: Contact us via email or phone with your order number and defect details.',
          'Step 2: Submit photographic or video evidence of the defect.',
          'Step 3: Await approval — we will respond within 2 business days.',
          'Step 4: Return the product via the method we specify.',
          'Step 5: Refund issued within 7–10 business days of receiving the returned item.',
        ],
      },
      {
        heading: '6. Refunds',
        body: [
          'Refunds are credited to the original payment method only.',
          'Processing takes 7–10 business days after we receive and inspect the return.',
          'Shipping charges are non-refundable unless the defect was caused by our error.',
        ],
      },
    ],
  },
  {
    slug: 'shipping-policy',
    title: 'Shipping Policy',
    description: 'Delivery timelines, charges, and shipping terms for Jeffi Stores orders.',
    lastUpdated: '1 May 2025',
    sections: [
      {
        heading: '1. Delivery Areas',
        body: 'We ship across India. Delivery to remote or restricted PIN codes may take additional time or may not be available — you will be notified before order confirmation.',
      },
      {
        heading: '2. Delivery Timelines',
        body: [
          'Standard Delivery: 5–7 business days.',
          'Express Delivery: 2–3 business days (available for select PIN codes).',
          'Heavy or bulk orders may require additional 2–3 business days.',
          'Timelines are estimates and may vary during peak seasons or due to logistics delays.',
        ],
      },
      {
        heading: '3. Shipping Charges',
        body: 'Shipping charges are calculated at checkout based on order weight, dimensions, and delivery location. Orders above a threshold amount may qualify for free shipping — check the website for current offers.',
      },
      {
        heading: '4. Order Processing',
        body: 'Orders are processed within 1–2 business days of payment confirmation. Orders placed on weekends or public holidays are processed the next business day.',
      },
      {
        heading: '5. Tracking',
        body: 'A tracking link will be shared via email or SMS once your order is dispatched. You can also track your order from the My Orders section of your account.',
      },
      {
        heading: '6. Damaged in Transit',
        body: 'If your order arrives visibly damaged, please refuse the delivery or report it within 24 hours with photographic evidence. We will arrange a replacement or refund after verification.',
      },
      {
        heading: '7. Delays',
        body: 'Jeffi Stores is not responsible for delays caused by courier partners, natural disasters, strikes, or other events beyond our control. We will keep you informed and work to resolve delays as quickly as possible.',
      },
    ],
  },
  {
    slug: 'cancellation-policy',
    title: 'Cancellation Policy',
    description: 'When and how you can cancel an order placed on Jeffi Stores.',
    lastUpdated: '1 May 2025',
    sections: [
      {
        heading: '1. Cancellation Before Dispatch',
        body: 'You may cancel your order at any time before it is dispatched. Log in to your account, go to My Orders, and use the Cancel Order option. A full refund will be issued within 7–10 business days.',
      },
      {
        heading: '2. Cancellation After Dispatch',
        body: 'Once an order has been dispatched, it cannot be cancelled. You may refuse delivery, in which case the order will be treated as a return. Refunds for refused deliveries are processed after we receive the item back — shipping costs may be deducted.',
      },
      {
        heading: '3. Cancellation by Jeffi Stores',
        body: [
          'We reserve the right to cancel orders in the following circumstances:',
          'Product is out of stock or discontinued after order placement.',
          'Pricing errors or technical issues at the time of ordering.',
          'Payment failure or suspected fraudulent transaction.',
          'Unable to deliver to the provided address.',
        ],
      },
      {
        heading: '4. Custom & Special Orders',
        body: 'Custom or special-order items cannot be cancelled once production or procurement has begun. This will be communicated to you at the time of placing such orders.',
      },
      {
        heading: '5. Refund on Cancellation',
        body: 'Approved cancellation refunds are credited to the original payment method within 7–10 business days. UPI and wallet payments may reflect sooner.',
      },
    ],
  },
  {
    slug: 'warranty-policy',
    title: 'Warranty Policy',
    description: 'Manufacturer warranty terms and how to raise a warranty claim at Jeffi Stores.',
    lastUpdated: '1 May 2025',
    sections: [
      {
        heading: '1. Manufacturer Warranty',
        body: 'Most products sold by Jeffi Stores carry the original manufacturer\'s warranty. The warranty period and terms vary by brand and product category. Warranty details are mentioned on the product packaging or datasheet.',
      },
      {
        heading: '2. What Is Covered',
        body: [
          'Manufacturing defects in materials or workmanship.',
          'Failure under normal use conditions within the warranty period.',
          'Products with valid proof of purchase from Jeffi Stores.',
        ],
      },
      {
        heading: '3. What Is Not Covered',
        body: [
          'Damage caused by misuse, improper installation, or neglect.',
          'Normal wear and tear.',
          'Damage from power surges, accidents, or unauthorised modifications.',
          'Consumable parts (belts, brushes, blades) unless defective on arrival.',
          'Products with removed or tampered serial numbers.',
        ],
      },
      {
        heading: '4. How to Raise a Warranty Claim',
        body: [
          'Step 1: Contact us at jeffistoress@gmail.com with your order number, product details, and description of the defect.',
          'Step 2: We will coordinate with the manufacturer on your behalf.',
          'Step 3: Depending on the manufacturer\'s process, the product may be repaired, replaced, or refunded.',
          'Step 4: Turnaround time varies by manufacturer — typically 15–30 business days.',
        ],
      },
      {
        heading: '5. Out-of-Warranty Repairs',
        body: 'For products outside the warranty period, we can help connect you with authorised service centres. Repair costs will be borne by the customer.',
      },
    ],
  },
  {
    slug: 'faq',
    title: 'Frequently Asked Questions',
    description: 'Answers to common questions about orders, payments, delivery, and more.',
    lastUpdated: '1 May 2025',
    sections: [
      {
        heading: 'Orders',
        body: [
          'How do I place an order? — Browse our products, add items to your cart, and proceed to checkout. You can pay online or use other available payment methods.',
          'Can I modify my order after placing it? — Orders can be modified before dispatch by contacting us immediately via phone or email.',
          'How do I track my order? — Log in to your account and visit My Orders for real-time tracking updates.',
          'Do you accept bulk or wholesale orders? — Yes. Contact us directly for bulk pricing and wholesale terms.',
        ],
      },
      {
        heading: 'Payments',
        body: [
          'What payment methods do you accept? — We accept UPI, credit/debit cards, net banking, and bank transfers for wholesale orders.',
          'Is it safe to pay online? — Yes. All payments are processed via secure, PCI-compliant payment gateways. We do not store card information.',
          'Will I receive a GST invoice? — Yes. A GST invoice is generated for every order and available in your account under My Orders.',
        ],
      },
      {
        heading: 'Delivery',
        body: [
          'How long does delivery take? — Standard delivery takes 5–7 business days. Express delivery (2–3 days) is available for select locations.',
          'Do you deliver across India? — Yes, we ship pan-India. Remote areas may have longer delivery times.',
          'What if I am not available to receive the order? — Our courier partner will attempt delivery twice. After that, the package is held at the local facility for 3 days before being returned.',
        ],
      },
      {
        heading: 'Returns & Refunds',
        body: [
          'Can I return a product I no longer need? — We only accept returns for defective or damaged products. Change-of-mind returns are not accepted.',
          'How long does a refund take? — Refunds are processed within 7–10 business days of receiving the returned item.',
          'What if my product arrives damaged? — Report it within 24 hours with photos. We will arrange a replacement or refund after verification.',
        ],
      },
      {
        heading: 'Account & Support',
        body: [
          'Do I need an account to order? — You can browse without an account, but an account is required to place orders and track them.',
          'How do I reset my password? — Click "Forgot Password" on the login page and follow the instructions sent to your email.',
          'How can I contact support? — Via the Support page on our website, email at jeffistoress@gmail.com, or call +91 96853 54099.',
        ],
      },
    ],
  },
  {
    slug: 'grievance-redressal',
    title: 'Grievance Redressal',
    description: 'How to raise a complaint and our escalation process — as required under the IT Act and Consumer Protection Act.',
    lastUpdated: '1 May 2025',
    sections: [
      {
        heading: '1. Our Commitment',
        body: 'Jeffi Stores is committed to resolving customer grievances promptly and fairly. If you are dissatisfied with any aspect of our service, product, or policies, please use the escalation process below.',
      },
      {
        heading: '2. Grievance Officer',
        body: [
          'Name: Jeffi Stores Management',
          'Email: jeffistoress@gmail.com',
          'Phone: +91 96853 54099',
          'Address: Sanjay Gandhi Chowk, Station Road, Raipur, CG 490092',
          'Working Hours: Monday – Friday, 9:00 AM – 7:00 PM IST',
        ],
      },
      {
        heading: '3. How to Raise a Grievance',
        body: [
          'Step 1: Contact our support team via the Support page, email, or phone with full details of your complaint.',
          'Step 2: You will receive an acknowledgement within 48 hours.',
          'Step 3: We aim to resolve all grievances within 15 business days.',
          'Step 4: If unresolved, escalate directly to the Grievance Officer at the contact above.',
        ],
      },
      {
        heading: '4. Information to Include',
        body: [
          'Your full name and registered email or phone number.',
          'Order number or invoice number (if applicable).',
          'Clear description of the grievance.',
          'Supporting documents or photographs (if applicable).',
        ],
      },
      {
        heading: '5. Consumer Forum',
        body: 'If your grievance is not resolved to your satisfaction, you may approach the National Consumer Disputes Redressal Commission (NCDRC) or the appropriate State Consumer Forum. You may also raise a complaint on the Government of India\'s consumer portal at consumerhelpline.gov.in.',
      },
      {
        heading: '6. Legal Compliance',
        body: 'This grievance mechanism is established in accordance with the Information Technology Act, 2000 and the Consumer Protection (E-Commerce) Rules, 2020.',
      },
    ],
  },
]

export function getPolicyBySlug(slug: string): Policy | undefined {
  return policies.find((p) => p.slug === slug)
}
