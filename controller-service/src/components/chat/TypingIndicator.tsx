export default function TypingIndicator({ label }: { label?: string | null }) {
  return (
    <div className="flex justify-start pt-1.5" aria-live="polite">
      <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-surface-elevated border border-border-default px-3 py-2">
        <span className="flex gap-1">
          {[0, 150, 300].map(d => (
            <span key={d} className="w-1.5 h-1.5 rounded-full bg-foreground-muted animate-bounce" style={{ animationDelay: `${d}ms` }} />
          ))}
        </span>
        {label && <span className="text-[11px] text-foreground-muted">{label}</span>}
      </div>
    </div>
  )
}
