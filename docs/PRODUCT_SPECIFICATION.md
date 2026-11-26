# Product specification

## Product contract

Software Factory Studio is a local-first, Git-native, AI-ready personal engineering platform. It helps developers build independent applications, design databases and migrations, and turn proven architectures, modules, and engineering practices into reusable assets. It protects custom code during repeated generation and supplies portable project context for people and coding assistants. Teams can share the same assets and standards through Git with permissions enforced by the repository host.

Studio complements VS Code, Codex, and other coding assistants. The primary workflow keeps ordinary repositories, editors, and toolchains in use. Git and project operations provide a reliable foundation for the factory workflow. The core does not require a Studio backend, an AI subscription, or access to a paid API. [Phase 07](ROADMAP.md#product-mvp) is the primary MVP gate.

A project reopened after a move retains its portable identity when its metadata moves with it. A project may have several local worktree tabs. Each tab is bound to its actual working directory. Recipes produce applications with standard source layout, toolchain commands, lockfiles, documentation, and runtime configuration. The generated application runs independently of Studio. VS Code and Codex are optional collaborators using the same directories and Git conventions. Personal local workflows such as inspection, local Git operations, and generation from installed assets remain available offline once their ordinary toolchain dependencies are present. A clone, fetch, push, or dependency download can require connectivity to its configured service.

## AI-ready project context

Phase 04 generates a concise, human-readable `AGENTS.md` and project documentation alongside the first scaffold. Instructions describe the actual stack, toolchain commands, source layout, custom-code ownership, and migration workflow. They work in an ordinary editor or coding agent session without Studio. The generator previews the files and protects existing instructions through the same ownership and collision rules as source code.

Phase 07 adds reusable context profiles for architecture guidance, module conventions, engineering standards, and reviewed task instructions. Profiles can be pinned and shared through Git. Treat imported instructions as untrusted text. Users inspect what gets written or exported. Exclude secrets, runtime environment values, personal paths, and hidden assistant state from portable context. Agent orchestration, automatic prompt execution, and AI service integrations are optional extensions outside the MVP.

## Workspace map

The global scope owns reusable assets, settings, and project entry points. Project scope owns work for the selected directory. Scope, working directory, branch, and working tree status stay visible so a user can tell where an action will run. A scan that cannot establish branch or status displays its actual state.

| Scope | Area | Destinations |
| --- | --- | --- |
| Global | Workspace | Home, Projects, Recent Projects, New Project, Open Folder, Clone Repository |
| Global | Factory Library | Technology Catalog, Architecture Library, Template Studio, Module Library, Component Library, Plugin Manager |
| Global | Organization | Team Workspace, Engineering Standards, Settings |
| Project | Project | Overview, Project Structure, Requirements |
| Project | Application Engineering | Database Studio, Module Manager, API Designer, Page Builder, Appearance, Business Workflows |
| Project | Development | Source Code, Git Studio, Generation Review, Run & Debug, API Playground, Terminal, Logs |
| Project | Quality and Release | Testing, Project Inspector, Environment Manager, Deployment, Release Manager |
| Project | Management | Project History, Recovery Center, Project Settings |

Navigation is driven by capabilities and context. Keep Overview, Project Structure, Git Studio, and generation entry points near primary project navigation. Prefer an external editor handoff for ordinary editing. Group branch tools in Git Studio, file and generation recovery in Recovery Center, and release controls in Release Manager. Retain Page Builder and API Designer as later stack-specific extensions. Full IDE parity and sophisticated visual page authoring have lower priority than templates, modules, and generation safety. Give unknown projects a read-only inspection path and explain why generation is unsupported when the user reaches that context. Show only usable commands in the command palette and sidebar. The roadmap defines when each destination becomes available.

## Project lifecycle

| User action | Product behavior |
| --- | --- |
| Open Folder | Use the native chooser, admit the selected directory to the session, and read a bounded snapshot. Opening an unsupported project still enables inspection when that feature is delivered. |
| New Project | Run the wizard against one enabled stack. Choose an empty directory or a new child under a parent selected through the native dialog. Preview and approve the resolved destination and deterministic plan. |
| Clone Repository | Ask for the remote and destination, confirm the operation, and admit the resulting directory only after clone succeeds. Phase 03 supports public HTTPS and explicitly selected local bare repositories. Review the exact source and a new child folder under a natively selected parent. |
| Reopen Recent | Reopen the actual directory by reference. If it is gone, offer Locate or Remove from Recents. An identity mismatch during Locate requires an explicit choice. |
| Rescan | Reconcile changes from native watchers and manual refresh. Refresh the snapshot on focus or watcher loss. External changes make affected previews stale. |
| Multiple tabs | Each tab is bound to a canonical directory. Two worktrees sharing one portable project ID retain independent tab identity, status, and pending operations. |

Portable state belongs under `.factory/` in managed projects. Local recents are directory references. User preferences, local connection information, secrets, and operation recovery data belong outside the project. Only an explicit initialization or generation operation creates portable metadata. See [Architecture](ARCHITECTURE.md).

## New Project wizard

1. Choose the application type.
2. Enter the project name, identifier, and destination.
3. Select an enabled technology combination.
4. Select the architecture profile.
5. Choose a UI template when the stack has a UI.
6. Choose optional modules when supported.
7. Configure an optional database schema when supported.
8. Review compatibility and resolve blocking diagnostics.
9. Inspect the generation plan, including every file and conflict.
10. Approve generation and review verification for the resulting source.

Skip optional steps only when the current stack has no applicable choices. Keep input when moving backward. Changing an input invalidates the plan and approval. Installation, tests that execute dependency or project code, and database connection are distinct operations with explicit authorization.

## Technology delivery

| Capability | Delivery status at Phase 00 |
| --- | --- |
| Full Stack with Node.js, TypeScript, Express, React, Vite, and PostgreSQL | First planned and gated vertical slice in Phase 04 |
| Full Stack with Go, Gin, React, Vite, and PostgreSQL | Second planned and gated vertical slice in Phase 08 |
| Generation for other combinations | Unsupported until implementation and verification |

The long-term category model covers Full Stack, Backend API, Web Frontend, Desktop, Mobile, Background Worker, CLI, and Static Website. The catalog can eventually describe Node.js, Go, Python, PHP, Java, C#, Rust, React, Next.js, Vue, Angular, Svelte, Electron, Tauri, Flutter, React Native, PostgreSQL, MySQL, MariaDB, SQLite, MongoDB, SQL Server, and Oracle. A catalog entry describes a possibility. Enable a wizard choice only when its complete versioned combination passes the applicable release gate.

Use explicit availability when describing a capability. **Planned** means scheduled. **Unsupported** means the combination is outside the current supported set. **Partial** means a defined subset works and the UI identifies its limits. **Unverified** means an implementation exists without evidence for the stated platform or scope. **Verified** refers only to the specific supported combination and environment recorded in [Progress](PROGRESS.md).

## Libraries and collaboration

Architecture, UI, module, component, and deployment templates are distinct versioned library assets. The resolution order is explicit per project and pinned in portable locks. Users can customize branding, logos, typography, colors, themes, layout, navigation, login screens, forms, tables, and components and save reusable versions in personal or team libraries. Imported assets remain untrusted. The [SDK](STACK_PLUGIN_SDK.md) defines compatibility and activation.

The module roadmap starts with authentication, user management, RBAC, audit logging, Excel and CSV, file management, notifications, reporting, scheduler, payment adapters, and deployment configuration. Modules declare compatible stacks, dependencies, versions, migration ownership, and reviewable file changes. Installation after project creation uses the same planner and recovery path as other incremental changes. Team libraries, standards, and policy can live in Git and be checked in CI, with access enforced by the host and Git provider.
