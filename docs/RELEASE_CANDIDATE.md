# Software Factory Studio 1.0.0-rc.1

This internal Windows x64 release candidate packages the local-first Software Factory Studio desktop workbench. It includes the Node.js and Go generators, reusable engineering library, PostgreSQL schema and CRUD workflow, Git and worktree tools, developer workspace, and client delivery screens. Generated projects continue to run independently of Studio.

The NSIS installer is configured for current-user installation by default. The Start Menu entry launches Studio using its bundled Electron runtime. Upgrades and uninstall preserve the roaming Studio profile and independently managed project files.

Read the matching build evidence and checksum for the exact source commit and installer bytes. CI distribution is unsigned. Windows may report an unknown publisher or display a SmartScreen warning. Code signing, interactive Windows desktop acceptance and the final product audit remain separate release gates.

See [Windows distribution](WINDOWS_DISTRIBUTION.md) in the repository for installation, upgrade, uninstall, troubleshooting and Windows verification instructions.
