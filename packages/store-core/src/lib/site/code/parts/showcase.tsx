import type { ReactNode } from 'react'
import { z } from 'zod'
import { defineCodeComponent, type RenderCtx } from '../registry'
import { MAX_EACH } from '../allow'
import type { SiteData } from '../../data/types'
import { emptyShowcaseContent, type ShowcaseView } from '@/lib/showcase/types'
import { businessView, faqViews, pictureView, serviceViews, statViews, testimonialViews, workViews } from '@/lib/showcase/views'
import { ASPECTS, CodeImage, ItemsLayout } from '@/components/visitor/site/code/common/tiles'
import { layoutProps } from './common'
import { FaqList, ServiceCard, StatTile, TestimonialCard, WorkTile } from '@/components/visitor/site/code/parts/showcase/tiles'
import LeadFormPart, { type LeadField } from '@/components/visitor/site/code/parts/showcase/LeadFormPart'

// The Showcase parts: a business's one-page site reads its details and content (services, work, reviews, stats, FAQs)
// through these, from SiteData.showcase() (lib/showcase/site-data.ts), and takes leads with LeadForm. Only the
// `showcase` page may use them; that page takes no shop part, only these and the decoration parts (library.ts
// SHOWCASE_DECOR).

const PAGES: ['showcase'] = ['showcase']
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
const view = async (data: SiteData): Promise<ShowcaseView | null> => (data.showcase ? data.showcase().catch(() => null) : null)
const items = <T,>(list: T[], ctx: RenderCtx, tile: (item: T, i: number) => ReactNode) => list.slice(0, MAX_EACH).map((it, i) => (ctx.renderItem ? ctx.renderItem(it, i) : tile(it, i)))

defineCodeComponent({
  name: 'Business',
  pages: PAGES,
  props: z.object({}),
  binding: {
    name: 'business name',
    tagline: 'tagline (may be empty)',
    profession: 'what they do, e.g. "Wedding photographer" (may be empty)',
    about: 'about text (may be empty)',
    logo: 'logo URL or null',
    initial: "the name's first letter, for a mark when there is no logo",
    phone: 'phone as written (may be empty)',
    phoneUrl: 'tel: link for the phone, or empty',
    whatsapp: 'WhatsApp number (may be empty)',
    whatsappUrl: 'https://wa.me/… chat link, or empty',
    email: 'email (may be empty)',
    emailUrl: 'mailto: link, or empty',
    address: 'street address (may be empty)',
    city: 'city',
    state: 'state',
    pincode: 'PIN code',
    location: '"City, State" (may be empty)',
    fullAddress: 'address, city, state and PIN on one line (may be empty)',
    hours: 'opening hours (may be empty)',
    mapUrl: 'map link for the address, or empty',
    socials: 'array of { network, href, label } (may be empty)',
    year: 'the current year',
    facts: 'only the details the business gave, as rows: array of { key ("hours", "address", "phone", "whatsapp" or "email"), label, value, href (a link, empty for hours), icon (an Icon name) }; {b.facts.map(f => …)} draws hours, address and contact rows with no row for a missing one',
  },
  describe:
    "The business's details, once: <Business>{b => <a href={b.whatsappUrl}>Chat on WhatsApp</a>}</Business>. Name, logo, contact details, hours, address and socials come only from here. A detail the business did not give has no row at all: guard each one (b.hours && …) or draw the rows from b.facts; never a stand-in such as \"Call for today's hours\" or \"In your neighbourhood\".",
  async render(_props, ctx) {
    if (!ctx.renderItem) return null
    const v = await view(ctx.data)
    return v ? ctx.renderItem(businessView(v.business), 0) : null
  },
})

const PictureProps = z.object({
  index: z.number().int().min(0).max(5).default(0).describe('which picture: 0 in the opening, 1, 2… in later sections so they differ'),
  aspect: z.enum(ASPECTS).default('4:5').describe('the picture shape without a render function'),
  fit: z.enum(['cover', 'contain']).default('cover'),
  sizes: z.string().max(200).regex(/^[\w\s(),.:%-]*$/).optional().describe('e.g. "(min-width: 1024px) 50vw, 100vw"'),
  priority: z.boolean().default(false).describe('load it eagerly even outside the first section'),
})
defineCodeComponent({
  name: 'BusinessPicture',
  pages: PAGES,
  props: PictureProps,
  binding: {
    kind: '"work" (the owner\'s own photo of their work), "mood" (a picture made for this page: never call it their work, a project or a client\'s) or "none" (no picture yet: <Image src={p.image}> draws a designed fill)',
    image: 'picture URL, or null when there is none yet',
    alt: 'what it shows (may be empty)',
  },
  describe:
    "A picture for the page that is always there: the owner's photo of their work, else a picture made for this page, else a designed fill in the theme's colours. The opening section always has one. Without a render function, the picture itself (aspect, fit); {p => …} to lay it out yourself.",
  async render(props, ctx) {
    const p = props as z.infer<typeof PictureProps>
    const v = await view(ctx.data)
    const pic = pictureView(v?.business ?? { name: '' }, v?.content ?? emptyShowcaseContent(), p.index)
    if (ctx.renderItem) return ctx.renderItem(pic, 0)
    return <CodeImage src={pic.image} alt={pic.alt} aspect={p.aspect} fit={p.fit} sizes={p.sizes ?? '(min-width: 1024px) 50vw, 100vw'} priority={p.priority || ctx.claimPriority()} className={str(props.className)} />
  },
})

const ServicesProps = z.object({ limit: z.number().int().min(1).max(24).default(12), aspect: z.enum(ASPECTS).optional().describe('picture shape of the default cards'), ...layoutProps })
defineCodeComponent({
  name: 'Services',
  pages: PAGES,
  props: ServicesProps,
  binding: { title: 'service name', description: 'what it is (may be empty)', price: 'price as the owner wrote it, e.g. "From ₹2,000" (may be empty)', image: 'image URL or null', number: '"01", "02"…' },
  describe: "The business's services. Without a render function each shows as a card (picture, name, description, price).",
  count: async (props, data) => {
    const v = await view(data)
    return v ? Math.min(serviceViews(v.content).length, (props as z.infer<typeof ServicesProps>).limit) : 0
  },
  async render(props, ctx) {
    const p = props as z.infer<typeof ServicesProps>
    const v = await view(ctx.data)
    const list = v ? serviceViews(v.content).slice(0, p.limit) : []
    if (!list.length) return null
    return (
      <ItemsLayout layout={p.layout} className={str(props.className)} itemClassName={p.itemClassName} label="Services" fallbackGrid="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items(list, ctx, (s, i) => <ServiceCard key={i} s={s} aspect={p.aspect} />)}
      </ItemsLayout>
    )
  },
})

const WorkProps = z.object({ limit: z.number().int().min(1).max(24).default(12), aspect: z.enum(ASPECTS).optional().describe('picture shape of the default tiles (default 1:1)'), ...layoutProps })
defineCodeComponent({
  name: 'Work',
  pages: PAGES,
  props: WorkProps,
  binding: { title: 'title (may be empty)', description: 'short description (may be empty)', image: 'picture URL (always set)', link: 'https link to the project, or empty', number: '"01", "02"…' },
  describe: "Work samples: only the owner's own uploads (a portfolio gallery), so a section built on it hides, with the links to it, until they add some; never fill a gallery with <BusinessPicture>. Without a render function each shows as a picture tile with its caption.",
  count: async (props, data) => {
    const v = await view(data)
    return v ? Math.min(workViews(v.content).length, (props as z.infer<typeof WorkProps>).limit) : 0
  },
  async render(props, ctx) {
    const p = props as z.infer<typeof WorkProps>
    const v = await view(ctx.data)
    const list = v ? workViews(v.content).slice(0, p.limit) : []
    if (!list.length) return null
    return (
      <ItemsLayout layout={p.layout} className={str(props.className)} itemClassName={p.itemClassName} label="Our work" fallbackGrid="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
        {items(list, ctx, (w, i) => <WorkTile key={i} w={w} aspect={p.aspect} priority={i === 0 && ctx.claimPriority()} />)}
      </ItemsLayout>
    )
  },
})

const TestimonialsProps = z.object({ limit: z.number().int().min(1).max(12).default(6), minRating: z.number().int().min(1).max(5).default(1), ...layoutProps })
defineCodeComponent({
  name: 'Testimonials',
  pages: PAGES,
  props: TestimonialsProps,
  binding: { name: "client's name", quote: 'what they said', rating: '1–5 or null', stars: 'the rating as "★★★★★", or empty', source: 'where it was said, e.g. "Google" (may be empty)', avatar: 'photo URL or null', initial: "the name's first letter" },
  describe: "What clients say about the business: only the reviews the owner added, so a section built on it hides until there are some; never write a quote, a name or a rating yourself. Without a render function each shows as a quote card.",
  count: async (props, data) => {
    const p = props as z.infer<typeof TestimonialsProps>
    const v = await view(data)
    return v ? Math.min(testimonialViews(v.content, p.minRating).length, p.limit) : 0
  },
  async render(props, ctx) {
    const p = props as z.infer<typeof TestimonialsProps>
    const v = await view(ctx.data)
    const list = v ? testimonialViews(v.content, p.minRating).slice(0, p.limit) : []
    if (!list.length) return null
    return (
      <ItemsLayout layout={p.layout} className={str(props.className)} itemClassName={p.itemClassName || 'w-[85%] md:w-[32%]'} label="Testimonials" fallbackGrid="grid gap-5 md:grid-cols-3">
        {items(list, ctx, (t, i) => <TestimonialCard key={i} t={t} />)}
      </ItemsLayout>
    )
  },
})

const StatsProps = z.object({ limit: z.number().int().min(1).max(8).default(4), ...layoutProps })
defineCodeComponent({
  name: 'Stats',
  pages: PAGES,
  props: StatsProps,
  binding: { value: 'the number as written, e.g. "500+"', label: 'what it counts, e.g. "weddings shot"' },
  describe: 'Numbers the business is proud of. Without a render function each shows as a big number over its label.',
  count: async (props, data) => {
    const v = await view(data)
    return v ? Math.min(statViews(v.content).length, (props as z.infer<typeof StatsProps>).limit) : 0
  },
  async render(props, ctx) {
    const p = props as z.infer<typeof StatsProps>
    const v = await view(ctx.data)
    const list = v ? statViews(v.content).slice(0, p.limit) : []
    if (!list.length) return null
    return (
      <ItemsLayout layout={p.layout} className={str(props.className)} itemClassName={p.itemClassName} label="Numbers" fallbackGrid="grid grid-cols-2 gap-6 md:grid-cols-4">
        {items(list, ctx, (s, i) => <StatTile key={i} s={s} />)}
      </ItemsLayout>
    )
  },
})

const FaqsProps = z.object({
  limit: z.number().int().min(1).max(20).default(10),
  multiple: z.boolean().default(false).describe('default list: let several answers be open at once'),
  defaultOpen: z.boolean().default(true).describe('default list: open the first answer'),
})
defineCodeComponent({
  name: 'Faqs',
  pages: PAGES,
  props: FaqsProps,
  binding: { question: 'the question', answer: 'the answer' },
  describe: 'Questions clients ask, with answers. Without a render function they show as an accordion; with one, wrap it in <Accordion> to draw <AccordionItem title={f.question}>.',
  count: async (props, data) => {
    const v = await view(data)
    return v ? Math.min(faqViews(v.content).length, (props as z.infer<typeof FaqsProps>).limit) : 0
  },
  async render(props, ctx) {
    const p = props as z.infer<typeof FaqsProps>
    const v = await view(ctx.data)
    const list = v ? faqViews(v.content).slice(0, p.limit) : []
    if (!list.length) return null
    if (ctx.renderItem) return <div className={str(props.className)}>{list.map((f, i) => ctx.renderItem!(f, i))}</div>
    return <FaqList faqs={list} multiple={p.multiple} defaultOpen={p.defaultOpen} className={str(props.className)} />
  },
})

const LeadFormProps = z.object({
  fields: z
    .array(z.enum(['name', 'phone', 'email', 'message']))
    .min(1)
    .max(4)
    .default(['name', 'phone', 'message'])
    .describe('the name is always asked, and a phone or an email'),
  submitLabel: z.string().trim().min(1).max(40).default('Send'),
  successText: z.string().trim().min(1).max(200).default('Thank you. We will get back to you soon.'),
  messagePlaceholder: z.string().trim().max(120).optional(),
})
defineCodeComponent({
  name: 'LeadForm',
  pages: PAGES,
  // A business page without a way to reach the business defeats it: the editors refuse to remove the form.
  required: ['showcase'],
  props: LeadFormProps,
  describe: 'The enquiry form: visitors leave their name, phone or email and a message, and the business gets it as a lead. className lays out the form (e.g. "grid gap-4 sm:grid-cols-2").',
  async render(props, ctx) {
    const p = props as z.infer<typeof LeadFormProps>
    const v = await view(ctx.data)
    const asked = new Set<LeadField>(['name', ...p.fields])
    if (!asked.has('phone') && !asked.has('email')) asked.add('phone')
    const fields = (['name', 'phone', 'email', 'message'] as LeadField[]).filter(f => asked.has(f))
    return (
      <LeadFormPart
        endpoint={v?.leadEndpoint ?? null}
        fields={fields}
        submitLabel={p.submitLabel}
        successText={p.successText}
        messagePlaceholder={p.messagePlaceholder}
        className={str(props.className)}
      />
    )
  },
})
