# Database engine

## Authority for PostgreSQL stacks

The committed, ordered PostgreSQL migration files plus supported working-tree migration changes are the declared source schema for both planned PostgreSQL stacks. The PostgreSQL dialect and migration convention are pinned by stack version. The Node stack uses `db/migrations/` as its planned convention. The Go adapter declares and verifies its own relative migration location in Phase 08. Studio reconstructs the supported schema from the ordered SQL. Portable `.factory/schema.json` stores diagram layout, stable metadata and supported modeling settings. It does not authorize DDL execution or override migration SQL.

| View | Derivation | User-facing meaning |
| --- | --- | --- |
| Declared source schema | Parse supported migration files in selected worktree order and record path, ID, and digest. | What this worktree declares. |
| Pending migrations | Compare source migration IDs and digests to a trusted ledger in the explicitly selected database. | What this target has yet to apply. Until a ledger was read successfully, pending status is unknown. |
| Actual database state | Opt-in read-only catalog introspection against the selected connection. | What currently exists physically. Comparison can reveal drift or an unknown migration history. |

Track migration path, identity, ordering, checksum, and ledger state separately. Edited applied migrations, duplicate migration IDs, unknown history, and partially parsed SQL block automated apply for affected scopes. Display supported, incomplete, and unsupported coverage with source locations. PostgreSQL identifiers and types follow dialect rules. Unsupported statements remain inspectable and cannot be round-tripped through a lossy model.

## Modeling and synchronization

Represent tables, columns and types, defaults, nullability, primary and foreign keys, constraints, and indexes. Use stable identifiers for diagram presentation and explicit rename intent. Visual editing proposes a new migration and a schema preview. SQL import parses and previews input without opening a live write connection. In Phase 05, persist a reviewed source change by adding a new migration through the Phase 04 journaled create path. Extend that path only as needed to create the new file safely in an existing project and preserve historical migrations. Editing existing application source and generating CRUD are Phase 06 work. ERD layout can be versioned independently of database credentials.

On rescan, rebuild the affected declared schema from current ordered migration files, invalidate stale generation plans, and report incompatible or incomplete input. For example, when a developer adds a supported table migration in VS Code, identify the new table and offer a separate plan for missing application components once Phase 06 is available. Preserve the original migration as the schema source and avoid emitting a duplicate. Apply the same rule when a Studio-authored migration has already been saved. Compare provenance so generated components can be matched to the correct schema revision. Switching branches refreshes the source view and invalidates cached pending results until the ledger is read again. A previous physical snapshot retains its connection and observation time and is marked stale for the new comparison. A branch switch never opens a write connection or applies migrations.

Introspection is opt-in and read-only. A schema comparison can produce a reviewed proposal. Importing introspection results into source requires an explicit generation plan. A difference may reflect out-of-band DDL, a different database, a modified migration, or incomplete parsing. Show these conditions before proposing changes.

## Applying migrations

Studio Phase 05 may apply explicitly reviewed, supported migrations to an approved disposable or local development database. The Node application has a standard standalone migration command from Phase 04. Show the target, migration order and file checksums, SQL, lock or data-loss risks, transaction behavior, and recovery prerequisites. Revalidate the selected target, permissions, ledger, and source checksums immediately before apply. Use least-privilege, independently stored credentials and parameterized catalog queries. Require an explicit destructive review for drops, risky rewrites, and destructive rollback. Production changes are managed through an explicitly authorized external release workflow with access policies, backups, and migration review. Studio never triggers them automatically.

Coordinate concurrent migration execution with a database lock and ledger. Recheck ledger state under the lock. Prefer a transactional migration where PostgreSQL supports it and record the ledger entry in the same transaction. Block unsupported non-transactional operations until a dedicated recovery design exists. A partially applied migration requires inspection and explicit resolution. Database backups, restores, and forward fixes are separate from Git checkpoints. Never describe a Git reset as database rollback.

## Verification

Use disposable PostgreSQL databases and independent test credentials. Test composite keys, foreign keys, indexes, explicit renames, unsupported statements, manually authored migrations, dirty branch transitions, stale previews, drift, changed migration checksums, introspection permissions, and failed apply. Confirm schema edits, imports, scans, branch switches, and Git recovery leave the physical database unchanged unless the user separately approves a supported migration operation. See [Testing strategy](TESTING_STRATEGY.md).
