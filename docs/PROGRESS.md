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
