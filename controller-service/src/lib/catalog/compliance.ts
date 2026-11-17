// India selling-compliance catalogue for the onboarding Store step (per selling category).
// Sources (checked 2026-11-17, consultancy + official pages; verify before legal reliance):
//  FSSAI e-commerce: https://cleartax.in/s/e-commerce-fssai-food-license-registration , https://www.indialaw.in/blog/food/fssai-food-safety-e-commerce-impacts/
//  BIS QCOs / CRS: https://www.bis.gov.in/wp-content/uploads/2021/08/Guidance-Document-on-Quality-Control-Orders-QCOs-1.pdf
//  Toys QCO (IS 9873): https://www.india-briefing.com/news/bis-toy-certification-india-manufacturers-importers-guide-44957.html
//  Legal Metrology e-commerce (2026 amendment, country-of-origin filter): https://www.scconline.com/blog/post/2026/02/21/legal-metrology-packaged-commodities-amendment-rules-2026-explained/
//  Drugs (Form 20/21): https://www.scconline.com/blog/post/2023/11/02/regulation-of-online-pharmacies-in-india/
//  Cosmetics (CDSCO import/manufacture): https://www.standphillindia.in/cdsco-license-registration-and-certificate.php
//  Agri inputs (seed, FCO 1985, Insecticides Rule 10E): https://www.agileregulatory.com/blogs/how-to-get-a-fertilizer-license-in-india-step-by-step-process
//
// Pure: the wizard (as the owner types) and the onboarding schema (at submit) check the same rules.

export interface ComplianceDoc {
  id: string
  name: string
  authority: string
  /** Who must hold it, in one line. */
  who: string
  /** The number the owner types (validated loosely), if the document has one. */
  numberLabel?: string
  numberPattern?: string
  /** What numberPattern asks for, in words. */
  numberHint?: string
  /** Licences that lapse: ask for the expiry date and remind before it. */
  expires?: boolean
  link?: string
}

export interface CategoryRule {
  /** A rule category; CATEGORY_RULES maps the wizard's selling categories to these. */
  category: string
  required: string[]
  /** Shown as "Do you …?" toggles; a yes makes the document required. */
  conditional: { doc: string; ask: string }[]
  /** Products that can't be sold on the platform. */
  restricted?: string
}

export const DOCS: Record<string, ComplianceDoc> = {
  fssai: { id: 'fssai', name: 'FSSAI licence or registration', authority: 'Food Safety and Standards Authority of India (FoSCoS)', who: 'Anyone selling food, beverages, supplements or packaged snacks', numberLabel: 'FSSAI number', numberPattern: '^\\d{14}$', numberHint: '14 digits', expires: true, link: 'https://foscos.fssai.gov.in' },
  lmpc: { id: 'lmpc', name: 'Legal Metrology (LMPC) registration', authority: 'Legal Metrology, Department of Consumer Affairs', who: 'Packers and importers of pre-packaged goods', numberLabel: 'Registration number', expires: true },
  iec: { id: 'iec', name: 'Importer Exporter Code (IEC)', authority: 'Directorate General of Foreign Trade', who: 'Anyone importing goods for sale', numberLabel: 'IEC', numberPattern: '^[A-Z0-9]{10}$', numberHint: '10 letters and digits', link: 'https://www.dgft.gov.in' },
  organic: { id: 'organic', name: 'Organic certification (NPOP / Jaivik Bharat)', authority: 'APEDA / FSSAI', who: 'Sellers labelling products as organic', expires: true },
  drug_retail: { id: 'drug_retail', name: 'Retail drug licence (Form 20 / 21)', authority: 'State Drugs Control Department', who: 'Anyone selling allopathic medicines; online sale also needs a registered pharmacist', numberLabel: 'Drug licence number', expires: true },
  pharmacist: { id: 'pharmacist', name: 'Registered pharmacist certificate', authority: 'State Pharmacy Council', who: 'Medicine sellers (the pharmacist dispensing orders)', numberLabel: 'Registration number' },
  ayush: { id: 'ayush', name: 'AYUSH manufacturing licence (Form 25-D)', authority: 'State AYUSH licensing authority', who: 'Manufacturers of Ayurvedic, Siddha or Unani products', numberLabel: 'Licence number', expires: true },
  medical_device: { id: 'medical_device', name: 'Medical device registration (CDSCO)', authority: 'Central Drugs Standard Control Organisation', who: 'Sellers, importers and makers of notified medical devices', numberLabel: 'Registration number', expires: true, link: 'https://cdscomdonline.gov.in' },
  cosmetics: { id: 'cosmetics', name: 'Cosmetics import registration / manufacturing licence (CDSCO)', authority: 'Central Drugs Standard Control Organisation', who: 'Importers (Form COS-2) or makers (Form COS-8) of cosmetics; retail needs none', numberLabel: 'Registration or licence number', expires: true },
  bis_crs: { id: 'bis_crs', name: 'BIS registration (CRS, R-number)', authority: 'Bureau of Indian Standards', who: 'Notified electronics and IT goods must carry it: upload yours or the brand’s', numberLabel: 'R-number', numberPattern: '^R-\\d{8}$', numberHint: 'R- and 8 digits, like R-41000000', link: 'https://www.crsbis.in' },
  bis_isi: { id: 'bis_isi', name: 'BIS ISI-mark licence (Quality Control Order)', authority: 'Bureau of Indian Standards', who: 'Products under a QCO (pressure cookers, steel utensils, electrical appliances…): yours or the maker’s', numberLabel: 'CM/L licence number', expires: true },
  bis_toys: { id: 'bis_toys', name: 'BIS licence for toys (IS 9873 / IS 15644)', authority: 'Bureau of Indian Standards', who: 'Toys for children under 14 must carry the ISI mark: yours or the maker’s licence', numberLabel: 'CM/L licence number', expires: true },
  bis_hallmark: { id: 'bis_hallmark', name: 'BIS hallmarking registration (HUID)', authority: 'Bureau of Indian Standards', who: 'Jewellers selling gold or silver jewellery and artefacts', numberLabel: 'Registration number', link: 'https://www.manakonline.in' },
  bis_helmet: { id: 'bis_helmet', name: 'BIS licence for two-wheeler helmets (IS 4151)', authority: 'Bureau of Indian Standards', who: 'Sellers of two-wheeler helmets', numberLabel: 'CM/L licence number', expires: true },
  bis_footwear: { id: 'bis_footwear', name: 'BIS licence for footwear (QCO)', authority: 'Bureau of Indian Standards', who: 'Footwear covered by the footwear QCOs: yours or the maker’s', numberLabel: 'CM/L licence number', expires: true },
  wpc_eta: { id: 'wpc_eta', name: 'WPC Equipment Type Approval (ETA)', authority: 'Wireless Planning & Coordination Wing, DoT', who: 'Wireless devices (Bluetooth, Wi-Fi, RF)', numberLabel: 'ETA number', link: 'https://saralsanchar.gov.in' },
  bee_label: { id: 'bee_label', name: 'BEE star-label registration', authority: 'Bureau of Energy Efficiency', who: 'Notified appliances (ACs, refrigerators, geysers, TVs…)', numberLabel: 'Registration number' },
  epr_ewaste: { id: 'epr_ewaste', name: 'E-waste EPR registration', authority: 'Central Pollution Control Board', who: 'Makers, importers and brand owners of electronics', numberLabel: 'EPR registration number', expires: true },
  seed: { id: 'seed', name: 'Seed dealer licence', authority: 'State Agriculture Department', who: 'Sellers of seeds', numberLabel: 'Licence number', expires: true },
  fertilizer: { id: 'fertilizer', name: 'Fertiliser dealer licence (FCO 1985)', authority: 'State Agriculture Department', who: 'Sellers of fertilisers', numberLabel: 'Licence number', expires: true },
  pesticide: { id: 'pesticide', name: 'Pesticide sale licence + principal certificate', authority: 'State Agriculture Department (Insecticides Rules)', who: 'Sellers of pesticides, including online (Rule 10E)', numberLabel: 'Licence number', expires: true },
  vet_drug: { id: 'vet_drug', name: 'Drug licence for veterinary medicines', authority: 'State Drugs Control Department', who: 'Sellers of veterinary medicines', numberLabel: 'Drug licence number', expires: true },
  brand_auth: { id: 'brand_auth', name: 'Brand authorisation letter or invoices', authority: 'The brand or its distributor', who: 'Resellers of other brands’ products' },
}

export const RULES: CategoryRule[] = [
  { category: 'food', required: ['fssai'], conditional: [{ doc: 'lmpc', ask: 'Do you pack or import packaged food?' }, { doc: 'organic', ask: 'Do you label products as organic?' }, { doc: 'iec', ask: 'Do you import products?' }] },
  { category: 'health', required: [], conditional: [{ doc: 'fssai', ask: 'Do you sell supplements, protein or nutrition products?' }, { doc: 'drug_retail', ask: 'Do you sell medicines?' }, { doc: 'pharmacist', ask: 'Do you sell medicines?' }, { doc: 'ayush', ask: 'Do you make Ayurvedic, Siddha or Unani products?' }, { doc: 'medical_device', ask: 'Do you sell medical devices (BP monitors, glucometers, thermometers…)?' }], restricted: 'Narcotic, psychotropic and Schedule X drugs can’t be sold online.' },
  { category: 'beauty', required: [], conditional: [{ doc: 'cosmetics', ask: 'Do you import or make cosmetics?' }, { doc: 'lmpc', ask: 'Do you pack or import packaged goods?' }, { doc: 'ayush', ask: 'Do you make Ayurvedic beauty products?' }] },
  { category: 'electronics', required: ['bis_crs'], conditional: [{ doc: 'wpc_eta', ask: 'Do you sell wireless devices (Bluetooth, Wi-Fi)?' }, { doc: 'bee_label', ask: 'Do you sell star-labelled appliances?' }, { doc: 'epr_ewaste', ask: 'Are you the maker, importer or brand owner?' }, { doc: 'iec', ask: 'Do you import products?' }] },
  { category: 'home_kitchen', required: [], conditional: [{ doc: 'bis_isi', ask: 'Do you sell pressure cookers, steel utensils or electrical appliances?' }, { doc: 'bee_label', ask: 'Do you sell star-labelled appliances?' }] },
  { category: 'toys', required: ['bis_toys'], conditional: [{ doc: 'fssai', ask: 'Do you sell baby food?' }, { doc: 'iec', ask: 'Do you import products?' }] },
  { category: 'jewellery', required: ['bis_hallmark'], conditional: [] },
  { category: 'fashion', required: [], conditional: [{ doc: 'bis_footwear', ask: 'Do you sell footwear?' }, { doc: 'brand_auth', ask: 'Do you resell other brands?' }] },
  { category: 'sports', required: [], conditional: [{ doc: 'bis_helmet', ask: 'Do you sell two-wheeler helmets?' }, { doc: 'fssai', ask: 'Do you sell sports nutrition?' }] },
  { category: 'books', required: [], conditional: [] },
  { category: 'industrial', required: [], conditional: [{ doc: 'bis_isi', ask: 'Are any of your products under a BIS Quality Control Order?' }, { doc: 'iec', ask: 'Do you import products?' }] },
  { category: 'agriculture', required: [], conditional: [{ doc: 'seed', ask: 'Do you sell seeds?' }, { doc: 'fertilizer', ask: 'Do you sell fertilisers?' }, { doc: 'pesticide', ask: 'Do you sell pesticides?' }] },
  { category: 'pets', required: [], conditional: [{ doc: 'vet_drug', ask: 'Do you sell veterinary medicines?' }] },
  { category: 'automotive', required: [], conditional: [{ doc: 'bis_helmet', ask: 'Do you sell two-wheeler helmets?' }, { doc: 'bis_isi', ask: 'Do you sell tyres or other QCO-covered parts?' }] },
  { category: 'restricted', required: [], conditional: [], restricted: 'Alcohol, tobacco and e-cigarettes, firearms, fireworks and explosives can’t be sold on Jeffi Stores.' },
]

/**
 * The onboarding wizard's selling categories, in the order it shows them, with the rules each one brings. The labels
 * are load-bearing (starter catalogues, the Razorpay profile category, tenant_kyc.product_categories): never rename
 * one, only add.
 */
export const CATEGORY_RULES: Record<string, string[]> = {
  'Electronics & Gadgets': ['electronics'],
  'Fashion & Apparel': ['fashion'],
  'Home & Kitchen': ['home_kitchen'],
  'Health & Beauty': ['health', 'beauty'],
  'Books & Stationery': ['books'],
  'Sports & Fitness': ['sports'],
  'Toys & Games': ['toys'],
  'Industrial & B2B': ['industrial'],
  'Food & Groceries': ['food'],
  'Jewellery & Watches': ['jewellery'],
  'Pet Supplies': ['pets'],
  Automotive: ['automotive'],
  'Agriculture & Gardening': ['agriculture'],
  // The catch-all stays last.
  Other: [],
}

export const SELLING_CATEGORIES = Object.keys(CATEGORY_RULES)

/** tenant_kyc.product_categories / the submit payload ("A, B") as the wizard's list. */
export const categoryList = (joined: string | null | undefined): string[] =>
  String(joined ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

/** What a document row records when no selling category asked for it. */
export const GENERAL = 'General'
export const RESTRICTED_QUESTION = 'restricted'
export const RESTRICTED_ASK = 'Do you sell any of: alcohol, tobacco or e-cigarettes, firearms, fireworks or explosives, prescription narcotics?'
export const RESTRICTED_MESSAGE =
  'Jeffi Stores can’t host a store that sells alcohol, tobacco or e-cigarettes, firearms, fireworks or explosives, or prescription narcotics. If none of your products are among these, answer No.'

export interface ComplianceQuestion {
  /** The answer's key in the draft: stable for the same question across categories. */
  id: string
  ask: string
  /** Documents a yes makes required. */
  docs: string[]
}

export interface ComplianceSection {
  category: string
  required: string[]
  questions: ComplianceQuestion[]
  /** What can't be sold in this category. */
  notes: string[]
}

export interface CompliancePlan {
  /** Asked of every store (besides the restricted-goods question). */
  general: ComplianceQuestion[]
  sections: ComplianceSection[]
}

/** One uploaded document, as the draft keeps it until submit. */
export interface ComplianceUpload {
  s3Key: string
  fileName?: string
  number?: string
  /** YYYY-MM-DD */
  expiresOn?: string
}

export interface ComplianceState {
  answers: Record<string, boolean>
  docs: Record<string, ComplianceUpload>
}

const GENERAL_QUESTIONS: ComplianceQuestion[] = [{ id: 'import', ask: 'Do you import goods?', docs: ['iec'] }]

const questionId = (ask: string) =>
  ask
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

/**
 * The questions and documents for the categories picked, in the wizard's order. A document is asked for once: where a
 * category requires it, or under the first question that would; the same question in two categories is asked once,
 * and the general import question stands in for each category's own.
 */
export function compliancePlan(categories: string[]): CompliancePlan {
  const picked = SELLING_CATEGORIES.filter(c => categories.includes(c))
  const rulesOf = (c: string) => (CATEGORY_RULES[c] ?? []).map(id => RULES.find(r => r.category === id)).filter((r): r is CategoryRule => !!r)
  const generalDocs = new Set(GENERAL_QUESTIONS.flatMap(q => q.docs))
  const requiredAnywhere = new Set(picked.flatMap(c => rulesOf(c).flatMap(r => r.required)))
  const requiredShown = new Set<string>()
  const asked = new Map<string, ComplianceQuestion>()
  const sections = picked.map(category => {
    const rules = rulesOf(category)
    const required = [...new Set(rules.flatMap(r => r.required))].filter(d => !requiredShown.has(d))
    required.forEach(d => requiredShown.add(d))
    const questions: ComplianceQuestion[] = []
    const docsHere = new Set<string>()
    for (const r of rules) {
      for (const c of r.conditional) {
        // Required anyway, asked in the general part, or already asked in this category (Health & Beauty's two Ayurveda questions).
        if (requiredAnywhere.has(c.doc) || generalDocs.has(c.doc) || docsHere.has(c.doc)) continue
        docsHere.add(c.doc)
        const id = questionId(c.ask)
        const same = asked.get(id)
        if (same) {
          if (!same.docs.includes(c.doc)) same.docs.push(c.doc)
          continue
        }
        const q = { id, ask: c.ask, docs: [c.doc] }
        asked.set(id, q)
        questions.push(q)
      }
    }
    const notes = rules.map(r => r.restricted).filter((n): n is string => !!n)
    return { category, required, questions, notes }
  })
  return { general: GENERAL_QUESTIONS, sections }
}

/** Every question the owner must answer, the restricted-goods one first. */
export function planQuestions(plan: CompliancePlan): ComplianceQuestion[] {
  return [{ id: RESTRICTED_QUESTION, ask: RESTRICTED_ASK, docs: [] }, ...plan.general, ...plan.sections.flatMap(s => s.questions)]
}

/** The documents the answers make required, each with the category it is filed under. */
export function requiredDocs(plan: CompliancePlan, answers: Record<string, boolean>): { doc: string; category: string }[] {
  const out = new Map<string, string>()
  for (const s of plan.sections) for (const d of s.required) if (!out.has(d)) out.set(d, s.category)
  for (const q of plan.general) if (answers[q.id] === true) for (const d of q.docs) if (!out.has(d)) out.set(d, GENERAL)
  for (const s of plan.sections) for (const q of s.questions) if (answers[q.id] === true) for (const d of q.docs) if (!out.has(d)) out.set(d, s.category)
  return [...out].map(([doc, category]) => ({ doc, category }))
}

/** Today in India (YYYY-MM-DD), which licence expiry dates are compared against. */
export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)

/** A real calendar date as YYYY-MM-DD (2026-02-30 is not one). */
export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const t = Date.parse(`${v}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v
}

/** Licence numbers are typed in capitals (IEC, R-numbers, CM/L). */
export const cleanDocNumber = (v: string) => v.toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 64)

/** Why an uploaded document is not complete yet, or null when it is. */
export function docProblem(doc: ComplianceDoc, u: ComplianceUpload | undefined, today = todayIst()): string | null {
  if (!u?.s3Key) return `Upload your ${doc.name}.`
  if (doc.numberLabel) {
    const n = cleanDocNumber(u.number ?? '')
    if (!n) return `Enter the ${doc.numberLabel} of your ${doc.name}.`
    if (n.length < 3 || (doc.numberPattern && !new RegExp(doc.numberPattern).test(n)))
      return `Check the ${doc.numberLabel}${doc.numberHint ? `: it is ${doc.numberHint}` : ''}.`
  }
  if (doc.expires) {
    const at = u.expiresOn ?? ''
    if (!isIsoDate(at)) return `Enter the expiry date of your ${doc.name}.`
    if (at < today) return `Your ${doc.name} has expired. Upload the renewed one.`
  }
  return null
}

/** The first thing that keeps the Licences & certificates part from being complete, or null. */
export function complianceProblem(categories: string[], state: ComplianceState, today = todayIst()): string | null {
  const plan = compliancePlan(categories)
  const answers = state.answers ?? {}
  if (answers[RESTRICTED_QUESTION] === true) return RESTRICTED_MESSAGE
  for (const q of planQuestions(plan)) if (typeof answers[q.id] !== 'boolean') return `Answer “${q.ask}”`
  for (const { doc } of requiredDocs(plan, answers)) {
    const d = DOCS[doc]
    const problem = d ? docProblem(d, state.docs?.[doc], today) : null
    if (problem) return problem
  }
  return null
}

// ── The documents on file (tenant_compliance_documents), after onboarding ──

/** A document's review status; `expired` is set by the daily compliance_expiry job (lib/catalog/compliance-expiry.ts). */
export type DocStatus = 'pending' | 'approved' | 'rejected' | 'expired'

/** The owner is emailed this many days before a licence lapses, then once it has. */
export const EXPIRY_REMINDER_DAYS = [30, 7] as const

/** Whole days from today (IST) to a YYYY-MM-DD date; negative once it has passed. */
export const daysUntil = (date: string, today = todayIst()) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)

/** Where a document stands today: past its date it reads as expired before the daily job marks it; a rejection stays one. */
export function docStanding(d: { status: string; expires_on: string | null }, today = todayIst()): DocStatus {
  if (d.status === 'rejected') return 'rejected'
  if (d.status === 'expired' || (!!d.expires_on && d.expires_on < today)) return 'expired'
  return d.status === 'approved' ? 'approved' : 'pending'
}

/**
 * The store's licences in one word: `action` once one is rejected or expired (every document on file is one the store's
 * own answers made required; the optional GST certificate lives on the KYC), `review` while one waits for the platform
 * admin, `ok` when all are approved, null with none on file.
 */
export function complianceStanding(docs: { status: string; expires_on: string | null }[], today = todayIst()): 'action' | 'review' | 'ok' | null {
  if (!docs.length) return null
  const s = docs.map(d => docStanding(d, today))
  return s.some(x => x === 'rejected' || x === 'expired') ? 'action' : s.includes('pending') ? 'review' : 'ok'
}

const rulesFor = (category: string) =>
  (CATEGORY_RULES[category] ?? []).map(id => RULES.find(r => r.category === id)).filter((r): r is CategoryRule => !!r)

/** Every document a selling category can ask for (GENERAL: what every store is asked), required ones first, the others with the question that would require them. */
export function categoryDocs(category: string): { doc: string; required: boolean; ask?: string }[] {
  const out = new Map<string, { doc: string; required: boolean; ask?: string }>()
  if (category === GENERAL) for (const q of GENERAL_QUESTIONS) for (const doc of q.docs) out.set(doc, { doc, required: false, ask: q.ask })
  const rules = rulesFor(category)
  for (const r of rules) for (const doc of r.required) if (!out.has(doc)) out.set(doc, { doc, required: true })
  for (const r of rules) for (const c of r.conditional) if (!out.has(c.doc)) out.set(c.doc, { doc: c.doc, required: false, ask: c.ask })
  return [...out.values()].filter(d => DOCS[d.doc])
}

/** What can't be sold in a selling category. */
export const categoryNotes = (category: string) => rulesFor(category).map(r => r.restricted).filter((n): n is string => !!n)
