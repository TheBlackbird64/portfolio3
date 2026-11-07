import { escapeHtml } from '../core/util';

const KEYWORDS: Record<string, Set<string>> = {
  go: new Set('func return if err nil for range defer var const type struct interface package import go select case switch default break continue map chan else'.split(' ')),
  rust: new Set('pub async fn let mut for in await return if else match impl struct enum use mod self Self where as move ref const static loop while Ok Err Some None'.split(' ')),
  kotlin: new Set('suspend fun val var if else return require null when is in object class data sealed override private public internal true false'.split(' ')),
};

const TOKEN = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*")|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_]\w*!?)|(\s+)|([\s\S])/g;

/** Tiny, dependency-free highlighter. Returns one <span class="ln"> per line. */
export function highlight(source: string, lang: string): string {
  const kw = KEYWORDS[lang] ?? new Set<string>();
  const lines: string[] = [''];
  const push = (text: string, cls?: string) => {
    const parts = text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push('');
      if (!part) return;
      const html = escapeHtml(part);
      lines[lines.length - 1] += cls ? `<span class="tk-${cls}">${html}</span>` : html;
    });
  };

  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(source))) {
    const [all, comment, str, num, ident, space] = m;
    if (comment) push(comment, 'com');
    else if (str) push(str, 'str');
    else if (num) push(num, 'num');
    else if (ident) {
      const next = source[TOKEN.lastIndex];
      if (kw.has(ident)) push(ident, 'kw');
      else if (next === '(') push(ident, 'fn');
      else if (/^[A-Z]/.test(ident)) push(ident, 'type');
      else push(ident);
    } else if (space) push(space);
    else push(all, /[{}()[\]]/.test(all) ? 'pun' : 'op');
  }

  return lines.map((l, i) => `<span class="ln"><span class="ln__n">${i + 1}</span>${l || ' '}</span>`).join('');
}
