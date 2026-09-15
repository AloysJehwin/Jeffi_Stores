# Changelog

## [1.1.0](https://github.com/AloysJehwin/Jeffi_Stores/compare/v1.0.0...v1.1.0) (2026-09-15)


### Features

* **admin-mobile:** shared ResponsiveList + MobileCard, retrofit products list ([f7086a6](https://github.com/AloysJehwin/Jeffi_Stores/commit/f7086a6a139f887806c945898b1afdf5da9f345e))
* **delhivery:** tenant wallet self-service — top-up, billing reconciliation, pickup UI ([4a7f3a2](https://github.com/AloysJehwin/Jeffi_Stores/commit/4a7f3a222e66d43f6cf7f0471272c39f5ce72527))
* **import,tenant:** bulk product import + fix social-post tenant wiring, dead merchant OAuth, delhivery billed_at gate ([11b4b66](https://github.com/AloysJehwin/Jeffi_Stores/commit/11b4b66d06cea9aa277e414c1a6846c2dbdac988))
* **migrations:** fan out pending migration files to every tenant RDS ([96683e5](https://github.com/AloysJehwin/Jeffi_Stores/commit/96683e5dd6dfa75fa917e7ba4d8546489876036e))
* **tenant:** per-tenant Delhivery mode, COD gating, shipment-charge reconciliation ([d1d0121](https://github.com/AloysJehwin/Jeffi_Stores/commit/d1d01213bc955da9df619f8a7bf8975965c80534))
* **tenant:** per-tenant Delhivery mode, COD gating, shipment-charge reconciliation ([2902482](https://github.com/AloysJehwin/Jeffi_Stores/commit/29024821b4f0dcc3d45157d28cdd2e9508aed672))


### Bug Fixes

* **admin-auth:** block non-admins on email step, resend OTP, recovery toggle, email contrast ([e79c83c](https://github.com/AloysJehwin/Jeffi_Stores/commit/e79c83cc8edba10fe7da35f5ddfa741f7388bc63))
* **admin-mobile:** variant table scroll, shortcut/badge/date wrapping, mobile product fetch creds ([e99be54](https://github.com/AloysJehwin/Jeffi_Stores/commit/e99be54c38541baeefd5264edc723de163101f72))
* **admin-nav:** distinct icons for Data Source and Social Posts ([ee3e1a7](https://github.com/AloysJehwin/Jeffi_Stores/commit/ee3e1a7c568feb5e4bb8b3bd8c8d88e7ee08f6c0))
* **admin:** mobile layout fixes + shared ResponsiveList; tenant schema fan-out DDL as master ([d403acd](https://github.com/AloysJehwin/Jeffi_Stores/commit/d403acdb7f3c4c4107c1546c50a4d0d035d0a8df))
* **controls:** gate /api/admin/controls on controls:* not inflation:* ([f198d9d](https://github.com/AloysJehwin/Jeffi_Stores/commit/f198d9d1aeb845355e6fc518bf2bea4ce7fc307a))
* **delhivery:** never bill the 500 g floor to a wallet; ship-from is the tenant's pickup pin ([ffe0b5d](https://github.com/AloysJehwin/Jeffi_Stores/commit/ffe0b5d843ad5d9b9ef69f2c867fbea27d8a3722))
* **ecom:** remove real customer PII from marketing screenshots ([2213c4b](https://github.com/AloysJehwin/Jeffi_Stores/commit/2213c4b03fcf5c1f27a96587b2c74f08f7c67e83))
* **ecom:** seamless darker landing background ([3985d90](https://github.com/AloysJehwin/Jeffi_Stores/commit/3985d90bf250ae73545587aa6bd56d97f94b7ff8))
* **forms:** build tenant-scoped forms host everywhere, not the platform host ([0ef0fee](https://github.com/AloysJehwin/Jeffi_Stores/commit/0ef0feee75fec6bd11434b0ae2a10cc6556a9971))
* **forms:** mark FormsTopNav as client component (useStoreConfig hook) ([5d3bd9e](https://github.com/AloysJehwin/Jeffi_Stores/commit/5d3bd9e343b3a1740fe5ecde4e8744e33e2554c6))
* **forms:** mark FormsTopNav as client component (useStoreConfig hook) ([cfc6dc4](https://github.com/AloysJehwin/Jeffi_Stores/commit/cfc6dc4b8d0317f207de89d3701a2bfa2262dbbb))
* **middleware:** serve public/ static assets on every host (fixes ecom screenshots 404) ([4b717ed](https://github.com/AloysJehwin/Jeffi_Stores/commit/4b717ed7063b821887c182f5250ca5226b20c419))
* **provisioning:** retry transient removeDns failures on deprovision ([dffd685](https://github.com/AloysJehwin/Jeffi_Stores/commit/dffd685872674cba00857fb1b59f0b90315679b9))
* **route:** resolve linked account via owner-bank fallback on transfer ([120254d](https://github.com/AloysJehwin/Jeffi_Stores/commit/120254d331559fc42d87a2034cb1bb050e5fc330))
* **route:** resolve linked account via owner-bank fallback on transfer ([974f695](https://github.com/AloysJehwin/Jeffi_Stores/commit/974f69575631e4feb2446d46f2048a9821f2d6a8))
* **scopes,oauth,email:** plan-reachable wallet/batch scopes; tenant-aware OAuth return; drop OTP emoji ([98d1584](https://github.com/AloysJehwin/Jeffi_Stores/commit/98d158466ad2cdff71ba9d2f4f82aab71a7186eb))
* **scopes,tests:** real routes for notifications/data-source scopes; align stale tests ([a20f6d8](https://github.com/AloysJehwin/Jeffi_Stores/commit/a20f6d847cb49154b6fc6fea9fae24c8ab5d76cc))
* **storefront:** stop flagship tagline/about/description leaking onto tenant stores ([a7560bd](https://github.com/AloysJehwin/Jeffi_Stores/commit/a7560bdb1a727146724bae35ab7ab7aa98490b2c))
* **storefront:** stop flagship tagline/niche leaking onto tenant store headers ([465c9a0](https://github.com/AloysJehwin/Jeffi_Stores/commit/465c9a094c87c8ec423c44db0e1e7f24a24b89d7))
* **tenant-context:** robust header-aware tenant resolution + basic-plan inventory gating ([ac7095d](https://github.com/AloysJehwin/Jeffi_Stores/commit/ac7095df7775981ad2310b6d616e8e1907516c98))
* **tenant-context:** robust header-aware tenant resolution + basic-plan inventory gating ([a8ecb5c](https://github.com/AloysJehwin/Jeffi_Stores/commit/a8ecb5c784c06b3be180e7242f1afe935277822e))
* **tenant-migrations:** run schema fan-out DDL as RDS master user ([03d1c3f](https://github.com/AloysJehwin/Jeffi_Stores/commit/03d1c3fcfae051b832679207bbe6a2c59d06750a))
* tenant-scoped forms host + retry transient DNS teardown failures ([d4fc4d9](https://github.com/AloysJehwin/Jeffi_Stores/commit/d4fc4d973f92e4c30f8986cca8c7f31603c3464d))
* **tenant:** header-aware resolution at handler frame + humanize product-filter labels ([8745653](https://github.com/AloysJehwin/Jeffi_Stores/commit/8745653b8ce8a5fd9de90c0e3e202d6d778f5312))
* **tenant:** header-aware tenant resolution at handler frame + humanize filter facet labels ([9c60cc7](https://github.com/AloysJehwin/Jeffi_Stores/commit/9c60cc7c1c62a0c17c7b0d3cdd61936d767e98b9))
* **tenant:** payment/refund reversal correctness, qty_step serials, release automation, and test suite repair ([1e27167](https://github.com/AloysJehwin/Jeffi_Stores/commit/1e2716749e06b3c7036d93eb3345e519f7a2fbd8))
* **tenant:** wallet GET uses x-tenant-id header; inventory gate respects scope ([5b1d030](https://github.com/AloysJehwin/Jeffi_Stores/commit/5b1d0301d4d6adc165376df5ebb06a51ef15eb36))
* **tests:** repair 5 suites left stale by qty_step, tracked-guard, blurhash and why_us changes ([02929c6](https://github.com/AloysJehwin/Jeffi_Stores/commit/02929c62cb8d18218fe56c4404001d30fa01625d))


### Refactoring

* **ecom-dashboard:** readable contrast, restructured layout, drop New store ([c2a18fb](https://github.com/AloysJehwin/Jeffi_Stores/commit/c2a18fbc0cb2e089907d685708fac28c259d4fd0))
