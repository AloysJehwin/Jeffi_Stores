import { REVIEW_TAGS } from './tags'

// The page's own light palette, so the shimmer blocks use gray-100 rather than the theme surface.
function Bar({ className }: { className: string }) {
  return <span aria-hidden className={`sk block rounded bg-gray-100 ${className}`} />
}

export default function ReviewSkeleton({ storeName, rating = 5 }: { storeName?: string; rating?: number }) {
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4" role="status" aria-busy="true" aria-label="Loading review">
      <div className="max-w-lg mx-auto">
        <div className="mb-6 text-center">
          {storeName ? (
            <span className="text-xl font-bold text-[#1a3a4a]">{storeName}</span>
          ) : (
            <Bar className="h-7 w-40 mx-auto" />
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <div>
            <h1 className="text-xl font-bold text-gray-800">How did we do?</h1>
            <p className="text-sm text-gray-500 mt-1">Share your experience to help other customers</p>
          </div>

          <div className="flex items-center gap-3 py-3 border-y border-gray-100">
            <Bar className="w-14 h-14 rounded-lg flex-shrink-0" />
            <Bar className="h-4 w-3/5" />
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              Your rating <span className="text-red-500">*</span>
            </p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <span key={n} className="text-4xl leading-none">
                  <span className={rating >= n ? 'text-yellow-400' : 'text-gray-200'}>★</span>
                </span>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">
              What did you like? <span className="text-gray-400">(optional)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {REVIEW_TAGS.map(tag => (
                <span key={tag} className="px-3 py-1.5 rounded-full text-xs font-medium border bg-gray-50 text-gray-600 border-gray-200">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Review title <span className="text-gray-400">(optional)</span>
            </span>
            <div className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-400">Summarise your experience</div>
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Your review <span className="text-red-500">*</span>
            </span>
            <div className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-400 h-[6.5rem]">
              Tell others about your experience…
            </div>
          </div>

          <div className="w-full py-3 rounded-lg bg-[#e07b3f] text-white text-sm font-bold text-center">Submit Review</div>
        </div>
      </div>
    </div>
  )
}
