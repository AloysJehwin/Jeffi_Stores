import { Sk } from '@/components/admin/kit/skeleton'
import PortalTopNav from '@/components/portal/PortalTopNav'
import { STAFF_NOTES } from '@/lib/tenancy/portal-config'
import { NOTE_TAGS } from '@/lib/shared/customer-notes-shared'

// The signed-in note form. The page picks mobile or desktop by user agent; here the breakpoint stands in.
const SECTION = 'rounded-2xl border border-border-default bg-surface-elevated p-5'
const FIELD = 'w-full border border-border-secondary rounded-xl bg-surface text-foreground-muted'
const TILE = 'flex items-center justify-center py-4 rounded-xl border-2 border-dashed border-border-secondary text-sm font-medium'

function Heading() {
  return (
    <>
      <h1 className="text-2xl font-bold">Customer note</h1>
      <p className="flex items-center gap-1 text-xs text-foreground-muted mt-1">
        Signed in as <Sk className="inline-block h-3 w-32" />
      </p>
    </>
  )
}

function CustomerSearch() {
  return (
    <div className="flex gap-2">
      <div className={`${FIELD} px-4 py-3 text-base`}>Name, phone, email or order number</div>
      <span className="flex items-center px-3 rounded-xl border border-border-secondary text-xs font-medium shrink-0">Scan</span>
    </div>
  )
}

function Attachments({ mobile }: { mobile: boolean }) {
  return (
    <div className="space-y-4">
      <div>
        <span className="block text-sm font-medium mb-1.5">Photos</span>
        <div className={`grid gap-2 ${mobile ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {mobile && <span className={TILE}>Take photo</span>}
          <span className={TILE}>{mobile ? 'Choose from gallery' : 'Choose or drop photos'}</span>
        </div>
        <p className="text-[11px] text-foreground-muted mt-1">Up to 8 attachments. Handwritten notes, sketches, measurements.</p>
      </div>
      <div className="rounded-xl border border-border-default p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Voice memo</p>
            <p className="text-[11px] text-foreground-muted">Optional. Saved as an audio attachment.</p>
          </div>
          <span className="px-4 py-2 rounded-xl text-sm font-semibold bg-surface-secondary text-foreground border border-border-secondary">Record</span>
        </div>
      </div>
    </div>
  )
}

function Tags({ mobile }: { mobile: boolean }) {
  return (
    <div className={`flex flex-wrap ${mobile ? 'gap-2' : 'gap-1.5'}`}>
      {NOTE_TAGS.map(t => (
        <span
          key={t}
          className={`${mobile ? 'px-3 py-1.5' : 'px-2.5 py-1'} rounded-full text-xs font-medium border bg-surface border-border-secondary text-foreground-secondary`}
        >
          {t}
        </span>
      ))}
    </div>
  )
}

export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col bg-surface text-foreground" role="status" aria-busy="true" aria-label="Loading">
      <PortalTopNav
        title={STAFF_NOTES.navTitle}
        homeHref={STAFF_NOTES.homeHref}
        right={<span className="text-sm text-white/80">Sign out</span>}
      />

      <main className="lg:hidden flex-1 w-full px-4 pt-5 pb-28">
        <Heading />
        <section className="mt-6">
          <span className="block text-sm font-medium mb-1.5">Customer</span>
          <CustomerSearch />
        </section>
        <section className="mt-5">
          <Attachments mobile />
        </section>
        <section className="mt-5 space-y-3">
          <div className={`${FIELD} px-4 py-3 text-base`}>Title (optional)</div>
          <div className={`${FIELD} px-4 py-3 text-base h-[6.5rem]`}>Typed note (optional)</div>
          <Tags mobile />
          <div className="flex items-center gap-3 rounded-xl border border-border-default p-3 text-sm">
            <span className="w-5 h-5 rounded border border-border-secondary shrink-0" />
            <span>
              Share with the customer{' '}
              <span className="block text-[11px] text-foreground-muted">Shows on their order page. Leave off for internal notes.</span>
            </span>
          </div>
        </section>
        <div className="fixed bottom-0 inset-x-0 p-4 bg-surface/95 backdrop-blur border-t border-border-default">
          <div className="w-full py-3.5 rounded-xl bg-accent-500 text-white font-semibold text-base text-center opacity-50">Save note</div>
        </div>
      </main>

      <main className="hidden lg:block flex-1 w-full px-8 py-10">
        <div className="mx-auto w-full max-w-6xl">
          <Heading />
          <div className="mt-8 grid grid-cols-5 gap-8">
            <div className="col-span-3 space-y-6">
              <section className={SECTION}>
                <span className="block text-sm font-medium mb-2">Customer</span>
                <CustomerSearch />
              </section>
              <section className={SECTION}>
                <Attachments mobile={false} />
              </section>
            </div>
            <div className="col-span-2 space-y-6">
              <section className={SECTION}>
                <div className="space-y-3">
                  <div className={`${FIELD} px-4 py-2.5 text-sm`}>Title (optional)</div>
                  <div className={`${FIELD} px-4 py-2.5 text-sm h-[9.25rem]`}>Typed note (optional)</div>
                  <Tags mobile={false} />
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-4 h-4 rounded border border-border-secondary shrink-0" />
                    Share with the customer
                  </div>
                  <div className="w-full py-2.5 rounded-xl bg-accent-500 text-white font-semibold text-sm text-center opacity-50">Save note</div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
