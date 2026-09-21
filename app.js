/* Memoroid core
 * Extension points: storage, markdown renderer, commands, and UI state are
 * deliberately kept separate so future features do not require a rewrite.
 */
const demoMarkdown = `# Memoroid

Ваше пространство для мыслей, заметок и идей.

Memoroid — простой **офлайн-просмотрщик Markdown**. Файлы остаются на этом
компьютере и никуда не отправляются.

## Как начать

1. Нажмите **«Открыть файл»**.
2. Выберите файл \`.md\` или \`.markdown\`.
3. Или перетащите его в окно просмотра.

> Хорошие заметки не должны ждать идеального момента.

## Возможности

- Заголовки и оглавление
- Списки, таблицы, цитаты и блоки кода
- Поиск по текущему документу
- Светлая и тёмная тема

---

Начните с одной мысли. Остальное соберётся само.`;

const STORAGE_KEY = 'memoroid.documents.v1';
const SETTINGS_KEY = 'memoroid.settings.v1';
const CATALOG_DB = 'memoroid.catalog.v1';
const CATALOG_DB_VERSION = 2;
const MAX_RECENT = 12;
const APP_VERSION = '1.2';
const GROUPS_KEY = 'memoroid.library.groups.v1';
let currentMarkdown = demoMarkdown;
let currentFileName = 'welcome.md';
let currentPageId = null;
let rawMode = false;
let searchTerm = '';
let currentFavorite = false;
let currentTags = [];
let favoritesOnly = false;
let editorMode = false;
let currentFileHandle = null;
let currentParentHandle = null;
let currentFileBaseline = null;
let draftTimer = null;
let librarySearchTerm = '';
let libraryDrawerOpen = false;
let collapsedLibraryGroups = readCollapsedLibraryGroups();
let wasmWordCounter = null;
let wasmSearchMatcher = null;
let memorySearchIndex = null;
let indexingInProgress = false;
let librarySort = 'new';
let staleOnly = false;
/* Reading positions, keyed by Page ID. Memory only: deliberately not
 * persisted, so a note reopened days later still starts at the top. */
const scrollPositions = new Map();
let localImageUrls = [];
const localImageCache = new Map();
let currentLastModified = 0;
const $ = (id) => document.getElementById(id);

function createPageId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `page-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function initWasmIndexer() {
  try {
    if (!window.MemoroidWasmBinary || typeof WebAssembly === 'undefined') return;
    const { instance } = await WebAssembly.instantiate(window.MemoroidWasmBinary);
    const memory = instance.exports.memory;
    const count = instance.exports.count_words;
    const match = instance.exports.contains_all_tokens;
    if (!memory || !count || !match) return;
    wasmWordCounter = (source) => {
      const bytes = new TextEncoder().encode(source);
      if (bytes.length > memory.buffer.byteLength) return null;
      new Uint8Array(memory.buffer, 0, bytes.length).set(bytes);
      return count(0, bytes.length);
    };
    wasmSearchMatcher = (source, query) => {
      const sourceBytes = new TextEncoder().encode(source);
      const queryBytes = new TextEncoder().encode(query);
      if (sourceBytes.length + queryBytes.length > memory.buffer.byteLength) return null;
      const buffer = new Uint8Array(memory.buffer);
      buffer.set(sourceBytes, 0);
      buffer.set(queryBytes, sourceBytes.length);
      return Boolean(match(0, sourceBytes.length, sourceBytes.length, queryBytes.length));
    };
  } catch { /* optional acceleration; JavaScript remains the fallback */ }
}
function countWords(source) {
  const text = String(source || '');
  const front = FRONT_MATTER_PATTERN.exec(text.replace(/^\uFEFF/, ''));
  const body = (front ? text.slice(front[0].length) : text).replace(/```[\s\S]*?```/g, ' ');
  const normalized = normalizeSearchText(body);
  return wasmWordCounter?.(normalized) ?? normalized.split(' ').filter(Boolean).length;
}
function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ru')
    .replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function searchTokens(value) {
  return normalizeSearchText(value).split(' ').filter(Boolean);
}
function matchesSearchText(source, query) {
  const normalizedSource = normalizeSearchText(source);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  if (wasmSearchMatcher) {
    const wasmResult = wasmSearchMatcher(normalizedSource, normalizedQuery);
    if (wasmResult !== null) return wasmResult;
  }
  const sourceTokens = new Set(searchTokens(normalizedSource));
  return searchTokens(normalizedQuery).every((token) => sourceTokens.has(token));
}

function readCollapsedLibraryGroups() {
  try {
    const value = JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.filter((name) => typeof name === 'string') : []);
  } catch { return new Set(); }
}
function saveCollapsedLibraryGroups() {
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify([...collapsedLibraryGroups])); } catch {}
}

function supportsFolderAccess() {
  return typeof window.showDirectoryPicker === 'function' && typeof window.indexedDB !== 'undefined';
}
function openCatalogDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(CATALOG_DB, CATALOG_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readCatalogFolders() {
  const db = await openCatalogDb();
  const folders = await new Promise((resolve, reject) => {
    const request = db.transaction('folders', 'readonly').objectStore('folders').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return folders;
}
async function deleteCatalogFolder(folderId) {
  const db = await openCatalogDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['folders', 'files'], 'readwrite');
    tx.objectStore('folders').delete(folderId);
    const files = tx.objectStore('files');
    files.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      if (cursor.value.connectionId === folderId) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function saveCatalogFolder(folder) {
  const db = await openCatalogDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readwrite');
    tx.objectStore('folders').put(folder);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function replaceFolderFiles(connectionId, files) {
  const db = await openCatalogDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    store.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      if (cursor.value.connectionId === connectionId) cursor.delete();
      cursor.continue();
    };
    files.forEach((file) => store.put(file));
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function saveCatalogFiles(files) {
  const db = await openCatalogDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    files.forEach((file) => tx.objectStore('files').put(file));
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function readCatalogFiles() {
  const db = await openCatalogDb();
  const files = await new Promise((resolve, reject) => {
    const request = db.transaction('files', 'readonly').objectStore('files').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return files;
}
const BUILTIN_EXCLUDES = ['.git', '.svn', '.hg', 'node_modules', 'build', 'dist', 'vendor', '.venv', 'venv',
  '.idea', '.vscode', '.cache', '.tox', '.mypy_cache', '.pytest_cache', '.memoroid-backups', '.ssh', '.aws'];

function excludedFolderNames() {
  const names = new Set(BUILTIN_EXCLUDES);
  const custom = readSettings().excludes;
  if (Array.isArray(custom)) {
    custom.filter((name) => typeof name === 'string').map((name) => name.trim()).filter(Boolean)
      .forEach((name) => names.add(name));
  }
  return names;
}

async function walkMarkdownFiles(directory, connectionId, prefix = '', rootName = directory.name, existingById = new Map()) {
  const excluded = excludedFolderNames();
  const found = [];
  for await (const entry of directory.values()) {
    if (entry.kind === 'directory') {
      if (excluded.has(entry.name)) continue;
      found.push(...await walkMarkdownFiles(entry, connectionId, `${prefix}${entry.name}/`, rootName, existingById));
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      const id = `${connectionId}:${prefix}${entry.name}`;
      const previous = existingById.get(id);
      let lastModified = Number(previous?.lastModified) || 0;
      try { lastModified = (await entry.getFile()).lastModified; } catch { /* keep previous value */ }
      found.push({ id, pageId: previous?.pageId || createPageId(), connectionId, name: entry.name, path: `${prefix}${entry.name}`, root: rootName, handle: entry, parent: directory, favorite: Boolean(previous?.favorite), tags: Array.isArray(previous?.tags) ? previous.tags : [], lastModified, indexedAt: Date.now() });
    }
  }
  return found;
}
async function connectFolder() {
  if (!supportsFolderAccess()) {
    showToast('Расширенный режим недоступен. Откройте отдельный .md-файл.');
    return;
  }
  try {
    const directory = await window.showDirectoryPicker({ mode: 'read' });
    const folders = await readCatalogFolders();
    let folder = null;
    for (const candidate of folders) {
      if (candidate.handle?.isSameEntry && await candidate.handle.isSameEntry(directory)) {
        folder = candidate; break;
      }
    }
    const existed = Boolean(folder);
    folder ||= { id: `folder:${directory.name}:${Date.now()}`, name: directory.name, handle: directory, connectedAt: Date.now() };
    folder.lastIndexedAt = Date.now();
    const existingFiles = await readCatalogFiles();
    const existingById = new Map(existingFiles.filter((file) => file.connectionId === folder.id).map((file) => [file.id, file]));
    const files = await walkMarkdownFiles(directory, folder.id, '', directory.name, existingById);
    await saveCatalogFolder(folder);
    await replaceFolderFiles(folder.id, files);
    memorySearchIndex = null;
    $('runtimeStatus').textContent = 'Расширенный режим';
    $('docStatus').textContent = `Подключено папок: ${existed ? folders.length : folders.length + 1}; файлов: ${files.length}`;
    await refreshRecent();
    showToast(`Найдено файлов: ${files.length}`);
  } catch (error) {
    if (error?.name !== 'AbortError') showToast('Не удалось подключить папку');
  }
}
async function restoreCatalogFolders() {
  if (!supportsFolderAccess()) return;
  let folders;
  try { folders = await readCatalogFolders(); } catch { return; }
  let existingFiles = [];
  try { existingFiles = await readCatalogFiles(); } catch { /* catalog may be unavailable */ }
  let restored = 0;
  for (const folder of folders) {
    try {
      if (folder.handle.queryPermission && await folder.handle.queryPermission({ mode: 'read' }) !== 'granted') continue;
      const existingById = new Map(existingFiles.filter((file) => file.connectionId === folder.id).map((file) => [file.id, file]));
      const files = await walkMarkdownFiles(folder.handle, folder.id, '', folder.name, existingById);
      await saveCatalogFolder({ ...folder, lastIndexedAt: Date.now() });
      await replaceFolderFiles(folder.id, files);
      restored += 1;
    } catch { /* permission may have been revoked */ }
  }
  if (restored) {
    $('runtimeStatus').textContent = 'Расширенный режим';
    $('docStatus').textContent = `Восстановлено подключений: ${restored}`;
    await refreshRecent();
  }
}
async function openCatalogFile(entry) {
  try {
    if (entry.handle.queryPermission && await entry.handle.queryPermission({ mode: 'read' }) !== 'granted') {
      await entry.handle.requestPermission({ mode: 'read' });
    }
    const file = await entry.handle.getFile();
    currentFileHandle = entry.handle;
    currentParentHandle = entry.parent || null;
    currentFileBaseline = { lastModified: file.lastModified, size: file.size };
    const source = await file.text();
    const baseline = { lastModified: file.lastModified, size: file.size };
    selectDocument(entry.path, source, {
      pageId: entry.pageId, favorite: entry.favorite, tags: entry.tags, handle: entry.handle, parent: entry.parent, baseline, lastModified: file.lastModified
    });
    showToast(`Открыт ${entry.path}`);
  } catch {
    showToast('Нет доступа к этому файлу. Подключите папку заново.');
  }
}

function draftKey() {
  return `memoroid.draft.${currentFileName}`;
}
function readDraft(name = currentFileName) {
  try {
    const draft = JSON.parse(localStorage.getItem(`memoroid.draft.${name}`) || 'null');
    return draft && typeof draft.source === 'string' ? draft : null;
  } catch { return null; }
}
function saveDraft() {
  if (!editorMode || currentFileName === 'welcome.md') return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      localStorage.setItem(draftKey(), JSON.stringify({ source: currentMarkdown, savedAt: Date.now() }));
      $('docStatus').textContent = 'Черновик сохранён локально';
    } catch { /* fallback storage can be unavailable */ }
  }, 400);
}
function clearDraft() {
  try { localStorage.removeItem(draftKey()); } catch {}
}
function setEditorMode(enabled) {
  editorMode = enabled;
  $('appShell').classList.toggle('editing-state', enabled);
  if (enabled) {
    $('appShell').classList.remove('structure-open');
    $('outline').hidden = true;
    $('structureButton').setAttribute('aria-expanded', 'false');
  }
  $('editorLayout').hidden = !enabled;
  $('saveButton').hidden = !enabled;
  $('downloadButton').hidden = !enabled;
  $('structureButton').hidden = enabled;
  $('editButton').textContent = enabled ? '◉ Просмотр' : '✎ Редактировать';
  $('editButton').setAttribute('aria-pressed', String(enabled));
  if (enabled) {
    $('editorInput').value = currentMarkdown;
    $('editorInput').focus();
  }
  renderMarkdown(currentMarkdown);
  if (enabled) {
    $('editorPreview').innerHTML = $('markdownOutput').innerHTML;
    $('markdownOutput').hidden = true;
  } else {
    $('markdownOutput').hidden = false;
  }
}
async function writeBackup(content) {
  try {
    const backupDir = await currentParentHandle.getDirectoryHandle('.memoroid-backups', { create: true });
    const backupPrefix = currentFileName.replace(/[\\/]/g, '_');
    const backupName = `${backupPrefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.bak`;
    const backup = await backupDir.getFileHandle(backupName, { create: true });
    const backupWriter = await backup.createWritable();
    await backupWriter.write(content);
    await backupWriter.close();
    const pattern = new RegExp(`^${backupPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+\\.[a-z0-9]+\\.bak$`);
    const backups = [];
    for await (const backupEntry of backupDir.values()) {
      if (backupEntry.kind === 'file' && pattern.test(backupEntry.name)) backups.push(backupEntry);
    }
    backups.sort((a, b) => a.name.localeCompare(b.name));
    for (const oldBackup of backups.slice(0, Math.max(0, backups.length - 5))) {
      try { await backupDir.removeEntry(oldBackup.name); } catch { /* keep backups we cannot remove */ }
    }
    return true;
  } catch {
    const proceed = !currentParentHandle || window.confirm('Не удалось создать резервную копию. Записать файл без копии?');
    if (!proceed) {
      saveDraft();
      showToast('Сохранение отменено. Черновик сохранён.');
    }
    return proceed;
  }
}
async function saveToOriginal() {
  if (!currentFileHandle) {
    if (!editorMode) { showToast('Откройте «Редактировать», чтобы сохранить файл'); return; }
    if (!currentMarkdown.trim()) { showToast('Документ пуст, сохранять нечего'); return; }
    downloadCurrentFile();
    showToast('Запись в файл недоступна в этом браузере — сохраняю копию');
    return;
  }
  try {
    if (currentFileHandle.queryPermission && await currentFileHandle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      if (await currentFileHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('permission');
    }
    const latest = await currentFileHandle.getFile();
    const backupContent = await latest.text();
    if (currentFileBaseline && (latest.lastModified !== currentFileBaseline.lastModified || latest.size !== currentFileBaseline.size)) {
      $('docStatus').textContent = 'Обнаружено внешнее изменение';
      saveDraft();
      if ($('conflictDialog').showModal) $('conflictDialog').showModal();
      else showToast('Файл изменён вне Memoroid. Черновик сохранён.');
      return;
    }
    if (currentParentHandle && !await writeBackup(backupContent)) return;
    const writable = await currentFileHandle.createWritable({ keepExistingData: true });
    try {
      await writable.write(currentMarkdown);
      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch { /* abort is best effort */ }
      throw error;
    }
    const refreshed = await currentFileHandle.getFile();
    currentFileBaseline = { lastModified: refreshed.lastModified, size: refreshed.size };
    currentLastModified = refreshed.lastModified;
    memorySearchIndex = null;
    clearDraft();
    $('docStatus').textContent = 'Сохранено локально';
    setEditorMode(false);
    showToast('Файл сохранён');
  } catch {
    saveDraft();
    showToast('Не удалось записать файл. Черновик сохранён.');
  }
}
function downloadCurrentFile() {
  const blob = new Blob([currentMarkdown], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = currentFileName.replace(/\.(md|markdown)$/i, '') + '.updated.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
function downloadBlob(fileName, content, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
function renderedPlainText() {
  const clone = $('markdownOutput').cloneNode(true);
  clone.querySelectorAll('a').forEach((link) => {
    link.replaceWith(document.createTextNode(`${link.textContent} (${link.href})`));
  });
  clone.querySelectorAll('img').forEach((image) => image.replaceWith(document.createTextNode(`[Изображение: ${image.alt || 'без подписи'}]`)));
  return clone.innerText.trim();
}
async function copyRenderedDocument() {
  const plain = renderedPlainText();
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([$(`markdownOutput`).innerHTML], { type: 'text/html' })
      })]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    showToast('Текст скопирован без Markdown');
  } catch { showToast('Не удалось скопировать документ'); }
}
function isLocalImageSource(source) {
  return Boolean(source) && !/^(?:https?:|data:|blob:|javascript:|#|\/|[a-zA-Z]:[\\/])/i.test(source);
}
async function readLocalImageBlob(root, source) {
  if (!root) throw new Error('local-image-unavailable');
  const normalized = String(source).replace(/\\/g, '/');
  const parts = normalized.split('/').filter((part) => part && part !== '.');
  if (!parts.length) throw new Error('local-image-unavailable');
  if (parts.some((part) => part === '..')) throw new Error('local-image-unavailable');
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  const handle = await directory.getFileHandle(parts.at(-1));
  return handle.getFile();
}
async function blobToDataUrl(blob) {
  return `data:${blob.type || 'application/octet-stream'};base64,${await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject; reader.readAsDataURL(blob);
  })}`;
}
function releaseLocalImages() {
  localImageUrls.forEach((url) => URL.revokeObjectURL(url));
  localImageUrls = [];
}
function markImageMissing(image, source, reason) {
  if (!image.dataset.originalAlt) image.dataset.originalAlt = image.alt || '';
  const altText = image.dataset.originalAlt;
  image.classList.add('image-missing');
  image.removeAttribute('src');
  image.dataset.localSource = source;
  image.alt = altText ? `${altText} — ${reason}: ${source}` : `${reason}: ${source}`;
  image.title = image.alt;
}
async function hydrateLocalImages() {
  releaseLocalImages();
  const images = [...$('markdownOutput').querySelectorAll('img')];
  for (const image of images) {
    const source = image.dataset.localSource || image.getAttribute('src') || '';
    if (!isLocalImageSource(source)) continue;
    image.dataset.localSource = source;
    if (!currentParentHandle) {
      markImageMissing(image, source, 'Локальное изображение недоступно без папки');
      continue;
    }
    try {
      let blob = localImageCache.get(source);
      if (!blob) { blob = await readLocalImageBlob(currentParentHandle, source); localImageCache.set(source, blob); }
      const url = URL.createObjectURL(blob);
      localImageUrls.push(url);
      image.src = url;
      image.classList.remove('image-missing');
      if (image.dataset.originalAlt) image.alt = image.dataset.originalAlt;
      image.title = `Локальный файл: ${source}`;
    } catch {
      markImageMissing(image, source, 'Файл не найден');
    }
  }
}
async function inlineExportImages(root, container) {
  const images = [...(container || $('markdownOutput')).querySelectorAll('img')];
  let unresolved = 0;
  for (const image of images) {
    const source = image.dataset.localSource || image.getAttribute('src') || '';
    if (!isLocalImageSource(source)) continue;
    try {
      image.src = await blobToDataUrl(await readLocalImageBlob(root, source));
      image.classList.remove('image-missing');
    } catch { unresolved += 1; }
  }
  return unresolved;
}
async function exportDocumentHtml() {
  const output = $('markdownOutput').cloneNode(true);
  const unresolved = await inlineExportImages(currentParentHandle, output);
  const title = escapeHtml(currentFileName.replace(/\.(md|markdown)$/i, ''));
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{background:#f8f8f6;color:#242424;font:16px/1.7 system-ui,sans-serif;margin:0;padding:40px}main{max-width:760px;margin:auto}h1,h2,h3{line-height:1.2}img{max-width:100%;height:auto;border-radius:8px}pre{background:#292927;color:#eee;padding:16px;border-radius:8px;overflow:auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#eee}footer{border-top:1px solid #ddd;color:#666;margin-top:40px;padding-top:14px;font-size:12px}</style></head><body><main><h1>${title}</h1>${output.innerHTML}<footer>Экспортировано из Memoroid · ${new Date().toLocaleDateString('ru-RU')}</footer></main></body></html>`;
  downloadBlob(`${currentFileName.replace(/\.(md|markdown)$/i, '')}.html`, html, 'text/html;charset=utf-8');
  showToast(unresolved ? `HTML экспортирован, изображений не встроено: ${unresolved}` : 'HTML экспортирован');
}
function formatAge(timestamp) {
  const days = Math.max(1, Math.floor((Date.now() - timestamp) / 86400000));
  return days > 3650 ? 'давно' : `${days} дн. назад`;
}
function renderResurfacing() {
  const panel = $('resurfacingPanel');
  const list = $('resurfacingList');
  if (!panel || !list) return;
  const cutoff = Date.now() - 30 * 86400000;
  const forgotten = readDocuments().filter((doc) => Number(doc.openedAt) && doc.openedAt < cutoff).slice(0, 4);
  panel.hidden = !forgotten.length || Boolean(librarySearchTerm) || staleOnly;
  list.replaceChildren();
  forgotten.forEach((doc) => {
    const item = document.createElement('button');
    item.className = 'resurfacing-item'; item.type = 'button';
    item.innerHTML = '<strong></strong><small></small>';
    item.querySelector('strong').textContent = doc.name;
    item.querySelector('small').textContent = formatAge(doc.openedAt);
    item.onclick = () => selectDocument(doc.name, doc.source, doc);
    list.append(item);
  });
}

function listDrafts() {
  const drafts = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith('memoroid.draft.')) continue;
      const draft = readDraft(key.slice('memoroid.draft.'.length));
      if (draft) drafts.push({ name: key.slice('memoroid.draft.'.length), ...draft });
    }
  } catch { return drafts; }
  return drafts;
}
function downloadJson(fileName, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = fileName;
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
async function exportLibrary(withSources = false) {
  const recent = readDocuments().map((doc) =>
    ({ name: doc.name, pageId: doc.pageId || createPageId(), favorite: Boolean(doc.favorite), tags: Array.isArray(doc.tags) ? doc.tags : [], openedAt: doc.openedAt, ...(withSources ? { source: doc.source } : {}) }));
  let catalog = [];
  try {
    catalog = (await readCatalogFiles()).map(({ id, pageId, name, path, root, favorite, tags, indexedAt }) =>
      ({ id, pageId: pageId || createPageId(), name, path, root, favorite: Boolean(favorite), tags: Array.isArray(tags) ? tags : [], indexedAt }));
  } catch { /* IndexedDB is optional */ }
  downloadJson('memoroid.json', {
    format: 'memoroid-library', version: 1, exportedAt: new Date().toISOString(), includesSources: withSources,
    recent, drafts: withSources ? listDrafts() : listDrafts().map(({ name, savedAt }) => ({ name, savedAt })), catalog
  });
  showToast(withSources ? 'Каталог с текстом заметок экспортирован' : 'Каталог экспортирован (без текста заметок)');
}
async function importLibrary(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data?.format !== 'memoroid-library' || data.version !== 1 || !Array.isArray(data.recent) || !Array.isArray(data.drafts)) {
      throw new Error('format');
    }
    const importedRecent = data.recent.filter((doc) => doc && typeof doc.name === 'string' && typeof doc.source === 'string')
      .map((doc) => ({ ...doc, pageId: typeof doc.pageId === 'string' && doc.pageId ? doc.pageId : createPageId(), favorite: Boolean(doc.favorite), tags: Array.isArray(doc.tags) ? doc.tags.slice(0, 10) : [], openedAt: Number(doc.openedAt) || Date.now() }));
    const merged = [...importedRecent, ...readDocuments()].filter((doc, index, all) => all.findIndex((item) => item.name === doc.name) === index);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged.slice(0, MAX_RECENT))); } catch { throw new Error('storage'); }
    data.drafts.filter((draft) => draft && typeof draft.name === 'string' && typeof draft.source === 'string').forEach((draft) => {
      try { localStorage.setItem(`memoroid.draft.${draft.name}`, JSON.stringify({ source: draft.source, savedAt: Number(draft.savedAt) || Date.now() })); } catch {}
    });
    if (Array.isArray(data.catalog) && window.indexedDB) {
      const existing = await readCatalogFiles();
      const metadata = new Map(data.catalog.filter((entry) => entry?.id).map((entry) => [entry.id, entry]));
      await saveCatalogFiles(existing.map((entry) => metadata.has(entry.id) ? {
        ...entry, pageId: typeof metadata.get(entry.id).pageId === 'string' && metadata.get(entry.id).pageId ? metadata.get(entry.id).pageId : (entry.pageId || createPageId()), favorite: Boolean(metadata.get(entry.id).favorite), tags: Array.isArray(metadata.get(entry.id).tags) ? metadata.get(entry.id).tags.slice(0, 10) : []
      } : entry));
    }
    await refreshRecent();
    memorySearchIndex = null;
    showToast('Каталог импортирован');
  } catch { showToast('Не удалось импортировать: нужен memoroid.json версии 1'); }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function decodeEscaped(value) {
  return String(value).replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"
  }[entity]));
}

function isSafeImageSource(source) {
  const trimmed = String(source).trim();
  if (!trimmed) return false;
  if (/^(?:https?:|data:image\/|blob:)/i.test(trimmed)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

function inline(text) {
  const codes = [];
  const autolinks = [];
  let result = escapeHtml(text);
  result = result.replace(/`([^`]+)`/g, (match, code) => {
    codes.push(code);
    return `\u0000CODE${codes.length - 1}\u0000`;
  });
  result = result.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, source) => {
    if (isSafeImageSource(decodeEscaped(source))) {
      return `\u0000IMG\u0000${source}\u0000IMG\u0000${alt}\u0000IMG\u0000`;
    }
    return match;
  });
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (match, label, url) => {
    autolinks.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    return `\u0000LINK${autolinks.length - 1}\u0000`;
  });
  result = result.replace(/(^|[\s(])(https?:\/\/[^\s<)"']+)(?![^<]*>)/g, (match, prefix, url) => {
    const trimmed = url.replace(/[.,;:!?]+$/, '');
    const tail = url.slice(trimmed.length);
    autolinks.push(`<a href="${trimmed}" target="_blank" rel="noopener noreferrer">${trimmed}</a>`);
    return `${prefix}\u0000LINK${autolinks.length - 1}\u0000${tail}`;
  });
  result = result.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '<strong>$1$2</strong>');
  result = result.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s.,!?)]|$)/g, '$1<em>$2</em>');
  result = result.replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s.,!?)]|$)/g, '$1<em>$2</em>');
  result = result.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  result = result.replace(/\u0000LINK(\d+)\u0000/g, (match, index) => autolinks[Number(index)]);
  result = result.replace(/\u0000IMG\u0000([^\u0000]*)\u0000IMG\u0000([^\u0000]*)\u0000IMG\u0000/g,
    (match, source, alt) => `<img src="${source}" alt="${alt}" loading="lazy">`);
  result = result.replace(/\u0000CODE(\d+)\u0000/g, (match, index) => `<code>${codes[Number(index)]}</code>`);
  return result;
}

function slugify(value, used) {
  const base = value.toLocaleLowerCase('ru').trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
  const count = (used[base] || 0) + 1;
  used[base] = count;
  return count === 1 ? base : `${base}-${count}`;
}

let headingObserver = null;

function markCurrentHeading(id) {
  const nav = $('outlineNav');
  if (!nav) return;
  [...nav.querySelectorAll('a')].forEach((link) => {
    link.classList.toggle('current', link.getAttribute('href') === `#${id}`);
  });
}

/* Highlights the section being read: the last heading that has scrolled past
 * a line set a third of the way down the viewport. Recomputed on scroll
 * rather than observed, because a document can be scrolled to a point where
 * no heading is inside the viewport at all. */
function currentHeadingId(headings) {
  const targets = headings
    .map((heading) => document.getElementById(heading.id))
    .filter(Boolean);
  if (!targets.length) return '';
  const line = window.scrollY + window.innerHeight / 3;
  let current = targets[0];
  targets.forEach((target) => {
    if (target.getBoundingClientRect().top + window.scrollY <= line) current = target;
  });
  return current.id;
}

function refreshCurrentHeading(headings) {
  markCurrentHeading(currentHeadingId(headings));
}

function trackCurrentHeading(headings) {
  if (headingObserver) { window.removeEventListener('scroll', headingObserver); headingObserver = null; }
  const nav = $('outlineNav');
  if (!nav) return;
  if (!headings.length) { markCurrentHeading(''); return; }
  refreshCurrentHeading(headings);
  const onScroll = () => refreshCurrentHeading(headings);
  window.addEventListener('scroll', onScroll, { passive: true });
  headingObserver = onScroll;
}

function renderDocumentMap(source, headings) {
  const plain = source.replace(/```[\s\S]*?```/g, ' ').replace(/[`*_>#|[\]()]/g, ' ');
  const words = countWords(plain);
  const stats = [
    ['Разделы', headings.length],
    ['Слов', words],
    ['Код', (source.match(/```/g) || []).length / 2],
    ['Таблицы', (source.match(/^\s*\|.+\|/gm) || []).length ? 1 : 0],
    ['Ссылки', (source.match(/\[[^\]]+\]\(https?:\/\//g) || []).length],
    ['Изображения', (source.match(/!\[[^\]]*\]\(https?:\/\//g) || []).length]
  ];
  $('documentStats').innerHTML = stats.map(([label, value]) =>
    `<div class="stat-item"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`).join('');

  const sections = headings.map((heading, index) => {
    const start = source.indexOf(heading.raw);
    const end = index + 1 < headings.length ? source.indexOf(headings[index + 1].raw, start + heading.raw.length) : source.length;
    const sectionWords = source.slice(start, end).replace(/[`*_>#|[\]()]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    return { ...heading, sectionWords };
  });
  const maxWords = Math.max(...sections.map((section) => section.sectionWords), 1);
  $('documentMap').innerHTML = sections.length ? sections.slice(0, 8).map((section) => `
    <a class="map-row level-${Math.min(section.level, 4)}" href="#${section.id}" title="Перейти к разделу">
      <span class="map-label">${escapeHtml(section.text)}</span>
      <span class="map-track"><span class="map-fill" style="width:${Math.max(8, Math.round(section.sectionWords / maxWords * 100))}%"></span></span>
      <span class="map-value">${section.sectionWords}</span>
    </a>`).join('') : '<span class="map-empty">В документе нет заголовков</span>';
}

function compileSearchPattern(term) {
  const text = String(term || '').trim();
  if (!text) return null;
  try {
    return new RegExp(text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'), 'iu');
  } catch {
    const literal = text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
    try { return new RegExp(literal, 'iu'); } catch { return null; }
  }
}
function toggleTaskLine(source, lineIndex) {
  const lines = String(source).replace(/\r/g, '').split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return null;
  const updated = line.replace(/^(\s*(?:[-*+])\s+\[)([ xX])(\]\s*)/, (match, prefix, state, suffix) =>
    `${prefix}${state.toLowerCase() === 'x' ? ' ' : 'x'}${suffix}`);
  if (updated === line) return null;
  lines[lineIndex] = updated;
  return lines.join('\n');
}
function attachTaskHandlers() {
  $('markdownOutput').querySelectorAll('input[type=checkbox][data-task-line]').forEach((checkbox) => {
    checkbox.disabled = false;
    checkbox.onchange = async () => {
      const updated = toggleTaskLine(currentMarkdown, Number(checkbox.dataset.taskLine));
      if (!updated) { renderMarkdown(currentMarkdown); return; }
      currentMarkdown = updated;
      if (editorMode && $('editorInput')) $('editorInput').value = updated;
      renderMarkdown(updated);
      saveDocument(currentFileName, updated);
      saveDraft();
      if (currentFileHandle) {
        try {
          if (currentFileHandle.queryPermission && await currentFileHandle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
            if (await currentFileHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('permission');
          }
          if (currentParentHandle) await writeBackup(await (await currentFileHandle.getFile()).text());
          const writable = await currentFileHandle.createWritable({ keepExistingData: true });
          await writable.write(updated);
          await writable.close();
          const refreshed = await currentFileHandle.getFile();
          currentFileBaseline = { lastModified: refreshed.lastModified, size: refreshed.size };
          currentLastModified = refreshed.lastModified;
          memorySearchIndex = null;
          showToast('Задача обновлена и записана в файл');
          return;
        } catch {
          showToast('Задача обновлена, но запись в файл не удалась. Черновик сохранён.');
          return;
        }
      }
      showToast('Задача обновлена. Чтобы сохранить в файл, нажмите «Сохранить»');
    };
  });
}
function renderMarkdown(source) {
  const text = typeof source === 'string' ? source.replace(/^\uFEFF/, '') : '';
  const front = FRONT_MATTER_PATTERN.exec(text);
  const lines = (front ? text.slice(front[0].length) : text).replace(/\r/g, '').split('\n');
  const output = [];
  const headings = [];
  const usedSlugs = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const fence = line.match(/^\s*```([^\s]*)\s*$/);
    if (fence) {
      const language = escapeHtml(fence[1] || '');
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      output.push(`<pre><code class="language-${language}">${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const id = slugify(heading[2], usedSlugs);
      headings.push({ level, id, text: heading[2], raw: line });
      output.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`);
      i += 1; continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      output.push('<hr>'); i += 1; continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      output.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`); continue;
    }
    const tableCells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    if (/^\s*\|?.+\|.+\|?\s*$/.test(line) && i + 1 < lines.length &&
        /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1]) &&
        tableCells(line).length === tableCells(lines[i + 1]).length) {
      const header = tableCells(line); i += 2; const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(tableCells(lines[i++]));
      output.push(`<div class="table-wrap"><table><thead><tr>${header.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, n) => `<td>${inline(row[n] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)/);
    if (listMatch) {
      const listKind = (m) => (/^\d/.test(m) ? 'ol' : 'ul');
      const indentOf = (s) => s.replace(/\t/g, '  ').length;
      const baseIndent = indentOf(listMatch[1]);
      const baseDepth = 0;
      const docLines = lines;
      const renderList = (startIndex, depth, parentTag) => {
        const items = [];
        let cursor = startIndex;
        while (cursor < docLines.length) {
          const item = docLines[cursor].match(/^(\s*)([-*+]|\d+\.)\s+(.*)/);
          if (!item) break;
          const currentIndent = indentOf(item[1]);
          const currentDepth = Math.min(Math.max(0, Math.floor((currentIndent - baseIndent) / 2)), 4);
          if (currentDepth < depth) break;
          if (currentDepth > depth) {
            const child = renderList(cursor, currentDepth, null);
            const last = items.pop() || '';
            const reopen = last.replace(/<\/li>$/, '');
            items.push(reopen ? `${reopen}${child.html}</li>` : child.html);
            cursor = child.cursor;
            continue;
          }
          let value = item[3];
          let task = null;
          if (!/^\d/.test(item[2])) task = value.match(/^\[([ xX])\]\s+(.*)/);
          if (task) {
            const checked = task[1].toLowerCase() === 'x';
            value = `<label><input type="checkbox" data-task-line="${cursor}"${checked ? ' checked' : ''}><span>${inline(task[2])}</span></label>`;
          } else value = inline(value);
          const tag = listKind(item[2]);
          items.push(`<li${task ? ' class="task-item"' : ''}>${value}</li>`);
          cursor += 1;
          const next = cursor < docLines.length ? docLines[cursor].match(/^(\s*)([-*+]|\d+\.)\s+/) : null;
          if (!next) break;
          const nextDepth = Math.min(Math.max(0, Math.floor((indentOf(next[1]) - baseIndent) / 2)), 4);
          if (nextDepth < depth) break;
        }
        const tag = parentTag || (startIndex < docLines.length ? listKind(docLines[startIndex].match(/^\s*([-*+]|\d+\.)\s+/)[1]) : 'ul');
        return { html: `<${tag}>${items.join('')}</${tag}>`, cursor };
      };
      const list = renderList(i, baseDepth, listKind(listMatch[2]));
      output.push(list.html);
      i = list.cursor; continue;
    }
    const paragraph = [line]; i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s|^\s*```|^\s*[-*+]\s|^\s*\d+\.\s|^\s*>|^\s*\|/.test(lines[i])) paragraph.push(lines[i++]);
    output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
  }
  $('markdownOutput').innerHTML = output.join('');
  $('markdownOutput').querySelectorAll('img').forEach((image) => {
    image.addEventListener('error', () => {
      image.classList.add('image-missing');
      image.title = `Локальное изображение не найдено: ${image.dataset.localSource || image.getAttribute('src') || ''}`;
    }, { once: true });
  });
  attachTaskHandlers();
  const visible = compileSearchPattern(searchTerm);
  $('markdownOutput').querySelectorAll('p,li,blockquote,td,th,h1,h2,h3,h4,h5,h6').forEach((node) => {
    node.classList.toggle('search-hit', Boolean(visible && visible.test(node.textContent)));
  });
  $('outlineNav').innerHTML = headings.map((h) =>
    `<a href="#${h.id}" class="${h.level > 1 ? 'sub' : ''}">${escapeHtml(h.text)}</a>`).join('');
  trackCurrentHeading(headings);
  renderDocumentMap(source, headings);
  const words = countWords(source);
  $('wordCount').textContent = `${words} слов · ${Math.max(1, Math.ceil(words / 265))} мин чтения`;
  const dateStamp = documentDate({ name: currentFileName, source: currentMarkdown, lastModified: currentLastModified, openedAt: Date.now() });
  const dateSource = documentDateSource({ name: currentFileName, source: currentMarkdown, lastModified: currentLastModified, openedAt: Date.now() });
  if ($('docDate')) $('docDate').textContent = dateSource ? `${formatDocumentDate(dateStamp)} · ${dateSource}` : '';
  if ($('printFooter')) {
    $('printFooter').textContent = [
      currentFileName,
      `${formatDocumentDate(dateStamp)} · ${words} слов`,
      'Напечатано из Memoroid'
    ].join(' · ');
  }
  if (editorMode && $('editorPreview')) $('editorPreview').innerHTML = $('markdownOutput').innerHTML;
  void hydrateLocalImages();
}

function readDocuments() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveDocument(name, source) {
  const previous = readDocuments().find((doc) => doc.name === name) || {};
  const isCurrent = name === currentFileName;
  const docs = readDocuments().filter((doc) => doc.name !== name);
  docs.unshift({
    ...previous,
    pageId: previous.pageId || currentPageId || createPageId(),
    name,
    source,
    favorite: isCurrent ? currentFavorite : Boolean(previous.favorite),
    tags: isCurrent ? currentTags : (Array.isArray(previous.tags) ? previous.tags : []),
    lastModified: isCurrent ? (currentLastModified || Number(previous.lastModified) || 0) : (Number(previous.lastModified) || 0),
    openedAt: Date.now()
  });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(docs.slice(0, MAX_RECENT))); } catch { /* file:// may deny storage */ }
}
function showToast(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}
function rememberScrollPosition() {
  if (!currentPageId || $('appShell').classList.contains('library-state')) return;
  scrollPositions.set(currentPageId, window.scrollY);
}
function restoreScrollPosition() {
  const saved = scrollPositions.get(currentPageId);
  window.scrollTo(0, typeof saved === 'number' ? saved : 0);
}
function selectDocument(name, source, metadata = {}) {
  rememberScrollPosition();
  clearTimeout(draftTimer);
  const draft = readDraft(name);
  const stored = readDocuments().find((doc) => doc.name === name) || {};
  /* Reuse the stored Page ID so the reading position survives a revisit:
   * a fresh id on every open would orphan the saved scroll offset. */
  currentPageId = metadata.pageId || stored.pageId || createPageId();
  currentFileName = name; currentMarkdown = source; rawMode = false; searchTerm = '';
  editorMode = false;
  currentFileHandle = metadata.handle || null;
  currentParentHandle = metadata.parent || null;
  currentFileBaseline = metadata.baseline || null;
  currentFavorite = metadata.favorite === undefined ? Boolean(stored.favorite) : Boolean(metadata.favorite);
  currentTags = Array.isArray(metadata.tags) ? metadata.tags : (Array.isArray(stored.tags) ? stored.tags : []);
  currentLastModified = Number(metadata.lastModified) || Number(stored.lastModified) || 0;
  localImageCache.clear(); releaseLocalImages();
  if (draft && draft.source !== source && window.confirm(`Восстановить локальный черновик для «${name}»?`)) {
    currentMarkdown = draft.source;
  }
  $('fileName').textContent = name; document.title = `${name} — Memoroid`; $('docStatus').textContent = draft && draft.source !== source ? 'Черновик доступен локально' : 'Файл открыт локально';
  $('draftIndicator').hidden = !(draft && draft.source !== source);
  $('searchInput').value = ''; $('tagsInput').value = currentTags.join(', ');
  $('rawButton').textContent = '{ } Исходник'; updateFavoriteButton();
  setEditorMode(false);
  if (name !== 'welcome.md') saveDocument(name, source);
  showDocument();
  restoreScrollPosition();
}
function updateFavoriteButton() {
  const button = $('favoriteButton');
  button.textContent = currentFavorite ? '★ В избранном' : '☆ В избранное';
  button.setAttribute('aria-pressed', String(currentFavorite));
}
function saveCurrentMetadata() {
  if (currentFileName === 'welcome.md') return;
  saveDocument(currentFileName, currentMarkdown); refreshRecent();
}
async function refreshRecent() {
  const list = $('recentFiles'); list.replaceChildren();
  const docs = readDocuments();
  const visibleDocs = favoritesOnly ? docs.filter((doc) => doc.favorite) : docs;
  const demoItem = document.createElement('button');
  demoItem.className = 'recent-file'; demoItem.type = 'button';
  demoItem.innerHTML = '<span class="file-dot"></span><span class="recent-name"></span><span class="recent-meta">DEMO</span>';
  demoItem.querySelector('.recent-name').textContent = 'welcome.md';
  demoItem.title = 'Пример Memoroid';
  demoItem.onclick = () => { favoritesOnly = false; selectDocument('welcome.md', demoMarkdown); refreshRecent(); };
  list.append(demoItem);
  visibleDocs.forEach((doc) => {
    const item = document.createElement('button'); item.className = 'recent-file'; item.type = 'button';
    item.innerHTML = '<span class="file-dot"></span><span class="recent-name"></span><span class="recent-meta">MD</span>';
    item.querySelector('.recent-name').textContent = doc.name;
    item.title = doc.tags?.length ? `Теги: ${doc.tags.join(', ')}` : doc.name;
    item.onclick = () => selectDocument(doc.name, doc.source, doc);
    list.append(item);
  });
  try {
    const catalogFiles = favoritesOnly ? (await readCatalogFiles()).filter((file) => file.favorite) : await readCatalogFiles();
    catalogFiles.forEach((entry) => {
      const item = document.createElement('button'); item.className = 'recent-file catalog-file'; item.type = 'button';
      item.innerHTML = '<span class="file-dot"></span><span class="recent-name"></span><span class="recent-meta">CAT</span>';
      item.querySelector('.recent-name').textContent = entry.path;
      item.title = `${entry.root || 'Папка'} / ${entry.path}`;
      item.onclick = () => openCatalogFile(entry);
      list.append(item);
    });
  } catch { /* catalog is optional in fallback mode */ }
  $('noteCount').textContent = String(docs.length + 1);
  $('favoriteCount').textContent = String(docs.filter((doc) => doc.favorite).length);
  $('emptyRecent').textContent = favoritesOnly ? 'В избранном пока ничего нет' : 'Открытые файлы появятся здесь';
  $('emptyRecent').hidden = list.children.length > 1;
  renderLibrary();
}

async function getLibraryEntries() {
  const entries = readDocuments().map((doc) => ({ ...doc, root: 'Открытые файлы', path: doc.name, source: doc.source, kind: 'recent' }));
  try {
    const catalog = await readCatalogFiles();
    entries.push(...catalog.map((entry) => ({ ...entry, kind: 'catalog' })));
  } catch { /* IndexedDB is optional */ }
  return entries;
}
const FRONT_MATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function parseDateValue(value) {
  const text = String(value ?? '').trim().replace(/^["']|["']$/g, '').trim();
  if (!text) return null;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (ru) {
    const stamp = Date.parse(`${ru[3]}-${ru[2]}-${ru[1]}T00:00:00`);
    return Number.isNaN(stamp) ? null : stamp;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
  if (iso) {
    const stamp = Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`);
    return Number.isNaN(stamp) ? null : stamp;
  }
  return null;
}

function frontMatterMeta(source) {
  const empty = { present: false, title: '', date: null, tags: [] };
  const text = typeof source === 'string' ? source.replace(/^\uFEFF/, '') : '';
  const match = FRONT_MATTER_PATTERN.exec(text);
  if (!match) return empty;
  const meta = { present: true, title: '', date: null, tags: [] };
  let collectingTags = false;
  const pushTags = (value) => {
    value.split(/[,;]/).map((tag) => tag.trim().replace(/^[-*]\s*/, '').replace(/^["'#]|["']$/g, '').trim())
      .filter(Boolean).forEach((tag) => { if (!meta.tags.includes(tag)) meta.tags.push(tag); });
  };
  match[1].split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.replace(/\s+#(?:\s.*)?$/g, '').trim();
    if (!line || line.startsWith('#')) return;
    const listItem = /^[-*]\s+(.+)$/.exec(line);
    if (listItem) {
      if (collectingTags) pushTags(listItem[1].replace(/^["']|["']$/g, ''));
      return;
    }
    const separator = line.indexOf(':');
    if (separator === -1) { collectingTags = false; return; }
    const key = line.slice(0, separator).trim().toLocaleLowerCase('en');
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '').trim();
    collectingTags = false;
    if (key === 'title' && !meta.title && value) meta.title = value;
    else if (key === 'date' && meta.date === null && value) meta.date = parseDateValue(value);
    else if (key === 'tags' || key === 'keywords') {
      if (value) pushTags(value.replace(/^\[|\]$/g, ''));
      collectingTags = true;
    }
  });
  meta.tags = meta.tags.slice(0, 12);
  return meta;
}
function filenameDate(name) {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(String(name || ''));
  if (!match) return null;
  const stamp = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
  return Number.isNaN(stamp) ? null : stamp;
}
function documentDate(entry) {
  const meta = frontMatterMeta(entry.source);
  if (meta.date) return meta.date;
  const fromName = filenameDate(entry.name);
  if (fromName) return fromName;
  return Number(entry.lastModified) || Number(entry.openedAt) || Number(entry.indexedAt) || 0;
}
function formatDocumentDate(timestamp) {
  if (!timestamp) return 'дата неизвестна';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(timestamp);
}
function documentDateSource(entry) {
  if (frontMatterMeta(entry.source).date) return 'из front matter';
  if (filenameDate(entry.name)) return 'из имени файла';
  if (Number(entry.lastModified)) return 'из даты изменения';
  if (Number(entry.openedAt)) return 'из даты открытия';
  return null;
}
function documentTitle(entry) {
  const meta = frontMatterMeta(entry.source);
  const baseName = String(entry.name || '').replace(/\.(md|markdown)$/i, '');
  return meta.title && meta.title !== baseName && meta.title !== entry.name ? meta.title : '';
}
function searchableEntryText(entry) {
  const meta = frontMatterMeta(entry.source);
  return [entry.name, entry.path, entry.root, meta.title, ...meta.tags, ...(entry.tags || []), entry.source || ''].join(' ');
}
function snippetFor(entry, query) {
  const sourceLines = (entry.source || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const queryTokens = searchTokens(query);
  const matchingLine = sourceLines.find((line) => {
    const lineTokens = new Set(searchTokens(line));
    return queryTokens.some((token) => lineTokens.has(token));
  });
  if (!matchingLine) return `${entry.name} · совпадение в имени, пути или тегах`;
  return matchingLine.length > 150 ? `${matchingLine.slice(0, 147)}…` : matchingLine;
}
function formatIndexTime(timestamp) {
  return timestamp ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp) : 'не индексирован';
}
async function renderFolderPanel() {
  const panel = $('folderPanel');
  const list = $('folderList');
  if (!panel || !list) return;
  let folders = [];
  try { folders = await readCatalogFolders(); } catch { /* catalog is optional */ }
  let files = [];
  try { files = await readCatalogFiles(); } catch { /* catalog is optional */ }
  panel.hidden = folders.length === 0;
  list.replaceChildren();
  folders.forEach((folder) => {
    const count = files.filter((file) => file.connectionId === folder.id).length;
    const row = document.createElement('div');
    row.className = 'folder-row';
    const copy = document.createElement('div');
    copy.className = 'folder-copy';
    const name = document.createElement('strong');
    name.textContent = folder.name;
    const meta = document.createElement('small');
    meta.textContent = `${count} файлов · индекс ${formatIndexTime(folder.lastIndexedAt)}`;
    copy.append(name, meta);
    const remove = document.createElement('button');
    remove.className = 'secondary-button'; remove.type = 'button';
    remove.textContent = 'Удалить';
    remove.title = `Удалить «${folder.name}» из каталога`;
    remove.onclick = async () => {
      const message = `Удалить «${folder.name}» из каталога? Файлы на диске не затрагиваются. Черновики, избранное и недавние остаются.`;
      if (!window.confirm(message)) return;
      try {
        await deleteCatalogFolder(folder.id);
        memorySearchIndex = null;
        showToast(`Папка «${folder.name}» удалена из каталога`);
        renderFolderPanel(); renderLibrary(); refreshRecent();
      } catch {
        showToast('Не удалось удалить папку из каталога');
      }
    };
    row.append(copy, remove);
    list.append(row);
  });
}
async function reindexLibrary() {
  if (indexingInProgress) return;
  indexingInProgress = true;
  $('reindexButton').disabled = true;
  $('indexStatus').textContent = 'Переиндексация…';
  try {
    const refreshed = await rescanConnectedFolders();
    const entries = await getLibraryEntries();
    const indexed = [];
    let skipped = 0;
    for (const entry of entries) {
      if (entry.kind === 'catalog' && entry.handle) {
        try {
          const file = await entry.handle.getFile();
          entry.source = await file.text();
          entry.indexedAt = Date.now();
        } catch { skipped += 1; continue; }
      }
      indexed.push({ ...entry, pageId: entry.pageId || createPageId(), indexedAt: Date.now() });
    }
    memorySearchIndex = { entries: indexed, builtAt: Date.now(), skipped };
    const note = refreshed.failed ? `, недоступно папок: ${refreshed.failed}` : '';
    $('indexStatus').textContent = `Индекс обновлён: ${indexed.length} документов${note}`;
  } catch {
    $('indexStatus').textContent = 'Не удалось построить индекс';
  } finally {
    indexingInProgress = false;
    $('reindexButton').disabled = false;
    renderLibrary();
  }
}

/* Re-walks every stored folder so files added or removed since the last scan
 * appear without the user reconnecting the folder. Folders whose permission
 * was revoked are reported, not silently dropped. */
async function rescanConnectedFolders() {
  if (!supportsFolderAccess()) return { folders: 0, files: 0, failed: 0 };
  let folders;
  try { folders = await readCatalogFolders(); } catch { return { folders: 0, files: 0, failed: 0 }; }
  let files = 0;
  let failed = 0;
  for (const folder of folders) {
    try {
      if (folder.handle.queryPermission && await folder.handle.queryPermission({ mode: 'read' }) !== 'granted') {
        failed += 1; continue;
      }
      const existingFiles = await readCatalogFiles();
      const existingById = new Map(existingFiles
        .filter((file) => file.connectionId === folder.id).map((file) => [file.id, file]));
      const found = await walkMarkdownFiles(folder.handle, folder.id, '', folder.name, existingById);
      await saveCatalogFolder({ ...folder, lastIndexedAt: Date.now() });
      await replaceFolderFiles(folder.id, found);
      files += found.length;
    } catch { failed += 1; }
  }
  return { folders: folders.length, files, failed };
}
async function renderLibrary(recentEntries = null) {
  const list = $('libraryList');
  if (!list) return;
  renderResurfacing();
  const liveEntries = recentEntries
    ? [...recentEntries.map((entry) => ({ ...entry, root: 'Открытые файлы', path: entry.name, kind: 'recent' }))]
    : await getLibraryEntries();
  if (librarySearchTerm && !memorySearchIndex) {
    list.replaceChildren();
    $('libraryEmpty').hidden = false;
    $('libraryEmpty').querySelector('strong').textContent = 'Индекс ещё не построен';
    $('libraryEmpty').querySelector('span').textContent = 'Нажмите «Переиндексировать», чтобы искать по содержимому.';
    $('libraryResultCount').textContent = '';
    $('indexStatus').textContent = 'Нажмите «Переиндексировать», чтобы искать по содержимому';
    return;
  }
  const entries = librarySearchTerm && memorySearchIndex ? memorySearchIndex.entries : liveEntries;
  const dateCache = new Map();
  const entryDate = (entry) => {
    if (!dateCache.has(entry)) dateCache.set(entry, documentDate(entry));
    return dateCache.get(entry);
  };
  const staleCutoff = Date.now() - 90 * 86400000;
  const compareEntries = (a, b) => {
    if (librarySort === 'name') return a.name.localeCompare(b.name, 'ru');
    const delta = entryDate(a) - entryDate(b);
    return librarySort === 'old' ? delta : -delta;
  };
  const filtered = entries.filter((entry) => {
    const haystack = searchableEntryText(entry);
    return (!librarySearchTerm || matchesSearchText(haystack, librarySearchTerm)) &&
      (!favoritesOnly || entry.favorite) &&
      (!staleOnly || (entryDate(entry) > 0 && entryDate(entry) < staleCutoff));
  }).slice().sort(compareEntries);
  list.replaceChildren();
  const groups = new Map();
  filtered.forEach((entry) => {
    const group = groups.get(entry.root || 'Без папки') || [];
    group.push(entry); groups.set(entry.root || 'Без папки', group);
  });
  groups.forEach((groupEntries, root) => {
    const section = document.createElement('section');
    section.className = 'library-group';
    const collapsed = collapsedLibraryGroups.has(root) && !librarySearchTerm;
    section.innerHTML = `<h2><button class="library-group-toggle" type="button" aria-expanded="${!collapsed}"><span>▱</span><span class="library-group-name">${escapeHtml(root)}</span><small>${groupEntries.length}</small><span class="library-group-chevron" aria-hidden="true">${collapsed ? '＋' : '−'}</span></button></h2>`;
    const groupList = document.createElement('div'); groupList.className = 'library-group-list';
    groupList.hidden = collapsed;
    section.querySelector('.library-group-toggle').onclick = () => {
      const isCollapsed = !groupList.hidden;
      groupList.hidden = isCollapsed;
      section.querySelector('.library-group-toggle').setAttribute('aria-expanded', String(!isCollapsed));
      section.querySelector('.library-group-chevron').textContent = isCollapsed ? '＋' : '−';
      if (isCollapsed) collapsedLibraryGroups.add(root);
      else collapsedLibraryGroups.delete(root);
      saveCollapsedLibraryGroups();
    };
    groupEntries.forEach((entry) => {
      const item = document.createElement('button'); item.className = 'library-document'; item.type = 'button';
      item.innerHTML = '<span class="library-file-icon">MD</span><span class="library-document-copy"><strong></strong><small></small><em class="library-snippet"></em></span><span class="library-arrow">›</span>';
      const title = documentTitle(entry);
      item.querySelector('strong').textContent = entry.name;
      item.querySelector('small').textContent = `${title ? `${title} · ` : ''}${entry.path === entry.name ? 'Markdown' : entry.path} · ${formatDocumentDate(entryDate(entry))}`;
      item.querySelector('.library-snippet').textContent = librarySearchTerm ? snippetFor(entry, librarySearchTerm) : '';
      item.onclick = () => entry.kind === 'catalog' ? openCatalogFile(entry) : selectDocument(entry.name, entry.source, entry);
      groupList.append(item);
    });
    section.append(groupList); list.append(section);
  });
  const filtersActive = Boolean(librarySearchTerm) || favoritesOnly || staleOnly;
  $('libraryEmpty').querySelector('strong').textContent = filtersActive ? 'Ничего не найдено' : 'Библиотека пока пуста';  $('libraryEmpty').querySelector('span').textContent = filtersActive ? 'Измените фильтры или строку поиска.' : 'Подключите папку или откройте отдельный Markdown-файл.';
  $('libraryDemoButton').hidden = filtersActive;
  $('libraryEmpty').hidden = filtered.length > 0;
  $('libraryResultCount').textContent = filtered.length ? `${filtered.length} документов${memorySearchIndex ? ` · индекс ${formatIndexTime(memorySearchIndex.builtAt)}` : ''}` : '';
}
function showLibrary() {
  $('appShell').classList.add('library-state');
  $('appShell').classList.remove('document-state', 'editing-state', 'structure-open');
  $('libraryView').hidden = false; $('documentWorkspace').hidden = true;
  $('fileName').textContent = 'Локальная библиотека'; $('crumbSeparator').hidden = true; $('draftIndicator').hidden = true;
  $('structureButton').hidden = true; $('documentMenuGroup').hidden = true; $('libraryMenuGroup').hidden = false;
  $('outline').hidden = true;
  rememberScrollPosition();
  void renderFolderPanel();
  $('moreButton').hidden = false; renderLibrary();
  toggleLibraryDrawer(false);
}
function showDocument() {
  $('appShell').classList.add('document-state');
  $('appShell').classList.remove('library-state', 'editing-state', 'structure-open');
  $('libraryView').hidden = true; $('documentWorkspace').hidden = false;
  $('crumbSeparator').hidden = false; $('documentMenuGroup').hidden = false; $('libraryMenuGroup').hidden = true;
  $('outline').hidden = true;
  $('moreButton').hidden = false; $('structureButton').hidden = editorMode;
  document.title = `${currentFileName} — Memoroid`;
}
function toggleLibraryDrawer(open) {
  libraryDrawerOpen = open;
  $('appShell').classList.toggle('drawer-open', open);
  const mobile = window.matchMedia('(max-width: 650px)').matches;
  const drawer = mobile && document.querySelector('#appShell').classList.contains('document-state');
  if (drawer) $('sidebar').setAttribute('aria-hidden', String(!open));
  else $('sidebar').removeAttribute('aria-hidden');
  $('drawerBackdrop').hidden = !open;
}
function openFile(file) {
  if (!file || !/\.(md|markdown)$/i.test(file.name)) return showToast('Выберите файл .md или .markdown');
  currentFileHandle = null; currentParentHandle = null; currentFileBaseline = null;
  const reader = new FileReader();
  reader.onload = () => { selectDocument(file.name, String(reader.result || ''), { lastModified: file.lastModified }); refreshRecent(); showToast(`Открыт ${file.name}`); };
  reader.onerror = () => showToast('Не удалось прочитать файл');
  reader.readAsText(file);
}

renderMarkdown(demoMarkdown); initWasmIndexer().then(() => renderMarkdown(currentMarkdown)); refreshRecent(); restoreCatalogFolders(); showLibrary();
try {
  const settings = readSettings();
  if (settings.dark) document.body.classList.add('dark');
  if (['new', 'old', 'name'].includes(settings.sort)) { librarySort = settings.sort; $('librarySortSelect').value = settings.sort; }
  if (Array.isArray(settings.excludes)) $('excludesInput').value = settings.excludes.join(', ');
} catch {}
if ($('appVersion')) $('appVersion').textContent = `v${APP_VERSION}`;
function readSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { return {}; }
}
function saveSettings(patch) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readSettings(), ...patch })); } catch { /* file:// may deny storage */ }
}
$('openButton').onclick = () => $('fileInput').click();
$('folderButton').onclick = connectFolder;
$('exportButton').onclick = () => {
  const count = readDocuments().length;
  if (!count || window.confirm(`Включить в memoroid.json полный текст ${count} заметок и все черновики? Файл будет содержать копию ваших записей в открытом виде.`)) exportLibrary(true);
  else if (count) exportLibrary(false);
};
$('importButton').onclick = () => $('importInput').click();
$('importInput').onchange = (e) => { importLibrary(e.target.files[0]); e.target.value = ''; };
$('libraryDemoButton').onclick = () => { favoritesOnly = false; selectDocument('welcome.md', demoMarkdown); refreshRecent(); };
$('libraryFolderButton').onclick = connectFolder;
$('libraryOpenButton').onclick = () => $('fileInput').click();
$('reindexButton').onclick = reindexLibrary;
$('libraryButton').onclick = () => {
  if (window.matchMedia('(max-width: 650px)').matches) toggleLibraryDrawer(true);
  else showLibrary();
};
$('librarySearchInput').oninput = (e) => { librarySearchTerm = e.target.value.trim().toLocaleLowerCase(); renderLibrary(); };
$('libraryFavoritesButton').onclick = () => {
  favoritesOnly = !favoritesOnly;
  $('libraryFavoritesButton').setAttribute('aria-pressed', String(favoritesOnly));
  $('libraryFavoritesButton').textContent = favoritesOnly ? '★ Только избранное' : '☆ Только избранное';
  renderLibrary(); refreshRecent();
};
$('staleButton').onclick = () => {
  staleOnly = !staleOnly;
  $('staleButton').setAttribute('aria-pressed', String(staleOnly));
  renderLibrary();
};
$('librarySortSelect').onchange = (event) => { librarySort = event.target.value; saveSettings({ sort: librarySort }); renderLibrary(); };
$('sidebarCloseButton').onclick = () => toggleLibraryDrawer(false);
$('drawerBackdrop').onclick = () => toggleLibraryDrawer(false);
$('conflictDownloadButton').onclick = () => downloadCurrentFile();
$('conflictReloadButton').onclick = async () => {
  try {
    const file = await currentFileHandle.getFile();
    currentMarkdown = await file.text();
    currentFileBaseline = { lastModified: file.lastModified, size: file.size };
    if (editorMode) $('editorInput').value = currentMarkdown;
    renderMarkdown(currentMarkdown);
    $('docStatus').textContent = 'Загружена версия с диска';
  } catch { showToast('Не удалось загрузить версию с диска'); }
};
$('moreButton').onclick = () => {
  const menu = $('moreMenu'); const opening = menu.hidden;
  menu.hidden = !opening; $('moreButton').setAttribute('aria-expanded', String(opening));
};
document.addEventListener('click', (event) => {
  if (!$('moreMenu').hidden && !event.target.closest('#moreMenu, #moreButton')) {
    $('moreMenu').hidden = true; $('moreButton').setAttribute('aria-expanded', 'false');
  }
});
$('structureButton').onclick = () => {
  const outline = document.querySelector('.outline'); const opening = outline.hidden;
  outline.hidden = !opening; $('structureButton').setAttribute('aria-expanded', String(opening));
  $('appShell').classList.toggle('structure-open', opening);
};
$('fileInput').onchange = (e) => { openFile(e.target.files[0]); e.target.value = ''; };
$('allNotesButton').onclick = () => { favoritesOnly = false; $('favoritesButton').classList.remove('active'); $('favoritesButton').setAttribute('aria-pressed', 'false'); showLibrary(); };
$('welcomeFileButton').onclick = () => { favoritesOnly = false; selectDocument('welcome.md', demoMarkdown); refreshRecent(); };
$('demoButton').onclick = () => { favoritesOnly = false; selectDocument('welcome.md', demoMarkdown); refreshRecent(); };
$('editButton').onclick = () => setEditorMode(!editorMode);
$('editorInput').oninput = (e) => { currentMarkdown = e.target.value; renderMarkdown(currentMarkdown); saveDraft(); };
$('saveButton').onclick = saveToOriginal;
$('downloadButton').onclick = downloadCurrentFile;
$('favoritesButton').onclick = () => { favoritesOnly = !favoritesOnly; $('favoritesButton').classList.toggle('active', favoritesOnly); $('favoritesButton').setAttribute('aria-pressed', String(favoritesOnly)); refreshRecent(); };
$('favoriteButton').onclick = () => { currentFavorite = !currentFavorite; updateFavoriteButton(); saveCurrentMetadata(); showToast(currentFavorite ? 'Добавлено в избранное' : 'Удалено из избранного'); };
$('tagsInput').onchange = (e) => { currentTags = e.target.value.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean).slice(0, 10); e.target.value = currentTags.join(', '); saveCurrentMetadata(); showToast('Теги сохранены локально'); };
$('excludesInput').onchange = (e) => {
  const excludes = e.target.value.split(',').map((name) => name.trim()).filter(Boolean).slice(0, 40);
  e.target.value = excludes.join(', ');
  saveSettings({ excludes });
  memorySearchIndex = null;
  showToast(excludes.length ? 'Исключения сохранены. Переиндексируйте библиотеку.' : 'Исключения очищены');
};
$('themeButton').onclick = () => { document.body.classList.toggle('dark'); saveSettings({ dark: document.body.classList.contains('dark') }); };
$('focusButton').onclick = () => document.body.classList.toggle('focus');
$('copyButton').onclick = async () => { try { await navigator.clipboard.writeText(currentMarkdown); showToast('Markdown скопирован'); } catch { showToast('Скопируйте текст вручную из режима «Исходник»'); } };
$('copyRenderedButton').onclick = copyRenderedDocument;
$('exportDocumentButton').onclick = exportDocumentHtml;
$('rawButton').onclick = () => { rawMode = !rawMode; $('markdownOutput').textContent = rawMode ? currentMarkdown : ''; $('rawButton').textContent = rawMode ? '◉ Просмотр' : '{ } Исходник'; if (!rawMode) renderMarkdown(currentMarkdown); };
$('searchInput').oninput = (e) => { searchTerm = e.target.value.trim(); renderMarkdown(currentMarkdown); };
const dropZone = $('dropZone');
['dragenter', 'dragover'].forEach((event) => dropZone.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((event) => dropZone.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', (e) => openFile(e.dataTransfer.files[0]));
const isTypingTarget = (element) => Boolean(element) && (
  ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable === true
);

document.addEventListener('keydown', (e) => {
  const typing = isTypingTarget(document.activeElement);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); $('fileInput').click(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); window.print(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveToOriginal(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); setEditorMode(!editorMode); return; }
  if (typing) return;
  if (e.key === '/' && document.activeElement !== $('searchInput')) {
    e.preventDefault();
    const menu = $('moreMenu');
    menu.hidden = false; $('moreButton').setAttribute('aria-expanded', 'true');
    $('searchInput').focus();
  }
  if (e.key === 'Escape') { toggleLibraryDrawer(false); $('moreMenu').hidden = true; $('moreButton').setAttribute('aria-expanded', 'false'); }
});
