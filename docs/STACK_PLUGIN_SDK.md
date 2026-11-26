# Stack plugin SDK

## Delivery and trust

Phase 04 implements a built-in Node adapter inside the generator boundary. Phase 08 adds the Go/Gin adapter, exercises shared contracts on both layouts, and versions the SDK. In-process executable adapters ship as reviewed Studio code. External catalog entries, team assets, and imported templates are untrusted data. Defer externally executable plugins until there is an independently reviewed capability, isolation, installation, and update model. ZIP or directory import, when implemented, validates entries and bounds file count, nesting, and expanded bytes before exposing content to the planner. Rejected imports leave the installed library unchanged.

## Manifest contract

A stack manifest declares a stable namespaced ID, semantic version, compatible SDK range, supported app categories, architecture profiles, languages and runtimes with tested versions, optional databases, capabilities, supported OS and toolchain conditions, and template digests. Capabilities distinguish inspect, scaffold, parse schema, plan incremental changes, and verify. Each template and module declares a version, content digest, compatible stacks, any dependencies and conflicts, and the file ownership it expects. The project locks resolved versions and digests. Upgrades use an explicit generation review.

| Adapter capability | Contract |
| --- | --- |
| Detect | Consume a bounded snapshot of candidate files and produce a confidence level, fingerprints, and human-readable reasons. Ambiguous detection yields inspection or explicit user selection. |
| Validate | Check normalized configuration and capability constraints and return structured diagnostics. |
| Scaffold | Return deterministic relative-path file operations plus ownership and verification requirements. |
| Interpret schema | Resolve the stack's authoritative migration locations and dialect. Return parsed structures, provenance, and coverage diagnostics. |
| Plan incremental | Given the current snapshot, manifest, and requested change, return planned edits or conflicts. |
| Verify | Declare expected outputs and approved toolchain checks. The host authorizes and runs any external commands. |

Adapter interfaces consume typed values and bounded source content. They cannot require arbitrary system paths, renderer imports, or direct main-process authority. Use declarative restricted rendering helpers, with controlled access to input values. Block path escapes, link entries, duplicate output names, reserved filenames, and case collisions. Untrusted template data cannot register arbitrary helpers, spawn processes, or access credentials.

## Reference stack structure

The first stack uses an Express/TypeScript backend and an independent React/Vite frontend. It always supplies PostgreSQL readiness and migration tooling. An optional example composes versioned routes, UI, migration, tests and documentation without adding dependencies. The catalog and contribution model are internal until Phase 08. The second uses a Go module, a `cmd/` entry point, idiomatic `internal/` packages for HTTP and persistence, and a React/Vite frontend. Migrations, Go toolchain commands, and build conventions follow that Go adapter. Shared interfaces describe capabilities and ownership rather than requiring identical directory structures.

## Enablement gate

Test toolchain detection, incompatible OS or versions, deterministic generation, invalid and malicious input data, protected-file behavior, and user-facing diagnostics. Build and test the actual generated applications, exercise HTTP and persistence with disposable PostgreSQL, and publish the tested combination before enabling it in the wizard. Verify standalone operation using only the generated project's documented toolchain and configuration. Studio and portable metadata must not be runtime dependencies of the generated application. Each published adapter records migration authority and verification commands. Deprecation, rollback, and upgrade paths belong in the stack version documentation.

## PostgreSQL contract exercised in Phase 05

The built-in Node adapter consumes the version 1 model from the Schema package. It advertises its canonical SQL dialect subset, fixed migration directory and ledger convention. It validates backend and frontend table eligibility before emitting a new-project plan. Phase 05 does not yet require other adapters to share the Node runtime layout or migrations.


Phase 06 exercises the incremental planning boundary using the built-in Node adapter. The planner needs the pinned manifest, checked-out source schema and prior feature selections. It returns exact before/after artifacts and conflict reasons. Filesystem approval, staged publication and recovery stay in the desktop service. Third-party executable adapters remain outside the current release.


## Authoring a built-in module

Add the exact release and compatibility requirements to the catalog. Define dependencies and conflicts explicitly. Bundle reviewed source, SQL, tests and docs in the trusted adapter. Keep environment values out of template inputs and specify each runtime setting in the catalog. Register the narrow integration through the adapter's existing contribution slots. Reserve file ownership and PostgreSQL names. Verify fresh generation, unsupported selections, unchanged-module replay and applicable incremental installation with disposable projects before enabling the release. Publish a new version for changed executable artifacts. External executable packages and arbitrary imported template code are unsupported.

## Built-in SDK v1

The executable registration is `stackAdapters` in `packages/generator/src/index.ts`. `STACKS` and `stackDefinition` in the contracts package provide renderer-safe discovery. The `BuiltInStackAdapter` interface joins static capability metadata and deterministic planning. Only reviewed entries compiled into the application can register. Workspace metadata selects a registered ID and exact architecture and never supplies code, commands, template paths, or module paths. The generator retains Node v1 journal replay and the existing Node v2 lock shape. Go locks record SDK 1 and exact template fingerprints. The host owns workspace admission, Git state, changes, and transactions.

| Capability | Node stack v2.0.0 | Go stack v1.0.0 |
| --- | --- | --- |
| ID and architecture | `node-express-react-postgres`, Layered Web v1 | `go-gin-react-postgres`, Go Service v1 |
| Backend runtime | Node.js 22.16.0, TypeScript 6.0.3, Express 5.2.1, pg 8.22.0 | Go 1.26.11, Gin 1.12.0, pgx 5.13.0 via pgxpool |
| Frontend | React 19.3.1, TypeScript 6.0.3, Vite 8.3.8, pnpm 10.13.1 | Same frontend and toolchain. The binary serves the compiled browser assets without a Node.js runtime. |
| Project type and database | Full-stack, PostgreSQL 17 reference | Full-stack, PostgreSQL 17 reference |
| Profiles and UI templates | Standard Engineering v1, personal advisory profiles, Foundation and Business Workspace v1 | Same reusable profiles and UI catalog. The generated baseline and AI context describe Go Service. |
| Optional executable modules | Welcome, Authentication, User Management, RBAC and Audit Logging v1.0.0 | Unavailable. Compilation does not register Node modules. |
| Generated record layers | Schema migration, API, optional React UI, incremental CRUD | Same. Uses Go descriptors, handlers, validation and parameterized repositories. |
| Manifest and verification | package.json and pnpm-lock.yaml. pnpm lint, typecheck, test and build. | go.mod and go.sum plus the frontend package and lockfile. go mod verify, gofmt, go vet, go test, go build and frontend checks. |

Both adapters use the versioned PostgreSQL v1 model, ordered `db/migrations/NNNN_*.sql` and the `schema_migrations` name/checksum ledger. CRUD supports a single compatible primary key and scalar columns of smallint, integer, text, boolean, UUID and date. Go validates these using int16, int32, string, bool, canonical UUID text and an ISO date string. Nullable input is explicitly bound as SQL NULL. SQL quoting comes from trusted descriptors, and user values are parameters. The schema engine handles broader schema-only types and supported constraints. Composite keys and unsupported CRUD types can remain schema-only.

## Add or revise an adapter

1. Add a reviewed capability entry in `packages/contracts/src/stacks.ts`, including a new stable stack ID, exact architecture, toolchain, manifests and verification. Expand validated choices only for implemented combinations.
2. Implement a deterministic planner in `packages/generator`. Reuse the shared schema selection, PostgreSQL migration composer, compatible UI and advisory profile rendering. Keep language-specific backend structure and dependency graphs in its adapter. Keep Stack, module, and template contributions pinned. Review renderer metadata with its actual contract.
3. Register the planner as a built-in adapter and use common path, byte, digest, ownership and manifest finalization. Describe the project’s exact commands, integration points, requirements and AI instructions. Lock dependencies and template bytes.
4. Declare incremental integration paths before permitting them. Bind a reviewed plan to the selected stack, version lock, source checksums, workspace, Git state and file ownership. Reconstruct expected baseline bytes and block customized required integrations. Preserve nonparticipating files. Keep migrations, filesystem recovery and runtime tests separate.
5. Verify replay, CLI commands, bad paths and cross-stack requests against disposable projects. Build real applications and exercise PostgreSQL, HTTP, and browser flows on Linux and Windows before release.

Stack conversion, external executable loading, cross-stack identity module installation, and runtime upgrades are outside this SDK. Sharing the advisory profile or Business Workspace definition creates independent version-pinned snapshots in both project types.
