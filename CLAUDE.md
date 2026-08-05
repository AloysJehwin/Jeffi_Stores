## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Database schema

- DDL lives in split, `pg_dump`-style schema files under `database/` — tables in a topic file (`catalog.sql`, `logs.sql`, `amazon.sql`, …), primary keys / CHECK constraints / sequence-owner ALTERs in `constraints.sql`, and indexes in `indexes.sql`. A schema pipeline applies these; **do NOT write migration files** in `database/migrations/` for new tables.
- To add a table: put `CREATE TABLE public.<name> (...)` (+ any `CREATE SEQUENCE`) in the topic schema file, its PK/CHECK in `constraints.sql`, and its indexes in `indexes.sql` — mirroring an existing table's split (e.g. the `merchant_*` / `amazon_*` tables). The pipeline handles applying them; never hand-run migrations.
- Apply only to the LOCAL DB (port 5432); never the live RDS.
