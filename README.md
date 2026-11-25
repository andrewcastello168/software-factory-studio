# Software Factory Studio

Software Factory Studio is a planned local-first, Git-native desktop engineering environment for creating and maintaining independent applications. Projects are ordinary directories and Git repositories. Developers keep the generated source and build it with standard toolchains. Core Studio workflows are designed to work without AI, a paid API, or a Studio backend.

## Repository status

Phase 00 establishes the product and engineering specifications. This checkout contains documentation and repository-local Codex skills. Application setup, launch, and test commands begin in Phase 01. Windows is the first desktop target. The recorded Cloud inspection used Linux. See [Progress](docs/PROGRESS.md) for actual verification and remaining gates.

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
