// A faster drop-in for csv-reader 1.0.0 (make.fun csv-reader-speed-01): the same
// {columns, rows, errors} for every input, read with the same broken-row policy,
// but built for V8 instead of one character at a time.
//
// How it stays fast:
//   - unquoted fields are scanned with a tight charCodeAt loop and cut out with
//     one String.slice (a zero-copy SlicedString) when they hold no stray CR;
//     only a field that actually holds a stray CR pays for segment joining;
//   - a quoted field whose next quote is its closer and whose body holds no CR
//     is one slice plus a count of its LFs; the character-by-character rebuild
//     runs only when a "" escape or a CR is really inside;
//   - every indexOf is bounded by the slice it inspects, so a search for a rare
//     character never scans the rest of the file;
//   - a record's fields fill a preallocated array by index, not push by push.
//
// The policy, matched case for case: a U+FEFF at the very start is dropped; a
// record ends at LF or CRLF and a line left with no characters is no record;
// outside quotes a CR not followed by LF is dropped (stray_cr); a field that
// opens with a quote runs to the next quote that is not doubled, "" inside it
// one quote and each CRLF or lone CR inside it read as LF; what follows its
// closing quote, up to the next comma or line break, is appended as it stands
// (quote_junk, when the field ends); a quote that never closes is a literal
// character and the text after it is read again as unquoted
// (unterminated_quote); a quote inside an unquoted field is a literal
// character; columns is the first record when header is true, else null; rows
// are padded (short_row, with fields: the count) or cut (long_row, with extra:
// the cut fields) to the first record's width; each error is {code, line, row}
// in the order met, line the 1-based line its record starts on and row its
// record's index in rows, null for the header.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = n > 0 && text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;

    const fields = new Array(24);
    let fc = 0;
    let quotedLast = false;
    let ended = 0; // 0 comma, 1 line break, 2 end
    do {
      let value;
      if (pos < n && text.charCodeAt(pos) === 34) {
        quotedLast = true;
        const open = pos;
        const openLine = line;
        const body = open + 1;
        let closed = false;
        // Fast close: the next quote is the closer (not doubled) and the body
        // holds no CR, so the value is one slice and only its LFs count lines.
        const q = text.indexOf('"', body);
        if (q !== -1 && text.charCodeAt(q + 1) !== 34) {
          const v = text.slice(body, q);
          if (v.indexOf('\r') === -1) {
            let cnt = 0;
            let j = v.indexOf('\n');
            while (j !== -1) { cnt += 1; j = v.indexOf('\n', j + 1); }
            value = v;
            line += cnt;
            pos = q + 1;
            closed = true;
          }
        }
        if (!closed && q !== -1) {
          // General quoted scan: "" unescapes, CRLF / lone CR inside read as LF.
          let i = body;
          let val = '';
          let l = line;
          let ok = false;
          while (i < n) {
            const c = text.charCodeAt(i);
            if (c === 34) {
              if (text.charCodeAt(i + 1) === 34) { val += '"'; i += 2; continue; }
              i += 1; ok = true; break;
            }
            if (c === 13) { val += '\n'; l += 1; i += text.charCodeAt(i + 1) === 10 ? 2 : 1; continue; }
            if (c === 10) l += 1;
            val += text[i];
            i += 1;
          }
          if (ok) { value = val; line = l; pos = i; closed = true; }
        }
        if (!closed) {
          // The quote never closes: literal character, text after it read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          line = openLine;
          // Unquoted re-read from body, value seeded with the opening quote.
          let acc = '"';
          let seg = body;
          let i = body;
          for (;;) {
            if (i >= n) { value = acc + text.slice(seg, n); pos = n; ended = 2; break; }
            const c = text.charCodeAt(i);
            if (c === 44) { value = acc + text.slice(seg, i); pos = i + 1; ended = 0; break; }
            if (c === 10) { value = acc + text.slice(seg, i); pos = i + 1; line += 1; ended = 1; break; }
            if (c === 13) {
              if (text.charCodeAt(i + 1) === 10) { value = acc + text.slice(seg, i); pos = i + 2; line += 1; ended = 1; break; }
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              acc += text.slice(seg, i);
              i += 1; seg = i; continue;
            }
            i += 1;
          }
          fields[fc++] = value;
          continue;
        }
        // After the closing quote: delimiter, line break, end, or junk.
        if (pos >= n) {
          ended = 2;
        } else {
          const c = text.charCodeAt(pos);
          if (c === 44) { pos += 1; ended = 0; }
          else if (c === 10) { pos += 1; line += 1; ended = 1; }
          else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; ended = 1; }
          else {
            // Junk: appended as it stands (stray CRs drop, with their errors);
            // quote_junk when at least one character was kept.
            let acc = value;
            let seg = pos;
            let i = pos;
            let added = 0;
            for (;;) {
              if (i >= n) { added += i - seg; value = acc + text.slice(seg, n); pos = n; ended = 2; break; }
              const cc = text.charCodeAt(i);
              if (cc === 44) { added += i - seg; value = acc + text.slice(seg, i); pos = i + 1; ended = 0; break; }
              if (cc === 10) { added += i - seg; value = acc + text.slice(seg, i); pos = i + 1; line += 1; ended = 1; break; }
              if (cc === 13) {
                if (text.charCodeAt(i + 1) === 10) { added += i - seg; value = acc + text.slice(seg, i); pos = i + 2; line += 1; ended = 1; break; }
                errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                acc += text.slice(seg, i);
                added += i - seg;
                i += 1; seg = i; continue;
              }
              i += 1;
            }
            if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          }
        }
        fields[fc++] = value;
      } else {
        quotedLast = false;
        // Unquoted field: scan to the next comma or line break; stray CRs drop.
        const start = pos;
        let acc = null;
        let seg = pos;
        let i = pos;
        for (;;) {
          if (i >= n) { value = acc === null ? text.slice(start, n) : acc + text.slice(seg, n); pos = n; ended = 2; break; }
          const c = text.charCodeAt(i);
          if (c === 44) { value = acc === null ? text.slice(start, i) : acc + text.slice(seg, i); pos = i + 1; ended = 0; break; }
          if (c === 10) { value = acc === null ? text.slice(start, i) : acc + text.slice(seg, i); pos = i + 1; line += 1; ended = 1; break; }
          if (c === 13) {
            if (text.charCodeAt(i + 1) === 10) { value = acc === null ? text.slice(start, i) : acc + text.slice(seg, i); pos = i + 2; line += 1; ended = 1; break; }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            acc = acc === null ? text.slice(start, i) : acc + text.slice(seg, i);
            i += 1; seg = i; continue;
          }
          i += 1;
        }
        fields[fc++] = value;
      }
    } while (ended === 0);
    fields.length = fc;

    // A line that held only stray CRs is left with no characters: no record.
    if (fc === 1 && fields[0] === '' && !quotedLast) continue;

    if (width < 0) width = fc;
    if (header && columns === null) { columns = fields; continue; }
    if (fc < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fc });
      while (fields.length < width) fields.push('');
    } else if (fc > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
