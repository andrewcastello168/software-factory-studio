import { orderedModules, WELCOME_EXAMPLE } from '@factory/contracts';
import { nodeTemplates } from './templates';
import { identityContributions } from './identity';
import foundation0 from '../templates/modular/foundation/AGENTS.md?raw';
import foundation1 from '../templates/modular/foundation/README.md?raw';
import foundation2 from '../templates/modular/foundation/db/migrations/0001_baseline.sql?raw';
import foundation3 from '../templates/modular/foundation/docs/ARCHITECTURE.md?raw';
import foundation4 from '../templates/modular/foundation/docs/REQUIREMENTS.md?raw';
import foundation5 from '../templates/modular/foundation/server/app.ts?raw';
import foundation6 from '../templates/modular/foundation/server/routes.ts?raw';
import foundation7 from '../templates/modular/foundation/server/server.ts?raw';
import foundation8 from '../templates/modular/foundation/test/http.test.ts?raw';
import foundation9 from '../templates/modular/foundation/web/main.tsx?raw';
import registerWelcome from '../templates/modular/welcome/server/register.ts?raw';
import welcomePanel from '../templates/modular/welcome/web/Welcome.tsx?raw';
import welcomeTests from '../templates/modular/welcome/test/welcome.test.ts?raw';

type Template = readonly [path: string, content: string];

function shared(path: string): Template {
  const template = nodeTemplates.find(([key]) => key === path);
  if (!template) throw new Error('Missing bundled source: ' + path);
  return template;
}

export const foundationTemplates: readonly Template[] = [
  ...[
    '.env.example', '.gitattributes', '.gitignore', '.node-version', '.npmrc',
    'docs/CODING_STANDARDS.md', 'docs/DEPENDENCIES.md', 'eslint.config.js',
    'package.json', 'pnpm-lock.yaml', 'server/config.ts', 'server/database.ts',
    'server/middleware.ts', 'server/migrate.ts', 'server/migrations.ts',
    'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts', 'web/index.html', 'web/styles.css',
  ].map(shared),
  ['AGENTS.md', foundation0],
  ['README.md', foundation1],
  ['db/migrations/0001_baseline.sql', foundation2],
  ['docs/ARCHITECTURE.md', foundation3],
  ['docs/REQUIREMENTS.md', foundation4],
  ['server/app.ts', foundation5],
  ['server/routes.ts', foundation6],
  ['server/server.ts', foundation7],
  ['test/http.test.ts', foundation8],
  ['web/main.tsx', foundation9],
];

const emptySlots = {
  APIIMPORTS: '', APIROUTES: '', WEBIMPORTS: '', WEBPANELS: '',
  AGENTFEATURES: '', READMEFEATURES: '', ARCHFEATURES: '', REQFEATURES: '',
};

interface Contribution {
  id: string;
  version: string;
  templates: readonly Template[];
  migration?: readonly [string, string];
  slots: Partial<typeof emptySlots>;
  tests: readonly string[];
}

// Reviewed build-time data. Projects and user input never supply template paths,
// executable registration hooks or dependency versions.
const contributions: readonly Contribution[] = [{
  ...WELCOME_EXAMPLE,
  templates: [
    ['db/migrations/0002_welcome.sql', shared('db/migrations/0001_welcome.sql')[1]],
    ['server/features/welcome/controller.ts', shared('server/controller.ts')[1]],
    ['server/features/welcome/repository.ts', shared('server/repository.ts')[1]],
    ['server/features/welcome/service.ts', shared('server/service.ts')[1]],
    ['server/features/welcome/register.ts', registerWelcome],
    ['web/features/Welcome.tsx', welcomePanel],
    ['test/welcome.test.ts', welcomeTests],
  ],
  slots: {
    APIIMPORTS: "import { registerWelcome } from './features/welcome/register.ts';\n",
    APIROUTES: '  registerWelcome(router, pool);\n',
    WEBIMPORTS: "import { Welcome } from './features/Welcome.tsx';\n",
    WEBPANELS: '    <Welcome />\n',
    AGENTFEATURES: '- The optional Welcome example lives in server/features/welcome/, web/features/Welcome.tsx and db/migrations/0002_welcome.sql. Keep client requirements separate from this example.\n',
    READMEFEATURES: '## Welcome example\n\nThe selected example adds a Welcome panel and GET /api/welcome with an optional variant parameter. The second migration seeds the example records.\n\n',
    ARCHFEATURES: '\nThe selected Welcome example registers its route in server/features/welcome/register.ts and its React panel in web/features/Welcome.tsx. Its SQL lives in db/migrations/0002_welcome.sql.\n',
    REQFEATURES: '- The optional Welcome example retrieves a seeded message through the same-origin API. This example is separate from client requirements.\n',
  },
  tests: ['test/welcome.test.ts'],
}, ...identityContributions];

export function composeModules(selected: readonly { id: string; version: string }[]) {
  const modules = orderedModules(selected).map(({ id, version }) => {
    const source = contributions.find((item) => item.id === id && item.version === version);
    if (!source) throw new Error('Selected module has no bundled template.');
    return source;
  });
  const slots = { ...emptySlots };
  for (const module of modules) {
    for (const name of Object.keys(slots) as (keyof typeof slots)[]) slots[name] += module.slots[name] ?? '';
  }
  const testPaths = [...new Set(['test/http.test.ts', ...modules.flatMap(({ tests }) => tests)])];
  return { modules, slots, testPaths };
}
