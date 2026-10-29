import type { AgentAction, ActionResult, ActionHandler } from './shared'
import {
  sendTestEmail,
  toggleCampaignEnabled,
  sendOrderDelayEmail,
  sendProductAnnouncement,
  updateCampaignTemplate,
  sendMailerBroadcast,
} from './messaging'
import {
  markOrderShipped,
  callAdminApi,
  markInvoicePaid,
  updateOrderStatus,
  setPaymentStatus,
  cancelOrder,
  refundOrder,
} from './orders'
import { createQuotation, sendQuotationEmail } from './quotations'
import {
  createCoupon,
  generatePersonalizedCoupon,
  createProduct,
  updateProduct,
  adjustInventory,
  setProductFeatured,
  createBrand,
  createCategory,
} from './catalog'
import {
  addCustomerNote,
  addCustomerTag,
  removeCustomerTag,
  createCustomerTask,
  closeCustomerTask,
  toggleMarketingOptOut,
  createTagDefinition,
} from './customers'
import { createPickupRequest, syncDelhiveryStatuses, payPayable, exportGstr1 } from './ops'
import { runGoogleAdsAction } from './google-ads'

const HANDLERS: Record<string, ActionHandler> = {
  send_test_email: sendTestEmail,
  toggle_campaign_enabled: toggleCampaignEnabled,
  mark_order_shipped: markOrderShipped,
  send_order_delay_email: sendOrderDelayEmail,
  send_product_announcement_email: sendProductAnnouncement,
  call_admin_api: callAdminApi,
  create_quotation: createQuotation,
  send_quotation_email: sendQuotationEmail,
  mark_invoice_paid: markInvoicePaid,
  update_order_status: updateOrderStatus,
  set_payment_status: setPaymentStatus,
  cancel_order: cancelOrder,
  refund_order: refundOrder,
  create_coupon: createCoupon,
  update_campaign_template: updateCampaignTemplate,
  send_mailer_broadcast: sendMailerBroadcast,
  generate_personalized_coupon: generatePersonalizedCoupon,
  create_product: createProduct,
  update_product: updateProduct,
  adjust_inventory: adjustInventory,
  set_product_featured: setProductFeatured,
  create_brand: createBrand,
  create_category: createCategory,
  add_customer_note: addCustomerNote,
  add_customer_tag: addCustomerTag,
  remove_customer_tag: removeCustomerTag,
  create_customer_task: createCustomerTask,
  close_customer_task: closeCustomerTask,
  toggle_marketing_opt_out: toggleMarketingOptOut,
  create_tag_definition: createTagDefinition,
  create_pickup_request: createPickupRequest,
  sync_delhivery_statuses: syncDelhiveryStatuses,
  pay_payable: payPayable,
  export_gstr1: exportGstr1,
  google_ads_action: runGoogleAdsAction,
}

export async function executeAction(action: AgentAction, cookieHeader: string): Promise<ActionResult> {
  const handler = HANDLERS[action.kind]
  if (!handler) return { result: null, error: `Unknown action kind: ${action.kind}` }
  // A throw (network, DB) still settles the action as failed instead of leaving it 'approved'.
  try {
    return await handler(action, cookieHeader)
  } catch (err: any) {
    return { result: null, error: String(err?.message || 'Action failed') }
  }
}
