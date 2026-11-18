import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { showcasePictures, showcaseStarter, StudioAiDownError, type StudioBrief } from '@/lib/site/studio'
import { starterFill } from '@/lib/showcase/starter'
import { workViews } from '@/lib/showcase/views'
import type { ShowcaseSiteRow } from '@/lib/showcase/store'

// What a Showcase build adds for a business that gave little, alongside its page and within the same budget: starter
// services and questions (AI-suggested, marked for the owner to check; lib/showcase/starter.ts) and a few mood
// pictures for BusinessPicture. Only lists that are still empty are filled, in one statement, so nothing the owner
// saved meanwhile is overwritten. It never fails the build.

/** Mood pictures a build makes when the owner has fewer than two work photos (0 turns them off). */
const MOOD_PICTURES = Math.max(0, Math.min(3, Number(process.env.SHOWCASE_MOOD_PICTURES ?? 3)))

const errText = (err: unknown) => ((err as Error)?.message || 'unknown error').slice(0, 300)

// A list already holding something stays as it is.
const filled = (key: string) => `(CASE WHEN jsonb_typeof(content->'${key}') = 'array' THEN jsonb_array_length(content->'${key}') ELSE 0 END) > 0`

export async function addStarterContent(site: ShowcaseSiteRow, brief: StudioBrief): Promise<{ services: number; faqs: number; pictures: number }> {
  try {
    const c = site.content
    const wantText = !c.services?.length || !c.faqs?.length
    const wantPictures = MOOD_PICTURES > 0 && !c.pictures?.length && workViews(c).length < 2
    const [suggested, moods] = await Promise.all([
      wantText
        ? showcaseStarter(brief, site.business).catch(err => {
            if (!(err instanceof StudioAiDownError)) console.warn('[showcase] starter content not suggested:', errText(err))
            return { services: [], faqs: [] }
          })
        : null,
      wantPictures ? showcasePictures(brief, MOOD_PICTURES).catch(err => ({ pictures: [], error: errText(err) })) : null,
    ])
    if (moods?.error) console.warn('[showcase] mood pictures:', moods.error)
    const fill: ReturnType<typeof starterFill> = suggested ? starterFill(c, suggested, site.business) : {}
    const pictures = moods?.pictures ?? []
    if (!fill.services && !fill.faqs && !pictures.length) return { services: 0, faqs: 0, pictures: 0 }
    await controlPlanePool().query(
      `UPDATE showcase_sites SET content = COALESCE(content, '{}'::jsonb)
         || CASE WHEN $2::jsonb IS NULL OR ${filled('services')} THEN '{}'::jsonb ELSE jsonb_build_object('services', $2::jsonb) END
         || CASE WHEN $3::jsonb IS NULL OR ${filled('faqs')} THEN '{}'::jsonb ELSE jsonb_build_object('faqs', $3::jsonb) END
         || CASE WHEN $4::jsonb IS NULL OR ${filled('pictures')} THEN '{}'::jsonb ELSE jsonb_build_object('pictures', $4::jsonb) END,
         updated_at = now()
       WHERE id = $1`,
      [site.id, fill.services ? JSON.stringify(fill.services) : null, fill.faqs ? JSON.stringify(fill.faqs) : null, pictures.length ? JSON.stringify(pictures) : null]
    )
    return { services: fill.services?.length ?? 0, faqs: fill.faqs?.length ?? 0, pictures: pictures.length }
  } catch (err) {
    console.warn('[showcase] starter content not saved:', errText(err))
    return { services: 0, faqs: 0, pictures: 0 }
  }
}
