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

| Scope | Current destinations |
| --- | --- |
| Global workspace | Home, Projects, Recent Projects, New Project, Open Folder, Clone Repository |
| Global library | Technology Catalog, Architecture Library, Template Studio, Module Library, AI Context, Engineering Standards |
| Global preferences | Settings |
| Active project | Overview, Project Structure, Git Studio, Database Studio, Generation Review |
| Developer Tools | Runtime, API Designer, API Playground, Page Designer, Requirements |
| Client Delivery | Project Inspector, Quality Center, Shared Library, Deployment, Release Center, Project History |

Some project views require a managed stack or a usable worktree. The selected worktree determines Git and generation scope. Source editing opens in a configured external editor. Component Library, Plugin Manager and Team Workspace are planned. The implemented page publisher supports a single optional Business Workspace page on an unauthenticated Node project. Follow the [audit matrix](FINAL_PRODUCT_AUDIT.md#capability-matrix) for observed capabilities and limitations.

## Project lifecycle

| User action | Product behavior |
| --- | --- |
| Open Folder | Use the native chooser, admit the selected directory to the session, and read a bounded snapshot. Opening an unsupported project still enables bounded filesystem inspection. |
| New Project | Select one of the enabled full-stack adapters. Choose a parent through the native dialog. Studio verifies a vacant new child directory. Preview and approve the resolved destination and deterministic plan. |
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

| Capability | Implemented scope |
| --- | --- |
| Full Stack with Node.js, TypeScript, Express, React, Vite, and PostgreSQL | Built-in Layered Web starter and verified incremental workflows |
| Full Stack with Go, Gin, React, Vite, and PostgreSQL | Built-in Go Service starter and verified incremental workflows |
| Generation for other combinations | Unsupported until implementation and verification |

The long-term category model covers Full Stack, Backend API, Web Frontend, Desktop, Mobile, Background Worker, CLI, and Static Website. The catalog can eventually describe Node.js, Go, Python, PHP, Java, C#, Rust, React, Next.js, Vue, Angular, Svelte, Electron, Tauri, Flutter, React Native, PostgreSQL, MySQL, MariaDB, SQLite, MongoDB, SQL Server, and Oracle. A catalog entry describes a possibility. Enable a wizard choice only when its complete versioned combination passes the applicable release gate.

Use explicit availability when describing a capability. **Planned** means scheduled. **Unsupported** means the combination is outside the current supported set. **Partial** means a defined subset works and the UI identifies its limits. **Unverified** means an implementation exists without evidence for the stated platform or scope. **Verified** refers only to the specific supported combination and environment recorded in [Progress](PROGRESS.md).

## Libraries and collaboration

Architecture, UI, module, component, and deployment templates are distinct versioned library assets. The resolution order is explicit per project and pinned in portable locks. Business Workspace supports versioned text branding, a primary color and theme choice. Project forms and tables derive from supported schema and ordinary client code. Broader visual editing remains outside current scope. Imported assets remain untrusted. The [SDK](STACK_PLUGIN_SDK.md) defines compatibility and activation.

The module roadmap starts with authentication, user management, RBAC, audit logging, Excel and CSV, file management, notifications, reporting, scheduler, payment adapters, and deployment configuration. Modules declare compatible stacks, dependencies, versions, migration ownership, and reviewable file changes. Installation after project creation uses the same planner and recovery path as other incremental changes. Team libraries, standards, and policy can live in Git and be checked in CI, with access enforced by the host and Git provider.

## Verified database-driven path

Phase 05 connects the managed PostgreSQL workbench to optional schema and CRUD selection in a new Node starter. Database Studio inspects and edits supported declared schema, previews additive migrations, and separately reviews local development apply. CRUD selection is independent per table and layer within the supported configuration. Phase 06 extends the same engineering practices to projects with existing application code.


## Phase 07 MVP scope

The Engineering Library provides personal and built-in declarative definitions, portable JSON exchange, pinned profile context, and branded Business Workspace templates. Trusted identity modules include Authentication, User Management, RBAC and Audit Logging. Teams can share reviewed JSON through Git. Additional component and deployment libraries, third-party packages, role hierarchies, and visual layout editing remain planned.
