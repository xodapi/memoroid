# ADR-0002: Use a hybrid HTML/WASM runtime

## Status

Accepted

## Context

Memoroid must run in a closed KII environment on Windows computers where users
may not have administrator rights. Installation, background services, local
servers, cloud services, telemetry, auto-updates, and network dependencies add
security-review and deployment cost.

At the same time, the product needs an optional library mode that can index
explicitly selected folders and write Markdown changes back safely. A plain
static web page cannot guarantee those filesystem capabilities in every
browser.

## Decision

Memoroid will use a progressive hybrid runtime:

- the primary delivery is a self-contained ZIP containing HTML, CSS, JavaScript,
  and WASM assets;
- fallback mode works by opening `index.html` directly and never requires a
  server or installation;
- extended mode uses only browser filesystem capabilities available and
  permitted in the approved corporate browser;
- the user explicitly selects each folder connection;
- if folder access is unavailable, Memoroid degrades to read, draft, and
  download behavior rather than failing or requesting elevated privileges;
- no required network activity, telemetry, auto-update, licensing check, or
  cloud synchronization is included;
- the release archive is accompanied by a manifest of file hashes.

The exact browser policy and CSP/network enforcement remain deployment
responsibilities of the organization and must be verified in a release test.

## Consequences

### Positive

- No administrator rights or installation are required.
- The viewer remains usable under restrictive browser policies.
- The same UI and domain model support both simple viewing and folder library.
- WASM can be introduced for local indexing without changing the storage model.

### Negative

- Extended mode depends on capabilities and policy of the approved browser.
- The application must clearly communicate which mode is active.
- Folder handles and permissions may need to be re-approved after browser
  restart or policy changes.
- A separate release validation is needed for the target corporate image.

## Rejected alternatives

- A portable desktop executable would provide filesystem access but introduces
  executable signing, application-control, and antivirus review questions.
- A local server adds a process and open-port concerns without solving all
  deployment constraints.
