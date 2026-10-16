# Integration keys still to obtain

These apps have to be created and approved before their features can connect. Each section lists:
- where to create the app
- what to register
- which env keys to set
- how long approval usually takes

Approval times are typical, not promised. Start the slow ones first: Amazon Ads, LinkedIn and Google verification.

## Redirect URIs

Every sign-in returns to one fixed platform host. The signed `state` carries the store, so one registration covers every tenant.

| Environment | Base |
|---|---|
| Production | `https://admin.jeffistores.in` |
| Local | `http://localhost:3000` (`ADMIN_BASE_URL`) |

Register both where the provider allows it. The Accounts tab on Social Posts also shows the exact URI for each network.

| Feature | Callback path |
|---|---|
| Amazon Seller (SP-API) | `/api/admin/integrations/amazon/callback` |
| Amazon Ads | `/api/admin/integrations/amazon-ads/callback` |
| Pinterest, LinkedIn, X, Google Business Profile, YouTube | `/api/admin/social/network/callback` |

Production example: `https://admin.jeffistores.in/api/admin/social/network/callback`.

## Where to put the keys

| Environment | Where |
|---|---|
| Local | `controller-service/.env.local`, then restart `npm run dev` |
| Production | The controller-service k8s secret, through the normal release (`deploy/k8s/README.md`). Do not paste keys in chat or commit them. |

---

## 1. Amazon Ads API (Sponsored Products console)

Keys: `AMAZON_ADS_CLIENT_ID` and `AMAZON_ADS_CLIENT_SECRET`.

1. **Create a security profile.** Go to developer.amazon.com, then Login with Amazon, then Create a New Security Profile. Use the Jeffi Stores name, privacy URL and logo.
2. **Set Web Settings on that profile:**
   - Allowed Origins: `https://admin.jeffistores.in`
   - Allowed Return URLs: `https://admin.jeffistores.in/api/admin/integrations/amazon-ads/callback` and the localhost version
3. **Apply for Amazon Ads API access** at advertising.amazon.com/API, under "Apply for access". Name the security profile above, and describe the use as "managing our own Sponsored Products campaigns on amazon.in and those of stores on our platform".
4. **After approval:**
   - Copy the profile's Client ID and Client Secret into the two keys.
   - The scope requested is `advertising::campaign_management`.
   - India uses the EU endpoint, which is the default, so nothing else needs setting.

Approval usually takes 1 to 3 weeks. The advertiser account must be active and have spent before.

## 2. Amazon SP-API app ("Connect with Amazon" for stores)

Keys: `AMAZON_SP_APP_ID`, `AMAZON_LWA_APP_CLIENT_ID` and `AMAZON_LWA_APP_CLIENT_SECRET`.

The flagship already works through `AMAZON_LWA_CLIENT_ID` and the refresh token. These keys are only for other stores connecting their own seller accounts.

1. **Register as a developer.** In Seller Central (sellercentral.amazon.in), go to Apps and Services, then Develop Apps (Developer Central).
2. **Complete the developer profile.**
   - Pick "public developer" so other sellers can authorise the app.
   - Roles: Product Listing, Pricing, Inventory and Order Tracking, and Amazon Fulfilment.
   - For buyer names and addresses on imported orders, also request the restricted Direct-to-Consumer Shipping role. It needs the security questionnaire.
3. **Add a new app client** with the API type SP-API.
4. **Set the OAuth fields:**
   - OAuth Redirect URI: `https://admin.jeffistores.in/api/admin/integrations/amazon/callback`
   - Login URI: `https://admin.jeffistores.in`
5. **Copy the IDs:**
   - The App ID (`amzn1.sp.solution...`) goes into `AMAZON_SP_APP_ID`.
   - The LWA credentials (View under the app) go into `AMAZON_LWA_APP_CLIENT_ID` and `AMAZON_LWA_APP_CLIENT_SECRET`.
6. **Until the app is published,** set `AMAZON_SP_APP_DRAFT=true` so consent uses the draft (beta) flow.

Approval: the developer profile takes a few days. The restricted role takes 2 to 4 weeks.

## 3. Pinterest

Keys: `PINTEREST_APP_ID` and `PINTEREST_APP_SECRET`.

1. Go to developers.pinterest.com, then My apps, then Connect app. Use a Pinterest **business** account.
2. Add the redirect URI `https://admin.jeffistores.in/api/admin/social/network/callback`, plus the localhost one.
3. The scopes requested are `boards:read`, `pins:read`, `pins:write` and `user_accounts:read`.
4. New apps start with **Trial access**: pins are created but only visible to you. Request **Standard access** with a short screen recording of connecting and posting from the Social Posts page.

Approval: Trial is immediate. Standard takes about 1 to 2 weeks.

## 4. LinkedIn (company page posting)

Keys: `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.

1. **Create the app** at linkedin.com/developers, then Create app. Link it to the Jeffi Stores **company page**, and have a page admin verify the association.
2. **Products tab:** request **Community Management API**. It needs the company to be a legal entity and a short use-case form.
3. **Auth tab:** add the redirect URL `https://admin.jeffistores.in/api/admin/social/network/callback`.
4. The scopes requested are `r_organization_social`, `w_organization_social` and `rw_organization_admin`.
5. The person connecting must be an admin of the page they post to.

Approval: the Community Management API takes 1 to 4 weeks and is the slowest of these.

## 5. X (Twitter)

Keys: `X_CLIENT_ID` and `X_CLIENT_SECRET`.

1. **Subscribe and set up the app.** At developer.x.com, subscribe to the **Basic** tier (paid, monthly), which posting needs. Create a project and an app inside it.
2. **User authentication settings:**
   - OAuth 2.0 on
   - Type of app: Web App (confidential client)
   - Permissions: Read and write
   - Callback URI: `https://admin.jeffistores.in/api/admin/social/network/callback`
   - Website: `https://jeffistores.in`
3. Copy the **OAuth 2.0** Client ID and Client Secret, not the API key and secret.
4. The scopes requested are `tweet.read`, `tweet.write`, `users.read`, `media.write` and `offline.access`.

Approval: instant once paid. Basic has a monthly post cap, so watch it if many stores post.

---

## Approvals that need no new keys

### Google Business Profile and YouTube Shorts

These reuse `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

1. In Google Cloud Console, open the project that owns the OAuth client:
   - Enable the **YouTube Data API v3**.
   - For Business Profile, request access through the GBP API access form (Business Profile APIs, "Request access"), then enable the **My Business** APIs it unlocks.
2. Under OAuth consent screen, then Scopes, add:
   - `https://www.googleapis.com/auth/business.manage`
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/youtube.force-ssl`
3. Under Credentials, then the OAuth client, add the redirect URI `https://admin.jeffistores.in/api/admin/social/network/callback`.
4. Submit for **verification**. The YouTube scopes are sensitive and need a demo video of the flow.
5. YouTube's default quota allows about 6 uploads a day. Request more in the console if needed.

Approval: GBP access takes about 1 to 2 weeks. Scope verification takes 2 to 6 weeks.

### Meta Ads (ads permissions)

This reuses `META_APP_ID` and `META_APP_SECRET`.

1. In the Meta app, under App Review, request `ads_read` and `ads_management`.
2. Request `catalog_management` too, only if catalog sync is wanted later.
3. Business Verification of the Meta business must be complete.
4. Provide a screencast of connecting and pausing a campaign on the Meta Ads page.
5. Add `https://admin.jeffistores.in/api/admin/integrations/meta-ads/callback` to Valid OAuth Redirect URIs.

### Google Merchant (testco)

Pick Jeffi's main Merchant Center account, which has a verified homepage, for the testco connection. The current one, 5761019346, has an unverified homepage, so registration fails.

## Checklist

- [ ] Amazon Ads API: security profile created, access requested
- [ ] SP-API public app: profile, roles, app client, redirect URI
- [ ] Pinterest app: Standard access requested
- [ ] LinkedIn app: page verified, Community Management API requested
- [ ] X: Basic tier, OAuth 2.0 client
- [ ] Google Cloud: YouTube API on, GBP access form, scopes added, verification submitted
- [ ] Meta App Review: ads permissions
- [ ] Keys added to local `.env.local` and to the production secret
- [ ] Each network connected once on testco from Social Posts, then Accounts
