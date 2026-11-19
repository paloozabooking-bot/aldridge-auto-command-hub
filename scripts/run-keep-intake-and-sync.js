#!/usr/bin/env node
/**
 * Batch AI Intake + Single-Variant OEM SKU Builder + Shopify Live Push Runner
 * Converts all KEEP photos from data/command_hub.db / data/review_catalog.json
 * into active single-variant (1 in stock) OEM inventory SKUs, generates QR cards,
 * pushes live to Shopify Admin API (when SHOPIFY_ADMIN_TOKEN is set), and
 * checkpoints SQLite WAL so data/command_hub.db is immediately commit/deploy-ready.
 */

const fs = require('node:fs');
const path = require('node:path');

// Auto-load local .env if present (Node 24 built-in support)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

const { db, DATA_DIR, getSettings } = require('../src/db');
const { runKeepBatchIntakeAndPublish } = require('../src/keep-intake-batch');

(async () => {
  const cfg = getSettings();
  const baseUrl = cfg.canonical_domain || cfg.public_pwa_url || 'https://aldridgeautosupply.com';
  const uploadsDir = path.join(DATA_DIR, 'uploads');

  console.log('=== Aldridge Auto Batch AI Intake & Shopify Sync ===');
  console.log('Shopify Shop Domain:', cfg.shopify_domain || '(unset)');
  console.log('Shopify Admin Token:', cfg.shopify_admin_token ? 'CONFIGURED (live push enabled)' : 'NOT SET (staging payload ready)');
  console.log('Gemini API Key:', cfg.gemini_api_key ? 'CONFIGURED' : 'NOT SET');
  console.log('Canonical Domain:', baseUrl);

  const result = await runKeepBatchIntakeAndPublish({
    pushShopify: true,
    baseUrl,
    uploadsDir
  });

  // Checkpoint WAL so data/command_hub.db is completely self-contained
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

  console.log('\n=== Batch Intake & Sync Summary ===');
  console.log(JSON.stringify({
    ok: result.ok,
    keep_photos_total: result.keep_photos_total,
    part_groups_total: result.part_groups_total,
    skus_created: result.skus_created,
    skus_updated: result.skus_updated,
    multi_angle_photos_merged: result.multi_angle_photos_merged,
    compliance_blocked_count: result.compliance_blocked.length,
    compliance_blocked: result.compliance_blocked.map((b) => `${b.original_name} [${b.matched_term}]`),
    qr_cards_generated: result.qr_cards_generated,
    total_active_inventory_skus: result.total_active_inventory_skus,
    shopify_sync: result.shopify_sync,
    feeds_and_exports: result.feeds_and_exports
  }, null, 2));
})().catch((err) => {
  console.error('[Batch Intake Failed]', err);
  process.exit(1);
});
