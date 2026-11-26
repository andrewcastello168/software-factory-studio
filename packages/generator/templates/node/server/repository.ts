import type { Pool } from 'pg';

export interface WelcomeRepository {
  find(variant: 'default' | 'short'): Promise<string | undefined>;
}

export function createWelcomeRepository(pool: Pool): WelcomeRepository {
  return {
    async find(variant) {
      const { rows } = await pool.query<{ message: string }>(
        'SELECT message FROM welcome_messages WHERE variant = $1',
        [variant],
      );
      return rows[0]?.message;
    },
  };
}
