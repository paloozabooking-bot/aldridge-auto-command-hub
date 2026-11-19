#!/usr/bin/env node
/**
 * Aldridge Auto's — Full Multi-Store Activation Builder
 * 1. Backs up 57-item on-hand DB -> data/backup_57_onhand_only.db
 * 2. Merges 905 clean sanitized legacy SKUs into data/command_hub.db WITHOUT touching ALD-OH-001..057 (Total = 962 active SKUs)
 * 3. Generates ready-to-launch channel files in data/audit_outputs/:
 *    - ebay_aabcas_safe_batch_1_50_skus.csv (First 50 safe parcel SKUs for eBay AABCAS)
 *    - local_pickup_98467_offerup_craigslist_ads.csv (11 heavy 70+ lb verified on-hand local ads)
 *    - aldridge_combined_962_vendoo.csv (All 962 SKUs for Vendoo)
 *    - aldridge_combined_962_meta_catalog.csv (All 962 SKUs for Meta Commerce Manager)
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { db, DATA_DIR, getSettings, logSync } = require('../src/db');
const {
  generateEbayMotorsCsv,
  generateVendooOrCrosslistCsv,
  generateMetaCatalogCsv,
  renderLocalMarketplacePacket
} = require('../src/exporters');
const { parseCsv, csvEscape } = require('../src/exporters-csv-utils');

const AUDIT_OUT_DIR = path.join(DATA_DIR, 'audit_outputs');
const DB_PATH = path.join(DATA_DIR, 'command_hub.db');
const BACKUP_57_PATH = path.join(DATA_DIR, 'backup_57_onhand_only.db');
const ARCHIVE_905_PATH = path.join(DATA_DIR, 'archive_905_legacy.db');
const DOWNLOADED_CSV = path.join(DATA_DIR, 'drive_downloaded_aldridge_shopify_sanitized_photo_preserving.csv');

fs.mkdirSync(AUDIT_OUT_DIR, { recursive: true });

// 1. Snapshot the 57-item DB before merging if not already backed up
const currentCount = db.prepare('SELECT COUNT(*) as c FROM inventory_items').get().c;
const ohBefore = db.prepare("SELECT COUNT(*) as c FROM inventory_items WHERE sku LIKE 'ALD-OH-%'").get().c;
if (currentCount === 57 && !fs.existsSync(BACKUP_57_PATH)) {
  db.exec(`VACUUM INTO '${BACKUP_57_PATH.replace(/'/g, "''")}';`);
}

// 2. Load exact 905 active SKUs from archive_905_legacy.db verified against downloaded Drive CSV
const csvRows = parseCsv(fs.readFileSync(DOWNLOADED_CSV, 'utf8'));
const activeLegacySkus = new Set(
  csvRows
    .filter((r) => r.Title && String(r.Status).trim().toLowerCase() === 'active')
    .map((r) => String(r['Variant SKU'] || '').trim())
    .filter(Boolean)
);

const arch = new DatabaseSync(ARCHIVE_905_PATH);
const archItems = arch.prepare('SELECT * FROM inventory_items ORDER BY id ASC').all();
const items905 = archItems.filter((i) => activeLegacySkus.has(i.sku) && !/^ALD-OH-/i.test(i.sku));

if (items905.length !== 905) {
  throw new Error(`Expected 905 legacy active SKUs, got ${items905.length}`);
}

// Map donor stock_number -> active DB donor_vehicle_id
const archDonors = new Map(arch.prepare('SELECT id, stock_number FROM donor_vehicles').all().map((d) => [d.id, d.stock_number]));
const activeDonors = new Map(db.prepare('SELECT stock_number, id FROM donor_vehicles').all().map((d) => [d.stock_number, d.id]));

const insertIgnore = db.prepare(`
  INSERT OR IGNORE INTO inventory_items (
    sku, title, category, condition, condition_id, brand, oem_part_number,
    interchange_number, hollander_number, placement_on_vehicle, donor_vehicle_id,
    fitment_years, fitment_make, fitment_model, fitment_engine, fitment_notes,
    description, defect_disclosure, bin_location, security_mark_code, security_mark_verified,
    security_mark_photo, photos_json, pull_status, allow_self_pull, price_self_pull,
    allow_we_pull, price_we_pull, allow_pull_install, price_pull_install, install_labor_hours,
    cost_basis, quantity, reserved_qty, weight_lbs, length_in, width_in, height_in,
    shipping_class, handling_fee, handling_days, channels_json, status, created_at, updated_at
  ) VALUES (
    ?, ?, ?, 'Used', 3000, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, 1,
    '', ?, ?, 0, 0,
    1, ?, 1, ?, ?,
    ?, ?, 0, ?, ?, ?, ?,
    ?, 10.00, 3, ?, 'active', ?, ?
  )
`);

let insertedLegacy = 0;
db.exec('BEGIN TRANSACTION;');
try {
  for (const it of items905) {
    const donorStock = it.donor_vehicle_id ? archDonors.get(it.donor_vehicle_id) : null;
    const mappedDonorId = donorStock ? (activeDonors.get(donorStock) || null) : null;
    const isHeavy = Number(it.weight_lbs || 0) >= 70 || it.shipping_class !== 'parcel_calculated';
    const res = insertIgnore.run(
      it.sku,
      it.title,
      it.category,
      it.brand || 'OEM',
      it.oem_part_number || '',
      it.interchange_number || '',
      it.hollander_number || '',
      it.placement_on_vehicle || '',
      mappedDonorId,
      it.fitment_years || '',
      it.fitment_make || '',
      it.fitment_model || '',
      it.fitment_engine || '',
      it.fitment_notes || '',
      it.description || it.title,
      it.defect_disclosure || 'Tested & inspected OEM part; see multi-angle photos.',
      it.bin_location || 'WHSE-LEGACY',
      it.security_mark_code,
      it.photos_json || '[]',
      it.pull_status || 'pulled_shelved',
      Number(it.price_we_pull || 0),
      Number(it.price_pull_install || 0),
      Number(it.install_labor_hours || 1.5),
      Number(it.cost_basis || 0),
      Number(it.quantity || 1),
      Number(it.weight_lbs || 8),
      Number(it.length_in || 14),
      Number(it.width_in || 10),
      Number(it.height_in || 8),
      isHeavy ? 'local_pickup_only' : 'parcel_calculated',
      it.channels_json || '{}',
      it.created_at,
      it.updated_at
    );
    insertedLegacy += res.changes;
  }
  logSync(
    'inbound',
    'co_master_962_merge',
    'merge_905_legacy_with_57_onhand',
    'ALL',
    'success',
    `Activated combined 962-SKU Co-Master catalog: 57 ALD-OH verified on-hand SKUs untouched + ${insertedLegacy} legacy active SKUs merged.`
  );
  db.exec('COMMIT;');
} catch (err) {
  db.exec('ROLLBACK;');
  throw err;
}

const ohAfter = db.prepare("SELECT COUNT(*) as c FROM inventory_items WHERE sku LIKE 'ALD-OH-%'").get().c;
const allActive = db.prepare("SELECT * FROM inventory_items WHERE status = 'active' ORDER BY id ASC").all();
const settings = getSettings();

// 3a. Safe eBay Batch #1 (First 50 parcel-shippable SKUs: 46 verified on-hand ALD-OH parcel SKUs + 4 clean MPN legacy SKUs)
const ohParcel = allActive.filter((i) => i.sku.startsWith('ALD-OH-') && i.shipping_class === 'parcel_calculated' && Number(i.weight_lbs) < 70);
const legacyParcelTop4 = allActive
  .filter((i) => !i.sku.startsWith('ALD-OH-') && i.shipping_class === 'parcel_calculated' && Number(i.weight_lbs) < 70 && i.oem_part_number)
  .slice(0, 50 - ohParcel.length);
const ebayBatch50 = [...ohParcel, ...legacyParcelTop4];
const ebayBatchCsv = generateEbayMotorsCsv(ebayBatch50, settings, '');
fs.writeFileSync(path.join(AUDIT_OUT_DIR, 'ebay_aabcas_safe_batch_1_50_skus.csv'), ebayBatchCsv, 'utf8');

// 3b. Local Pickup 98467 Heavy Cash Drip Packet (11 heavy 70+ lb verified physical ALD-OH SKUs)
const ohHeavy11 = allActive.filter((i) => i.sku.startsWith('ALD-OH-') && (i.shipping_class !== 'parcel_calculated' || Number(i.weight_lbs) >= 70));
const localHeaders = ['SKU', 'Title', 'Price_USD', 'Installed_Price_USD', 'Weight_Lbs', 'Pickup_Location', 'Primary_Photo_File', 'Ready_To_Paste_OfferUp_Craigslist_FB_Ad'];
const localRows = [localHeaders.join(',')];
for (const item of ohHeavy11) {
  const copyText = renderLocalMarketplacePacket(item, settings);
  const firstPhoto = (JSON.parse(item.photos_json || '[]')[0] || '').replace('/uploads/', '');
  localRows.push([
    item.sku,
    item.title,
    Number(item.price_we_pull).toFixed(2),
    Number(item.price_pull_install).toFixed(2),
    item.weight_lbs,
    '5115 66th St W, Bldg B, University Place, WA 98467',
    firstPhoto,
    copyText
  ].map(csvEscape).join(','));
}
fs.writeFileSync(path.join(AUDIT_OUT_DIR, 'local_pickup_98467_offerup_craigslist_ads.csv'), localRows.join('\n') + '\n', 'utf8');

// 3c. Combined 962-SKU Vendoo & Meta Catalog CSVs
const vendoo962 = generateVendooOrCrosslistCsv(allActive, settings, 'https://aldridgesales.myshopify.com', 'vendoo');
const meta962 = generateMetaCatalogCsv(allActive, settings, 'https://aldridgesales.myshopify.com');
fs.writeFileSync(path.join(AUDIT_OUT_DIR, 'aldridge_combined_962_vendoo.csv'), vendoo962, 'utf8');
fs.writeFileSync(path.join(AUDIT_OUT_DIR, 'aldridge_combined_962_meta_catalog.csv'), meta962, 'utf8');

console.log(JSON.stringify({
  ohProtectedBefore: ohBefore,
  ohProtectedAfter: ohAfter,
  insertedLegacy,
  totalActiveInCommandHubDb: allActive.length,
  ebayBatch1Count: ebayBatch50.length,
  localHeavyAdsCount: ohHeavy11.length,
  localHeavyTotalValueUSD: Number(ohHeavy11.reduce((s, i) => s + Number(i.price_we_pull || 0), 0).toFixed(2)),
  vendooRows: vendoo962.trim().split('\n').length - 1,
  metaRows: meta962.trim().split('\n').length - 1
}, null, 2));
