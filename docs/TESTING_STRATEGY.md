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
