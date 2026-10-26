import 'server-only'
import { INVOICES_ENTITY, PURCHASE_ORDERS_ENTITY, QUOTATIONS_ENTITY, type FilterEntity } from '@jeffi/list-filters'
import { ORDERS_ENTITY } from './entities/orders'
import { REPLACEMENTS_ENTITY, RETURNS_ENTITY } from './entities/returns'
import { PACKING_ENTITY } from './entities/packing-slips'
import { RFQ_ENTITY } from './entities/business-rfqs'
import { B2B_ENTITY } from './entities/business-customers'
import { MESSAGING_ENTITY } from './entities/messaging'
import { AMAZON_LISTINGS_ENTITY } from './entities/amazon-listings'
import { WALLET_ENTITY } from './entities/wallet'
import { CASH_SALE_ENTITY } from './entities/cash-sale'
import { LEDGER_ENTITY, VALUATION_ENTITY } from './entities/inventory'
import { CUSTOMERS_ENTITY } from './entities/customers'
import { PRODUCTS_ENTITY } from './entities/products'
import { COUPONS_ENTITY } from './entities/coupons'
import { SUBSCRIPTIONS_ENTITY } from './entities/subscriptions'
import { BRANDS_ENTITY } from './entities/brands'
import { CATEGORIES_ENTITY } from './entities/categories'
import { REVIEWS_ENTITY } from './entities/reviews'
import { REVIEW_FORMS_ENTITY } from './entities/review-forms'
import { SUPPLIERS_ENTITY } from './entities/suppliers'
import { TASKS_ENTITY } from './entities/tasks'

// Every filterable admin list, by key. Field definitions (client-safe) live in ./fields.
export const FILTER_ENTITIES: Record<string, FilterEntity> = {
  orders: ORDERS_ENTITY as unknown as FilterEntity,
  returns: RETURNS_ENTITY as unknown as FilterEntity,
  replacements: REPLACEMENTS_ENTITY as unknown as FilterEntity,
  business_rfqs: RFQ_ENTITY as unknown as FilterEntity,
  business_customers: B2B_ENTITY as unknown as FilterEntity,
  messaging: MESSAGING_ENTITY as unknown as FilterEntity,
  'amazon.listings': AMAZON_LISTINGS_ENTITY as unknown as FilterEntity,
  wallet: WALLET_ENTITY as unknown as FilterEntity,
  packing_slips: PACKING_ENTITY as unknown as FilterEntity,
  cash_sale: CASH_SALE_ENTITY as unknown as FilterEntity,
  'inventory.ledger': LEDGER_ENTITY as unknown as FilterEntity,
  'inventory.valuation': VALUATION_ENTITY as unknown as FilterEntity,
  customers: CUSTOMERS_ENTITY as unknown as FilterEntity,
  products: PRODUCTS_ENTITY,
  coupons: COUPONS_ENTITY as unknown as FilterEntity,
  subscriptions: SUBSCRIPTIONS_ENTITY as unknown as FilterEntity,
  // Lists served by document-service; their registries live in the package so both services share them.
  invoices: INVOICES_ENTITY as unknown as FilterEntity,
  quotations: QUOTATIONS_ENTITY as unknown as FilterEntity,
  'purchase-orders': PURCHASE_ORDERS_ENTITY as unknown as FilterEntity,
  brands: BRANDS_ENTITY as unknown as FilterEntity,
  categories: CATEGORIES_ENTITY as unknown as FilterEntity,
  reviews: REVIEWS_ENTITY as unknown as FilterEntity,
  review_forms: REVIEW_FORMS_ENTITY as unknown as FilterEntity,
  suppliers: SUPPLIERS_ENTITY as unknown as FilterEntity,
  tasks: TASKS_ENTITY as unknown as FilterEntity,
}

export function getEntity(key: string): FilterEntity | null {
  return Object.hasOwn(FILTER_ENTITIES, key) ? FILTER_ENTITIES[key] : null
}
