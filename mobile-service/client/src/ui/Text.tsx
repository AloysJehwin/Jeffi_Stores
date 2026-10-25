import { createContext, forwardRef, useContext } from 'react'
import { Text as RNText, type TextProps as RNTextProps } from 'react-native'
import { cn } from './cn'

export type TextProps = RNTextProps & { className?: string }

// NativeWind resolves two classes for one property by stylesheet order, not string order, so a default
// family or colour is only added when the caller didn't set one.
const NOT_COLOUR = /^text-(xs|sm|base|lg|[2-9]?xl|left|right|center|justify|\[)/
function hasColour(className: string) {
  return className.split(/\s+/).some(c => {
    const u = c.slice(c.lastIndexOf(':') + 1)
    return u.startsWith('text-') && !NOT_COLOUR.test(u)
  })
}
const hasFamily = (className: string) => /(^|\s|:)font-(inter|display|bebas)\b/.test(className)

function withDefaults(className = '', colour = 'text-foreground', family = 'font-inter') {
  return cn(!hasFamily(className) && family, !hasColour(className) && colour, className)
}

// Nested Text inherits its parent's colour and family, so only the outermost one gets the defaults.
const Nested = createContext(false)

/** React Native's Text in the app's body face (Inter). Use it wherever a raw Text would go. */
export const Text = forwardRef<RNText, TextProps>(function Text({ className, children, ...props }, ref) {
  const nested = useContext(Nested)
  return (
    <RNText ref={ref} className={nested ? className : withDefaults(className)} {...props}>
      <Nested.Provider value>{children}</Nested.Provider>
    </RNText>
  )
})

function preset(base: string, opts: { colour?: string; family?: string; header?: boolean } = {}) {
  return forwardRef<RNText, TextProps>(function Preset({ className, children, ...props }, ref) {
    return (
      <RNText
        ref={ref}
        accessibilityRole={opts.header ? 'header' : undefined}
        className={cn(base, withDefaults(className, opts.colour, opts.family))}
        {...props}
      >
        <Nested.Provider value>{children}</Nested.Provider>
      </RNText>
    )
  })
}

export const Display = preset('text-[30px] font-extrabold leading-9 tracking-tight', { family: 'font-display', header: true })
export const Title = preset('text-2xl font-extrabold leading-8 tracking-tight', { family: 'font-display', header: true })
export const Heading = preset('text-lg font-bold leading-6', { header: true })
export const Subheading = preset('text-base font-semibold leading-6')
export const Body = preset('text-[15px] leading-[22px]')
export const BodySmall = preset('text-[13px] leading-[18px]', { colour: 'text-foreground-secondary' })
export const Caption = preset('text-xs font-medium leading-4', { colour: 'text-foreground-muted' })
export const Overline = preset('text-[11px] font-extrabold uppercase tracking-wider', { colour: 'text-foreground-muted' })
