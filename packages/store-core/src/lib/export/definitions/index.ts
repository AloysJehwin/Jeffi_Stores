import 'server-only'
import type { ExportDefinition } from '../define'
import { GST_EXPORTS } from './gst'
import { FINANCIAL_EXPORTS } from './financial'
import { MARKETING_EXPORTS } from './marketing'
import { OPERATIONS_EXPORTS } from './operations'
import { CATALOG_EXPORTS } from './catalog'
import { INSIGHTS_EXPORTS } from './insights'

// Report exports (pages not backed by the filter registry), one module per admin area.

export const REPORT_EXPORTS: ExportDefinition[] = [...GST_EXPORTS, ...FINANCIAL_EXPORTS, ...MARKETING_EXPORTS, ...OPERATIONS_EXPORTS, ...CATALOG_EXPORTS, ...INSIGHTS_EXPORTS]
