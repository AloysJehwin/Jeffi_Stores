export interface SeedItem {
  name: string
  price: number
  blurb: string
}
export interface SeedCatalog {
  category: string
  categorySlug: string
  items: SeedItem[]
  hero: { title: string; subtitle: string; badge: string; cta: string }[]
}

const mk = (name: string, price: number, blurb: string): SeedItem => ({ name, price, blurb })

// Starter catalogues, one per onboarding category. Deliberately generic placeholders:
// a new store looks furnished on first login, and every row is safe to edit or delete.
export const SEED_CATALOGS: Record<string, SeedCatalog> = {
  'Electronics & Gadgets': {
    category: 'Electronics',
    categorySlug: 'electronics',
    items: [
      mk('Wireless Earbuds', 2499, 'True wireless earbuds with charging case and noise isolation.'),
      mk('Bluetooth Speaker', 1899, 'Portable speaker with deep bass and all-day battery.'),
      mk('Fast Charger 65W', 1299, 'GaN charger with dual USB-C and USB-A output.'),
      mk('Power Bank 20000mAh', 1799, 'High-capacity power bank with fast charge support.'),
      mk('Smart Watch', 3999, 'Fitness tracking, notifications and heart-rate monitoring.'),
      mk('USB-C Hub', 2199, 'Seven-in-one hub with HDMI, card reader and power delivery.'),
      mk('Wireless Mouse', 899, 'Silent-click ergonomic mouse with adjustable DPI.'),
      mk('Mechanical Keyboard', 4499, 'Hot-swappable switches with per-key backlighting.'),
      mk('Laptop Stand', 1499, 'Adjustable aluminium stand with cable routing.'),
      mk('Webcam 1080p', 2799, 'Full-HD webcam with autofocus and built-in microphone.'),
    ],
    hero: [
      {
        title: 'New arrivals in electronics',
        subtitle: 'Audio, charging and desk essentials',
        badge: 'New',
        cta: 'Shop now',
      },
      {
        title: 'Everyday tech, honest prices',
        subtitle: 'Curated gadgets for work and home',
        badge: 'Featured',
        cta: 'Browse catalogue',
      },
    ],
  },
  'Fashion & Apparel': {
    category: 'Apparel',
    categorySlug: 'apparel',
    items: [
      mk('Cotton Crew T-Shirt', 699, 'Pre-shrunk combed cotton with a regular fit.'),
      mk('Oxford Shirt', 1499, 'Button-down oxford weave for work or weekend.'),
      mk('Slim Fit Chinos', 1799, 'Stretch cotton twill with a tapered leg.'),
      mk('Denim Jacket', 2999, 'Mid-wash denim with a classic trucker cut.'),
      mk('Knit Sweater', 2199, 'Soft-knit pullover with ribbed cuffs and hem.'),
      mk('Canvas Sneakers', 1999, 'Low-top canvas sneakers with cushioned insole.'),
      mk('Leather Belt', 1199, 'Full-grain leather with a brushed metal buckle.'),
      mk('Tote Bag', 899, 'Heavyweight canvas tote with inner pocket.'),
      mk('Wool Scarf', 1399, 'Lightweight wool blend in a neutral palette.'),
      mk('Baseball Cap', 599, 'Six-panel cotton cap with adjustable strap.'),
    ],
    hero: [
      {
        title: 'The new season is here',
        subtitle: 'Everyday staples, considered fabrics',
        badge: 'New season',
        cta: 'Shop the range',
      },
      {
        title: 'Built to be worn often',
        subtitle: 'Simple pieces that hold their shape',
        badge: 'Featured',
        cta: 'Browse catalogue',
      },
    ],
  },
  'Home & Kitchen': {
    category: 'Home & Kitchen',
    categorySlug: 'home-kitchen',
    items: [
      mk('Stainless Steel Cookware Set', 4999, 'Five-piece induction-ready set with glass lids.'),
      mk('Ceramic Dinner Set', 2999, 'Sixteen-piece stoneware set, dishwasher safe.'),
      mk('Chef Knife 8 inch', 1799, 'High-carbon stainless blade with balanced handle.'),
      mk('Glass Storage Jars', 1299, 'Set of six airtight borosilicate jars.'),
      mk('Electric Kettle 1.7L', 1599, 'Rapid boil with auto shut-off and dry-boil guard.'),
      mk('Cotton Bedsheet Set', 2199, 'Two hundred thread count with two pillow covers.'),
      mk('Table Lamp', 1899, 'Warm-light lamp with fabric shade and dimmer.'),
      mk('Bath Towel Pair', 1099, 'Quick-dry combed cotton, six hundred GSM.'),
      mk('Wall Clock', 899, 'Silent sweep movement with a minimal dial.'),
      mk('Storage Basket', 749, 'Woven basket with reinforced handles.'),
    ],
    hero: [
      { title: 'Make the everyday better', subtitle: 'Kitchen and home essentials', badge: 'New', cta: 'Shop now' },
      {
        title: 'Built for daily use',
        subtitle: 'Durable pieces at fair prices',
        badge: 'Featured',
        cta: 'Browse catalogue',
      },
    ],
  },
  'Health & Beauty': {
    category: 'Health & Beauty',
    categorySlug: 'health-beauty',
    items: [
      mk('Vitamin C Serum', 1299, 'Brightening serum with stabilised vitamin C.'),
      mk('Daily Moisturiser', 899, 'Lightweight hydration for all skin types.'),
      mk('Sunscreen SPF 50', 749, 'Broad-spectrum protection, non-greasy finish.'),
      mk('Gentle Face Wash', 549, 'Sulphate-free cleanser for daily use.'),
      mk('Hair Oil 200ml', 649, 'Cold-pressed blend for scalp conditioning.'),
      mk('Shampoo & Conditioner', 1099, 'Paraben-free duo for everyday care.'),
      mk('Body Lotion', 699, 'Twenty-four hour moisture with shea butter.'),
      mk('Lip Balm Set', 449, 'Pack of three tinted balms with SPF.'),
      mk('Beard Grooming Kit', 1499, 'Oil, balm, comb and trimming scissors.'),
      mk('Electric Face Brush', 1999, 'Silicone sonic cleansing brush, waterproof.'),
    ],
    hero: [
      {
        title: 'Care that fits your routine',
        subtitle: 'Skin, hair and daily essentials',
        badge: 'New',
        cta: 'Shop now',
      },
      {
        title: 'Simple ingredients, real results',
        subtitle: 'Dermatologist-friendly formulations',
        badge: 'Featured',
        cta: 'Browse catalogue',
      },
    ],
  },
  'Books & Stationery': {
    category: 'Books & Stationery',
    categorySlug: 'books-stationery',
    items: [
      mk('Hardbound Notebook A5', 499, 'Two hundred pages of ninety GSM paper.'),
      mk('Gel Pen Set', 349, 'Pack of ten quick-dry pens in assorted colours.'),
      mk('Fountain Pen', 1299, 'Medium nib with converter and ink cartridge.'),
      mk('Desk Organiser', 899, 'Multi-compartment organiser in powder-coated steel.'),
      mk('Sketch Pad A4', 599, 'Acid-free cartridge paper, one hundred sheets.'),
      mk('Highlighter Pack', 249, 'Set of six chisel-tip pastel highlighters.'),
      mk('Leather Journal', 1599, 'Refillable journal with elastic closure.'),
      mk('Sticky Notes Bundle', 199, 'Twelve pads in four sizes.'),
      mk('Document Folder', 449, 'Expanding folder with thirteen pockets.'),
      mk('Book Stand', 799, 'Adjustable bamboo reading stand.'),
    ],
    hero: [
      {
        title: 'For the desk you actually use',
        subtitle: 'Notebooks, pens and organisers',
        badge: 'New',
        cta: 'Shop now',
      },
      {
        title: 'Stationery worth keeping',
        subtitle: 'Considered tools for daily work',
        badge: 'Featured',
        cta: 'Browse catalogue',
      },
    ],
  },
  'Sports & Fitness': {
    category: 'Sports & Fitness',
    categorySlug: 'sports-fitness',
    items: [
      mk('Yoga Mat 6mm', 1299, 'Non-slip TPE mat with carrying strap.'),
      mk('Adjustable Dumbbell', 3499, 'Two-point-five to twenty-four kilogram range.'),
      mk('Resistance Band Set', 899, 'Five bands with door anchor and handles.'),
      mk('Skipping Rope', 449, 'Ball-bearing rope with adjustable length.'),
      mk('Foam Roller', 1099, 'High-density roller for muscle recovery.'),
      mk('Water Bottle 1L', 699, 'Insulated stainless steel, twelve-hour cold.'),
      mk('Gym Gloves', 799, 'Padded palm with wrist support strap.'),
      mk('Running Shorts', 1199, 'Moisture-wicking fabric with zip pocket.'),
      mk('Protein Shaker', 499, 'Leak-proof shaker with mixing ball.'),
      mk('Ankle Weights Pair', 1399, 'One kilogram each with adjustable straps.'),
    ],
    hero: [
      {
        title: 'Train at home, properly',
        subtitle: 'Equipment that lasts past January',
        badge: 'New',
        cta: 'Shop now',
      },
      {
        title: 'Kit for every session',
        subtitle: 'Strength, mobility and recovery',
        badge: 'Featured',
        cta: 'Browse catalogue',
      },
    ],
  },
  'Toys & Games': {
    category: 'Toys & Games',
    categorySlug: 'toys-games',
    items: [
      mk('Wooden Building Blocks', 1299, 'Fifty-piece set in untreated hardwood.'),
      mk('Strategy Board Game', 1999, 'Two to four players, forty-five minute play.'),
      mk('Jigsaw Puzzle 1000pc', 899, 'Poster-quality print with storage box.'),
      mk('Remote Control Car', 2499, 'Rechargeable with two-point-four gigahertz control.'),
      mk('Plush Bear', 749, 'Hypoallergenic filling, machine washable.'),
      mk('Art & Craft Kit', 1099, 'Paints, brushes and canvas for beginners.'),
      mk('Magnetic Tiles Set', 2799, 'Sixty translucent tiles for open play.'),
      mk('Card Game Set', 599, 'Three family card games in one box.'),
      mk('Science Experiment Kit', 1699, 'Twenty guided experiments with manual.'),
      mk('Ride-On Scooter', 3299, 'Three-wheel scooter with adjustable handlebar.'),
    ],
    hero: [
      { title: 'Play that lasts', subtitle: 'Toys and games for every age', badge: 'New', cta: 'Shop now' },
      {
        title: 'Screen-free favourites',
        subtitle: 'Build, solve and imagine',
        badge: 'Featured',
        cta: 'Browse catalogue',
      },
    ],
  },
  'Industrial & B2B': {
    category: 'Industrial Supplies',
    categorySlug: 'industrial-supplies',
    items: [
      mk('Hex Bolt Assortment', 1499, 'Grade eight-point-eight zinc-plated, assorted sizes.'),
      mk('Torque Wrench', 3999, 'Twenty to two hundred newton metre, calibrated.'),
      mk('Safety Helmet', 899, 'ISI-marked helmet with ratchet suspension.'),
      mk('Cut-Resistant Gloves', 699, 'Level five protection, coated palm.'),
      mk('Digital Vernier Caliper', 2499, 'Zero to one hundred fifty millimetre, stainless.'),
      mk('Cordless Drill 18V', 5999, 'Two-speed drill with battery and charger.'),
      mk('Measuring Tape 8m', 549, 'Steel blade with nylon coating and lock.'),
      mk('Industrial Adhesive', 799, 'High-strength epoxy for metal and plastic.'),
      mk('Tool Storage Box', 2199, 'Three-tier cantilever box in steel.'),
      mk('Safety Goggles', 449, 'Anti-fog polycarbonate with side shields.'),
    ],
    hero: [
      {
        title: 'Supplies for the working day',
        subtitle: 'Fasteners, tools and safety gear',
        badge: 'New',
        cta: 'Shop now',
      },
      {
        title: 'Bulk pricing available',
        subtitle: 'Request a quotation on any line',
        badge: 'B2B',
        cta: 'Browse catalogue',
      },
    ],
  },
  'Food & Groceries': {
    category: 'Food & Groceries',
    categorySlug: 'food-groceries',
    items: [
      mk('Cold Pressed Oil 1L', 649, 'Single-origin, unrefined and filtered.'),
      mk('Organic Honey 500g', 549, 'Raw multifloral honey, unpasteurised.'),
      mk('Basmati Rice 5kg', 899, 'Aged long-grain rice in resealable pack.'),
      mk('Mixed Nuts 500g', 999, 'Almonds, cashews and pistachios, unsalted.'),
      mk('Green Tea 100 bags', 449, 'Whole-leaf green tea in foil-wrapped bags.'),
      mk('Filter Coffee 250g', 599, 'Medium roast arabica-robusta blend.'),
      mk('Whole Wheat Atta 5kg', 429, 'Stone-ground flour, chakki fresh.'),
      mk('Spice Sampler Box', 1199, 'Eight whole spices in glass jars.'),
      mk('Dark Chocolate Pack', 749, 'Seventy percent cocoa, pack of four.'),
      mk('Millet Mix 1kg', 399, 'Five-millet blend for daily cooking.'),
    ],
    hero: [
      {
        title: 'Pantry staples, sourced well',
        subtitle: 'Everyday groceries you can trust',
        badge: 'New',
        cta: 'Shop now',
      },
      {
        title: 'Fresh stock every week',
        subtitle: 'Grains, oils, spices and more',
        badge: 'Featured',
        cta: 'Browse catalogue',
      },
    ],
  },
  Other: {
    category: 'General',
    categorySlug: 'general',
    items: [
      mk('Sample Product One', 999, 'Replace this with your own product details.'),
      mk('Sample Product Two', 1499, 'Replace this with your own product details.'),
      mk('Sample Product Three', 799, 'Replace this with your own product details.'),
      mk('Sample Product Four', 2499, 'Replace this with your own product details.'),
      mk('Sample Product Five', 1299, 'Replace this with your own product details.'),
      mk('Sample Product Six', 1899, 'Replace this with your own product details.'),
      mk('Sample Product Seven', 649, 'Replace this with your own product details.'),
      mk('Sample Product Eight', 3299, 'Replace this with your own product details.'),
      mk('Sample Product Nine', 1099, 'Replace this with your own product details.'),
      mk('Sample Product Ten', 2199, 'Replace this with your own product details.'),
    ],
    hero: [
      {
        title: 'Welcome to your new store',
        subtitle: 'Edit this banner from Admin, Hero Slides',
        badge: 'Getting started',
        cta: 'Shop now',
      },
      {
        title: 'Your products, your way',
        subtitle: 'Replace these samples with your catalogue',
        badge: 'Featured',
        cta: 'Browse catalogue',
      },
    ],
  },
}

/** Map an onboarding category to a catalogue, falling back to the generic one. */
export function catalogFor(profile: string): SeedCatalog {
  return SEED_CATALOGS[profile] ?? SEED_CATALOGS.Other
}

export const SEED_PROFILES = Object.keys(SEED_CATALOGS)
