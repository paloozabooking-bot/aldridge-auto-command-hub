const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  db,
  DATA_DIR,
  getSettings,
  generateSecurityCode,
  computeShippingClass,
  validateVinStrict,
  validatePartCompliance,
  validateInventoryItemForPublish,
  logSync
} = require('./db');
const { generateAllPolicies } = require('./policies');
const { csvEscape, xmlEscape, parseCsv } = require('./exporters-csv-utils');
const { isQrCardUrl, generatePartQrCardPng } = require('./qr-card');
const { resolvePartTaxonomyAndMetafields, sanitizeVerifiedMpn, resolveCountryOfOrigin } = require('./taxonomy');
const {
  PROHIBITED_CAT_SKUS,
  PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS,
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

// Marketplace-Safe Clean Photos ONLY (excludes QR/info cards for eBay Motors & Google Merchant Center)
function getValidPhotos(item) {
  return extractRawPhotoArray(item)
    .map((u) => String(u || '').trim())
    .filter((u) => u && u !== '/assets/oem-parts.jpg' && !isGoogleDriveViewerUrl(u) && !isQrCardUrl(u));
}

function hasRealPhotos(item) {
  return getValidPhotos(item).length > 0;
}

// Shopify Gallery Photos: 1..N Clean Real Part Photos + Final (N+1) QR-Branded Info & App Card
function getShopifyGalleryPhotos(item, settings, uploadsDir) {
  const cleanPhotos = getValidPhotos(item);
  if (!cleanPhotos.length) return [];

  const existingQrCdn = extractRawPhotoArray(item)
    .map((u) => String(u || '').trim())
    .find((u) => /^https?:\/\//i.test(u) && isQrCardUrl(u));

  const dir = uploadsDir || path.join(DATA_DIR, 'uploads');
  const safeSku = String(item?.sku || 'ALD-PART').replace(/[^A-Za-z0-9-]/g, '').toUpperCase() || 'ALD-PART';
  const qrPublicPath = `/uploads/${safeSku}.qr.png`;
  const qrAbsPath = path.join(dir, `${safeSku}.qr.png`);

  if (!fs.existsSync(qrAbsPath)) {
    generatePartQrCardPng(item, settings || getSettings(), dir);
  }

  const finalQrImage = existingQrCdn || qrPublicPath;
  return [...cleanPhotos, finalQrImage];
}

function isMarketplaceSafeItem(item) {
  if (!item || item.quantity <= 0 || item.status !== 'active') return false;
  const vVin = String(item.verified_vin || '').trim().toUpperCase();
  const isTitleCheckOverride =
    vVin === 'VIN-TITLE-CHECK' &&
    Boolean(item.intake_session_id) &&
    item.intake_source === 'vin_intake_pipeline' &&
    Boolean(
      db.prepare("SELECT id FROM vin_intake_sessions WHERE UPPER(session_code) = ? AND vin = 'VIN-TITLE-CHECK' AND status = 'active'").get(String(item.intake_session_id).toUpperCase())
    );
  if ((!vVin || !validateVinStrict(vVin).valid) && !isTitleCheckOverride) return false;
  if (!item.intake_session_id || item.intake_source !== 'vin_intake_pipeline') return false;
  if (!hasRealPhotos(item)) return false;
  const skuUpper = String(item.sku || '').trim().toUpperCase();
  if (PROHIBITED_CAT_SKUS.has(skuUpper) || PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS.has(skuUpper)) {
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
 * PERMANENT PRE-EXPORT DEDUPLICATION & MANDATORY VIN-INTAKE GATE:
 * Runs deduplicateCatalog() before every marketplace CSV/XML export and strictly
 * excludes any item that did not enter through the verified VIN/Plate Intake Pipeline.
 */
function ensureDeduplicatedItems(items) {
  try {
    const { deduplicateCatalog } = require('./catalog-enrichment');
    deduplicateCatalog();
  } catch (_) {}
  if (!Array.isArray(items) || !items.length) return [];
  const activeRows = db.prepare(`
    SELECT sku, status, quantity, photos_json, verified_vin, intake_session_id, intake_source
    FROM inventory_items
    WHERE status = 'active'
      AND COALESCE(verified_vin, '') != ''
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
      intake_source: live.intake_source
    });
  }
  return out;
}

function sanitizeMpnField(rawMpn) {
  const clean = sanitizeVerifiedMpn(rawMpn);
  if (!clean) return '';
  return isCounterfeitMpn(clean) ? '' : clean;
}

function resolveExportMpn(rawMpn) {
  // STRICT ANTI-PLACEHOLDER RULE: NEVER output "Does Not Apply" or fake hex/year-make tokens as MPN.
  return sanitizeMpnField(rawMpn);
}

function normalizeExportCondition(rawCondition) {
  const c = String(rawCondition || 'Used').trim().toLowerCase();
  if (c === 'new') return 'New';
  if (c.includes('reman') || c.includes('rebuilt')) return 'Used';
  return 'Used';
}

function isHeavyLocalPickupItem(item, settings) {
  const threshold = Number(settings?.freight_weight_threshold_lbs || 70);
  return Number(item.weight_lbs || 0) >= threshold || item.shipping_class !== 'parcel_calculated';
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
  return `${Math.ceil(Number(item.length_in || 14))}x${Math.ceil(Number(item.width_in || 10))}x${Math.ceil(Number(item.height_in || 8))}`;
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
  return String(text || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b[a-z0-9-]+\.(com|net|org|io|app|shop|store|myshopify\.com)(\/\S*)?/gi, '')
    .replace(/\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
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

function buildExpectedShopifyImageAlt(item, isQr = false) {
  const sku = String(item?.sku || '').trim();
  const sec = String(item?.security_mark_code || '').trim();
  if (isQr) {
    return `${sku} Security Tag ${sec} - Scan QR for Aldridge Auto's App`.replace(/\s{2,}/g, ' ').trim().slice(0, 125);
  }
  const cleanTitle = String(item?.title || '').trim();
  const suffix = sku ? ` (${sku})` : '';
  const maxTitleLen = Math.max(20, 125 - suffix.length);
  return `${cleanTitle.slice(0, maxTitleLen).trim()}${suffix}`.trim();
}

function renderShopifyHtml(item, settings, baseUrl) {
  const policies = generateAllPolicies(settings);
  const tpl = policies.shopify_direct_html_template || policies.ebay_motors_html_template;
  const mpnOut = resolveExportMpn(item.oem_part_number);
  const mpnLabel = mpnOut || 'OEM Factory Part (Match Photos & VIN)';
  const interchangeLabel = sanitizeMpnField(item.interchange_number) || (item.hollander_number ? `Hollander #${item.hollander_number}` : 'Verify via Donor Fitment');
  const condOut = normalizeExportCondition(item.condition);
  const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
  const { installTotal, otdTotal, supplyFee, supplyCap, taxRate, hours, rate } = computeInstallEstimate(item, settings);
  const { pwaUrl } = resolveDirectPublicUrls(settings, baseUrl);
  const phone = settings.phone || '(253) 245-4206';

  const installCalloutHtml = `<div style="background:#f0f9ff;border:1px solid #0284c7;border-radius:6px;padding:12px 14px;margin-bottom:12px;font-size:13px;line-height:1.5;">
      <strong style="color:#0369a1;">🔧 OPTIONAL CERTIFIED SHOP BAY INSTALLATION (INFO-ONLY — SINGLE-UNIT PART):</strong><br/>
      Estimated Turnkey Part + Certified Installation at our 5.0★ University Place, WA 98467 bays: <strong>$${installTotal.toFixed(2)}</strong> part + labor <em>(~${hours.toFixed(1)} hrs certified technician labor @ $${rate.toFixed(2)}/hr; est. <strong>$${otdTotal.toFixed(2)}</strong> out-the-door incl. $${supplyFee.toFixed(2)} 7% shop supplies capped at $${supplyCap} + ${(taxRate * 100).toFixed(1)}% WA tax at 5115 66th St W, Bldg B)</em>.<br/>
      <span style="font-size:12px;color:#334155;">To prevent double-booking this 1-of-1 part, purchase the part here first to lock it in, then schedule your bay installation on our <a href="${pwaUrl}" style="color:#0369a1;font-weight:700;">Live Website &amp; Mobile App (${pwaUrl.replace(/^https?:\/\//i, '')})</a> or call/text <strong>${phone}</strong>.</span>
    </div>`;

  const directAppCalloutHtml = `<div style="background:#f8fafc;border:1px solid #0b1628;border-radius:6px;padding:12px 14px;margin-bottom:12px;font-size:12.5px;line-height:1.5;">
      <strong style="color:#0b1628;">📱 BUY DIRECT &amp; INSTALL THE ALDRIDGE AUTO'S MOBILE APP (SAVE ON MARKETPLACE FEES):</strong><br/>
      Shop our full verified photo catalog directly at <a href="${pwaUrl}" style="color:#ea580c;font-weight:700;">${pwaUrl}</a> and tap <strong>"Add to Home Screen"</strong> on iPhone or Android for instant 17-digit VIN checks, bay booking, and direct repeat-customer pricing!
    </div>`;

  const shipLabel = heavyPickupOnly
    ? 'Local Pickup Only in University Place, WA 98467'
    : `Calculated Parcel + $${Number(settings.handling_fee_default ?? 10).toFixed(2)} Handling`;

  const safeDesc = stripDriveUrlsFromPublicText(item.description || item.title);
  const safeNotes = stripDriveUrlsFromPublicText(item.fitment_notes) || 'Match OEM photos & VIN prior to purchase (Returns Not Accepted for remorse/fitment).';
  const safeDefect = stripDriveUrlsFromPublicText(item.defect_disclosure || 'Inspected & verified.');

  return tpl
    .replaceAll('{{BUSINESS_NAME}}', settings.business_name)
    .replaceAll('{{SKU}}', item.sku)
    .replaceAll('{{OEM_PART_NUMBER}}', mpnLabel)
    .replaceAll('{{INTERCHANGE_NUMBER}}', interchangeLabel)
    .replaceAll('{{HOLLANDER_NUMBER}}', item.hollander_number ? `(Hollander #${item.hollander_number})` : '')
    .replaceAll('{{SECURITY_CODE}}', item.security_mark_code)
    .replaceAll('{{TITLE}}', item.title)
    .replaceAll('{{DESCRIPTION}}', safeDesc)
    .replaceAll('{{CONDITION}}', condOut)
    .replaceAll('{{DEFECT_DISCLOSURE}}', safeDefect)
    .replaceAll('{{FITMENT_YEARS}}', item.fitment_years || '')
    .replaceAll('{{FITMENT_MAKE}}', item.fitment_make || '')
    .replaceAll('{{FITMENT_MODEL}}', item.fitment_model || '')
    .replaceAll('{{FITMENT_ENGINE}}', item.fitment_engine || 'Verify OEM # / VIN')
    .replaceAll('{{FITMENT_NOTES}}', safeNotes)
    .replaceAll('{{BIN_LOCATION}}', item.bin_location || 'MAIN-WHSE')
    .replaceAll('{{WEIGHT_LBS}}', String(item.weight_lbs || 10))
    .replaceAll('{{DIMENSIONS_IN}}', formatDimensionsIn(item))
    .replaceAll('{{SHIPPING_SUMMARY_LABEL}}', shipLabel)
    .replaceAll('{{INSTALL_CALLOUT_HTML}}', installCalloutHtml)
    .replaceAll('{{DIRECT_APP_CALLOUT_HTML}}', directAppCalloutHtml);
}

function renderEbayHtml(item, settings) {
  const tpl = generateAllPolicies(settings).ebay_motors_html_template;
  const mpnOut = resolveExportMpn(item.oem_part_number);
  const mpnLabel = mpnOut || 'OEM Factory Part (Match Photos & VIN)';
  const interchangeLabel = sanitizeMpnField(item.interchange_number) || (item.hollander_number ? `Hollander #${item.hollander_number}` : 'Verify via Donor Fitment');
  const condOut = normalizeExportCondition(item.condition);
  const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
  const { installTotal, otdTotal, supplyFee, supplyCap, taxRate, hours, rate } = computeInstallEstimate(item, settings);

  // 100% eBay Policy Compliant Callout — ZERO external URLs, domains, or phone numbers!
  const installCalloutEbayHtml = `<div style="background:#f0f9ff;border:1px solid #0284c7;border-radius:6px;padding:12px 14px;margin-bottom:12px;font-size:13px;line-height:1.5;">
      <strong style="color:#0369a1;">OPTIONAL CERTIFIED IN-HOUSE SHOP INSTALLATION (UNIVERSITY PLACE, WA 98467):</strong><br/>
      Informational Turnkey Part + Certified Bay Installation Estimate: <strong>$${installTotal.toFixed(2)}</strong> part + labor <em>(~${hours.toFixed(1)} hrs certified technician labor @ $${rate.toFixed(2)}/hr; est. $${otdTotal.toFixed(2)} out-the-door incl. $${supplyFee.toFixed(2)} 7% shop supplies capped at $${supplyCap} + ${(taxRate * 100).toFixed(1)}% WA tax)</em>. Listed strictly as 1 single physical unit so inventory is never double-booked — local Pierce County buyers may message us directly via <strong>eBay Messages</strong> regarding counter pickup or bay installation availability!
    </div>`;

  const shipLabel = heavyPickupOnly
    ? 'Local Pickup Only in University Place, WA 98467'
    : `Calculated Parcel + $${Number(settings.handling_fee_default ?? 10).toFixed(2)} Handling`;

  return tpl
    .replaceAll('{{BUSINESS_NAME}}', settings.business_name)
    .replaceAll('{{SKU}}', item.sku)
    .replaceAll('{{OEM_PART_NUMBER}}', mpnLabel)
    .replaceAll('{{INTERCHANGE_NUMBER}}', interchangeLabel)
    .replaceAll('{{HOLLANDER_NUMBER}}', item.hollander_number ? `(Hollander #${item.hollander_number})` : '')
    .replaceAll('{{SECURITY_CODE}}', item.security_mark_code)
    .replaceAll('{{TITLE}}', stripOffEbayContactText(item.title))
    .replaceAll('{{DESCRIPTION}}', stripOffEbayContactText(stripDriveUrlsFromPublicText(item.description || item.title)))
    .replaceAll('{{CONDITION}}', condOut)
    .replaceAll('{{DEFECT_DISCLOSURE}}', stripOffEbayContactText(stripDriveUrlsFromPublicText(item.defect_disclosure || 'Inspected & verified.')))
    .replaceAll('{{FITMENT_YEARS}}', item.fitment_years || '')
    .replaceAll('{{FITMENT_MAKE}}', item.fitment_make || '')
    .replaceAll('{{FITMENT_MODEL}}', item.fitment_model || '')
    .replaceAll('{{FITMENT_ENGINE}}', item.fitment_engine || 'Verify OEM # / VIN')
    .replaceAll('{{FITMENT_NOTES}}', stripOffEbayContactText(stripDriveUrlsFromPublicText(item.fitment_notes) || 'Match OEM photos & VIN prior to purchase (Returns Not Accepted for remorse/fitment).'))
    .replaceAll('{{BIN_LOCATION}}', item.bin_location || 'MAIN-WHSE')
    .replaceAll('{{WEIGHT_LBS}}', String(item.weight_lbs || 10))
    .replaceAll('{{DIMENSIONS_IN}}', formatDimensionsIn(item))
    .replaceAll('{{SHIPPING_SUMMARY_LABEL}}', shipLabel)
    .replaceAll('{{INSTALL_CALLOUT_EBAY_HTML}}', installCalloutEbayHtml);
}

function renderLocalMarketplacePacket(item, settings, baseUrl) {
  const tpl = generateAllPolicies(settings).local_marketplace_template;
  const mpnOut = resolveExportMpn(item.oem_part_number);
  const mpnLabel = mpnOut || 'Verified OEM (Match Photos/VIN)';
  const interchangeLabel = sanitizeMpnField(item.interchange_number) || item.hollander_number || 'Match Donor Vehicle';
  const condOut = normalizeExportCondition(item.condition);
  const handlingFee = Number(settings.handling_fee_default ?? 10).toFixed(2);
  const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
  const { installTotal, hours, rate } = computeInstallEstimate(item, settings);
  const { pwaUrl } = resolveDirectPublicUrls(settings, baseUrl);

  const shipOrPickupLine = heavyPickupOnly
    ? `$${Number(item.price_we_pull || 0).toFixed(2)} — LOCAL PICKUP ONLY in University Place, WA 98467 (70+ lb / oversized / hazmat assembly at 5115 66th St W, Bldg B)`
    : `$${Number(item.price_we_pull || 0).toFixed(2)} (+ Calculated Parcel Shipping + $${handlingFee} handling buffer if shipped, or FREE Shop Counter Pickup in University Place, WA 98467!)`;

  const installLine = `OPTIONAL CERTIFIED SHOP INSTALLATION (INFO CALLOUT): ~$${installTotal.toFixed(2)} turnkey installed (~${hours.toFixed(1)} hrs certified bay labor @ $${rate.toFixed(2)}/hr in University Place, WA 98467 — purchase single-unit part to reserve)!`;

  return tpl
    .replaceAll('{{TITLE}}', item.title)
    .replaceAll('{{OEM_PART_NUMBER}}', mpnLabel)
    .replaceAll('{{INTERCHANGE_NUMBER}}', interchangeLabel)
    .replaceAll('{{SKU}}', item.sku)
    .replaceAll('{{FITMENT_YEARS}}', item.fitment_years || '')
    .replaceAll('{{FITMENT_MAKE}}', item.fitment_make || '')
    .replaceAll('{{FITMENT_MODEL}}', item.fitment_model || '')
    .replaceAll('{{FITMENT_ENGINE}}', item.fitment_engine || '')
    .replaceAll('{{WEIGHT_LBS}}', String(item.weight_lbs || 10))
    .replaceAll('{{DIMENSIONS_IN}}', formatDimensionsIn(item))
    .replaceAll('{{CONDITION}}', condOut)
    .replaceAll('{{DESCRIPTION}}', stripDriveUrlsFromPublicText(item.description || ''))
    .replaceAll('{{DEFECT_DISCLOSURE}}', stripDriveUrlsFromPublicText(item.defect_disclosure || 'Clean tested assembly.'))
    .replaceAll('{{SHIPPING_OR_PICKUP_LINE}}', shipOrPickupLine)
    .replaceAll('{{PULL_INSTALL_LINE}}', installLine)
    .replaceAll('{{DIRECT_WEBSITE_URL}}', pwaUrl)
    .replaceAll('{{SECURITY_CODE}}', item.security_mark_code);
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
    'Google Shopping / Google Product Category',
    'Google Shopping / MPN',
    'Google Shopping / Condition',
    'Google Shopping / Custom Label 0',
    'Google Shopping / Custom Label 1',
    'Metafield: custom.oem_part_number [single_line_text_field]',
    'Metafield: custom.condition [single_line_text_field]',
    'Metafield: custom.bin_location [single_line_text_field]',
    'Metafield: custom.security_mark [single_line_text_field]',
    'Metafield: custom.shipping_class [single_line_text_field]',
    'Metafield: custom.package_dimensions [single_line_text_field]',
    'Metafield: custom.ebay_us_category_id [single_line_text_field]',
    'Metafield: custom.shopify_taxonomy_id [single_line_text_field]',
    'Metafield: custom.return_policy [single_line_text_field]',
    'Status'
  ];

  const imgSrcIdx = headers.indexOf('Image Src');
  const imgPosIdx = headers.indexOf('Image Position');
  const imgAltIdx = headers.indexOf('Image Alt Text');

  const rows = [headers.join(',')];
  for (const item of items) {
    // Hard compliance, anti-placeholder, deduplication, fake-VIN & real-photo guard
    if (item.status === 'pending_verification' || item.status === 'compliance_blocked' || item.status === 'duplicate_archived') continue;
    if (!hasRealPhotos(item)) continue;
    const gate = validateInventoryItemForPublish(item);
    if (!gate.valid) continue;
    if (item.donor_vehicle_id) {
      const dv = db.prepare('SELECT vin FROM donor_vehicles WHERE id = ?').get(item.donor_vehicle_id);
      if (dv && dv.vin && !validateVinStrict(dv.vin).valid) continue;
    }
    const skuUpper = String(item.sku || '').trim().toUpperCase();
    if (PROHIBITED_CAT_SKUS.has(skuUpper) || PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS.has(skuUpper)) continue;

    const tax = resolvePartTaxonomyAndMetafields(item, settings);
    const handle = item.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const photos = getValidPhotos(item);
    const resolvePhoto = (p) => resolveExportPhotoUrl(p, baseUrl, settings);
    const imgUrl = photos[0] ? resolvePhoto(photos[0]) : '';
    const condOut = normalizeExportCondition(item.condition);
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
    const effectiveShippingClass = heavyPickupOnly ? 'local_pickup_only_98467' : 'parcel_calculated_plus_10_handling';

    const htmlBody = renderShopifyHtml(item, settings, baseUrl);
    const grams = Math.round(Number(item.weight_lbs || 8) * 453.592);
    const tags = tax.seoTags.join(', ');
    const safeActive = isMarketplaceSafeItem(item);
    const status = item.status === 'archived' ? 'archived' : (safeActive ? 'active' : 'draft');

    // STRICT SINGLE-VARIANT RULE: Only 1 physical unit variant (Default Title) so inventory can NEVER be double-booked!
    rows.push([
      handle,
      item.title,
      htmlBody,
      settings.business_name,
      tax.shopifyProductCategory,
      tax.partType,
      tags,
      status === 'active' ? 'true' : 'false',
      'Title',
      'Default Title',
      item.sku,
      grams,
      'shopify',
      status === 'active' ? Math.max(1, Number(item.quantity || 1)) : 0,
      'deny',
      'manual',
      Number(item.price_we_pull || 0).toFixed(2),
      heavyPickupOnly ? 'false' : 'true',
      'true',
      imgUrl,
      imgUrl ? '1' : '',
      imgUrl ? item.title.slice(0, 70) : '',
      tax.googleProductCategory,
      tax.mpn,
      tax.condition,
      tax.customLabel0,
      tax.customLabel1,
      tax.mpn,
      condOut,
      item.bin_location,
      item.security_mark_code,
      effectiveShippingClass,
      `${formatDimensionsIn(item)} in`,
      tax.ebayUsCategoryId,
      tax.shopifyTaxonomyId,
      'Returns Not Accepted (Defect-Only)',
      status
    ].map(csvEscape).join(','));

    // Secondary angle photos + FINAL gallery image = QR-Branded Info & App Card (strictly blank Variant/Option/Price columns!)
    photos.slice(1).forEach((secPhoto, secIdx) => {
      const secRow = new Array(headers.length).fill('');
      secRow[0] = handle;
      secRow[imgSrcIdx] = resolvePhoto(secPhoto);
      secRow[imgPosIdx] = String(secIdx + 2);
      secRow[imgAltIdx] = isQrCardUrl(secPhoto)
        ? `${item.sku} Security Tag ${item.security_mark_code} - Scan QR for Aldridge Auto's App`.slice(0, 70)
        : item.title.slice(0, 70);
      rows.push(secRow.map(csvEscape).join(','));
    });
  }
  return rows.join('\n') + '\n';
}

// STRICT STANDARD EBAY US (ebay.com, SiteID=US) ONLY — NEVER eBay Motors!
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
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
    if (freightOnly && !heavyPickupOnly) continue;
    const tax = resolvePartTaxonomyAndMetafields(item, settings);
    const photos = getValidPhotos(item);
    const picUrl = photos.map((p) => resolveExportPhotoUrl(p, baseUrl, settings)).join('|');
    const ebayTitle = cleanListingTitle(item.title).slice(0, 80);
    const condOut = normalizeExportCondition(item.condition);

    rows.push([
      'Add',
      item.sku,
      tax.ebayUsCategoryId,
      ebayTitle,
      condOut === 'New' ? 1000 : 3000,
      `${condOut} — ${item.defect_disclosure} | Fits: ${tax.customLabel0} | Returns Not Accepted (Defect-Only) | Security Mark ID: ${item.security_mark_code}`,
      tax.brand,
      tax.mpn,
      tax.mpn,
      [sanitizeMpnField(item.interchange_number), item.hollander_number].filter(Boolean).join(', '),
      item.placement_on_vehicle || 'Vehicle Specific',
      picUrl,
      renderEbayHtml(item, settings),
      'FixedPrice',
      'GTC',
      Number(item.price_we_pull || 0).toFixed(2),
      1,
      'University Place, WA 98467',
      settings.handling_days_default || 3,
      heavyPickupOnly ? (freightOnly ? 'FreightFlat' : 'Flat') : 'Calculated',
      heavyPickupOnly ? 'US_Pickup' : 'UPSGround',
      heavyPickupOnly ? '0.00' : Number(settings.handling_fee_default || 10).toFixed(2),
      'US_Pickup',
      '0.00',
      'ReturnsNotAccepted',
      Math.ceil(Number(item.weight_lbs || 8)),
      Math.ceil(Number(item.length_in || 14)),
      Math.ceil(Number(item.width_in || 10)),
      Math.ceil(Number(item.height_in || 8))
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
    const tax = resolvePartTaxonomyAndMetafields(item, settings);
    const photos = getValidPhotos(item);
    const imgUrl = resolveExportPhotoUrl(photos[0], baseUrl, settings);
    const avail = item.quantity > 0 ? 'in_stock' : 'out_of_stock';
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
    const { installTotal, hours, rate } = computeInstallEstimate(item, settings);
    const mpnTag = tax.mpn ? `\n      <g:mpn>${xmlEscape(tax.mpn)}</g:mpn>` : '';
    const mpnDesc = tax.mpn ? ` | OEM MPN: ${tax.mpn}` : '';
    return `    <item>
      <g:id>${xmlEscape(item.sku)}</g:id>
      <g:title>${xmlEscape(item.title)}</g:title>
      <g:description>${xmlEscape(`${item.description} | Optional Certified Shop Bay Installation at 5115 66th St W, Bldg B, University Place, WA 98467: $${installTotal.toFixed(2)} turnkey installed (~${hours.toFixed(1)} hrs @ $${rate.toFixed(2)}/hr) | Fits: ${tax.customLabel0}${mpnDesc}`)}</g:description>
      <g:link>${xmlEscape(`${pwaUrl}/?sku=${encodeURIComponent(item.sku)}`)}</g:link>
      <g:image_link>${xmlEscape(imgUrl)}</g:image_link>
      <g:condition>${xmlEscape(tax.condition)}</g:condition>
      <g:availability>${avail}</g:availability>
      <g:price>${Number(item.price_we_pull || 0).toFixed(2)} USD</g:price>
      <g:brand>${xmlEscape(tax.brand)}</g:brand>${mpnTag}
      <g:identifier_exists>${tax.identifierExists ? 'yes' : 'no'}</g:identifier_exists>
      <g:google_product_category>${xmlEscape(tax.googleProductCategory)}</g:google_product_category>
      <g:custom_label_0>${xmlEscape(tax.customLabel0)}</g:custom_label_0>
      <g:custom_label_1>${xmlEscape(tax.customLabel1)}</g:custom_label_1>
      <g:shipping_weight>${Number(item.weight_lbs || 8).toFixed(1)} lb</g:shipping_weight>
      <g:shipping_length>${Math.ceil(Number(item.length_in || 14))} in</g:shipping_length>
      <g:shipping_width>${Math.ceil(Number(item.width_in || 10))} in</g:shipping_width>
      <g:shipping_height>${Math.ceil(Number(item.height_in || 8))} in</g:shipping_height>
      <g:shipping_label>${xmlEscape(heavyPickupOnly ? 'local_pickup_only_university_place_wa_98467' : 'calculated_parcel_plus_10_00_handling')}</g:shipping_label>
      <g:min_handling_time>2</g:min_handling_time>
      <g:max_handling_time>${Number(settings.handling_days_default || 3)}</g:max_handling_time>
      <g:pickup_method>buy</g:pickup_method>
      <g:pickup_sla>multi-day</g:pickup_sla>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${xmlEscape(settings.business_name)} — Google Merchant, YouTube &amp; Local Feed</title>
    <link>${xmlEscape(pwaUrl)}</link>
    <description>${xmlEscape(settings.tagline)}</description>
${itemNodes}
  </channel>
</rss>`;
}

function generateMetaCatalogCsv(items, settings, baseUrl) {
  items = ensureDeduplicatedItems(items);
  const headers = [
    'id', 'title', 'description', 'availability', 'condition', 'price',
    'link', 'image_link', 'brand', 'mpn', 'quantity_to_sell_on_facebook', 'google_product_category'
  ];
  const { pwaUrl } = resolveDirectPublicUrls(settings, baseUrl);
  const rows = [headers.join(',')];
  for (const item of items) {
    if (!isMarketplaceSafeItem(item)) continue;
    const photos = getValidPhotos(item);
    if (!photos.length) continue;
    const tax = resolvePartTaxonomyAndMetafields(item, settings);
    const imgUrl = resolveExportPhotoUrl(photos[0], baseUrl, settings);
    const mpnOut = resolveExportMpn(item.oem_part_number);
    const condOut = normalizeExportCondition(item.condition);
    const cond = condOut === 'New' ? 'new' : 'used';
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
    const { installTotal, hours, rate } = computeInstallEstimate(item, settings);
    const mpnClause = mpnOut ? ` OEM MPN: ${mpnOut}.` : '';
    rows.push([
      item.sku,
      item.title.slice(0, 150),
      `${item.title}. Single-unit inspected Used OEM part (1 in stock).${mpnClause} Fits: ${tax.customLabel0}. Optional Certified Shop Installation at 5115 66th St W, Bldg B, University Place, WA 98467: $${installTotal.toFixed(2)} turnkey installed (~${hours.toFixed(1)} hrs @ $${rate.toFixed(2)}/hr). ${heavyPickupOnly ? 'Local Pickup Only in University Place, WA 98467.' : 'Calculated Parcel + $10.00 handling or Free Local Pickup in University Place, WA 98467.'} Returns Not Accepted (Defect-Only).`,
      item.quantity > 0 && item.status === 'active' ? 'in stock' : 'out of stock',
      cond,
      `${Number(item.price_we_pull || 0).toFixed(2)} USD`,
      `${pwaUrl}/?sku=${encodeURIComponent(item.sku)}`,
      imgUrl,
      tax.brand || item.brand || 'OEM',
      mpnOut,
      item.status === 'active' ? Math.max(1, Number(item.quantity || 1)) : 0,
      tax.googleProductCategory || 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts'
    ].map(csvEscape).join(','));
  }
  return rows.join('\n') + '\n';
}

function generateVendooOrCrosslistCsv(items, settings, baseUrl, mode = 'vendoo') {
  items = ensureDeduplicatedItems(items);
  const handlingFee = Number(settings.handling_fee_default || 10);
  const headers = mode === 'crosslist'
    ? ['SKU', 'Title', 'Description', 'Brand', 'MPN', 'Condition', 'Price', 'Quantity', 'Year', 'Make', 'Model', 'eBay_US_Category_ID', 'Weight (lbs)', 'Length', 'Width', 'Height', 'Shipping_Policy', 'Return_Policy', 'Zip Code', 'Shop_Install_Price_98467', 'Image 1', 'Additional_Images', 'Internal Notes']
    : ['SKU', 'Title', 'Description', 'Brand', 'MPN', 'Condition', 'Price', 'Cost of Goods', 'Quantity', 'Weight_lb', 'Length', 'Width', 'Height', 'Shipping_Type', 'Handling_Fee_USD', 'Local_Pickup_Location', 'Return_Policy', 'Primary_Image', 'Additional_Images', 'Storage_Bin_Notes'];

  const rows = [headers.join(',')];
  for (const item of items) {
    if (!isMarketplaceSafeItem(item)) continue;
    const tax = resolvePartTaxonomyAndMetafields(item, settings);
    const photos = getValidPhotos(item);
    const resolvePhoto = (p) => resolveExportPhotoUrl(p, baseUrl, settings);
    const imgUrl = photos[0] ? resolvePhoto(photos[0]) : '';
    const extraImgs = photos.slice(1).map(resolvePhoto).join('|');
    const mpnOut = resolveExportMpn(item.oem_part_number);
    const condOut = normalizeExportCondition(item.condition);
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
    const shippingPolicy = heavyPickupOnly
      ? 'Local Pickup Only — University Place, WA 98467'
      : `Calculated Parcel + $${handlingFee.toFixed(2)} Handling`;
    const returnPolicy = 'Returns Not Accepted (Defect-Only)';
    const basePrice = Number(item.price_we_pull || 0).toFixed(2);
    const { installTotal, hours, rate } = computeInstallEstimate(item, settings);
    const mpnSegment = mpnOut ? ` | OEM MPN: ${mpnOut}` : '';
    // Compliant marketplace description (includes Certified Shop Install price at 5115 66th St W Bldg B @ $174.99/hr, zero external URLs/phones so eBay aabcas + OfferUp + FB Marketplace channels stay safe)
    const compliantDesc = `${stripOffEbayContactText(item.title)}${mpnSegment} | Single-Unit Inspected OEM Part (1 in stock) | Fits: ${tax.customLabel0} | Spec: ${item.weight_lbs} lbs (${formatDimensionsIn(item)} in) | Optional Certified Shop Bay Installation at 5115 66th St W, Bldg B, University Place, WA 98467: ~$${installTotal.toFixed(2)} turnkey installed (~${hours.toFixed(1)} hrs @ $${rate.toFixed(2)}/hr) | ${shippingPolicy} | ${returnPolicy} | Security ID: ${item.security_mark_code}`;

    if (mode === 'crosslist') {
      rows.push([
        item.sku, item.title, compliantDesc, tax.brand || item.brand || 'OEM', mpnOut, condOut,
        basePrice, 1, item.fitment_years || '', item.fitment_make || '', item.fitment_model || '',
        tax.ebayUsCategoryId, item.weight_lbs, item.length_in, item.width_in, item.height_in,
        shippingPolicy, returnPolicy,
        settings.zip || '98467', installTotal.toFixed(2), imgUrl, extraImgs,
        `SINGLE_VARIANT_ONLY | eBay aabcas + OfferUp + FB Marketplace | Bin: ${item.bin_location} | Security: ${item.security_mark_code}`
      ].map(csvEscape).join(','));
    } else {
      rows.push([
        item.sku, item.title, compliantDesc, tax.brand || item.brand || 'OEM', mpnOut, condOut,
        basePrice, Number(item.cost_basis || 0).toFixed(2), 1,
        item.weight_lbs, item.length_in, item.width_in, item.height_in,
        shippingPolicy,
        heavyPickupOnly ? '0.00' : handlingFee.toFixed(2),
        'University Place, WA 98467',
        returnPolicy,
        imgUrl,
        extraImgs,
        `1-Variant Only | Shop Install Est: $${installTotal.toFixed(2)} | Bin: ${item.bin_location} | Security: ${item.security_mark_code}`
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
  const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
  const dimsLabel = `${Math.round(Number(item.length_in || 14))}x${Math.round(Number(item.width_in || 10))}x${Math.round(Number(item.height_in || 8))} in`;
  const weightLbs = Number(item.weight_lbs || 8);
  const { installTotal, otdTotal, hours, rate } = computeInstallEstimate(item, settings);
  const donorVehicle = [item.fitment_years, item.fitment_make, item.fitment_model].filter(Boolean).join(' ').trim() || tax.customLabel0;
  const condLabel = normalizeExportCondition(item.condition) === 'New' ? 'New OEM' : 'Used OEM';
  const fulfillmentLabel = heavyPickupOnly
    ? 'Local Pickup Only — University Place, WA 98467'
    : 'Calculated Parcel Shipping + Free Local Pickup (98467)';

  const raw = [
    { namespace: 'mm-google-shopping', key: 'google_product_category', value: tax.googleProductCategory, type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'condition', value: tax.condition, type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'mpn', value: tax.mpn, type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'custom_label_0', value: tax.customLabel0, type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'custom_label_1', value: tax.customLabel1, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'oem_mpn', value: tax.mpn, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'oem_part_number', value: tax.mpn, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'donor_vehicle', value: donorVehicle, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'fitment_years', value: String(item.fitment_years || '').trim(), type: 'single_line_text_field' },
    { namespace: 'custom', key: 'part_condition', value: condLabel, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'fulfillment_type', value: fulfillmentLabel, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'shop_install_price', value: `$${installTotal.toFixed(2)} part+labor (~${hours.toFixed(1)} hrs @ $${rate.toFixed(2)}/hr; est. $${otdTotal.toFixed(2)} OTD w/ 7% supplies & 10.1% WA tax)`, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'packed_dimensions', value: `${dimsLabel} (${weightLbs} lbs)`, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'package_dimensions', value: `${dimsLabel} (${weightLbs} lbs)`, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'bin_location', value: String(item.bin_location || '').trim(), type: 'single_line_text_field' },
    { namespace: 'custom', key: 'security_mark', value: String(item.security_mark_code || '').trim(), type: 'single_line_text_field' },
    { namespace: 'custom', key: 'ebay_us_category_id', value: tax.ebayUsCategoryId, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'shopify_taxonomy_id', value: tax.shopifyTaxonomyId, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'country_of_origin', value: tax.countryOfOrigin || 'US', type: 'single_line_text_field' },
    { namespace: 'custom', key: 'return_policy', value: 'Returns Not Accepted (Defect-Only)', type: 'single_line_text_field' },
    { namespace: 'custom', key: 'crosslist_offerup_fb_sync', value: 'enabled_auto_delist_on_zero', type: 'single_line_text_field' }
  ];

  // Shopify metafieldsSet rejects empty string values — omit blank optional keys (e.g., unstamped MPN).
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

async function syncShopifyProductGraphqlAndOrigin({ domain, tokenRef, authMode, settings, productId, inventoryItemId, item, tax }) {
  const countryCode = resolveCountryOfOrigin(item);
  const resolvedTaxGid = await resolveLiveShopifyTaxonomyGid({ domain, tokenRef, authMode, settings, tax });
  const results = {
    country_code_of_origin: countryCode,
    origin_updated: false,
    category_updated: false,
    category_gid: resolvedTaxGid,
    metafields_count: 0,
    warnings: []
  };

  // 1. Set Country of Origin on Shopify InventoryItem (REST)
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

  // 2. Assign Shopify Standard Product Taxonomy Category + Structured Metafields via GraphQL
  const graphqlUrl = `https://${domain}/admin/api/2025-01/graphql.json`;
  const productGid = `gid://shopify/Product/${productId}`;
  const metafieldsList = buildShopifyProductMetafields(item, settings, { ...tax, shopifyTaxonomyId: resolvedTaxGid });

  const runCategoryMutation = async (catGid) => {
    const resp = await shopifyFetchWithRetry(
      graphqlUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query: `mutation SetCategory($product: ProductUpdateInput!) {
            productUpdate(product: $product) {
              product { id category { id fullName } }
              userErrors { field message }
            }
          }`,
          variables: { product: { id: productGid, category: catGid } }
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
    let catRes = await runCategoryMutation(resolvedTaxGid);
    if (!catRes.ok && resolvedTaxGid !== tax.shopifyTaxonomyId) {
      catRes = await runCategoryMutation(tax.shopifyTaxonomyId);
      if (catRes.ok) results.category_gid = tax.shopifyTaxonomyId;
    }
    if (!catRes.ok && tax.shopifyTaxonomyId !== 'gid://shopify/TaxonomyCategory/vp-1-4') {
      catRes = await runCategoryMutation('gid://shopify/TaxonomyCategory/vp-1-4');
      if (catRes.ok) results.category_gid = 'gid://shopify/TaxonomyCategory/vp-1-4';
    }
    if (catRes.ok) {
      results.category_updated = true;
    } else {
      results.warnings.push(`category: ${catRes.err}`);
    }
  } catch (err) {
    results.warnings.push(`category err: ${err.message}`);
  }

  try {
    const mfInput = metafieldsList.map((m) => ({
      ownerId: productGid,
      namespace: m.namespace,
      key: m.key,
      type: m.type,
      value: String(m.value)
    }));
    const mfResp = await shopifyFetchWithRetry(
      graphqlUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query: `mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { namespace key value }
              userErrors { field message code }
            }
          }`,
          variables: { metafields: mfInput }
        })
      },
      { authMode, settings, tokenRef }
    );
    if (mfResp.ok) {
      const mfData = await mfResp.json();
      const uerrs = mfData?.data?.metafieldsSet?.userErrors || [];
      const savedMfs = mfData?.data?.metafieldsSet?.metafields || [];
      results.metafields_count = savedMfs.length;
      if (mfData.errors?.length || uerrs.length) {
        results.warnings.push(`metafields: ${JSON.stringify(mfData.errors || uerrs).slice(0, 160)}`);
      }
    } else {
      results.warnings.push(`metafields HTTP ${mfResp.status}`);
    }
  } catch (err) {
    results.warnings.push(`metafields err: ${err.message}`);
  }

  // Purge any stale legacy/placeholder MPN metafields on Shopify when no verified stamped OEM MPN exists
  if (!tax?.mpn) {
    try {
      const delResp = await shopifyFetchWithRetry(
        graphqlUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            query: `mutation DeleteStaleMpns($metafields: [MetafieldIdentifierInput!]!) {
              metafieldsDelete(metafields: $metafields) {
                deletedMetafields { key namespace ownerId }
                userErrors { field message }
              }
            }`,
            variables: {
              metafields: [
                { ownerId: productGid, namespace: 'mm-google-shopping', key: 'mpn' },
                { ownerId: productGid, namespace: 'custom', key: 'oem_part_number' },
                { ownerId: productGid, namespace: 'custom', key: 'oem_mpn' }
              ]
            }
          })
        },
        { authMode, settings, tokenRef }
      );
      if (delResp.ok) {
        const delData = await delResp.json();
        const delErrs = delData?.data?.metafieldsDelete?.userErrors || [];
        if (delErrs.length) {
          results.warnings.push(`metafieldsDelete: ${JSON.stringify(delErrs).slice(0, 140)}`);
        }
      }
    } catch (err) {
      results.warnings.push(`metafieldsDelete err: ${err.message}`);
    }
  }

  return results;
}

async function syncAllToShopifyCoMaster({ updateExisting = false } = {}) {
  // PERMANENT PRE-SYNC DEDUPLICATION GATE: Archive any duplicate physical parts & merge photos before touching Shopify
  let dedupeSummary = null;
  try {
    const { deduplicateCatalog } = require('./catalog-enrichment');
    dedupeSummary = deduplicateCatalog();
  } catch (_) {}

  const settings = getSettings();
  const allDbItems = db.prepare('SELECT * FROM inventory_items').all();
  const items = allDbItems.filter(isMarketplaceSafeItem);
  const blockedSkusSet = new Set([
    ...PROHIBITED_CAT_SKUS,
    ...PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS,
    ...allDbItems
      .filter((r) => r.status === 'compliance_blocked' || !validatePartCompliance({ title: r.title, category: r.category, description: r.description }).compliant)
      .map((r) => String(r.sku || '').trim().toUpperCase())
  ]);
  const duplicateArchivedSkusSet = new Set(
    allDbItems
      .filter((r) => r.status === 'duplicate_archived' || r.status === 'sold' || r.status === 'archived')
      .map((r) => String(r.sku || '').trim().toUpperCase())
      .filter((s) => s && !blockedSkusSet.has(s))
  );
  const pendingVerificationSkusSet = new Set(
    allDbItems
      .filter((r) => r.status === 'pending_verification' || (r.status === 'active' && !validateInventoryItemForPublish(r).valid))
      .map((r) => String(r.sku || '').trim().toUpperCase())
      .filter((s) => s && !blockedSkusSet.has(s) && !duplicateArchivedSkusSet.has(s))
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
      message: 'Shopify Single-Variant payload staged (Photos Required + Shop Install in Description HTML). Configure SHOPIFY_ADMIN_TOKEN (or SHOPIFY_CLIENT_ID + shpss_) to activate live API push.'
    };
  }
  if (auth.authMode === 'shpss_missing_client_id') {
    throw new Error('SHOPIFY_ADMIN_TOKEN starts with shpss_ (client secret) but SHOPIFY_CLIENT_ID is missing. Add SHOPIFY_CLIENT_ID in Render Environment to enable client_credentials OAuth exchange.');
  }

  const domain = auth.shopDomain;
  const tokenRef = { token: auth.token };
  const existingHandles = new Set();
  const existingSkus = new Map();
  let nextUrl = `https://${domain}/admin/api/2025-01/products.json?limit=250&fields=id,handle,status,variants,images`;
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
      const cleanCdnImages = (p.images || [])
        .filter((img) => img && img.src && !isQrCardUrl(img.src) && !/scan qr/i.test(String(img.alt || '')))
        .map((img) => img.src);
      for (const v of p.variants || []) {
        if (v.sku) {
          existingSkus.set(String(v.sku).trim().toUpperCase(), {
            product_id: String(p.id || ''),
            handle: String(p.handle || ''),
            status: String(p.status || 'active'),
            variant_id: String(v.id || ''),
            inventory_item_id: String(v.inventory_item_id || ''),
            inventory_quantity: Number(v.inventory_quantity || 0),
            clean_cdn_images: cleanCdnImages
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
  let draftedBlocked = 0;
  let archivedPending = 0;
  let archivedDuplicates = 0;
  let skippedProtected = 0;
  let updatedImageAlts = 0;
  const errors = [];

  // 1. COMPLIANCE ENFORCEMENT: Immediately draft & zero any prohibited SRS/airbag/catalytic SKUs on Shopify!
  for (const blockedSku of blockedSkusSet) {
    const liveBlocked = existingSkus.get(blockedSku);
    if (!liveBlocked) continue;
    const needsDraft = liveBlocked.status !== 'draft' && liveBlocked.status !== 'archived';
    const needsZero = Number(liveBlocked.inventory_quantity || 0) > 0;
    if (!needsDraft && !needsZero) continue;
    try {
      if (needsDraft) {
        const draftResp = await shopifyFetchWithRetry(
          `https://${domain}/admin/api/2025-01/products/${liveBlocked.product_id}.json`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              product: {
                id: Number(liveBlocked.product_id),
                status: 'draft',
                tags: 'COMPLIANCE-BLOCKED, SRS-PROHIBITED-DO-NOT-PUBLISH'
              }
            })
          },
          { authMode: auth.authMode, settings, tokenRef }
        );
        if (draftResp.ok) {
          draftedBlocked++;
          logSync('outbound', 'shopify_co_master', 'compliance_draft_blocked', blockedSku, 'success', `Drafted prohibited SRS/compliance SKU ${blockedSku} on ${domain} (Product ID ${liveBlocked.product_id}).`);
        } else {
          errors.push(`draft-blocked ${blockedSku}: HTTP ${draftResp.status}`);
        }
      }
      if (needsZero) {
        await zeroShopifyInventoryItem(liveBlocked.inventory_item_id);
      }
      await new Promise((r) => setTimeout(r, 260));
    } catch (err) {
      errors.push(`draft-blocked ${blockedSku}: ${err.message}`);
    }
  }

  // 1b. ZERO-PLACEHOLDER & DUPLICATE QUARANTINE: Archive & zero any pending_verification SKU currently on Shopify!
  for (const pendSku of pendingVerificationSkusSet) {
    const livePend = existingSkus.get(pendSku);
    if (!livePend) continue;
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
                tags: 'PENDING-VERIFICATION, AWAITING-YMM-REVIEW'
              }
            })
          },
          { authMode: auth.authMode, settings, tokenRef }
        );
        if (archResp.ok) {
          archivedPending++;
          logSync('outbound', 'shopify_co_master', 'archive_pending_verification', pendSku, 'success', `Archived pending_verification SKU ${pendSku} on ${domain} (Product ID ${livePend.product_id}) until verified YMM/part details are completed.`);
        } else {
          errors.push(`archive-pending ${pendSku}: HTTP ${archResp.status}`);
        }
      }
      if (needsZero) {
        await zeroShopifyInventoryItem(livePend.inventory_item_id);
      }
      await new Promise((r) => setTimeout(r, 260));
    } catch (err) {
      errors.push(`archive-pending ${pendSku}: ${err.message}`);
    }
  }

  // 1c. PERMANENT DUPLICATE ARCHIVAL: Archive & zero every duplicate_archived SKU currently on Shopify!
  for (const dupSku of duplicateArchivedSkusSet) {
    const liveDup = existingSkus.get(dupSku);
    if (!liveDup) continue;
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
                tags: 'DUPLICATE-ARCHIVED, MERGED-INTO-CANONICAL-SKU'
              }
            })
          },
          { authMode: auth.authMode, settings, tokenRef }
        );
        if (archResp.ok) {
          archivedDuplicates++;
          logSync('outbound', 'shopify_co_master', 'archive_duplicate_sku', dupSku, 'success', `Archived duplicate_archived SKU ${dupSku} on ${domain} (Product ID ${liveDup.product_id}) — merged into canonical single-unit listing.`);
        } else {
          errors.push(`archive-duplicate ${dupSku}: HTTP ${archResp.status}`);
        }
      }
      if (needsZero) {
        await zeroShopifyInventoryItem(liveDup.inventory_item_id);
      }
      await new Promise((r) => setTimeout(r, 260));
    } catch (err) {
      errors.push(`archive-duplicate ${dupSku}: ${err.message}`);
    }
  }

  // 2. Push new active SKUs (and when updateExisting=true, PUT-enrich ALL existing active Shopify products!)
  for (const item of items) {
    try {
      const handle = item.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const skuUpper = String(item.sku || '').toUpperCase();
      const matchedExisting = existingSkus.get(skuUpper);
      const tax = resolvePartTaxonomyAndMetafields(item, settings);
      const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
      const dimsLabel = `${Math.round(Number(item.length_in || 14))}x${Math.round(Number(item.width_in || 10))}x${Math.round(Number(item.height_in || 8))} in`;
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

        if (!updateExisting) {
          skippedProtected++;
          continue;
        }

        // FULL ENRICHMENT PUT UPDATE (intentionally omits `images` so <SKU>.qr.png stays untouched in final gallery slot!)
        const updatePayload = {
          product: {
            id: Number(matchedExisting.product_id),
            title: item.title,
            body_html: renderShopifyHtml(item, settings),
            vendor: tax.brand || settings.business_name,
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
                weight: Number(item.weight_lbs || 8),
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

        // Sanitize ALL existing Shopify image alt-texts to strictly match clean verified OEM title (or final QR tag alt)
        try {
          const putData = await putResp.json();
          const liveImages = Array.isArray(putData?.product?.images) ? putData.product.images : [];
          for (let imgIdx = 0; imgIdx < liveImages.length; imgIdx++) {
            const img = liveImages[imgIdx];
            if (!img?.id) continue;
            const isQrImg =
              isQrCardUrl(img.src) ||
              /scan qr|security tag/i.test(String(img.alt || '')) ||
              (liveImages.length > 1 && imgIdx === liveImages.length - 1 && /\.qr\.png/i.test(String(img.src || '')));
            const expectedAlt = buildExpectedShopifyImageAlt(item, isQrImg);
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
          inventoryItemId: matchedExisting.inventory_item_id,
          item,
          tax
        });

        updatedCount++;
        await new Promise((r) => setTimeout(r, 340));
        continue;
      }

      if (existingHandles.has(handle)) {
        skippedProtected++;
        continue;
      }

      // STRICT SINGLE VARIANT ONLY (Default Title, 1 in stock)
      const variants = [
        {
          sku: item.sku,
          price: Number(item.price_we_pull || 0).toFixed(2),
          inventory_management: 'shopify',
          inventory_quantity: item.status === 'active' ? Math.max(1, Number(item.quantity || 1)) : 0,
          inventory_policy: 'deny',
          weight: Number(item.weight_lbs || 8),
          weight_unit: 'lb',
          requires_shipping: !heavyPickupOnly
        }
      ];

      const metafields = buildShopifyProductMetafields(item, settings, tax);

      const uploadsDir = path.join(DATA_DIR, 'uploads');
      const reviewThumbsDir = path.join(__dirname, '..', 'public', 'review-thumbs');
      const rawPhotos = getShopifyGalleryPhotos(item, settings, uploadsDir);
      const images = rawPhotos.map((u, idx) => {
        const altText = buildExpectedShopifyImageAlt(item, isQrCardUrl(u));
        if (u.startsWith('/uploads/')) {
          const localFile = path.join(uploadsDir, path.basename(u));
          if (fs.existsSync(localFile)) {
            return {
              attachment: fs.readFileSync(localFile).toString('base64'),
              filename: path.basename(localFile),
              position: idx + 1,
              alt: altText
            };
          }
        }
        if (u.startsWith('/review-thumbs/')) {
          const localThumb = path.join(reviewThumbsDir, path.basename(u));
          if (fs.existsSync(localThumb)) {
            return {
              attachment: fs.readFileSync(localThumb).toString('base64'),
              filename: `${item.sku}.${idx + 1}.jpg`,
              position: idx + 1,
              alt: altText
            };
          }
        }
        return {
          src: resolveExportPhotoUrl(u, `https://${domain}`, settings),
          position: idx + 1,
          alt: altText
        };
      });

      const payload = {
        product: {
          title: item.title,
          handle,
          body_html: renderShopifyHtml(item, settings),
          vendor: tax.brand || settings.business_name,
          product_type: tax.partType,
          tags,
          status: item.quantity > 0 && item.status === 'active' ? 'active' : 'draft',
          variants,
          images,
          metafields
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
        // Multi-channel photo isolation: store ONLY clean part photo CDN URLs (never <SKU>.qr.png)
        // in inventory_items.photos_json so Crosslist, eBay aabcas, Google Merchant XML, Meta CSV,
        // and Craigslist stay 100% QR-free.
        const cleanCdnImages = (data.product.images || [])
          .filter((img) => img && img.src && !isQrCardUrl(img.src) && !/scan qr/i.test(String(img.alt || '')))
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
          inventoryItemId: String(primaryVar.inventory_item_id || ''),
          item,
          tax
        });
      }
      pushed++;
      await new Promise((r) => setTimeout(r, 420));
    } catch (err) {
      errors.push(`${item.sku}: ${err.message}`);
    }
  }

  const finalActiveCount = items.length;
  logSync(
    'outbound',
    'shopify_co_master',
    updateExisting ? 'live_api_full_enrichment_sync' : 'live_api_push',
    'ALL',
    errors.length ? 'partial' : 'success',
    `Shopify sync on ${domain} via ${auth.authMode}: created=${pushed}, updated_enriched=${updatedCount}, drafted_blocked_srs=${draftedBlocked}, archived_pending=${archivedPending}, archived_duplicates=${archivedDuplicates}, skipped=${skippedProtected}, errors=${errors.length} (active_catalog=${finalActiveCount}).`
  );
  return {
    mode: 'live_api',
    auth_mode: auth.authMode,
    update_existing: Boolean(updateExisting),
    synced_count: pushed,
    updated_count: updatedCount,
    drafted_blocked_count: draftedBlocked,
    archived_pending_count: archivedPending,
    archived_duplicates_count: archivedDuplicates,
    skipped_protected: skippedProtected,
    total_active_catalog_skus: finalActiveCount,
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

  if (!hasRealPhotos(item)) {
    return {
      pushed: false,
      shopify_domain: domain,
      reason: 'Blocked: Real part photos are required before publishing to Shopify or eBay.'
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

  const handle = String(item.sku || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const fs = require('node:fs');
  const path = require('node:path');
  const tax = resolvePartTaxonomyAndMetafields(item, cfg);
  const heavyPickupOnly = isHeavyLocalPickupItem(item, cfg);
  const dimsLabel = `${Math.round(Number(item.length_in || 14))}x${Math.round(Number(item.width_in || 10))}x${Math.round(Number(item.height_in || 8))} in`;
  const tags = [...tax.seoTags, `Dims:${dimsLabel}`, 'eBay-US-Ready-Queue'].join(', ');

  // STRICT SINGLE VARIANT ONLY (Default Title, 1 in stock — zero double-booking, Crosslist auto-delist ready)
  const variants = [
    {
      sku: item.sku,
      price: Number(item.price_we_pull || 0).toFixed(2),
      inventory_management: 'shopify',
      inventory_quantity: item.status === 'active' ? Math.max(1, Number(item.quantity || 1)) : 0,
      inventory_policy: 'deny',
      weight: Number(item.weight_lbs || 8),
      weight_unit: 'lb',
      requires_shipping: !heavyPickupOnly
    }
  ];

  const metafields = buildShopifyProductMetafields(item, cfg, tax);

  const targetDir = uploadsDir || path.join(DATA_DIR, 'uploads');
  const reviewThumbsDir = path.join(__dirname, '..', 'public', 'review-thumbs');
  const rawPhotos = getShopifyGalleryPhotos(item, cfg, targetDir);
  const images = [];
  let pos = 1;
  for (const str of rawPhotos) {
    const altText = buildExpectedShopifyImageAlt(item, isQrCardUrl(str));
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
      title: item.title,
      handle,
      body_html: renderShopifyHtml(item, cfg),
      vendor: tax.brand || cfg.business_name || "Aldridge Auto's",
      product_type: tax.partType,
      tags,
      status: Number(item.quantity || 1) > 0 && item.status === 'active' ? 'active' : 'draft',
      variants,
      images,
      metafields
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
      .filter((img) => img && img.src && !isQrCardUrl(img.src) && !/scan qr/i.test(String(img.alt || '')))
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
      settings: cfg,
      productId: String(data.product.id),
      inventoryItemId: String(primaryVar.inventory_item_id || ''),
      item,
      tax
    });
    logSync('outbound', 'shopify_direct_camera', 'auto_publish_live', item.sku, 'success', `Published single-variant ${item.sku} directly to https://${domain}/products/${data.product.handle} (Product ID ${data.product.id}, ${cleanCdnImages.length} clean CDN images; QR card isolated to Shopify only).`);
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
async function purgeAllShopifyPreVinListings({ deleteProducts = false } = {}) {
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
  purgeAllShopifyPreVinListings,
  pushSingleItemToShopify,
  handleShopifyWebhook
};
