# Implementation roadmap

## Milestones and dependencies

Each phase delivers a demonstrable slice. Alongside the feature gate below, complete the applicable test, typecheck, lint, build, regression review, security review, and documentation checks in [Testing strategy](TESTING_STRATEGY.md). Record passed, failed, blocked, and pending evidence in [Progress](PROGRESS.md). Keep unavailable product features out of active navigation and generation choices.

| Phase | Depends on | Scope and observable acceptance |
| --- | --- | --- |
| 00 · Product foundation | Initialized repository | Required English instructions and specifications exist, local skills are discoverable, links resolve, responsibilities and risks agree across documents, Cloud and Git are inspected, and Phase 01 has exact gates. |
| 01 · Desktop foundation | 00 | Secure Electron window and functional React workbench, app preferences, theme, resizable navigation, one global workspace context, and keyboard commands. Pass P01-01 through P01-08 below. |
| 02 · Project management | 01 | Native chooser, read-only open for arbitrary admitted folders, recent references, multiple tabs, manual rescan and external-change reconciliation. Prove byte-for-byte preservation on open, separate worktree tab identity, bounded scan, and recovery from missing or moved folders. Read existing portable descriptors safely. Display the actual folder and explicitly mark Git details unavailable until Phase 03. |
| 03 · Developer Workspace | 02 | Add Git Studio core to the actual project workspace. Pass P03-01 through P03-07 below. |
| 04 · AI-ready Application Generator | 02, 03 | Deliver one verified Node.js and PostgreSQL stack with the default foundation and optional Welcome example. Pass P04-01 through P04-08 below. |
| 05 · Database-driven Software Factory | 02, 04 | Render and edit a supported PostgreSQL schema with multiple tables, keys, constraints and indexes. Deliver ERD, reviewed DDL import, append-only source migration creation, read-only introspection, comparison, and reviewed dev migration apply. Deliver optional inventory-style CRUD in a new scaffold. Pass P05-01 through P05-06 below. |
| 06 · Continuous Generation and Code Protection | 03, 04, 05 | Extend Phase 05 CRUD to supported incremental generation from a Studio proposal or manual SQL migration with no duplicate migration. Preserve owned and user-authored code and verify P06-01 through P06-05 below. |
| 07 · Engineering Library and AI Context Studio | 06 | Versioned built-in, personal and Git-shared libraries of architecture, UI, module, component, and deployment templates. Install a supported audited module after project creation, preview dependency changes, lock digests, reject cycles and conflicts, and verify repeatable generation with a reusable appearance customization. Apply a reviewed, version-pinned reusable AI context profile without secrets or a provider integration. This is the primary MVP gate. |
| 08 · Multi-stack support and SDK validation | 05, 06, 07 | Generate an idiomatic Go/Gin + React/Vite + PostgreSQL app using the versioned SDK. Pass P08-01 through P08-05 below. Preserve Phase 07 reference behavior and record migrations and tooling per stack. |
| 09 · Advanced Git and worktrees | 03, 06 | Deliver reviewed commit/stash/worktree dirty-switch paths, guarded branch mutations, comparison and directional merge/rebase/cherry-pick/selected-file operations. Use fixtures to prove linked worktree isolation, ref and file revalidation, conflict preservation, stash recovery, and dirty removal prevention. Gate history, graph, conflict editor, stash, tags, remotes and provider integration on their own operation and permission evidence. |
| 10 · Editor integrations and design extensions | 05, 06, 08 | Prioritize VS Code handoff and context-aware links to source. Keep embedded source editing, controlled run/debug, logs, terminal, and advanced designers as gated extensions with local trust controls. Verify an API design-to-request path, a saved page design that builds through an enabled stack, and a saved requirements-to-workflow link that points to real project artifacts. |
| 11 · Engineering standards, collaboration and release | 07, 09, 10 | Verify an engineering standard and shared template through Git and CI. Build and package a generated app using reviewed environment and deployment configuration. Show test, inspection, and release results, permission errors, and project history and recovery. Prove the core flow works without a mandatory Studio service. |
| 12 · Windows distribution and verification | 11 and Windows native evidence for relevant earlier phases | Produce a Windows x64 installer via Electron Builder and verify clean install, launch, upgrade with data preservation, uninstall, and documented signing and SmartScreen behavior on actual Windows. Record exact artifact and platform versions. |

## Product MVP

Phase 07 is the first complete factory workflow. A developer opens a real repository, generates an independent app with project instructions, proposes a schema and source migration, adds or updates code without losing custom work, and reuses a versioned template, module, and context profile on another project. This workflow runs locally with the ordinary stack toolchain and without a mandatory AI account. A coding assistant can consume the same human-readable context alongside VS Code. Verify the whole workflow before claiming MVP readiness.

Phases 08–12 retain the approved multi-stack, advanced Git, design, development, quality, collaboration, deployment, and distribution requirements. Prioritize interoperability and external editor handoff ahead of full IDE duplication and complex page authoring. Verify extended capability claims individually. Phase 04 begins after Phase 03 approval and merge.

## Phase 08 acceptance criteria

| ID | Gate | Observable pass criteria |
| --- | --- | --- |
| P08-01 | Stack SDK | Resolve exact Go and Node stack versions. Reject incorrect architectures and incompatible modules. Replay both stacks and preserve old Node plans. |
| P08-02 | Go foundation | Build and run Gin, PostgreSQL readiness and the React frontend using locked Go and web dependencies. Verify Go commands, migrations and project-specific instructions. |
| P08-03 | Go CRUD | Exercise real PostgreSQL HTTP and browser operations, constraints, nullability, pagination and filtering. Add supplier CRUD from existing reviewed SQL while preserving customization and preventing duplicate writes. |
| P08-04 | Workspace and isolation | Select Go in the native catalog and wizard, verify retained Database Studio and Generation Review support, protect owned integration files, and snapshot shared profiles independently. |
| P08-05 | Delivery | Pass both platform workflows, verify generated applications, audit dependencies and capture the Technology Catalog and New Project Wizard. |

## Phase 07 acceptance criteria

| ID | Gate | Observable pass criteria |
| --- | --- | --- |
| P07-01 | Engineering library | Browse the verified stack, architecture, profiles, templates and modules. Duplicate or create a personal asset, preview and publish an immutable version, exchange validated portable JSON and select an exact release in the wizard. |
| P07-02 | Independent project and template | Generate projects sharing one profile with different branding, schemas and module selections. Validate locks, advisories, client requirements, unauthenticated generation, generated documentation and standalone builds. |
| P07-03 | Application identity | Verify opt-in authentication, bootstrap, server authorization, user and role administration, protected React UI, audit inspection and privacy. Exercise session expiry and revocation, cross-origin rejection, throttling, and invalid privilege assignments against disposable PostgreSQL. |
| P07-04 | Incremental installation | Install a reviewed supported identity release into an existing starter, verify ordered dependency decisions and source provenance, preserve custom code, reject unsafe integrations, and prove interrupted installation resumes without duplicate migrations. |
| P07-05 | Delivery | Pass applicable Studio and generated application checks on Linux and Windows x64. Capture the wizard and library in the built app, audit dependencies and document working capabilities and limitations. |

## Phase 06 acceptance criteria

| ID | Gate | Observable pass criteria |
| --- | --- | --- |
| P06-01 | Read-only inspection | Inspect modular starter locks and ownership, distinguish changed, missing and discovered files, and detect a supplier migration saved outside Studio. Reject unsupported layouts and DDL. |
| P06-02 | Deterministic generation and review | Preview exact creates and updates, protected files, conflicts, content differences, migration references, and unchanged dependencies. Generate compatible API and React layers without a new migration. Repeat the same selection with zero writes. |
| P06-03 | Workspace and code protection | Preserve custom source, modules and requirements. Block unknown or modified required integration files, staged targets, symlinks, junctions, revoked grants, and changed refs or migration checksums. |
| P06-04 | Applied work and recovery | Require native authorization bound to the plan, publish verified writes with app-data history, and exercise interruption, restart, conflicting external edits, resume, and explicit handoff. |
| P06-05 | Independent verification | Verify the inventory project before and after supplier generation with disposable PostgreSQL and browser CRUD. Pass Studio lint, typecheck, tests, builds and Linux and Windows workflows. Capture the built desktop review in both themes. |

## Phase 05 acceptance criteria

| ID | Gate | Observable pass criteria |
| --- | --- | --- |
| P05-01 | Model and designer | Create, edit and validate multi-table PostgreSQL drafts with constrained types, defaults, keys, constraints and indexes. Inspect relationships in a keyboard-accessible ERD, reposition nodes and reopen the saved layout in both themes. |
| P05-02 | Source and migration | Import supported SQL into a draft without execution and report unsupported DDL with source locations. Plan deterministic additive DDL and publish an exclusive migration with native approval, checksum and recovery. Rescan external migration edits. Reject stale refs, changed files, conflicts and escaping links. |
| P05-03 | Physical comparison | Inspect a selected namespace in a read-only transaction. Show physical, declared, applied and pending state independently. Verify ledger mismatch, drift, separate approval for loopback development apply, transactional rollback and no implicit DB action from checkout. |
| P05-04 | New-project CRUD | Enable migration-only, API, or API plus React per supported table through the wizard. Verify compatible selections, template ownership, manifests, independently runnable output, and configuration-specific engineering documentation. |
| P05-05 | Inventory verification | Use five related tables in disposable PostgreSQL. Exercise HTTP and React create/read/update/delete, filtering, pagination, invalid requests, uniqueness, checks, and foreign-key behavior. |
| P05-06 | Regression and delivery | Run Studio lint, typecheck, unit/integration tests, renderer, Electron, build, and Linux/Windows CI. Review data, path, IPC and Git boundaries and record platform evidence. |

## Phase 04 acceptance criteria

| ID | Gate | Observable pass criteria |
| --- | --- | --- |
| P04-01 | Wizard | Review the only supported full-stack configuration, project name, package/folder name, API port, native destination, architecture, and engineering profile. Browse the exact create plan and cancel before any project files are written. |
| P04-02 | Determinism | Identical complete inputs, including a project ID, produce matching files, template/version locks, and fingerprints. Generate a readable portable descriptor and manifest. |
| P04-03 | Authorization and recovery | Confirm the destination and digest natively, reject existing or replaced destinations, invalid tokens, reserved names, traversal, links and junctions. Resume an interrupted journal only after reauthorization, preserving edited files, unexpected entries and incompatible plans for review. |
| P04-04 | Standalone starter | Install the generated project from its lockfile. Pass its lint, strict typecheck, tests and production build. Start the generated server, serve its browser bundle and retrieve a PostgreSQL-backed response. Verify migration replay and checksum rejection against a disposable PostgreSQL instance. |
| P04-05 | Engineering profile | Generate AGENTS.md, README, architecture, coding standards, requirements, environment example and dependency notices consistent with the actual code. Record the profile version and keep new profile versions independent of generated client repositories. |
| P04-06 | Desktop flow | Verify native approval, file verification and opening the managed project. Check Light/Dark review, keyboard navigation and stale/error feedback. Runtime commands and database writes stay in the user's terminal. |
| P04-07 | Regression and delivery | Pass Studio Linux and Windows checks, preserve Git Studio behavior, review the full diff and record the target/platform-specific verification evidence. |
| P04-08 | Modular composition | Verify foundation-only and Welcome-enabled projects independently. Unselected modules contribute no code, dependencies, routes, migrations, tests or instructions. Reject unavailable combinations and preserve replay of previously approved v1 journals. |

## Phase 03 acceptance criteria

| ID | Gate | Observable pass criteria |
| --- | --- | --- |
| P03-01 | Native discovery and workspace scope | Resolve approved Git outside the project. Show no Git, no repository, unborn and detached HEAD, actual worktree identity, and operation-in-progress states. Opening and inspecting change no project files. Initialize only an explicitly confirmed empty Git metadata location. Reject closed and relocated grants and avoid running writes against an enclosing repository. |
| P03-02 | Source control | Show working, staged, untracked and conflict rows and bounded read-only file/hunk diffs. Verify file stage and unstage (including unborn HEAD), commit preview, durable commit, and preservation of unstaged work. Conflicts and stale reviews prevent unsupported writes. |
| P03-03 | Branch handling | List local and remote refs. Compare a ref without checkout. Create a branch at the reviewed object. Switch cleanly on native confirmation, including from detached HEAD. Show changed paths and Cancel when dirty. Verify ignored collisions, stale ref/status, and pending Git operations without dropping files. |
| P03-04 | Remotes and clone | Clone to a new child of an approved native destination. Reject unsupported transport and existing destinations. Verify fetch, ahead/behind, fast-forward-only pull and explicit ordinary push with a disposable bare remote. Show and preserve divergence and partial failures. Support public HTTPS within the documented policy. |
| P03-05 | Subprocess and IPC | Validate typed requests and responses, permit only named operations, verify grant and configuration for each scope, limit output, and exercise blocked hooks, config delegation, traversal, and metadata links or junctions. Neither database actions nor project script execution is available. |
| P03-06 | Workbench | Top bar and Git Studio represent the active tab and branch, with accessible controls and outcomes in light and dark. External changes reconcile on focus, periodic refresh, or manual refresh. Successful checkout rescans project structure. Verify the built native UI with real repositories and disposable chooser decisions. |
| P03-07 | Delivery | Pass lint, type checking, unit, integration, renderer, Electron, and production build checks. Record Linux and Windows results separately and review the entire diff, risks, and limitations. |

## Phase 01 acceptance criteria

| ID | Gate | Observable pass criteria |
| --- | --- | --- |
| P01-01 | Reproducible workspace | Introduce only `apps/desktop` and `packages/contracts` as workspace packages. Record the chosen version matrix and install-script policy. A fresh `pnpm install --frozen-lockfile` succeeds using the pinned toolchain. Root `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` all exit zero. Main, preload, and renderer compile in separate contexts with strict TypeScript and enforced import boundaries. |
| P01-02 | Secure runtime | Launch built output in real Electron. Verify context isolation, sandbox, disabled Node integration, enabled web security, and no accessible renderer Node or raw IPC. The packaged origin serves bundled assets only with restrictive CSP. Attempts to navigate off-origin, create a new window, or request unexpected permissions are denied. Development Vite origin is accepted only in explicit dev mode. |
| P01-03 | Typed bridge | The preload exposes only app information, preference read/write, and any event subscription needed for native theme changes. Valid values complete a full main/preload round trip. Unknown payload keys, invalid theme or sidebar width, or an untrusted origin or subframe lead to bounded errors with no settings mutation. Invalid replies are rejected without exposing raw payloads. |
| P01-04 | Functional workbench | Home and Settings open through real navigation groups within the global Workspace tab. The top bar shows `No project open` with accessible empty working-directory and Git context. The status bar reflects actual workspace and preference state. Collapse and restore the sidebar or resize it with a pointer and 8 px keyboard steps. Clamp resizing at 180–320 px from an initial 240 px. Test 1280×800, 1024×768, and 200% zoom. Project, Git, generator, and database capabilities remain inactive. |
| P01-05 | Theme and persistence | Settings offers System, Dark and Light. System responds to an OS color-scheme change. Theme and expanded width survive an Electron exit and relaunch via temp-profile app data. Use controlled write-failure, corrupt-file, and future-version fixtures to show a recoverable message, safe defaults where applicable, preserved future data, and no fake save confirmation. Check AA contrast and visible focus in both themes. |
| P01-06 | Commands and keyboard | Ctrl+K on Windows/Linux and Cmd+K on macOS opens a searchable palette with Home, Settings and Toggle Sidebar. Arrow keys and Enter invoke the selected functional command. An unmatched query shows an empty result state. Escape closes the palette and restores focus. Test focus order, accessible names, and keyboard-only use for all shell controls. |
| P01-07 | Layered evidence | `pnpm test:renderer` drives the shell in Playwright with a test-only typed adapter. `pnpm test:electron` or a documented, repeatable equivalent exercises built main, preload and renderer with a temporary profile in a sandbox-capable environment, including successful launch and clean exit. Record separate results. Run a Windows x64 native launch, resize and theme persistence smoke for Windows claims. If Windows is unavailable, report it as pending and keep the Windows gate open. Installer evidence belongs to Phase 12. |
| P01-08 | Review and scope | Record commands and acceptance results, update instructions for running the shell and suites, and review IPC, CSP, data storage, accessible states, and regressions. Keep future engines, inactive navigation, and packaging dependencies out of this phase. |

## Sequencing rules

Introduce native dialog, recents and watchers with actual project admission in Phase 02. Add Git remotes and indexing when their safety checks are implemented. Introduce PostgreSQL access, React Flow, a migration parser, or SQLite only when the corresponding feature needs it. Gate generation on published stack-specific evidence. A phase can land incrementally with explicit pending evidence. Mark a phase verified only when its applicable gates pass.

Add `factory-generator` in Phase 04, `factory-schema` in Phase 05, and `factory-stack-plugin` in Phase 08 when the corresponding engines or SDK have working execution paths and fixtures.
