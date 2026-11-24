/**
 * Aldridge Auto's v26 — Universal VIN Extraction, Folder/VIN Conflict Detector,
 * Smart Legacy Prefix & Multi-Angle Grouping, and Sold-Order (#1006-#1038) + SRS/Seatbelt Compliance Filter
 */
const path = require('node:path');
const { db, validateVinStrict, validatePartCompliance } = require('./db');
const {
  PROHIBITED_CAT_SKUS,
  PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS,
  CONFIRMED_SOLD_OR_GHOST_SKUS,
  DUPLICATE_MERGE_TO_PRIMARY
} = require('./audit-sanitizer');

// Confirmed Shopify Sold Orders (#1006 - #1038) SKU & Component Blocklist
const SHOPIFY_SOLD_ORDER_SKUS = new Set([
  ...CONFIRMED_SOLD_OR_GHOST_SKUS,
  // Order #1006-#1038 confirmed sold legacy SKU references
  'ALD-FN19XF', // Camry Engine/Auto Trans (sold)
  'ALD-WXWTJ7', // 2010 Tundra Front Right Door (sold)
  'ALD-HKOW5U', 'ALD-C74GDF', 'ALD-KW3SEC', 'ALD-3XSMH3', 'ALD-N705TV',
  'ALD-T9XQPR', 'ALD-GSSKE6', 'ALD-MA08N5', 'ALD-RXE802',
  'ALD-YIS3S3', 'ALD-GC27GR', 'ALD-T4F60R'
]);

const BANNED_SRS_SEATBELT_REGEX = /\b(air\s*bag|airbag|srs|clock\s*spring|clockspring|seat\s*belt|seatbelt|retractor|pretensioner|pre-tensioner|inflator|curtain\s*bag|impact\s*sensor|crash\s*sensor|catalytic\s*converter|cat\s*converter)\b/i;

/* ==================== 1. UNIVERSAL ISO-3779 VIN EXTRACTION ==================== */
function extractIsoVinCandidates(rawText = '') {
  const text = String(rawText || '').toUpperCase();
  if (!text) return [];
  const matches = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || [];
  const valid = [];
  const seen = new Set();
  for (const cand of matches) {
    if (seen.has(cand)) continue;
    seen.add(cand);
    const check = validateVinStrict(cand);
    if (check.valid) {
      valid.push(check.vin);
    }
  }
  return valid;
}

const TITLE_CHECK_VIN_SENTINEL = 'VIN-TITLE-CHECK';

function isTitleCheckSessionVin(rawVin = '') {
  return String(rawVin || '').trim().toUpperCase() === TITLE_CHECK_VIN_SENTINEL;
}

const KNOWN_MAKE_ALIASES = [
  { re: /\btoyota\b/i, name: 'Toyota' },
  { re: /\bfiat\b/i, name: 'Fiat' },
  { re: /\bsubaru\b/i, name: 'Subaru' },
  { re: /\b(chevrolet|chevy)\b/i, name: 'Chevrolet' },
  { re: /\bdodge\b/i, name: 'Dodge' },
  { re: /\bford\b/i, name: 'Ford' },
  { re: /\bhonda\b/i, name: 'Honda' },
  { re: /\bnissan\b/i, name: 'Nissan' },
  { re: /\bgmc\b/i, name: 'GMC' },
  { re: /\bjeep\b/i, name: 'Jeep' },
  { re: /\bram\b/i, name: 'Ram' },
  { re: /\bhyundai\b/i, name: 'Hyundai' },
  { re: /\bkia\b/i, name: 'Kia' },
  { re: /\bbmw\b/i, name: 'BMW' },
  { re: /\bmercedes\b/i, name: 'Mercedes-Benz' },
  { re: /\bmazda\b/i, name: 'Mazda' },
  { re: /\blexus\b/i, name: 'Lexus' },
  { re: /\bacura\b/i, name: 'Acura' },
  { re: /\bvolkswagen|\bvw\b/i, name: 'Volkswagen' },
  { re: /\bchrysler\b/i, name: 'Chrysler' },
  { re: /\bbuick\b/i, name: 'Buick' },
  { re: /\bcadillac\b/i, name: 'Cadillac' },
  { re: /\bpontiac\b/i, name: 'Pontiac' },
  { re: /\bvolvo\b/i, name: 'Volvo' },
  { re: /\baudi\b/i, name: 'Audi' }
];

function parseFolderYearMakeModel(folderLabel = '') {
  const cleaned = String(folderLabel || '')
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, ' ')
    .replace(/[_\-\/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  const yrMatch = cleaned.match(/\b(19[6-9]\d|20[0-2]\d)\b/);
  const year = yrMatch ? parseInt(yrMatch[1], 10) : 0;
  const makeEntry = KNOWN_MAKE_ALIASES.find((m) => m.re.test(cleaned));
  if (!year || !makeEntry) return null;

  const mMatch = cleaned.match(makeEntry.re);
  const afterMake = mMatch ? cleaned.slice(mMatch.index + mMatch[0].length).trim() : '';
  const modelTokens = afterMake
    .split(/\s+/)
    .filter((t) => t && !/^(parts?|photos?|images?|donor|car|truck|suv|sedan|van|folder|vin|oem|used|bay|lot|\d{4})$/i.test(t))
    .slice(0, 2);
  const model = modelTokens
    .map((t) => (/^\d+$/.test(t) || t.length <= 2 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()))
    .join(' ')
    .trim();
  if (!model) return null;

  const parsed = { year, make: makeEntry.name, model };
  parsed.auto_bin_prefix = buildAutoBinPrefix(parsed);
  return parsed;
}

function detectFolderVinConflict(folderLabel = '', decoded = {}) {
  const label = String(folderLabel || '').trim();
  if (!label || !decoded?.year) {
    return { has_conflict: false, warning: '' };
  }

  const parsedFolder = parseFolderYearMakeModel(label);
  const yrMatch = label.match(/\b(19[6-9]\d|20[0-2]\d)\b/);
  const folderYear = parsedFolder?.year || (yrMatch ? parseInt(yrMatch[1], 10) : 0);
  const decodedYear = parseInt(decoded.year, 10) || 0;
  const decodedMake = String(decoded.make || '').trim();
  const decodedModel = String(decoded.model || '').trim();

  const warnings = [];
  if (folderYear && decodedYear && folderYear !== decodedYear) {
    warnings.push(
      `Folder label specifies ${folderYear}${parsedFolder ? ` ${parsedFolder.make} ${parsedFolder.model}` : ''}, but VIN ${decoded.vin} decodes via NHTSA vPIC to ${decodedYear} ${decodedMake} ${decodedModel}`
    );
  }

  if (parsedFolder?.make && decodedMake && !decodedMake.toLowerCase().includes(parsedFolder.make.toLowerCase())) {
    warnings.push(
      `Folder label specifies make "${parsedFolder.make}", but VIN ${decoded.vin} decodes via NHTSA vPIC to ${decodedMake}`
    );
  }

  if (parsedFolder?.model && decodedModel) {
    const fm = parsedFolder.model.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dm = decodedModel.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (fm.length >= 3 && dm.length >= 3 && !dm.includes(fm) && !fm.includes(dm)) {
      warnings.push(
        `Folder label specifies model "${parsedFolder.model}", but VIN ${decoded.vin} decodes via NHTSA vPIC to ${decodedModel}`
      );
    }
  }

  const nhtsaVehicle = {
    vin: decoded.vin || '',
    year: decodedYear || null,
    make: decodedMake,
    model: decodedModel,
    trim: decoded.trim || '',
    engine: decoded.engine || '',
    drivetrain: decoded.drivetrain || '',
    auto_bin_prefix: buildAutoBinPrefix(decoded)
  };

  return {
    has_conflict: warnings.length > 0,
    folder_label: label,
    folder_year: folderYear || null,
    decoded_year: decodedYear || null,
    decoded_vehicle: `${decodedYear} ${decodedMake} ${decodedModel}`.trim(),
    folder_vehicle: parsedFolder,
    nhtsa_vehicle: nhtsaVehicle,
    warning: warnings.join(' | ')
  };
}

/* ==================== 2. SELF-POPULATING SHELF / BIN PREFIX ==================== */
function buildAutoBinPrefix(session = {}) {
  const yr = String(session.year || '').trim();
  const yr2 = yr.length >= 4 ? yr.slice(-2) : '';
  const make = String(session.make || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const modelRaw = String(session.model || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Crisp mechanic-friendly bay bin labels: CAMRY-05-BAYB, CAMRY-96-BAYB, FIAT500-15-BAYB, EQUINOX-16-BAYB
  let token = modelRaw;
  if (make === 'FIAT' && modelRaw.startsWith('500')) {
    token = 'FIAT500';
  } else if (make === 'CHEVROLET' && modelRaw.startsWith('S10')) {
    token = 'S10';
  } else if (!token || token.length < 2) {
    token = make || 'OEM';
  }
  token = token.slice(0, 10);
  return yr2 ? `${token}-${yr2}-BAYB` : `${token}-BAYB`;
}

/* ==================== 3. SMART LEGACY PREFIX & MULTI-ANGLE GROUPING ==================== */
function stripTriagePrefix(filename = '') {
  const base = path.basename(String(filename || ''), path.extname(String(filename || ''))).trim();
  // Strip P0291__, P1049__, etc.
  return base.replace(/^P\d{3,5}__+/i, '').trim();
}

function extractLegacySkuPrefix(filename = '') {
  const cleaned = stripTriagePrefix(filename).toUpperCase();
  // Match ALD-OH-019.1 -> ALD-OH-019
  const ohMatch = cleaned.match(/^(ALD-OH-\d{2,4})(?:[._-\s]\d+)?$/i);
  if (ohMatch) {
    return { kind: 'legacy_oh', code: ohMatch[1].toUpperCase() };
  }
  // Match ALD-PYGBDJ_1, ALD-PYGBDJ_2, ALD-FN19XF_1 -> ALD-PYGBDJ
  const aldMatch = cleaned.match(/^(ALD-[A-Z0-9]{5,8})(?:[._-\s]\d+)?$/i);
  if (aldMatch) {
    const rawCode = aldMatch[1].toUpperCase();
    const canonical = DUPLICATE_MERGE_TO_PRIMARY[rawCode] || rawCode;
    return { kind: 'legacy_sku', code: rawCode, canonical };
  }
  return null;
}

function normalizeComponentSlug(filename = '') {
  const cleaned = stripTriagePrefix(filename).toLowerCase();
  // Ignore pure camera timestamps / IMG_ / DSC_ / PXL_
  if (/^(img|dsc|dscn|pxl|photo|image|pic|mvimg|whatsapp|screenshot|cam|snap|drive|vid|mov|20\d{6})[_\-\s0-9]*$/i.test(cleaned)) {
    return '';
  }

  let slug = cleaned
    // Remove leading 4-digit year + make/model prefixes (e.g. "1996-toyota-camry-front-seat.8" -> "front-seat")
    .replace(/^(19[7-9]\d|20[0-2]\d)[\s_-]+/i, '')
    .replace(/^(toyota|fiat|subaru|chevrolet|chevy|dodge|ford|honda|nissan|gmc|jeep|ram|hyundai|kia|bmw)[\s_-]+/i, '')
    .replace(/^(camry|4runner|tacoma|tundra|500|pop|outback|forester|s10|s-10|equinox|dakota|civic|accord|f150|f-150|silverado)[\s_-]+/i, '')
    // Remove angle/sequence suffixes: .1, .8, _1, _2, -angle-2, (2)
    .replace(/[\._\-\s]+(angle|view|photo|pic|img|shot|close|closeup|label|mpn|tag)?[\._\-\s]*\d+$/i, '')
    .replace(/[\._\-\s]+\(\d+\)$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // Singularize common plural component suffixes so rear-seat & rear-seats or car-seat & car-seats merge cleanly
  slug = slug
    .replace(/\bseats\b/g, 'seat')
    .replace(/\bdoors\b/g, 'door')
    .replace(/\bheadlights\b/g, 'headlight')
    .replace(/\btaillights\b/g, 'taillight')
    .replace(/\bmirrors\b/g, 'mirror')
    .replace(/\bfenders\b/g, 'fender')
    .replace(/\bshocks\b/g, 'shock')
    .replace(/\bstruts\b/g, 'strut')
    .replace(/\bwheels\b/g, 'wheel')
    .replace(/^car-/, ''); // car-seat -> seat, car-door -> door

  return slug.length >= 3 ? slug : '';
}

function deriveSmartGroupKey(img = {}, groupingMode = 'auto') {
  if (groupingMode === 'single_part') return '__single_part_batch__';
  if (groupingMode === 'one_per_photo') return `__photo_${String(img.sha256 || '').slice(0, 12)}__`;

  // 1) Legacy ALD-XXXXXX or ALD-OH-XXX prefix grouping (e.g., P0291__ALD-PYGBDJ_1.jpeg + P0356__ALD-PYGBDJ_2.jpeg -> 1 gallery!)
  const legacy = extractLegacySkuPrefix(img.filename || '');
  if (legacy) {
    return `${legacy.kind}:${legacy.canonical || legacy.code}`;
  }

  // 2) Named ZIP subfolder grouping (when not a generic wrapper or vehicle-level folder)
  const folder = String(img.folderName || '').trim().toLowerCase();
  const isVehicleFolder = /\b(19[7-9]\d|20[0-2]\d)\b/.test(folder) || extractIsoVinCandidates(folder).length > 0;
  if (folder && !isVehicleFolder && !/^(photos?|images?|pics?|parts?|uploads?|dcim|camera|all|batch|videos?)$/i.test(folder)) {
    return `folder:${folder}`;
  }

  // 3) Component slug grouping (e.g., front-seat.1.jpg .. front-seat.8.jpg -> slug:front-seat)
  const slug = normalizeComponentSlug(img.filename || '');
  if (slug) {
    return `slug:${slug}`;
  }

  // 4) Video frames from the same video clip stay grouped together as multi-angle shots of that clip
  if (img.videoSourceKey) {
    return `video:${img.videoSourceKey}`;
  }

  // 5) Raw camera photo starts in its own group and merges post-AI Vision if identical component
  return `photo:${String(img.sha256 || Math.random().toString(36).slice(2)).slice(0, 12)}`;
}

/* ==================== 4. SOLD-ORDER (#1006-#1038) & SRS/SEATBELT/CAT FILTER ==================== */
function getLiveSoldSkuSet() {
  const sold = new Set(SHOPIFY_SOLD_ORDER_SKUS);
  try {
    const rows = db.prepare("SELECT sku FROM inventory_items WHERE status = 'sold'").all();
    for (const r of rows) {
      if (r.sku) sold.add(String(r.sku).trim().toUpperCase());
    }
  } catch (_) {}
  try {
    const ordRows = db.prepare("SELECT items_json FROM orders WHERE status IN ('paid', 'fulfilled', 'completed', 'shipped')").all();
    for (const r of ordRows) {
      const items = JSON.parse(r.items_json || '[]');
      for (const it of items) {
        if (it?.sku) sold.add(String(it.sku).trim().toUpperCase());
      }
    }
  } catch (_) {}
  return sold;
}

const SOLD_SUBARU_TRANSMISSION_SKUS = new Set([
  'ALD-09SUB-TRANSMISSION-A-94D1',
  'ALD-98SUB-TRANSMISSION-A-69CF',
  'ALD-98SUB-TRANSMISSION-A-5388',
  'ALD-09SUB-AUTOMATIC-TRAN-08CC',
  'ALD-98SUB-AUTOMATIC-TRAN-FFBA'
]);
const SOLD_SUBARU_TRANSMISSION_FILE_REGEX = /\b(?:P0126__|P1942__|P0082__)|1998[\s_-]+subaru[\s_-]+(?:outback|forester)[\s_-]+(?:automatic[\s_-]+)?transmission|2003[\s_-]+subaru[\s_-]+outback[\s_-]+manual[\s_-]+transmission/i;
const GHOST_LACROSSE_REGEX = /\b(1G4GA5GR2FF246661|LACROSSE-15-BAYB|buick[\s_-]+lacrosse)\b/i;

function checkSoldOrderAndSrsBlocklist({ filename = '', legacySku = '', title = '', description = '' } = {}) {
  const legacyInfo = legacySku ? { code: String(legacySku).toUpperCase() } : extractLegacySkuPrefix(filename);
  const skuCode = legacyInfo?.code || '';
  const soldSet = getLiveSoldSkuSet();
  const rawBlob = `${filename} ${legacySku} ${title} ${description}`;

  if (GHOST_LACROSSE_REGEX.test(rawBlob)) {
    return {
      blocked: true,
      category: 'ghost_vehicle_banned',
      reason: 'Permanently blocked ghost vehicle: 2015 Buick LaCrosse (1G4GA5GR2FF246661) was never owned by Aldridge Auto.'
    };
  }

  if (
    (skuCode && (soldSet.has(skuCode) || SOLD_SUBARU_TRANSMISSION_SKUS.has(skuCode))) ||
    SOLD_SUBARU_TRANSMISSION_FILE_REGEX.test(String(filename || ''))
  ) {
    return {
      blocked: true,
      category: 'sold_order_filter',
      reason: `Blocked already-sold / duplicate SKU (${skuCode || filename} — sold order / retired transmission blocklist).`
    };
  }
  if (skuCode && PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS.has(skuCode)) {
    return {
      blocked: true,
      category: 'prohibited_srs',
      reason: `Blocked prohibited SRS / airbag / safety SKU (${skuCode}).`
    };
  }
  if (skuCode && PROHIBITED_CAT_SKUS.has(skuCode)) {
    return {
      blocked: true,
      category: 'prohibited_catalytic',
      reason: `Blocked prohibited catalytic converter SKU (${skuCode}).`
    };
  }

  const combined = `${filename} ${title} ${description}`.replace(/[_\./\\-]+/g, ' ');
  if (BANNED_SRS_SEATBELT_REGEX.test(combined)) {
    const m = combined.match(BANNED_SRS_SEATBELT_REGEX);
    return {
      blocked: true,
      category: 'prohibited_srs_seatbelt',
      reason: `Blocked prohibited SRS / airbag / seatbelt / catalytic keyword ("${m?.[0] || 'SRS'}").`
    };
  }

  const comp = validatePartCompliance({ title: title || combined, description: description || combined });
  if (!comp.compliant) {
    return {
      blocked: true,
      category: 'prohibited_compliance',
      reason: comp.reason
    };
  }

  return { blocked: false, category: '', reason: '' };
}

module.exports = {
  SHOPIFY_SOLD_ORDER_SKUS,
  TITLE_CHECK_VIN_SENTINEL,
  isTitleCheckSessionVin,
  parseFolderYearMakeModel,
  extractIsoVinCandidates,
  detectFolderVinConflict,
  buildAutoBinPrefix,
  stripTriagePrefix,
  extractLegacySkuPrefix,
  normalizeComponentSlug,
  deriveSmartGroupKey,
  getLiveSoldSkuSet,
  checkSoldOrderAndSrsBlocklist
};
