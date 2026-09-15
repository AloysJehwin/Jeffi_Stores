'use client'

import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant
  /** Size props mirror AdminSelect so a button and the field beside it read the same. */
  sm?: boolean
  xs?: boolean
  /** Square box for an icon with no label, so it still lines up in a row of fields. */
  iconOnly?: boolean
  className?: string
  children?: ReactNode
}

const VARIANTS: Record<ButtonVariant, string> = {
  // Borders are on EVERY variant — including a transparent one on the filled
  // variants — so each keeps the same box as a bordered input on its tier.
  primary:
    'border border-transparent bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 font-medium',
  secondary:
    'border border-border-default bg-surface hover:bg-surface-secondary text-foreground font-medium',
  ghost:
    'border border-transparent bg-transparent hover:bg-surface-secondary text-foreground-secondary hover:text-foreground',
  danger:
    'border border-transparent bg-red-600 hover:bg-red-700 text-white font-medium',
}

const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', sm, xs, iconOnly, className = '', type = 'button', children, ...rest },
  ref
) {
  const tier = xs ? 'control-xs' : sm ? 'control-sm' : 'control-md'
  return (
    <button
      ref={ref}
      type={type}
      className={`${tier}${iconOnly ? ' control-icon' : ''} ${VARIANTS[variant]} transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  )
})

export default Button
