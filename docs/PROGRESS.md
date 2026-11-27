# Progress

## Phase 00 · Product foundation

Phase 00 is prepared for human review. The base checkout contained only `README.md`. The work adds planning documents and three repository-local skills. No application source, lockfile, application dependencies, or test binaries were added.

| Item | Observation |
| --- | --- |
| Repository | `andrewcastello168/software-factory-studio`, checked out at `/workspace/software-factory-studio` |
| Working branch and starting HEAD | Isolated `work` at `b9e05203fe981a9f01d308d78b21bfb0878ac0d0`. The initial tree was clean. |
| Base and remote default | The remote returned `HEAD -> refs/heads/main`. `origin/main` matched the starting HEAD. |
| Host and toolchain | Debian 13.7 on Linux x86-64 with Git 2.56.1, Node 24.22.3, npm 11.19.1, pnpm 11.25.0, Corepack 0.36.0, and Python 3.12.14. These are Cloud observations. Workspace pins will be decided in Phase 01. |
| Network and containers | Read access to the configured Git remote and `npm ping` passed. Cloud reports a restricted package-manager allowlist. Docker client and daemon reported 29.9.2. Container execution and PostgreSQL availability remain unverified. |
| Browser and desktop | Chromium 156.0.8078.79 and a Playwright 1.62.0 CLI are installed. The standalone sandboxed Chromium probe failed because the SUID sandbox helper had non-root ownership. The shell had no DISPLAY or WAYLAND_DISPLAY, and `Xvfb` and `electron` were absent from PATH. A compatible runner is needed for product browser and runtime evidence. |
| Other toolchains | `psql` and `sqlite3` were absent from PATH. The `go` command on PATH rejected Go toolchain version flags. A usable Go toolchain was unverified. |
| Windows | Native Windows launch, path and Git behavior, and installer tests require Windows evidence. Linux observations establish none of those gates. |

## Verification record

| Check | Result and boundary |
| --- | --- |
| Repository and remote | Passed. Used `git rev-parse`, `git status --short --branch`, `git log -1`, and `git ls-remote --symref origin HEAD refs/heads/main`. |
| Required files and documentation | Passed. Verified 17 changed Markdown files, three skill manifests, 54 local references, document whitespace, 13 ordered phase records, and all eight Phase 01 gate identifiers. |
| Design, security, and regression review | Passed for Phase 00 planning. Reviewed scope against the original README-only tree, checked 44 text and control contrast pairs across both themes, and traced Electron authority, Git execution and recovery, generation ownership, and schema authority against the phase gates. Adjusted the strong border tokens after the initial dark selected surface fell below 3:1. Runtime behavior awaits implementation. |
| Application typecheck, lint, tests and build | Not applicable. Phase 00 has no application code or dependency manifest. |
| Standalone headless Chromium probe | Failed at browser startup. The probe used `chromium --headless --dump-dom` with a temporary profile and kept Chromium sandboxing enabled. |
| Windows verification | Pending. Phase 01 requires a separate Windows x64 native smoke test for Windows claims. Phase 12 owns installer verification. |

## Open engineering risks

| Risk | Trigger and control | Gate |
| --- | --- | --- |
| Electron, Playwright and toolchain compatibility | Validate candidate version and platform metadata, pin resolved versions, then build and smoke real preload in Linux or Windows with sandboxing enabled. | 01 |
| Windows path and file semantics | Exercise path aliases, junctions, case collisions, user permissions, editor-held files, and watcher reconciliation on Windows fixtures. | 02 onward |
| Native Git executing untrusted programs | Prove per-operation handling of hooks, filters, config, transports and ignored files. Refuse unsafe or unsupported operations before mutation. | 03 and 09 |
| Concurrent edits, partial generation, or overwrite | Bind approved bytes to worktree and fingerprints, use safe filesystem primitives, inject interruption at journal boundaries, and preserve intervening edits during recovery. | 04 and 06 |
| Schema drift and unsafe database writes | Keep source, pending and physical states independent. Validate ledger checksums, show unsupported parsing, and prove branch changes never issue DDL. | 05 and 06 |
| Third-party code execution | Keep shipped adapters reviewed and imports declarative. Require an isolated execution design before supporting executable external plugins. | 07 and 08 |
| Windows native runtime and distribution | Record native smoke evidence early, then verify real installer, upgrade, uninstall, signing, and SmartScreen behavior on Windows. | 01 and 12 |

## Final review

Reviewed the Phase 00 change set against the master assignment. The final specifications clarify append-only schema authoring in Phase 05, external Git race handling, unsupported preference versions, application origin validation, and the remaining milestone gates. The delivery scope is the 17 required Markdown files. Final checks cover the complete diff, local references, skill metadata, roadmap and Phase 01 gates, theme token contrast, and common secret patterns. Application checks remain outside this documentation milestone.

Phase 00 handed off to [Phase 01](ROADMAP.md#phase-01-acceptance-criteria) with dependency, sandbox-capable runner, and Windows verification gates.

## Phase 01 · Desktop foundation

The isolated `work` branch was fast-forwarded to approved `origin/main` at `99cf46f7c3a45790acc936e1bee7b8de4b1d45fc` before implementation. The workbench delivers Home, Settings, planned navigation labels, a command palette, a collapsible and resizable sidebar, and separate desktop and browser development commands. The production build uses independent Electron main and preload entries, a local renderer protocol, and versioned preferences. Project admission, Git operations, generators, database features, and installer packaging remain scheduled for later phases.

| Layer | Pinned versions or verified evidence |
| --- | --- |
| Host | Node.js 22.16.0 and pnpm 10.13.1 on Cloud Linux x64, matching the Windows development target |
| Desktop | Electron 45.5.0, embedded Node.js 24.22.3, Chromium 156.0.8078.109 |
| Renderer | React and React DOM 19.3.1, Vite 8.3.8, React plugin 6.3.0, Tailwind CSS and Vite plugin 4.3.5, Lucide React 1.80.0 |
| Build and verification | TypeScript 6.0.3, esbuild 0.28.2, ESLint 10.15.0, typescript-eslint 8.74.0, Vitest 5.1.2, Playwright 1.65.1 |
| Dependency setup | Registry engines and peers match the selected host. Lockfile retains Windows and Linux native package selections. Initial and clean frozen installs passed on Linux. esbuild's lifecycle script is excluded. Electron binary setup runs explicitly via `install-electron`. |

## Phase 01 verification

| Gate | Result and scope |
| --- | --- |
| P01-01 | Passed in Cloud Linux. Clean frozen install, strict typecheck, ESLint, Vitest, and production build succeeded. |
| P01-02 | Passed on Linux. Built Electron loaded the local origin with sandboxing on. The smoke checked Node and raw IPC isolation, CSP, denial of extra windows and outside navigation, a denied permission check, and unavailable resources. |
| P01-03 | Passed on Linux. Contract tests cover invalid input and replies, and frame tests exercise untrusted origins and subframes. The native smoke exercised the real bridge and denied a write from a second window on the same origin. |
| P01-04 | Passed on Linux. Playwright verified 1280×800, 1024×768, and 640×400 in the renderer. Pointer and keyboard resizing and the 180–320 px limits passed. Native Electron verified the shell at 200% zoom with no document-level horizontal overflow. |
| P01-05 | Passed on Linux. File integration tested serialized writes, corruption, explicit restore, future-version preservation, and controlled filesystem failure. Native Electron followed a System theme change and restored the saved theme and width after a clean relaunch with a disposable profile. |
| P01-06 | Passed in Playwright and manually inspected in Cloud Chrome. Checked `Ctrl+K`, filtering, empty results, keyboard command execution, and Escape focus restoration. |
| P01-07 | Renderer and native Electron suites passed on Linux and on the GitHub-hosted Windows Server 2025 x64 runner. |
| P01-08 | README documents all root commands, exact Windows setup and smoke checks, and runtime boundaries. Security review and dependency audit completed for Phase 01. |

`pnpm test` passed 21 tests across three Vitest suites. `pnpm test:renderer` passed seven Playwright cases with system Chromium and Chromium sandboxing enabled. The default Chromium download endpoint was denied by the Cloud allowlist. The preinstalled Chromium worked on the host runner with its sandbox intact. `pnpm audit --audit-level high` reported no known vulnerabilities.

The sandboxed Electron smoke passed on an isolated Xvfb display on the Cloud host. The ordinary command sandbox prevented Chromium sandbox initialization, and the managed desktop X11 display rejected the test process. The final test used an isolated display and temporary Electron user-data directory with Chromium sandboxing enabled. The native development launcher also started with the fixed Vite origin and build watcher.

Cloud Chrome visual review covered Home in Light, Settings in Dark, the collapsed sidebar, and a filtered command palette. The screenshots prompted two changes. The Factory Library group got one availability label, and Settings gained a functional navigation row with the expanded width. Browser preview evidence covers rendering and local interactions, including the explicit notice that desktop preferences are unavailable.

## Windows x64 verification

The Windows Server 2025 x64 GitHub Actions job passed the frozen installation, lint, type checking, production build, 21 unit and filesystem integration tests, seven renderer tests, and one native Electron smoke test. The Electron suite verified sandboxed launch, denied operations, resizing at 200% zoom, and theme and sidebar persistence after relaunch. [Successful Windows CI run](https://github.com/andrewcastello168/software-factory-studio/actions/runs/45742068229)

The initial run exposed a preferences read failure because Node's Windows path stats omitted the volume serial for a file whose opened handle reported it. The fix retains the exact file ID comparison and checks creation time when that volume serial is unavailable. The Windows filesystem integration and native Electron suites both cover successful reads after a write.

Use the [PowerShell commands](../README.md#development-setup) to reproduce the checks on a local Windows system. Windows installer, upgrade, uninstall, and signing checks remain Phase 12.

## Phase 02 · Project management

Phase 02 starts from `main` at `c5c8d19` with the merged desktop foundation and Windows x64 CI fixes. The existing Windows workflow runs the Phase 02 suites. The base had no tracked Linux workflow, so a Linux job runs the pinned installation, lint, type checking, filesystem integration tests, and build on GitHub. The full Linux browser and native Electron suites run separately in Cloud with sandboxing enabled.

| Gate | Evidence |
| --- | --- |
| Native chooser and real folders | The integration suite uses disposable local directories. The built Electron suite checks the directory-only dialog call, then supplies a fixture choice and exercises the same admission and IPC path as the desktop UI. |
| Read-only opening and portable metadata | Fixtures preserve their directory entries, source bytes, and original descriptor bytes. The descriptor parser covers absent, valid, invalid, newer, and blocked metadata. |
| Multiple workspaces and persistent recents | Tests cover separate roots sharing a portable UUID, canonical deduplication, tab selection, close and revocation, and reopening a recent after Electron relaunch. |
| Rescan, filesystem events, and missing paths | Tests cover edits from outside Studio, a manual scan, a missing or replaced root, confirmed relocation, and rejecting an unconfirmed identity mismatch. |
| Filesystem boundary | Tests cover invalid IPC paths and unknown tokens, traversal and reserved-name validation, scan depth, skipped links, and a native Windows junction fixture. |
| Git status and clone | The workbench displays the actual working folder and labels Git details unavailable. Phase 03 owns cloning and Git operations. |

Cloud Linux passed lint, type checking, 42 Vitest cases, the production build, eight sandboxed Chromium tests, and two sandboxed Electron tests. GitHub Linux x64 passed the frozen install, lint, type checking, Vitest, and build. [Linux CI](https://github.com/andrewcastello168/software-factory-studio/actions/runs/45745161634)

GitHub Windows Server 2025 x64 passed the frozen install, lint, type checking, build, the same 42 Vitest cases, eight Chromium tests, and two native Electron tests. The initial Windows run exposed descendant watcher handles blocking folder moves and an alias mismatch in the recent-store containment check. Both cases passed after the watcher and path fixes. [Windows CI](https://github.com/andrewcastello168/software-factory-studio/actions/runs/45745161643)

Project Overview in light theme and Project Structure in dark theme were visually inspected from the built Linux app. The Windows test captures the same screens with disposable projects. [Windows screenshots](https://github.com/andrewcastello168/software-factory-studio/actions/runs/45745161643/artifacts/15082792961)

## Phase 03 · Developer Workspace

Phase 03 started on the isolated `work` branch. GitHub confirmed PRs #1 through #4 were merged, including the Windows CI fixes. The remote default branch was `main`. The local checkout fast-forwarded from `dfaee2a` to `685fd5ec2164261f033768c0d79ccac95830b352` before implementation. Delivery is [PR #5](https://github.com/andrewcastello168/software-factory-studio/pull/5) targeting `main`.

| Gate | Evidence |
| --- | --- |
| P03-01 | The native service checks Git availability and admits a standalone repository at the selected project root. Fixtures cover explicit initialization, an unborn branch, detached HEAD, and revocation after move or close. |
| P03-02 | Disposable repositories verify the porcelain parser, status additions and renames, a genuine merge conflict, stale working diffs, stage and unstage, and commits that preserve separate unstaged changes. |
| P03-03 | Native Git verifies branch creation and clean checkout. Tests cover read-only comparison, dirty cancellation, ignored-file collisions, and changes during native confirmation. |
| P03-04 | A disposable local bare remote verifies fresh clone, existing destination rejection, fetch and upstream counts, fast-forward pull, ordinary push, and divergence preservation. Public HTTPS uses direct TLS with credential helpers and redirects disabled. |
| P03-05 | The review covered the Electron sender and project grant, strict action fields, path validation, config allowlisting, inactive hooks, bounded output, and metadata junctions. Git Studio has no project execution or database entry point. |
| P03-06 | Browser and native tests exercise keyboard interaction, Escape focus restoration, both themes, the active tab, external changes, and the project tree after checkout. The native tests use real repository data with controlled chooser and confirmation results. |
| P03-07 | Cloud Linux passed lint, typecheck, 50 unit and integration tests, the production build, nine renderer cases, and three native Electron cases. The public HTTPS smoke needs direct DNS and TLS access to GitHub and is enabled in the Windows workflow. |

Visual review used real Electron captures of a working patch in Light and a remote-branch comparison in Dark. The iterations made the dirty-checkout dialog focus Cancel, prevented file action tooltips from moving the row during a click, made disabled commit styling explicit in both themes, and constrained the scrollable workbench above the status bar in compact windows. The [Windows transport and integration run](https://github.com/andrewcastello168/software-factory-studio/actions/runs/45749000622) passed Git for Windows integration, including local transport, paths with spaces and Unicode, metadata junctions, and the native public HTTPS smoke. It exposed a compact-window overlap between the workbench and the status bar. Subsequent [PR checks](https://github.com/andrewcastello168/software-factory-studio/pull/5/checks) exercise the corrected layout with a real commit in a compact native window. Physical picker interaction, ordinary on-device display scaling and installer checks remain documented in [README](../README.md).

Phase 07 is the primary product MVP. Phase 04 next delivers one independently runnable Node.js, TypeScript, Express, React, Vite, and PostgreSQL scaffold with preview, approval, recovery, and repository-native project instructions. Begin that work after Phase 03 approval and merge. See the [MVP gate](ROADMAP.md#product-mvp).

## Phase 04 · AI-ready Application Generator

Phase 04 started from main at ab724b71fcb2fccaa866c87e725fa3b6c518535e, which contains PR #5 and the preceding desktop and Windows fixes. The isolated Cloud work branch stayed in place. Delivery is [PR #6](https://github.com/andrewcastello168/software-factory-studio/pull/6) targeting main.

| Gate | Evidence |
| --- | --- |
| P04-01 | Native New Project shows the supported full-stack option, Layered Web v1, Standard Engineering v1, exact destination and 36 preview files. Cancel leaves the selected parent unchanged. |
| P04-02 | Planner tests compare repeated plans, output digests, versions, and the generated descriptor and manifest. Node and pnpm are pinned, and the starter installs using its bundled lockfile. |
| P04-03 | Disposable tests cover stale approval, case collisions, reserved names and path validation, parent replacement, a symlink or junction during recovery, journal interruption, parent reauthorization, preserved edits, verified resume and explicit manual handoff. Git Studio checks for overlapping generation records before writes. |
| P04-04 | Cloud Linux independently installed, linted, typechecked, tested and built the generated application. With PostgreSQL 17.12, it verified API liveness, a persisted welcome message, migration replay and changed checksum rejection. The Vite development proxy and compiled production app both reached the API. Sandboxed Chromium rendered the live PostgreSQL message. |
| P04-05 | The preview includes the generated AGENTS.md, README, architecture, coding standards, requirements, dependencies and environment example. Profile and template fingerprints are portable. |
| P04-06 | Cloud Linux passed ten Playwright renderer tests and four real Electron tests. Native picker and confirmation decisions use controlled test results. Actual publication, digest verification and opening the generated project run through the production bridge. Light and Dark screenshots informed wrapping long Markdown lines in the file preview. The optional Git public-HTTPS regression runs on Windows. |
| P04-07 | Cloud Linux passed the frozen workspace install, lint, typecheck, 58 Vitest cases and the production build. The [PR checks](https://github.com/andrewcastello168/software-factory-studio/pull/6/checks) report Linux and Windows results for this change. The existing Windows workflow uses a dedicated database on the runner's PostgreSQL 17 service and verifies the generated browser flow. |

Studio authorizes file creation in a new directory. It does not run install, startup or migration commands. The destination must support hard links. Windows uses canonical-path and identity checks around native operations. Simultaneous changes by an adversarial process running under the same local account are outside that protection boundary. An ambiguous partial folder is handed off without deleting files. Detailed verification instructions and manual native-dialog limits are in the [README](../README.md) and [testing strategy](TESTING_STRATEGY.md). Phase 05 has not started.

The initial [Linux x64 run](https://github.com/andrewcastello168/software-factory-studio/actions/runs/45751738063) and [Windows Server 2025 x64 run](https://github.com/andrewcastello168/software-factory-studio/actions/runs/45751737977) passed at 93af92e. Both verified the generated app with isolated PostgreSQL. Windows additionally verified the running React frontend in Chromium and exercised the native New Project flow. The latest PR checks cover the subsequent manual recovery handoff and preview readability changes.

## Phase 04 · Modular generator follow-up

PR #6 was already merged. The isolated Cloud work branch advanced to main at 9468cc6ed8553b8766adba412579dbba6a67f98f before implementation. The follow-up is [PR #7](https://github.com/andrewcastello168/software-factory-studio/pull/7).

| Gate | Evidence |
| --- | --- |
| P04-01, P04-06 | The sandboxed desktop verified a default 34-file foundation preview, a canceled confirmation, and opening the 41-file Welcome-enabled project. Captured the feature selector and both Light and Dark previews. |
| P04-02, P04-08 | Identical inputs produce identical plans. The optional example adds seven owned files and only its required registrations, test command and documentation. Unsupported application types, database choices, module IDs and versions, duplicate modules, and missing prerequisites are covered. |
| P04-03 | The previously released v1 digest was reproduced byte for byte. An interrupted v1 record resumed with its original layout. The suite also exercised the existing conflict, stale plan, link or junction, and manual handoff cases. |
| P04-04, P04-05 | Both generated configurations passed frozen installation, lint, typecheck, tests, development proxy and production build. Isolated PostgreSQL 17 schemas verified readiness and checksum rejection. The foundation schema contained only the migration ledger and its welcome route returned 404. The selected example's migration added its seeded table and sandboxed Chromium displayed the persisted value. |
| P04-07 | Cloud Linux passed 62 unit and integration tests, 10 Chromium renderer tests, four Electron tests, and the production build. The optional public Git HTTPS regression runs on Windows. [PR checks](https://github.com/andrewcastello168/software-factory-studio/pull/7/checks) cover both platform workflows. |

No application dependencies changed. Foundation and example share the frozen dependency graph. Startup, credential handling, filesystem authority, and recovery remain within the Phase 04 boundaries. The reusable module installer and Database Studio are later milestones.

## Phase 05 · Database-driven Software Factory

| Gate | Verification |
| --- | --- |
| P05-01 | Model, designer and ERD exercised in the built desktop UI. The inventory fixture shows five tables and four foreign keys, keyboard movement, persisted coordinates and both themes. PostgreSQL 17 verified literal and typed defaults across the documented model. |
| P05-02 | Tests cover deterministic ordering, composite and cyclic keys, unsupported DDL, stale file and Git state, protected symlinks and junctions, interrupted publication and restart recovery. Native UI verification approves and publishes one additive file. Historical bytes remain intact. |
| P05-03 | PostgreSQL 17 catalog and ledger checks use a disposable loopback database. Verified read-only inspection, reviewed apply and schema parity, checksum divergence, and rollback of both DDL and ledger on a failed constraint. Git integration regression checks use disposable workspaces. |
| P05-04 | Migration-only, backend-only, and API plus React selections are covered by generator tests. Reviewed native preview, manifest ownership, configuration-specific documentation, optional features, and old Phase 04 workflows remain available. |
| P05-05 | Standalone inventory, foundation and Welcome projects each install from their generated frozen lock, lint, typecheck, test, build and run. Inventory verifies API and sandboxed Chromium CRUD, filtering, pagination, request errors, unique and check constraints, foreign-key rejection, and SET NULL against PostgreSQL 17. |
| P05-06 | Local Debian 13 Linux x64 passed frozen install, lint, typecheck, production build, 71 Vitest checks, 11 Playwright renderer checks, and five built Electron checks. The public HTTPS Git smoke requires the Windows workflow's explicit opt-in. GitHub Actions reuses Linux x64 and Windows Server 2025 x64 workflows, and the delivery pull request records the job links and screenshot artifact. |

Database apply is confined to a separately approved development target. The UI support matrix and manual native dialog, remote trust store and installer checks are documented in [Database engine](DATABASE_ENGINE.md), [Testing strategy](TESTING_STRATEGY.md) and the [README](../README.md). CRUD composition is create-only in this phase. Phase 06 will extend application writes using ownership, conflict and recovery rules.

## Phase 06 · Continuous Generation and Code Protection

| Gate | Verification |
| --- | --- |
| P06-01 | Verified modular project locks and ownership, manual supplier migration detection, missing files and protected paths on disposable roots. The existing read-only schema workflow remains available. |
| P06-02 | Built Electron reviewed exact created and modified files, a protected custom service, cancelled native consent, applied an approved plan, and then showed zero writes for the same selection. Captured dark and light plans. |
| P06-03 | Exercised Git branch and migration staleness, modified entrypoints, a revoked workspace grant, and an escaping symlink or Windows junction. Retained custom source and client instructions. |
| P06-04 | Simulated an interruption after creating a verified backup. Restarted the service, rejected a conflicting edit, and resumed with fresh approval when the conflict was removed. Manual handoff preserves backup and workspace bytes and records a receipt. |
| P06-05 | Debian 13 x64 passed frozen install, lint, typecheck, 76 Vitest checks with a PostgreSQL 17 fixture, 11 renderer checks, six sandboxed Electron checks, and a production build. The standalone verifier passed the foundation, Welcome, original inventory and expanded inventory with PostgreSQL. Windows CI opts into the public HTTPS Git smoke. Delivery links the CI runs and screenshots from the pull request. |

Supported scope is the deterministic modular v2 layout, approved CRUD types, existing supported migration sources and untouched required integration files. Editable application extension points and optional module installation remain future work. Resume and handoff are explicit filesystem recovery operations independent of database and Git history.

## Phase 07 · Engineering Library and AI Context Studio

The isolated `work` branch started from `main` at `262f134`, after the merge of Phase 06 PR #9. The verified stack remains Node/TypeScript, Express, React/Vite, and PostgreSQL with Layered Web. The [MVP guide](MVP_GETTING_STARTED.md) describes project creation, safe installation, and deployment prerequisites.

| Gate | Verification |
| --- | --- |
| P07-01 | Sandboxed Electron published a personal profile, selected the exact version and Business Workspace template, and captured a branded project preview. Library tests cover immutable releases, stale edits, validation, unsafe storage paths, and keeping existing releases readable when a publication exceeds the UTF-8 storage limit. |
| P07-02 | The standalone verifier exercised a no-login inventory and two clients sharing a personal profile with separate IDs, metadata, branding, schemas, module pins, and disposable databases. Matching context and independent runtime builds passed. |
| P07-03 | The authenticated inventory passed PostgreSQL 17, browser and HTTP checks for login, logout, bootstrap replay, session expiry and revocation, throttling, origin protection, secure-cookie settings, user and role administration, direct authorization checks, and scoped audit events. |
| P07-04 | Sandboxed Electron reviewed an unsatisfied dependency and applied Authentication and User Management after approval, preserving custom source and the manual supplier migration. Disposable fixtures also verify stale plans, protected integration files, and recovery after interruption during SQL file publication with no duplicate migration. Database apply remains separately authorized. |
| P07-05 | Local Linux x64 passed frozen installation, lint, type checks, the production build, 80 Vitest cases, 11 renderer cases, and seven sandboxed Electron cases. The optional public Git HTTPS smoke runs in Windows CI. All six generated application variants passed independent verification with PostgreSQL. The Studio and generated production dependency audits found no known vulnerabilities. The delivery pull request records platform CI and the screenshot artifact. |

Business Workspace v1 supports a text mark, primary color, and theme. Personal profiles publish advisory guidance, with the built-in generator enforcing the versioned stack and integration contract. Executable imports, arbitrary upgrades or removals, additional stacks, and a visual editor remain unavailable.

## Phase 08 · Multi-stack support and SDK validation

Phase 08 starts at `9e8bb22` on the isolated `work` branch. The second parent matches the head of merged PR #10. The Go adapter is a built-in SDK implementation. No extra runtime loader or third stack is enabled.

| Gate | Verification |
| --- | --- |
| P08-01 | Studio plans the exact Go stack deterministically and rejects a Node architecture or an identity module on Go. Existing Node, portable manifest and legacy journal regression cases remain in the suite. |
| P08-02 | Disposable PostgreSQL 17 fixtures verify generated Go health and readiness, checksum mismatch and transactional rollback, frozen pnpm install, Go hash verification, formatting, vet, tests and production build. Vite proxies to the service in development and the production binary serves the compiled frontend assets. |
| P08-03 | Inventory verification sends real HTTP and browser CRUD requests, checks unique/check/foreign-key behavior and nulls, validates UUID and smallint, and tests pagination and filtering. Reviewed incremental supplier CRUD preserves manual SQL and custom service code without repeat writes. |
| P08-04 | Built Electron selects the correct architecture for Go, shows incompatible modules and opens the approved workspace in Database Studio and Generation Review. Verifier compares two independent projects using the same portable engineering profile and stack-specific AGENTS.md and runtime files. |
| P08-05 | Local Linux passed frozen installation, lint, typecheck, production build, 81 Vitest checks and 11 renderer checks. The pull request records the platform jobs, screenshots and dependency audit evidence for the delivered head. |

The Go vulnerability check uses upstream advisory data. The initial scan reported reachable transitive dependency advisories. The resulting lock pins golang.org/x/net v0.63.0 and quic-go v0.59.1. The Linux workflow scans generated source with govulncheck v1.10.0 and the upstream advisory snapshot recorded in the workflow. See the [stack matrix](STACK_PLUGIN_SDK.md#built-in-sdk-v1) for boundaries and exact versions.

The initial Windows run exceeded Vitest’s default five-second budget in the existing Git initialization and staging fixture. Its test budget now matches the other multistep Git integration cases. The Git execution limits and assertions are unchanged.

## Phase 09 · Advanced Git and worktree isolation

Phase 09 starts on the isolated work branch at 5daa4c9, including merged PR #11 and the Phase 08 stack adapters.

| Gate | Evidence |
| --- | --- |
| P09-01 | Native Git fixtures exercise two linked feature checkouts, separate root grants, shared metadata identities, locks, missing worktrees, path aliases, reciprocal markers and clean removal. Sandbox Electron creates and opens a worktree in a separate tab. |
| P09-02 | Real staged, unstaged and untracked files are reviewed before a branch switch. Tests exercise exact stash entries, credential-path guards, restored staged state, and retention after a conflicted pop. |
| P09-03 | Native commands verify fast-forward and divergent merges, one-commit cherry-pick, linear unpublished rebase, published-range rejection, guarded branch changes and a selected-file replacement. |
| P09-04 | Conflict tests verify available index stages, abort and staged resolution, recovery after a new Git service instance, stale confirmation and overlapping writes. |
| P09-05 | Node and Go incremental plans are exercised in linked checkouts of the same portable project. Tests cover distinct source and lock files, wrong grants, and branch drift during confirmation. A separate PostgreSQL fixture verifies checkout changes source schema without applying SQL or changing the ledger. |
| P09-06 | Local end-to-end verification covers all eight generated Node and Go reference cases using PostgreSQL. The delivery pull request records Linux and Windows x64 CI, renderer and Electron results, dependency scan evidence, and screenshots. |

The Phase 09 trust boundaries and independent development database setup are documented in [Git safety](GIT_SAFETY.md) and the [parallel development guide](PARALLEL_DEVELOPMENT.md).

The first Windows native merge smoke clicked Review while its explicit Git refresh was still reading the linked commit. The fixture now waits for the source selector to show the actual new commit ID. Production stale-review checks and test assertions remain in force.

The subsequent Windows run exposed scheduling timeouts in two existing native filesystem and Git fixtures that use Vitest’s five-second default. Windows CI now runs those suites with two workers and a 15-second default fixture budget. The same cases, assertions and production Git process limits remain active.

## Phase 10 · Editor integrations and design extensions

- Base `837e0b7` includes PR #12 and the Phase 00–09 history. Work remains on the isolated task branch.
- P10-01: Native Git fixture verifies separate repository and worktree identity, Unicode and spaced paths, scoped reveal, grant closure, and exact VS Code arguments using a Linux fixture executable. An installed VS Code instance and native terminal launch still need interactive Windows desktop verification.
- P10-02: The real Node.js and Go inventory applications passed reviewed build, test, backend and Vite startup, health and readiness, PostgreSQL-backed requests, and process shutdown locally. Integration coverage includes occupied ports, stale approvals, cross-worktree access, byte limits, log redaction and link/junction rejection.
- P10-03: Sandboxed Electron verified a saved built-in API design, native OpenAPI export, handoff to a live HTTP request, and a structured response. The service fixture exercised invalid Host, redirect and oversized response handling.
- P10-04: Sandboxed Electron verified reviewed page application and exact preservation of a customized Vite configuration. Standalone verification built and rendered `/studio-page.html` against PostgreSQL inventory rows using the Business Workspace template.
- P10-05: Sandboxed Electron saved a requirement linked to a schema table, built-in API, page and workspace source, followed the table and requirement links, saved a workflow, and detected an externally modified source.
- P10-06: Linux local frozen install, lint, typecheck, production build and browser renderer suite passed. The Windows workflow runs native Electron and the disposable PostgreSQL fixtures before uploading screenshots. Review the final pull request checks for the candidate commit.

The Linux cloud regression passed 94 Vitest checks, 11 Chromium renderer checks, and 10 sandboxed Electron cases. All eight standalone Node.js and Go configurations passed PostgreSQL and Chromium verification. pnpm and Go advisory checks passed. The opt-in Linux public HTTPS clone test reached a direct DNS restriction for `github.com`; studio intentionally disables ambient Git configuration and proxies for that transport. The Windows CI workflow exercises public HTTPS separately.

The first complete Windows run reached the generated inventory application's Vite production build and exposed an NTFS short-path alias mismatch for the additional HTML input. The generator now derives the Vite root and all inputs from the same native canonical path. Vite readiness markers also ignore console color sequences. The subsequent platform runs retain the same real PostgreSQL, browser and Electron checks.

## Phase 11 · Engineering standards, collaboration and release

The isolated task branch is based on `5492acd`. PR #13 and its verified Phase 10 implementation are included.

- P11-01 and P11-02 use existing generator, Git and runtime inspection. The native Electron reference exercises inspected locks, a real failed test, a passing rerun, and stale evidence after a source edit.
- P11-03 uses two disposable linked Git worktrees and separate library profiles. Verified exact profile and template sharing, immutable version retention, idempotent import, differentiated client branding, and rejection of corrupted bundle bytes. The generated CI checks use those imported definitions in the starter regression workflow.
- P11-04 exercises create-only CI and Docker configuration generation with the existing journal. The standalone script supports optional Docker verification with a disposable Compose database.
- P11-05 verified that the Node.js archive extracts, installs frozen production dependencies, and runs health and readiness against disposable PostgreSQL without Studio. The release test also verifies SHA-256, stale source rejection, missing output, and recreation of the exact archive. The Go reference also extracted and ran an independently verified native executable with the compiled frontend and PostgreSQL.
- P11-06 records artifact and quality evidence locally. Check the Phase 11 pull request for final Linux and Windows x64 workflow evidence.

Local Linux frozen install, lint, typecheck and production build passed. The regression included 94 Vitest and 11 renderer cases. The Phase 11 sandboxed Electron case passed in both themes with failed, passed and stale quality evidence. The direct registry audit from the controlled desktop process encountered the cloud's DNS restriction. Generated CI commands also exercised the advisory check through the normal package manager environment.

The cloud Docker daemon pulled the pinned Node.js, Go and PostgreSQL images. Direct registry probes from its build network failed DNS resolution, and the proxied package fetch reported an untrusted certificate chain. The Linux workflow includes Docker build and Compose verification for both reference apps, using its disposable service database and isolated Docker projects.

## Phase 12 · Windows distribution

Phase 12 starts from `main` at `562a5c2`, the merged Phase 11 PR #14. The candidate targets Windows x64 with the per-user NSIS installer. The upgrade fixture uses the same source as the candidate with an earlier prerelease version. The workflow tests the executable from the real installation and verifies the artifact digest, provenance and unsigned status before upload. See [Windows distribution](WINDOWS_DISTRIBUTION.md) for profile paths, uninstall behavior and interactive gates.

Local Linux x64 passed frozen installation, lint, type checking, build, 94 Vitest cases with the disposable PostgreSQL fixture, and 11 renderer cases. Initial Windows CI built both installers and verified the candidate's unsigned status. Lifecycle verification exposed Electron Builder's versioned uninstall display name. The installer now uses the stable product name and checks executable publisher metadata. Installed Node.js and Go reference workflows retain disposable output for fingerprint comparison and standalone PostgreSQL, HTTP, browser and build verification.

The sandboxed Linux ASAR regression passed 11 native cases. It exercised the packaged renderer and preload, both generators, project and Git worktrees, Database Studio, incremental review, Developer Tools, and Client Delivery. The unconfigured optional public HTTPS check and the Windows-only installer test were skipped in that run.

Windows Server 2025 x64 completed the installer lifecycle for the Phase 12 workflow, including current-user registration, the Start Menu target, launch from ASAR with the renderer sandboxed, upgrade from the compatible fixture, in-place reinstall, uninstall, and reinstall with the existing profile. The pull request records the final source revision, artifact digest, screenshots and CI results. Interactive Windows desktop and signing checks are listed in the distribution guide.
