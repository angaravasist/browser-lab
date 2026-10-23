import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../../../tests/fixtures/site/fixture.js', import.meta.url), 'utf8');

describe('fixture HTML injection regression', () => {
  it('shows query and uploaded file name as text, and navigates with encoded values', () => {
    let nextUrl = '';
    let onChange: ((event: { target: { files: Array<{ name: string; size: number }> } }) => void) | undefined;
    const query = { textContent: '', set innerHTML(_s: string) { throw new Error('HTML injection'); } };
    const status = { textContent: '', set innerHTML(_s: string) { throw new Error('HTML injection'); } };
    const nodes = new Map<string, object>([
      ['query', query], ['status', status],
      ['file', { addEventListener(_event: string, fn: typeof onChange) { onChange = fn; } }],
    ]);
    const url = new URL('http://app:3000/fixture/index.html?query=%3Cimg%20src%3Dx%3E');
    runInNewContext(script, {
      URL, URLSearchParams,
      location: { href: url.href, search: url.search, assign(href: string) { nextUrl = href; } },
      document: { getElementById: (id: string) => nodes.get(id) ?? null,
        documentElement: { style: { setProperty() {} } } },
    });
    expect(query.textContent).toContain('%3Cimg');
    expect(query.textContent).not.toContain('<img');
    expect(onChange).toBeTypeOf('function');
    const filename = '<svg onload=alert(1)>.txt';
    onChange!({ target: { files: [{ name: filename, size: 42 }] } });
    expect(status.textContent).toBe(`Selected file: ${filename}`);
    const dest = new URL(nextUrl);
    expect(dest.pathname).toBe('/fixture/page2.html');
    expect(dest.searchParams.get('uploaded')).toBe(filename);
    expect(dest.searchParams.get('size')).toBe('42');
    expect(nextUrl).not.toContain('<svg');
  });
});
