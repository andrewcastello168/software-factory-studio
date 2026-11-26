# Client delivery guide

## Inspect the client project

Open the generated project or its linked Git worktree and choose **Client Delivery**. Project Inspector correlates the portable descriptor, stack and architecture, engineering profile and template, installed modules, dependency locks, and current Git context. It reports missing or modified owned files, unsupported layouts, changed documentation fingerprints, source migration diagnostics, tool versions, and absent environment keys. Open available source links in the editor. Natural-language engineering guidance is advisory. Stack compatibility, manifest ownership, and pinned inputs are enforced. Use Database Studio to verify a physical database and its migration ledger.

## Share engineering versions through Git

Create personal profile and template versions in the Engineering Library. Open the team's existing Git repository in Studio. In **Shared Library**, select **Read Repository Bundles**, pick the desired exact versions, and choose **Review Export**. Studio publishes a canonical JSON bundle under `factory-library/<sha256>.json` after confirmation. Use Git Studio to review, commit, and share it through your existing Git remote. On another worktree or Studio profile, refresh the bundles and choose **Import Exact Versions**.

The bundle includes immutable definitions and their digests, supported stack and architecture versions, built-in module metadata references and the CI and deployment recipe identifiers. The Studio build supplies executable templates. The bundle transports profile advice including AI context and the supported interface and branding metadata. Compatible team versions become selectable in the project wizard. Existing client projects retain their portable pins and snapshots. Imports reject noncanonical or malformed content, incompatible dependencies, duplicate version keys, and conflicting local releases. Review advice for proprietary client details before publishing. Use ordinary Git permissions and reviews.

## Prepare CI and deployment

Open **Deployment**, review the CI or Docker template, inspect the proposed paths, and choose **Approve and Apply**. Configuration publication uses a reviewed incremental plan. Existing custom files and missing-owned files block publication. The new files are covered by the generation manifest and journal.

- The **GitHub Actions v1** template uses pull-request and manual triggers, read-only repository permissions, disabled persisted checkout credentials, pinned actions and toolchains, frozen dependency install, and a disposable PostgreSQL 17 service. It runs the generated `delivery/verify.sh` and keeps a CI development artifact for seven days. It creates no Git tags or external releases and includes no production deployment job.
- The **Docker v1** template supplies pinned multi-stage images, a source allowlist, a non-root runtime, an image liveness check, and a development Compose example. PostgreSQL stays on the private Compose network. Compose publishes the app to `127.0.0.1:3000`. Follow the generated deployment guide for configuration, readiness, and the separate migration command. Apply migrations only after explicit review of the target and backup.
- Stage with a disposable or isolated database. Production config comes from the operator's secret manager and TLS ingress. Built images use the deployment environment supplied at process start. The generated environment example has empty secret values.

## Verify the worktree

Install the pinned lockfiles with `pnpm install --frozen-lockfile`. In **Quality Center**, review each command and approve it natively. Studio executes the actual tools and displays exit code, status, timing, and current-session logs. Record results against a clean source revision before packaging. A relevant file or configuration change invalidates previous evidence. If a result is blocked, review the tool version, worktree and permissions, then run it again.

| Check | Node.js | Go |
| --- | --- | --- |
| Lint and type check | ESLint and TypeScript | ESLint and TypeScript for the frontend |
| Tests | Native Node test runner over supported `test/**/*.test.ts` paths | `go test -mod=readonly -buildvcs=false ./...` |
| Production build | TypeScript and Vite | Vite and host-specific server and migration executables |
| Dependency audit | Pinned pnpm audit | Pinned pnpm audit for frontend dependencies |
| Native Go checks | Unavailable | Nonmutating gofmt and Go vet. Optional govulncheck uses an installed native executable |
| PostgreSQL | Explicit `TEST_DATABASE_URL` in local .env. Use numeric loopback and a disposable `factory_` database | Standalone CI verification uses the reviewed disposable database and checks readiness after migrations |

Packaging requires current successful lint, type check, tests, and build. Go also requires clean formatting and successful vet. Audits and live PostgreSQL checks are optional prerequisites. A recorded failure of these checks blocks packaging until a successful rerun or a new source revision. The PostgreSQL verification command permits a single optional `search_path` for disposable test schemas. Project processes run with the current account's ordinary permissions after explicit review.

## Package and deliver

1. Commit reviewed source and deployment files. Keep the complete worktree clean.
2. Run the required Quality Center checks in the same worktree.
3. In **Release Center**, set a release version and notes, choose an external destination, and confirm the files, source revision, and archive digest.
4. Copy the archive and its SHA-256 through your approved delivery channel. Verify the digest before extraction. Verify the individual file fingerprints recorded in `release-evidence.json`.
5. Extract into an empty directory. Supply environment configuration and a reviewed PostgreSQL database. Follow `DELIVERY.md`. The Node.js archive contains compiled files and lockfiles and needs Node.js 22.16.0 plus the pinned production-only pnpm install. The Go archive contains executables for the host operating system and architecture alongside compiled frontend assets. Run it from the extracted root.

The release record contains the app version, source revision, required check identities, dependency fingerprints, archive bytes, digest, and local path. Archive output is limited to known runtime files, migrations and safe generated evidence. Quality and artifact digests are rechecked across native approval. Byte-identical archive assembly does not establish reproducibility of independently built binaries.

**Project History** shows source migrations, incremental generation (including modules and deployment), quality evidence and artifact status for the active worktree. For an interrupted archive, retry the same release using the same version, source, notes, and external directory. An occupied or different archive is preserved. Filesystem recovery, Git recovery, database recovery, and deployed software use their own procedures. A restored project directory cannot roll back a physical migration or deployment.
