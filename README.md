# Memoroid

> **RU** — см. ниже. **EN** — scroll down.

## Русский

Memoroid — локальная библиотека и просмотрщик Markdown-документов. Открывается
прямо в браузере: без установки, без сервера, без интернета и без прав
администратора. Ваши файлы остаются на вашем компьютере.

**Один файл.** `memoroid-single.html` содержит всё — CSS, JavaScript и WASM.
Скопируйте его на флешку или телефон и откройте через `file://`.

### Зачем

Инженерные заметки часто живут в `.md`-файлах, которые неудобно читать и
сложно найти. Обычные редакторы требуют установки, учётной записи или
подключения к облаку. Memoroid не требует ничего: файл остаётся
первоисточником, приложение лишь помогает его найти и прочитать.

### Что умеет

- **Чтение.** Заголовки, списки, таблицы, цитаты, ссылки, изображения, код.
  Поддержка GFM-списков задач `- [ ]` / `- [x]` с кликабельными чекбоксами,
  зачёркнутым текстом и автоссылками.
- **Поиск.** По текущему документу и по всей библиотеке с фрагментами.
  Поиск по содержимому запускается вручную кнопкой «Переиндексировать».
- **Даты.** Дата документа определяется по приоритету: `date` из front matter →
  `YYYY-MM-DD` в имени файла → дата изменения → дата открытия. Сортировка
  «сначала новые / старые / по имени» и фильтр «давно не открывали».
- **Front matter.** Необязательный блок `---` читается только для метаданных
  (`title`, `date`, `tags`). Исходный Markdown никогда не перезаписывается.
- **Изображения.** Локальные картинки подтягиваются из подключённой папки.
  Ненайденные помечаются видимой подписью с путём.
- **Редактирование.** Черновик хранится локально и восстанавливается при
  сбое. Запись в исходный файл — только по явной команде, с резервной копией
  и проверкой внешнего изменения.
- **Офлайн.** Ни одного внешнего запроса, ни одной телеметрии.

### Как пользоваться

**Русский.** Самый простой путь — скачать `memoroid-single.html` из
[раздела Releases](https://github.com/xodapi/memoroid/releases) и открыть его
двойным щелчком. Всё работает сразу, без установки.

1. **Открыть файл.** Кнопка «Открыть файл» (или `Ctrl`/`⌘` + `O`) — выберите
   любой `.md`. Можно просто перетащить файл в окно.
2. **Читать.** Слева — оглавление (кнопка «Структура»). Внизу — число слов,
   время чтения и дата документа с указанием источника.
3. **Искать.** `/` открывает поиск по текущему документу. В библиотеке —
   отдельное поле поиска.
4. **Редактировать.** «Редактировать» открывает текст слева и предпросмотр
   справа. «Сохранить» пишет прямо в исходный файл, предварительно сделав
   резервную копию. Если файл меняли извне, Memoroid предупредит.
5. **Подключить папку.** «Подключить папку» даёт библиотеку со всеми
   Markdown-файлами внутри. Работает в Chrome и Edge.
6. **Упорядочить.** Сортировка по дате или имени. Фильтры: «Только избранное»
   и «Давно не открывали».
7. **Горячие клавиши.** `⌘O` открыть файл, `/` поиск, `Esc` закрыть меню.

Если браузер не поддерживает доступ к папкам (Firefox, Safari, мобильные),
приложение переходит в **fallback-режим**: открытие отдельных файлов и
черновики работают, запись в исходный файл заменяется скачиванием копии.

**Где мои данные.** Всё в localStorage и IndexedDB вашего браузера.
Приложение не делает ни одного сетевого запроса. Экспорт каталога
(`memoroid.json`) по умолчанию содержит только метаданные — полный текст
заметок добавляется лишь после явного подтверждения.

**English.** The simplest path: download `memoroid-single.html` from the
[Releases page](https://github.com/xodapi/memoroid/releases) and double-click
it. Everything works immediately, with no installation.

1. **Open a file.** Click «Open file» (or `Ctrl`/`⌘` + `O`) and pick any
   `.md`. You can also drag a file onto the window.
2. **Read.** The outline is on the left («Structure»). The footer shows the
   word count, reading time, and the document date with its source.
3. **Search.** `/` opens in-document search. The library has its own search
   field.
4. **Edit.** «Edit» shows the source on the left and a live preview on the
   right. «Save» writes to the original file after making a backup. If the
   file changed externally, Memoroid warns you first.
5. **Connect a folder.** «Connect folder» builds a library from every
   Markdown file inside. Works in Chrome and Edge.
6. **Organize.** Sort by date or name. Filters: «Favorites only» and
   «Not opened for a while».
7. **Shortcuts.** `⌘O` open file, `/` search, `Esc` dismiss menu.

If the browser does not support folder access (Firefox, Safari, mobile), the
app enters **fallback mode**: opening individual files and drafts still work,
and saving produces a downloadable copy instead of writing to the original.

**Where your data lives.** Everything stays in your browser's localStorage
and IndexedDB. The app makes no network requests at all. Catalog export
(`memoroid.json`) contains metadata only by default; full note text is
included only after an explicit confirmation.

### Запуск

Откройте `index.html` в браузере и выберите `.md`-файл. Для работы с папками
нужен браузер с File System Access API (Chrome, Edge) — иначе приложение
переходит в fallback-режим, который поддерживает открытие отдельных файлов
и работает в любом браузере.

Собрать один файл:

```powershell
pwsh -File .\build-single-html.ps1
```

Результат: `memoroid-single.html`.

### Принципы

1. Сначала — быстрый и надёжный просмотрщик.
2. Каждая функция необязательна и работает локально.
3. Markdown-файл — первоисточник. Приложение не меняет его без явной команды.
4. Не добавляем функцию только потому, что она красиво выглядит в демо.

**Сознательно не делаем:** плагины, граф связей, wikilinks, календарь-сетку,
обязательные метаданные, облачную синхронизацию и AI внутри приложения.
Memoroid не должен стать «ещё одним Obsidian».

---

## English

Memoroid is a local-first library and viewer for Markdown documents. It opens
directly in a browser: no install, no server, no internet, no administrator
rights. Your files stay on your machine.

**Single file.** `memoroid-single.html` contains everything — CSS, JavaScript,
and WASM. Copy it to a USB drive or a phone and open it over `file://`.

### Why

Engineering notes often live in `.md` files that are awkward to read and hard
to find. Typical editors demand installation, an account, or a cloud
connection. Memoroid demands none of that: the file remains the source of
truth, and the app only helps you find and read it.

### Features

- **Reading.** Headings, lists, tables, quotes, links, images, code. GFM task
  lists `- [ ]` / `- [x]` with clickable checkboxes, strikethrough, and
  autolinks.
- **Search.** Within the current document and across the library, with
  snippets. Content search runs on demand via «Reindex».
- **Dates.** A document date resolves by priority: front-matter `date` →
  `YYYY-MM-DD` in the filename → modification time → first-opened time. Sort
  by newest / oldest / name, plus a «not opened for a while» filter.
- **Front matter.** An optional `---` block is read for metadata only
  (`title`, `date`, `tags`). The original Markdown is never rewritten.
- **Images.** Local images resolve through the connected folder. Missing ones
  get a visible caption with their path.
- **Editing.** A draft is stored locally and restored on failure. Writing to
  the original file happens only on an explicit command, with a backup and an
  external-change check.
- **Offline.** No external requests, no telemetry.

### Run

Open `index.html` in a browser and pick a `.md` file. Folder connections need
a browser with the File System Access API (Chrome, Edge); otherwise the app
falls back to opening individual files, which works everywhere.

Build the single file:

```powershell
pwsh -File .\build-single-html.ps1
```

Result: `memoroid-single.html`.

### Principles

1. Keep it a fast and reliable viewer first.
2. Every feature is optional and works locally.
3. The Markdown file is the source of truth. The app does not modify it
   without an explicit command.
4. Do not add a feature just because it looks good in a demo.

**Deliberately not doing:** plugins, graph view, wikilinks, a calendar grid,
mandatory metadata, cloud sync, and AI inside the app. Memoroid should not
become «another Obsidian».

---

## Автор / Author

**Богорад С.Б.** / Sergey Bogorad

- Telegram: [t.me/syntog](https://t.me/syntog)
- Email: sergey.bogorad@gmail.com
