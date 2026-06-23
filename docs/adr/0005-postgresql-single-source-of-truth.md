# ADR-0005: PostgreSQL as single source of truth (no separate read replicas)

- **Status**: Accepted
- **Date**: 2026-06-18
- **Authors**: engineering

## Context

At launch, Jeffi Stores operates on a single RDS PostgreSQL instance (db.t3.medium) in ap-south-1. The options evaluated were:

1. **Single RDS instance** — all reads and writes hit the same DB.
2. **RDS + read replica** — writes to primary, reads (product listings, search) to replica.
3. **RDS + Redis** — write-through cache for hot product/inventory data; reads from Redis.
4. **RDS + ElastiCache** — managed Redis layer for session data, rate-limit counters, and hot reads.

The traffic profile at current scale is modest: a few hundred daily active users, no concurrent-spike events, and product catalog changes that are infrequent relative to read volume. Introducing a read replica or a Redis tier at this stage would add operational overhead (failover config, cache invalidation bugs, replication lag edge cases) without a meaningful latency or throughput benefit.

Next.js ISR (Incremental Static Regeneration) already absorbs the majority of read pressure on product listing and detail pages. Most page-level reads never reach the DB at all — they are served from the CDN or from the ISR cache on the Next.js server.

## Decision

Use a single RDS PostgreSQL instance for all reads and writes. No Redis, no ElastiCache, no read replica.

Connection management uses the `pg` pool (`src/lib/db.ts`) with a bounded pool size tuned to the RDS instance class. The pool is shared across all Next.js server processes via the module singleton pattern.

ISR revalidation periods (`revalidate`) are set on static pages to limit how often product/category queries run. Dynamic pages (cart, checkout, order status) query the DB directly and are not ISR-cached.

Redis is not used for sessions — session state lives in the JWT itself (stateless). Rate-limit counters, if added, will use the DB short-term before a Redis tier is justified by traffic.

## Consequences

**Positive**

- Zero cache-invalidation bugs. The DB is always the truth; stale reads are impossible by construction.
- Dramatically simpler operations: one database to back up, monitor, restore, and reason about.
- ISR handles read pressure on the most-queried pages (home, category, product detail) without any caching infrastructure.
- Replication lag is not a concern — business users checking order status or inventory always see the latest committed row.
- Cost: a single db.t3.medium is materially cheaper than primary + replica + ElastiCache.

**Negative**

- A single-instance failure takes down both reads and writes until RDS auto-recovery completes (~20 min). Multi-AZ is a separate ADR item (audit #20).
- The connection pool is the only connection-count protection. A traffic spike that exhausts the pool will queue requests rather than shed load to a replica.
- When traffic grows to require a read replica, the migration requires splitting reads in the application layer, which may surface previously hidden read-your-writes assumptions.

**Revisit trigger**: sustained p95 DB query latency above 200 ms on product listing pages, or RDS CPU above 70% at peak. At that point, evaluate ISR revalidate tuning first, read replica second.
