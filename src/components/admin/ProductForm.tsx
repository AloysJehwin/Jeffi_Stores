'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import { Star, X } from 'lucide-react'
import ImageUpload from './ImageUpload'
import AdminSelect from './AdminSelect'
import Toggle from '@/components/ui/Toggle'
import AIEnrichButton from './AIEnrichButton'
import UnitsManager, { UnitLoadedInfo } from './UnitsManager'
import { applyDiscount } from '@/lib/pricing'

interface Category {
  id: string
  name: string
  parent_category_id: string | null
}

interface Brand {
  id: string
  name: string
}

interface VariantRow {
  id?: string
  variant_name: string
  price: string
  mrp: string
  mrp_ex_gst: string
  price_ex_gst: string
  discount_pct: string
  priceLockSide?: 'incl' | 'excl' | null
  mrpLockSide?: 'incl' | 'excl' | null
  stock_status: string
  mpn: string
  gtin: string
  pricing_type: 'unit'
  unit: string
  numeric_value: string
  weight_grams: string
  package_type: string
  length_cm: string
  breadth_cm: string
  height_cm: string
  sub_variant_type: string
  sub_variant_type_on: boolean
  variant_type: string
  use_own_images: boolean
  _isDeleted?: boolean
}

interface VariantGroup {
  pricing_type: 'unit'
  unit: string
  variant_type: string
}

interface ProductFormProps {
  categories: Category[]
  brands: Brand[]
  action: (formData: FormData) => Promise<void>
  product?: any
  productId?: string
}

const UNIT_UNITS = ['pcs', 'pair', 'set', 'box', 'pack', 'roll', 'sheet']
const PACKAGE_TYPES = ['flat_poly_auto', 'flat_poly_s', 'flat_poly_m', 'flat_poly_l', 'flat_poly_xl', 'drill_bit_tube', 'drill_bit_set_case', 'corrugated_box', 'long_tube']
const PACKAGE_TYPE_LABELS: Record<string, string> = {
  flat_poly_auto: 'Flat Poly (auto)',
  flat_poly_s: 'Flat Poly S',
  flat_poly_m: 'Flat Poly M',
  flat_poly_l: 'Flat Poly L',
  flat_poly_xl: 'Flat Poly XL',
  drill_bit_tube: 'Drill Bit Tube',
  drill_bit_set_case: 'Drill Bit Set Case',
  corrugated_box: 'Corrugated Box',
  long_tube: 'Long Tube / Rod',
}

function getUnitOptions(_pricing_type: string) {
  return UNIT_UNITS
}

// SKU generation
const BRAND_PREFIX_MAP: Record<string, string> = {
  'unbrako': 'UNB', 'taparia': 'TAP', 'tvs': 'TVS', 'totem': 'TTM',
  'gmf': 'GMF', 'jk fenner': 'JKF', 'nesco': 'NES', 'havells': 'HVL',
  'koleshwari': 'KRE', 'kundan': 'KUN', 'welfast': 'WEL', 'belsona': 'BLS',
}

// Matches size/spec tokens: M8, M10x50, DIN985, ISO4032, A16-A50, Grade 8.8, 10.9, BSW3/8
const SKU_SIZE_RE = /\b(M\d+(?:x\d+)?(?:\.\d+)?|DIN\s*\d+[A-Z]?|ISO\s*\d+[A-Z]?|[A-Z]{1,2}\d{2,}(?:-\d+[A-Z]*)?|Grade\s*\d+(?:\.\d+)?[A-Z]?|(?:10|12)\.\d+S?|BSW\s*\d+(?:\/\d+)?|UNC|BSP)\b/gi

const BRAND_STOP = new Set([
  'UNBRAKO','TAPARIA','TVS','TOTEM','GMF','FENNER','NESCO','HAVELLS',
  'KOLESHWARI','KUNDAN','WELFAST','BELSONA','FASTENERS','LIMITED','LTD','PVT','INDIA',
])
const SKU_STOP = new Set([
  'THE','AND','FOR','WITH','OF','IN','A','AN','BY','SERIES','TEST',
  'METRIC','INCH','GRADE','TYPE','STANDARD','CLASS','QUALITY','ALLOY',
  'CLASSICAL','HEXAGONAL',
])

function getBrandPrefix(brandName: string): string {
  const lower = brandName.toLowerCase().trim()
  for (const [key, val] of Object.entries(BRAND_PREFIX_MAP)) {
    if (lower.includes(key)) return val
  }
  return brandName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
}

function generateSku(name: string, brandName: string): string {
  let s = name.toUpperCase()
  // Strip brand words from name
  for (const bw of brandName.toUpperCase().split(/\s+/).filter(w => w.length > 1))
    s = s.replace(new RegExp(`(^|\\s)${bw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'g'), ' ')

  // Extract size/spec tokens
  const sizes = [...new Set(
    [...s.matchAll(SKU_SIZE_RE)].map(m => m[0].replace(/\s+/g, '').toUpperCase())
  )].slice(0, 2)

  // Strip sizes, then extract product-type words
  let rem = s
  for (const sz of sizes) rem = rem.replace(sz, ' ')
  const typeTokens = rem
    .replace(SKU_SIZE_RE, ' ')
    .split(/[\s/,.()\[\]\-–—]+/)
    .map(t => t.replace(/[^A-Z0-9]/g, ''))
    .filter(t => t.length >= 2 && !SKU_STOP.has(t) && !BRAND_STOP.has(t))
    .slice(0, 3)

  const parts = [
    getBrandPrefix(brandName),
    ...(typeTokens.length ? [typeTokens.join('-')] : []),
    ...sizes,
  ]
  if (parts.length <= 1) return parts[0] || ''
  return parts.join('-').replace(/--+/g, '-').replace(/-+$/, '').toUpperCase()
}


function defaultUnit(_pricing_type: string): string {
  return 'pcs'
}

function emptyVariant(pricing_type: 'unit', unit: string): VariantRow {
  return {
    id: `temp-${Math.random().toString(36).slice(2, 11)}`,
    variant_name: '', price: '', mrp: '', mrp_ex_gst: '', price_ex_gst: '', discount_pct: '',
    stock_status: 'In Stock', mpn: '', gtin: '',
    pricing_type, unit, numeric_value: '',
    weight_grams: '', package_type: '', length_cm: '', breadth_cm: '', height_cm: '',
    sub_variant_type: '', sub_variant_type_on: false,
    variant_type: '',
    use_own_images: false,
  }
}

function lockedInputCls(baseCls: string, isLocked: boolean): string {
  return isLocked ? `${baseCls} bg-surface-secondary text-foreground-muted cursor-not-allowed` : baseCls
}

function exToIncl(exVal: string, rate: number): string {
  if (!exVal) return ''
  const n = parseFloat(exVal)
  if (isNaN(n) || n < 0) return ''
  if (rate <= 0) return exVal
  return (Math.round(n * (1 + rate / 100) * 100) / 100).toFixed(2)
}

function inclToEx(inclVal: string, rate: number): string {
  if (!inclVal) return ''
  const n = parseFloat(inclVal)
  if (isNaN(n) || n < 0) return ''
  if (rate <= 0) return inclVal
  return String(Math.round(n / (1 + rate / 100) * 100) / 100)
}

function sumSubVariantStock(svs: any[] | undefined): number {
  if (!svs || svs.length === 0) return 0
  return svs.filter(sv => sv.stock_status !== 'Out of Stock').length
}

function UnlockBtn({ onClick, title = 'Unlock to edit this side' }: { onClick: () => void; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-foreground-muted hover:text-accent-600 transition-colors" tabIndex={-1}>
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    </button>
  )
}

export default function ProductForm({ categories, brands, action, product, productId }: ProductFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [productName, setProductName] = useState<string>(product?.name || '')
  const [description, setDescription] = useState<string>(product?.description || '')
  const [brandId, setBrandId] = useState<string>(product?.brand_id || '')
  const [categoryId, setCategoryId] = useState<string>(product?.category_id || '')
  const [sku, setSku] = useState<string>(product?.sku || '')
  const [skuManuallyEdited, setSkuManuallyEdited] = useState<boolean>(!!product?.sku)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [existingImagesToKeep, setExistingImagesToKeep] = useState<any[]>([])
  const [galleryImageIds, setGalleryImageIds] = useState<{ id: string; isPrimary: boolean }[]>([])
  const [imageOrder, setImageOrder] = useState<string[]>([])
  const [tempProductId] = useState<string>(productId || `temp-${Date.now()}`)
  const [hasVariants, setHasVariants] = useState(product?.has_variants ?? false)
  const [variantPopupId, setVariantPopupId] = useState<string | null>(null)
  const [popupUnitKey, setPopupUnitKey] = useState<string>('')
  const [popupUnitInfo, setPopupUnitInfo] = useState<UnitLoadedInfo | null>(null)
  const [variantImagesMap, setVariantImagesMap] = useState<Record<string, any[]>>(() => {
    const init: Record<string, any[]> = {}
    if (product?.product_variants) {
      for (const v of product.product_variants) {
        if (v.id && Array.isArray(v.variant_images) && v.variant_images.length > 0) {
          init[v.id] = v.variant_images
        }
      }
    }
    return init
  })
  const [variantImageUploading, setVariantImageUploading] = useState<Record<string, boolean>>({})
  const [variantImageError, setVariantImageError] = useState<string | null>(null)
  const [variantImagePendingAdds, setVariantImagePendingAdds] = useState<Record<string, number>>({})
  const [variantImageDeleting, setVariantImageDeleting] = useState<Record<string, boolean>>({})
  const variantImageDragIndex = useRef<number | null>(null)
  const variantImageDragOverIndex = useRef<number | null>(null)
  const [variantGalleryOpen, setVariantGalleryOpen] = useState(false)
  const [variantGalleryImages, setVariantGalleryImages] = useState<any[]>([])
  const [variantGalleryCategories, setVariantGalleryCategories] = useState<any[]>([])
  const [variantGallerySearch, setVariantGallerySearch] = useState('')
  const [variantGalleryCategory, setVariantGalleryCategory] = useState('')
  const [variantGallerySelected, setVariantGallerySelected] = useState<string[]>([])
  const [variantGalleryLoading, setVariantGalleryLoading] = useState(false)
  const [subVariantsMap, setSubVariantsMap] = useState<Record<string, any[]>>(() => {
    const init: Record<string, any[]> = {}
    if (product?.product_variants) {
      for (const v of product.product_variants) {
        if (v.id && Array.isArray(v.sub_variants) && v.sub_variants.length > 0) {
          init[v.id] = v.sub_variants
        }
      }
    }
    return init
  })
  const [subVariantDrafts, setSubVariantDrafts] = useState<Record<string, { name: string; price: string; mrp: string; price_ex_gst: string; mrp_ex_gst: string; discount_pct: string; stock: string; sku: string }>>({})
  const [subVariantEditId, setSubVariantEditId] = useState<string | null>(null)
  const [subVariantEditDraft, setSubVariantEditDraft] = useState<{ name: string; price: string; mrp: string; price_ex_gst: string; mrp_ex_gst: string; discount_pct: string; stock: string; sku: string } | null>(null)
  const [expandedSvUnits, setExpandedSvUnits] = useState<Set<string>>(new Set())
  const [productPackageType, setProductPackageType] = useState<string>(product?.package_type || 'flat_poly_auto')
  const [gstRate, setGstRate] = useState<number>(product?.gst_percentage != null ? parseFloat(product.gst_percentage) : 18)

  const [basePrice, setBasePrice] = useState(() => {
    if (product?.base_price != null) return String(product.base_price)
    if (product?.price_ex_gst != null) {
      const r = product?.gst_percentage != null ? parseFloat(product.gst_percentage) : 18
      return String(Math.round(Number(product.price_ex_gst) * (1 + r / 100) * 100) / 100)
    }
    return ''
  })
  const [costPrice, setCostPrice] = useState(product?.cost_price != null ? String(product.cost_price) : '')
  const [mrp, setMrp] = useState(product?.mrp != null ? String(product.mrp) : '')
  const [mrpExGst, setMrpExGst] = useState(() => {
    if (product?.mrp_ex_gst != null) return String(product.mrp_ex_gst)
    if (product?.mrp != null) {
      const r = product?.gst_percentage != null ? parseFloat(product.gst_percentage) : 18
      return r > 0 ? String(Math.round(Number(product.mrp) / (1 + r / 100) * 100) / 100) : String(product.mrp)
    }
    return ''
  })
  const [topMrpLockSide, setTopMrpLockSide] = useState<'incl' | 'excl' | null>(
    product?.mrp != null ? 'excl' : (product?.mrp_ex_gst != null ? 'incl' : null)
  )
  const [salePrice, setSalePrice] = useState(() => {
    if (product?.price_ex_gst != null) return String(product.price_ex_gst)
    if (product?.base_price != null) {
      const r = product?.gst_percentage != null ? parseFloat(product.gst_percentage) : 18
      return String(Math.round(Number(product.base_price) / (1 + r / 100) * 100) / 100)
    }
    return ''
  })
  const [topPriceLockSide, setTopPriceLockSide] = useState<'incl' | 'excl' | null>(
    product?.base_price != null ? 'excl' : (product?.price_ex_gst != null ? 'incl' : null)
  )
  const [discountPct, setDiscountPct] = useState(product?.discount_pct != null ? String(product.discount_pct) : '')

  const draftKey = productId ? `draft_product_${productId}` : 'draft_product_new'
  const [isActive, setIsActive] = useState<boolean>(product?.is_active ?? true)
  const [isFeatured, setIsFeatured] = useState<boolean>(product?.is_featured ?? false)
  const [hasDraft, setHasDraft] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [variants, setVariants] = useState<VariantRow[]>(() => {
    if (product?.product_variants && product.product_variants.length > 0) {
      const rate = product?.gst_percentage != null ? parseFloat(product.gst_percentage) : 18
      const deriveExGst = (priceVal: any) => priceVal != null ? String(Math.round(Number(priceVal) / (1 + rate / 100) * 100) / 100) : ''
      const deriveIncl = (exVal: any) => exVal != null ? String(Math.round(Number(exVal) * (1 + rate / 100) * 100) / 100) : ''
      return product.product_variants.map((v: any) => {
        const discPct = product.discount_pct != null ? parseFloat(product.discount_pct) : 0
        const mrpEx = v.mrp_ex_gst != null ? parseFloat(v.mrp_ex_gst) : (v.mrp != null ? Math.round(parseFloat(v.mrp) / (1 + rate / 100) * 100) / 100 : null)
        // Derive price from mrp_ex_gst + discount_pct as the authoritative source
        let priceEx: string
        let price: string
        if (mrpEx != null && !isNaN(mrpEx) && mrpEx > 0) {
          const derived = Math.round(mrpEx * (1 - discPct / 100) * 100) / 100
          priceEx = String(derived)
          price = String(Math.round(derived * (1 + rate / 100) * 100) / 100)
        } else {
          priceEx = v.price_ex_gst != null ? String(v.price_ex_gst) : (v.price != null ? String(Math.round(parseFloat(v.price) / (1 + rate / 100) * 100) / 100) : '')
          price = v.price != null ? String(v.price) : (v.price_ex_gst != null ? String(Math.round(parseFloat(v.price_ex_gst) * (1 + rate / 100) * 100) / 100) : '')
        }
        const mrpInclStr = mrpEx != null ? String(Math.round(mrpEx * (1 + rate / 100) * 100) / 100) : (v.mrp != null ? String(v.mrp) : '')
        const mrpExStr = mrpEx != null ? String(mrpEx) : ''
        return ({
        id: v.id,
        variant_name: v.variant_name,
        price,
        mrp: mrpInclStr,
        mrp_ex_gst: mrpExStr,
        price_ex_gst: priceEx,
        discount_pct: product.discount_pct != null ? String(product.discount_pct) : '0',
        priceLockSide: null,
        mrpLockSide: null,
        stock_status: v.stock_status || 'In Stock',
        mpn: v.mpn || '',
        gtin: v.gtin || '',
        pricing_type: v.pricing_type || 'unit',
        unit: v.unit || 'pcs',
        numeric_value: v.numeric_value != null ? String(v.numeric_value) : '',
        weight_grams: v.weight_grams != null ? String(v.weight_grams) : '',
        package_type: v.package_type || '',
        length_cm: v.length_cm != null ? String(v.length_cm) : '',
        breadth_cm: v.breadth_cm != null ? String(v.breadth_cm) : '',
        height_cm: v.height_cm != null ? String(v.height_cm) : '',
        sub_variant_type: v.sub_variant_type || '',
        sub_variant_type_on: !!v.sub_variant_type || (Array.isArray(v.sub_variants) && v.sub_variants.length > 0),
        variant_type: v.variant_type || '',
        use_own_images: !!(v.variant_images && v.variant_images.length > 0),
      })
      })
    }
    return []
  })

  const [groups, setGroups] = useState<VariantGroup[]>(() => {
    const seen = new Set<string>()
    const result: VariantGroup[] = []
    const src = product?.product_variants?.length > 0 ? product.product_variants : []
    for (const v of src) {
      const pt = v.pricing_type || 'unit'
      if (!seen.has(pt)) {
        seen.add(pt)
        result.push({ pricing_type: pt as any, unit: v.unit || defaultUnit(pt), variant_type: v.variant_type || product?.variant_type || '' })
      }
    }
    return result
  })

  const mainCategories = categories.filter(c => !c.parent_category_id)
  const getSubcategories = (parentId: string) => categories.filter(c => c.parent_category_id === parentId)
  const leafCategories = categories.filter(c =>
    !categories.some(other => other.parent_category_id === c.id)
  )

  useEffect(() => {
    const saved = localStorage.getItem(draftKey)
    if (saved) setHasDraft(true)
  }, [draftKey])

  // Reset cached popup unit when switching variants in the popup
  useEffect(() => {
    setPopupUnitKey('')
    setPopupUnitInfo(null)
  }, [variantPopupId])

  // Auto-regenerate SKU when name/brand/category change (only if not manually edited)
  useEffect(() => {
    if (skuManuallyEdited) return
    const brandName = brands.find(b => b.id === brandId)?.name || ''
    const categoryName = categories.find(c => c.id === categoryId)?.name || ''
    if (!productName && !brandName && !categoryName) return
    const generated = generateSku(productName, brandName)
    if (generated) setSku(generated)
  }, [productName, brandId, categoryId, skuManuallyEdited, brands, categories])

  useEffect(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      const form = formRef.current
      if (!form) return
      const formData = new FormData(form)
      const uncontrolled: Record<string, string> = {}
      for (const [k, v] of formData.entries()) {
        if (typeof v === 'string') uncontrolled[k] = v
      }
      const snapshot = {
        uncontrolled,
        hasVariants, variants, groups,
        basePrice, mrp, mrpExGst, salePrice, costPrice,
        discountPct,
        topPriceLockSide, topMrpLockSide,
        gstRate, isActive,
      }
      localStorage.setItem(draftKey, JSON.stringify(snapshot))
      setHasDraft(true)
    }, 1000)
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }
  }, [
    hasVariants, variants, groups,
    basePrice, mrp, mrpExGst, salePrice, costPrice, discountPct,
    topPriceLockSide, topMrpLockSide,
    gstRate, isActive, draftKey,
  ])

  function restoreDraft() {
    const saved = localStorage.getItem(draftKey)
    if (!saved) return
    try {
      const snap = JSON.parse(saved)
      const form = formRef.current
      if (form && snap.uncontrolled) {
        for (const [k, v] of Object.entries(snap.uncontrolled as Record<string, string>)) {
          const el = form.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
          if (el && 'value' in el) el.value = v
        }
      }
      if (snap.hasVariants !== undefined) setHasVariants(snap.hasVariants)
      if (snap.variants) setVariants(snap.variants)
      if (snap.groups) setGroups(snap.groups)
      if (snap.basePrice !== undefined) setBasePrice(snap.basePrice)
      if (snap.mrp !== undefined) setMrp(snap.mrp)
      if (snap.mrpExGst !== undefined) setMrpExGst(snap.mrpExGst)
      if (snap.salePrice !== undefined) setSalePrice(snap.salePrice)
      if (snap.costPrice !== undefined) setCostPrice(snap.costPrice)
      if (snap.discountPct !== undefined) setDiscountPct(snap.discountPct)
      if (snap.topPriceLockSide !== undefined) setTopPriceLockSide(snap.topPriceLockSide)
      if (snap.topMrpLockSide !== undefined) setTopMrpLockSide(snap.topMrpLockSide)
      if (snap.gstRate !== undefined) setGstRate(snap.gstRate)
      if (snap.isActive !== undefined) setIsActive(snap.isActive)
    } catch {}
  }

  function discardDraft() {
    localStorage.removeItem(draftKey)
    setHasDraft(false)
    window.location.reload()
  }

  function addGroup(pricing_type: 'unit') {
    if (groups.find(g => g.pricing_type === pricing_type)) return
    const unit = defaultUnit(pricing_type)
    setGroups([...groups, { pricing_type, unit, variant_type: '' }])
    setVariants([...variants, emptyVariant(pricing_type, unit)])
  }

  function removeGroup(pricing_type: string) {
    setGroups(groups.filter(g => g.pricing_type !== pricing_type))
    setVariants(variants.map(v => {
      if (v.pricing_type !== pricing_type) return v
      return v.id ? { ...v, _isDeleted: true } : null
    }).filter(Boolean) as VariantRow[])
  }

  function updateGroupVariantType(pricing_type: string, variant_type: string) {
    setGroups(groups.map(g => g.pricing_type === pricing_type ? { ...g, variant_type } : g))
  }

  function buildVariantName(numeric_value: string, unit: string, pricing_type: string): string {
    if (pricing_type === 'unit') return ''
    if (!numeric_value) return ''
    return `${numeric_value}${unit}`
  }

  function addVariantToGroup(pricing_type: 'unit', unit: string) {
    setVariants([...variants, emptyVariant(pricing_type, unit)])
  }

  function removeVariant(index: number) {
    const v = variants[index]
    if (v.id) {
      const updated = [...variants]
      updated[index] = { ...v, _isDeleted: true }
      setVariants(updated)
    } else {
      setVariants(variants.filter((_, i) => i !== index))
    }
  }

  function updateVariant(index: number, field: keyof VariantRow, value: string | boolean) {
    const updated = [...variants]
    const row = { ...updated[index], [field]: value }
    if ((field === 'numeric_value' || field === 'unit') && row.pricing_type !== 'unit') {
      row.variant_name = buildVariantName(
        field === 'numeric_value' ? (value as string) : row.numeric_value,
        field === 'unit' ? (value as string) : row.unit,
        row.pricing_type
      )
    }
    updated[index] = row
    setVariants(updated)
  }

  async function openVariantPopup(variantId: string) {
    setVariantPopupId(variantId)
    setVariantImageError(null)
    const isTemp = variantId.startsWith('temp-')
    if (productId && !isTemp) {
      if (!variantImagesMap[variantId]) {
        const res = await fetch(`/api/admin/products/${productId}/variants/${variantId}/images`)
        if (res.ok) {
          const data = await res.json()
          setVariantImagesMap(m => ({ ...m, [variantId]: data.images || [] }))
        } else {
          const err = await res.json().catch(() => ({}))
          setVariantImageError(err.error || `Could not load images (${res.status})`)
        }
      }
      if (!subVariantsMap[variantId]) {
        const res = await fetch(`/api/admin/products/${productId}/variants/${variantId}/sub-variants`)
        if (res.ok) {
          const data = await res.json()
          const loaded = data.sub_variants || []
          setSubVariantsMap(m => ({ ...m, [variantId]: loaded }))
        } else {
          setSubVariantsMap(m => ({ ...m, [variantId]: [] }))
        }
      }
    }
  }

  async function uploadVariantImageFile(variantId: string, file: File) {
    if (!productId) return
    if (variantId.startsWith('temp-')) {
      setVariantImageError('Save the product first to upload variant images.')
      return
    }
    setVariantImageError(null)
    setVariantImageUploading(m => ({ ...m, [variantId]: true }))
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/admin/products/${productId}/variants/${variantId}/images`, {
        method: 'POST',
        body: fd,
      })
      if (res.ok) {
        const data = await res.json()
        setVariantImagesMap(m => ({ ...m, [variantId]: [...(m[variantId] || []), data.image] }))
      } else {
        const err = await res.json().catch(() => ({}))
        setVariantImageError(err.error || `Upload failed (${res.status})`)
      }
    } catch {
      setVariantImageError('Upload failed — network error')
    } finally {
      setVariantImageUploading(m => ({ ...m, [variantId]: false }))
    }
  }

  async function deleteVariantImage(variantId: string, imageId: string) {
    if (!productId) return
    setVariantImageDeleting(m => ({ ...m, [imageId]: true }))
    try {
      await fetch(`/api/admin/products/${productId}/variants/${variantId}/images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId }),
      })
      setVariantImagesMap(m => ({ ...m, [variantId]: (m[variantId] || []).filter((img: any) => img.id !== imageId) }))
    } finally {
      setVariantImageDeleting(m => {
        const n = { ...m }
        delete n[imageId]
        return n
      })
    }
  }

  async function setVariantImagePrimary(variantId: string, imageId: string) {
    if (!productId) return
    await fetch(`/api/admin/products/${productId}/variants/${variantId}/images`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId, isPrimary: true }),
    })
    setVariantImagesMap(m => ({
      ...m,
      [variantId]: (m[variantId] || []).map((img: any) => ({ ...img, is_primary: img.id === imageId })),
    }))
  }

  async function reorderVariantImages(variantId: string, fromIndex: number, toIndex: number) {
    if (!productId || fromIndex === toIndex) return
    const current = variantImagesMap[variantId] || []
    if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length) return
    const next = [...current]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    setVariantImagesMap(m => ({ ...m, [variantId]: next }))
    await Promise.all(
      next.map((img: any, idx: number) =>
        fetch(`/api/admin/products/${productId}/variants/${variantId}/images`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId: img.id, displayOrder: idx }),
        }),
      ),
    )
  }

  const openVariantGallery = useCallback(async () => {
    setVariantGalleryOpen(true)
    setVariantGallerySelected([])
    setVariantGallerySearch('')
    setVariantGalleryCategory('')
    setVariantGalleryLoading(true)
    try {
      const [galleryRes, catRes] = await Promise.all([
        fetch('/api/gallery?limit=100'),
        fetch('/api/categories'),
      ])
      const galleryData = await galleryRes.json()
      const catData = await catRes.json()
      setVariantGalleryImages(galleryData.images || [])
      setVariantGalleryCategories(catData.categories || [])
    } catch {
      setVariantGalleryImages([])
    } finally {
      setVariantGalleryLoading(false)
    }
  }, [])

  async function addVariantImagesFromGallery() {
    if (!productId || !variantPopupId) return
    const currentImages = variantImagesMap[variantPopupId] || []
    const slotsLeft = 5 - currentImages.length
    const toAdd = variantGallerySelected.slice(0, slotsLeft)
    setVariantGalleryOpen(false)
    setVariantGallerySelected([])
    setVariantImageError(null)
    const vid = variantPopupId
    setVariantImagePendingAdds(m => ({ ...m, [vid]: (m[vid] || 0) + toAdd.length }))
    for (const galleryImageId of toAdd) {
      try {
        const res = await fetch(`/api/admin/products/${productId}/variants/${vid}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gallery_image_id: galleryImageId }),
        })
        if (res.ok) {
          const data = await res.json()
          setVariantImagesMap(m => ({ ...m, [vid]: [...(m[vid] || []), data.image] }))
        } else {
          const err = await res.json().catch(() => ({}))
          setVariantImageError(err.error || `Failed to add image (${res.status})`)
          setVariantImagePendingAdds(m => ({ ...m, [vid]: Math.max(0, (m[vid] || 0) - (toAdd.length - toAdd.indexOf(galleryImageId))) }))
          return
        }
      } finally {
        setVariantImagePendingAdds(m => ({ ...m, [vid]: Math.max(0, (m[vid] || 0) - 1) }))
      }
    }
  }

  async function addSubVariant(variantId: string) {
    if (!productId) {
      setVariantImageError('Save the product first to add sub-variants.')
      return
    }
    if (variantId.startsWith('temp-')) {
      setVariantImageError('Save the product first to add sub-variants for this variant.')
      return
    }
    const draft = subVariantDrafts[variantId]
    if (!draft?.name) return
    const res = await fetch(`/api/admin/products/${productId}/variants/${variantId}/sub-variants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sub_variant_name: draft.name,
        price: draft.price ? parseFloat(draft.price) : null,
        mrp: draft.mrp ? parseFloat(draft.mrp) : null,
        price_ex_gst: draft.price_ex_gst ? parseFloat(draft.price_ex_gst) : null,
        mrp_ex_gst: draft.mrp_ex_gst ? parseFloat(draft.mrp_ex_gst) : null,
        discount_pct: parseFloat(discountPct) || 0,
        stock_status: draft.stock || 'In Stock',
        sku: draft.sku || undefined,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      setSubVariantsMap(m => ({ ...m, [variantId]: [...(m[variantId] || []), data.sub_variant] }))
      setSubVariantDrafts(m => ({ ...m, [variantId]: { name: '', price: '', mrp: '', price_ex_gst: '', mrp_ex_gst: '', discount_pct: '', stock: '', sku: '' } }))
    }
  }

  async function deleteSubVariant(variantId: string, subId: string) {
    if (!productId) return
    if (variantId.startsWith('temp-')) return
    await fetch(`/api/admin/products/${productId}/variants/${variantId}/sub-variants`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: subId }),
    })
    setSubVariantsMap(m => ({ ...m, [variantId]: (m[variantId] || []).filter((sv: any) => sv.id !== subId) }))
  }

  const activeVariants = variants.filter(v => !v._isDeleted)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const formData = new FormData(e.currentTarget)

      imageFiles.forEach((file, index) => {
        formData.append(`image_${index}`, file)
      })
      formData.append('image_count', imageFiles.length.toString())
      formData.append('gallery_image_ids', JSON.stringify(galleryImageIds))
      formData.append('image_order', JSON.stringify(imageOrder))
      formData.append('existing_images_to_keep', JSON.stringify(existingImagesToKeep))

      formData.set('has_variants', hasVariants ? 'true' : 'false')

      if (!hasVariants) {
        formData.set('base_price', basePrice || '')
        formData.set('mrp', mrp || '')
        formData.set('mrp_ex_gst', mrpExGst || '')
        formData.set('price_ex_gst', salePrice || '')
        formData.set('discount_pct', discountPct || '0')
      } else {
        formData.set('mrp', mrp || '')
        formData.set('mrp_ex_gst', mrpExGst || '')
        formData.set('price_ex_gst', salePrice || '')
        formData.set('discount_pct', discountPct || '0')
      }
      formData.set('cost_price', costPrice || '0')

      if (hasVariants) {
        const convertedVariants = variants.map(v => {
          const grp = groups.find(g => g.pricing_type === v.pricing_type)
          const stockStatus = v.sub_variant_type_on
            ? (sumSubVariantStock(subVariantsMap[v.id || '']) > 0 ? 'In Stock' : 'Out of Stock')
            : v.stock_status
          return {
            ...v,
            variant_type: grp?.variant_type || v.variant_type || '',
            stock_status: stockStatus,
            price: v.price,
            mrp: v.mrp,
            mrp_ex_gst: v.mrp_ex_gst,
            price_ex_gst: v.price_ex_gst || (v.price ? inclToEx(v.price, gstRate) : ''),
            discount_pct: discountPct || '0',
          }
        })
        formData.set('variants_json', JSON.stringify(convertedVariants))
      }

      await action(formData)
      localStorage.removeItem(draftKey)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      setError(err?.message || 'Failed to save product. Please try again.')
      setIsSubmitting(false)
    }
  }

  const inputCls = 'field-normal w-full border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent'

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
      <div className="p-4 sm:p-6">
        {hasDraft && (
          <div className="mb-4 px-4 py-3 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
            <span className="text-yellow-800 dark:text-yellow-200">You have an auto-saved draft. Click Restore to load it, or Discard to clear it and reload from database.</span>
            <div className="flex gap-3 shrink-0">
              <button type="button" onClick={restoreDraft} className="text-yellow-800 dark:text-yellow-200 font-semibold hover:underline">Restore</button>
              <button type="button" onClick={discardDraft} className="text-yellow-700 dark:text-yellow-300 font-semibold hover:underline">Discard</button>
            </div>
          </div>
        )}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Product Name */}
          <div className="md:col-span-2">
            <label htmlFor="name" className="block text-sm font-medium text-foreground-secondary mb-2">
              Product Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              value={productName}
              onChange={e => setProductName(e.target.value)}
              className="w-full field-normal border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Enter product name"
            />
          </div>

          {/* SKU */}
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-2">
              SKU
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                name="sku"
                value={sku}
                onChange={e => { setSku(e.target.value.toUpperCase()); setSkuManuallyEdited(true) }}
                className="flex-1 field-normal border border-border-default bg-surface text-foreground font-mono text-sm uppercase focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                placeholder="Auto-generated"
              />
              <button
                type="button"
                title="Regenerate SKU from name, brand and category"
                onClick={() => {
                  const brandName = brands.find(b => b.id === brandId)?.name || ''
                  const categoryName = categories.find(c => c.id === categoryId)?.name || ''
                  const generated = generateSku(productName, brandName)
                  if (generated) { setSku(generated); setSkuManuallyEdited(false) }
                }}
                className="px-3 py-2 border border-border-default rounded-lg bg-surface hover:bg-surface-elevated text-foreground-muted hover:text-accent-500 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-foreground-muted mt-1">
              {skuManuallyEdited ? 'Manually set — click ↺ to regenerate from name, brand & category' : 'Auto-generated from name, brand & category'}
            </p>
          </div>

          {/* HSN/SAC Code */}
          <div>
            <label htmlFor="hsn_code" className="block text-sm font-medium text-foreground-secondary mb-2">
              HSN/SAC Code
            </label>
            <input
              type="text"
              id="hsn_code"
              name="hsn_code"
              defaultValue={product?.hsn_code}
              className="w-full field-normal border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g., 8531"
            />
            <p className="text-xs text-foreground-muted mt-1">Required for GST invoices</p>
          </div>

          {/* MPN — hidden when has variants */}
          {!hasVariants && (
          <div>
            <label htmlFor="mpn" className="block text-sm font-medium text-foreground-secondary mb-2">
              MPN (Manufacturer Part No.)
            </label>
            <input
              type="text"
              id="mpn"
              name="mpn"
              defaultValue={product?.mpn}
              className="w-full field-normal border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g., TVS-M6X30"
            />
            <p className="text-xs text-foreground-muted mt-1">Used in Google Shopping feed</p>
          </div>
          )}

          {/* GTIN/Barcode — hidden when has variants */}
          {!hasVariants && (
          <div>
            <label htmlFor="gtin" className="block text-sm font-medium text-foreground-secondary mb-2">
              GTIN / Barcode
            </label>
            <input
              type="text"
              id="gtin"
              name="gtin"
              defaultValue={product?.gtin}
              className="w-full field-normal border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="EAN/UPC barcode number"
            />
            <p className="text-xs text-foreground-muted mt-1">Used in Google Shopping feed</p>
          </div>
          )}

          {/* Category */}
          <AdminSelect
            id="category_id"
            name="category_id"
            label="Category *"
            required
            value={categoryId}
            onChange={setCategoryId}
            placeholder="Select a category"
            options={(() => {
              const opts = leafCategories.map(cat => {
                const parent = cat.parent_category_id ? categories.find(c => c.id === cat.parent_category_id) : null
                return {
                  value: cat.id,
                  label: cat.name,
                  group: parent ? parent.name : 'Top-level',
                  indent: !!parent,
                  _hasParent: !!parent,
                }
              })
              opts.sort((a, b) => {
                if (a._hasParent !== b._hasParent) return a._hasParent ? -1 : 1
                if (a.group !== b.group) return a.group.localeCompare(b.group)
                return a.label.localeCompare(b.label)
              })
              return opts.map(({ _hasParent, ...rest }) => rest)
            })()}
          />

          {/* Brand */}
          <AdminSelect
            id="brand_id"
            name="brand_id"
            label="Brand"
            value={brandId}
            onChange={setBrandId}
            placeholder="No Brand"
            options={[
              { value: '', label: 'No Brand' },
              ...brands.map(brand => ({
                value: brand.id,
                label: brand.name,
              })),
            ]}
          />

          {/* MRP — hidden when has variants */}
          {!hasVariants && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="mrp_ex_gst" className="block text-sm font-medium text-foreground-secondary mb-2">
                MRP (Ex. GST) *
              </label>
              <div className="relative">
                <input
                  type="number"
                  id="mrp_ex_gst"
                  name="mrp_ex_gst"
                  step="0.01"
                  min="0"
                  value={mrpExGst}
                  onChange={e => {
                    const v = e.target.value
                    setMrpExGst(v)
                    const mrpInclNew = v ? exToIncl(v, gstRate) : ''
                    setMrp(mrpInclNew)
                    const disc = parseFloat(discountPct)
                    const mrpExN = parseFloat(v)
                    if (!isNaN(mrpExN) && mrpExN > 0 && !isNaN(disc)) {
                      const newSaleEx = parseFloat((mrpExN * (1 - disc / 100)).toFixed(2)).toString()
                      const newSaleIncl = exToIncl(newSaleEx, gstRate)
                      setSalePrice(newSaleEx)
                      setBasePrice(newSaleIncl)
                    } else {
                      setSalePrice('')
                      setBasePrice('')
                    }
                  }}
                  className="w-full px-4 py-2 bg-surface text-foreground border border-border-secondary rounded-lg placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                  placeholder="From price catalog"
                />
              </div>
            </div>
            <div>
              <label htmlFor="mrp" className="block text-sm font-medium text-foreground-secondary mb-2">
                MRP (incl. GST)
              </label>
              <input
                type="number"
                id="mrp"
                name="mrp"
                step="0.01"
                min="0"
                value={mrp}
                readOnly
                className="w-full px-4 py-2 bg-surface-secondary text-foreground-muted cursor-not-allowed border border-border-secondary rounded-lg"
                placeholder="Auto-calculated"
              />
            </div>
          </div>
          )}

          {/* Selling Price — hidden when has variants */}
          {!hasVariants && (
            <div>
              <label htmlFor="base_price" className="block text-sm font-medium text-foreground-secondary mb-2">
                Selling Price (incl. GST)
              </label>
              <input
                type="number"
                id="base_price"
                name="base_price"
                required={!hasVariants}
                step="0.01"
                min="0"
                value={basePrice}
                readOnly
                className="w-full px-4 py-2 bg-surface-secondary text-foreground-muted cursor-not-allowed border border-border-secondary rounded-lg"
                placeholder="Auto-calculated"
              />
              <p className="text-xs text-foreground-muted mt-1">MRP (Ex. GST) × (1 − Discount%) × (1 + GST%)</p>
            </div>
          )}

          {/* Discount % — product-level, applies to all variants */}
          <div>
            <label htmlFor="discount_pct" className="block text-sm font-medium text-foreground-secondary mb-2">
                Discount % (off MRP)
              </label>
              <input
                type="number"
                id="discount_pct"
                name="discount_pct"
                step="0.01"
                min="0"
                max="100"
                value={discountPct}
                onChange={e => {
                  const v = e.target.value
                  setDiscountPct(v)
                  const disc = parseFloat(v)
                  const mrpExN = parseFloat(mrpExGst)
                  if (!isNaN(disc) && !isNaN(mrpExN) && mrpExN > 0) {
                    const newSaleEx = parseFloat((mrpExN * (1 - disc / 100)).toFixed(2)).toString()
                    const newSaleIncl = exToIncl(newSaleEx, gstRate)
                    setSalePrice(newSaleEx)
                    setBasePrice(newSaleIncl)
                    setTopPriceLockSide('incl')
                    // cascade to all variant rows
                    if (hasVariants) {
                      setVariants(prev => prev.map(vr => {
                        const mrpExN2 = parseFloat(vr.mrp_ex_gst)
                        if (!isNaN(mrpExN2) && mrpExN2 > 0) {
                          const newPriceEx = parseFloat((mrpExN2 * (1 - disc / 100)).toFixed(2)).toString()
                          const newPriceIncl = exToIncl(newPriceEx, gstRate)
                          return { ...vr, discount_pct: v,
                            price_ex_gst: newPriceEx, price: newPriceIncl,
                          }
                        }
                        return { ...vr, discount_pct: v }
                      }))
                    }
                  } else if (v === '') {
                    setDiscountPct('')
                  }
                }}
                className="w-full field-normal border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                placeholder="0.00"
              />
              <p className="text-xs text-foreground-muted mt-1">Enter MRP (Ex. GST) + Discount % → selling price auto-fills for all variants.</p>
            </div>

          <div>
            <label htmlFor="cost_price" className="block text-sm font-medium text-foreground-secondary mb-2">
              Cost Price (Rs.)
            </label>
            <input
              type="number"
              id="cost_price"
              name="cost_price"
              step="0.01"
              min="0"
              value={costPrice}
              onChange={e => setCostPrice(e.target.value)}
              className="w-full field-normal border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Your purchase / landed cost"
            />
            <p className="text-xs text-foreground-muted mt-1">Used for P&amp;L gross margin — not shown to customers</p>
          </div>

          {/* GST Rate + Entry Mode */}
          <div className="md:col-span-2">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[140px]">
                <AdminSelect
                  id="gst_percentage"
                  name="gst_percentage"
                  label="GST Rate *"
                  value={String(gstRate)}
                  onChange={(v) => setGstRate(parseFloat(v))}
                  options={[
                    { value: '0', label: '0% GST' },
                    { value: '5', label: '5% GST' },
                    { value: '12', label: '12% GST' },
                    { value: '18', label: '18% GST' },
                    { value: '28', label: '28% GST' },
                  ]}
                />
              </div>
            </div>
          </div>

          {/* Ex-GST Price — hidden when has variants */}
          {!hasVariants && (
          <div>
            <label htmlFor="price_ex_gst" className="block text-sm font-medium text-foreground-secondary mb-2">
              Selling Price (Ex. GST)
            </label>
            <input
              type="number"
              id="price_ex_gst"
              name="price_ex_gst"
              step="0.01"
              min="0"
              value={salePrice}
              readOnly
              className="w-full px-4 py-2 bg-surface-secondary text-foreground-muted cursor-not-allowed border border-border-secondary rounded-lg"
              placeholder="Auto-calculated"
            />
          </div>
          )}

          {/* Stock Status — hidden when has variants */}
          {!hasVariants && (
            <>
              <div>
                <label htmlFor="stock_status" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Stock Status *
                </label>
                <AdminSelect
                  id="stock_status"
                  name="stock_status"
                  required={!hasVariants}
                  defaultValue={product?.stock_status || 'In Stock'}
                  options={[
                    { value: 'In Stock', label: 'In Stock' },
                    { value: 'Low Stock', label: 'Low Stock' },
                    { value: 'Out of Stock', label: 'Out of Stock' },
                  ]}
                />
                <p className="text-xs text-foreground-muted mt-1">Availability shown to customers. Inventory quantity is managed separately.</p>
              </div>
            </>
          )}

          {/* Shipping Weight — only when no variants; per-variant weight is in the variant table */}
          {!hasVariants && (
          <div>
            <label htmlFor="weight_grams" className="block text-sm font-medium text-foreground-secondary mb-2">
              Shipping Weight (g)
            </label>
            <input
              type="number"
              id="weight_grams"
              name="weight_grams"
              step="1"
              min="0"
              defaultValue={product?.weight_grams ?? ''}
              className="w-full field-normal border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g., 500"
            />
          </div>
          )}

          {/* Shipping Dimensions — hidden when variants enabled; shown inside variants section instead */}
          {!hasVariants && (
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-2">
              Package Type
            </label>
            <input type="hidden" name="package_type" value={productPackageType} />
            <AdminSelect
              value={productPackageType}
              onChange={setProductPackageType}
              options={[
                { value: 'flat_poly_auto', label: 'Flat Poly (auto by weight)' },
                { value: 'flat_poly_s',    label: 'Flat Poly S (≤100g)' },
                { value: 'flat_poly_m',    label: 'Flat Poly M (≤500g)' },
                { value: 'flat_poly_l',    label: 'Flat Poly L (≤1500g)' },
                { value: 'flat_poly_xl',   label: 'Flat Poly XL (>1500g)' },
                { value: 'drill_bit_tube',     label: 'Drill Bit Tube' },
                { value: 'drill_bit_set_case', label: 'Drill Bit Set Case' },
                { value: 'corrugated_box',     label: 'Corrugated Box' },
                { value: 'long_tube',          label: 'Long Tube / Rod / Pipe' },
              ]}
            />
            {['drill_bit_tube', 'drill_bit_set_case', 'corrugated_box', 'long_tube'].includes(productPackageType) && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div>
                  <input type="number" id="length_cm" name="length_cm" step="0.1" min="0" defaultValue={product?.length_cm ?? ''} className="w-full field-normal border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="L" />
                  <p className="text-xs text-foreground-muted mt-1 text-center">Length</p>
                </div>
                <div>
                  <input type="number" id="breadth_cm" name="breadth_cm" step="0.1" min="0" defaultValue={product?.breadth_cm ?? ''} className="w-full field-normal border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="B" />
                  <p className="text-xs text-foreground-muted mt-1 text-center">Breadth</p>
                </div>
                <div>
                  <input type="number" id="height_cm" name="height_cm" step="0.1" min="0" defaultValue={product?.height_cm ?? ''} className="w-full field-normal border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="H" />
                  <p className="text-xs text-foreground-muted mt-1 text-center">Height</p>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Description */}
          <div className="md:col-span-2">
            <label htmlFor="description" className="block text-sm font-medium text-foreground-secondary mb-2">
              Description
            </label>
            <AIEnrichButton
              fieldLabel="Description"
              value={description}
              onChange={setDescription}
              context={`Product: ${productName}`}
              multiline
            >
              <textarea
                id="description"
                name="description"
                rows={4}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full field-normal pr-8 border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                placeholder="Enter product description"
              />
            </AIEnrichButton>
          </div>

          {/* Image Upload */}
          <div className="md:col-span-2">
            <ImageUpload
              productId={tempProductId}
              maxImages={5}
              existingImages={product?.product_images || []}
              onImagesChange={(files, existingToKeep, galleryImgs, orderedKeys) => {
                setImageFiles(files)
                setExistingImagesToKeep(existingToKeep)
                setGalleryImageIds(galleryImgs)
                setImageOrder(orderedKeys)
              }}
            />
          </div>

          {/* Checkboxes */}
          <div className="md:col-span-2 flex flex-wrap gap-4 sm:gap-6">
            <div>
              <input type="hidden" name="is_active" value={isActive ? 'true' : ''} />
              <Toggle id="is_active" checked={isActive} onChange={setIsActive} label="Active" />
            </div>
            <div>
              <input type="hidden" name="is_featured" value={isFeatured ? 'true' : ''} />
              <Toggle id="is_featured" checked={isFeatured} onChange={setIsFeatured} label="Featured Product" />
            </div>
            <Toggle id="has_variants_toggle" checked={hasVariants} onChange={setHasVariants} label="This product has variants" />
          </div>

          {/* Variant Management Section */}
          {hasVariants && (
            <div className="md:col-span-2 border border-blue-200 dark:border-blue-800 rounded-lg p-4 bg-blue-50/50 dark:bg-blue-900/20">
              <h3 className="text-sm font-semibold text-foreground mb-4">Product Variants</h3>

              {/* Buying Mode Groups */}
              <div className="space-y-6">
                {groups.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border-secondary p-6 text-center">
                    <p className="text-sm text-foreground-muted mb-3">No variants yet.</p>
                    <button
                      type="button"
                      onClick={() => addGroup('unit')}
                      className="px-4 py-2 text-sm font-medium text-foreground-secondary border border-border-secondary rounded-lg hover:bg-surface-secondary transition-colors"
                    >
                      + Add Variants
                    </button>
                  </div>
                )}
                {groups.map((group) => {
                  const groupVariants = variants.filter(v => v.pricing_type === group.pricing_type && !v._isDeleted)
                  const allGroupVariants = variants.filter(v => v.pricing_type === group.pricing_type)

                  return (
                    <div key={group.pricing_type} className="border border-border-default rounded-lg overflow-hidden">
                      {/* Group header */}
                      <div className="flex items-center justify-between px-4 py-3 bg-surface-secondary border-b border-border-default">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-foreground-muted">Differentiator:</span>
                            <input
                              type="text"
                              value={group.variant_type}
                              onChange={(e) => updateGroupVariantType(group.pricing_type, e.target.value)}
                              className="field-compact border border-border-secondary bg-surface text-foreground text-sm focus:ring-1 focus:ring-accent-500 focus:border-transparent w-36"
                              placeholder="e.g. Size, Pack, Colour"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Mobile cards */}
                      <div className="md:hidden p-3 space-y-3">
                        {groupVariants.map((variant) => {
                          const index = variants.indexOf(variant)
                          const perUnit = null
                          return (
                            <div key={variant.id || index} className="border border-border-default rounded-lg p-3 space-y-3 bg-surface">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-foreground-muted uppercase">
                                  Variant
                                </span>
                                {groupVariants.length > 1 && (
                                  <button type="button" onClick={() => removeVariant(index)} className="text-red-500 hover:text-red-700 text-xs font-medium">
                                    Remove
                                  </button>
                                )}
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-foreground-secondary mb-1">Name *</label>
                                <input
                                  type="text"
                                  value={variant.variant_name}
                                  onChange={(e) => updateVariant(index, 'variant_name', e.target.value)}
                                  className={inputCls}
                                  placeholder="e.g. Small, M8, Red"
                                  required
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-3">
                                {variant.sub_variant_type_on ? (
                                  <>
                                    <div className="col-span-2 rounded-lg border border-dashed border-border-secondary bg-surface-secondary/40 p-2.5">
                                      <p className="text-xs text-foreground-secondary">Pricing managed by sub-variants. Open this variant to add or edit sub-variants.</p>
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Listed Stock (from sub-variants)</label>
                                      <input type="number" value={sumSubVariantStock(subVariantsMap[variant.id || ''])} readOnly className={`${inputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`} placeholder="0" />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-foreground-secondary mb-1">MPN</label>
                                      <input type="text" value={variant.mpn} onChange={(e) => updateVariant(index, 'mpn', e.target.value)} className={inputCls} placeholder="Part No." />
                                    </div>
                                  </>
                                ) : (
                                  <>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">MRP (Ex. GST) *</label>
                                  <input type="number" step="0.01" min="0" value={variant.mrp_ex_gst} onChange={(e) => {
                                    const v = e.target.value
                                    const updated = [...variants]
                                    updated[index] = { ...updated[index], mrp_ex_gst: v }
                                    const newMrpIncl = v ? exToIncl(v, gstRate) : ''
                                    updated[index].mrp = newMrpIncl
                                    const mrpExN = parseFloat(v)
                                    const disc = parseFloat(discountPct || '0')
                                    if (!isNaN(mrpExN) && mrpExN > 0 && !isNaN(disc)) {
                                      const newPriceEx = parseFloat((mrpExN * (1 - disc / 100)).toFixed(2)).toString()
                                      const newPriceIncl = exToIncl(newPriceEx, gstRate)
                                      updated[index].price_ex_gst = newPriceEx
                                      updated[index].price = newPriceIncl
                                    } else {
                                      updated[index].price_ex_gst = ''
                                      updated[index].price = ''
                                    }
                                    setVariants(updated)
                                  }} className={inputCls} placeholder="From catalog" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Discount %</label>
                                  <input type="number" step="0.01" min="0" max="100" readOnly value={discountPct || '0'} className={`${inputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`} />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Selling Price (incl. GST) *</label>
                                  <input type="number" step="0.01" min="0" value={variant.price} readOnly className={`${inputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`} placeholder="Auto-calculated" required />
                                  {perUnit && <p className="text-xs text-accent-600 dark:text-accent-400 mt-0.5">{perUnit}</p>}
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">MRP (incl. GST)</label>
                                  <input type="number" step="0.01" min="0" value={variant.mrp} readOnly className={`${inputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`} placeholder="Auto-calculated" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Selling Price (Ex. GST)</label>
                                  <input type="number" step="0.01" min="0" value={variant.price_ex_gst} readOnly className={`${inputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`} placeholder="Auto-calculated" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">{variant.sub_variant_type_on ? 'Stock Status (from sub-variants)' : 'Stock Status *'}</label>
                                  {variant.sub_variant_type_on ? (
                                    <input type="text" value={sumSubVariantStock(subVariantsMap[variant.id || '']) > 0 ? 'In Stock' : 'Out of Stock'} readOnly className={`${inputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`} />
                                  ) : (
                                    <AdminSelect
                                      value={variant.stock_status}
                                      onChange={(v) => updateVariant(index, 'stock_status', v)}
                                      options={[
                                        { value: 'In Stock', label: 'In Stock' },
                                        { value: 'Low Stock', label: 'Low Stock' },
                                        { value: 'Out of Stock', label: 'Out of Stock' },
                                      ]}
                                    />
                                  )}
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">MPN</label>
                                  <input type="text" value={variant.mpn} onChange={(e) => updateVariant(index, 'mpn', e.target.value)} className={inputCls} placeholder="Part No." />
                                </div>
                                  </>
                                )}
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground-secondary mb-1">GTIN / Barcode</label>
                                <input type="text" value={variant.gtin} onChange={(e) => updateVariant(index, 'gtin', e.target.value)} className={inputCls} placeholder="Barcode" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground-secondary mb-1">Shipping Weight (g)</label>
                                <input type="number" step="1" min="0" value={variant.weight_grams} onChange={(e) => updateVariant(index, 'weight_grams', e.target.value)} className={inputCls} placeholder="e.g. 500" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground-secondary mb-1">Package Type</label>
                                <AdminSelect
                                  value={variant.package_type || 'flat_poly_auto'}
                                  onChange={(val) => updateVariant(index, 'package_type', val)}
                                  options={[
                                    { value: 'flat_poly_auto',    label: 'Flat Poly (auto)' },
                                    { value: 'flat_poly_s',       label: 'Flat Poly S' },
                                    { value: 'flat_poly_m',       label: 'Flat Poly M' },
                                    { value: 'flat_poly_l',       label: 'Flat Poly L' },
                                    { value: 'flat_poly_xl',      label: 'Flat Poly XL' },
                                    { value: 'drill_bit_tube',    label: 'Drill Bit Tube' },
                                    { value: 'drill_bit_set_case',label: 'Drill Bit Set Case' },
                                    { value: 'corrugated_box',    label: 'Corrugated Box' },
                                    { value: 'long_tube',         label: 'Long Tube / Rod' },
                                  ]}
                                  compact
                                />
                              </div>
                              {['drill_bit_tube', 'drill_bit_set_case', 'corrugated_box', 'long_tube'].includes(variant.package_type || 'flat_poly_auto') && (
                              <div>
                                <label className="block text-xs font-medium text-foreground-secondary mb-1">Dimensions (L × B × H cm)</label>
                                <div className="grid grid-cols-3 gap-1">
                                  <input type="number" step="0.1" min="0" value={variant.length_cm} onChange={(e) => updateVariant(index, 'length_cm', e.target.value)} className={inputCls} placeholder="L" />
                                  <input type="number" step="0.1" min="0" value={variant.breadth_cm} onChange={(e) => updateVariant(index, 'breadth_cm', e.target.value)} className={inputCls} placeholder="B" />
                                  <input type="number" step="0.1" min="0" value={variant.height_cm} onChange={(e) => updateVariant(index, 'height_cm', e.target.value)} className={inputCls} placeholder="H" />
                                </div>
                              </div>
                              )}
                              <div className="pt-2 border-t border-border-default space-y-2">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = [...variants]
                                      const row = { ...updated[index] }
                                      row.sub_variant_type_on = !row.sub_variant_type_on
                                      if (!row.sub_variant_type_on) row.sub_variant_type = ''
                                      if (row.sub_variant_type_on) {
                                        row.use_own_images = true
                                        row.price = ''
                                        row.price_ex_gst = ''
                                        row.mrp = ''
                                        row.mrp_ex_gst = ''
                                      }
                                      updated[index] = row
                                      setVariants(updated)
                                    }}
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${variant.sub_variant_type_on ? 'bg-accent-500' : 'bg-border-secondary'}`}
                                    role="switch"
                                    aria-checked={variant.sub_variant_type_on}
                                  >
                                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${variant.sub_variant_type_on ? 'translate-x-4' : 'translate-x-0'}`} />
                                  </button>
                                  <span className="text-xs font-medium text-foreground-secondary">Has sub-variants</span>
                                </div>
                                {variant.sub_variant_type_on && (
                                  <div className="flex items-center gap-2 pl-11">
                                    <span className="text-xs text-foreground-muted">Label</span>
                                    <input
                                      type="text"
                                      value={variant.sub_variant_type}
                                      onChange={(e) => updateVariant(index, 'sub_variant_type', e.target.value)}
                                      className="w-32 field-xs border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent text-xs"
                                      placeholder="e.g. Colour, Finish"
                                    />
                                  </div>
                                )}
                              </div>
                              {product?.sku && variant.variant_name && (
                                <div className="text-xs font-mono text-foreground-muted">
                                  SKU: {product.sku}-{variant.variant_name.toUpperCase().replace(/[^A-Z0-9]/g, '')}
                                </div>
                              )}
                              {variant.id && (
                                <div className="pt-2 border-t border-border-default">
                                  <button
                                    type="button"
                                    onClick={() => openVariantPopup(variant.id!)}
                                    className="text-xs font-medium text-accent-600 dark:text-accent-400 flex items-center gap-1"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h8" /></svg>
                                    Images & Sub-Variants
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {/* Desktop table — core columns only; details in expand panel */}
                      <div className="hidden md:block">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border-secondary bg-surface">
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary text-xs">Name *</th>
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary whitespace-nowrap text-xs">MRP (Ex. GST) *</th>
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary whitespace-nowrap text-xs">Disc %</th>
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary whitespace-nowrap text-xs">MRP (incl)</th>
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary whitespace-nowrap text-xs">Price (incl) *</th>
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary whitespace-nowrap text-xs">Price (Ex)</th>
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary text-xs">Listed Stock *</th>
                              <th className="py-2 px-3 w-16"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupVariants.map((variant) => {
                              const index = variants.indexOf(variant)
                              const perUnit = null
                              const isExpanded = false
                              return (
                                <React.Fragment key={variant.id || index}>
                                <tr className={`border-b border-border-default ${isExpanded ? 'bg-surface-secondary' : 'hover:bg-surface-secondary/40'}`}>
                                  <td className="py-2 px-3">
                                    <input type="text" value={variant.variant_name} onChange={(e) => updateVariant(index, 'variant_name', e.target.value)} className="w-32 field-compact border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="e.g. M8, Red" required />
                                  </td>
                                  {variant.sub_variant_type_on ? (
                                    <td className="py-2 px-3" colSpan={4}>
                                      <span className="text-xs text-foreground-muted italic">Pricing managed by sub-variants</span>
                                    </td>
                                  ) : (
                                    <>
                                  {/* MRP (Ex. GST) — primary input */}
                                  <td className="py-2 px-3">
                                    <input type="number" step="0.01" min="0" value={variant.mrp_ex_gst} onChange={(e) => {
                                      const v = e.target.value
                                      const updated = [...variants]
                                      updated[index] = { ...updated[index], mrp_ex_gst: v }
                                      const newMrpIncl = v ? exToIncl(v, gstRate) : ''
                                      updated[index].mrp = newMrpIncl
                                      const mrpExN = parseFloat(v)
                                      const disc = parseFloat(discountPct || '0')
                                      if (!isNaN(mrpExN) && mrpExN > 0 && !isNaN(disc)) {
                                        const newPriceEx = parseFloat((mrpExN * (1 - disc / 100)).toFixed(2)).toString()
                                        const newPriceIncl = exToIncl(newPriceEx, gstRate)
                                        updated[index].price_ex_gst = newPriceEx
                                        updated[index].price = newPriceIncl
                                      } else {
                                        updated[index].price_ex_gst = ''; updated[index].price = ''
                                      }
                                      setVariants(updated)
                                    }} className="w-28 field-compact border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="From catalog" />
                                  </td>
                                  {/* Discount % — product-level read-only */}
                                  <td className="py-2 px-3">
                                    <input type="number" step="0.01" min="0" max="100" readOnly value={discountPct || '0'} className="w-20 field-compact border border-border-secondary bg-surface-secondary text-foreground-muted cursor-not-allowed text-sm" />
                                  </td>
                                  {/* MRP (incl. GST) — locked */}
                                  <td className="py-2 px-3">
                                    <input type="number" step="0.01" min="0" value={variant.mrp} readOnly className="w-28 field-compact border border-border-secondary bg-surface-secondary text-foreground-muted cursor-not-allowed text-sm" placeholder="Auto" />
                                  </td>
                                  {/* Selling Price (incl. GST) — locked */}
                                  <td className="py-2 px-3">
                                    <div>
                                      <input type="number" step="0.01" min="0" value={variant.price} readOnly className="w-28 field-compact border border-border-secondary bg-surface-secondary text-foreground-muted cursor-not-allowed text-sm" placeholder="Auto" required />
                                      {perUnit && <p className="text-xs text-accent-600 dark:text-accent-400 mt-0.5">{perUnit}</p>}
                                    </div>
                                  </td>
                                  {/* Selling Price (Ex. GST) — locked */}
                                  <td className="py-2 px-3">
                                    <input type="number" step="0.01" min="0" value={variant.price_ex_gst} readOnly className="w-28 field-compact border border-border-secondary bg-surface-secondary text-foreground-muted cursor-not-allowed text-sm" placeholder="Auto" />
                                  </td>
                                    </>
                                  )}
                                  <td className="py-2 px-3">
                                    {variant.sub_variant_type_on ? (
                                      <input type="text" value={sumSubVariantStock(subVariantsMap[variant.id || '']) > 0 ? 'In Stock' : 'Out of Stock'} readOnly className="w-28 field-compact border border-border-secondary bg-surface-secondary text-foreground-muted cursor-not-allowed text-sm" title="Derived from sub-variants" />
                                    ) : (
                                      <AdminSelect
                                        value={variant.stock_status}
                                        onChange={(v) => updateVariant(index, 'stock_status', v)}
                                        sm
                                        className="w-28"
                                        options={[
                                          { value: 'In Stock', label: 'In Stock' },
                                          { value: 'Low Stock', label: 'Low Stock' },
                                          { value: 'Out of Stock', label: 'Out of Stock' },
                                        ]}
                                      />
                                    )}
                                  </td>
                                  <td className="py-2 px-3">
                                    <div className="flex items-center gap-1 justify-end">
                                      <button
                                        type="button"
                                        onClick={() => variant.id ? openVariantPopup(variant.id) : undefined}
                                        className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors text-foreground-muted hover:text-foreground hover:bg-surface-secondary"
                                        title="Edit images & sub-variants"
                                      >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h8" /></svg>
                                        More
                                      </button>
                                      {allGroupVariants.filter(v => !v._isDeleted).length > 1 && (
                                        <button type="button" onClick={() => removeVariant(index)} className="text-red-400 hover:text-red-600 p-1 rounded transition-colors" title="Remove">
                                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                                </React.Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Add variant to group */}
                      <div className="px-4 py-3 border-t border-border-default bg-surface">
                        <button
                          type="button"
                          onClick={() => addVariantToGroup(group.pricing_type, group.unit)}
                          className="px-3 py-1.5 text-xs font-medium text-accent-600 dark:text-accent-400 border border-accent-300 rounded-lg hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                        >
                          + Add Variant
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <p className="text-xs text-foreground-muted mt-4">
                Stock is managed per variant. Product-level stock is not used when variants are enabled.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Selling Units (product-level — applies to every variant) */}
      {productId && (
        <div className="px-4 sm:px-6 py-4 border-t border-border-default">
          <h3 className="text-sm font-semibold text-foreground mb-3">Selling Units &amp; Conversions</h3>
          <p className="text-xs text-foreground-muted mb-4">
            Configure alternate units (e.g. box of 100, sheet of 4&apos;×8&apos;, tin of 5 L). The pricing engine
            multiplies the base price by the factor automatically. Stock always lives in the BASE unit.
            Units configured here apply to <strong>every variant</strong> by default — open a variant to override per-variant.
            For bulk discounts, attach a tiered_price rule to the unit instead of overriding the price.
          </p>
          <UnitsManager
            productId={productId}
            basePrice={basePrice}
          />
        </div>
      )}

      {/* Form Actions */}
      <div className="px-4 sm:px-6 py-4 bg-surface-secondary border-t border-border-default flex flex-col sm:flex-row justify-end gap-3 sm:gap-4">
        <Link
          href={ap('/admin/products')}
          className="px-6 py-2 border border-border-secondary rounded-lg text-foreground-secondary hover:bg-surface-secondary transition-colors text-center"
        >
          Cancel
        </Link>
        <button
          type="submit"
          name="intent"
          value="draft"
          disabled={isSubmitting}
          onClick={() => setIsActive(false)}
          className="px-6 py-2 bg-surface border border-border-secondary hover:bg-surface-secondary text-foreground rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : 'Save as Draft'}
        </button>
        <button
          type="submit"
          name="intent"
          value="publish"
          disabled={isSubmitting}
          onClick={() => setIsActive(true)}
          className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : product ? 'Update & Publish' : 'Save & Publish'}
        </button>
      </div>
      {/* Variant Detail Popup */}
      {variantPopupId && (() => {
        const popupVariant = variants.find(v => v.id === variantPopupId)
        if (!popupVariant) return null
        const popupIndex = variants.indexOf(popupVariant)
        const navIndex = activeVariants.findIndex(v => v.id === variantPopupId)
        const prevVariant = navIndex > 0 ? activeVariants[navIndex - 1] : null
        const nextVariant = navIndex < activeVariants.length - 1 ? activeVariants[navIndex + 1] : null
        return (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60" onClick={() => setVariantPopupId(null)}>
            <div className="bg-surface rounded-xl border border-border-default shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
                <div className="flex items-center gap-2 min-w-0">
                  <button type="button" onClick={() => prevVariant && setVariantPopupId(prevVariant.id ?? null)} disabled={!prevVariant} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm">&#8249;</button>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground truncate">{popupVariant.variant_name || 'Variant Details'}</h3>
                    <p className="text-xs text-foreground-muted mt-0.5">{navIndex + 1} / {activeVariants.length}</p>
                  </div>
                  <button type="button" onClick={() => nextVariant && setVariantPopupId(nextVariant.id ?? null)} disabled={!nextVariant} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg border border-border-default text-foreground-secondary hover:bg-surface-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm">&#8250;</button>
                </div>
                <button type="button" onClick={() => setVariantPopupId(null)} className="shrink-0 text-foreground-muted hover:text-foreground transition-colors p-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="p-5 space-y-6">
                {/* Pricing & Identifiers */}
                <div>
                  <div className="flex items-baseline justify-between mb-3">
                    <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Pricing & Identifiers</p>
                    <span className="text-[10px] text-foreground-muted">Per BASE unit{popupUnitKey ? ` (${popupUnitKey})` : ''}. Other units convert via factor — configure in Variant Units below.</span>
                  </div>
                  {popupUnitInfo && popupUnitInfo.unitKey && !popupVariant.sub_variant_type_on && (
                    <div className={`flex items-center gap-2 flex-wrap mb-3 px-3 py-2 rounded-lg border text-[11px] ${
                      popupUnitInfo.inherited
                        ? 'border-border-default bg-surface-secondary/60 text-foreground-secondary'
                        : 'border-accent-300/50 bg-accent-50 dark:bg-accent-900/20 text-foreground'
                    }`}>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-foreground-muted">Prices apply to</span>
                      <span className="font-semibold text-foreground">1 {popupUnitKey}</span>
                      {popupUnitInfo.displayLabel && (
                        <span className="text-foreground-muted">({popupUnitInfo.displayLabel})</span>
                      )}
                      <span className="text-border-secondary">·</span>
                      {popupUnitInfo.inherited ? (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface border border-border-default text-foreground-muted">
                          Inherited from product
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-accent-500/10 border border-accent-300/40 text-accent-700 dark:text-accent-300">
                          Variant override
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-foreground-muted italic">
                        {popupUnitInfo.inherited
                          ? "Change product's Selling Unit, or click Override below to set a variant-specific unit."
                          : 'Reset below to inherit the product’s unit.'}
                      </span>
                    </div>
                  )}
                  {popupVariant.sub_variant_type_on ? (
                    <div className="rounded-lg border border-dashed border-border-secondary bg-surface-secondary/40 p-3 space-y-3">
                      <p className="text-xs text-foreground-secondary">Pricing is managed at the sub-variant level for this variant. Use the Sub-variants section below to set prices.</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-foreground-secondary mb-1">MPN</label>
                          <input type="text" value={popupVariant.mpn} onChange={(e) => updateVariant(popupIndex, 'mpn', e.target.value)} className="w-full field-compact border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="Part No." />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-foreground-secondary mb-1">GTIN / Barcode</label>
                          <input type="text" value={popupVariant.gtin} onChange={(e) => updateVariant(popupIndex, 'gtin', e.target.value)} className="w-full field-compact border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="Barcode" />
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
                    {/* MRP (Ex. GST) — primary input from price catalog */}
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1 whitespace-nowrap">MRP (Ex. GST) *</label>
                      <input type="number" step="0.01" min="0" value={popupVariant.mrp_ex_gst} onChange={(e) => {
                        const v = e.target.value
                        const updated = [...variants]
                        updated[popupIndex] = { ...updated[popupIndex], mrp_ex_gst: v }
                        const newMrpIncl = v ? exToIncl(v, gstRate) : ''
                        updated[popupIndex].mrp = newMrpIncl
                        const mrpExN = parseFloat(v)
                        const disc = parseFloat(discountPct || '0')
                        if (!isNaN(mrpExN) && mrpExN > 0 && !isNaN(disc)) {
                          const newPriceEx = String(Math.round(mrpExN * (1 - disc / 100) * 100) / 100)
                          const newPriceIncl = exToIncl(newPriceEx, gstRate)
                          updated[popupIndex].price_ex_gst = newPriceEx
                          updated[popupIndex].price = newPriceIncl
                        } else {
                          updated[popupIndex].price_ex_gst = ''; updated[popupIndex].price = ''
                        }
                        setVariants(updated)
                      }} className="w-full field-compact border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="From catalog" />
                    </div>
                    {/* Discount % — product-level read-only */}
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1 whitespace-nowrap">Discount %</label>
                      <input type="number" step="0.01" min="0" max="100" readOnly value={discountPct || '0'} className="w-full field-compact border border-border-secondary bg-surface-secondary text-foreground-muted cursor-not-allowed" />
                    </div>
                    {/* MRP (incl. GST) — locked */}
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1 whitespace-nowrap">MRP (incl. GST)</label>
                      <input type="number" step="0.01" min="0" value={popupVariant.mrp} readOnly className="w-full field-compact border border-border-secondary bg-surface-secondary text-foreground-muted cursor-not-allowed" placeholder="Auto-calculated" />
                    </div>
                    {/* Selling Price (incl. GST) — locked */}
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1 whitespace-nowrap">Price (incl. GST)</label>
                      <input type="number" step="0.01" min="0" value={popupVariant.price} readOnly className="w-full field-compact border border-border-secondary bg-surface-secondary text-foreground-muted cursor-not-allowed" placeholder="Auto-calculated" />
                    </div>
                    {/* Selling Price (Ex. GST) — locked */}
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1 whitespace-nowrap">Price (Ex. GST)</label>
                      <input type="number" step="0.01" min="0" value={popupVariant.price_ex_gst} readOnly className="w-full field-compact border border-border-secondary bg-surface-secondary text-foreground-muted cursor-not-allowed" placeholder="Auto-calculated" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">MPN</label>
                      <input type="text" value={popupVariant.mpn} onChange={(e) => updateVariant(popupIndex, 'mpn', e.target.value)} className="w-full field-compact border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="Part No." />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">GTIN / Barcode</label>
                      <input type="text" value={popupVariant.gtin} onChange={(e) => updateVariant(popupIndex, 'gtin', e.target.value)} className="w-full field-compact border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="Barcode" />
                    </div>
                  </div>
                  )}
                  {/* Sub-variants toggle */}
                  <div className="space-y-2 pt-3">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => { const updated = [...variants]; const row = { ...updated[popupIndex] }; row.sub_variant_type_on = !row.sub_variant_type_on; if (!row.sub_variant_type_on) row.sub_variant_type = ''; if (row.sub_variant_type_on) { row.use_own_images = true; row.price = ''; row.price_ex_gst = ''; row.mrp = ''; row.mrp_ex_gst = '' } updated[popupIndex] = row; setVariants(updated) }} className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${popupVariant.sub_variant_type_on ? 'bg-accent-500' : 'bg-border-secondary'}`} role="switch" aria-checked={popupVariant.sub_variant_type_on}>
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${popupVariant.sub_variant_type_on ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                      <span className="text-xs font-medium text-foreground-secondary">Has sub-variants</span>
                    </div>
                    {popupVariant.sub_variant_type_on && (
                      <div className="flex items-center gap-2 pl-11">
                        <span className="text-xs text-foreground-muted">Label</span>
                        <input type="text" value={popupVariant.sub_variant_type} onChange={(e) => updateVariant(popupIndex, 'sub_variant_type', e.target.value)} className="w-40 field-xs border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="e.g. Colour, Finish" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Shipping */}
                <div>
                  <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-3">Shipping</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Ship Wt. (g)</label>
                      <input type="number" step="1" min="0" value={popupVariant.weight_grams} onChange={(e) => updateVariant(popupIndex, 'weight_grams', e.target.value)} className="w-full field-normal border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="e.g. 500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Package Type</label>
                      <div className="w-full h-9 flex items-center border border-border-secondary rounded-lg overflow-hidden bg-surface">
                        <button type="button" onClick={() => { const idx = PACKAGE_TYPES.indexOf(popupVariant.package_type || 'flat_poly_auto'); updateVariant(popupIndex, 'package_type', PACKAGE_TYPES[(idx - 1 + PACKAGE_TYPES.length) % PACKAGE_TYPES.length]) }} className="h-full px-2 text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors text-sm leading-none">‹</button>
                        <span className="h-full px-2 text-sm font-medium text-foreground flex-1 text-center border-x border-border-secondary truncate flex items-center justify-center">{PACKAGE_TYPE_LABELS[popupVariant.package_type || 'flat_poly_auto']}</span>
                        <button type="button" onClick={() => { const idx = PACKAGE_TYPES.indexOf(popupVariant.package_type || 'flat_poly_auto'); updateVariant(popupIndex, 'package_type', PACKAGE_TYPES[(idx + 1) % PACKAGE_TYPES.length]) }} className="h-full px-2 text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors text-sm leading-none">›</button>
                      </div>
                    </div>
                  </div>
                  {['drill_bit_tube','drill_bit_set_case','corrugated_box','long_tube'].includes(popupVariant.package_type || 'flat_poly_auto') && (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Dimensions (L × B × H cm)</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        <input type="number" step="0.1" min="0" value={popupVariant.length_cm} onChange={(e) => updateVariant(popupIndex, 'length_cm', e.target.value)} className="field-compact border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="L" />
                        <input type="number" step="0.1" min="0" value={popupVariant.breadth_cm} onChange={(e) => updateVariant(popupIndex, 'breadth_cm', e.target.value)} className="field-compact border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="B" />
                        <input type="number" step="0.1" min="0" value={popupVariant.height_cm} onChange={(e) => updateVariant(popupIndex, 'height_cm', e.target.value)} className="field-compact border border-border-secondary bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="H" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Images */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Images</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-foreground-secondary">Own images</span>
                      <button
                        type="button"
                        onClick={() => updateVariant(popupIndex, 'use_own_images', !popupVariant.use_own_images)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${popupVariant.use_own_images ? 'bg-accent-500' : 'bg-border-secondary'}`}
                        role="switch"
                        aria-checked={popupVariant.use_own_images}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${popupVariant.use_own_images ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  </div>
                  {popupVariant.use_own_images ? (
                    <>
                      {(variantImagesMap[variantPopupId] || []).length > 1 && (
                        <p className="text-xs text-foreground-muted mb-2">
                          <span className="hidden sm:inline">Drag</span><span className="sm:hidden">Use ◀ ▶</span> to reorder · First image is shown first on the product page
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {(variantImagesMap[variantPopupId] || []).map((img: any, imgIdx: number, arr: any[]) => (
                          <div
                            key={img.id}
                            className="relative group w-20 h-20 sm:w-16 sm:h-16 rounded border border-border-default overflow-hidden bg-surface cursor-grab active:cursor-grabbing select-none"
                            draggable
                            onDragStart={() => { variantImageDragIndex.current = imgIdx }}
                            onDragEnter={() => { variantImageDragOverIndex.current = imgIdx }}
                            onDragOver={(e) => e.preventDefault()}
                            onDragEnd={() => {
                              const from = variantImageDragIndex.current
                              const to = variantImageDragOverIndex.current
                              variantImageDragIndex.current = null
                              variantImageDragOverIndex.current = null
                              if (from === null || to === null || from === to) return
                              reorderVariantImages(variantPopupId, from, to)
                            }}
                          >
                            <img src={img.thumbnail_url || img.image_url} alt="" className="w-full h-full object-cover pointer-events-none select-none" />
                            <span className="absolute top-0 right-0 text-[10px] sm:text-[9px] bg-black/60 text-white px-1 leading-4 font-bold">{imgIdx + 1}</span>
                            {img.is_primary && <span className="absolute top-0 left-0 bg-accent-500 text-white px-1 py-0.5 leading-none"><Star className="w-2.5 h-2.5 fill-current" /></span>}
                            {arr.length > 1 && (
                              <div className="absolute inset-x-0 bottom-0 flex justify-between px-0.5 pb-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity">
                                <button
                                  type="button"
                                  onClick={() => imgIdx > 0 && reorderVariantImages(variantPopupId, imgIdx, imgIdx - 1)}
                                  disabled={imgIdx === 0}
                                  className="w-5 h-5 flex items-center justify-center rounded bg-black/60 text-white text-xs leading-none disabled:opacity-30"
                                  title="Move left"
                                  aria-label="Move image left"
                                >
                                  ◀
                                </button>
                                <button
                                  type="button"
                                  onClick={() => imgIdx < arr.length - 1 && reorderVariantImages(variantPopupId, imgIdx, imgIdx + 1)}
                                  disabled={imgIdx === arr.length - 1}
                                  className="w-5 h-5 flex items-center justify-center rounded bg-black/60 text-white text-xs leading-none disabled:opacity-30"
                                  title="Move right"
                                  aria-label="Move image right"
                                >
                                  ▶
                                </button>
                              </div>
                            )}
                            <div className="absolute inset-x-0 top-4 bottom-6 sm:inset-0 sm:top-0 sm:bottom-0 bg-black/50 sm:bg-black/0 sm:group-hover:bg-black/50 transition-opacity flex items-center justify-center gap-1">
                              {!img.is_primary && <button type="button" onClick={() => setVariantImagePrimary(variantPopupId, img.id)} className="text-yellow-300 hover:text-yellow-100 leading-none sm:opacity-0 sm:group-hover:opacity-100" title="Set primary"><Star className="w-4 h-4" /></button>}
                              <button type="button" onClick={() => deleteVariantImage(variantPopupId, img.id)} disabled={!!variantImageDeleting[img.id]} className="text-red-300 hover:text-red-100 leading-none sm:opacity-0 sm:group-hover:opacity-100 disabled:opacity-50" title="Delete"><X className="w-4 h-4" /></button>
                            </div>
                            {variantImageDeleting[img.id] && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-none">
                                <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                              </div>
                            )}
                          </div>
                        ))}
                        {Array.from({ length: variantImagePendingAdds[variantPopupId] || 0 }).map((_, k) => (
                          <div key={`pending-${k}`} className="relative w-20 h-20 sm:w-16 sm:h-16 rounded border border-border-default bg-surface-secondary flex items-center justify-center overflow-hidden">
                            <div className="absolute inset-0 animate-pulse bg-surface-tertiary/40" />
                            <svg className="relative w-5 h-5 text-foreground-muted animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                          </div>
                        ))}
                        {(variantImagesMap[variantPopupId] || []).length + (variantImagePendingAdds[variantPopupId] || 0) < 5 && (
                          <label className={`w-20 h-20 sm:w-16 sm:h-16 rounded border-2 border-dashed border-border-secondary flex items-center justify-center cursor-pointer hover:border-accent-400 transition-colors ${variantImageUploading[variantPopupId] ? 'opacity-50 pointer-events-none' : ''}`}>
                            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVariantImageFile(variantPopupId, f); e.target.value = '' }} />
                            {variantImageUploading[variantPopupId] ? <svg className="w-4 h-4 text-foreground-muted animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> : <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>}
                          </label>
                        )}
                      </div>
                      {productId && (variantImagesMap[variantPopupId] || []).length < 5 && (
                        <button
                          type="button"
                          onClick={openVariantGallery}
                          className="mt-2 px-2.5 py-1 bg-surface-secondary hover:bg-surface-elevated border border-border-default text-foreground-secondary rounded-lg text-xs font-semibold transition-colors"
                        >
                          Choose from Gallery
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-foreground-muted italic">Uses product images</p>
                  )}
                  {variantImageError && (
                    <p className="mt-2 text-xs text-red-500">{variantImageError}</p>
                  )}
                </div>

                {variantGalleryOpen && typeof document !== 'undefined' && createPortal(
                  <div className="fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm bg-black/50 p-4">
                    <div className="bg-surface-elevated rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
                      <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
                        <h2 className="text-lg font-semibold text-foreground">Choose from Gallery</h2>
                        <button
                          type="button"
                          onClick={() => { setVariantGalleryOpen(false); setVariantGallerySelected([]) }}
                          className="text-foreground-muted hover:text-foreground transition-colors text-2xl leading-none"
                        >
                          &times;
                        </button>
                      </div>
                      <div className="px-6 py-3 border-b border-border-default flex gap-2 items-center">
                        <input
                          type="text"
                          placeholder="Search by name..."
                          value={variantGallerySearch}
                          onChange={e => setVariantGallerySearch(e.target.value)}
                          className="flex-1 field-normal border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                        />
                        <div className="w-48 shrink-0">
                          <AdminSelect
                            value={variantGalleryCategory}
                            onChange={setVariantGalleryCategory}
                            placeholder="All categories"
                            options={[
                              { value: '', label: 'All categories' },
                              ...variantGalleryCategories.map((c: any) => ({ value: c.id, label: c.name })),
                            ]}
                          />
                        </div>
                      </div>
                      <div className="overflow-y-auto flex-1 min-h-0 p-4 pr-3">
                        {variantGalleryLoading && (
                          <div className="flex items-center justify-center py-16">
                            <div className="w-8 h-8 border-4 border-accent-500 border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                        {!variantGalleryLoading && variantGalleryImages.length === 0 && (
                          <p className="text-center text-foreground-secondary py-16">No images in gallery yet.</p>
                        )}
                        {!variantGalleryLoading && variantGalleryImages.length > 0 && (() => {
                          const q = variantGallerySearch.toLowerCase()
                          const filtered = variantGalleryImages.filter((g: any) => {
                            const nameMatch = q ? (g.custom_name || '').toLowerCase().includes(q) : true
                            const catMatch = variantGalleryCategory ? g.category_id === variantGalleryCategory : true
                            return nameMatch && catMatch
                          })
                          return filtered.length === 0 ? (
                            <p className="text-center text-foreground-secondary py-16">No images match &ldquo;{variantGallerySearch}&rdquo;</p>
                          ) : (
                            <div className="grid grid-cols-4 gap-3 w-full">
                              {filtered.map((gimg: any) => {
                                const selIdx = variantGallerySelected.indexOf(gimg.id)
                                const isSelected = selIdx !== -1
                                return (
                                  <button
                                    key={gimg.id}
                                    type="button"
                                    onClick={() => setVariantGallerySelected(prev =>
                                      prev.includes(gimg.id) ? prev.filter((id: string) => id !== gimg.id) : [...prev, gimg.id]
                                    )}
                                    className={`relative rounded-lg overflow-hidden border-2 transition-colors text-left ${isSelected ? 'border-accent-500 ring-2 ring-accent-500' : 'border-border-default hover:border-accent-400'}`}
                                  >
                                    {isSelected && (
                                      <div className="absolute top-1 right-1 bg-accent-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold z-10">
                                        {selIdx + 1}
                                      </div>
                                    )}
                                    <div className="aspect-square">
                                      <img src={gimg.thumbnail_url || gimg.image_url} alt={gimg.custom_name || gimg.file_name} className="w-full h-full object-cover" />
                                    </div>
                                    <div className="px-1.5 py-1 bg-surface-secondary">
                                      <p className="text-xs text-foreground-secondary truncate">{gimg.custom_name || gimg.file_name}</p>
                                      {gimg.category_name && (
                                        <p className="text-xs text-accent-500 truncate">{gimg.category_name}</p>
                                      )}
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          )
                        })()}
                      </div>
                      <div className="px-6 py-4 border-t border-border-default flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => { setVariantGalleryOpen(false); setVariantGallerySelected([]) }}
                          className="px-4 py-2 text-sm font-semibold text-foreground-secondary hover:text-foreground transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={addVariantImagesFromGallery}
                          disabled={variantGallerySelected.length === 0 || (variantImagePendingAdds[variantPopupId || ''] || 0) > 0}
                          className="px-4 py-2 bg-accent-500 hover:bg-accent-600 disabled:bg-surface-secondary disabled:text-foreground-muted text-white rounded-lg text-sm font-semibold transition-colors"
                        >
                          {variantGallerySelected.length > 0 ? `Add ${variantGallerySelected.length} Image${variantGallerySelected.length > 1 ? 's' : ''}` : 'Add Images'}
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

                {/* Sub-Variants */}
                {popupVariant.sub_variant_type_on && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                        Sub-Variants{popupVariant.sub_variant_type ? ` (${popupVariant.sub_variant_type})` : ''}
                      </p>
                      {popupUnitKey && (
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wide bg-accent-500/10 text-accent-600 px-1.5 py-0.5 rounded border border-accent-500/30"
                          title={`All sub-variant prices are per this base unit${popupUnitInfo?.inherited ? ' (inherited from product)' : ''}. Configure other units in Variant Units below.`}
                        >
                          per {popupUnitInfo?.displayLabel || popupUnitKey}
                          {popupUnitInfo?.inherited && (
                            <span className="ml-1 normal-case font-normal text-foreground-muted">(inherited)</span>
                          )}
                        </span>
                      )}
                    </div>
                    {variantPopupId.startsWith('temp-') && (
                      <div className="mb-3 rounded-lg border border-dashed border-amber-400/60 bg-amber-50 dark:bg-amber-900/20 p-3">
                        <p className="text-xs text-amber-700 dark:text-amber-300">Save the product first to add sub-variants for this variant.</p>
                      </div>
                    )}
                    {(subVariantsMap[variantPopupId] || []).length > 0 && (
                      <div className="overflow-x-auto mb-3">
                      <table className="w-full text-xs whitespace-nowrap">
                        <thead>
                          <tr className="text-left text-foreground-muted border-b border-border-default">
                            <th className="pb-1 pr-2 font-medium">Name</th>
                            <th className="pb-1 pr-2 font-medium">MRP (Ex){popupUnitKey && <span className="text-[10px] text-foreground-muted ml-1">/ {popupUnitKey}</span>}</th>
                            <th className="pb-1 pr-2 font-medium">Disc %</th>
                            <th className="pb-1 pr-2 font-medium">MRP (incl){popupUnitKey && <span className="text-[10px] text-foreground-muted ml-1">/ {popupUnitKey}</span>}</th>
                            <th className="pb-1 pr-2 font-medium">Price (incl){popupUnitKey && <span className="text-[10px] text-foreground-muted ml-1">/ {popupUnitKey}</span>}</th>
                            <th className="pb-1 pr-2 font-medium">Price (Ex){popupUnitKey && <span className="text-[10px] text-foreground-muted ml-1">/ {popupUnitKey}</span>}</th>
                            <th className="pb-1 pr-2 font-medium">Stock</th>
                            <th className="pb-1 pr-2 font-medium">SKU</th>
                            <th className="pb-1"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(subVariantsMap[variantPopupId] || []).map((sv: any) => {
                            const isEditingSv = subVariantEditId === sv.id
                            const ed = subVariantEditDraft
                            const svInputCls = "field-xs border border-accent-500 bg-surface text-foreground focus:ring-1 focus:ring-accent-500 w-16"
                            return (
                              <React.Fragment key={sv.id}>
                              <tr className="border-b border-border-default last:border-0">
                                {isEditingSv && ed ? (<>
                                  <td className="py-1 pr-1"><input type="text" value={ed.name} onChange={e => setSubVariantEditDraft(d => d && ({ ...d, name: e.target.value }))} className={`${svInputCls} w-20`} /></td>
                                  {/* MRP (Ex. GST) — primary input */}
                                  <td className="py-1 pr-1"><input type="number" step="0.01" value={ed.mrp_ex_gst} onChange={e => {
                                    const v = e.target.value; const mrpExN = parseFloat(v)
                                    const disc = parseFloat(discountPct || '0')
                                    const newMrpIncl = v ? exToIncl(v, gstRate) : ''
                                    if (!isNaN(mrpExN) && mrpExN > 0 && !isNaN(disc)) {
                                      const newPriceEx = parseFloat((mrpExN * (1 - disc / 100)).toFixed(2)).toString()
                                      const newPriceIncl = exToIncl(newPriceEx, gstRate)
                                      setSubVariantEditDraft(d => d && ({ ...d, mrp_ex_gst: v, mrp: newMrpIncl, price_ex_gst: newPriceEx, price: newPriceIncl }))
                                    } else {
                                      setSubVariantEditDraft(d => d && ({ ...d, mrp_ex_gst: v, mrp: newMrpIncl, price_ex_gst: '', price: '' }))
                                    }
                                  }} className={svInputCls} /></td>
                                  {/* Discount % — product-level read-only */}
                                  <td className="py-1 pr-1"><input type="number" step="0.01" min="0" max="100" readOnly value={discountPct || '0'} className={`${svInputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`} /></td>
                                  {/* MRP (incl. GST) — locked */}
                                  <td className="py-1 pr-1"><input type="number" step="0.01" value={ed.mrp} readOnly className={`${svInputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`} /></td>
                                  {/* Price (incl. GST) — locked */}
                                  <td className="py-1 pr-1"><input type="number" step="0.01" value={ed.price} readOnly className={`${svInputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`} /></td>
                                  {/* Price (Ex. GST) — locked */}
                                  <td className="py-1 pr-1"><input type="number" step="0.01" value={ed.price_ex_gst} readOnly className={`${svInputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`} /></td>
                                  <td className="py-1 pr-1">
                                    <AdminSelect
                                      value={ed.stock}
                                      onChange={v => setSubVariantEditDraft(d => d && ({ ...d, stock: v }))}
                                      xs
                                      className="w-28"
                                      options={[
                                        { value: 'In Stock', label: 'In Stock' },
                                        { value: 'Low Stock', label: 'Low Stock' },
                                        { value: 'Out of Stock', label: 'Out of Stock' },
                                      ]}
                                    />
                                  </td>
                                  <td className="py-1 pr-1"><input type="text" value={ed.sku} onChange={e => setSubVariantEditDraft(d => d && ({ ...d, sku: e.target.value }))} className={`${svInputCls} w-20`} /></td>
                                  <td className="py-1 pl-1 flex items-center gap-1">
                                    <button type="button" onClick={async () => {
                                      if (!ed) return
                                      const res = await fetch(`/api/admin/products/${productId}/variants/${variantPopupId}/sub-variants`, {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ id: sv.id, sub_variant_name: ed.name, price: ed.price ? parseFloat(ed.price) : null, mrp: ed.mrp ? parseFloat(ed.mrp) : null, price_ex_gst: ed.price_ex_gst ? parseFloat(ed.price_ex_gst) : null, mrp_ex_gst: ed.mrp_ex_gst ? parseFloat(ed.mrp_ex_gst) : null, discount_pct: parseFloat(discountPct) || 0, stock_status: ed.stock || 'In Stock', sku: ed.sku || null }),
                                      })
                                      if (res.ok) {
                                        const updated = await res.json()
                                        setSubVariantsMap(m => ({ ...m, [variantPopupId]: m[variantPopupId].map(s => s.id === sv.id ? (updated.sub_variant || { ...s, sub_variant_name: ed.name, price: ed.price ? parseFloat(ed.price) : null, mrp: ed.mrp ? parseFloat(ed.mrp) : null, price_ex_gst: ed.price_ex_gst ? parseFloat(ed.price_ex_gst) : null, mrp_ex_gst: ed.mrp_ex_gst ? parseFloat(ed.mrp_ex_gst) : null, stock_status: ed.stock || 'In Stock', sku: ed.sku || s.sku }) : s) }))
                                      }
                                      setSubVariantEditId(null); setSubVariantEditDraft(null)
                                    }} className="text-accent-600 hover:text-accent-700 text-xs font-medium leading-none">Save</button>
                                    <button type="button" onClick={() => { setSubVariantEditId(null); setSubVariantEditDraft(null) }} className="text-foreground-muted hover:text-foreground text-xs font-medium leading-none">Cancel</button>
                                  </td>
                                </>) : (<>
                                  <td className="py-1.5 pr-2">{sv.sub_variant_name}</td>
                                  <td className="py-1.5 pr-2">{sv.mrp_ex_gst != null ? `₹${sv.mrp_ex_gst}` : '—'}</td>
                                  <td className="py-1.5 pr-2">{discountPct ? `${discountPct}%` : '—'}</td>
                                  <td className="py-1.5 pr-2">{sv.mrp != null ? `₹${sv.mrp}` : '—'}</td>
                                  <td className="py-1.5 pr-2">{sv.price != null ? `₹${sv.price}` : '—'}</td>
                                  <td className="py-1.5 pr-2">{sv.price_ex_gst != null ? `₹${sv.price_ex_gst}` : '—'}</td>
                                  <td className="py-1.5 pr-2">{sv.stock_status || '—'}</td>
                                  <td className="py-1.5 pr-2 font-mono text-foreground-muted">{sv.sku}</td>
                                  <td className="py-1.5 flex items-center gap-2">
                                    <button type="button" onClick={() => { setSubVariantEditId(sv.id); setSubVariantEditDraft({ name: sv.sub_variant_name, price: sv.price != null ? String(sv.price) : '', mrp: sv.mrp != null ? String(sv.mrp) : '', price_ex_gst: sv.price_ex_gst != null ? String(sv.price_ex_gst) : '', mrp_ex_gst: sv.mrp_ex_gst != null ? String(sv.mrp_ex_gst) : '', discount_pct: sv.discount_pct != null ? String(sv.discount_pct) : '', stock: sv.stock_status || 'In Stock', sku: sv.sku || '' }) }} className="text-accent-500 hover:text-accent-600 leading-none text-xs font-medium">Edit</button>
                                    <button type="button" onClick={() => setExpandedSvUnits(s => { const n = new Set(s); n.has(sv.id) ? n.delete(sv.id) : n.add(sv.id); return n })} className="text-foreground-muted hover:text-accent-500 leading-none text-xs font-medium">Unit</button>
                                    <button type="button" onClick={() => deleteSubVariant(variantPopupId, sv.id)} className="text-red-400 hover:text-red-600 leading-none" aria-label="Delete"><X className="w-3.5 h-3.5" /></button>
                                  </td>
                                </>)}
                              </tr>
                              {expandedSvUnits.has(sv.id) && productId && !variantPopupId.startsWith('temp-') && (
                                <tr key={`${sv.id}-unit`}>
                                  <td colSpan={9} className="px-2 pb-3 pt-1 bg-surface-secondary/50">
                                    <UnitsManager
                                      productId={productId}
                                      variantId={variantPopupId}
                                      subVariantId={sv.id}
                                      basePrice={sv.price}
                                    />
                                  </td>
                                </tr>
                              )}
                              </React.Fragment>
                            )
                          })}
                        </tbody>
                      </table>
                      </div>
                    )}
                    {(() => {
                      const d = subVariantDrafts[variantPopupId] || { name:'',price:'',mrp:'',price_ex_gst:'',mrp_ex_gst:'',discount_pct:'',stock:'',sku:'' }
                      const setD = (field: string, val: string) => setSubVariantDrafts(m => ({ ...m, [variantPopupId]: { ...d, [field]: val } }))
                      const inputCls = "field-xs border border-border-secondary bg-surface text-foreground focus:ring-1 focus:ring-accent-500"
                      const lockedCls = `${inputCls} bg-surface-secondary text-foreground-muted cursor-not-allowed`
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">Name *</label>
                            <input type="text" placeholder="e.g. Red" value={d.name} onChange={(e) => setD('name', e.target.value)} className={`${inputCls} w-full`} />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">MRP (Ex. GST) *{popupUnitKey && <span className="text-[10px] text-foreground-muted ml-1">/ {popupUnitKey}</span>}</label>
                            <input type="number" step="0.01" placeholder="From catalog" value={d.mrp_ex_gst} onChange={(e) => {
                              const v = e.target.value; const mrpExN = parseFloat(v)
                              const disc = parseFloat(discountPct || '0')
                              const newMrpIncl = v ? exToIncl(v, gstRate) : ''
                              if (!isNaN(mrpExN) && mrpExN > 0 && !isNaN(disc)) {
                                const newPriceEx = String(Math.round(mrpExN * (1 - disc / 100) * 100) / 100)
                                const newPriceIncl = exToIncl(newPriceEx, gstRate)
                                setSubVariantDrafts(m => ({ ...m, [variantPopupId]: { ...d, mrp_ex_gst: v, mrp: newMrpIncl, price_ex_gst: newPriceEx, price: newPriceIncl } }))
                              } else {
                                setSubVariantDrafts(m => ({ ...m, [variantPopupId]: { ...d, mrp_ex_gst: v, mrp: newMrpIncl, price_ex_gst: '', price: '' } }))
                              }
                            }} className={`${inputCls} w-full`} />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">Discount %</label>
                            <input type="number" step="0.01" min="0" max="100" readOnly value={discountPct || '0'} className={`${lockedCls} w-full`} />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">MRP (incl. GST){popupUnitKey && <span className="text-[10px] text-foreground-muted ml-1">/ {popupUnitKey}</span>}</label>
                            <input type="number" step="0.01" value={d.mrp} readOnly className={`${lockedCls} w-full`} placeholder="Auto-calculated" />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">Price (incl. GST){popupUnitKey && <span className="text-[10px] text-foreground-muted ml-1">/ {popupUnitKey}</span>}</label>
                            <input type="number" step="0.01" value={d.price} readOnly className={`${lockedCls} w-full`} placeholder="Auto-calculated" />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">Price (Ex. GST){popupUnitKey && <span className="text-[10px] text-foreground-muted ml-1">/ {popupUnitKey}</span>}</label>
                            <input type="number" step="0.01" value={d.price_ex_gst} readOnly className={`${lockedCls} w-full`} placeholder="Auto-calculated" />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">Listed Stock</label>
                            <input type="number" step="1" min="0" placeholder="0" value={d.stock} onChange={(e) => setD('stock', e.target.value)} className={`${inputCls} w-full`} />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">SKU (auto)</label>
                            <input type="text" placeholder="auto" value={d.sku} onChange={(e) => setD('sku', e.target.value)} className={`${inputCls} w-full`} />
                          </div>
                          <div className="col-span-2 sm:col-span-4 flex justify-end mt-1">
                            <button type="button" onClick={() => addSubVariant(variantPopupId)} disabled={!d.name || variantPopupId.startsWith('temp-')} className="field-xs font-medium text-white bg-accent-500 hover:bg-accent-600 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors">+ Add Sub-Variant</button>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>

              {variantPopupId && variantPopupId.startsWith('temp-') && (
                <div className="px-5 pb-4 border-t border-border-default pt-4 mt-0">
                  <p className="text-xs text-foreground-muted italic">Save the product first to configure selling units for this variant.</p>
                </div>
              )}
              {productId && variantPopupId && !variantPopupId.startsWith('temp-') && (
                <div className="px-5 pb-4">
                  <UnitsManager
                    productId={productId}
                    variantId={variantPopupId}
                    basePrice={popupVariant?.price || (popupVariant?.price_ex_gst ? exToIncl(popupVariant.price_ex_gst, gstRate) : null)}
                    onUnitLoaded={(info) => { setPopupUnitKey(info.unitKey); setPopupUnitInfo(info) }}
                  />
                </div>
              )}

              <div className="px-5 py-4 border-t border-border-default flex justify-end">
                <button type="button" onClick={() => setVariantPopupId(null)} className="px-4 py-2 text-sm font-medium bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-colors">Done</button>
              </div>
            </div>
          </div>
        )
      })()}
    </form>
  )
}
