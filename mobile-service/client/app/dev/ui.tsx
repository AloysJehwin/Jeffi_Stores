import { useState } from 'react'
import { View } from 'react-native'
import { Redirect } from 'expo-router'
import { useColorScheme } from 'nativewind'
import { Bell, Heart, Mail, MapPin, Package, Search, Share2, ShoppingBag, Trash2, User } from 'lucide-react-native'
import { useThemeStore } from '../../src/stores/themeStore'
import {
  Badge, Body, BodySmall, Button, Caption, Card, Checkbox, Chip, ChipGroup, confirm, DateField, Display, Divider,
  EmptyState, ErrorState, formatDate, Heading, IconButton, ListGroup, ListRow, ModalSheet, Notice, OtpField, Overline,
  PhoneField, Pill, Radio, Screen, ScreenHeader, Section, SelectField, Skeleton, SkeletonText, Spinner, Subheading, Switch,
  Text, TextField, Title, toast, TONES, type Tone,
} from '../../src/ui'

// Every src/ui component in one place, for screenshot review in light and dark. Dev builds only.

export default function UiGallery() {
  if (!__DEV__) return <Redirect href="/" />
  return <Gallery />
}

function Gallery() {
  const { colorScheme } = useColorScheme()
  const setPreference = useThemeStore(s => s.setPreference)
  const [text, setText] = useState('')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [date, setDate] = useState('')
  const [select, setSelect] = useState('')
  const [chip, setChip] = useState('All')
  const [checked, setChecked] = useState(true)
  const [radio, setRadio] = useState('standard')
  const [on, setOn] = useState(true)
  const [sheet, setSheet] = useState(false)

  return (
    <Screen
      mode="keyboard"
      header={
        <ScreenHeader
          title="UI library"
          subtitle="src/ui"
          actions={<Switch value={colorScheme === 'dark'} onChange={v => setPreference(v ? 'dark' : 'light')} label="Dark mode" />}
        />
      }
    >
      <Section title="Typography" gutter={false}>
        <Display>Display 30</Display>
        <Title>Title 24</Title>
        <Heading>Heading 18</Heading>
        <Subheading>Subheading 16</Subheading>
        <Body>Body 15 — the quick brown fox jumps over the lazy dog.</Body>
        <BodySmall>Body small 13 — secondary copy.</BodySmall>
        <Caption>Caption 12</Caption>
        <Overline>Overline 11</Overline>
        <Text className="mt-2 font-bold">Inter bold via font-bold</Text>
      </Section>

      <Section title="Buttons" gutter={false}>
        <View className="gap-3">
          <Button label="Add item · ₹1,249" icon={ShoppingBag} haptics onPress={() => toast.success('Added to cart')} />
          <Button label="Secondary" variant="secondary" onPress={() => toast.info('Secondary')} />
          <Button label="Outline" variant="outline" size="md" onPress={() => {}} />
          <Button label="Delete address" variant="destructive" size="md" icon={Trash2} onPress={async () => (await confirm({ title: 'Delete this address?', message: 'This can’t be undone.', destructive: true })) && toast.error('Deleted')} />
          <Button label="Loading" loading loadingLabel="Saving…" onPress={() => {}} />
          <Button label="Disabled" disabled onPress={() => {}} />
          <View className="flex-row items-center gap-2">
            <Button label="Ghost" variant="ghost" size="sm" block={false} onPress={() => {}} />
            <IconButton icon={Search} label="Search" />
            <IconButton icon={Heart} label="Wishlist" variant="tinted" />
            <IconButton icon={Share2} label="Share" variant="solid" />
            <IconButton icon={Bell} label="Notifications" badge={3} />
          </View>
        </View>
      </Section>

      <Section title="Fields" gutter={false}>
        <View className="gap-4">
          <TextField label="Full name" required placeholder="Your name" value={text} onChangeText={setText} clearable icon={User} helper="As on your ID" />
          <TextField label="Email" placeholder="you@example.com" keyboardType="email-address" icon={Mail} error="Enter a valid email" value="jeffi@" />
          <PhoneField label="Mobile number" value={phone} onChange={setPhone} />
          <TextField label="Notes" multiline placeholder="Anything we should know?" />
          <SelectField
            label="State"
            value={select}
            onChange={setSelect}
            placeholder="Choose a state"
            options={['Tamil Nadu', 'Kerala', 'Karnataka', 'Andhra Pradesh'].map(s => ({ value: s, label: s }))}
          />
          <DateField value={date} onChange={setDate} title="Delivery date">
            {open => (
              <View className={`h-14 flex-row items-center rounded-field border-2 px-4 ${open ? 'border-accent-500' : 'border-border-secondary'} bg-surface`}>
                <Text className={date ? '' : 'text-foreground-muted'}>{date ? formatDate(date, 'long') : 'Pick a date'}</Text>
              </View>
            )}
          </DateField>
          <OtpField value={otp} onChange={setOtp} />
        </View>
      </Section>

      <Section title="Choices" gutter={false}>
        <ChipGroup className="mb-3">
          {['All', 'Tools', 'Paint', 'Electrical'].map(c => (
            <Chip key={c} label={c} selected={chip === c} onPress={() => setChip(c)} />
          ))}
          <Chip label="Out of stock" unavailable disabled />
          <Chip label="Small" size="sm" meta={12} />
        </ChipGroup>
        <Checkbox checked={checked} onChange={setChecked} label="Email me offers" description="About once a week" />
        <Radio selected={radio === 'standard'} onSelect={() => setRadio('standard')} label="Standard delivery" description="3–5 days" card className="mb-2" />
        <Radio selected={radio === 'express'} onSelect={() => setRadio('express')} label="Express delivery" description="Tomorrow" card />
        <View className="mt-3 flex-row items-center justify-between">
          <Body>Order updates</Body>
          <Switch value={on} onChange={setOn} label="Order updates" />
        </View>
      </Section>

      <Section title="Cards and rows" gutter={false}>
        <Card className="mb-3">
          <Subheading>A raised card</Subheading>
          <BodySmall>Shadow in light mode, border in dark.</BodySmall>
        </Card>
        <Card onPress={() => toast.info('Pressed')} elevation="overlay" className="mb-3">
          <Subheading>Pressable card</Subheading>
        </Card>
        <ListGroup title="Account">
          <ListRow title="My orders" subtitle="Track, return or buy again" icon={Package} onPress={() => {}} />
          <ListRow title="Addresses" icon={MapPin} value="3" onPress={() => {}} />
          <ListRow title="Notifications" icon={Bell} trailing={<Switch value={on} onChange={setOn} label="Notifications" />} />
          <ListRow title="Sign out" destructive onPress={() => {}} />
        </ListGroup>
        <Divider className="my-4" />
      </Section>

      <Section title="Badges" gutter={false}>
        <View className="flex-row flex-wrap gap-2">
          {(Object.keys(TONES) as Tone[]).map(tone => (
            <Badge key={tone} label={tone} tone={tone} />
          ))}
          <Badge label="Solid" tone="accent" solid />
          <Pill label="20% off" />
        </View>
      </Section>

      <Section title="Loading" gutter={false}>
        <Card className="mb-3 flex-row gap-3">
          <Skeleton width={64} height={64} rounded="rounded-xl" />
          <View className="flex-1 justify-center">
            <SkeletonText lines={2} />
          </View>
        </Card>
        <Spinner fill={false} label="Loading orders" />
      </Section>

      <Section title="States" gutter={false}>
        <Notice>Your order ships tomorrow.</Notice>
        <Notice tone="danger" className="mt-2">
          Couldn’t apply that coupon.
        </Notice>
        <Card className="mt-3">
          <EmptyState title="Your wishlist is empty" message="Tap the heart on any product to save it." actionLabel="Browse products" onAction={() => {}} />
        </Card>
        <Card className="mt-3">
          <ErrorState onRetry={() => toast.info('Retrying')} />
        </Card>
      </Section>

      <Section title="Sheets" gutter={false}>
        <View className="gap-3">
          <Button label="Open a sheet" variant="secondary" onPress={() => setSheet(true)} />
          <Button label="Confirm" variant="outline" onPress={async () => toast.info((await confirm({ title: 'Place this order?', message: '₹1,249 by UPI', confirmLabel: 'Place order' })) ? 'Confirmed' : 'Cancelled')} />
        </View>
        <ModalSheet open={sheet} onClose={() => setSheet(false)} title="Choose a size" subtitle="Prices include GST" footer={<Button label="Done" onPress={() => setSheet(false)} />}>
          <ChipGroup>
            {['S', 'M', 'L', 'XL'].map(s => (
              <Chip key={s} label={s} selected={s === 'M'} />
            ))}
          </ChipGroup>
          <TextField label="Quantity" keyboardType="number-pad" containerClassName="mt-4" />
        </ModalSheet>
      </Section>
    </Screen>
  )
}
