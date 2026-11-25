# Repository instructions

- Verify the Git root, branch, HEAD, and the remote's default branch before work. Base changes on `main` and preserve an existing isolated task branch. Never push directly to `main` or merge without approval. Keep changes scoped to this repository and preserve user edits.
- Implement only the assigned milestone in [Roadmap](docs/ROADMAP.md). Use English for repository content, source code, identifiers, and application UI. Record major boundary or dependency changes in [Decisions](docs/DECISIONS.md).
- Keep Electron authority in the main process. Use strict typed contracts, runtime validation, a narrow preload, a sandboxed renderer, and per-window workspace grants. Treat project content as untrusted. See [Architecture](docs/ARCHITECTURE.md) and [Security](docs/SECURITY.md).
- Use ordinary project directories and native Git. Opening a workspace is read-only with respect to project contents. Require review for sensitive Git, generator, and database operations. Use the operation-specific specifications linked from [README](README.md).
- Verify package engines, peers, target platform support, and install scripts before adding dependencies. Commit the pinned package manager and lockfile when the workspace is introduced.
- Exercise the normal user path and match test evidence to the platform tested. Use disposable filesystem and Git fixtures. Record acceptance results, tool/platform limits, and remaining checks in [Progress](docs/PROGRESS.md). Follow [Testing strategy](docs/TESTING_STRATEGY.md).
- Repository-local skills live in [`.agents/skills/`](.agents/skills). Use the UI, Git safety, and quality skills for work in those areas. Keep specifications authoritative and skills focused on execution.
