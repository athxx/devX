// Small dependency-free CSV parser (RFC 4180-aware).
//
// devX avoids npm dependencies for self-contained features, so the DB CSV import
// path parses files by hand. Handles quoted fields, escaped quotes (""), and
// embedded commas / newlines inside quotes. Both \n and \r\n line endings are
// accepted; a trailing newline is ignored.

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

/** Parse CSV text into a header row plus data rows. */
export function parseCsv(text: string, delimiter = ","): ParsedCsv {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  while (i < len) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Swallow CR; the following LF (if any) finalizes the record.
      if (text[i + 1] === "\n") {
        pushRecord();
        i += 2;
        continue;
      }
      pushRecord();
      i += 1;
      continue;
    }
    if (char === "\n") {
      pushRecord();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  // Flush the final field/record unless the file ended on a clean newline.
  if (field.length > 0 || record.length > 0) {
    pushRecord();
  }

  // Drop a trailing empty record produced by a terminal newline.
  while (
    records.length > 0 &&
    records[records.length - 1].length === 1 &&
    records[records.length - 1][0] === ""
  ) {
    records.pop();
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...rows] = records;
  return { headers, rows };
}
