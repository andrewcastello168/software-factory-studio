export interface Actor { id: string; email: string; display_name: string; administrator: boolean; permissions: string[] }
export interface PageData<T> { rows: T[]; hasMore: boolean }
export type RequestJson = <T>(path: string, method?: string, body?: object, signal?: AbortSignal) => Promise<T>;

export const request: RequestJson = async <T,>(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> => {
  const response = await fetch('/api' + path, {
    method, ...(signal ? { signal } : {}),
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json() as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new RequestError(response.status, result.error?.message ?? 'The request failed.');
  return result.data as T;
};

export class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const allowed = (actor: Actor, permission: string) => actor.administrator || actor.permissions.includes(permission);
