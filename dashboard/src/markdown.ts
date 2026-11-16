import MarkdownIt from 'markdown-it';

// Same renderer settings as the server: raw HTML in a note never becomes markup.
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

export function renderMarkdown(source: string): string {
  return md.render(source);
}
