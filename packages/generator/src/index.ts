import { createHash } from 'node:crypto';
import { GENERATOR_LIMITS, isGeneratorPath, isProjectId, isStarterConfig, STARTER } from '@factory/contracts';
import type { GeneratorFile, StarterConfig } from '@factory/contracts';
import { nodeTemplates } from './templates';

export interface StarterPlan {
  projectId: string;
  config: StarterConfig;
  digest: string;
  files: GeneratorFile[];
}

export function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

function file(path: string, content: string): GeneratorFile {
  if (!isGeneratorPath(path) || Buffer.byteLength(content) > GENERATOR_LIMITS.fileBytes || content.includes('\0')) {
    throw new Error('Invalid built-in generator output.');
  }
  return { path, content, sha256: sha256(content) };
}

function renderingConfig(config: StarterConfig): StarterConfig {
  const { name, slug, port, appType, stack, architecture, engineering } = config;
  return { name, slug, port, appType, stack, architecture, engineering };
}

export function planProject(input: StarterConfig, projectId: string): StarterPlan {
  if (!isStarterConfig(input) || !isProjectId(projectId)) throw new Error('Unsupported project configuration.');
  const config = renderingConfig(input);
  const versions = {
    generator: STARTER.engineVersion,
    stack: { id: config.stack, version: STARTER.templateVersion, templateSha256: sha256(json(nodeTemplates.map(
      ([path, template]) => [path, sha256(template.replace(/\r\n/gu, '\n'))],
    ))) },
    architecture: { id: config.architecture, version: STARTER.architectureVersion },
    engineering: { id: config.engineering, version: STARTER.engineeringVersion },
  };
  const values: Readonly<Record<string, string>> = {
    NAME: config.name,
    TITLE: JSON.stringify(config.name),
    PORT: String(config.port),
    DATABASE: config.slug.replace(/-/gu, '_'),
  };
  const files = nodeTemplates.map(([path, template]) => {
    const text = template.replace(/\r\n/gu, '\n').replace(/@@([A-Z]+)@@/gu, (_all, key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error('Unknown built-in template parameter.');
      return value;
    });
    if (path !== 'package.json') return file(path, text);
    const manifest = JSON.parse(text) as Record<string, unknown>;
    return file(path, json({ ...manifest, name: config.slug }));
  });
  files.push(
    file('.factory/project.json', json({
      version: 1, id: projectId, name: config.name, type: config.appType, stackId: config.stack, profileId: config.architecture,
    })),
    file('.factory/versions.lock.json', json({ version: 1, ...versions })),
  );
  const fingerprints = () => files.map(({ path, sha256 }) => ({ path, sha256, owner: config.stack, action: 'create' }));
  files.push(file('.factory/generation-manifest.json', json({
    version: 1, projectId, inputsSha256: sha256(json({ projectId, config })), versions, files: fingerprints(),
  })));
  const paths = files.map(({ path }) => path.toLowerCase());
  if (files.length > GENERATOR_LIMITS.files || new Set(paths).size !== paths.length) {
    throw new Error('Duplicate or excessive built-in generator outputs.');
  }
  return { projectId, config, digest: sha256(json({ projectId, config, files: fingerprints() })), files };
}
