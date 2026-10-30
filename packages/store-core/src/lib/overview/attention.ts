// One "needs attention" row in an overview; built by lib/overviews, rendered by the kit's AttentionList.
export interface AttentionItem {
  key: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  sub?: string
  href?: string
}
