import nodemailer from 'nodemailer'
import { queryMany } from './db'
import { sendAuditedMail } from './mail-audit'
import { customerMailFrom, adminMailFrom, currentBrandName } from './brand'

/**
 * Store name for email bodies. Synchronous on purpose: templates are built inside string
 * literals, and currentBrandName reads the tenant from AsyncLocalStorage, so it resolves the
 * right store without making every template function await a lookup.
 */
const storeName = currentBrandName

export const transporter = nodemailer.createTransport({
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SES_SMTP_USER,
    pass: process.env.SES_SMTP_PASSWORD,
  },
})

async function getAdminNotificationEmails(): Promise<string> {
  try {
    // 'administrator' is the top role (scopes.ts SUPER_ROLES = ['administrator','super_admin'])
    // and was missing here, so the actual administrative mailbox — admin@jeffistores.in, whose
    // role IS 'administrator' — was excluded from every admin notification while a personal
    // gmail account received them instead.
    const rows = await queryMany<{ email: string }>(
      `SELECT u.email FROM admins a
       JOIN users u ON u.id = a.user_id
       WHERE a.is_active = TRUE
         AND a.role IN ('administrator', 'super_admin', 'admin')
         AND u.email IS NOT NULL
       ORDER BY a.role = 'administrator' DESC, a.role = 'super_admin' DESC`,
      []
    )
    if (rows.length > 0) return rows.map(r => r.email).join(', ')
  } catch { /* fall back to ADMIN_EMAIL below */ }
  // Default is the administrative mailbox on the platform domain, not a personal address.
  return process.env.ADMIN_EMAIL || 'admin@jeffistores.in'
}

export async function sendOTPEmail(email: string, otp: string, name?: string) {
  const from = customerMailFrom()
  const subject = 'Your Verification Code - Jeffi Stores'
  const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .container {
              background-color: #f9f9f9;
              border-radius: 10px;
              padding: 30px;
              border: 1px solid #e0e0e0;
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .logo {
              font-size: 28px;
              font-weight: bold;
              color: #2563eb;
            }
            .otp-box {
              background-color: #2563eb;
              color: white;
              font-size: 32px;
              font-weight: bold;
              text-align: center;
              padding: 20px;
              border-radius: 8px;
              letter-spacing: 8px;
              margin: 24px 0;
            }
            .info {
              background-color: #fff3cd;
              border-left: 4px solid #ffc107;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .footer {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e0e0e0;
              color: #666;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <span style="display:none;font-size:1px;color:#fff;max-height:0;overflow:hidden;mso-hide:all;">Your Jeffi Stores OTP is ${otp} — valid for 10 minutes. Do not share.</span>
          <div class="container">
            <div class="header">
              <div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div>
              <p style="color: #666;">Hardware &amp; Tools</p>
            </div>

            <h2>Email Verification</h2>
            <p>Hello ${name || 'Customer'},</p>
            <p>Thank you for registering with Jeffi Stores. Please use the following One-Time Password (OTP) to verify your email address:</p>

            <div class="otp-box">${otp}</div>

            <div class="info">
              <strong>This OTP will expire in 10 minutes.</strong>
              <br>
              <small>Please do not share this code with anyone.</small>
            </div>

            <p>If you didn't request this verification code, please ignore this email or contact our support team.</p>

            <div class="footer">
              <p><strong>${storeName()}</strong></p>
              <p>SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092</p>
                            <p>Phone: +91 96853 54099 | Email: jeffistoress@gmail.com</p>
            </div>
          </div>
        </body>
      </html>
    `

  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      kind: 'otp',
      templateName: 'otp',
      redactBody: true,
      entityType: null,
      entityId: null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendWelcomeEmail(email: string, name: string) {
  const from = customerMailFrom()
  const subject = 'Welcome to Jeffi Stores!'
  const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .container {
              background-color: #f9f9f9;
              border-radius: 10px;
              padding: 30px;
              border: 1px solid #e0e0e0;
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .logo {
              font-size: 28px;
              font-weight: bold;
              color: #2563eb;
            }
            .button {
              display: inline-block;
              background-color: #f97316;
              color: #ffffff !important;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
              font-weight: bold;
            }
            .footer {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e0e0e0;
              color: #666;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <span style="display:none;font-size:1px;color:#fff;max-height:0;overflow:hidden;mso-hide:all;">Welcome to Jeffi Stores! Your account is ready — shop industrial tools, hardware and more.</span>
          <div class="container">
            <div class="header">
              <div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div>
              <p style="color: #666;">Hardware &amp; Tools</p>
            </div>

            <h2>Welcome to Jeffi Stores!</h2>
            <p>Hello ${name},</p>
            <p>Thank you for creating an account with us. We're excited to have you as part of the Jeffi Stores family!</p>

            <p>At Jeffi Stores, you'll find:</p>
            <ul>
              <li>Wide range of industrial machinery parts</li>
              <li>Quality components for manufacturing & construction</li>
              <li>Expert service and support</li>
              <li>Competitive pricing</li>
            </ul>

            <div style="text-align: center;">
              <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/products" class="button" style="color:#ffffff;">
                Start Shopping
              </a>
            </div>

            <p>If you have any questions or need assistance, feel free to reach out to our team.</p>

            <div class="footer">
              <p><strong>${storeName()}</strong></p>
              <p>SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092</p>
                                          <p>Phone: +91 96853 54099<br>Email: jeffistoress@gmail.com</p>
            </div>
          </div>
        </body>
      </html>
    `

  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      kind: 'welcome',
      templateName: 'welcome',
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendOrderConfirmationEmail(email: string, order: any, orderItems: any[]) {
  const from = customerMailFrom()
  const subject = `Order Received - ${order.order_number}`
  const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .container {
              background-color: #f9f9f9;
              border-radius: 10px;
              padding: 30px;
              border: 1px solid #e0e0e0;
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .logo {
              font-size: 28px;
              font-weight: bold;
              color: #2563eb;
            }
            .order-box {
              background-color: #e3f2fd;
              border: 2px solid #2563eb;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
            }
            th, td {
              padding: 12px;
              text-align: left;
              border-bottom: 1px solid #ddd;
            }
            th {
              background-color: #f0f0f0;
              font-weight: bold;
            }
            .total {
              background-color: #fff3cd;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
              text-align: right;
            }
            .footer {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e0e0e0;
              color: #666;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <span style="display:none;font-size:1px;color:#fff;max-height:0;overflow:hidden;mso-hide:all;">Order confirmed! We've received your order and will keep you updated on dispatch.</span>
          <div class="container">
            <div class="header">
              <div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div>
              <p style="color: #666;">Hardware &amp; Tools</p>
            </div>

            <h2>Order Received!</h2>
            <p>Hello ${order.customer_name},</p>
            <p>Thank you for your order! We've received your order and payment — our team is preparing it and will keep you updated on dispatch.</p>

            <div class="order-box">
              <h3 style="margin-top: 0;">Order Details</h3>
              <p><strong>Order Number:</strong> ${order.order_number}</p>
              <p><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
              })}</p>
              <p><strong>Status:</strong> <span style="color: #16a34a; font-weight: bold;">CONFIRMED</span></p>
              ${order.taxable_amount > 0 ? `
              <p><strong>GSTIN:</strong> 22AQFPJ2897M1ZG</p>
              ` : ''}
            </div>

            <h3>Order Items</h3>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                ${orderItems.map(item => `
                  <tr>
                    <td>${item.product_name}</td>
                    <td>${item.buy_mode === 'weight' || item.buy_mode === 'length' ? `${Number(item.quantity).toFixed(3)} ${item.buy_unit ?? ''}` : Math.round(Number(item.quantity))}</td>                    <td>₹${item.total_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <div class="total">
              ${order.taxable_amount > 0 ? `
              <p style="margin: 3px 0; font-size: 14px;">Taxable Amount: ₹${Number(order.taxable_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              ${order.is_igst
                ? `<p style="margin: 3px 0; font-size: 14px;">IGST: ₹${Number(order.igst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>`
                : `<p style="margin: 3px 0; font-size: 14px;">CGST: ₹${Number(order.cgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                   <p style="margin: 3px 0; font-size: 14px;">SGST: ₹${Number(order.sgst_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>`
              }
              <hr style="border: none; border-top: 1px solid #ccc; margin: 8px 0;">
              ` : ''}
              <h3 style="margin: 0;">Total Amount: ₹${order.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h3>
            </div>

            <div style="background-color: #dcfce7; border-left: 4px solid #16a34a; padding: 15px; margin: 20px 0;">
              <h4 style="margin-top: 0;">What happens next?</h4>
              <p style="margin: 5px 0;">Your payment has been received. We're now preparing your order for dispatch. You'll receive another email once your order is on its way.</p>
            </div>

            <p>If you have any questions, feel free to contact us:</p>
                                        <p>Phone: +91 96853 54099<br>Email: jeffistoress@gmail.com</p>

            <div class="footer">
              <p><strong>${storeName()}</strong></p>
              <p>SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092</p>
            </div>
          </div>
        </body>
      </html>
    `
  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      attachments: [],
      kind: 'order',
      templateName: 'order_confirmation',
      entityType: 'orders',
      entityId: order?.id ?? null,
      userId: order?.user_id ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendNewOrderNotification(order: any, orderItems: any[], _user: any) {
  const adminEmail = await getAdminNotificationEmails()

  const from = adminMailFrom()
  const subject = `New Order - ${order.order_number}`
  const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 700px;
              margin: 0 auto;
              padding: 20px;
            }
            .container {
              background-color: #f9f9f9;
              border-radius: 10px;
              padding: 30px;
              border: 1px solid #e0e0e0;
            }
            .alert {
              background-color: #d4edda;
              border: 2px solid #28a745;
              padding: 20px;
              border-radius: 8px;
              margin-bottom: 20px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
              background-color: white;
            }
            th, td {
              padding: 12px;
              text-align: left;
              border: 1px solid #ddd;
            }
            th {
              background-color: #2563eb;
              color: white;
              font-weight: bold;
            }
            .info-box {
              background-color: white;
              padding: 15px;
              border-radius: 5px;
              margin: 15px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="alert">
              <h2 style="margin-top: 0;">New Order Received!</h2>
              <p style="font-size: 18px; margin: 0;"><strong>Order #${order.order_number}</strong></p>
            </div>

            <div class="info-box">
              <h3>Customer Information</h3>
              <p><strong>Name:</strong> ${order.customer_name}</p>
              <p><strong>Email:</strong> ${order.customer_email}</p>
              <p><strong>Phone:</strong> ${order.customer_phone || 'Not provided'}</p>
            </div>

            <div class="info-box">
              <h3>Order Information</h3>
              <p><strong>Order Number:</strong> ${order.order_number}</p>
              <p><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleString('en-IN')}</p>
              <p><strong>Status:</strong> PENDING</p>
              ${order.notes ? `<p><strong>Customer Notes:</strong> ${order.notes}</p>` : ''}
            </div>

            <h3>Order Items</h3>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${orderItems.map(item => `
                  <tr>
                    <td>${item.product_name}</td>
                    <td>${item.product_sku}</td>
                    <td>${item.buy_mode === 'weight' || item.buy_mode === 'length' ? `${Number(item.quantity).toFixed(3)} ${item.buy_unit ?? ''}` : Math.round(Number(item.quantity))}</td>                    <td>₹${item.unit_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td>₹${item.total_price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  </tr>
                `).join('')}
                <tr style="background-color: #fff3cd; font-weight: bold;">
                  <td colspan="4" style="text-align: right;">Total:</td>
                  <td>₹${order.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              </tbody>
            </table>

            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
              <h4 style="margin-top: 0;">Action Required</h4>
              <p>Please contact the customer within 24 hours to confirm the order and payment details.</p>
            </div>

            <p style="text-align: center; margin-top: 30px;">
              <a href="${process.env.ADMIN_BASE_URL || 'https://admin.jeffistores.in'}/admin/orders/${order.id}"
                 style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                View Order in Admin Panel
              </a>
            </p>
          </div>
        </body>
      </html>
    `

  try {
    const info = await sendAuditedMail({
      from,
      to: adminEmail,
      subject,
      html,
      kind: 'admin_notification',
      templateName: 'new_order_admin',
      entityType: 'orders',
      entityId: order?.id ?? null,
      userId: null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendOrderStatusUpdate(
  customerEmail: string,
  customerName: string,
  orderNumber: string,
  orderId: string,
  newStatus: string,
  previousStatus?: string,
  invoicePdfBuffer?: Buffer | null,
  cancellationNote?: string,
) {
  const statusMessages: Record<string, { title: string; message: string; color: string }> = {
    pending: {
      title: 'Order Received',
      message: 'We have received your order and are preparing it for processing.',
      color: '#ffc107',
    },
    confirmed: {
      title: 'Order Confirmed',
      message: 'Your order has been confirmed and is being prepared for shipment.',
      color: '#2563eb',
    },
    processing: {
      title: 'Order Processing',
      message: 'Your order is currently being processed and will be shipped soon.',
      color: '#2563eb',
    },
    shipped: {
      title: 'Order Shipped',
      message: 'Great news! Your order has been shipped and is on its way to you.',
      color: '#8b5cf6',
    },
    out_for_delivery: {
      title: 'Out for Delivery',
      message: 'Your order is out for delivery today! Our delivery partner will arrive soon.',
      color: '#6366f1',
    },
    delivered: {
      title: 'Order Delivered',
      message: 'Your order has been successfully delivered. Thank you for shopping with us!',
      color: '#10b981',
    },
    cancelled: {
      title: 'Order Cancelled',
      message: 'Your order has been cancelled. If you did not request this cancellation, please contact us immediately.',
      color: '#ef4444',
    },
    cancel_requested: {
      title: 'Cancellation Request Received',
      message: 'We have received your cancellation request. Our team will review it and notify you once it is approved or rejected.',
      color: '#f97316',
    },
    cancel_rejected: {
      title: 'Cancellation Request Rejected',
      message: 'We were unable to process your cancellation request. Your order will continue as normal.',
      color: '#6b7280',
    },
  }

  const statusInfo = statusMessages[newStatus] || {
    title: 'Order Update',
    message: `Your order status has been updated to: ${newStatus}`,
    color: '#6b7280',
  }

  const from = customerMailFrom()
  const subject = `${statusInfo.title} - Order ${orderNumber}`
  const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .container {
              background-color: #f9f9f9;
              border-radius: 10px;
              padding: 30px;
              border: 1px solid #e0e0e0;
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .logo {
              font-size: 28px;
              font-weight: bold;
              color: #2563eb;
            }
            .status-badge {
              background-color: ${statusInfo.color};
              color: white;
              font-size: 18px;
              font-weight: bold;
              text-align: center;
              padding: 15px 20px;
              border-radius: 8px;
              margin: 20px 0;
              text-transform: uppercase;
            }
            .info-box {
              background-color: #f0f9ff;
              border-left: 4px solid #2563eb;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .order-details {
              background-color: white;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .footer {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e0e0e0;
              color: #666;
              font-size: 14px;
            }
            .button {
              display: inline-block;
              background-color: #2563eb;
              color: #ffffff !important;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <span style="display:none;font-size:1px;color:#fff;max-height:0;overflow:hidden;mso-hide:all;">${statusInfo.title} — Order #${orderNumber}. ${statusInfo.message}</span>
          <div class="container">
            <div class="header">
              <div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div>
              <p style="color: #666;">Hardware &amp; Tools</p>
            </div>

            <h2>${statusInfo.title}</h2>
            <p>Hello ${customerName},</p>
            <p>${statusInfo.message}</p>

            ${cancellationNote ? `
            <div class="info-box" style="background-color: #fef2f2; border-left-color: #ef4444;">
              <h4 style="margin-top: 0; color: #b91c1c;">Reason</h4>
              <p style="margin: 0;">${cancellationNote}</p>
            </div>
            ` : ''}

            <div class="status-badge">${newStatus}</div>

            <div class="order-details">
              <h3 style="margin-top: 0;">Order Details</h3>
              <p><strong>Order Number:</strong> ${orderNumber}</p>
              <p><strong>Order ID:</strong> ${orderId}</p>
              ${previousStatus ? `<p><strong>Previous Status:</strong> ${previousStatus}</p>` : ''}
              <p><strong>Updated:</strong> ${new Date().toLocaleString('en-IN', { 
                dateStyle: 'long', 
                timeStyle: 'short' 
              })}</p>
            </div>

            ${newStatus === 'shipped' ? `
              <div class="info-box" style="background-color: #f0f9ff; border-left-color: #2563eb;">
                <h4 style="margin-top: 0; color: #1e40af;">Your order is on its way!</h4>
                <p>Track your shipment live by visiting your order page:</p>
                <p style="text-align: center; margin: 0;">
                  <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/account/orders/${orderId}"
                     style="display: inline-block; background-color: #2563eb; color: white; padding: 10px 24px; border-radius: 6px; font-weight: bold; text-decoration: none; font-size: 14px;">
                    Track Your Order
                  </a>
                </p>
              </div>
            ` : ''}

            ${newStatus === 'delivered' ? `
              <div class="info-box">
                <h4 style="margin-top: 0;">Thank You!</h4>
                <p>We hope you're satisfied with your purchase. If you have any questions or concerns, please don't hesitate to contact us.</p>
              </div>
            ` : ''}

            <p style="text-align: center;">
              <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/account/orders/${orderId}"
                 class="button" style="color:#ffffff;">
                View Order Details
              </a>
            </p>

            <p>If you have any questions about your order, please feel free to contact us.</p>

            <div class="footer">
              <p><strong>${storeName()}</strong></p>
              <p>SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092</p>
                            <p>Phone: +91 96853 54099 | Email: jeffistoress@gmail.com</p>
            </div>
          </div>
        </body>
      </html>
    `
  const attachments = invoicePdfBuffer ? [{
    filename: `Invoice-${orderNumber}.pdf`,
    content: invoicePdfBuffer,
    contentType: 'application/pdf',
  }] : []

  try {
    const info = await sendAuditedMail({
      from,
      to: customerEmail,
      subject,
      html,
      attachments,
      kind: 'order',
      templateName: 'order_status_update',
      entityType: 'orders',
      entityId: orderId ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendPaymentStatusUpdate(
  customerEmail: string,
  customerName: string,
  orderNumber: string,
  orderId: string,
  newPaymentStatus: string,
  orderTotal: number
) {
  const paymentMessages: Record<string, { title: string; message: string; color: string }> = {
    paid: {
      title: 'Payment Received',
      message: 'We have received your payment successfully. Thank you!',
      color: '#10b981',
    },
    pending: {
      title: 'Payment Pending',
      message: 'Your payment is pending. Please complete the payment to proceed with your order.',
      color: '#ffc107',
    },
    failed: {
      title: 'Payment Failed',
      message: 'Unfortunately, your payment could not be processed. You have 10 minutes from when the order was placed to retry payment before the order is automatically cancelled.',
      color: '#ef4444',
    },
    refunded: {
      title: 'Payment Refunded',
      message: 'Your payment has been refunded. It may take 5-7 business days to reflect in your account.',
      color: '#8b5cf6',
    },
  }

  const paymentInfo = paymentMessages[newPaymentStatus] || {
    title: 'Payment Update',
    message: `Your payment status has been updated to: ${newPaymentStatus}`,
    color: '#6b7280',
  }

  const from = customerMailFrom()
  const subject = `${paymentInfo.title} - Order ${orderNumber}`
  const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .container {
              background-color: #f9f9f9;
              border-radius: 10px;
              padding: 30px;
              border: 1px solid #e0e0e0;
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .logo {
              font-size: 28px;
              font-weight: bold;
              color: #2563eb;
            }
            .payment-badge {
              background-color: ${paymentInfo.color};
              color: white;
              font-size: 18px;
              font-weight: bold;
              text-align: center;
              padding: 15px 20px;
              border-radius: 8px;
              margin: 20px 0;
              text-transform: uppercase;
            }
            .amount-box {
              background-color: white;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
              text-align: center;
            }
            .amount {
              font-size: 32px;
              font-weight: bold;
              color: #2563eb;
            }
            .order-details {
              background-color: white;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .info-box {
              background-color: #f0f9ff;
              border-left: 4px solid #2563eb;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .footer {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e0e0e0;
              color: #666;
              font-size: 14px;
            }
            .button {
              display: inline-block;
              background-color: #2563eb;
              color: #ffffff !important;
              padding: 12px 30px;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <span style="display:none;font-size:1px;color:#fff;max-height:0;overflow:hidden;mso-hide:all;">${paymentInfo.title} — Order #${orderNumber}. ${paymentInfo.message}</span>
          <div class="container">
            <div class="header">
              <div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div>
              <p style="color: #666;">Hardware &amp; Tools</p>
            </div>

            <h2>${paymentInfo.title}</h2>
            <p>Hello ${customerName},</p>
            <p>${paymentInfo.message}</p>

            <div class="payment-badge">${newPaymentStatus}</div>

            <div class="amount-box">
              <p style="margin: 0; color: #666;">Order Amount</p>
              <div class="amount">₹${orderTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            </div>

            <div class="order-details">
              <h3 style="margin-top: 0;">Order Details</h3>
              <p><strong>Order Number:</strong> ${orderNumber}</p>
              <p><strong>Order ID:</strong> ${orderId}</p>
              <p><strong>Payment Status:</strong> ${newPaymentStatus}</p>
              <p><strong>Updated:</strong> ${new Date().toLocaleString('en-IN', { 
                dateStyle: 'long', 
                timeStyle: 'short' 
              })}</p>
            </div>

            ${newPaymentStatus === 'paid' ? `
              <div class="info-box">
                <h4 style="margin-top: 0;">Payment Confirmed</h4>
                <p>Your order will now be processed and shipped as per the delivery schedule.</p>
              </div>
            ` : ''}

            ${newPaymentStatus === 'pending' ? `
              <div class="info-box">
                <h4 style="margin-top: 0;">Action Required</h4>
                <p>Please complete your payment to avoid order cancellation. Contact us if you need assistance.</p>
              </div>
            ` : ''}

            ${newPaymentStatus === 'refunded' ? `
              <div class="info-box">
                <h4 style="margin-top: 0;">Refund Processed</h4>
                <p>The refund has been initiated. Please allow 5-7 business days for the amount to reflect in your account.</p>
              </div>
            ` : ''}

            ${newPaymentStatus === 'failed' ? `
              <div class="info-box" style="background-color: #fef2f2; border-left-color: #ef4444;">
                <h4 style="margin-top: 0; color: #ef4444;">Action Required &mdash; 10 Minute Window</h4>
                <p>You have <strong>10 minutes</strong> from when the order was placed to complete payment. After that, the order will be automatically cancelled and items returned to your cart.</p>
                <p>Click the button below to retry payment now.</p>
              </div>
            ` : ''}

            <p style="text-align: center;">
              <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/account/orders/${orderId}"
                 class="button" style="color:#ffffff;">
                View Order Details
              </a>
            </p>

            <p>If you have any questions about this payment update, please contact us.</p>

            <div class="footer">
              <p><strong>${storeName()}</strong></p>
              <p>SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092</p>
                            <p>Phone: +91 96853 54099 | Email: jeffistoress@gmail.com</p>
            </div>
          </div>
        </body>
      </html>
    `

  try {
    const info = await sendAuditedMail({
      from,
      to: customerEmail,
      subject,
      html,
      kind: 'order',
      templateName: 'payment_status',
      entityType: 'orders',
      entityId: orderId ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendAdminCertificateEmail(
  email: string,
  displayName: string,
  p12Buffer: Buffer,
  p12Password: string,
  serialNumber: string,
  expiresAt: string,
  role: string,
  tenant?: { slug: string; storeName: string }
) {
  // Tenant owners are an ecom communication, so they come from ecommerce@; the platform's
  // own admin certs keep the existing admin sender.
  const from = tenant
    ? `"Jeffi Commerce" <${process.env.ECOM_FROM_EMAIL || 'ecommerce@jeffistores.in'}>`
    : adminMailFrom()
  const subject = tenant
    ? `Your admin certificate for ${tenant.storeName}`
    : 'Your Admin Certificate - Jeffi Stores'
  const certFileSlug = (displayName || email).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'admin'
  const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .container {
              background-color: #f9f9f9;
              border-radius: 10px;
              padding: 30px;
              border: 1px solid #e0e0e0;
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
            }
            .logo {
              font-size: 28px;
              font-weight: bold;
              color: #2563eb;
            }
            .credential-box {
              background-color: #1e293b;
              color: #e2e8f0;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
              font-family: monospace;
            }
            .credential-box .label {
              color: #94a3b8;
              font-size: 12px;
              text-transform: uppercase;
              margin-bottom: 4px;
            }
            .credential-box .value {
              color: #38bdf8;
              font-size: 16px;
              font-weight: bold;
              word-break: break-all;
            }
            .credential-box hr {
              border: none;
              border-top: 1px solid #334155;
              margin: 12px 0;
            }
            .warning {
              background-color: #fef3c7;
              border-left: 4px solid #f59e0b;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .info {
              background-color: #f0f9ff;
              border-left: 4px solid #2563eb;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .footer {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e0e0e0;
              color: #666;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div>
              <p style="color: #666;">Admin Panel Access</p>
            </div>

            <h2>Welcome, ${displayName}!</h2>
            <p>You have been added as an <strong>${role}</strong> on the Jeffi Stores admin panel. Your client certificate is attached to this email.</p>

            <div class="credential-box">
              <div class="label">Email</div>
              <div class="value">${email}</div>
              <hr>
              <div class="label">Certificate Password</div>
              <div class="value">${p12Password}</div>
              <hr>
              <div class="label">Certificate Serial</div>
              <div class="value" style="font-size: 11px;">${serialNumber}</div>
              <hr>
              <div class="label">Expires On</div>
              <div class="value">${new Date(expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
            </div>

            <div class="warning">
              <strong>Important Security Notice</strong>
              <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                <li>The attached <code>.p12</code> certificate file is required to access the admin panel.</li>
                <li>Install it in your browser or system keychain using the password above.</li>
                <li>Do <strong>not</strong> share this certificate or password with anyone.</li>
                <li>This certificate is valid for 365 days from issuance.</li>
              </ul>
            </div>

            <div class="info">
              <strong>How to install:</strong>
              <ol style="margin: 8px 0 0 0; padding-left: 20px;">
                <li>Download the attached <code>${certFileSlug}-admin-cert.p12</code> file.</li>
                <li>Double-click the file to open it in your system's certificate manager.</li>
                <li>Enter the certificate password shown above when prompted.</li>
                <li>Navigate to <strong>https://admin.jeffistores.in/admin/login</strong> to access the admin panel.</li>
              </ol>
            </div>

            <p>If you have any questions, contact the super admin.</p>

            <div class="footer">
              <p><strong>${storeName()}</strong></p>
              <p>SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092</p>
              <p>Phone: +91 96853 54099 | Email: admin@jeffistores.in</p>
            </div>
          </div>
        </body>
      </html>
    `
  const attachments = [
    {
      filename: `${certFileSlug}-admin-cert.p12`,
      content: p12Buffer,
      contentType: 'application/x-pkcs12',
    },
  ]

  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      attachments,
      kind: 'admin_notification',
      templateName: 'admin_certificate',
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendNewReviewNotification(review: any, user: any, product: any) {
  const adminEmail = await getAdminNotificationEmails()

  const mailOptions = {
    from: adminMailFrom(),
    to: adminEmail,
    subject: `New Review Pending Approval - ${product.name}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .container {
              background-color: #f9f9f9;
              border-radius: 10px;
              padding: 30px;
              border: 1px solid #e0e0e0;
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 20px;
              border-radius: 10px;
              text-align: center;
              margin-bottom: 30px;
            }
            .content {
              background-color: white;
              padding: 20px;
              border-radius: 8px;
              margin-bottom: 20px;
            }
            .review-box {
              background-color: #fff3cd;
              border-left: 4px solid #ffc107;
              padding: 15px;
              margin: 20px 0;
            }
            .stars {
              color: #ffc107;
              font-size: 20px;
              margin: 10px 0;
            }
            .info-row {
              display: flex;
              justify-content: space-between;
              padding: 10px 0;
              border-bottom: 1px solid #eee;
            }
            .info-label {
              font-weight: bold;
              color: #555;
            }
            .button {
              display: inline-block;
              padding: 12px 30px;
              background-color: #28a745;
              color: #ffffff !important;
              text-decoration: none;
              border-radius: 5px;
              margin: 10px 5px;
              font-weight: bold;
            }
            .button.delete {
              background-color: #dc3545;
            }
            .footer {
              text-align: center;
              color: #666;
              font-size: 12px;
              margin-top: 30px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">New Review Submitted</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">Action Required: Pending Approval</p>
            </div>

            <div class="content">
              <h2 style="color: #667eea; margin-top: 0;">Review Details</h2>
              
              <div class="info-row">
                <span class="info-label">Product:</span>
                <span>${product.name}</span>
              </div>
              
              <div class="info-row">
                <span class="info-label">Customer:</span>
                <span>${user.first_name} ${user.last_name}</span>
              </div>
              
              <div class="info-row">
                <span class="info-label">Email:</span>
                <span>${user.email}</span>
              </div>
              
              <div class="info-row">
                <span class="info-label">Rating:</span>
                <span class="stars">${review.rating}/5</span>
              </div>
              
              ${review.is_verified_purchase ? `
              <div class="info-row">
                <span class="info-label">Status:</span>
                <span style="color: #28a745; font-weight: bold;">Verified Purchase</span>
              </div>
              ` : ''}
              
              <div class="info-row">
                <span class="info-label">Submitted:</span>
                <span>${new Date(review.created_at).toLocaleString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}</span>
              </div>

              ${review.title ? `
              <div style="margin-top: 20px;">
                <strong>Review Title:</strong>
                <p style="margin: 5px 0; font-size: 16px;">${review.title}</p>
              </div>
              ` : ''}

              <div class="review-box">
                <strong>Review Comment:</strong>
                <p style="margin: 10px 0 0 0; white-space: pre-wrap;">${review.comment}</p>
              </div>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.ADMIN_BASE_URL || 'https://admin.jeffistores.in'}/admin/reviews" class="button" style="color:#ffffff;">
                Approve / Reject Review
              </a>
            </div>

            <div class="footer">
              <p>This is an automated notification from Jeffi Stores Admin Panel</p>
              <p>Please review and approve/reject this review from the admin dashboard</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }

  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'admin_notification',
      templateName: 'new_review',
      entityType: 'product_reviews',
      entityId: review?.id ?? null,
      userId: user?.id ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendPaymentFailedAdminNotification(
  order: { order_number: string; id: string; customer_name: string; customer_email: string; total_amount: string | number; customer_phone?: string },
  errorDescription?: string
) {
  const adminEmail = await getAdminNotificationEmails()

  const mailOptions = {
    from: adminMailFrom(),
    to: adminEmail,
    subject: `[Payment Failed] Order ${order.order_number}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 700px;
              margin: 0 auto;
              padding: 20px;
            }
            .container {
              background-color: #f9f9f9;
              border-radius: 10px;
              padding: 30px;
              border: 1px solid #e0e0e0;
            }
            .alert {
              background-color: #fef2f2;
              border: 2px solid #ef4444;
              padding: 20px;
              border-radius: 8px;
              margin-bottom: 20px;
            }
            .info-box {
              background-color: white;
              padding: 15px;
              border-radius: 5px;
              margin: 15px 0;
            }
            .warning-box {
              background-color: #fff3cd;
              border-left: 4px solid #ffc107;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="alert">
              <h2 style="margin-top: 0; color: #ef4444;">Payment Failed</h2>
              <p style="font-size: 18px; margin: 0;"><strong>Order #${order.order_number}</strong></p>
            </div>

            <div class="info-box">
              <h3>Customer Information</h3>
              <p><strong>Name:</strong> ${order.customer_name}</p>
              <p><strong>Email:</strong> ${order.customer_email}</p>
              ${order.customer_phone ? `<p><strong>Phone:</strong> ${order.customer_phone}</p>` : ''}
            </div>

            <div class="info-box">
              <h3>Payment Details</h3>
              <p><strong>Order Amount:</strong> ₹${parseFloat(String(order.total_amount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              <p><strong>Status:</strong> <span style="color: #ef4444; font-weight: bold;">FAILED</span></p>
              ${errorDescription ? `<p><strong>Reason:</strong> ${errorDescription}</p>` : ''}
              <p><strong>Time:</strong> ${new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}</p>
            </div>

            <div class="warning-box">
              <h4 style="margin-top: 0;">Auto-Cancel in 10 Minutes</h4>
              <p>The customer has been notified and given a <strong>10-minute window</strong> to retry payment. If payment is not completed, the order will be automatically cancelled and stock restored.</p>
            </div>

            <p style="text-align: center; margin-top: 30px;">
              <a href="${process.env.ADMIN_BASE_URL || 'https://admin.jeffistores.in'}/admin/orders/${order.id}"
                 style="display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                View Order in Admin Panel
              </a>
            </p>
          </div>
        </body>
      </html>
    `,
  }

  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'admin_notification',
      templateName: 'payment_failed_admin',
      entityType: 'orders',
      entityId: order?.id ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendAdminContactEmail(
  email: string,
  name: string,
  subject: string,
  message: string,
  opts: { isHtml?: boolean; entityType?: string; entityId?: string } = {}
) {
  const messageHtml = opts.isHtml
    ? message
    : message.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const mailOptions = {
    from: customerMailFrom(),
    to: email,
    subject,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .container { background-color: #f9f9f9; border-radius: 10px; padding: 30px; border: 1px solid #e0e0e0; }
            .header { text-align: center; padding-bottom: 20px; margin-bottom: 30px; }
            .logo { font-size: 28px; font-weight: bold; color: #f97316; }
            .message-box { background-color: #fff; border-left: 4px solid #f97316; padding: 20px; border-radius: 4px; margin: 20px 0;${opts.isHtml ? '' : ' white-space: pre-wrap;'} }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #666; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div>
              <p style="color: #666; margin: 4px 0 0;">Hardware &amp; Tools</p>
            </div>
            <div class="message-box">${messageHtml}</div>
            <div class="footer">
              <p>This message was sent by the Jeffi Stores admin team. Please do not reply directly to this email.</p>
              <p><strong>${storeName()}</strong> | SANJAY GANTHI CHOWK, STATION ROAD, RAIPUR, CHHATTISGARH-490092</p>
              <p>Phone: +91 96853 54099 | Email: jeffistoress@gmail.com</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }

  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'admin_notification',
      templateName: 'admin_contact',
      ...(opts.entityType && opts.entityId ? { entityType: opts.entityType, entityId: opts.entityId } : {}),
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendSupportEscalationEmail(
  customerName: string,
  customerEmail: string,
  customerId: string,
  sessionId: string,
  adminEmails: string[]
): Promise<{ success: boolean; error?: unknown }> {
  const adminBaseUrl = process.env.ADMIN_BASE_URL || 'https://admin.jeffistores.in'
  const chatLink = `${adminBaseUrl}/admin/customers/${customerId}?chat=true`
  const recipients = adminEmails.length > 0 ? adminEmails : [process.env.SUPPORT_EMAIL || 'aloysjehwin@gmail.com']

  const mailOptions = {
    from: `"Jeffi Stores" <${process.env.SES_FROM_EMAIL}>`,
    to: recipients.join(', '),
    subject: `Support Request from ${customerName}`,
    html: `
      <!DOCTYPE html><html><head><style>
        body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}
        .container{max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}
        .header{background:#f97316;padding:24px;text-align:center}
        .logo{font-size:24px;font-weight:bold;color:#fff}
        .body{padding:28px}
        .info-box{background:#fff7ed;border-left:4px solid #f97316;padding:16px;border-radius:4px;margin:20px 0}
        .cta{display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin-top:16px}
        .footer{text-align:center;padding:20px;border-top:1px solid #e0e0e0;color:#888;font-size:12px}
      </style></head>
      <body><div class="container">
        <div class="header"><div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div></div>
        <div class="body">
          <p style="font-size:16px;font-weight:bold;color:#1f2937;">New Support Chat Request</p>
          <p>A customer has requested to connect with a support agent.</p>
          <div class="info-box">
            <p style="margin:0 0 6px"><strong>Name:</strong> ${customerName}</p>
            <p style="margin:0 0 6px"><strong>Email:</strong> ${customerEmail}</p>
            <p style="margin:0"><strong>Session ID:</strong> ${sessionId}</p>
          </div>
          <p>Click below to open the customer profile and join the chat:</p>
          <a href="${chatLink}" class="cta">Open Support Chat</a>
        </div>
        <div class="footer"><p>Jeffi Stores Admin Notification — do not reply to this email.</p></div>
      </div></body></html>
    `,
  }

  try {
    await sendAuditedMail({
      ...mailOptions,
      kind: 'support',
      templateName: 'support_escalation',
    })
    return { success: true }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendAgentConnectedEmail(
  customerName: string,
  customerEmail: string,
  agentName: string
): Promise<{ success: boolean; error?: unknown }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://jeffistores.in'
  const chatLink = `${appUrl}/support`

  const mailOptions = {
    from: `"Jeffi Stores Support" <${process.env.SES_FROM_EMAIL}>`,
    to: customerEmail,
    subject: `A support agent has joined your chat`,
    html: `
      <!DOCTYPE html><html><head><style>
        body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}
        .container{max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}
        .header{background:#f97316;padding:24px;text-align:center}
        .logo{font-size:24px;font-weight:bold;color:#fff}
        .body{padding:28px}
        .info-box{background:#fff7ed;border-left:4px solid #f97316;padding:16px;border-radius:4px;margin:20px 0}
        .cta{display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin-top:16px}
        .footer{text-align:center;padding:20px;border-top:1px solid #e0e0e0;color:#888;font-size:12px}
      </style></head>
      <body><div class="container">
        <div class="header"><div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div></div>
        <div class="body">
          <p style="font-size:16px;font-weight:bold;color:#1f2937;">Hi ${customerName}, your support agent is here!</p>
          <p>A support agent has joined your chat and is ready to help you.</p>
          <div class="info-box">
            <p style="margin:0"><strong>Agent:</strong> ${agentName}</p>
          </div>
          <p>Click below to return to the chat:</p>
          <a href="${chatLink}" class="cta">Return to Chat</a>
          <p style="margin-top:24px;font-size:13px;color:#6b7280;">If you no longer need assistance, you can close the chat from the support page.</p>
        </div>
        <div class="footer"><p>Jeffi Stores Support — do not reply to this email.</p></div>
      </div></body></html>
    `,
  }

  try {
    await sendAuditedMail({
      ...mailOptions,
      kind: 'support',
      templateName: 'agent_connected',
    })
    return { success: true }
  } catch (error) {
    return { success: false, error }
  }
}

type ReturnEmailEvent = 'requested_admin' | 'approved' | 'rejected' | 'received' | 'replacement_created'

export async function sendReturnStatusEmail(
  recipientEmail: string | string[],
  recipientName: string,
  orderNumber: string,
  orderId: string,
  event: ReturnEmailEvent,
  extra?: { adminNotes?: string; replacementOrderNumber?: string; returnType?: string; reason?: string; appUrl?: string }
): Promise<{ success: boolean; error?: unknown }> {
  const appUrl = extra?.appUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://jeffistores.in'
  const orderLink = `${appUrl}/account/orders/${orderId}`
  const to = Array.isArray(recipientEmail) ? recipientEmail.join(', ') : recipientEmail

  const subjects: Record<ReturnEmailEvent, string> = {
    requested_admin:    `Return/Replacement Request — Order #${orderNumber}`,
    approved:           `Your Return Request Has Been Approved — Order #${orderNumber}`,
    rejected:           `Your Return Request Was Not Approved — Order #${orderNumber}`,
    received:           `We've Received Your Return — Order #${orderNumber}`,
    replacement_created:`Your Replacement Order Has Been Created — Order #${orderNumber}`,
  }

  const bodies: Record<ReturnEmailEvent, string> = {
    requested_admin: `
      <p style="font-size:15px;font-weight:bold;color:#1f2937;">New Return / Replacement Request</p>
      <p>A customer has submitted a return/replacement request for order <strong>#${orderNumber}</strong>.</p>
      <div style="background:#fff7ed;border-left:4px solid #f97316;padding:16px;border-radius:4px;margin:20px 0">
        <p style="margin:0 0 6px"><strong>Customer:</strong> ${recipientName}</p>
        <p style="margin:0 0 6px"><strong>Type:</strong> ${extra?.returnType || 'N/A'}</p>
        <p style="margin:0"><strong>Reason:</strong> ${extra?.reason || 'N/A'}</p>
      </div>
      <a href="${process.env.ADMIN_BASE_URL || 'https://admin.jeffistores.in'}/admin/orders/${orderId}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">Review Request</a>
    `,
    approved: `
      <p>Your return/replacement request for order <strong>#${orderNumber}</strong> has been <strong style="color:#16a34a;">approved</strong>.</p>
      <p>Please ship the item(s) back to us. Our team will contact you with the return shipping address and instructions shortly.</p>
      <p>Once we receive and inspect the item, we will process your ${extra?.returnType === 'replacement' ? 'replacement shipment' : 'refund'} promptly.</p>
      <a href="${orderLink}" style="display:inline-block;background:#5a8a00;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">View Order</a>
    `,
    rejected: `
      <p>We have reviewed your return/replacement request for order <strong>#${orderNumber}</strong>.</p>
      <p>Unfortunately, we are unable to approve this request at this time.</p>
      ${extra?.adminNotes ? `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:16px;border-radius:4px;margin:16px 0"><p style="margin:0"><strong>Reason:</strong> ${extra.adminNotes}</p></div>` : ''}
      <p>If you have questions, please contact our support team.</p>
      <a href="${orderLink}" style="display:inline-block;background:#5a8a00;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">View Order</a>
    `,
    received: `
      <p>We have received your returned item(s) for order <strong>#${orderNumber}</strong>.</p>
      <p>Our team is now inspecting the item and will process your ${extra?.returnType === 'replacement' ? 'replacement shipment' : 'refund'} shortly. You will receive another notification once it is done.</p>
      <a href="${orderLink}" style="display:inline-block;background:#5a8a00;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">View Order</a>
    `,
    replacement_created: `
      <p>Great news! Your replacement order has been created for original order <strong>#${orderNumber}</strong>.</p>
      ${extra?.replacementOrderNumber ? `<p>Your new order number is <strong>#${extra.replacementOrderNumber}</strong>. It has been confirmed and will be processed shortly.</p>` : ''}
      <a href="${orderLink}" style="display:inline-block;background:#5a8a00;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">View Original Order</a>
    `,
  }

  const mailOptions = {
    from: `"Jeffi Stores" <${process.env.SES_FROM_EMAIL}>`,
    to,
    subject: subjects[event],
    html: `
      <!DOCTYPE html><html><head><style>
        body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}
        .container{max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}
        .header{background:#5a8a00;padding:24px;text-align:center}
        .logo{font-size:24px;font-weight:bold;color:#fff}
        .body{padding:28px;color:#374151;font-size:14px;line-height:1.6}
        .footer{text-align:center;padding:20px;border-top:1px solid #e0e0e0;color:#888;font-size:12px}
      </style></head>
      <body><div class="container">
        <div class="header"><div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div></div>
        <div class="body">
          ${event !== 'requested_admin' ? `<p>Hi ${recipientName},</p>` : ''}
          ${bodies[event]}
        </div>
        <div class="footer"><p>Jeffi Stores — do not reply to this email.</p></div>
      </div></body></html>
    `,
  }

  try {
    await sendAuditedMail({
      ...mailOptions,
      kind: 'order',
      templateName: 'return_status',
      entityType: 'orders',
      entityId: orderId ?? null,
      metadata: { event, orderNumber },
    })
    return { success: true }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendPaymentRetryEmail(
  customerEmail: string,
  customerName: string,
  orderNumber: string,
  orderTotal: number,
) {
  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistores.in'
  const shopUrl = `${BASE_URL}/products`
  const formatted = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(orderTotal)

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .hdr{background:#1a3a4a;padding:20px 32px}
  .hdr a{color:#fff;font-size:20px;font-weight:700;text-decoration:none}
  .body{padding:32px}
  .badge{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin:20px 0;text-align:center}
  .badge p{margin:0;color:#dc2626;font-weight:700;font-size:18px}
  .badge small{color:#6b7280;font-size:13px}
  .amount{font-size:28px;font-weight:900;color:#1a3a4a;display:block;margin:8px 0 0}
  .cta{display:inline-block;background:#e07b3f;color:#fff;text-decoration:none;padding:13px 28px;border-radius:6px;font-weight:700;font-size:15px;margin:24px 0 8px}
  .note{color:#6b7280;font-size:13px;line-height:1.6;margin:16px 0 0}
  .ftr{background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;font-size:12px;color:#9ca3af}
</style></head>
<body>
<div class="wrap">
  <div class="hdr"><div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div></div>
  <div class="body">
    <p style="color:#333;font-size:16px;margin:0 0 8px">Hi ${customerName},</p>
    <p style="color:#555;line-height:1.6;margin:0 0 16px">We're sorry your purchase didn't go through. It looks like the payment for order <strong>#${orderNumber}</strong> (${formatted}) could not be processed.</p>
    <p style="color:#555;line-height:1.6;margin:0 0 16px">No worries — simply visit our store and place a new order whenever you're ready. Your cart items are still available.</p>
    <a href="${shopUrl}" class="cta">Shop Again →</a>
    <p class="note">If you need any help or have questions, just reply to this email and we'll be happy to assist.</p>
  </div>
  <div class="ftr">© ${new Date().getFullYear()} Jeffi Store's &bull; <a href="${BASE_URL}" style="color:#9ca3af">jeffistores.in</a></div>
</div>
</body></html>`

  try {
    await sendAuditedMail({
      from: customerMailFrom(),
      to: customerEmail,
      subject: `Sorry your order didn't go through — Order #${orderNumber}`,
      html,
      kind: 'order',
      templateName: 'payment_retry',
      entityType: 'orders',
      entityId: null,
      metadata: { orderNumber, orderTotal },
    })
    return { success: true }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendInvoiceFinalizedEmail(
  toEmail: string,
  customerName: string,
  invoiceNumber: string,
  totalAmount: number,
  orderNumber?: string,
  viewUrl?: string
) {
  const formatted = totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })
  const mailOptions = {
    from: customerMailFrom(),
    to: toEmail,
    subject: `Invoice ${invoiceNumber} from Jeffi Stores`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}
            .container{max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}
            .header{background:#1a3a4a;padding:24px;text-align:center}
            .logo{font-size:22px;font-weight:bold;color:#fff}
            .body{padding:28px;color:#374151;font-size:14px;line-height:1.6}
            .box{background:#f0fdf4;border-left:4px solid #16a34a;padding:16px;border-radius:4px;margin:20px 0}
            .btn{display:inline-block;background:#1a3a4a;color:#ffffff !important;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:16px 0}
            .footer{text-align:center;padding:20px;border-top:1px solid #e0e0e0;color:#888;font-size:12px}
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div></div>
            <div class="body">
              <p>Dear ${customerName},</p>
              <p>Thank you for your purchase! Your invoice has been generated.</p>
              <div class="box">
                <p style="margin:0 0 6px"><strong>Invoice No.:</strong> ${invoiceNumber}</p>
                ${orderNumber ? `<p style="margin:0 0 6px"><strong>Order No.:</strong> ${orderNumber}</p>` : ''}
                <p style="margin:0"><strong>Total Amount:</strong> ₹${formatted}</p>
              </div>
              ${viewUrl ? `<p style="text-align:center"><a href="${viewUrl}" class="btn" style="color:#ffffff;">View Invoice</a></p>` : ''}
              <p>For any queries, please contact us.</p>
              <p>Phone: +91 96853 54099 | Email: jeffistoress@gmail.com</p>
            </div>
            <div class="footer">
              <p><strong>${storeName()}</strong> | SANJAY GANTHI CHOWK, STATION ROAD, RAIPUR, CHHATTISGARH-490092</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }
  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'invoice',
      templateName: 'invoice_finalized',
      entityType: 'orders',
      entityId: null,
      metadata: { invoiceNumber, orderNumber: orderNumber ?? null, totalAmount },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendPurchaseOrderEmail(
  toEmail: string,
  contactName: string,
  supplierName: string,
  poNumber: string,
  totalAmount: number,
  items: Array<{ product_name: string; variant_name?: string | null; quantity: number; unit_cost: number }>,
  viewUrl?: string
) {
  const formatted = totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })
  const itemRows = items.map(it =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${it.product_name}${it.variant_name ? ` / ${it.variant_name}` : ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${it.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">₹${it.unit_cost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>`
  ).join('')
  const mailOptions = {
    from: customerMailFrom(),
    to: toEmail,
    subject: `Purchase Order ${poNumber} from Jeffi Stores`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}
            .container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}
            .header{background:#1a3a4a;padding:24px;text-align:center}
            .logo{font-size:22px;font-weight:bold;color:#fff}
            .body{padding:28px;color:#374151;font-size:14px;line-height:1.6}
            .box{background:#eff6ff;border-left:4px solid #2563eb;padding:16px;border-radius:4px;margin:20px 0}
            .btn{display:inline-block;background:#1a3a4a;color:#ffffff !important;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:16px 0}
            table{width:100%;border-collapse:collapse;margin-top:16px}
            thead{background:#f3f4f6}
            th{padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em}
            .footer{text-align:center;padding:20px;border-top:1px solid #e0e0e0;color:#888;font-size:12px}
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div></div>
            <div class="body">
              <p>Dear ${contactName || supplierName},</p>
              <p>Please find below our purchase order. Kindly confirm receipt and expected delivery.</p>
              <div class="box">
                <p style="margin:0 0 6px"><strong>PO Number:</strong> ${poNumber}</p>
                <p style="margin:0"><strong>Total Amount:</strong> ₹${formatted}</p>
              </div>
              ${viewUrl ? `<p style="text-align:center"><a href="${viewUrl}" class="btn" style="color:#ffffff;">View Purchase Order</a></p>` : ''}
              <table>
                <thead><tr>
                  <th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Cost</th>
                </tr></thead>
                <tbody>${itemRows}</tbody>
              </table>
              <p style="margin-top:20px">For any questions, please contact us.</p>
              <p>Phone: +91 96853 54099 | Email: jeffistoress@gmail.com</p>
            </div>
            <div class="footer">
              <p><strong>${storeName()}</strong> | SANJAY GANTHI CHOWK, STATION ROAD, RAIPUR, CHHATTISGARH-490092</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }
  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'purchase_order',
      templateName: 'purchase_order',
      entityType: 'purchase_orders',
      entityId: null,
      metadata: { poNumber, supplierName, totalAmount },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendPOReceiveNotificationEmail(
  toEmail: string,
  contactName: string,
  supplierName: string,
  poNumber: string,
  grnNumber: string,
  newStatus: string,
  items: Array<{ product_name: string; variant_name?: string | null; quantity_received: number; unit_cost: number }>
) {
  const statusLabel = newStatus === 'received' ? 'Fully Received' : 'Partially Received'
  const itemRows = items.map(it =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${it.product_name}${it.variant_name ? ` / ${it.variant_name}` : ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${it.quantity_received}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">₹${it.unit_cost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>`
  ).join('')
  const mailOptions = {
    from: customerMailFrom(),
    to: toEmail,
    subject: `Goods Receipt Confirmation — PO ${poNumber} (${statusLabel})`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}
            .container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}
            .header{background:#1a3a4a;padding:24px;text-align:center}
            .logo{font-size:22px;font-weight:bold;color:#fff}
            .body{padding:28px;color:#374151;font-size:14px;line-height:1.6}
            .box{background:#f0fdf4;border-left:4px solid #16a34a;padding:16px;border-radius:4px;margin:20px 0}
            table{width:100%;border-collapse:collapse;margin-top:16px}
            thead{background:#f3f4f6}
            th{padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em}
            .footer{text-align:center;padding:20px;border-top:1px solid #e0e0e0;color:#888;font-size:12px}
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div></div>
            <div class="body">
              <p>Dear ${contactName || supplierName},</p>
              <p>We have recorded receipt of goods against your purchase order.</p>
              <div class="box">
                <p style="margin:0 0 6px"><strong>PO Number:</strong> ${poNumber}</p>
                <p style="margin:0 0 6px"><strong>GRN Number:</strong> ${grnNumber}</p>
                <p style="margin:0"><strong>Status:</strong> ${statusLabel}</p>
              </div>
              <table>
                <thead><tr>
                  <th>Product</th><th style="text-align:right">Qty Received</th><th style="text-align:right">Unit Cost</th>
                </tr></thead>
                <tbody>${itemRows}</tbody>
              </table>
              <p style="margin-top:20px">Thank you for your supply.</p>
              <p>Phone: +91 96853 54099 | Email: jeffistoress@gmail.com</p>
            </div>
            <div class="footer">
              <p><strong>${storeName()}</strong> | SANJAY GANTHI CHOWK, STATION ROAD, RAIPUR, CHHATTISGARH-490092</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }
  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'admin_notification',
      templateName: 'po_receive',
      entityType: 'purchase_orders',
      entityId: null,
      metadata: { poNumber, grnNumber, newStatus, supplierName },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendQuotationFinalizedEmail(
  toEmail: string,
  consigneeName: string,
  quoteNumber: string,
  totalAmount: number,
  viewUrl: string
) {
  const formatted = totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })
  const mailOptions = {
    from: customerMailFrom(),
    to: toEmail,
    subject: `Quotation ${quoteNumber} from Jeffi Stores`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px}
            .container{max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}
            .header{background:#1a3a4a;padding:24px;text-align:center}
            .logo{font-size:22px;font-weight:bold;color:#fff}
            .body{padding:28px;color:#374151;font-size:14px;line-height:1.6}
            .box{background:#f0f9ff;border-left:4px solid #2563eb;padding:16px;border-radius:4px;margin:20px 0}
            .btn{display:inline-block;background:#1a3a4a;color:#ffffff !important;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;margin:16px 0}
            .footer{text-align:center;padding:20px;border-top:1px solid #e0e0e0;color:#888;font-size:12px}
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><div style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${storeName()}</div></div>
            <div class="body">
              <p>Dear ${consigneeName},</p>
              <p>Please find your quotation from Jeffi Stores.</p>
              <div class="box">
                <p style="margin:0 0 6px"><strong>Quotation No.:</strong> ${quoteNumber}</p>
                <p style="margin:0"><strong>Total Amount:</strong> ₹${formatted}</p>
              </div>
              <p style="text-align:center"><a href="${viewUrl}" class="btn" style="color:#ffffff;">View Quotation</a></p>
              <p>If you have any questions regarding this quotation, please feel free to contact us.</p>
              <p>Phone: +91 96853 54099 | Email: jeffistoress@gmail.com</p>
            </div>
            <div class="footer">
              <p><strong>${storeName()}</strong> | SANJAY GANTHI CHOWK, STATION ROAD, RAIPUR, CHHATTISGARH-490092</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }
  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'quotation',
      templateName: 'quotation_finalized',
      entityType: 'quotations',
      entityId: null,
      metadata: { quoteNumber, totalAmount },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendOrderAutoCancelledEmail(
  customerEmail: string,
  customerName: string,
  orderNumber: string,
  orderId: string,
  orderType: string,
  orderTotal: number,
  redirectPath: string
) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistores.in'
  const isDirect = orderType === 'direct'
  const ctaLabel = isDirect ? 'Place Order Again' : 'Return to Cart'
  const bodyMessage = isDirect
    ? 'Your order was automatically cancelled because payment was not completed within the 10-minute window. You can place the order again from the product page below.'
    : 'Your order was automatically cancelled because payment was not completed within the 10-minute window. The items have been returned to your cart so you can try again.'

  const mailOptions = {
    from: customerMailFrom(),
    to: customerEmail,
    subject: `Order Cancelled - ${orderNumber}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .container { background-color: #f9f9f9; border-radius: 10px; padding: 30px; border: 1px solid #e0e0e0; }
            .header { text-align: center; margin-bottom: 30px; }
            .logo { font-size: 28px; font-weight: bold; color: #2563eb; }
            .badge { background-color: #ef4444; color: white; font-size: 18px; font-weight: bold; text-align: center; padding: 15px 20px; border-radius: 8px; margin: 20px 0; text-transform: uppercase; }
            .amount-box { background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
            .amount { font-size: 28px; font-weight: bold; color: #2563eb; }
            .info-box { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .button { display: inline-block; background-color: #2563eb; color: white !important; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 15px; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">${storeName()}</div>
            </div>
            <p>Dear ${customerName},</p>
            <div class="badge">Order Auto-Cancelled</div>
            <p>${bodyMessage}</p>
            <div class="amount-box">
              <p style="margin:0;color:#666;">Order Number</p>
              <div style="font-size:18px;font-weight:bold;">${orderNumber}</div>
              <p style="margin:10px 0 0;color:#666;">Amount</p>
              <div class="amount">₹${orderTotal.toFixed(2)}</div>
            </div>
            <div class="info-box">
              <strong>What happened?</strong><br>
              Payment for this order was not received within 10 minutes of placing it, so the order was automatically cancelled and stock was released.
            </div>
            <div style="text-align:center;">
              <a href="${baseUrl}${redirectPath}" class="button" style="color:#ffffff;">${ctaLabel}</a>
            </div>
            <p style="margin-top:25px;">If you completed the payment but still received this email, please contact us so we can reconcile your transaction.</p>
            <div class="footer">
              <p>Need help? Reply to this email or contact <a href="mailto:${process.env.SUPPORT_EMAIL || 'jeffistoress@gmail.com'}">${process.env.SUPPORT_EMAIL || 'jeffistoress@gmail.com'}</a></p>
              <p>&copy; ${new Date().getFullYear()} Jeffi Stores</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }

  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'order',
      templateName: 'order_auto_cancelled',
      entityType: 'orders',
      entityId: orderId ?? null,
      metadata: { orderNumber, orderType, orderTotal },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendOrderAutoCancelledAdminNotification(order: any, redirectPath: string) {
  const adminEmail = await getAdminNotificationEmails()
  const baseUrl = process.env.ADMIN_BASE_URL || 'https://admin.jeffistores.in'
  const total = parseFloat(order.total_amount || 0)

  const mailOptions = {
    from: adminMailFrom(),
    to: adminEmail,
    subject: `[Auto-Cancelled] Order ${order.order_number}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .container { background-color: #f9f9f9; border-radius: 10px; padding: 30px; border: 1px solid #e0e0e0; }
            .badge { background-color: #ef4444; color: white; font-size: 16px; font-weight: bold; text-align: center; padding: 12px; border-radius: 8px; margin: 15px 0; }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            td { padding: 8px; border-bottom: 1px solid #e0e0e0; }
            td.label { color: #666; width: 40%; }
            .button { display: inline-block; background-color: #2563eb; color: white !important; padding: 10px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2 style="margin-top:0;">Order Auto-Cancelled (Payment Timeout)</h2>
            <div class="badge">10-MINUTE PAYMENT WINDOW EXPIRED</div>
            <p>An order was automatically cancelled because the customer did not complete payment within 10 minutes.</p>
            <table>
              <tr><td class="label">Order Number</td><td><strong>${order.order_number}</strong></td></tr>
              <tr><td class="label">Customer</td><td>${order.customer_name || ''} &lt;${order.customer_email || ''}&gt;</td></tr>
              <tr><td class="label">Order Type</td><td>${order.order_type || 'cart'}</td></tr>
              <tr><td class="label">Amount</td><td>₹${total.toFixed(2)}</td></tr>
              <tr><td class="label">Customer Redirected To</td><td>${redirectPath}</td></tr>
            </table>
            <p>Stock has been released. ${order.order_type === 'direct' ? 'Items were not restored to a cart (direct order).' : 'Items were restored to the customer cart.'}</p>
            <div style="text-align:center;margin-top:20px;">
              <a href="${baseUrl}/admin/orders/${order.id}" class="button" style="color:#ffffff;">View Order in Admin</a>
            </div>
          </div>
        </body>
      </html>
    `,
  }

  try {
    const info = await sendAuditedMail({
      ...mailOptions,
      kind: 'admin_notification',
      templateName: 'order_auto_cancelled_admin',
      entityType: 'orders',
      entityId: order?.id ?? null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendOrderDelayNotification(args: {
  toEmail: string
  customerName: string
  orderNumber: string
  delayDays: number
  reason: string
}) {
  const { toEmail, customerName, orderNumber, delayDays, reason } = args
  const dayLabel = delayDays === 1 ? 'day' : 'days'
  const subject = `Update on your Jeffi Stores order ${orderNumber}`
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:#1a3a4a;padding:20px 28px;color:#ffffff;font-weight:700;font-size:18px;">${storeName()}</td></tr>
        <tr><td style="padding:28px 28px 8px;font-size:16px;line-height:1.5;">
          <p style="margin:0 0 16px;">Hi ${customerName},</p>
          <p style="margin:0 0 16px;">We're writing to let you know that your order <strong>${orderNumber}</strong> will be delayed by approximately <strong>${delayDays} ${dayLabel}</strong>.</p>
          <p style="margin:0 0 16px;"><strong>Reason:</strong> ${reason}</p>
          <p style="margin:0 0 16px;">We're sorry for the inconvenience. We'll send you another update as soon as the situation changes, and your order is on its way.</p>
          <p style="margin:0 0 16px;">If you have any questions, just reply to this email and we'll get back to you.</p>
          <p style="margin:24px 0 0;color:#475569;">Thank you for your patience,<br>The Jeffi Stores team</p>
        </td></tr>
        <tr><td style="padding:20px 28px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">This is an automated update about order ${orderNumber}. Please do not reply with sensitive information.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
  const text = `Hi ${customerName},

Your order ${orderNumber} will be delayed by approximately ${delayDays} ${dayLabel}.

Reason: ${reason}

We're sorry for the inconvenience. We'll send another update as soon as the situation changes.

If you have any questions, just reply to this email.

— The Jeffi Stores team`

  try {
    const info = await sendAuditedMail({
      from: customerMailFrom(),
      to: toEmail,
      subject,
      html,
      text,
      kind: 'order',
      templateName: 'order_delay',
      entityType: 'orders',
      entityId: null,
      metadata: { orderNumber, delayDays, reason },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

interface AnnouncementProduct {
  id: string
  name: string
  slug: string
  price: string
  short_description: string | null
  primary_image_url?: string | null
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function sendProductAnnouncementEmail(args: {
  toEmail: string
  customerName?: string
  subject: string
  intro: string
  products: AnnouncementProduct[]
}) {
  const { toEmail, customerName, subject, intro, products } = args
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://jeffistores.in'
  const cleanIntro = intro
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\(https?:[^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  const cards = products.map(p => `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#ffffff;">
      <tr>
        ${p.primary_image_url ? `<td width="120" style="vertical-align:top;padding:12px;"><img src="${escapeHtml(p.primary_image_url)}" alt="" width="100" height="100" style="display:block;border-radius:6px;object-fit:cover;"></td>` : ''}
        <td style="padding:14px 16px 14px ${p.primary_image_url ? '0' : '16px'};vertical-align:top;">
          <a href="${siteUrl}/products/${escapeHtml(p.slug)}" style="text-decoration:none;color:#1a3a4a;font-weight:600;font-size:15px;">${escapeHtml(p.name)}</a>
          ${p.short_description ? `<p style="margin:4px 0 6px;color:#475569;font-size:13px;line-height:1.4;">${escapeHtml(p.short_description.slice(0, 140))}</p>` : ''}
          <p style="margin:6px 0 0;font-weight:600;color:#0f172a;font-size:14px;">₹${escapeHtml(p.price)}</p>
        </td>
      </tr>
    </table>`).join('')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:#1a3a4a;padding:18px 24px;color:#ffffff;font-weight:700;font-size:18px;">${storeName()}</td></tr>
        <tr><td style="padding:24px 20px 8px;">
          <p style="margin:0 0 12px;font-size:15px;">Hi ${escapeHtml(customerName || 'there')},</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#334155;">${escapeHtml(cleanIntro)}</p>
          ${cards}
          <p style="margin:18px 0 0;font-size:13px;color:#64748b;">Visit <a href="${siteUrl}" style="color:#1a3a4a;">jeffistores.in</a> for the full catalogue.</p>
        </td></tr>
        <tr><td style="padding:18px 24px;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0;">You are receiving this because you opted in to product updates from Jeffi Stores. To stop receiving these, reply to this email with "unsubscribe".</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  const textProducts = products.map(p => `• ${p.name} — ₹${p.price}\n  ${siteUrl}/products/${p.slug}`).join('\n\n')
  const text = `Hi ${customerName || 'there'},\n\n${cleanIntro}\n\n${textProducts}\n\nVisit ${siteUrl} for the full catalogue.\n\n— Jeffi Stores`

  try {
    const info = await sendAuditedMail({
      from: customerMailFrom(),
      to: toEmail,
      subject,
      html,
      text,
      kind: 'campaign',
      templateName: 'product_announcement',
      metadata: { productCount: products.length, productIds: products.map(p => p.id) },
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

// Admin-initiated post-order variant/sub-variant change awaiting customer approval.
// Shows old → new variant, the price difference (refund owed / extra due /
// COD-adjusted total), and a link to confirm on the order page.
export async function sendVariantChangeRequestedEmail(params: {
  customerEmail: string
  customerName: string
  orderNumber: string
  orderId: string
  oldVariantName: string | null
  newVariantName: string | null
  priceDiff: number
  settlementType: 'refund' | 'collect' | 'cod_adjust' | 'none'
  newTotal: number
}): Promise<{ success: boolean; messageId?: string; error?: unknown }> {
  const from = customerMailFrom()
  const orderUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/account/orders/${params.orderId}`
  const absDiff = Math.abs(params.priceDiff)
  const diffLine = params.settlementType === 'refund'
    ? `We'll <strong>refund &#8377;${absDiff.toFixed(2)}</strong> to your original payment once you confirm.`
    : params.settlementType === 'collect'
      ? `An additional <strong>&#8377;${absDiff.toFixed(2)}</strong> is payable — you'll be asked to pay it securely when you confirm.`
      : params.settlementType === 'cod_adjust'
        ? `Your order total will be updated to <strong>&#8377;${params.newTotal.toFixed(2)}</strong> (payable on delivery).`
        : `There is no change to your total.`

  const subject = `Action needed: variant change on order ${params.orderNumber}`
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f4f4f5;margin:0;padding:24px;color:#111827;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;color:#fff;padding:20px 24px;"><h2 style="margin:0;font-size:18px;">Variant change requested</h2></div>
      <div style="padding:24px;">
        <p style="margin-top:0;">Hi ${params.customerName || 'there'},</p>
        <p>For your order <strong>${params.orderNumber}</strong>, we'd like to substitute an item with a near-equivalent variant. Please review and confirm:</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0 0 6px;"><span style="color:#6b7280;">Current:</span> ${params.oldVariantName || '&#8212;'}</p>
          <p style="margin:0;"><span style="color:#6b7280;">Proposed:</span> <strong>${params.newVariantName || '&#8212;'}</strong></p>
        </div>
        <p>${diffLine}</p>
        <p style="text-align:center;margin:24px 0 8px;">
          <a href="${orderUrl}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 28px;border-radius:6px;font-weight:bold;text-decoration:none;">Review &amp; Confirm</a>
        </p>
        <p style="font-size:12px;color:#6b7280;text-align:center;">The change is applied only after you confirm. You can also decline it.</p>
      </div>
    </div></body></html>`

  try {
    const info = await sendAuditedMail({
      from,
      to: params.customerEmail,
      subject,
      html,
      kind: 'variant_change_requested',
      templateName: 'variant_change_requested',
      entityType: 'orders',
      entityId: params.orderId,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

/**
 * Operational report for background jobs (marketplace syncs and similar).
 *
 * These used to build their own nodemailer transport and send bare <h2>/<ul> HTML, so they
 * looked nothing like the rest of the system's mail and — because they bypassed the audited
 * sender — never appeared in /admin/audit?tab=mail_log. Services should not send mail
 * themselves; they describe what happened and the email service renders and records it.
 */
export async function sendOperationalReport(opts: {
  title: string
  startedAt?: string
  finishedAt?: string
  stats?: Record<string, string | number>
  errors?: { sku: string; error: string }[]
  kind?: string
}): Promise<void> {
  const { sendAuditedMail } = await import('./mail-audit')
  const esc = (t: unknown) => String(t ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const errs = opts.errors ?? []
  const shown = errs.slice(0, 20)
  const rows = Object.entries(opts.stats ?? {})
    .map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6b7280">${esc(k)}</td>
        <td style="padding:4px 0;font-weight:bold;color:#111827">${esc(v)}</td></tr>`)
    .join('')

  const errorBlock = shown.length
    ? `<h3 style="margin:22px 0 8px;font-size:14px;color:#111827">Errors</h3>
       <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.7">
         ${shown.map(e => `<li><strong>${esc(e.sku)}</strong>: ${esc(e.error)}</li>`).join('')}
       </ul>
       ${errs.length > shown.length ? `<p style="color:#6b7280;font-size:12px">…and ${errs.length - shown.length} more.</p>` : ''}`
    : `<p style="color:#059669;font-size:13px;margin:18px 0 0">No errors.</p>`

  const accent = errs.length ? '#b91c1c' : '#059669'

  await sendAuditedMail({
    to: (await import('./brand')).platformAdminEmail(),
    from: adminMailFrom(),
    subject: `[${storeName()}] ${opts.title}${errs.length ? ` — ${errs.length} error(s)` : ''}`,
    kind: opts.kind ?? 'operational_report',
    html: `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f5f5f5;font-family:Arial,sans-serif">
      <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
        <div style="background:${accent};padding:18px 24px">
          <div style="font-size:18px;font-weight:bold;color:#ffffff">${esc(opts.title)}</div>
        </div>
        <div style="padding:22px 24px">
          <table style="border-collapse:collapse;font-size:13px">
            ${opts.startedAt ? `<tr><td style="padding:4px 14px 4px 0;color:#6b7280">Started</td><td style="padding:4px 0;color:#111827">${esc(opts.startedAt)}</td></tr>` : ''}
            ${opts.finishedAt ? `<tr><td style="padding:4px 14px 4px 0;color:#6b7280">Finished</td><td style="padding:4px 0;color:#111827">${esc(opts.finishedAt)}</td></tr>` : ''}
            ${rows}
          </table>
          ${errorBlock}
        </div>
        <div style="padding:14px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px">
          Automated report from ${esc(storeName())}.
        </div>
      </div></body></html>`,
  })
}
