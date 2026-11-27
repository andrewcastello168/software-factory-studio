import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const manifest = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8'));
const workspace = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
const flags = process.argv.slice(2);
const fixture = flags.includes('--upgrade-fixture');
const sign = flags.includes('--sign');
if (flags.length > 1 || flags.some((flag) => !['--upgrade-fixture', '--sign'].includes(flag))) {
  throw new Error('Use package:windows with at most one of --upgrade-fixture or --sign.');
}
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The Windows installer requires a Windows x64 packaging host.');
}
if (sign && (!(process.env.WIN_CSC_LINK || process.env.CSC_LINK) || process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false')) {
  throw new Error('Provide an authorized Windows certificate and enable signing before using --sign.');
}
if (!sign) {
  for (const key of Object.keys(process.env)) {
    if (/^(?:WIN_)?CSC_/iu.test(key)) delete process.env[key];
  }
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
}

const { Arch, Platform, build } = await import('electron-builder');
const version = fixture ? '1.0.0-rc.0' : manifest.version;
const stage = await mkdtemp(join(tmpdir(), 'factory-studio-package-'));
const output = join(desktop, 'dist', fixture ? 'upgrade-fixture' : 'windows-release');
const artifactName = `Software-Factory-Studio-${version}-windows-x64.exe`;
function git(...args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
}
const source = git('rev-parse', 'HEAD');
const workingTreeClean = !git('status', '--porcelain');
const icon = join(desktop, 'packaging', 'studio.ico');

try {
  const dist = join(stage, 'dist');
  await mkdir(dist);
  for (const directory of ['main', 'preload', 'renderer']) {
    await cp(join(desktop, 'dist', directory), join(dist, directory), { recursive: true });
  }
  await mkdir(join(stage, 'docs'));
  for (const document of ['WINDOWS_DISTRIBUTION.md', 'MVP_GETTING_STARTED.md', 'CLIENT_DELIVERY.md']) {
    await copyFile(join(repository, 'docs', document), join(stage, 'docs', document));
  }
  await writeFile(join(stage, 'package.json'), JSON.stringify({
    name: 'software-factory-studio',
    productName: manifest.productName,
    version,
    main: manifest.main,
    description: 'Local-first development and engineering workbench',
    author: { name: 'Software Factory Studio' },
    private: true,
  }, null, 2));
  await build({
    projectDir: stage,
    targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
    publish: 'never',
    config: {
      appId: 'com.softwarefactorystudio.desktop',
      productName: manifest.productName,
      electronVersion: manifest.devDependencies.electron,
      artifactName,
      asar: true,
      npmRebuild: false,
      directories: { output },
      files: ['package.json', 'dist/{main,preload}/index.cjs', 'dist/renderer/**', 'docs/*.md'],
      forceCodeSigning: sign,
      win: { icon },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowElevation: false,
        packElevateHelper: false,
        uninstallDisplayName: manifest.productName,
        allowToChangeInstallationDirectory: false,
        createStartMenuShortcut: true,
        createDesktopShortcut: false,
        deleteAppDataOnUninstall: false,
        runAfterFinish: false,
        installerIcon: icon,
        uninstallerIcon: icon,
      },
    },
  });

  const installer = join(output, artifactName);
  const sha256 = createHash('sha256').update(await readFile(installer)).digest('hex');
  const information = {
    artifact: artifactName,
    bytes: (await stat(installer)).size,
    sha256,
    version,
    platform: process.platform,
    architecture: process.arch,
    source,
    workingTreeClean,
    signingRequested: sign,
    toolchain: {
      node: process.version,
      pnpm: workspace.packageManager,
      electron: manifest.devDependencies.electron,
      electronBuilder: manifest.devDependencies['electron-builder'],
    },
  };
  await writeFile(join(output, `${artifactName}.sha256`), `${sha256}  ${artifactName}\n`);
  await writeFile(join(output, 'build-evidence.json'), JSON.stringify(information, null, 2) + '\n');
  await copyFile(join(repository, 'docs', 'RELEASE_CANDIDATE.md'), join(output, 'release-notes.md'));
  console.log(JSON.stringify(information));
} finally {
  await rm(stage, { recursive: true, force: true });
}
