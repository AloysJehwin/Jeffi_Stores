import { Linking, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { Mic } from 'lucide-react-native'
import { absUrl } from '../../lib/links'
import { BodySmall, Button, Card, Caption, Heading, Text } from '../../ui'
import type { Order } from './shared'

/** Sketches, measurements and voice notes the store shared on the order. */
export function StoreNotes({ notes }: { notes: NonNullable<Order['sharedNotes']> }) {
  return (
    <Card>
      <Heading>Notes from the store</Heading>
      <Caption className="mb-4 mt-0.5">Sketches, measurements and messages our team shared with you for this order.</Caption>
      <View className="gap-3">
        {notes.map(n => (
          <View key={n.id} className="rounded-field bg-surface p-4">
            {!!n.title && <Text className="font-semibold text-foreground">{n.title}</Text>}
            {!!n.body && <BodySmall className="mt-1">{n.body}</BodySmall>}
            {n.attachments?.some(x => x.kind === 'image') && (
              <View className="mt-3 flex-row flex-wrap gap-2">
                {n.attachments
                  .filter(x => x.kind === 'image')
                  .map(x => (
                    <Pressable key={x.id} accessibilityRole="imagebutton" accessibilityLabel="Open image" onPress={() => Linking.openURL(absUrl(x.url) ?? x.url)}>
                      <Image source={{ uri: absUrl(x.thumbnailUrl || x.url) ?? undefined }} style={{ width: 96, height: 96, borderRadius: 12 }} contentFit="cover" />
                    </Pressable>
                  ))}
              </View>
            )}
            {n.attachments
              ?.filter(x => x.kind === 'audio')
              .map(x => (
                <View key={x.id} className="mt-3">
                  <Button label="Play voice note" icon={Mic} variant="secondary" size="sm" block={false} onPress={() => Linking.openURL(absUrl(x.url) ?? x.url)} />
                </View>
              ))}
            <Caption className="mt-2">{new Date(n.createdAt).toLocaleString('en-IN')}</Caption>
          </View>
        ))}
      </View>
    </Card>
  )
}

/** The customer's own note on the order. */
export function OrderNote({ notes }: { notes: string }) {
  return (
    <Card>
      <Heading className="mb-2">Order Notes</Heading>
      <BodySmall>{notes}</BodySmall>
    </Card>
  )
}
