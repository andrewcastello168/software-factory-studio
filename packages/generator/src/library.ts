import { PROFILE_TOPICS } from '@factory/contracts';
import type { LibrarySelection } from '@factory/contracts';
import shell from '../templates/business/BusinessShell.tsx?raw';
import css from '../templates/business/business.css?raw';

export function normalizeLibrary(input: LibrarySelection): LibrarySelection {
  const { profile, template, branding } = input;
  return {
    profile: { kind: profile.kind, id: profile.id, version: profile.version, name: profile.name,
      advice: Object.fromEntries(PROFILE_TOPICS.flatMap((topic) => profile.advice[topic] ? [[topic, profile.advice[topic]]] : [])) },
    ...(template ? { template: { kind: template.kind, id: template.id, version: template.version, name: template.name,
      color: template.color, theme: template.theme, mark: template.mark } } : {}),
    ...(branding ? { branding: { color: branding.color, theme: branding.theme, mark: branding.mark } } : {}),
  };
}

export function libraryFiles(input: LibrarySelection, project: string, baseline = 'Node, TypeScript, Express, React, Vite and PostgreSQL with Layered Web conventions') {
  const { profile, template, branding } = input;
  const selected = branding ?? template;
  const mark = selected?.mark || [...project].filter((char) => /[\p{L}\p{N}]/u.test(char)).slice(0, 2).join('').toUpperCase();
  const guidance = '# Engineering profile\n\n' + profile.name + ', version ' + profile.version
    + '\n\nThe baseline enforces ' + baseline + '. '
    + 'See ARCHITECTURE.md and CODING_STANDARDS.md for the implemented baseline. '
    + 'The guidance below is advisory and leaves the client requirements in REQUIREMENTS.md.\n\n'
    + PROFILE_TOPICS.flatMap((topic) => {
      const advice = profile.advice[topic];
      return advice ? ['## ' + topic + '\n\n' + advice + '\n'] : [];
    }).join('\n');
  return {
    files: template ? [['web/features/business/BusinessShell.tsx', shell], ['web/features/business/business.css', css]] as const : [],
    guidance,
    values: { BRANDCOLOR: selected?.color ?? '#2458a4', BRANDTHEME: JSON.stringify(selected?.theme ?? 'system'), BRANDMARK: JSON.stringify(mark) },
  };
}
