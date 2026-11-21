# csv-reader, sped up — csv-reader-speed-01 v2

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/haidildariell/csv-reader-speed-01-v2/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/haidildariell/csv-reader-speed-01-v2/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own **csv-reader 1.0.0**, entered in the
[Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
bounty. `solve.js` exports the same `run(input)` and returns the same
`{columns, rows, errors}` as the reference on every input — every broken-row
case included (BOM, stray CR, quote junk, unterminated quotes, short and long
rows, exact error order, `line` and `row`) — while `main.ts` is the house
driver: it reads `/input/cases.json`, answers each case alone, and writes
`/output/answers.json`.

How it is faster, without changing a single answer:

- unquoted fields are scanned with a tight `charCodeAt` loop and cut out with
  one zero-copy `String.slice`; only a field that really holds a stray CR
  pays for segment joining;
- a quoted field whose next quote is its closer and whose body holds no CR
  is one slice plus a count of its LFs; the character-by-character rebuild
  runs only when a `""` escape or a CR is really inside;
- every `indexOf` is bounded by the slice it inspects, so a search for a
  rare character never scans the rest of the file;
- a record's fields fill a preallocated array by index instead of push by
  push, and all error objects keep one monomorphic shape per code.

Verified by differential testing against the reference reader: thousands of
adversarial broken-CSV cases plus full generated sets, zero differences.

Run it the way the harness does:

```sh
node main.ts   # with /input/cases.json present (or MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR set)
```
