import { siteEditorEnabled } from '@/lib/site/store'
import SiteEditorLazy from './SiteEditorLazy'

/**
 * The visual editor's canvas bridge, for stores the editor is switched on for (site_settings site_editor_enabled).
 * Pages render it only with a Site Builder preview token, and the bridge loads in its own chunk, so live pages never
 * fetch it (tests/lib/site-editor-imports.test.ts).
 */
export default async function SiteEditorGate() {
  return (await siteEditorEnabled().catch(() => false)) ? <SiteEditorLazy /> : null
}
