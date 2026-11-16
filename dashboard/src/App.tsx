import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api';
import { renderMarkdown } from './markdown';
import {
  EMPTY_FILTERS,
  KINDS,
  filtersFromUrl,
  filtersToQuery,
  plainExcerpt,
  stamp,
  tagsOf,
  type Entry,
  type Filters,
  type Kind,
  type TagCount,
} from './types';

type LoadState = 'loading' | 'ready' | 'error';

interface Draft {
  id: number | null;
  kind: Kind;
  title: string;
  tags: string;
  body: string;
}

interface Toast {
  text: string;
  kind: 'info' | 'error';
  key: number;
}

/** Read once at module load: the filter effect rewrites the URL on mount and would drop it. */
const DEEP_LINK_ENTRY = (() => {
  const raw = new URLSearchParams(window.location.search).get('entry');
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
})();

function emptyDraft(): Draft {
  return { id: null, kind: 'task', title: '', tags: '', body: '' };
}

function draftOf(entry: Entry): Draft {
  return { id: entry.id, kind: entry.kind, title: entry.title, tags: entry.tags, body: entry.body };
}

function excerptOf(entry: Entry): string {
  return plainExcerpt(entry.body, 160);
}

export default function App() {
  const [filters, setFilters] = useState<Filters>(() => filtersFromUrl(window.location.search));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [errorText, setErrorText] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [railOpen, setRailOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
  );

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const notify = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    setToast({ text, kind, key: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // The URL is the filter state, so a bookmark of ?tag=docker reloads the same view.
  useEffect(() => {
    const query = filtersToQuery(filters);
    const next = `${window.location.pathname}${query}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', next);
    }
  }, [filters]);

  useEffect(() => {
    const onPop = () => setFilters(filtersFromUrl(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setErrorText('');

    Promise.all([api.listEntries(filters, controller.signal), api.listTags(controller.signal)])
      .then(([list, tagResult]) => {
        setEntries(list.entries);
        setTags(tagResult.tags);
        setState('ready');
        setSelectedId((current) =>
          current !== null && list.entries.some((entry) => entry.id === current) ? current : null,
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setErrorText(error instanceof Error ? error.message : 'Gagal memuat catatan.');
        setState('error');
      });

    return () => controller.abort();
  }, [filters, reloadKey]);

  // /admin?entry=7 is what the entry page's "ubah" link points at: open that note in the editor.
  useEffect(() => {
    if (DEEP_LINK_ENTRY === null) return;
    api
      .getEntry(DEEP_LINK_ENTRY)
      .then((entry) => {
        setDraft(draftOf(entry));
        setPreview(false);
        window.history.replaceState(null, '', '/admin' + filtersToQuery(filters));
      })
      .catch(() => notify('Catatan yang mau diubah tidak ditemukan.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? null,
    [entries, selectedId],
  );

  const openEditor = useCallback((entry: Entry | null) => {
    setDraft(entry ? draftOf(entry) : emptyDraft());
    setPreview(false);
    window.setTimeout(() => titleRef.current?.focus(), 0);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem('notulen-theme', next);
    } catch {
      /* private mode: the choice just does not persist */
    }
    setTheme(next);
  }, [theme]);

  const pin = useCallback(
    async (entry: Entry) => {
      const optimistic = entry.pinned ? 0 : 1;
      setEntries((rows) =>
        rows.map((row) => (row.id === entry.id ? { ...row, pinned: optimistic } : row)),
      );
      try {
        const updated = await api.togglePin(entry.id);
        setEntries((rows) => rows.map((row) => (row.id === entry.id ? updated : row)));
      } catch (error) {
        setEntries((rows) =>
          rows.map((row) => (row.id === entry.id ? { ...row, pinned: entry.pinned } : row)),
        );
        notify(
          `Gagal menyematkan "${entry.title}". ${error instanceof Error ? error.message : ''}`.trim(),
          'error',
        );
      }
    },
    [notify],
  );

  const remove = useCallback(
    async (entry: Entry) => {
      const ok = window.confirm(`Hapus "${entry.title}"? Tindakan ini tidak bisa dibatalkan.`);
      if (!ok) return;
      const index = entries.findIndex((row) => row.id === entry.id);
      setEntries((rows) => rows.filter((row) => row.id !== entry.id));
      if (selectedId === entry.id) setSelectedId(null);
      try {
        await api.deleteEntry(entry.id);
        notify(`"${entry.title}" dihapus.`);
        setReloadKey((key) => key + 1);
      } catch (error) {
        setEntries((rows) => {
          const next = [...rows];
          next.splice(Math.max(0, index), 0, entry);
          return next;
        });
        notify(
          `Gagal menghapus "${entry.title}". ${error instanceof Error ? error.message : ''}`.trim(),
          'error',
        );
      }
    },
    [entries, notify, selectedId],
  );

  const save = useCallback(async () => {
    if (!draft || saving) return;
    if (!draft.title.trim()) {
      notify('Judul tidak boleh kosong.', 'error');
      titleRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const payload = {
        kind: draft.kind,
        title: draft.title.trim(),
        body: draft.body,
        tags: draft.tags,
      };
      if (draft.id === null) {
        const created = await api.createEntry(payload);
        notify('Catatan disimpan.');
        setDraft(null);
        setSelectedId(created.id);
      } else {
        const updated = await api.updateEntry(draft.id, payload);
        setEntries((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
        notify('Perubahan disimpan.');
        setDraft(null);
      }
      setReloadKey((key) => key + 1);
    } catch (error) {
      notify(
        `Gagal menyimpan. ${error instanceof Error ? error.message : 'Coba lagi.'}`.trim(),
        'error',
      );
    } finally {
      setSaving(false);
    }
  }, [draft, notify, saving]);

  // Global shortcuts: / focuses search, Escape leaves the editor, Ctrl/Cmd+Enter saves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && draft) {
        event.preventDefault();
        void save();
        return;
      }
      if (event.key === 'Escape' && draft) {
        event.preventDefault();
        setDraft(null);
        return;
      }
      if (event.key === '/' && !typing && !draft) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, save]);

  const onListKey = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      if (!selected || draft) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        window.location.href = `/entry/${selected.id}`;
      } else if (event.key === 'e') {
        event.preventDefault();
        openEditor(selected);
      } else if (event.key === 'p') {
        event.preventDefault();
        void pin(selected);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        void remove(selected);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const index = entries.findIndex((entry) => entry.id === selected.id);
        const nextIndex = event.key === 'ArrowDown' ? index + 1 : index - 1;
        const next = entries[nextIndex];
        if (next) setSelectedId(next.id);
      }
    },
    [draft, entries, openEditor, pin, remove, selected],
  );

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  // On a phone the rail is a panel; choosing a filter closes it so the list is visible.
  const setFilterAndClose = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilter(key, value);
    setRailOpen(false);
  };

  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const filtered = filters.kind || filters.tag || filters.q.trim() !== '' || filters.pinned;
  const activeTag = filters.tag;

  return (
    <div className="shell">
      <header className="topbar">
        <a className="wordmark" href="/">
          notulen
        </a>
        <span className="where">/ tulis</span>
        <span className="spacer" />
        <button
          className="rail-toggle"
          type="button"
          aria-expanded={railOpen}
          aria-controls="filter-rail"
          onClick={() => setRailOpen((open) => !open)}
        >
          saringan
        </button>
        <button className="plain" type="button" onClick={toggleTheme}>
          tema: {theme === 'dark' ? 'gelap' : 'terang'}
        </button>
        <a className="plain to-list" href="/">
          lihat catatan
        </a>
      </header>

      <div className="panes">
        <aside
          className="rail"
          id="filter-rail"
          aria-label="Saringan"
          data-open={railOpen ? 'true' : 'false'}
        >
          <div className="group group-search">
            <label className="group-label" htmlFor="search">
              cari
            </label>
            <input
              id="search"
              ref={searchRef}
              type="search"
              value={filters.q}
              placeholder="judul, tag, isi"
              onChange={(event) => setFilter('q', event.target.value)}
            />
          </div>

          <div className="group">
            <span className="group-label">jenis</span>
            <button
              type="button"
              className="kind-btn"
              aria-pressed={filters.kind === ''}
              onClick={() => setFilterAndClose('kind', '')}
            >
              semua
            </button>
            {KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="kind-btn"
                aria-pressed={filters.kind === kind}
                onClick={() => setFilterAndClose('kind', filters.kind === kind ? '' : kind)}
              >
                {kind}
              </button>
            ))}
          </div>

          <div className="group group-tags">
            <span className="group-label">tag</span>
            <div className="tag-scroll">
              {tags.length === 0 ? (
                <p className="hint">belum ada tag</p>
              ) : (
                tags.map((tag) => (
                  <button
                    key={tag.tag}
                    type="button"
                    className="tag-btn"
                    aria-pressed={activeTag === tag.tag}
                    onClick={() => setFilterAndClose('tag', activeTag === tag.tag ? '' : tag.tag)}
                  >
                    <span>{tag.tag}</span>
                    <span className="n">{tag.count}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="group group-pinned">
            <label className="check">
              <input
                type="checkbox"
                checked={filters.pinned}
                onChange={(event) => setFilter('pinned', event.target.checked)}
              />
              hanya disematkan
            </label>
            {filtered ? (
              <button type="button" className="btn quiet" onClick={clearFilters}>
                hapus saringan
              </button>
            ) : null}
          </div>

          <div className="group">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRailOpen(false);
                openEditor(null);
              }}
            >
              catatan baru
            </button>
          </div>
        </aside>

        <section className="work" aria-label="Daftar catatan">
          {draft ? (
            <Editor
              draft={draft}
              preview={preview}
              saving={saving}
              titleRef={titleRef}
              onChange={setDraft}
              onPreview={setPreview}
              onSave={() => void save()}
              onCancel={() => setDraft(null)}
            />
          ) : (
            <>
              <div className="list-head">
                <h1>catatan</h1>
                <span className="count">{entries.length}</span>
                <span className="spacer" />
                <span className="hint">enter buka / e ubah / p sematkan / del hapus / / cari</span>
              </div>

              {state === 'loading' ? (
                <div aria-busy="true" aria-live="polite">
                  <p className="hint">memuat catatan</p>
                  {[0, 1, 2].map((i) => (
                    <div className="skeleton" key={i}>
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              ) : state === 'error' ? (
                <div className="state error" role="alert">
                  <p>{errorText}</p>
                  <button
                    type="button"
                    className="btn quiet"
                    onClick={() => setReloadKey((key) => key + 1)}
                  >
                    coba lagi
                  </button>
                </div>
              ) : entries.length === 0 ? (
                <div className="state">
                  <p>
                    {filtered
                      ? 'Tidak ada catatan yang cocok dengan saringan ini. Hapus saringan untuk melihat semuanya.'
                      : 'Belum ada catatan. Mulai dengan satu baris tentang apa yang sedang kamu kerjakan.'}
                  </p>
                  {filtered ? (
                    <button type="button" className="btn quiet" onClick={clearFilters}>
                      hapus saringan
                    </button>
                  ) : (
                    <button type="button" className="btn" onClick={() => openEditor(null)}>
                      catatan baru
                    </button>
                  )}
                </div>
              ) : (
                <ul
                  className="rows"
                  ref={listRef}
                  tabIndex={0}
                  onKeyDown={onListKey}
                  aria-label="Catatan"
                >
                  {entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="row"
                      aria-selected={selectedId === entry.id}
                      onClick={() => setSelectedId(entry.id)}
                      onDoubleClick={() => openEditor(entry)}
                    >
                      <div className="row-main">
                        <div className="row-meta">
                          <span className="kind">{entry.kind}</span>
                          {entry.pinned ? <span className="pin-mark">disematkan</span> : null}
                          <span className="kind">{stamp(entry.created_at)}</span>
                        </div>
                        <p className="row-title">{entry.title}</p>
                        {excerptOf(entry) ? <p className="row-excerpt">{excerptOf(entry)}</p> : null}
                        {tagsOf(entry).length > 0 ? (
                          <ul className="row-tags">
                            {tagsOf(entry).map((tag) => (
                              <li key={tag} className="chip">
                                {tag}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Sematkan ${entry.title}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void pin(entry);
                          }}
                        >
                          {entry.pinned ? 'lepas' : 'semat'}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Ubah ${entry.title}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditor(entry);
                          }}
                        >
                          ubah
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Hapus ${entry.title}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void remove(entry);
                          }}
                        >
                          hapus
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>

      {toast ? (
        <div className="toast" role="status" data-kind={toast.kind} key={toast.key}>
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}

interface EditorProps {
  draft: Draft;
  preview: boolean;
  saving: boolean;
  titleRef: React.RefObject<HTMLInputElement>;
  onChange: (draft: Draft) => void;
  onPreview: (value: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
}

function Editor({ draft, preview, saving, titleRef, onChange, onPreview, onSave, onCancel }: EditorProps) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });

  return (
    <div className="editor">
      <div className="editor-head">
        <h1>{draft.id === null ? 'catatan baru' : 'ubah catatan'}</h1>
        <span className="spacer" />
        <span className="hint">ctrl / cmd + enter untuk simpan</span>
      </div>

      <div className="field">
        <label htmlFor="title">judul</label>
        <input
          id="title"
          ref={titleRef}
          type="text"
          value={draft.title}
          onChange={(event) => set('title', event.target.value)}
          placeholder="apa yang perlu diingat"
        />
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="kind">jenis</label>
          <select
            id="kind"
            value={draft.kind}
            onChange={(event) => set('kind', event.target.value as Kind)}
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tags">tag</label>
          <input
            id="tags"
            type="text"
            value={draft.tags}
            onChange={(event) => set('tags', event.target.value)}
            placeholder="docker, backup"
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="body">isi</label>
        <div className="segmented" role="group" aria-label="Mode isi">
          <button type="button" aria-pressed={!preview} onClick={() => onPreview(false)}>
            tulis
          </button>
          <button type="button" aria-pressed={preview} onClick={() => onPreview(true)}>
            pratinjau
          </button>
        </div>
      </div>

      {preview ? (
        <div
          className="preview"
          // markdown-it runs with html:false, so this cannot carry raw markup from a note
          dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.body) }}
        />
      ) : (
        <textarea
          id="body"
          value={draft.body}
          onChange={(event) => set('body', event.target.value)}
          placeholder={'# judul kecil\n\n- langkah satu\n- langkah dua\n\n```bash\nsystemctl restart nginx\n```'}
          spellCheck={false}
        />
      )}

      <div className="editor-foot">
        <button type="button" className="btn" onClick={onSave} disabled={saving}>
          {saving ? 'menyimpan' : 'simpan'}
        </button>
        <button type="button" className="btn quiet" onClick={onCancel}>
          batal
        </button>
        <span className="spacer" />
        <span className="hint">esc untuk keluar</span>
      </div>
    </div>
  );
}
