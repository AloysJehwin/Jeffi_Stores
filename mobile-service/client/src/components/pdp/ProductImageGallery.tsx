import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, ChevronRight, ImageIcon } from 'lucide-react-native'
import { IconButton, Lightbox, Pill } from '../../ui'
import { useTokens } from '../../theme'
import type { PdpImage } from '../../api/pdp'

// Mirror of controller-service components/visitor/ProductImageGallery.tsx at the mobile breakpoint, plus swipe paging.

function Slide({ image, width, height, label }: { image: PdpImage; width: number; height: number; label: string }) {
  return (
    <View style={{ width, height }} className="items-center justify-center overflow-hidden">
      <Image
        source={{ uri: image.image_url }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.6, transform: [{ scale: 1.1 }] }}
        contentFit="cover"
        blurRadius={24}
      />
      <Image
        source={{ uri: image.image_url }}
        placeholder={image.blurhash ? { blurhash: image.blurhash } : undefined}
        style={{ width: '100%', height: '100%' }}
        contentFit="contain"
        transition={200}
        accessibilityLabel={label}
      />
    </View>
  )
}

export default function ProductImageGallery({
  images,
  productName,
  variantImages,
  discountPct,
}: {
  images: PdpImage[]
  productName: string
  variantImages?: PdpImage[]
  discountPct?: number | null
}) {
  const t = useTokens()
  const displayImages = variantImages && variantImages.length > 0 ? variantImages : images
  const [index, setIndex] = useState(0)
  const [width, setWidth] = useState(0)
  const [lightbox, setLightbox] = useState(false)
  const mainRef = useRef<ScrollView>(null)

  useEffect(() => {
    setIndex(0)
    mainRef.current?.scrollTo({ x: 0, animated: false })
  }, [variantImages])

  if (!displayImages || displayImages.length === 0) {
    return (
      <View className="overflow-hidden rounded-field border border-border-default bg-surface-elevated">
        <View className="h-96 w-full items-center justify-center">
          <ImageIcon size={128} strokeWidth={1} color={t.foregroundMuted} />
        </View>
      </View>
    )
  }

  const height = width * (3 / 5)
  // Slides sit inside the 1px border.
  const slideW = width - 2
  const select = (i: number) => {
    setIndex(i)
    mainRef.current?.scrollTo({ x: i * slideW, animated: true })
  }
  const onSwipe = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!slideW) return
    setIndex(Math.max(0, Math.min(displayImages.length - 1, Math.round(e.nativeEvent.contentOffset.x / slideW))))
  }
  // grid-cols-4 gap-3
  const thumbW = width ? (width - 36) / 4 : 0

  return (
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      <View className="relative mb-4 overflow-hidden rounded-field border border-border-default bg-surface-elevated" style={{ height: height || undefined, aspectRatio: width ? undefined : 5 / 3 }}>
        {width > 0 ? (
          <ScrollView
            ref={mainRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onSwipe}
            scrollEnabled={displayImages.length > 1}
          >
            {displayImages.map((img, i) => (
              <Pressable key={img.id ?? i} accessibilityRole="imagebutton" accessibilityHint="Opens full screen" onPress={() => setLightbox(true)}>
                <Slide image={img} width={slideW} height={height - 2} label={`${productName} - Image ${i + 1}`} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {discountPct != null && discountPct > 0 ? <Pill label="Sale" className="absolute right-3 top-3" /> : null}
      </View>

      {displayImages.length > 1 && thumbW > 0 ? (
        <View className="flex-row flex-wrap" style={{ gap: 12 }}>
          {displayImages.map((img, i) => (
            <Pressable
              key={img.id ?? i}
              onPress={() => select(i)}
              accessibilityRole="imagebutton"
              accessibilityState={{ selected: i === index }}
              style={{ width: thumbW, transform: [{ scale: i === index ? 1.02 : 1 }] }}
              className={`overflow-hidden rounded-xl border-2 bg-surface-elevated ${i === index ? 'border-accent-500' : 'border-border-default'}`}
            >
              <View className="h-20 w-full overflow-hidden rounded-[10px] bg-surface-secondary">
                <Image
                  source={{ uri: img.thumbnail_url || img.image_url }}
                  placeholder={img.blurhash ? { blurhash: img.blurhash } : undefined}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="contain"
                  accessibilityLabel={`${productName} - Thumbnail ${i + 1}`}
                />
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      <GalleryLightbox
        visible={lightbox}
        images={displayImages}
        index={index}
        productName={productName}
        onIndex={i => select(i)}
        onClose={() => setLightbox(false)}
      />
    </View>
  )
}

function GalleryLightbox({
  visible,
  images,
  index,
  productName,
  onIndex,
  onClose,
}: {
  visible: boolean
  images: PdpImage[]
  index: number
  productName: string
  onIndex: (i: number) => void
  onClose: () => void
}) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const ref = useRef<ScrollView>(null)
  const go = (i: number) => {
    onIndex(i)
    ref.current?.scrollTo({ x: i * width, animated: true })
  }

  return (
    <Lightbox open={visible} onClose={onClose} caption={`${index + 1} / ${images.length}`} onShow={() => ref.current?.scrollTo({ x: index * width, animated: false })}>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: index * width, y: 0 }}
        onMomentumScrollEnd={e => onIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {images.map((img, i) => (
          <Pressable key={img.id ?? i} onPress={onClose} accessibilityLabel="Close" style={{ width, height }} className="items-center justify-center p-4">
            <Image
              source={{ uri: img.image_url }}
              style={{ width: width - 32, height: height * 0.85 }}
              contentFit="contain"
              accessibilityLabel={`${productName} - Image ${i + 1}`}
            />
          </Pressable>
        ))}
      </ScrollView>

      {images.length > 1 ? (
        <>
          <View className="absolute left-4" style={{ top: height / 2 - 24 }}>
            <IconButton icon={ChevronLeft} label="Previous image" variant="overlay" size="lg" onPress={() => go((index - 1 + images.length) % images.length)} />
          </View>
          <View className="absolute right-4" style={{ top: height / 2 - 24 }}>
            <IconButton icon={ChevronRight} label="Next image" variant="overlay" size="lg" onPress={() => go((index + 1) % images.length)} />
          </View>
          <View className="absolute left-0 right-0 items-center" style={{ bottom: insets.bottom + 16 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="max-w-full grow-0 rounded-field bg-black/60" contentContainerStyle={{ padding: 8, gap: 8 }}>
              {images.map((img, i) => (
                <Pressable
                  key={img.id ?? i}
                  onPress={() => go(i)}
                  accessibilityLabel={`Image ${i + 1}`}
                  accessibilityState={{ selected: i === index }}
                  className={`h-16 w-16 overflow-hidden rounded-xl border-2 bg-surface-secondary ${i === index ? 'border-accent-500' : 'border-transparent'}`}
                >
                  <Image source={{ uri: img.thumbnail_url || img.image_url }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </>
      ) : null}
    </Lightbox>
  )
}
