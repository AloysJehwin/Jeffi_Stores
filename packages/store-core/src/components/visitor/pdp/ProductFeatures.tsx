/** The AI-enriched features, use cases, users and application; renders nothing when the product has none. */
export default function ProductFeatures({ product }: { product: Record<string, any> }) {
  const p = product
  const hasFeatures = p.ai_features?.length > 0
  const hasUseCases = p.ai_use_cases?.length > 0
  const hasWhoUses = p.ai_who_uses_it
  const hasApplication = p.ai_application

  if (!hasFeatures && !hasUseCases && !hasWhoUses && !hasApplication) return null

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 sm:p-8 mb-8">
      <h2 className="text-xl font-bold text-foreground mb-6">Features &amp; Use Cases</h2>
      <div className="space-y-6">
        {hasFeatures && (
          <div>
            <p className="text-xs text-foreground-muted mb-2 uppercase tracking-wide">Key Features</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-1.5">
              {(p.ai_features as string[]).map((f: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
        {hasUseCases && (
          <>
            {hasFeatures && <div className="border-t border-border-default" />}
            <div>
              <p className="text-xs text-foreground-muted mb-2 uppercase tracking-wide">Use Cases</p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-1.5">
                {(p.ai_use_cases as string[]).map((u: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                    {u}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        {(hasWhoUses || hasApplication) && (
          <>
            {(hasFeatures || hasUseCases) && <div className="border-t border-border-default" />}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-5">
              {hasWhoUses && (
                <div>
                  <p className="text-xs text-foreground-muted mb-0.5">Who Uses It</p>
                  <p className="font-semibold text-foreground text-sm">{p.ai_who_uses_it}</p>
                </div>
              )}
              {hasApplication && (
                <div>
                  <p className="text-xs text-foreground-muted mb-0.5">Application</p>
                  <p className="font-semibold text-foreground text-sm">{p.ai_application}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
