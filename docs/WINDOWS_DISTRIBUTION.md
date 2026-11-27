# Software Factory Studio on Windows

## Install and launch

1. In the repository's **Actions** tab, open a successful **Windows installer verification** run for the reviewed source commit. Download **software-factory-studio-windows-x64-rc** under **Artifacts** and extract the ZIP.
2. Compare the installer SHA-256 with the accompanying `.sha256` file and `build-evidence.json`. Run `Get-FileHash .\Software-Factory-Studio-1.0.0-rc.1-windows-x64.exe -Algorithm SHA256` in PowerShell from the extracted folder.
3. In an authorized internal test environment, open the installer as your usual Windows user and select the current-user installation. Follow your organization's Windows policy for unsigned software. The release candidate may show a SmartScreen or unknown publisher warning.
4. Launch **Software Factory Studio** from Start. You can pin it or manually create a desktop shortcut. The installer creates only the Start Menu shortcut.

Studio uses its bundled Electron runtime. Open **Home → Getting started → Check developer tools** for version discovery. No external runtime, account, network service, or subscription is required to launch Studio. Git Studio uses Git for Windows 2.39 or later. Both starter stacks use PostgreSQL 17 and the frontend tooling requires Node.js 22.16.0 and pnpm 10.13.1. The Go backend requires Go 1.26.11. Use Technology Catalog for the verified Node/Express and Go/Gin combinations and their exact requirements. See [MVP Getting Started](MVP_GETTING_STARTED.md) and [Client Delivery](CLIENT_DELIVERY.md) for client project workflows.

## Upgrade and uninstall

Close Studio, then run the newer installer as the same user. The installer upgrades the existing per-user installation, normally at `%LOCALAPPDATA%\Programs\Software Factory Studio`. Keep client repositories in a separate project directory. The executable is `Software Factory Studio.exe`.

Settings, recent project references, engineering assets, schema and generation recovery records, and quality and release history use the Electron profile at `%APPDATA%\Software Factory Studio`. Project source, portable metadata, deployment artifacts and databases have their own locations. Back up the profile with Studio closed before moving systems. Existing safe handling for malformed or unsupported records still applies.

Uninstall via **Settings → Apps → Installed apps → Software Factory Studio → Uninstall**. The uninstaller removes the application and its Start Menu registration. It preserves the Electron profile and client directories. Reinstalling under the same user uses the existing profile.

## Build a candidate

On Windows x64, use the repository's pinned Node.js and pnpm versions.

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm package:windows
```

The output in `apps/desktop/dist/windows-release` includes the NSIS installer, SHA-256, release notes and machine-readable build evidence. The build evidence binds the artifact digest and size to the exact Git commit and packaging toolchain. Verify the working tree is clean when building a candidate for review. The workflow produces a separately named artifact containing the tested candidate and its records. No byte-for-byte reproducibility claim is made.

For a separately authorized signed build on a trusted machine, set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` through a secure signing environment and run `pnpm package:windows --sign`. The command requires signing to succeed. Check Authenticode status, certificate identity, timestamp and trust chain on the resulting installer and installed executable. Pull-request builds are unsigned and receive no signing secrets. Public distribution requires an authorized, trusted signing identity and documented Windows reputation and policy checks.

## Troubleshooting and desktop acceptance

- An unsupported or missing tool in **Getting started** only affects workflows that need it. Install the documented tool manually in a supported location, then run tool discovery again.
- If launch fails, rerun the verified installer under the same account. Leave the profile and project directories intact. Report the installed version and OS build with sanitized error details.
- GitHub-hosted verification runs the installer and native Playwright suite with a disposable account. File-dialog answers and reviewed consent in automated workspace tests come from controlled fixtures.
- On interactive Windows 11 x64, verify the installer screens and publisher prompt, the Start Menu launch and optional manually created shortcut, file and folder choosers, Explorer reveal, actual VS Code handoff with line and column, and the native terminal working directory. Exercise spaces and Unicode, a redirected junction, permission rejection, window resizing, 100% and 150% OS scaling, keyboard focus and both themes.
- Use a clean VM without separately installed Git, Node.js, pnpm or Go to verify first launch and missing-tool states. Then install the documented tools and verify detection. Exercise application shutdown with a managed process and confirm unrelated processes and worktrees remain running.
- For a signed candidate, repeat manual installation under normal Windows policy and record publisher and trust behavior. Keep OS security controls enabled.
