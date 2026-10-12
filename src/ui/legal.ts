// The privacy and terms pages' text (docs/PRIVACY.md, docs/TERMS.md: one copy, readable on GitHub
// too) as HTML for the game's pages. Only what those files use: `#` and `##` headings, paragraphs,
// `- ` bullets, **bold** and [links](…). Every piece goes through `esc`, so the files can't put
// markup on the page, and a link that isn't https or mailto is just its words.

import { esc } from './html';

/** One line's text: escaped, then its bold and links. */
function inline(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, words: string, url: string) =>
      /^(https:|mailto:)/.test(url) ? `<a href="${url}" target="_blank" rel="noopener">${words}</a>` : words,
    );
}

/** A doc as HTML: blocks split on blank lines; a block of `- ` lines is a list. */
export function renderDoc(md: string): string {
  return md
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim());
      if (lines[0].startsWith('## ')) return `<h2>${inline(lines[0].slice(3))}</h2>`;
      if (lines[0].startsWith('# ')) return `<h1>${inline(lines[0].slice(2))}</h1>`;
      if (lines.every((l) => l.startsWith('- '))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
      return `<p>${inline(lines.join(' '))}</p>`;
    })
    .join('');
}
