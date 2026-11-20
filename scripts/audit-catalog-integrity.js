#!/usr/bin/env node
/**
 * Universal Automated Catalog Integrity Auditor CLI
 * Runs permanent verification across all 141 items:
 * - Zero raw Google Drive links in public fitment_notes / descriptions
 * - Component vs. Title / Taxonomy / Weight / Dimensions / Shipping-Class / Pricing sanity
 * - Zero duplicate primary photos across active 1-of-1 single-variant SKUs
 * - Zero placeholder titles, fake MPNs, or SRS compliance leaks
 */
const { enrichAllActiveInventoryInDb, auditCatalogIntegrity } = require('../src/catalog-enrichment');

const shouldFix = process.argv.includes('--fix');
if (shouldFix) {
  const enrichRes = enrichAllActiveInventoryInDb();
  console.log('Enrichment + Deduplication applied:', JSON.stringify({
    active: enrichRes.enriched_active_skus,
    pending_verification: enrichRes.pending_verification_count,
    compliance_blocked: enrichRes.compliance_blocked_count,
    duplicate_archived: enrichRes.duplicate_archived_count,
    labor_rate_hourly: enrichRes.labor_rate_hourly
  }));
}

const report = auditCatalogIntegrity();
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exit(1);
}
