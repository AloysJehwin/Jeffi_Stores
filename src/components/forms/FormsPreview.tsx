interface CustomField {
  id: string
  label: string
  type: 'text' | 'textarea' | 'image' | 'rating'
  required: boolean
}

interface Props {
  title: string
  description: string
  googleReviewUrl: string
  couponId: string
  customFields: CustomField[]
}

function StarPreview() {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(s => (
        <span key={s} className="text-xl text-gray-300">★</span>
      ))}
    </div>
  )
}

export default function FormsPreview({ title, description, googleReviewUrl, couponId, customFields }: Props) {
  return (
    <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-xl overflow-hidden border border-gray-200">
      <div style={{ background: '#1a3a4a' }} className="px-4 py-3 flex items-center justify-between">
        <span className="text-white font-bold text-sm">Jeffi Store&apos;s</span>
        <span className="text-white/70 text-xs">Shop at Jeffi Stores →</span>
      </div>

      <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
        <div className="text-center">
          <h1 className="text-lg font-bold text-gray-800">{title || 'Form Title'}</h1>
          {description && <p className="text-gray-500 text-xs mt-1">{description}</p>}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div>
              <p className="font-semibold text-gray-800 text-sm">Leave us a Google review</p>
              <p className="text-xs text-gray-400">It takes less than a minute!</p>
            </div>
          </div>
          <div className="w-full py-2.5 bg-blue-500 text-white rounded-xl text-sm font-semibold text-center opacity-80">
            Open Google Review Page {googleReviewUrl ? '✓' : ''}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-green-500 text-white text-xs font-bold flex items-center justify-center">2</span>
            <div>
              <p className="font-semibold text-gray-800 text-sm">Submit your review screenshot</p>
              <p className="text-xs text-gray-400">{couponId ? 'Get your discount coupon instantly' : 'We\'ll verify your review'}</p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1">Email Address *</p>
              <div className="w-full px-3 py-2 border border-gray-200 rounded-xl text-gray-400 text-xs bg-gray-50">you@example.com</div>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-600 mb-1">Screenshot of your review *</p>
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-3 text-center">
                <p className="text-xl">📸</p>
                <p className="text-xs text-gray-400">Tap to upload</p>
              </div>
            </div>

            {customFields.map(field => (
              <div key={field.id}>
                <p className="text-xs font-medium text-gray-600 mb-1">{field.label || '(unnamed field)'}{field.required ? ' *' : ''}</p>
                {field.type === 'text' && (
                  <div className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 text-xs text-gray-400">Text answer…</div>
                )}
                {field.type === 'textarea' && (
                  <div className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-gray-50 text-xs text-gray-400 h-14">Long answer…</div>
                )}
                {field.type === 'image' && (
                  <div className="border-2 border-dashed border-gray-200 rounded-xl p-3 text-center">
                    <p className="text-lg">📎</p>
                    <p className="text-xs text-gray-400">Upload image</p>
                  </div>
                )}
                {field.type === 'rating' && <StarPreview />}
              </div>
            ))}

            <div className="w-full py-3 bg-green-500 text-white rounded-xl text-sm font-bold text-center opacity-80">
              Submit{couponId ? ' & Get Coupon' : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
