# Architecture

## Runtime boundaries

| Boundary | Ownership |
| --- | --- |
| Electron main | Window lifecycle, origin checks, IPC handlers, native dialogs, workspace grants, settings and recents, privileged service orchestration. Main validates requests and resolves all paths, identities, and policies before privileged I/O. |
| Sandboxed preload | Deliberate `contextBridge` methods and subscription wrappers. Method arguments and replies follow shared contracts. The bridge removes Electron event objects and returns explicit unsubscribe functions. |
| React renderer | Presentation, route state, interaction, theme, and local view models. It consumes typed capabilities and receives display-safe snapshots and diagnostics. |
| Shared contracts | Runtime-validatable request and response models, domain identifiers, capabilities, and stable error codes. Contracts are platform-neutral and contain no Electron or filesystem authority. |
| Domain engines | Versioned generation, schema interpretation, and stack compatibility. Pure engines consume snapshots and return plans and diagnostics. Main-owned adapters perform authorized reads and operations. |

Keep the main process responsive. Move expensive parsing and planning to a worker when profiling or bounded-job requirements justify it. Trusted workers get explicit input and never inherit workspace or shell authority as a plugin SDK feature. Error codes such as `INVALID_REQUEST`, `WORKSPACE_MISSING`, `STALE_PLAN`, and `RECOVERY_REQUIRED` allow the renderer to map failures to actionable messages. Error telemetry is local and scrubbed.

## Monorepo structure

Phase 01 starts with `apps/desktop` for main, preload, and renderer entry points, and `packages/contracts` for shared schemas and cross-boundary types used immediately. Keep main services in `apps/desktop/src/main/services` while only the desktop consumes them. Main and preload have separate build entry points, privileges, and compilation contexts. Renderer and contracts cannot import main code. Use import restrictions and TypeScript configuration to enforce the direction.

Phase 04 adds `packages/generator` for versioned built-in templates and deterministic plans. Introduce `packages/schema` once Phase 05 has a consumer and fixtures. Phase 08 adds a versioned stack adapter interface inside the generator package and publishes safe capability discovery through contracts. Keep executable built-ins at that boundary until a separate package has a consumer. The future CLI can reuse pure planning and approved platform adapters. Keep workspace package names stable and avoid directories for unused layers.

Use TypeScript in strict mode and pin Node and pnpm for a reproducible frozen-lockfile install. Use Electron, React, Vite, and Tailwind in Phase 01. Select build and test integration after checking Electron's embedded Node/Chromium, host Node, pnpm and native binary support, and the bundler and test matrices. Bundle a sandbox-compatible preload entry and smoke-test it in real Electron. See [Testing strategy](TESTING_STRATEGY.md) for dependency validation.

## Data ownership

| Location | Data and ownership |
| --- | --- |
| Electron per-user application data | Phase 01 versioned JSON preferences, validated on read and written via a same-directory temporary file and replace. Later holds recents, indexes, and the operation journal. Serialize updates so theme and panel changes preserve each other. Corrupt data uses safe defaults with a recoverable message. Preserve records from unsupported future versions and report the compatibility issue. |
| Selected project root | User source code and standard toolchain files. Studio reads only through a session grant. Opening and rescanning create no files here. |
| `.factory/project.json` | Versioned portable descriptor with stable UUID, project type, and stack/profile identifiers. A path grant remains separate from portable identity. |
| `.factory/versions.lock.json` and `.factory/modules.json` | Exact stack, template and generator versions and digests, resolved modules and dependencies. Values describe reproducible inputs. |
| `.factory/generation-manifest.json` | Relative project paths, content fingerprints, template ownership, and generation provenance. |
| `db/migrations/` | Portable, ordered source schema. Diagram coordinates use versioned workbench preferences; see [Database engine](DATABASE_ENGINE.md). |
| Main-owned recovery storage | Worktree-local operation records keyed by canonical path and operation ID, with narrowly scoped backups and content digests. Keep outside the source tree. The recovery design records the staging paths needed for same-filesystem operations. |
| OS-protected credential store | Database and service credentials. Store only opaque references in app data. See [Security](SECURITY.md). |

The portable paths and contract are reserved for their implementing phases. Validate descriptors as untrusted input. Unknown or corrupt versions produce a diagnostic and a read-only view. Schema upgrades use an explicit, versioned operation with recovery. Store relative paths in portable metadata. Keep local absolute paths, machine ports, local database names, and secret references in per-user state. Adopt SQLite for app-local indexes or queries once volume, integrity, or transactional needs justify it. Phase 01 uses built-in filesystem and preference storage APIs and avoids an Electron-native database dependency.

## Workspace lifecycle

Resolve the native selection to a canonical root and issue an opaque session grant scoped to a window and supported actions. Key UI tabs and operation locks by canonical worktree identity. Keep the portable UUID as a separate association for matching relocated managed projects. Unmanaged directories remain inspectable without assigning portable identity. Reopening a recent resolves the recorded directory and revalidates identity, access, and aliasing. A different project at the old path requires explicit admission.

New Project and Clone Repository may authorize a single validated child under a natively selected parent. Bind approval to that destination. Use exclusive directory creation where supported and establish the new workspace grant when the operation succeeds. When a selected project is inside a repository, Phase 03 detects the enclosing marker and asks the user to admit that root before reading its Git data or writing to it. The Git service binds repository discovery to the selected root and treats linked or external Git metadata as unsupported until an explicit common-directory grant exists.

Snapshots hold scan revision, access state, Git identity, and relevant file fingerprints. Watchers are hints. Coalesce bursts, bound scans, reject stale responses, and reconcile on focus, watcher overflow, or manual rescan. Close tabs and revoke grants when a window closes. Handle disappearance, permission loss, and root replacement by revoking access and offering Locate or Retry. When several tabs share a Git common directory, serialize Studio ref mutations in addition to per-worktree locks. These locks coordinate Studio operations. External Git and editor processes can still change the same files. Recheck state immediately before mutation and reconcile the observed result afterwards.

## Git Studio integration

The main-owned Git service consumes an active project root and directory identity from the workspace manager. It exposes named status, diff, comparison, action, and clone IPC methods. A renderer request cannot supply a filesystem path, arbitrary refspec, Git arguments, or command. Revision binds ref, index, configuration, status, and affected path identities. Native confirmation precedes sensitive actions. Phase 03 serializes writes in the Studio window and refreshes the Phase 02 project snapshot after actions. The active renderer refreshes Git context on focus, manual refresh, and a periodic reconciliation. See [Git safety](GIT_SAFETY.md).

## Generator integration

The Contracts package describes validated wizard input, preview files, receipts and pending recovery entries. The Generator package renders trusted bundled templates without filesystem authority. Electron main owns the native parent grant, approval token, journal, filesystem transaction and managed workspace adoption. The renderer never supplies an absolute path or file payload. The generated application runs without a Studio package or a network integration with Studio.

## Platform risks

Windows path handling requires native tests for Unicode, spaces, drive and UNC roots, case-insensitive collisions, reserved device names, alternate streams, and junctions. Git for Windows executable discovery, shell-free argument passing, CRLF policy, and watcher behavior require Windows fixtures. File replacement can fail while an editor or antivirus holds a handle. Treat failures as recoverable operations with cleanup and meaningful errors. Electron packaging introduces separate icon, installer, upgrade, signing, and SmartScreen gates. Linux success does not establish the Windows results. Evidence belongs in [Progress](PROGRESS.md).


## Phase 05 database boundaries

The pure Schema package validates the bounded PostgreSQL model, interprets SQL, compares snapshots, and plans deterministic additive changes. Shared contracts validate the narrow schema IPC. The desktop main service owns scope checks, source files, recovery storage, Git rechecks and the pinned JavaScript PostgreSQL client. The renderer owns drafts and ERD interaction. The generator consumes the schema and explicit table selections for independent new applications. Opening folders and switching branches do not connect to a database.


## Phase 06 incremental generation

The existing generator composes initial and incremental files for the pinned starter. The desktop incremental service captures the granted workspace, ordered migration bytes and Git identity, owns the approval and recovery journal, and verifies each output. Generation Review displays the plan and delegates operations over named IPC commands. History and pending before/after bytes are bounded in per-user application data. Project source remains independent of Studio.


## Phase 07 library boundary

Main stores personal engineering assets in an application-data catalog. The renderer can list and publish validated declarative records. The fixed Node adapter receives exact snapshots and module selections and returns reviewed code and source documents. The generated application contains all runtime components and needs no connection to Studio. Profile and branding reuse never reads client databases or project secret configuration.

## Multiple built-in stacks

The Phase 08 SDK is an interface and registration table inside the generator package with read-only discovery in contracts. It needs no extra workspace package or runtime loading boundary. Studio dispatches a validated stack and architecture pair through the same workspace preview, approval, publication and recovery services. Stack-specific planners only contribute deterministic source bytes. The Go adapter keeps `cmd/` executable entry points, `internal/` packages and a frontend Vite build. Node keeps Layered Web and its existing optional modules. Both consume the shared PostgreSQL schema and portable locks.

## Linked Git checkout identity

Workspace authorization and watchers remain tied to a canonical checkout. Git additionally verifies the shared common-directory identity and the per-checkout metadata identity. The existing workspace service admits linked checkouts as separate tabs. A shared Git writer lock coordinates local Studio ref mutations. Incremental generation and Database Studio bind linked-worktree identity into their review revisions. Existing standalone journal identity fields retain compatibility.

## Developer workbench

The per-window developer service owns native editor and terminal handoff, toolchain probes, reviewed runtime plans, process groups and the bounded loopback HTTP client. It consumes the existing workspace grant and native Git context without exposing generic process, filesystem, shell or network primitives through preload. The runtime catalog is declared with the built-in stack descriptors.

Portable developer design uses a versioned data document. The generator derives API and page observations from current local artifacts. Design and page mutations use the incremental planner and its durable journal. The first page extension uses a second Vite HTML entry so it can preserve the existing React root, CRUD workspace and custom application components. Project source and portable design data remain usable in external tools. See [Developer workspace](DEVELOPER_WORKSPACE.md).

## Client delivery workbench

Client Delivery reads existing incremental and runtime inspections. Quality jobs reuse the developer command planner and process lifecycle. A separate bounded history holds local quality records and artifact receipts scoped to the canonical worktree. Evidence joins native Git context and bounded byte-level source hashes. Builds record a digest of their supported production output. Archive planning requires current successful checks, a clean commit and matching output, then publishes a verified USTAR archive to an explicitly selected directory outside admitted workspaces.

Shared library bundles use content-addressed canonical JSON. The team repository controls exchange and history, and the local library stages exact compatible imports as a single update. Existing projects keep their pinned portable inputs. Deployment and CI definitions are fixed built-in contributions in the incremental planner.
