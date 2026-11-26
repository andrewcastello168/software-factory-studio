import template0 from '../templates/node/.env.example?raw';
import template1 from '../templates/node/.gitattributes?raw';
import template2 from '../templates/node/.gitignore?raw';
import template3 from '../templates/node/.node-version?raw';
import template4 from '../templates/node/.npmrc?raw';
import template5 from '../templates/node/AGENTS.md?raw';
import template6 from '../templates/node/README.md?raw';
import template7 from '../templates/node/db/migrations/0001_welcome.sql?raw';
import template8 from '../templates/node/docs/ARCHITECTURE.md?raw';
import template9 from '../templates/node/docs/CODING_STANDARDS.md?raw';
import template10 from '../templates/node/docs/DEPENDENCIES.md?raw';
import template11 from '../templates/node/docs/REQUIREMENTS.md?raw';
import template12 from '../templates/node/eslint.config.js?raw';
import template13 from '../templates/node/package.json?raw';
import template14 from '../templates/node/pnpm-lock.yaml?raw';
import template15 from '../templates/node/server/app.ts?raw';
import template16 from '../templates/node/server/config.ts?raw';
import template17 from '../templates/node/server/controller.ts?raw';
import template18 from '../templates/node/server/database.ts?raw';
import template19 from '../templates/node/server/middleware.ts?raw';
import template20 from '../templates/node/server/migrate.ts?raw';
import template21 from '../templates/node/server/migrations.ts?raw';
import template22 from '../templates/node/server/repository.ts?raw';
import template23 from '../templates/node/server/routes.ts?raw';
import template24 from '../templates/node/server/server.ts?raw';
import template25 from '../templates/node/server/service.ts?raw';
import template26 from '../templates/node/test/http.test.ts?raw';
import template27 from '../templates/node/tsconfig.json?raw';
import template28 from '../templates/node/tsconfig.server.json?raw';
import template29 from '../templates/node/vite.config.ts?raw';
import template30 from '../templates/node/web/index.html?raw';
import template31 from '../templates/node/web/main.tsx?raw';
import template32 from '../templates/node/web/styles.css?raw';

export const nodeTemplates: readonly (readonly [string, string])[] = [
  ['.env.example', template0],
  ['.gitattributes', template1],
  ['.gitignore', template2],
  ['.node-version', template3],
  ['.npmrc', template4],
  ['AGENTS.md', template5],
  ['README.md', template6],
  ['db/migrations/0001_welcome.sql', template7],
  ['docs/ARCHITECTURE.md', template8],
  ['docs/CODING_STANDARDS.md', template9],
  ['docs/DEPENDENCIES.md', template10],
  ['docs/REQUIREMENTS.md', template11],
  ['eslint.config.js', template12],
  ['package.json', template13],
  ['pnpm-lock.yaml', template14],
  ['server/app.ts', template15],
  ['server/config.ts', template16],
  ['server/controller.ts', template17],
  ['server/database.ts', template18],
  ['server/middleware.ts', template19],
  ['server/migrate.ts', template20],
  ['server/migrations.ts', template21],
  ['server/repository.ts', template22],
  ['server/routes.ts', template23],
  ['server/server.ts', template24],
  ['server/service.ts', template25],
  ['test/http.test.ts', template26],
  ['tsconfig.json', template27],
  ['tsconfig.server.json', template28],
  ['vite.config.ts', template29],
  ['web/index.html', template30],
  ['web/main.tsx', template31],
  ['web/styles.css', template32],
];
