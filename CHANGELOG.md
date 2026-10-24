# Changelog

## 0.1.3 - 2026-10-24

- Make the JSON backup export/import limit consistent at 20 MiB, measured in UTF-8 bytes; previously valid large exports could not be imported again.
- Add a maximum-record regression test using 5000 allowed 500-character notes.

## 0.1.2 — 2026-10-13

- Validate dates in years 0001–0099 correctly.
- Persist changes before updating the in-memory shift list so quota failures cannot leave unsaved edits active.
- Expand CI to Node.js 20, 22, and 24; add automated release archives with SHA-256 checksums.

## 0.1.1 - 2026-10-11

- Complete the standard MIT license text, restoring the full warranty and liability disclaimer.

## 0.1.0 — 2026-10-10

- First public version of the local shift log and gross-pay calculator.
- Add/edit/delete shifts, period summaries, weekly/monthly breakdowns by currency, search, CSV/JSON import and export.
- Add fixed-cent arithmetic, input validation, formula-safe CSV output, and backup size/record limits.
