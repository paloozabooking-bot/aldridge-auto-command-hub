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
  logSync
} = require('./db');
const { generateAllPolicies } = require('./policies');
const { csvEscape, xmlEscape, parseCsv } = require('./exporters-csv-utils');
const { isQrCardUrl, generatePartQrCardPng } = require('./qr-card');
const { resolvePartTaxonomyAndMetafields } = require('./taxonomy');
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
  if (!hasRealPhotos(item)) return false;
  const skuUpper = String(item.sku || '').trim().toUpperCase();
  if (PROHIBITED_CAT_SKUS.has(skuUpper) || PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS.has(skuUpper)) {
    return false;
  }
  const comp = validatePartCompliance({
    title: item.title,
    category: item.category,
    description: item.description
  });
  if (!comp.compliant) return false;

  if (item.donor_vehicle_id) {
    const dv = db.prepare('SELECT vin FROM donor_vehicles WHERE id = ?').get(item.donor_vehicle_id);
    if (dv && dv.vin && !validateVinStrict(dv.vin).valid) return false;
  }
  return true;
}

function sanitizeMpnField(rawMpn) {
  const val = String(rawMpn || '').trim();
  if (!val || /^does\s+not\s+apply$/i.test(val) || /^n\/?a$/i.test(val)) return '';
  return isCounterfeitMpn(val) ? '' : val;
}

function resolveExportMpn(rawMpn) {
  const clean = sanitizeMpnField(rawMpn);
  return clean || 'Does Not Apply';
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
  const storedInstall = Number(item.price_pull_install || 0);
  const hours = Number(item.install_labor_hours || 1.5);
  const rate = Number(settings?.labor_rate_hourly || 135);
  const installTotal = storedInstall > base ? storedInstall : Math.round((base + hours * rate) * 100) / 100;
  return { installTotal, hours };
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

function renderShopifyHtml(item, settings, baseUrl) {
  const policies = generateAllPolicies(settings);
  const tpl = policies.shopify_direct_html_template || policies.ebay_motors_html_template;
  const mpnOut = resolveExportMpn(item.oem_part_number);
  const condOut = normalizeExportCondition(item.condition);
  const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
  const { installTotal, hours } = computeInstallEstimate(item, settings);
  const { pwaUrl } = resolveDirectPublicUrls(settings, baseUrl);
  const phone = settings.phone || '(253) 245-4206';

  const installCalloutHtml = `<div style="background:#f0f9ff;border:1px solid #0284c7;border-radius:6px;padding:12px 14px;margin-bottom:12px;font-size:13px;line-height:1.5;">
      <strong style="color:#0369a1;">🔧 OPTIONAL CERTIFIED SHOP BAY INSTALLATION (INFO-ONLY — SINGLE-UNIT PART):</strong><br/>
      Estimated Turnkey Part + Certified Installation at our 5.0★ University Place, WA 98467 bays: <strong>$${installTotal.toFixed(2)}</strong> <em>(includes this tested OEM part + ~${hours.toFixed(1)} hrs certified technician labor at 5115 66th St W, Bldg B)</em>.<br/>
      <span style="font-size:12px;color:#334155;">To prevent double-booking this 1-of-1 part, purchase the part here first to lock it in, then schedule your bay installation on our <a href="${pwaUrl}" style="color:#0369a1;font-weight:700;">Live Website &amp; Mobile App (${pwaUrl.replace(/^https?:\/\//i, '')})</a> or call/text <strong>${phone}</strong>.</span>
    </div>`;

  const directAppCalloutHtml = `<div style="background:#f8fafc;border:1px solid #0b1628;border-radius:6px;padding:12px 14px;margin-bottom:12px;font-size:12.5px;line-height:1.5;">
      <strong style="color:#0b1628;">📱 BUY DIRECT &amp; INSTALL THE ALDRIDGE AUTO'S MOBILE APP (SAVE ON MARKETPLACE FEES):</strong><br/>
      Shop our full verified photo catalog directly at <a href="${pwaUrl}" style="color:#ea580c;font-weight:700;">${pwaUrl}</a> and tap <strong>"Add to Home Screen"</strong> on iPhone or Android for instant 17-digit VIN checks, bay booking, and direct repeat-customer pricing!
    </div>`;

  const shipLabel = heavyPickupOnly
    ? 'Local Pickup Only in University Place, WA 98467'
    : `Calculated Parcel + $${Number(settings.handling_fee_default ?? 10).toFixed(2)} Handling`;

  return tpl
    .replaceAll('{{BUSINESS_NAME}}', settings.business_name)
    .replaceAll('{{SKU}}', item.sku)
    .replaceAll('{{OEM_PART_NUMBER}}', mpnOut)
    .replaceAll('{{INTERCHANGE_NUMBER}}', item.interchange_number || 'Does Not Apply')
    .replaceAll('{{HOLLANDER_NUMBER}}', item.hollander_number ? `(Hollander #${item.hollander_number})` : '')
    .replaceAll('{{SECURITY_CODE}}', item.security_mark_code)
    .replaceAll('{{TITLE}}', item.title)
    .replaceAll('{{DESCRIPTION}}', item.description || item.title)
    .replaceAll('{{CONDITION}}', condOut)
    .replaceAll('{{DEFECT_DISCLOSURE}}', item.defect_disclosure || 'Inspected & verified.')
    .replaceAll('{{FITMENT_YEARS}}', item.fitment_years || '')
    .replaceAll('{{FITMENT_MAKE}}', item.fitment_make || '')
    .replaceAll('{{FITMENT_MODEL}}', item.fitment_model || '')
    .replaceAll('{{FITMENT_ENGINE}}', item.fitment_engine || 'Verify OEM #')
    .replaceAll('{{FITMENT_NOTES}}', item.fitment_notes || 'Match MPN & photos prior to purchase (Returns Not Accepted for remorse/fitment).')
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
  const condOut = normalizeExportCondition(item.condition);
  const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
  const { installTotal, hours } = computeInstallEstimate(item, settings);

  // 100% eBay Policy Compliant Callout — ZERO external URLs, domains, or phone numbers!
  const installCalloutEbayHtml = `<div style="background:#f0f9ff;border:1px solid #0284c7;border-radius:6px;padding:12px 14px;margin-bottom:12px;font-size:13px;line-height:1.5;">
      <strong style="color:#0369a1;">OPTIONAL CERTIFIED IN-HOUSE SHOP INSTALLATION (UNIVERSITY PLACE, WA 98467):</strong><br/>
      Informational Turnkey Part + Certified Bay Installation Estimate: <strong>$${installTotal.toFixed(2)}</strong> <em>(~${hours.toFixed(1)} hrs certified technician labor at our 5.0★ University Place, WA 98467 shop)</em>. Listed strictly as 1 single physical unit so inventory is never double-booked — local Pierce County buyers may message us directly via <strong>eBay Messages</strong> regarding counter pickup or bay installation availability!
    </div>`;

  const shipLabel = heavyPickupOnly
    ? 'Local Pickup Only in University Place, WA 98467'
    : `Calculated Parcel + $${Number(settings.handling_fee_default ?? 10).toFixed(2)} Handling`;

  return tpl
    .replaceAll('{{BUSINESS_NAME}}', settings.business_name)
    .replaceAll('{{SKU}}', item.sku)
    .replaceAll('{{OEM_PART_NUMBER}}', mpnOut)
    .replaceAll('{{INTERCHANGE_NUMBER}}', item.interchange_number || 'Does Not Apply')
    .replaceAll('{{HOLLANDER_NUMBER}}', item.hollander_number ? `(Hollander #${item.hollander_number})` : '')
    .replaceAll('{{SECURITY_CODE}}', item.security_mark_code)
    .replaceAll('{{TITLE}}', stripOffEbayContactText(item.title))
    .replaceAll('{{DESCRIPTION}}', stripOffEbayContactText(item.description || item.title))
    .replaceAll('{{CONDITION}}', condOut)
    .replaceAll('{{DEFECT_DISCLOSURE}}', stripOffEbayContactText(item.defect_disclosure || 'Inspected & verified.'))
    .replaceAll('{{FITMENT_YEARS}}', item.fitment_years || '')
    .replaceAll('{{FITMENT_MAKE}}', item.fitment_make || '')
    .replaceAll('{{FITMENT_MODEL}}', item.fitment_model || '')
    .replaceAll('{{FITMENT_ENGINE}}', item.fitment_engine || 'Verify OEM #')
    .replaceAll('{{FITMENT_NOTES}}', stripOffEbayContactText(item.fitment_notes || 'Match MPN & photos prior to purchase (Returns Not Accepted for remorse/fitment).'))
    .replaceAll('{{BIN_LOCATION}}', item.bin_location || 'MAIN-WHSE')
    .replaceAll('{{WEIGHT_LBS}}', String(item.weight_lbs || 10))
    .replaceAll('{{DIMENSIONS_IN}}', formatDimensionsIn(item))
    .replaceAll('{{SHIPPING_SUMMARY_LABEL}}', shipLabel)
    .replaceAll('{{INSTALL_CALLOUT_EBAY_HTML}}', installCalloutEbayHtml);
}

function renderLocalMarketplacePacket(item, settings, baseUrl) {
  const tpl = generateAllPolicies(settings).local_marketplace_template;
  const mpnOut = resolveExportMpn(item.oem_part_number);
  const condOut = normalizeExportCondition(item.condition);
  const handlingFee = Number(settings.handling_fee_default ?? 10).toFixed(2);
  const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
  const { installTotal, hours } = computeInstallEstimate(item, settings);
  const { pwaUrl } = resolveDirectPublicUrls(settings, baseUrl);

  const shipOrPickupLine = heavyPickupOnly
    ? `$${Number(item.price_we_pull || 0).toFixed(2)} — LOCAL PICKUP ONLY in University Place, WA 98467 (70+ lb / oversized / hazmat assembly at 5115 66th St W, Bldg B)`
    : `$${Number(item.price_we_pull || 0).toFixed(2)} (+ Calculated Parcel Shipping + $${handlingFee} handling buffer if shipped, or FREE Shop Counter Pickup in University Place, WA 98467!)`;

  const installLine = `OPTIONAL CERTIFIED SHOP INSTALLATION (INFO CALLOUT): ~$${installTotal.toFixed(2)} turnkey installed (~${hours.toFixed(1)} hrs certified bay labor in University Place, WA 98467 — purchase single-unit part to reserve)!`;

  return tpl
    .replaceAll('{{TITLE}}', item.title)
    .replaceAll('{{OEM_PART_NUMBER}}', mpnOut)
    .replaceAll('{{INTERCHANGE_NUMBER}}', item.interchange_number || item.hollander_number || 'Does Not Apply')
    .replaceAll('{{SKU}}', item.sku)
    .replaceAll('{{FITMENT_YEARS}}', item.fitment_years || '')
    .replaceAll('{{FITMENT_MAKE}}', item.fitment_make || '')
    .replaceAll('{{FITMENT_MODEL}}', item.fitment_model || '')
    .replaceAll('{{FITMENT_ENGINE}}', item.fitment_engine || '')
    .replaceAll('{{WEIGHT_LBS}}', String(item.weight_lbs || 10))
    .replaceAll('{{DIMENSIONS_IN}}', formatDimensionsIn(item))
    .replaceAll('{{CONDITION}}', condOut)
    .replaceAll('{{DESCRIPTION}}', item.description || '')
    .replaceAll('{{DEFECT_DISCLOSURE}}', item.defect_disclosure || 'Clean tested assembly.')
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
        row.price_pull_install || (priceWePull + laborHours * Number(settings.labor_rate_hourly || 135)).toFixed(2)
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
      const finalQty = isNaN(rawQty) ? 1 : rawQty;
      const rowStatus = row.Status && ['archived', 'draft'].includes(String(row.Status).toLowerCase())
        ? String(row.Status).toLowerCase()
        : (finalQty > 0 ? 'active' : 'sold');

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
    // Hard compliance, fake-VIN & real-photo guard: never export SRS/catalytic, fake-VIN, or photo-less items!
    if (!hasRealPhotos(item)) continue;
    const comp = validatePartCompliance({ title: item.title, category: item.category, description: item.description });
    if (!comp.compliant) continue;
    if (item.donor_vehicle_id) {
      const dv = db.prepare('SELECT vin FROM donor_vehicles WHERE id = ?').get(item.donor_vehicle_id);
      if (dv && dv.vin && !validateVinStrict(dv.vin).valid) continue;
    }
    const skuUpper = String(item.sku || '').trim().toUpperCase();
    if (PROHIBITED_CAT_SKUS.has(skuUpper) || PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS.has(skuUpper)) continue;

    const tax = resolvePartTaxonomyAndMetafields(item, settings);
    const handle = item.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const photos = getShopifyGalleryPhotos(item, settings);
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
function generateEbayMotorsCsv(items, settings, baseUrl) {
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
    const tax = resolvePartTaxonomyAndMetafields(item, settings);
    const photos = getValidPhotos(item);
    const picUrl = photos.map((p) => resolveExportPhotoUrl(p, baseUrl, settings)).join('|');
    const ebayTitle = cleanListingTitle(item.title).slice(0, 80);
    const condOut = normalizeExportCondition(item.condition);
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);

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
      [item.interchange_number, item.hollander_number].filter(Boolean).join(', ') || 'Does Not Apply',
      item.placement_on_vehicle || 'Vehicle Specific',
      picUrl,
      renderEbayHtml(item, settings),
      'FixedPrice',
      'GTC',
      Number(item.price_we_pull || 0).toFixed(2),
      1,
      'University Place, WA 98467',
      settings.handling_days_default || 3,
      heavyPickupOnly ? 'Flat' : 'Calculated',
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

function generateGoogleMerchantXml(items, settings, baseUrl) {
  const activeItems = items.filter(isMarketplaceSafeItem);
  const { pwaUrl } = resolveDirectPublicUrls(settings, baseUrl);
  const itemNodes = activeItems.map((item) => {
    const tax = resolvePartTaxonomyAndMetafields(item, settings);
    const photos = getValidPhotos(item);
    const imgUrl = resolveExportPhotoUrl(photos[0], baseUrl, settings);
    const avail = item.quantity > 0 ? 'in_stock' : 'out_of_stock';
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
    const { installTotal } = computeInstallEstimate(item, settings);
    return `    <item>
      <g:id>${xmlEscape(item.sku)}</g:id>
      <g:title>${xmlEscape(item.title)}</g:title>
      <g:description>${xmlEscape(`${item.description} | Optional Certified Shop Bay Installation in University Place, WA 98467: $${installTotal.toFixed(2)} turnkey installed | Fits: ${tax.customLabel0} | MPN: ${tax.mpn}`)}</g:description>
      <g:link>${xmlEscape(`${pwaUrl}/?sku=${encodeURIComponent(item.sku)}`)}</g:link>
      <g:image_link>${xmlEscape(imgUrl)}</g:image_link>
      <g:condition>${xmlEscape(tax.condition)}</g:condition>
      <g:availability>${avail}</g:availability>
      <g:price>${Number(item.price_we_pull || 0).toFixed(2)} USD</g:price>
      <g:brand>${xmlEscape(tax.brand)}</g:brand>
      <g:mpn>${xmlEscape(tax.mpn)}</g:mpn>
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
    const imgUrl = resolveExportPhotoUrl(photos[0], baseUrl, settings);
    const mpnOut = resolveExportMpn(item.oem_part_number);
    const condOut = normalizeExportCondition(item.condition);
    const cond = condOut === 'New' ? 'new' : 'used';
    const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
    const { installTotal } = computeInstallEstimate(item, settings);
    rows.push([
      item.sku,
      item.title.slice(0, 150),
      `${item.title}. Single-unit OEM part (1 in stock). MPN: ${mpnOut}. Optional Certified Shop Installation in University Place, WA 98467: $${installTotal.toFixed(2)} turnkey installed. ${heavyPickupOnly ? 'Local Pickup Only in University Place, WA 98467.' : 'Calculated Parcel + $10.00 handling or Free Local Pickup in University Place, WA 98467.'} Returns Not Accepted (Defect-Only).`,
      item.quantity > 0 && item.status === 'active' ? 'in stock' : 'out of stock',
      cond,
      `${Number(item.price_we_pull || 0).toFixed(2)} USD`,
      `${pwaUrl}/?sku=${encodeURIComponent(item.sku)}`,
      imgUrl,
      item.brand || 'OEM',
      mpnOut,
      item.status === 'active' ? Math.max(1, Number(item.quantity || 1)) : 0,
      'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts'
    ].map(csvEscape).join(','));
  }
  return rows.join('\n') + '\n';
}

function generateVendooOrCrosslistCsv(items, settings, baseUrl, mode = 'vendoo') {
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
    const { installTotal } = computeInstallEstimate(item, settings);
    // Compliant marketplace description (includes Certified Shop Install price at 5115 66th St W Bldg B, zero external URLs/phones so eBay aabcas + OfferUp + FB Marketplace channels stay safe)
    const compliantDesc = `${stripOffEbayContactText(item.title)} | MPN: ${mpnOut} | Single-Unit OEM Part (1 in stock) | Fits: ${tax.customLabel0} | Spec: ${item.weight_lbs} lbs (${formatDimensionsIn(item)} in) | Optional Certified Shop Bay Installation at 5115 66th St W, Bldg B, University Place, WA 98467: ~$${installTotal.toFixed(2)} turnkey installed | ${shippingPolicy} | ${returnPolicy} | Security ID: ${item.security_mark_code}`;

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
    const { installTotal } = computeInstallEstimate(item, settings);
    const desc = `${stripOffEbayContactText(item.description || item.title)} | Single-unit OEM part (1 in stock). Optional Certified Shop Bay Installation in University Place, WA 98467: $${installTotal.toFixed(2)} installed. Security ID: ${item.security_mark_code}.`;
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
      donorStock, item.sku, item.hollander_number || item.interchange_number || 'Does Not Apply',
      resolveExportMpn(item.oem_part_number), item.fitment_years || '', item.fitment_make || '',
      item.fitment_model || '', item.category, 'Used',
      Number(item.price_we_pull || 0).toFixed(2),
      installTotal.toFixed(2),
      item.bin_location || '', item.security_mark_code, 1
    ].map(csvEscape).join(','));
  }
  return rows.join('\n') + '\n';
}

async function syncAllToShopifyCoMaster() {
  const settings = getSettings();
  const items = db.prepare('SELECT * FROM inventory_items').all().filter(isMarketplaceSafeItem);
  if (!settings.shopify_domain || !settings.shopify_admin_token) {
    logSync(
      'outbound',
      'shopify_co_master',
      'staged_sync_ready',
      'ALL',
      'staged',
      `Staged ${items.length} single-variant photo-verified products for Shopify sync. Add your .myshopify.com domain & Admin API token in Business Settings Vault for live push/pull.`
    );
    return {
      mode: 'staged_ready',
      synced_count: items.length,
      message: 'Shopify Single-Variant payload staged (Photos Required + Shop Install in Description HTML). Paste your Shopify Admin API token in Settings Vault to activate live API push.'
    };
  }

  const domain = settings.shopify_domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const existingHandles = new Set();
  const existingSkus = new Set();
  let nextUrl = `https://${domain}/admin/api/2025-01/products.json?limit=250&fields=id,handle,variants`;
  while (nextUrl) {
    const preResp = await fetch(nextUrl, {
      headers: { 'X-Shopify-Access-Token': settings.shopify_admin_token, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!preResp.ok) {
      throw new Error(`Shopify Admin API authentication check failed (HTTP ${preResp.status})`);
    }
    const preData = await preResp.json();
    for (const p of preData.products || []) {
      existingHandles.add(String(p.handle || '').toLowerCase());
      for (const v of p.variants || []) {
        if (v.sku) existingSkus.add(String(v.sku).trim().toUpperCase());
      }
    }
    const link = preResp.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = m ? m[1] : null;
  }

  let pushed = 0;
  let skippedProtected = 0;
  const errors = [];

  for (const item of items) {
    try {
      const handle = item.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (
        existingHandles.has(handle) ||
        existingSkus.has(String(item.sku || '').toUpperCase())
      ) {
        skippedProtected++;
        continue;
      }

      const tax = resolvePartTaxonomyAndMetafields(item, settings);
      const heavyPickupOnly = isHeavyLocalPickupItem(item, settings);
      const dimsLabel = `${Math.round(Number(item.length_in || 14))}x${Math.round(Number(item.width_in || 10))}x${Math.round(Number(item.height_in || 8))} in`;
      const tags = [...tax.seoTags, `Dims:${dimsLabel}`].join(', ');

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

      const metafields = [
        { namespace: 'mm-google-shopping', key: 'google_product_category', value: tax.googleProductCategory, type: 'single_line_text_field' },
        { namespace: 'mm-google-shopping', key: 'condition', value: tax.condition, type: 'single_line_text_field' },
        { namespace: 'mm-google-shopping', key: 'mpn', value: tax.mpn, type: 'single_line_text_field' },
        { namespace: 'mm-google-shopping', key: 'custom_label_0', value: tax.customLabel0, type: 'single_line_text_field' },
        { namespace: 'mm-google-shopping', key: 'custom_label_1', value: tax.customLabel1, type: 'single_line_text_field' },
        { namespace: 'custom', key: 'oem_part_number', value: tax.mpn, type: 'single_line_text_field' },
        { namespace: 'custom', key: 'ebay_us_category_id', value: tax.ebayUsCategoryId, type: 'single_line_text_field' },
        { namespace: 'custom', key: 'shopify_taxonomy_id', value: tax.shopifyTaxonomyId, type: 'single_line_text_field' },
        { namespace: 'custom', key: 'package_dimensions', value: dimsLabel, type: 'single_line_text_field' },
        { namespace: 'custom', key: 'crosslist_offerup_fb_sync', value: 'enabled_auto_delist_on_zero', type: 'single_line_text_field' }
      ];

      const uploadsDir = path.join(DATA_DIR, 'uploads');
      const reviewThumbsDir = path.join(__dirname, '..', 'public', 'review-thumbs');
      const rawPhotos = getShopifyGalleryPhotos(item, settings, uploadsDir);
      const images = rawPhotos.map((u, idx) => {
        const altText = isQrCardUrl(u)
          ? `${item.sku} Security Tag ${item.security_mark_code} - Scan QR for Aldridge Auto's App`.slice(0, 70)
          : item.title.slice(0, 70);
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
      let resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': settings.shopify_admin_token
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000)
      });

      if (resp.status === 429) {
        await new Promise((r) => setTimeout(r, 2200));
        resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': settings.shopify_admin_token
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(12000)
        });
      }

      if (!resp.ok) {
        throw new Error(`Shopify HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (data.product && data.product.id) {
        const primaryVar = data.product.variants?.[0] || {};
        const cdnImages = (data.product.images || []).map((img) => img.src).filter(Boolean);
        const nextPhotosJson = cdnImages.length > 0 ? JSON.stringify(cdnImages) : (item.photos_json || JSON.stringify(getValidPhotos(item)));
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
      }
      pushed++;
      await new Promise((r) => setTimeout(r, 520));
    } catch (err) {
      errors.push(`${item.sku}: ${err.message}`);
    }
  }

  const finalCount = existingHandles.size + pushed;
  logSync('outbound', 'shopify_co_master', 'live_api_push', 'ALL', errors.length ? 'partial' : 'success', `Created ${pushed} new single-variant products on ${domain} (${skippedProtected} existing SKUs untouched, ${errors.length} errors; total live=${finalCount}).`);
  return { mode: 'live_api', synced_count: pushed, skipped_protected: skippedProtected, total_live_shopify_products: finalCount, errors };
}

function handleShopifyWebhook(topic, rawBody, hmacHeader) {
  const settings = getSettings();
  if (settings.shopify_webhook_secret && hmacHeader) {
    const digest = crypto
      .createHmac('sha256', settings.shopify_webhook_secret)
      .update(rawBody, 'utf8')
      .digest('base64');
    if (digest !== hmacHeader) {
      throw new Error('Invalid Shopify webhook HMAC signature');
    }
  }

  const payload = JSON.parse(rawBody || '{}');
  const now = new Date().toISOString();

  if (topic === 'orders/create' && Array.isArray(payload.line_items)) {
    for (const li of payload.line_items) {
      const baseSku = String(li.sku || '').replace(/-(SELFPULL|INSTALL)$/, '');
      if (!baseSku) continue;
      const item = db.prepare('SELECT * FROM inventory_items WHERE sku = ?').get(baseSku);
      if (item) {
        const nextQty = Math.max(0, item.quantity - Number(li.quantity || 1));
        const nextStatus = nextQty === 0 ? 'sold' : 'active';
        db.prepare('UPDATE inventory_items SET quantity = ?, status = ?, updated_at = ? WHERE id = ?').run(
          nextQty, nextStatus, now, item.id
        );
        logSync('inbound', 'shopify_webhook', 'order_stock_decrement', baseSku, 'success', `Shopify Order #${payload.name || payload.id} decremented single-variant ${baseSku} to ${nextQty}. Queued zero-out across eBay/Feeds.`);
      }
    }
  } else if (topic === 'products/update' && Array.isArray(payload.variants)) {
    for (const v of payload.variants) {
      const baseSku = String(v.sku || '').replace(/-(SELFPULL|INSTALL)$/, '');
      if (!baseSku || String(v.sku || '').endsWith('-SELFPULL') || String(v.sku || '').endsWith('-INSTALL')) continue;
      const item = db.prepare('SELECT * FROM inventory_items WHERE sku = ?').get(baseSku);
      if (item && v.inventory_quantity !== undefined) {
        const nextQty = Math.max(0, Number(v.inventory_quantity));
        db.prepare('UPDATE inventory_items SET quantity = ?, price_we_pull = COALESCE(?, price_we_pull), status = ?, updated_at = ? WHERE id = ?').run(
          nextQty, parseFloat(v.price) || item.price_we_pull, nextQty === 0 ? 'sold' : 'active', now, item.id
        );
        logSync('inbound', 'shopify_webhook', 'co_master_product_sync', baseSku, 'success', `Co-Master sync updated ${baseSku} qty=${nextQty}, price=$${v.price}`);
      }
    }
  }

  return { ok: true, topic };
}

async function pushSingleItemToShopify(item, settings, uploadsDir) {
  const cfg = settings || getSettings();
  const domain = (cfg.shopify_domain || 'aldridgesales.myshopify.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  if (!hasRealPhotos(item)) {
    return {
      pushed: false,
      shopify_domain: domain,
      reason: 'Blocked: Real part photos are required before publishing to Shopify or eBay.'
    };
  }

  if (!cfg.shopify_admin_token) {
    return {
      pushed: false,
      queued_for_shopify: true,
      queued_for_ebay: true,
      shopify_domain: domain,
      reason: 'Awaiting SHOPIFY_ADMIN_TOKEN in Settings Vault or cloud env vars'
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

  const metafields = [
    { namespace: 'mm-google-shopping', key: 'google_product_category', value: tax.googleProductCategory, type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'condition', value: tax.condition, type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'mpn', value: tax.mpn, type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'custom_label_0', value: tax.customLabel0, type: 'single_line_text_field' },
    { namespace: 'mm-google-shopping', key: 'custom_label_1', value: tax.customLabel1, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'oem_part_number', value: tax.mpn, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'ebay_us_category_id', value: tax.ebayUsCategoryId, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'shopify_taxonomy_id', value: tax.shopifyTaxonomyId, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'package_dimensions', value: dimsLabel, type: 'single_line_text_field' },
    { namespace: 'custom', key: 'crosslist_offerup_fb_sync', value: 'enabled_auto_delist_on_zero', type: 'single_line_text_field' }
  ];

  const targetDir = uploadsDir || path.join(DATA_DIR, 'uploads');
  const reviewThumbsDir = path.join(__dirname, '..', 'public', 'review-thumbs');
  const rawPhotos = getShopifyGalleryPhotos(item, cfg, targetDir);
  const images = [];
  let pos = 1;
  for (const str of rawPhotos) {
    const altText = isQrCardUrl(str)
      ? `${item.sku} Security Tag ${item.security_mark_code} - Scan QR for Aldridge Auto's App`.slice(0, 70)
      : item.title.slice(0, 70);
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
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': cfg.shopify_admin_token
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });

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
    const cdnImages = (data.product.images || []).map((img) => img.src).filter(Boolean);
    const nextPhotosJson = cdnImages.length > 0 ? JSON.stringify(cdnImages) : (item.photos_json || JSON.stringify(getValidPhotos(item)));
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
    logSync('outbound', 'shopify_direct_camera', 'auto_publish_live', item.sku, 'success', `Published single-variant ${item.sku} directly to https://${domain}/products/${data.product.handle} (Product ID ${data.product.id}, ${cdnImages.length} CDN images incl. final QR App Card; clean photos preserved for eBay/Google).`);
    return {
      pushed: true,
      shopify_domain: domain,
      shopify_product_id: String(data.product.id),
      shopify_url: `https://${domain}/products/${data.product.handle}`,
      cdn_photos: cdnImages,
      queued_for_ebay: true
    };
  }

  return { pushed: false, queued_for_ebay: true, shopify_domain: domain };
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
  generateGoogleMerchantXml,
  generateMetaCatalogCsv,
  generateVendooOrCrosslistCsv,
  generateCraigslistCsv,
  generateTiktokShopCsv,
  generateCarPartHollanderCsv,
  renderLocalMarketplacePacket,
  syncAllToShopifyCoMaster,
  pushSingleItemToShopify,
  handleShopifyWebhook
};
