# Software Factory Studio

Software Factory Studio is a planned local-first, Git-native desktop engineering environment for creating and maintaining independent applications. Projects are ordinary directories and Git repositories. Developers keep the generated source and build it with standard toolchains. Core Studio workflows are designed to work without AI, a paid API, or a Studio backend.

## Repository status

Phase 01 delivers the Electron desktop foundation with Home, Settings, a command palette, resizable navigation, and local appearance preferences. Planned project and library views are identified in the workspace. Windows x64 is the first desktop target. See [Progress](docs/PROGRESS.md) for platform-specific evidence and remaining gates.

## Development setup

Use Node.js **22.16.0** and pnpm **10.13.1**. The application has no service or credential setup. Install the binary explicitly before running the desktop app. These commands work from PowerShell after installing the pinned Windows x64 Node release.

```powershell
node --version
npm install --global pnpm@10.13.1
pnpm --version
pnpm install --frozen-lockfile
pnpm --filter @factory/desktop exec install-electron
pnpm dev
```

`pnpm dev` starts Vite on the fixed Electron development origin and launches the native application from source. Renderer edits use HMR. A successful main or preload rebuild restarts the native process. The terminal reports bundle errors, native startup failures, and process exit. Close the app or interrupt the terminal to stop the session.

Use `pnpm dev:web` for a separate Vite renderer preview at `http://127.0.0.1:4482/`. The command opens the default browser. Theme and sidebar changes in this mode last for the session. The status bar reports that desktop preferences are unavailable.

## Quality commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Electron development at the fixed loopback development origin |
| `pnpm dev:web` | Browser development and visual inspection |
| `pnpm lint` | ESLint including Electron process import restrictions |
| `pnpm typecheck` | Strict TypeScript checks for contracts, main, preload, renderer, and test/build tooling |
| `pnpm test` | Vitest contract, policy, and disposable-filesystem integration tests |
| `pnpm build` | Production renderer, main, and preload bundles under `apps/desktop/dist/` |
| `pnpm start` | Run the built desktop app through its production renderer origin |
| `pnpm test:renderer` | Playwright tests against the built renderer with a test-only bridge and the browser development mode |
| `pnpm test:electron` | Playwright smoke test of the built app with sandboxing and a disposable profile |

For both end-to-end suites and a manual production smoke test on Windows x64:

```powershell
pnpm --filter @factory/desktop exec playwright install chromium
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:renderer
pnpm test:electron
pnpm start
```

Close other Studio instances before the manual smoke test. In the built app, switch among System, Dark, and Light in Settings. With System selected, change the Windows appearance setting and confirm Studio follows it. Check both 1280×800 and 1024×768 workbench sizes, keyboard and pointer resize, `Ctrl+K`, Escape focus restoration, and the 200% zoom layout. Restart and verify the saved theme and expanded sidebar width. Record Windows version, architecture, display scaling, and results in [Progress](docs/PROGRESS.md). Installer creation is scheduled for Phase 12.

## Working on this repository

Read [AGENTS.md](AGENTS.md) for repository instructions. Verify the checkout and base before editing, keep work on the isolated task branch when provided, and target `main` through the repository's review workflow. Merge only with approval. See [Roadmap](docs/ROADMAP.md) for milestone scope and Phase 01 acceptance criteria.

| Topic | Specification |
| --- | --- |
| Product and navigation | [Product specification](docs/PRODUCT_SPECIFICATION.md) |
| Runtime, packages, and data | [Architecture](docs/ARCHITECTURE.md) |
| Desktop interaction and visual tokens | [UI design system](docs/UI_DESIGN_SYSTEM.md) |
| Generation and recovery | [Generator specification](docs/GENERATOR_SPECIFICATION.md) |
| Git operations and worktrees | [Git safety](docs/GIT_SAFETY.md) |
| Source schema, migrations, and database state | [Database engine](docs/DATABASE_ENGINE.md) |
| Built-in adapters and trust model | [Stack plugin SDK](docs/STACK_PLUGIN_SDK.md) |
| Threat model and runtime controls | [Security](docs/SECURITY.md) |
| Test layers and platform evidence | [Testing strategy](docs/TESTING_STRATEGY.md) |
| Scope, dependencies, and acceptance criteria | [Roadmap](docs/ROADMAP.md) |
| Verification record for each phase | [Progress](docs/PROGRESS.md) |
| Technical decisions and trade-offs | [Decisions](docs/DECISIONS.md) |
