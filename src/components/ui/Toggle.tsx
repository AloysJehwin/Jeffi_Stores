'use client'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  id?: string
  size?: 'sm' | 'md'
}

export default function Toggle({ checked, onChange, disabled, label, id, size = 'md' }: ToggleProps) {
  const isSm = size === 'sm'

  const trackStyle = isSm ? { width: 28, height: 16 } : { width: 40, height: 22 }
  const thumbStyle = isSm ? { width: 12, height: 12, top: 2, left: 2 } : { width: 16, height: 16, top: 3, left: 3 }
  const translateOn = isSm ? 12 : 18

  return (
    <label
      className={`inline-flex items-center gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} select-none`}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={trackStyle}
        className={[
          'relative shrink-0 rounded-full transition-colors duration-200',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2',
          checked ? 'bg-accent-500' : 'bg-neutral-300 dark:bg-neutral-600',
        ].join(' ')}
      >
        <span
          style={{
            width: thumbStyle.width,
            height: thumbStyle.height,
            top: thumbStyle.top,
            left: thumbStyle.left,
            transform: checked ? `translateX(${translateOn}px)` : 'translateX(0)',
          }}
          className="absolute rounded-full bg-white shadow-sm transition-transform duration-200"
        />
      </button>
      {label && <span className={`text-foreground-secondary ${isSm ? 'text-xs' : 'text-sm'}`}>{label}</span>}
    </label>
  )
}
