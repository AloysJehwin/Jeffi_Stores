import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: 'email-smtp.us-east-1.amazonaws.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SES_SMTP_USER,
    pass: process.env.SES_SMTP_PASSWORD,
  },
})

export async function sendOTPEmail(email: string, otp: string, name?: string) {
  const mailOptions = {
    from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
    to: email,
    subject: 'Your Verification Code - Jeffi Stores',
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
              margin: 30px 0;
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
              <div class="logo">Jeffi Stores</div>
              <p style="color: #666;">Hardware & Tools</p>
            </div>

            <h2>Email Verification</h2>
            <p>Hello ${name || 'Customer'},</p>
            <p>Thank you for registering with Jeffi Stores. Please use the following One-Time Password (OTP) to verify your email address:</p>

            <div class="otp-box">${otp}</div>

            <p style="text-align: center; margin: -10px 0 24px;">
              <a href="#"
                 onclick="var t=this;navigator.clipboard.writeText('${otp}').then(function(){t.innerHTML='&#10003; Copied!';t.style.backgroundColor='#22c55e';t.style.borderColor='#16a34a';t.style.color='white';setTimeout(function(){t.innerHTML='&#128203; Copy OTP';t.style.backgroundColor='#f1f5f9';t.style.borderColor='#cbd5e1';t.style.color='#334155';},2000)}).catch(function(){});return false;"
                 style="display:inline-block;background-color:#f1f5f9;color:#334155;border:1px solid #cbd5e1;padding:9px 24px;border-radius:6px;font-size:13px;font-weight:700;text-decoration:none;font-family:Arial,sans-serif;cursor:pointer;">
                &#128203; Copy OTP
              </a>
            </p>

            <div class="info">
              <strong>This OTP will expire in 10 minutes.</strong>
              <br>
              <small>Please do not share this code with anyone.</small>
            </div>

            <p>If you didn't request this verification code, please ignore this email or contact our support team.</p>

            <div class="footer">
              <p><strong>Jeffi Stores</strong></p>
              <p>SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092</p>
                            <p>Phone: +91 89030 31299 | Email: jeffistoress@gmail.com</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }

  try {
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendWelcomeEmail(email: string, name: string) {
  const mailOptions = {
    from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
    to: email,
    subject: 'Welcome to Jeffi Stores!',
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
              color: white;
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
              <div class="logo">Jeffi Stores</div>
              <p style="color: #666;">Hardware & Tools</p>
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
              <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/products" class="button">
                Start Shopping
              </a>
            </div>

            <p>If you have any questions or need assistance, feel free to reach out to our team.</p>

            <div class="footer">
              <p><strong>Jeffi Stores</strong></p>
              <p>SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092</p>
                                          <p>Phone: +91 89030 31299 | +91 94883 54099<br>Email: jeffistoress@gmail.com</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }

  try {
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendOrderConfirmationEmail(email: string, order: any, orderItems: any[], invoicePdfBuffer?: Buffer | null) {
  const mailOptions = {
    from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
    to: email,
    subject: `Order Confirmation - ${order.order_number}`,
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
              <div class="logo">Jeffi Stores</div>
              <p style="color: #666;">Hardware & Tools</p>
            </div>

            <h2>Order Confirmed!</h2>
            <p>Hello ${order.customer_name},</p>
            <p>Thank you for your order! We've received it and our team will contact you shortly to confirm payment and delivery details.</p>

            <div class="order-box">
              <h3 style="margin-top: 0;">Order Details</h3>
              <p><strong>Order Number:</strong> ${order.order_number}</p>
              ${order.invoice_number ? `<p><strong>Invoice Number:</strong> ${order.invoice_number}</p>` : ''}
              <p><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
              })}</p>
              <p><strong>Status:</strong> <span style="color: #f97316; font-weight: bold;">PENDING CONFIRMATION</span></p>
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

            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
              <h4 style="margin-top: 0;">Next Steps</h4>
              <p style="margin: 5px 0;">Our team will contact you within 24 hours to:</p>
              <ul style="margin: 10px 0;">
                <li>Confirm your order details</li>
                <li>Provide payment instructions</li>
                <li>Schedule delivery</li>
              </ul>
            </div>

            <p>If you have any questions, feel free to contact us:</p>
                                        <p>Phone: +91 89030 31299 | +91 94883 54099<br>Email: jeffistoress@gmail.com</p>

            <div class="footer">
              <p><strong>Jeffi Stores</strong></p>
              <p>SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092</p>
            </div>
          </div>
        </body>
      </html>
    `,
    attachments: invoicePdfBuffer ? [{
      filename: `Invoice-${order.invoice_number || order.order_number}.pdf`,
      content: invoicePdfBuffer,
      contentType: 'application/pdf',
    }] : [],
  }

  try {
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendNewOrderNotification(order: any, orderItems: any[], _user: any) {
  const adminEmail = process.env.ADMIN_EMAIL || 'jeffistoress@gmail.com'
  
  const mailOptions = {
    from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
    to: adminEmail,
    subject: `New Order - ${order.order_number}`,
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
              <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/admin/orders/${order.id}" 
                 style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                View Order in Admin Panel
              </a>
            </p>
          </div>
        </body>
      </html>
    `,
  }

  try {
    const info = await transporter.sendMail(mailOptions)
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
  trackingUrl?: string
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

  const mailOptions = {
    from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
    to: customerEmail,
    subject: `${statusInfo.title} - Order ${orderNumber}`,
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
              color: white;
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
              <div class="logo">Jeffi Stores</div>
              <p style="color: #666;">Hardware & Tools</p>
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
                ${trackingUrl ? `
                <p style="margin-bottom: 12px;">Use the link below to track your shipment in real time:</p>
                <p style="text-align: center; margin: 0;">
                  <a href="${trackingUrl}" target="_blank"
                     style="display: inline-block; background-color: #2563eb; color: white; padding: 10px 24px; border-radius: 6px; font-weight: bold; text-decoration: none; font-size: 14px;">
                    Track Your Order
                  </a>
                </p>
                <p style="font-size: 12px; color: #64748b; margin-top: 10px; word-break: break-all;">
                  Or copy this link: <a href="${trackingUrl}" style="color: #2563eb;">${trackingUrl}</a>
                </p>
                ` : `<p>You can track your order by logging into your account.</p>`}
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
                 class="button">
                View Order Details
              </a>
            </p>

            <p>If you have any questions about your order, please feel free to contact us.</p>

            <div class="footer">
              <p><strong>Jeffi Stores</strong></p>
              <p>SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092</p>
                            <p>Phone: +91 89030 31299 | Email: jeffistoress@gmail.com</p>
            </div>
          </div>
        </body>
      </html>
    `,
    attachments: invoicePdfBuffer ? [{
      filename: `Invoice-${orderNumber}.pdf`,
      content: invoicePdfBuffer,
      contentType: 'application/pdf',
    }] : [],
  }

  try {
    const info = await transporter.sendMail(mailOptions)
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

  const mailOptions = {
    from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
    to: customerEmail,
    subject: `${paymentInfo.title} - Order ${orderNumber}`,
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
              color: white;
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
              <div class="logo">Jeffi Stores</div>
              <p style="color: #666;">Hardware & Tools</p>
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
                 class="button">
                View Order Details
              </a>
            </p>

            <p>If you have any questions about this payment update, please contact us.</p>

            <div class="footer">
              <p><strong>Jeffi Stores</strong></p>
              <p>SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092</p>
                            <p>Phone: +91 89030 31299 | Email: jeffistoress@gmail.com</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }

  try {
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendAdminCertificateEmail(
  email: string,
  username: string,
  p12Buffer: Buffer,
  p12Password: string,
  serialNumber: string,
  expiresAt: string,
  role: string
) {
  const mailOptions = {
    from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
    to: email,
    subject: 'Your Admin Certificate - Jeffi Stores',
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
              <div class="logo">Jeffi Stores</div>
              <p style="color: #666;">Admin Panel Access</p>
            </div>

            <h2>Welcome, ${username}!</h2>
            <p>You have been added as an <strong>${role}</strong> on the Jeffi Stores admin panel. Your client certificate is attached to this email.</p>

            <div class="credential-box">
              <div class="label">Username</div>
              <div class="value">${username}</div>
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
                <li>Download the attached <code>${username}-admin-cert.p12</code> file.</li>
                <li>Double-click the file to open it in your system's certificate manager.</li>
                <li>Enter the certificate password shown above when prompted.</li>
                <li>Navigate to <strong>https://admin.jeffistores.in/admin/login</strong> to access the admin panel.</li>
              </ol>
            </div>

            <p>If you have any questions, contact the super admin.</p>

            <div class="footer">
              <p><strong>Jeffi Stores</strong></p>
              <p>SANJAY GANTHI CHOWK, STATION ROAD<br>RAIPUR, CHHATTISGARH-490092</p>
              <p>Phone: +91 89030 31299 | Email: jeffistoress@gmail.com</p>
            </div>
          </div>
        </body>
      </html>
    `,
    attachments: [
      {
        filename: `${username}-admin-cert.p12`,
        content: p12Buffer,
        contentType: 'application/x-pkcs12',
      },
    ],
  }

  try {
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendNewReviewNotification(review: any, user: any, product: any) {
  const adminEmail = process.env.ADMIN_EMAIL || 'aloysjehwin@gmail.com'

  const mailOptions = {
    from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
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
              color: white;
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
                <span class="stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} (${review.rating}/5)</span>
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
              <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/admin/reviews" class="button">
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
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendPaymentFailedAdminNotification(
  order: { order_number: string; id: string; customer_name: string; customer_email: string; total_amount: string | number; customer_phone?: string },
  errorDescription?: string
) {
  const adminEmail = process.env.ADMIN_EMAIL || 'jeffistoress@gmail.com'

  const mailOptions = {
    from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
    to: adminEmail,
    subject: `Payment Failed - Order ${order.order_number}`,
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
              <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/admin/orders/${order.id}"
                 style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                View Order in Admin Panel
              </a>
            </p>
          </div>
        </body>
      </html>
    `,
  }

  try {
    const info = await transporter.sendMail(mailOptions)
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendAdminContactEmail(
  email: string,
  name: string,
  subject: string,
  message: string
) {
  const mailOptions = {
    from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
    to: email,
    subject,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .container { background-color: #f9f9f9; border-radius: 10px; padding: 30px; border: 1px solid #e0e0e0; }
            .header { text-align: center; padding-bottom: 20px; border-bottom: 3px solid #f97316; margin-bottom: 30px; }
            .logo { font-size: 28px; font-weight: bold; color: #f97316; }
            .message-box { background-color: #fff; border-left: 4px solid #f97316; padding: 20px; border-radius: 4px; margin: 20px 0; white-space: pre-wrap; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #666; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">Jeffi Stores</div>
              <p style="color: #666; margin: 4px 0 0;">Hardware &amp; Tools</p>
            </div>
            <p>Hello ${name || 'Valued Customer'},</p>
            <p>You have received a message from the Jeffi Stores team:</p>
            <div class="message-box">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
            <div class="footer">
              <p>This message was sent by the Jeffi Stores admin team. Please do not reply directly to this email.</p>
              <p><strong>Jeffi Stores</strong> | SANJAY GANTHI CHOWK, STATION ROAD, RAIPUR, CHHATTISGARH-490092</p>
              <p>Phone: +91 89030 31299 | Email: jeffistoress@gmail.com</p>
            </div>
          </div>
        </body>
      </html>
    `,
  }

  try {
    const info = await transporter.sendMail(mailOptions)
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://jeffistores.com'
  const chatLink = `${appUrl}/admin/customers/${customerId}?chat=true`
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
        <div class="header"><div class="logo">Jeffi Stores</div></div>
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
    await transporter.sendMail(mailOptions)
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
      <a href="${appUrl}/admin/orders/${orderId}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">Review Request</a>
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
        <div class="header"><div class="logo">Jeffi Stores</div></div>
        <div class="body">
          ${event !== 'requested_admin' ? `<p>Hi ${recipientName},</p>` : ''}
          ${bodies[event]}
        </div>
        <div class="footer"><p>Jeffi Stores — do not reply to this email.</p></div>
      </div></body></html>
    `,
  }

  try {
    await transporter.sendMail(mailOptions)
    return { success: true }
  } catch (error) {
    return { success: false, error }
  }
}
