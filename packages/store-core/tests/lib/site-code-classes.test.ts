import { describe, it, expect } from 'vitest'
import { applyOps } from '@jeffi/site-blocks/design'
import type { CodeNode } from '@jeffi/site-blocks'
import { classOps, effectiveValue, readClasses, setPanelValue, utilityProp } from '@/lib/site/code/classes'

describe('style panel classes', () => {
  it('reads the utility set per breakpoint and keeps everything else', () => {
    const r = readClasses('text-2xl md:text-4xl font-bold font-display hover:bg-primary-600 bg-[#ff0000] p-4 lg:p-8 -mt-2 rounded-tl-lg max-md:hidden md:hover:underline')
    expect(r.values.base).toEqual({ fontSize: '2xl', fontWeight: 'bold', fontFamily: 'display', bgColor: '[#ff0000]', padding: '4', marginTop: '-2' })
    expect(r.values.md).toEqual({ fontSize: '4xl' })
    expect(r.values.lg).toEqual({ padding: '8' })
    expect(r.unknown).toEqual(['hover:bg-primary-600', 'rounded-tl-lg', 'max-md:hidden', 'md:hover:underline'])
  })

  it('tells sizes from colours in look-alike utilities', () => {
    expect(utilityProp('text-center')).toEqual({ prop: 'textAlign', value: 'center' })
    expect(utilityProp('text-white')).toEqual({ prop: 'textColor', value: 'white' })
    expect(utilityProp('text-[18px]')).toEqual({ prop: 'fontSize', value: '[18px]' })
    expect(utilityProp('text-[#333]')).toEqual({ prop: 'textColor', value: '[#333]' })
    expect(utilityProp('text-[var(--x)]')).toBeNull()
    expect(utilityProp('border-2')).toEqual({ prop: 'borderWidth', value: '2' })
    expect(utilityProp('border')).toEqual({ prop: 'borderWidth', value: '' })
    expect(utilityProp('border-primary-500/50')).toEqual({ prop: 'borderColor', value: 'primary-500/50' })
    expect(utilityProp('gap-x-4')).toEqual({ prop: 'gapX', value: '4' })
    expect(utilityProp('w-1/2')).toEqual({ prop: 'width', value: '1/2' })
    expect(utilityProp('flex-1')).toBeNull()
  })

  it('pins the old value on the next breakpoint up, so editing one leaves the wider ones as they were', () => {
    expect(setPanelValue('text-2xl', 'base', 'fontSize', 'xl')).toBe('text-xl md:text-2xl')
    expect(setPanelValue('text-xl md:text-2xl', 'md', 'fontSize', '3xl')).toBe('text-xl md:text-3xl lg:text-2xl')
    expect(setPanelValue('p-4', 'lg', 'padding', '8')).toBe('p-4 lg:p-8')
    expect(setPanelValue('p-4 md:p-6', 'md', 'padding', null)).toBe('p-4 lg:p-6')
    expect(setPanelValue('p-4', 'base', 'padding', '4')).toBe('p-4')
    expect(setPanelValue('hover:bg-primary-600 bg-white lg:bg-black', 'base', 'bgColor', 'surface')).toBe('hover:bg-primary-600 bg-surface md:bg-white lg:bg-black')
    expect(effectiveValue('p-2 md:p-6', 'lg', 'padding')).toEqual({ value: '6', from: 'md' })
    expect(effectiveValue('md:p-6', 'base', 'padding')).toBeNull()
  })

  it('turns a class change into per-breakpoint operations the tree applies', () => {
    const before = 'p-2 md:p-6 text-sm'
    const after = setPanelValue(setPanelValue(before, 'base', 'padding', '3'), 'lg', 'fontSize', 'lg')
    const ops = classOps('e1', before, after)
    expect(ops.map(o => (o.op === 'classes' ? o.bp : null))).toEqual(['base', 'lg'])
    const tree: CodeNode = { t: 'el', tag: 'div', props: { className: { k: 'lit', v: before } }, children: [], id: 'e1' }
    const next = applyOps(tree, ops).tree
    expect(readClasses(next.t === 'el' ? String(next.props.className && (next.props.className as { v: string }).v) : '')).toEqual(readClasses(after))
  })
})
