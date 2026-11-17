import {
  ArrowLeft, ArrowRight, ArrowUpRight, Award, Baby, BadgeCheck, Banknote, Bike, BookOpen, Boxes, Cake, Calendar, Camera, Car, Check, ChevronDown,
  ChevronLeft, ChevronRight, CircleCheck, Clock, Coffee, CreditCard, Crown, Diamond, Dog, Droplet, Dumbbell, Eye, Factory, Feather, Flame, Flower2,
  Gauge, Gem, Gift, Globe, HandHeart, Handshake, Headphones, Heart, Hourglass, House, Infinity as InfinityIcon, Layers, Leaf, Lock, Mail, MapPin,
  MessageCircle, Minus, Moon, Mountain, Music, Package, Palette, Percent, Phone, Pill, Play, Plus, Quote, Recycle, RefreshCw, RotateCcw, Ruler,
  Scissors, Search, Shield, ShieldCheck, Shirt, ShoppingBag, ShoppingCart, Smartphone, Smile, Snowflake, Sparkle, Sparkles, Sprout, Star, Store,
  Sun, Tag, ThumbsUp, Timer, TreePine, Truck, User, Watch, Waves, Wind, Wrench, Zap, type LucideIcon,
} from 'lucide-react'

// The icons a code section may name: kebab-case lucide names.
export const CODE_ICONS: Record<string, LucideIcon> = {
  'arrow-left': ArrowLeft, 'arrow-right': ArrowRight, 'arrow-up-right': ArrowUpRight, award: Award, baby: Baby, 'badge-check': BadgeCheck,
  banknote: Banknote, bike: Bike, 'book-open': BookOpen, boxes: Boxes, cake: Cake, calendar: Calendar, camera: Camera, car: Car, check: Check,
  'check-circle': CircleCheck, 'chevron-down': ChevronDown, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight, clock: Clock, coffee: Coffee,
  'credit-card': CreditCard, crown: Crown, diamond: Diamond, dog: Dog, droplet: Droplet, dumbbell: Dumbbell, eye: Eye, factory: Factory,
  feather: Feather, flame: Flame, flower: Flower2, gauge: Gauge, gem: Gem, gift: Gift, globe: Globe, 'hand-heart': HandHeart, handshake: Handshake,
  headphones: Headphones, heart: Heart, hourglass: Hourglass, home: House, infinity: InfinityIcon, layers: Layers, leaf: Leaf, lock: Lock, mail: Mail,
  'map-pin': MapPin, 'message-circle': MessageCircle, minus: Minus, moon: Moon, mountain: Mountain, music: Music, package: Package, palette: Palette,
  percent: Percent, phone: Phone, pill: Pill, play: Play, plus: Plus, quote: Quote, recycle: Recycle, refresh: RefreshCw, 'rotate-ccw': RotateCcw,
  ruler: Ruler, scissors: Scissors, search: Search, shield: Shield, 'shield-check': ShieldCheck, shirt: Shirt, 'shopping-bag': ShoppingBag,
  'shopping-cart': ShoppingCart, smartphone: Smartphone, smile: Smile, snowflake: Snowflake, sparkle: Sparkle, sparkles: Sparkles, sprout: Sprout,
  star: Star, store: Store, sun: Sun, tag: Tag, 'thumbs-up': ThumbsUp, timer: Timer, tree: TreePine, truck: Truck, user: User, watch: Watch,
  waves: Waves, wind: Wind, wrench: Wrench, zap: Zap,
}

export const CODE_ICON_NAMES = Object.keys(CODE_ICONS) as [string, ...string[]]
