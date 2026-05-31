# RAG Infrastructure Setup

Operator's guide for the Retrieval-Augmented Generation (RAG) stack powering admin AI features (campaign scenario generation, email copy generation, and semantic search over store data).

This document is intended to be a complete rebuild guide and a debugging reference.

---

## Architecture

```
                  ┌─────────────────────────────┐
                  │   Mac (dev workstation)     │
                  │   100.121.227.128 (tailnet) │
                  └──────────────┬──────────────┘
                                 │  Tailscale (WireGuard)
                                 │
                  ┌──────────────┴──────────────┐
                  │   EC2 (prod app server)     │
                  │   tailnet member            │
                  └──────────────┬──────────────┘
                                 │  Tailscale
                                 │
                  ┌──────────────▼──────────────────────────┐
                  │  Razer Blade 18  (RTX 4080, WSL Ubuntu) │
                  │  100.110.153.68  (tailnet)              │
                  │                                          │
                  │  ┌────────────────────────────────────┐ │
                  │  │ Ollama (chat + embeddings)         │ │
                  │  │   :11434                           │ │
                  │  ├────────────────────────────────────┤ │
                  │  │ Postgres 15 + pgvector             │ │
                  │  │   :5432  (db: jeffi_dev)           │ │
                  │  ├────────────────────────────────────┤ │
                  │  │ SSH                                │ │
                  │  │   :22                              │ │
                  │  └────────────────────────────────────┘ │
                  └──────────────────────────────────────────┘
```

The Razer is the **dev-DB box**: it holds a mirror of the live RDS schema/data plus the RAG-specific `embeddings` table, and it serves both inference (Ollama) and the vector store (Postgres) over the tailnet.

- **Mac → Razer** over Tailscale for development.
- **EC2 → Razer** over Tailscale (`100.121.227.128 → 100.110.153.68`) for production app access to the RAG stack.

---

## What's Installed Where (Razer)

| Software   | Version                       | Port  | Notes                                  |
|------------|-------------------------------|-------|----------------------------------------|
| Ollama     | 0.24.0                        | 11434 | Chat + embedding inference             |
| Postgres   | 15.18                         | 5432  | Primary DB engine                      |
| pgvector   | 0.8.2                         | —     | Postgres extension for vector ops      |
| OpenSSH    | TBD                           | 22    | Remote access                          |
| Tailscale  | TBD                           | —     | Mesh VPN, hostname `100.110.153.68`    |
| WSL        | Ubuntu (TBD release)          | —     | systemd enabled (`/etc/wsl.conf`)      |

### Models pulled into Ollama

| Model                              | Purpose                                      | Size / Dim       |
|------------------------------------|----------------------------------------------|------------------|
| `qwen2.5-coder:14b`                | SQL generation (campaign scenarios)          | TBD (~9 GB)      |
| `llama3.1:8b-instruct-q4_K_M`      | Email copy generation                        | TBD (~4.9 GB)    |
| `nomic-embed-text`                 | Embeddings                                   | 137 M, 768-dim   |

---

## Database

- **Host:** `100.110.153.68` (Razer over tailnet)
- **Port:** `5432`
- **Database:** `jeffi_dev`
- **User:** `postgres`
- **Connection string:**

```
postgresql://postgres:$RDS_MASTER_PASSWORD@100.110.153.68:5432/jeffi_dev
```

The schema is a clone of the live RDS (`jeffi_stores`) created via `pg_dump`, plus one extra table for RAG: `embeddings`.

### `embeddings` table

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table  varchar(64),
  source_id     text,
  content       text,
  content_hash  text,
  embedding     vector(768),
  metadata      jsonb,
  updated_at    timestamptz,
  UNIQUE(source_table, source_id)
);
```

### Indexes

| Index                                       | Type     | Purpose                                  |
|---------------------------------------------|----------|------------------------------------------|
| `embeddings_pkey`                           | btree    | Primary key on `id`                      |
| `embeddings_source_table_source_id_key`     | btree    | UNIQUE(source_table, source_id)          |
| `idx_embeddings_content_hash`               | btree    | Idempotency lookups                      |
| `idx_embeddings_source_table`               | btree    | Filter scans by source                   |
| `idx_embeddings_embedding_ivfflat`          | ivfflat  | Cosine similarity ANN (`lists=100`)      |

The `ivfflat` index is created with cosine ops:

```sql
CREATE INDEX idx_embeddings_embedding_ivfflat
  ON embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

> Run `ANALYZE embeddings;` after large backfills so the planner uses the index.

---

## Models

Three models are used end-to-end:

1. **`qwen2.5-coder:14b`** — SQL generation.
   - Called by: `/api/admin/campaigns/scenarios/generate`
   - Endpoint: `POST http://100.110.153.68:11434/api/chat`

2. **`llama3.1:8b-instruct-q4_K_M`** — email copy.
   - Called by: `/api/admin/campaigns/generate`
   - Endpoint: `POST http://100.110.153.68:11434/api/chat`

3. **`nomic-embed-text`** — embeddings, 768-dim.
   - Called by: backfill script + retrieval endpoints
   - Endpoint: `POST http://100.110.153.68:11434/api/embeddings`
   - Example body:
     ```json
     { "model": "nomic-embed-text", "prompt": "your text here" }
     ```

To verify a model is loaded:

```bash
curl http://100.110.153.68:11434/api/tags
```

---

## Backfill Script

Path: `scripts/embed-everything.mjs`

### Run it locally (Mac)

```bash
cd /Users/I578432/Documents/GitHub-Personal/Jeffi_Storess_Site
RDS_MASTER_PASSWORD='...' node scripts/embed-everything.mjs
```

Either env var works:

- `RDS_MASTER_PASSWORD` — the same value used for prod RDS (intentional, kept in sync).
- `RAZER_PG_PASSWORD` — alias accepted by the script.

### Idempotency

Each row's text is hashed (SHA-256 of the content) and stored in `content_hash`. On re-run, the script:

1. Computes the hash for the current row.
2. Looks up `(source_table, source_id)` in `embeddings`.
3. Skips the row if `content_hash` matches.
4. Otherwise re-embeds and `UPSERT`s.

This means you can safely re-run the script after a `pg_dump` refresh — only changed rows hit Ollama.

### Tunables (defined inside the script)

| Setting       | Default | Notes                                          |
|---------------|---------|------------------------------------------------|
| Concurrency   | TBD     | Parallel embed calls to Ollama                 |
| Batch size    | TBD     | Rows fetched from Postgres per batch           |

> TBD values: open `scripts/embed-everything.mjs` and confirm the constants — they were tuned to keep the RTX 4080 saturated without OOM.

### Tables embedded

- `products`
- `product_variants`
- `users`
- `orders`
- `campaigns`
- `coupons`

Each row is rendered to a single text blob (a "card") before embedding; the exact template lives in the script.

---

## Querying (pgvector cosine similarity)

Smoke test:

```sql
-- $QUERY_VEC is the 768-dim embedding of your query string,
-- produced by calling /api/embeddings on Ollama.
SELECT source_table,
       source_id,
       content,
       1 - (embedding <=> $QUERY_VEC::vector) AS similarity
FROM   embeddings
ORDER  BY embedding <=> $QUERY_VEC::vector
LIMIT  10;
```

- `<=>` is pgvector's cosine **distance** operator (0 = identical, 2 = opposite).
- `1 - distance` gives a similarity score in `[-1, 1]`; for normalized embeddings it's effectively `[0, 1]`.

To restrict to one source table:

```sql
WHERE source_table = 'products'
```

---

## Nightly Sync (placeholder)

Another agent is setting up a nightly job on the Razer to keep `jeffi_dev` in sync with prod RDS. When it lands, expect these files to exist on the Razer:

- `/usr/local/bin/jeffi-rag-sync.sh` — pulls latest from RDS, applies to `jeffi_dev`, then runs the embed script over changed rows.
- `/etc/systemd/system/jeffi-rag-sync.service` — the unit that runs the script.
- `/etc/systemd/system/jeffi-rag-sync.timer` — daily trigger.

**Schedule:** 03:00 IST daily.

Useful commands once it's installed:

```bash
ssh aloys@100.110.153.68 'systemctl status jeffi-rag-sync.timer'
ssh aloys@100.110.153.68 'systemctl list-timers | grep jeffi-rag-sync'
ssh aloys@100.110.153.68 'journalctl -u jeffi-rag-sync.service -n 200 --no-pager'
```

---

## Boot Chain (24/7 setup)

Goal: Razer comes back fully online after any reboot, with zero manual steps.

1. **Windows auto-login** — the Windows user signs in automatically on boot.
2. **Task Scheduler → `WSL-AutoStart`** — fires at logon, runs `wsl.exe` to bring up the Ubuntu distro.
3. **`/etc/wsl.conf`** — has `systemd=true`, so WSL boots under systemd.
4. **`start-services.sh`** — invoked at WSL start; brings up:
   - `ollama` (systemd unit)
   - `ssh`
   - `tailscale`
5. **Postgres 15** — has its own systemd unit (`postgresql.service` / `postgresql@15-main.service`) and starts independently.

All of these are persistent across reboots. To verify after a reboot:

```bash
ssh aloys@100.110.153.68 'systemctl is-active ollama postgresql tailscaled ssh'
```

---

## Troubleshooting

### Razer offline / unreachable

1. Check the Tailscale admin page: <https://login.tailscale.com/admin/machines>.
2. From the Mac:
   ```bash
   tailscale ping 100.110.153.68
   ```
3. If the node is down, the Windows machine likely rebooted and the auto-login or `WSL-AutoStart` task failed — RDP in and re-run the task manually.

### Embeddings call hanging or returning errors

Check Ollama logs:

```bash
ssh aloys@100.110.153.68 'journalctl -u ollama -n 50 --no-pager'
```

Confirm the model is loaded:

```bash
curl http://100.110.153.68:11434/api/tags
```

Restart Ollama if needed:

```bash
ssh aloys@100.110.153.68 'sudo systemctl restart ollama'
```

### Disk filling up

The two big offenders:

```bash
ssh aloys@100.110.153.68 'sudo du -sh /var/lib/postgresql/15/main/'
ssh aloys@100.110.153.68 'sudo du -sh /usr/share/ollama/.ollama/models/'
```

- Postgres growth → check for runaway WAL or large embeddings re-runs; `VACUUM (FULL)` on `embeddings` if it's bloated.
- Ollama growth → unused model blobs; `ollama rm <model>` to delete.

### Slow vector queries

```sql
ANALYZE embeddings;
SET ivfflat.probes = 10;  -- raise for recall, lower for speed
```

If the table grows past ~1M rows, consider increasing `lists` on the ivfflat index (rebuild required).

---

## Security Notes

- **Postgres bind:** `localhost` + tailnet interface only — never public.
- **`pg_hba.conf`:** allows the tailnet `100.64.0.0/10` with `scram-sha-256` auth.
- **DB password:** intentionally **the same as prod RDS** (`$RDS_MASTER_PASSWORD`) to avoid drift between environments. Treat it as a prod secret.
- **Tailscale:** node key expiry **disabled** for the Razer so it doesn't drop off the tailnet during long uptime.
- **Ollama:** bound to all interfaces inside WSL, but only reachable via the tailnet IP — there's no public route. Do not expose `:11434` to the public internet.
- **SSH:** key-based auth only; password auth disabled (TBD — confirm `PasswordAuthentication no` in `/etc/ssh/sshd_config`).

---

## Quick Reference

```bash
# Connect to the dev DB from the Mac
psql "postgresql://postgres:$RDS_MASTER_PASSWORD@100.110.153.68:5432/jeffi_dev"

# Run a one-off embedding
curl -s http://100.110.153.68:11434/api/embeddings \
  -d '{"model":"nomic-embed-text","prompt":"hello world"}' | jq '.embedding | length'
# -> 768

# Re-run the backfill (idempotent)
RDS_MASTER_PASSWORD='...' node scripts/embed-everything.mjs

# SSH into the Razer
ssh aloys@100.110.153.68
```
