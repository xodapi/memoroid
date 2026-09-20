/* Memoroid test suite
 * Runs with the Node built-in runner:  node --test tests/
 *
 * These tests cover pure logic only. They load app.js with a stubbed DOM so
 * the renderer, date resolver and front matter parser can be exercised
 * without a browser and without refactoring app.js into modules.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP_PATH = path.join(ROOT, 'app.js');

/* --- Minimal DOM stub ------------------------------------------------- */
function makeElement(id) {
  const element = {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    children: [],
    dataset: {},
    style: {},
    classList: {
      add() {}, remove() {}, toggle() {}, contains: () => false
    },
    querySelectorAll: () => [],
    querySelector: () => makeElement(`${id}-child`),
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    addEventListener() {}, append() {}, replaceChildren() {},
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 })
  };
  return element;
}

function loadApp() {
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const store = new Map();
  const document = {
    getElementById(id) {
      if (!store.has(id)) store.set(id, makeElement(id));
      return store.get(id);
    },
    createElement: () => makeElement('created'),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }
  };
  const factory = new Function(
    'document', 'window', 'localStorage', 'navigator', 'URL', 'FileReader',
    'indexedDB', 'Intl', 'TextEncoder', 'globalThis', 'setTimeout', 'clearTimeout',
    `${source}\nreturn { escapeHtml, inline, renderMarkdown, frontMatterMeta, parseDateValue, filenameDate, documentDate, formatDocumentDate, documentTitle, toggleTaskLine, searchTokens, normalizeSearchText, countWords, getOutput: () => document.getElementById('markdownOutput').innerHTML };`
  );
  const win = { matchMedia: () => ({ matches: false }) };
  const storage = {
    getItem: () => null,
    setItem() {},
    removeItem() {}
  };
  return factory(document, win, storage, {}, {
    createObjectURL: () => 'blob:stub', revokeObjectURL() {}
  }, class {}, { open: () => ({}) }, Intl, TextEncoder, globalThis,
    () => 0, () => {});
}

const app = loadApp();

/* --- Front matter ------------------------------------------------------ */
test('front matter is read only from the leading block', () => {
  const meta = app.frontMatterMeta('---\ntitle: Заметка\ndate: 2026-09-18\n---\n\n# Тело');
  assert.strictEqual(meta.present, true);
  assert.strictEqual(meta.title, 'Заметка');
  assert.ok(meta.date > 0);
});

test('a block that is not at the very start is not front matter', () => {
  const meta = app.frontMatterMeta('текст\n\n---\ndate: 2026-01-01\n---\n');
  assert.strictEqual(meta.present, false);
});

test('unknown front matter keys are ignored', () => {
  const meta = app.frontMatterMeta('---\nfoo: bar\nauthor: someone\n---\nx');
  assert.strictEqual(meta.title, '');
  assert.strictEqual(meta.date, null);
  assert.deepStrictEqual(meta.tags, []);
});

test('tags are parsed from list, inline and bracket forms', () => {
  const list = app.frontMatterMeta('---\ntags:\n  - alpha\n  - beta\n---\nx');
  const inline = app.frontMatterMeta('---\ntags: gamma, delta\n---\nx');
  const brackets = app.frontMatterMeta('---\ntags: [eps, zeta]\n---\nx');
  assert.deepStrictEqual(list.tags, ['alpha', 'beta']);
  assert.deepStrictEqual(inline.tags, ['gamma', 'delta']);
  assert.deepStrictEqual(brackets.tags, ['eps', 'zeta']);
});

test('keywords are accepted as an alias for tags', () => {
  assert.deepStrictEqual(app.frontMatterMeta('---\nkeywords: one, two\n---\nx').tags, ['one', 'two']);
});

test('a malformed front matter block does not throw', () => {
  assert.doesNotThrow(() => app.frontMatterMeta('---\nnot: [valid\n---\ntext'));
  assert.doesNotThrow(() => app.frontMatterMeta(''));
  assert.doesNotThrow(() => app.frontMatterMeta('# Нет front matter'));
});

/* --- Dates ------------------------------------------------------------- */
test('dates are parsed in ISO and Russian formats', () => {
  assert.ok(app.parseDateValue('2026-09-18') > 0);
  assert.ok(app.parseDateValue('18.09.2026') > 0);
  assert.strictEqual(app.parseDateValue('18 сентября 2026'), null);
  assert.strictEqual(app.parseDateValue(''), null);
});

test('dates are always displayed as DD.MM.YYYY', () => {
  assert.strictEqual(app.formatDocumentDate(app.parseDateValue('2026-09-18')), '18.09.2026');
  assert.strictEqual(app.formatDocumentDate(app.parseDateValue('18.09.2026')), '18.09.2026');
  assert.strictEqual(app.formatDocumentDate(0), 'дата неизвестна');
});

test('a date in the filename is recognised', () => {
  assert.ok(app.filenameDate('2020-01-02-old-note.md') > 0);
  assert.strictEqual(app.filenameDate('plain-note.md'), null);
});

test('document date follows the documented priority', () => {
  const fromFrontMatter = { name: '2020-01-01-old.md', source: '---\ndate: 2026-09-18\n---\nx', lastModified: Date.parse('2021-01-01') };
  const fromName = { name: '2020-05-05-old.md', source: '# x', lastModified: Date.parse('2021-01-01') };
  const fromModified = { name: 'plain.md', source: '# x', lastModified: Date.parse('2021-03-04') };
  const fromOpened = { name: 'plain.md', source: '# x', openedAt: Date.parse('2022-02-03') };
  assert.strictEqual(app.formatDocumentDate(app.documentDate(fromFrontMatter)), '18.09.2026');
  assert.strictEqual(app.formatDocumentDate(app.documentDate(fromName)), '05.05.2020');
  assert.strictEqual(app.formatDocumentDate(app.documentDate(fromModified)), '04.03.2021');
  assert.strictEqual(app.formatDocumentDate(app.documentDate(fromOpened)), '03.02.2022');
  assert.strictEqual(app.formatDocumentDate(app.documentDate({ name: 'plain.md', source: '# x' })), 'дата неизвестна');
});

test('a front matter title is exposed only when it differs from the filename', () => {
  assert.strictEqual(app.documentTitle({ name: 'note.md', source: '---\ntitle: Разбор\n---\nx' }), 'Разбор');
  assert.strictEqual(app.documentTitle({ name: 'note.md', source: '---\ntitle: note\n---\nx' }), '');
  assert.strictEqual(app.documentTitle({ name: 'note.md', source: '# x' }), '');
});

/* --- Inline rendering -------------------------------------------------- */
test('user HTML is escaped and script payloads are inert', () => {
  const html = app.inline('<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'), 'raw markup must not survive');
  assert.ok(html.includes('&lt;img'));
});

test('javascript and data image sources are rejected', () => {
  assert.ok(!app.inline('![a](javascript:alert(1))').includes('<img'));
  assert.ok(!app.inline('![a](data:text/html;base64,x)').includes('<img'));
});

test('snake_case identifiers are not turned into emphasis', () => {
  assert.strictEqual(app.inline('my_long_name here'), 'my_long_name here');
  assert.strictEqual(app.inline('file_name_here'), 'file_name_here');
});

test('markup inside code spans is not interpreted', () => {
  assert.strictEqual(app.inline('`**not bold**`'), '<code>**not bold**</code>');
  assert.ok(!app.inline('`use <b>x</b>`').includes('<b>'));
});

test('bold, italic and strikethrough still work', () => {
  assert.strictEqual(app.inline('**bold**'), '<strong>bold</strong>');
  assert.strictEqual(app.inline('*italic*'), '<em>italic</em>');
  assert.strictEqual(app.inline('~~gone~~'), '<del>gone</del>');
});

test('a bare URL is linked exactly once', () => {
  const html = app.inline('go https://example.com now');
  assert.strictEqual((html.match(/<a /g) || []).length, 1);
  assert.ok(html.includes('href="https://example.com"'));
});

test('a URL inside link text does not produce nested anchors', () => {
  const html = app.inline('[see https://x.test and](https://y.test)');
  assert.strictEqual((html.match(/<a /g) || []).length, 1);
  assert.ok(html.includes('href="https://y.test"'));
});

test('only http(s) links are linkified, so javascript never reaches href', () => {
  assert.ok(!app.inline('[x](javascript:alert(1))').includes('href="javascript'));
});

/* --- Block rendering --------------------------------------------------- */
function rendered(markdown) {
  app.renderMarkdown(markdown);
  return app.getOutput();
}

test('markdown tables render and are wrapped for horizontal scrolling', () => {
  const html = rendered('| a | b |\n|---|---|\n| 1 | 2 |\n');
  assert.ok(html.includes('<table'));
  assert.ok(html.includes('class="table-wrap"'));
  assert.ok(html.includes('<th scope="col">a</th>'));
});

test('GFM task lists render checkboxes in unordered lists', () => {
  const html = rendered('- [ ] open\n- [x] done\n');
  assert.strictEqual((html.match(/data-task-line/g) || []).length, 2);
  assert.ok(html.includes('checked'));
  assert.ok(!html.includes('disabled'));
});

test('ordered lists do not get checkboxes and keep their numbering', () => {
  const html = rendered('1. one\n2. [x] done\n3. three\n');
  assert.ok(!html.includes('checkbox'), 'numbered items must not become tasks');
  assert.strictEqual((html.match(/<li>/g) || []).length, 3);
});

test('nested lists are nested inside their parent item', () => {
  assert.strictEqual(rendered('- a\n  - n1\n  - n2\n- b\n'), '<ul><li>a<ul><li>n1</li><li>n2</li></ul></li><li>b</li></ul>');
  assert.strictEqual(rendered('- a\n  - n1\n    - deep\n- b\n'), '<ul><li>a<ul><li>n1<ul><li>deep</li></ul></li></ul></li><li>b</li></ul>');
});

test('a blank line separates adjacent lists', () => {
  assert.strictEqual((rendered('- a\n\n- b\n').match(/<ul>/g) || []).length, 2);
});

test('ordered and unordered lists stay separate', () => {
  const html = rendered('- a\n- b\n\n1. one\n2. two\n');
  assert.ok(html.includes('<ul>') && html.includes('<ol>'));
  assert.ok(html.indexOf('</ul>') < html.indexOf('<ol>'));
});

test('code fences are escaped and not interpreted', () => {
  const html = rendered('```\n<script>alert(1)</script>\n```\n');
  assert.ok(!html.includes('<script>'), 'fenced code must be escaped');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('headings keep levels and get slugs', () => {
  const html = rendered('# H1\n\n## H2\n');
  assert.ok(html.includes('<h1 id=') && html.includes('<h2 id='));
});

test('a heading of seven hashes is not a heading', () => {
  assert.ok(!rendered('####### seven\n').includes('<h'));
});

/* --- Task toggling ----------------------------------------------------- */
test('toggling a task rewrites only the addressed line', () => {
  assert.strictEqual(app.toggleTaskLine('- [ ] a\n- [ ] b\n', 1), '- [ ] a\n- [x] b\n');
  assert.strictEqual(app.toggleTaskLine('- [x] a\n- [x] b\n', 0), '- [ ] a\n- [x] b\n');
});

test('toggling ignores lines that are not tasks', () => {
  assert.strictEqual(app.toggleTaskLine('- plain\n', 0), null);
  assert.strictEqual(app.toggleTaskLine('- [ ] a\n', 9), null);
});

/* --- Folder excludes --------------------------------------------------- */
function loadExcludes(settings = {}) {
  const src = fs.readFileSync(APP_PATH, 'utf8');
  const start = src.indexOf('const BUILTIN_EXCLUDES');
  const walker = src.indexOf('async function walkMarkdownFiles');
  const factory = new Function(
    'readSettings',
    `${src.slice(start, walker)}; return { BUILTIN_EXCLUDES, excludedFolderNames };`
  );
  return factory(() => settings);
}

test('the built-in exclude list covers common build and secret folders', () => {
  const { BUILTIN_EXCLUDES } = loadExcludes();
  ['.git', 'node_modules', 'dist', '.venv', '.idea', '.cache', '.ssh', '.memoroid-backups']
    .forEach((name) => assert.ok(BUILTIN_EXCLUDES.includes(name), `${name} must be excluded by default`));
});

test('custom excludes are added on top of the built-in list', () => {
  const { excludedFolderNames, BUILTIN_EXCLUDES } = loadExcludes({ excludes: ['  drafts ', '', 'tmp'] });
  const names = excludedFolderNames();
  assert.ok(names.has('drafts'), 'custom entries are trimmed and added');
  assert.ok(names.has('tmp'));
  assert.ok(names.has('.git'), 'built-ins are still present');
  assert.ok(names.size >= BUILTIN_EXCLUDES.length + 2);
});

test('a malformed settings value cannot break the exclude list', () => {
  const { excludedFolderNames } = loadExcludes({ excludes: 'not-an-array' });
  assert.doesNotThrow(() => excludedFolderNames());
  assert.ok(excludedFolderNames().has('.git'));
});

test('excluding a folder prevents it from being walked', async () => {
  const src = fs.readFileSync(APP_PATH, 'utf8');
  const start = src.indexOf('const BUILTIN_EXCLUDES');
  const end = src.indexOf('async function connectFolder');
  const scope = new Function('readSettings', 'createPageId',
    `${src.slice(start, end)}; return { walkMarkdownFiles };`);

  const makeTree = (name, children) => ({
    name,
    kind: 'directory',
    async *values() {
      for (const child of children) yield child;
    }
  });
  const file = (name) => ({ name, kind: 'file', getFile: async () => ({ lastModified: 1 }) });
  const root = makeTree('root', [
    makeTree('node_modules', [file('a.md')]),
    makeTree('notes', [file('keep.md')]),
    file('top.md')
  ]);

  const found = await scope(() => ({}), () => 'id').walkMarkdownFiles(root, 'conn');
  const paths = found.map((entry) => entry.path);
  assert.ok(paths.includes('notes/keep.md'), 'ordinary folders are walked');
  assert.ok(paths.includes('top.md'));
  assert.ok(!paths.some((p) => p.startsWith('node_modules')), 'excluded folders are skipped');
});

/* --- Reading position -------------------------------------------------- */
function loadScrollMemory() {
  const src = fs.readFileSync(APP_PATH, 'utf8');
  const start = src.indexOf('function rememberScrollPosition');
  /* Stop before selectDocument, which would close the scope with its own return. */
  const end = src.indexOf('function selectDocument');
  /* Drive currentPageId through a live holder instead of a closure setter,
   * so the helper returns only functions that exist in app.js. */
  const factory = new Function('$', 'window', 'holder', `
    const scrollPositions = new Map();
    Object.defineProperty(globalThis, '__pageId', { get: () => holder.id, configurable: true });
    ${src.slice(start, end).replace(/\bcurrentPageId\b/g, 'globalThis.__pageId')};
    return { rememberScrollPosition, restoreScrollPosition, positions: scrollPositions };
  `);
  return factory;
}

test('the reading position is remembered per document and restored on return', () => {
  let scrollY = 0;
  const win = { get scrollY() { return scrollY; }, scrollTo: (x, y) => { scrollY = y; } };
  const holder = { id: null };
  const memory = loadScrollMemory()(() => ({ classList: { contains: () => false } }), win, holder);

  holder.id = 'A1'; scrollY = 3000;
  memory.rememberScrollPosition();
  assert.strictEqual(memory.positions.get('A1'), 3000);

  holder.id = 'B1'; memory.restoreScrollPosition();
  assert.strictEqual(scrollY, 0, 'a document without a saved position starts at the top');

  holder.id = 'A1'; scrollY = 0;
  memory.restoreScrollPosition();
  assert.strictEqual(scrollY, 3000, 'returning to a document restores its position');
});

test('the reading position is not recorded while the library is shown', () => {
  let scrollY = 500;
  const win = { get scrollY() { return scrollY; }, scrollTo: (x, y) => { scrollY = y; } };
  const holder = { id: null };
  const memory = loadScrollMemory()(() => ({ classList: { contains: () => true } }), win, holder);
  holder.id = 'A1';
  memory.rememberScrollPosition();
  assert.strictEqual(memory.positions.size, 0, 'library view must not overwrite the document position');
});

/* --- Search normalisation --------------------------------------------- */
test('search normalisation folds case and the Russian yo', () => {
  assert.strictEqual(app.normalizeSearchText('Ёлка'), 'елка');
  assert.deepStrictEqual(app.searchTokens('Привет, мир!'), ['привет', 'мир']);
});

test('word counting works without the WASM module', () => {
  assert.ok(app.countWords('один два три') >= 3);
});

/* --- Local image safety ------------------------------------------------ */
function loadImageReader() {
  const src = fs.readFileSync(APP_PATH, 'utf8');
  /* Take the whole image block: the guard, the reader and the data-url
   * helper. Slicing mid-function would break the async declaration. */
  const start = src.indexOf('function isLocalImageSource');
  const end = src.indexOf('function releaseLocalImages');
  return new Function(`${src.slice(start, end)}; return { isLocalImageSource, readLocalImageBlob };`)();
}

test('image reading refuses paths that escape the connected folder', () => {
  const { readLocalImageBlob } = loadImageReader();
  const seen = [];
  const root = {
    getDirectoryHandle: (name) => { seen.push(name); return root; },
    getFileHandle: () => { throw new Error('must not be reached'); }
  };
  return assert.rejects(() => readLocalImageBlob(root, '../../secret.png'), {
    message: 'local-image-unavailable'
  }).then(() => assert.deepStrictEqual(seen, [], 'no directory may be walked for a traversal path'));
});

test('Windows-style image paths are split into real path segments', async () => {
  const { readLocalImageBlob } = loadImageReader();
  const seen = [];
  const root = {
    getDirectoryHandle: (name) => { seen.push(name); return root; },
    getFileHandle: (name) => { seen.push(`file:${name}`); return { getFile: async () => 'blob' }; }
  };
  const result = await readLocalImageBlob(root, 'assets\\img\\p.png');
  assert.strictEqual(result, 'blob');
  assert.deepStrictEqual(seen, ['assets', 'img', 'file:p.png']);
});

test('remote, absolute and data URLs are never treated as local files', () => {
  const { isLocalImageSource } = loadImageReader();
  assert.strictEqual(isLocalImageSource('https://x.test/a.png'), false);
  assert.strictEqual(isLocalImageSource('/etc/passwd'), false);
  assert.strictEqual(isLocalImageSource('data:image/png;base64,x'), false);
  assert.strictEqual(isLocalImageSource('C:/Users/a.png'), false);
  assert.strictEqual(isLocalImageSource('images/pic.png'), true);
});
