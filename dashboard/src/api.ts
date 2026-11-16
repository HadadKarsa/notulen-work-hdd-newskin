import type { Entry, Filters, TagCount } from './types';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // Only declare JSON when there is a body: Fastify rejects an empty body sent
  // with content-type: application/json, which is exactly what pin and delete are.
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Permintaan gagal (${response.status}).`;
    throw new ApiError(response.status, message);
  }

  return payload as T;
}

export function listEntries(filters: Filters, signal?: AbortSignal): Promise<{ entries: Entry[] }> {
  const params = new URLSearchParams();
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.pinned) params.set('pinned', '1');
  params.set('limit', '200');
  return request<{ entries: Entry[] }>(`/api/entries?${params.toString()}`, { signal });
}

export function getEntry(id: number, signal?: AbortSignal): Promise<Entry> {
  return request<Entry>(`/api/entries/${id}`, { signal });
}

export function listTags(signal?: AbortSignal): Promise<{ tags: TagCount[] }> {
  return request<{ tags: TagCount[] }>('/api/tags', { signal });
}

export interface EntryInput {
  kind: string;
  title: string;
  body: string;
  tags: string;
  pinned?: boolean;
}

export function createEntry(input: EntryInput): Promise<Entry> {
  return request<Entry>('/api/entries', { method: 'POST', body: JSON.stringify(input) });
}

export function updateEntry(id: number, input: Partial<EntryInput>): Promise<Entry> {
  return request<Entry>(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteEntry(id: number): Promise<void> {
  return request<void>(`/api/entries/${id}`, { method: 'DELETE' });
}

export function togglePin(id: number): Promise<Entry> {
  return request<Entry>(`/api/entries/${id}/pin`, { method: 'POST' });
}
