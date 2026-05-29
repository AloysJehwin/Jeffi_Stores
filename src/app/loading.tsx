export default function Loading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center animate-fade-in">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-accent-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-foreground-muted">Loading...</p>
      </div>
    </div>
  )
}
