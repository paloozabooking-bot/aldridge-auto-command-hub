const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  db,
  DATA_DIR,
  getSettings,
  generateSecurityCode,
  computeShippingClass,
  PERMANENTLY_BANNED_GHOST_VINS,
  PERMANENTLY_BANNED_SOLD_SKUS,
  ACTIVE_DONOR_ALLOWLIST,
  ALLOWED_ACTIVE_DONOR_VINS,
  DISPOSED_VEHICLE_TEXT_REGEX,
  validateVinStrict,
  isAllowedActiveDonorVehicle,
  isGhostOrBannedInventoryItem,
  purgeGhostAndBlockedInventory,
  validatePartCompliance,
  validateInventoryItemForPublish,
  logSync
} = require('./db');
const { generateAllPolicies } = require('./policies');
const { csvEscape, xmlEscape, parseCsv } = require('./exporters-csv-utils');
const { isQrCardUrl } = require('./qr-card');
const {
  resolvePartTaxonomyAndMetafields,
  sanitizeVerifiedMpn,
  resolveStructuredOemMpn,
  resolveCountryOfOrigin
} = require('./taxonomy');
const {
  resolveCategoryBookTimeLabor,
  resolvePartDimensionsAndWeight,
  stripOffPlatformViolations,
  dedupeSentences
} = require('./catalog-enrichment');
const {
  PROHIBITED_CAT_SKUS,
  PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS,
  CONFIRMED_SOLD_OR_GHOST_SKUS,
  isCounterfeitMpn,
  isGoogleDriveViewerUrl,
  cleanListingTitle,
  sanitizeHtmlBody,
  healWeightAndShipping
} = require('./audit-sanitizer');

function extractRawPhotoArray(item) {
  return Array.isArray(item?.photos)
    ? item.photos
    : (() => {
        try {
          return JSON.parse(item?.photos_json || '[]');
        } catch (_) {
          return [];
        }
      })();
}

// Marketplace-Safe Clean Photos ONLY (NEVER includes QR/info cards or Drive viewer URLs!)
function getValidPhotos(item) {
  return extractRawPhotoArray(item)
    .map((u) => String(u || '').trim())
    .filter((u) => u && u !== '/assets/oem-parts.jpg' && !isGoogleDriveViewerUrl(u) && !isQrCardUrl(u));
}

function hasRealPhotos(item) {
  return getValidPhotos(item).length > 0;
}

// v31.0 ZERO-QR MEDIA POLICY: Shopify product media MUST contain ONLY real part photos — NEVER *.qr.png!
function getShopifyGalleryPhotos(item) {
  return getValidPhotos(item);
}

function isMarketplaceSafeItem(item) {
  if (!item || Number(item.quantity || 0) <= 0 || item.status !== 'active') return false;
  if (isGhostOrBannedInventoryItem(item).blocked) return false;
  if (!isAllowedActiveDonorVehicle(item).allowed) return false;
  const vVin = String(item.verified_vin || '').trim().toUpperCase();
  // STRICT NO REAL 17-CHAR VERIFIED DONOR VIN = NO LISTING (zero VIN-TITLE-CHECK bypass)
  if (!vVin || vVin.length !== 17 || !validateVinStrict(vVin).valid) return false;
  if (!item.intake_session_id || item.intake_source !== 'vin_intake_pipeline') return false;
  if (!hasRealPhotos(item)) return false;
  const skuUpper = String(item.sku || '').trim().toUpperCase();
  if (
    PROHIBITED_CAT_SKUS.has(skuUpper) ||
    PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS.has(skuUpper) ||
    CONFIRMED_SOLD_OR_GHOST_SKUS.has(skuUpper) ||
    PERMANENTLY_BANNED_SOLD_SKUS.has(skuUpper)
  ) {
    return false;
  }
  const gate = validateInventoryItemForPublish(item);
  if (!gate.valid) return false;

  if (item.donor_vehicle_id) {
    const dv = db.prepare('SELECT vin FROM donor_vehicles WHERE id = ?').get(item.donor_vehicle_id);
    if (dv && dv.vin && !validateVinStrict(dv.vin).valid) return false;
  }
  return true;
}

/**
 * PERMANENT PRE-EXPORT DEDUPLICATION, GHOST PURGE & MANDATORY STRICT 17-CHAR VIN GATE:
 * Runs purgeGhostAndBlockedInventory() + deduplicateCatalog() before every marketplace CSV/XML export
 * and strictly excludes any item without a real 17-character NHTSA-verified donor VIN.
 */
function ensureDeduplicatedItems(items) {
  try {
    purgeGhostAndBlockedInventory({ actor: 'pre_export_gate' });
  } catch (_) {}
  try {
    const { deduplicateCatalog } = require('./catalog-enrichment');
    deduplicateCatalog();
  } catch (_) {}
  if (!Array.isArray(items) || !items.length) return [];
  const activeRows = db.prepare(`
    SELECT sku, status, quantity, photos_json, verified_vin, intake_session_id, intake_source,
           weight_lbs, length_in, width_in, height_in, oem_part_number, title, description, defect_disclosure, shipping_class
    FROM inventory_items
    WHERE status = 'active'
      AND LENGTH(TRIM(COALESCE(verified_vin, ''))) = 17
      AND UPPER(TRIM(COALESCE(verified_vin, ''))) != '1G4GA5GR2FF246661'
      AND COALESCE(intake_session_id, '') != ''
      AND COALESCE(intake_source, '') = 'vin_intake_pipeline'
  `).all();
  const activeBySku = new Map(activeRows.map((r) => [String(r.sku || '').trim().toUpperCase(), r]));
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const skuKey = String(item?.sku || '').trim().toUpperCase();
    if (!skuKey || seen.has(skuKey)) continue;
    const live = activeBySku.get(skuKey);
    if (!live || Number(live.quantity || 0) <= 0) continue;
    seen.add(skuKey);
    out.push({
      ...item,
      status: live.status,
      quantity: live.quantity,
      photos_json: live.photos_json || item.photos_json,
      verified_vin: live.verified_vin,
      intake_session_id: live.intake_session_id,
      intake_source: live.intake_source,
      weight_lbs: live.weight_lbs || item.weight_lbs,
      length_in: live.length_in || item.length_in,
      width_in: live.width_in || item.width_in,
      height_in: live.height_in || item.height_in,
      oem_part_number: live.oem_part_number || item.oem_part_number,
      title: live.title || item.title,
      description: live.description || item.description,
      defect_disclosure: live.defect_disclosure || item.defect_disclosure,
      shipping_class: live.shipping_class || item.shipping_class
    });
  }
  return out;
}

function sanitizeMpnField(rawMpn) {
  const clean = sanitizeVerifiedMpn(rawMpn);
  if (!clean) return '';
  return isCounterfeitMpn(clean) ? '' : clean;
}

function resolveExportMpn(itemOrRawMpn) {
  if (itemOrRawMpn && typeof itemOrRawMpn === 'object') {
    return resolveStructuredOemMpn(itemOrRawMpn).mpn;
  }
  return sanitizeMpnField(itemOrRawMpn);
}

function resolveExportDims(item = {}) {
  const det = resolvePartDimensionsAndWeight(item);
  const w = Number(item.weight_lbs || 0);
  const l = Number(item.length_in || 0);
  const wi = Number(item.width_in || 0);
  const h = Number(item.height_in || 0);
  const isLegacyDefault =
    w <= 0 || w === 2 || w === 8.5 ||
    (l === 14 && wi === 10 && (h === 7 || h === 8));
  if (isLegacyDefault || l <= 0 || wi <= 0 || h <= 0) {
    return det;
  }
  return {
    weight_lbs: Number(w.toFixed(1)),
    length_in: Math.round(l),
    width_in: Math.round(wi),
    height_in: Math.round(h),
    labor_hours: Number(item.install_labor_hours ?? det.labor_hours),
    local_pickup_only: Boolean(det.local_pickup_only || item.shipping_class === 'local_pickup_only')
  };
}

function normalizeExportCondition(rawCondition) {
  const c = String(rawCondition || 'Used').trim().toLowerCase();
  if (c === 'new') return 'New';
  if (c.includes('reman') || c.includes('rebuilt')) return 'Used';
  return 'Used';
}

function isHeavyLocalPickupItem(item, settings) {
  const threshold = Number(settings?.freight_weight_threshold_lbs || 70);
  const dims = resolveExportDims(item);
  const girth = dims.length_in + 2 * (dims.width_in + dims.height_in);
  return dims.local_pickup_only || dims.weight_lbs >= threshold || girth > 130 || item.shipping_class !== 'parcel_calculated';
}

function resolveExportPhotoUrl(photoPath, baseUrl, settings) {
  if (!photoPath) return '';
  if (/^https?:\/\//i.test(photoPath)) return photoPath;
  const { resolvePublicAppBaseUrl } = require('./qr-card');
  const canonicalBase = resolvePublicAppBaseUrl(settings);
  if (canonicalBase) {
    return `${canonicalBase}${photoPath.startsWith('/') ? photoPath : '/' + photoPath}`;
  }
  const isLocalBase = !baseUrl || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl);
  if (isLocalBase && photoPath.startsWith('/uploads/') && settings?.shopify_cdn_id) {
    const fileName = photoPath.replace(/^\/uploads\//, '');
    return `https://cdn.shopify.com/s/files/1/${settings.shopify_cdn_id}/files/${fileName}`;
  }
  return `${baseUrl || ''}${photoPath}`;
}

function formatDimensionsIn(item) {
  const dims = resolveExportDims(item);
  return `${Math.ceil(dims.length_in)}x${Math.ceil(dims.width_in)}x${Math.ceil(dims.height_in)}`;
}

function computeInstallEstimate(item, settings) {
  const base = Number(item.price_we_pull || 0);
  const hours = Number(item.install_labor_hours || 1.5);
  const rate = Number(settings?.labor_rate_hourly || 174.99);
  const supplyRate = Number(settings?.shop_supply_fee_rate ?? 0.07);
  const supplyCap = Number(settings?.shop_supply_fee_cap ?? 45);
  const taxRate = Number(settings?.tax_rate ?? 0.101);
  const laborSub = Math.round(hours * rate * 100) / 100;
  const supplyFee = laborSub > 0 ? Math.round(Math.min(supplyCap, laborSub * supplyRate) * 100) / 100 : 0;
  const installTotal = Math.round((base + laborSub) * 100) / 100;
  const otdTotal = Math.round((base + laborSub + supplyFee) * (1 + taxRate) * 100) / 100;
  return { installTotal, otdTotal, supplyFee, supplyCap, taxRate, hours, rate };
}

function stripOffEbayContactText(text) {
  return stripOffPlatformViolations(text);
}

function resolveDirectPublicUrls(settings, baseUrl) {
  const { resolvePublicAppBaseUrl } = require('./qr-card');
  const pwaUrl = resolvePublicAppBaseUrl(settings);
  const shopifyUrl = (settings?.shopify_storefront_url || 'https://aldridgesales.myshopify.com').replace(/\/+$/, '');
  return { pwaUrl, shopifyUrl };
}

function stripDriveUrlsFromPublicText(text) {
  return String(text || '')
    .replace(/\s*\|\s*Drive\s+(Photo\s+Ref|Source)\s*:\s*https?:\/\/[^\s|<"]+/gi, '')
    .replace(/\bDrive\s+(Photo\s+Ref|Source)\s*:\s*https?:\/\/[^\s|<"]+/gi, '')
    .replace(/https?:\/\/drive\.google\.com\/[^\s|<",)]+/gi, '')
    .replace(/\s*\|\s*\|/g, ' |')
    .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildExpectedShopifyImageAlt(item) {
  const sku = String(item?.sku || '').trim();
  const cleanTitle = cleanListingTitle(item?.title || '').slice(0, 80);
  const suffix = sku ? ` (${sku})` : '';
  const maxTitleLen = Math.max(20, 125 - suffix.length);
  return `${cleanTitle.slice(0, maxTitleLen).trim()}${suffix}`.trim();
}

function buildCleanInspectionSummary(item = {}) {
  const cleanDefect = stripOffPlatformViolations(item.defect_disclosure || '');
  const fitmentLine = [item.fitment_years, item.fitment_make, item.fitment_model, item.fitment_engine]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ');
  const isGeneric = !cleanDefect || cleanDefect.length < 12 || /^(inspected & verified\.?|clean tested assembly\.?)$/i.test(cleanDefect);
  const baseNote = isGeneric
    ? `Genuine factory OEM ${item.category || 'component'} removed from ${fitmentLine || 'verified donor vehicle'}. Mounting points and connectors inspected intact; see all photos for exact cosmetic condition.`
    : cleanDefect;
  return dedupeSentences(stripOffPlatformViolations(baseNote));
}

function buildCleanPlainListingDesc(item, settings) {
  const title80 = cleanListingTitle(item.title || '').slice(0, 80);
  const tax = resolvePartTaxonomyAndMetafields(item, settings);
  const dims = resolveExportDims(item);
  const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
  const fitmentLine = [item.fitment_years, item.fitment_make, item.fitment_model, item.fitment_engine]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ');
  const donorVin = String(item.verified_vin || '').trim().toUpperCase();
  const summary = buildCleanInspectionSummary(item);
  const shipText = heavyPickupOnly ? 'Local Pickup Only' : 'Calculated Parcel Shipping';
  return dedupeSentences(
    stripOffPlatformViolations(
      `${title80}. ${summary} OEM MPN: ${tax.mpn}. Donor Fitment: ${fitmentLine || tax.customLabel0}${donorVin.length === 17 ? ` (VIN ${donorVin})` : ''}. Condition: ${normalizeExportCondition(item.condition)} OEM. Packed Spec: ${dims.weight_lbs} lbs (${dims.length_in}x${dims.width_in}x${dims.height_in} in) - ${shipText}. Origin: ${tax.countryCodeOfOrigin}.`
    )
  );
}

function renderCleanOemSpecHtml(item, settings, templateKey = 'shopify_direct_html_template') {
  const policies = generateAllPolicies(settings);
  const tpl = policies[templateKey] || policies.shopify_direct_html_template;
  const title80 = cleanListingTitle(item.title || '').slice(0, 80);
  const tax = resolvePartTaxonomyAndMetafields(item, settings);
  const dims = resolveExportDims(item);
  const condOut = normalizeExportCondition(item.condition);
  const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
  const interchangeClean = sanitizeMpnField(item.interchange_number);
  const interchangeSuffix = interchangeClean
    ? ` / Interchange: ${interchangeClean}`
    : (item.hollander_number ? ` (Hollander #${item.hollander_number})` : '');
  const fitmentLine = [item.fitment_years, item.fitment_make, item.fitment_model, item.fitment_engine]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ') || tax.customLabel0;
  const donorVin = String(item.verified_vin || '').trim().toUpperCase();
  const shipLabel = heavyPickupOnly ? 'Local Pickup Only' : 'Calculated Parcel Shipping';
  const inspectionSummary = buildCleanInspectionSummary(item);

  return tpl
    .replaceAll('{{SKU}}', item.sku || '')
    .replaceAll('{{TITLE}}', title80)
    .replaceAll('{{OEM_PART_NUMBER}}', tax.mpn)
    .replaceAll('{{INTERCHANGE_SUFFIX}}', interchangeSuffix)
    .replaceAll('{{INSPECTION_SUMMARY}}', inspectionSummary)
    .replaceAll('{{CONDITION}}', condOut === 'New' ? 'New OEM' : 'Used OEM')
    .replaceAll('{{FITMENT_LINE}}', fitmentLine)
    .replaceAll('{{DONOR_VIN}}', donorVin)
    .replaceAll('{{PLACEMENT}}', stripOffPlatformViolations(item.placement_on_vehicle || 'Vehicle Specific') || 'Vehicle Specific')
    .replaceAll('{{BIN_LOCATION}}', item.bin_location || 'BAY-B')
    .replaceAll('{{WEIGHT_LBS}}', String(dims.weight_lbs))
    .replaceAll('{{DIMENSIONS_IN}}', `${dims.length_in} x ${dims.width_in} x ${dims.height_in}`)
    .replaceAll('{{SHIPPING_SUMMARY_LABEL}}', shipLabel)
    .replaceAll('{{COUNTRY_OF_ORIGIN}}', tax.countryCodeOfOrigin);
}

function renderShopifyHtml(item, settings) {
  return renderCleanOemSpecHtml(item, settings, 'shopify_direct_html_template');
}

function renderEbayHtml(item, settings) {
  return renderCleanOemSpecHtml(item, settings, 'ebay_motors_html_template');
}

function renderLocalMarketplacePacket(item, settings) {
  const tpl = generateAllPolicies(settings).local_marketplace_template;
  const title80 = cleanListingTitle(item.title || '').slice(0, 80);
  const tax = resolvePartTaxonomyAndMetafields(item, settings);
  const dims = resolveExportDims(item);
  const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
  const fitmentLine = [item.fitment_years, item.fitment_make, item.fitment_model, item.fitment_engine]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ') || tax.customLabel0;

  return tpl
    .replaceAll('{{TITLE}}', title80)
    .replaceAll('{{OEM_PART_NUMBER}}', tax.mpn)
    .replaceAll('{{SKU}}', item.sku || '')
    .replaceAll('{{FITMENT_LINE}}', fitmentLine)
    .replaceAll('{{DONOR_VIN}}', String(item.verified_vin || '').trim().toUpperCase())
    .replaceAll('{{CONDITION}}', normalizeExportCondition(item.condition) === 'New' ? 'New OEM' : 'Used OEM')
    .replaceAll('{{INSPECTION_SUMMARY}}', buildCleanInspectionSummary(item))
    .replaceAll('{{WEIGHT_LBS}}', String(dims.weight_lbs))
    .replaceAll('{{DIMENSIONS_IN}}', `${dims.length_in}x${dims.width_in}x${dims.height_in}`)
    .replaceAll('{{SHIPPING_SUMMARY_LABEL}}', heavyPickupOnly ? 'Local Pickup Only' : 'Calculated Parcel Shipping')
    .replaceAll('{{BIN_LOCATION}}', item.bin_location || 'BAY-B');
}

function generateMasterImportTemplateCsv() {
  const headers = [
    'sku', 'title', 'category', 'condition', 'brand', 'oem_part_number',
    'interchange_number', 'hollander_number', 'placement_on_vehicle', 'donor_vin',
    'fitment_years', 'fitment_make', 'fitment_model', 'fitment_engine', 'fitment_notes',
    'description', 'defect_disclosure', 'bin_location', 'security_mark_code',
    'pull_status', 'allow_self_pull', 'price_self_pull', 'allow_we_pull', 'price_we_pull',
    'allow_pull_install', 'price_pull_install', 'install_labor_hours', 'quantity',
    'weight_lbs', 'length_in', 'width_in', 'height_in', 'photo_url_1'
  ];
  const sample1 = [
    'ALD-SAMPLE-001',
    '2017-2020 Honda CR-V 1.5L Turbo OEM Electronic Throttle Body Assembly',
    'Air & Fuel Delivery',
    'Used',
    'Keihin / Honda OEM',
    '16400-5PA-A01',
    'TB1302',
    '337-51029',
    'Upper Intake Manifold',
    '5TFHW5F12AX134337',
    '2017, 2018, 2019, 2020',
    'Honda',
    'CR-V',
    '1.5L Turbo I4',
    'Requires idle relearn scan procedure after install.',
    'Clean tested OEM Honda throttle body pulled from verified donor.',
    'Clean bore & connector pins intact; light exterior wear.',
    'RACK-C1-BIN-09',
    'SEC-DEMO01',
    'pulled_shelved',
    '0',
    '0',
    '1',
    '115.00',
    '1',
    '245.00',
    '1.0',
    '1',
    '4.5',
    '9',
    '8',
    '7',
    '/assets/oem-parts.jpg'
  ];
  return headers.join(',') + '\n' + sample1.map(csvEscape).join(',') + '\n';
}

function importInventoryCsv(csvText) {
  const parsed = parseCsv(csvText);
  const settings = getSettings();
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  let secondaryPhotosMerged = 0;
  const errors = [];

  const defaultChannels = JSON.stringify({
    shopify: true,
    shopify_marketplace_connect: true,
    ebay_motors: true,
    google_merchant: true,
    meta_catalog: true,
    offerup: true,
    vendoo: true,
    tiktok_shop: true,
    craigslist: true
  });

  // Pre-group Shopify secondary image rows by Handle so multi-angle CDN photos are NEVER dropped
  const handleExtraPhotos = new Map();
  const primaryRows = [];
  parsed.forEach((row, idx) => {
    const rawTitle = (row.title || row.Title || row['*Title'] || row.PartName || '').trim();
    const handle = (row.Handle || row.handle || '').trim();
    const secImg = (row['Image Src'] || row.photo_url_2 || '').trim();
    if (!rawTitle && handle && secImg) {
      if (isGoogleDriveViewerUrl(secImg)) {
        errors.push(`Row ${idx + 2}: Rejected Google Drive HTML viewer link on Handle ${handle} (must use raw .jpg or Shopify CDN URL)`);
      } else {
        if (!handleExtraPhotos.has(handle)) handleExtraPhotos.set(handle, []);
        handleExtraPhotos.get(handle).push(secImg);
        secondaryPhotosMerged++;
      }
      return;
    }
    primaryRows.push({ row, origIdx: idx });
  });

  primaryRows.forEach(({ row, origIdx }) => {
    try {
      const sku = (
        row.sku || row.SKU || row['Variant SKU'] || row.CustomLabel || row['Stock#'] || row.Handle ||
        `ALD-IMP-${Date.now().toString().slice(-5)}-${origIdx + 1}`
      ).trim();
      const rawTitle = (row.title || row.Title || row['*Title'] || row.PartName || '').trim();
      if (!rawTitle) {
        errors.push(`Row ${origIdx + 2}: Missing title for SKU ${sku}`);
        return;
      }

      const title = cleanListingTitle(rawTitle);
      const category = row.category || row.Type || row['Product Category'] || 'OEM Auto Parts';
      const condition = normalizeExportCondition(row.condition || row.Condition || 'Used');
      const conditionId = condition === 'New' ? 1000 : 3000;

      // Hard-block fake or invalid-checksum VINs on import
      const donorVin = (row.donor_vin || row.VIN || '').trim();
      if (donorVin) {
        const vinCheck = validateVinStrict(donorVin);
        if (!vinCheck.valid) {
          errors.push(`Row ${origIdx + 2} (${sku}): HARD BLOCKED — ${vinCheck.reason}`);
          return;
        }
      }

      const rawDesc = row.description || row['Body (HTML)'] || title;
      const cleanDesc = row['Body (HTML)'] ? sanitizeHtmlBody(rawDesc, title) : rawDesc;

      // Hard-block SRS/airbag/clockspring/pretensioner & catalytic converter items on import
      const skuUpper = sku.toUpperCase();
      const comp = validatePartCompliance({ title: `${rawTitle} ${title}`, category, description: cleanDesc });
      const isProhibited =
        PROHIBITED_CAT_SKUS.has(skuUpper) ||
        PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS.has(skuUpper) ||
        !comp.compliant;
      if (isProhibited) {
        errors.push(`Row ${origIdx + 2} (${sku}): HARD BLOCKED — ${comp.reason || 'Prohibited SRS/airbag/catalytic SKU.'}`);
        return;
      }

      // Heal weights if importing a Shopify CSV with Variant Grams
      let weightLbs = parseFloat(row.weight_lbs || row.Weight_lb || 0);
      let reqShip = row['Variant Requires Shipping'];
      if (!weightLbs && row['Variant Grams']) {
        const healed = healWeightAndShipping(title, row['Variant Grams'], reqShip);
        weightLbs = Number((healed.grams / 453.592).toFixed(1));
        reqShip = healed.requiresShipping;
      }
      if (!weightLbs) weightLbs = 8.5;

      const lengthIn = parseFloat(row.length_in || row.Length || 14) || 14;
      const widthIn = parseFloat(row.width_in || row.Width || 10) || 10;
      const heightIn = parseFloat(row.height_in || row.Height || 8) || 8;
      const computedClass = computeShippingClass(weightLbs, `${category} ${title}`, lengthIn, widthIn, heightIn);
      const shippingClass = (Number(weightLbs) >= Number(settings.freight_weight_threshold_lbs || 70) || String(reqShip).toLowerCase() === 'false')
        ? 'local_pickup_only'
        : (row.shipping_class === 'freight_ltl' ? 'local_pickup_only' : (row.shipping_class || computedClass));

      const priceWePull = parseFloat(row.price_we_pull || row['Variant Price'] || row.StartPrice || row.Price || 0) || 0;
      const pullStatus = row.pull_status || 'pulled_shelved';
      const allowSelfPull = row.allow_self_pull !== undefined
        ? (String(row.allow_self_pull) === '1' || String(row.allow_self_pull).toLowerCase() === 'true' ? 1 : 0)
        : (pullStatus === 'on_vehicle' ? 1 : 0);
      const priceSelfPull = parseFloat(row.price_self_pull || (allowSelfPull ? (priceWePull * 0.72).toFixed(2) : 0)) || 0;
      const allowPullInstall = row.allow_pull_install !== undefined
        ? (String(row.allow_pull_install) === '1' || String(row.allow_pull_install).toLowerCase() === 'true' ? 1 : 0)
        : 1;
      const laborHours = parseFloat(row.install_labor_hours || 1.5) || 1.5;
      const pricePullInstall = parseFloat(
        row.price_pull_install || (priceWePull + laborHours * Number(settings.labor_rate_hourly || 174.99)).toFixed(2)
      ) || 0;

      const photos = [];
      ['photo_url_1', 'photo_url_2', 'Image Src', 'PicURL', 'Primary_Image', 'Additional_Images'].forEach((k) => {
        if (!row[k]) return;
        String(row[k]).split('|').map((u) => u.trim()).filter(Boolean).forEach((u) => {
          if (isGoogleDriveViewerUrl(u)) {
            errors.push(`Row ${origIdx + 2} (${sku}): Rejected Google Drive HTML viewer link ${u}`);
          } else if (!photos.includes(u)) {
            photos.push(u);
          }
        });
      });
      const handle = (row.Handle || row.handle || '').trim();
      if (handle && handleExtraPhotos.has(handle)) {
        for (const extraUrl of handleExtraPhotos.get(handle)) {
          if (!photos.includes(extraUrl)) photos.push(extraUrl);
        }
      }
      if (photos.length === 0) photos.push('/assets/oem-parts.jpg');

      const rawMpn = row.oem_part_number || row.MPN || row['C:OE/OEM Part Number'] || row['*C:Manufacturer Part Number'] || row['Google Shopping / MPN'] || '';
      const cleanOem = sanitizeMpnField(rawMpn);

      const secCode = row.security_mark_code || generateSecurityCode();
      const rawQty = parseInt(row.quantity || row.Quantity || row['Variant Inventory Qty'] || row['*Quantity'] || '1', 10);
      let finalQty = isNaN(rawQty) ? 1 : rawQty;
      let rowStatus = row.Status && ['archived', 'draft', 'pending_verification'].includes(String(row.Status).toLowerCase())
        ? String(row.Status).toLowerCase()
        : (finalQty > 0 ? 'active' : 'sold');

      if (rowStatus === 'active') {
        const pubGate = validateInventoryItemForPublish({
          title,
          category,
          oem_part_number: cleanOem,
          fitment_years: row.fitment_years || '',
          fitment_make: row.fitment_make || '',
          fitment_model: row.fitment_model || '',
          fitment_notes: row.fitment_notes || '',
          description: cleanDesc,
          weight_lbs: weightLbs,
          length_in: lengthIn,
          width_in: widthIn,
          height_in: heightIn
        });
        if (!pubGate.valid) {
          rowStatus = pubGate.recommended_status;
          finalQty = 0;
          errors.push(`Row ${origIdx + 2} (${sku}): Quarantined to ${rowStatus} — ${pubGate.reasons.join('; ')}`);
        }
      }

      let donorId = null;
      if (donorVin) {
        const d = db.prepare('SELECT id FROM donor_vehicles WHERE vin = ?').get(donorVin.toUpperCase());
        if (d) donorId = d.id;
      }

      const existing = db.prepare('SELECT id FROM inventory_items WHERE sku = ?').get(sku);
      if (existing) {
        db.prepare(`
          UPDATE inventory_items SET
            title = ?, category = ?, condition = ?, condition_id = ?,
            brand = ?, oem_part_number = ?, interchange_number = ?, hollander_number = ?,
            placement_on_vehicle = ?, donor_vehicle_id = COALESCE(?, donor_vehicle_id),
            fitment_years = ?, fitment_make = ?, fitment_model = ?, fitment_engine = ?, fitment_notes = ?,
            description = ?, defect_disclosure = ?, bin_location = ?, photos_json = ?,
            pull_status = ?, allow_self_pull = ?, price_self_pull = ?, allow_we_pull = 1, price_we_pull = ?,
            allow_pull_install = ?, price_pull_install = ?, install_labor_hours = ?,
            quantity = ?, weight_lbs = ?, length_in = ?, width_in = ?, height_in = ?,
            shipping_class = ?, handling_fee = ?, handling_days = ?, status = ?, updated_at = ?
          WHERE id = ?
        `).run(
          title, category, condition, conditionId,
          row.brand || row.Brand || row['C:Brand'] || 'OEM',
          cleanOem,
          row.interchange_number || row['C:Interchange Part Number'] || '',
          row.hollander_number || row.Hollander || '',
          row.placement_on_vehicle || row['C:Placement on Vehicle'] || '',
          donorId,
          row.fitment_years || '', row.fitment_make || '', row.fitment_model || '', row.fitment_engine || '', row.fitment_notes || '',
          cleanDesc,
          row.defect_disclosure || 'Inspected & verified.',
          row.bin_location || 'IMPORT-STAGE',
          JSON.stringify(photos),
          pullStatus, allowSelfPull, priceSelfPull, priceWePull,
          allowPullInstall, pricePullInstall, laborHours,
          finalQty, weightLbs, lengthIn, widthIn, heightIn,
          shippingClass, Number(settings.handling_fee_default || 10), Number(settings.handling_days_default || 3),
          rowStatus, now, existing.id
        );
        updated++;
      } else {
        db.prepare(`
          INSERT INTO inventory_items (
            sku, title, category, condition, condition_id, brand, oem_part_number,
            interchange_number, hollander_number, placement_on_vehicle, donor_vehicle_id,
            fitment_years, fitment_make, fitment_model, fitment_engine, fitment_notes,
            description, defect_disclosure, bin_location, security_mark_code, security_mark_verified,
            photos_json, pull_status, allow_self_pull, price_self_pull, allow_we_pull, price_we_pull,
            allow_pull_install, price_pull_install, install_labor_hours, quantity,
            weight_lbs, length_in, width_in, height_in, shipping_class, handling_fee, handling_days,
            channels_json, status, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
            ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `).run(
          sku, title, category, condition, conditionId,
          row.brand || row.Brand || row['C:Brand'] || 'OEM',
          cleanOem,
          row.interchange_number || row['C:Interchange Part Number'] || '',
          row.hollander_number || row.Hollander || '',
          row.placement_on_vehicle || row['C:Placement on Vehicle'] || '',
          donorId,
          row.fitment_years || '', row.fitment_make || '', row.fitment_model || '', row.fitment_engine || '', row.fitment_notes || '',
          cleanDesc,
          row.defect_disclosure || 'Inspected & verified.',
          row.bin_location || 'IMPORT-STAGE',
          secCode,
          JSON.stringify(photos),
          pullStatus, allowSelfPull, priceSelfPull, priceWePull,
          allowPullInstall, pricePullInstall, laborHours,
          finalQty, weightLbs, lengthIn, widthIn, heightIn,
          shippingClass, Number(settings.handling_fee_default || 10), Number(settings.handling_days_default || 3),
          defaultChannels, rowStatus, now, now
        );
        inserted++;
      }
    } catch (err) {
      errors.push(`Row ${origIdx + 2}: ${err.message}`);
    }
  });

  logSync('inbound', 'bulk_csv_import', 'import_batch', '', 'success', `Imported CSV batch: ${inserted} created, ${updated} updated, ${secondaryPhotosMerged} secondary angle photos preserved, ${errors.length} compliance/link notices.`);
  return { inserted, updated, secondary_photos_merged: secondaryPhotosMerged, total_rows: parsed.length, errors };
}

function generateShopifyCsv(items, settings, baseUrl) {
  items = ensureDeduplicatedItems(items);
  const headers = [
    'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags', 'Published',
    'Option1 Name', 'Option1 Value', 'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker',
    'Variant Inventory Qty', 'Variant Inventory Policy', 'Variant Fulfillment Service',
    'Variant Price', 'Variant Requires Shipping', 'Variant Taxable', 'Image Src', 'Image Position', 'Image Alt Text',
    'SEO Title', 'SEO Description',
    'Google Shopping / Google Product Category',
    'Google Shopping / MPN',
    'Google Shopping / Condition',
    'Google Shopping / Age Group',
    'Google Shopping / Gender',
    'Google Shopping / Custom Label 0',
    'Google Shopping / Custom Label 1',
    'Metafield: custom.oem_part_number [single_line_text_field]',
    'Metafield: custom.donor_vin [single_line_text_field]',
    'Metafield: custom.condition [single_line_text_field]',
    'Metafield: custom.bin_location [single_line_text_field]',
    'Metafield: custom.packed_dimensions [single_line_text_field]',
    'Metafield: custom.country_of_origin [single_line_text_field]',
    'Metafield: custom.color [single_line_text_field]',
    'Metafield: custom.material [single_line_text_field]',
    'Metafield: custom.manufacturer_type [single_line_text_field]',
    'Metafield: custom.finish [single_line_text_field]',
    'Metafield: custom.ebay_us_category_id [single_line_text_field]',
    'Metafield: custom.shopify_taxonomy_id [single_line_text_field]',
    'Status'
  ];

  const imgSrcIdx = headers.indexOf('Image Src');
  const imgPosIdx = headers.indexOf('Image Position');
  const imgAltIdx = headers.indexOf('Image Alt Text');

  const rows = [headers.join(',')];
  for (const item of items) {
    if (!isMarketplaceSafeItem(item)) continue;
    const title80 = cleanListingTitle(item.title || '').slice(0, 80);
    const dims = resolveExportDims(item);
    const tax = resolvePartTaxonomyAndMetafields({ ...item, title: title80, weight_lbs: dims.weight_lbs }, settings);
    const handle = item.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const photos = getValidPhotos(item);
    const resolvePhoto = (p) => resolveExportPhotoUrl(p, baseUrl, settings);
    const imgUrl = photos[0] ? resolvePhoto(photos[0]) : '';
    const condOut = normalizeExportCondition(item.condition);
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);

    const htmlBody = renderShopifyHtml({ ...item, title: title80 }, settings);
    const grams = Math.round(Number(dims.weight_lbs) * 453.592);
    const dimsLabel = `${dims.length_in}x${dims.width_in}x${dims.height_in} in (${dims.weight_lbs} lbs)`;
    const tags = [...tax.seoTags, `Dims:${dims.length_in}x${dims.width_in}x${dims.height_in}`].join(', ');
    const donorVin = String(item.verified_vin || '').trim().toUpperCase();

    rows.push([
      handle,
      title80,
      htmlBody,
      tax.brand || item.fitment_make || 'OEM',
      tax.shopifyProductCategory,
      tax.partType,
      tags,
      'true',
      'Title',
      'Default Title',
      item.sku,
      grams,
      'shopify',
      1,
      'deny',
      'manual',
      Number(item.price_we_pull || 0).toFixed(2),
      heavyPickupOnly ? 'false' : 'true',
      'true',
      imgUrl,
      imgUrl ? '1' : '',
      imgUrl ? buildExpectedShopifyImageAlt({ ...item, title: title80 }) : '',
      tax.seoTitle,
      tax.seoDescription,
      tax.googleProductCategory,
      tax.mpn,
      tax.condition,
      'adult',
      'unisex',
      tax.customLabel0,
      tax.customLabel1,
      tax.mpn,
      donorVin,
      condOut,
      item.bin_location || '',
      dimsLabel,
      tax.countryCodeOfOrigin,
      tax.attributes.color,
      tax.attributes.material,
      tax.attributes.manufacturer_type,
      tax.attributes.finish,
      tax.ebayUsCategoryId,
      tax.shopifyTaxonomyId,
      'active'
    ].map(csvEscape).join(','));

    // Secondary real part photos ONLY (NEVER *.qr.png!)
    photos.slice(1).forEach((secPhoto, secIdx) => {
      const secRow = new Array(headers.length).fill('');
      secRow[0] = handle;
      secRow[imgSrcIdx] = resolvePhoto(secPhoto);
      secRow[imgPosIdx] = String(secIdx + 2);
      secRow[imgAltIdx] = buildExpectedShopifyImageAlt({ ...item, title: title80 });
      rows.push(secRow.map(csvEscape).join(','));
    });
  }
  return rows.join('\n') + '\n';
}

// STRICT STANDARD EBAY US (ebay.com, SiteID=US) ONLY
function generateEbayMotorsCsv(items, settings, baseUrl, { freightOnly = false } = {}) {
  items = ensureDeduplicatedItems(items);
  const headers = [
    '*Action(SiteID=US|Country=US|Currency=USD|Version=1193)',
    'CustomLabel',
    '*Category',
    '*Title',
    '*ConditionID',
    'ConditionDescription',
    '*C:Brand',
    '*C:Manufacturer Part Number',
    'C:OE/OEM Part Number',
    'C:Interchange Part Number',
    'C:Placement on Vehicle',
    'C:Country/Region of Manufacture',
    'PicURL',
    '*Description',
    '*Format',
    '*Duration',
    '*StartPrice',
    '*Quantity',
    '*Location',
    '*DispatchTimeMax',
    'ShippingType',
    'ShippingService-1:Option',
    'PackagingHandlingCosts',
    'ShippingService-2:Option',
    'ShippingService-2:Cost',
    '*ReturnsAcceptedOption',
    'WeightMajor',
    'PackageLength',
    'PackageWidth',
    'PackageDepth'
  ];

  const rows = [headers.join(',')];
  for (const item of items) {
    if (!isMarketplaceSafeItem(item)) continue;
    const dims = resolveExportDims(item);
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
    if (freightOnly && !heavyPickupOnly) continue;
    const ebayTitle = cleanListingTitle(item.title || '').slice(0, 80);
    const tax = resolvePartTaxonomyAndMetafields({ ...item, title: ebayTitle, weight_lbs: dims.weight_lbs }, settings);
    const photos = getValidPhotos(item);
    const picUrl = photos.map((p) => resolveExportPhotoUrl(p, baseUrl, settings)).join('|');
    const condOut = normalizeExportCondition(item.condition);
    const condDesc = buildCleanInspectionSummary(item).slice(0, 280);

    rows.push([
      'Add',
      item.sku,
      tax.ebayUsCategoryId,
      ebayTitle,
      condOut === 'New' ? 1000 : 3000,
      condDesc,
      tax.brand,
      tax.mpn,
      tax.mpn,
      [sanitizeMpnField(item.interchange_number), item.hollander_number].filter(Boolean).join(', '),
      item.placement_on_vehicle || 'Vehicle Specific',
      tax.countryCodeOfOrigin,
      picUrl,
      renderEbayHtml({ ...item, title: ebayTitle }, settings),
      'FixedPrice',
      'GTC',
      Number(item.price_we_pull || 0).toFixed(2),
      1,
      '98467',
      settings.handling_days_default || 3,
      heavyPickupOnly ? (freightOnly ? 'FreightFlat' : 'Flat') : 'Calculated',
      heavyPickupOnly ? 'US_Pickup' : 'UPSGround',
      heavyPickupOnly ? '0.00' : Number(settings.handling_fee_default || 10).toFixed(2),
      'US_Pickup',
      '0.00',
      'ReturnsNotAccepted',
      Math.ceil(dims.weight_lbs),
      Math.ceil(dims.length_in),
      Math.ceil(dims.width_in),
      Math.ceil(dims.height_in)
    ].map(csvEscape).join(','));
  }
  return rows.join('\n') + '\n';
}

function generateEbayFreightCsv(items, settings, baseUrl) {
  return generateEbayMotorsCsv(items, settings, baseUrl, { freightOnly: true });
}

function generateGoogleMerchantXml(items, settings, baseUrl) {
  items = ensureDeduplicatedItems(items);
  const activeItems = items.filter(isMarketplaceSafeItem);
  const { pwaUrl } = resolveDirectPublicUrls(settings, baseUrl);
  const itemNodes = activeItems.map((item) => {
    const title80 = cleanListingTitle(item.title || '').slice(0, 80);
    const dims = resolveExportDims(item);
    const tax = resolvePartTaxonomyAndMetafields({ ...item, title: title80, weight_lbs: dims.weight_lbs }, settings);
    const photos = getValidPhotos(item);
    const imgUrl = resolveExportPhotoUrl(photos[0], baseUrl, settings);
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
    const cleanDesc = buildCleanPlainListingDesc({ ...item, title: title80 }, settings);
    return `    <item>
      <g:id>${xmlEscape(item.sku)}</g:id>
      <g:title>${xmlEscape(title80)}</g:title>
      <g:description>${xmlEscape(cleanDesc)}</g:description>
      <g:link>${xmlEscape(`${pwaUrl}/?sku=${encodeURIComponent(item.sku)}`)}</g:link>
      <g:image_link>${xmlEscape(imgUrl)}</g:image_link>
      <g:condition>${xmlEscape(tax.condition)}</g:condition>
      <g:age_group>adult</g:age_group>
      <g:gender>unisex</g:gender>
      <g:availability>in_stock</g:availability>
      <g:price>${Number(item.price_we_pull || 0).toFixed(2)} USD</g:price>
      <g:brand>${xmlEscape(tax.brand)}</g:brand>
      <g:mpn>${xmlEscape(tax.mpn)}</g:mpn>
      <g:identifier_exists>yes</g:identifier_exists>
      <g:google_product_category>${xmlEscape(tax.googleProductCategory)}</g:google_product_category>
      <g:color>${xmlEscape(tax.attributes.color)}</g:color>
      <g:material>${xmlEscape(tax.attributes.material)}</g:material>
      <g:custom_label_0>${xmlEscape(tax.customLabel0)}</g:custom_label_0>
      <g:custom_label_1>${xmlEscape(tax.customLabel1)}</g:custom_label_1>
      <g:shipping_weight>${Number(dims.weight_lbs).toFixed(1)} lb</g:shipping_weight>
      <g:shipping_length>${Math.ceil(dims.length_in)} in</g:shipping_length>
      <g:shipping_width>${Math.ceil(dims.width_in)} in</g:shipping_width>
      <g:shipping_height>${Math.ceil(dims.height_in)} in</g:shipping_height>
      <g:shipping_label>${xmlEscape(heavyPickupOnly ? 'local_pickup_only' : 'calculated_parcel')}</g:shipping_label>
      <g:min_handling_time>2</g:min_handling_time>
      <g:max_handling_time>${Number(settings.handling_days_default || 3)}</g:max_handling_time>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${xmlEscape(settings.business_name)} — OEM Auto Parts Catalog Feed</title>
    <link>${xmlEscape(pwaUrl)}</link>
    <description>Verified OEM Auto Parts Catalog</description>
${itemNodes}
  </channel>
</rss>`;
}

function generateMetaCatalogCsv(items, settings, baseUrl) {
  items = ensureDeduplicatedItems(items);
  const headers = [
    'id', 'title', 'description', 'availability', 'condition', 'price',
    'link', 'image_link', 'brand', 'mpn', 'quantity_to_sell_on_facebook',
    'age_group', 'gender', 'color', 'material', 'google_product_category'
  ];
  const { pwaUrl } = resolveDirectPublicUrls(settings, baseUrl);
  const rows = [headers.join(',')];
  for (const item of items) {
    if (!isMarketplaceSafeItem(item)) continue;
    const photos = getValidPhotos(item);
    if (!photos.length) continue;
    const title80 = cleanListingTitle(item.title || '').slice(0, 80);
    const dims = resolveExportDims(item);
    const tax = resolvePartTaxonomyAndMetafields({ ...item, title: title80, weight_lbs: dims.weight_lbs }, settings);
    const imgUrl = resolveExportPhotoUrl(photos[0], baseUrl, settings);
    const condOut = normalizeExportCondition(item.condition);
    const cond = condOut === 'New' ? 'new' : 'used';
    const cleanDesc = buildCleanPlainListingDesc({ ...item, title: title80 }, settings);
    rows.push([
      item.sku,
      title80,
      cleanDesc,
      'in stock',
      cond,
      `${Number(item.price_we_pull || 0).toFixed(2)} USD`,
      `${pwaUrl}/?sku=${encodeURIComponent(item.sku)}`,
      imgUrl,
      tax.brand || item.brand || 'OEM',
      tax.mpn,
      1,
      'adult',
      'unisex',
      tax.attributes.color,
      tax.attributes.material,
      tax.googleProductCategory || 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts'
    ].map(csvEscape).join(','));
  }
  return rows.join('\n') + '\n';
}

function generateVendooOrCrosslistCsv(items, settings, baseUrl, mode = 'vendoo') {
  items = ensureDeduplicatedItems(items);
  const handlingFee = Number(settings.handling_fee_default || 10);
  const headers = mode === 'crosslist'
    ? ['SKU', 'Title', 'Description', 'Brand', 'MPN', 'Condition', 'Price', 'Quantity', 'Year', 'Make', 'Model', 'Donor_VIN', 'Origin_Country', 'eBay_US_Category_ID', 'Weight (lbs)', 'Length', 'Width', 'Height', 'Shipping_Policy', 'Zip Code', 'Image 1', 'Additional_Images', 'Bin_Location']
    : ['SKU', 'Title', 'Description', 'Brand', 'MPN', 'Condition', 'Price', 'Cost of Goods', 'Quantity', 'Weight_lb', 'Length', 'Width', 'Height', 'Shipping_Type', 'Handling_Fee_USD', 'Origin_Country', 'Primary_Image', 'Additional_Images', 'Storage_Bin_Notes'];

  const rows = [headers.join(',')];
  for (const item of items) {
    if (!isMarketplaceSafeItem(item)) continue;
    const title80 = cleanListingTitle(item.title || '').slice(0, 80);
    const dims = resolveExportDims(item);
    const tax = resolvePartTaxonomyAndMetafields({ ...item, title: title80, weight_lbs: dims.weight_lbs }, settings);
    const photos = getValidPhotos(item);
    const resolvePhoto = (p) => resolveExportPhotoUrl(p, baseUrl, settings);
    const imgUrl = photos[0] ? resolvePhoto(photos[0]) : '';
    const extraImgs = photos.slice(1).map(resolvePhoto).join('|');
    const condOut = normalizeExportCondition(item.condition);
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
    const shippingPolicy = heavyPickupOnly ? 'Local_Pickup_Only' : 'Calculated_Parcel';
    const basePrice = Number(item.price_we_pull || 0).toFixed(2);
    const cleanDesc = buildCleanPlainListingDesc({ ...item, title: title80 }, settings);
    const donorVin = String(item.verified_vin || '').trim().toUpperCase();

    if (mode === 'crosslist') {
      rows.push([
        item.sku, title80, cleanDesc, tax.brand || item.brand || 'OEM', tax.mpn, condOut,
        basePrice, 1, item.fitment_years || '', item.fitment_make || '', item.fitment_model || '',
        donorVin, tax.countryCodeOfOrigin,
        tax.ebayUsCategoryId, dims.weight_lbs, dims.length_in, dims.width_in, dims.height_in,
        shippingPolicy, settings.zip || '98467', imgUrl, extraImgs,
        item.bin_location || ''
      ].map(csvEscape).join(','));
    } else {
      rows.push([
        item.sku, title80, cleanDesc, tax.brand || item.brand || 'OEM', tax.mpn, condOut,
        basePrice, Number(item.cost_basis || 0).toFixed(2), 1,
        dims.weight_lbs, dims.length_in, dims.width_in, dims.height_in,
        shippingPolicy,
        heavyPickupOnly ? '0.00' : handlingFee.toFixed(2),
        tax.countryCodeOfOrigin,
        imgUrl,
        extraImgs,
        `Bin: ${item.bin_location || ''} | VIN: ${donorVin}`
      ].map(csvEscape).join(','));
    }
  }
  return rows.join('\n') + '\n';
}

function generateCraigslistCsv(items, settings, baseUrl) {
  items = ensureDeduplicatedItems(items);
  const headers = [
    'SKU', 'Posting_Title', 'Price_USD', 'Category', 'Area_Subarea', 'Postal_Code',
    'Condition', 'Make_Model', 'OEM_Part_Number', 'Shipping_Or_Pickup',
    'Turnkey_Bay_Install_Price_98467', 'Posting_Body', 'Primary_Image_URL',
    'Additional_Image_URLs', 'Direct_Storefront_URL'
  ];
  const { pwaUrl } = resolveDirectPublicUrls(settings, baseUrl);
  const rows = [headers.join(',')];
  for (const item of items) {
    if (!isMarketplaceSafeItem(item)) continue;
    const photos = getValidPhotos(item);
    const resolvePhoto = (p) => resolveExportPhotoUrl(p, baseUrl, settings);
    const primaryImg = photos[0] ? resolvePhoto(photos[0]) : '';
    const extraImgs = photos.slice(1).map(resolvePhoto).join('|');
    const mpnOut = resolveExportMpn(item.oem_part_number);
    const condOut = normalizeExportCondition(item.condition);
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
    const { installTotal } = computeInstallEstimate(item, settings);
    const ymm = [item.fitment_years, item.fitment_make, item.fitment_model].filter(Boolean).join(' ').trim() || 'OEM Auto Part';
    const postTitle = `${cleanListingTitle(item.title)} — ${heavyPickupOnly ? 'University Place 98467 Pickup' : '98467 Pickup or Ship'}`.slice(0, 70);
    const body = renderLocalMarketplacePacket(item, settings, baseUrl);

    rows.push([
      item.sku,
      postTitle,
      Math.round(Number(item.price_we_pull || 0)),
      'auto parts - by owner (pts)',
      'seattle.craigslist.org > tac (Tacoma / Pierce County)',
      settings.zip || '98467',
      condOut === 'New' ? 'new' : 'good',
      ymm,
      mpnOut,
      heavyPickupOnly ? 'Local Pickup Only — 5115 66th St W, Bldg B, University Place, WA 98467' : 'Free Counter Pickup 98467 or Calculated Parcel Shipping',
      installTotal.toFixed(2),
      body,
      primaryImg,
      extraImgs,
      `${pwaUrl}/?sku=${encodeURIComponent(item.sku)}`
    ].map(csvEscape).join(','));
  }
  return rows.join('\n') + '\n';
}

function generateTiktokShopCsv(items, settings, baseUrl) {
  items = ensureDeduplicatedItems(items);
  const headers = [
    'seller_sku', 'product_name', 'category', 'brand', 'mpn', 'condition', 'product_description',
    'price', 'quantity', 'package_weight_lb', 'package_length_in', 'package_width_in', 'package_height_in', 'main_image_url'
  ];
  const rows = [headers.join(',')];
  for (const item of items) {
    if (!isMarketplaceSafeItem(item) || isHeavyLocalPickupItem(item, settings)) continue;
    const photos = getValidPhotos(item);
    const imgUrl = photos[0] ? resolveExportPhotoUrl(photos[0], baseUrl, settings) : '';
    const pricePlusHandling = (Number(item.price_we_pull || 0) + Number(settings.handling_fee_default || 10)).toFixed(2);
    const { installTotal, hours, rate } = computeInstallEstimate(item, settings);
    const desc = `${stripOffEbayContactText(item.description || item.title)} | Single-unit OEM part (1 in stock). Optional Certified Shop Bay Installation in University Place, WA 98467: $${installTotal.toFixed(2)} installed (~${hours.toFixed(1)} hrs @ $${rate.toFixed(2)}/hr). Security ID: ${item.security_mark_code}.`;
    rows.push([
      item.sku, item.title, 'Automotive & Motorcycle > Auto Replacement Parts', item.brand || 'OEM',
      resolveExportMpn(item.oem_part_number), normalizeExportCondition(item.condition),
      desc, pricePlusHandling, 1,
      item.weight_lbs, item.length_in, item.width_in, item.height_in, imgUrl
    ].map(csvEscape).join(','));
  }
  return rows.join('\n') + '\n';
}

function generateCarPartHollanderCsv(items) {
  items = ensureDeduplicatedItems(items);
  const headers = [
    'StockNumber', 'InventorySKU', 'HollanderInterchange', 'OEMPartNumber',
    'YearRange', 'Make', 'Model', 'PartCategory', 'ConditionGrade',
    'SingleUnitPartPrice', 'InfoOnlyInstalledPrice', 'LocationBin', 'SecurityMark', 'Qty'
  ];
  const rows = [headers.join(',')];
  for (const item of items) {
    if (!isMarketplaceSafeItem(item)) continue;
    let donorStock = 'SHOP-STOCK';
    if (item.donor_vehicle_id) {
      const dv = db.prepare('SELECT stock_number FROM donor_vehicles WHERE id = ?').get(item.donor_vehicle_id);
      if (dv) donorStock = dv.stock_number;
    }
    const { installTotal } = computeInstallEstimate(item, getSettings());
    rows.push([
      donorStock, item.sku, item.hollander_number || sanitizeMpnField(item.interchange_number),
      resolveExportMpn(item.oem_part_number), item.fitment_years || '', item.fitment_make || '',
      item.fitment_model || '', item.category, 'Used',
      Number(item.price_we_pull || 0).toFixed(2),
      installTotal.toFixed(2),
      item.bin_location || '', item.security_mark_code, 1
    ].map(csvEscape).join(','));
  }
  return rows.join('\n') + '\n';
}

const _shopifyOAuthCache = {
  cacheKey: '',
  accessToken: '',
  scope: '',
  expiresAt: 0
};

/**
 * Resolves a live Shopify Admin API access token.
 * - If SHOPIFY_ADMIN_TOKEN starts with `shpss_` and SHOPIFY_CLIENT_ID is set,
 *   exchanges `grant_type=client_credentials` at `https://${shopDomain}/admin/oauth/access_token`
 *   and caches the fresh 24h access_token in memory.
 * - Otherwise returns the configured static Admin API token (`shpat_...`).
 */
async function resolveShopifyAccessToken(settingsOverride = null, { forceRefresh = false } = {}) {
  const cfg = settingsOverride || getSettings();
  const shopDomain = (
    cfg.shopify_domain ||
    process.env.SHOPIFY_SHOP_DOMAIN ||
    process.env.SHOPIFY_DOMAIN ||
    'aldridgesales.myshopify.com'
  )
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

  const rawToken = String(
    cfg.shopify_admin_token ||
    process.env.SHOPIFY_ADMIN_TOKEN ||
    process.env.SHOPIFY_CLIENT_SECRET ||
    ''
  ).trim();
  const clientId = String(cfg.shopify_client_id || process.env.SHOPIFY_CLIENT_ID || '').trim();

  if (!rawToken) {
    return { token: '', shopDomain, authMode: 'none' };
  }

  if (rawToken.startsWith('shpss_') && clientId) {
    const cacheKey = `${shopDomain}|${clientId}|${rawToken.slice(0, 14)}`;
    if (!forceRefresh && _shopifyOAuthCache.cacheKey === cacheKey && _shopifyOAuthCache.accessToken && Date.now() < _shopifyOAuthCache.expiresAt - 60_000) {
      return {
        token: _shopifyOAuthCache.accessToken,
        shopDomain,
        authMode: 'client_credentials',
        cached: true,
        scope: _shopifyOAuthCache.scope
      };
    }

    const tokenEndpoint = `https://${shopDomain}/admin/oauth/access_token`;
    const bodyParams = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: rawToken
    });

    const resp = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: bodyParams.toString(),
      signal: AbortSignal.timeout(12000)
    });

    const rawText = await resp.text().catch(() => '');
    let data = {};
    try {
      data = JSON.parse(rawText || '{}');
    } catch (_) {
      data = {};
    }

    if (!resp.ok || !data.access_token) {
      const msg = `Shopify client_credentials OAuth exchange failed at ${tokenEndpoint} (HTTP ${resp.status}): ${data.error_description || data.error || rawText.slice(0, 180)}`;
      logSync('outbound', 'shopify_oauth', 'client_credentials_error', 'AUTH', 'error', msg);
      throw new Error(msg);
    }

    const ttlSec = Math.max(300, Number(data.expires_in) || 86399);
    _shopifyOAuthCache.cacheKey = cacheKey;
    _shopifyOAuthCache.accessToken = String(data.access_token).trim();
    _shopifyOAuthCache.scope = String(data.scope || '');
    _shopifyOAuthCache.expiresAt = Date.now() + ttlSec * 1000;

    logSync(
      'outbound',
      'shopify_oauth',
      'client_credentials_exchange',
      'AUTH',
      'success',
      `Exchanged shpss_ client_credentials for fresh Shopify access_token on ${shopDomain} (ttl=${ttlSec}s${data.scope ? `, scope=${data.scope}` : ''}).`
    );

    return {
      token: _shopifyOAuthCache.accessToken,
      shopDomain,
      authMode: 'client_credentials',
      cached: false,
      scope: _shopifyOAuthCache.scope,
      expires_in: ttlSec
    };
  }

  return {
    token: rawToken,
    shopDomain,
    authMode: rawToken.startsWith('shpss_') ? 'shpss_missing_client_id' : 'static_admin_token'
  };
}

function buildShopifyProductMetafields(item, settings, tax) {
  const dims = resolveExportDims(item);
  const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
  const dimsLabel = `${dims.length_in}x${dims.width_in}x${dims.height_in} in (${dims.weight_lbs} lbs)`;
  const donorVehicle = [item.fitment_years, item.fitment_make, item.fitment_model].filter(Boolean).join(' ').trim() || tax.customLabel0;
  const donorVin = String(item.verified_vin || '').trim().toUpperCase();
  const condLabel = normalizeExportCondition(item.condition) === 'New' ? 'New OEM' : 'Used OEM';
  const fulfillmentLabel = heavyPickupOnly ? 'Local_Pickup_Only' : 'Calculated_Parcel';
  const attrs = tax.attributes || { color: 'Black', material: 'OEM Composite', condition: 'Used', manufacturer_type: 'OEM', finish: 'Factory OEM' };

  const raw = [
    // Google & YouTube / Shopping Channel Metafields
    { namespace: 'mm-google-shopping', key: 'google_product_category', value: tax.googleProductCategory, type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'condition', value: tax.condition, type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'age_group', value: 'adult', type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'gender', value: 'unisex', type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'mpn', value: tax.mpn, type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'custom_label_0', value: tax.customLabel0, type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'custom_label_1', value: tax.customLabel1, type: 'single_line_text_field' },
    // Product & Warehouse Metafields
    { namespace: 'custom', key: 'bin_location', value: String(item.bin_location || '').trim(), type: 'single_line_text_field' },
    { namespace: 'custom', key: 'donor_vin', value: donorVin, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'packed_dimensions', value: dimsLabel, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'package_dimensions', value: dimsLabel, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'oem_mpn', value: tax.mpn, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'oem_part_number', value: tax.mpn, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'donor_vehicle', value: donorVehicle, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'fitment_years', value: String(item.fitment_years || '').trim(), type: 'single_line_text_field' },
    { namespace: 'custom', key: 'part_condition', value: condLabel, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'fulfillment_type', value: fulfillmentLabel, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'country_of_origin', value: tax.countryCodeOfOrigin || 'US', type: 'single_line_text_field' },
    { namespace: 'custom', key: 'ebay_us_category_id', value: tax.ebayUsCategoryId, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'shopify_taxonomy_id', value: tax.shopifyTaxonomyId, type: 'single_line_text_field' },
    // Category Attributes (Color, Material, Condition, Manufacturer Type = OEM, Finish)
    { namespace: 'custom', key: 'color', value: attrs.color, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'material', value: attrs.material, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'condition', value: attrs.condition, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'manufacturer_type', value: attrs.manufacturer_type || 'OEM', type: 'single_line_text_field' },
    { namespace: 'custom', key: 'finish', value: attrs.finish, type: 'single_line_text_field' }
  ];

  return raw.filter((m) => String(m.value || '').trim().length > 0);
}

function buildShopifyVariantMetafields(item, tax) {
  const dims = resolveExportDims(item);
  const dimsLabel = `${dims.length_in}x${dims.width_in}x${dims.height_in} in (${dims.weight_lbs} lbs)`;
  const donorVin = String(item.verified_vin || '').trim().toUpperCase();
  const raw = [
    { namespace: 'custom', key: 'bin_location', value: String(item.bin_location || '').trim(), type: 'single_line_text_field' },
    { namespace: 'custom', key: 'donor_vin', value: donorVin, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'packed_dimensions', value: dimsLabel, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'oem_mpn', value: tax.mpn, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'country_of_origin', value: tax.countryCodeOfOrigin || 'US', type: 'single_line_text_field' }
  ];
  return raw.filter((m) => String(m.value || '').trim().length > 0);
}

const _shopifyTaxonomyGidCache = new Map();

async function resolveLiveShopifyTaxonomyGid({ domain, tokenRef, authMode, settings, tax }) {
  const fallback = tax?.shopifyTaxonomyId || 'gid://shopify/TaxonomyCategory/vp-1-4';
  const searchTerm = String(tax?.shopifyTaxonomySearch || tax?.partType || '').trim();
  const cacheKey = `${domain}|${fallback}|${searchTerm.toLowerCase()}`;
  if (searchTerm && _shopifyTaxonomyGidCache.has(cacheKey)) {
    return _shopifyTaxonomyGidCache.get(cacheKey);
  }
  if (searchTerm) {
    try {
      const resp = await shopifyFetchWithRetry(
        `https://${domain}/admin/api/2025-01/graphql.json`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            query: `query LookupTax($q: String!) {
              taxonomy {
                categories(search: $q, first: 10) {
                  nodes { id name fullName }
                }
              }
            }`,
            variables: { q: searchTerm }
          })
        },
        { authMode, settings, tokenRef }
      );
      if (resp.ok) {
        const data = await resp.json();
        const nodes = (data?.data?.taxonomy?.categories?.nodes || []).filter((n) =>
          String(n.id || '').startsWith('gid://shopify/TaxonomyCategory/vp-1-4')
        );
        const vehicleNode =
          nodes.find((n) => String(n.name || '').toLowerCase() === searchTerm.toLowerCase()) ||
          nodes.find((n) => String(n.id || '').startsWith(fallback)) ||
          null;
        if (vehicleNode?.id) {
          _shopifyTaxonomyGidCache.set(cacheKey, vehicleNode.id);
          return vehicleNode.id;
        }
      }
    } catch (_) {}
  }
  if (searchTerm) _shopifyTaxonomyGidCache.set(cacheKey, fallback);
  return fallback;
}

async function fetchAllShopifyPublications({ domain, tokenRef, authMode, settings }) {
  try {
    const resp = await shopifyFetchWithRetry(
      `https://${domain}/admin/api/2025-01/graphql.json`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query: `query GetPublications {
            publications(first: 25) {
              nodes { id name }
            }
          }`
        })
      },
      { authMode, settings, tokenRef }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data?.data?.publications?.nodes || []).filter((n) => n && n.id);
  } catch (_) {
    return [];
  }
}

async function publishResourceToAllChannels({ domain, tokenRef, authMode, settings, resourceGid, publications = [] }) {
  if (!resourceGid || !publications.length) return { published: 0 };
  try {
    const resp = await shopifyFetchWithRetry(
      `https://${domain}/admin/api/2025-01/graphql.json`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query: `mutation PublishAll($id: ID!, $input: [PublicationInput!]!) {
            publishablePublish(id: $id, input: $input) {
              userErrors { field message }
            }
          }`,
          variables: {
            id: resourceGid,
            input: publications.map((p) => ({ publicationId: p.id }))
          }
        })
      },
      { authMode, settings, tokenRef }
    );
    if (!resp.ok) return { published: 0, warning: `publish HTTP ${resp.status}` };
    const data = await resp.json();
    const uerrs = data?.data?.publishablePublish?.userErrors || [];
    return { published: publications.length, warning: uerrs.length ? JSON.stringify(uerrs).slice(0, 140) : '' };
  } catch (err) {
    return { published: 0, warning: err.message };
  }
}

async function shopifyFetchWithRetry(url, options, { authMode, settings, tokenRef }) {
  let resp = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Shopify-Access-Token': tokenRef.token
    },
    signal: AbortSignal.timeout(15000)
  });

  if (resp.status === 429) {
    const retryAfterSec = parseFloat(resp.headers.get('retry-after') || '2') || 2;
    await new Promise((r) => setTimeout(r, Math.ceil(retryAfterSec * 1000) + 300));
    resp = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'X-Shopify-Access-Token': tokenRef.token
      },
      signal: AbortSignal.timeout(15000)
    });
  } else if (resp.status === 401 && authMode === 'client_credentials') {
    const refreshed = await resolveShopifyAccessToken(settings, { forceRefresh: true });
    tokenRef.token = refreshed.token;
    resp = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'X-Shopify-Access-Token': tokenRef.token
      },
      signal: AbortSignal.timeout(15000)
    });
  }
  return resp;
}

async function syncShopifyProductGraphqlAndOrigin({
  domain,
  tokenRef,
  authMode,
  settings,
  productId,
  variantId = '',
  inventoryItemId,
  item,
  tax,
  publications = []
}) {
  const countryCode = resolveCountryOfOrigin(item);
  const resolvedTaxGid = await resolveLiveShopifyTaxonomyGid({ domain, tokenRef, authMode, settings, tax });
  const results = {
    country_code_of_origin: countryCode,
    origin_updated: false,
    category_updated: false,
    seo_updated: false,
    category_gid: resolvedTaxGid,
    metafields_count: 0,
    variant_metafields_count: 0,
    channels_published: 0,
    warnings: []
  };

  // 1. Set Country of Origin (strictly decoded from Donor VIN WMI) on Shopify InventoryItem (REST)
  if (inventoryItemId) {
    try {
      const invResp = await shopifyFetchWithRetry(
        `https://${domain}/admin/api/2025-01/inventory_items/${inventoryItemId}.json`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            inventory_item: {
              id: Number(inventoryItemId),
              country_code_of_origin: countryCode,
              tracked: true
            }
          })
        },
        { authMode, settings, tokenRef }
      );
      if (invResp.ok) {
        results.origin_updated = true;
      } else {
        const txt = await invResp.text().catch(() => '');
        results.warnings.push(`origin HTTP ${invResp.status}: ${txt.slice(0, 120)}`);
      }
    } catch (err) {
      results.warnings.push(`origin err: ${err.message}`);
    }
  }

  // 2. Assign Shopify Standard Product Taxonomy Category + High-Intent SEO Title (<=70) & Meta Description (<=155) via GraphQL
  const graphqlUrl = `https://${domain}/admin/api/2025-01/graphql.json`;
  const productGid = `gid://shopify/Product/${productId}`;
  const seoPayload = {
    title: String(tax.seoTitle || cleanListingTitle(item.title || '')).slice(0, 70),
    description: String(tax.seoDescription || '').slice(0, 155)
  };

  const runCategoryAndSeoMutation = async (catGid) => {
    const resp = await shopifyFetchWithRetry(
      graphqlUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query: `mutation SetCategoryAndSeo($product: ProductUpdateInput!) {
            productUpdate(product: $product) {
              product { id category { id fullName } seo { title description } }
              userErrors { field message }
            }
          }`,
          variables: { product: { id: productGid, category: catGid, seo: seoPayload } }
        })
      },
      { authMode, settings, tokenRef }
    );
    if (!resp.ok) return { ok: false, err: `HTTP ${resp.status}` };
    const data = await resp.json();
    const uerrs = data?.data?.productUpdate?.userErrors || [];
    if (data.errors?.length || uerrs.length) {
      return { ok: false, err: JSON.stringify(data.errors || uerrs).slice(0, 160) };
    }
    return { ok: true, category: data?.data?.productUpdate?.product?.category || null };
  };

  try {
    let catRes = await runCategoryAndSeoMutation(resolvedTaxGid);
    if (!catRes.ok && resolvedTaxGid !== tax.shopifyTaxonomyId) {
      catRes = await runCategoryAndSeoMutation(tax.shopifyTaxonomyId);
      if (catRes.ok) results.category_gid = tax.shopifyTaxonomyId;
    }
    if (!catRes.ok && tax.shopifyTaxonomyId !== 'gid://shopify/TaxonomyCategory/vp-1-4') {
      catRes = await runCategoryAndSeoMutation('gid://shopify/TaxonomyCategory/vp-1-4');
      if (catRes.ok) results.category_gid = 'gid://shopify/TaxonomyCategory/vp-1-4';
    }
    if (catRes.ok) {
      results.category_updated = true;
      results.seo_updated = true;
    } else {
      results.warnings.push(`category/seo: ${catRes.err}`);
    }
  } catch (err) {
    results.warnings.push(`category/seo err: ${err.message}`);
  }

  // 3. Write ALL Product, Category & Variant Metafields in <=25-entry batches via GraphQL metafieldsSet
  const productMfList = buildShopifyProductMetafields(item, settings, { ...tax, shopifyTaxonomyId: results.category_gid }).map((m) => ({
    ownerId: productGid,
    namespace: m.namespace,
    key: m.key,
    type: m.type,
    value: String(m.value)
  }));
  const variantMfList = variantId
    ? buildShopifyVariantMetafields(item, tax).map((m) => ({
        ownerId: `gid://shopify/ProductVariant/${variantId}`,
        namespace: m.namespace,
        key: m.key,
        type: m.type,
        value: String(m.value)
      }))
    : [];

  const allMfChunks = [];
  const combinedMf = [...productMfList, ...variantMfList];
  for (let i = 0; i < combinedMf.length; i += 25) {
    allMfChunks.push(combinedMf.slice(i, i + 25));
  }

  for (const chunk of allMfChunks) {
    try {
      const mfResp = await shopifyFetchWithRetry(
        graphqlUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            query: `mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $metafields) {
                metafields { ownerType namespace key value }
                userErrors { field message code }
              }
            }`,
            variables: { metafields: chunk }
          })
        },
        { authMode, settings, tokenRef }
      );
      if (mfResp.ok) {
        const mfData = await mfResp.json();
        const uerrs = mfData?.data?.metafieldsSet?.userErrors || [];
        const savedMfs = mfData?.data?.metafieldsSet?.metafields || [];
        for (const sm of savedMfs) {
          if (String(sm.ownerType || '').toUpperCase().includes('VARIANT')) results.variant_metafields_count++;
          else results.metafields_count++;
        }
        if (mfData.errors?.length || uerrs.length) {
          results.warnings.push(`metafields: ${JSON.stringify(mfData.errors || uerrs).slice(0, 160)}`);
        }
      } else {
        results.warnings.push(`metafields HTTP ${mfResp.status}`);
      }
    } catch (err) {
      results.warnings.push(`metafields err: ${err.message}`);
    }
  }

  // 4. Publish active product to ALL available Shopify Sales Channels (Online Store, POS, Google & YouTube, Facebook & Instagram, Shop)
  if (publications.length > 0) {
    const pubRes = await publishResourceToAllChannels({
      domain,
      tokenRef,
      authMode,
      settings,
      resourceGid: productGid,
      publications
    });
    results.channels_published = pubRes.published || 0;
    if (pubRes.warning) results.warnings.push(`publish: ${pubRes.warning}`);
  }

  return results;
}

async function syncShopifyCollections({ domain, tokenRef, authMode, settings, collectionMap, publications = [] }) {
  const graphqlUrl = `https://${domain}/admin/api/2025-01/graphql.json`;
  const summary = { collections_checked: 0, collections_created: 0, products_assigned: 0, warnings: [] };
  if (!collectionMap || collectionMap.size === 0) return summary;

  // 1. Fetch existing Shopify custom/manual collections (first 250)
  const existingByTitle = new Map();
  try {
    let cursor = null;
    for (let page = 0; page < 4; page++) {
      const resp = await shopifyFetchWithRetry(
        graphqlUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            query: `query ListCollections($after: String) {
              collections(first: 100, after: $after) {
                pageInfo { hasNextPage endCursor }
                nodes { id title handle ruleSet { appliedDisjunctively } }
              }
            }`,
            variables: { after: cursor }
          })
        },
        { authMode, settings, tokenRef }
      );
      if (!resp.ok) break;
      const data = await resp.json();
      const nodes = data?.data?.collections?.nodes || [];
      for (const c of nodes) {
        if (c && c.title && !c.ruleSet) {
          existingByTitle.set(String(c.title).trim().toLowerCase(), c.id);
        }
      }
      if (!data?.data?.collections?.pageInfo?.hasNextPage) break;
      cursor = data.data.collections.pageInfo.endCursor;
    }
  } catch (err) {
    summary.warnings.push(`list collections: ${err.message}`);
  }

  // 2. Create missing Donor Vehicle & Part Category Collections + add products in chunks of 50
  for (const [colTitle, productGidSet] of collectionMap.entries()) {
    const cleanTitle = String(colTitle || '').trim();
    const productIds = Array.from(productGidSet || []);
    if (!cleanTitle || !productIds.length) continue;
    summary.collections_checked++;

    let colId = existingByTitle.get(cleanTitle.toLowerCase());
    if (!colId) {
      try {
        const createResp = await shopifyFetchWithRetry(
          graphqlUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              query: `mutation CreateCollection($input: CollectionInput!) {
                collectionCreate(input: $input) {
                  collection { id title handle }
                  userErrors { field message }
                }
              }`,
              variables: {
                input: {
                  title: cleanTitle,
                  descriptionHtml: `<p>Verified single-unit OEM auto parts in the <strong>${cleanTitle}</strong> collection.</p>`
                }
              }
            })
          },
          { authMode, settings, tokenRef }
        );
        if (createResp.ok) {
          const cData = await createResp.json();
          const newCol = cData?.data?.collectionCreate?.collection;
          if (newCol?.id) {
            colId = newCol.id;
            existingByTitle.set(cleanTitle.toLowerCase(), colId);
            summary.collections_created++;
            if (publications.length) {
              await publishResourceToAllChannels({ domain, tokenRef, authMode, settings, resourceGid: colId, publications });
            }
          } else {
            const uerrs = cData?.data?.collectionCreate?.userErrors || [];
            summary.warnings.push(`create "${cleanTitle}": ${JSON.stringify(uerrs).slice(0, 120)}`);
          }
        }
      } catch (err) {
        summary.warnings.push(`create "${cleanTitle}": ${err.message}`);
      }
    }

    if (!colId) continue;

    for (let i = 0; i < productIds.length; i += 50) {
      const batch = productIds.slice(i, i + 50);
      try {
        const addResp = await shopifyFetchWithRetry(
          graphqlUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              query: `mutation AddToCollection($id: ID!, $productIds: [ID!]!) {
                collectionAddProducts(id: $id, productIds: $productIds) {
                  collection { id }
                  userErrors { field message }
                }
              }`,
              variables: { id: colId, productIds: batch }
            })
          },
          { authMode, settings, tokenRef }
        );
        if (addResp.ok) {
          summary.products_assigned += batch.length;
        }
      } catch (err) {
        summary.warnings.push(`add "${cleanTitle}": ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  return summary;
}

async function syncAllToShopifyCoMaster({ updateExisting = false } = {}) {
  // 0. PERMANENT PRE-SYNC GHOST PURGE & DEDUPLICATION GATE
  const ghostPurgeSummary = purgeGhostAndBlockedInventory({ actor: 'shopify_sync_pre_gate' });
  let dedupeSummary = null;
  try {
    const { deduplicateCatalog } = require('./catalog-enrichment');
    dedupeSummary = deduplicateCatalog();
  } catch (_) {}

  const settings = getSettings();
  const allDbItems = db.prepare('SELECT * FROM inventory_items').all();
  const items = allDbItems.filter(isMarketplaceSafeItem);
  const activeAllowedSkusSet = new Set(items.map((r) => String(r.sku || '').trim().toUpperCase()).filter(Boolean));
  const blockedSkusSet = new Set([
    ...PROHIBITED_CAT_SKUS,
    ...PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS,
    ...PERMANENTLY_BANNED_SOLD_SKUS,
    ...allDbItems
      .filter((r) => r.status === 'compliance_blocked' || !validatePartCompliance({ title: r.title, category: r.category, description: r.description }).compliant)
      .map((r) => String(r.sku || '').trim().toUpperCase())
  ]);
  const ghostDeleteSkusSet = new Set(
    allDbItems
      .filter((r) => isGhostOrBannedInventoryItem(r).ghost_delete === true)
      .map((r) => String(r.sku || '').trim().toUpperCase())
      .filter(Boolean)
  );
  const duplicateArchivedSkusSet = new Set(
    allDbItems
      .filter((r) => r.status === 'duplicate_archived' || r.status === 'sold' || r.status === 'archived' || isGhostOrBannedInventoryItem(r).disposed_fleet === true)
      .map((r) => String(r.sku || '').trim().toUpperCase())
      .filter((s) => s && !blockedSkusSet.has(s) && !ghostDeleteSkusSet.has(s) && !activeAllowedSkusSet.has(s))
  );
  const pendingVerificationSkusSet = new Set(
    allDbItems
      .filter((r) => r.status === 'pending_verification' || (r.status === 'active' && !validateInventoryItemForPublish(r).valid))
      .map((r) => String(r.sku || '').trim().toUpperCase())
      .filter((s) => s && !blockedSkusSet.has(s) && !ghostDeleteSkusSet.has(s) && !duplicateArchivedSkusSet.has(s) && !activeAllowedSkusSet.has(s))
  );

  const auth = await resolveShopifyAccessToken(settings, { forceRefresh: Boolean(updateExisting) });
  if (!auth.shopDomain || !auth.token) {
    logSync(
      'outbound',
      'shopify_co_master',
      'staged_sync_ready',
      'ALL',
      'staged',
      `Staged ${items.length} single-variant photo-verified products for Shopify sync. Add SHOPIFY_SHOP_DOMAIN & SHOPIFY_ADMIN_TOKEN (or SHOPIFY_CLIENT_ID + shpss_ secret) in Render Environment or Settings Vault for live push/pull.`
    );
    return {
      mode: 'staged_ready',
      auth_mode: auth.authMode,
      synced_count: items.length,
      ghost_purge: ghostPurgeSummary,
      message: 'Shopify Single-Variant payload staged. Configure SHOPIFY_ADMIN_TOKEN (or SHOPIFY_CLIENT_ID + shpss_) to activate live API push.'
    };
  }
  if (auth.authMode === 'shpss_missing_client_id') {
    throw new Error('SHOPIFY_ADMIN_TOKEN starts with shpss_ (client secret) but SHOPIFY_CLIENT_ID is missing. Add SHOPIFY_CLIENT_ID in Render Environment to enable client_credentials OAuth exchange.');
  }

  const domain = auth.shopDomain;
  const tokenRef = { token: auth.token };
  const publications = await fetchAllShopifyPublications({ domain, tokenRef, authMode: auth.authMode, settings });

  const existingHandles = new Set();
  const existingSkus = new Map();
  const liveGhostProductsToDelete = new Map(); // productId -> { title, sku }
  const liveDisposedOrNonAllowlistToArchive = new Map(); // productId -> { title, sku, status, inventory_item_id, inventory_quantity }

  let nextUrl = `https://${domain}/admin/api/2025-01/products.json?limit=250&fields=id,handle,title,vendor,tags,status,variants,images`;
  while (nextUrl) {
    const preResp = await shopifyFetchWithRetry(
      nextUrl,
      { method: 'GET', headers: { Accept: 'application/json' } },
      { authMode: auth.authMode, settings, tokenRef }
    );
    if (!preResp.ok) {
      throw new Error(`Shopify Admin API authentication check failed (HTTP ${preResp.status})`);
    }
    const preData = await preResp.json();
    for (const p of preData.products || []) {
      existingHandles.add(String(p.handle || '').toLowerCase());
      const pBlob = `${p.title || ''} ${p.vendor || ''} ${p.tags || ''} ${p.handle || ''}`;
      const isLiveGhostLaCrosse = /\b(1G4GA5GR2FF246661|LACROSSE-15-BAYB|buick[\s_-]+lacrosse)\b/i.test(pBlob);
      const isLiveDisposedVehicle = DISPOSED_VEHICLE_TEXT_REGEX.test(pBlob);
      const cleanCdnImages = (p.images || [])
        .filter((img) => img && img.src && !isQrCardUrl(img.src) && !/scan qr|security tag/i.test(String(img.alt || '')))
        .map((img) => img.src);

      if (isLiveGhostLaCrosse && p.id) {
        liveGhostProductsToDelete.set(String(p.id), {
          product_id: String(p.id),
          title: String(p.title || ''),
          sku: String(p.variants?.[0]?.sku || ''),
          inventory_item_id: String(p.variants?.[0]?.inventory_item_id || '')
        });
      }

      let productMatchesAllowedActiveSku = false;
      for (const v of p.variants || []) {
        if (v.sku) {
          const skuUpper = String(v.sku).trim().toUpperCase();
          if (activeAllowedSkusSet.has(skuUpper)) productMatchesAllowedActiveSku = true;
          existingSkus.set(skuUpper, {
            product_id: String(p.id || ''),
            handle: String(p.handle || ''),
            title: String(p.title || ''),
            status: String(p.status || 'active'),
            variant_id: String(v.id || ''),
            inventory_item_id: String(v.inventory_item_id || ''),
            inventory_quantity: Number(v.inventory_quantity || 0),
            clean_cdn_images: cleanCdnImages,
            raw_images: Array.isArray(p.images) ? p.images : []
          });
          if (ghostDeleteSkusSet.has(skuUpper) && p.id) {
            liveGhostProductsToDelete.set(String(p.id), {
              product_id: String(p.id),
              title: String(p.title || ''),
              sku: skuUpper,
              inventory_item_id: String(v.inventory_item_id || '')
            });
          }
        }
      }

      // 7-VEHICLE ALLOWLIST FIREWALL ON SHOPIFY: Any product NOT in the verified 7-vehicle active catalog (or matching disposed vehicles) MUST be archived & zeroed!
      if (p.id && !liveGhostProductsToDelete.has(String(p.id))) {
        const primaryVar = p.variants?.[0] || {};
        const needsArchiveOrZero = String(p.status || '') !== 'archived' || Number(primaryVar.inventory_quantity || 0) > 0;
        if (needsArchiveOrZero && (isLiveDisposedVehicle || !productMatchesAllowedActiveSku)) {
          liveDisposedOrNonAllowlistToArchive.set(String(p.id), {
            product_id: String(p.id),
            title: String(p.title || ''),
            sku: String(primaryVar.sku || ''),
            status: String(p.status || 'active'),
            inventory_item_id: String(primaryVar.inventory_item_id || ''),
            inventory_quantity: Number(primaryVar.inventory_quantity || 0)
          });
        }
      }
    }
    const link = preResp.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = m ? m[1] : null;
  }

  async function zeroShopifyInventoryItem(inventoryItemId) {
    if (!inventoryItemId) return;
    try {
      const lvlResp = await shopifyFetchWithRetry(
        `https://${domain}/admin/api/2025-01/inventory_levels.json?inventory_item_ids=${inventoryItemId}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        { authMode: auth.authMode, settings, tokenRef }
      );
      if (lvlResp.ok) {
        const lvlData = await lvlResp.json();
        for (const lvl of lvlData.inventory_levels || []) {
          if (Number(lvl.available || 0) > 0) {
            await shopifyFetchWithRetry(
              `https://${domain}/admin/api/2025-01/inventory_levels/set.json`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                  location_id: lvl.location_id,
                  inventory_item_id: Number(inventoryItemId),
                  available: 0
                })
              },
              { authMode: auth.authMode, settings, tokenRef }
            );
          }
        }
      }
    } catch (_) {}
  }

  let pushed = 0;
  let updatedCount = 0;
  let deletedGhostLaCrosse = 0;
  let archivedDisposedFleet = 0;
  let deletedQrImages = 0;
  let draftedBlocked = 0;
  let archivedPending = 0;
  let archivedDuplicates = 0;
  let skippedProtected = 0;
  let updatedImageAlts = 0;
  const errors = [];

  // 0. PERMANENT GHOST VEHICLE PURGE ON SHOPIFY: DELETE every 2015 Buick LaCrosse (1G4GA5GR2FF246661 / LACROSSE-15-BAYB) product!
  for (const ghost of liveGhostProductsToDelete.values()) {
    try {
      const delResp = await shopifyFetchWithRetry(
        `https://${domain}/admin/api/2025-01/products/${ghost.product_id}.json`,
        { method: 'DELETE', headers: { Accept: 'application/json' } },
        { authMode: auth.authMode, settings, tokenRef }
      );
      if (delResp.ok) {
        deletedGhostLaCrosse++;
        logSync('outbound', 'shopify_co_master', 'delete_ghost_lacrosse', ghost.sku || ghost.product_id, 'success', `Permanently DELETED ghost 2015 Buick LaCrosse product "${ghost.title}" (ID ${ghost.product_id}) from ${domain}.`);
      } else {
        await shopifyFetchWithRetry(
          `https://${domain}/admin/api/2025-01/products/${ghost.product_id}.json`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ product: { id: Number(ghost.product_id), status: 'archived', tags: 'GHOST-VEHICLE-PURGED' } })
          },
          { authMode: auth.authMode, settings, tokenRef }
        );
        await zeroShopifyInventoryItem(ghost.inventory_item_id);
        deletedGhostLaCrosse++;
      }
      await new Promise((r) => setTimeout(r, 180));
    } catch (err) {
      errors.push(`delete-ghost ${ghost.sku || ghost.product_id}: ${err.message}`);
    }
  }

  // 0b. 7-VEHICLE ALLOWLIST FIREWALL PURGE ON SHOPIFY: Archive & zero EVERY disposed/unapproved/non-allowlist product!
  for (const disp of liveDisposedOrNonAllowlistToArchive.values()) {
    try {
      if (disp.status !== 'archived') {
        const archResp = await shopifyFetchWithRetry(
          `https://${domain}/admin/api/2025-01/products/${disp.product_id}.json`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              product: {
                id: Number(disp.product_id),
                status: 'archived',
                tags: 'DISPOSED-FLEET-ARCHIVED, ALLOWLIST-FIREWALL'
              }
            })
          },
          { authMode: auth.authMode, settings, tokenRef }
        );
        if (archResp.ok) archivedDisposedFleet++;
        else errors.push(`archive-disposed ${disp.sku || disp.product_id}: HTTP ${archResp.status}`);
      }
      if (Number(disp.inventory_quantity || 0) > 0) {
        await zeroShopifyInventoryItem(disp.inventory_item_id);
      }
      await new Promise((r) => setTimeout(r, 180));
    } catch (err) {
      errors.push(`archive-disposed ${disp.sku || disp.product_id}: ${err.message}`);
    }
  }

  // 1. COMPLIANCE & SOLD TRANSMISSION ENFORCEMENT: Archive & zero prohibited/sold SKUs on Shopify!
  for (const blockedSku of blockedSkusSet) {
    const liveBlocked = existingSkus.get(blockedSku);
    if (!liveBlocked || liveGhostProductsToDelete.has(liveBlocked.product_id) || liveDisposedOrNonAllowlistToArchive.has(liveBlocked.product_id)) continue;
    const needsArchive = liveBlocked.status !== 'archived';
    const needsZero = Number(liveBlocked.inventory_quantity || 0) > 0;
    if (!needsArchive && !needsZero) continue;
    try {
      if (needsArchive) {
        const draftResp = await shopifyFetchWithRetry(
          `https://${domain}/admin/api/2025-01/products/${liveBlocked.product_id}.json`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              product: {
                id: Number(liveBlocked.product_id),
                status: 'archived',
                tags: 'BLOCKED-OR-SOLD-ARCHIVED'
              }
            })
          },
          { authMode: auth.authMode, settings, tokenRef }
        );
        if (draftResp.ok) {
          draftedBlocked++;
          logSync('outbound', 'shopify_co_master', 'compliance_archive_blocked', blockedSku, 'success', `Archived blocked/sold SKU ${blockedSku} on ${domain} (Product ID ${liveBlocked.product_id}).`);
        } else {
          errors.push(`archive-blocked ${blockedSku}: HTTP ${draftResp.status}`);
        }
      }
      if (needsZero) {
        await zeroShopifyInventoryItem(liveBlocked.inventory_item_id);
      }
      await new Promise((r) => setTimeout(r, 220));
    } catch (err) {
      errors.push(`archive-blocked ${blockedSku}: ${err.message}`);
    }
  }

  // 1b. ZERO-PLACEHOLDER & UNVERIFIED-VIN QUARANTINE: Archive & zero any pending_verification SKU on Shopify
  for (const pendSku of pendingVerificationSkusSet) {
    const livePend = existingSkus.get(pendSku);
    if (!livePend || liveGhostProductsToDelete.has(livePend.product_id) || liveDisposedOrNonAllowlistToArchive.has(livePend.product_id)) continue;
    const needsArchive = livePend.status !== 'archived';
    const needsZero = Number(livePend.inventory_quantity || 0) > 0;
    if (!needsArchive && !needsZero) continue;
    try {
      if (needsArchive) {
        const archResp = await shopifyFetchWithRetry(
          `https://${domain}/admin/api/2025-01/products/${livePend.product_id}.json`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              product: {
                id: Number(livePend.product_id),
                status: 'archived',
                tags: 'PENDING-VERIFICATION'
              }
            })
          },
          { authMode: auth.authMode, settings, tokenRef }
        );
        if (archResp.ok) archivedPending++;
        else errors.push(`archive-pending ${pendSku}: HTTP ${archResp.status}`);
      }
      if (needsZero) await zeroShopifyInventoryItem(livePend.inventory_item_id);
      await new Promise((r) => setTimeout(r, 220));
    } catch (err) {
      errors.push(`archive-pending ${pendSku}: ${err.message}`);
    }
  }

  // 1c. PERMANENT DUPLICATE / SOLD ARCHIVAL
  for (const dupSku of duplicateArchivedSkusSet) {
    const liveDup = existingSkus.get(dupSku);
    if (!liveDup || liveGhostProductsToDelete.has(liveDup.product_id) || liveDisposedOrNonAllowlistToArchive.has(liveDup.product_id)) continue;
    const needsArchive = liveDup.status !== 'archived';
    const needsZero = Number(liveDup.inventory_quantity || 0) > 0;
    if (!needsArchive && !needsZero) continue;
    try {
      if (needsArchive) {
        const archResp = await shopifyFetchWithRetry(
          `https://${domain}/admin/api/2025-01/products/${liveDup.product_id}.json`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              product: {
                id: Number(liveDup.product_id),
                status: 'archived',
                tags: 'DUPLICATE-OR-SOLD-ARCHIVED'
              }
            })
          },
          { authMode: auth.authMode, settings, tokenRef }
        );
        if (archResp.ok) archivedDuplicates++;
        else errors.push(`archive-duplicate ${dupSku}: HTTP ${archResp.status}`);
      }
      if (needsZero) await zeroShopifyInventoryItem(liveDup.inventory_item_id);
      await new Promise((r) => setTimeout(r, 220));
    } catch (err) {
      errors.push(`archive-duplicate ${dupSku}: ${err.message}`);
    }
  }

  // Track active product GIDs for Automated Donor Vehicle Collections + Part Category Collections
  const collectionMap = new Map();
  const trackForCollections = (productId, tax) => {
    if (!productId) return;
    const gid = `gid://shopify/Product/${productId}`;
    if (tax?.donorCollectionTitle) {
      if (!collectionMap.has(tax.donorCollectionTitle)) collectionMap.set(tax.donorCollectionTitle, new Set());
      collectionMap.get(tax.donorCollectionTitle).add(gid);
    }
    if (tax?.categoryCollectionTitle) {
      if (!collectionMap.has(tax.categoryCollectionTitle)) collectionMap.set(tax.categoryCollectionTitle, new Set());
      collectionMap.get(tax.categoryCollectionTitle).add(gid);
    }
  };

  // 2. Push new active SKUs (and when updateExisting=true, FULL v31.0 enrichment PUT + QR purge + GraphQL taxonomy/metafields/SEO/channels!)
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (global.__aldridgeShopifySyncJob && global.__aldridgeShopifySyncJob.status === 'running') {
      global.__aldridgeShopifySyncJob.progress = {
        processed: idx,
        total: items.length,
        created: pushed,
        updated: updatedCount,
        deleted_ghost_lacrosse: deletedGhostLaCrosse,
        deleted_qr_images: deletedQrImages,
        errors_count: errors.length
      };
    }

    try {
      const title80 = cleanListingTitle(item.title || '').slice(0, 80);
      const dims = resolveExportDims(item);
      const handle = item.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const skuUpper = String(item.sku || '').toUpperCase();
      const matchedExisting = existingSkus.get(skuUpper);
      const tax = resolvePartTaxonomyAndMetafields({ ...item, title: title80, weight_lbs: dims.weight_lbs }, settings);
      const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
      const dimsLabel = `${dims.length_in}x${dims.width_in}x${dims.height_in}`;
      const tags = [...tax.seoTags, `Dims:${dimsLabel}`].join(', ');

      if (matchedExisting) {
        // Always backfill Shopify IDs & clean non-QR CDN URLs into SQLite
        const curPhotos = getValidPhotos(item);
        const needsCdn = matchedExisting.clean_cdn_images?.length > 0 && !curPhotos.some((u) => /cdn\.shopify\.com/i.test(u));
        if (!item.shopify_product_id || needsCdn) {
          const nextPhotosJson = needsCdn ? JSON.stringify(matchedExisting.clean_cdn_images) : item.photos_json;
          db.prepare(`
            UPDATE inventory_items
            SET shopify_product_id = ?, shopify_variant_id = ?, shopify_inventory_item_id = ?, photos_json = ?, updated_at = ?
            WHERE id = ?
          `).run(
            matchedExisting.product_id,
            matchedExisting.variant_id,
            matchedExisting.inventory_item_id,
            nextPhotosJson,
            new Date().toISOString(),
            item.id
          );
        }

        trackForCollections(matchedExisting.product_id, tax);

        if (!updateExisting) {
          skippedProtected++;
          continue;
        }

        // FULL v31.0 ENRICHMENT PUT UPDATE (<=80 clean title, clean HTML, accurate weight/dims, Qty 1)
        const updatePayload = {
          product: {
            id: Number(matchedExisting.product_id),
            title: title80,
            body_html: renderShopifyHtml({ ...item, title: title80 }, settings),
            vendor: tax.brand || item.fitment_make || 'OEM',
            product_type: tax.partType,
            tags,
            status: 'active',
            variants: [
              {
                id: Number(matchedExisting.variant_id),
                sku: item.sku,
                price: Number(item.price_we_pull || 0).toFixed(2),
                inventory_management: 'shopify',
                inventory_policy: 'deny',
                weight: Number(dims.weight_lbs),
                weight_unit: 'lb',
                requires_shipping: !heavyPickupOnly
              }
            ]
          }
        };

        const putResp = await shopifyFetchWithRetry(
          `https://${domain}/admin/api/2025-01/products/${matchedExisting.product_id}.json`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(updatePayload)
          },
          { authMode: auth.authMode, settings, tokenRef }
        );
        if (!putResp.ok) {
          const errTxt = await putResp.text().catch(() => '');
          throw new Error(`Shopify PUT HTTP ${putResp.status}: ${errTxt.slice(0, 140)}`);
        }

        // PURGE any legacy *.qr.png / "Scan QR" image from Shopify AND sanitize clean image alt-texts!
        try {
          const putData = await putResp.json();
          const liveImages = Array.isArray(putData?.product?.images) ? putData.product.images : [];
          for (const img of liveImages) {
            if (!img?.id) continue;
            const isQrImg =
              isQrCardUrl(img.src) ||
              /\.qr\.png/i.test(String(img.src || '')) ||
              /scan qr|security tag/i.test(String(img.alt || ''));
            if (isQrImg) {
              const delImgResp = await shopifyFetchWithRetry(
                `https://${domain}/admin/api/2025-01/products/${matchedExisting.product_id}/images/${img.id}.json`,
                { method: 'DELETE', headers: { Accept: 'application/json' } },
                { authMode: auth.authMode, settings, tokenRef }
              );
              if (delImgResp.ok) deletedQrImages++;
              continue;
            }
            const expectedAlt = buildExpectedShopifyImageAlt({ ...item, title: title80 });
            if (String(img.alt || '').trim() !== expectedAlt) {
              const imgResp = await shopifyFetchWithRetry(
                `https://${domain}/admin/api/2025-01/products/${matchedExisting.product_id}/images/${img.id}.json`,
                {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                  body: JSON.stringify({ image: { id: img.id, alt: expectedAlt } })
                },
                { authMode: auth.authMode, settings, tokenRef }
              );
              if (imgResp.ok) updatedImageAlts++;
            }
          }
        } catch (_) {}

        await syncShopifyProductGraphqlAndOrigin({
          domain,
          tokenRef,
          authMode: auth.authMode,
          settings,
          productId: matchedExisting.product_id,
          variantId: matchedExisting.variant_id,
          inventoryItemId: matchedExisting.inventory_item_id,
          item: { ...item, title: title80 },
          tax,
          publications
        });

        updatedCount++;
        await new Promise((r) => setTimeout(r, 260));
        continue;
      }

      if (existingHandles.has(handle)) {
        skippedProtected++;
        continue;
      }

      // STRICT SINGLE VARIANT ONLY (Default Title, Qty 1, exact physical weight_lbs)
      const variants = [
        {
          sku: item.sku,
          price: Number(item.price_we_pull || 0).toFixed(2),
          inventory_management: 'shopify',
          inventory_quantity: 1,
          inventory_policy: 'deny',
          weight: Number(dims.weight_lbs),
          weight_unit: 'lb',
          requires_shipping: !heavyPickupOnly
        }
      ];

      const uploadsDir = path.join(DATA_DIR, 'uploads');
      const reviewThumbsDir = path.join(__dirname, '..', 'public', 'review-thumbs');
      const rawPhotos = getShopifyGalleryPhotos(item); // ZERO *.qr.png!
      const altText = buildExpectedShopifyImageAlt({ ...item, title: title80 });
      const images = rawPhotos.map((u, photoIdx) => {
        if (u.startsWith('/uploads/')) {
          const localFile = path.join(uploadsDir, path.basename(u));
          if (fs.existsSync(localFile)) {
            return {
              attachment: fs.readFileSync(localFile).toString('base64'),
              filename: path.basename(localFile),
              position: photoIdx + 1,
              alt: altText
            };
          }
        }
        if (u.startsWith('/review-thumbs/')) {
          const localThumb = path.join(reviewThumbsDir, path.basename(u));
          if (fs.existsSync(localThumb)) {
            return {
              attachment: fs.readFileSync(localThumb).toString('base64'),
              filename: `${item.sku}.${photoIdx + 1}.jpg`,
              position: photoIdx + 1,
              alt: altText
            };
          }
        }
        return {
          src: resolveExportPhotoUrl(u, `https://${domain}`, settings),
          position: photoIdx + 1,
          alt: altText
        };
      });

      const payload = {
        product: {
          title: title80,
          handle,
          body_html: renderShopifyHtml({ ...item, title: title80 }, settings),
          vendor: tax.brand || item.fitment_make || 'OEM',
          product_type: tax.partType,
          tags,
          status: 'active',
          variants,
          images
        }
      };

      const endpoint = `https://${domain}/admin/api/2025-01/products.json`;
      const resp = await shopifyFetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        },
        { authMode: auth.authMode, settings, tokenRef }
      );

      if (!resp.ok) {
        throw new Error(`Shopify HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (data.product && data.product.id) {
        const primaryVar = data.product.variants?.[0] || {};
        const cleanCdnImages = (data.product.images || [])
          .filter((img) => img && img.src && !isQrCardUrl(img.src) && !/scan qr|security tag/i.test(String(img.alt || '')))
          .map((img) => img.src);
        const nextPhotosJson = cleanCdnImages.length > 0 ? JSON.stringify(cleanCdnImages) : (item.photos_json || JSON.stringify(getValidPhotos(item)));
        db.prepare(`
          UPDATE inventory_items
          SET shopify_product_id = ?, shopify_variant_id = ?, shopify_inventory_item_id = ?, photos_json = ?, updated_at = ?
          WHERE id = ?
        `).run(
          String(data.product.id),
          String(primaryVar.id || ''),
          String(primaryVar.inventory_item_id || ''),
          nextPhotosJson,
          new Date().toISOString(),
          item.id
        );

        await syncShopifyProductGraphqlAndOrigin({
          domain,
          tokenRef,
          authMode: auth.authMode,
          settings,
          productId: String(data.product.id),
          variantId: String(primaryVar.id || ''),
          inventoryItemId: String(primaryVar.inventory_item_id || ''),
          item: { ...item, title: title80 },
          tax,
          publications
        });

        trackForCollections(String(data.product.id), tax);
      }
      pushed++;
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      errors.push(`${item.sku}: ${err.message}`);
    }
  }

  // 3. Automated Donor Vehicle Collections + Part Category Collections on Shopify
  const collectionsSummary = await syncShopifyCollections({
    domain,
    tokenRef,
    authMode: auth.authMode,
    settings,
    collectionMap,
    publications
  });

  const finalActiveCount = items.length;
  logSync(
    'outbound',
    'shopify_co_master',
    updateExisting ? 'live_api_v32_allowlist_full_sync' : 'live_api_push',
    'ALL',
    errors.length ? 'partial' : 'success',
    `Shopify v32 Allowlist sync on ${domain} via ${auth.authMode}: created=${pushed}, updated=${updatedCount}, deleted_ghost_lacrosse=${deletedGhostLaCrosse}, archived_disposed_fleet=${archivedDisposedFleet}, deleted_qr_images=${deletedQrImages}, archived_blocked=${draftedBlocked}, archived_pending=${archivedPending}, archived_dupes=${archivedDuplicates}, publications=${publications.length}, collections_created=${collectionsSummary.collections_created}, errors=${errors.length} (active_7vehicle_catalog=${finalActiveCount}).`
  );
  return {
    mode: 'live_api',
    auth_mode: auth.authMode,
    update_existing: Boolean(updateExisting),
    synced_count: pushed,
    updated_count: updatedCount,
    deleted_ghost_lacrosse_count: deletedGhostLaCrosse,
    archived_disposed_fleet_count: archivedDisposedFleet,
    deleted_qr_images_count: deletedQrImages,
    updated_image_alts_count: updatedImageAlts,
    drafted_blocked_count: draftedBlocked,
    archived_pending_count: archivedPending,
    archived_duplicates_count: archivedDuplicates,
    skipped_protected: skippedProtected,
    sales_channels_available: publications.map((p) => p.name),
    collections: collectionsSummary,
    default_package_note: 'Shopify Admin API restricts saved store default package deletion to Shopify Admin -> Settings -> Shipping and delivery -> Saved packages (remove Uhaul Medium Box there; all per-SKU weights & custom.packed_dimensions are synced via API).',
    total_active_catalog_skus: finalActiveCount,
    ghost_purge: ghostPurgeSummary,
    deduplication: dedupeSummary,
    errors
  };
}

function markInventoryChannelDelisted(item, reason, extra = {}) {
  let ch = {};
  try {
    ch = JSON.parse(item.channels_json || '{}');
  } catch (_) {
    ch = {};
  }
  const now = new Date().toISOString();
  return JSON.stringify({
    ...ch,
    delisted_all_feeds: true,
    delisted_at: now,
    delist_reason: reason,
    crosslist_delist_required: true,
    ebay_delisted: true,
    google_merchant_removed: true,
    meta_catalog_removed: true,
    craigslist_delisted: true,
    ...extra
  });
}

function findInventoryItemForWebhook({ sku, variantId, productId, inventoryItemId }) {
  const cleanSku = String(sku || '').trim().replace(/-(SELFPULL|INSTALL)$/i, '');
  if (cleanSku) {
    const bySku = db.prepare('SELECT * FROM inventory_items WHERE UPPER(sku) = UPPER(?)').get(cleanSku);
    if (bySku) return bySku;
  }
  if (variantId) {
    const byVar = db.prepare('SELECT * FROM inventory_items WHERE shopify_variant_id = ?').get(String(variantId));
    if (byVar) return byVar;
  }
  if (inventoryItemId) {
    const byInv = db.prepare('SELECT * FROM inventory_items WHERE shopify_inventory_item_id = ?').get(String(inventoryItemId));
    if (byInv) return byInv;
  }
  if (productId) {
    const byProd = db.prepare('SELECT * FROM inventory_items WHERE shopify_product_id = ?').get(String(productId));
    if (byProd) return byProd;
  }
  return null;
}

function handleShopifyWebhook(topic, rawBody, hmacHeader) {
  const settings = getSettings();
  const normalizedTopic = String(topic || 'orders/create').trim().toLowerCase();

  if (settings.shopify_webhook_secret) {
    if (!hmacHeader) {
      const err = new Error('Missing Shopify webhook HMAC signature');
      err.statusCode = 401;
      throw err;
    }
    const digest = crypto
      .createHmac('sha256', settings.shopify_webhook_secret)
      .update(rawBody, 'utf8')
      .digest('base64');
    const a = Buffer.from(digest, 'utf8');
    const b = Buffer.from(String(hmacHeader).trim(), 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      const err = new Error('Invalid Shopify webhook HMAC signature');
      err.statusCode = 401;
      throw err;
    }
  }

  const payload = JSON.parse(rawBody || '{}');
  const now = new Date().toISOString();
  const updatedSkus = [];
  const delistedSkus = [];

  if ((normalizedTopic === 'orders/create' || normalizedTopic === 'orders/paid') && Array.isArray(payload.line_items)) {
    for (const li of payload.line_items) {
      const item = findInventoryItemForWebhook({
        sku: li.sku,
        variantId: li.variant_id,
        productId: li.product_id
      });
      if (!item) continue;
      const qtyOrdered = Math.max(1, Number(li.quantity || 1));
      const nextQty = Math.max(0, Number(item.quantity || 0) - qtyOrdered);
      const nextStatus = nextQty === 0 ? 'sold' : 'active';
      const nextChannels = nextQty === 0
        ? markInventoryChannelDelisted(item, 'shopify_order_sold', { shopify_order: String(payload.name || payload.id || '') })
        : (item.channels_json || '{}');

      db.prepare('UPDATE inventory_items SET quantity = ?, status = ?, channels_json = ?, updated_at = ? WHERE id = ?').run(
        nextQty, nextStatus, nextChannels, now, item.id
      );
      updatedSkus.push(item.sku);
      if (nextQty === 0) delistedSkus.push(item.sku);

      logSync(
        'inbound',
        'shopify_webhook',
        nextQty === 0 ? 'order_sold_auto_delist_all_feeds' : 'order_stock_decrement',
        item.sku,
        'success',
        `Shopify Order #${payload.name || payload.id || 'N/A'} set single-variant ${item.sku} qty=${nextQty} (status=${nextStatus}). Auto-delisted from Crosslist, eBay aabcas, Google Merchant XML, Meta CSV & Craigslist queue.`
      );
    }
  } else if (normalizedTopic === 'products/update' && Array.isArray(payload.variants)) {
    const shopifyStatus = String(payload.status || 'active').toLowerCase();
    const isArchivedOrDraft = shopifyStatus === 'archived' || shopifyStatus === 'draft';

    for (const v of payload.variants) {
      if (String(v.sku || '').endsWith('-SELFPULL') || String(v.sku || '').endsWith('-INSTALL')) continue;
      const item = findInventoryItemForWebhook({
        sku: v.sku,
        variantId: v.id,
        productId: payload.id,
        inventoryItemId: v.inventory_item_id
      });
      if (!item) continue;

      const isLockedQuarantine = item.status === 'compliance_blocked' || item.status === 'pending_verification' || item.status === 'duplicate_archived';
      const hasInvField = v.inventory_quantity !== undefined && v.inventory_quantity !== null;
      const rawQty = hasInvField ? Math.max(0, Number(v.inventory_quantity)) : Number(item.quantity || 0);
      const nextQty = (isLockedQuarantine || isArchivedOrDraft) ? 0 : rawQty;
      const nextStatus = isLockedQuarantine
        ? item.status
        : (nextQty === 0 ? (isArchivedOrDraft && rawQty > 0 ? 'inactive' : 'sold') : 'active');
      const nextPrice = Number.isFinite(parseFloat(v.price)) && parseFloat(v.price) > 0 ? parseFloat(v.price) : item.price_we_pull;

      let nextChannels = item.channels_json || '{}';
      if (nextQty === 0) {
        nextChannels = markInventoryChannelDelisted(item, isLockedQuarantine ? item.status : (isArchivedOrDraft ? `shopify_${shopifyStatus}` : 'shopify_zero_inventory'));
        delistedSkus.push(item.sku);
      } else {
        try {
          const ch = JSON.parse(nextChannels);
          ch.delisted_all_feeds = false;
          ch.crosslist_delist_required = false;
          nextChannels = JSON.stringify(ch);
        } catch (_) {}
      }

      db.prepare(`
        UPDATE inventory_items
        SET quantity = ?, price_we_pull = ?, status = ?, channels_json = ?, updated_at = ?
        WHERE id = ?
      `).run(nextQty, nextPrice, nextStatus, nextChannels, now, item.id);
      updatedSkus.push(item.sku);

      logSync(
        'inbound',
        'shopify_webhook',
        nextQty === 0 ? 'product_update_auto_delist_all_feeds' : 'co_master_product_sync',
        item.sku,
        'success',
        `Shopify products/update synced ${item.sku}: qty=${nextQty}, status=${nextStatus}, price=$${nextPrice}${nextQty === 0 ? ' — auto-delisted across Crosslist, eBay aabcas, Google Merchant XML, Meta CSV & Craigslist.' : '.'}`
      );
    }
  } else if (normalizedTopic === 'inventory_levels/update' && payload.inventory_item_id !== undefined) {
    const item = findInventoryItemForWebhook({ inventoryItemId: payload.inventory_item_id });
    if (item && payload.available !== undefined && payload.available !== null) {
      const isLockedQuarantine = item.status === 'compliance_blocked' || item.status === 'pending_verification' || item.status === 'duplicate_archived';
      const nextQty = isLockedQuarantine ? 0 : Math.max(0, Number(payload.available));
      const nextStatus = isLockedQuarantine ? item.status : (nextQty === 0 ? 'sold' : 'active');
      const nextChannels = nextQty === 0
        ? markInventoryChannelDelisted(item, isLockedQuarantine ? item.status : 'shopify_inventory_zero')
        : (item.channels_json || '{}');
      db.prepare('UPDATE inventory_items SET quantity = ?, status = ?, channels_json = ?, updated_at = ? WHERE id = ?').run(
        nextQty, nextStatus, nextChannels, now, item.id
      );
      updatedSkus.push(item.sku);
      if (nextQty === 0) delistedSkus.push(item.sku);
      logSync('inbound', 'shopify_webhook', 'inventory_level_sync', item.sku, 'success', `Shopify inventory_levels/update set ${item.sku} qty=${nextQty} (status=${nextStatus}).`);
    }
  }

  return {
    ok: true,
    topic: normalizedTopic,
    updated_count: updatedSkus.length,
    updated_skus: updatedSkus,
    delisted_count: delistedSkus.length,
    delisted_skus: delistedSkus
  };
}

async function pushSingleItemToShopify(item, settings, uploadsDir) {
  const cfg = settings || getSettings();
  const auth = await resolveShopifyAccessToken(cfg);
  const domain = auth.shopDomain;

  if (!isMarketplaceSafeItem(item)) {
    return {
      pushed: false,
      shopify_domain: domain,
      reason: 'Blocked: Item failed strict v31.0 17-char verified donor VIN, compliance, ghost-vehicle, or real-photo publish gate.'
    };
  }

  if (!auth.token || auth.authMode === 'shpss_missing_client_id') {
    return {
      pushed: false,
      queued_for_shopify: true,
      queued_for_ebay: true,
      shopify_domain: domain,
      reason: auth.authMode === 'shpss_missing_client_id'
        ? 'SHOPIFY_ADMIN_TOKEN starts with shpss_ but SHOPIFY_CLIENT_ID is missing'
        : 'Awaiting SHOPIFY_ADMIN_TOKEN in Settings Vault or cloud env vars'
    };
  }

  const title80 = cleanListingTitle(item.title || '').slice(0, 80);
  const dims = resolveExportDims(item);
  const handle = String(item.sku || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const tax = resolvePartTaxonomyAndMetafields({ ...item, title: title80, weight_lbs: dims.weight_lbs }, cfg);
  const heavyPickupOnly = isHeavyLocalPickupItem(item, cfg);
  const dimsLabel = `${dims.length_in}x${dims.width_in}x${dims.height_in}`;
  const tags = [...tax.seoTags, `Dims:${dimsLabel}`].join(', ');

  // STRICT SINGLE VARIANT ONLY (Default Title, Qty 1, exact physical weight_lbs)
  const variants = [
    {
      sku: item.sku,
      price: Number(item.price_we_pull || 0).toFixed(2),
      inventory_management: 'shopify',
      inventory_quantity: 1,
      inventory_policy: 'deny',
      weight: Number(dims.weight_lbs),
      weight_unit: 'lb',
      requires_shipping: !heavyPickupOnly
    }
  ];

  const targetDir = uploadsDir || path.join(DATA_DIR, 'uploads');
  const reviewThumbsDir = path.join(__dirname, '..', 'public', 'review-thumbs');
  const rawPhotos = getShopifyGalleryPhotos(item); // ZERO *.qr.png!
  const altText = buildExpectedShopifyImageAlt({ ...item, title: title80 });
  const images = [];
  let pos = 1;
  for (const str of rawPhotos) {
    if (str.startsWith('data:image/')) {
      const m = str.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (m) {
        images.push({
          attachment: m[2],
          filename: `${item.sku}.${pos}.jpg`,
          position: pos++,
          alt: altText
        });
      }
    } else if (str.startsWith('/uploads/')) {
      const localFile = path.join(targetDir, path.basename(str));
      if (fs.existsSync(localFile)) {
        images.push({
          attachment: fs.readFileSync(localFile).toString('base64'),
          filename: path.basename(localFile),
          position: pos++,
          alt: altText
        });
      }
    } else if (str.startsWith('/review-thumbs/')) {
      const localThumb = path.join(reviewThumbsDir, path.basename(str));
      if (fs.existsSync(localThumb)) {
        images.push({
          attachment: fs.readFileSync(localThumb).toString('base64'),
          filename: `${item.sku}.${pos}.jpg`,
          position: pos++,
          alt: altText
        });
      }
    } else if (/^https?:\/\//i.test(str)) {
      images.push({
        src: str,
        position: pos++,
        alt: altText
      });
    }
  }

  const payload = {
    product: {
      title: title80,
      handle,
      body_html: renderShopifyHtml({ ...item, title: title80 }, cfg),
      vendor: tax.brand || item.fitment_make || 'OEM',
      product_type: tax.partType,
      tags,
      status: 'active',
      variants,
      images
    }
  };

  const endpoint = `https://${domain}/admin/api/2025-01/products.json`;
  const tokenRef = { token: auth.token };
  const resp = await shopifyFetchWithRetry(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    },
    { authMode: auth.authMode, settings: cfg, tokenRef }
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    logSync('outbound', 'shopify_direct_camera', 'auto_publish_error', item.sku, 'error', `Direct camera publish to ${domain} returned HTTP ${resp.status}: ${errText.slice(0, 180)}`);
    return {
      pushed: false,
      queued_for_shopify: true,
      queued_for_ebay: true,
      shopify_domain: domain,
      error: `Shopify HTTP ${resp.status}`
    };
  }

  const data = await resp.json();
  if (data.product && data.product.id) {
    const primaryVar = data.product.variants?.[0] || {};
    const cleanCdnImages = (data.product.images || [])
      .filter((img) => img && img.src && !isQrCardUrl(img.src) && !/scan qr|security tag/i.test(String(img.alt || '')))
      .map((img) => img.src);
    const nextPhotosJson = cleanCdnImages.length > 0 ? JSON.stringify(cleanCdnImages) : (item.photos_json || JSON.stringify(getValidPhotos(item)));
    db.prepare(`
      UPDATE inventory_items
      SET shopify_product_id = ?, shopify_variant_id = ?, shopify_inventory_item_id = ?, photos_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      String(data.product.id),
      String(primaryVar.id || ''),
      String(primaryVar.inventory_item_id || ''),
      nextPhotosJson,
      new Date().toISOString(),
      item.id
    );
    const publications = await fetchAllShopifyPublications({ domain, tokenRef, authMode: auth.authMode, settings: cfg });
    await syncShopifyProductGraphqlAndOrigin({
      domain,
      tokenRef,
      authMode: auth.authMode,
      settings: cfg,
      productId: String(data.product.id),
      variantId: String(primaryVar.id || ''),
      inventoryItemId: String(primaryVar.inventory_item_id || ''),
      item: { ...item, title: title80 },
      tax,
      publications
    });
    const colMap = new Map();
    const pGid = `gid://shopify/Product/${data.product.id}`;
    if (tax.donorCollectionTitle) colMap.set(tax.donorCollectionTitle, new Set([pGid]));
    if (tax.categoryCollectionTitle) colMap.set(tax.categoryCollectionTitle, new Set([pGid]));
    await syncShopifyCollections({ domain, tokenRef, authMode: auth.authMode, settings: cfg, collectionMap: colMap, publications });

    logSync('outbound', 'shopify_direct_camera', 'auto_publish_live', item.sku, 'success', `Published single-variant ${item.sku} directly to https://${domain}/products/${data.product.handle} (Product ID ${data.product.id}, ${cleanCdnImages.length} clean CDN images, 0 QR images).`);
    return {
      pushed: true,
      shopify_domain: domain,
      shopify_product_id: String(data.product.id),
      shopify_url: `https://${domain}/products/${data.product.handle}`,
      cdn_photos: cleanCdnImages,
      queued_for_ebay: true
    };
  }

  return { pushed: false, queued_for_ebay: true, shopify_domain: domain };
}

const REQUIRED_SHOPIFY_WEBHOOK_TOPICS = [
  'orders/create',
  'orders/paid',
  'products/update',
  'inventory_levels/update'
];

async function ensureShopifyWebhooksRegistered({ registerMissing = true, baseUrl = '' } = {}) {
  const settings = getSettings();
  const auth = await resolveShopifyAccessToken(settings, { forceRefresh: true });
  const targetOrigin = (baseUrl || settings.canonical_domain || 'https://aldridgeautosupply.com').replace(/\/+$/, '');
  const webhookAddress = `${targetOrigin}/api/webhooks/shopify`;

  if (!auth.shopDomain || !auth.token || auth.authMode === 'shpss_missing_client_id') {
    return {
      ok: false,
      mode: 'unconfigured',
      auth_mode: auth.authMode,
      address: webhookAddress,
      required_topics: REQUIRED_SHOPIFY_WEBHOOK_TOPICS,
      registered: [],
      created: [],
      missing: REQUIRED_SHOPIFY_WEBHOOK_TOPICS,
      errors: []
    };
  }

  let activeToken = auth.token;
  const listUrl = `https://${auth.shopDomain}/admin/api/2025-01/webhooks.json?limit=250`;
  let listResp = await fetch(listUrl, {
    headers: { 'X-Shopify-Access-Token': activeToken, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(12000)
  });
  if (listResp.status === 401 && auth.authMode === 'client_credentials') {
    const refreshed = await resolveShopifyAccessToken(settings, { forceRefresh: true });
    activeToken = refreshed.token;
    listResp = await fetch(listUrl, {
      headers: { 'X-Shopify-Access-Token': activeToken, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });
  }
  if (!listResp.ok) {
    const errBody = await listResp.text().catch(() => '');
    throw new Error(`Shopify GET /webhooks.json failed (HTTP ${listResp.status}): ${errBody.slice(0, 180)}`);
  }

  const listData = await listResp.json();
  const existingWebhooks = Array.isArray(listData.webhooks) ? listData.webhooks : [];
  const existingByTopic = new Map();
  for (const wh of existingWebhooks) {
    const normAddr = String(wh.address || '').replace(/\/+$/, '').toLowerCase();
    if (normAddr === webhookAddress.toLowerCase()) {
      existingByTopic.set(String(wh.topic || '').toLowerCase(), wh);
    }
  }

  const alreadyRegistered = [];
  const created = [];
  const errors = [];

  for (const topic of REQUIRED_SHOPIFY_WEBHOOK_TOPICS) {
    const found = existingByTopic.get(topic);
    if (found) {
      alreadyRegistered.push({ id: found.id, topic: found.topic, address: found.address, format: found.format });
      continue;
    }
    if (!registerMissing) continue;

    try {
      const postResp = await fetch(`https://${auth.shopDomain}/admin/api/2025-01/webhooks.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': activeToken,
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          webhook: {
            topic,
            address: webhookAddress,
            format: 'json'
          }
        }),
        signal: AbortSignal.timeout(12000)
      });
      const postText = await postResp.text().catch(() => '');
      let postData = {};
      try { postData = JSON.parse(postText || '{}'); } catch (_) {}
      if (!postResp.ok || !postData.webhook) {
        errors.push({ topic, status: postResp.status, error: postData.errors || postText.slice(0, 200) });
      } else {
        created.push({
          id: postData.webhook.id,
          topic: postData.webhook.topic,
          address: postData.webhook.address,
          format: postData.webhook.format
        });
      }
    } catch (err) {
      errors.push({ topic, error: err.message });
    }
  }

  const allRegistered = [...alreadyRegistered, ...created];
  const registeredTopics = new Set(allRegistered.map((w) => String(w.topic).toLowerCase()));
  const missing = REQUIRED_SHOPIFY_WEBHOOK_TOPICS.filter((t) => !registeredTopics.has(t));

  logSync(
    'outbound',
    'shopify_webhooks',
    registerMissing ? 'auto_register_webhooks' : 'check_webhooks',
    'ALL',
    errors.length === 0 && missing.length === 0 ? 'success' : 'partial',
    `Shopify webhooks on ${auth.shopDomain} -> ${webhookAddress}: ${alreadyRegistered.length} already active, ${created.length} newly registered, ${missing.length} missing, ${errors.length} error(s).`
  );

  return {
    ok: errors.length === 0 && missing.length === 0,
    shop_domain: auth.shopDomain,
    auth_mode: auth.authMode,
    address: webhookAddress,
    required_topics: REQUIRED_SHOPIFY_WEBHOOK_TOPICS,
    already_registered: alreadyRegistered,
    created,
    registered: allRegistered,
    missing,
    errors,
    total_store_webhooks: existingWebhooks.length + created.length
  };
}

async function inspectLiveShopifyProducts(skus = []) {
  const settings = getSettings();
  const auth = await resolveShopifyAccessToken(settings);
  if (!auth.shopDomain || !auth.token || auth.authMode === 'shpss_missing_client_id') {
    return { ok: false, error: 'Shopify Admin API not configured', products: [] };
  }
  const domain = auth.shopDomain;
  const tokenRef = { token: auth.token };
  const targetSkus = (Array.isArray(skus) && skus.length ? skus : ['ALD-12TOY-COOLANT-RESE-P0840', 'ALD-KEEP-P0818', 'ALD-KEEP-P0294', 'ALD-KEEP-P0544', 'ALD-KEEP-P0691'])
    .map((s) => String(s || '').trim().toUpperCase())
    .filter(Boolean);

  const out = [];
  for (const sku of targetSkus) {
    const dbRow = db.prepare('SELECT * FROM inventory_items WHERE UPPER(sku) = ?').get(sku);
    let productId = dbRow?.shopify_product_id || '';
    if (!productId) {
      const handle = sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const searchResp = await shopifyFetchWithRetry(
        `https://${domain}/admin/api/2025-01/products.json?handle=${encodeURIComponent(handle)}&limit=1`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        { authMode: auth.authMode, settings, tokenRef }
      );
      if (searchResp.ok) {
        const sData = await searchResp.json();
        productId = String(sData?.products?.[0]?.id || '');
      }
    }
    if (!productId) {
      out.push({ sku, found: false });
      continue;
    }

    const pResp = await shopifyFetchWithRetry(
      `https://${domain}/admin/api/2025-01/products/${productId}.json`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      { authMode: auth.authMode, settings, tokenRef }
    );
    if (!pResp.ok) {
      out.push({ sku, found: false, http_status: pResp.status });
      continue;
    }
    const p = (await pResp.json()).product || {};
    const v = (p.variants || [])[0] || {};

    let countryOfOrigin = '';
    if (v.inventory_item_id) {
      const invResp = await shopifyFetchWithRetry(
        `https://${domain}/admin/api/2025-01/inventory_items/${v.inventory_item_id}.json`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        { authMode: auth.authMode, settings, tokenRef }
      );
      if (invResp.ok) {
        const invData = await invResp.json();
        countryOfOrigin = invData?.inventory_item?.country_code_of_origin || '';
      }
    }

    let category = null;
    const metafields = {};
    const gqlResp = await shopifyFetchWithRetry(
      `https://${domain}/admin/api/2025-01/graphql.json`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query: `query InspectProd($id: ID!) {
            product(id: $id) {
              id
              category { id fullName }
              metafields(first: 30) {
                edges { node { namespace key value } }
              }
            }
          }`,
          variables: { id: `gid://shopify/Product/${productId}` }
        })
      },
      { authMode: auth.authMode, settings, tokenRef }
    );
    if (gqlResp.ok) {
      const gqlData = await gqlResp.json();
      category = gqlData?.data?.product?.category || null;
      for (const edge of gqlData?.data?.product?.metafields?.edges || []) {
        if (edge?.node) {
          metafields[`${edge.node.namespace}.${edge.node.key}`] = edge.node.value;
        }
      }
    }

    const imgs = (p.images || []).map((im) => ({
      position: im.position,
      src: im.src,
      alt: im.alt,
      is_qr: isQrCardUrl(im.src) || /scan qr/i.test(String(im.alt || ''))
    }));

    const rawHtml = String(p.body_html || '');
    const rawHtmlText = rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const expectedNonQrAlt = buildExpectedShopifyImageAlt({ sku, title: p.title, security_mark_code: dbRow?.security_mark_code || '' }, false);
    const expectedQrAlt = buildExpectedShopifyImageAlt({ sku, title: p.title, security_mark_code: dbRow?.security_mark_code || '' }, true);
    const allAltsClean = imgs.length > 0 && imgs.every((im) => {
      const a = String(im.alt || '').trim();
      if (im.is_qr) return a === expectedQrAlt || (a.includes(sku) && /Scan QR for Aldridge Auto's App/i.test(a));
      return a === expectedNonQrAlt && !/tested oem auto part|manual review needed|oem driver seat/i.test(a);
    });

    out.push({
      sku,
      found: true,
      shopify_product_id: String(p.id),
      handle: p.handle,
      status: p.status,
      title: p.title,
      vendor: p.vendor,
      product_type: p.product_type,
      category,
      country_code_of_origin: countryOfOrigin,
      variants_count: Array.isArray(p.variants) ? p.variants.length : 0,
      price: v.price,
      inventory_quantity: v.inventory_quantity,
      weight_lbs: v.weight,
      weight_unit: v.weight_unit,
      requires_shipping: v.requires_shipping,
      tags: p.tags,
      metafields,
      images_count: imgs.length,
      image_alts: imgs.map((im) => im.alt || ''),
      all_image_alts_clean: allAltsClean,
      first_photo_is_real: imgs.length > 0 ? !imgs[0].is_qr : false,
      qr_in_final_slot: imgs.length > 0 ? Boolean(imgs[imgs.length - 1].is_qr) : false,
      has_174_99_in_html: rawHtmlText.includes('174.99'),
      has_135_in_html: /\$135(\.00)?\s*\/\s*hr/i.test(rawHtmlText),
      has_pickup_address_in_html: /5115\s+66th\s+St\s+W/i.test(rawHtmlText) && /98467/.test(rawHtmlText),
      has_drive_url_in_html: /drive\.google\.com|Drive Photo Ref/i.test(rawHtml),
      body_html_preview: rawHtmlText.slice(0, 320)
    });
  }

  return { ok: true, shop_domain: domain, count: out.length, products: out };
}

/**
 * FULL CLEAN-SLATE SHOPIFY PRE-VIN ARCHIVE/PURGE:
 * Paginates ALL live products on the connected Shopify store and archives + zeros
 * every listing that does NOT correspond to an active verified VIN-intake SKU in SQLite.
 */
async function purgeAllShopifyPreVinListings({ deleteProducts = false, forceEmptyDb = false } = {}) {
  const settings = getSettings();
  const auth = await resolveShopifyAccessToken(settings, { forceRefresh: true });
  if (!auth.shopDomain || !auth.token || auth.authMode === 'shpss_missing_client_id') {
    return {
      ok: false,
      mode: 'not_configured',
      archived_count: 0,
      deleted_count: 0,
      zeroed_inventory_count: 0,
      message: 'Shopify Admin API credentials not configured in this environment.'
    };
  }

  const domain = auth.shopDomain;
  const tokenRef = { token: auth.token };
  const verifiedActiveSkus = new Set(
    db.prepare(`
      SELECT UPPER(sku) AS sku
      FROM inventory_items
      WHERE status = 'active'
        AND quantity > 0
        AND COALESCE(verified_vin, '') != ''
        AND COALESCE(intake_session_id, '') != ''
        AND COALESCE(intake_source, '') = 'vin_intake_pipeline'
    `).all().map((r) => r.sku)
  );

  // SAFETY GUARD (v32.2): Never archive live Shopify products when local ephemeral SQLite is empty!
  if (verifiedActiveSkus.size === 0 && !forceEmptyDb) {
    return {
      ok: true,
      mode: 'aborted_empty_local_db_guard',
      shop_domain: domain,
      total_scanned: 0,
      archived_count: 0,
      deleted_count: 0,
      already_archived_count: 0,
      zeroed_inventory_count: 0,
      kept_verified_vin_count: 0,
      errors: [],
      message: 'Safety guard aborted clean-slate Shopify purge because local SQLite has 0 verified active SKUs.'
    };
  }

  const liveProducts = [];
  let nextUrl = `https://${domain}/admin/api/2025-01/products.json?limit=250&fields=id,handle,title,status,variants`;
  while (nextUrl) {
    const resp = await shopifyFetchWithRetry(
      nextUrl,
      { method: 'GET', headers: { Accept: 'application/json' } },
      { authMode: auth.authMode, settings, tokenRef }
    );
    if (!resp.ok) {
      throw new Error(`Shopify product scan failed during clean-slate purge (HTTP ${resp.status})`);
    }
    const data = await resp.json();
    for (const p of data.products || []) liveProducts.push(p);
    const link = resp.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = m ? m[1] : null;
  }

  let archivedCount = 0;
  let deletedCount = 0;
  let zeroedCount = 0;
  let keptVerifiedCount = 0;
  let alreadyArchivedCount = 0;
  const errors = [];

  for (const p of liveProducts) {
    const skus = (p.variants || []).map((v) => String(v.sku || '').trim().toUpperCase()).filter(Boolean);
    const isVerifiedVinItem = skus.length > 0 && skus.every((s) => verifiedActiveSkus.has(s));
    if (isVerifiedVinItem) {
      keptVerifiedCount++;
      continue;
    }

    try {
      if (deleteProducts) {
        const delResp = await shopifyFetchWithRetry(
          `https://${domain}/admin/api/2025-01/products/${p.id}.json`,
          { method: 'DELETE', headers: { Accept: 'application/json' } },
          { authMode: auth.authMode, settings, tokenRef }
        );
        if (delResp.ok) deletedCount++;
        else errors.push(`delete ${p.id}: HTTP ${delResp.status}`);
      } else {
        if (p.status !== 'archived') {
          const archResp = await shopifyFetchWithRetry(
            `https://${domain}/admin/api/2025-01/products/${p.id}.json`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                product: {
                  id: Number(p.id),
                  status: 'archived',
                  tags: 'PRE-VIN-PURGED, ARCHIVED-CLEAN-SLATE'
                }
              })
            },
            { authMode: auth.authMode, settings, tokenRef }
          );
          if (archResp.ok) archivedCount++;
          else errors.push(`archive ${p.id}: HTTP ${archResp.status}`);
        } else {
          alreadyArchivedCount++;
        }

        // Zero inventory levels on every variant
        for (const v of p.variants || []) {
          if (Number(v.inventory_quantity || 0) > 0 && v.inventory_item_id) {
            try {
              const lvlResp = await shopifyFetchWithRetry(
                `https://${domain}/admin/api/2025-01/inventory_levels.json?inventory_item_ids=${v.inventory_item_id}`,
                { method: 'GET', headers: { Accept: 'application/json' } },
                { authMode: auth.authMode, settings, tokenRef }
              );
              if (lvlResp.ok) {
                const lvlData = await lvlResp.json();
                for (const lvl of lvlData.inventory_levels || []) {
                  if (Number(lvl.available || 0) > 0) {
                    const setResp = await shopifyFetchWithRetry(
                      `https://${domain}/admin/api/2025-01/inventory_levels/set.json`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify({
                          location_id: lvl.location_id,
                          inventory_item_id: Number(v.inventory_item_id),
                          available: 0
                        })
                      },
                      { authMode: auth.authMode, settings, tokenRef }
                    );
                    if (setResp.ok) zeroedCount++;
                  }
                }
              }
            } catch (_) {}
          }
        }
      }
      await new Promise((r) => setTimeout(r, 240));
    } catch (err) {
      errors.push(`purge ${p.id}: ${err.message}`);
    }
  }

  logSync(
    'outbound',
    'shopify_clean_slate_purge',
    deleteProducts ? 'delete_pre_vin_products' : 'archive_pre_vin_products',
    'ALL',
    errors.length ? 'partial' : 'success',
    `Shopify clean-slate purge on ${domain}: scanned=${liveProducts.length}, archived=${archivedCount}, deleted=${deletedCount}, already_archived=${alreadyArchivedCount}, zeroed_qty=${zeroedCount}, kept_vin_verified=${keptVerifiedCount}, errors=${errors.length}.`
  );

  return {
    ok: errors.length === 0,
    mode: 'live_api',
    shop_domain: domain,
    total_scanned: liveProducts.length,
    archived_count: archivedCount,
    deleted_count: deletedCount,
    already_archived_count: alreadyArchivedCount,
    zeroed_inventory_count: zeroedCount,
    kept_verified_vin_count: keptVerifiedCount,
    errors
  };
}

/**
 * SHOPIFY CO-MASTER SELF-HEALING HYDRATION & REACTIVATION (v32.2):
 * Restores verified 7-Vehicle Allowlist products directly from Shopify (aldridgesales.myshopify.com)
 * back into local SQLite on Render container cold-starts/deploys — ZERO data loss even on ephemeral disks!
 * When reactivateAccidentallyArchived=true, also re-activates verified allowlist products that were
 * accidentally tagged ARCHIVED-CLEAN-SLATE while keeping all non-allowlist/disposed products archived.
 */
async function hydrateInventoryFromShopifyCoMaster({
  onlyActive = true,
  reactivateAccidentallyArchived = false,
  skipExisting = true
} = {}) {
  const settings = getSettings();
  const auth = await resolveShopifyAccessToken(settings, { forceRefresh: true });
  if (!auth.shopDomain || !auth.token || auth.authMode === 'shpss_missing_client_id') {
    return {
      ok: false,
      mode: 'not_configured',
      scanned: 0,
      hydrated_count: 0,
      reactivated_on_shopify: 0,
      errors: []
    };
  }

  const domain = auth.shopDomain;
  const tokenRef = { token: auth.token };
  const graphqlUrl = `https://${domain}/admin/api/2025-01/graphql.json`;

  const query = `
    query HydrateAllowlistProducts($cursor: String) {
      products(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          handle
          title
          descriptionHtml
          productType
          vendor
          status
          tags
          createdAt
          updatedAt
          images(first: 10) {
            nodes { url altText }
          }
          variants(first: 1) {
            nodes {
              id
              sku
              price
              inventoryQuantity
              inventoryItem {
                id
                measurement {
                  weight { value unit }
                }
              }
            }
          }
          metafields(first: 25) {
            nodes { namespace key value }
          }
        }
      }
    }
  `;

  const allNodes = [];
  let cursor = null;
  let pages = 0;
  while (pages < 60) {
    pages++;
    const resp = await shopifyFetchWithRetry(
      graphqlUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables: { cursor } })
      },
      { authMode: auth.authMode, settings, tokenRef }
    );
    if (!resp.ok) {
      throw new Error(`Shopify GraphQL hydration scan failed (HTTP ${resp.status})`);
    }
    const payload = await resp.json();
    const conn = payload?.data?.products;
    const nodes = conn?.nodes || [];
    for (const n of nodes) allNodes.push(n);
    if (!conn?.pageInfo?.hasNextPage || !conn?.pageInfo?.endCursor) break;
    cursor = conn.pageInfo.endCursor;
    await new Promise((r) => setTimeout(r, 120));
  }

  const stripHtmlToText = (html = '') =>
    String(html || '')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

  const extractNumericId = (gid = '') => {
    const m = String(gid || '').match(/(\d+)$/);
    return m ? m[1] : '';
  };

  // Deduplicate by SKU and by (VIN + normalized title), keeping the newest/richest v32.1 product
  const winnersByTitleKey = new Map();
  let skippedNonAllowlist = 0;
  let skippedArchived = 0;
  let skippedNoPhoto = 0;

  for (const node of allNodes) {
    const statusUpper = String(node.status || '').toUpperCase();
    const tags = Array.isArray(node.tags) ? node.tags : [];
    const tagBlob = tags.join(', ');
    const isCleanSlateVictim = statusUpper === 'ARCHIVED' && /ARCHIVED-CLEAN-SLATE/i.test(tagBlob);
    const isActive = statusUpper === 'ACTIVE';

    if (onlyActive && !isActive) {
      skippedArchived++;
      continue;
    }
    if (!isActive && !(reactivateAccidentallyArchived && isCleanSlateVictim)) {
      skippedArchived++;
      continue;
    }

    const v0 = (node.variants?.nodes || [])[0];
    const sku = String(v0?.sku || '').trim().toUpperCase();
    const qty = Number(v0?.inventoryQuantity ?? 0);
    if (!sku || qty <= 0) {
      skippedArchived++;
      continue;
    }

    const meta = {};
    for (const mf of node.metafields?.nodes || []) {
      meta[`${mf.namespace}.${mf.key}`] = String(mf.value || '').trim();
    }

    let vin = String(meta['custom.donor_vin'] || '').trim().toUpperCase();
    if (!vin) {
      const vinTag = tags.find((t) => /^VIN:[A-HJ-NPR-Z0-9]{17}$/i.test(String(t || '').trim()));
      if (vinTag) vin = String(vinTag).split(':')[1].trim().toUpperCase();
    }
    if (!vin || !ALLOWED_ACTIVE_DONOR_VINS.has(vin)) {
      skippedNonAllowlist++;
      continue;
    }

    const slot = ACTIVE_DONOR_ALLOWLIST.find((s) => s.vin === vin);
    if (!slot) {
      skippedNonAllowlist++;
      continue;
    }

    const cleanTitle = cleanListingTitle(String(node.title || '').trim()).slice(0, 80);
    const plainDesc = stripOffPlatformViolations(stripHtmlToText(node.descriptionHtml || '')).slice(0, 1200);
    const productType = String(node.productType || 'Auto Parts').trim() || 'Auto Parts';
    const fitYear = String(meta['custom.fitment_years'] || slot.years[0] || '').trim();
    const allowCheck = isAllowedActiveDonorVehicle({
      vin,
      year: fitYear,
      make: slot.make,
      model: slot.model,
      title: cleanTitle
    });
    if (!allowCheck.allowed) {
      skippedNonAllowlist++;
      continue;
    }
    if (
      isGhostOrBannedInventoryItem({ sku, title: cleanTitle, verified_vin: vin }).blocked ||
      !validatePartCompliance({ title: cleanTitle, category: productType, description: plainDesc }).compliant
    ) {
      skippedNonAllowlist++;
      continue;
    }

    const photoUrls = (node.images?.nodes || [])
      .map((img) => String(img?.url || '').trim())
      .filter((u) => /^https?:\/\//i.test(u) && !isQrCardUrl(u) && !isGoogleDriveViewerUrl(u));
    if (!photoUrls.length) {
      skippedNoPhoto++;
      continue;
    }

    const numericId = BigInt(extractNumericId(node.id) || '0');
    const richnessScore =
      (isActive ? 1000 : 0) +
      (meta['custom.donor_vin'] ? 100 : 0) +
      (meta['custom.oem_part_number'] ? 50 : 0) +
      (meta['custom.packed_dimensions'] ? 25 : 0) +
      (photoUrls.length * 2);

    const normTitleKey = `${vin}|${cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    const existing = winnersByTitleKey.get(normTitleKey);
    if (
      !existing ||
      richnessScore > existing.richnessScore ||
      (richnessScore === existing.richnessScore && numericId > existing.numericId)
    ) {
      winnersByTitleKey.set(normTitleKey, {
        node,
        v0,
        sku,
        vin,
        slot,
        meta,
        tags,
        cleanTitle,
        plainDesc,
        productType,
        fitYear,
        photoUrls,
        numericId,
        isActive,
        isCleanSlateVictim,
        richnessScore
      });
    }
  }

  // Upsert donor_vehicles, vin_intake_sessions, and inventory_items into SQLite
  const now = new Date().toISOString();
  const donorIdByVin = new Map();
  const sessionCodeByVin = new Map();
  const existingSkusInDb = new Set(
    db.prepare('SELECT UPPER(sku) AS sku FROM inventory_items').all().map((r) => r.sku)
  );

  let hydratedCount = 0;
  let updatedCount = 0;
  let reactivatedOnShopify = 0;
  const errors = [];

  for (const w of winnersByTitleKey.values()) {
    try {
      let donorId = donorIdByVin.get(w.vin);
      if (!donorId) {
        let donor = db.prepare('SELECT id FROM donor_vehicles WHERE UPPER(vin) = ?').get(w.vin);
        if (!donor) {
          const stockNum = `DON-${w.slot.years[0]}-${w.slot.make.slice(0, 3).toUpperCase()}-${w.vin.slice(-5)}`;
          const dRes = db.prepare(`
            INSERT INTO donor_vehicles (
              org_id, stock_number, vin, year, make, model, trim, engine, transmission, drivetrain,
              status, notes, created_at
            ) VALUES (1, ?, ?, ?, ?, ?, '', '', 'Automatic', '', 'active', ?, ?)
          `).run(
            stockNum, w.vin, Number(w.slot.years[0] || 2010), w.slot.make, w.slot.model,
            `Auto-hydrated from Shopify Co-Master (${domain})`, now
          );
          donorId = Number(dRes.lastInsertRowid);
        } else {
          donorId = Number(donor.id);
        }
        donorIdByVin.set(w.vin, donorId);
      }

      let sessionCode = sessionCodeByVin.get(w.vin);
      if (!sessionCode) {
        sessionCode = `VIN-SHP-${w.vin.slice(-6)}`;
        const sess = db.prepare('SELECT session_code FROM vin_intake_sessions WHERE UPPER(session_code) = ?').get(sessionCode);
        if (!sess) {
          db.prepare(`
            INSERT INTO vin_intake_sessions (
              org_id, session_code, staff_name, vin, year, make, model,
              donor_vehicle_id, status, created_at, updated_at
            ) VALUES (1, ?, 'Shopify Co-Master Hydration', ?, ?, ?, ?, ?, 'active', ?, ?)
          `).run(sessionCode, w.vin, Number(w.slot.years[0] || 2010), w.slot.make, w.slot.model, donorId, now, now);
        }
        sessionCodeByVin.set(w.vin, sessionCode);
      }

      // Parse weight & dimensions cleanly
      let weightLbs = Number(w.v0?.inventoryItem?.measurement?.weight?.value || 0);
      const weightUnit = String(w.v0?.inventoryItem?.measurement?.weight?.unit || 'POUNDS').toUpperCase();
      if (weightUnit === 'GRAMS') weightLbs = Number((weightLbs / 453.59237).toFixed(2));
      else if (weightUnit === 'KILOGRAMS') weightLbs = Number((weightLbs * 2.20462).toFixed(2));
      else if (weightUnit === 'OUNCES') weightLbs = Number((weightLbs / 16).toFixed(2));

      let lengthIn = 0;
      let widthIn = 0;
      let heightIn = 0;
      const dimsMeta = String(w.meta['custom.packed_dimensions'] || w.meta['custom.package_dimensions'] || '');
      const dimMatch = dimsMeta.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
      if (dimMatch) {
        lengthIn = Number(dimMatch[1]);
        widthIn = Number(dimMatch[2]);
        heightIn = Number(dimMatch[3]);
      }
      const fallbackDims = resolvePartDimensionsAndWeight(w.cleanTitle, w.productType);
      if (!weightLbs || weightLbs <= 0) weightLbs = Number(fallbackDims.weight_lbs || 5);
      if (!lengthIn || !widthIn || !heightIn) {
        lengthIn = Number(fallbackDims.length_in || 12);
        widthIn = Number(fallbackDims.width_in || 9);
        heightIn = Number(fallbackDims.height_in || 6);
      }

      const shipClass =
        /Local_Pickup_Only/i.test(w.meta['custom.fulfillment_type'] || '') || weightLbs >= 70
          ? 'local_pickup_only'
          : computeShippingClass(weightLbs, `${w.productType} ${w.cleanTitle}`, lengthIn, widthIn, heightIn);

      const price = Math.max(15, Number(w.v0?.price || 45));
      const laborRate = Number(settings.labor_rate_hourly || settings.shop_labor_rate || 174.99);
      const bookTime = resolveCategoryBookTimeLabor({ title: w.cleanTitle, category: w.productType }, laborRate);
      const priceInstall = Number((price + bookTime.labor_cost).toFixed(2));
      const oemMpn =
        String(w.meta['custom.oem_part_number'] || w.meta['custom.oem_mpn'] || w.meta['mm-google-shopping.mpn'] || '').trim() ||
        resolveStructuredOemMpn({ sku: w.sku, title: w.cleanTitle, fitment_years: w.fitYear, fitment_make: w.slot.make });
      const binLoc =
        String(w.meta['custom.bin_location'] || '').trim() ||
        `${w.slot.model.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8)}-${String(w.slot.years[0]).slice(-2)}-BAYB`;
      const secTag = w.tags.find((t) => /^SEC:/i.test(String(t || '')));
      const secCode = secTag ? String(secTag).replace(/^SEC:/i, '').trim() : generateSecurityCode();
      const prodId = extractNumericId(w.node.id);
      const varId = extractNumericId(w.v0?.id);
      const invItemId = extractNumericId(w.v0?.inventoryItem?.id);

      const channelsJson = JSON.stringify({
        shopify: true,
        shopify_marketplace_connect: true,
        ebay_motors: true,
        google_merchant: true,
        meta_catalog: true,
        crosslist: true
      });

      if (!existingSkusInDb.has(w.sku)) {
        db.prepare(`
          INSERT INTO inventory_items (
            sku, title, category, condition, condition_id, brand, oem_part_number,
            donor_vehicle_id, verified_vin, intake_session_id, intake_source,
            fitment_years, fitment_make, fitment_model, description, defect_disclosure,
            bin_location, security_mark_code, security_mark_verified, photos_json,
            pull_status, allow_self_pull, price_self_pull, allow_we_pull, price_we_pull,
            allow_pull_install, price_pull_install, install_labor_hours, quantity,
            weight_lbs, length_in, width_in, height_in, shipping_class,
            handling_fee, handling_days, channels_json,
            shopify_product_id, shopify_variant_id, shopify_inventory_item_id,
            status, created_at, updated_at
          ) VALUES (
            ?, ?, ?, 'Used - Tested Good', 3000, ?, ?,
            ?, ?, ?, 'vin_intake_pipeline',
            ?, ?, ?, ?, 'Tested OEM part — verified donor VIN.',
            ?, ?, 1, ?,
            'pulled', 0, ?, 1, ?,
            1, ?, ?, 1,
            ?, ?, ?, ?, ?,
            10, 3, ?,
            ?, ?, ?,
            'active', ?, ?
          )
        `).run(
          w.sku, w.cleanTitle, w.productType, w.slot.make.toUpperCase(), oemMpn,
          donorId, w.vin, sessionCode,
          w.fitYear || String(w.slot.years[0]), w.slot.make, w.slot.model,
          w.plainDesc || `Verified OEM ${w.cleanTitle}.`,
          binLoc, secCode, JSON.stringify(w.photoUrls),
          price, price, priceInstall, bookTime.hours,
          weightLbs, lengthIn, widthIn, heightIn, shipClass,
          channelsJson,
          prodId, varId, invItemId,
          now, now
        );
        existingSkusInDb.add(w.sku);
        hydratedCount++;
      } else if (!skipExisting) {
        db.prepare(`
          UPDATE inventory_items
          SET shopify_product_id = ?, shopify_variant_id = ?, shopify_inventory_item_id = ?,
              photos_json = ?, status = 'active', quantity = 1, updated_at = ?
          WHERE UPPER(sku) = ?
        `).run(prodId, varId, invItemId, JSON.stringify(w.photoUrls), now, w.sku);
        updatedCount++;
      }

      // If requested, reactivate verified allowlist products that were accidentally archived by ARCHIVED-CLEAN-SLATE
      if (reactivateAccidentallyArchived && w.isCleanSlateVictim && prodId) {
        const cleanTags = [
          ...new Set([
            ...w.tags.filter((t) => !/ARCHIVED-CLEAN-SLATE|PRE-VIN-PURGED|DISPOSED-FLEET-ARCHIVED/i.test(String(t || ''))),
            w.fitYear || String(w.slot.years[0]),
            `${w.fitYear || w.slot.years[0]} ${w.slot.make} ${w.slot.model}`,
            w.slot.make,
            w.slot.model,
            `VIN:${w.vin}`,
            `BIN:${binLoc}`,
            `MPN:${oemMpn}`,
            'Genuine OEM',
            'Used OEM',
            'Single-Unit-In-Stock',
            shipClass === 'local_pickup_only' ? 'Local_Pickup_Only' : 'Parcel_Calculated'
          ])
        ].filter(Boolean).join(', ');

        const putResp = await shopifyFetchWithRetry(
          `https://${domain}/admin/api/2025-01/products/${prodId}.json`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              product: {
                id: Number(prodId),
                status: 'active',
                tags: cleanTags
              }
            })
          },
          { authMode: auth.authMode, settings, tokenRef }
        );
        if (putResp.ok) {
          reactivatedOnShopify++;
        } else {
          errors.push(`reactivate ${w.sku} (${prodId}): HTTP ${putResp.status}`);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      errors.push(`hydrate ${w.sku}: ${err.message}`);
    }
  }

  logSync(
    'inbound',
    'shopify_comaster_hydration',
    reactivateAccidentallyArchived ? 'restore_and_reactivate_verified' : 'startup_hydrate_verified',
    'ALL',
    errors.length ? 'partial' : 'success',
    `Hydrated ${hydratedCount} verified 7-vehicle SKUs from ${domain} (scanned=${allNodes.length}, winners=${winnersByTitleKey.size}, reactivated_on_shopify=${reactivatedOnShopify}, skipped_non_allowlist=${skippedNonAllowlist}, skipped_archived=${skippedArchived}, errors=${errors.length}).`
  );

  return {
    ok: errors.length === 0,
    mode: 'live_api',
    shop_domain: domain,
    scanned: allNodes.length,
    winners_count: winnersByTitleKey.size,
    hydrated_count: hydratedCount,
    updated_count: updatedCount,
    reactivated_on_shopify: reactivatedOnShopify,
    skipped_non_allowlist: skippedNonAllowlist,
    skipped_archived: skippedArchived,
    skipped_no_photo: skippedNoPhoto,
    errors
  };
}

module.exports = {
  parseCsv,
  getValidPhotos,
  getShopifyGalleryPhotos,
  hasRealPhotos,
  renderShopifyHtml,
  renderEbayHtml,
  importInventoryCsv,
  generateMasterImportTemplateCsv,
  generateShopifyCsv,
  generateEbayMotorsCsv,
  generateEbayFreightCsv,
  generateGoogleMerchantXml,
  generateMetaCatalogCsv,
  generateVendooOrCrosslistCsv,
  generateCraigslistCsv,
  generateTiktokShopCsv,
  generateCarPartHollanderCsv,
  renderLocalMarketplacePacket,
  resolveShopifyAccessToken,
  ensureShopifyWebhooksRegistered,
  inspectLiveShopifyProducts,
  syncAllToShopifyCoMaster,
  hydrateInventoryFromShopifyCoMaster,
  purgeAllShopifyPreVinListings,
  pushSingleItemToShopify,
  handleShopifyWebhook
};
