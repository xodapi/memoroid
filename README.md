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
