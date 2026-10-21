import { useState } from 'react'
import { Modal, Pressable, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Glyph, P } from './Glyph'
import { checkDelivery } from '../../api/pdp'
import { openHref } from '../../lib/links'
import { useTokens } from '../../theme'

// Mirror of the DeliveryInfo perks grid + policy popup and the PincodeChecker in ProductDetailClient.tsx.

export interface PolicyProps {
  returnAllowed: boolean
  returnDays: number
  replacementAllowed: boolean
  replacementDays: number
  isCodAllowed?: boolean
  freeShippingThreshold?: number
}

type Tone = 'blue' | 'green' | 'red' | 'orange' | 'purple'
const TONE_BG: Record<Tone, string> = {
  blue: 'bg-blue-50 dark:bg-blue-900/20',
  green: 'bg-green-50 dark:bg-green-900/20',
  red: 'bg-red-50 dark:bg-red-900/20',
  orange: 'bg-orange-50 dark:bg-orange-900/20',
  purple: 'bg-purple-50 dark:bg-purple-900/20',
}
const TONE_TEXT: Record<Tone, string> = {
  blue: 'text-blue-600 dark:text-blue-400',
  green: 'text-green-600 dark:text-green-400',
  red: 'text-red-500 dark:text-red-400',
  orange: 'text-orange-600 dark:text-orange-400',
  purple: 'text-purple-600 dark:text-purple-400',
}

interface Policy {
  icon: string | string[]
  label: string
  sub: string
  detail: string
  bullets: string[]
  tone: Tone
  href: string
  hrefLabel: string
}

function PerkIcon({ item }: { item: Policy }) {
  return (
    <View className={`h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE_BG[item.tone]}`}>
      <Glyph d={item.icon} size={28} strokeWidth={1.5} className={TONE_TEXT[item.tone]} />
    </View>
  )
}

const inrWhole = (n: number) => n.toLocaleString('en-IN')

export function DeliveryInfo({
  returnAllowed,
  returnDays,
  replacementAllowed,
  replacementDays,
  isCodAllowed,
  freeShippingThreshold = 500,
}: PolicyProps) {
  const router = useRouter()
  const [active, setActive] = useState<Policy | null>(null)

  const items: Policy[] = [
    {
      icon: P.truck,
      label: 'Free Delivery',
      sub: `On orders above ₹${inrWhole(freeShippingThreshold)}`,
      detail: `Free delivery on all orders above ₹${inrWhole(freeShippingThreshold)}. Standard shipping charges apply below this threshold.`,
      bullets: [
        'Delivered within 3–7 business days',
        'Same-day dispatch on orders placed before 2 PM',
        'Tracking link sent via SMS & email after dispatch',
        'Delivery available across India including remote areas',
      ],
      tone: 'blue',
      href: '/legal/shipping-policy',
      hrefLabel: 'Read Shipping Policy',
    },
    {
      icon: P.refresh,
      label: returnAllowed ? 'Easy Returns' : 'Non-Returnable',
      sub: returnAllowed ? `${returnDays}-day return policy` : 'This product cannot be returned',
      detail: returnAllowed ? `Hassle-free returns within ${returnDays} days of delivery.` : 'This product is non-returnable due to its nature.',
      bullets: returnAllowed
        ? [
            `Raise a return request within ${returnDays} days of delivery`,
            'Item must be unused and in original packaging',
            'Refund processed within 5–7 business days after pickup',
            'Free pickup arranged from your doorstep',
          ]
        : [
            'Please review the product details carefully before ordering',
            'Damaged or defective items — contact support within 48 hours',
            'Wrong item received? We will arrange a replacement',
            'Our team is available 9 AM – 6 PM Mon–Sat',
          ],
      tone: returnAllowed ? 'green' : 'red',
      href: '/legal/return-refund-policy',
      hrefLabel: 'Read Return & Refund Policy',
    },
    {
      icon: P.swap,
      label: replacementAllowed ? 'Free Replacement' : 'Non-Replaceable',
      sub: replacementAllowed ? `${replacementDays}-day guarantee` : 'This product cannot be replaced',
      detail: replacementAllowed
        ? `Free replacement within ${replacementDays} days for defective or damaged products.`
        : 'This product is not eligible for replacement under our standard policy.',
      bullets: replacementAllowed
        ? [
            `Request replacement within ${replacementDays} days of delivery`,
            'Applicable for manufacturing defects & damage on delivery',
            'Upload photos of the defect when raising the request',
            'Replacement dispatched within 2–3 business days of approval',
          ]
        : [
            'Damaged on delivery? Contact support within 48 hours with photos',
            'Incorrect item received will be replaced at no cost',
            'Manufacturing defects covered under brand warranty',
            'Contact us at support@jeffistores.in for assistance',
          ],
      tone: replacementAllowed ? 'orange' : 'red',
      href: '/legal/return-refund-policy',
      hrefLabel: 'Read Return & Refund Policy',
    },
    {
      icon: P.shield,
      label: '100% Genuine',
      sub: 'Verified authentic products',
      detail: 'Every product is sourced directly from authorised distributors or manufacturers.',
      bullets: [
        'Sourced directly from authorised distributors',
        'Zero tolerance for counterfeit or grey-market goods',
        'Quality inspection before every dispatch',
        'Brand warranty honoured on all genuine products',
      ],
      tone: 'purple',
      href: '/legal/warranty-policy',
      hrefLabel: 'Read Warranty Policy',
    },
    {
      icon: P.lock,
      label: 'Secure Payment',
      sub: 'Encrypted & protected checkout',
      detail:
        'All payments are processed over an encrypted, PCI-DSS compliant gateway. Your card and bank details are never stored on our servers.',
      bullets: [
        '256-bit SSL encrypted checkout',
        'UPI, Cards, Net Banking & Wallets accepted',
        isCodAllowed ? 'Cash on Delivery available for eligible orders' : 'Prepaid orders only for this product',
        'Instant payment confirmation & receipt',
      ],
      tone: 'green',
      href: '/legal/terms',
      hrefLabel: 'Read Payment Terms',
    },
  ]

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-3">
        {items.slice(0, 4).map((item, i) => (
          <Pressable
            key={i}
            onPress={() => setActive(item)}
            style={{ flexBasis: '45%', flexGrow: 1 }}
            className="flex-row items-start gap-2.5 overflow-hidden rounded-xl border border-border-default bg-surface p-3"
          >
            <View className="mt-0.5">
              <PerkIcon item={item} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold leading-tight text-foreground">{item.label}</Text>
              <Text className="mt-0.5 text-[11px] leading-snug text-foreground-muted">{item.sub}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={() => setActive(items[4])}
        className="w-full flex-row items-center gap-2.5 rounded-xl border border-border-default bg-surface px-3 py-2.5"
      >
        <PerkIcon item={items[4]} />
        <Text className="w-10 shrink-0 text-[11px] font-medium leading-tight text-foreground-muted">Secure Payment</Text>
        <View className="ml-2 flex-1 flex-row flex-wrap items-center gap-1">
          {['UPI', 'Cards', 'Net Banking', 'Wallets'].map(m => (
            <View key={m} className="rounded border border-border-default bg-surface-secondary px-1 py-0.5">
              <Text className="text-[9px] font-semibold text-foreground-secondary">{m}</Text>
            </View>
          ))}
          {isCodAllowed ? (
            <View className="rounded border border-amber-200 bg-amber-50 px-1 py-0.5 dark:border-amber-700 dark:bg-amber-900/20">
              <Text className="text-[9px] font-semibold text-amber-700 dark:text-amber-400">Cash on Delivery</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      <Modal visible={!!active} transparent animationType="fade" onRequestClose={() => setActive(null)}>
        <View className="flex-1 items-center justify-center p-4">
          <Pressable className="absolute inset-0 bg-black/40" onPress={() => setActive(null)} />
          {active ? (
            <View className="w-full max-w-sm gap-4 rounded-2xl border border-border-default bg-surface p-5 shadow-2xl">
              <View className="flex-row items-center gap-3">
                <PerkIcon item={active} />
                <View className="flex-1">
                  <Text className="text-base font-semibold text-foreground">{active.label}</Text>
                  <Text className="text-xs text-foreground-muted">{active.sub}</Text>
                </View>
              </View>
              <Text className="text-sm leading-relaxed text-foreground-secondary">{active.detail}</Text>
              <View className="gap-2">
                {active.bullets.map((b, i) => (
                  <View key={i} className="flex-row items-start gap-2">
                    <View className="mt-0.5">
                      <Glyph d={P.check} size={16} strokeWidth={2.5} className="text-accent-500" />
                    </View>
                    <Text className="flex-1 text-sm text-foreground-secondary">{b}</Text>
                  </View>
                ))}
              </View>
              <View className="flex-row items-center justify-between pt-1">
                <Pressable
                  onPress={() => {
                    const href = active.href
                    setActive(null)
                    openHref(router, href)
                  }}
                  className="flex-row items-center gap-1"
                >
                  <Text className="text-sm font-medium text-accent-600">{active.hrefLabel}</Text>
                  <Glyph d={P.externalLink} size={14} className="text-accent-600" />
                </Pressable>
                <Pressable onPress={() => setActive(null)} className="rounded-lg px-3 py-1.5">
                  <Text className="text-xs text-foreground-muted">Close</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  )
}

export function PincodeChecker() {
  const t = useTokens()
  const [pincode, setPincode] = useState('')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [checking, setChecking] = useState(false)

  const check = async () => {
    const p = pincode.trim()
    if (!/^\d{6}$/.test(p)) {
      setResult({ ok: false, message: 'Enter a valid 6-digit pincode' })
      return
    }
    setChecking(true)
    setResult(null)
    try {
      const data = await checkDelivery(p)
      setResult({ ok: data.serviceable, message: data.message })
    } catch {
      setResult({ ok: false, message: 'Could not check delivery. Try again.' })
    } finally {
      setChecking(false)
    }
  }

  return (
    <View className="mt-3 rounded-xl border border-border-default bg-surface-elevated p-3">
      <Text className="mb-2 text-xs font-semibold uppercase text-foreground-secondary" style={{ letterSpacing: 0.3 }}>
        Check Delivery
      </Text>
      <View className="flex-row gap-2">
        <TextInput
          value={pincode}
          onChangeText={v => {
            setPincode(v.replace(/\D/g, ''))
            setResult(null)
          }}
          onSubmitEditing={check}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="Enter pincode"
          placeholderTextColor={t.foregroundMuted}
          className="min-w-0 flex-1 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground"
        />
        <Pressable
          onPress={check}
          disabled={checking}
          className={`shrink-0 justify-center rounded-lg border border-border-default bg-surface px-4 py-2 ${checking ? 'opacity-60' : ''}`}
        >
          <Text className="text-sm font-semibold text-foreground">{checking ? 'Checking…' : 'Check'}</Text>
        </Pressable>
      </View>
      {result ? (
        <Text className={`mt-2 text-xs font-medium ${result.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {result.ok ? '✓ ' : '✗ '}
          {result.message}
        </Text>
      ) : null}
    </View>
  )
}
