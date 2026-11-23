import { describe, it, expect, vi } from 'vitest'
import { cloneElement, createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// A Showcase made from little input is still whole: every ready-made template (and a page written like the live
// "Latte" one) drawn through the live page's own path (planSections + CodeSection over showcaseSiteData) for a
// business with only a name and a phone. The header, opening and contact always draw, every in-page link lands, the
// page has a picture, no typed stand-in poses as a missing fact and no quote shows without a real review. Plus the
// pieces those stand on: the stand-in rows, the lint, the starter content and the cleaning that keeps it.

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children) }))

import { SHOWCASE_TEMPLATES } from '@/lib/site/themes/templates/index'
import { checkSection, compileSection, type CompiledSection } from '@/lib/site/code/compile'
import CodeSection, { planSections } from '@/components/visitor/site/code/CodeSection'
import { Resolve } from '@/components/visitor/site/code/interpret'
import { placeholderRows } from '@/lib/site/code/placeholders'
import { LINT, studioLint } from '@/lib/site/studio/lint'
import { writeOrder } from '@/lib/site/studio/generate'
import { showcaseSiteData } from '@/lib/showcase/site-data'
import { cleanContent } from '@/lib/showcase/clean'
import { cleanStarter, starterFaqs, starterFill } from '@/lib/showcase/starter'
import { businessView, pictureView } from '@/lib/showcase/views'
import { emptyShowcaseContent, type ShowcaseBusiness, type ShowcaseContent, type ShowcaseView } from '@/lib/showcase/types'

type Template = { pages?: Record<string, { sections: { label: string; source: string }[] }> }

async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve))
  if (!isValidElement(node)) return node
  if (node.type === Resolve) return resolve(await (node.props as { promise: Promise<ReactNode> }).promise)
  const kids = (node.props as { children?: ReactNode }).children
  if (kids === undefined) return node
  // Children keep their shape: a list stays a list (ItemsLayout maps over it).
  return cloneElement(node, { children: Array.isArray(kids) ? await Promise.all(kids.map(resolve)) : await resolve(kids) } as never)
}

const compiled = new Map<string, Promise<CompiledSection>>()
function compile(source: string): Promise<CompiledSection> {
  if (!compiled.has(source))
    compiled.set(
      source,
      compileSection(source, { page: 'showcase' }).then(r => {
        if (!r.ok) throw new Error(JSON.stringify(r.issues))
        return r.section
      })
    )
  return compiled.get(source)!
}

/** The page as showcase-service draws it, as a document, with which sections drew. */
async function drawPage(sources: string[], view: ShowcaseView) {
  const sections = await Promise.all(sources.map(compile))
  const data = showcaseSiteData(view)
  const plan = await planSections(sections, data)
  const parts = await Promise.all(
    sections.map(async (section, i) => {
      const el = await CodeSection({ section, id: `b${i}`, page: 'showcase', data, priority: i === 0, always: plan.always[i], anchors: plan.anchors })
      return el ? renderToStaticMarkup(createElement('div', null, await resolve(el))) : ''
    })
  )
  const root = document.createElement('div')
  root.innerHTML = parts.join('')
  return { root, shown: parts.map(html => html.length > 0) }
}

const BARE: ShowcaseBusiness = { name: 'Latte', phone: '9345820023' }
const bare = (content: ShowcaseContent = emptyShowcaseContent()): ShowcaseView => ({ business: BARE, content, leadEndpoint: '/api/leads' })

const STAND_INS = /in your neighbou?rhood|message us for today|call (us )?for (today|hours|timings)|coming soon|lorem ipsum|address on request|hours on request/i
const PICTURE = 'img, [role="img"], [data-picture-fallback]'

/** Links on the page to a part of it that is not there (#top always lands). */
function deadLinks(root: HTMLElement): string[] {
  return [...root.querySelectorAll('a[href]')]
    .map(a => a.getAttribute('href') ?? '')
    .filter(h => /^\/?#/.test(h))
    .map(h => h.replace(/^\/?#/, ''))
    .filter(id => id.toLowerCase() !== 'top' && !root.querySelector(`[id="${id}"]`))
}

const TEMPLATES = Object.entries(SHOWCASE_TEMPLATES as Record<string, Template>).filter(([, t]) => t.pages?.['showcase:home']?.sections?.length)

describe('a Showcase template with only a name and a phone', () => {
  it('has ready templates to check', () => expect(TEMPLATES.length).toBeGreaterThanOrEqual(2))

  for (const [style, file] of TEMPLATES) {
    const sources = file.pages!['showcase:home'].sections.map(s => s.source)
    it(`${style}: draws its core, links only to what is there, has a picture, no stand-in and no quote`, async () => {
      const { root, shown } = await drawPage(sources, bare())
      // The header, the opening (its h1), the contact form and the footer.
      expect(shown[0], 'header').toBe(true)
      expect(shown[shown.length - 1], 'footer').toBe(true)
      expect(root.querySelector('h1'), 'the opening and its h1').not.toBeNull()
      expect(root.querySelector('form'), 'the enquiry form').not.toBeNull()
      expect(shown.filter(Boolean).length).toBeGreaterThanOrEqual(4)
      expect(root.textContent).toContain('Latte')
      expect(deadLinks(root)).toEqual([])
      expect(root.querySelector(PICTURE), 'a picture or a designed fill').not.toBeNull()
      expect(root.textContent ?? '').not.toMatch(STAND_INS)
      // No reviews: no quote, no reviews section, no stars.
      expect(root.querySelector('blockquote, q')).toBeNull()
      expect(root.querySelector('#reviews')).toBeNull()
      expect(root.querySelector('svg.lucide-star')).toBeNull()
    }, 60_000)

    it(`${style}: with starter services and questions their sections draw and the links to them stay`, async () => {
      const content = { ...emptyShowcaseContent(), ...starterFill(emptyShowcaseContent(), { services: [{ title: 'Filter coffee', ai: true }, { title: 'Fresh bakes', ai: true }], faqs: [] }, BARE) }
      const { root } = await drawPage(sources, bare(content as ShowcaseContent))
      expect(root.textContent).toContain('Filter coffee')
      expect(root.textContent).toContain('How can I get in touch?')
      expect(root.querySelector('#services')).not.toBeNull()
      expect(root.querySelector('#faq')).not.toBeNull()
      expect(deadLinks(root)).toEqual([])
      expect(root.querySelector('a[href="#services"], a[href="#faq"]')).not.toBeNull()
    }, 60_000)

    it(`${style}: the opening shows the owner's work photo, else a picture made for the page`, async () => {
      const mood = { ...emptyShowcaseContent(), pictures: [{ image: 'https://cdn.example.com/mood.webp', ai: true }] }
      const a = await drawPage(sources, bare(mood))
      expect(a.root.querySelector('img[src*="mood.webp"]')).not.toBeNull()
      const work = { ...mood, work: [{ title: 'A wedding', image: 'https://cdn.example.com/work.webp' }] }
      const b = await drawPage(sources, bare(work))
      expect(b.root.querySelector('h1')?.closest('[data-code-section]')?.querySelector('img[src*="work.webp"]')).not.toBeNull()
    }, 60_000)

    it(`${style}: every section passes the Showcase lint`, async () => {
      for (const s of file.pages!['showcase:home'].sections) {
        const r = checkSection(s.source, { page: 'showcase' })
        if (!r.ok) throw new Error(`${s.label}: ${JSON.stringify(r.issues)}`)
        const notes = studioLint(r.ast, 'showcase').filter(n => [LINT.showcaseHero, LINT.standIn, LINT.quotes, LINT.anchor].includes(n as never))
        expect(notes, s.label).toEqual([])
      }
    })
  }
})

// A page written as the live Latte one was: a header linking to every section, an opening built on a work picture,
// an hours band with typed stand-ins, a story, sections over empty data, a typed testimonial, contact and footer.
const LATTE = [
  `const NAV = [{ label: 'Our story', href: '#about' }, { label: 'Menu', href: '#services' }, { label: 'The room', href: '#work' }, { label: 'Kind words', href: '#reviews' }, { label: 'Before you come', href: '#faq' }, { label: 'Say hello', href: '#contact' }]
export default function Section() {
  return (
    <header className="px-4 py-3">
      <Business>{b => <Link href="#top" className="font-display">{b.name}</Link>}</Business>
      <ul className="flex gap-4">
        {NAV.map((n, i) => (
          <li key={i}><Link href={n.href} className="text-sm">{n.label}</Link></li>
        ))}
      </ul>
    </header>
  )
}`,
  `export default function Section() {
  return (
    <section className="grid md:grid-cols-2">
      <Business>{b => <h1 className="font-display text-5xl">{b.name}</h1>}</Business>
      <Link href="#services" className="text-sm">See what we pour</Link>
      <Work limit={1}>{w => <Image src={w.image} alt={w.title} aspect="4:5" />}</Work>
    </section>
  )
}`,
  `export default function Section() {
  return (
    <section aria-label="Hours, address and call" className="py-16">
      <Business>
        {b => (
          <div className="grid gap-6 md:grid-cols-3">
            <div className="flex flex-col items-center">
              <Icon name="clock" />
              <h3 className="text-sm">Doors open</h3>
              <p className="text-base">{b.hours || "Message us for today’s hours"}</p>
              <p className="text-sm italic">The window seat is first come, first served.</p>
            </div>
            <div className="flex flex-col items-center">
              <Icon name="map-pin" />
              <h3 className="text-sm">Find us</h3>
              <address className="text-base">{b.fullAddress ? b.fullAddress : "In your neighbourhood"}</address>
            </div>
            <div className="flex flex-col items-center">
              <Icon name="phone" />
              <h3 className="text-sm">Ring the bar</h3>
              <p className="text-base">{b.phone}</p>
              {b.phoneUrl && <Link href={b.phoneUrl} className="text-sm">Tap to call</Link>}
            </div>
          </div>
        )}
      </Business>
    </section>
  )
}`,
  `export default function Section() {
  return (
    <section id="about" className="py-16">
      <Business>{b => (<div><h2 className="text-3xl">Our story</h2><p className="text-base">{b.about || b.tagline}</p></div>)}</Business>
      <Link href="#work" className="text-sm">Step inside the room</Link>
    </section>
  )
}`,
  `export default function Section() {
  return (
    <section id="services" className="py-16">
      <h2 className="text-3xl">The menu</h2>
      <Services />
    </section>
  )
}`,
  `export default function Section() {
  return (
    <section id="work" className="py-16">
      <h2 className="text-3xl">The room</h2>
      <Work />
    </section>
  )
}`,
  `export default function Section() {
  return (
    <section id="reviews" className="py-16">
      <h2 className="text-3xl">Kind words</h2>
      <figure className="p-6"><blockquote className="text-base">The best flat white in town.</blockquote><figcaption className="text-sm">Priya S.</figcaption></figure>
      <Testimonials />
    </section>
  )
}`,
  `export default function Section() {
  return (
    <section id="faq" className="py-16">
      <h2 className="text-3xl">Before you come</h2>
      <Faqs />
    </section>
  )
}`,
  `export default function Section() {
  return (
    <section id="contact" className="py-16">
      <h2 className="text-3xl">Say hello</h2>
      <LeadForm />
    </section>
  )
}`,
  `export default function Section() {
  return (
    <footer className="py-10">
      <Business>{b => <p className="text-sm">{b.name}, {b.year}</p>}</Business>
      <Link href="#reviews" className="text-sm">Kind words</Link>
      <Link href="#gallery" className="text-sm">Gallery</Link>
      <Link href="#top" className="text-sm">Back to the top</Link>
    </footer>
  )
}`,
]

describe('a page like the live Latte one, drawn again', () => {
  it('keeps its opening, drops links to sections that draw nothing, hides the stand-in rows and the typed quote', async () => {
    const { root, shown } = await drawPage(LATTE, bare())
    expect(shown).toEqual([true, true, true, true, false, false, false, false, true, true])
    expect(root.querySelector('h1')?.textContent).toBe('Latte')
    expect(deadLinks(root)).toEqual([])
    const hrefs = [...root.querySelectorAll('a')].map(a => a.getAttribute('href'))
    expect(hrefs).toEqual(expect.arrayContaining(['#top', '#about', '#contact', 'tel:+919345820023']))
    for (const gone of ['#services', '#work', '#reviews', '#faq', '#gallery']) expect(hrefs, gone).not.toContain(gone)
    // The emptied menu items go with their links.
    expect(root.querySelectorAll('header li').length).toBe(2)
    expect(root.textContent ?? '').not.toMatch(STAND_INS)
    expect(root.textContent).not.toContain('Doors open')
    expect(root.textContent).not.toContain('Find us')
    expect(root.textContent).toContain('Ring the bar')
    expect(root.querySelector('blockquote')).toBeNull()
    expect(root.textContent).not.toContain('Priya')
  }, 60_000)

  it('keeps the opening when the header sets the name in an h1 too', async () => {
    const header = `export default function Section() { return (<header><Business>{b => <h1 className="text-xl">{b.name}</h1>}</Business></header>) }`
    const sections = await Promise.all([header, LATTE[1], LATTE[4]].map(compile))
    expect((await planSections(sections, showcaseSiteData(bare()))).always).toEqual([true, true, false])
    // No h1 anywhere: the section after the header opens the page when it introduces the business.
    const hero = `export default function Section() { return (<section><Business>{b => <h2 className="text-5xl">{b.name}</h2>}</Business><Work limit={1} /></section>) }`
    const noH1 = await Promise.all([LATTE[0], hero, LATTE[4]].map(compile))
    expect((await planSections(noH1, showcaseSiteData(bare()))).always).toEqual([true, true, false])
  })

  it('shows the details and the sections once the business has them', async () => {
    const content: ShowcaseContent = {
      ...emptyShowcaseContent(),
      services: [{ title: 'Filter coffee' }],
      reviews: [{ name: 'Anu', quote: 'Lovely mornings here.' }],
      faqs: [{ q: 'Do you have Wi-Fi?', a: 'Yes.' }],
    }
    const view: ShowcaseView = { business: { ...BARE, hours: 'Daily 8–8', address: '12 Beach Road', city: 'Chennai' }, content, leadEndpoint: '/api/leads' }
    const { root, shown } = await drawPage(LATTE, view)
    expect(shown).toEqual([true, true, true, true, true, false, true, true, true, true])
    expect(root.textContent).toContain('Daily 8–8')
    expect(root.textContent).toContain('12 Beach Road')
    expect(root.textContent).toContain('Lovely mornings here.')
    // A grid's testimonial fills its cell: the slide width is the carousel's only.
    expect(root.querySelector('#reviews [class*="w-[85%]"]')).toBeNull()
    expect(root.querySelector('a[href="#services"]')).not.toBeNull()
    expect(root.querySelector('a[href="#faq"]')).not.toBeNull()
    expect(deadLinks(root)).toEqual([])
  }, 60_000)
})

describe('stand-ins for a missing detail', () => {
  const rows = (jsx: string) => {
    const r = checkSection(`export default function S() { return ${jsx} }`, { page: 'showcase' })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    return [...placeholderRows(r.ast).keys()].map(n => (n as { tag?: string; t: string }).tag ?? (n as { t: string }).t)
  }

  it('takes the small row around the stand-in, never the opening around it', () => {
    expect(rows('<Business>{b => <div><div className="card"><Icon name="clock" /><h3>Hours</h3><p>{b.hours || "Call for hours"}</p></div></div>}</Business>')).toEqual(['div'])
    expect(rows('<Business>{b => <div><h1>{b.name}</h1><p>{b.location || "Serving your neighbourhood"}</p><Link href="#contact">Write</Link></div>}</Business>')).toEqual(['p'])
    expect(rows('<Business>{b => <dl><div><dt>Find us</dt><dd>{b.fullAddress ? b.fullAddress : "Ask us"}</dd></div></dl>}</Business>')).toEqual(['div'])
    expect(rows('<Business>{b => <ul><li>{!b.hours && "Hours on request"}</li></ul>}</Business>')).toEqual(['li'])
  })

  it('leaves a link label, another field and a guarded row alone', () => {
    expect(rows('<Business>{b => b.mapUrl && <Link href={b.mapUrl}>{b.location ? b.location : "Open map"}</Link>}</Business>')).toEqual([])
    expect(rows('<Business>{b => <h1>{b.profession || b.name}</h1>}</Business>')).toEqual([])
    expect(rows('<Business>{b => b.hours && <p>{b.hours}</p>}</Business>')).toEqual([])
  })
})

describe('the Showcase lint', () => {
  const lint = (jsx: string) => {
    const r = checkSection(`export default function S() { return ${jsx} }`, { page: 'showcase' })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    return studioLint(r.ast, 'showcase')
  }

  it('asks the opening for BusinessPicture, never only a work picture', () => {
    expect(lint('<section><Business>{b => <h1>{b.name}</h1>}</Business><Work limit={1} /></section>')).toContain(LINT.showcaseHero)
    expect(lint('<section><Business>{b => <h1>{b.name}</h1>}</Business><BusinessPicture aspect="4:5" /></section>')).not.toContain(LINT.showcaseHero)
  })

  it('flags stand-ins, typed quotes and links to sections the page cannot have', () => {
    expect(lint('<section><Business>{b => <p>{b.hours || "Message us for today’s hours"}</p>}</Business></section>')).toContain(LINT.standIn)
    expect(lint('<section><p>In your neighbourhood</p></section>')).toContain(LINT.standIn)
    expect(lint('<section><figure><blockquote>Best coffee in town</blockquote></figure></section>')).toContain(LINT.quotes)
    expect(lint('<section><p>★★★★★ from our guests</p></section>')).toContain(LINT.quotes)
    expect(lint('<section>{[{ name: "Priya", quote: "Lovely" }].map((r, i) => <p key={i}>{r.quote}</p>)}</section>')).toContain(LINT.quotes)
    expect(lint('<nav><Link href="#gallery">Gallery</Link></nav>')).toContain(LINT.anchor)
    expect(lint('<nav>{[{ label: "Gallery", href: "#gallery" }].map((n, i) => <Link key={i} href={n.href}>{n.label}</Link>)}</nav>')).toContain(LINT.anchor)
    expect(lint('<nav><Link href="#services">Menu</Link><a href="#top">Top</a></nav>')).not.toContain(LINT.anchor)
    expect(lint('<section><Business>{b => b.hours && <p>{b.hours}</p>}</Business></section>')).toEqual([])
  })
})

describe('writing order', () => {
  it('writes the header, opening, contact and footer first and the sections that may stay hidden last', () => {
    const sections = ['Business', 'Business', 'Work', 'Services', 'Testimonials', 'Faqs', 'LeadForm', 'Business'].map((p, i) => ({ id: `s${i}`, label: p, intent: p, layout: '', parts: [p] }))
    expect(writeOrder({ page: 'showcase', sections })).toEqual([0, 1, 6, 7, 3, 5, 2, 4])
    expect(writeOrder({ page: 'home', sections })).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
})

describe('starter content', () => {
  it('answers only with the ways to reach the business it gave', () => {
    const faqs = starterFaqs({ name: 'Latte', phone: '9345820023' })
    expect(faqs.every(f => f.ai)).toBe(true)
    const text = faqs.map(f => f.a).join(' ')
    expect(text).toMatch(/call us/)
    expect(text).not.toMatch(/WhatsApp|email/)
    expect(text).not.toMatch(/\d/)
    expect(starterFaqs({ name: 'Latte', email: 'hi@latte.in', whatsapp: '919345820023' }).map(f => f.a).join(' ')).toMatch(/message us on WhatsApp, email us or leave/)
  })

  it('keeps no suggestion that states a fact the owner did not give', () => {
    const out = cleanStarter({
      services: [
        { title: 'Filter coffee', description: 'Strong South Indian coffee, made to order.' },
        { title: 'Fresh bakes', description: 'Our award-winning croissants since 2015.' },
        { title: 'Combo at ₹199' },
        { title: 'Filter coffee' },
      ],
      faqs: [
        { q: 'Can I book a table for a group?', a: 'Message us on WhatsApp with the day and how many of you are coming, and we will let you know.' },
        { q: 'When are you open?', a: 'Every day from 8 am to 10 pm.' },
        { q: 'Do you deliver?', a: 'Yes, free delivery within 3 km.' },
      ],
    })
    expect(out.services).toEqual([
      { title: 'Filter coffee', description: 'Strong South Indian coffee, made to order.', ai: true },
      { title: 'Fresh bakes', ai: true },
    ])
    expect(out.faqs.map(f => f.q)).toEqual(['Can I book a table for a group?'])
  })

  it('fills only the lists the owner left empty', () => {
    const suggested = { services: [{ title: 'Filter coffee', ai: true }], faqs: [{ q: 'Can I book a table?', a: 'Message us and we will let you know.', ai: true }] }
    const own: ShowcaseContent = { ...emptyShowcaseContent(), services: [{ title: 'Espresso' }] }
    const fill = starterFill(own, suggested, BARE)
    expect(fill.services).toBeUndefined()
    expect(fill.faqs?.map(f => f.q)).toEqual(['Can I book a table?', 'How can I get in touch?', 'Can I ask about something that is not on this page?'])
    expect(starterFill({ ...own, faqs: [{ q: 'Mine?', a: 'Yes.' }] }, suggested, BARE)).toEqual({})
  })

  it('keeps the AI mark and the page pictures through cleaning', () => {
    const c = cleanContent({
      services: [{ title: 'Filter coffee', ai: true }, { title: 'Espresso', ai: 'yes' }],
      faqs: [{ q: 'How can I get in touch?', a: 'Call us.', ai: true }],
      pictures: [{ image: 'https://cdn.example.com/mood.webp', ai: true }, { image: 'http://insecure.example.com/x.jpg' }],
    })
    expect(c.services).toEqual([{ title: 'Filter coffee', ai: true }, { title: 'Espresso' }])
    expect(c.faqs[0].ai).toBe(true)
    expect(c.pictures).toEqual([{ image: 'https://cdn.example.com/mood.webp', ai: true }])
    expect(cleanContent({}).pictures).toBeUndefined()
  })
})

describe('the business as the page reads it', () => {
  it('has a row for each detail it gave and none for the rest', () => {
    expect(businessView(BARE).facts.map(f => f.key)).toEqual(['phone'])
    expect(businessView({ ...BARE, hours: 'Daily 8–8', whatsapp: '919345820023' }).facts.map(f => [f.key, f.href ? 'link' : ''])).toEqual([
      ['hours', ''],
      ['phone', 'link'],
      ['whatsapp', 'link'],
    ])
  })

  it('draws the detail rows from b.facts, one per detail given', async () => {
    const rowsSection = `export default function Section() {
  return (
    <section className="py-10">
      <Business>
        {b => (
          <dl className="grid gap-4">
            {b.facts.map(f => (
              <div key={f.key} className="flex gap-3">
                <Icon name={f.icon} size="sm" />
                <dt className="text-sm">{f.label}</dt>
                <dd className="text-base">{f.href ? <Link href={f.href}>{f.value}</Link> : f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Business>
    </section>
  )
}`
    const { root } = await drawPage([rowsSection], { business: { ...BARE, hours: 'Daily 8–8', whatsapp: '919345820023' }, content: emptyShowcaseContent(), leadEndpoint: null })
    expect([...root.querySelectorAll('dt')].map(d => d.textContent)).toEqual(['Hours', 'Phone', 'WhatsApp'])
    expect(root.querySelector('a[href="https://wa.me/919345820023"]')).not.toBeNull()
    expect(root.querySelectorAll('svg').length).toBe(3)
  })

  it('dials a number written with 91 and no + as +91', () => {
    expect(businessView({ name: 'X', phone: '919876543210' }).phoneUrl).toBe('tel:+919876543210')
    expect(businessView({ name: 'X', phone: '98765 43210' }).phoneUrl).toBe('tel:+919876543210')
    expect(businessView({ name: 'X', phone: '+1 415 555 0100' }).phoneUrl).toBe('tel:+14155550100')
  })

  it("picks the owner's work photos first, then the pictures made for the page, then a designed fill", () => {
    const content: ShowcaseContent = { ...emptyShowcaseContent(), work: [{ title: 'Wedding', image: 'https://cdn.example.com/w.webp' }], pictures: [{ image: 'https://cdn.example.com/m.webp', ai: true }] }
    expect(pictureView(BARE, content, 0)).toEqual({ kind: 'work', image: 'https://cdn.example.com/w.webp', alt: 'Wedding' })
    expect(pictureView(BARE, content, 1)).toMatchObject({ kind: 'mood', image: 'https://cdn.example.com/m.webp' })
    expect(pictureView(BARE, content, 2)).toEqual({ kind: 'none', image: null, alt: 'Latte' })
  })
})
