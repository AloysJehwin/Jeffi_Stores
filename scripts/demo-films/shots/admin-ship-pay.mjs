// Admin a3: shipping with built-in couriers, then payments and settlements.
import { ADMIN, adminLogin } from './common.mjs'

export default {
  viewport: { width: 1536, height: 960 },
  mask: true,
  async before(page, h) {
    await adminLogin(page)
    await h.goto(`${ADMIN}/admin/delhivery`, 3000)
  },
  async run(page, h) {
    await h.sleep(500)
    await h.cursorTo('text=SHIPMENTS', 800)
    await h.sleep(400)
    await h.cursorTo('text=ON TIME', 700)
    await h.sleep(500)
    await h.cursorTo('text=Pickups not yet collected', 700)
    await h.sleep(800)
    await h.goto(`${ADMIN}/admin/financial`, 1500)
    await h.sleep(800)
    await h.cursorTo('text=NET SALES', 700)
    await h.sleep(400)
    await h.click('text=Razorpay settlements', 800)
    await h.sleep(2600)
  },
}
