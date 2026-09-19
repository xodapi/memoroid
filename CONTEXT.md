# Memoroid domain context

## Purpose

Memoroid is a local-first library and viewer for engineering Markdown
documents. It helps a person find and read documents without requiring an
account, server, or network connection.

## Terms

### Document

A Markdown file with a `.md` or `.markdown` extension that Memoroid can read.
The document is a user-owned file and remains the source of truth.

### Library

The set of explicitly connected folders and the Documents found in them.
Memoroid must not scan the whole computer without an explicit user action.

### Catalog

Memoroid's local metadata about a Document: its identity, location, tags,
favorite state, last-viewed time, and derived navigation information.
Catalog data is not the document itself.

### Source of truth

The original Markdown file on the user's storage. Catalog data and temporary
copies must never silently replace it.

### Draft

An unsaved version of a Document created during editing. A Draft must remain
recoverable if the original file cannot be written.

### External change

A change made to a Document outside Memoroid after Memoroid last read it.
Memoroid must warn before overwriting a Document affected by an External change.

### Backup

A `.bak` copy made before Memoroid writes to the original Document. The
initial policy keeps the five most recent backups.

### Read-only document

A Document that Memoroid can display but cannot safely write, for example
because of permissions or a denied browser capability.

### Folder connection

An explicit user-approved association between Memoroid and a filesystem folder.
Multiple Folder connections are allowed.

Folder connections are persisted locally as permission-aware handles. A
subsequent session may refresh a connection only when the browser still grants
read permission; otherwise the user must explicitly connect the folder again.

### Working state

Memoroid has three user-facing Working states: Library for finding Documents,
Reading for viewing one Document, and Editing for changing a Draft. A Working
state describes the user's task, not the technical Extended or Fallback mode.

### Extended mode

The optional mode in which the approved browser grants Memoroid access to
selected Folder connections. It enables recursive indexing and writing back
to original Documents.

### Fallback mode

The mode used when folder access is unavailable or denied. It supports opening
individual Documents, editing a recoverable Draft, and downloading the result,
but does not silently write to the original file.

### Catalog export

An explicit `memoroid.json` file containing portable Catalog metadata. It does
not contain the original Documents unless a future feature explicitly defines
that behavior.

### Page ID

An opaque identifier assigned to a Catalog record for one Document. It is
metadata, not derived from the Document name or location. If a moved or
renamed file is represented as a new Catalog record, it receives a new Page
ID.

### Search index

A temporary local representation used to find Documents by their text and
searchable Catalog metadata. It is rebuilt only after an explicit reindex
action and is not a replacement for the source-of-truth Document.
