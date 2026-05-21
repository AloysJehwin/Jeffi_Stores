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
  const trackSm = 'w-7 h-4'
  const thumbSm = 'w-3 h-3 top-0.5 left-0.5'
  const thumbSmOn = 'translate-x-3'
  const trackMd = 'w-10 h-5.5'
  const thumbMd = 'w-4 h-4 top-[3px] left-[3px]'
  const thumbMdOn = 'translate-x-[18px]'

  const track = size === 'sm' ? trackSm : trackMd
  const thumb = size === 'sm' ? thumbSm : thumbMd
  const thumbOn = size === 'sm' ? thumbSmOn : thumbMdOn

  return (
    <label
      htmlFor={id}
      className={`inline-flex items-center gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} select-none`}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1 ${track} ${
          checked
            ? 'bg-accent-500'
            : 'bg-surface-secondary border border-border-default'
        }`}
      >
        <span
          className={`absolute rounded-full bg-white shadow transition-transform duration-200 ${thumb} ${checked ? thumbOn : 'translate-x-0'}`}
        />
      </button>
      {label && (
        <span className="text-sm text-foreground-secondary">{label}</span>
      )}
    </label>
  )
}
