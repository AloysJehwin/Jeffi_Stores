import { z } from 'zod'
import { defineCodeComponent } from '../registry'
import { layoutProps } from './common'
import {
  brandIndex,
  currentBrand,
  currentCategory,
  renderAllBrands,
  renderAllCategories,
  renderBrand,
  renderBreadcrumbs,
  renderCategory,
  renderCategoryFaqs,
  renderSearchQuery,
  renderSeoText,
  renderSubCategories,
  seoCopy,
} from '@/components/visitor/site/code/parts/taxonomy/server'

// The catalogue pages' parts: a category or brand page's own record and what hangs off it (subcategories, FAQs, SEO
// copy), the breadcrumbs, the search term, and every category or brand for the index pages. They read the page they
// are on, so a design never names a category or brand: the store's own fill it in.

const list = layoutProps

const SUBCATEGORY: Record<string, string> = {
  id: 'category id',
  slug: 'URL slug',
  name: 'subcategory name',
  url: 'link to it',
  image: 'picture URL, or null',
  productCount: 'number of products in it',
}

defineCodeComponent({
  name: 'Category',
  pages: ['category'],
  props: z.object({}),
  binding: {
    id: 'category id',
    slug: 'URL slug',
    name: "category name: the page's h1",
    url: 'link to this category',
    description: 'description text, may be empty',
    tagline: 'one-line tagline, may be empty',
    image: 'hero picture URL, or null',
    mobileImage: 'hero picture for phones, or null',
    bannerUrl: 'where the hero picture links (a /path or https URL), or null',
    parentName: 'parent category name, or null at the top level',
    parentUrl: 'link to the parent category, or null',
    productCount: 'number of products in it and its subcategories',
  },
  describe:
    "The page's own category as data: {c => …} renders once with its fields (the name is the page's h1). Without a function, its heading, description and hero picture. The store fills it in per category: never type a category.",
  count: async (_props, data) => ((await currentCategory(data)) ? 1 : 0),
  render: (props, ctx) => renderCategory(ctx, props),
})

defineCodeComponent({
  name: 'SubCategories',
  pages: ['category'],
  props: z.object({ variant: z.enum(['chips', 'tiles']).default('chips').describe('without a function: name chips or picture tiles'), ...list }),
  binding: SUBCATEGORY,
  describe: "This category's own subcategories (nothing when it has none): {s => …} renders each, else chips or picture tiles.",
  count: async (_props, data) => (await currentCategory(data))?.children.length ?? 0,
  render: (props, ctx) => renderSubCategories(ctx, props),
})

defineCodeComponent({
  name: 'CategoryFaqs',
  pages: ['category'],
  props: z.object({ defaultOpen: z.boolean().default(false).describe('open the first question') }),
  binding: { question: 'the question', answer: 'the answer (keep its line breaks with whitespace-pre-line)' },
  describe: "The category's questions and answers (nothing when it has none): an accordion, or {f => …} per question.",
  count: async (_props, data) => (await currentCategory(data))?.faqs.length ?? 0,
  render: (props, ctx) => renderCategoryFaqs(ctx, props),
})

defineCodeComponent({
  name: 'SeoText',
  pages: ['category', 'brand'],
  props: z.object({}),
  binding: { text: 'the copy as plain text', paragraphs: 'the copy as paragraphs (string[]): s.paragraphs.map(t => <p>{t}</p>)' },
  describe: "The category's or brand's longer copy for shoppers and search engines, usually under the products (nothing when empty): paragraphs styled by className, or {s => …}.",
  count: async (_props, data) => ((await seoCopy(data, null)) ? 1 : 0),
  render: (props, ctx) => renderSeoText(ctx, props),
})

defineCodeComponent({
  name: 'Breadcrumbs',
  pages: ['category', 'brand', 'products', 'search', 'categories', 'brands'],
  props: z.object({}),
  binding: { name: 'crumb text', url: 'its link, or null for the current page', current: 'true for the current page (the last crumb)' },
  describe: "The page's trail (Home / Categories / parent / this category, Home / Brands / this brand…): a slash-separated trail, or {b => …} per crumb.",
  render: (props, ctx) => renderBreadcrumbs(ctx, props),
})

defineCodeComponent({
  name: 'Brand',
  pages: ['brand'],
  props: z.object({}),
  binding: {
    id: 'brand id',
    slug: 'URL slug',
    name: "brand name: the page's h1",
    url: 'link to this brand',
    logo: 'logo URL, or null',
    tagline: 'one-line tagline, may be empty',
    description: 'description text, may be empty',
    story: 'the brand story (paragraphs split by blank lines), may be empty',
    website: 'its https website, or null',
    color: 'its colour as "#rrggbb", or null (classes cannot use it)',
    image: 'banner picture URL, or null',
    mobileImage: 'banner picture for phones, or null',
    founded: 'founding year, or null',
    headquarters: 'where it is based, or null',
    origin: 'country of origin, or null',
    socials: 'social profiles as { network, label, href }[]: b.socials.map(s => <Link href={s.href}>{s.label}</Link>)',
    productCount: 'number of products',
  },
  describe:
    "The page's own brand as data: {b => …} renders once with its fields (the name is the page's h1). Without a function, its logo, heading, description, links and banner. The store fills it in per brand: never type a brand.",
  count: async (_props, data) => ((await currentBrand(data)) ? 1 : 0),
  render: (props, ctx) => renderBrand(ctx, props),
})

defineCodeComponent({
  name: 'SearchQuery',
  pages: ['search'],
  props: z.object({}),
  binding: { term: 'what the shopper searched for', total: 'number of matching products' },
  describe: 'What the shopper searched for: {q => …} renders once with the term and the number of results; without a function, a "Results for …" heading.',
  render: (props, ctx) => renderSearchQuery(ctx, props),
})

defineCodeComponent({
  name: 'AllCategories',
  pages: ['categories'],
  required: ['categories'],
  props: z.object({ ...list }),
  binding: {
    id: 'category id',
    slug: 'URL slug',
    name: 'category name',
    url: 'link to the category',
    image: 'picture URL, or null',
    tagline: 'one-line tagline, may be empty',
    description: 'description text, may be empty',
    productCount: 'number of products in it and its subcategories',
    children: `its subcategories as { ${Object.keys(SUBCATEGORY).join(', ')} }[]: c.children.map(s => <Link href={s.url}>{s.name}</Link>)`,
  },
  describe: "Every top-level category of the store with its subcategories and product counts: {c => …} renders each, else picture cards.",
  count: async (_props, data) => (await data.allCategories()).length,
  render: (props, ctx) => renderAllCategories(ctx, props),
})

defineCodeComponent({
  name: 'AllBrands',
  pages: ['brands'],
  required: ['brands'],
  props: z.object({ featured: z.boolean().default(false).describe("only the store's featured brands"), ...list }),
  binding: {
    id: 'brand id',
    slug: 'URL slug',
    name: 'brand name',
    url: 'link to the brand',
    logo: 'logo URL, or null',
    tagline: 'one-line tagline, may be empty',
    description: 'description text, may be empty',
    productCount: 'number of products',
    featured: "true for the store's featured brands (they come first)",
  },
  describe: 'Every brand of the store with its logo and product count, featured first: {b => …} renders each, else logo cards.',
  count: async (props, data) => (await brandIndex(data, props.featured === true)).length,
  render: (props, ctx) => renderAllBrands(ctx, props),
})
