import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import AboutEditor from '@/components/admin/homepage/editors/AboutEditor'
import BenefitsEditor from '@/components/admin/homepage/editors/BenefitsEditor'
import BlogTeaserEditor from '@/components/admin/homepage/editors/BlogTeaserEditor'
import MotionHeroEditor from '@/components/admin/homepage/editors/MotionHeroEditor'
import PromoBannerEditor from '@/components/admin/homepage/editors/PromoBannerEditor'
import SocialStripEditor from '@/components/admin/homepage/editors/SocialStripEditor'
import TrustStripEditor from '@/components/admin/homepage/editors/TrustStripEditor'
import WhyUsEditor from '@/components/admin/homepage/editors/WhyUsEditor'
import { renderEditor, input, commit, choose, combo } from './editor-kit'

// Tile-list style homepage editors (about, benefits, trust strip, why us, blog teaser, social strip, motion hero)
// and the promo banner. The media picker is stubbed to a button that "uploads" /new.jpg (+ /new.mp4 when the
// slot takes video); everything else is the real TileListEditor / field set.
vi.mock('@/components/admin/media/MediaField', () => ({
  default: ({ label, allowVideo, onChange, disabled }: any) => (
    <button
      type="button"
      disabled={disabled}
      data-testid={`media-${label}`}
      onClick={() => onChange({ image: '/new.jpg', video: allowVideo ? '/new.mp4' : null })}
    >
      pick media
    </button>
  ),
}))

describe('AboutEditor', () => {
  it('shows live default copy, the default photo and the built-in stats', () => {
    renderEditor(AboutEditor, 'about')
    expect(input('Heading')).toHaveValue('Your Trusted Hardware Partner')
    expect(input('Second paragraph').value).toMatch(/product breadth/)
    expect(screen.getByLabelText('Photo link')).toHaveValue('/images/Working.png')
    expect(screen.getByAltText('About photo')).toBeInTheDocument()
    expect(screen.getByText(/built-in tiles shown on the homepage/)).toBeInTheDocument()
    expect(input('Value', 0)).toHaveValue('10+')
    expect(input('Label', 1)).toHaveValue('Happy Customers')
    expect(input('Button link')).toHaveValue('/about')
  })

  it('saves the second paragraph, or null when cleared', () => {
    const { onSave } = renderEditor(AboutEditor, 'about', { config: { body: 'Old' } })
    commit(input('Second paragraph'), 'We ship fast')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { body: 'We ship fast' } })
    commit(input('Second paragraph'), '  ')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { body: null } })
  })

  it('saves the story to the subtitle column', () => {
    const { onSave } = renderEditor(AboutEditor, 'about')
    commit(input('Story'), 'Founded in 2010')
    expect(onSave).toHaveBeenCalledWith('sec-1', { subtitle: 'Founded in 2010' })
  })

  it('saves a new photo with its video', () => {
    const { onSave } = renderEditor(AboutEditor, 'about')
    fireEvent.click(screen.getByTestId('media-Photo'))
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { imageUrl: '/new.jpg', video: '/new.mp4' } })
  })

  it('saves a pasted photo link on blur', () => {
    const { onSave } = renderEditor(AboutEditor, 'about', { config: { imageUrl: '/a.jpg' } })
    commit(screen.getByLabelText('Photo link'), ' https://cdn.test/b.jpg ')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { imageUrl: 'https://cdn.test/b.jpg', video: null } })
  })

  it('materialises the built-in stats when one is edited, and removes one', () => {
    const { onSave } = renderEditor(AboutEditor, 'about')
    commit(input('Value', 0), '25+')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', {
      config: {
        stats: [
          { value: '25+', label: 'Years in Business' },
          { value: '1000+', label: 'Happy Customers' },
        ],
      },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { stats: [{ value: '10+', label: 'Years in Business' }] } })
  })

  it('caps stats at four and locks without write access', () => {
    const stats = [1, 2, 3, 4].map(n => ({ value: String(n), label: `L${n}` }))
    const { unmount } = renderEditor(AboutEditor, 'about', { config: { stats } })
    expect(screen.getByRole('button', { name: 'Add tile' })).toBeDisabled()
    unmount()
    renderEditor(AboutEditor, 'about', {}, { canWrite: false })
    expect(input('Story')).toBeDisabled()
    expect(screen.getByTestId('media-Photo')).toBeDisabled()
  })
})

describe('BenefitsEditor', () => {
  it('shows the three built-in tiles with the built-in note', () => {
    renderEditor(BenefitsEditor, 'benefits')
    expect(screen.getByText(/built-in tiles shown on the homepage/)).toBeInTheDocument()
    expect(input('Title', 0)).toHaveValue('Save up to 18% with GST')
    expect(screen.getByText('Tile 3')).toBeInTheDocument()
  })

  it('adds a blank tile after the built-ins', () => {
    const { onSave } = renderEditor(BenefitsEditor, 'benefits')
    fireEvent.click(screen.getByRole('button', { name: 'Add tile' }))
    const items = onSave.mock.calls[0][1].config.items
    expect(items).toHaveLength(4)
    expect(items[3]).toEqual({ icon: 'Receipt', title: '', sub: '' })
  })

  it('saves an edited title and an icon change', () => {
    const { onSave } = renderEditor(BenefitsEditor, 'benefits', {
      config: { items: [{ icon: 'Clock', title: 'Fast', sub: 'Quick' }] },
    })
    commit(input('Title'), 'Faster')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { items: [{ icon: 'Clock', title: 'Faster', sub: 'Quick' }] } })
    choose('Icon', 'Truck')
    expect(onSave.mock.calls.at(-1)![1].config.items[0].icon).toBe('Truck')
  })

  it('reorders tiles with Up and Down', () => {
    const { onSave } = renderEditor(BenefitsEditor, 'benefits', {
      config: { items: [{ icon: 'Clock', title: 'A', sub: '' }, { icon: 'Clock', title: 'B', sub: '' }] },
    })
    expect(screen.getAllByRole('button', { name: 'Up' })[0]).toBeDisabled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Down' })[0])
    expect(onSave.mock.calls[0][1].config.items.map((t: any) => t.title)).toEqual(['B', 'A'])
  })

  it('confirms before restoring the built-in tiles, which saves an empty list', () => {
    const { onSave } = renderEditor(BenefitsEditor, 'benefits', {
      config: { items: [{ icon: 'Clock', title: 'Mine', sub: '' }] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Restore built-in tiles' }))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore built-in tiles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { items: [] } })
  })

  it('locks tile controls without write access', () => {
    renderEditor(BenefitsEditor, 'benefits', {}, { canWrite: false })
    expect(screen.getByRole('button', { name: 'Add tile' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Remove' })[0]).toBeDisabled()
  })
})

describe('TrustStripEditor', () => {
  it('shows the four built-in strip items and the {amount} hint', () => {
    renderEditor(TrustStripEditor, 'trust_strip')
    expect(screen.getByText(/Write \{amount\} in a label/)).toBeInTheDocument()
    expect(input('Label', 0)).toHaveValue('Free delivery above {amount}')
    expect(screen.getAllByText(/^Tile \d$/)).toHaveLength(4)
  })

  it('saves an edited label across the whole list', () => {
    const { onSave } = renderEditor(TrustStripEditor, 'trust_strip', {
      config: { items: [{ icon: 'Truck', label: 'Fast' }] },
    })
    commit(input('Label'), 'Free over {amount}')
    expect(onSave).toHaveBeenCalledWith('sec-1', { config: { items: [{ icon: 'Truck', label: 'Free over {amount}' }] } })
  })

  it('stops adding at six', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ icon: 'Truck', label: `L${i}` }))
    renderEditor(TrustStripEditor, 'trust_strip', { config: { items } })
    expect(screen.getByRole('button', { name: 'Add tile' })).toBeDisabled()
  })
})

describe('WhyUsEditor', () => {
  it('shows built-in cards with their accent colours', () => {
    renderEditor(WhyUsEditor, 'why_us')
    expect(input('Title', 1)).toHaveValue('Wide Range')
    expect(combo('Accent colour', 1)).toHaveTextContent('Accent')
  })

  it('saves a changed accent colour for one card', () => {
    const { onSave } = renderEditor(WhyUsEditor, 'why_us')
    choose('Accent colour', 'Secondary', 0)
    const items = onSave.mock.calls[0][1].config.items
    expect(items.map((i: any) => i.color)).toEqual(['secondary', 'accent', 'secondary'])
  })

  it('saves a description edit', () => {
    const { onSave } = renderEditor(WhyUsEditor, 'why_us', {
      config: { items: [{ icon: 'Zap', title: 'Fast', desc: 'old', color: 'primary' }] },
    })
    commit(input('Description'), 'Next day')
    expect(onSave).toHaveBeenCalledWith('sec-1', {
      config: { items: [{ icon: 'Zap', title: 'Fast', desc: 'Next day', color: 'primary' }] },
    })
  })
})

describe('BlogTeaserEditor', () => {
  const article = { title: 'Drill bits', excerpt: 'Pick the right one', url: '/guides/bits', imageUrl: '/a.jpg', video: '' }

  it('shows an empty state, then adds a blank article', () => {
    const { onSave } = renderEditor(BlogTeaserEditor, 'blog_teaser')
    expect(screen.getByText('No tiles yet. Add one to show it on the homepage.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add tile' }))
    expect(onSave).toHaveBeenCalledWith('sec-1', {
      config: { items: [{ title: '', excerpt: '', url: '', imageUrl: '', video: '' }] },
    })
  })

  it('lists saved articles and saves an edited link', () => {
    const { onSave } = renderEditor(BlogTeaserEditor, 'blog_teaser', { config: { items: [article] } })
    expect(screen.getByText('Article 1')).toBeInTheDocument()
    expect(input('Title')).toHaveValue('Drill bits')
    commit(input('Link'), '/guides/new')
    expect(onSave.mock.calls.at(-1)![1].config.items[0].url).toBe('/guides/new')
  })

  it('saves a picked image together with its video key', () => {
    const { onSave } = renderEditor(BlogTeaserEditor, 'blog_teaser', { config: { items: [article] } })
    fireEvent.click(screen.getByTestId('media-Image'))
    expect(onSave.mock.calls[0][1].config.items[0]).toMatchObject({ imageUrl: '/new.jpg', video: '/new.mp4' })
  })

  it('flags cards whose link, image or video would be ignored', () => {
    const bad = { ...article, url: 'javascript:alert(1)' }
    const { unmount } = renderEditor(BlogTeaserEditor, 'blog_teaser', { config: { items: [bad] } })
    expect(screen.getByText(/One card has a link that will be ignored/)).toBeInTheDocument()
    unmount()
    renderEditor(BlogTeaserEditor, 'blog_teaser', { config: { items: [bad, { ...article, imageUrl: 'ftp://x' }] } })
    expect(screen.getByText(/2 cards have a link that will be ignored/)).toBeInTheDocument()
  })

  it('is read-only without write access', () => {
    renderEditor(BlogTeaserEditor, 'blog_teaser', { config: { items: [article] } }, { canWrite: false })
    expect(input('Title')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add tile' })).toBeDisabled()
  })
})

describe('SocialStripEditor', () => {
  const post = { imageUrl: '/p.jpg', video: '', url: 'https://instagram.com/p/1', caption: 'Hello' }

  it('shows posts with their caption and saves a caption edit', () => {
    const { onSave } = renderEditor(SocialStripEditor, 'social_strip', { config: { items: [post] } })
    expect(screen.getByText('Post 1')).toBeInTheDocument()
    commit(input('Caption'), 'Hi there')
    expect(onSave.mock.calls.at(-1)![1].config.items[0]).toMatchObject({ caption: 'Hi there', url: post.url })
  })

  it('warns with the plural count when several posts have unsafe links', () => {
    const bad = { ...post, url: 'javascript:1' }
    renderEditor(SocialStripEditor, 'social_strip', { config: { items: [bad, bad] } })
    expect(screen.getByText(/2 posts have a link that will be ignored/)).toBeInTheDocument()
  })

  it('shows the profile button defaults and saves the link', () => {
    const { onSave } = renderEditor(SocialStripEditor, 'social_strip')
    expect(input('Button label')).toHaveValue('Follow us')
    commit(input('Button link'), 'https://instagram.com/store')
    expect(onSave).toHaveBeenCalledWith('sec-1', { ctaUrl: 'https://instagram.com/store' })
  })

  it('caps posts at twelve', () => {
    renderEditor(SocialStripEditor, 'social_strip', { config: { items: Array.from({ length: 12 }, () => post) } })
    expect(screen.getByRole('button', { name: 'Add tile' })).toBeDisabled()
  })
})

describe('MotionHeroEditor', () => {
  const slide = { bgImage: '/bg.jpg', bgVideo: '', fgImage: '', fgFrame: 'rounded', eyebrow: 'New', headline: 'Built to last', sub: '', ctaLabel: 'Shop', url: '/products' }

  it('asks for a slide when none are saved and always notes the Hero replacement', () => {
    renderEditor(MotionHeroEditor, 'motion_hero')
    expect(screen.getByText(/Add at least one slide with a background image and a headline/)).toBeInTheDocument()
    expect(screen.getByText(/replaces the Hero slides section/)).toBeInTheDocument()
    expect(input('Seconds per slide')).toHaveValue(6)
  })

  it('lists a slide, hides the empty note, and saves a headline edit', () => {
    const { onSave } = renderEditor(MotionHeroEditor, 'motion_hero', { config: { slides: [slide] } })
    expect(screen.queryByText(/Add at least one slide/)).toBeNull()
    expect(input('Headline')).toHaveValue('Built to last')
    commit(input('Headline'), 'Made tough')
    expect(onSave.mock.calls.at(-1)![1].config.slides[0]).toMatchObject({ headline: 'Made tough', bgImage: '/bg.jpg' })
  })

  it('saves the background with its video through the media picker', () => {
    const { onSave } = renderEditor(MotionHeroEditor, 'motion_hero', { config: { slides: [slide] } })
    fireEvent.click(screen.getByTestId('media-Background'))
    expect(onSave.mock.calls[0][1].config.slides[0]).toMatchObject({ bgImage: '/new.jpg', bgVideo: '/new.mp4' })
  })

  it('saves the foreground frame style', () => {
    const { onSave } = renderEditor(MotionHeroEditor, 'motion_hero', { config: { slides: [slide] } })
    choose('Foreground style', 'Faded edges')
    expect(onSave.mock.calls[0][1].config.slides[0].fgFrame).toBe('fade')
  })

  it('caps the interval at 20 seconds and ignores values under 3', () => {
    const { onSave } = renderEditor(MotionHeroEditor, 'motion_hero')
    commit(input('Seconds per slide'), '45')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { intervalSeconds: 20 } })
    onSave.mockClear()
    commit(input('Seconds per slide'), '1')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('flags slides with unsafe links', () => {
    renderEditor(MotionHeroEditor, 'motion_hero', { config: { slides: [{ ...slide, url: 'javascript:1' }] } })
    expect(screen.getByText(/One slide has a link that will be ignored/)).toBeInTheDocument()
  })

  it('caps slides at eight and locks without write access', () => {
    const { unmount } = renderEditor(MotionHeroEditor, 'motion_hero', { config: { slides: Array.from({ length: 8 }, () => slide) } })
    expect(screen.getByRole('button', { name: 'Add tile' })).toBeDisabled()
    unmount()
    renderEditor(MotionHeroEditor, 'motion_hero', {}, { canWrite: false })
    expect(input('Seconds per slide')).toBeDisabled()
  })
})

describe('PromoBannerEditor', () => {
  it('warns that there is no desktop image and shows the preview fallbacks', () => {
    renderEditor(PromoBannerEditor, 'promo_banner')
    expect(screen.getByText(/Add a desktop image/)).toBeInTheDocument()
    expect(screen.getByText('No desktop image')).toBeInTheDocument()
    expect(screen.getByText('No image')).toBeInTheDocument()
  })

  it('shows previews and no warning once an image is set', () => {
    renderEditor(PromoBannerEditor, 'promo_banner', { config: { imageUrl: '/d.jpg' } })
    expect(screen.queryByText(/Add a desktop image/)).toBeNull()
    expect(screen.getByAltText('Desktop preview')).toBeInTheDocument()
    expect(screen.getByAltText('Mobile preview')).toHaveAttribute('src', '/d.jpg')
  })

  it('saves the desktop image and video, and the mobile image', () => {
    const { onSave } = renderEditor(PromoBannerEditor, 'promo_banner', { config: { background: 'bg-blue-600' } })
    fireEvent.click(screen.getByTestId('media-Banner (desktop)'))
    expect(onSave).toHaveBeenLastCalledWith('sec-1', {
      config: { background: 'bg-blue-600', imageUrl: '/new.jpg', video: '/new.mp4' },
    })
    fireEvent.click(screen.getByTestId('media-Image (mobile)'))
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { background: 'bg-blue-600', imageUrlMobile: '/new.jpg' } })
  })

  it('saves the colours, and a null for the Default option', () => {
    const { onSave } = renderEditor(PromoBannerEditor, 'promo_banner', { config: { background: 'bg-blue-600' } })
    expect(combo('Background colour')).toHaveTextContent('Blue')
    choose('Background colour', 'Default')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { background: null } })
    choose('Text colour', 'White')
    expect(onSave).toHaveBeenLastCalledWith('sec-1', { config: { background: 'bg-blue-600', textColor: 'text-white' } })
  })

  it('saves the subtitle as a row column', () => {
    const { onSave } = renderEditor(PromoBannerEditor, 'promo_banner')
    commit(input('Subtitle'), 'Up to 40% off')
    expect(onSave).toHaveBeenCalledWith('sec-1', { subtitle: 'Up to 40% off' })
  })

  it('locks everything without write access', () => {
    renderEditor(PromoBannerEditor, 'promo_banner', {}, { canWrite: false })
    expect(screen.getByTestId('media-Banner (desktop)')).toBeDisabled()
    expect(combo('Text colour')).toBeDisabled()
  })
})
