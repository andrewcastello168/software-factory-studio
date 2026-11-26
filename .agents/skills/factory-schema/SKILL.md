---
name: factory-schema
description: Implement and verify PostgreSQL schema modeling, DDL import, catalog comparison, migration publication, and database-driven generation in Studio.
---

# Studio database engine

1. Read the [database engine](../../../docs/DATABASE_ENGINE.md), [security boundaries](../../../docs/SECURITY.md), and current [roadmap](../../../docs/ROADMAP.md).
2. Keep declared migrations, ledger, and physical observations separate. Update the closed grammar with a fixture for every supported construct. Report unsupported definitions and block lossy round trips.
3. Publish an additive migration only after reviewing source hashes, workspace and Git identity, and native consent. Use the existing exclusive publication primitive and durable recovery. Keep database apply separate.
4. Use fixed catalog queries with bound parameters. Keep connection credentials ephemeral and diagnostic values bounded. Test database changes only on disposable PostgreSQL targets.
5. Generate CRUD layers only for selected compatible tables. Run the generated app with the ordinary toolchain and verify relationships, invalid input, CRUD, and rollback. Record Linux and Windows evidence in [Progress](../../../docs/PROGRESS.md).
