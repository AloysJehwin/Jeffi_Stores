// The design styles an owner can pick in the studio brief (shared by the wizard's preview cards and the generator).
// Each maps to a layout feel in directions.ts, the font pairs that suit it, its shape tokens, the rules the section
// writer follows, its product card, and a sample palette for its preview card. Fonts must be in FONT_CHOICES.

export type UiStyleId = 'minimalist' | 'brutalist' | 'editorial' | 'luxury' | 'playful' | 'poster' | 'crafted' | 'bazaar' | 'soft' | 'glass'

export interface UiStyle {
  id: UiStyleId
  name: string
  /** One line under the name on the card. */
  blurb: string
  /** The layout feel in directions.ts it builds on. */
  feel: string
  /** Display + body pairs that suit the style. */
  fonts: [string, string][]
  tokens: {
    radius: 'none' | 'sm' | 'md' | 'lg' | 'full'
    buttonStyle: 'solid' | 'outline' | 'pill'
    density: 'compact' | 'comfortable' | 'airy'
    buttonShape: 'square' | 'rounded' | 'pill'
    cardStyle: 'flat' | 'outlined' | 'shadow'
    inputStyle: 'outlined' | 'filled' | 'underline'
    headingCase: 'normal' | 'upper'
    headingTracking: 'tight' | 'normal' | 'wide'
    shadow: 'none' | 'soft' | 'strong'
  }
  /** How sections are composed in this style, for the section writer. */
  rules: string
  /** The product card in this style, for the card writer (lib/site/card.ts). */
  card: string
  /** The preview card's sample colours: page, ink, primary, accent. */
  sample: { bg: string; ink: string; primary: string; accent: string }
}

export const UI_STYLES: UiStyle[] = [
  {
    id: 'minimalist',
    name: 'Minimalist',
    blurb: 'White space, thin lines, one accent',
    feel: 'grid',
    fonts: [['Manrope', 'Inter'], ['Inter', 'Inter'], ['DM Sans', 'Inter'], ['Plus Jakarta Sans', 'Inter']],
    tokens: { radius: 'sm', buttonStyle: 'solid', density: 'airy', buttonShape: 'square', cardStyle: 'flat', inputStyle: 'underline', headingCase: 'normal', headingTracking: 'tight', shadow: 'none' },
    rules: 'Minimalist: lots of white space, thin 1px rules, mostly monochrome with one accent, restrained type sizes, small uppercase labels, no shadows, gradients or decoration.',
    card: 'no box: the picture on a plain surface-secondary tint, the name and price in small restrained type beneath it, a thin 1px rule or none, an outline or text-only add button; no shadows, badges kept tiny.',
    sample: { bg: '#ffffff', ink: '#111111', primary: '#111111', accent: '#2563eb' },
  },
  {
    id: 'brutalist',
    name: 'Brutalist',
    blurb: 'Raw, thick borders, monospace',
    feel: 'brutalist',
    fonts: [['Space Mono', 'Space Grotesk'], ['Archivo Black', 'Space Mono'], ['Space Grotesk', 'Space Mono']],
    tokens: { radius: 'none', buttonStyle: 'solid', density: 'comfortable', buttonShape: 'square', cardStyle: 'outlined', inputStyle: 'outlined', headingCase: 'upper', headingTracking: 'normal', shadow: 'strong' },
    rules:
      'Brutalist: raw and loud. Thick 2-4px borders in the dark neutral (border-secondary-900) around cards, buttons and bands; hard offset shadows made with a solid block behind (absolute, translate-x-2 translate-y-2, bg-secondary-900); square corners; visible grid lines; uppercase monospace labels; flat high-contrast colour, no soft shadows or gradients.',
    card: 'a square box with a 2px border-secondary-900 border on bg-surface and a hard offset shadow behind it (an aria-hidden block, absolute inset-0 translate-x-1.5 translate-y-1.5 bg-secondary-900, under the box, which is relative); the picture edge to edge above a 2px rule; the name uppercase in the display font, the price bold; a full-width square add-to-cart bar (border-2 border-secondary-900, bg-accent-500 or bg-secondary-900 with white text, uppercase); the discount as a square sticker. No rounded corners, soft shadows or gradients.',
    sample: { bg: '#f4f1ea', ink: '#0a0a0a', primary: '#0a0a0a', accent: '#ff4d00' },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    blurb: 'Magazine serif, big pictures',
    feel: 'editorial',
    fonts: [['Playfair Display', 'Inter'], ['Libre Baskerville', 'Plus Jakarta Sans'], ['Lora', 'DM Sans']],
    tokens: { radius: 'none', buttonStyle: 'outline', density: 'airy', buttonShape: 'square', cardStyle: 'flat', inputStyle: 'underline', headingCase: 'normal', headingTracking: 'tight', shadow: 'none' },
    rules: 'Editorial: large serif headlines, asymmetric magazine grids, full-bleed pictures, captions and pull-quote styling, generous margins.',
    card: 'no box: a tall 3:4 picture edge to edge, a small uppercase label (brand or category) above the name, the name in the serif display font, the price in body type; an understated outline or text add button; generous space.',
    sample: { bg: '#faf8f4', ink: '#1c1917', primary: '#1c1917', accent: '#b45309' },
  },
  {
    id: 'luxury',
    name: 'Luxury',
    blurb: 'Refined serif, quiet and dark',
    feel: 'luxury',
    fonts: [['Cormorant Garamond', 'Manrope'], ['Cinzel', 'Lora'], ['Marcellus', 'Poppins']],
    tokens: { radius: 'none', buttonStyle: 'outline', density: 'airy', buttonShape: 'square', cardStyle: 'flat', inputStyle: 'underline', headingCase: 'upper', headingTracking: 'wide', shadow: 'none' },
    rules: 'Luxury: refined and quiet. Centred compositions, thin serif or small-caps headlines with wide letter spacing, deep muted colours with a gold or metallic-toned accent, slow reveals, no badges, discounts or busy colour.',
    card: 'no box and no badges or discount stickers: a tall 3:4 picture, the name centred in the display font with wide tracking, the price small and quiet beneath, a thin accent rule; an outline add button, visible on phones too; muted colour.',
    sample: { bg: '#14110f', ink: '#f5efe6', primary: '#c9a45c', accent: '#e8d9b8' },
  },
  {
    id: 'playful',
    name: 'Playful',
    blurb: 'Rounded, bright, tilted labels',
    feel: 'playful',
    fonts: [['Archivo Black', 'Poppins'], ['Poppins', 'Poppins'], ['Josefin Sans', 'Manrope']],
    tokens: { radius: 'full', buttonStyle: 'pill', density: 'comfortable', buttonShape: 'pill', cardStyle: 'shadow', inputStyle: 'filled', headingCase: 'normal', headingTracking: 'normal', shadow: 'strong' },
    rules: 'Playful: overlapping cards, slightly tilted labels and stickers (rotate-2), pill buttons, rounded pictures, bright accent bands and bouncy reveals.',
    card: 'a rounded-3xl card with a bright tinted picture panel (primary-100 or accent-100), the badge or discount as a tilted round sticker (rotate-3), a chunky pill add button with an icon and a bold soft shadow; the name in the display font.',
    sample: { bg: '#fff7ed', ink: '#1f2937', primary: '#db2777', accent: '#f59e0b' },
  },
  {
    id: 'poster',
    name: 'Bold poster',
    blurb: 'Huge uppercase type, colour blocks',
    feel: 'poster',
    fonts: [['Bebas Neue', 'Inter'], ['Archivo Black', 'Manrope'], ['Bebas Neue', 'Space Grotesk']],
    tokens: { radius: 'none', buttonStyle: 'solid', density: 'comfortable', buttonShape: 'square', cardStyle: 'outlined', inputStyle: 'outlined', headingCase: 'upper', headingTracking: 'wide', shadow: 'strong' },
    rules: 'Bold poster: oversized uppercase display type, colour-blocked bands, marquees, hard edges and strong contrast.',
    card: 'hard edges: the picture over a colour-block band, the name uppercase in the display font, the price in a solid colour block (bg-primary-600 text-white), a square full-width add bar; strong contrast, no soft shadows.',
    sample: { bg: '#ffffff', ink: '#111827', primary: '#166534', accent: '#f97316' },
  },
  {
    id: 'crafted',
    name: 'Warm & crafted',
    blurb: 'Tinted bands, story-led',
    feel: 'crafted',
    fonts: [['Lora', 'DM Sans'], ['Cormorant Garamond', 'Lora'], ['Playfair Display', 'Manrope']],
    tokens: { radius: 'md', buttonStyle: 'outline', density: 'comfortable', buttonShape: 'rounded', cardStyle: 'flat', inputStyle: 'filled', headingCase: 'normal', headingTracking: 'normal', shadow: 'soft' },
    rules: 'Warm and crafted: warm tinted bands, rounded pictures, story-led alternating picture and text splits, hand-made feel.',
    card: 'a warm card: a rounded-2xl picture on a tinted band (primary-50), the name in the serif, the brand as a small italic label, the price in body type; a rounded outline add button; a soft shadow on hover.',
    sample: { bg: '#f7efe5', ink: '#3b2a1e', primary: '#8b5e34', accent: '#4d7c0f' },
  },
  {
    id: 'bazaar',
    name: 'Bazaar',
    blurb: 'Packed, deals and badges',
    feel: 'bazaar',
    fonts: [['Montserrat', 'DM Sans'], ['Poppins', 'Inter'], ['Plus Jakarta Sans', 'Inter']],
    tokens: { radius: 'md', buttonStyle: 'solid', density: 'compact', buttonShape: 'rounded', cardStyle: 'outlined', inputStyle: 'outlined', headingCase: 'normal', headingTracking: 'normal', shadow: 'soft' },
    rules: 'Bazaar: compact rows, lots to scan, badges and countdowns on store offers, strong colour bands; dense but tidy.',
    card: 'a compact outlined card that packs it in: the discount badge and p.badge on the picture, rating stars, the price large with the MRP struck through and the % off, the stock state, and a solid full-width add button; tight padding, strong accent colour.',
    sample: { bg: '#ffffff', ink: '#1f2937', primary: '#16a34a', accent: '#f59e0b' },
  },
  {
    id: 'soft',
    name: 'Soft & friendly',
    blurb: 'Rounded cards, gentle shadows',
    feel: 'boutique',
    fonts: [['Plus Jakarta Sans', 'Inter'], ['Manrope', 'DM Sans'], ['Poppins', 'Inter']],
    tokens: { radius: 'lg', buttonStyle: 'solid', density: 'airy', buttonShape: 'rounded', cardStyle: 'shadow', inputStyle: 'filled', headingCase: 'normal', headingTracking: 'normal', shadow: 'soft' },
    rules: 'Soft and friendly: centred compositions, rounded cards with gentle shadows, pastel tints, calm spacing.',
    card: 'a rounded-2xl card on white with a gentle shadow (shadow-md, a little more on hover), a rounded picture inset in it, the name in medium weight and the price below; a rounded solid add button; pastel tints for badges.',
    sample: { bg: '#f8fafc', ink: '#1e293b', primary: '#6366f1', accent: '#f472b6' },
  },
  {
    id: 'glass',
    name: 'Glass',
    blurb: 'Frosted panels over soft colour',
    feel: 'boutique',
    fonts: [['Plus Jakarta Sans', 'Inter'], ['Manrope', 'Inter'], ['Space Grotesk', 'DM Sans'], ['Poppins', 'Inter']],
    tokens: { radius: 'lg', buttonStyle: 'pill', density: 'airy', buttonShape: 'pill', cardStyle: 'shadow', inputStyle: 'filled', headingCase: 'normal', headingTracking: 'tight', shadow: 'soft' },
    rules:
      'Glass: frosted translucent panels over soft colour. Section backgrounds are gentle gradients (bg-gradient-to-br from-primary-100 via-surface to-accent-100) or a mesh of a few large blurred colour blobs behind the content (absolute rounded-full bg-primary-300/40 or bg-accent-300/40 blur-3xl, the section relative and overflow-hidden). Cards, bars and panels are glass: bg-white/50 or bg-white/60 with backdrop-blur-xl, a 1px border-white/60 hairline and a soft coloured shadow (shadow-lg shadow-primary-900/10); dark bands use bg-secondary-900/70 with backdrop-blur. Rounded-2xl and rounded-3xl corners, pill buttons, dark text on light glass for contrast; no hard borders or heavy shadows.',
    card: 'a frosted card: bg-white/60 with backdrop-blur-xl, a 1px border-white/70 hairline and a soft coloured shadow (shadow-lg shadow-primary-900/10), rounded-3xl, the picture rounded-2xl inside it with a little padding; the name in medium weight, the price below; a pill add button (solid primary, or white glass with dark text); dark text throughout for contrast.',
    sample: { bg: '#eef2ff', ink: '#0f172a', primary: '#6366f1', accent: '#06b6d4' },
  },
]

export const UI_STYLE_IDS = UI_STYLES.map(s => s.id)

export const uiStyle = (id: unknown): UiStyle | null => UI_STYLES.find(s => s.id === id) ?? null

/** Every font the preview cards use, for one Google Fonts link. */
export const UI_STYLE_FONTS = [...new Set(UI_STYLES.flatMap(s => s.fonts[0]))]
