/**
 * Indian state from a pincode.
 *
 * Razorpay's linked-account API validates the state name and rejects anything it does not
 * recognise ("State name entered is incorrect"). The KYC business address is free text, so
 * parsing it positionally — `addressParts[length - 2]` — produced 'IN' for an address with no
 * commas, which Razorpay refuses.
 *
 * The pincode is the only structured location we reliably hold, and its leading digits identify
 * the postal circle. Mapped here are the prefixes whose state is unambiguous. Ranges that span
 * more than one state are resolved at three digits where the split is well defined, and left
 * unmapped otherwise: returning null so the caller fails with a clear message is better than
 * guessing a state and sending Razorpay something wrong.
 */

/** Three-digit prefixes that differ from their two-digit circle. */
const THREE_DIGIT: Record<string, string> = {
  '403': 'Goa', // inside Maharashtra's 40x
  '605': 'Puducherry', // inside Tamil Nadu's 60x
  '246': 'Uttarakhand', // 24x is otherwise Uttar Pradesh
  '247': 'Uttarakhand',
  '248': 'Uttarakhand',
  '249': 'Uttarakhand',
}

/** Two-digit postal circles with a single unambiguous state. */
const TWO_DIGIT: Record<string, string> = {
  '11': 'Delhi',
  '12': 'Haryana',
  '13': 'Haryana',
  '14': 'Punjab',
  '15': 'Punjab',
  '16': 'Punjab',
  '17': 'Himachal Pradesh',
  '18': 'Jammu and Kashmir',
  '19': 'Jammu and Kashmir',
  '20': 'Uttar Pradesh',
  '21': 'Uttar Pradesh',
  '22': 'Uttar Pradesh',
  '23': 'Uttar Pradesh',
  '24': 'Uttar Pradesh',
  '25': 'Uttar Pradesh',
  '26': 'Uttar Pradesh',
  '27': 'Uttar Pradesh',
  '28': 'Uttar Pradesh',
  '30': 'Rajasthan',
  '31': 'Rajasthan',
  '32': 'Rajasthan',
  '33': 'Rajasthan',
  '34': 'Rajasthan',
  '36': 'Gujarat',
  '37': 'Gujarat',
  '38': 'Gujarat',
  '39': 'Gujarat',
  '40': 'Maharashtra',
  '41': 'Maharashtra',
  '42': 'Maharashtra',
  '43': 'Maharashtra',
  '44': 'Maharashtra',
  '45': 'Madhya Pradesh',
  '46': 'Madhya Pradesh',
  '47': 'Madhya Pradesh',
  '48': 'Madhya Pradesh',
  '49': 'Chhattisgarh',
  '50': 'Telangana',
  '56': 'Karnataka',
  '57': 'Karnataka',
  '58': 'Karnataka',
  '59': 'Karnataka',
  '60': 'Tamil Nadu',
  '61': 'Tamil Nadu',
  '62': 'Tamil Nadu',
  '63': 'Tamil Nadu',
  '64': 'Tamil Nadu',
  '67': 'Kerala',
  '68': 'Kerala',
  '69': 'Kerala',
  '70': 'West Bengal',
  '71': 'West Bengal',
  '72': 'West Bengal',
  '73': 'West Bengal',
  '74': 'West Bengal',
  '75': 'Odisha',
  '76': 'Odisha',
  '77': 'Odisha',
  '78': 'Assam',
  // Deliberately unmapped: 51-53 (Andhra Pradesh / Telangana boundary), 79 (several
  // north-eastern states share the circle), 80-85 (Bihar / Jharkhand interleave).
  // An unmapped prefix returns null and the caller asks for the state instead of guessing.
}

export function stateFromPincode(pin: string | null | undefined): string | null {
  const p = String(pin ?? '').replace(/\D/g, '')
  if (!/^\d{6}$/.test(p)) return null
  return THREE_DIGIT[p.slice(0, 3)] ?? TWO_DIGIT[p.slice(0, 2)] ?? null
}
