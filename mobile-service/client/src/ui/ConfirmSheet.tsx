import { View } from 'react-native'
import { create } from 'zustand'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { SheetHeader } from './ModalSheet'

// Alert.alert's replacement: `await confirm({...})` resolves true/false. One host at the app root.

interface ConfirmRequest {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  /** An acknowledgement with a single button. */
  alert?: boolean
}

interface ConfirmState {
  request: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null
  open: boolean
  settle: (ok: boolean) => void
}

const useConfirm = create<ConfirmState>((set, get) => ({
  request: null,
  open: false,
  settle: ok => {
    get().request?.resolve(ok)
    set({ open: false })
  },
}))

export function confirm(req: ConfirmRequest): Promise<boolean> {
  return new Promise(resolve => {
    useConfirm.getState().request?.resolve(false)
    useConfirm.setState({ request: { ...req, resolve }, open: true })
  })
}

/** A one-button notice ("Saved", "Couldn't do that"). */
export function notify(title: string, message?: string): Promise<boolean> {
  return confirm({ title, message, alert: true, confirmLabel: 'OK' })
}

export function ConfirmHost() {
  const { request, open, settle } = useConfirm()
  if (!request) return null
  return (
    <BottomSheet open={open} onClose={() => settle(false)} onClosed={() => {
      if (!useConfirm.getState().open) useConfirm.setState({ request: null })
    }}>
      <SheetHeader title={request.title} subtitle={request.message} />
      <View className="gap-2.5 pb-2">
        <Button
          label={request.confirmLabel ?? (request.destructive ? 'Delete' : 'Confirm')}
          variant={request.destructive ? 'destructive' : 'primary'}
          haptics
          onPress={() => settle(true)}
        />
        {request.alert ? null : <Button label={request.cancelLabel ?? 'Cancel'} variant="secondary" onPress={() => settle(false)} />}
      </View>
    </BottomSheet>
  )
}
