export {
  VARIANT_STOCK_TOTAL_SQL,
  VARIANT_INVENTORY_TOTAL_SQL,
  VARIANT_MIN_PRICE_SQL,
  VARIANT_MIN_PRICE_INCL_GST_SQL,
  VARIANT_MIN_PRICE_EX_GST_SQL,
  VARIANT_MIN_MRP_SQL,
  EFFECTIVE_STOCK_SQL,
  EFFECTIVE_PRICE_SQL,
  type AnalyticsRange,
  type RevenuePeriod,
} from './shared'
export {
  getAllProducts,
  getProduct,
  getAllCategories,
  getAllBrands,
  getCategoriesWithProducts,
  getBrandsWithProducts,
  getFilteredProducts,
  getFilteredCategories,
} from './catalog'
export {
  getBrochureProductsByCategories,
  getBrochureProductsByBrands,
  getBrochureProductsByIds,
  type BrochureProduct,
} from './brochure'
export { getAllOrders, getFilteredOrders, getRecentOrders, getOrder, getReturnRequest } from './orders'
export { getCustomers, getCustomerById } from './customers'
export {
  getDashboardStats,
  getDashboardMetrics,
  getDashboardAnalytics,
  type DashboardAnalytics,
} from './dashboard'
export {
  getRevenueTrendBySource,
  getProductBreakdowns,
  getCustomerStats,
  getCustomerSegments,
  getCustomerChannelMix,
  type RevenueTrend,
  type BreakdownSlice,
  type ProductStats,
  type CustomerStats,
} from './analytics'
