import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { Glyph, P } from './Glyph'
import { status } from '../../theme'
import type { PdpImage } from '../../api/pdp'

// Mirror of controller-service components/visitor/ProductImageGallery.tsx at the mobile breakpoint, plus swipe paging.

function SaleRibbon() {
  // absolute top-7 right-[-28px] w-32 rotate-45 bg-gradient-to-r from-rose-500 to-orange-500 py-1 text-xs
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 28, right: -28, width: 128, transform: [{ rotate: '45deg' }], zIndex: 10 }}>
      <Svg width={128} height={24} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="pdpSale" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={status.saleFrom} />
            <Stop offset="1" stopColor={status.saleTo} />
          </LinearGradient>
        </Defs>
        <Rect width={128} height={24} fill="url(#pdpSale)" />
      </Svg>
      <Text className="text-center text-xs font-bold text-white" style={{ lineHeight: 24 }}>
        SALE
      </Text>
    </View>
  )
}

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
      <View className="overflow-hidden rounded-xl border border-border-default bg-surface-elevated">
        <View className="h-96 w-full items-center justify-center">
          <Glyph d={P.photo} size={128} strokeWidth={1} className="text-foreground-muted" />
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
      <View className="relative mb-4 overflow-hidden rounded-xl border border-border-default bg-surface-elevated" style={{ height: height || undefined, aspectRatio: width ? undefined : 5 / 3 }}>
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
              <Pressable key={img.id ?? i} onPress={() => setLightbox(true)}>
                <Slide image={img} width={slideW} height={height - 2} label={`${productName} - Image ${i + 1}`} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {discountPct != null && discountPct > 0 ? <SaleRibbon /> : null}
      </View>

      {displayImages.length > 1 && thumbW > 0 ? (
        <View className="flex-row flex-wrap" style={{ gap: 12 }}>
          {displayImages.map((img, i) => (
            <Pressable
              key={img.id ?? i}
              onPress={() => select(i)}
              style={{ width: thumbW, transform: [{ scale: i === index ? 1.02 : 1 }] }}
              className={`overflow-hidden rounded-lg border-2 bg-surface-elevated ${i === index ? 'border-accent-500' : 'border-border-default'}`}
            >
              <View className="h-20 w-full overflow-hidden rounded-md bg-surface-secondary">
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

      <Lightbox
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

function Lightbox({
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={() => ref.current?.scrollTo({ x: index * width, animated: false })}>
      <View className="flex-1 bg-black/90">
        <ScrollView
          ref={ref}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: index * width, y: 0 }}
          onMomentumScrollEnd={e => onIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        >
          {images.map((img, i) => (
            <Pressable key={img.id ?? i} onPress={onClose} style={{ width, height }} className="items-center justify-center p-4">
              <Image
                source={{ uri: img.image_url }}
                style={{ width: width - 32, height: height * 0.85 }}
                contentFit="contain"
                accessibilityLabel={`${productName} - Image ${i + 1}`}
              />
            </Pressable>
          ))}
        </ScrollView>

        <Pressable onPress={onClose} hitSlop={8} className="absolute right-4 z-10" style={{ top: insets.top + 16 }} accessibilityLabel="Close">
          <Glyph d={P.close} size={32} className="text-white" />
        </Pressable>
        <View className="absolute left-4 z-10 rounded-lg bg-black/60 px-4 py-2" style={{ top: insets.top + 16 }}>
          <Text className="text-sm text-white">
            {index + 1} / {images.length}
          </Text>
        </View>

        {images.length > 1 ? (
          <>
            <Pressable
              onPress={() => go((index - 1 + images.length) % images.length)}
              className="absolute left-4 rounded-full bg-black/60 p-3"
              style={{ top: height / 2 - 24 }}
              accessibilityLabel="Previous image"
            >
              <Glyph d={P.chevronLeft} size={24} className="text-white" />
            </Pressable>
            <Pressable
              onPress={() => go((index + 1) % images.length)}
              className="absolute right-4 rounded-full bg-black/60 p-3"
              style={{ top: height / 2 - 24 }}
              accessibilityLabel="Next image"
            >
              <Glyph d={P.chevronRight} size={24} className="text-white" />
            </Pressable>
            <View className="absolute left-0 right-0 items-center" style={{ bottom: insets.bottom + 16 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="max-w-full grow-0 rounded-lg bg-black/60" contentContainerStyle={{ padding: 8, gap: 8 }}>
                {images.map((img, i) => (
                  <Pressable
                    key={img.id ?? i}
                    onPress={() => go(i)}
                    className={`h-16 w-16 overflow-hidden rounded border-2 bg-surface-secondary ${i === index ? 'border-accent-500' : 'border-transparent'}`}
                  >
                    <Image source={{ uri: img.thumbnail_url || img.image_url }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  )
}
