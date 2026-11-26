import type { WelcomeRepository } from './repository.ts';

export function readWelcome(repository: WelcomeRepository, variant: 'default' | 'short') {
  return repository.find(variant);
}
