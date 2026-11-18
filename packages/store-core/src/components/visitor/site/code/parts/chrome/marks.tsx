// The store's logo mark, as the built-in header draws it; the header and the AI's <Logo> both use it. No hooks.

const NAME_CLASS = 'text-base sm:text-lg lg:text-xl font-bold text-secondary-500 dark:text-primary-400 truncate'

export function StoreLogoMark({
  name,
  logoUrl,
  tagline,
  showName = true,
  nameClassName = NAME_CLASS,
}: {
  name: string
  logoUrl: string | null
  tagline?: string | null
  showName?: boolean
  nameClassName?: string
}) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
      {logoUrl ? (
        <img src={logoUrl} alt={`${name} Logo`} className="h-8 sm:h-10 lg:h-12 w-auto max-w-[6rem] sm:max-w-none object-contain shrink-0" />
      ) : (
        <span
          aria-hidden
          className="inline-flex h-8 w-8 sm:h-10 sm:w-10 lg:h-12 lg:w-12 shrink-0 items-center justify-center rounded-xl bg-accent-500 text-white text-base sm:text-lg lg:text-xl font-black"
        >
          {name.trim().charAt(0).toUpperCase() || 'S'}
        </span>
      )}
      {showName && (
        <div className="min-w-0">
          <div className={nameClassName}>{name}</div>
          {tagline && <div className="hidden sm:block text-xs text-foreground-muted truncate">{tagline}</div>}
        </div>
      )}
    </div>
  )
}

export const CART_GLYPH =
  'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z'
