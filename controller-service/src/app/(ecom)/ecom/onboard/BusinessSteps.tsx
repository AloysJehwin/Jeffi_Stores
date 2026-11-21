'use client'

import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import DatePicker from '@/components/ui/DatePicker'
import { stateFromPincode } from '@/lib/shipping/india-pincode-state'
import { ChoiceCards } from '../_ui'
import { Card } from '../dashboard/_components/Card'
import { fieldInput, fieldLabel, noteCls } from './ui'
import { todayIst } from '@controller/lib/catalog/compliance'
import { ENTITY_TYPES, checkGstin, checkPan, idChars, type EntityType } from '@controller/lib/kyb/ids'
import { KYB_DOCS, docNumberProblem, formatDocNumber, registrationDocsFor } from '@controller/lib/kyb/requirements'
import { GST_EXEMPT_REASONS, INDIAN_STATES, SIGNATORY_TITLE, patchDoc, type GstExemptReason, type KybState, type KybUpload } from './kyb'

// The wizard's Business and GST steps: what KYB needs to know about the business (lib/kyb), checked as the owner types.
// The documents are rendered by the wizard (renderDoc), which runs their automatic check.

const inp = fieldInput
const lbl = fieldLabel
const optional = <span className="font-normal text-foreground-muted">(optional)</span>
const errCls = 'mt-1 text-xs text-[#8a2e1f]'
const hintCls = 'mt-1 text-xs text-foreground-muted'

interface StepProps {
  value: KybState
  onChange: Dispatch<SetStateAction<KybState>>
  renderDoc: (docType: string, label: string) => ReactNode
}

export function StateSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return <AdminSelect id={id} value={value} onChange={onChange} placeholder="Pick a state" options={INDIAN_STATES.map(s => ({ value: s, label: s }))} />
}

/** An ID field's message waits until it is left or full, not while it is typed. */
function useLeft() {
  const [left, setLeft] = useState(false)
  return [left, () => setLeft(true)] as const
}

export function BusinessStep({ value: k, onChange, renderDoc }: StepProps) {
  const set = (patch: Partial<KybState>) => onChange(v => ({ ...v, ...patch }))
  const [panLeft, leavePan] = useLeft()
  const panCheck = checkPan(k.pan, k.entityType || null)
  const panError = !!k.pan && !panCheck.ok && (panLeft || k.pan.length >= 10) ? panCheck.problem : null

  const setEntity = (e: EntityType) =>
    onChange(v => ({
      ...v,
      entityType: e,
      // The usual title follows the type until the owner types their own.
      signatoryDesignation: !v.signatoryDesignation.trim() || (v.entityType && v.signatoryDesignation === SIGNATORY_TITLE[v.entityType]) ? SIGNATORY_TITLE[e] : v.signatoryDesignation,
      regDocType: registrationDocsFor(e).includes(v.regDocType) ? v.regDocType : '',
    }))

  return (
    <div className="space-y-4">
      <Card title="Your business">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <label htmlFor="biz-name" className={lbl}>
                Legal name
              </label>
              <input id="biz-name" className={inp} maxLength={200} value={k.bizName} onChange={e => set({ bizName: e.target.value })} />
              <p className={hintCls}>As on the PAN and registration. For a sole proprietorship, usually the proprietor’s name.</p>
            </div>
            <div>
              <label htmlFor="biz-trade-name" className={lbl}>
                Trade name {optional}
              </label>
              <input id="biz-trade-name" className={inp} maxLength={200} value={k.tradeName ?? ''} onChange={e => set({ tradeName: e.target.value })} />
              <p className={hintCls}>The name you trade under, if it differs from the legal name.</p>
            </div>
          </div>
          <div>
            <span className={lbl}>Business type</span>
            <ChoiceCards
              ariaLabel="Business type"
              columns="grid-cols-2 xl:grid-cols-5"
              cardClassName="px-3 py-2.5 text-sm"
              value={k.entityType || null}
              onChange={setEntity}
              options={ENTITY_TYPES.map(t => ({ value: t.id, label: <span className="font-medium">{t.label}</span> }))}
            />
          </div>
        </div>
      </Card>

      <Card title="Registered address">
        <div className="space-y-4">
          <div>
            <label htmlFor="biz-address" className={lbl}>
              Address
            </label>
            <input
              id="biz-address"
              className={inp}
              maxLength={300}
              autoComplete="street-address"
              placeholder="Building, street and area"
              value={k.addrLine}
              onChange={e => set({ addrLine: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="biz-city" className={lbl}>
                City
              </label>
              <input id="biz-city" className={inp} maxLength={100} autoComplete="address-level2" value={k.addrCity} onChange={e => set({ addrCity: e.target.value })} />
            </div>
            <div>
              <label htmlFor="biz-state" className={lbl}>
                State
              </label>
              <StateSelect id="biz-state" value={k.addrState} onChange={addrState => set({ addrState })} />
            </div>
            <div>
              <label htmlFor="biz-pin" className={lbl}>
                PIN code
              </label>
              <input
                id="biz-pin"
                className={inp}
                inputMode="numeric"
                maxLength={6}
                autoComplete="postal-code"
                value={k.addrPin}
                onChange={e => {
                  const addrPin = e.target.value.replace(/\D/g, '').slice(0, 6)
                  // The state follows from most PIN codes; one already picked stays.
                  const state = !k.addrState && addrPin.length === 6 ? stateFromPincode(addrPin) : null
                  set({ addrPin, ...(state ? { addrState: state } : {}) })
                }}
              />
              {k.addrPin.length === 6 && !/^[1-9]/.test(k.addrPin) ? <p className={errCls}>A PIN code doesn’t start with 0.</p> : k.addrPin && k.addrPin.length !== 6 ? <p className={errCls}>6 digits</p> : null}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Authorised signatory">
        <p className="-mt-2 mb-4 text-xs text-foreground-muted">The person who signs for the business: the proprietor, a partner or a director.</p>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <label htmlFor="biz-signatory" className={lbl}>
              Full name
            </label>
            <input id="biz-signatory" className={inp} maxLength={120} autoComplete="name" value={k.signatoryName} onChange={e => set({ signatoryName: e.target.value })} />
            {k.entityType === 'proprietor' && <p className={hintCls}>Your PAN card is checked against this name.</p>}
          </div>
          <div>
            <label htmlFor="biz-designation" className={lbl}>
              Designation
            </label>
            <input
              id="biz-designation"
              className={inp}
              maxLength={80}
              placeholder="e.g. Director"
              value={k.signatoryDesignation}
              onChange={e => set({ signatoryDesignation: e.target.value })}
            />
          </div>
        </div>
      </Card>

      <Card title="PAN">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <label htmlFor="biz-pan" className={lbl}>
              PAN
            </label>
            <input
              id="biz-pan"
              className={inp}
              value={k.pan}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!panError}
              aria-describedby="biz-pan-hint"
              onChange={e => set({ pan: idChars(e.target.value, 10) })}
              onBlur={leavePan}
            />
            {panError ? (
              <p id="biz-pan-hint" className={errCls}>
                {panError}
              </p>
            ) : (
              <p id="biz-pan-hint" className={hintCls}>
                {k.entityType === 'proprietor' ? 'Your own PAN: a sole proprietorship has no separate PAN.' : 'The business’s own PAN, not a partner’s or director’s.'}
              </p>
            )}
          </div>
          {renderDoc('pan_card', 'PAN card')}
        </div>
      </Card>
    </div>
  )
}

export function GstStep({ value: k, onChange, renderDoc }: StepProps) {
  const set = (patch: Partial<KybState>) => onChange(v => ({ ...v, ...patch }))
  const [gstLeft, leaveGst] = useLeft()
  const [numberLeft, leaveNumber] = useLeft()
  const gstCheck = checkGstin(k.gstNumber, { pan: k.pan, state: k.addrState })
  const gstError = !!k.gstNumber && !gstCheck.ok && (gstLeft || k.gstNumber.length >= 15) ? gstCheck.problem : null

  const proofs = registrationDocsFor(k.entityType || null)
  const spec = k.regDocType ? KYB_DOCS[k.regDocType] : null
  const proof: KybUpload | undefined = k.regDocType ? k.kybDocs[k.regDocType] : undefined
  const patchProof = (patch: Partial<KybUpload>) => onChange(v => patchDoc(v, v.regDocType, patch))
  const numberProblem = k.regDocType && numberLeft ? docNumberProblem(k.regDocType, proof?.number) : null

  return (
    <div className="space-y-4">
      <Card title="GST registration">
        <div className="space-y-5">
          <div>
            <span className={lbl}>Is the business registered for GST?</span>
            <ChoiceCards
              ariaLabel="Registered for GST"
              columns="grid-cols-1 sm:grid-cols-2"
              cardClassName="px-4 py-3"
              value={k.gstRegistered === null ? null : k.gstRegistered ? 'yes' : 'no'}
              onChange={v => set({ gstRegistered: v === 'yes' })}
              options={[
                { value: 'yes', label: 'Yes, it has a GSTIN' },
                { value: 'no', label: 'No, it isn’t registered', description: 'We ask for a reason and a document that shows the business exists.' },
              ]}
            />
          </div>

          {k.gstRegistered === true && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div>
                <label htmlFor="gst-number" className={lbl}>
                  GSTIN
                </label>
                <input
                  id="gst-number"
                  className={inp}
                  value={k.gstNumber}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!gstError}
                  aria-describedby="gst-number-hint"
                  onChange={e => set({ gstNumber: idChars(e.target.value, 15) })}
                  onBlur={leaveGst}
                />
                {gstError ? (
                  <p id="gst-number-hint" className={errCls}>
                    {gstError}
                  </p>
                ) : (
                  <p id="gst-number-hint" className={hintCls}>
                    15 characters, as on your GST certificate. It carries your PAN and your state’s code. Never enter another business’s number.
                  </p>
                )}
              </div>
              {renderDoc('gst_cert', 'GST registration certificate')}
            </div>
          )}

          {k.gstRegistered === false && (
            <div className="space-y-4">
              <div>
                <span className={lbl}>Why isn’t it registered?</span>
                <ChoiceCards<GstExemptReason>
                  ariaLabel="Why the business isn’t registered for GST"
                  columns="grid-cols-1 sm:grid-cols-2"
                  cardClassName="px-4 py-3"
                  value={k.gstExemptReason || null}
                  onChange={gstExemptReason => set({ gstExemptReason })}
                  options={GST_EXEMPT_REASONS.map(r => ({ value: r.id, label: r.label }))}
                />
              </div>
              {k.gstExemptReason && (
                <div>
                  <label htmlFor="gst-exempt-note" className={lbl}>
                    {k.gstExemptReason === 'other' ? 'Tell us why' : <>Anything to add {optional}</>}
                  </label>
                  <textarea
                    id="gst-exempt-note"
                    className={`${inp} h-20 resize-none`}
                    maxLength={500}
                    placeholder={k.gstExemptReason === 'applied' ? 'For example: the ARN of your application.' : undefined}
                    value={k.gstExemptNote}
                    onChange={e => set({ gstExemptNote: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {k.gstRegistered === false && (
        <Card title="Registration proof">
          <p className="-mt-2 mb-4 text-xs text-foreground-muted">Without GST, upload one document that shows the business is registered.</p>
          <ChoiceCards
            ariaLabel="Registration proof"
            columns="grid-cols-1 sm:grid-cols-2"
            cardClassName="px-4 py-3"
            value={proofs.includes(k.regDocType) ? k.regDocType : null}
            onChange={regDocType => set({ regDocType })}
            options={proofs.map(t => ({ value: t, label: KYB_DOCS[t].label, description: KYB_DOCS[t].hint }))}
          />
          {spec && proofs.includes(k.regDocType) && (
            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="space-y-4">
                {spec.numberLabel && (
                  <div>
                    <label htmlFor="reg-number" className={lbl}>
                      {spec.numberLabel}
                    </label>
                    <input
                      id="reg-number"
                      className={inp}
                      maxLength={64}
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      value={proof?.number ?? ''}
                      onChange={e => patchProof({ number: e.target.value.toUpperCase() })}
                      onBlur={e => {
                        leaveNumber()
                        if (e.target.value.trim()) patchProof({ number: formatDocNumber(k.regDocType, e.target.value) })
                      }}
                    />
                    {numberProblem && <p className={errCls}>{numberProblem}</p>}
                  </div>
                )}
                {spec.expires && (
                  <div>
                    <span className={lbl}>Valid until {optional}</span>
                    <DatePicker
                      aria-label="Valid until"
                      className="w-full"
                      triggerClassName={inp}
                      placeholder="Pick a date, if it lapses"
                      min={todayIst()}
                      clearable
                      value={proof?.expiresOn ?? ''}
                      onChange={expiresOn => patchProof({ expiresOn })}
                    />
                  </div>
                )}
              </div>
              {renderDoc(k.regDocType, KYB_DOCS[k.regDocType].label)}
            </div>
          )}
        </Card>
      )}

      <div className={`${noteCls} org-peach`}>
        Each document is checked automatically when you upload it, and the Jeffi Commerce team reviews them with your licences before your store goes live. This
        usually takes 1–2 business days.
      </div>
    </div>
  )
}
