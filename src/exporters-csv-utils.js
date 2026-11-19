function csvEscape(val) {
  const s = val === null || val === undefined ? '' : String(val);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function xmlEscape(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseCsv(text, opts = {}) {
  const raw = String(text || '');
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cur.trim());
        cur = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && next === '\n') i++;
        row.push(cur.trim());
        if (row.some((c) => c !== '')) rows.push(row);
        row = [];
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur.trim());
    if (row.some((c) => c !== '')) rows.push(row);
  }
  if (rows.length < 2) {
    return opts.includeHeaders ? { headers: rows[0] || [], rows: [] } : [];
  }
  const headers = rows[0].map((h) => h.replace(/^\uFEFF/, '').trim());
  const objects = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] !== undefined ? r[idx] : '';
    });
    return obj;
  });

  if (opts.includeHeaders) {
    return { headers, rows: objects };
  }
  return objects;
}

module.exports = {
  csvEscape,
  xmlEscape,
  parseCsv
};
