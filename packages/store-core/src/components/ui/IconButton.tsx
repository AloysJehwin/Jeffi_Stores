'use client'

import { forwardRef } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import Tooltip from '@/components/ui/Tooltip'

type Variant = 'default' | 'accent' | 'danger'
type Size = 'sm' | 'md'

interface BaseProps {
  icon: LucideIcon
  /** Required — becomes the aria-label AND the tooltip content (replaces native title=). */
  label: string
  variant?: Variant
  size?: Size
  disabled?: boolean
  /** Shows a spinner in place of the icon and disables the control. */
  busy?: boolean
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}
type AsButton = BaseProps & { onClick: () => void; href?: never; target?: never; download?: never }
type AsLink = BaseProps & { href: string; onClick?: never; target?: string; download?: boolean }
export type IconButtonProps = AsButton | AsLink

const VARIANT_CLASSES: Record<Variant, string> = {
  default: 'text-foreground-secondary hover:bg-surface-secondary hover:text-foreground',
  accent: 'text-foreground-secondary hover:bg-surface-secondary hover:text-accent-500',
  danger: 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
}

/**
 * A single lucide-icon action button with an accessible label (aria-label + Tooltip).
 * Renders a <Link> when given `href`, otherwise a <button>.
 */
const IconButton = forwardRef<HTMLElement, IconButtonProps>(function IconButton(props, ref) {
  const {
    icon: Icon,
    label,
    variant = 'default',
    size = 'md',
    disabled,
    busy,
    tooltipPosition = 'top',
    className = '',
  } = props
  const isDisabled = disabled || busy
  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'
  const classes = `inline-flex items-center justify-center p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none ${VARIANT_CLASSES[variant]} ${className}`

  const inner = busy ? <Loader2 className={`${iconSize} animate-spin`} /> : <Icon className={iconSize} />

  const control =
    'href' in props && props.href !== undefined && !isDisabled ? (
      <Link
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={props.href}
        target={props.target}
        download={props.download}
        aria-label={label}
        className={classes}
      >
        {inner}
      </Link>
    ) : (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        onClick={'onClick' in props ? props.onClick : undefined}
        disabled={isDisabled}
        aria-label={label}
        className={classes}
      >
        {inner}
      </button>
    )

  return (
    <Tooltip content={label} position={tooltipPosition}>
      {control}
    </Tooltip>
  )
})

export default IconButton
