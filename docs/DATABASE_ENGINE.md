# Database engine

## Authoritative views

Ordered PostgreSQL migrations in the selected worktree define the declared source schema. The Node starter uses `db/migrations/NNNN_name.sql` and a `schema_migrations` ledger with SHA-256 of the exact UTF-8 source bytes.

| View | Derivation | Meaning |
| --- | --- | --- |
| Declared source | Ordered, locally parsed SQL, including supported external changes | What this worktree declares |
| Applied and pending | Ordered source names and checksums compared with the selected database ledger | What the database recorded and what remains pending. A divergent ledger or incomplete source gives unknown status. |
| Physical | Opt-in, read-only catalog snapshot for a single namespace, with observation time | What the inspected target actually contains |

Diagram coordinates are stored separately in versioned, per-user Studio data keyed to the admitted worktree. Layout can move independently of the SQL and contains no connection settings. Schema publication is portable through the migrations. Sharing layouts is deferred.

## Supported design and import

The version 1 model supports up to 32 tables, 32 columns and 32 constraints or indexes per table. Database Studio offers a table inspector, independent ERD with zoom, pan and keyboard repositioning, SQL import into a draft, migration history, and a separate physical view. The New Project Wizard also supports DDL import and table editing.

| Area | Supported in Phase 05 |
| --- | --- |
| Types | `smallint`, `integer`, `bigint`, unconstrained `numeric`, `text`, `boolean`, `date`, `timestamp`, `timestamptz`, `uuid`, and `jsonb` |
| Defaults | Bounded compatible literals, empty JSON stores, `CURRENT_DATE`, and `CURRENT_TIMESTAMP`. Timestamp values are normalized consistently for comparison. |
| Keys | Primary and unique keys, including ordered composite keys. Same-namespace foreign keys to primary or unique columns of matching types. Supported delete actions are no action, restrict, cascade, and set null. |
| Checks and indexes | A direct column or text-length comparison with a compatible literal, and plain ascending B-tree indexes. |
| DDL | `CREATE TABLE`, plain `CREATE INDEX`, and `ALTER TABLE … ADD COLUMN/CONSTRAINT`. Exact bundled Phase 04 baseline and Welcome migrations have explicit recognition. |

Use lowercase ASCII identifiers and explicit constraint names for portable comparisons. The parser locally interprets a bounded SQL subset and never executes imported text. SQL requiring runtime expressions, arbitrary functions, arrays, identity/serial, enum/domain definitions, precision modifiers, cross-schema references, quoted mixed-case names, column renames, destruction, or non-default storage/index options is unsupported. The source view reports the first unsupported statement and preserves the SQL for inspection. Detected catalog features outside the model produce diagnostics rather than a lossy source update.

## Migration publication and recovery

Drafts change proposed definitions only. Preview derives a deterministic additive migration. It orders tables and columns before keys, foreign keys, then indexes so mutual references can be planned. Existing columns and constraints cannot be removed or rewritten. An added required column on an existing table needs a default.

Native approval identifies the canonical destination and SHA-256. Main rechecks the worktree grant, Git refs, migration directory identity, source filename order, and fingerprints before committing a new file. Publication reuses the generator's exclusive staging and hard-link primitive. A local journal retains interrupted intent. Resume requires fresh native approval and the original base; handoff drops the local record and leaves every workspace file available for inspection. A pending publication blocks Studio Git operations that could change the worktree. Project reopen, refresh, and Git checkout read source only.

## PostgreSQL inspection and development apply

Introspection uses explicitly entered credentials, one native confirmation, bound catalog queries, and a read-only transaction. PostgreSQL versions 15–17 are admitted. Version 17 is the tested reference. Remote inspection requires verified TLS and uses the system trust settings available to Node. Studio clears the password after each request, does not retain credentials in its settings or metadata, and returns bounded errors. Catalog inspection does not propose or apply changes to the declared source.

Development apply is restricted to loopback IPs and a database named `factory_dev_*` or the `factory_check` fixture database. Review the target, SQL, and checksums, then approve in a separate native confirmation. Even on loopback use a disposable or development-only instance and an appropriately scoped account. Studio checks the previously observed ledger, files, Git refs and physical schema again under the same advisory lock used by the starter. It applies recognized bundled migrations or canonical additive Studio migrations and verifies the final catalog and ledger before commit. Failure rolls back SQL and ledger entries. Differently formatted manual DDL can be inspected, compared, and applied using the standalone terminal workflow after review. Destructive, nontransactional and production changes remain in a separate reviewed release workflow. Git history is independent of database backup, restoration, and migration recovery.

## Verification

Use the [inventory DDL fixture](../tests/fixtures/inventory.sql) and disposable PostgreSQL schemas. Verify foreign keys, checks, exact checksums, stale source, drift, failed apply, and independent CRUD. Use [Testing strategy](TESTING_STRATEGY.md) for Linux, Windows, and native renderer evidence.


## Phase 06 migration handoff

Generation Review uses supported checked-out migration files directly. It flags external files, preserves their sequence and checksums, and detects eligible tables that lack an API or page. Approval writes only the reviewed application files and metadata. The source, applied ledger, pending status and physical database retain their existing authorities. Unsupported DDL or edits to earlier schema sources block incremental generation until reviewed.


## Phase 07 module migrations

Bundled identity migrations are versioned DDL. The generator preserves previously applied files and appends reviewed module SQL to the current sequence when installing into a compatible project. The reserved factory_identity_ namespace cannot be used for generated business CRUD. Development apply still requires separate consent. Identity session, role, account, throttling and audit tables are internal infrastructure.

## Go adapter

Go and Node managed projects use the same Database Studio source interpretation, physical inspection, verified development apply, and canonical source order. The generated Go migration command uses pgx and the same SHA-256 checksum ledger and advisory transaction lock. Review authored SQL before explicit CLI apply. Keep transaction control and nontransactional commands outside migrations. Backend startup only checks readiness and has no migration entry point. The app CLI expects a reviewed target in `DATABASE_URL`; Studio continues to require its narrower dedicated development target and native approval.

Go CRUD uses int16, int32, bool and validated strings for text, UUID and ISO date, plus explicit null handling. Database constraints remain authoritative. Related tables, unique/check constraints, and foreign-key actions use the existing schema engine. Composite keys and broader supported schema types can be generated as SQL without CRUD. Unsupported SQL blocks source-driven generation with diagnostics.
