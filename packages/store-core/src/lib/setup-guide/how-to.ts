import type { GuideLink } from './registry'

// "How to do it" walkthroughs, one per setup step: what to have ready, the clicks in order, and
// where the outside accounts come from. The "use your own credentials" guides stay in registry.ts.

export interface HowTo {
  /** What to have ready before starting. */
  before?: string[]
  steps: string[]
  links?: GuideLink[]
  /** Typical wait for any outside approval. */
  wait?: string
  notes?: string[]
}

const GST_PORTAL: GuideLink = { label: 'GST portal', url: 'https://www.gst.gov.in/' }
const GOOGLE_ADS: GuideLink = { label: 'Google Ads', url: 'https://ads.google.com/' }
const META_BUSINESS: GuideLink = { label: 'Meta Business Suite', url: 'https://business.facebook.com/' }
const SOCIAL_ACCOUNTS = 'In the admin, open Social Posts → Accounts'

export const HOW_TO: Record<string, HowTo> = {
  // ── Store basics ───────────────────────────────────────────────────────
  'store-identity': {
    before: [
      'The store name as customers should see it',
      'A support email and phone number customers can reach',
      'A logo (PNG or SVG, at least 512 px wide, on a transparent or white background) and a square favicon',
    ],
    steps: [
      'Open Settings → Site Controls → Store tab.',
      'Under Store Identity, fill in Store name, Contact email, Contact phone and Website URL.',
      'Upload the logo. It is used in the storefront header, on invoices and in emails.',
      'Upload the favicon (the small icon in the browser tab) or paste its URL.',
      'Optional: set the email accent colour and your business hours.',
      'Open the storefront in a private window and check the header, footer and contact page.',
    ],
  },
  'legal-details': {
    before: ['Your legal name exactly as on your PAN or GST certificate', 'The registered address with pincode and state'],
    steps: [
      'Open Settings → Site Controls → Store tab → Legal & Banking.',
      'Enter the Legal name exactly as registered, and the Trade name if you sell under a different name.',
      'Enter the Registered address, City, Pincode and State.',
      'Enter the State code: the two-digit GST code of your state (for example 33 Tamil Nadu, 29 Karnataka, 27 Maharashtra, 07 Delhi). It is also the first two digits of your GSTIN.',
      'Open your privacy policy, terms and refund pages on the storefront (footer links) and check your name and address appear.',
      'Stores: if the owner portal asks you to accept updated legal terms, accept them there.',
    ],
    notes: ['Razorpay, Google Merchant Center and Meta reviewers check these pages. A name or address that differs from your registration is one of the most common rejection reasons.'],
  },
  gstin: {
    before: [
      'PAN of the business (or of the proprietor)',
      'Aadhaar of the proprietor, partners or directors',
      'Proof of the place of business: rent agreement, electricity bill or property tax receipt',
      'A bank account statement or cancelled cheque, and a photograph',
    ],
    steps: [
      'If you already have a GSTIN, skip to step 6.',
      'On the GST portal, Services → Registration → New Registration. Fill Part A (PAN, mobile and email, each verified by OTP) to get a TRN.',
      'Log in with the TRN and fill Part B: business details, promoters, principal place of business, the goods you sell (HSN codes) and the bank account. Upload the documents.',
      'Opt for Aadhaar authentication when asked; it usually avoids a physical verification. Submit with EVC (OTP) or a digital signature.',
      'Track the ARN. When approved, download the certificate (REG-06) from Services → User Services → View/Download Certificates.',
      'In Site Controls → Store tab → Legal & Banking, enter the 15-character GSTIN. Its first two digits must match the State code.',
      'In Site Controls → Payments & tax, turn on GST calculation so invoices show CGST and SGST, or IGST for other states.',
    ],
    links: [GST_PORTAL, { label: 'New registration (GST portal)', url: 'https://reg.gst.gov.in/registration/' }],
    wait: 'about 7 working days; up to 30 if an officer orders a site visit',
    notes: [
      'Registration is required once turnover crosses ₹40 lakh for goods in most states (₹20 lakh for services). Selling on Amazon, Myntra or AJIO generally needs a GSTIN from the first sale; ask your accountant about exemptions.',
      'Upload the same GST certificate to the owner portal for KYC.',
    ],
  },
  'invoice-setup': {
    before: ['A short invoice prefix, for example ABC/', 'A scan of your seal or signature as a transparent PNG', 'The bank account customers should transfer to'],
    steps: [
      'Open Settings → Site Controls → Store tab → Legal & Banking.',
      'Set the Invoice number prefix before your first invoice. Keep it short: a GST invoice number can be at most 16 characters including the prefix.',
      'Upload your seal or signature under Seal / signature URL. It prints at the foot of every invoice.',
      'Fill in Account holder name, Bank name, Account number, IFSC code and Branch. They print on invoices and quotations for bank transfers.',
      'Open any order and preview its invoice to check the layout.',
    ],
    notes: ['GST wants one continuous, unique series per financial year, so avoid changing the prefix mid-year.'],
  },
  'custom-domain': {
    before: [
      'A domain you own, bought from any registrar (GoDaddy, Namecheap, Hostinger, Cloudflare and so on)',
      'Access to that domain’s DNS settings',
    ],
    steps: [
      'Decide the address. A subdomain such as www.yourbrand.in is the simplest; the bare domain (yourbrand.in) works too.',
      'Owner portal → Domains → add the domain.',
      'At your DNS provider, add the TXT record shown (name _jeffi.<your domain>). It proves you own the domain.',
      'Add the pointing record shown: a CNAME for a subdomain, or an A record to the IP shown for the bare domain.',
      'Delete any older A, AAAA or CNAME records on the same name, or verification keeps failing.',
      'Click Verify. It is also checked every 10 minutes, and the HTTPS certificate is issued as soon as the domain points at us.',
      'Optional: at your registrar, forward the bare domain to www (or the other way round) so both addresses work.',
    ],
    wait: 'DNS changes usually show within minutes; some providers take a few hours (up to 48)',
    notes: ['Cloudflare: keep the records on "DNS only" (grey cloud) until the certificate has been issued.'],
  },
  team: {
    before: ['The email address each person signs in with (a Google account email lets them use Google sign-in)'],
    steps: [
      'Open Settings → Team → Add Team Member.',
      'Enter their name and email, choose the role, and tick only the permissions they need.',
      'They receive an invitation. Each admin downloads their own client certificate once (by signing in on the link in the invitation) and installs it on their computer; without it the admin panel does not open.',
      'They sign in at your admin login with a code sent to their email, then set up two-factor authentication with an authenticator app.',
      'When someone leaves, deactivate them under Team the same day; their certificate stops working.',
    ],
  },
  'google-tag': {
    before: ['A Google account'],
    steps: [
      'Go to Google Analytics → Admin → Create → Property. Name it after your store and set the time zone to India and the currency to INR.',
      'Choose Web as the platform, enter your store’s address and a stream name. Google shows a Measurement ID like G-XXXXXXXXXX.',
      'Open Settings → Site Controls → Storefront tab → Google tag card and paste the ID into Google tag ID.',
      'Open your store in another tab. In Google Analytics → Reports → Realtime you should see yourself within a minute.',
      'For Google Ads conversion tracking: in Google Ads, Goals → Conversions → New conversion action → Website → Purchase. Copy the conversion ID (AW-…) and label from the send_to value into the Ads conversion ID and label fields on the same card.',
      'Link Google Ads to Analytics: Analytics Admin → Product links → Google Ads links.',
    ],
    links: [{ label: 'Google Analytics', url: 'https://analytics.google.com/' }, GOOGLE_ADS],
  },

  // ── Get paid and ship ──────────────────────────────────────────────────
  razorpay: {
    before: ['KYC and a payout bank account approved (the next step), for stores paid through the platform'],
    steps: [
      'By default nothing to sign up for: payments go through the platform Razorpay account and reach your bank as payouts once KYC is approved.',
      'Open Settings → Site Controls → Payments & tax and make sure Online payments (Razorpay) is on.',
      'Place a small order on your storefront and pay with UPI to check the checkout.',
      'Payments, refunds, disputes and settlements appear in Financial → Razorpay.',
      'To collect on your own Razorpay account instead, follow "Use your own credentials".',
    ],
  },
  'kyc-bank': {
    before: [
      'Legal name, business type and registered address',
      'GSTIN and the GST certificate as a PDF, and the business PAN',
      'A bank account in the business’s name (a proprietor’s own account works for a proprietorship)',
    ],
    steps: [
      'Owner portal → Business: check the details submitted during sign-up (legal name, type, address, mobile, categories, GSTIN, PAN, GST certificate) and that the legal terms are accepted.',
      'The platform team reviews them, usually within 1–2 working days. If rejected, the reviewer’s note on the same page says what to fix.',
      'Owner portal → Payouts: enter the account number twice, the IFSC and the account holder name exactly as the bank has it.',
      'The account is verified automatically. A name that does not match the bank’s record fails verification; fix it and submit again.',
      'Once both are approved, payouts for your online sales go to this account.',
    ],
    wait: '1–2 working days for the KYC review',
  },
  delhivery: {
    before: ['Wallet balance (platform shipping is charged to it)', 'Your pickup address, a contact phone and the ship-from pincode'],
    steps: [
      'Open Settings → Site Controls → Orders & delivery → Default warehouse. Fill in Pickup location name, Seller name, Pickup / return address, phone and Ship-from pincode.',
      'Open Delhivery in the admin and make sure the pickup location shows as active.',
      'Set realistic weights: Default product weight in Site Controls, and the weight on each product. Courier charges are by weight.',
      'Top up the wallet (Wallet page). Bookings pause when the balance runs out.',
      'Ship a test order: open the order → ship with Delhivery → print the label, then request a pickup.',
      'To ship on your own Delhivery account instead, follow "Use your own credentials".',
    ],
  },
  cod: {
    steps: [
      'Open Settings → Site Controls → Payments & tax and turn Cash on delivery (COD) on or off.',
      'Optional: add a COD surcharge (flat or percentage) to cover the courier’s COD fee.',
      'Platform Delhivery: the cash the courier collects is remitted to you after delivery; see Financial for the COD remittances.',
      'Own Delhivery account: Delhivery remits the cash to your bank on your agreed cycle.',
    ],
    notes: ['COD orders are refused at the door more often than prepaid ones, and each return costs a return shipment.'],
  },
  'shipping-rates': {
    steps: [
      'Open Settings → Site Controls → Orders & delivery → Delivery & Shipping.',
      'Set the Shipping rate per kg and the Free-weight ceiling (orders up to this weight ship at the minimum).',
      'Set the Minimum and Maximum shipping charge.',
      'Set Default product weight and the default for low-weight items; they apply to products without their own weight.',
      'Add a light and a heavy product to a cart on the storefront and check the charge at checkout.',
    ],
  },
  wallet: {
    steps: [
      'Open Wallet in the admin to see the balance and what was charged (shipping, SMS, WhatsApp, AI).',
      'Add money with UPI, card or net banking.',
      'Keep enough for a week of shipping. When the balance runs out, platform shipping, SMS, WhatsApp and AI pause until you top up.',
      'Statements are in the owner portal → Wallet and Ledger.',
    ],
  },

  // ── Catalogue ──────────────────────────────────────────────────────────
  categories: {
    steps: [
      'Open Catalogue → Categories → add a category with a name and an image (the image is used on homepage tiles).',
      'Add subcategories by choosing a parent category.',
      'Move products off the starter category, then rename or delete it.',
    ],
  },
  brands: {
    steps: [
      'Open Catalogue → Brands → add your brand with its logo and a short description.',
      'If you resell other brands, add each one.',
      'Set the brand on every product. Google Shopping and marketplaces need it.',
    ],
    notes: ['Selling your own brand on Amazon: enrol it in Amazon Brand Registry, which needs a registered or applied-for trademark.'],
  },
  products: {
    before: ['Product names, prices (MRP and selling price), GST rate and HSN code', 'Clear photos: square, at least 1000 px, on a plain or white background'],
    steps: [
      'Open Catalogue → Products → add a product: name, category, brand, prices, GST rate, HSN code, stock and weight.',
      'Upload images. The first image is the main one; use at least one per product.',
      'Add variants (size, colour) with their own SKU, price and stock where needed.',
      'Many products at once: import them from a spreadsheet (Data Source), and use AI Enrichment to write descriptions.',
      'Delete or deactivate the starter products.',
      'Open a product page on the storefront to check it.',
    ],
    notes: ['Google Merchant Center and marketplaces reject images with watermarks, borders, logos or text overlays.'],
  },
  hero: {
    steps: [
      'Open Settings → Homepage → the banner slides.',
      'Add a slide with a wide image (1600×900 for most layouts; 1080×1350 for the Cards layout), a heading, button text and the link it opens (a category or product).',
      'Keep text away from the image edges; phones crop them.',
      'Delete the starter slides, then check the homepage on a phone and a laptop.',
    ],
  },
  'google-sheets': {
    before: ['A Google Sheet with one product per row (name, SKU, price, stock, image URLs and so on)'],
    steps: [
      'Open Data Source → Google Sheet tab and connect with Google, using the account that can open the sheet.',
      'Paste the sheet’s URL and pick the tab.',
      'Map each column to a product field the first time.',
      'Preview, then import. Later syncs update the same products by SKU.',
    ],
  },

  // ── Messaging ──────────────────────────────────────────────────────────
  email: {
    steps: [
      'Nothing to set up: order and account emails go out from your store’s address.',
      'Replies go to the Contact email in Site Controls → Store tab, so make sure someone reads it.',
      'Optional: turn on the daily summary email in Site Controls → Daily email.',
    ],
  },
  sms: {
    steps: [
      'Open Settings → Site Controls → Notifications and turn on SMS notifications.',
      'Messages go out from the platform’s registered sender with DLT-approved templates, so you do not register anything yourself.',
      'Each SMS is charged to your wallet; keep it topped up.',
    ],
  },
  whatsapp: {
    steps: [
      'Open Settings → Site Controls → Notifications and turn on WhatsApp notifications.',
      'Messages go out from the platform’s WhatsApp number using templates Meta has approved.',
      'Check each template’s approval in Marketing → Templates. Until a template is approved, that message goes out as plain text.',
      'Each message is charged to your wallet.',
    ],
  },
  push: {
    steps: [
      'Open Settings → Site Controls → Notifications. Enter your Store app build ID (your store needs its own mobile app), then turn on App push notifications for order updates, and Marketing push notifications for offers.',
      'Customers receive them once they allow notifications in their browser or the app.',
      'Send offers from Marketing.',
    ],
  },

  // ── Sell on marketplaces ───────────────────────────────────────────────
  'google-merchant': {
    before: ['Products with images, prices, brands and GTINs or MPNs', 'Shipping and return policies on your storefront', 'The Google tag set up (Store basics)'],
    steps: [
      'Create a free Merchant Center account: business name, country India and your store’s web address.',
      'Business info: add the business address and a customer service contact.',
      'Shipping and returns: set the shipping cost and delivery time, and link your refund policy page.',
      'Verify and claim your website. With your Google tag already on the storefront, choose the Google tag (or Google Analytics) method; it needs Edit access on that Analytics property.',
      'In the admin, open Google Merchant → Connect and sign in with a Google account that is a Merchant Center admin. Choose the account.',
      'Run the first sync and fix the product issues listed (missing GTIN, image problems, price mismatch).',
      'For Shopping and Performance Max ads, link Google Ads: Merchant Center → Settings → Apps and services → Google Ads.',
    ],
    links: [{ label: 'Merchant Center', url: 'https://merchants.google.com/' }],
    wait: 'product review takes up to 3 working days after the first sync',
  },
  amazon: {
    before: ['GSTIN (PAN alone only for GST-exempt categories)', 'PAN, a bank account and a pickup address', 'A mobile number and email not already used on another seller account'],
    steps: [
      'Register on Amazon’s seller site (sell.amazon.in) → Start selling. Create the Seller Central account with your business email.',
      'Enter the business details, GSTIN, PAN, bank account and tax details, and complete identity verification.',
      'Set the pickup address and choose how you ship: Easy Ship (Amazon picks up), Self Ship or FBA.',
      'Wait for the account to be activated, then list a product or two to check.',
      'Connect here: follow "Use your own credentials" (a private app for your own seller account).',
    ],
    links: [{ label: 'Sell on Amazon.in', url: 'https://sell.amazon.in/' }, { label: 'Seller Central (India)', url: 'https://sellercentral.amazon.in/' }],
    wait: 'account verification usually takes a few days',
  },
  myntra: {
    before: ['GSTIN, PAN and a bank account', 'Brand documents: a trademark certificate or a brand authorisation letter', 'A catalogue with on-model or studio photos'],
    steps: [
      'Apply as a seller on the Myntra Partner Portal with your business, GST, bank and brand details.',
      'Myntra’s category team reviews the brand and catalogue, then you sign the seller agreement.',
      'Ask your account manager to put you on a model that allows the API (PPMP C+L or OMNI, not MDirect).',
      'Get your API credentials and connect here: see "Use your own credentials".',
      'List products from the Listings tab (template export and image pack), then accept orders from the Orders tab.',
    ],
    links: [{ label: 'Myntra Partner Portal', url: 'https://partners.myntrainfo.com/' }],
    wait: 'brand and catalogue review: usually a few weeks',
  },
  ajio: {
    before: ['GSTIN, PAN and a bank account', 'Brand documents (trademark or brand authorisation)', 'A catalogue with studio photos'],
    steps: [
      'Apply as a seller with AJIO (through the AJIO seller site or an AJIO category manager).',
      'After the brand and catalogue review and the agreement, you get VMS access and your POB ID.',
      'Ask your account manager for VMS API credentials and connect here: see "Use your own credentials".',
      'Purchase orders then arrive in the Orders tab; invoices and manifests are raised from there.',
    ],
    links: [{ label: 'AJIO seller (VMS)', url: 'https://seller.ajio.com/ajiocommerce/' }],
    wait: 'onboarding usually takes a few weeks',
  },

  // ── Advertise ──────────────────────────────────────────────────────────
  'google-ads': {
    before: ['A Google Ads account with a payment method', 'Admin or Standard access on it for the Google account you sign in with'],
    steps: [
      'No account yet: go to Google Ads, start in Expert mode and skip the first campaign. Set country India, your time zone and INR. Currency and time zone cannot be changed later.',
      'Billing → set up a payment method.',
      'Note the 10-digit customer ID shown at the top right (123-456-7890).',
      'In the admin, open Google Ads → Connect and sign in with Google using an account that can see the ads account. Pick the account (and the manager account, if you use one).',
      'Set up purchase conversions: see the Google tag step in Store basics.',
      'For Shopping and Performance Max, link Merchant Center to the ads account.',
    ],
    links: [GOOGLE_ADS],
  },
  'amazon-ads': {
    before: ['An Amazon.in seller account in good standing with active listings'],
    steps: [
      'In Seller Central, open Advertising → Campaign Manager, accept the advertising terms and add a payment method.',
      'In the admin, open Amazon Ads → Connect and sign in with Amazon using your seller login.',
      'Choose the Amazon.in advertising profile.',
      'Reports appear after the first sync. Amazon publishes reports a few hours late, so today’s numbers fill in later.',
    ],
    links: [{ label: 'Amazon Ads', url: 'https://advertising.amazon.in/' }],
  },
  'meta-ads': {
    before: ['A Facebook account', 'A Meta business portfolio that owns the ad account (create one in Meta Business Suite)'],
    steps: [
      'Meta Business Suite → Settings → Business portfolio: create one with your business name and email if you have none.',
      'Settings → Accounts → Ad accounts → Add → Create a new ad account. Set the currency to INR and your time zone; both are permanent. Give yourself full control.',
      'Billing and payments → add a payment method to the ad account.',
      'Events Manager → Connect data sources → Web → create a dataset (pixel) for the store and copy its ID.',
      'In the admin, open Meta Ads → Connect → Continue with Facebook. Allow access to the business and the ad account, then pick the ad account.',
      'Events Manager → your dataset → Settings → Conversions API → Generate access token. Paste the dataset (pixel) ID and token in the Meta Ads gear.',
      'Events Manager → Test events: place a test order and check the Purchase event arrives.',
    ],
    links: [META_BUSINESS, { label: 'Events Manager', url: 'https://business.facebook.com/events_manager2' }],
  },
  'myntra-ads': {
    steps: [
      'In the Myntra Partner Portal, open the Ads section and download the campaign (or product) performance report for a date range, as CSV or Excel.',
      'In the admin, open Myntra Ads → Import and upload the file.',
      'The first time, map the columns: date, campaign, spend, impressions, clicks, orders and revenue. The mapping is remembered.',
      'Check the preview, then import. Uploading the same dates again replaces them, so there are never duplicates.',
      'Import weekly. An alert appears after 7 days without a report.',
    ],
  },
  'ajio-ads': {
    steps: [
      'In AJIO’s seller portal, open the advertising reports and download the campaign performance report for a date range, as CSV or Excel.',
      'In the admin, open AJIO Ads → Import and upload the file.',
      'The first time, map the columns: date, campaign, spend, impressions, clicks, orders and revenue. The mapping is remembered.',
      'Check the preview, then import. Uploading the same dates again replaces them.',
      'Import weekly. An alert appears after 7 days without a report.',
    ],
  },

  // ── Social ─────────────────────────────────────────────────────────────
  'facebook-instagram': {
    before: ['A Facebook Page you are an admin of', 'An Instagram professional account (Business or Creator) linked to that Page'],
    steps: [
      'No Page yet: create one on Facebook (Pages → Create new Page) with your store name, category and logo.',
      'In the Instagram app: Settings → Account type and tools → Switch to professional account → Business.',
      'Link them: Meta Business Suite → Settings → Instagram accounts → Connect (or the Page’s settings → Linked accounts).',
      `${SOCIAL_ACCOUNTS} → Continue with Facebook. In the dialog, tick the Page and the Instagram account and allow every permission asked.`,
      'If you manage several Pages, choose this store’s Page.',
      'Schedule a test post to both.',
    ],
    links: [META_BUSINESS],
  },
  gbp: {
    before: ['A verified Google Business Profile for the store, with your website on it'],
    steps: [
      'No profile yet: on Google Business Profile, add the business, its category, address or service area, phone and website.',
      'Verify it the way Google offers (video, phone, email or postcard).',
      `${SOCIAL_ACCOUNTS} → Google Business Profile → sign in with an owner or manager of the profile, then pick the location.`,
      'Publish a test update.',
    ],
    links: [{ label: 'Google Business Profile', url: 'https://business.google.com/' }],
    notes: ['If one-click connect says it is unavailable, the platform is still waiting for Google’s API approval; use "Use your own credentials".'],
  },
  youtube: {
    before: ['A YouTube channel for the store'],
    steps: [
      'No channel yet: in YouTube, Create a channel, and use a business name (not your personal name).',
      'Verify the channel with your phone (YouTube → Settings → Channel → Feature eligibility) to unlock longer uploads and custom thumbnails.',
      `${SOCIAL_ACCOUNTS} → YouTube → sign in with Google and choose the channel.`,
      'Upload a short test video.',
    ],
    links: [{ label: 'YouTube Studio', url: 'https://studio.youtube.com/' }],
  },
  pinterest: {
    before: ['A Pinterest business account'],
    steps: [
      'Create a business account, or convert yours in Settings → Account management.',
      'Create a board for your products.',
      `${SOCIAL_ACCOUNTS} → Pinterest → sign in and allow access, then pick the board.`,
      'Pin a product to check.',
    ],
    links: [{ label: 'Pinterest Business', url: 'https://business.pinterest.com/' }],
  },
  linkedin: {
    before: ['A LinkedIn company Page where you are a super admin'],
    steps: [
      'No Page yet: LinkedIn → For Business → Create a Company Page.',
      `${SOCIAL_ACCOUNTS} → LinkedIn → sign in as a Page admin and choose the Page.`,
      'Publish a test post.',
    ],
  },
  x: {
    before: ['An X account for the store'],
    steps: [`${SOCIAL_ACCOUNTS} → X → sign in with X and authorise.`, 'Publish a test post.'],
  },

  // ── Tax documents ──────────────────────────────────────────────────────
  ewaybill: {
    before: ['Your GSTIN and the mobile number registered with GST'],
    steps: [
      'An e-way bill is needed to move goods worth more than ₹50,000 in one consignment (some states set a different limit within the state).',
      'On the e-way bill portal, Registration → e-Way bill Registration: enter your GSTIN, verify with the OTP sent to your GST mobile, and create a username and password.',
      'Then create the API user and paste the credentials: see "Use your own credentials".',
      'Generate e-way bills from an order’s GST panel; the vehicle or transporter ID can be added later.',
    ],
    links: [{ label: 'E-way bill portal', url: 'https://ewaybillgst.gov.in/' }],
  },
  einvoice: {
    before: ['Your GSTIN, and your annual turnover for past years'],
    steps: [
      'E-invoicing is required if your turnover has crossed ₹5 crore in any financial year since 2017-18. Check on the e-invoice portal: Search → e-Invoice status of taxpayer.',
      'Log in to the e-invoice portal (your e-way bill login works).',
      'Create the API user and paste the credentials: see "Use your own credentials".',
      'B2B invoices then get an IRN and a signed QR code when you register them from the GST page.',
    ],
    links: [{ label: 'E-invoice portal', url: 'https://einvoice1.gst.gov.in/' }],
    notes: ['Above ₹10 crore turnover, an e-invoice must be registered within 30 days of the invoice date.'],
  },

  // ── Developers ─────────────────────────────────────────────────────────
  'service-accounts': {
    steps: [
      'Open Settings → Service accounts → Add.',
      'Name it after the system that will use it, and tick only the permissions it needs.',
      'Download the .p12 certificate and note its password. Both are shown once.',
      'Your system calls the admin API with that client certificate.',
      'Revoke it from the same list when it is no longer used, or if the certificate leaks.',
    ],
  },
  cli: {
    before: ['Node.js 20 or newer on your computer'],
    steps: [
      'Install: npm install -g @jeffi_erp/cli',
      'Sign in: jeffi login --store <your store’s name> (the first part of your store’s address). A browser window opens to confirm.',
      'Try jeffi whoami, then jeffi --help to see the commands.',
      'Your tokens are listed under Settings → CLI & tokens; revoke one there to sign that terminal out.',
    ],
    links: [{ label: 'Node.js', url: 'https://nodejs.org/' }],
  },
}
