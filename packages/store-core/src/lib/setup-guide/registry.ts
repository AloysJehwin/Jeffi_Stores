import type { OAuthProvider } from '@/lib/integrations/oauth'

// Setup guide content: sections, steps and the "use your own credentials" guides. Pure data;
// status.ts checks each step and fills the live values (redirect URIs, the store's own URLs).

export type SetupSection = 'basics' | 'payments' | 'catalogue' | 'messaging' | 'marketplaces' | 'advertise' | 'social' | 'tax' | 'developers'
export type StepStatus = 'todo' | 'in_progress' | 'done' | 'needs_attention' | 'skipped'

export const SECTIONS: { id: SetupSection; title: string }[] = [
  { id: 'basics', title: 'Store basics' },
  { id: 'payments', title: 'Get paid and ship' },
  { id: 'catalogue', title: 'Catalogue' },
  { id: 'messaging', title: 'Messaging' },
  { id: 'marketplaces', title: 'Sell on marketplaces' },
  { id: 'advertise', title: 'Advertise' },
  { id: 'social', title: 'Social' },
  { id: 'tax', title: 'Tax documents' },
  { id: 'developers', title: 'Developers' },
]

/** A value shown with a copy button, filled in per request. */
export type LiveValue =
  | { kind: 'oauth'; provider: OAuthProvider }
  | { kind: 'social' }
  | { kind: 'store'; path: string }
  | { kind: 'platform'; path: string }
  | { kind: 'text'; value: string }

export interface RegisterItem {
  label: string
  value: LiveValue
  hint?: string
}
export interface GuideLink {
  label: string
  url: string
}
export interface Permission {
  name: string
  why: string
}
export interface ApprovalStep {
  step: string
  wait?: string
}

export interface OwnCredentials {
  summary: string
  consoles: GuideLink[]
  create: string[]
  steps: string[]
  register?: RegisterItem[]
  permissions?: Permission[]
  approval?: ApprovalStep[]
  /** Fields to paste back and the form that takes them (an admin path, or owner: for the owner portal). */
  paste: { fields: string[]; href: string; label: string }
  rejections?: string[]
  notes?: string[]
}

export interface SetupStep {
  id: string
  section: SetupSection
  title: string
  why: string
  /** Admin scope needed to open href; null = no admin page (owner portal). */
  scope: string | null
  /** The plan must sell this scope for the step to show (defaults to scope). */
  planScope?: string
  /** Admin path, or owner:/path for the owner portal. */
  href: string
  /** Deep link that opens the connect panel directly. */
  connect?: string
  optional?: boolean
  /** Stores only; the flagship has no owner portal, KYC or wallet. */
  tenantOnly?: boolean
  ownCredentials?: OwnCredentials
}

const STORE_PRIVACY: RegisterItem = { label: 'Privacy policy URL', value: { kind: 'store', path: '/legal/privacy-policy' } }
const STORE_TERMS: RegisterItem = { label: 'Terms of service URL', value: { kind: 'store', path: '/legal/terms-and-conditions' } }
const STORE_DELETION: RegisterItem = { label: 'Data deletion instructions URL', value: { kind: 'store', path: '/legal/account-deletion' } }
const STORE_SITE: RegisterItem = { label: 'Website / app domain', value: { kind: 'store', path: '' } }
const PLAYGROUND: RegisterItem = {
  label: 'Authorised redirect URI',
  value: { kind: 'text', value: 'https://developers.google.com/oauthplayground' },
  hint: 'The OAuth Playground redirect. Any OAuth client may use it, so you do not have to verify our domain.',
}

const GOOGLE_CLOUD: GuideLink = { label: 'Google Cloud console', url: 'https://console.cloud.google.com/' }
const GOOGLE_AUTH: GuideLink = { label: 'Google Auth Platform (consent screen and clients)', url: 'https://console.cloud.google.com/auth/overview' }
const OAUTH_PLAYGROUND: GuideLink = { label: 'OAuth 2.0 Playground', url: 'https://developers.google.com/oauthplayground' }

const GOOGLE_TESTING_NOTE =
  'Consent screen audience: "Internal" (only users of your Google Workspace) never expires tokens. "External" in Testing status expires refresh tokens after 7 days, so publish the app ("In production") before generating the token you paste here. An unverified production app shows a warning screen you can click through for your own account.'

function googlePlaygroundSteps(api: string, scope: string): string[] {
  return [
    `In Google Cloud, create a project (or pick one) and enable the ${api}.`,
    'In Google Auth Platform, set up the consent screen (app name, support email, the privacy and terms URLs below).',
    'Create an OAuth client of type "Web application" and add https://developers.google.com/oauthplayground as an authorised redirect URI.',
    'Open the OAuth Playground, click the gear, tick "Use your own OAuth credentials" and enter the client ID and secret.',
    `In Step 1 enter the scope ${scope}, click Authorize APIs and sign in with the Google account that owns the data.`,
    'In Step 2 click "Exchange authorization code for tokens" and copy the refresh token.',
  ]
}

export const STEPS: SetupStep[] = [
  // ── Store basics ─────────────────────────────────────────────────────────
  {
    id: 'store-identity',
    section: 'basics',
    title: 'Store name, contact and logo',
    why: 'Shown on the storefront, invoices, emails and every message customers get.',
    scope: 'settings:read',
    href: '/admin/settings/site-controls?tab=store',
  },
  {
    id: 'legal-details',
    section: 'basics',
    title: 'Legal details behind the policy pages',
    why: 'Your privacy, terms and refund pages are filled from your legal name and address. Marketplaces and ad platforms check these pages.',
    scope: 'settings:read',
    href: '/admin/settings/site-controls?tab=store',
  },
  {
    id: 'gstin',
    section: 'basics',
    title: 'GSTIN',
    why: 'Puts your GSTIN and tax split on invoices. Needed if you are GST-registered.',
    scope: 'settings:read',
    href: '/admin/settings/site-controls?tab=payments',
    optional: true,
  },
  {
    id: 'invoice-setup',
    section: 'basics',
    title: 'Invoice prefix, seal and bank details',
    why: 'Printed on every invoice and quotation so customers can pay by bank transfer.',
    scope: 'settings:read',
    href: '/admin/settings/site-controls?tab=store',
  },
  {
    id: 'custom-domain',
    section: 'basics',
    title: 'Custom domain',
    why: 'Serve your store on your own domain instead of the default store address.',
    scope: null,
    href: 'owner:/dashboard/domains',
    optional: true,
    tenantOnly: true,
  },
  {
    id: 'team',
    section: 'basics',
    title: 'Invite your team',
    why: 'Give staff their own logins with only the access they need.',
    scope: 'settings:read',
    href: '/admin/settings?tab=team',
    optional: true,
  },
  {
    id: 'google-tag',
    section: 'basics',
    title: 'Google tag',
    why: 'Measures visits and conversions in Google Analytics and Google Ads.',
    scope: 'settings:read',
    href: '/admin/settings/site-controls?tab=storefront',
    optional: true,
  },

  // ── Get paid and ship ────────────────────────────────────────────────────
  {
    id: 'razorpay',
    section: 'payments',
    title: 'Online payments (Razorpay)',
    why: 'Takes cards, UPI and netbanking at checkout.',
    scope: 'financial:read',
    planScope: 'orders:read',
    href: '/admin/financial?tab=razorpay',
    ownCredentials: {
      summary: 'By default your payments go through the platform Razorpay account and reach you as Route payouts. To collect on your own Razorpay account instead, ask for the switch in the owner portal, then enter your keys.',
      consoles: [{ label: 'Razorpay dashboard', url: 'https://dashboard.razorpay.com/' }],
      create: ['A Razorpay account with KYC activated', 'Live API keys (Key ID and Key Secret)', 'A webhook with a secret'],
      steps: [
        'Sign up on the Razorpay dashboard with your business email and mobile number.',
        'Fill in the activation form: business type (proprietorship, partnership, LLP or company), category, PAN, GSTIN, business address and your store’s web address. The site must show contact details, prices and the privacy, terms and refund pages.',
        'Add the settlement bank account (a current account in the business name; a proprietor’s own savings account also works) and upload what is asked for: PAN, address proof and a business proof such as the GST certificate.',
        'Wait for activation. Razorpay may email questions; answer them in the dashboard.',
        'Switch the dashboard to Live mode → Account & Settings → API Keys → Generate Key. Download the key file now: the Key Secret is shown only once.',
        'Account & Settings → Webhooks → Add New Webhook: paste the webhook URL shown on the Razorpay card in Financial, set a long random secret, and tick the events listed on the card.',
        'Ask for the switch to your own Razorpay account in the owner portal.',
        'Paste the Key ID, Key Secret and webhook secret on the Razorpay card. A test call checks them before they take effect.',
        'Place a small test order on your storefront and refund it from Financial to check both directions.',
      ],
      approval: [{ step: 'Razorpay activation (KYC)', wait: 'usually 2–5 working days' }],
      paste: { fields: ['Key ID', 'Key Secret', 'Webhook secret'], href: '/admin/financial?tab=razorpay', label: 'Open the Razorpay card' },
      rejections: ['Website missing policy pages or contact details', 'Business category not supported', 'Bank account name does not match the PAN'],
    },
  },
  {
    id: 'kyc-bank',
    section: 'payments',
    title: 'KYC and payout bank account',
    why: 'Payouts for your sales go to this account once KYC is approved.',
    scope: null,
    href: 'owner:/dashboard/payouts',
    tenantOnly: true,
  },
  {
    id: 'delhivery',
    section: 'payments',
    title: 'Delhivery and a pickup location',
    why: 'Books shipments, prints labels and tracks deliveries from the order page.',
    scope: 'delhivery:read',
    href: '/admin/delhivery',
    ownCredentials: {
      summary: 'Shipments go on the platform Delhivery account and are charged to your wallet. To ship on your own Delhivery account, switch in the owner portal and add your API token.',
      consoles: [{ label: 'Delhivery One', url: 'https://one.delhivery.com/' }],
      create: ['A Delhivery business account', 'An API token', 'A registered pickup warehouse'],
      steps: [
        'Sign up for Delhivery One with your business details, GSTIN and PAN, and finish the business verification (KYC).',
        'Add the bank account for COD remittances, and choose a prepaid wallet or (through an account manager) postpaid credit.',
        'In Delhivery One, add your pickup warehouse. Give it exactly the same name as the Pickup location name in Site Controls → Orders & delivery.',
        'Get the API token from the API settings in Delhivery One, or ask your account manager or Delhivery support to enable API access and share it.',
        'Owner portal → Delivery: choose your own Delhivery account and paste the token.',
        'Book a test shipment from an order and cancel it before pickup.',
      ],
      approval: [{ step: 'Delhivery account verification and API token', wait: '1–3 working days' }],
      paste: { fields: ['Delhivery API token'], href: 'owner:/dashboard/delivery', label: 'Open Delivery in the owner portal' },
      rejections: ['Pickup address does not match the registered warehouse name'],
    },
  },
  {
    id: 'cod',
    section: 'payments',
    title: 'Cash on delivery',
    why: 'Lets customers pay the courier. Turn it off if you only take prepaid orders.',
    scope: 'settings:read',
    href: '/admin/settings/site-controls?tab=payments',
    optional: true,
  },
  {
    id: 'shipping-rates',
    section: 'payments',
    title: 'Shipping charges',
    why: 'Free-delivery threshold and per-kg charges shown at checkout.',
    scope: 'settings:read',
    href: '/admin/settings/site-controls?tab=orders',
    optional: true,
  },
  {
    id: 'wallet',
    section: 'payments',
    title: 'Wallet balance',
    why: 'Platform shipping, SMS, WhatsApp and AI are paid from your wallet; a low balance pauses them.',
    scope: 'delhivery:read',
    planScope: 'orders:read',
    href: '/admin/wallet',
    tenantOnly: true,
  },

  // ── Catalogue ────────────────────────────────────────────────────────────
  {
    id: 'categories',
    section: 'catalogue',
    title: 'Your own categories',
    why: 'The starter category is a placeholder. Customers browse by category.',
    scope: 'categories:read',
    href: '/admin/categories',
  },
  {
    id: 'brands',
    section: 'catalogue',
    title: 'At least one brand',
    why: 'Brand pages and filters, and Google and Amazon listings need a brand.',
    scope: 'brands:read',
    href: '/admin/brands',
  },
  {
    id: 'products',
    section: 'catalogue',
    title: 'Real products with images',
    why: 'The starter products have no images and are placeholders. Products need images to sell and to list on Google or marketplaces.',
    scope: 'products:read',
    href: '/admin/products',
  },
  {
    id: 'hero',
    section: 'catalogue',
    title: 'Homepage banner with an image',
    why: 'The first thing visitors see. The starter banners have no image.',
    scope: 'settings:read',
    href: '/admin/settings/homepage',
  },
  {
    id: 'google-sheets',
    section: 'catalogue',
    title: 'Import products from Google Sheets',
    why: 'Keep your catalogue in a sheet and sync it.',
    scope: 'products:read',
    href: '/admin/data-source?tab=google_sheet',
    optional: true,
    ownCredentials: {
      summary: 'Sign in with Google uses the platform app. To use your own Google project, either share the sheet with a service account or paste a refresh token from your own OAuth client.',
      consoles: [GOOGLE_CLOUD, GOOGLE_AUTH, OAUTH_PLAYGROUND],
      create: ['A Google Cloud project with the Google Sheets API (and Google Drive API) enabled', 'Either a service account with a JSON key, or a Web OAuth client'],
      steps: [
        'Pick one way: a service account is simplest for reading a sheet; your own OAuth client acts as your own Google account.',
        'Service account: in Google Cloud, create a project (or pick one), then APIs & Services → Library → enable the Google Sheets API and the Google Drive API.',
        'IAM & Admin → Service accounts → Create service account. Give it a name; it needs no project roles.',
        'Open the service account → Keys → Add key → Create new key → JSON. The file downloads once; keep it safe.',
        'Open your Google Sheet → Share → add the service account’s email (it ends in iam.gserviceaccount.com) as a Viewer.',
        'Paste the spreadsheet URL and the JSON key in the Google Sheet tab.',
        'Own OAuth client instead:',
        ...googlePlaygroundSteps('Google Sheets API', 'https://www.googleapis.com/auth/spreadsheets.readonly'),
      ],
      register: [PLAYGROUND, STORE_PRIVACY, STORE_TERMS],
      permissions: [
        { name: 'spreadsheets.readonly', why: 'Read the rows to import.' },
        { name: 'drive.file', why: 'Only if you want the app to create a new sheet for you.' },
      ],
      paste: { fields: ['Spreadsheet ID or URL', 'Service account JSON, or client ID + client secret + refresh token'], href: '/admin/data-source?tab=google_sheet', label: 'Open the Google Sheet tab' },
      rejections: ['Refresh token stops working after 7 days: the consent screen is still in Testing'],
      notes: [GOOGLE_TESTING_NOTE],
    },
  },

  // ── Messaging ────────────────────────────────────────────────────────────
  {
    id: 'email',
    section: 'messaging',
    title: 'Email',
    why: 'Order and account emails go out from your store address. Nothing to set up.',
    scope: 'settings:read',
    href: '/admin/settings/site-controls?tab=notifications',
  },
  {
    id: 'sms',
    section: 'messaging',
    title: 'SMS',
    why: 'Order updates and sign-in codes by text. Billed from your wallet.',
    scope: 'settings:read',
    href: '/admin/settings/site-controls?tab=notifications',
    optional: true,
  },
  {
    id: 'whatsapp',
    section: 'messaging',
    title: 'WhatsApp',
    why: 'Order updates on WhatsApp, using templates Meta has approved.',
    scope: 'settings:read',
    href: '/admin/settings/site-controls?tab=notifications',
    optional: true,
  },
  {
    id: 'push',
    section: 'messaging',
    title: 'Push notifications',
    why: 'Browser and app notifications for order updates and offers.',
    scope: 'settings:read',
    href: '/admin/settings/site-controls?tab=notifications',
    optional: true,
  },

  // ── Sell on marketplaces ─────────────────────────────────────────────────
  {
    id: 'google-merchant',
    section: 'marketplaces',
    title: 'Google Merchant Center',
    why: 'Lists your products free on Google Shopping and feeds Shopping ads.',
    scope: 'merchant_sync:read',
    href: '/admin/merchant',
    connect: '/admin/merchant?connect=1',
    optional: true,
    ownCredentials: {
      summary: 'Connect with Google uses the platform app. You can instead use a service account from your own Google Cloud project, or your own OAuth client with a refresh token.',
      consoles: [{ label: 'Merchant Center', url: 'https://merchants.google.com/' }, GOOGLE_CLOUD, OAUTH_PLAYGROUND],
      create: ['A Google Cloud project with the Merchant API enabled', 'A service account with a JSON key (or a Web OAuth client)'],
      steps: [
        'In Google Cloud, create a project (or pick one), then APIs & Services → Library → enable the Merchant API.',
        'IAM & Admin → Service accounts → Create service account (no project roles needed), then Keys → Add key → Create new key → JSON.',
        'In Merchant Center → Settings (gear) → People and access → Add person: enter the service account’s email and give it Admin access.',
        'Note your Merchant Center ID, shown at the top right of Merchant Center.',
        'Paste the Merchant Center ID and the JSON key in the Merchant gear. On the first sync the Cloud project is registered with your Merchant Center account (the Merchant API "developer registration") for you.',
        'Own OAuth client instead: in the OAuth Playground, use your client with the scope https://www.googleapis.com/auth/content and copy the refresh token.',
      ],
      register: [PLAYGROUND, STORE_SITE],
      permissions: [{ name: 'content', why: 'Create and update your product listings.' }],
      approval: [{ step: 'Merchant Center website verification and claim', wait: 'minutes, once your domain is reachable' }, { step: 'Product review after the first sync', wait: 'up to 3 working days' }],
      paste: { fields: ['Merchant Center ID', 'Service account JSON (or client ID, client secret and refresh token)'], href: '/admin/merchant?connect=1', label: 'Open the Merchant gear' },
      rejections: ['Misrepresentation: missing contact details, return policy or secure checkout', 'Images with watermarks or placeholder images', 'Price or availability on the page differs from the feed'],
      notes: [GOOGLE_TESTING_NOTE],
    },
  },
  {
    id: 'amazon',
    section: 'marketplaces',
    title: 'Amazon Seller',
    why: 'Lists your products on Amazon.in and brings orders and stock in.',
    scope: 'amazon:read',
    href: '/admin/amazon',
    connect: '/admin/amazon?connect=1',
    optional: true,
    ownCredentials: {
      summary: 'For your own seller account you do not need a public app: register as a private developer and self-authorise a private SP-API app. It has no login or redirect URI.',
      consoles: [
        { label: 'Seller Central (India)', url: 'https://sellercentral.amazon.in/' },
        { label: 'Solution Provider Portal', url: 'https://solutionproviderportal.amazon.com/' },
        { label: 'Self-authorisation guide', url: 'https://developer-docs.amazon/sp-api/docs/self-authorization' },
      ],
      create: ['A developer profile (private developer, for your own business)', 'A draft SP-API app with the roles you need', 'A self-authorisation refresh token'],
      steps: [
        'Seller Central (India) → Apps and Services → Develop Apps → Proceed to Developer Profile.',
        'Fill in the profile as a private developer ("I build applications to integrate my company with Amazon Selling Partner APIs"): organisation, contact, the data you need and the data-protection questions.',
        'Pick the roles: Product Listing, Inventory and Order Tracking, Pricing, Finance and Accounting. Skip roles that need customer PII unless you ship orders through us.',
        'Wait for the profile to be approved (you get an email), then back in Develop Apps → Add new app client: name it, type SP-API, the same roles. It stays a draft; private apps are never published.',
        'On the app’s row, Edit → Authorize → Authorize app, choose the Amazon.in marketplace, and copy the refresh token shown.',
        'On the same row, View under LWA credentials: copy the client ID and client secret.',
        'Note your Seller ID (Merchant Token): Seller Central → Settings → Account Info → Your Merchant Token.',
        'In the Amazon gear, paste them all and set the host to Production (EU: sellingpartnerapi-eu.amazon.com); India is served from the EU region.',
      ],
      permissions: [
        { name: 'Product Listing', why: 'Create and update listings.' },
        { name: 'Inventory and Order Tracking', why: 'Read orders and push stock.' },
        { name: 'Pricing', why: 'Buy Box and repricer.' },
        { name: 'Finance and Accounting', why: 'Fees and settlements.' },
      ],
      approval: [{ step: 'Developer profile review', wait: 'a few days to 2 weeks' }],
      paste: { fields: ['Seller ID (Merchant Token)', 'LWA client ID', 'LWA client secret', 'Refresh token', 'SP-API host'], href: '/admin/amazon?connect=1', label: 'Open the Amazon gear' },
      rejections: ['Use case unclear: describe it as managing your own listings and orders', 'Restricted (PII) roles requested without a data-protection answer', 'Adding roles later needs a new authorisation (and a new refresh token)'],
      notes: ['Each "Authorize app" click makes a new refresh token; older ones keep working. An app allows up to 10 self-authorisations.'],
    },
  },
  {
    id: 'myntra',
    section: 'marketplaces',
    title: 'Myntra',
    why: 'Pulls Myntra orders in and pushes stock out.',
    scope: 'myntra:read',
    href: '/admin/myntra',
    connect: '/admin/myntra?connect=1',
    optional: true,
    ownCredentials: {
      summary: 'Myntra always uses your own seller credentials. API access is enabled by your Myntra account manager.',
      consoles: [{ label: 'Myntra Partner Portal', url: 'https://partners.myntrainfo.com/' }],
      create: ['API access on your seller account (PPMP C+L or OMNI model, not MDirect)', 'A Merchant ID and Secret Key', 'Your store IDs'],
      steps: [
        'Check your seller account is on the PPMP C+L or OMNI model. MDirect accounts cannot use the API; ask your account manager to move you if needed.',
        'Email your Myntra account manager to enable API (PPMP / Omni) integration for your seller account, and ask for the API documentation.',
        'Once enabled, generate the Merchant ID and Secret Key in the Myntra Partner Portal (your account manager will point you to the API settings). Note the Store / Warehouse ID of each warehouse you ship from.',
        'In the admin, open Myntra → connect panel. Paste the Merchant ID, the Secret Key and the store IDs (comma-separated). Set Mode to Sandbox for test credentials, or Live.',
        'Click Test. The connection switches to live after the first successful call.',
        'Copy the push URL and the push token from the connect panel and send both to your account manager, so Myntra sends orders to you as they happen.',
        'Wait for the next order (or a test order from Myntra) and check it appears under Orders.',
      ],
      register: [{ label: 'Push URL', value: { kind: 'store', path: '/api/webhooks/myntra' }, hint: 'Myntra sends order events here, with the token from the connect panel.' }],
      approval: [{ step: 'API enablement by your account manager', wait: 'varies; often 1–3 weeks' }],
      paste: { fields: ['Merchant ID', 'Secret Key', 'Store IDs'], href: '/admin/myntra?connect=1', label: 'Open the Myntra connect panel' },
      rejections: ['MDirect sellers cannot use the API'],
    },
  },
  {
    id: 'ajio',
    section: 'marketplaces',
    title: 'AJIO',
    why: 'Pulls AJIO purchase orders in, raises invoices and manifests.',
    scope: 'ajio:read',
    href: '/admin/ajio',
    connect: '/admin/ajio?connect=1',
    optional: true,
    ownCredentials: {
      summary: 'AJIO always uses your own seller credentials, issued through your AJIO account manager.',
      consoles: [{ label: 'AJIO seller (VMS)', url: 'https://seller.ajio.com/ajiocommerce/' }],
      create: ['VMS API credentials: Seller ID, password and POB ID'],
      steps: [
        'Email your AJIO account manager to enable VMS API integration for your seller account and to share the API documentation.',
        'They issue the API credentials: your Seller ID, a password and the POB ID (it starts with DV).',
        'In the admin, open AJIO → connect panel, paste the Seller ID, password and POB ID, and set the Mode.',
        'Click Test. The connection switches to live after the first successful call.',
        'Copy the push URL and push token from the connect panel and send both to your account manager so purchase orders reach you as they happen.',
        'Wait for the next purchase order and check it appears under Orders.',
      ],
      register: [{ label: 'Push URL', value: { kind: 'store', path: '/api/webhooks/ajio' } }],
      approval: [{ step: 'API credentials from your account manager', wait: 'varies; often 1–3 weeks' }],
      paste: { fields: ['Seller ID', 'Password', 'POB ID'], href: '/admin/ajio?connect=1', label: 'Open the AJIO connect panel' },
    },
  },

  // ── Advertise ────────────────────────────────────────────────────────────
  {
    id: 'google-ads',
    section: 'advertise',
    title: 'Google Ads',
    why: 'Runs and reports Search, Shopping and Performance Max campaigns, and uploads conversions.',
    scope: 'google_ads:read',
    href: '/admin/google-ads',
    connect: '/admin/google-ads?connect=1',
    optional: true,
    ownCredentials: {
      summary: 'Connect with Google uses the platform app. Your own credentials are pasted in, not signed in: your own OAuth client cannot list our callback without verifying our domain, so you generate the refresh token in Google’s OAuth Playground.',
      consoles: [{ label: 'Google Ads', url: 'https://ads.google.com/' }, GOOGLE_CLOUD, GOOGLE_AUTH, OAUTH_PLAYGROUND],
      create: ['A Google Cloud project with the Google Ads API enabled and API access approved', 'A Web OAuth client', 'A refresh token for the Google account that can see your ads account'],
      steps: [
        'Note your Google Ads customer ID (10 digits, top right in Google Ads) and, if you use one, the manager (MCC) account ID.',
        'In Google Cloud, create a project, then APIs & Services → Library → enable the Google Ads API.',
        'Google Auth Platform → Branding: app name, support email, home page and the privacy and terms URLs below. Audience: External, then Publish app.',
        'Google Auth Platform → Clients → Create client → Web application. Add the Playground redirect below and copy the client ID and secret.',
        'Open the OAuth Playground → gear → tick "Use your own OAuth credentials" and paste the client ID and secret.',
        'Step 1: enter the scope https://www.googleapis.com/auth/adwords → Authorize APIs → sign in with the Google account that can open your ads account → Allow (click through "unverified app" for your own account).',
        'Step 2: Exchange authorization code for tokens, and copy the refresh token.',
        'The project starts with Explorer access (production use with a small daily limit). For more, verify your brand on the consent screen, then on the Google Ads API Overview page apply for Basic access with your company site, use case and a short tool design document.',
        'Paste the client ID, client secret, refresh token, customer ID and login-customer (manager) ID in the Google Ads gear.',
      ],
      register: [PLAYGROUND, STORE_PRIVACY, STORE_TERMS],
      permissions: [{ name: 'adwords', why: 'Read reports, manage campaigns and upload conversions.' }],
      approval: [
        { step: 'Explorer access', wait: 'automatic' },
        { step: 'Brand verification of the consent screen', wait: '2–3 working days' },
        { step: 'Basic access', wait: 'a few working days' },
        { step: 'Standard access (only for very large accounts)', wait: 'about 10 working days' },
      ],
      paste: { fields: ['Client ID', 'Client secret', 'Refresh token', 'Customer ID', 'Login-customer (manager) ID', 'Developer token (optional, legacy)'], href: '/admin/google-ads?connect=1', label: 'Open the Google Ads gear' },
      rejections: ['Basic access refused: tool design document does not match what the tool does', 'Brand not verified on the consent screen', 'Refresh token stops after 7 days: the consent screen is still in Testing'],
      notes: [
        GOOGLE_TESTING_NOTE,
        'Google retired developer tokens on 9 September 2026: API access now belongs to the Cloud project that owns your OAuth client. A developer token is accepted but ignored.',
      ],
    },
  },
  {
    id: 'amazon-ads',
    section: 'advertise',
    title: 'Amazon Ads',
    why: 'Sponsored Products reports, bids and budgets for your Amazon listings.',
    scope: 'amazon_ads:read',
    href: '/admin/amazon-ads',
    connect: '/admin/amazon-ads?connect=1',
    optional: true,
    ownCredentials: {
      summary: 'Sign in with Amazon uses the platform app. To use your own, create a Login with Amazon security profile, get Amazon Ads API access for it, and sign in through it.',
      consoles: [
        { label: 'Login with Amazon console', url: 'https://developer.amazon.com/loginwithamazon/console/site/lwa/overview.html' },
        { label: 'Amazon Ads API onboarding', url: 'https://advertising.amazon.com/API/docs/en-us/guides/onboarding/overview' },
      ],
      create: ['A Login with Amazon security profile', 'Amazon Ads API access assigned to that profile'],
      steps: [
        'Login with Amazon console → Create a New Security Profile: a name, a description, your privacy policy URL (below) and a logo. Save.',
        'Open the profile → Show client ID and client secret, and copy both.',
        'Web Settings → Edit → Allowed Return URLs: add the return URL below.',
        'Apply for Amazon Ads API access as a direct advertiser (onboarding guide), signed in with the same Amazon account that owns the security profile.',
        'When the approval email arrives, open its link and assign API access to this security profile. It cannot be moved later, so pick the right one.',
        'In the Amazon Ads gear, enter the client ID and client secret, sign in with Amazon, and choose the Amazon.in advertising profile.',
      ],
      register: [{ label: 'Allowed return URL', value: { kind: 'oauth', provider: 'amazon_ads' } }, STORE_PRIVACY],
      permissions: [{ name: 'advertising::campaign_management', why: 'Read reports and manage campaigns.' }],
      approval: [{ step: 'Amazon Ads API access', wait: 'usually 1 working day' }],
      paste: { fields: ['Client ID', 'Client secret', 'Refresh token (if entering by hand)', 'Profile ID'], href: '/admin/amazon-ads?connect=1', label: 'Open the Amazon Ads gear' },
      rejections: ['"unknown scope": the security profile has not been assigned Ads API access yet', 'Applied with a different email than the security profile'],
    },
  },
  {
    id: 'meta-ads',
    section: 'advertise',
    title: 'Meta Ads and the Conversions API',
    why: 'Facebook and Instagram ad reports and campaigns, and server-side purchase events for better attribution.',
    scope: 'meta_ads:read',
    href: '/admin/meta-ads',
    connect: '/admin/meta-ads?connect=1',
    optional: true,
    ownCredentials: {
      summary: 'Continue with Facebook uses the platform app. You can use your own Meta app instead; the same app also serves Social Posts.',
      consoles: [
        { label: 'Meta for Developers', url: 'https://developers.facebook.com/apps/' },
        { label: 'Facebook Login for Business', url: 'https://developers.facebook.com/docs/facebook-login/facebook-login-for-business' },
        { label: 'Business Settings (verification)', url: 'https://business.facebook.com/settings/security' },
      ],
      create: ['A Business-type Meta app with Facebook Login for Business and the Marketing API', 'A Facebook Login for Business configuration for ads (gives a configuration ID)', 'A pixel and a Conversions API access token'],
      steps: [
        'Meta for Developers → My Apps → Create app. Pick the "Create & manage ads with Marketing API" use case, app type Business, and link your business portfolio.',
        'Facebook Login for Business → Configurations → Create configuration: token type User access token, assets Ad accounts, and the ads permissions below. Copy its configuration ID.',
        'Facebook Login for Business → Settings: add the valid OAuth redirect URI below.',
        'App settings → Basic: add the app domain, privacy policy URL, terms URL, and the data deletion and deauthorize callbacks below. Copy the App ID and App Secret.',
        'App roles → Roles: add everyone who will connect as an admin or developer. With Standard access only people with a role can sign in.',
        'Switch the app to Live mode.',
        'In the Meta Ads gear, under "Use your own Meta app", enter the App ID, App Secret and configuration ID, Verify, then Continue with Facebook and pick the ad account.',
        'Events Manager → your dataset (pixel) → Settings → Conversions API → Generate access token. Paste the pixel ID and token in the gear.',
      ],
      register: [
        { label: 'Valid OAuth redirect URI', value: { kind: 'oauth', provider: 'meta_ads' } },
        STORE_SITE,
        STORE_PRIVACY,
        STORE_TERMS,
        { label: 'Data deletion callback URL', value: { kind: 'platform', path: '/api/meta/data-deletion' } },
        { label: 'Deauthorize callback URL', value: { kind: 'platform', path: '/api/meta/deauthorize' } },
      ],
      permissions: [
        { name: 'ads_read', why: 'Read campaign reports.' },
        { name: 'ads_management', why: 'Create and edit campaigns and budgets.' },
        { name: 'business_management', why: 'List the ad accounts your business owns.' },
      ],
      approval: [
        { step: 'Standard access: enough when you only connect ad accounts your own business owns and you have a role on the app', wait: 'none' },
        { step: 'Business Verification (needed for Advanced access)', wait: '1–5 working days' },
        { step: 'App Review for Advanced access, one permission at a time with a screencast', wait: 'about 5 working days, sometimes longer' },
      ],
      paste: { fields: ['App ID', 'App Secret', 'Login configuration ID', 'Pixel ID', 'Conversions API token'], href: '/admin/meta-ads?connect=1', label: 'Open the Meta Ads gear' },
      rejections: ['Screencast does not show the permission being used', 'Reviewer cannot log in: give test credentials', 'Privacy policy URL unreachable or missing a data-deletion section', 'Requesting permissions the app does not use'],
    },
  },
  {
    id: 'myntra-ads',
    section: 'advertise',
    title: 'Myntra Ads',
    why: 'Import Myntra ad reports to see spend, sales and ACoS next to your orders.',
    scope: 'myntra_ads:read',
    href: '/admin/myntra-ads',
    optional: true,
  },
  {
    id: 'ajio-ads',
    section: 'advertise',
    title: 'AJIO Ads',
    why: 'Import AJIO ad reports to see spend, sales and ACoS next to your orders.',
    scope: 'ajio_ads:read',
    href: '/admin/ajio-ads',
    optional: true,
  },

  // ── Social ───────────────────────────────────────────────────────────────
  {
    id: 'facebook-instagram',
    section: 'social',
    title: 'Facebook Page and Instagram',
    why: 'Schedule posts, auto-post new products and answer comments from one inbox.',
    scope: 'social:read',
    href: '/admin/social-posts?tab=accounts',
    optional: true,
    ownCredentials: {
      summary: 'Continue with Facebook uses the platform app. To use your own Meta app, add it in the Social Posts gear; the same app can serve Meta Ads.',
      consoles: [{ label: 'Meta for Developers', url: 'https://developers.facebook.com/apps/' }],
      create: ['A Business-type Meta app with the "Manage everything on your Page" use case', 'A Facebook Login for Business configuration for Pages and Instagram'],
      steps: [
        'Meta for Developers → My Apps → Create app. Pick the "Manage everything on your Page" use case (and the Instagram one), app type Business, and link your business portfolio. The Meta Ads app can be reused instead.',
        'Facebook Login for Business → Configurations → Create configuration with the Page and Instagram permissions below. Copy its configuration ID.',
        'Facebook Login for Business → Settings: add the redirect URI below. App settings → Basic: add the domain, policy URLs and the data deletion and deauthorize callbacks. Copy the App ID and App Secret.',
        'App roles → Roles: add everyone who will connect; with Standard access only people with a role can sign in. Then switch the app to Live mode.',
        'Link your Instagram professional account to your Facebook Page in Meta Business Suite → Settings → Instagram accounts.',
        'In the Social Posts gear, enter the App ID, App Secret and configuration ID, then Continue with Facebook and pick the Page.',
      ],
      register: [
        { label: 'Valid OAuth redirect URI', value: { kind: 'oauth', provider: 'meta' } },
        STORE_SITE,
        STORE_PRIVACY,
        STORE_TERMS,
        { label: 'Data deletion callback URL', value: { kind: 'platform', path: '/api/meta/data-deletion' } },
        { label: 'Deauthorize callback URL', value: { kind: 'platform', path: '/api/meta/deauthorize' } },
      ],
      permissions: [
        { name: 'pages_show_list, pages_manage_posts, pages_read_engagement', why: 'List your Pages and publish to them.' },
        { name: 'instagram_basic, instagram_content_publish', why: 'Publish to Instagram.' },
        { name: 'read_insights, instagram_manage_insights', why: 'Post reach and engagement.' },
        { name: 'pages_read_user_content, pages_manage_engagement, instagram_manage_comments', why: 'Read and reply to comments in the inbox.' },
      ],
      approval: [
        { step: 'Standard access: enough for Pages your own business manages when you have a role on the app', wait: 'none' },
        { step: 'Business Verification and App Review for Advanced access', wait: '1–2 weeks in total' },
      ],
      paste: { fields: ['App ID', 'App Secret', 'Login configuration ID'], href: '/admin/social-posts?tab=accounts', label: 'Open Social Posts accounts' },
      rejections: ['Instagram account is personal, not professional, or not linked to the Page', 'Screencast missing the publish flow'],
    },
  },
  {
    id: 'gbp',
    section: 'social',
    title: 'Google Business Profile',
    why: 'Post updates and offers to your Google Maps listing.',
    scope: 'social:read',
    href: '/admin/social-posts?tab=accounts',
    optional: true,
    ownCredentials: {
      summary: 'Sign in with Google uses the platform app. Your own project needs Business Profile API access, which Google grants on request.',
      consoles: [{ label: 'Business Profile API prerequisites', url: 'https://developers.google.com/my-business/content/prereqs' }, GOOGLE_CLOUD, OAUTH_PLAYGROUND],
      create: ['A Google Cloud project approved for the Business Profile APIs', 'A Web OAuth client', 'A refresh token'],
      steps: [
        'Make sure the profile has been verified and active for 60 days or more, and lists your website.',
        'In Google Cloud, create a project and note its project number (Dashboard → Project info).',
        'Submit the Business Profile API contact form, choose "Application for Basic API Access" and give the project number. Apply from an email that is an owner or manager on the profile.',
        'After approval (the API quota changes from 0 to 300 per minute), enable the My Business Account Management API and Business Information API in the project.',
        ...googlePlaygroundSteps('My Business Account Management API and Business Information API', 'https://www.googleapis.com/auth/business.manage').slice(1),
        'Paste the refresh token, client ID and secret, and your location ID, in the Social Posts gear.',
      ],
      register: [PLAYGROUND, STORE_PRIVACY, STORE_TERMS],
      permissions: [{ name: 'business.manage', why: 'Post to your profile and read its locations.' }],
      approval: [{ step: 'Business Profile API access', wait: 'a few days to a few weeks; you get an email' }],
      paste: { fields: ['Refresh token', 'Client ID', 'Client secret', 'Location ID'], href: '/admin/social-posts?tab=accounts', label: 'Open Social Posts accounts' },
      rejections: ['Profile verified for less than 60 days', 'Applying email is not an owner or manager of the profile', 'No website on the profile'],
      notes: [GOOGLE_TESTING_NOTE],
    },
  },
  {
    id: 'youtube',
    section: 'social',
    title: 'YouTube',
    why: 'Upload product videos and Shorts to your channel.',
    scope: 'social:read',
    href: '/admin/social-posts?tab=accounts',
    optional: true,
    ownCredentials: {
      summary: 'Sign in with Google uses the platform app. Your own project uses the YouTube Data API with a refresh token from the OAuth Playground.',
      consoles: [GOOGLE_CLOUD, OAUTH_PLAYGROUND, { label: 'YouTube API audit and quota form', url: 'https://support.google.com/youtube/contact/yt_api_form' }],
      create: ['A Google Cloud project with the YouTube Data API v3 enabled', 'A Web OAuth client', 'A refresh token'],
      steps: [
        ...googlePlaygroundSteps('YouTube Data API v3', 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'),
        'Paste the refresh token, client ID and secret and your channel ID in the Social Posts gear.',
      ],
      register: [PLAYGROUND, STORE_PRIVACY, STORE_TERMS],
      permissions: [
        { name: 'youtube.upload', why: 'Upload videos.' },
        { name: 'youtube.readonly', why: 'Read the channel and video stats.' },
        { name: 'youtube.force-ssl', why: 'Read and reply to comments.' },
      ],
      approval: [{ step: 'Audit and quota extension, only if you need more than the default daily quota', wait: 'weeks; not guaranteed' }],
      paste: { fields: ['Refresh token', 'Client ID', 'Client secret', 'Channel ID'], href: '/admin/social-posts?tab=accounts', label: 'Open Social Posts accounts' },
      rejections: ['Uploads forced to private: older unaudited projects may still be restricted until the audit passes'],
      notes: [GOOGLE_TESTING_NOTE],
    },
  },
  {
    id: 'pinterest',
    section: 'social',
    title: 'Pinterest',
    why: 'Pin your products to your boards.',
    scope: 'social:read',
    href: '/admin/social-posts?tab=accounts',
    optional: true,
    ownCredentials: {
      summary: 'Sign in with Pinterest uses the platform app. Your own app starts on Trial access, where Pins are visible only to you; Standard access makes them public.',
      consoles: [{ label: 'Pinterest developer apps', url: 'https://developers.pinterest.com/apps/' }, { label: 'Access tiers', url: 'https://developers.pinterest.com/docs/key-concepts/access-tiers/' }],
      create: ['A Pinterest business account', 'A developer app (Trial access)'],
      steps: [
        'Convert to a Pinterest business account if you have not already.',
        'On developers.pinterest.com → My apps → Connect app: name, description, your website and privacy policy URL. Trial access is usually granted in 1–2 working days.',
        'Open the app → add the redirect URI below, and copy the App ID and app secret.',
        'Sign in through the app once and create a test Pin; on Trial access it is visible only to you.',
        'Click Upgrade on the app card and upload a video showing the full sign-in (consent screen) and a Pin being created.',
        'Paste the App ID and secret with your tokens and board ID in the Social Posts gear.',
      ],
      register: [{ label: 'Redirect URI', value: { kind: 'social' } }, STORE_PRIVACY],
      permissions: [
        { name: 'boards:read, user_accounts:read', why: 'Pick the board.' },
        { name: 'pins:read, pins:write', why: 'Create Pins.' },
      ],
      approval: [{ step: 'Trial access', wait: '1–2 working days' }, { step: 'Standard access (video review)', wait: '1–4 weeks' }],
      paste: { fields: ['Access token', 'Refresh token', 'App ID', 'App secret', 'Board ID'], href: '/admin/social-posts?tab=accounts', label: 'Open Social Posts accounts' },
      rejections: ['Demo video does not show the sign-in flow', 'Demo video does not show a live Pin being created'],
    },
  },
  {
    id: 'linkedin',
    section: 'social',
    title: 'LinkedIn Page',
    why: 'Post updates to your company Page.',
    scope: 'social:read',
    href: '/admin/social-posts?tab=accounts',
    optional: true,
    ownCredentials: {
      summary: 'Sign in with LinkedIn uses the platform app. Posting as a Page needs the Community Management API, which LinkedIn grants on a new, dedicated app.',
      consoles: [{ label: 'LinkedIn developer apps', url: 'https://www.linkedin.com/developers/apps' }, { label: 'Increasing access', url: 'https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access' }],
      create: ['A new LinkedIn app linked to your company Page, with no other products on it', 'Community Management API access (Development tier, then Standard)'],
      steps: [
        'Create a new app on LinkedIn Developers: name, your company Page and logo. Ask a Page admin to verify the app (Settings → Verify).',
        'Products → request Community Management API. It must be the only product on the app.',
        'Auth tab → add the redirect URL below, and copy the client ID and client secret.',
        'The Development tier allows testing with up to 500 calls a day. For production, fill in the Standard tier form with a screen recording of each use case.',
        'Paste the client ID and secret with your tokens and organization URN in the Social Posts gear.',
      ],
      register: [{ label: 'Authorized redirect URL', value: { kind: 'social' } }, STORE_PRIVACY],
      permissions: [
        { name: 'w_organization_social', why: 'Post as the Page.' },
        { name: 'r_organization_social, rw_organization_admin', why: 'Read Page posts and pick the Page.' },
      ],
      approval: [
        { step: 'Development tier (500 calls a day)', wait: 'a few days' },
        { step: 'Standard tier (screen recording review)', wait: '1–4 weeks' },
      ],
      paste: { fields: ['Access token', 'Refresh token', 'Client ID', 'Client secret', 'Organization URN'], href: '/admin/social-posts?tab=accounts', label: 'Open Social Posts accounts' },
      rejections: ['Requested on an app that already has other products', 'Not a registered business or no verified business email', 'Screen recording does not cover every use case in the form'],
    },
  },
  {
    id: 'x',
    section: 'social',
    title: 'X (Twitter)',
    why: 'Post product updates to your X account.',
    scope: 'social:read',
    href: '/admin/social-posts?tab=accounts',
    optional: true,
    ownCredentials: {
      summary: 'Sign in with X uses the platform app. X has no free tier now: your own app is pay-per-use, from credits you buy in the X developer console.',
      consoles: [{ label: 'X developer console', url: 'https://console.x.com/' }],
      create: ['A project and app in the X developer console', 'Credits for pay-per-use', 'OAuth 2.0 user authentication (Web App)'],
      steps: [
        'Sign in to the X developer console, create a project and an app, and buy credits (pay-per-use).',
        'App → User authentication settings → Set up: OAuth 2.0, type "Web App", app permissions Read and write, with the callback URI and website URL below.',
        'Keys and tokens tab: copy the OAuth 2.0 client ID and client secret.',
        'Paste them with your tokens and user ID in the Social Posts gear.',
      ],
      register: [{ label: 'Callback URI', value: { kind: 'social' } }, STORE_SITE],
      permissions: [
        { name: 'tweet.read, tweet.write, users.read', why: 'Post and read your posts.' },
        { name: 'media.write', why: 'Attach product images.' },
        { name: 'offline.access', why: 'Stay connected without signing in again.' },
      ],
      approval: [{ step: 'None; posts are charged per request from your credits', wait: 'none' }],
      paste: { fields: ['Access token', 'Refresh token', 'Client ID', 'Client secret', 'User ID'], href: '/admin/social-posts?tab=accounts', label: 'Open Social Posts accounts' },
      rejections: ['Calls fail with a payment error once credits run out'],
    },
  },

  // ── Tax documents ────────────────────────────────────────────────────────
  {
    id: 'ewaybill',
    section: 'tax',
    title: 'E-way bill API access',
    why: 'Generates e-way bills for shipments above ₹50,000 straight from the order.',
    scope: 'gst:read',
    href: '/admin/gst',
    optional: true,
    ownCredentials: {
      summary: 'E-way bills are generated under your own GSTIN, so you need your own API user on the e-way bill portal, created through a GST Suvidha Provider (GSP). Until you add it, the store cannot generate e-way bills.',
      consoles: [{ label: 'E-way bill portal', url: 'https://ewaybillgst.gov.in/' }],
      create: ['An e-way bill portal login for your GSTIN', 'An API user for your GSP', 'The GSP client ID and client secret'],
      steps: [
        'Pick a GST Suvidha Provider (GSP) and sign up with them for e-way bill API access. They give you a client ID, client secret and their API base URL.',
        'Log in to the e-way bill portal. Registration → For GSP → choose your GSP, then Send OTP and verify it on your GST mobile.',
        'Create the API username and password there (the portal adds a prefix to the username).',
        'Open GST → credentials gear (top right) → E-way bill API section. Enter the API username and password, the GSP client ID and client secret, and the GSP’s API base URL. The GSTIN comes from your store settings.',
        'Click Test.',
      ],
      approval: [{ step: 'API user creation on the portal', wait: 'immediate' }, { step: 'GSP onboarding', wait: '1–3 working days' }],
      paste: { fields: ['API username', 'API password', 'GSP client ID', 'GSP client secret', 'GSP API base URL'], href: '/admin/gst', label: 'Open GST (credentials gear, top right)' },
      rejections: ['GSTIN in store settings differs from the portal login', 'API user created for a different GSP than the credentials'],
    },
  },
  {
    id: 'einvoice',
    section: 'tax',
    title: 'E-invoice (IRN) API access',
    why: 'Registers B2B invoices with the IRP and prints the IRN and QR. Required above ₹5 crore turnover.',
    scope: 'gst:read',
    href: '/admin/gst',
    optional: true,
    ownCredentials: {
      summary: 'E-invoices are registered under your own GSTIN, through your own API user on the e-invoice portal (via a GSP). Until you add it, the store cannot generate e-invoices.',
      consoles: [{ label: 'E-invoice portal (IRP)', url: 'https://einvoice1.gst.gov.in/' }],
      create: ['E-invoice enablement for your GSTIN', 'An API user for your GSP', 'The GSP client ID and client secret'],
      steps: [
        'Check your GSTIN is enabled for e-invoicing (portal: Search → e-Invoice status). If eligible but not enabled, use self-enablement on the same portal.',
        'Pick a GST Suvidha Provider (GSP) and sign up with them for e-invoice API access. They give you a client ID, client secret and their API base URL.',
        'Log in to the e-invoice portal (your e-way bill login works) → API Registration → User Credentials → Create API User → Through GSP. Pick the GSP, verify the OTP, and set a username and password.',
        'Open GST → credentials gear (top right) → E-invoice (IRP) API section. Enter the API username and password, the GSP client ID and client secret, and the GSP’s production API base URL. The GSTIN comes from your store settings.',
        'Click Test.',
      ],
      approval: [{ step: 'API user creation', wait: 'immediate' }, { step: 'GSP onboarding', wait: '1–3 working days' }],
      paste: { fields: ['API username', 'API password', 'GSP client ID', 'GSP client secret', 'GSP API base URL'], href: '/admin/gst', label: 'Open GST (credentials gear, top right)' },
      rejections: ['GSTIN not enabled for e-invoicing yet', 'One API user per GSP: reuse the one you created, or reset its password'],
      notes: ['Direct integration with the IRP (without a GSP) is only for very large taxpayers with a static IP.'],
    },
  },

  // ── Developers ───────────────────────────────────────────────────────────
  {
    id: 'service-accounts',
    section: 'developers',
    title: 'Service accounts',
    why: 'Let your own systems call the admin API with a certificate and limited scopes.',
    scope: 'service_accounts:read',
    href: '/admin/settings?tab=service-accounts',
    optional: true,
  },
  {
    id: 'cli',
    section: 'developers',
    title: 'Command-line tool (CLI)',
    why: 'Manage products, orders and more from your terminal with `jeffi login`.',
    scope: 'settings:read',
    href: '/admin/settings?tab=cli',
    optional: true,
  },
]

export const STEP_IDS = new Set(STEPS.map(s => s.id))

// ── Platform apps (administrators, flagship only) ─────────────────────────

export interface PlatformItem {
  id: string
  title: string
  why: string
  /** Keys the admin-service process must hold. */
  env: string[]
  /** Having all keys means it works (no separate approval to track). */
  doneWhenKeys?: boolean
  consoles: GuideLink[]
  steps: string[]
  register?: RegisterItem[]
  approval?: ApprovalStep[]
  rejections?: string[]
}

const PLATFORM_PRIVACY: RegisterItem = { label: 'Privacy policy URL', value: { kind: 'store', path: '/legal/privacy-policy' } }
const PLATFORM_TERMS: RegisterItem = { label: 'Terms of service URL', value: { kind: 'store', path: '/legal/terms-and-conditions' } }

export const PLATFORM_ITEMS: PlatformItem[] = [
  {
    id: 'google-ads-access',
    title: 'Google Ads API access (Basic / Standard)',
    why: 'Stores that connect Google Ads with one click run on the platform Cloud project’s access level.',
    env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    consoles: [{ label: 'Google Ads API Overview (Cloud console)', url: 'https://console.cloud.google.com/apis/api/googleads.googleapis.com/overview' }],
    steps: [
      'Developer tokens were retired on 9 September 2026; API access now belongs to the Cloud project that owns GOOGLE_OAUTH_CLIENT_ID.',
      'Complete brand verification on the consent screen first (see the next item); Basic access needs it.',
      'Open the Google Ads API Overview page for that project and check it shows Explorer access.',
      'Apply for Basic access: company website, how stores use the tool (reports, campaign management and conversion uploads for their own accounts), and a tool design document with screenshots of the Google Ads pages.',
      'Apply for Standard only when the daily operation limit is hit; expect a manual audit.',
    ],
    approval: [{ step: 'Basic access', wait: 'a few working days' }, { step: 'Standard access', wait: 'about 10 working days' }],
    rejections: ['Tool design document does not match the product', 'Brand not verified'],
  },
  {
    id: 'google-oauth-verification',
    title: 'Google OAuth consent and sensitive-scope verification',
    why: 'Without it stores see the "unverified app" warning and the 100-user cap applies.',
    env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    consoles: [GOOGLE_AUTH],
    steps: [
      'Google Auth Platform → Branding: app name, logo, support email, home page, privacy and terms URLs, all on a domain verified in Search Console. Submit for brand verification.',
      'Audience: External, In production.',
      'Data Access: add the scopes the platform uses (adwords, content, business.manage, the YouTube scopes, spreadsheets.readonly and drive.file), each with a short justification.',
      'Record one demo video (unlisted on YouTube): the consent screen showing the app name and the client ID in the address bar, then each scope being used in the admin.',
      'Submit for verification and answer the reviewer emails from the Verification Center.',
      'Clients → the platform web client → Authorised redirect URIs: add the callback URIs below.',
    ],
    register: [
      { label: 'Google callback (Merchant and Ads)', value: { kind: 'oauth', provider: 'google_merchant' } },
      { label: 'Social networks callback (Business Profile, YouTube)', value: { kind: 'social' } },
      { label: 'Data Source (Sheets) callback', value: { kind: 'platform', path: '/api/admin/data-source/google/callback' } },
      PLATFORM_PRIVACY,
      PLATFORM_TERMS,
    ],
    approval: [{ step: 'Brand verification', wait: '2–3 working days' }, { step: 'Sensitive-scope verification', wait: '3–6 weeks' }],
    rejections: ['Demo video does not show the consent screen and each scope in use', 'Home page does not explain the app or link the privacy policy'],
  },
  {
    id: 'gbp-api-access',
    title: 'Business Profile API access',
    why: 'Stores posting to Google Business Profile with one click need the platform project approved.',
    env: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    consoles: [{ label: 'Prerequisites and request form', url: 'https://developers.google.com/my-business/content/prereqs' }],
    steps: [
      'Apply from an owner or manager email of a Business Profile that has been verified and active for 60 days or more and lists the platform website.',
      'Submit the Business Profile API contact form → "Application for Basic API Access" with the platform Cloud project number.',
      'After approval (quota changes from 0 to 300 per minute), enable the My Business Account Management API, the Business Information API and the Google My Business API (used for posts).',
      'Add business.manage to the consent screen scopes.',
    ],
    approval: [{ step: 'Basic API access', wait: 'days to weeks' }],
  },
  {
    id: 'meta-app',
    title: 'Meta App Review, Business Verification and data deletion',
    why: 'One-click Facebook, Instagram and Meta Ads for stores need Advanced access on the platform app.',
    env: ['META_APP_ID', 'META_APP_SECRET'],
    consoles: [{ label: 'Meta for Developers', url: 'https://developers.facebook.com/apps/' }, { label: 'Business Settings', url: 'https://business.facebook.com/settings/security' }],
    steps: [
      'App settings → Basic: app domains, privacy policy and terms URLs, category, icon, and the data deletion callback below.',
      'Facebook Login for Business → Settings: add both redirect URIs below, and set the deauthorize callback URL.',
      'If the app is Business-type, create two configurations (Social: the Page and Instagram permissions; Ads: ads_read, ads_management and business_management) and set META_LOGIN_CONFIG_ID and META_ADS_LOGIN_CONFIG_ID.',
      'Business Settings → Security Center → Start verification: legal name, address, phone and website matching the registration documents (GST or incorporation certificate).',
      'App Review → Permissions and features: request Advanced access for each permission with a description of its use and a screencast of it in the admin. Give the reviewer a test login.',
      'Switch the app to Live mode, and check META_APP_ID and META_APP_SECRET are set for admin-service.',
    ],
    register: [
      { label: 'Social Posts redirect URI', value: { kind: 'oauth', provider: 'meta' } },
      { label: 'Meta Ads redirect URI', value: { kind: 'oauth', provider: 'meta_ads' } },
      { label: 'Data deletion callback URL', value: { kind: 'platform', path: '/api/meta/data-deletion' } },
      { label: 'Deauthorize callback URL', value: { kind: 'platform', path: '/api/meta/deauthorize' } },
      PLATFORM_PRIVACY,
    ],
    approval: [{ step: 'Business Verification', wait: '1–5 working days' }, { step: 'App Review', wait: 'about 5 working days per round' }],
    rejections: ['Screencast missing a permission in use', 'Reviewer could not log in'],
  },
  {
    id: 'amazon-sp-public',
    title: 'Amazon SP-API public app',
    why: 'Lets stores connect Amazon Seller with one click instead of a private app.',
    env: ['AMAZON_SP_APP_ID', 'AMAZON_LWA_APP_CLIENT_ID', 'AMAZON_LWA_APP_CLIENT_SECRET'],
    consoles: [{ label: 'Solution Provider Portal', url: 'https://solutionproviderportal.amazon.com/' }],
    steps: [
      'Solution Provider Portal → register as a public developer: organisation, the roles needed, and the data-protection and security answers.',
      'After approval, create the SP-API app with a login URI on the platform site and the OAuth redirect URI below.',
      'Test the full authorisation on one seller account while the app is in draft.',
      'List the app in the Selling Partner Appstore, or keep it unlisted and share the authorisation link.',
      'Set AMAZON_SP_APP_ID, AMAZON_LWA_APP_CLIENT_ID and AMAZON_LWA_APP_CLIENT_SECRET.',
    ],
    register: [{ label: 'OAuth redirect URI', value: { kind: 'oauth', provider: 'amazon_seller' } }],
    approval: [{ step: 'Public developer profile and app review', wait: '2–4 weeks' }],
  },
  {
    id: 'amazon-ads-access',
    title: 'Amazon Ads API access',
    why: 'Lets stores sign in to Amazon Ads through the platform app.',
    env: ['AMAZON_ADS_CLIENT_ID', 'AMAZON_ADS_CLIENT_SECRET'],
    consoles: [{ label: 'Amazon Ads API onboarding', url: 'https://advertising.amazon.com/API/docs/en-us/guides/onboarding/overview' }],
    steps: [
      'Login with Amazon console → create the platform security profile with the privacy policy URL and a logo, and add the return URL below under Web Settings.',
      'Apply for Amazon Ads API access as a partner (tool provider) with the company details and use case.',
      'When approved, open the link in the email and assign API access to the platform security profile. This is permanent.',
      'Set AMAZON_ADS_CLIENT_ID and AMAZON_ADS_CLIENT_SECRET.',
    ],
    register: [{ label: 'Allowed return URL', value: { kind: 'oauth', provider: 'amazon_ads' } }],
    approval: [{ step: 'API access', wait: 'about 1 working day' }],
  },
  {
    id: 'pinterest-standard',
    title: 'Pinterest Standard access',
    why: 'On Trial access, Pins stores create are visible only to them.',
    env: ['PINTEREST_APP_ID', 'PINTEREST_APP_SECRET'],
    consoles: [{ label: 'Pinterest apps', url: 'https://developers.pinterest.com/apps/' }],
    steps: [
      'On the platform app (developers.pinterest.com → My apps), add the redirect URI below, the website and the privacy policy URL.',
      'Sign in through the app and create a test Pin while on Trial access.',
      'Click Upgrade and upload a video showing the full sign-in (consent screen) and a Pin being created from the admin.',
    ],
    register: [{ label: 'Redirect URI', value: { kind: 'social' } }],
    approval: [{ step: 'Standard access review', wait: '1–4 weeks' }],
  },
  {
    id: 'linkedin-community',
    title: 'LinkedIn Community Management API',
    why: 'Posting as a company Page for stores.',
    env: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
    consoles: [{ label: 'LinkedIn developer apps', url: 'https://www.linkedin.com/developers/apps' }],
    steps: [
      'Create a dedicated LinkedIn app linked to the platform company Page, and have a Page admin verify it.',
      'Products → request Community Management API, the only product on the app. The Development tier is granted first.',
      'Auth tab → add the redirect URL below.',
      'Fill in the Standard tier form: registered business details, a business email, and a screen recording for every use case listed.',
    ],
    register: [{ label: 'Redirect URL', value: { kind: 'social' } }],
    approval: [{ step: 'Development tier', wait: 'days' }, { step: 'Standard tier', wait: '1–4 weeks' }],
  },
  {
    id: 'x-api',
    title: 'X API (pay-per-use credits)',
    why: 'Stores posting through the platform X app draw on its credits.',
    env: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
    doneWhenKeys: true,
    consoles: [{ label: 'X developer console', url: 'https://console.x.com/' }],
    steps: [
      'In the X developer console, keep credits on the platform project; each post is charged per request.',
      'User authentication settings: OAuth 2.0, type Web App, Read and write, with the callback URI below.',
      'Set X_CLIENT_ID and X_CLIENT_SECRET.',
    ],
    register: [{ label: 'Callback URI', value: { kind: 'social' } }],
  },
  {
    id: 'myntra-partner',
    title: 'Myntra partner programme',
    why: 'API docs and partner access to build against the live Myntra API.',
    env: [],
    consoles: [{ label: 'Myntra Partner Portal', url: 'https://partners.myntrainfo.com/' }],
    steps: [
      'Contact Myntra’s partner team (through the Myntra Partner Portal) to become an integration partner and get the API documentation (MMIP).',
      'Confirm the API host, authentication headers, token lifetime, push payload and acknowledgement, event names and inventory batch size.',
      'Put endpoint corrections in MARKETPLACE_ENDPOINTS_JSON; no code change is needed.',
    ],
  },
  {
    id: 'ajio-partner',
    title: 'AJIO partner programme',
    why: 'VMS API docs and credentials to build against the live AJIO API.',
    env: [],
    consoles: [{ label: 'AJIO seller (VMS)', url: 'https://seller.ajio.com/ajiocommerce/' }],
    steps: [
      'Ask AJIO (through a seller account manager) for the VMS API documentation.',
      'Confirm authentication, purchase order and invoice upload, and the manifest and catalogue endpoints.',
      'Put endpoint corrections in MARKETPLACE_ENDPOINTS_JSON.',
    ],
  },
  {
    id: 'razorpay-route',
    title: 'Razorpay Route',
    why: 'Stores paid through the platform account get their share as Route transfers.',
    env: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
    consoles: [{ label: 'Razorpay dashboard', url: 'https://dashboard.razorpay.com/' }],
    steps: [
      'Ask Razorpay support or your account manager to enable Route on the platform account.',
      'Make sure the platform webhook includes the transfer events.',
      'Check RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are set.',
      'Each store’s linked account is created when its KYC is approved, and its payouts follow automatically.',
    ],
    approval: [{ step: 'Route enablement', wait: 'about 1 week' }],
  },
  {
    id: 'flagship-ewaybill-einvoice',
    title: 'E-way bill and e-invoice for the flagship',
    why: 'The flagship generates under the platform GSTIN from these keys.',
    env: ['EWAYBILL_CLIENT_ID', 'EWAYBILL_CLIENT_SECRET', 'EWAYBILL_USERNAME', 'EWAYBILL_PASSWORD', 'EWAYBILL_GSTIN', 'EINVOICE_CLIENT_ID', 'EINVOICE_CLIENT_SECRET', 'EINVOICE_USERNAME', 'EINVOICE_PASSWORD', 'EINVOICE_GSTIN'],
    doneWhenKeys: true,
    consoles: [{ label: 'E-way bill portal', url: 'https://ewaybillgst.gov.in/' }, { label: 'E-invoice portal', url: 'https://einvoice1.gst.gov.in/' }],
    steps: [
      'Sign up with a GSP for e-way bill and e-invoice API access under the platform GSTIN.',
      'Create the API user through that GSP on both portals (e-way bill: Registration → For GSP; e-invoice: API Registration → Create API User).',
      'Set the EWAYBILL_* and EINVOICE_* keys, and the GSP base URLs (EWAYBILL_BASE_URL, EINVOICE_BASE_URL), in the store secret set.',
    ],
  },
]

export const PLATFORM_ITEM_IDS = new Set(PLATFORM_ITEMS.map(i => i.id))
