import { useState, useMemo } from 'react';

export interface ArticleItem {
  id: string;
  title: string;
  description?: string;
  date?: string;   // ISO string — serialized from Date
  tags: string[];
  href: string;
}

interface Props {
  articles: ArticleItem[];
  accentVar?: string;   // CSS custom property name, e.g. '--color-sepia'
  emptyMsg?: string;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ListRow({ a, accent }: { a: ArticleItem; accent: string }) {
  const [hov, setHov] = useState(false);
  return (
    <a
      href={a.href}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gridTemplateRows: 'auto auto',
        gap: '0.2rem 1rem',
        padding: '1rem 1.25rem',
        background: `color-mix(in srgb, ${accent} ${hov ? 16 : 7}%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} ${hov ? 55 : 28}%, transparent)`,
        borderRadius: '4px',
        textDecoration: 'none',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', color: 'var(--color-ink)', gridColumn: 1, gridRow: 1 }}>
        {a.title}
      </span>
      {a.description && (
        <span style={{ fontSize: '0.85rem', color: 'var(--color-ink-faded)', fontStyle: 'italic', gridColumn: 1, gridRow: 2 }}>
          {a.description}
        </span>
      )}
      {a.date && (
        <time style={{ fontSize: '0.72rem', color: 'var(--color-ink-faded)', gridColumn: 2, gridRow: 1, alignSelf: 'center', whiteSpace: 'nowrap' }}>
          {fmt(a.date)}
        </time>
      )}
    </a>
  );
}

function GridCard({ a, accent }: { a: ArticleItem; accent: string }) {
  const [hov, setHov] = useState(false);
  return (
    <a
      href={a.href}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        padding: '1.25rem',
        background: `color-mix(in srgb, ${accent} ${hov ? 16 : 7}%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} ${hov ? 55 : 28}%, transparent)`,
        borderRadius: '6px',
        textDecoration: 'none',
        transition: 'background 0.15s, border-color 0.15s',
        minHeight: '110px',
      }}
    >
      <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', color: 'var(--color-ink)', lineHeight: 1.3 }}>
        {a.title}
      </span>
      {a.description && (
        <span style={{ fontSize: '0.82rem', color: 'var(--color-ink-faded)', fontStyle: 'italic', flex: 1 }}>
          {a.description}
        </span>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
        {a.date && <time style={{ fontSize: '0.7rem', color: 'var(--color-ink-faded)' }}>{fmt(a.date)}</time>}
        {a.tags[0] && <span style={{ fontSize: '0.7rem', color: 'var(--color-ink-faded)', fontStyle: 'italic' }}>#{a.tags[0]}</span>}
      </div>
    </a>
  );
}

export default function ArticleGrid({ articles, accentVar = '--color-sepia', emptyMsg = 'No articles yet.' }: Props) {
  const [view, setView]       = useState<'list' | 'grid'>('list');
  const [search, setSearch]   = useState('');
  const [activeTag, setTag]   = useState<string | null>(null);

  const accent = `var(${accentVar})`;

  const allTags = useMemo(() => {
    const s = new Set<string>();
    articles.forEach((a) => a.tags.forEach((t) => s.add(t)));
    return [...s].sort();
  }, [articles]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return articles.filter((a) => {
      const mSearch = !q
        || a.title.toLowerCase().includes(q)
        || (a.description?.toLowerCase().includes(q) ?? false)
        || a.tags.some((t) => t.toLowerCase().includes(q));
      const mTag = !activeTag || a.tags.includes(activeTag);
      return mSearch && mTag;
    });
  }, [articles, search, activeTag]);

  const btnBase: React.CSSProperties = {
    padding: '0.28em 0.75em',
    fontSize: '0.73rem',
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    fontFamily: 'var(--font-body)',
    border: `1px solid ${accent}`,
    borderRadius: '3px',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  };

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'center', marginBottom: '1.1rem', flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: '150px',
            padding: '0.38em 0.75em',
            background: 'var(--color-parchment)',
            color: 'var(--color-ink)',
            border: '1px solid var(--color-sepia)',
            borderRadius: '3px',
            fontFamily: 'var(--font-body)',
            fontSize: '0.9rem',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          {(['list', 'grid'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                ...btnBase,
                background: view === v ? accent : 'transparent',
                color:      view === v ? 'var(--color-parchment)' : accent,
              }}
            >
              {v === 'list' ? '≡ List' : '⊞ Grid'}
            </button>
          ))}
        </div>
      </div>

      {/* Tag chips */}
      {allTags.length > 0 && (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '1.4rem' }}>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setTag(activeTag === tag ? null : tag)}
              style={{
                ...btnBase,
                padding: '0.18em 0.55em',
                background: activeTag === tag ? accent : 'transparent',
                color:      activeTag === tag ? 'var(--color-parchment)' : 'var(--color-ink-faded)',
                borderColor: `color-mix(in srgb, ${accent} ${activeTag === tag ? 100 : 40}%, transparent)`,
              }}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* Result count when filtering */}
      {(search || activeTag) && (
        <p style={{ fontSize: '0.78rem', color: 'var(--color-ink-faded)', marginBottom: '0.9rem', fontStyle: 'italic' }}>
          {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'} found
        </p>
      )}

      {/* Articles */}
      {filtered.length === 0 ? (
        <p style={{ color: 'var(--color-ink-faded)', fontStyle: 'italic', padding: '2rem 0' }}>
          {search || activeTag ? 'No matching entries.' : emptyMsg}
        </p>
      ) : view === 'list' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          {filtered.map((a) => <ListRow key={a.id} a={a} accent={accent} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(255px, 1fr))', gap: '0.9rem' }}>
          {filtered.map((a) => <GridCard key={a.id} a={a} accent={accent} />)}
        </div>
      )}
    </div>
  );
}
