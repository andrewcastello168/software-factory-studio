# Security

## Threat model

Protect the user's source code, branch and index state, ignored and unsaved work, application credentials, local databases, and the machine running Studio. Treat renderer input, imported projects and archives, Git configuration and attributes, templates and plugins, SQL, tool output, and external file changes as untrusted. Main is the privileged boundary. A renderer compromise can attempt allowed UI requests, so sensitive work must still require host-side grants, preflight, and operation-specific approval. Native filesystem restrictions and authenticated remote permissions complement Studio checks.

## Electron boundary

- Create windows with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and `webSecurity: true`. Keep Node disabled in worker and subframe renderer contexts. Bundle preload as a single sandbox-compatible entry.
- Use the app's registered secure standard local origin for the packaged renderer. Resolve only bundled assets from its handler. Allow an exact loopback development renderer origin only in explicit dev mode. Use a restrictive CSP with packaged `default-src 'self'`, packaged scripts from self, `object-src 'none'`, and `base-uri 'none'`. Limit dev allowances to required Vite transport and assets. Bundle application fonts and icons or use system fonts.
- Deny arbitrary navigation, secondary windows, webviews, and permission requests. External links require a narrow allowlisted URL policy if implemented. Render content and tool output as text by default. Never render a project's HTML as a privileged Studio page.
- Keep preload methods named per capability. Expose no raw Electron objects, arbitrary channels, filesystem primitives, or generic process runners. Use runtime schemas on both the request and response boundaries. Main verifies the authorized window, top-level frame, expected origin, and applicable typed grant for every call. Preload subscriptions forward validated values and expose cleanup.
- Keep errors structured, bounded and safe to present. Never log raw environments, credential URLs, secrets, or unfiltered process output. Redact values before serializing and log only operation context needed for diagnosis.

## Filesystem boundary

Only native admission and previously authorized recents can establish workspace grants. A grant binds the owning window, canonical root, and allowed operations. Creation can use a one-operation grant for a validated destination under a natively selected parent. Sensitive writes require a scoped intent and explicit review. Require normalized relative paths for project reads and writes. Reject absolute paths, traversal, ambiguous encodings, platform device names, Windows alternate streams, and case or normalization aliases that can target the same file. Apply path checks to imported archives and generated paths as well.

Resolve the real root and target or nearest existing parent, verify containment by path components, and check links and junctions at and below the grant. Disallow following project links for writes until a separately reviewed policy exists. Use exclusive creation for new files. Revalidate identities and opened handles at use, with a reviewed OS-appropriate primitive for any operation exposed to path-replacement races. Reject any operation whose path safety cannot be established. Test root and parent replacement with disposable fixtures. Journal generator changes and fail closed if recovery is required. See [Generator specification](GENERATOR_SPECIFICATION.md).

## Subprocesses, credentials, and approval

Treat everything that executes code as privileged. Git and toolchain adapters select an approved executable outside the project, pass argv without a shell, build a restricted environment, enforce cwd and output limits, time out hung processes, and implement cancellation where safe. Never run commands copied from imported metadata. Opening, previewing, rescanning and switching views execute no project scripts. Git has its own execution constraints because ordinary commands can trigger external programs through config, attributes or hooks. See [Git safety](GIT_SAFETY.md).

Prefer operating-system credential protection through Electron safeStorage where its platform backend provides secure protection. Fail closed for insecure backends, such as Linux `basic_text`. Allow session-only credentials or a separately reviewed OS credential store when durable protection is unavailable. Never persist secrets in portable project files, diagnostics, generated source, or command arguments. Keep private configuration and environment files isolated per worktree where applicable.

Sensitive actions bind approval to the actor window, current workspace, destination, exact scope, and operation digest. Require review for checkout, commit, stash, worktree and branch changes, remote writes, generation, executing project code, and database changes. Recheck stale intent and return a fresh preview after changes. Local database write support requires an explicitly authorized target and the database guardrails. See [Database engine](DATABASE_ENGINE.md).

## Phase 01 attack surface

Phase 01 exposes only typed application information and theme/panel preferences, scoped to enum and numeric range inputs. Persistence uses a fixed application-data location selected by main. Validate sender, inputs, replies, corrupt settings behavior, blocked navigation and renderer Node isolation. Compare the parsed scheme, host, and port for custom renderer URLs, since an opaque URL origin alone cannot identify an approved application origin. Reject user information and resolve packaged resources from the bundled renderer root with explicit response types. Check the target and ancestor path policy before any read. File access, Git, database clients, executable plugins, process requests, and credentials enter only with their implementing milestone and tests. Review privileged dependencies and update Electron on supported release lines, with regression checks before distributing changes.

## Phase 03 attack surface

Git Studio accepts a project token and operation-specific fields. A file request uses a row in the reviewed porcelain snapshot instead of an arbitrary path. Main reconstructs Git arguments, verifies the active root, checks metadata and repository config, and validates the approval state before mutation. Native clone and local remote selection establish separate one-operation grants. Rejected Git output is mapped to bounded diagnostics rather than forwarding raw stderr. Patches are bounded untrusted text displayed only for the active grant; they are not logged. HTTPS accepts plain anonymous addresses, verifies TLS, and disables redirects, helpers, and prompts. This phase acquires and stores no credentials.

The Git subprocess runs with the desktop user's filesystem permissions. Studio policy checks and Git locks guard admitted paths and supported operations. They do not provide an OS sandbox for a concurrent process with the same permissions. Keep repository configuration stable during an approved operation. Separate Git for Windows evidence is required for path, junction, and transport behavior.

## Phase 04 attack surface

Generator IPC accepts only a validated profile, normalized project input and opaque session tokens. IPC never accepts absolute destinations, template content, shell commands, database credentials or file payloads. Main verifies the parent grant, absence of the destination, and native approval digest. Recovery reconstructs the reviewed plan from the built-in template and requires the original native parent grant and consent. Files changed by people are preserved for manual review. Details and platform limits are in the [generator specification](GENERATOR_SPECIFICATION.md).

The starter runs as independent project source. Desktop generation reads back files only. PostgreSQL migrations use explicit terminal execution, a transaction and checksum ledger. Test/database URLs are kept out of Studio metadata and runtime logs.

## Phase 05 attack surface

Schema IPC accepts versioned structured drafts, bounded paste-in SQL for parsing, operation tokens, and connection fields. Filesystem paths come from the active grant and a fixed migration location, with canonical directory and handle checks before reading and staging. Publication binds native consent to an append-only target path, source history, and fingerprint. Store recovery and diagram settings in app data. Renderer networking remains unavailable in the production CSP.

Inspect using a native confirmation and a read-only PostgreSQL transaction. Main owns the database connection and fixed catalog queries. Remote inspection requires verified TLS. Each connection password is supplied for one operation and omitted from logs, portable files, plans and journals. Apply supports explicitly reviewed development targets and accepted migrations, compares the scoped ledger and physical state, and uses the stack's transaction and advisory lock. No branch operation initiates database access. See [Database engine](DATABASE_ENGINE.md) for supported syntax and development target checks.


## Phase 06 incremental writes

The renderer sends a project token, a read revision, table selections, and opaque approval or recovery IDs. It cannot submit paths or file content. Main restricts writable paths to the built-in adapter's outputs. Replacement requires explicit approval, exact pinned baseline bytes, and matching portable ownership. Generated changes, Git context, directory identities, and migration fingerprints are rechecked across consent and recovery. The native dialog defaults to cancel. In-progress and interrupted operations protect their worktree from Studio Git and database mutations.

The transaction preserves verified originals in sibling backups until all reviewed outputs are readable and match. Conflicting workspace or recovery bytes are preserved for manual inspection. Linux uses the existing opened-directory binding. On Windows the canonical identity checks bracket path-based operations. Save editor buffers first. Concurrent same-account processes are outside the filesystem isolation boundary. Incremental commits never run project scripts or change a database.


## Phase 07 identity and portable definitions

The library accepts typed data and bounded advisory text. It rejects unknown fields, executable metadata, common credential patterns, and unsafe branding values. Portable exports and project context contain the selected definitions, never runtime environment values. Review authored free text before sharing.

Generated applications use scrypt-derived password hashes and database-backed, expiring sessions with token digests at rest. Login and administration use parameterized queries. Unsafe requests require the configured exact Origin. HTTPS mode accepts direct TLS or a trusted loopback proxy that overwrites forwarded protocol and client address. Local loopback HTTP requires explicit opt-in. Critical administration endpoints enforce role and bootstrap administrator boundaries before database writes. Audit coverage is described in the generated identity guide.
