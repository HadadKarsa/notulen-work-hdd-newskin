export const KINDS = ['task', 'tutorial', 'command', 'sop', 'workflow', 'meeting'] as const;
export type Kind = (typeof KINDS)[number];

export interface Entry {
  id: number;
  kind: Kind;
  title: string;
  body: string;
  tags: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface Filters {
  kind: string;
  tag: string;
  q: string;
  pinned: boolean;
}

export const EMPTY_FILTERS: Filters = { kind: '', tag: '', q: '', pinned: false };

export function tagsOf(entry: Entry): string[] {
  return entry.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** One line of plain prose for a row excerpt: markdown syntax is noise there. */
export function plainExcerpt(body: string, max: number): string {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, max);
}

export function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function filtersFromUrl(search: string): Filters {
  const params = new URLSearchParams(search);
  const kind = params.get('kind') ?? '';
  return {
    kind: (KINDS as readonly string[]).includes(kind) ? kind : '',
    tag: params.get('tag') ?? '',
    q: params.get('q') ?? '',
    pinned: params.get('pinned') === '1',
  };
}

export function filtersToQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.pinned) params.set('pinned', '1');
  const query = params.toString();
  return query ? `?${query}` : '';
}
