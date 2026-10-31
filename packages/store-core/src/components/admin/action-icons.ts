import type { LucideIcon } from 'lucide-react'
import {
  Eye,
  Pencil,
  Trash2,
  Send,
  Play,
  Power,
  Download,
  ExternalLink,
  Mail,
  Printer,
  Copy,
  ShieldOff,
  FileText,
} from 'lucide-react'

// Single source of truth for action kind → icon + default label, so every admin surface pulls the same
// glyph/label for a given action. Callers can override label/icon per use.
export type ActionKind =
  | 'view'
  | 'edit'
  | 'delete'
  | 'send'
  | 'run'
  | 'toggle'
  | 'download'
  | 'open'
  | 'email'
  | 'print'
  | 'duplicate'
  | 'revoke'
  | 'document'

export const ACTION_ICONS: Record<ActionKind, { icon: LucideIcon; label: string; danger?: boolean }> = {
  view: { icon: Eye, label: 'View' },
  edit: { icon: Pencil, label: 'Edit' },
  delete: { icon: Trash2, label: 'Delete', danger: true },
  send: { icon: Send, label: 'Send' },
  run: { icon: Play, label: 'Run now' },
  toggle: { icon: Power, label: 'Toggle' },
  download: { icon: Download, label: 'Download' },
  open: { icon: ExternalLink, label: 'Open' },
  email: { icon: Mail, label: 'Email' },
  print: { icon: Printer, label: 'Print' },
  duplicate: { icon: Copy, label: 'Duplicate' },
  revoke: { icon: ShieldOff, label: 'Revoke', danger: true },
  document: { icon: FileText, label: 'Document' },
}
