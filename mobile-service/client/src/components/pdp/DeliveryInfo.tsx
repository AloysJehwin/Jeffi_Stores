import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ArrowLeftRight, Check, CircleCheck, CircleX, ExternalLink, Lock, RefreshCw, ShieldCheck, Truck } from 'lucide-react-native'
import { Badge, Button, ModalSheet, Overline, Text, TextField, TONES, type IconComponent } from '../../ui'
import { checkDelivery } from '../../api/pdp'
import { openHref } from '../../lib/links'
import { primary, status, useTokens } from '../../theme'

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
// Tiles from the shared tones; icons in the nearest token colour (there's no blue token, so delivery is brand).
const TONE_BG: Record<Tone, string> = {
  blue: TONES.accent.bg,
  green: TONES.success.bg,
  red: TONES.danger.bg,
  orange: TONES.progress.bg,
  purple: TONES.transit.bg,
}

interface Policy {
  icon: IconComponent
  label: string
  sub: string
  detail: string
  bullets: string[]
  tone: Tone
  href: string
  hrefLabel: string
}

function PerkIcon({ item }: { item: Policy }) {
  const t = useTokens()
  const colour: Record<Tone, string> = { blue: t.accent600, green: status.success, red: status.danger, orange: primary[600], purple: status.digital }
  const Icon = item.icon
  return (
    <View className={`h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TONE_BG[item.tone]}`}>
      <Icon size={24} strokeWidth={1.75} color={colour[item.tone]} />
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
  const t = useTokens()
  const [active, setActive] = useState<Policy | null>(null)
  // The last policy stays in the sheet while it slides away.
  const [shown, setShown] = useState<Policy | null>(null)
  if (active && active !== shown) setShown(active)

  const items: Policy[] = [
    {
      icon: Truck,
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
      icon: RefreshCw,
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
      icon: ArrowLeftRight,
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
      icon: ShieldCheck,
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
      icon: Lock,
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
            accessibilityRole="button"
            accessibilityLabel={`${item.label}, ${item.sub}`}
            className="flex-row items-start gap-2.5 overflow-hidden rounded-field border border-border-default bg-surface p-3 active:bg-surface-secondary"
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
        accessibilityRole="button"
        accessibilityLabel="Secure Payment"
        className="w-full flex-row items-center gap-2.5 rounded-field border border-border-default bg-surface px-3 py-2.5 active:bg-surface-secondary"
      >
        <PerkIcon item={items[4]} />
        <Text className="w-10 shrink-0 text-[11px] font-medium leading-tight text-foreground-muted">Secure Payment</Text>
        <View className="ml-2 flex-1 flex-row flex-wrap items-center gap-1">
          {['UPI', 'Cards', 'Net Banking', 'Wallets'].map(m => (
            <Badge key={m} label={m} size="sm" />
          ))}
          {isCodAllowed ? <Badge label="Cash on Delivery" tone="warning" size="sm" /> : null}
        </View>
      </Pressable>

      <ModalSheet
        open={!!active}
        onClose={() => setActive(null)}
        title={shown?.label}
        subtitle={shown?.sub}
        footer={
          shown ? (
            <Button
              label={shown.hrefLabel}
              variant="secondary"
              icon={ExternalLink}
              onPress={() => {
                const href = shown.href
                setActive(null)
                openHref(router, href)
              }}
            />
          ) : null
        }
      >
        {shown ? (
          <View className="gap-4">
            <Text className="text-[15px] leading-[22px] text-foreground-secondary">{shown.detail}</Text>
            <View className="gap-2.5">
              {shown.bullets.map((b, i) => (
                <View key={i} className="flex-row items-start gap-2.5">
                  <View className="mt-0.5">
                    <Check size={16} strokeWidth={2.5} color={t.accent500} />
                  </View>
                  <Text className="flex-1 text-sm leading-5 text-foreground-secondary">{b}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ModalSheet>
    </View>
  )
}

export function PincodeChecker() {
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
    <View className="mt-3 rounded-field border border-border-default bg-surface-elevated p-3">
      <Overline className="mb-2 text-foreground-secondary">Check Delivery</Overline>
      <View className="flex-row items-start gap-2">
        <TextField
          value={pincode}
          onChangeText={v => {
            setPincode(v.replace(/\D/g, ''))
            setResult(null)
          }}
          onSubmitEditing={check}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="Enter pincode"
          accessibilityLabel="Pincode"
          containerClassName="flex-1"
        />
        <Button label="Check" loading={checking} loadingLabel="Checking…" variant="secondary" block={false} onPress={check} />
      </View>
      {result ? (
        <View accessibilityLiveRegion="polite" className="mt-2 flex-row items-center gap-1.5">
          {result.ok ? <CircleCheck size={14} color={status.success} /> : <CircleX size={14} color={status.danger} />}
          <Text className={`flex-1 text-xs font-medium ${result.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{result.message}</Text>
        </View>
      ) : null}
    </View>
  )
}
