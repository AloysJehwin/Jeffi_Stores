export type Section = { heading: string; body: string | string[] }

export type Policy = {
  slug: string
  title: string
  description: string
  lastUpdated: string
  sections: Section[]
}

export const policies: Policy[] = [
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    description: 'How Jeffi Stores collects, uses, and protects your personal information.',
    lastUpdated: '1 May 2025',
    sections: [
      {
        heading: '1. Information We Collect',
        body: [
          'Name, email address, phone number, and delivery address when you register or place an order.',
          'Payment information (processed securely via third-party gateways — we do not store card details).',
          'Browsing behaviour, device information, and IP address via cookies and analytics tools.',
          'Communications you send us via email, phone, or the support chat.',
        ],
      },
      {
        heading: '2. How We Use Your Information',
        body: [
          'To process and fulfil your orders and send order confirmations and invoices.',
          'To communicate about your orders, returns, and support requests.',
          'To send promotional offers and updates (you can opt out at any time).',
          'To improve our website, products, and customer service.',
          'To comply with legal obligations under Indian law.',
        ],
      },
      {
        heading: '3. Sharing of Information',
        body: 'We do not sell or rent your personal data to third parties. We share data only with logistics partners for delivery, payment gateways for transaction processing, and as required by law or court order.',
      },
      {
        heading: '4. Cookies',
        body: 'We use cookies to maintain your session, remember your cart, and analyse website traffic. You can disable cookies in your browser settings; however, some features may not function correctly.',
      },
      {
        heading: '5. Data Security',
        body: 'We implement industry-standard security measures including HTTPS encryption and secure database storage. Despite these measures, no transmission over the internet is 100% secure.',
      },
      {
        heading: '6. Your Rights',
        body: [
          'Access and review the personal data we hold about you.',
          'Request correction of inaccurate data.',
          'Request deletion of your account and associated data.',
          'Opt out of marketing communications at any time.',
        ],
      },
      {
        heading: '7. Contact',
        body: 'For privacy-related requests, contact us at jeffistoress@gmail.com or call +91 89030 31299.',
      },
    ],
  },
  {
    slug: 'terms-and-conditions',
    title: 'Terms & Conditions',
    description: 'The rules and guidelines governing your use of the Jeffi Stores website and services.',
    lastUpdated: '1 May 2025',
    sections: [
      {
        heading: '1. Acceptance of Terms',
        body: 'By accessing or using jeffistoress.com, you agree to be bound by these Terms & Conditions. If you do not agree, please do not use our website.',
      },
      {
        heading: '2. Use of the Website',
        body: [
          'You must be at least 18 years old or have parental consent to place orders.',
          'You agree not to use the site for any unlawful purpose or in a way that disrupts its operation.',
          'Account credentials are your responsibility — do not share your password.',
          'We reserve the right to suspend or terminate accounts that violate these terms.',
        ],
      },
      {
        heading: '3. Products & Pricing',
        body: 'All prices are listed in Indian Rupees (INR) and are inclusive of applicable GST unless stated otherwise. We reserve the right to modify prices, discontinue products, or limit quantities at any time without prior notice.',
      },
      {
        heading: '4. Orders & Payment',
        body: [
          'An order confirmation email does not constitute acceptance — orders are accepted upon dispatch.',
          'We reserve the right to cancel orders due to pricing errors, stock unavailability, or suspected fraud.',
          'Payment must be completed at the time of order unless credit terms have been separately agreed.',
        ],
      },
      {
        heading: '5. Intellectual Property',
        body: 'All content on this website — including text, images, logos, and product descriptions — is the property of Jeffi Stores or its licensors and may not be reproduced without written permission.',
      },
      {
        heading: '6. Limitation of Liability',
        body: 'Jeffi Stores shall not be liable for any indirect, incidental, or consequential damages arising from the use of our products or website. Our maximum liability shall not exceed the value of the order in question.',
      },
      {
        heading: '7. Governing Law',
        body: 'These terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts in Raipur, Chhattisgarh.',
      },
      {
        heading: '8. Changes to Terms',
        body: 'We may update these Terms & Conditions at any time. Continued use of the website after changes constitutes acceptance of the revised terms.',
      },
    ],
  },
  {
    slug: 'return-refund-policy',
    title: 'Return & Refund Policy',
    description: 'Our policy on returns, refunds, and defective product claims.',
    lastUpdated: '1 May 2025',
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
        heading: '2. No Exchange Policy',
        body: 'We do not offer product exchanges. Please review product specifications carefully before ordering. Defective items will be refunded, not exchanged.',
      },
      {
        heading: '3. Non-Returnable Items',
        body: [
          'Products that have been used, installed, or altered in any way.',
          'Products returned without original packaging.',
          'Custom or special-order items.',
          'Products reported after the 7-day return window.',
          'Consumable items (e.g. cutting discs, abrasives) once opened.',
        ],
      },
      {
        heading: '4. Return Process',
        body: [
          'Step 1: Contact us via email or phone with your order number and defect details.',
          'Step 2: Submit photographic or video evidence of the defect.',
          'Step 3: Await approval — we will respond within 2 business days.',
          'Step 4: Return the product via the method we specify.',
          'Step 5: Refund issued within 7–10 business days of receiving the returned item.',
        ],
      },
      {
        heading: '5. Refunds',
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
          'How can I contact support? — Via the Support page on our website, email at jeffistoress@gmail.com, or call +91 89030 31299.',
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
          'Phone: +91 89030 31299',
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
