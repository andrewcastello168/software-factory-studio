# Testing strategy

## Verification layers

| Layer | Evidence | Environment |
| --- | --- | --- |
| Repository documentation | Required files, references, skill metadata, consistent milestone dependencies and phase claims, whitespace and Git state. | Phase 00 on the selected Cloud checkout. |
| Unit | Vitest tests of contracts, preference validation, view behavior, parsers, and pure planning as introduced. | Supported host Node. |
| Integration | Real disposable directories and temporary Git repositories, using local bare remotes. PostgreSQL integration uses a dedicated disposable instance and credentials once introduced. | Linux and Windows fixtures where relevant. |
| Renderer UI | Playwright exercises keyboard controls, focus, navigation, layout, and theme using a test-scoped typed bridge fixture. This proves renderer behavior. | Supported sandboxed browser or configured CI runner. |
| Electron runtime | Playwright Electron where compatible or a documented smoke harness against built main, preload, and renderer. Cover launch, fixed navigation policy, denied calls, actual preference persistence and clean exit. | Supported Linux runner with sandbox and display, or Windows. |
| Windows native | Test native window behavior and persistence, dialogs when introduced, Git for Windows, junctions, CRLF, case collisions, long paths, Unicode, locked files, watcher overflow, and DPI as those features ship. | Windows CI or a recorded local Windows run with version and architecture. |
| Windows installer | Test install, upgrade, uninstall, process launch, retained user data, signing, and healthy cleanup. | Phase 12 Windows machine or VM using actual built artifacts. |

Do not work around a Cloud sandbox failure by weakening the product or browser test settings. Move that check to a compatible runner and record the missing result in [Progress](PROGRESS.md). A renderer-only bridge fixture stays in the test harness and is excluded from packaged and development product entry points. Unit and browser passes cannot substitute for verifying the actual Electron bridge. Linux passes cannot establish Windows compatibility.

Phase 01 uses a temporary per-user Electron profile for persistence, corruption, and denied-request fixtures. Verify that the test launch resolves to that profile before changing preferences. Exercise production CSP and packaged asset handling through the built renderer origin, and verify the explicit dev origin in its own run. Keep Windows launch, resize, theme persistence, and DPI results separate from Linux results. The Windows installer remains a Phase 12 gate.

## Dependency admission

Before adding a package, inspect candidate metadata and release documentation for host Node/pnpm engines, peer ranges, ESM/CJS entry points, Electron-hosted Node/Chromium compatibility, native or binary requirements, and Windows x64 plus Cloud Linux x64 support. Check license, release maintenance, and install scripts. Record relevant exact selections and why they fit. Pin the host toolchain and pnpm, commit the lockfile, and verify a frozen install and clean build. Document install script approvals narrowly, including reviewed Electron binary setup. If the preferred combination is incompatible, select a supported combination and record the trade-off. Use this gate for Tailwind/Vite integration and Playwright's Electron and browser support.

Phase 01 needs Electron, React, strict TypeScript, Vite, Tailwind, pnpm, Vitest, Playwright, and applicable lint tooling. Choose a small schema-validation approach for the bridge. SQLite, Monaco, React Flow, Handlebars or equivalent, xterm.js, node-pty, and Electron Builder enter with demonstrated feature use. Reassess native dependency ABI, prebuilds, and Electron packaging when relevant.

## Per-milestone evidence

For each code phase record the commit or reviewed working tree, host and tool versions, commands, fixture assumptions, outcomes, and open checks. Verify standard commands from the repository root with the frozen lockfile. Review the normal UI and IPC path, permission and input checks, errors and recovery, cross-platform behavior, and regressions from previous phases. Add tests for acceptance behaviors and any regression an existing suite would miss. Scope high-risk tests to disposable fixtures. Avoid real user repositories and databases.

Record `passed`, `failed`, `blocked`, or `not applicable` per check and describe the actual limits. Application typecheck, lint, build, and test gates start in Phase 01 when their entry points exist. [Roadmap](ROADMAP.md) defines feature-specific acceptance.

## Git Studio fixtures

Use standard Git for Windows and a system Git on Linux. Generate separate ordinary repositories, project directories and bare remotes in the test process. Integration tests verify stored refs, index state and preserved files through Git and the filesystem. Electron tests drive the built app with native sandboxing and controlled chooser and confirmation outcomes. Renderer tests cover keyboard decisions and theme rendering through a test-only bridge. Keep screenshots and temporary credentials outside the repository. HTTPS transport policy is checked locally. Record any independent public HTTPS smoke with its actual host and platform.

## Generator verification

Run pnpm verify:starter through the pinned package manager. The harness renders foundation-only, Welcome-enabled, and inventory CRUD projects in separate temporary directories. Each uses its included frozen lockfile, runs lint, typecheck and tests, and exercises the Vite development proxy and production build over loopback. Each generated project uses its own temporary schema in the disposable verification database. The foundation should contain only the migration ledger, and the example must also read its seeded table. FACTORY_REQUIRE_DATABASE=1 requires a disposable PostgreSQL connection in FACTORY_TEST_DATABASE_URL for the dedicated factory_check database. FACTORY_STARTER_BROWSER=1 runs a sandboxed Chromium assertion against the generated frontend. Studio workflows use a pinned Linux PostgreSQL service and the Windows runner's PostgreSQL service with a new test database. The native Electron test separately exercises the reviewed workspace flow and captures the Light and Dark previews.

Journal tests use disposable directories and inject an interruption into the journal update. Verify that a restarted service requires the original parent, safely resumes verified output, detects edits and symlink or junction replacements, and leaves protected content intact.

## Phase 05 verification

Use the pinned PostgreSQL 17 fixture database at loopback. Set FACTORY_TEST_DATABASE_URL to the dedicated factory_check endpoint to run the Database Studio integration in Vitest. It uses a unique temporary namespace and verifies read-only inspection, an approved transaction, ledger and source checksums, constraint failure rollback, and edited-history detection. The same inventory SQL drives the standalone verifier, which exercises all record operations, foreign-key actions, checks, invalid input, and pagination. FACTORY_STARTER_BROWSER=1 also verifies the generated React record editor against the production Express server. The Electron suite exercises the actual wizard and Database Studio, using controlled native consent responses to test the workspace paths and capture light and dark screenshots without automating the operating system dialog.
