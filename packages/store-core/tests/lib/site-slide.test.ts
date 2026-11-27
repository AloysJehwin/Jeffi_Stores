import { describe, it, expect, vi } from 'vitest'

// Slides: the frame classes and how a slide is recognised, container units, the five starters (each compiles through
// the save path with the aspect, container and cqw rules in its CSS), the critique's slide checks and the writer's lint.

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(async () => ({ rows: [] })), withTransaction: vi.fn() }))

import type { CodeNode } from '@jeffi/site-blocks'
import { applyOps } from '@jeffi/site-blocks/design'
import { compileCodeProps, type CompiledSection } from '@/lib/site/code/compile'
import { effectiveValue } from '@/lib/site/code/classes'
import { aspectOf, classOf, cqwAt, cqwOwn, frameClasses, isSlide, nearestTextSize, pxToCqw, setCqwFont, slideFrameClasses, slideLayers, textPx, unframeClasses } from '@/lib/site/code/slide'
import { SLIDE_TEMPLATES, slideSectionProps, slideTemplate } from '@/lib/site/code/slide-templates'
import { critiqueTrees, slideOverflow, slideText } from '@/lib/site/code/tree-critique'
import { DEFAULT_THEME } from '@jeffi/site-blocks'
import { SLIDE_RULES, lintSlide } from '@/lib/site/studio/slide-rules'

const lit = (v: string) => ({ k: 'lit' as const, v })
const el = (id: string, tag: string, cls: string, text?: string): CodeNode => ({ t: 'el', tag, id, props: { className: lit(cls) }, children: text ? [{ t: 'text', value: text, id: `${id}.0` }] : [] })
const slide = (kids: CodeNode[], cls = slideFrameClasses()): CodeNode => ({ t: 'el', tag: 'section', id: 'e1', props: { className: lit(cls) }, children: kids })

describe('slide frame', () => {
  it('writes the frame classes and recognises a slide from its root', () => {
    expect(slideFrameClasses()).toBe('relative md:aspect-[16/9] md:p-0 md:overflow-hidden md:[container-type:inline-size]')
    expect(slideFrameClasses('3:4')).toContain('md:aspect-[3/4]')
    const s = slide([])
    expect(isSlide(s)).toBe(true)
    expect(aspectOf(s)).toBe('16:9')
    expect(isSlide(el('e1', 'section', 'py-16'))).toBe(false)
    expect(aspectOf(el('e1', 'section', 'py-16'))).toBeNull()
    expect(isSlide(el('e1', 'section', 'md:aspect-[16/9]'))).toBe(false)
  })

  it('makes a flow root a frame, clears what fights it, and gives it back', () => {
    const framed = frameClasses('py-16 bg-surface md:py-20 lg:min-h-[600px]', '4:3')
    expect(isSlide(el('e1', 'section', framed))).toBe(true)
    expect(framed).toContain('md:aspect-[4/3]')
    expect(framed).not.toContain('md:py-20')
    expect(framed).not.toContain('min-h')
    expect(framed).toContain('py-16')
    const back = unframeClasses(framed)
    expect(isSlide(el('e1', 'section', back))).toBe(false)
    expect(back).not.toContain('aspect')
    expect(back).not.toContain('container-type')
    expect(back).not.toContain('md:p-0')
  })

  it('converts px to container units and back to sizes', () => {
    expect(pxToCqw(48, 1280)).toBe(3.75)
    expect(pxToCqw(30, 768)).toBe(3.91)
    expect(textPx('3xl')).toBe(30)
    expect(textPx('[1.5rem]')).toBe(24)
    expect(textPx('[18px]')).toBe(18)
    expect(textPx('[calc(1px)]')).toBeNull()
    expect(nearestTextSize(47)).toBe('5xl')
  })

  it('sets one container-unit size per breakpoint and replaces a px size there', () => {
    const a = setCqwFont('text-3xl md:text-5xl', 'md', 4.2)
    expect(a).toBe('text-3xl md:text-[4.2cqw]')
    expect(setCqwFont(a, 'md', 5)).toBe('text-3xl md:text-[5cqw]')
    expect(cqwOwn(a, 'md')).toBe(4.2)
    expect(cqwAt(a, 'lg')).toBe(4.2)
    expect(cqwAt(a, 'base')).toBeNull()
    expect(setCqwFont(a, 'md', null)).toBe('text-3xl')
    expect(effectiveValue(a, 'base', 'fontSize')?.value).toBe('3xl')
  })
})

describe('slide starters', () => {
  for (const t of SLIDE_TEMPLATES)
    it(`${t.label} is a slide that saves, with the frame, container and cqw rules compiled`, async () => {
      const tree = slideTemplate(t.id)
      expect(isSlide(tree)).toBe(true)
      expect(aspectOf(tree)).toBe(t.aspect)
      expect(lintSlide(tree)).toEqual([])
      expect(slideOverflow(tree)).toEqual([])
      expect(slideText(tree)).toEqual([])
      const r = await compileCodeProps(slideSectionProps(t.id), 'home')
      if (!r.ok) throw new Error(r.issues[0]?.message)
      const css = (r.props.compiled as CompiledSection).css
      const [w, h] = t.aspect.split(':')
      expect(css).toMatch(new RegExp(`aspect-ratio:\\s*${w}\\s*/\\s*${h}`))
      expect(css).toMatch(/container-type:\s*inline-size/)
      expect(css).toMatch(/\d(?:\.\d+)?cqw/)
      expect(css).toMatch(/position:\s*absolute/)
      expect(r.props.tree).toBeTruthy()
    })

  it('builds fresh trees with unique ids, and the spotlight holds a live product part in a clipped box', () => {
    const ids = (n: CodeNode, out: string[] = []): string[] => {
      if (n.id) out.push(n.id)
      if (n.t === 'el' || n.t === 'cmp') n.children.forEach(c => ids(c, out))
      return out
    }
    for (const t of SLIDE_TEMPLATES) {
      const list = ids(slideTemplate(t.id))
      expect(new Set(list).size).toBe(list.length)
    }
    const products = slideLayers(slideTemplate('product')).find(l => l.t === 'cmp' && l.name === 'Products')
    expect(products).toBeTruthy()
    expect(classOf(products!)).toMatch(/overflow-hidden/)
    expect(classOf(products!)).toMatch(/md:h-\[84%\]/)
  })
})

describe('slide critique and lint', () => {
  it('finds a layer past the frame and words sized in px, with fixes', () => {
    const tree = slide([
      el('e2', 'h2', 'text-3xl md:absolute md:left-[70%] md:top-[10%] md:w-[50%] md:z-10 lg:absolute lg:left-[70%] lg:top-[10%] lg:w-[50%] lg:z-10', 'Hello'),
      el('e3', 'p', 'text-base md:text-xl md:absolute md:left-[5%] md:top-[50%] md:w-[40%] md:z-10 lg:absolute lg:left-[5%] lg:top-[50%] lg:w-[40%] lg:z-10', 'Body'),
    ])
    const over = slideOverflow(tree)
    expect(over.map(o => o.id)).toEqual(['e2'])
    const fixed = applyOps(tree, over[0].ops).tree
    expect(slideOverflow(fixed)).toEqual([])
    const px = slideText(tree)
    expect(px.map(p => p.id)).toEqual(['e2', 'e3'])
    const cqw = applyOps(tree, px[1].ops).tree
    expect(cqwOwn(classOf(slideLayers(cqw)[1])!, 'md')).toBe(2.6)
    const codes = critiqueTrees([{ block: 'b1', label: 'Hero', tree }], DEFAULT_THEME).map(f => f.code)
    expect(codes).toContain('slide_overflow')
    expect(codes).toContain('slide_text')
    expect(critiqueTrees([{ block: 'b1', label: 'Hero', tree: slideTemplate('poster') }], DEFAULT_THEME).filter(f => f.code.startsWith('slide_'))).toEqual([])
  })

  it('lints what a writer got wrong, and says nothing about a flow section', () => {
    expect(lintSlide(el('e1', 'section', 'py-16'))).toEqual([])
    expect(lintSlide(el('e1', 'section', 'md:aspect-[16/9]')).join(' ')).toMatch(/needs both/)
    const bad = slide([
      { t: 'text', value: 'loose', id: 'e2' },
      el('e3', 'p', 'absolute left-[0%] top-[0%] w-[10%] text-sm', 'x'),
      el('e4', 'div', 'md:absolute md:left-[10%] md:top-[10%] md:w-[95%]'),
      el('e5', 'div', 'p-4'),
    ])
    const lines = lintSlide(bad).join('\n')
    expect(lines).toMatch(/no loose text/)
    expect(lines).toMatch(/not placed at md/)
    expect(lines).toMatch(/runs past the slide at md/)
    expect(lines).toMatch(/no absolute at the base/)
    expect(lines).toMatch(/container units/)
    expect(SLIDE_RULES).toContain(slideFrameClasses())
  })
})
