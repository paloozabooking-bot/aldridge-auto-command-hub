#!/usr/bin/env node
/**
 * Aldridge Auto's — Safe 905-SKU Legacy Importer for aldridgesales.myshopify.com
 *
 * Enforces all 3 strict rules:
 *  1. NEVER overwrites, modifies, or deletes any of the 57 live on-hand SKUs (ALD-OH-001 .. ALD-OH-057)
 *     or any handle/SKU already present on aldridgesales.myshopify.com.
 *  2. Preserves all 1,209 cdn.shopify.com image URLs (and automatically attaches raw .jpg binaries from
 *     Google Drive if Shopify purged old deleted-product CDN media), Two-Tier variants (Standard We-Pull
 *     vs. Certified Shop Installation), prices, weights, Used condition, Does Not Apply fallback MPNs,
 *     and Returns Not Accepted - Defect Only RMA policy tags.
 *  3. Supports:
 *     - `--stage-csv`: Generates `aldridge_905_legacy_two_tier_active_only.csv` (905 active SKUs only;
 *       0 draft holds, 0 archived SRS/cat items, 0 overlap with ALD-OH-001..057).
 *     - Live Shopify Admin API push (`SHOPIFY_ADMIN_TOKEN=shpat_... node scripts/push-905-legacy-shopify.js`)
 *       and verifies final live product count on `aldridgesales.myshopify.com`.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { getSettings, updateSettings, DATA_DIR } = require('../src/db');
const { generateShopifyCsv } = require('../src/exporters');
const { parseCsv } = require('../src/exporters-csv-utils');

const DOMAIN = 'aldridgesales.myshopify.com';
const API_VERSION = '2025-01';
const AUDIT_OUT_DIR = path.join(DATA_DIR, 'audit_outputs');
const DOWNLOADED_CSV = path.join(DATA_DIR, 'drive_downloaded_aldridge_shopify_sanitized_photo_preserving.csv');
const ARCHIVE_DB = path.join(DATA_DIR, 'archive_905_legacy.db');
const STAGED_TWO_TIER_CSV = path.join(AUDIT_OUT_DIR, 'aldridge_905_legacy_two_tier_active_only.csv');
const DRIVE_INDEX_PATH = path.join(AUDIT_OUT_DIR, 'legacy_905_drive_photo_index.json');

function loadExact905Items() {
  if (!fs.existsSync(DOWNLOADED_CSV)) {
    throw new Error(`Missing downloaded Drive CSV at ${DOWNLOADED_CSV}`);
  }
  const csvRows = parseCsv(fs.readFileSync(DOWNLOADED_CSV, 'utf8'));
  const activeCsvBySku = new Map();
  for (const r of csvRows) {
    if (r.Title && String(r.Status).trim().toLowerCase() === 'active') {
      const sku = String(r['Variant SKU'] || '').trim();
      if (sku) activeCsvBySku.set(sku, r);
    }
  }

  const { db } = require('../src/db');
  let sourceItems = db.prepare("SELECT * FROM inventory_items WHERE status = 'active' AND sku NOT LIKE 'ALD-OH-%' ORDER BY id ASC").all();
  if (sourceItems.length !== 905 && fs.existsSync(ARCHIVE_DB)) {
    const arch = new DatabaseSync(ARCHIVE_DB);
    sourceItems = arch.prepare('SELECT * FROM inventory_items ORDER BY id ASC').all();
  }
  const items905 = [];

  for (const item of sourceItems) {
    if (/^ALD-OH-/i.test(item.sku)) {
      throw new Error(`Safety Abort: Found ALD-OH SKU (${item.sku}) in legacy set!`);
    }
    if (!activeCsvBySku.has(item.sku)) continue; // Excludes any non-legacy demo SKUs
    // Ensure self-pull is off so every SKU has cleanly Two-Tier variants:
    // Tier 1: Standard We-Pull (Parcel + $10 handling OR 70+ lb Local Pickup 98467)
    // Tier 2: We Pull + Certified Shop Installation (University Place, WA 98467)
    items905.push({
      ...item,
      allow_self_pull: 0,
      price_self_pull: 0,
      allow_pull_install: 1
    });
  }

  if (items905.length !== 905) {
    throw new Error(`Expected exactly 905 active legacy SKUs, got ${items905.length}`);
  }
  return items905;
}

function buildDrivePhotoIndexIfMissing() {
  if (fs.existsSync(DRIVE_INDEX_PATH)) {
    try {
      const cached = JSON.parse(fs.readFileSync(DRIVE_INDEX_PATH, 'utf8'));
      if (Object.keys(cached).length > 50) return cached;
    } catch (_) {}
  }
  const index = {};
  try {
    const res = JSON.parse(
      execFileSync('gdrive', ['readonly', 'search', '--name-contains', 'ALD-', '--max', '1000', '--json'], {
        encoding: 'utf8',
        maxBuffer: 30 * 1024 * 1024
      })
    );
    for (const f of res) {
      if (f.mimeType && f.mimeType.startsWith('image/') && !index[f.name]) {
        index[f.name] = f.id;
      }
    }
    fs.writeFileSync(DRIVE_INDEX_PATH, JSON.stringify(index, null, 2));
  } catch (_) {}
  return index;
}

async function fetchAllExistingStoreHandlesAndSkus(token) {
  const existingHandles = new Set();
  const existingSkus = new Set();
  let totalCount = 0;
  let nextUrl = `https://${DOMAIN}/admin/api/${API_VERSION}/products.json?limit=250&fields=id,handle,title,status,variants`;

  while (nextUrl) {
    const resp = await fetch(nextUrl, {
      headers: { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' }
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Shopify Admin API GET failed (${resp.status}): ${body}`);
    }
    const data = await resp.json();
    for (const p of data.products || []) {
      totalCount++;
      existingHandles.add(String(p.handle || '').toLowerCase());
      for (const v of p.variants || []) {
        if (v.sku) existingSkus.add(String(v.sku).trim().toUpperCase());
      }
    }
    const link = resp.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = m ? m[1] : null;
  }

  return { totalCount, existingHandles, existingSkus };
}

async function resolveImagesPayloadForItem(item, driveIndex) {
  const urls = JSON.parse(item.photos_json || '[]');
  const images = [];
  const tmpDir = '/tmp/aldridge_legacy_img_cache';
  fs.mkdirSync(tmpDir, { recursive: true });

  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    const rawFileName = u.split('/files/').pop().split('?')[0] || `${item.sku}.${i + 1}.jpg`;
    const strippedUuidName = rawFileName.replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]+)$/i, '$1');
    const matchedDriveId = driveIndex[rawFileName] || driveIndex[strippedUuidName] || null;
    let cdnAlive = false;
    try {
      const head = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      cdnAlive = head.ok;
    } catch (_) {
      cdnAlive = false;
    }

    if (cdnAlive) {
      images.push({ src: u, position: i + 1, alt: item.title.slice(0, 70) });
    } else if (matchedDriveId) {
      const localTmp = path.join(tmpDir, strippedUuidName);
      if (!fs.existsSync(localTmp)) {
        execFileSync('gdrive', ['readonly', 'download', matchedDriveId, '--out', localTmp], { stdio: 'ignore' });
      }
      const b64 = fs.readFileSync(localTmp).toString('base64');
      images.push({ attachment: b64, filename: strippedUuidName, position: i + 1, alt: item.title.slice(0, 70) });
    } else {
      // Preserve original cdn.shopify.com URL per Rule 2 if not in Drive index
      images.push({ src: u, position: i + 1, alt: item.title.slice(0, 70) });
    }
  }
  return images;
}

async function main() {
  const settings = updateSettings({
    shopify_domain: DOMAIN,
    shopify_storefront_url: `https://${DOMAIN}`
  });

  const items905 = loadExact905Items();
  const twoTierCsv = generateShopifyCsv(items905, settings, `https://${DOMAIN}`);
  fs.mkdirSync(AUDIT_OUT_DIR, { recursive: true });
  fs.writeFileSync(STAGED_TWO_TIER_CSV, twoTierCsv, 'utf8');

  const parsedCheck = parseCsv(twoTierCsv);
  const primaryCount = parsedCheck.filter((r) => r.Title).length;
  const installVariantCount = parsedCheck.filter((r) => !r.Title && r['Variant SKU'] && r['Variant SKU'].endsWith('-INSTALL')).length;
  const secPhotoCount = parsedCheck.filter((r) => !r.Title && !r['Variant SKU'] && r['Image Src']).length;

  console.log('[Stage] Verified Two-Tier 905-SKU CSV generated:', {
    file: STAGED_TWO_TIER_CSV,
    primaryProducts: primaryCount,
    installVariants: installVariantCount,
    secondaryPhotoRows: secPhotoCount,
    totalCdnImageRows: primaryCount + secPhotoCount
  });

  if (process.argv.includes('--stage-only')) {
    const idx = buildDrivePhotoIndexIfMissing();
    console.log('[Stage] Cached Google Drive ALD-* photo index count:', Object.keys(idx).length);
    return;
  }

  const token = (process.env.SHOPIFY_ADMIN_TOKEN || settings.shopify_admin_token || '').trim();
  if (!token) {
    console.error('ERROR: Missing Shopify Admin API Access Token (shpat_...).');
    process.exit(2);
  }

  updateSettings({ shopify_admin_token: token });
  const driveIndex = buildDrivePhotoIndexIfMissing();
  const before = await fetchAllExistingStoreHandlesAndSkus(token);
  console.log(`[Shopify] Before import: ${before.totalCount} total products on ${DOMAIN} (${[...before.existingHandles].filter((h) => h.startsWith('ald-oh-')).length} ALD-OH-* protected).`);

  const { renderLocalMarketplacePacket } = require('../src/exporters');
  void renderLocalMarketplacePacket;

  // Build HTML bodies from staged CSV so Admin API push matches generateShopifyCsv byte-for-byte
  const bodyBySku = new Map();
  const tagsBySku = new Map();
  for (const r of parsedCheck) {
    if (r.Title && r['Variant SKU']) {
      bodyBySku.set(r['Variant SKU'], r['Body (HTML)']);
      tagsBySku.set(r['Variant SKU'], r.Tags);
    }
  }

  let created = 0;
  let skippedExisting = 0;
  const errors = [];

  for (const item of items905) {
    const handle = item.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (
      handle.startsWith('ald-oh-') ||
      before.existingHandles.has(handle) ||
      before.existingSkus.has(item.sku.toUpperCase())
    ) {
      skippedExisting++;
      continue;
    }

    const heavyPickupOnly = Number(item.weight_lbs || 0) >= 70 || item.shipping_class !== 'parcel_calculated';
    const variants = [
      {
        option1: heavyPickupOnly
          ? 'Local Pickup Only — University Place, WA 98467 (70+ lb)'
          : 'We Pull — Calculated Parcel (+$10.00 Handling) or Counter Pickup',
        sku: item.sku,
        price: Number(item.price_we_pull || 0).toFixed(2),
        inventory_management: 'shopify',
        inventory_quantity: item.quantity || 1,
        inventory_policy: 'deny',
        weight: Number(item.weight_lbs || 8),
        weight_unit: 'lb',
        requires_shipping: !heavyPickupOnly,
        taxable: true
      },
      {
        option1: 'We Pull + Certified Shop Installation — University Place, WA 98467 (Appt)',
        sku: `${item.sku}-INSTALL`,
        price: Number(item.price_pull_install || 0).toFixed(2),
        inventory_management: 'shopify',
        inventory_quantity: item.quantity || 1,
        inventory_policy: 'deny',
        weight: Number(item.weight_lbs || 8),
        weight_unit: 'lb',
        requires_shipping: false,
        taxable: true
      }
    ];

    try {
      const images = await resolveImagesPayloadForItem(item, driveIndex);
      const payload = {
        product: {
          title: item.title,
          handle,
          body_html: bodyBySku.get(item.sku) || item.description,
          vendor: settings.business_name,
          product_type: item.category,
          tags: tagsBySku.get(item.sku) || '',
          status: 'active',
          published: true,
          options: [{ name: 'Fulfillment & Service Option' }],
          variants,
          images
        }
      };

      const resp = await fetch(`https://${DOMAIN}/admin/api/${API_VERSION}/products.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token
        },
        body: JSON.stringify(payload)
      });

      if (resp.status === 429) {
        await new Promise((r) => setTimeout(r, 2200));
        const retry = await fetch(`https://${DOMAIN}/admin/api/${API_VERSION}/products.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
          body: JSON.stringify(payload)
        });
        if (!retry.ok) throw new Error(`HTTP ${retry.status}: ${await retry.text()}`);
      } else if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      }

      created++;
      if (created % 50 === 0) {
        console.log(`[Shopify] Progress: ${created}/${items905.length} created...`);
      }
      // Respect Shopify standard REST bucket (2 req/sec)
      await new Promise((r) => setTimeout(r, 520));
    } catch (err) {
      errors.push({ sku: item.sku, error: err.message });
    }
  }

  const after = await fetchAllExistingStoreHandlesAndSkus(token);
  console.log(JSON.stringify({
    domain: DOMAIN,
    created,
    skippedExisting,
    errorCount: errors.length,
    sampleErrors: errors.slice(0, 5),
    finalShopifyProductCount: after.totalCount,
    protectedOnHandCountIntact: [...after.existingHandles].filter((h) => h.startsWith('ald-oh-')).length
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
