# Memoroid agent guidance

Memoroid is a local-first Markdown library and viewer for engineering notes.
Keep the fallback mode usable by opening `index.html` directly without a
server. The extended folder-library mode must remain optional.

## Agent skills

### Issue tracker

Issues live as local Markdown files under `.scratch/`.
See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the default triage labels:
`needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, and `wontfix`.
See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context project with `CONTEXT.md`
and `docs/adr/`.
See `docs/agents/domain.md`.

## Working rules

- Preserve offline operation and do not add required external services.
- Do not assume administrator rights, installation, or network access.
- Treat the original Markdown file as the source of truth.
- Do not silently delete, overwrite, or move user files.
- Validate JavaScript syntax and exercise the browser flow after UI changes.
- Keep future features modular and optional.
