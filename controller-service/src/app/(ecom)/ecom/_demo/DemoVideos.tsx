'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Maximize2, Play, Volume2, VolumeX } from 'lucide-react'
import { useCanPlayVideo } from '@/components/visitor/media/StoreMedia'
import type { DemoFilm } from './demo-videos'

// Product films: each plays muted while on screen. Sound is on for at most one film; turning it on starts that film
// from the top and mutes the rest. Reduced motion and Save-Data get the poster and a play button.

interface Sound {
  loud: string | null
  setLoud: (id: string | null) => void
}

const SoundContext = createContext<Sound | null>(null)

export function FilmSound({ children }: { children: ReactNode }) {
  const [loud, setLoud] = useState<string | null>(null)
  const value = useMemo(() => ({ loud, setLoud }), [loud])
  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>
}

const mins = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function useFilm(film: DemoFilm) {
  const ref = useRef<HTMLVideoElement>(null)
  const sound = useContext(SoundContext)
  const autoplay = useCanPlayVideo()
  const loud = sound?.loud === film.id
  const [visible, setVisible] = useState(false)
  const [asked, setAsked] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && e.intersectionRatio >= 0.35), { threshold: [0, 0.35, 0.7] })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || failed) return
    el.muted = !loud
    if (visible && (autoplay || asked || loud)) el.play().catch(() => setAsked(false))
    else el.pause()
  }, [visible, autoplay, asked, loud, failed])

  const toggle = () => {
    const el = ref.current
    if (!el || !sound) return
    if (loud) return sound.setLoud(null)
    el.currentTime = 0
    el.muted = false
    setAsked(true)
    sound.setLoud(film.id)
    el.play().catch(() => sound.setLoud(null))
  }

  const expand = () => {
    const el = ref.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (!el) return
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {})
    else el.webkitEnterFullscreen?.()
  }

  // A film with sound plays once, then carries on looping muted.
  const onEnded = () => {
    const el = ref.current
    if (!el) return
    if (loud) sound?.setLoud(null)
    el.currentTime = 0
    el.play().catch(() => {})
  }

  const playing = visible && (autoplay || asked || loud) && !failed
  return { ref, loud, playing, failed, setFailed, toggle, expand, onEnded, poster: !autoplay && !asked && !loud }
}

function FilmVideo({ film, f, className }: { film: DemoFilm; f: ReturnType<typeof useFilm>; className: string }) {
  return (
    <video
      ref={f.ref}
      className={className}
      poster={film.poster}
      muted
      playsInline
      loop={!f.loud}
      preload="metadata"
      onEnded={f.onEnded}
      onError={() => f.setFailed(true)}
      aria-label={film.title}
    >
      <source src={film.webm} type="video/webm" />
      <source src={film.mp4} type="video/mp4" />
    </video>
  )
}

function SoundButton({ f, title, big }: { f: ReturnType<typeof useFilm>; title: string; big?: boolean }) {
  const Icon = f.loud ? Volume2 : VolumeX
  return (
    <button
      type="button"
      onClick={f.toggle}
      aria-pressed={f.loud}
      aria-label={f.loud ? `Mute ${title}` : `Play ${title} with sound`}
      className={`inline-flex items-center gap-2 rounded-full bg-black/65 text-white backdrop-blur-sm transition hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${big ? 'h-11 px-4 text-sm font-semibold' : 'h-9 w-9 justify-center'}`}
    >
      <Icon className={big ? 'h-4 w-4' : 'h-4 w-4'} aria-hidden />
      {big && <span>{f.loud ? 'Sound on' : 'Play with sound'}</span>}
    </button>
  )
}

function PlayOverlay({ f, title }: { f: ReturnType<typeof useFilm>; title: string }) {
  if (!f.poster) return null
  return (
    <button type="button" onClick={f.toggle} aria-label={`Play ${title}`} className="absolute inset-0 flex items-center justify-center bg-black/10">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-foreground shadow-lg">
        <Play className="h-7 w-7 translate-x-0.5" aria-hidden />
      </span>
    </button>
  )
}

/** The overview film beside the hero copy. */
export function HeroFilm({ film }: { film: DemoFilm }) {
  const f = useFilm(film)
  return (
    <figure className="relative overflow-hidden rounded-[1.25rem] sm:rounded-[2rem] border border-border-secondary org-chrome shadow-2xl shadow-black/[0.12]">
      <div className="relative aspect-video bg-black">
        <FilmVideo film={film} f={f} className="absolute inset-0 h-full w-full object-cover" />
        {f.failed ? (
          <div className="absolute inset-0 flex items-center justify-center org-frame text-sm text-foreground-muted">The tour is on its way.</div>
        ) : (
          <>
            <PlayOverlay f={f} title={film.title} />
            <div className="absolute bottom-3 right-3 flex items-center gap-2 sm:bottom-4 sm:right-4">
              <SoundButton f={f} title={film.title} big />
              <button
                type="button"
                onClick={f.expand}
                aria-label={`Watch ${film.title} full screen`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm transition hover:bg-black/80"
              >
                <Maximize2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </>
        )}
      </div>
      <figcaption className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <span className="font-display font-bold text-sm sm:text-base text-foreground">{film.title}</span>
        <span className="font-mono text-xs text-foreground-muted">{mins(film.length)}</span>
      </figcaption>
    </figure>
  )
}

function FilmTile({ film }: { film: DemoFilm }) {
  const f = useFilm(film)
  return (
    <figure className="group flex flex-col overflow-hidden rounded-[1.25rem] border border-border-secondary org-chrome">
      <div className="relative aspect-video bg-black">
        <FilmVideo film={film} f={f} className="absolute inset-0 h-full w-full cursor-pointer object-cover" />
        {f.failed ? (
          <div className="absolute inset-0 flex items-center justify-center org-frame text-xs text-foreground-muted">Coming soon</div>
        ) : (
          <>
            <PlayOverlay f={f} title={film.title} />
            <div className="absolute bottom-2.5 right-2.5 flex gap-2">
              <SoundButton f={f} title={film.title} />
              <button
                type="button"
                onClick={f.expand}
                aria-label={`Watch ${film.title} full screen`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm transition hover:bg-black/80"
              >
                <Maximize2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </>
        )}
      </div>
      <figcaption className="flex flex-1 flex-col gap-1 px-4 py-3.5">
        <span className="flex items-center justify-between gap-2">
          <span className="font-display font-bold text-base text-foreground">{film.title}</span>
          <span className="shrink-0 font-mono text-[11px] text-foreground-muted">{mins(film.length)}</span>
        </span>
        <span className="text-sm text-foreground-secondary leading-snug">{film.blurb}</span>
      </figcaption>
    </figure>
  )
}

/** The three short films, in one row on desktop. */
export function FilmRow({ films }: { films: DemoFilm[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
      {films.map(film => (
        <FilmTile key={film.id} film={film} />
      ))}
    </div>
  )
}
