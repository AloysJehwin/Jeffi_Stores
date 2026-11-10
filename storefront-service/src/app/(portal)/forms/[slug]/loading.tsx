import FormsTopNav from './FormsTopNav'

// The form's page palette is fixed light grays, so shimmer with gray-100. Step 1 depends on the form type.
function Bar({ className }: { className: string }) {
  return <span aria-hidden className={`sk block rounded bg-gray-100 ${className}`} />
}

function StepHead({ n, color }: { n: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-7 h-7 rounded-full ${color} text-white text-sm font-bold flex items-center justify-center shrink-0`}>{n}</span>
      <div className="flex-1 space-y-1.5">
        <Bar className="h-4 w-48" />
        <Bar className="h-3 w-36" />
      </div>
    </div>
  )
}

export default function Loading() {
  return (
    <>
      <FormsTopNav />
      <div className="min-h-[calc(100vh-48px)] bg-gradient-to-br from-slate-50 to-blue-50" role="status" aria-busy="true" aria-label="Loading form">
        <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
          <div className="text-center space-y-2">
            <Bar className="h-8 w-2/3 mx-auto" />
            <Bar className="h-4 w-4/5 mx-auto" />
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <StepHead n={1} color="bg-gray-300" />
            <Bar className="h-12 w-full rounded-xl" />
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="mb-4">
              <StepHead n={2} color="bg-green-500" />
            </div>
            <div className="space-y-4">
              <div>
                <span className="block text-sm font-medium text-gray-600 mb-1.5">Email Address *</span>
                <div className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-gray-400 text-sm">you@example.com</div>
              </div>
              <Bar className="h-32 w-full rounded-xl" />
              <div className="w-full py-3.5 bg-green-500 opacity-50 text-white rounded-xl font-bold text-center">Submit</div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
