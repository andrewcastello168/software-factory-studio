---
name: factory-generator
description: Implement and verify deterministic plans, generator previews, safe file publication, recovery, and standalone starter applications in Studio.
---

# Studio generator

1. Read the [generator specification](../../../docs/GENERATOR_SPECIFICATION.md) and the assigned phase in [Roadmap](../../../docs/ROADMAP.md).
2. Keep template rendering and hashing deterministic. Add supported versioned profiles through the built-in adapter. Preserve previously generated source and pin the dependency graph.
3. Keep filesystem authority in Electron main. Verify destination grants, consent, stale inputs, exclusive publication, and recovery with disposable paths.
4. Run Studio checks and the standalone starter verification. Use a disposable PostgreSQL target for migration and HTTP tests. Record platform evidence in [Progress](../../../docs/PROGRESS.md).
