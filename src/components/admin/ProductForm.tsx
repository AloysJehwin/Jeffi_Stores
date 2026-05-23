'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import ImageUpload from './ImageUpload'
import AdminSelect from './AdminSelect'
import Toggle from '@/components/ui/Toggle'

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
  price_ex_gst: string
  wholeprice_ex_gst: string
  stock_quantity: string
  mpn: string
  gtin: string
  pricing_type: 'unit' | 'weight' | 'length'
  unit: string
  numeric_value: string
  weight_rate: string
  weight_unit: string
  weight_rate_on: boolean
  length_rate: string
  length_unit: string
  length_rate_on: boolean
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
  pricing_type: 'unit' | 'weight' | 'length'
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

const WEIGHT_UNITS = ['kg', 'g', 'lb', 'oz']
const LENGTH_UNITS = ['m', 'cm', 'mm', 'ft', 'in']
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

const PRICING_TYPE_LABELS: Record<string, string> = {
  unit: 'By Piece / Unit',
  weight: 'By Weight',
  length: 'By Length',
}

function getUnitOptions(pricing_type: string) {
  if (pricing_type === 'weight') return WEIGHT_UNITS
  if (pricing_type === 'length') return LENGTH_UNITS
  return UNIT_UNITS
}

function getPerUnitLabel(unit: string): string {
  const map: Record<string, string> = {
    kg: '/kg', g: '/100g', lb: '/lb', oz: '/oz',
    m: '/m', cm: '/cm', mm: '/mm', ft: '/ft', in: '/in',
  }
  return map[unit] || `/${unit}`
}

function calcPerUnitRate(price: string, numeric_value: string, unit: string): string | null {
  const p = parseFloat(price)
  const n = parseFloat(numeric_value)
  if (!p || !n || n === 0) return null
  let rate = p / n
  if (unit === 'g') rate = (p / n) * 100
  return `₹${rate.toFixed(2)}${getPerUnitLabel(unit)}`
}

function defaultUnit(pricing_type: string): string {
  if (pricing_type === 'weight') return 'kg'
  if (pricing_type === 'length') return 'm'
  return 'pcs'
}

function emptyVariant(pricing_type: 'unit' | 'weight' | 'length', unit: string): VariantRow {
  return {
    variant_name: '', price: '', mrp: '', price_ex_gst: '', wholeprice_ex_gst: '',
    stock_quantity: '0', mpn: '', gtin: '',
    pricing_type, unit, numeric_value: '',
    weight_rate: '', weight_unit: 'kg', weight_rate_on: false,
    length_rate: '', length_unit: 'm', length_rate_on: false,
    weight_grams: '', package_type: '', length_cm: '', breadth_cm: '', height_cm: '',
    sub_variant_type: '', sub_variant_type_on: false,
    variant_type: '',
    use_own_images: false,
  }
}

function toInclusive(val: string, rate: number, mode: 'inclusive' | 'exclusive'): string {
  const n = parseFloat(val)
  if (!val || isNaN(n)) return val
  if (mode === 'exclusive') return String(Math.round(n * (1 + rate / 100) * 100) / 100)
  return val
}

function toExGst(val: string, rate: number, mode: 'inclusive' | 'exclusive'): string {
  const n = parseFloat(val)
  if (!val || isNaN(n)) return val
  const incl = mode === 'exclusive' ? n * (1 + rate / 100) : n
  return String(Math.round(incl / (1 + rate / 100) * 100) / 100)
}

function inclusivePreview(val: string, rate: number, mode: 'inclusive' | 'exclusive'): string | null {
  if (mode !== 'exclusive') return null
  const n = parseFloat(val)
  if (!val || isNaN(n) || n <= 0) return null
  return `= ₹${(Math.round(n * (1 + rate / 100) * 100) / 100).toFixed(2)} incl. GST`
}

export default function ProductForm({ categories, brands, action, product, productId }: ProductFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [existingImagesToKeep, setExistingImagesToKeep] = useState<any[]>([])
  const [galleryImageIds, setGalleryImageIds] = useState<{ id: string; isPrimary: boolean }[]>([])
  const [imageOrder, setImageOrder] = useState<string[]>([])
  const [tempProductId] = useState<string>(productId || `temp-${Date.now()}`)
  const [hasVariants, setHasVariants] = useState(product?.has_variants ?? false)
  const [variantPopupId, setVariantPopupId] = useState<string | null>(null)
  const [variantImagesMap, setVariantImagesMap] = useState<Record<string, any[]>>({})
  const [variantImageUploading, setVariantImageUploading] = useState<Record<string, boolean>>({})
  const [variantImageError, setVariantImageError] = useState<string | null>(null)
  const [variantGalleryOpen, setVariantGalleryOpen] = useState(false)
  const [variantGalleryImages, setVariantGalleryImages] = useState<any[]>([])
  const [variantGalleryCategories, setVariantGalleryCategories] = useState<any[]>([])
  const [variantGallerySearch, setVariantGallerySearch] = useState('')
  const [variantGalleryCategory, setVariantGalleryCategory] = useState('')
  const [variantGallerySelected, setVariantGallerySelected] = useState<string[]>([])
  const [variantGalleryLoading, setVariantGalleryLoading] = useState(false)
  const [subVariantsMap, setSubVariantsMap] = useState<Record<string, any[]>>({})
  const [subVariantDrafts, setSubVariantDrafts] = useState<Record<string, { name: string; price: string; mrp: string; price_ex_gst: string; mrp_ex_gst: string; wholeprice_ex_gst: string; stock: string; sku: string }>>({})
  const [subVariantEditId, setSubVariantEditId] = useState<string | null>(null)
  const [subVariantEditDraft, setSubVariantEditDraft] = useState<{ name: string; price: string; mrp: string; price_ex_gst: string; mrp_ex_gst: string; wholeprice_ex_gst: string; stock: string; sku: string } | null>(null)
  const [productPackageType, setProductPackageType] = useState<string>(product?.package_type || 'flat_poly_auto')
  const [weightRate, setWeightRate] = useState(product?.weight_rate != null ? String(product.weight_rate) : '')
  const [weightUnit, setWeightUnit] = useState(product?.weight_unit || 'kg')
  const [weightEnabled, setWeightEnabled] = useState(product?.weight_rate != null)
  const [lengthRate, setLengthRate] = useState(product?.length_rate != null ? String(product.length_rate) : '')
  const [lengthUnit, setLengthUnit] = useState(product?.length_unit || 'm')
  const [lengthEnabled, setLengthEnabled] = useState(product?.length_rate != null)
  const gstModeKey = `gstMode:${productId || 'new'}`
  const [gstMode, setGstMode] = useState<'inclusive' | 'exclusive'>(() => {
    if (typeof window === 'undefined') return 'inclusive'
    return (localStorage.getItem(gstModeKey) as 'inclusive' | 'exclusive') || 'inclusive'
  })

  function changeGstMode(mode: 'inclusive' | 'exclusive') {
    localStorage.setItem(gstModeKey, mode)
    setGstMode(mode)
  }
  const [gstRate, setGstRate] = useState<number>(product?.gst_percentage != null ? parseFloat(product.gst_percentage) : 18)

  const [basePrice, setBasePrice] = useState(product?.base_price != null ? String(product.base_price) : '')
  const [costPrice, setCostPrice] = useState(product?.cost_price != null ? String(product.cost_price) : '')
  const [mrp, setMrp] = useState(product?.mrp != null ? String(product.mrp) : '')
  const [salePrice, setSalePrice] = useState(product?.price_ex_gst != null ? String(product.price_ex_gst) : '')
  const [wholesalePrice, setWholesalePrice] = useState(product?.wholeprice_ex_gst != null ? String(product.wholeprice_ex_gst) : '')

  const draftKey = productId ? `draft_product_${productId}` : 'draft_product_new'
  const [isActive, setIsActive] = useState<boolean>(product?.is_active ?? true)
  const [isFeatured, setIsFeatured] = useState<boolean>(product?.is_featured ?? false)
  const [hasDraft, setHasDraft] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [variants, setVariants] = useState<VariantRow[]>(() => {
    if (product?.product_variants && product.product_variants.length > 0) {
      return product.product_variants.map((v: any) => ({
        id: v.id,
        variant_name: v.variant_name,
        price: v.price != null ? String(v.price) : '',
        mrp: v.mrp != null ? String(v.mrp) : '',
        price_ex_gst: v.price_ex_gst != null ? String(v.price_ex_gst) : '',
        wholeprice_ex_gst: v.wholeprice_ex_gst != null ? String(v.wholeprice_ex_gst) : '',
        stock_quantity: String(v.stock_quantity || 0),
        mpn: v.mpn || '',
        gtin: v.gtin || '',
        pricing_type: v.pricing_type || 'unit',
        unit: v.unit || 'pcs',
        numeric_value: v.numeric_value != null ? String(v.numeric_value) : '',
        weight_rate: v.weight_rate != null ? String(v.weight_rate) : '',
        weight_unit: v.weight_unit || 'kg',
        weight_rate_on: v.weight_rate != null,
        length_rate: v.length_rate != null ? String(v.length_rate) : '',
        length_unit: v.length_unit || 'm',
        length_rate_on: v.length_rate != null,
        weight_grams: v.weight_grams != null ? String(v.weight_grams) : '',
        package_type: v.package_type || '',
        length_cm: v.length_cm != null ? String(v.length_cm) : '',
        breadth_cm: v.breadth_cm != null ? String(v.breadth_cm) : '',
        height_cm: v.height_cm != null ? String(v.height_cm) : '',
        sub_variant_type: v.sub_variant_type || '',
        sub_variant_type_on: !!v.sub_variant_type,
        variant_type: v.variant_type || '',
        use_own_images: !!(v.variant_images && v.variant_images.length > 0),
      }))
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

  useEffect(() => {
    const saved = localStorage.getItem(draftKey)
    if (saved) setHasDraft(true)
  }, [draftKey])

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
        basePrice, mrp, salePrice, wholesalePrice,
        weightRate, weightUnit, weightEnabled,
        lengthRate, lengthUnit, lengthEnabled,
        gstRate, gstMode, isActive,
      }
      localStorage.setItem(draftKey, JSON.stringify(snapshot))
      setHasDraft(true)
    }, 1000)
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }
  }, [
    hasVariants, variants, groups,
    basePrice, mrp, salePrice, wholesalePrice,
    weightRate, weightUnit, weightEnabled,
    lengthRate, lengthUnit, lengthEnabled,
    gstRate, gstMode, isActive, draftKey,
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
      if (snap.salePrice !== undefined) setSalePrice(snap.salePrice)
      if (snap.wholesalePrice !== undefined) setWholesalePrice(snap.wholesalePrice)
      if (snap.weightRate !== undefined) setWeightRate(snap.weightRate)
      if (snap.weightUnit !== undefined) setWeightUnit(snap.weightUnit)
      if (snap.weightEnabled !== undefined) setWeightEnabled(snap.weightEnabled)
      if (snap.lengthRate !== undefined) setLengthRate(snap.lengthRate)
      if (snap.lengthUnit !== undefined) setLengthUnit(snap.lengthUnit)
      if (snap.lengthEnabled !== undefined) setLengthEnabled(snap.lengthEnabled)
      if (snap.gstRate !== undefined) setGstRate(snap.gstRate)
      if (snap.gstMode !== undefined) setGstMode(snap.gstMode)
      if (snap.isActive !== undefined) setIsActive(snap.isActive)
    } catch {}
  }

  function discardDraft() {
    localStorage.removeItem(draftKey)
    setHasDraft(false)
    window.location.reload()
  }

  function addGroup(pricing_type: 'unit' | 'weight' | 'length') {
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

  function updateGroupUnit(pricing_type: string, unit: string) {
    setGroups(groups.map(g => g.pricing_type === pricing_type ? { ...g, unit } : g))
    setVariants(variants.map(v =>
      v.pricing_type === pricing_type && !v._isDeleted ? { ...v, unit, variant_name: buildVariantName(v.numeric_value, unit, pricing_type) } : v
    ))
  }

  function updateGroupVariantType(pricing_type: string, variant_type: string) {
    setGroups(groups.map(g => g.pricing_type === pricing_type ? { ...g, variant_type } : g))
  }

  function buildVariantName(numeric_value: string, unit: string, pricing_type: string): string {
    if (pricing_type === 'unit') return ''
    if (!numeric_value) return ''
    return `${numeric_value}${unit}`
  }

  function addVariantToGroup(pricing_type: 'unit' | 'weight' | 'length', unit: string) {
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

  function toggleVariantRate(index: number, rateType: 'weight' | 'length') {
    const updated = [...variants]
    const row = { ...updated[index] }
    const onField = rateType === 'weight' ? 'weight_rate_on' : 'length_rate_on'
    const rateField = rateType === 'weight' ? 'weight_rate' : 'length_rate'
    const turningOff = row[onField]
    row[onField] = !turningOff
    if (turningOff) row[rateField] = ''
    updated[index] = row
    setVariants(updated)
  }

  async function openVariantPopup(variantId: string) {
    setVariantPopupId(variantId)
    setVariantImageError(null)
    if (productId) {
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
          if (loaded.length > 0) {
            setVariants(prev => prev.map(v => v.id === variantId ? { ...v, sub_variant_type_on: true } : v))
          }
        } else {
          setSubVariantsMap(m => ({ ...m, [variantId]: [] }))
        }
      }
    }
  }

  async function uploadVariantImageFile(variantId: string, file: File) {
    if (!productId) return
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
    await fetch(`/api/admin/products/${productId}/variants/${variantId}/images`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId }),
    })
    setVariantImagesMap(m => ({ ...m, [variantId]: (m[variantId] || []).filter((img: any) => img.id !== imageId) }))
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
    for (const galleryImageId of toAdd) {
      const res = await fetch(`/api/admin/products/${productId}/variants/${variantPopupId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gallery_image_id: galleryImageId }),
      })
      if (res.ok) {
        const data = await res.json()
        setVariantImagesMap(m => ({ ...m, [variantPopupId]: [...(m[variantPopupId] || []), data.image] }))
      } else {
        const err = await res.json().catch(() => ({}))
        setVariantImageError(err.error || `Failed to add image (${res.status})`)
        break
      }
    }
  }

  async function addSubVariant(variantId: string) {
    if (!productId) return
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
        wholeprice_ex_gst: draft.wholeprice_ex_gst ? parseFloat(draft.wholeprice_ex_gst) : null,
        stock_quantity: draft.stock ? parseInt(draft.stock) : 0,
        sku: draft.sku || undefined,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      setSubVariantsMap(m => ({ ...m, [variantId]: [...(m[variantId] || []), data.sub_variant] }))
      setSubVariantDrafts(m => ({ ...m, [variantId]: { name: '', price: '', mrp: '', price_ex_gst: '', mrp_ex_gst: '', wholeprice_ex_gst: '', stock: '', sku: '' } }))
    }
  }

  async function deleteSubVariant(variantId: string, subId: string) {
    if (!productId) return
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
      formData.set('weight_rate', weightEnabled ? weightRate : '')
      formData.set('weight_unit', weightEnabled ? weightUnit : '')
      formData.set('length_rate', lengthEnabled ? lengthRate : '')
      formData.set('length_unit', lengthEnabled ? lengthUnit : '')

      if (!hasVariants) {
        formData.set('base_price', toInclusive(basePrice, gstRate, gstMode))
        formData.set('mrp', toInclusive(mrp, gstRate, gstMode))
        formData.set('price_ex_gst', toExGst(salePrice, gstRate, gstMode))
        formData.set('wholeprice_ex_gst', toExGst(wholesalePrice, gstRate, gstMode))
      } else {
        formData.set('mrp', toInclusive(mrp, gstRate, gstMode))
        formData.set('price_ex_gst', toExGst(salePrice, gstRate, gstMode))
        formData.set('wholeprice_ex_gst', toExGst(wholesalePrice, gstRate, gstMode))
      }
      formData.set('cost_price', costPrice || '0')

      if (hasVariants) {
        const convertedVariants = variants.map(v => {
          const grp = groups.find(g => g.pricing_type === v.pricing_type)
          return {
            ...v,
            variant_type: grp?.variant_type || v.variant_type || '',
            price: toInclusive(v.price, gstRate, gstMode),
            mrp: toInclusive(v.mrp, gstRate, gstMode),
            price_ex_gst: toExGst(v.price_ex_gst || v.price, gstRate, gstMode),
            wholeprice_ex_gst: toExGst(v.wholeprice_ex_gst, gstRate, gstMode),
            weight_rate: v.weight_rate_on ? toInclusive(v.weight_rate, gstRate, gstMode) : v.weight_rate,
            length_rate: v.length_rate_on ? toInclusive(v.length_rate, gstRate, gstMode) : v.length_rate,
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

  const inputCls = 'w-full px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm'

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
              defaultValue={product?.name}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Enter product name"
            />
          </div>

          {product?.sku && (
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-2">
                SKU
              </label>
              <div className="w-full px-4 py-2 border border-border-default rounded-lg bg-surface text-foreground-secondary font-mono text-sm uppercase">
                {product.sku.toUpperCase()}
              </div>
              <p className="text-xs text-foreground-muted mt-1">Auto-generated, cannot be changed</p>
            </div>
          )}

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
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
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
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
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
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
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
            defaultValue={product?.category_id}
            placeholder="Select a category"
            options={mainCategories.flatMap(cat => [
              { value: cat.id, label: cat.name, group: cat.name },
              ...getSubcategories(cat.id).map(sub => ({
                value: sub.id,
                label: sub.name,
                group: cat.name,
                indent: true,
              })),
            ])}
          />

          {/* Brand */}
          <AdminSelect
            id="brand_id"
            name="brand_id"
            label="Brand"
            defaultValue={product?.brand_id || ''}
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
          <div>
            <label htmlFor="mrp" className="block text-sm font-medium text-foreground-secondary mb-2">
              MRP (Rs.) {gstMode === 'exclusive' ? '(excl. GST)' : ''}
            </label>
            <input
              type="number"
              id="mrp"
              name="mrp"
              step="0.01"
              min="0"
              value={mrp}
              onChange={e => setMrp(e.target.value)}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Maximum Retail Price"
            />
            {inclusivePreview(mrp, gstRate, gstMode) && (
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{inclusivePreview(mrp, gstRate, gstMode)}</p>
            )}
          </div>
          )}

          {/* Selling Price — hidden when has variants */}
          {!hasVariants && (
            <div>
              <label htmlFor="base_price" className="block text-sm font-medium text-foreground-secondary mb-2">
                Selling Price (Rs.) * {gstMode === 'exclusive' ? '(excl. GST)' : '(incl. GST)'}
              </label>
              <input
                type="number"
                id="base_price"
                name="base_price"
                required={!hasVariants}
                step="0.01"
                min="0"
                value={basePrice}
                onChange={e => setBasePrice(e.target.value)}
                className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                placeholder={gstMode === 'exclusive' ? 'Price excl. GST' : 'Price incl. GST'}
              />
              {inclusivePreview(basePrice, gstRate, gstMode)
                ? <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{inclusivePreview(basePrice, gstRate, gstMode)}</p>
                : <p className="text-xs text-foreground-muted mt-1">GST-inclusive price the customer pays</p>
              }
            </div>
          )}

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
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
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
              <div className="pb-0.5">
                <p className="text-xs font-medium text-foreground-secondary mb-1.5">Price entry mode</p>
                <div className="flex rounded-lg border border-border-secondary overflow-hidden text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => changeGstMode('inclusive')}
                    className={`px-3 py-1.5 transition-colors ${gstMode === 'inclusive' ? 'bg-accent-500 text-white' : 'bg-surface text-foreground-secondary hover:bg-surface-elevated'}`}
                  >
                    GST Inclusive
                  </button>
                  <button
                    type="button"
                    onClick={() => changeGstMode('exclusive')}
                    className={`px-3 py-1.5 transition-colors ${gstMode === 'exclusive' ? 'bg-accent-500 text-white' : 'bg-surface text-foreground-secondary hover:bg-surface-elevated'}`}
                  >
                    GST Exclusive
                  </button>
                </div>
              </div>
            </div>
            {gstMode === 'exclusive' && gstRate > 0 && (
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1.5">
                Prices will be converted to inclusive before saving (×{(1 + gstRate / 100).toFixed(2)})
              </p>
            )}
          </div>

          {/* Ex-GST Price — hidden when has variants */}
          {!hasVariants && (
          <div>
            <label htmlFor="price_ex_gst" className="block text-sm font-medium text-foreground-secondary mb-2">
              Ex-GST Price (Rs.) {gstMode === 'exclusive' ? '(excl. GST)' : ''}
            </label>
            <input
              type="number"
              id="price_ex_gst"
              name="price_ex_gst"
              step="0.01"
              min="0"
              value={salePrice}
              onChange={e => setSalePrice(e.target.value)}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Price excluding GST (optional)"
            />
            {inclusivePreview(salePrice, gstRate, gstMode) && (
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{inclusivePreview(salePrice, gstRate, gstMode)}</p>
            )}
          </div>
          )}

          {/* Wholesale Price — hidden when has variants */}
          {!hasVariants && (
          <div>
            <label htmlFor="wholeprice_ex_gst" className="block text-sm font-medium text-foreground-secondary mb-2">
              Wholesale Price (Rs.) {gstMode === 'exclusive' ? '(excl. GST)' : ''}
            </label>
            <input
              type="number"
              id="wholeprice_ex_gst"
              name="wholeprice_ex_gst"
              step="0.01"
              min="0"
              value={wholesalePrice}
              onChange={e => setWholesalePrice(e.target.value)}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Bulk price (optional)"
            />
            {inclusivePreview(wholesalePrice, gstRate, gstMode) && (
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{inclusivePreview(wholesalePrice, gstRate, gstMode)}</p>
            )}
          </div>
          )}

          {/* Stock & Low Stock — hidden when has variants */}
          {!hasVariants && (
            <>
              <div>
                <label htmlFor="stock_quantity" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Stock Quantity *
                </label>
                <input
                  type="number"
                  id="stock_quantity"
                  name="stock_quantity"
                  required={!hasVariants}
                  min="0"
                  defaultValue={product?.stock_quantity || 0}
                  className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                  placeholder="0"
                />
              </div>

              <div>
                <label htmlFor="low_stock_threshold" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Low Stock Threshold *
                </label>
                <input
                  type="number"
                  id="low_stock_threshold"
                  name="low_stock_threshold"
                  required={!hasVariants}
                  min="0"
                  defaultValue={product?.low_stock_threshold || 10}
                  className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                  placeholder="10"
                />
              </div>
            </>
          )}

          {/* Custom Quantity Selling — only for non-variant products */}
          {!hasVariants && (
          <div className="md:col-span-2 border border-border-default rounded-lg p-4 bg-surface-secondary">
            <h3 className="text-sm font-semibold text-foreground mb-1">Custom Quantity Selling</h3>
            <p className="text-xs text-foreground-muted mb-4">Enable if customers can buy any amount (e.g. 2.5 kg). Leave blank to disable a mode.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => { setWeightEnabled(!weightEnabled); if (weightEnabled) setWeightRate('') }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${weightEnabled ? 'bg-accent-500' : 'bg-border-secondary'}`}
                    role="switch"
                    aria-checked={weightEnabled}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${weightEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <label className="text-xs font-medium text-foreground-secondary">Rate per {weightUnit} / weight unit (Rs.)</label>
                </div>
                {weightEnabled && (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={weightRate}
                        onChange={e => setWeightRate(e.target.value)}
                        className="flex-1 px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                        placeholder="e.g. 200"
                      />
                      <AdminSelect
                        value={weightUnit}
                        onChange={setWeightUnit}
                        options={['kg', 'g', 'lb', 'oz'].map(u => ({ value: u, label: u }))}
                        className="w-24"
                      />
                    </div>
                    {weightRate && <p className="text-xs text-accent-600 dark:text-accent-400 mt-1">₹{weightRate}/{weightUnit}</p>}
                  </>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => { setLengthEnabled(!lengthEnabled); if (lengthEnabled) setLengthRate('') }}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${lengthEnabled ? 'bg-accent-500' : 'bg-border-secondary'}`}
                    role="switch"
                    aria-checked={lengthEnabled}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${lengthEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <label className="text-xs font-medium text-foreground-secondary">Rate per {lengthUnit} / length unit (Rs.)</label>
                </div>
                {lengthEnabled && (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={lengthRate}
                        onChange={e => setLengthRate(e.target.value)}
                        className="flex-1 px-3 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm"
                        placeholder="e.g. 50"
                      />
                      <AdminSelect
                        value={lengthUnit}
                        onChange={setLengthUnit}
                        options={['m', 'cm', 'mm', 'ft', 'in'].map(u => ({ value: u, label: u }))}
                        className="w-24"
                      />
                    </div>
                    {lengthRate && <p className="text-xs text-accent-600 dark:text-accent-400 mt-1">₹{lengthRate}/{lengthUnit}</p>}
                  </>
                )}
              </div>
            </div>
          </div>
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
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
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
                  <input type="number" id="length_cm" name="length_cm" step="0.1" min="0" defaultValue={product?.length_cm ?? ''} className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="L" />
                  <p className="text-xs text-foreground-muted mt-1 text-center">Length</p>
                </div>
                <div>
                  <input type="number" id="breadth_cm" name="breadth_cm" step="0.1" min="0" defaultValue={product?.breadth_cm ?? ''} className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="B" />
                  <p className="text-xs text-foreground-muted mt-1 text-center">Breadth</p>
                </div>
                <div>
                  <input type="number" id="height_cm" name="height_cm" step="0.1" min="0" defaultValue={product?.height_cm ?? ''} className="w-full px-3 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="H" />
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
            <textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={product?.description}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Enter product description"
            />
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
                  const unitOptions = getUnitOptions(group.pricing_type)
                  const isWeightOrLength = group.pricing_type !== 'unit'

                  return (
                    <div key={group.pricing_type} className="border border-border-default rounded-lg overflow-hidden">
                      {/* Group header */}
                      <div className="flex items-center justify-between px-4 py-3 bg-surface-secondary border-b border-border-default">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-foreground">
                            {PRICING_TYPE_LABELS[group.pricing_type]}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-foreground-muted">Unit:</span>
                            <div className="flex items-center border border-border-secondary rounded-lg overflow-hidden bg-surface">
                              <button
                                type="button"
                                onClick={() => {
                                  const idx = unitOptions.indexOf(group.unit)
                                  updateGroupUnit(group.pricing_type, unitOptions[(idx - 1 + unitOptions.length) % unitOptions.length])
                                }}
                                className="px-2 py-1.5 text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors text-sm leading-none"
                              >‹</button>
                              <span className="px-2 py-1.5 text-sm font-medium text-foreground min-w-[2.5rem] text-center border-x border-border-secondary">
                                {group.unit}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  const idx = unitOptions.indexOf(group.unit)
                                  updateGroupUnit(group.pricing_type, unitOptions[(idx + 1) % unitOptions.length])
                                }}
                                className="px-2 py-1.5 text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors text-sm leading-none"
                              >›</button>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-foreground-muted">Label:</span>
                            <input
                              type="text"
                              value={group.variant_type}
                              onChange={(e) => updateGroupVariantType(group.pricing_type, e.target.value)}
                              className="px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-1 focus:ring-accent-500 focus:border-transparent w-28"
                              placeholder="e.g. Size, Pack"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Mobile cards */}
                      <div className="md:hidden p-3 space-y-3">
                        {groupVariants.map((variant) => {
                          const index = variants.indexOf(variant)
                          const perUnit = isWeightOrLength ? calcPerUnitRate(variant.price, variant.numeric_value, group.unit) : null
                          return (
                            <div key={variant.id || index} className="border border-border-default rounded-lg p-3 space-y-3 bg-surface">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-foreground-muted uppercase">
                                  {isWeightOrLength ? `${group.pricing_type === 'weight' ? 'Weight' : 'Length'} Variant` : 'Variant'}
                                </span>
                                {groupVariants.length > 1 && (
                                  <button type="button" onClick={() => removeVariant(index)} className="text-red-500 hover:text-red-700 text-xs font-medium">
                                    Remove
                                  </button>
                                )}
                              </div>

                              {isWeightOrLength ? (
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-foreground-secondary mb-1">
                                      Value ({group.unit}) *
                                    </label>
                                    <input
                                      type="number"
                                      step="any"
                                      min="0"
                                      value={variant.numeric_value}
                                      onChange={(e) => updateVariant(index, 'numeric_value', e.target.value)}
                                      className={inputCls}
                                      placeholder="e.g. 500"
                                      required
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-foreground-secondary mb-1">Variant Name</label>
                                    <input
                                      type="text"
                                      value={variant.variant_name}
                                      readOnly
                                      className={`${inputCls} bg-surface-secondary cursor-default`}
                                      placeholder="Auto-filled"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <>
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
</>
                              )}

                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Selling Price {gstMode === 'exclusive' ? '(excl. GST) *' : '*'}</label>
                                  <input type="number" step="0.01" min="0" value={variant.price} onChange={(e) => updateVariant(index, 'price', e.target.value)} className={inputCls} placeholder="0.00" required />
                                  {perUnit && <p className="text-xs text-accent-600 dark:text-accent-400 mt-0.5">{perUnit}</p>}
                                  {inclusivePreview(variant.price, gstRate, gstMode) && <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">{inclusivePreview(variant.price, gstRate, gstMode)}</p>}
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">MRP {gstMode === 'exclusive' ? '(excl.)' : ''}</label>
                                  <input type="number" step="0.01" min="0" value={variant.mrp} onChange={(e) => updateVariant(index, 'mrp', e.target.value)} className={inputCls} placeholder="0.00" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Ex-GST Price</label>
                                  <input type="number" step="0.01" min="0" value={variant.price_ex_gst} onChange={(e) => updateVariant(index, 'price_ex_gst', e.target.value)} className={inputCls} placeholder="0.00" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Wholesale</label>
                                  <input type="number" step="0.01" min="0" value={variant.wholeprice_ex_gst} onChange={(e) => updateVariant(index, 'wholeprice_ex_gst', e.target.value)} className={inputCls} placeholder="0.00" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">Stock *</label>
                                  <input type="number" min="0" value={variant.stock_quantity} onChange={(e) => updateVariant(index, 'stock_quantity', e.target.value)} className={inputCls} placeholder="0" required />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-foreground-secondary mb-1">MPN</label>
                                  <input type="text" value={variant.mpn} onChange={(e) => updateVariant(index, 'mpn', e.target.value)} className={inputCls} placeholder="Part No." />
                                </div>
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
                                    onClick={() => toggleVariantRate(index, 'weight')}
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${variant.weight_rate_on ? 'bg-accent-500' : 'bg-border-secondary'}`}
                                    role="switch"
                                    aria-checked={variant.weight_rate_on}
                                  >
                                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${variant.weight_rate_on ? 'translate-x-4' : 'translate-x-0'}`} />
                                  </button>
                                  <span className="text-xs font-medium text-foreground-secondary">Also sell by weight</span>
                                </div>
                                {variant.weight_rate_on && (
                                  <div className="flex items-center gap-2 pl-11">
                                    <span className="text-xs text-foreground-muted">Rate (Rs.)</span>
                                    <input type="number" step="0.01" min="0" value={variant.weight_rate} onChange={(e) => updateVariant(index, 'weight_rate', e.target.value)} className="w-24 px-2 py-1 border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent text-xs" placeholder="e.g. 200" required />
                                    <span className="text-xs text-foreground-muted">per</span>
                                    <AdminSelect value={variant.weight_unit} onChange={(val) => updateVariant(index, 'weight_unit', val)} options={['kg','g','lb','oz'].map(u => ({ value: u, label: u }))} className="w-20" compact />
                                    {variant.weight_rate && <span className="text-xs text-accent-600 dark:text-accent-400">₹{variant.weight_rate}/{variant.weight_unit}</span>}
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleVariantRate(index, 'length')}
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${variant.length_rate_on ? 'bg-accent-500' : 'bg-border-secondary'}`}
                                    role="switch"
                                    aria-checked={variant.length_rate_on}
                                  >
                                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${variant.length_rate_on ? 'translate-x-4' : 'translate-x-0'}`} />
                                  </button>
                                  <span className="text-xs font-medium text-foreground-secondary">Also sell by length</span>
                                </div>
                                {variant.length_rate_on && (
                                  <div className="flex items-center gap-2 pl-11">
                                    <span className="text-xs text-foreground-muted">Rate (Rs.)</span>
                                    <input type="number" step="0.01" min="0" value={variant.length_rate} onChange={(e) => updateVariant(index, 'length_rate', e.target.value)} className="w-24 px-2 py-1 border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent text-xs" placeholder="e.g. 50" required />
                                    <span className="text-xs text-foreground-muted">per</span>
                                    <AdminSelect value={variant.length_unit} onChange={(val) => updateVariant(index, 'length_unit', val)} options={['m','cm','mm','ft','in'].map(u => ({ value: u, label: u }))} className="w-20" compact />
                                    {variant.length_rate && <span className="text-xs text-accent-600 dark:text-accent-400">₹{variant.length_rate}/{variant.length_unit}</span>}
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = [...variants]
                                      const row = { ...updated[index] }
                                      row.sub_variant_type_on = !row.sub_variant_type_on
                                      if (!row.sub_variant_type_on) row.sub_variant_type = ''
                                      if (row.sub_variant_type_on) row.use_own_images = true
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
                                      className="w-32 px-2 py-1 border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent text-xs"
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
                              {isWeightOrLength && <th className="text-left py-2 px-3 font-medium text-foreground-secondary whitespace-nowrap text-xs">Value ({group.unit}) *</th>}
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary text-xs">Name *</th>
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary whitespace-nowrap text-xs">Price (incl. GST) *</th>
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary whitespace-nowrap text-xs">Ex-GST</th>
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary whitespace-nowrap text-xs">Wholesale</th>
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary text-xs">MRP</th>
                              <th className="text-left py-2 px-3 font-medium text-foreground-secondary text-xs">Stock *</th>
                              <th className="py-2 px-3 w-16"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupVariants.map((variant) => {
                              const index = variants.indexOf(variant)
                              const perUnit = isWeightOrLength ? calcPerUnitRate(variant.price, variant.numeric_value, group.unit) : null
                              const isExpanded = false
                              return (
                                <>
                                <tr key={variant.id || index} className={`border-b border-border-default ${isExpanded ? 'bg-surface-secondary' : 'hover:bg-surface-secondary/40'}`}>
                                  {isWeightOrLength && (
                                    <td className="py-2 px-3">
                                      <input type="number" step="any" min="0" value={variant.numeric_value} onChange={(e) => updateVariant(index, 'numeric_value', e.target.value)} className="w-24 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="e.g. 500" required />
                                    </td>
                                  )}
                                  <td className="py-2 px-3">
                                    {isWeightOrLength ? (
                                      <input type="text" value={variant.variant_name} readOnly className="w-24 px-2 py-1.5 border border-border-default rounded-lg bg-surface-secondary text-foreground-muted text-sm cursor-default" placeholder="Auto" />
                                    ) : (
                                      <input type="text" value={variant.variant_name} onChange={(e) => updateVariant(index, 'variant_name', e.target.value)} className="w-32 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="e.g. M8, Red" required />
                                    )}
                                  </td>
                                  <td className="py-2 px-3">
                                    <div>
                                      <input type="number" step="0.01" min="0" value={variant.price} onChange={(e) => updateVariant(index, 'price', e.target.value)} className="w-28 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0.00" required />
                                      {perUnit && <p className="text-xs text-accent-600 dark:text-accent-400 mt-0.5">{perUnit}</p>}
                                    </div>
                                  </td>
                                  <td className="py-2 px-3">
                                    <input type="number" step="0.01" min="0" value={variant.price_ex_gst} onChange={(e) => updateVariant(index, 'price_ex_gst', e.target.value)} className="w-28 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0.00" />
                                  </td>
                                  <td className="py-2 px-3">
                                    <input type="number" step="0.01" min="0" value={variant.wholeprice_ex_gst} onChange={(e) => updateVariant(index, 'wholeprice_ex_gst', e.target.value)} className="w-28 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0.00" />
                                  </td>
                                  <td className="py-2 px-3">
                                    <input type="number" step="0.01" min="0" value={variant.mrp} onChange={(e) => updateVariant(index, 'mrp', e.target.value)} className="w-28 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0.00" />
                                  </td>
                                  <td className="py-2 px-3">
                                    <input type="number" min="0" value={variant.stock_quantity} onChange={(e) => updateVariant(index, 'stock_quantity', e.target.value)} className="w-20 px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent text-sm" placeholder="0" required />
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
                                </>
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
                          + Add {PRICING_TYPE_LABELS[group.pricing_type]} Variant
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

      {/* Form Actions */}
      <div className="px-4 sm:px-6 py-4 bg-surface-secondary border-t border-border-default flex flex-col sm:flex-row justify-end gap-3 sm:gap-4">
        <Link
          href="/admin/products"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setVariantPopupId(null)}>
            <div className="bg-surface rounded-xl border border-border-default shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
                  <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-3">Pricing & Identifiers</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Price (incl. GST)</label>
                      <input type="number" step="0.01" min="0" value={popupVariant.price} onChange={(e) => {
                        const v = e.target.value
                        const n = parseFloat(v)
                        updateVariant(popupIndex, 'price', v)
                        if (!isNaN(n) && n > 0 && gstRate > 0) updateVariant(popupIndex, 'price_ex_gst', String(Math.round(n / (1 + gstRate / 100) * 100) / 100))
                      }} className="w-full px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="0.00" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Ex-GST Price</label>
                      <input type="number" step="0.01" min="0" value={popupVariant.price_ex_gst} onChange={(e) => {
                        const v = e.target.value
                        const n = parseFloat(v)
                        updateVariant(popupIndex, 'price_ex_gst', v)
                        if (!isNaN(n) && n > 0 && gstRate > 0) updateVariant(popupIndex, 'price', String(Math.round(n * (1 + gstRate / 100) * 100) / 100))
                      }} className="w-full px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="0.00" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">MRP (incl. GST)</label>
                      <input type="number" step="0.01" min="0" value={popupVariant.mrp} onChange={(e) => {
                        const v = e.target.value
                        const n = parseFloat(v)
                        updateVariant(popupIndex, 'mrp', v)
                      }} className="w-full px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="0.00" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Wholesale</label>
                      <input type="number" step="0.01" min="0" value={popupVariant.wholeprice_ex_gst} onChange={(e) => updateVariant(popupIndex, 'wholeprice_ex_gst', e.target.value)} className="w-full px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="0.00" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">MPN</label>
                      <input type="text" value={popupVariant.mpn} onChange={(e) => updateVariant(popupIndex, 'mpn', e.target.value)} className="w-full px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="Part No." />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">GTIN / Barcode</label>
                      <input type="text" value={popupVariant.gtin} onChange={(e) => updateVariant(popupIndex, 'gtin', e.target.value)} className="w-full px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="Barcode" />
                    </div>
                  </div>
                  {/* Rate toggles */}
                  <div className="space-y-2 pt-3">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => toggleVariantRate(popupIndex, 'weight')} className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${popupVariant.weight_rate_on ? 'bg-accent-500' : 'bg-border-secondary'}`} role="switch" aria-checked={popupVariant.weight_rate_on}>
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${popupVariant.weight_rate_on ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                      <span className="text-xs font-medium text-foreground-secondary">Also sell by weight</span>
                    </div>
                    {popupVariant.weight_rate_on && (
                      <div className="flex items-center gap-2 pl-11">
                        <span className="text-xs text-foreground-muted">Rate (₹)</span>
                        <input type="number" step="0.01" min="0" value={popupVariant.weight_rate} onChange={(e) => updateVariant(popupIndex, 'weight_rate', e.target.value)} className="w-24 px-2 py-1 border border-border-secondary rounded-lg bg-surface text-foreground text-xs focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="e.g. 200" />
                        <span className="text-xs text-foreground-muted">per</span>
                        <div className="flex items-center border border-border-secondary rounded-lg overflow-hidden bg-surface">
                          <button type="button" onClick={() => { const idx = WEIGHT_UNITS.indexOf(popupVariant.weight_unit || 'kg'); updateVariant(popupIndex, 'weight_unit', WEIGHT_UNITS[(idx - 1 + WEIGHT_UNITS.length) % WEIGHT_UNITS.length]) }} className="px-1.5 py-1 text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors text-sm leading-none">‹</button>
                          <span className="px-1.5 py-1 text-xs font-medium text-foreground min-w-[2rem] text-center border-x border-border-secondary">{popupVariant.weight_unit || 'kg'}</span>
                          <button type="button" onClick={() => { const idx = WEIGHT_UNITS.indexOf(popupVariant.weight_unit || 'kg'); updateVariant(popupIndex, 'weight_unit', WEIGHT_UNITS[(idx + 1) % WEIGHT_UNITS.length]) }} className="px-1.5 py-1 text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors text-sm leading-none">›</button>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => toggleVariantRate(popupIndex, 'length')} className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${popupVariant.length_rate_on ? 'bg-accent-500' : 'bg-border-secondary'}`} role="switch" aria-checked={popupVariant.length_rate_on}>
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${popupVariant.length_rate_on ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                      <span className="text-xs font-medium text-foreground-secondary">Also sell by length</span>
                    </div>
                    {popupVariant.length_rate_on && (
                      <div className="flex items-center gap-2 pl-11">
                        <span className="text-xs text-foreground-muted">Rate (₹)</span>
                        <input type="number" step="0.01" min="0" value={popupVariant.length_rate} onChange={(e) => updateVariant(popupIndex, 'length_rate', e.target.value)} className="w-24 px-2 py-1 border border-border-secondary rounded-lg bg-surface text-foreground text-xs focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="e.g. 50" />
                        <span className="text-xs text-foreground-muted">per</span>
                        <div className="flex items-center border border-border-secondary rounded-lg overflow-hidden bg-surface">
                          <button type="button" onClick={() => { const idx = LENGTH_UNITS.indexOf(popupVariant.length_unit || 'm'); updateVariant(popupIndex, 'length_unit', LENGTH_UNITS[(idx - 1 + LENGTH_UNITS.length) % LENGTH_UNITS.length]) }} className="px-1.5 py-1 text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors text-sm leading-none">‹</button>
                          <span className="px-1.5 py-1 text-xs font-medium text-foreground min-w-[2rem] text-center border-x border-border-secondary">{popupVariant.length_unit || 'm'}</span>
                          <button type="button" onClick={() => { const idx = LENGTH_UNITS.indexOf(popupVariant.length_unit || 'm'); updateVariant(popupIndex, 'length_unit', LENGTH_UNITS[(idx + 1) % LENGTH_UNITS.length]) }} className="px-1.5 py-1 text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors text-sm leading-none">›</button>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => { const updated = [...variants]; const row = { ...updated[popupIndex] }; row.sub_variant_type_on = !row.sub_variant_type_on; if (!row.sub_variant_type_on) row.sub_variant_type = ''; if (row.sub_variant_type_on) row.use_own_images = true; updated[popupIndex] = row; setVariants(updated) }} className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${popupVariant.sub_variant_type_on ? 'bg-accent-500' : 'bg-border-secondary'}`} role="switch" aria-checked={popupVariant.sub_variant_type_on}>
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${popupVariant.sub_variant_type_on ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                      <span className="text-xs font-medium text-foreground-secondary">Has sub-variants</span>
                    </div>
                    {popupVariant.sub_variant_type_on && (
                      <div className="flex items-center gap-2 pl-11">
                        <span className="text-xs text-foreground-muted">Label</span>
                        <input type="text" value={popupVariant.sub_variant_type} onChange={(e) => updateVariant(popupIndex, 'sub_variant_type', e.target.value)} className="w-40 px-2 py-1 border border-border-secondary rounded-lg bg-surface text-foreground text-xs focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="e.g. Colour, Finish" />
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
                      <input type="number" step="1" min="0" value={popupVariant.weight_grams} onChange={(e) => updateVariant(popupIndex, 'weight_grams', e.target.value)} className="w-full px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="e.g. 500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Package Type</label>
                      <div className="w-full flex items-center border border-border-secondary rounded-lg overflow-hidden bg-surface">
                        <button type="button" onClick={() => { const idx = PACKAGE_TYPES.indexOf(popupVariant.package_type || 'flat_poly_auto'); updateVariant(popupIndex, 'package_type', PACKAGE_TYPES[(idx - 1 + PACKAGE_TYPES.length) % PACKAGE_TYPES.length]) }} className="px-1.5 py-1.5 text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors text-sm leading-none">‹</button>
                        <span className="px-1.5 py-1.5 text-xs font-medium text-foreground flex-1 text-center border-x border-border-secondary truncate">{PACKAGE_TYPE_LABELS[popupVariant.package_type || 'flat_poly_auto']}</span>
                        <button type="button" onClick={() => { const idx = PACKAGE_TYPES.indexOf(popupVariant.package_type || 'flat_poly_auto'); updateVariant(popupIndex, 'package_type', PACKAGE_TYPES[(idx + 1) % PACKAGE_TYPES.length]) }} className="px-1.5 py-1.5 text-foreground-secondary hover:bg-surface-secondary hover:text-foreground transition-colors text-sm leading-none">›</button>
                      </div>
                    </div>
                  </div>
                  {['drill_bit_tube','drill_bit_set_case','corrugated_box','long_tube'].includes(popupVariant.package_type || 'flat_poly_auto') && (
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Dimensions (L × B × H cm)</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        <input type="number" step="0.1" min="0" value={popupVariant.length_cm} onChange={(e) => updateVariant(popupIndex, 'length_cm', e.target.value)} className="px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="L" />
                        <input type="number" step="0.1" min="0" value={popupVariant.breadth_cm} onChange={(e) => updateVariant(popupIndex, 'breadth_cm', e.target.value)} className="px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="B" />
                        <input type="number" step="0.1" min="0" value={popupVariant.height_cm} onChange={(e) => updateVariant(popupIndex, 'height_cm', e.target.value)} className="px-2 py-1.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent" placeholder="H" />
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
                      <div className="flex flex-wrap gap-2">
                        {(variantImagesMap[variantPopupId] || []).map((img: any) => (
                          <div key={img.id} className="relative group w-16 h-16 rounded border border-border-default overflow-hidden bg-surface">
                            <img src={img.thumbnail_url || img.image_url} alt="" className="w-full h-full object-cover" />
                            {img.is_primary && <span className="absolute top-0 left-0 text-[9px] bg-accent-500 text-white px-1 leading-4">★</span>}
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                              {!img.is_primary && <button type="button" onClick={() => setVariantImagePrimary(variantPopupId, img.id)} className="text-yellow-300 hover:text-yellow-100 text-xs leading-none" title="Set primary">★</button>}
                              <button type="button" onClick={() => deleteVariantImage(variantPopupId, img.id)} className="text-red-300 hover:text-red-100 text-xs leading-none" title="Delete">✕</button>
                            </div>
                          </div>
                        ))}
                        {(variantImagesMap[variantPopupId] || []).length < 5 && (
                          <label className={`w-16 h-16 rounded border-2 border-dashed border-border-secondary flex items-center justify-center cursor-pointer hover:border-accent-400 transition-colors ${variantImageUploading[variantPopupId] ? 'opacity-50 pointer-events-none' : ''}`}>
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
                          className="flex-1 px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
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
                          disabled={variantGallerySelected.length === 0}
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
                {(popupVariant.sub_variant_type_on || (subVariantsMap[variantPopupId] || []).length > 0) && (
                  <div>
                    <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
                      Sub-Variants{popupVariant.sub_variant_type ? ` (${popupVariant.sub_variant_type})` : ''}
                    </p>
                    {(subVariantsMap[variantPopupId] || []).length > 0 && (
                      <div className="overflow-x-auto mb-3">
                      <table className="w-full text-xs whitespace-nowrap">
                        <thead>
                          <tr className="text-left text-foreground-muted border-b border-border-default">
                            <th className="pb-1 pr-2 font-medium">Name</th>
                            <th className="pb-1 pr-2 font-medium">Price</th>
                            <th className="pb-1 pr-2 font-medium">MRP</th>
                            <th className="pb-1 pr-2 font-medium">Ex-GST</th>
                            <th className="pb-1 pr-2 font-medium">MRP Ex-GST</th>
                            <th className="pb-1 pr-2 font-medium">Wholesale</th>
                            <th className="pb-1 pr-2 font-medium">Stock</th>
                            <th className="pb-1 pr-2 font-medium">SKU</th>
                            <th className="pb-1"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(subVariantsMap[variantPopupId] || []).map((sv: any) => {
                            const isEditingSv = subVariantEditId === sv.id
                            const ed = subVariantEditDraft
                            const svInputCls = "px-1.5 py-1 border border-accent-500 rounded bg-surface text-foreground text-xs focus:ring-1 focus:ring-accent-500 w-16"
                            return (
                              <tr key={sv.id} className="border-b border-border-default last:border-0">
                                {isEditingSv && ed ? (<>
                                  <td className="py-1 pr-1"><input type="text" value={ed.name} onChange={e => setSubVariantEditDraft(d => d && ({ ...d, name: e.target.value }))} className={`${svInputCls} w-20`} /></td>
                                  <td className="py-1 pr-1"><input type="number" step="0.01" value={ed.price} onChange={e => {
                                    const v = e.target.value; const n = parseFloat(v)
                                    setSubVariantEditDraft(d => d && ({ ...d, price: v, price_ex_gst: (!isNaN(n) && n > 0 && gstRate > 0) ? String(Math.round(n / (1 + gstRate / 100) * 100) / 100) : d.price_ex_gst }))
                                  }} className={svInputCls} /></td>
                                  <td className="py-1 pr-1"><input type="number" step="0.01" value={ed.mrp} onChange={e => setSubVariantEditDraft(d => d && ({ ...d, mrp: e.target.value }))} className={svInputCls} /></td>
                                  <td className="py-1 pr-1"><input type="number" step="0.01" value={ed.price_ex_gst} onChange={e => {
                                    const v = e.target.value; const n = parseFloat(v)
                                    setSubVariantEditDraft(d => d && ({ ...d, price_ex_gst: v, price: (!isNaN(n) && n > 0 && gstRate > 0) ? String(Math.round(n * (1 + gstRate / 100) * 100) / 100) : d.price }))
                                  }} className={svInputCls} /></td>
                                  <td className="py-1 pr-1"><input type="number" step="0.01" value={ed.mrp_ex_gst} onChange={e => setSubVariantEditDraft(d => d && ({ ...d, mrp_ex_gst: e.target.value }))} className={svInputCls} /></td>
                                  <td className="py-1 pr-1"><input type="number" step="0.01" value={ed.wholeprice_ex_gst} onChange={e => setSubVariantEditDraft(d => d && ({ ...d, wholeprice_ex_gst: e.target.value }))} className={svInputCls} /></td>
                                  <td className="py-1 pr-1"><input type="number" step="1" min="0" value={ed.stock} onChange={e => setSubVariantEditDraft(d => d && ({ ...d, stock: e.target.value }))} className={svInputCls} /></td>
                                  <td className="py-1 pr-1"><input type="text" value={ed.sku} onChange={e => setSubVariantEditDraft(d => d && ({ ...d, sku: e.target.value }))} className={`${svInputCls} w-20`} /></td>
                                  <td className="py-1 pl-1 flex items-center gap-1">
                                    <button type="button" onClick={async () => {
                                      if (!ed) return
                                      const res = await fetch(`/api/admin/products/${productId}/variants/${variantPopupId}/sub-variants`, {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ id: sv.id, sub_variant_name: ed.name, price: ed.price ? parseFloat(ed.price) : null, mrp: ed.mrp ? parseFloat(ed.mrp) : null, price_ex_gst: ed.price_ex_gst ? parseFloat(ed.price_ex_gst) : null, mrp_ex_gst: ed.mrp_ex_gst ? parseFloat(ed.mrp_ex_gst) : null, wholeprice_ex_gst: ed.wholeprice_ex_gst ? parseFloat(ed.wholeprice_ex_gst) : null, stock_quantity: ed.stock ? parseInt(ed.stock) : 0, sku: ed.sku || null }),
                                      })
                                      if (res.ok) {
                                        const updated = await res.json()
                                        setSubVariantsMap(m => ({ ...m, [variantPopupId]: m[variantPopupId].map(s => s.id === sv.id ? (updated.sub_variant || { ...s, sub_variant_name: ed.name, price: ed.price ? parseFloat(ed.price) : null, mrp: ed.mrp ? parseFloat(ed.mrp) : null, price_ex_gst: ed.price_ex_gst ? parseFloat(ed.price_ex_gst) : null, mrp_ex_gst: ed.mrp_ex_gst ? parseFloat(ed.mrp_ex_gst) : null, wholeprice_ex_gst: ed.wholeprice_ex_gst ? parseFloat(ed.wholeprice_ex_gst) : null, stock_quantity: ed.stock ? parseInt(ed.stock) : 0, sku: ed.sku || s.sku }) : s) }))
                                      }
                                      setSubVariantEditId(null); setSubVariantEditDraft(null)
                                    }} className="text-green-500 hover:text-green-700 leading-none font-bold text-sm">✓</button>
                                    <button type="button" onClick={() => { setSubVariantEditId(null); setSubVariantEditDraft(null) }} className="text-foreground-muted hover:text-foreground leading-none">✕</button>
                                  </td>
                                </>) : (<>
                                  <td className="py-1.5 pr-2">{sv.sub_variant_name}</td>
                                  <td className="py-1.5 pr-2">{sv.price != null ? `₹${sv.price}` : '—'}</td>
                                  <td className="py-1.5 pr-2">{sv.mrp != null ? `₹${sv.mrp}` : '—'}</td>
                                  <td className="py-1.5 pr-2">{sv.price_ex_gst != null ? `₹${sv.price_ex_gst}` : '—'}</td>
                                  <td className="py-1.5 pr-2">{sv.mrp_ex_gst != null ? `₹${sv.mrp_ex_gst}` : '—'}</td>
                                  <td className="py-1.5 pr-2">{sv.wholeprice_ex_gst != null ? `₹${sv.wholeprice_ex_gst}` : '—'}</td>
                                  <td className="py-1.5 pr-2">{sv.stock_quantity}</td>
                                  <td className="py-1.5 pr-2 font-mono text-foreground-muted">{sv.sku}</td>
                                  <td className="py-1.5 flex items-center gap-2">
                                    <button type="button" onClick={() => { setSubVariantEditId(sv.id); setSubVariantEditDraft({ name: sv.sub_variant_name, price: sv.price != null ? String(sv.price) : '', mrp: sv.mrp != null ? String(sv.mrp) : '', price_ex_gst: sv.price_ex_gst != null ? String(sv.price_ex_gst) : '', mrp_ex_gst: sv.mrp_ex_gst != null ? String(sv.mrp_ex_gst) : '', wholeprice_ex_gst: sv.wholeprice_ex_gst != null ? String(sv.wholeprice_ex_gst) : '', stock: String(sv.stock_quantity ?? 0), sku: sv.sku || '' }) }} className="text-accent-500 hover:text-accent-600 leading-none text-xs font-medium">Edit</button>
                                    <button type="button" onClick={() => deleteSubVariant(variantPopupId, sv.id)} className="text-red-400 hover:text-red-600 leading-none">✕</button>
                                  </td>
                                </>)}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      </div>
                    )}
                    {(() => {
                      const d = subVariantDrafts[variantPopupId] || { name:'',price:'',mrp:'',price_ex_gst:'',mrp_ex_gst:'',wholeprice_ex_gst:'',stock:'',sku:'' }
                      const setD = (field: string, val: string) => setSubVariantDrafts(m => ({ ...m, [variantPopupId]: { ...d, [field]: val } }))
                      const setDCalc = (field: string, val: string) => {
                        const n = parseFloat(val)
                        const next = { ...d, [field]: val }
                        if (!isNaN(n) && n > 0 && gstRate > 0) {
                          if (field === 'price') next.price_ex_gst = String(Math.round(n / (1 + gstRate / 100) * 100) / 100)
                          if (field === 'price_ex_gst') next.price = String(Math.round(n * (1 + gstRate / 100) * 100) / 100)
                        }
                        setSubVariantDrafts(m => ({ ...m, [variantPopupId]: next }))
                      }
                      const inputCls = "px-2 py-1.5 border border-border-secondary rounded bg-surface text-foreground text-xs focus:ring-1 focus:ring-accent-500"
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">Name *</label>
                            <input type="text" placeholder="e.g. Red" value={d.name} onChange={(e) => setD('name', e.target.value)} className={`${inputCls} w-full`} />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">Price (incl.)</label>
                            <input type="number" step="0.01" placeholder="0.00" value={d.price} onChange={(e) => setDCalc('price', e.target.value)} className={`${inputCls} w-full`} />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">MRP</label>
                            <input type="number" step="0.01" placeholder="0.00" value={d.mrp} onChange={(e) => setD('mrp', e.target.value)} className={`${inputCls} w-full`} />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">Ex-GST Price</label>
                            <input type="number" step="0.01" placeholder="0.00" value={d.price_ex_gst} onChange={(e) => setDCalc('price_ex_gst', e.target.value)} className={`${inputCls} w-full`} />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">MRP Ex-GST</label>
                            <input type="number" step="0.01" placeholder="0.00" value={d.mrp_ex_gst} onChange={(e) => setD('mrp_ex_gst', e.target.value)} className={`${inputCls} w-full`} />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">Wholesale</label>
                            <input type="number" step="0.01" placeholder="0.00" value={d.wholeprice_ex_gst} onChange={(e) => setD('wholeprice_ex_gst', e.target.value)} className={`${inputCls} w-full`} />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">Stock</label>
                            <input type="number" step="1" min="0" placeholder="0" value={d.stock} onChange={(e) => setD('stock', e.target.value)} className={`${inputCls} w-full`} />
                          </div>
                          <div>
                            <label className="block text-xs text-foreground-muted mb-0.5">SKU (auto)</label>
                            <input type="text" placeholder="auto" value={d.sku} onChange={(e) => setD('sku', e.target.value)} className={`${inputCls} w-full`} />
                          </div>
                          <div className="col-span-2 sm:col-span-4 flex justify-end mt-1">
                            <button type="button" onClick={() => addSubVariant(variantPopupId)} disabled={!d.name} className="px-4 py-1.5 text-xs font-medium text-white bg-accent-500 hover:bg-accent-600 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors">+ Add Sub-Variant</button>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>

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
