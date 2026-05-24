import { readFileSync } from 'fs';
import { visit } from 'unist-util-visit';

// ── BibTeX parser ────────────────────────────────────────────────────────────

function extractBraceValue(content, startIdx) {
  let depth = 0;
  let i = startIdx;
  let value = '';
  while (i < content.length) {
    const ch = content[i];
    if (ch === '{') {
      depth++;
      if (depth > 1) value += ch;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return [value, i + 1];
      value += ch;
    } else {
      value += ch;
    }
    i++;
  }
  return [value, i];
}

function stripBraces(str) {
  let s = str;
  let prev;
  do {
    prev = s;
    s = s.replace(/\{([^{}]*)\}/g, '$1');
  } while (s !== prev);
  return s;
}

function parseFields(content) {
  const fields = {};
  let i = 0;
  while (i < content.length) {
    while (i < content.length && /[\s,]/.test(content[i])) i++;
    if (i >= content.length) break;

    const eqIdx = content.indexOf('=', i);
    if (eqIdx === -1) break;

    const fieldName = content.slice(i, eqIdx).trim().toLowerCase();
    if (!fieldName.match(/^[a-z]\w*$/)) { i = eqIdx + 1; continue; }

    let vs = eqIdx + 1;
    while (vs < content.length && /[ \t]/.test(content[vs])) vs++;
    if (vs >= content.length) break;

    let value = '';
    let valueEnd;
    if (content[vs] === '{') {
      [value, valueEnd] = extractBraceValue(content, vs);
    } else if (content[vs] === '"') {
      valueEnd = content.indexOf('"', vs + 1);
      if (valueEnd === -1) break;
      value = content.slice(vs + 1, valueEnd);
      valueEnd++;
    } else {
      valueEnd = vs;
      while (valueEnd < content.length && content[valueEnd] !== ',' && content[valueEnd] !== '\n') valueEnd++;
      value = content.slice(vs, valueEnd).trim();
    }

    fields[fieldName] = stripBraces(value).trim();
    i = valueEnd;
  }
  return fields;
}

function parseBibTeX(bibContent) {
  const entries = {};
  let i = 0;
  while (i < bibContent.length) {
    const atIdx = bibContent.indexOf('@', i);
    if (atIdx === -1) break;
    const braceIdx = bibContent.indexOf('{', atIdx);
    if (braceIdx === -1) break;

    const entryType = bibContent.slice(atIdx + 1, braceIdx).trim().toLowerCase();
    // Skip special entries
    if (['comment', 'string', 'preamble'].includes(entryType)) {
      let depth = 1, j = braceIdx + 1;
      while (j < bibContent.length && depth > 0) {
        if (bibContent[j] === '{') depth++;
        else if (bibContent[j] === '}') depth--;
        j++;
      }
      i = j;
      continue;
    }

    let keyEnd = braceIdx + 1;
    while (keyEnd < bibContent.length && bibContent[keyEnd] !== ',' && bibContent[keyEnd] !== '}' && bibContent[keyEnd] !== '\n') keyEnd++;
    const key = bibContent.slice(braceIdx + 1, keyEnd).trim();

    let depth = 1, j = braceIdx + 1;
    while (j < bibContent.length && depth > 0) {
      if (bibContent[j] === '{') depth++;
      else if (bibContent[j] === '}') depth--;
      j++;
    }

    if (key) entries[key] = parseFields(bibContent.slice(keyEnd, j - 1));
    i = j;
  }
  return entries;
}

// ── Reference formatting ─────────────────────────────────────────────────────

function formatAuthors(authorStr) {
  if (!authorStr) return '';
  const authors = authorStr.split(/\s+and\s+/).map(a => {
    a = a.trim();
    const commaIdx = a.indexOf(',');
    if (commaIdx >= 0) {
      const last = a.slice(0, commaIdx).trim();
      const first = a.slice(commaIdx + 1).trim();
      const initials = first.split(/\s+/).filter(n => n).map(n => n[0].toUpperCase() + '.').join(' ');
      return `${initials} ${last}`;
    }
    return a;
  });
  if (authors.length > 3) return `${authors[0]} et al.`;
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
  return authors.join(', ');
}

function formatReference(num, key, entry) {
  if (!entry) return `[${num}] <em>Unknown key:</em> ${key}`;

  const authors = formatAuthors(entry.author);
  const title = entry.title || '(no title)';
  const year = entry.year || '';
  const venue = entry.journal || entry.booktitle || entry.institution || entry.publisher || '';

  let ref = `[${num}]`;
  if (authors) ref += ` ${authors},`;
  ref += ` &ldquo;${title},&rdquo;`;
  if (venue) ref += ` <em>${venue}</em>,`;
  if (entry.volume) ref += ` vol. ${entry.volume},`;
  if (entry.number) ref += ` no. ${entry.number},`;
  if (entry.pages) ref += ` pp. ${entry.pages.replace(/--+/g, '–')},`;
  if (year) ref += ` ${year}.`;

  // Clean up any trailing comma before period
  return ref.replace(/,(\s*\.)/, '$1').trim();
}

// ── Remark plugin ────────────────────────────────────────────────────────────

export function remarkCitations({ bibliography }) {
  const entries = parseBibTeX(readFileSync(bibliography, 'utf8'));

  return (tree) => {
    const citeOrder = [];
    const citeMap = Object.create(null);

    visit(tree, 'text', (node, index, parent) => {
      if (!node.value.includes('[@') || parent == null || index == null) return;

      const citePattern = /\[(@[\w:-]+(?:\s*;\s*@[\w:-]+)*)\]/g;
      const parts = [];
      let lastIdx = 0;
      let match;

      while ((match = citePattern.exec(node.value)) !== null) {
        if (match.index > lastIdx)
          parts.push({ type: 'text', value: node.value.slice(lastIdx, match.index) });

        const keys = match[1].split(';').map(k => k.trim().replace(/^@/, ''));
        const nums = keys.map(key => {
          if (!(key in citeMap)) { citeOrder.push(key); citeMap[key] = citeOrder.length; }
          return citeMap[key];
        });
        parts.push({ type: 'html', value: `<span class="cite">[${nums.join(', ')}]</span>` });
        lastIdx = match.index + match[0].length;
      }

      if (parts.length === 0) return;
      if (lastIdx < node.value.length)
        parts.push({ type: 'text', value: node.value.slice(lastIdx) });

      parent.children.splice(index, 1, ...parts);
      return [visit.SKIP, index + parts.length];
    });

    if (citeOrder.length === 0) return;

    tree.children.push(
      { type: 'thematicBreak' },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'References' }] },
      {
        type: 'html',
        value: `<div class="references">\n${
          citeOrder.map((key, i) => `  <p>${formatReference(i + 1, key, entries[key])}</p>`).join('\n')
        }\n</div>`,
      },
    );
  };
}
