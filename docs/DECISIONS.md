# Architecture decisions

## 0001 · Electron with separate privilege and compilation boundaries

**Status** Accepted in Phase 00.

Electron supplies a consistent desktop runtime for Windows-first development. React and Vite keep the renderer testable in a browser. Use a sandbox-compatible preload, per-capability IPC and a secure bundled origin. Separate main, preload, renderer and platform-neutral shared contracts. This adds Electron footprint and a browser/runtime patch cadence. It keeps privileged operations reviewable and allows browser UI coverage alongside native evidence.

## 0002 · Start with two workspace packages and minimal app-local persistence

**Status** Accepted in Phase 00.

Begin with the desktop app and shared contracts in strict TypeScript, with native Electron user-data paths and versioned JSON preferences. Defer SQLite and other native modules until a feature or measured need justifies them. JSON limits cross-record querying and high-volume writes. The smaller dependency graph avoids early native ABI and packaging concerns. Keep the persistence interface local and evolve it with actual consumers.

## 0003 · Directory grants and independent portable identities

**Status** Accepted in Phase 00.

The filesystem path identifies the active worktree, and an opaque window grant authorizes access. A portable UUID under `.factory/` identifies a managed project across moves and shared worktrees. Recents store references. Opening existing projects reads without creating metadata. This requires separate canonical-path, project, and Git common-directory identities. It makes worktree isolation, unmanaged inspection, and move handling explicit.

## 0004 · Deterministic plans and journaled, reviewed writes

**Status** Accepted in Phase 00.

Separate pure generation from privileged apply. Bind review to planned bytes, ownership, workspace identity, ref and commit, and relevant fingerprints. Journal recoverable writes and use verified, OS-appropriate primitives. Mark uncertain state recovery-required. This introduces storage and interruption tests. It protects edited source files and gives the future CLI the same planning contract. File safety under concurrent external changes remains an implementation gate.

## 0005 · Migration files define the declared PostgreSQL schema

**Status** Accepted for both planned PostgreSQL slices.

Use ordered, versioned migration SQL as source authority. Pending migrations depend on the target ledger. Physical state comes from opt-in catalog introspection. Keep layout and modeling metadata portable. Limited SQL support means some projects will be read-only or partially represented. This preserves developer-authored migrations and keeps Git operations independent of database execution.

## 0006 · Native Git with narrow policy and staged enablement

**Status** Accepted in Phase 00.

Use native Git with reviewed operation policies, fixed argv, temporary fixtures, and explicit approval for mutations. Start with confirmed clean checkout and fast-forward-only pull. Add dirty-tree handling and advanced directional branch operations after core safety verification. Untrusted Git configuration reduces the initially supported repository and remote cases. Supported operations retain native semantics and preserve interoperability.

## 0007 · Built-in executable stack adapters and declarative libraries

**Status** Accepted in Phase 00.

Ship reviewed executable adapters. Treat imported templates and modules as limited data and validate compatibility through actual Node and Go implementations before stabilizing the SDK. Defer execution of third-party plugin code until there is an isolation and capability design. This limits early extensions and avoids granting arbitrary machine access as part of ordinary library import.

## 0008 · Native frame and evidence-based Windows support

**Status** Accepted in Phase 00.

Keep the native window frame for Phase 01. Build the original workbench within it and verify appearance, input, and settings on Windows separately from Linux renderer and Electron checks. Defer Electron Builder and installer signing verification to Phase 12. Native frames offer less chrome customization. They retain platform behaviors while the project establishes its application layout and accessible interactions.

## 0009 · Append-only schema authoring before incremental application edits

**Status** Accepted in the Phase 00 final review.

Phase 05 can add a reviewed migration to an existing project through the journaled create path introduced in Phase 04. This extends file creation and leaves historical migrations and existing application files intact. Phase 06 adds ownership-aware application edits and derives missing components from a saved migration without duplicating it. The split limits the Phase 05 write surface while delivering a complete source schema authoring path.
