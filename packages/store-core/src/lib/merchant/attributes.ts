// Product columns → Google Merchant attribute values (shared by the API sync and the XML feed).

/** Google's condition from ours ('open_box' sells as used). */
export function gmcCondition(p: any): 'new' | 'refurbished' | 'used' {
  return p.condition === 'refurbished' ? 'refurbished' : p.condition === 'used' || p.condition === 'open_box' ? 'used' : 'new'
}

/** Google's age group from the product's age range (years); adult when unset. */
export function gmcAgeGroup(p: any): 'adult' | 'kids' | 'toddler' | 'infant' {
  const max = Number(p.age_max)
  const min = Number(p.age_min)
  if (min >= 13 || !(max > 0)) return 'adult'
  if (max <= 1) return 'infant'
  if (max <= 5) return 'toddler'
  return max <= 13 ? 'kids' : 'adult'
}

export function gmcGender(p: any): 'male' | 'female' | 'unisex' | undefined {
  return ['male', 'female', 'unisex'].includes(p.target_gender) ? p.target_gender : undefined
}

/** Units in a multipack ("Pack of 10" → 10); undefined for single items. */
export function gmcMultipack(p: any): number | undefined {
  const n = Number(String(p.pack_size ?? '').match(/\d+/)?.[0])
  return n > 1 ? n : undefined
}
