import type { AnyScenarioModule } from '../types'
import { abandonedCart } from './abandoned-cart'
import { abandonedCheckout } from './abandoned-checkout'
import { postPurchase } from './post-purchase'
import { reviewReminder } from './review-reminder'
import { reviewRequest } from './review-request'
import { winback90 } from './winback-90'
import { winback180 } from './winback-180'
import { restock } from './restock'
import { priceDrop } from './price-drop'
import { viewedProduct } from './viewed-product'
import { viewedCategory } from './viewed-category'
import { highValueCart } from './high-value-cart'
import { cartPriceDrop } from './cart-price-drop'
import { wishlistReminder } from './wishlist-reminder'
import { reviewPhotoFollowup } from './review-photo-followup'
import { backInStockWishlist } from './back-in-stock-wishlist'
import { firstPurchaseNudge } from './first-purchase-nudge'
import { secondPurchaseNudge } from './second-purchase-nudge'
import { signupAnniversary } from './signup-anniversary'
import { replenishment } from './replenishment'
import { subscriptionRenewal } from './subscription-renewal'
import { loyaltyTierUpgrade } from './loyalty-tier-upgrade'
import { loyaltyPointsReminder } from './loyalty-points-reminder'
import { referralInvite } from './referral-invite'
import { birthday } from './birthday'

export const SCENARIOS: Record<string, AnyScenarioModule> = {
  [abandonedCart.kind]: abandonedCart as unknown as AnyScenarioModule,
  [abandonedCheckout.kind]: abandonedCheckout as unknown as AnyScenarioModule,
  [postPurchase.kind]: postPurchase as unknown as AnyScenarioModule,
  [reviewReminder.kind]: reviewReminder as unknown as AnyScenarioModule,
  [reviewRequest.kind]: reviewRequest as unknown as AnyScenarioModule,
  [winback90.kind]: winback90 as unknown as AnyScenarioModule,
  [winback180.kind]: winback180 as unknown as AnyScenarioModule,
  [restock.kind]: restock as unknown as AnyScenarioModule,
  [priceDrop.kind]: priceDrop as unknown as AnyScenarioModule,
  [viewedProduct.kind]: viewedProduct as unknown as AnyScenarioModule,
  [viewedCategory.kind]: viewedCategory as unknown as AnyScenarioModule,
  [highValueCart.kind]: highValueCart as unknown as AnyScenarioModule,
  [cartPriceDrop.kind]: cartPriceDrop as unknown as AnyScenarioModule,
  [wishlistReminder.kind]: wishlistReminder as unknown as AnyScenarioModule,
  [reviewPhotoFollowup.kind]: reviewPhotoFollowup as unknown as AnyScenarioModule,
  [backInStockWishlist.kind]: backInStockWishlist as unknown as AnyScenarioModule,
  [firstPurchaseNudge.kind]: firstPurchaseNudge as unknown as AnyScenarioModule,
  [secondPurchaseNudge.kind]: secondPurchaseNudge as unknown as AnyScenarioModule,
  [signupAnniversary.kind]: signupAnniversary as unknown as AnyScenarioModule,
  [replenishment.kind]: replenishment as unknown as AnyScenarioModule,
  [subscriptionRenewal.kind]: subscriptionRenewal as unknown as AnyScenarioModule,
  [loyaltyTierUpgrade.kind]: loyaltyTierUpgrade as unknown as AnyScenarioModule,
  [loyaltyPointsReminder.kind]: loyaltyPointsReminder as unknown as AnyScenarioModule,
  [referralInvite.kind]: referralInvite as unknown as AnyScenarioModule,
  [birthday.kind]: birthday as unknown as AnyScenarioModule,
}

export function getScenario(kind: string): AnyScenarioModule | null {
  return SCENARIOS[kind] ?? null
}

export function listScenarios(): AnyScenarioModule[] {
  return Object.values(SCENARIOS)
}
