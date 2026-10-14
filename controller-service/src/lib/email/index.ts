import 'server-only'

export { transporter } from './shared'
export { sendOTPEmail, sendAdminOTPEmail, sendWelcomeEmail } from './auth'
export { sendOrderConfirmationEmail, sendNewOrderNotification } from './order-confirmation'
export { sendOrderStatusUpdate, sendPaymentStatusUpdate } from './order-status'
export { sendAdminCertificateEmail, sendCertInviteEmail } from './certificates'
export {
  sendNewReviewNotification,
  sendPaymentFailedAdminNotification,
  sendAdminContactEmail,
  sendSupportEscalationEmail,
  sendAgentConnectedEmail,
} from './notifications'
export {
  sendReturnStatusEmail,
  sendPaymentRetryEmail,
  sendInvoiceFinalizedEmail,
  sendPurchaseOrderEmail,
  sendPOReceiveNotificationEmail,
  sendQuotationFinalizedEmail,
} from './fulfilment'
export {
  sendOrderAutoCancelledEmail,
  sendOrderAutoCancelledAdminNotification,
  sendOrderDelayNotification,
  sendProductAnnouncementEmail,
  sendVariantChangeRequestedEmail,
  sendOperationalReport,
} from './lifecycle'
