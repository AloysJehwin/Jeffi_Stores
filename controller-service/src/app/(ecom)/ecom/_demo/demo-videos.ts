// The landing's product films (made from recordings of the real app, narrated). Each has an MP4, a WebM and a poster
// under BASE; the overview sits beside the hero and the three short ones below it.

const BASE = (process.env.NEXT_PUBLIC_DEMO_VIDEO_BASE || 'https://dm9rri2wgl1e.cloudfront.net/marketing/demo/v1').replace(/\/$/, '')

/** The films lead the hero; a build with NEXT_PUBLIC_DEMO_VIDEOS=off shows the copy alone above the interactive demo. */
export const DEMO_VIDEOS_READY = process.env.NEXT_PUBLIC_DEMO_VIDEOS !== 'off'

export interface DemoFilm {
  id: string
  title: string
  blurb: string
  /** Seconds, for the label. */
  length: number
  mp4: string
  webm: string
  poster: string
}

const film = (id: string, title: string, blurb: string, length: number): DemoFilm => ({
  id,
  title,
  blurb,
  length,
  mp4: `${BASE}/${id}.mp4`,
  webm: `${BASE}/${id}.webm`,
  poster: `${BASE}/${id}.jpg`,
})

export const HERO_FILM = film('overview', 'Jeffi Stores in 70 seconds', 'Design, sell, deliver and grow: the whole platform end to end.', 69)

export const FEATURE_FILMS: DemoFilm[] = [
  film('storefront', 'A storefront designed for you', 'Pick a style or let AI design every page, then shop it on any device.', 30),
  film('admin', 'Run it all from one admin', 'Products, orders, stock, payouts and GST in one place.', 25),
  film('campaigns', 'Campaigns that sell on autopilot', 'Email, WhatsApp and SMS campaigns that reach the right customers.', 27),
]
