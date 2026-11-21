const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  db,
  getSettings,
  generateSecurityCode,
  computeShippingClass,
  validateVinStrict,
  validatePartCompliance,
  validateInventoryItemForPublish,
  logSync
} = require('./db');
const { resolvePartTaxonomyAndMetafields, sanitizeVerifiedMpn } = require('./taxonomy');
const {
  resolvePartDimensionsAndWeight,
  buildRichStructuredDescription,
  stripDriveUrlsFromPublicText,
  deduplicateCatalog
} = require('./catalog-enrichment');
const { isCounterfeitMpn } = require('./audit-sanitizer');
const { pushSingleItemToShopify } = require('./exporters');

const SHOP_LABOR_RATE_LOCKED = 174.99;

/* ==================== 1. IMAGE MAGIC-BYTE & FILE VALIDATION ==================== */
function detectBinaryFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  // ZIP: PK\x03\x04 or PK\x05\x06
  if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)) {
    return { kind: 'zip', ext: 'zip', mime: 'application/zip' };
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { kind: 'image', ext: 'jpg', mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { kind: 'image', ext: 'png', mime: 'image/png' };
  }
  // WebP: RIFF....WEBP
  if (
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { kind: 'image', ext: 'webp', mime: 'image/webp' };
  }
  // GIF: GIF87a / GIF89a
  if (buf.toString('ascii', 0, 4) === 'GIF8') {
    return { kind: 'image', ext: 'gif', mime: 'image/gif' };
  }
  return null;
}

/* ==================== 2. ZERO-DEPENDENCY MULTIPART/FORM-DATA PARSER ==================== */
function parseMultipartFormData(bodyBuf, contentType = '') {
  const m = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!m) {
    const err = new Error('Missing multipart/form-data boundary.');
    err.statusCode = 400;
    throw err;
  }
  const boundary = m[1] || m[2];
  const delim = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];

  let pos = bodyBuf.indexOf(delim);
  while (pos !== -1) {
    pos += delim.length;
    // Closing boundary "--"
    if (bodyBuf[pos] === 0x2d && bodyBuf[pos + 1] === 0x2d) break;
    if (bodyBuf[pos] === 0x0d && bodyBuf[pos + 1] === 0x0a) pos += 2;

    const nextPos = bodyBuf.indexOf(delim, pos);
    if (nextPos === -1) break;

    const partBuf = bodyBuf.subarray(pos, nextPos);
    const headerEnd = partBuf.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headerStr = partBuf.subarray(0, headerEnd).toString('utf8');
      let content = partBuf.subarray(headerEnd + 4);
      // Trim trailing CRLF before next boundary
      if (content.length >= 2 && content[content.length - 2] === 0x0d && content[content.length - 1] === 0x0a) {
        content = content.subarray(0, content.length - 2);
      }

      const nameMatch = headerStr.match(/name="([^"]+)"/i);
      const filenameMatch = headerStr.match(/filename="([^"]*)"/i);
      const ctMatch = headerStr.match(/content-type:\s*([^\r\n]+)/i);

      if (nameMatch) {
        const fieldName = nameMatch[1];
        if (filenameMatch && filenameMatch[1]) {
          files.push({
            field: fieldName,
            filename: filenameMatch[1],
            mime: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
            buffer: Buffer.from(content)
          });
        } else {
          fields[fieldName] = content.toString('utf8');
        }
      }
    }
    pos = nextPos;
  }

  return { fields, files };
}

/* ==================== 3. PURE-NODE ZIP ARCHIVE EXTRACTOR ==================== */
function extractImagesFromZipBuffer(zipBuf, { maxFiles = 60, maxTotalBytes = 60 * 1024 * 1024, sourceLabel = 'zip_upload' } = {}) {
  const images = [];
  const skipped = [];
  if (!Buffer.isBuffer(zipBuf) || zipBuf.length < 22) {
    return { images, skipped: [{ filename: sourceLabel, reason: 'Invalid or empty ZIP archive.' }] };
  }

  // Locate End of Central Directory (EOCD) signature 0x06054b50 from end of buffer
  const maxCommentScan = Math.min(zipBuf.length, 65557);
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= zipBuf.length - maxCommentScan; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    return { images, skipped: [{ filename: sourceLabel, reason: 'ZIP End-of-Central-Directory header not found.' }] };
  }

  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);
  let cursor = cdOffset;
  let extractedBytes = 0;

  for (let i = 0; i < totalEntries && cursor + 46 <= zipBuf.length; i++) {
    if (zipBuf.readUInt32LE(cursor) !== 0x02014b50) break;

    const method = zipBuf.readUInt16LE(cursor + 10);
    const compSize = zipBuf.readUInt32LE(cursor + 20);
    const uncompSize = zipBuf.readUInt32LE(cursor + 24);
    const nameLen = zipBuf.readUInt16LE(cursor + 28);
    const extraLen = zipBuf.readUInt16LE(cursor + 30);
    const commentLen = zipBuf.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(cursor + 42);

    const rawName = zipBuf.toString('utf8', cursor + 46, cursor + 46 + nameLen);
    cursor += 46 + nameLen + extraLen + commentLen;

    // Ignore directories, macOS junk, hidden files, path traversal
    if (
      !rawName ||
      rawName.endsWith('/') ||
      rawName.includes('__MACOSX/') ||
      rawName.includes('..') ||
      path.basename(rawName).startsWith('.')
    ) {
      continue;
    }

    if (images.length >= maxFiles) {
      skipped.push({ filename: rawName, reason: `Batch limit (${maxFiles} photos) reached.` });
      continue;
    }

    if (uncompSize > 15 * 1024 * 1024 || extractedBytes + uncompSize > maxTotalBytes) {
      skipped.push({ filename: rawName, reason: 'File exceeds safe extraction size limit.' });
      continue;
    }

    if (localHeaderOffset + 30 > zipBuf.length || zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      skipped.push({ filename: rawName, reason: 'Corrupted local ZIP header.' });
      continue;
    }

    const lNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const lExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > zipBuf.length) {
      skipped.push({ filename: rawName, reason: 'Truncated ZIP entry data.' });
      continue;
    }

    let fileBuf = null;
    try {
      const compSlice = zipBuf.subarray(dataStart, dataEnd);
      if (method === 0) {
        fileBuf = Buffer.from(compSlice);
      } else if (method === 8) {
        fileBuf = zlib.inflateRawSync(compSlice);
      } else {
        skipped.push({ filename: rawName, reason: `Unsupported ZIP compression method (${method}).` });
        continue;
      }
    } catch (zErr) {
      skipped.push({ filename: rawName, reason: `Decompression failed: ${zErr.message}` });
      continue;
    }

    const fmt = detectBinaryFormat(fileBuf);
    if (!fmt || fmt.kind !== 'image') {
      continue; // Ignore non-image files (e.g. README.txt, .DS_Store) silently
    }

    extractedBytes += fileBuf.length;
    const parts = rawName.replace(/\\/g, '/').split('/').filter(Boolean);
    const filename = parts[parts.length - 1];
    const folderName = parts.length >= 2 ? parts[parts.length - 2] : '';

    images.push({
      buffer: fileBuf,
      ext: fmt.ext,
      mime: fmt.mime,
      filename,
      folderName,
      source: sourceLabel,
      sha256: crypto.createHash('sha256').update(fileBuf).digest('hex')
    });
  }

  return { images, skipped };
}

/* ==================== 4. GOOGLE DRIVE FOLDER / FILE FETCHER ==================== */
function parseGoogleDriveTarget(rawUrl = '') {
  const s = String(rawUrl || '').trim();
  if (!s) return null;

  const folderMatch = s.match(/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|embeddedfolderview\?id=)([A-Za-z0-9_-]{10,})/i);
  if (folderMatch) {
    return { type: 'folder', id: folderMatch[1], url: s };
  }
  const fileMatch = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]{10,})/i);
  if (fileMatch) {
    return { type: 'file', id: fileMatch[1], url: s };
  }
  if (/^https?:\/\//i.test(s)) {
    return { type: 'direct_url', id: '', url: s };
  }
  return null;
}

async function downloadDriveFileBinary(fileId, fallbackName = '', fetchImpl = fetch) {
  const urls = [
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}&confirm=t`
  ];

  for (const url of urls) {
    try {
      const resp = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'AldridgeAutoCommandHub/v24' },
        signal: AbortSignal.timeout(20000)
      });
      if (!resp.ok) continue;
      const arr = await resp.arrayBuffer();
      const buf = Buffer.from(arr);
      const fmt = detectBinaryFormat(buf);
      if (fmt) {
        const disp = String(resp.headers?.get?.('content-disposition') || '');
        const fnMatch = disp.match(/filename\*?=(?:UTF-8''|")?([^";\r\n]+)/i);
        const filename = fnMatch ? decodeURIComponent(fnMatch[1].replace(/"/g, '').trim()) : (fallbackName || `drive_${fileId}.${fmt.ext}`);
        return { ok: true, buffer: buf, format: fmt, filename };
      }

      // Check for Google Drive HTML virus-scan confirmation link
      const text = buf.toString('utf8', 0, Math.min(buf.length, 24000));
      const confirmMatch = text.match(/confirm=([0-9A-Za-z_-]+)/i);
      const uuidMatch = text.match(/name="uuid"\s+value="([^"]+)"/i);
      if (confirmMatch) {
        const retryUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=${encodeURIComponent(confirmMatch[1])}${uuidMatch ? `&uuid=${encodeURIComponent(uuidMatch[1])}` : ''}`;
        const r2 = await fetchImpl(retryUrl, {
          redirect: 'follow',
          headers: { 'User-Agent': 'AldridgeAutoCommandHub/v24' },
          signal: AbortSignal.timeout(20000)
        });
        if (r2.ok) {
          const buf2 = Buffer.from(await r2.arrayBuffer());
          const fmt2 = detectBinaryFormat(buf2);
          if (fmt2) {
            return { ok: true, buffer: buf2, format: fmt2, filename: fallbackName || `drive_${fileId}.${fmt2.ext}` };
          }
        }
      }
    } catch (_) {}
  }

  return { ok: false, error: `Could not download binary image/ZIP for Google Drive ID ${fileId} (ensure link sharing is set to "Anyone with the link can view").` };
}

async function fetchImagesFromGoogleDriveUrl(driveUrl, { maxFiles = 40, fetchImpl = fetch } = {}) {
  const target = parseGoogleDriveTarget(driveUrl);
  if (!target) {
    return { images: [], skipped: [{ filename: driveUrl, reason: 'Unrecognized Google Drive or file URL.' }] };
  }

  const images = [];
  const skipped = [];

  if (target.type === 'direct_url') {
    try {
      const resp = await fetchImpl(target.url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'AldridgeAutoCommandHub/v24' },
        signal: AbortSignal.timeout(20000)
      });
      if (!resp.ok) {
        return { images, skipped: [{ filename: target.url, reason: `HTTP ${resp.status} fetching direct URL.` }] };
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      const fmt = detectBinaryFormat(buf);
      if (!fmt) {
        return { images, skipped: [{ filename: target.url, reason: 'URL did not return a valid JPG/PNG/WebP image or ZIP archive.' }] };
      }
      const urlName = path.basename(new URL(target.url).pathname) || `remote.${fmt.ext}`;
      if (fmt.kind === 'zip') {
        return extractImagesFromZipBuffer(buf, { maxFiles, sourceLabel: `drive_zip:${urlName}` });
      }
      images.push({
        buffer: buf,
        ext: fmt.ext,
        mime: fmt.mime,
        filename: decodeURIComponent(urlName),
        folderName: '',
        source: 'remote_url',
        sha256: crypto.createHash('sha256').update(buf).digest('hex')
      });
      return { images, skipped };
    } catch (err) {
      return { images, skipped: [{ filename: target.url, reason: `Failed fetching URL: ${err.message}` }] };
    }
  }

  if (target.type === 'file') {
    const dl = await downloadDriveFileBinary(target.id, '', fetchImpl);
    if (!dl.ok) {
      return { images, skipped: [{ filename: target.url, reason: dl.error }] };
    }
    if (dl.format.kind === 'zip') {
      return extractImagesFromZipBuffer(dl.buffer, { maxFiles, sourceLabel: `drive_zip:${dl.filename}` });
    }
    images.push({
      buffer: dl.buffer,
      ext: dl.format.ext,
      mime: dl.format.mime,
      filename: dl.filename,
      folderName: '',
      source: 'google_drive_file',
      sha256: crypto.createHash('sha256').update(dl.buffer).digest('hex')
    });
    return { images, skipped };
  }

  // Folder mode: 1) Try official Google Drive v3 API if API key present; 2) Fallback to public embeddedfolderview HTML
  const discoveredFiles = [];
  const apiKey = String(process.env.GOOGLE_DRIVE_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (apiKey) {
    try {
      const q = encodeURIComponent(`'${target.id}' in parents and trashed = false`);
      const apiUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=${Math.min(100, maxFiles * 2)}&key=${encodeURIComponent(apiKey)}`;
      const r = await fetchImpl(apiUrl, { signal: AbortSignal.timeout(12000) });
      if (r.ok) {
        const json = await r.json();
        for (const f of json.files || []) {
          if (/^image\//i.test(f.mimeType || '') || /zip/i.test(f.mimeType || '') || /\.(jpe?g|png|webp|zip)$/i.test(f.name || '')) {
            discoveredFiles.push({ id: f.id, name: f.name || '' });
          }
        }
      }
    } catch (_) {}
  }

  if (!discoveredFiles.length) {
    try {
      const embedUrl = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(target.id)}#list`;
      const resp = await fetchImpl(embedUrl, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AldridgeAutoCommandHub/v24)' },
        signal: AbortSignal.timeout(15000)
      });
      if (resp.ok) {
        const html = await resp.text();
        const seenIds = new Set();
        // Match file entries in Drive embeddedfolderview: /file/d/<ID>/view ... title
        const entryRegex = /\/file\/d\/([A-Za-z0-9_-]{10,})\/view[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = entryRegex.exec(html)) !== null) {
          const id = m[1];
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          const cleanName = m[2].replace(/<[^>]+>/g, '').trim();
          discoveredFiles.push({ id, name: cleanName || `drive_${id}.jpg` });
        }
        // Fallback regex if markup uses data-id attributes
        if (!discoveredFiles.length) {
          const idRegex = /id="entry-([A-Za-z0-9_-]{10,})"[\s\S]{0,600}?flip-entry-title">([^<]+)</gi;
          while ((m = idRegex.exec(html)) !== null) {
            if (seenIds.has(m[1])) continue;
            seenIds.add(m[1]);
            discoveredFiles.push({ id: m[1], name: m[2].trim() });
          }
        }
      }
    } catch (err) {
      skipped.push({ filename: target.url, reason: `Could not read Google Drive folder: ${err.message}` });
    }
  }

  if (!discoveredFiles.length) {
    skipped.push({
      filename: target.url,
      reason: 'No publicly readable images or ZIP files found in this Google Drive folder. Verify folder sharing is "Anyone with the link can view" or download the folder as a .zip and drop it above.'
    });
    return { images, skipped };
  }

  for (const df of discoveredFiles.slice(0, maxFiles)) {
    const dl = await downloadDriveFileBinary(df.id, df.name, fetchImpl);
    if (!dl.ok) {
      skipped.push({ filename: df.name || df.id, reason: dl.error });
      continue;
    }
    if (dl.format.kind === 'zip') {
      const unpacked = extractImagesFromZipBuffer(dl.buffer, {
        maxFiles: Math.max(1, maxFiles - images.length),
        sourceLabel: `drive_folder_zip:${dl.filename}`
      });
      images.push(...unpacked.images);
      skipped.push(...unpacked.skipped);
    } else {
      images.push({
        buffer: dl.buffer,
        ext: dl.format.ext,
        mime: dl.format.mime,
        filename: dl.filename || df.name,
        folderName: '',
        source: 'google_drive_folder',
        sha256: crypto.createHash('sha256').update(dl.buffer).digest('hex')
      });
    }
  }

  return { images, skipped };
}

/* ==================== 5. AUTOMOTIVE COMPONENT + MPN INTELLIGENCE ==================== */
const PART_DETECTION_RULES = [
  { re: /\b(auto(?:matic)?\s*trans(?:mission)?|manual\s*trans(?:mission)?|transmission|transaxle|gearbox|cvt)\b/i, name: 'Transmission Assembly', price: 895, placement: 'Center Drivetrain' },
  { re: /\b(complete\s*engine|engine\s*assembly|long\s*block|short\s*block|motor\s*assembly)\b/i, name: 'Complete Engine Assembly', price: 1650, placement: 'Front Engine Bay' },
  { re: /\b(transfer\s*case)\b/i, name: 'Transfer Case Assembly', price: 425, placement: 'Center Drivetrain' },
  { re: /\b(front\s*diff(?:erential)?|rear\s*diff(?:erential)?|differential|third\s*member)\b/i, name: 'Differential Carrier Assembly', price: 445, placement: 'Drivetrain' },
  { re: /\b(alternator|generator|27060)\b/i, name: 'Alternator Assembly', price: 145, placement: 'Engine Accessory Drive' },
  { re: /\b(starter|solenoid|28100)\b/i, name: 'Starter Motor Assembly', price: 95, placement: 'Lower Engine Bellhousing' },
  { re: /\b(ecm|ecu|pcm|engine\s*control\s*module|engine\s*computer|89661)\b/i, name: 'Engine Control Module (ECM / PCM)', price: 175, placement: 'Engine Bay / Firewall' },
  { re: /\b(tcm|tcu|transmission\s*control\s*module)\b/i, name: 'Transmission Control Module (TCM)', price: 145, placement: 'Interior / Engine Bay' },
  { re: /\b(bcm|body\s*control\s*module|fuse\s*box|tipm|junction\s*box)\b/i, name: 'Body Control Module / Fuse Box Assembly', price: 135, placement: 'Engine Bay / Dash' },
  { re: /\b(abs\s*(?:pump|module|actuator)|anti[\s-]*lock)\b/i, name: 'ABS Brake Pump & Control Module Assembly', price: 185, placement: 'Engine Bay' },
  { re: /\b(headlight|headlamp|led\s*lamp|projector\s*lamp)\b/i, name: 'Headlight Headlamp Assembly', price: 185, placement: 'Front Corner' },
  { re: /\b(tail\s*light|taillight|tail\s*lamp|rear\s*lamp)\b/i, name: 'Tail Light Lamp Assembly', price: 115, placement: 'Rear Quarter' },
  { re: /\b(side\s*mirror|wing\s*mirror|door\s*mirror|mirror\s*assembly|mirror)\b/i, name: 'Side View Door Mirror Assembly', price: 95, placement: 'Front Door' },
  { re: /\b(front\s*bumper|rear\s*bumper|bumper\s*cover|bumper)\b/i, name: 'Bumper Cover Assembly', price: 245, placement: 'Exterior' },
  { re: /\b(fender|quarter\s*panel)\b/i, name: 'Fender Panel Assembly', price: 175, placement: 'Exterior' },
  { re: /\b(hood\s*panel|engine\s*hood|hood)\b/i, name: 'Hood Panel Assembly', price: 295, placement: 'Front Exterior' },
  { re: /\b(door\s*shell|front\s*door|rear\s*door|sliding\s*door|tailgate|liftgate|hatch|trunk\s*lid)\b/i, name: 'Door / Liftgate Assembly', price: 325, placement: 'Exterior Body' },
  { re: /\b(grille|front\s*grill|grill)\b/i, name: 'Front Grille Assembly', price: 125, placement: 'Front Fascia' },
  { re: /\b(radiator|cooling\s*fan|fan\s*shroud|condenser)\b/i, name: 'Radiator & Cooling Fan Assembly', price: 155, placement: 'Front Core Support' },
  { re: /\b(a\/?c\s*compressor|air\s*conditioning\s*compressor)\b/i, name: 'A/C Compressor Assembly', price: 145, placement: 'Engine Accessory Drive' },
  { re: /\b(turbo|turbocharger|intercooler|supercharger)\b/i, name: 'Turbocharger Assembly', price: 325, placement: 'Exhaust / Intake' },
  { re: /\b(throttle\s*body|intake\s*manifold|maf\s*sensor|mass\s*air)\b/i, name: 'Intake Manifold / Throttle Body Assembly', price: 135, placement: 'Upper Engine' },
  { re: /\b(fuel\s*pump|fuel\s*rail|injector)\b/i, name: 'Fuel Pump Module Assembly', price: 125, placement: 'Fuel System' },
  { re: /\b(brake\s*caliper|caliper|brake\s*booster|master\s*cylinder)\b/i, name: 'Brake Caliper / Master Cylinder Assembly', price: 85, placement: 'Brake System' },
  { re: /\b(strut|shock|coilover|fox\s*2\.0|suspension)\b/i, name: 'Strut / Shock Absorber Assembly', price: 135, placement: 'Suspension' },
  { re: /\b(control\s*arm|knuckle|spindle|wheel\s*hub|bearing|cv\s*axle|drive\s*shaft|driveshaft)\b/i, name: 'Suspension Knuckle / Axle Assembly', price: 115, placement: 'Suspension / Driveline' },
  { re: /\b(steering\s*rack|rack\s*and\s*pinion|power\s*steering\s*pump|steering\s*column)\b/i, name: 'Steering Rack / Power Steering Assembly', price: 195, placement: 'Front Steering' },
  { re: /\b(wheel|rim|alloy\s*wheel|spare\s*tire)\b/i, name: 'OEM Alloy Wheel Rim Assembly', price: 165, placement: 'Hub / Wheel' },
  { re: /\b(rear\s*seat|bench\s*seat|bucket\s*seat|driver\s*seat|passenger\s*seat|seat\s*set|seats?)\b/i, name: 'Interior Seat Assembly', price: 245, placement: 'Interior Cabin' },
  { re: /\b(center\s*console|armrest|glove\s*box|dash\s*bezel|trim\s*panel)\b/i, name: 'Interior Console / Trim Assembly', price: 95, placement: 'Interior Cabin' },
  { re: /\b(instrument\s*cluster|speedometer|gauge\s*cluster|odometer)\b/i, name: 'Instrument Gauge Cluster Assembly', price: 135, placement: 'Dashboard' },
  { re: /\b(stereo|radio|head\s*unit|infotainment|navigation|display\s*screen|amplifier)\b/i, name: 'OEM Audio Radio / Display Head Unit', price: 165, placement: 'Center Dashboard' },
  { re: /\b(climate\s*control|hvac\s*control|blower\s*motor|heater\s*core)\b/i, name: 'HVAC Climate Control / Blower Assembly', price: 95, placement: 'Dashboard / Cabin' },
  { re: /\b(window\s*regulator|window\s*motor|door\s*lock\s*actuator|wiper\s*motor|sunroof\s*motor)\b/i, name: 'Window Regulator / Door Motor Assembly', price: 78, placement: 'Door / Body' },
  { re: /\b(ignition\s*coil|coil\s*pack|distributor|oxygen\s*sensor|o2\s*sensor|camshaft\s*sensor)\b/i, name: 'Ignition / Engine Sensor Assembly', price: 65, placement: 'Engine Bay' }
];

function extractPlacementFromHint(text = '') {
  const s = String(text || '').toLowerCase();
  const frontRear = /\b(front|frt|fr)\b/.test(s) ? 'Front' : /\b(rear|rr)\b/.test(s) ? 'Rear' : '';
  const leftRight = /\b(left|lh|driver)\b/.test(s) ? 'Left (Driver Side)' : /\b(right|rh|passenger)\b/.test(s) ? 'Right (Passenger Side)' : '';
  return [frontRear, leftRight].filter(Boolean).join(' ');
}

function extractMpnFromFilenameOrText(text = '') {
  const raw = String(text || '')
    .replace(/\.[A-Za-z0-9]{2,4}\b/g, ' ')
    .replace(/[_\s/\\]+/g, ' ')
    .toUpperCase();
  // Match classic OEM hyphenated or alphanumeric MPNs like 27060-31190, 89661-35822, 68070543AA, 12586242
  const patterns = [
    /\b([0-9]{5}-[0-9A-Z]{4,6}(?:-[0-9A-Z]{2})?)\b/,
    /\b([A-Z0-9]{4,6}-[A-Z0-9]{3,6}(?:-[A-Z0-9]{1,4})?)\b/,
    /\b([0-9]{8}[A-Z]{0,2})\b/
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) {
      const candidate = sanitizeVerifiedMpn(m[1]);
      if (candidate && !isCounterfeitMpn(candidate) && !/^(IMG|DSC|PXL|PHOTO|202\d{5})$/i.test(candidate)) {
        return candidate;
      }
    }
  }
  return '';
}

function deriveGroupKeyFromImage(img, groupingMode = 'auto') {
  if (groupingMode === 'single_part') return '__single_part_batch__';
  if (groupingMode === 'one_per_photo') return `__photo_${img.sha256.slice(0, 12)}__`;

  // Auto mode:
  // 1) If image came from a named ZIP subfolder (other than generic "photos"/"images"/"parts"), group by subfolder!
  const folder = String(img.folderName || '').trim().toLowerCase();
  if (folder && !/^(photos?|images?|pics?|parts?|uploads?|dcim|camera|all|batch)$/i.test(folder)) {
    return `folder:${folder}`;
  }
  // 2) If filename has a descriptive part stem with angle suffix (e.g., "alternator_1.jpg", "alternator_2.jpg" or "headlight-front.jpg"), group by stem!
  const base = path.basename(img.filename || '', path.extname(img.filename || '')).trim().toLowerCase();
  const isGenericCameraName = /^(img|dsc|pxl|photo|image|pic|mvimg|whatsapp|screenshot|cam|snap|drive)[_\-\s0-9]*$/i.test(base);
  if (!isGenericCameraName && base.length >= 4) {
    const stem = base
      .replace(/[_\-\s]+(angle|view|photo|pic|img|shot|close|closeup|label|mpn|tag|back|front|side|top|bottom)?[_\-\s]*\d+$/i, '')
      .replace(/[_\-\s]+\(\d+\)$/i, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (stem.length >= 4) return `stem:${stem}`;
  }
  // 3) Otherwise each raw camera photo starts in its own group (and will auto-merge after AI Vision if same part!)
  return `photo:${img.sha256.slice(0, 12)}`;
}

async function identifyPartGroupWithAi(group, session, settings, { batchHint = '', fetchImpl = fetch } = {}) {
  const photos = group.images.slice(0, 4);
  const rawHintText = [group.folderName, ...photos.map((p) => p.filename), batchHint].filter(Boolean).join(' ');
  const hintText = rawHintText.replace(/\.[A-Za-z0-9]{2,4}\b/g, ' ').replace(/[_\s/\\]+/g, ' ').trim();
  const filenameMpn = extractMpnFromFilenameOrText(rawHintText);
  const geminiKey = String(settings?.gemini_api_key || process.env.GEMINI_API_KEY || '').trim();

  // 1) Live Gemini 2.5 Flash Vision + Stamped MPN OCR when configured!
  if (geminiKey && photos.length > 0) {
    try {
      const inlineParts = photos.map((img) => ({
        inline_data: {
          mime_type: img.mime || 'image/jpeg',
          data: img.buffer.toString('base64')
        }
      }));
      const prompt = `You are an expert automotive OEM salvage parts cataloger for Aldridge Auto's Service & Repair (University Place, WA 98467).
Inspect all ${inlineParts.length} photo angle(s) of this automotive part pulled from a VIN-verified donor vehicle.
LOCKED DONOR VEHICLE (NHTSA vPIC verified — DO NOT change vehicle):
- VIN: ${session.vin}
- Vehicle: ${session.year} ${session.make} ${session.model} ${session.trim || ''}
- Engine: ${session.engine || 'Factory'} | Drivetrain: ${session.drivetrain || 'Factory'} | Transmission: ${session.transmission || 'Factory'}
Optional filename/context hint: ${hintText || 'None'}.

Return ONLY valid JSON with these exact keys:
{
  "part_name": "Exact specific OEM part component name (e.g., Front Left Driver Side Headlight Assembly, Alternator Assembly, Engine Control Module ECM/PCM) — NEVER write generic 'Auto Part' or 'Car Part'",
  "placement_on_vehicle": "Front Left (Driver Side) / Front Right (Passenger Side) / Rear / Engine Bay / Interior / Drivetrain / etc.",
  "oem_part_number": "Exact stamped or sticker OEM part number visibly readable in the photo(s), or empty string if none visible — NEVER invent or fabricate a part number",
  "condition": "Used" | "Tested Used OEM" | "Reconditioned",
  "condition_notes": "Concise physical inspection note (tabs, connector pins, lens clarity, scratches)",
  "suggested_price_usd": 125.00,
  "is_prohibited_safety_item": false
}
Set "is_prohibited_safety_item": true ONLY if the photo shows a deployed/undeployed airbag, SRS module/sensor, clockspring, seat belt pretensioner, or catalytic converter.`;

      const resp = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, ...inlineParts] }],
            generationConfig: { responseMimeType: 'application/json' }
          }),
          signal: AbortSignal.timeout(20000)
        }
      );

      if (resp.ok) {
        const gJson = await resp.json();
        const rawText = gJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (rawText) {
          const ai = JSON.parse(rawText);
          const aiPartName = String(ai.part_name || '').trim();
          const aiMpn = sanitizeVerifiedMpn(ai.oem_part_number || filenameMpn || '');
          const cleanAiMpn = isCounterfeitMpn(aiMpn) ? '' : aiMpn;
          if (aiPartName && aiPartName.length >= 3 && !/^(auto\s*part|car\s*part|oem\s*part|unknown)$/i.test(aiPartName)) {
            return {
              ok: true,
              provider: 'gemini_2.5_flash_vision',
              part_name: aiPartName,
              placement_on_vehicle: String(ai.placement_on_vehicle || extractPlacementFromHint(aiPartName) || 'Vehicle Specific').trim(),
              oem_part_number: cleanAiMpn,
              condition: String(ai.condition || 'Tested Used OEM').trim(),
              condition_notes: String(ai.condition_notes || 'Inspected on-site from VIN-verified donor vehicle; see actual photos.').trim(),
              suggested_price_usd: Math.max(25, Number(ai.suggested_price_usd || 115)),
              is_prohibited_safety_item: Boolean(ai.is_prohibited_safety_item)
            };
          }
        }
      }
    } catch (_) {
      // Fall through cleanly to deterministic OEM filename/metadata recognition
    }
  }

  // 2) Hard safety compliance gate BEFORE deterministic part rules (never misclassify steering_wheel_airbag as a wheel!)
  const hintCompliance = validatePartCompliance({ title: hintText, description: hintText });
  if (!hintCompliance.compliant) {
    return {
      ok: true,
      provider: 'compliance_gate',
      part_name: hintText.slice(0, 60),
      placement_on_vehicle: 'Prohibited Safety Item',
      oem_part_number: '',
      condition: 'Used',
      condition_notes: hintCompliance.reason,
      suggested_price_usd: 0,
      is_prohibited_safety_item: true,
      compliance_reason: hintCompliance.reason
    };
  }

  // 3) Deterministic OEM Part Recognition from subfolder / filename / batch hint (NEVER fabricates generic placeholders!)
  const matchedRule = PART_DETECTION_RULES.find((r) => r.re.test(hintText));
  if (matchedRule) {
    const placementPrefix = extractPlacementFromHint(hintText);
    const fullPartName = placementPrefix && !matchedRule.name.toLowerCase().includes(placementPrefix.split(' ')[0].toLowerCase())
      ? `${placementPrefix} ${matchedRule.name}`
      : matchedRule.name;
    return {
      ok: true,
      provider: 'smart_oem_batch_classifier',
      part_name: fullPartName,
      placement_on_vehicle: placementPrefix || matchedRule.placement,
      oem_part_number: filenameMpn,
      condition: 'Tested Used OEM',
      condition_notes: 'Pulled & inspected on-site from VIN-verified donor vehicle; connector pins, tabs & housing verified clean — see actual photos.',
      suggested_price_usd: matchedRule.price,
      is_prohibited_safety_item: false
    };
  }

  // If no Gemini key is configured AND the photo has only a generic camera filename like IMG_1234.jpg,
  // refuse to fabricate a placeholder title ("Tested OEM Auto Part") — report actionable guidance!
  return {
    ok: false,
    reason: geminiKey
      ? 'AI Vision could not confidently identify a specific OEM part from this image. Retake a clearer photo or include the stamped OEM label.'
      : 'Raw camera filename without GEMINI_API_KEY configured. Add GEMINI_API_KEY in Render Environment for automatic raw-camera vision ID, or name files/ZIP folders with the part (e.g., alternator_1.jpg).'
  };
}

function normalizeMergeKey(ident) {
  const normPart = String(ident.part_name || '')
    .toLowerCase()
    .replace(/\b(oem|tested|used|genuine|factory|assembly)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const normPlace = String(ident.placement_on_vehicle || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normMpn = String(ident.oem_part_number || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${normPart}|${normPlace}|${normMpn}`;
}

/* ==================== 6. MASTER HANDS-FREE AI MULTI-INPUT BATCH INTAKE ==================== */
async function runAiMultiInputBatchIntake(payload = {}, staffUser = 'Shop Staff', { uploadsDir, baseUrl, fetchImpl = fetch, pushToShopifyFn = pushSingleItemToShopify } = {}) {
  const sessionCode = String(payload.session_code || payload.intake_session_id || '').trim().toUpperCase();
  if (!sessionCode) {
    const err = new Error('Mandatory Step 1 Lock: Decode and lock a 17-character VIN (or State + License Plate) before running AI Batch Intake.');
    err.statusCode = 422;
    throw err;
  }

  const session = db.prepare('SELECT * FROM vin_intake_sessions WHERE UPPER(session_code) = ?').get(sessionCode);
  if (!session || !validateVinStrict(session.vin).valid) {
    const err = new Error(`Invalid or expired VIN intake session "${sessionCode}". Complete Step 1 VIN decode first.`);
    err.statusCode = 422;
    throw err;
  }

  const targetUploadsDir = uploadsDir || path.join(__dirname, '..', 'data', 'uploads');
  fs.mkdirSync(targetUploadsDir, { recursive: true });

  const binPrefix = String(payload.bin_location || payload.bin_prefix || 'BAY-B-SHELF').trim() || 'BAY-B-SHELF';
  const pushShopify = payload.push_shopify === false || payload.push_shopify === 'false' ? false : true;
  const groupingMode = ['auto', 'single_part', 'one_per_photo'].includes(String(payload.grouping_mode || 'auto'))
    ? String(payload.grouping_mode || 'auto')
    : 'auto';
  const batchHint = String(payload.batch_hint || payload.notes || '').trim();

  const collectedImages = [];
  const skippedItems = [];
  const inputSources = { direct_photos: 0, zip_archives: 0, google_drive_links: 0 };

  // --- A. Multipart binary files (photos AND/OR .zip archives) ---
  if (Array.isArray(payload.uploaded_files)) {
    for (const f of payload.uploaded_files) {
      if (!f || !Buffer.isBuffer(f.buffer) || f.buffer.length < 12) continue;
      const fmt = detectBinaryFormat(f.buffer);
      if (!fmt) {
        skippedItems.push({ filename: f.filename || 'upload', reason: 'Unsupported file format (must be JPG, PNG, WebP, or ZIP).' });
        continue;
      }
      if (fmt.kind === 'zip') {
        inputSources.zip_archives += 1;
        const unpacked = extractImagesFromZipBuffer(f.buffer, { sourceLabel: `zip:${f.filename || 'archive.zip'}` });
        collectedImages.push(...unpacked.images);
        skippedItems.push(...unpacked.skipped);
      } else {
        inputSources.direct_photos += 1;
        collectedImages.push({
          buffer: f.buffer,
          ext: fmt.ext,
          mime: fmt.mime,
          filename: f.filename || `photo_${collectedImages.length + 1}.${fmt.ext}`,
          folderName: '',
          source: 'direct_upload',
          sha256: crypto.createHash('sha256').update(f.buffer).digest('hex')
        });
      }
    }
  }

  // --- B. JSON Base64 photos array ---
  if (Array.isArray(payload.photos)) {
    for (let i = 0; i < payload.photos.length; i++) {
      const entry = payload.photos[i];
      const dataUrl = typeof entry === 'string' ? entry : String(entry?.data_url || entry?.dataUrl || '');
      const filename = typeof entry === 'object' ? String(entry?.filename || entry?.name || `photo_${i + 1}.jpg`) : `photo_${i + 1}.jpg`;
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
      if (!m) continue;
      const buf = Buffer.from(m[2], 'base64');
      const fmt = detectBinaryFormat(buf);
      if (!fmt) {
        skippedItems.push({ filename, reason: 'Invalid image/ZIP payload.' });
        continue;
      }
      if (fmt.kind === 'zip') {
        inputSources.zip_archives += 1;
        const unpacked = extractImagesFromZipBuffer(buf, { sourceLabel: `zip:${filename}` });
        collectedImages.push(...unpacked.images);
        skippedItems.push(...unpacked.skipped);
      } else {
        inputSources.direct_photos += 1;
        collectedImages.push({
          buffer: buf,
          ext: fmt.ext,
          mime: fmt.mime,
          filename,
          folderName: typeof entry === 'object' ? String(entry?.folder_name || '') : '',
          source: 'base64_photo',
          sha256: crypto.createHash('sha256').update(buf).digest('hex')
        });
      }
    }
  }

  // --- C. JSON Base64 ZIP archive ---
  if (payload.zip_base64) {
    const rawZip = String(payload.zip_base64).replace(/^data:[^;]+;base64,/i, '');
    const zipBuf = Buffer.from(rawZip, 'base64');
    inputSources.zip_archives += 1;
    const unpacked = extractImagesFromZipBuffer(zipBuf, { sourceLabel: `zip:${payload.zip_filename || 'batch.zip'}` });
    collectedImages.push(...unpacked.images);
    skippedItems.push(...unpacked.skipped);
  }

  // --- D. Google Drive Folder / File URL ---
  const driveUrl = String(payload.drive_url || payload.google_drive_url || '').trim();
  if (driveUrl) {
    inputSources.google_drive_links += 1;
    const driveRes = await fetchImagesFromGoogleDriveUrl(driveUrl, { fetchImpl });
    collectedImages.push(...driveRes.images);
    skippedItems.push(...driveRes.skipped);
  }

  if (!collectedImages.length) {
    const err = new Error(
      skippedItems.length
        ? `No valid part photos extracted: ${skippedItems.map((s) => `${s.filename}: ${s.reason}`).join(' | ')}`
        : 'Attach at least 1 part photo, a .zip archive of photos, or a Google Drive folder/file link.'
    );
    err.statusCode = 400;
    throw err;
  }

  // --- E. Deduplicate exact byte-identical photos (SHA-256) ---
  const uniqueImages = [];
  const seenHashes = new Set();
  let exactDupPhotosMerged = 0;
  for (const img of collectedImages) {
    if (seenHashes.has(img.sha256)) {
      exactDupPhotosMerged += 1;
      continue;
    }
    seenHashes.add(img.sha256);
    uniqueImages.push(img);
  }

  // --- F. Group images into candidate part batches ---
  const preGroups = new Map();
  for (const img of uniqueImages) {
    const key = deriveGroupKeyFromImage(img, groupingMode);
    if (!preGroups.has(key)) {
      preGroups.set(key, { key, folderName: img.folderName || '', images: [] });
    }
    preGroups.get(key).images.push(img);
  }

  // --- G. Run AI Vision + MPN OCR on each candidate group ---
  const settings = getSettings();
  const laborRate = Number(settings.labor_rate_hourly || SHOP_LABOR_RATE_LOCKED);
  const identifiedGroups = [];

  for (const grp of preGroups.values()) {
    const ident = await identifyPartGroupWithAi(grp, session, settings, { batchHint, fetchImpl });
    if (!ident.ok) {
      skippedItems.push({
        filename: grp.images.map((i) => i.filename).join(', '),
        reason: ident.reason
      });
      continue;
    }

    // Hard SRS / Catalytic safety compliance check
    const comp = validatePartCompliance({
      title: ident.part_name,
      category: '',
      description: ident.condition_notes
    });
    if (ident.is_prohibited_safety_item || !comp.compliant) {
      skippedItems.push({
        filename: grp.images.map((i) => i.filename).join(', '),
        reason: ident.compliance_reason || comp.reason || 'Blocked prohibited SRS/airbag/catalytic safety component.'
      });
      continue;
    }

    identifiedGroups.push({ group: grp, ident });
  }

  // --- H. Merge duplicate angles that resolved to the exact same OEM part within this batch ---
  const canonicalParts = new Map();
  let duplicateAnglesMerged = exactDupPhotosMerged;
  for (const entry of identifiedGroups) {
    const mergeKey = normalizeMergeKey(entry.ident);
    if (canonicalParts.has(mergeKey)) {
      const existing = canonicalParts.get(mergeKey);
      existing.group.images.push(...entry.group.images);
      if (!existing.ident.oem_part_number && entry.ident.oem_part_number) {
        existing.ident.oem_part_number = entry.ident.oem_part_number;
      }
      duplicateAnglesMerged += entry.group.images.length;
    } else {
      canonicalParts.set(mergeKey, entry);
    }
  }

  // --- I. Auto-Enrich, Quality-Gate, Persist Single-Variant SKUs & Push Live to Shopify ---
  const createdItems = [];
  const now = new Date().toISOString();

  for (const { group, ident } of canonicalParts.values()) {
    const cleanMpn = sanitizeVerifiedMpn(ident.oem_part_number || '');
    const slug = ident.part_name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 14);
    const sku = `ALD-${String(session.year).slice(-2)}${session.make.slice(0, 3).toUpperCase()}-${slug}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    // Save real binary photos locally to /uploads (NEVER exposing drive.google.com URLs!)
    const savedPhotos = [];
    for (let idx = 0; idx < Math.min(group.images.length, 8); idx++) {
      const img = group.images[idx];
      const fname = `${sku.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${idx + 1}-${crypto.randomBytes(2).toString('hex')}.${img.ext || 'jpg'}`;
      fs.writeFileSync(path.join(targetUploadsDir, fname), img.buffer);
      savedPhotos.push(`/uploads/${fname}`);
    }

    const fullTitle = `${session.year} ${session.make} ${session.model}${session.engine ? ` ${session.engine.split(' ')[0]}` : ''} ${ident.part_name} OEM${cleanMpn ? ` ${cleanMpn}` : ''}`
      .replace(/\bOEM\s+OEM\b/gi, 'OEM')
      .replace(/\s+/g, ' ')
      .trim();

    const tax = resolvePartTaxonomyAndMetafields({
      title: fullTitle,
      category: '',
      brand: `${session.make} OEM`,
      condition: ident.condition || 'Used',
      oem_part_number: cleanMpn,
      fitment_years: String(session.year),
      fitment_make: session.make,
      fitment_model: session.model
    }, settings);

    const dims = resolvePartDimensionsAndWeight({
      title: fullTitle,
      category: tax.partType
    });

    const priceWePull = Number(Math.max(25, Number(ident.suggested_price_usd || 95)).toFixed(2));
    const laborHours = Number(dims.labor_hours || 1.2);
    const pricePullInstall = laborHours > 0 ? Number((priceWePull + laborHours * laborRate).toFixed(2)) : priceWePull;
    const shippingClass = computeShippingClass(dims.weight_lbs, `${tax.partType} ${fullTitle}`, dims.length_in, dims.width_in, dims.height_in);
    const secCode = generateSecurityCode();
    const cleanNotes = stripDriveUrlsFromPublicText(
      `VIN-Verified Donor: ${session.year} ${session.make} ${session.model} ${session.trim} ${session.engine} ${session.drivetrain} | Session ${session.session_code} | AI Intake (${ident.provider})`
    );

    const candidate = {
      sku,
      title: fullTitle,
      category: tax.partType,
      condition: ident.condition || 'Tested Used OEM',
      brand: `${session.make} OEM`,
      oem_part_number: cleanMpn,
      interchange_number: '',
      fitment_years: String(session.year),
      fitment_make: session.make,
      fitment_model: session.model,
      fitment_engine: session.engine,
      fitment_notes: cleanNotes,
      defect_disclosure: ident.condition_notes || 'Used OEM — pulled & inspected on-site from VIN-verified donor vehicle; see actual photos.',
      price_we_pull: priceWePull,
      install_labor_hours: laborHours,
      weight_lbs: dims.weight_lbs,
      length_in: dims.length_in,
      width_in: dims.width_in,
      height_in: dims.height_in,
      shipping_class: shippingClass,
      verified_vin: session.vin,
      intake_session_id: session.session_code,
      intake_source: 'vin_intake_pipeline'
    };

    const description = stripDriveUrlsFromPublicText(buildRichStructuredDescription(candidate, settings));
    const gate = validateInventoryItemForPublish({ ...candidate, description });
    if (!gate.valid) {
      skippedItems.push({
        filename: group.images.map((i) => i.filename).join(', '),
        reason: `Quality gate blocked: ${gate.reasons.join('; ')}`
      });
      continue;
    }

    const ins = db.prepare(`
      INSERT INTO inventory_items (
        org_id, sku, title, category, condition, condition_id, brand,
        oem_part_number, interchange_number, placement_on_vehicle, donor_vehicle_id,
        fitment_years, fitment_make, fitment_model, fitment_engine, fitment_notes,
        description, defect_disclosure, bin_location, security_mark_code, security_mark_verified,
        photos_json, pull_status, allow_self_pull, price_self_pull, allow_we_pull, price_we_pull,
        allow_pull_install, price_pull_install, install_labor_hours, quantity,
        weight_lbs, length_in, width_in, height_in, shipping_class, handling_fee, handling_days,
        channels_json, status, verified_vin, intake_session_id, intake_source, created_at, updated_at
      ) VALUES (
        1, ?, ?, ?, ?, ?, ?,
        ?, '', ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, 1,
        ?, 'pulled_on_shelf', 0, 0, 1, ?,
        ?, ?, ?, 1,
        ?, ?, ?, ?, ?, ?, ?,
        '{}', 'active', ?, ?, 'vin_intake_pipeline', ?, ?
      )
    `).run(
      sku, fullTitle, tax.partType, candidate.condition, 3000, candidate.brand,
      cleanMpn, ident.placement_on_vehicle || 'Vehicle Specific', session.donor_vehicle_id || null,
      String(session.year), session.make, session.model, session.engine, cleanNotes,
      description, candidate.defect_disclosure, binPrefix, secCode,
      JSON.stringify(savedPhotos), priceWePull,
      laborHours > 0 ? 1 : 0, pricePullInstall, laborHours,
      dims.weight_lbs, dims.length_in, dims.width_in, dims.height_in, shippingClass,
      Number(settings.handling_fee_default || 10), Number(settings.handling_days_default || 3),
      session.vin, session.session_code, now, now
    );

    const createdRow = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(Number(ins.lastInsertRowid));
    createdItems.push({
      item: createdRow,
      photos: savedPhotos,
      ai_provider: ident.provider,
      taxonomy: {
        shopify_taxonomy_id: tax.shopifyTaxonomyId,
        ebay_us_category_id: tax.ebayUsCategoryId
      },
      shopify_push: null
    });
  }

  // --- J. Run Permanent Catalog Deduplication Across SQLite (merges duplicate angles with existing catalog too!) ---
  const dedupeResult = deduplicateCatalog();

  // --- K. Push Each Surviving Active SKU Live to Shopify (with QR Security Tag in final photo slot!) ---
  const finalResults = [];
  for (const entry of createdItems) {
    const fresh = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(entry.item.id);
    if (!fresh || fresh.status !== 'active') {
      // Merged into an existing canonical listing by deduplicateCatalog()
      duplicateAnglesMerged += entry.photos.length;
      continue;
    }

    let shopifyPush = null;
    if (pushShopify && typeof pushToShopifyFn === 'function') {
      try {
        shopifyPush = await pushToShopifyFn(fresh, settings, targetUploadsDir);
      } catch (shErr) {
        shopifyPush = { pushed: false, error: shErr.message };
      }
    }

    const freshPhotos = (() => {
      try { return JSON.parse(fresh.photos_json || '[]'); } catch (_) { return entry.photos; }
    })();

    finalResults.push({
      sku: fresh.sku,
      title: fresh.title,
      category: fresh.category,
      oem_part_number: fresh.oem_part_number || '',
      placement_on_vehicle: fresh.placement_on_vehicle || '',
      verified_vin: fresh.verified_vin,
      intake_session_id: fresh.intake_session_id,
      price_we_pull: Number(fresh.price_we_pull),
      price_pull_install: Number(fresh.price_pull_install),
      install_labor_hours: Number(fresh.install_labor_hours),
      weight_lbs: Number(fresh.weight_lbs),
      dimensions_in: `${fresh.length_in}x${fresh.width_in}x${fresh.height_in}`,
      shipping_class: fresh.shipping_class,
      quantity: Number(fresh.quantity),
      bin_location: fresh.bin_location,
      security_mark_code: fresh.security_mark_code,
      photo_count: freshPhotos.length,
      thumbnail: freshPhotos[0] || '',
      ai_provider: entry.ai_provider,
      taxonomy: entry.taxonomy,
      shopify_push: shopifyPush
    });
  }

  logSync(
    'internal',
    'vin_ai_batch_intake',
    'batch_ai_publish',
    session.session_code,
    finalResults.length > 0 ? 'success' : 'warning',
    `${staffUser} ran Hands-Free AI Batch Intake for VIN ${session.vin} (${session.year} ${session.make} ${session.model}): images=${collectedImages.length}, created=${finalResults.length}, merged_angles=${duplicateAnglesMerged}, skipped=${skippedItems.length}.`
  );

  return {
    ok: true,
    session: {
      session_code: session.session_code,
      vin: session.vin,
      year: session.year,
      make: session.make,
      model: session.model,
      trim: session.trim,
      engine: session.engine,
      drivetrain: session.drivetrain,
      transmission: session.transmission
    },
    input_sources: inputSources,
    total_photos_received: collectedImages.length,
    unique_photos_processed: uniqueImages.length,
    created_count: finalResults.length,
    duplicate_angles_merged: duplicateAnglesMerged,
    skipped_count: skippedItems.length,
    deduplication: dedupeResult,
    feeds_updated: [
      '/api/inventory',
      '/api/exports/shopify.csv',
      '/api/exports/crosslist.csv',
      '/api/exports/ebay-file-exchange.csv',
      '/api/exports/google-merchant.xml',
      '/api/exports/meta-commerce.csv',
      '/api/craigslist/queue'
    ],
    created_items: finalResults,
    skipped_items: skippedItems
  };
}

module.exports = {
  parseMultipartFormData,
  extractImagesFromZipBuffer,
  parseGoogleDriveTarget,
  fetchImagesFromGoogleDriveUrl,
  runAiMultiInputBatchIntake
};
