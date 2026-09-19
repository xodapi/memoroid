# ADR-0001: Keep Markdown files as the source of truth

## Status

Accepted

## Context

Memoroid is intended for engineering documents that should remain portable,
inspectable, and usable outside the application. A previous prototype stored
opened text in browser storage, which was convenient but could become stale,
was limited by browser quotas, and disappeared when browser data was cleared.

The project needs multiple folders, local metadata, editing, and recovery
without introducing a server or account.

## Decision

Memoroid will use a local-first library model:

- the user explicitly connects one or more folders;
- original `.md` files remain in those folders;
- Memoroid stores catalog metadata separately;
- Memoroid may keep a temporary or recoverable Draft;
- editing writes back only after explicit confirmation;
- an external change blocks silent overwrite;
- a `.bak` backup is made before each write, retaining the five newest;
- removing a Document from the Library removes only catalog membership, not the
  original file.

The catalog may be exported and imported as `memoroid.json`.

## Consequences

### Positive

- Markdown remains portable and easy to back up.
- Users retain control of their original files.
- No server, account, or cloud dependency is required.
- Future search, tags, folders, and notes can build on the Catalog.

### Negative

- Browser filesystem permissions must be handled explicitly.
- A web-only implementation cannot reliably watch every external change.
- The Catalog can become stale and needs refresh/re-index behavior.
- Editing requires conflict detection and backup handling.

## Rejected alternatives

- Importing all files into a private database would create a second source of
  truth and increase migration and recovery risk.
- Scanning the whole disk would be intrusive, slow, and difficult to explain.
