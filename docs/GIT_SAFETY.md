# Git safety

## Repository context

Use native Git against the granted directory with an explicit working directory, argv arrays, and bounded machine-readable output. Verify the repository root and Git common directory before mutations. Use porcelain v2 with NUL delimiters for staged, unstaged, untracked, and conflict data. Treat ignored files separately. Preserve ambiguous or undecodable paths safely and block mutations that cannot identify their exact target. Resolve and validate refs, verify their object IDs with Git, and use option and path delimiters where supported.

Top-bar data contains the project name, actual working directory, branch or detached HEAD, and working tree status. Show unavailable Git or recovery states directly. For linked worktrees keep the selected path fixed and identify the common repository independently. Branch Explorer can read other refs without changing the active directory.

## Execution policy

Trust only an approved Git executable resolved outside the project. Pass arguments without a shell and use a curated environment. Protect against inherited Git overrides, ambiguous option parsing, credential prompting, and exposure of remote credentials. For read-only inspection disable optional Git locks where supported, use bounded low-side-effect commands, and avoid hooks, external diff or text conversion, credential helpers, filters, and submodule recursion. Render all Git output as untrusted text.

Repository and user Git config may delegate to hooks, filesystem monitors, filters, merge drivers, helpers, SSH commands, signing tools, transports, and submodules. Each operation must implement and test a policy for the mechanisms it can activate. Suppress external execution where possible and block unsupported configuration before the operation. Treat attributes, config includes, URL rewrites, and inherited process state as inputs to preflight. Start clone with standard HTTPS or an admitted local source and no recursive submodules. Admit SSH and provider integrations only after explicit credential and transport designs. Until approved authentication exists, limit tested remote workflows to supported unauthenticated or local fixtures. See [Security](SECURITY.md).

## Switch branch

1. Capture the canonical directory, current full ref and commit, target full ref and commit, status, and any pending Git or generation operation. Unborn branches use an explicit no-commit state.
2. Block switching during a merge, rebase, cherry-pick, revert, bisect, or pending generation or recovery. Show locked and already-checked-out targets. Inspect ignored and untracked collision candidates, including local configuration.
3. For a clean tree, show current and target refs and obtain explicit confirmation. For dirty trees render the staged, unstaged, and untracked paths and their intended handling. Note that external editor buffers may still be unsaved. Offer the choices below.
4. Immediately before any write, acquire the worktree lock, recheck the snapshot and selected files, and invalidate approval on drift. Ref changes also require the common-directory lock. Use Git's native locking and expected-old-object guards when available. For checkout use `--no-overwrite-ignore` or verify equivalent native protection. Display a collision as a blocked operation. Studio locks cannot exclude external Git or editor processes.
5. Refresh Git state, portable metadata, and the source schema after a confirmed checkout. Update physical database status only through an explicitly requested database operation. If a step fails, show the observed state and safe recovery commands or actions.

| Dirty-tree choice | Required behavior |
| --- | --- |
| Commit and Switch | Preview the complete commit set, including stage decisions and excluded paths. Require a message and approval. Recheck that checkout is safe after commit. If checkout fails, record the resulting commit and leave it accessible. |
| Safe Stash and Switch | Preview tracked and explicitly approved untracked files. Preserve ignored paths and block when untracked or potentially sensitive data cannot be kept out of the stash. Verify that the resulting stash matches the approved scope and retain its object ID. A separate apply review identifies whether staged state can be restored and how any conflicts will be handled. |
| Open in Separate Worktree | Show the new path and checked-out ref. Require explicit creation and open it in another tab. Keep the original workspace associated with its directory. |
| Cancel | Preserve branch, index, worktree files, and stash state. |

## Source control and remote operations

Phase 03 delivers status, staged and unstaged file and hunk views, file stage and unstage, commit, fetch, fast-forward-only pull, ordinary push, upstream and divergence display, read-only branch browsing, and confirmed clean switching. Hunk views can be read-only in this phase. A dirty switch surfaces the current files and Cancel until the alternative flows are implemented in Phase 09. Show renames, binary files, conflicts, and unborn or detached state accurately. Diff actions bind to the expected path, ref and status. Commit preview binds to the index and planned staged changes. Refresh after failure as well as success.

For fetch, pull, and push show the remote and branch, and enforce the operation's explicit destination. Pull requires a clean eligible worktree and a fast-forward relationship. If refs diverge, provide a read-only comparison and leave the worktree as observed. Use ordinary push with an explicit target ref and surface a rejected non-fast-forward update. Force push is outside the approved workflows. The Studio repository itself is subject to [repository instructions](../AGENTS.md).

## Advanced branch operations and worktrees

For merge, cherry-pick, rebase, and selected-file replacement, show source and target separately, the resulting direction, affected paths, and whether history changes. Build previews in disposable, trusted fixtures or in an admitted temporary worktree with the same execution policy. Revalidate both refs, common directory, worktree, and affected files at apply time. Preserve Git's conflict state, present the conflict and the native abort or continue path, and require human resolution of business logic. Branch creation binds the new name to the reviewed base object. Rename and deletion check the current object and all worktree uses. Block deletion of an active, protected, or unmerged branch in the initial guarded workflow. Require review for stash apply and recovery checkpoints.

Never force a dirty worktree removal. Respect Git's checked-out branch restrictions. New worktrees start with separate local environment configuration and development port and database choices when those features are implemented. Git recovery can recover source or history. Database recovery uses the database engine's recovery process.

Verify each operation in temporary repositories with local bare remotes, including staged, unstaged, untracked, ignored, divergence, conflict, stale preview, and linked-worktree cases. Exercise Windows paths and Git for Windows independently. See [Testing strategy](TESTING_STRATEGY.md).

## Phase 03 execution boundary

Use a conventionally installed Git executable. Studio starts Git with a private process environment, an empty global and system configuration, an inert hooks path, disabled credential helpers and interaction, disabled submodule recursion, and an operation-specific HTTPS or file transport allowlist. Inspect local configuration with includes disabled and allow only basic core settings, straightforward remote mappings, branch upstream, and repository-local author identity. Unsupported settings block Studio Git operations until reviewed externally. Git metadata must be a real directory without links, junctions, or object alternates. Existing source trees containing symlinks, gitlinks, ambiguous paths, or nonportable names may be browsed through Project Structure. Studio refuses to materialize those trees through checkout, pull, or clone. Linked worktrees need a separate common-directory grant design.

Clone uses an exclusive new child folder, no checkout during transfer, and tree review before populating files. A failed clone may leave a partial destination for user inspection. Local remotes must be separately selected bare repositories. Phase 03 uses anonymous HTTPS without redirects or embedded credentials. Studio uses existing branch tracking and does not configure private credentials, custom fetch mappings, or first-push upstreams. Configure commit identity using `git config --local user.name` and `git config --local user.email`.

Dirty checkout allows review and cancellation. Clean checkout requests native confirmation and keeps Git's ignored-file collision protection. Pull fetches an explicitly scoped tracking ref and applies only a verified fast-forward. Divergence leaves the checked-out branch untouched and can be inspected by comparing its upstream ref. Ordinary push uses the reviewed commit ID and destination branch, with no force or hook execution. A successful push followed by a failed tracking refresh is reported as partial success.

A Studio lock serializes its own writes. External editors and Git clients can still act in the interval between the last review and a native Git call. Git's native locks and overwrite checks remain active. Save editor buffers before checkout, and avoid modifying the same Git configuration or files concurrently. On failure, refresh and review the actual worktree and refs before retrying. Phase 03 has no authority over physical databases.


## Phase 06 generation coordination

Incremental generation binds review to the admitted worktree, repository directory identity, ref and HEAD, and rejects staged affected paths and in-progress Git operations. It permits unrelated dirty files. A pending transaction blocks Studio Git mutations and source migration publication on that workspace. Resume rechecks the exact Git and schema context and the observed before/after bytes. Handoff preserves workspace and backup files for independent recovery.
