import { useEffect, useId } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg'
import { GUTTER, SectionHeading } from './layout'
import { absUrl } from '../../lib/links'
import { isGroupSeen, openStories, useStoryStore } from '../../stores/storyStore'
import { accent } from '../../theme'
import type { SectionProps, StoriesData, StoryGroup } from '../../types/home'

// A row of story rings; tapping one opens the full-screen viewer (StoryViewerHost at the root).

const COPY = { eyebrow: 'Fresh today', title: 'Stories' }
const RING = 68
const STROKE = 2.5
const INSET = 2.5 // gap between the ring and the cover
const CELL = RING + 8

export default function Stories({ section, data }: SectionProps) {
  const groups = (data.extras[section.id] as StoriesData | undefined)?.groups ?? []
  const seen = useStoryStore(s => s.seen)
  const hydrateSeen = useStoryStore(s => s.hydrateSeen)
  useEffect(() => {
    hydrateSeen()
  }, [hydrateSeen])
  if (groups.length === 0) return null

  return (
    <View className="bg-surface px-4 pb-6 pt-8">
      <SectionHeading
        eyebrow={section.copy.eyebrow ?? COPY.eyebrow}
        title={section.copy.title ?? COPY.title}
        titleClassName="font-display text-xl font-extrabold text-foreground"
        className="mb-4"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -GUTTER }}
        contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 12 }}
      >
        {groups.map((group, i) => (
          <Ring key={group.id} group={group} seen={isGroupSeen(seen, group)} onPress={() => openStories(groups, i)} />
        ))}
      </ScrollView>
    </View>
  )
}

function Ring({ group, seen, onPress }: { group: StoryGroup; seen: boolean; onPress: () => void }) {
  const gid = `ring${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const inner = RING - 2 * (STROKE + INSET)
  const cover = absUrl(group.cover)
  return (
    <Pressable
      onPress={onPress}
      style={{ width: CELL }}
      className="items-center"
      accessibilityRole="button"
      accessibilityLabel={`${group.title} story${seen ? '' : ', new'}`}
    >
      <View style={{ width: RING, height: RING }} className="items-center justify-center">
        {seen ? (
          <View style={[StyleSheet.absoluteFill, { borderRadius: RING / 2, borderWidth: STROKE }]} className="border-border-secondary" />
        ) : (
          <Svg style={StyleSheet.absoluteFill} width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`}>
            <Defs>
              <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={accent[400]} />
                <Stop offset="1" stopColor={accent[700]} />
              </LinearGradient>
            </Defs>
            <Circle cx={RING / 2} cy={RING / 2} r={(RING - STROKE) / 2} stroke={`url(#${gid})`} strokeWidth={STROKE} fill="none" />
          </Svg>
        )}
        <View style={{ width: inner, height: inner, borderRadius: inner / 2 }} className="overflow-hidden bg-surface-secondary">
          <Image source={cover ? { uri: cover } : undefined} style={{ width: inner, height: inner }} contentFit="cover" transition={200} />
        </View>
      </View>
      <Text
        numberOfLines={1}
        className={`mt-1.5 text-xs ${seen ? 'text-foreground-muted' : 'font-semibold text-foreground'}`}
        style={{ width: CELL, textAlign: 'center' }}
      >
        {group.title}
      </Text>
    </Pressable>
  )
}
