// GET /v1/providers: configured state per provider and capability, the models each offers, the default orders.

import type {
  EmbedProviderName, ImageProviderName, OcrProviderName, ProviderStatus, ProvidersResponse, RazerHealth, StockProviderName,
  SttProviderName, TextProviderName, TtsProviderName, VideoProviderName,
} from '../../sdk/types'
import { orderedStatus, providerStatus, type StatusBase } from './media'
import type { Capability, ModelSource } from './models'
import type { SttProvider, TtsProvider } from './providers/types'

type Configurable = { configured(): boolean }

export interface ProvidersReportDeps {
  models: ModelSource
  text: { order: TextProviderName[]; status: Record<TextProviderName, StatusBase<TextProviderName>> }
  image: { order: ImageProviderName[]; providers: Partial<Record<ImageProviderName, Configurable>>; healthy?: Partial<Record<ImageProviderName, boolean>> }
  video: { order: VideoProviderName[]; providers: Partial<Record<VideoProviderName, Configurable>> }
  stt: { order: SttProviderName[]; providers: Partial<Record<SttProviderName, SttProvider>> }
  tts: { order: TtsProviderName[]; providers: Partial<Record<TtsProviderName, TtsProvider>> }
  embed: { default: EmbedProviderName; status: Record<EmbedProviderName, StatusBase<EmbedProviderName>> }
  ocr: StatusBase<OcrProviderName>[]
  ocrModel: string
  stock: { order: StockProviderName[]; providers: Partial<Record<StockProviderName, Configurable>> }
  razer?: RazerHealth
}

export function providersReport(d: ProvidersReportDeps): ProvidersResponse {
  const withModels = <N extends string>(cap: Capability, list: StatusBase<N>[]): ProviderStatus<N>[] =>
    list.map(s => ({ ...s, models: d.models(s.name, cap)?.models ?? [] }))
  const sides = <N extends string, P>(order: N[], providers: Partial<Record<N, P>>, ok: (p: P) => boolean) =>
    providerStatus(order, Object.fromEntries(Object.entries(providers).map(([n, p]) => [n, { configured: () => ok(p as P) }])) as Partial<Record<N, Configurable>>)
  const image = providerStatus(d.image.order, d.image.providers)
    .map(s => (d.image.healthy?.[s.name] === undefined ? s : { ...s, healthy: d.image.healthy[s.name] }))
  return {
    text: withModels('text', orderedStatus(d.text.order, d.text.status)),
    image: withModels('image', image),
    video: withModels('video', providerStatus(d.video.order, d.video.providers)),
    stt: withModels('stt', sides(d.stt.order, d.stt.providers, p => p.transcribeConfigured())),
    tts: withModels('tts', sides(d.tts.order, d.tts.providers, p => p.speakConfigured())),
    embed: withModels('embed', Object.values(d.embed.status)),
    ocr: d.ocr.map(s => ({ ...s, models: [{ id: d.ocrModel, label: d.ocrModel, default: true }] })),
    stock: providerStatus(d.stock.order, d.stock.providers).map(s => ({ ...s, models: [] })),
    razer: d.razer,
    defaults: {
      text: d.text.order, image: d.image.order, video: d.video.order, stt: d.stt.order, tts: d.tts.order,
      embed: d.embed.default, stock: d.stock.order,
    },
  }
}
