# Software Factory Studio

Software Factory Studio is a local-first, Git-native, AI-ready desktop engineering platform. It helps developers maintain ordinary local repositories and will generate independent applications from reusable engineering assets. Studio complements VS Code, Codex, and other coding assistants. Its core workflows require no AI subscription, paid API, or Studio backend.

## Repository status

The desktop provides local project workspaces, Git Studio, and one independently runnable full-stack generator. The primary factory MVP is Phase 07, after independent application generation, database-driven changes, and incremental code protection. Windows x64 is the first desktop target. See [Progress](docs/PROGRESS.md) for platform-specific evidence.

## Open a local project

Use **Open Folder** in the desktop app to select a local directory. The project opens in its own tab. **Project Overview** shows the working directory and any portable descriptor. **Project Structure** lists files and expandable folders, with symbolic links and junctions shown as skipped. Studio reconciles external changes automatically. Use **Rescan** to refresh on demand.

**Recent Projects** stores folder references in Studio application data. Use **Locate** when a folder has moved, or remove its recent entry. If Studio cannot match the selected directory to the saved project, the native dialog asks which folder to use. An existing `.factory/project.json` with `version: 1` and a UUID `id` supplies portable identity. The optional `name`, `type`, `stackId`, and `profileId` fields provide display metadata. Studio reads this descriptor directly and leaves the project contents intact.

## Use Git Studio

Install native Git 2.39 or newer in a system location. On Windows use the standard Git for Windows installation under Program Files. Open a standalone repository root, then select **Git Studio** in the project sidebar or click the Git context in the top bar. The panel shows local and remote branches, HEAD, upstream divergence and real working or staged patches. Select a file to inspect a hunk and use its adjacent Stage or Unstage control. Set repository-local `user.name` and `user.email` using `git config --local` before committing. This phase isolates global and system config to keep imported repositories from activating host tools.

Use **Clone Repository** on Home or from the command palette. Select a public HTTPS URL or a local bare Git repository and choose the native destination parent. Studio creates a new child folder after confirmation. Fetch, fast-forward pull and ordinary push use existing upstream and remote configuration. Local transfer requires separate selection of the bare remote. Private authentication, SSH, tracked submodules, and linked worktrees are outside the supported Phase 03 Git boundary. Use the existing Git client for unsupported configurations. See [Git safety](docs/GIT_SAFETY.md).

## Generate a standalone project

Open **New Project** from Home or the command palette. Enter a project name and API port and choose a parent folder outside an existing Git working tree. The wizard creates a new child and offers the full-stack Node.js, TypeScript, Express, React, Vite and PostgreSQL combination with Layered Web v1 and Standard Engineering v1. Review the exact files, confirm in the native dialog, and open the verified managed project.

The output includes independent backend and frontend source, a PostgreSQL migration, a frozen dependency graph, portable fingerprints, and project-specific instructions for people and coding assistants. Use **Generation Recovery** in the command palette to reauthorize and resume an interrupted operation. The [generator specification](docs/GENERATOR_SPECIFICATION.md) describes destination, file integrity, and recovery limits.

Use the generated README to configure a disposable local PostgreSQL database and run the app with Node.js 22.16.0 and pnpm 10.13.1. From the project root:

~~~sh
pnpm install --frozen-lockfile
cp .env.example .env
# Set DATABASE_URL in .env to the reviewed local database.
pnpm db:migrate
pnpm dev:api
~~~

In a second terminal run pnpm dev:web. For production run pnpm build and pnpm start from the generated root. On PowerShell use Copy-Item .env.example .env. Neither project runtime nor development commands depend on Studio.

## Development setup

Use Node.js **22.16.0** and pnpm **10.13.1**. The application has no service or credential setup. Install Git for the project workflows and integration tests. Install the binary explicitly before running the desktop app. These commands work from PowerShell after installing the pinned Windows x64 Node release.

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
| `pnpm test` | Vitest contract, policy, filesystem, and disposable Git integration tests |
| `pnpm build` | Production renderer, main, and preload bundles under `apps/desktop/dist/` |
| `pnpm start` | Run the built desktop app through its production renderer origin |
| `pnpm test:renderer` | Playwright tests against the built renderer with a test-only bridge and the browser development mode |
| `pnpm test:electron` | Playwright flows through sandboxed Electron with disposable profiles, projects, and Git repositories |
| `pnpm verify:starter` | Generate a disposable app, install the frozen graph, run checks and serve the production build |

The [Windows verification workflow](.github/workflows/windows.yml) runs automatically on pull requests to `main`. It builds the application on Windows x64 and runs the renderer and native Electron suites. To reproduce those checks locally and open the built app on Windows x64:

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

The Windows workflow sets `FACTORY_TEST_PUBLIC_HTTPS=1` for the anonymous GitHub clone smoke. Set the same variable before `pnpm test:electron` when testing on a machine with direct HTTPS access. The disposable local repository suite runs without that network dependency.

Close other Studio instances before the manual smoke test. In the built app, switch among System, Dark, and Light in Settings. With System selected, change the Windows appearance setting and confirm Studio follows it. Check both 1280×800 and 1024×768 workbench sizes, keyboard and pointer resize, `Ctrl+K`, Escape focus restoration, and the 200% zoom layout. Restart and verify the saved theme and expanded sidebar width. Record Windows version, architecture, display scaling, and results in [Progress](docs/PROGRESS.md). Manually check native chooser and confirmation dialogs on a Windows desktop when validating a release. CI supplies controlled chooser results so the tests exercise real Git and filesystem operations without automating the OS dialog. Installer creation is scheduled for Phase 12.

## Working on this repository

Read [AGENTS.md](AGENTS.md) for repository instructions. Verify the checkout and base before editing, keep work on the isolated task branch when provided, and target `main` through the repository's review workflow. Merge only with approval. See [Roadmap](docs/ROADMAP.md) for milestone scope and acceptance criteria.

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
