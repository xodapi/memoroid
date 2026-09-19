# Memoroid WASM indexer

`memoroid-index.wasm` is an optional `no_std` Rust module used for local
word-count calculations and exact normalized-token matching during document
search. It has no network or filesystem access.

The checked-in `memoroid-index.js` loader embeds the binary so `index.html`
continues to work from `file://`. JavaScript remains the fallback if WASM is
blocked by the browser policy.

Rebuild with:

```text
rustup target add wasm32-unknown-unknown
rustc --target wasm32-unknown-unknown --crate-type cdylib -C opt-level=z -C lto=fat -C codegen-units=1 -C strip=symbols -C panic=abort -C link-arg=--export=count_words -C link-arg=--export=contains_all_tokens -C link-arg=--export-memory -C link-arg=--initial-memory=2097152 -C link-arg=--max-memory=2097152 wasm/index.rs -o wasm/memoroid-index.wasm
pwsh -File wasm/build-loader.ps1
```
