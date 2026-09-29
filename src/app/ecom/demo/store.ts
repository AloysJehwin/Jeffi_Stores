'use client'

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  PRODUCTS,
  SEED_ORDERS,
  SEED_METRICS,
  SEED_ACTIVITY,
  HERO_PRODUCT_ID,
  HERO_CUSTOMER,
} from './data'

export type OrderStatus = 'cart' | 'pending' | 'processing' | 'shipped' | 'delivered'

export interface Product {
  id: string
  name: string
  category: string
  price: number
  mrp: number | null
  rating: number
  reviews: number
}

export interface CartLine {
  productId: string
  name: string
  qty: number
  price: number
}

export interface OrderItem {
  productId: string
  name: string
  qty: number
  price: number
}

export interface TimelineStep {
  label: string
  at: string
  done: boolean
}

export interface Order {
  id: string
  number: string
  customer: string
  items: OrderItem[]
  total: number
  status: OrderStatus
  awb?: string
  placedAt: string
  timeline: TimelineStep[]
}

export interface Metrics {
  revenue: number
  orderCount: number
  todayCount: number
}

export interface ActivityRow {
  id: string
  label: string
  at: string
  kind: 'order' | 'payment' | 'shipment' | 'customer'
}

export interface World {
  products: Product[]
  cart: CartLine[]
  order: Order | null
  orders: Order[]
  metrics: Metrics
  activity: ActivityRow[]
  openProductId: string | null
  invoiceReady: boolean
  campaignSent: boolean
  couponCreated: boolean
  poRaised: boolean
  goodsReceived: boolean
  settled: boolean
  returnStage: 'pending_approval' | 'approved' | 'received' | 'completed'
  quoteFinalized: boolean
  rfqStage: 'negotiating' | 'offer_accepted' | 'converted'
}

export type { FlowId, Flow, Chapter } from './chapters'
import type { FlowId, Flow, Chapter } from './chapters'
import { FLOWS, CHAPTERS, FLOW_CHAPTERS } from './chapters'
export { FLOWS, CHAPTERS, FLOW_CHAPTERS }
function heroLines(): CartLine[] {
  const p = PRODUCTS.find((x) => x.id === HERO_PRODUCT_ID)!
  return [{ productId: p.id, name: p.name, qty: 1, price: p.price }]
}

function makeHeroOrder(status: OrderStatus): Order {
  const lines = heroLines()
  return {
    id: 'o1042',
    number: '1042',
    customer: HERO_CUSTOMER,
    items: lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, price: l.price })),
    total: lines.reduce((s, l) => s + l.price * l.qty, 0),
    status,
    placedAt: '05 Sep 2026',
    timeline: [
      { label: 'Placed', at: '05 Sep, 12:04', done: true },
      { label: 'Processing', at: '', done: false },
      { label: 'Shipped', at: '', done: false },
      { label: 'Delivered', at: '', done: false },
    ],
  }
}

function initialWorld(): World {
  return {
    products: PRODUCTS,
    cart: [],
    order: null,
    orders: SEED_ORDERS,
    metrics: SEED_METRICS,
    activity: SEED_ACTIVITY,
    openProductId: null,
    invoiceReady: false,
    campaignSent: false,
    couponCreated: false,
    poRaised: false,
    goodsReceived: false,
    settled: false,
    returnStage: 'pending_approval',
    quoteFinalized: false,
    rfqStage: 'negotiating',
  }
}

type Action =
  | { type: 'ADD_TO_CART'; id: string }
  | { type: 'OPEN_PRODUCT'; id: string }
  | { type: 'PAY' }
  | { type: 'MARK_PROCESSING' }
  | { type: 'SHIP' }
  | { type: 'GENERATE_INVOICE' }
  | { type: 'SEND_CAMPAIGN' }
  | { type: 'CREATE_COUPON' }
  | { type: 'RAISE_PO' }
  | { type: 'RECEIVE_GOODS' }
  | { type: 'SETTLE' }
  | { type: 'ADVANCE_RETURN' }
  | { type: 'FINALIZE_QUOTE' }
  | { type: 'ADVANCE_RFQ' }
  | { type: 'RESET' }

function pushActivity(list: ActivityRow[], row: ActivityRow): ActivityRow[] {
  return [row, ...list].slice(0, 6)
}

function withTimeline(order: Order, label: string, at: string): TimelineStep[] {
  return order.timeline.map((s) => (s.label === label ? { ...s, at, done: true } : s))
}

function advanceOrder(state: World, next: Order, ev: ActivityRow): World {
  return {
    ...state,
    order: next,
    orders: state.orders.map((o) => (o.id === next.id ? next : o)),
    activity: pushActivity(state.activity, ev),
  }
}

function reducer(state: World, action: Action): World {
  switch (action.type) {
    case 'OPEN_PRODUCT':
      return { ...state, openProductId: action.id }
    case 'ADD_TO_CART': {
      const p = state.products.find((x) => x.id === action.id)
      if (!p) return state
      const existing = state.cart.find((l) => l.productId === p.id)
      const cart = existing
        ? state.cart.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l))
        : [...state.cart, { productId: p.id, name: p.name, qty: 1, price: p.price }]
      return { ...state, cart, openProductId: p.id }
    }
    case 'PAY': {
      const order = makeHeroOrder('pending')
      if (state.cart.length > 0) {
        order.items = state.cart.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, price: l.price }))
        order.total = state.cart.reduce((s, l) => s + l.price * l.qty, 0)
      }
      return placeOrder(state, order)
    }
    case 'MARK_PROCESSING': {
      const order = state.order ?? makeHeroOrder('pending')
      const next: Order = { ...order, status: 'processing', timeline: withTimeline(order, 'Processing', '05 Sep, 12:22') }
      return advanceOrder(state, next, { id: 'ev-proc', label: `Order #${next.number} moved to processing`, at: 'just now', kind: 'order' })
    }
    case 'SHIP': {
      const order = state.order ?? makeHeroOrder('processing')
      const next: Order = { ...order, status: 'shipped', awb: 'DL42019384726', timeline: withTimeline(order, 'Shipped', '05 Sep, 15:40') }
      return advanceOrder(state, next, { id: 'ev-ship', label: `Order #${next.number} shipped, AWB ${next.awb}`, at: 'just now', kind: 'shipment' })
    }
    case 'GENERATE_INVOICE':
      if (!state.order) return state
      return { ...state, invoiceReady: true }
    case 'SEND_CAMPAIGN':
      if (state.campaignSent) return state
      return {
        ...state,
        campaignSent: true,
        activity: pushActivity(state.activity, {
          id: 'ev-camp', label: 'Campaign "Festive Picks" sent to 1,284 customers', at: 'just now', kind: 'customer',
        }),
      }
    case 'CREATE_COUPON':
      if (state.couponCreated) return state
      return {
        ...state,
        couponCreated: true,
        activity: pushActivity(state.activity, {
          id: 'ev-coupon', label: 'Coupon FESTIVE15 created (15% off)', at: 'just now', kind: 'order',
        }),
      }
    case 'RAISE_PO':
      return { ...state, poRaised: true }
    case 'RECEIVE_GOODS':
      return { ...state, poRaised: true, goodsReceived: true }
    case 'SETTLE':
      return { ...state, settled: true }
    case 'ADVANCE_RETURN': {
      const seq: World['returnStage'][] = ['pending_approval', 'approved', 'received', 'completed']
      return { ...state, returnStage: seq[Math.min(seq.indexOf(state.returnStage) + 1, seq.length - 1)] }
    }
    case 'FINALIZE_QUOTE':
      return { ...state, quoteFinalized: true }
    case 'ADVANCE_RFQ': {
      const seq: World['rfqStage'][] = ['negotiating', 'offer_accepted', 'converted']
      return { ...state, rfqStage: seq[Math.min(seq.indexOf(state.rfqStage) + 1, seq.length - 1)] }
    }
    case 'RESET':
      return initialWorld()

    default:
      return state
  }
}

function placeOrder(state: World, order: Order): World {
  return {
    ...state,
    order,
    cart: [],
    invoiceReady: false,
    orders: [order, ...state.orders.filter((o) => o.id !== order.id)],
    metrics: {
      revenue: state.metrics.revenue + order.total,
      orderCount: state.metrics.orderCount + 1,
      todayCount: state.metrics.todayCount + 1,
    },
    activity: pushActivity(state.activity, {
      id: 'ev-pay', label: `Payment received from ${order.customer}`, at: 'just now', kind: 'payment',
    }),
  }
}

const AUTO_PLAY_MS = 3400

interface DemoValue {
  world: World
  chapter: Chapter
  chapterIndex: number
  chapters: Chapter[]
  flow: FlowId
  flows: Flow[]
  isPlaying: boolean
  isManual: boolean
  reducedMotion: boolean
  dispatch: (a: Action) => void
  actions: {
    addToCart: (id: string) => void
    openProduct: (id: string) => void
    pay: () => void
    markProcessing: () => void
    ship: () => void
    generateInvoice: () => void
    sendCampaign: () => void
    createCoupon: () => void
    raisePo: () => void
    receiveGoods: () => void
    settle: () => void
    advanceReturn: () => void
    finalizeQuote: () => void
    advanceRfq: () => void
    goToChapter: (i: number) => void
    setFlow: (id: FlowId) => void
    play: () => void
    pause: () => void
    reset: () => void
  }
}

const DemoContext = createContext<DemoValue | null>(null)

function applyChapter(index: number, dispatch: (a: Action) => void) {
  switch (CHAPTERS[index]?.id) {
    case 'browse':
      dispatch({ type: 'RESET' })
      break
    case 'product':
      dispatch({ type: 'OPEN_PRODUCT', id: HERO_PRODUCT_ID })
      break
    case 'cart':
      dispatch({ type: 'ADD_TO_CART', id: HERO_PRODUCT_ID })
      break
    case 'pay':
      dispatch({ type: 'PAY' })
      break
    case 'dashboard':
      break
    case 'processing':
      dispatch({ type: 'MARK_PROCESSING' })
      break
    case 'ship':
      dispatch({ type: 'SHIP' })
      break
    case 'docs':
      dispatch({ type: 'GENERATE_INVOICE' })
      break
    case 'campaign':
      dispatch({ type: 'SEND_CAMPAIGN' })
      break
    case 'coupon':
      dispatch({ type: 'CREATE_COUPON' })
      break
    case 'crm':
      break
    case 'inventory':
      break
    case 'po':
      dispatch({ type: 'RAISE_PO' })
      break
    case 'grn':
      dispatch({ type: 'RECEIVE_GOODS' })
      break
    case 'settlement':
      dispatch({ type: 'SETTLE' })
      break
    case 'gstinvoice':
      dispatch({ type: 'GENERATE_INVOICE' })
      break
    case 'reports':
      break
    case 'return':
      dispatch({ type: 'ADVANCE_RETURN' })
      break
    case 'quote':
      dispatch({ type: 'FINALIZE_QUOTE' })
      break
    case 'rfq':
      dispatch({ type: 'ADVANCE_RFQ' })
      break
  }
}

export function DemoProvider({ children, initialChapter = 0 }: { children: ReactNode; initialChapter?: number }) {
  const [world, dispatch] = useReducer(reducer, undefined, initialWorld)
  const [chapterIndex, setChapterIndex] = useState(initialChapter)
  const [isPlaying, setIsPlaying] = useState(true)
  const [isManual, setIsManual] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      setReducedMotion(mq.matches)
      if (mq.matches) setIsPlaying(false)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const flow = CHAPTERS[chapterIndex]?.flow ?? 'shop'

  useEffect(() => {
    if (!isPlaying || isManual || reducedMotion) return
    timerRef.current = setInterval(() => {
      setChapterIndex((i) => {
        const seq = FLOW_CHAPTERS[CHAPTERS[i]?.flow ?? 'shop']
        const pos = seq.indexOf(i)
        const next = seq[(pos + 1) % seq.length]
        applyChapter(next, dispatch)
        return next
      })
    }, AUTO_PLAY_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [isPlaying, isManual, reducedMotion])

  // Rebuild the world deterministically up to a target chapter (used by manual jumps and flow
  // switches), so any chapter renders with the state its story assumes.
  const replayTo = (target: number) => {
    dispatch({ type: 'RESET' })
    for (let step = 0; step <= target; step++) applyChapter(step, dispatch)
    setChapterIndex(target)
  }

  const goToChapter = (i: number) => {
    const clamped = ((i % CHAPTERS.length) + CHAPTERS.length) % CHAPTERS.length
    setIsManual(true)
    setIsPlaying(false)
    replayTo(clamped)
  }

  const setFlow = (id: FlowId) => {
    const first = FLOW_CHAPTERS[id][0]
    setIsManual(false)
    setIsPlaying(true)
    replayTo(first)
  }

  const manual = (fn: () => void) => {
    setIsManual(true)
    setIsPlaying(false)
    fn()
  }

  const actions = useMemo<DemoValue['actions']>(
    () => ({
      addToCart: (id) => manual(() => dispatch({ type: 'ADD_TO_CART', id })),
      openProduct: (id) => manual(() => dispatch({ type: 'OPEN_PRODUCT', id })),
      pay: () => manual(() => dispatch({ type: 'PAY' })),
      markProcessing: () => manual(() => dispatch({ type: 'MARK_PROCESSING' })),
      ship: () => manual(() => dispatch({ type: 'SHIP' })),
      generateInvoice: () => manual(() => dispatch({ type: 'GENERATE_INVOICE' })),
      sendCampaign: () => manual(() => dispatch({ type: 'SEND_CAMPAIGN' })),
      createCoupon: () => manual(() => dispatch({ type: 'CREATE_COUPON' })),
      raisePo: () => manual(() => dispatch({ type: 'RAISE_PO' })),
      receiveGoods: () => manual(() => dispatch({ type: 'RECEIVE_GOODS' })),
      settle: () => manual(() => dispatch({ type: 'SETTLE' })),
      advanceReturn: () => manual(() => dispatch({ type: 'ADVANCE_RETURN' })),
      finalizeQuote: () => manual(() => dispatch({ type: 'FINALIZE_QUOTE' })),
      advanceRfq: () => manual(() => dispatch({ type: 'ADVANCE_RFQ' })),
      goToChapter,
      setFlow,
      play: () => {
        setIsManual(false)
        setIsPlaying(true)
      },
      pause: () => setIsPlaying(false),
      reset: () => {
        setIsManual(false)
        setIsPlaying(true)
        setChapterIndex(0)
        dispatch({ type: 'RESET' })
      },
    }),
    []
  )

  const value = useMemo<DemoValue>(
    () => ({
      world,
      chapter: CHAPTERS[chapterIndex],
      chapterIndex,
      chapters: CHAPTERS,
      flow,
      flows: FLOWS,
      isPlaying,
      isManual,
      reducedMotion,
      dispatch,
      actions,
    }),
    [world, chapterIndex, flow, isPlaying, isManual, reducedMotion, actions]
  )

  return createElement(DemoContext.Provider, { value }, children)
}

export function useDemo(): DemoValue {
  const ctx = useContext(DemoContext)
  if (!ctx) throw new Error('useDemo must be used within a DemoProvider')
  return ctx
}
