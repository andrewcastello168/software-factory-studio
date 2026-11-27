# Final product audit

The audit starts from `main` at `3d83e7d` with Phase 00–12 and PR #15 merged. It reviews the Windows x64 release candidate and the supported Node.js/Express and Go/Gin full-stack paths. The audit pull request records the final installer digest, source revision, Windows logs, and screenshots. It adds no roadmap phase.

## Release decision

| Release use | Decision | Gate |
| --- | --- | --- |
| Internal testing | Eligible on a disposable environment after all three CI workflows and artifact integrity pass | Use the unsigned RC under local Windows policy. |
| Internal daily use | Pending manual verification | Complete P12-04 on the target Windows 11 workstation, including the editor and terminal handoffs and representative client worktree. |
| Trusted public distribution | Blocked | Complete P12-04 and sign and verify the installer and installed executable with an authorized identity. Exercise the signed install and upgrade before promoting v1.0.0. |

## Capability matrix

A Passed result is scoped to the operation and fixture in the evidence column. Failed means a demonstrated unmet check. Blocked requires an unavailable prerequisite. Pending manual verification requires evidence from the stated environment. Unsupported is outside the delivered contract. Not applicable identifies checks that cannot apply to the stated capability. Original acceptance gates remain in the [roadmap](ROADMAP.md).

| Phase and workbench entry | Implemented and expected behavior | Verification and status | Security considerations and manual limits |
| --- | --- | --- | --- |
| 00 · Documentation and architecture | Define local-first workspace, engine, Git, generation and delivery contracts. | **Passed**. Reviewed repository instructions, product specification, decisions and actual workspace boundaries. Desktop interaction is **Not applicable** to this phase. | OS authorization and filesystem grants are separate from portable project definitions. |
| 01 · Home, Settings, Command Palette | Open a usable workbench, switch System/Light/Dark and persist navigation preferences, restore keyboard focus. | **Passed**. Renderer suite, preferences and frame tests, real ASAR smoke with zoom, theme and relaunch. | Sandboxed renderer, isolated main frame, restricted CSP/IPC. Native Windows scaling at 100% and 150% is **Pending manual verification** under P12-04. |
| 02 · Open Folder, Overview, Structure, Recent Projects, tabs | Admit the selected directory, rescan external changes, reopen or locate the correct directory. | **Passed**. Native folder/resource fixtures cover Unicode, independent tabs, rescans, recents, missing/moved roots, dangling and escaping links. | Native dialog results use controlled fixture answers. Actual Windows chooser, Explorer and ordinary account ACL handling are **Pending manual verification**. |
| 03 · Git Studio, Clone Repository | Show actual state and diffs, then perform reviewed branch and native repository operations. | **Passed**. Disposable Git roots and bare remotes cover stage/commit, checkout, history comparison, pull and dirty/stale rejection. Windows exercises public HTTPS. | Structured native argv, repository/config revalidation, bounded output. Credentials, SSH, forced writes and arbitrary hooks are **Unsupported**. |
| 04 · New Project, initial generation recovery | Preview, consent to, and verify files, manifests, locks and documentation with a standalone runtime. | **Passed**. Native Wizard, deterministic byte and digest tests, interrupted journal and separate frozen-install, migration, startup and build suites. | Main owns grants, exclusive writes and journal. Opening/previewing performs no project execution. |
| 05 · Database Studio, ERD, Wizard | Design the supported PostgreSQL schema, import supported DDL, inspect physical state, and review migration and optional CRUD. | **Passed**. Native designer and ERD, keyboard and layout fixtures, real PostgreSQL ledger and apply/rollback, HTTP and browser CRUD. | Read-only inspection and explicit disposable target apply are independent. Unsupported types, constructs and destructive migration paths stay **Unsupported**. |
| 06 · Generation Review, filesystem recovery | Reconcile source migrations, add missing CRUD, preserve custom code and recover an interrupted journal. | **Passed**. Native review, stale refs/worktrees, conflicts, absent files, changed manifests, junctions and idempotency tests. Controlled interruption, restart and handoff verified by service tests. | Preserve user bytes on conflict. File recovery never reverts PostgreSQL or Git. |
| 07 · Engineering Standards, Template/Module Library, AI Context | Publish immutable personal definitions, choose compatible modules and generate stack-specific advisory instructions. | **Passed**. Real Wizard branding and selected modules, version locks and stale/unsafe definition rejection, same profile across isolated projects, PostgreSQL sessions and authorization, scoped audit events. | Node identity only. Frontend visibility is advisory. Executable imports, module removal and arbitrary upgrades are **Unsupported**. |
| 08 · Technology Catalog, Go Wizard | Generate Go Service with Gin, PostgreSQL, React/Vite, compatible profiles, and incremental CRUD. | **Passed**. Go and frontend build and tests, migration ledger, API and browser CRUD, checked locks and standalone release execution. Native Wizard rejects Node-specific modules. | Generated Go requires operator TLS and access policy. Go identity modules and stack conversion are **Unsupported**. |
| 09 · Git Studio Worktrees, Stashes, Integrate, Conflicts | Keep references and physical checkouts separate and expose reviewed native recovery actions. | **Passed**. Native linked checkout and merge, Git service fixtures for staged/unstaged and transition rejection, stash and reviewed conflict continuation/abort. | Current per-worktree grants and native refs guard writes. Advanced Git does not change the physical database. No automatic force push or dirty removal. |
| 10 · Developer Tools, API Designer/Playground, Page Designer, Requirements | Inspect tools, authorize commands, run scoped backends and logs, link artifacts and publish the supported page. | **Passed** for tested operations on rc.2. Shutdown and cleared editor column are regressions from rc.1. Native editor and terminal behavior are **Pending manual verification**. | Local HTTP is numeric loopback with no redirects. Trusted project code uses ordinary account permissions. Arbitrary page generation, Go page publication, and page publication in authenticated projects are **Unsupported**. |
| 11 · Client Delivery, Inspector, Quality Center, Shared Library, Deployment, Release Center, History | Validate real worktree inputs and current results, publish reviewed recipes and release checksummed standalone archives. | **Passed**. Native deployment review and real pass/fail/stale status, Git-sharing fixture, Docker on Linux, isolated PostgreSQL and extracted Node.js/Go archives. | Quality and packaging bind source, worktree, locks and output hashes. Studio preserves existing CI/config files. Production deployment and release publication are **Unsupported**. |
| 12 · Installer, Start Menu, Getting started | Install per user, launch with bundled resources, retain profile and client folders during maintenance. | **Passed** for the hosted install lifecycle and packaged checks. **Pending manual verification** for interactive Windows 11 and first launch on a VM with no developer tools. Public signing is **Blocked**. | A fresh profile and restricted discovery environment in CI exercise first launch and missing-tool states, while the Windows runner still has those tools installed. The [Windows checklist](WINDOWS_DISTRIBUTION.md#interactive-windows-11-acceptance) records the separate physical-session gate. |

## UX review

The audit traced visible actions to renderer handlers, typed preload and main-process services. The Linux ASAR suite and Windows installed suite drive actual screens. Chromium renderer tests exercise compact sizes and keyboard interaction. Native dialogs and operation approvals use controlled fixture results. Individual screenshot references are in the audit pull request.

| Screens | Verified controls and states |
| --- | --- |
| Home, Recent Projects, Overview, Structure, Settings | New/open/clone routes, reopen and locate, tab scope, expanding folders, rescan, theme and layout controls, restoration and keyboard focus. |
| Wizard, Technology Catalog, Engineering Standards, Template Studio, Module Library, AI Context | Exact compatible choices, disabled unavailable capabilities, template and profile selection, module prerequisites, file review and approval, and published profile version. Catalog and AI context are read-only views of reviewed metadata. |
| Database Studio, ERD, Generation Review and Recovery | Edit and validate drafts, import, relation inspection, layout movement, migration preview, code conflict/repeat checks, pending recovery and rejected stale plans. |
| Git Studio and Worktrees | Native repository and branch status, real diffs and changed paths, guarded switching, separate worktree opening and review of integration operations. |
| Developer Tools, API Designer, Playground, Page Designer, Requirements | Runtime command review, status/stop/log output, file and line selection, API save/export, local HTTP, page publication and reference tracing. Real installed editor, Explorer and terminal launches require the interactive checklist. |
| Inspector, Quality Center, Deployment, Release Center, Project History | Evidence refresh, review and run, failed and stale checks, application-blocked release controls, deployment file review, read-only history and links to the respective recovery tools. |
| Placeholder status | Component Library, Plugin Manager and Team Workspace use non-actionable **Planned** copy. Unsupported stack/module/command combinations report an unavailable state. |

## Findings and stabilization

| Finding | Severity | Baseline | Stabilization and evidence |
| --- | --- | --- | --- |
| AUD-01 · Closing during a managed Stop action | Medium | **Failed**. A real disposable process with delayed SIGTERM cleanup still owned its port when Studio's runtime service finished disposing. | Join a single bounded termination request during reconciliation and disposal. The regression waits for backend close and successfully rebinds the port. Native tests retain ordinary owned process-stop coverage on both platforms. |
| AUD-02 · Editor column remains set after clearing Line | Low | **Failed**. The disabled input kept its value and the editor handoff could send a column without a line, which the IPC schema rejects. | Clear the column with the line and omit an orphaned column from the request. The native renderer test covers select, enter, clear, and disabled state. |
| AUD-03 · Hosted Windows and unsigned RC provenance | Release gate | **Pending manual verification** and **Blocked** for signing. | Pin the original rc.1 ZIP and installer digests for cross-release upgrade. Keep the expired-artifact fallback explicitly identified as same-source coverage. Validate Authenticode separately and keep interactive evidence pending. |

## Reference client delivery

The installed suites publish a reusable profile, select branded Business Workspace, configure the five-table PostgreSQL inventory and approve the deterministic file preview. Node selects all four identity modules. Go verifies their unavailability. The fixture compares every generated output digest with the reviewed plan before running the same source bytes independently.

| Client workflow steps | Evidence and remaining owner action |
| --- | --- |
| 1–9 · Launch through generated project | Sandbox Electron, real Wizard approval, published profile, Node and Go stack adapters, branded UI, selected schema and CRUD, migration source, exact locks and stack-aware `AGENTS.md`. Screenshots include both reviewed plans. |
| 10–14 · Install, migrate, bootstrap, run and verify | Frozen dependency install, isolated PostgreSQL namespace, explicit migrations, repeat/checksum behavior, administrator bootstrap for Node, dev proxy and production build, authentication, authorization, real constraints and browser/HTTP records. Go uses no login. |
| 15 · External editor | Service tests verify a controlled launch on Linux and path rejection on both platforms. Actual Windows 11 VS Code, line/column and terminal behavior are **Pending manual verification**. |
| 16–18 · Custom source and incremental change | Preserve a modified service and an independently authored `supplier_contacts` migration, review and apply only its CRUD contributions, prove repeat no-op, migrate explicitly and exercise the new HTTP route against PostgreSQL. |
| 19 · Git and worktree protection | Real linked checkouts and scope verification cover both focused fixtures and the reference clients. Each client release keeps its clean revision and fingerprint while the parallel worktree contains separate edits. Changed source invalidates release evidence. |
| 20–23 · Quality, deployment, build and release | Native Inspector/Quality displays real evidence. Verified client archives use actual current checks, reviewed CI and Docker recipes, expected artifacts, clean revision and checksums. |
| 24–25 · Independent delivery | Extract Node and Go archives and start with their documented tools outside Studio. The released executable serves PostgreSQL health and readiness, the new CRUD API, and the browser record view from the extracted root. The corresponding independent built references exercise full CRUD, role and constraint cases. |

Use these reference projects to validate generated CRUD and access enforcement. Design inventory valuation, stock accounting, reconciliation, and business approval rules in client-owned requirements and source.

## Security and recovery review

The review followed Electron origin and frame validation, path and grant containment including Windows junctions, approved Git argv and subprocesses, session expiration and role authorization, local HTTP constraints, ephemeral database credentials, portable asset validation, generation digests, migration transactions, and release artifacts. The suites exercise separate filesystem recovery, Git continuation/abort, PostgreSQL DDL rollback, and missing-artifact republishing. They compare exact client revisions and ensure edited required integrations fail without replacement. Windows path identity checks and Git locks protect the tested operations. Same-account concurrent processes remain outside those protections.

Studio production and full npm dependency audits reported no advisories in the local assessment. Linux CI separately audits generated production npm dependencies and Go against the reviewed advisory database. Credentials are excluded from runtime-derived generator inputs. Profile and release-note validators reject common secret patterns, and logs redact known values. Free text, compiled client artifacts and configured tools still require operator judgment. The audit found no confirmed Critical or High issue in the reviewed paths and cannot certify every environment or user-authored extension.

## Performance and reliability

Run `node scripts/audit-performance.mjs` with the regular built application. Set `FACTORY_AUDIT_EXECUTABLE` to an absolute packaged executable to exercise ASAR startup. The run uses three fresh temporary profiles, a 288-file native Git workspace, a second generated foundation, and a managed backend that emits 240 lines. The timer includes automation and IPC overhead where relevant. It verifies the last 200 lines, process shutdown and port closure. Host filesystem caches were warm. Linux used Debian 13 x64, four available CPUs, kernel 6.18.57, Node.js 22.16.0, and sandboxed Electron under Xvfb. These latency samples are baselines for that fixture rather than universal performance targets.

| Operation | Median (ms) | Range (ms) |
| --- | ---: | ---: |
| Start until Home is visible | 697 | 568–875 |
| Open 288 files | 189 | 185–420 |
| Explicit rescan, 288 files | 125 | 119–136 |
| Native Git status, 288 files | 113 | 104–260 |
| Foundation generation preview | 132 | 93–153 |
| Switch between two project tabs | 54 | 41–59 |
| Declared foundation schema inspection | 22 | 20–25 |
| IPC snapshot with 200 log lines | 15 | 13–29 |
| Exit with a running managed backend | 141 | 54–274 |

Aggregate Electron working set was 554–555 MiB at the sampled point. That sum can count shared memory more than once. Three launches confirm bounded logs and port cleanup for the fixture. They do not establish long-session memory behavior. Native watcher budgets, polling, bounded scans, child ownership and cleanup were reviewed in source. Performance under sustained load and at native Windows display scaling remains outside this benchmark.
