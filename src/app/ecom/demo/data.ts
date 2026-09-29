import type { Product, Order, ActivityRow, Metrics } from './store'

export const CATEGORIES = ['Electronics', 'Fashion', 'Kitchen', 'Sports', 'Home', 'Beauty'] as const

export const PRODUCTS: Product[] = [
  { id: 'p1',  name: 'Wireless Headphones',      category: 'Electronics', price: 2499, mrp: 3199, rating: 4.6, reviews: 214 },
  { id: 'p2',  name: 'Cotton Casual Shirt',      category: 'Fashion',     price: 899,  mrp: 1299, rating: 4.3, reviews: 128 },
  { id: 'p3',  name: 'Stainless Steel Cookware', category: 'Kitchen',     price: 1299, mrp: null, rating: 4.8, reviews: 96  },
  { id: 'p4',  name: 'Fitness Exercise Mat',     category: 'Sports',      price: 649,  mrp: 899,  rating: 4.5, reviews: 340 },
  { id: 'p5',  name: 'Premium Bedsheet Set',     category: 'Home',        price: 1099, mrp: 1499, rating: 4.7, reviews: 152 },
  { id: 'p6',  name: 'Ceramic Mug Set',          category: 'Kitchen',     price: 549,  mrp: null, rating: 4.4, reviews: 78  },
  { id: 'p7',  name: 'LED Desk Lamp',            category: 'Home',        price: 799,  mrp: 1049, rating: 4.6, reviews: 203 },
  { id: 'p8',  name: 'Canvas Backpack',          category: 'Fashion',     price: 1199, mrp: 1699, rating: 4.5, reviews: 187 },
  { id: 'p9',  name: 'Bluetooth Speaker',        category: 'Electronics', price: 1799, mrp: 2299, rating: 4.5, reviews: 176 },
  { id: 'p10', name: 'Yoga Block Pair',          category: 'Sports',      price: 399,  mrp: 599,  rating: 4.4, reviews: 88  },
  { id: 'p11', name: 'Aroma Diffuser',           category: 'Beauty',      price: 999,  mrp: 1399, rating: 4.7, reviews: 241 },
  { id: 'p12', name: 'Insulated Water Bottle',   category: 'Kitchen',     price: 699,  mrp: 949,  rating: 4.6, reviews: 312 },
]

export const HERO_PRODUCT_ID = 'p1'
export const HERO_CUSTOMER = 'Alex Morgan'

export const SEED_ORDERS: Order[] = [
  {
    id: 'o1041', number: '1041', customer: 'Jordan Lee',
    items: [{ productId: 'p5', name: 'Premium Bedsheet Set', qty: 1, price: 1099 }],
    total: 1099, status: 'delivered', awb: 'DL41938275610', placedAt: '04 Sep 2026',
    timeline: [
      { label: 'Placed', at: '04 Sep, 09:12', done: true },
      { label: 'Processing', at: '04 Sep, 10:40', done: true },
      { label: 'Shipped', at: '04 Sep, 16:20', done: true },
      { label: 'Delivered', at: '06 Sep, 13:05', done: true },
    ],
  },
  {
    id: 'o1040', number: '1040', customer: 'Sam Carter',
    items: [{ productId: 'p4', name: 'Fitness Exercise Mat', qty: 1, price: 649 }],
    total: 649, status: 'processing', placedAt: '05 Sep 2026',
    timeline: [
      { label: 'Placed', at: '05 Sep, 08:31', done: true },
      { label: 'Processing', at: '05 Sep, 09:15', done: true },
      { label: 'Shipped', at: '', done: false },
      { label: 'Delivered', at: '', done: false },
    ],
  },
  {
    id: 'o1039', number: '1039', customer: 'Taylor Reed',
    items: [
      { productId: 'p7', name: 'LED Desk Lamp', qty: 2, price: 799 },
      { productId: 'p6', name: 'Ceramic Mug Set', qty: 1, price: 549 },
    ],
    total: 2147, status: 'pending', placedAt: '05 Sep 2026',
    timeline: [
      { label: 'Placed', at: '05 Sep, 11:48', done: true },
      { label: 'Processing', at: '', done: false },
      { label: 'Shipped', at: '', done: false },
      { label: 'Delivered', at: '', done: false },
    ],
  },
  {
    id: 'o1038', number: '1038', customer: 'Casey Brooks',
    items: [{ productId: 'p2', name: 'Cotton Casual Shirt', qty: 1, price: 899 }],
    total: 899, status: 'delivered', awb: 'DL38102947551', placedAt: '03 Sep 2026',
    timeline: [
      { label: 'Placed', at: '03 Sep, 14:02', done: true },
      { label: 'Processing', at: '03 Sep, 15:10', done: true },
      { label: 'Shipped', at: '03 Sep, 18:44', done: true },
      { label: 'Delivered', at: '05 Sep, 10:22', done: true },
    ],
  },
  {
    id: 'o1037', number: '1037', customer: 'Riya Nair',
    items: [{ productId: 'p9', name: 'Bluetooth Speaker', qty: 1, price: 1799 }],
    total: 1799, status: 'shipped', awb: 'DL37559182034', placedAt: '05 Sep 2026',
    timeline: [
      { label: 'Placed', at: '05 Sep, 07:20', done: true },
      { label: 'Processing', at: '05 Sep, 08:05', done: true },
      { label: 'Shipped', at: '05 Sep, 12:30', done: true },
      { label: 'Delivered', at: '', done: false },
    ],
  },
  {
    id: 'o1036', number: '1036', customer: 'Marcus Fdo',
    items: [{ productId: 'p11', name: 'Aroma Diffuser', qty: 2, price: 999 }],
    total: 1998, status: 'delivered', awb: 'DL36771029845', placedAt: '02 Sep 2026',
    timeline: [
      { label: 'Placed', at: '02 Sep, 16:41', done: true },
      { label: 'Processing', at: '02 Sep, 17:30', done: true },
      { label: 'Shipped', at: '02 Sep, 20:10', done: true },
      { label: 'Delivered', at: '04 Sep, 11:55', done: true },
    ],
  },
]

export const SEED_METRICS: Metrics = { revenue: 384250, orderCount: 342, todayCount: 12 }

export const SEED_ACTIVITY: ActivityRow[] = [
  { id: 'a1', label: 'Order #1040 moved to processing', at: '2m ago', kind: 'order' },
  { id: 'a2', label: 'Payment received from Jordan Lee', at: '18m ago', kind: 'payment' },
  { id: 'a3', label: 'Order #1037 shipped to Riya Nair', at: '40m ago', kind: 'shipment' },
  { id: 'a4', label: 'New customer Taylor Reed signed up', at: '2h ago', kind: 'customer' },
]

export interface DemoCustomer { id: string; name: string; orders: number; spent: number; tag: string }
export const CUSTOMERS: DemoCustomer[] = [
  { id: 'c1', name: 'Jordan Lee',   orders: 9, spent: 18240, tag: 'VIP' },
  { id: 'c2', name: 'Taylor Reed',  orders: 5, spent: 8630,  tag: 'Loyal' },
  { id: 'c3', name: 'Riya Nair',    orders: 3, spent: 5210,  tag: 'Repeat' },
  { id: 'c4', name: 'Sam Carter',   orders: 2, spent: 2980,  tag: 'New' },
  { id: 'c5', name: 'Marcus Fdo',   orders: 6, spent: 11450, tag: 'Loyal' },
]

export interface DemoCampaign { id: string; name: string; audience: string; reach: number }
export const CAMPAIGN = { name: 'Festive Picks', audience: 'Repeat buyers (last 90 days)', reach: 1284, openRate: 41, orders: 76 }
export const COUPON = { code: 'FESTIVE15', off: '15% off', minCart: 999, used: 132, cap: 500 }

// Inventory & catalogue (stock levels, low-stock, PO/GRN)
export interface StockRow { id: string; sku: string; name: string; onHand: number; threshold: number; status: 'In Stock' | 'Low Stock' | 'Out of Stock' }
export const STOCK_ROWS: StockRow[] = [
  { id: 'p1',  sku: 'NS-HD-01',  name: 'Wireless Headphones',      onHand: 42, threshold: 10, status: 'In Stock' },
  { id: 'p3',  sku: 'NS-CK-03',  name: 'Stainless Steel Cookware', onHand: 8,  threshold: 12, status: 'Low Stock' },
  { id: 'p9',  sku: 'NS-SP-09',  name: 'Bluetooth Speaker',        onHand: 0,  threshold: 8,  status: 'Out of Stock' },
  { id: 'p5',  sku: 'NS-BD-05',  name: 'Premium Bedsheet Set',     onHand: 27, threshold: 10, status: 'In Stock' },
  { id: 'p12', sku: 'NS-WB-12',  name: 'Insulated Water Bottle',   onHand: 6,  threshold: 15, status: 'Low Stock' },
]
export const SUPPLIER = { name: 'Meridian Wholesale', gstin: '29ABCDE1234F1Z5', terms: 30 }
export const PURCHASE_ORDER = {
  poNumber: 'PO/2025-26/048', supplier: 'Meridian Wholesale', expected: '12 Sep 2026',
  lines: [
    { name: 'Bluetooth Speaker', ordered: 40, received: 0, rate: 1180 },
    { name: 'Stainless Steel Cookware', ordered: 24, received: 0, rate: 860 },
  ],
}

// Payments, GST & finance
export const SETTLEMENT = {
  gross: 2499, tenantShare: 2311, commission: 125, gatewayFee: 63, gateway: 'Razorpay', isCod: false,
}
export const INVOICE = {
  number: 'JS/2025-26/119', date: '05 Sep 2026', buyer: 'Alex Morgan', buyerGstin: '-',
  hsn: '85183000', taxable: 2117.80, cgst: 190.60, sgst: 190.60, total: 2499,
}
export const RECEIVABLES = [
  { id: 'r1', invoice: 'JS/2025-26/117', customer: 'Northwind Traders', amount: 42800, age: '0-30', badge: 'partial' },
  { id: 'r2', invoice: 'JS/2025-26/109', customer: 'Blue Oak Cafe',     amount: 18650, age: '31-60', badge: 'overdue' },
  { id: 'r3', invoice: 'JS/2025-26/121', customer: 'Alex Morgan',       amount: 2499,  age: '0-30', badge: 'paid' },
]

// Returns, quotations & B2B
export const RETURN_REQUEST = {
  id: 'rr-208', order: '1039', customer: 'Taylor Reed', type: 'refund' as 'refund' | 'replacement',
  reason: 'defective', item: 'LED Desk Lamp', amount: 799,
}
export const QUOTE = {
  number: 'QT/2025-26/054', buyer: 'Northwind Traders', buyerGstin: '27AAECN1234M1Z2',
  lines: [
    { desc: 'Bluetooth Speaker', hsn: '85182200', qty: 20, unit: 'PCS', rate: 1799, discount: 8 },
    { desc: 'LED Desk Lamp', hsn: '94051000', qty: 30, unit: 'PCS', rate: 799, discount: 5 },
  ],
  gstRate: 18,
}
export interface RfqOffer { line: string; qty: number; requested: number; offered: number }
export const RFQ = {
  number: 'RFQ/2025-26/031', company: 'Northwind Traders', gstin: '27AAECN1234M1Z2',
  offers: [
    { line: 'Bluetooth Speaker', qty: 20, requested: 1650, offered: 1720 },
    { line: 'LED Desk Lamp', qty: 30, requested: 720, offered: 760 },
  ] as RfqOffer[],
}

export const DASHBOARD_BARS = [38, 55, 47, 72, 58, 85, 68, 74, 62, 88, 79, 92, 71, 83, 95, 68, 77, 84, 91, 100]
