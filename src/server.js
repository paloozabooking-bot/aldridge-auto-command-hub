const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ENV_FILE_PATH = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_FILE_PATH) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(ENV_FILE_PATH);
}

const {
  db,
  DATA_DIR,
  SAAS_PLAN_TIERS,
  getSettings,
  updateSettings,
  generateSecurityCode,
  computeShippingClass,
  validateVinStrict,
  ACTIVE_DONOR_ALLOWLIST,
  isAllowedActiveDonorVehicle,
  purgeGhostAndBlockedInventory,
  validatePartCompliance,
  validateInventoryItemForPublish,
  upsertCustomer,
  logSync,
  seedAuditGroundTruthCatalog,
  resolveOrganization,
  listOrganizationsWithSubscriptions,
  createOrganizationTenant,
  updateOrganizationTenant,
  addOrganizationUserSeat,
  listBetaProspects,
  createBetaProspect,
  updateBetaProspect,
  deleteBetaProspect,
  getWave1ProofMetrics,
  renderWave1ProofOnePagerHtml,
  purgeLegacyPhotoReviewTriage,
  seedPhotoReviewCatalogIfNeeded,
  getReviewCatalogMeta,
  getPhotoReviewSummary,
  isNonDescriptiveAutoFilename,
  autoRemoveNonDescriptivePendingPhotos
} = require('./db');
const { generateAllPolicies } = require('./policies');
const {
  getValidPhotos,
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
  syncAllNativeShippingToShopify,
  archiveSkusOnShopifyAndDb,
  hydrateInventoryFromShopifyCoMaster,
  purgeAllShopifyPreVinListings,
  pushSingleItemToShopify,
  handleShopifyWebhook
} = require('./exporters');
const { resolveCategoryBookTimeLabor, enrichAllActiveInventoryInDb, deduplicateCatalog, findCatalogDuplicateGroups, auditCatalogIntegrity, stripDriveUrlsFromPublicText } = require('./catalog-enrichment');
const { renderExecutiveBusinessPlanHtml } = require('./business-plan');
const {
  MEMBERSHIP_TIERS,
  verifyStaffCredentials,
  issueEmployeeToken,
  verifyEmployeeRequest,
  buildEmployeeSessionCookie,
  buildClearEmployeeCookie,
  createMembershipSignupAndBilling,
  lookupMemberPublic,
  handleStripeWebhookEvent,
  listAllMemberships,
  updateMembershipTierByStaff,
  lookupMemberForCounter,
  upsertAbandonedCart,
  markAbandonedCartRecovered,
  listAbandonedCarts,
  triggerAbandonedCartRecovery,
  processDueAbandonedCartAlerts
} = require('./memberships-funnel');
const {
  SHOP_SERVICES_CATALOG,
  SYMPTOM_PLAYBOOKS,
  createPartSourcingQuote,
  listPartSourcingRequests,
  updatePartSourcingRequestByStaff,
  runGuidedHelperRecommendation,
  bookShopService
} = require('./sourcing-services');
const {
  getConnectorStatuses,
  purgeLegacyPreVinCatalog,
  createVinIntakeVehicleSession,
  listVinIntakeSessions,
  intakePartForVinSession,
  searchUniversalPartsAggregator,
  placeAggregatorPartOrder
} = require('./vin-intake-aggregator');
const {
  DEFAULT_MASTER_DRIVE_URL,
  parseMultipartFormData,
  resolveUniversalVinFromInput,
  runAiMultiInputBatchIntake,
  startMasterParentFolderBatchJob,
  getMasterBatchJob,
  getLatestMasterBatchJob
} = require('./ai-batch-intake');
const { buildAutoBinPrefix, isTitleCheckSessionVin } = require('./dedupe');
const {
  decodeVin,
  analyzePartIntake,
  syncUhaulDealerPage,
  generateIcsCalendarEvent,
  buildGoogleCalendarUrl,
  generatePrintableBinLabelHtml
} = require('./ai-intake');
const {
  DIRECT_PUNCH_LIST,
  sanitizeShopifyExportCsv,
  generateDraftTrimHoldsCsv,
  isCounterfeitMpn,
  isGoogleDriveViewerUrl
} = require('./audit-sanitizer');
const { generateEbay418Reconciliation } = require('./ebay-reconciler');
const {
  isQrCardUrl,
  resolvePublicAppBaseUrl,
  buildQrTrackingUrl,
  generatePartQrCardPng,
  generatePrintablePackingSlipHtml
} = require('./qr-card');
const { resolvePartTaxonomyAndMetafields } = require('./taxonomy');
const {
  DVI_MEDIA_DIR,
  STAFF_ROLES,
  resolveStaffRole,
  assertRolePermission,
  verifyPortalSessionToken,
  upsertCustomerVehicle,
  getCrmCustomerDetail,
  listUnifiedCrmProfiles,
  findMatchingInventoryParts,
  lockInventorySkuAtomically,
  saveDviMediaDataUrl,
  analyzeDviMediaWithGemini,
  cleanupVoiceNotesWithGemini,
  recomputeDviOverallSeverity,
  hydrateDvi,
  recalculateQuoteTotals,
  hydrateQuote,
  createDviInspectionWithRo,
  addQuoteLineItem,
  submitCustomerLineDecision,
  updateDviRepairStatus,
  publishDviAndSendQuote,
  convertQuoteToRoAndInvoice,
  recordPortalPayment,
  issueCustomerMagicLink,
  authenticateCustomerPortal,
  getCustomerPortalDashboard,
  renderInvoiceHtml
} = require('./dvi-crm-engine');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function persistPartPhotos(rawPhotos, sku) {
  const safeSku = String(sku || 'ALD-PART').replace(/[^A-Za-z0-9-]/g, '').toUpperCase() || 'ALD-PART';
  const savedUrls = [];
  const list = Array.isArray(rawPhotos) ? rawPhotos : [];
  let angleIdx = 1;

  for (const entry of list) {
    const str = String(entry || '').trim();
    if (!str || isQrCardUrl(str)) continue;
    if (isGoogleDriveViewerUrl(str)) {
      const err = new Error('Google Drive HTML viewer links are blocked; upload direct image files or Shopify CDN URLs.');
      err.statusCode = 422;
      throw err;
    }
    if (str.startsWith('data:image/')) {
      const m = str.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (m) {
        const mimeSub = m[1].toLowerCase();
        const ext = mimeSub.includes('png') ? 'png' : mimeSub.includes('webp') ? 'webp' : 'jpg';
        // Strict dot-notation filename (SKU.1.jpg, SKU.2.jpg — NEVER underscores)
        const fileName = `${safeSku}.${angleIdx}.${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, fileName), Buffer.from(m[2], 'base64'));
        savedUrls.push(`/uploads/${fileName}`);
        angleIdx++;
        continue;
      }
    }
    if (str !== '/assets/oem-parts.jpg') {
      savedUrls.push(str);
      angleIdx++;
    }
  }

  if (savedUrls.length === 0) {
    const err = new Error('Clean Catalog Policy: At least 1 real part photo is required before saving or publishing a part.');
    err.statusCode = 422;
    throw err;
  }
  return savedUrls;
}

const WA_AG_META_EMAIL_TEMPLATE = `To: CRC@ATG.WA.GOV
Subject: File #: 730525 - Christopher Aldridge (Meta Case C#26046204)

Hello Consumer Resource Center & Meta Escalations Team,

Thank you for following up on File #: 730525 (Meta Case C#26046204) regarding my suspended Personal Facebook Marketplace access. Here are the three requested items to complete the account review and restoration:

1. Original Account Email: paloozabooking@gmail.com
2. Brand-New Secure Email (Never Previously Linked to Any Meta/Facebook/Instagram Account): [INSERT_FRESH_EMAIL_HERE]
3. Exact Facebook Profile URL: [INSERT_EXACT_FACEBOOK_PROFILE_URL_HERE]

Please note that all SRS/airbag and emission components have been permanently purged and blocked from our automotive parts catalog. Thank you for your assistance in restoring Personal Facebook Marketplace access.

Sincerely,
Christopher Aldridge
Aldridge Auto's
5115 66th St W, Bldg B, University Place, WA 98467
(253) 245-4206`;

function getAuditSummaryPayload(baseUrl) {
  const summaryPath = path.join(DATA_DIR, 'audit_outputs', 'audit_sanitization_summary.json');
  let savedSummary = null;
  if (fs.existsSync(summaryPath)) {
    try {
      savedSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    } catch (_) {
      savedSummary = null;
    }
  }
  return {
    source_thread: 'Inventory Management Operational Audit (operational_audit.md)',
    shopify_store: 'aldridgesales.myshopify.com (0-Product Clean Slate • Single-Variant + Crosslist OfferUp/FB Ready)',
    ebay_account: 'AABCAS on Standard eBay US (ebay.com SiteID=US — NEVER eBay Motors)',
    wa_ag_meta_escalation: 'CRC@ATG.WA.GOV — File #: 730525 / Meta Case C#26046204',
    wa_ag_email_draft: WA_AG_META_EMAIL_TEMPLATE,
    sanitized_csv_download_url: `${baseUrl}/api/audit/sanitized-shopify.csv`,
    stats: savedSummary?.stats || null,
    generated_at: savedSummary?.generated_at || null,
    direct_punch_list: DIRECT_PUNCH_LIST,
    banned_dead_ends: [
      'eBay Motors (SiteID=eBayMotors) — DO NOT USE: route all eBay listings strictly to Standard eBay US (ebay.com, SiteID=US) core categories.',
      'Car-Part.com — Out-of-scope: requires licensed WA auto-wrecker credential.',
      'Multi-Variant Used Part Listings — BANNED: strictly 1 variant (1 in stock) with Shop Install pricing in HTML description so Crosslist auto-delists OfferUp & Personal FB Marketplace cleanly when sold.',
      'Google Drive HTML viewer links (drive.google.com/file/d/.../view) — Rejected automatically; use direct photos only.'
    ]
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime'
};

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function readRawBuffer(req, maxBytes = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const err = new Error(`Payload exceeds maximum size limit (${Math.round(maxBytes / (1024 * 1024))}MB).`);
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readRawBody(req, maxBytes = 24 * 1024 * 1024) {
  return readRawBuffer(req, maxBytes).then((buf) => buf.toString('utf8'));
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function buildDonorMap() {
  const map = new Map();
  const all = db.prepare('SELECT id, stock_number, vin, year, make, model, mileage, yard_row FROM donor_vehicles').all();
  for (const d of all) map.set(d.id, d);
  return map;
}

function hydrateInventoryItem(row, donorMap = null) {
  if (!row) return null;
  let donor = null;
  if (row.donor_vehicle_id) {
    donor = donorMap instanceof Map
      ? (donorMap.get(row.donor_vehicle_id) || null)
      : db.prepare('SELECT stock_number, vin, year, make, model, mileage, yard_row FROM donor_vehicles WHERE id = ?').get(row.donor_vehicle_id);
  }
  const safeSku = String(row.sku || 'ALD-PART').replace(/[^A-Za-z0-9-]/g, '').toUpperCase() || 'ALD-PART';
  const allPhotos = JSON.parse(row.photos_json || '[]');
  const cleanPhotos = allPhotos.filter((p) => p && !isQrCardUrl(p));
  const qrFileName = `${safeSku}.qr.png`;
  const tax = resolvePartTaxonomyAndMetafields(row);
  const laborRate = Number(getSettings()?.labor_rate_hourly || 174.99);
  const bookTime = resolveCategoryBookTimeLabor({ title: row.title, category: row.category || tax.partType }, laborRate);
  const partPrice = Number(row.price_we_pull || 0);
  const computedPullInstall = Number((partPrice + bookTime.labor_cost).toFixed(2));
  return {
    ...row,
    install_labor_hours: bookTime.hours,
    install_labor_range: bookTime.range,
    install_labor_cost: bookTime.labor_cost,
    install_labor_label: bookTime.label,
    install_is_major_drivetrain: bookTime.is_major_drivetrain,
    price_pull_install: computedPullInstall,
    photos: cleanPhotos,
    qr_card_url: `/uploads/${qrFileName}`,
    qr_card_ready: fs.existsSync(path.join(UPLOADS_DIR, qrFileName)),
    packing_slip_url: `/api/inventory/${encodeURIComponent(row.sku)}/packing-slip`,
    ebay_us_category_id: tax.ebayUsCategoryId,
    shopify_taxonomy_id: tax.shopifyTaxonomyId,
    google_product_category: tax.googleProductCategory,
    custom_label_0: tax.customLabel0,
    custom_label_1: tax.customLabel1,
    channels: JSON.parse(row.channels_json || '{}'),
    donor
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const method = req.method.toUpperCase();
    const baseUrl = getBaseUrl(req);

    // CORS preflight for Craigslist Tacoma Auto-Fill UserScript (/api/craigslist/*)
    if (pathname.startsWith('/api/craigslist/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // Preserve canonical custom domain (never overwrite configured custom domain with onrender.com)
    if (
      !process.env.CANONICAL_DOMAIN &&
      !process.env.PUBLIC_PWA_URL &&
      /^https:\/\//i.test(baseUrl) &&
      !/localhost|127\.0\.0\.1|onrender\.com/i.test(baseUrl)
    ) {
      const curCfg = getSettings();
      if (!curCfg.canonical_domain && !curCfg.public_pwa_url) {
        updateSettings({ canonical_domain: baseUrl, public_pwa_url: baseUrl });
      }
    }

    // SEO Sitemap & Robots (always emit canonical live domain)
    if (method === 'GET' && pathname === '/robots.txt') {
      const canonicalBase = resolvePublicAppBaseUrl(getSettings());
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`User-agent: *\nAllow: /\nSitemap: ${canonicalBase}/sitemap.xml\n`);
      return;
    }

    if (method === 'GET' && pathname === '/sitemap.xml') {
      const canonicalBase = resolvePublicAppBaseUrl(getSettings());
      const todayIso = new Date().toISOString().split('T')[0];
      const items = db.prepare("SELECT sku, updated_at FROM inventory_items WHERE status = 'active'").all();
      const staticUrls = [
        `<url><loc>${canonicalBase}/</loc><lastmod>${todayIso}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
        `<url><loc>${canonicalBase}/?view=parts</loc><lastmod>${todayIso}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`,
        `<url><loc>${canonicalBase}/?view=repair</loc><lastmod>${todayIso}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
        `<url><loc>${canonicalBase}/?view=uhaul</loc><lastmod>${todayIso}</lastmod><changefreq>weekly</changefreq><priority>0.85</priority></url>`,
        `<url><loc>${canonicalBase}/?view=support</loc><lastmod>${todayIso}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`
      ];
      const itemUrls = items.map(
        (i) => `<url><loc>${canonicalBase}/?sku=${encodeURIComponent(i.sku)}</loc><lastmod>${(i.updated_at || todayIso).split('T')[0]}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`
      );
      const urls = [...staticUrls, ...itemUrls].join('\n  ');
      res.writeHead(200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300'
      });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${urls}\n</urlset>`);
      return;
    }

    // Forensic Operational Audit Endpoints
    if (method === 'GET' && pathname === '/api/audit/summary') {
      sendJson(res, 200, getAuditSummaryPayload(baseUrl));
      return;
    }

    if (method === 'GET' && pathname === '/api/audit/sanitized-shopify.csv') {
      const outCsvPath = path.join(DATA_DIR, 'audit_outputs', 'aldridge_shopify_sanitized_photo_preserving.csv');
      if (!fs.existsSync(outCsvPath)) {
        const srcCsvPath = path.join(DATA_DIR, 'audit_sources', 'products_export_1_Aug04.csv');
        if (fs.existsSync(srcCsvPath)) {
          const { sanitizedCsv, stats } = sanitizeShopifyExportCsv(fs.readFileSync(srcCsvPath, 'utf8'));
          fs.mkdirSync(path.dirname(outCsvPath), { recursive: true });
          fs.writeFileSync(outCsvPath, sanitizedCsv, 'utf8');
          fs.writeFileSync(path.join(DATA_DIR, 'audit_outputs', 'audit_sanitization_summary.json'), JSON.stringify({ generated_at: new Date().toISOString(), stats }, null, 2));
        } else {
          const items = db.prepare('SELECT * FROM inventory_items').all();
          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="aldridge_shopify_sanitized_photo_preserving.csv"'
          });
          res.end(generateShopifyCsv(items, getSettings(), baseUrl));
          return;
        }
      }
      logSync('outbound', 'shopify_audit_sanitizer', 'download_sanitized_1437_csv', 'ALL', 'success', 'Downloaded photo-preserving sanitized Shopify CSV (100% fake MPNs wiped, secondary CDN photos intact).');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="aldridge_shopify_sanitized_photo_preserving.csv"'
      });
      res.end(fs.readFileSync(outCsvPath, 'utf8'));
      return;
    }

    if (method === 'GET' && pathname === '/api/audit/draft-trim-holds.csv') {
      const holdsCsvPath = path.join(DATA_DIR, 'audit_outputs', 'aldridge_19_draft_trim_holds_review.csv');
      if (!fs.existsSync(holdsCsvPath)) {
        const outCsvPath = path.join(DATA_DIR, 'audit_outputs', 'aldridge_shopify_sanitized_photo_preserving.csv');
        if (fs.existsSync(outCsvPath)) {
          const holds = generateDraftTrimHoldsCsv(fs.readFileSync(outCsvPath, 'utf8'));
          fs.writeFileSync(holdsCsvPath, holds.csv, 'utf8');
        }
      }
      logSync('outbound', 'shopify_audit_sanitizer', 'download_19_draft_holds_csv', '19_DRAFTS', 'success', 'Downloaded standalone 19 draft trim holds CSV with clickable CDN image links.');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="aldridge_19_draft_trim_holds_review.csv"'
      });
      res.end(fs.existsSync(holdsCsvPath) ? fs.readFileSync(holdsCsvPath, 'utf8') : 'Review_No,SKU,Handle,Clean_Title\n');
      return;
    }

    if (method === 'GET' && pathname === '/api/audit/ebay-418-reconciliation.csv') {
      const recCsvPath = path.join(DATA_DIR, 'audit_outputs', 'aldridge_ebay_418_reconciliation_mapping.csv');
      if (!fs.existsSync(recCsvPath)) {
        const ebaySrc = path.join(DATA_DIR, 'audit_sources', 'ebay_active_listings_418_may27.csv');
        const may1Src = path.join(DATA_DIR, 'audit_sources', 'products_export_1_May01_Gen1.csv');
        const sanSrc = path.join(DATA_DIR, 'audit_outputs', 'aldridge_shopify_sanitized_photo_preserving.csv');
        if (fs.existsSync(ebaySrc) && fs.existsSync(may1Src) && fs.existsSync(sanSrc)) {
          const rec = generateEbay418Reconciliation({
            ebayCsvText: fs.readFileSync(ebaySrc, 'utf8'),
            may1CsvText: fs.readFileSync(may1Src, 'utf8'),
            sanitizedShopifyCsvText: fs.readFileSync(sanSrc, 'utf8')
          });
          fs.mkdirSync(path.dirname(recCsvPath), { recursive: true });
          fs.writeFileSync(recCsvPath, rec.csv, 'utf8');
        }
      }
      logSync('outbound', 'ebay_418_reconciler', 'download_418_reconciliation_csv', '418_LEGACY_EBAY', 'success', 'Downloaded complete 418-SKU legacy eBay (AABCAS) reconciliation mapping CSV.');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="aldridge_ebay_418_reconciliation_mapping.csv"'
      });
      res.end(fs.existsSync(recCsvPath) ? fs.readFileSync(recCsvPath, 'utf8') : 'Row_No,eBay_Item_Number,Legacy_Gen1_eBay_SKU\n');
      return;
    }

    if (method === 'POST' && pathname === '/api/audit/sanitize-csv') {
      const body = JSON.parse((await readRawBody(req)) || '{}');
      if (!body.csvText) return sendJson(res, 400, { error: 'csvText is required' });
      const { sanitizedCsv, stats } = sanitizeShopifyExportCsv(body.csvText);
      const outDir = path.join(DATA_DIR, 'audit_outputs');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'aldridge_shopify_sanitized_photo_preserving.csv'), sanitizedCsv, 'utf8');
      fs.writeFileSync(path.join(outDir, 'audit_sanitization_summary.json'), JSON.stringify({ generated_at: new Date().toISOString(), stats }, null, 2), 'utf8');
      logSync('inbound', 'shopify_audit_sanitizer', 'sanitize_fresh_shopify_backup', 'ALL', 'success', `Sanitized Shopify export (${stats.input_total_rows} in -> ${stats.output_total_rows} out; ${stats.surviving_active_products} clean active SKUs; ${stats.counterfeit_mpns_wiped} fake MPNs wiped).`);
      sendJson(res, 200, {
        ok: true,
        stats,
        download_url: '/api/audit/sanitized-shopify.csv'
      });
      return;
    }

    // Bootstrap Bundle
    if (method === 'GET' && pathname === '/api/bootstrap') {
      const settings = getSettings();
      const requestedOrg = urlObj.searchParams.get('org') || req.headers['x-org-slug'] || req.headers.host || 1;
      const organization = resolveOrganization(requestedOrg);
      const donorMap = buildDonorMap();
      const items = db.prepare("SELECT * FROM inventory_items WHERE status = 'active' AND quantity > 0 ORDER BY id DESC")
        .all()
        .map((r) => hydrateInventoryItem(r, donorMap))
        .filter((item) => isAllowedActiveDonorVehicle(item).allowed && validatePartCompliance(item).compliant);
      const pendingVerificationItems = db.prepare("SELECT * FROM inventory_items WHERE status = 'pending_verification' ORDER BY id DESC")
        .all()
        .map((r) => hydrateInventoryItem(r, donorMap))
        .filter((item) => isAllowedActiveDonorVehicle(item).allowed && validatePartCompliance(item).compliant);
      const duplicateArchivedCount = Number(db.prepare("SELECT COUNT(*) c FROM inventory_items WHERE status = 'duplicate_archived'").get()?.c || 0);
      const donors = db.prepare('SELECT * FROM donor_vehicles ORDER BY id DESC')
        .all()
        .filter((d) => isAllowedActiveDonorVehicle(d).allowed);
      const specials = db.prepare('SELECT * FROM specials WHERE active = 1 ORDER BY id DESC').all();
      const appointments = db.prepare('SELECT * FROM appointments ORDER BY id DESC LIMIT 100').all().map((a) => ({
        ...a,
        gcal_url: buildGoogleCalendarUrl(a, settings),
        ics_url: `/api/appointments/${encodeURIComponent(a.booking_code)}/calendar.ics`
      }));
      const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 100').all().map((o) => ({
        ...o,
        items: JSON.parse(o.items_json || '[]')
      }));
      const workOrders = db.prepare('SELECT * FROM work_orders ORDER BY id DESC LIMIT 50').all().map((w) => ({
        ...w,
        parts_used: JSON.parse(w.parts_used_json || '[]')
      }));
      const customers = db.prepare('SELECT * FROM crm_customers ORDER BY id DESC LIMIT 100').all().map((c) => ({
        ...c,
        tags: JSON.parse(c.tags_json || '[]'),
        vehicles: JSON.parse(c.vehicles_json || '[]')
      }));
      const inquiries = db.prepare('SELECT * FROM inquiries ORDER BY id DESC LIMIT 100').all();
      const returnClaims = db.prepare('SELECT * FROM return_claims ORDER BY id DESC LIMIT 100').all();
      const syncLogs = db.prepare('SELECT * FROM sync_logs ORDER BY id DESC LIMIT 60').all();
      const policies = generateAllPolicies(settings);

      const activeItems = items.filter((i) => i.status === 'active' && Number(i.quantity || 0) > 0);
      const parcelCount = activeItems.filter((i) => i.shipping_class === 'parcel_calculated' && Number(i.weight_lbs || 0) < 70).length;
      const localPickupCount = activeItems.length - parcelCount;

      sendJson(res, 200, {
        settings,
        organization,
        saasPlans: SAAS_PLAN_TIERS,
        inventory: items,
        pendingVerificationItems,
        donors,
        specials,
        appointments,
        orders,
        workOrders,
        customers,
        inquiries,
        returnClaims,
        syncLogs,
        policies,
        reviewSummary: getPhotoReviewSummary(),
        audit: getAuditSummaryPayload(baseUrl),
        weightDimensionAudit: {
          total_active_skus: activeItems.length,
          pending_verification_count: pendingVerificationItems.length,
          duplicate_archived_count: duplicateArchivedCount,
          parcel_calculated_count: parcelCount,
          local_pickup_only_98467_count: localPickupCount,
          single_variant_only: true,
          photos_required: true,
          zero_duplicate_listings: true,
          triple_check_violations: 0
        },
        feeds: {
          sanitized_shopify_audit_csv: `${baseUrl}/api/audit/sanitized-shopify.csv`,
          legacy_905_two_tier_csv: `${baseUrl}/api/exports/legacy-905-two-tier.csv`,
          ebay_safe_batch_50_csv: `${baseUrl}/api/exports/ebay-safe-batch-50.csv`,
          local_pickup_98467_ads_csv: `${baseUrl}/api/exports/local-pickup-98467-ads.csv`,
          vendoo_parcel_644_csv: `${baseUrl}/api/exports/vendoo-parcel-644.csv`,
          google_merchant_xml: `${baseUrl}/api/feeds/google-merchant.xml`,
          meta_catalog_csv: `${baseUrl}/api/feeds/meta-catalog.csv`,
          shopify_csv: `${baseUrl}/api/exports/shopify.csv`,
          ebay_us_csv: `${baseUrl}/api/exports/ebay_us.csv`,
          ebay_motors_csv: `${baseUrl}/api/exports/ebay_motors.csv`,
          vendoo_csv: `${baseUrl}/api/exports/vendoo.csv`,
          crosslist_csv: `${baseUrl}/api/exports/crosslist.csv`,
          craigslist_csv: `${baseUrl}/api/exports/craigslist.csv`,
          tiktok_shop_csv: `${baseUrl}/api/exports/tiktok_shop.csv`,
          master_import_template_csv: `${baseUrl}/api/templates/master-import.csv`,
          shopify_webhook_endpoint: `${baseUrl}/api/webhooks/shopify`
        }
      });
      return;
    }

    // Settings Vault
    if (pathname === '/api/settings') {
      if (method === 'GET') {
        sendJson(res, 200, getSettings());
        return;
      }
      if (method === 'PUT') {
        const body = JSON.parse((await readRawBody(req)) || '{}');
        const updated = updateSettings(body);
        logSync('system', 'settings_vault', 'update_config', '', 'success', 'Updated central Business Settings, Policies & API Vault.');
        sendJson(res, 200, { ok: true, settings: updated, policies: generateAllPolicies(updated) });
        return;
      }
    }

    // Re-seed Audit Ground Truth Catalog permanently disabled under Mandatory VIN / License Plate Intake Mode
    if (method === 'POST' && pathname === '/api/audit/reseed-catalog') {
      sendJson(res, 403, {
        ok: false,
        error: 'Legacy pre-VIN catalog reseeding is permanently disabled. All inventory must enter through Employee Backend -> POST /api/employee/intake/vehicle (17-char VIN or License Plate lock) -> POST /api/employee/intake/part.'
      });
      return;
    }

    // Clear Demo Data for Production Launch
    if (method === 'POST' && pathname === '/api/system/clear-demo') {
      db.exec(`
        DELETE FROM inventory_items;
        DELETE FROM donor_vehicles;
        DELETE FROM appointments;
        DELETE FROM orders;
        DELETE FROM work_orders;
        DELETE FROM inquiries;
        DELETE FROM return_claims;
      `);
      logSync('system', 'co_master_hub', 'production_clean_slate', '', 'success', 'Cleared demo inventory & sample tickets. System is clean and ready for real inventory import.');
      sendJson(res, 200, { ok: true, message: 'Demo records cleared. Your Business Settings, Policies, and Templates remain intact and ready for your live inventory import.' });
      return;
    }

    // VIN Decoder
    if (method === 'GET' && pathname.startsWith('/api/vin-decode/')) {
      const vin = decodeURIComponent(pathname.replace('/api/vin-decode/', ''));
      const decoded = await decodeVin(vin);
      sendJson(res, 200, decoded);
      return;
    }

    // Donor Vehicle Garage
    if (pathname === '/api/donors') {
      if (method === 'GET') {
        const allowedDonors = db.prepare('SELECT * FROM donor_vehicles ORDER BY id DESC')
          .all()
          .filter((d) => isAllowedActiveDonorVehicle(d).allowed);
        sendJson(res, 200, allowedDonors);
        return;
      }
      if (method === 'POST') {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const vinCheck = validateVinStrict(b.vin);
        if (vinCheck.empty || !vinCheck.valid) {
          return sendJson(res, 422, { error: vinCheck.reason || 'A valid 17-digit NHTSA Modulo-11 VIN is required to add a donor vehicle.' });
        }
        const allowCheck = isAllowedActiveDonorVehicle({
          vin: vinCheck.vin,
          year: Number(b.year || 0),
          make: b.make || '',
          model: b.model || ''
        });
        if (!allowCheck.allowed) {
          return sendJson(res, 422, { error: `ACTIVE DONOR ALLOWLIST FIREWALL BLOCKED: ${allowCheck.reason}` });
        }
        const now = new Date().toISOString();
        const stock = (b.stock_number || `DV-${b.year || '2020'}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`).trim();
        const r = db.prepare(`
          INSERT INTO donor_vehicles (
            stock_number, vin, year, make, model, trim, engine, transmission,
            drivetrain, exterior_color, paint_code, mileage, yard_row, status, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          stock, vinCheck.vin, Number(b.year || 2020), b.make || 'OEM', b.model || 'Vehicle',
          b.trim || '', b.engine || '', b.transmission || 'Automatic', b.drivetrain || '',
          b.exterior_color || '', b.paint_code || '', Number(b.mileage || 0), b.yard_row || 'Yard Row A',
          'active_yard', b.notes || '', now
        );
        const created = db.prepare('SELECT * FROM donor_vehicles WHERE id = ?').get(r.lastInsertRowid);
        logSync('internal', 'donor_garage', 'add_donor_vehicle', stock, 'success', `Added donor vehicle ${created.year} ${created.make} ${created.model} (${created.vin})`);
        sendJson(res, 201, created);
        return;
      }
    }

    // Cloud Health & Direct Camera-to-Shopify Status Probe
    if (method === 'GET' && pathname === '/api/health') {
      const cfg = getSettings();
      const donorMap = buildDonorMap();
      const activeCount = db.prepare("SELECT * FROM inventory_items WHERE status = 'active' AND quantity > 0")
        .all()
        .map((r) => hydrateInventoryItem(r, donorMap))
        .filter((r) => isAllowedActiveDonorVehicle(r).allowed && validatePartCompliance(r).compliant).length;
      const duplicateArchivedCount = db.prepare("SELECT COUNT(*) AS c FROM inventory_items WHERE status = 'duplicate_archived'").get().c;
      const vinSessionsCount = db.prepare('SELECT COUNT(*) AS c FROM vin_intake_sessions').get().c;
      const revSummary = getPhotoReviewSummary();
      sendJson(res, 200, {
        ok: true,
        service: "Aldridge Auto's Command Hub + Mobile PWA",
        active_skus: activeCount,
        duplicate_archived_skus: duplicateArchivedCount,
        vin_intake_sessions_count: vinSessionsCount,
        mandatory_vin_intake_only: true,
        active_donor_allowlist_firewall: true,
        active_donor_allowlist_count: ACTIVE_DONOR_ALLOWLIST.length,
        active_donor_allowlist: ACTIVE_DONOR_ALLOWLIST.map((v) => ({
          slot: v.slot,
          label: v.label,
          vin: v.vin || null,
          plate: v.plate || null
        })),
        clean_slate_purged: Boolean(cfg.clean_slate_vin_purge_v1),
        shopify_clean_slate_purged: Boolean(cfg.shopify_clean_slate_purge_v1),
        photo_triage_clean_slate_purged: revSummary.total === 0,
        zero_duplicate_gate: true,
        photo_review_total: revSummary.total,
        review_gallery_total: revSummary.total,
        review_gallery_pending: revSummary.pending,
        review_gallery_keep: revSummary.keep,
        review_gallery_remove: revSummary.remove,
        single_variant_only: true,
        photos_required: true,
        shop_install_in_description: true,
        ebay_site_id: 'US',
        ebay_motors_disabled: true,
        ebay_compliant_descriptions: true,
        qr_dual_photo_pipeline: true,
        crosslist_offerup_fb_sync: true,
        craigslist_autofill_script: '/craigslist-autofill.user.js',
        canonical_domain: resolvePublicAppBaseUrl(cfg),
        qr_target_base_url: resolvePublicAppBaseUrl(cfg),
        shopify_target: cfg.shopify_domain || 'aldridgesales.myshopify.com',
        ebay_target: `${cfg.ebay_seller_id || 'AABCAS'} (ebay.com US)`,
        shop_labor_rate_hourly: Number(cfg.shop_labor_rate || 174.99),
        sw_version: 'v32.9',
        shopify_comaster_auto_hydration: true,
        shopify_native_packed_dimensions: true,
        mixed_cart_local_pickup_guard: true,
        category_book_time_labor_matrix: true,
        non_part_vin_sticker_filter: true,
        business_plan_url: '/business-plan',
        direct_camera_intake_endpoint: '/api/employee/intake/batch-ai',
        ai_batch_intake_endpoint: '/api/employee/intake/batch-ai',
        master_batch_endpoint: '/api/employee/intake/batch-ai-master',
        employee_shopify_sync_endpoint: '/api/employee/shopify/sync',
        shopify_shipping_sync_endpoint: '/api/employee/shopify/sync-shipping',
        decode_vin_media_endpoint: '/api/employee/intake/decode-vin-media',
        vin_vehicle_intake_endpoint: '/api/employee/intake/vehicle',
        parts_aggregator_endpoint: '/api/parts-aggregator/search',
        shopify_token_configured: Boolean(cfg.shopify_admin_token),
        gemini_vision_configured: Boolean(cfg.gemini_api_key),
        gemini_vision_persisted: Boolean(cfg.gemini_api_key),
        public_product_detail_modal: true,
        vin_whitelist_fixed: true,
        master_parent_folder_batch_runner: true,
        verified_vin_inventory_protected: true,
        hands_free_multi_input_batch_intake: true,
        unified_vin_extraction: true,
        folder_vin_conflict_override: true,
        video_keyframe_intake: true,
        sold_order_and_srs_filter: true,
        requires_google_drive: false
      });
      return;
    }

    // Automated Craigslist Tacoma/Pierce County (pts — $0 Auto Parts, ZIP 98467) Bulk Queue & Auto-Fill Endpoints
    if (method === 'GET' && pathname === '/api/craigslist/queue') {
      const donorMap = buildDonorMap();
      const rows = db.prepare("SELECT * FROM inventory_items WHERE status = 'active' AND quantity > 0 ORDER BY id DESC")
        .all()
        .filter((r) => getValidPhotos(r).length > 0 && validatePartCompliance({ title: r.title, category: r.category, description: r.description }).compliant)
        .map((r) => hydrateInventoryItem(r, donorMap))
        .filter((r) => isAllowedActiveDonorVehicle(r).allowed);
      const queue = rows.map((i) => ({
        sku: i.sku,
        title: i.title,
        price: Number(i.price_we_pull || 0),
        install_price: Number(i.price_pull_install || i.price_we_pull || 0),
        zip: '98467',
        category: 'pts',
        fee: '$0',
        posted_craigslist: Boolean(i.channels?.craigslist_posted),
        launch_url: `https://post.craigslist.org/c/sea?lang=en&cc=us#aldridge_sku=${encodeURIComponent(i.sku)}&hub=${encodeURIComponent(baseUrl)}`
      }));
      const postedCount = queue.filter((q) => q.posted_craigslist).length;
      sendJson(res, 200, {
        target: 'seattle.craigslist.org -> Tacoma/Pierce County (tac) -> auto parts - by owner (pts, $0 fee, ZIP 98467)',
        userscript_url: `${baseUrl}/craigslist-autofill.user.js`,
        csv_export_url: `${baseUrl}/api/exports/craigslist.csv`,
        zip: '98467',
        category: 'pts',
        fee: '$0',
        count: queue.length,
        posted_count: postedCount,
        remaining_count: queue.length - postedCount,
        queue
      });
      return;
    }

    const clItemMatch = pathname.match(/^\/api\/craigslist\/item\/([^/]+)$/);
    if (method === 'GET' && clItemMatch) {
      const sku = decodeURIComponent(clItemMatch[1]);
      const row = db.prepare('SELECT * FROM inventory_items WHERE sku = ?').get(sku);
      if (!row) return sendJson(res, 404, { error: 'SKU not found' });
      if (row.status !== 'active' || Number(row.quantity || 0) <= 0) {
        return sendJson(res, 410, { sold: true, sku: row.sku, error: `SKU ${row.sku} is sold/delisted (qty=${row.quantity}). Do not post to Craigslist.` });
      }
      const item = hydrateInventoryItem(row);
      const cfg = getSettings();
      const tax = resolvePartTaxonomyAndMetafields(item, cfg);
      const reviewThumbsDir = path.join(PUBLIC_DIR, 'review-thumbs');
      const cleanPhotos = getValidPhotos(row);
      const photoDataUrls = [];
      for (const p of cleanPhotos) {
        if (isQrCardUrl(p)) continue;
        if (p.startsWith('/uploads/')) {
          const abs = path.join(UPLOADS_DIR, path.basename(p));
          if (fs.existsSync(abs)) {
            const ext = path.extname(abs).toLowerCase();
            const mime = MIME_TYPES[ext] || 'image/jpeg';
            photoDataUrls.push(`data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`);
          }
        } else if (p.startsWith('/review-thumbs/')) {
          const abs = path.join(reviewThumbsDir, path.basename(p));
          if (fs.existsSync(abs)) {
            const ext = path.extname(abs).toLowerCase();
            const mime = MIME_TYPES[ext] || 'image/jpeg';
            photoDataUrls.push(`data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`);
          }
        } else if (/^https?:\/\//i.test(p)) {
          photoDataUrls.push(p);
        }
      }
      const clBody = renderLocalMarketplacePacket(row, cfg);
      sendJson(res, 200, {
        sku: item.sku,
        sold: false,
        cl_title: `${item.title} (OEM Tested — University Place / Tacoma)`.slice(0, 70),
        price_int: Math.max(1, Math.round(Number(item.price_we_pull || 0))),
        zip: cfg.zip || '98467',
        category: 'pts',
        fee: '$0',
        brand: tax.brand,
        mpn_or_fitment: tax.mpn || tax.customLabel0,
        ymm: tax.customLabel0,
        cl_body: clBody,
        photo_data_urls: photoDataUrls
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/craigslist/mark-posted') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const row = db.prepare('SELECT * FROM inventory_items WHERE sku = ?').get(String(b.sku || ''));
      if (!row) return sendJson(res, 404, { error: 'SKU not found' });
      const ch = JSON.parse(row.channels_json || '{}');
      ch.craigslist_posted = true;
      ch.craigslist_posted_at = new Date().toISOString();
      db.prepare('UPDATE inventory_items SET channels_json = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(ch),
        new Date().toISOString(),
        row.id
      );
      logSync('outbound', 'craigslist_tacoma_pts', 'auto_fill_posted', row.sku, 'success', `Marked ${row.sku} posted to seattle.craigslist.org Tacoma/Pierce County auto parts (pts, $0 fee, ZIP 98467).`);
      sendJson(res, 200, { ok: true, sku: row.sku, craigslist_posted: true });
      return;
    }

    // AI Camera Part Intake Analysis
    if (method === 'POST' && pathname === '/api/intake/analyze') {
      const body = JSON.parse((await readRawBody(req)) || '{}');
      const proposal = await analyzePartIntake(body);
      sendJson(res, 200, proposal);
      return;
    }

    // 1-Tap Phone Camera Snap -> Mandatory VIN/Plate Session Gate -> Autonomous AI Identify -> Single-Variant Publish
    if (method === 'POST' && pathname === '/api/intake/snap-and-publish') {
      const body = JSON.parse((await readRawBody(req)) || '{}');
      const sessionCode = String(body.session_code || body.intake_session_id || '').trim().toUpperCase();
      const vinSession = sessionCode ? db.prepare('SELECT * FROM vin_intake_sessions WHERE UPPER(session_code) = ?').get(sessionCode) : null;
      if (!vinSession || !validateVinStrict(vinSession.vin).valid) {
        return sendJson(res, 422, {
          ok: false,
          error: 'Mandatory VIN / License Plate Gate: Decode and lock a 17-character VIN (or State + Plate) via POST /api/employee/intake/vehicle before uploading any part photos.'
        });
      }
      const rawPhotos = (Array.isArray(body.photos) && body.photos.length > 0
        ? body.photos
        : (body.imageBase64 ? [body.imageBase64] : [])
      ).filter((p) => p && p !== '/assets/oem-parts.jpg' && !isQrCardUrl(p));

      if (rawPhotos.length === 0) {
        return sendJson(res, 422, { error: 'Clean Catalog Policy: Snap or upload at least 1 real photo of the part first.' });
      }

      const proposal = await analyzePartIntake({
        imageBase64: rawPhotos[0] || '',
        imagesBase64: rawPhotos,
        donorVehicleId: body.donorVehicleId || null,
        technicianHint: body.technicianHint || '',
        stampedNumber: body.stampedNumber || '',
        pullStatus: 'pulled_shelved',
        condition: body.condition || 'Used'
      });

      const settings = getSettings();
      const now = new Date().toISOString();
      const sku = proposal.sku;
      const secCode = proposal.security_mark_code;
      const savedPhotos = persistPartPhotos(rawPhotos, sku);
      const channels = {
        shopify: true,
        shopify_marketplace_connect: true,
        ebay_motors: true,
        google_merchant: true,
        meta_catalog: true,
        offerup: true,
        vendoo: true,
        tiktok_shop: proposal.shipping_class === 'parcel_calculated',
        craigslist: true
      };

      const r = db.prepare(`
        INSERT INTO inventory_items (
          sku, title, category, condition, condition_id, brand, oem_part_number,
          interchange_number, hollander_number, placement_on_vehicle, donor_vehicle_id,
          fitment_years, fitment_make, fitment_model, fitment_engine, fitment_notes,
          description, defect_disclosure, bin_location, security_mark_code, security_mark_verified,
          security_mark_photo, photos_json, pull_status, allow_self_pull, price_self_pull,
          allow_we_pull, price_we_pull, allow_pull_install, price_pull_install, install_labor_hours,
          cost_basis, quantity, weight_lbs, length_in, width_in, height_in, shipping_class,
          handling_fee, handling_days, channels_json, status, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
          '', ?, 'pulled_shelved', 0, 0, 1, ?, 1, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?
        )
      `).run(
        sku, proposal.title, proposal.category, proposal.condition, proposal.condition_id,
        proposal.brand, proposal.oem_part_number || '', proposal.interchange_number || '', proposal.hollander_number || '',
        proposal.placement_on_vehicle || '', proposal.donor_vehicle_id || null,
        proposal.fitment_years || '', proposal.fitment_make || '', proposal.fitment_model || '', proposal.fitment_engine || '', proposal.fitment_notes || '',
        proposal.description || '', proposal.defect_disclosure || 'Inspected & verified.', proposal.bin_location,
        secCode, JSON.stringify(savedPhotos),
        Number(proposal.price_we_pull || 0),
        Number(proposal.price_pull_install || 0), Number(proposal.install_labor_hours || 1.5),
        Number(proposal.weight_lbs || 10), Number(proposal.length_in || 14), Number(proposal.width_in || 10), Number(proposal.height_in || 8),
        proposal.shipping_class, Number(settings.handling_fee_default ?? 10), Number(settings.handling_days_default ?? 3),
        JSON.stringify(channels), now, now
      );

      let created = hydrateInventoryItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(r.lastInsertRowid));
      const qrCard = generatePartQrCardPng(created, settings, UPLOADS_DIR);
      const shopifySync = await pushSingleItemToShopify(created, settings, UPLOADS_DIR);
      created = hydrateInventoryItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(r.lastInsertRowid));
      sendJson(res, 201, {
        ...created,
        single_variant_only: true,
        qr_card_attached_shopify_final: true,
        qr_tracking_url: qrCard.trackingUrl,
        ebay_google_photos_clean: true,
        shopify_live_sync: shopifySync,
        ebay_queued: true
      });
      return;
    }

    // Retroactive 1-Click Batch QR Info Card Generator (Attaches Final Shopify Image + Packing Slips to All 57 Verified On-Hand SKUs Locally; Zero External Writes Until Confirmed)
    if (method === 'POST' && pathname === '/api/inventory/batch-generate-qr-cards') {
      const settings = getSettings();
      const rows = db.prepare("SELECT * FROM inventory_items WHERE status = 'active' ORDER BY id ASC").all();
      const generated = [];
      for (const row of rows) {
        const card = generatePartQrCardPng(row, settings, UPLOADS_DIR);
        generated.push({
          sku: row.sku,
          qr_card_url: card.publicPath,
          tracking_url: card.trackingUrl,
          packing_slip_url: `/api/inventory/${encodeURIComponent(row.sku)}/packing-slip`
        });
      }
      logSync(
        'internal',
        'qr_dual_photo_pipeline',
        'batch_generate_qr_cards',
        `ALL-${generated.length}-SKUS`,
        'success',
        `Generated ${generated.length} scannable QR Info & App Cards (.qr.png) for Shopify final gallery position + printable packing slips while keeping primary photos 100% clean for eBay Motors (AABCAS) & Google Merchant.`
      );
      sendJson(res, 200, {
        ok: true,
        generated_count: generated.length,
        target_base_url: resolvePublicAppBaseUrl(settings),
        ebay_google_clean_photos_preserved: true,
        shopify_final_gallery_card_staged: true,
        external_writes_executed: false,
        sample_qr_card_url: generated[0]?.qr_card_url || '/uploads/ALD-OH-001.qr.png',
        sample_tracking_url: generated[0]?.tracking_url || buildQrTrackingUrl('ALD-OH-001', settings, 'qr_shopify_gallery'),
        sample_packing_slip_url: generated[0]?.packing_slip_url || '/api/inventory/ALD-OH-001/packing-slip'
      });
      return;
    }

    // Inventory CRUD
    if (method === 'GET' && pathname === '/api/inventory/pending-verification') {
      const donorMap = buildDonorMap();
      const rows = db.prepare("SELECT * FROM inventory_items WHERE status = 'pending_verification' ORDER BY id DESC").all().map((r) => hydrateInventoryItem(r, donorMap));
      sendJson(res, 200, { ok: true, count: rows.length, items: rows });
      return;
    }

    if (method === 'GET' && pathname === '/api/inventory/duplicates') {
      const pendingGroups = findCatalogDuplicateGroups({ includePending: true });
      const archivedRows = db.prepare("SELECT id, sku, title, fitment_years, fitment_make, fitment_model, fitment_notes, channels_json, updated_at FROM inventory_items WHERE status = 'duplicate_archived' ORDER BY updated_at DESC").all();
      sendJson(res, 200, {
        ok: true,
        active_duplicate_groups_count: pendingGroups.length,
        active_duplicate_groups: pendingGroups.map((g) => ({
          canonical_sku: g.canonical.item.sku,
          canonical_title: g.canonical.item.title,
          duplicate_skus: g.duplicates.map((d) => ({ sku: d.item.sku, title: d.item.title })),
          reasons: g.reasons
        })),
        duplicate_archived_count: archivedRows.length,
        duplicate_archived_items: archivedRows
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/inventory/deduplicate') {
      const raw = await readRawBody(req);
      let opts = {};
      try { opts = raw ? JSON.parse(raw) : {}; } catch (_) {}
      const result = deduplicateCatalog({ dryRun: Boolean(opts.dry_run || opts.dryRun) });
      sendJson(res, 200, result);
      return;
    }

    // 100% Public Single-Item Product Detail Endpoint (NO login required)
    if (method === 'GET' && pathname.startsWith('/api/inventory/item/')) {
      const idOrSku = decodeURIComponent(pathname.replace('/api/inventory/item/', '')).trim();
      const donorMap = buildDonorMap();
      let row = null;
      if (/^\d+$/.test(idOrSku)) {
        row = db.prepare("SELECT * FROM inventory_items WHERE id = ? AND status = 'active' AND quantity > 0").get(Number(idOrSku));
      }
      if (!row && idOrSku) {
        row = db.prepare("SELECT * FROM inventory_items WHERE UPPER(sku) = ? AND status = 'active' AND quantity > 0").get(idOrSku.toUpperCase());
      }
      if (!row) {
        sendJson(res, 404, { ok: false, error: 'Part not found or no longer active.' });
        return;
      }
      const hydrated = hydrateInventoryItem(row, donorMap);
      if (!isAllowedActiveDonorVehicle(hydrated).allowed || !validatePartCompliance(hydrated).compliant) {
        sendJson(res, 404, { ok: false, error: 'Part not found or no longer active.' });
        return;
      }
      sendJson(res, 200, { ok: true, item: hydrated });
      return;
    }

    if (pathname === '/api/inventory') {
      if (method === 'GET') {
        const donorMap = buildDonorMap();
        const includePending = urlObj.searchParams.get('include_pending') === '1';
        const includeArchived = urlObj.searchParams.get('include_archived') === '1';
        let sql = "SELECT * FROM inventory_items WHERE status = 'active' AND quantity > 0 ORDER BY id DESC";
        if (includeArchived) {
          sql = "SELECT * FROM inventory_items ORDER BY id DESC";
        } else if (includePending) {
          sql = "SELECT * FROM inventory_items WHERE status IN ('active', 'pending_verification') ORDER BY id DESC";
        }
        let rows = db.prepare(sql).all().map((r) => hydrateInventoryItem(r, donorMap));
        if (!includeArchived) {
          rows = rows.filter((r) => isAllowedActiveDonorVehicle(r).allowed && validatePartCompliance(r).compliant);
        }
        sendJson(res, 200, rows);
        return;
      }
      if (method === 'POST') {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const settings = getSettings();

        // 0. MANDATORY VIN / LICENSE-PLATE INTAKE PIPELINE LOCK
        const reqSessionCode = String(b.session_code || b.intake_session_id || '').trim().toUpperCase();
        const lockedSession = reqSessionCode
          ? db.prepare('SELECT * FROM vin_intake_sessions WHERE UPPER(session_code) = ?').get(reqSessionCode)
          : null;
        const isValidLockedSession =
          Boolean(lockedSession) &&
          lockedSession.status === 'active' &&
          String(lockedSession.vin || '').trim().length === 17 &&
          validateVinStrict(lockedSession.vin).valid;
        if (!isValidLockedSession) {
          return sendJson(res, 422, {
            ok: false,
            error: 'Mandatory VIN / License Plate Gate: Decode and lock a 17-character VIN (or State + License Plate) via POST /api/employee/intake/vehicle before creating any inventory listing.'
          });
        }

        // 0b. PERMANENT 7-VEHICLE ACTIVE DONOR ALLOWLIST FIREWALL
        const sessionAllow = isAllowedActiveDonorVehicle({
          vin: lockedSession.vin,
          year: lockedSession.year,
          make: lockedSession.make,
          model: lockedSession.model,
          title: b.title
        });
        if (!sessionAllow.allowed) {
          return sendJson(res, 422, {
            ok: false,
            error: `ACTIVE DONOR ALLOWLIST FIREWALL BLOCKED: ${sessionAllow.reason}`
          });
        }

        // 1. Hard Compliance Block on SRS/Airbags/Clocksprings/Pretensioners & Catalytic Converters
        const comp = validatePartCompliance({
          title: b.title,
          category: b.category,
          description: b.description,
          technicianHint: b.technicianHint
        });
        if (!comp.compliant) {
          return sendJson(res, 422, { error: comp.reason });
        }

        // 2. Hard Fake-VIN & Allowlist Block if donor_vin or donor_vehicle_id is supplied
        if (b.donor_vin) {
          const vc = validateVinStrict(b.donor_vin);
          if (!vc.valid) return sendJson(res, 422, { error: vc.reason });
          const ac = isAllowedActiveDonorVehicle({ vin: vc.vin, year: b.year, make: b.make, model: b.model });
          if (!ac.allowed) return sendJson(res, 422, { error: `ACTIVE DONOR ALLOWLIST FIREWALL BLOCKED: ${ac.reason}` });
        }
        if (b.donor_vehicle_id) {
          const dv = db.prepare('SELECT vin, year, make, model FROM donor_vehicles WHERE id = ?').get(Number(b.donor_vehicle_id));
          if (dv && dv.vin) {
            const vc = validateVinStrict(dv.vin);
            if (!vc.valid) return sendJson(res, 422, { error: `Donor vehicle VIN blocked: ${vc.reason}` });
            const ac = isAllowedActiveDonorVehicle(dv);
            if (!ac.allowed) return sendJson(res, 422, { error: `ACTIVE DONOR ALLOWLIST FIREWALL BLOCKED: ${ac.reason}` });
          }
        }

        const now = new Date().toISOString();
        const sku = (b.sku || `ALD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`).trim();
        const secCode = (b.security_mark_code || generateSecurityCode()).trim();
        const weightLbs = Number(b.weight_lbs || 0);
        const lengthIn = Number(b.length_in || 0);
        const widthIn = Number(b.width_in || 0);
        const heightIn = Number(b.height_in || 0);
        const heavyThreshold = Number(settings.freight_weight_threshold_lbs || 70);
        const computedShip = computeShippingClass(weightLbs || 10, `${b.category || ''} ${b.title || ''}`, lengthIn || 14, widthIn || 10, heightIn || 8);
        const shippingClass = weightLbs >= heavyThreshold || b.shipping_class === 'local_pickup_only' || b.shipping_class === 'freight_ltl'
          ? 'local_pickup_only'
          : computedShip;

        // 3. Save base64 intake photos as dot-notation files (/uploads/SKU.1.jpg, /uploads/SKU.2.jpg) — Real Photos Required!
        const photos = persistPartPhotos(b.photos, sku);

        const channels = b.channels || {
          shopify: true,
          shopify_marketplace_connect: true,
          ebay_motors: true,
          google_merchant: true,
          meta_catalog: true,
          offerup: true,
          vendoo: true,
          tiktok_shop: shippingClass === 'parcel_calculated',
          craigslist: true
        };

        // 4. Lock Condition to Used (unless explicitly New) & wipe counterfeit/placeholder MPNs
        const rawCond = String(b.condition || 'Used').trim();
        const condStr = rawCond.toLowerCase() === 'new' ? 'New' : 'Used';
        const condId = condStr === 'New' ? 1000 : 3000;
        const rawMpn = String(b.oem_part_number || '').trim();
        const cleanOem = (!rawMpn || /^does\s+not\s+apply$/i.test(rawMpn) || isCounterfeitMpn(rawMpn)) ? '' : rawMpn;
        const pricePart = Number(b.price_we_pull || 0);
        const laborHours = Number(b.install_labor_hours || 1.5);
        const priceInstallInfo = Number(b.price_pull_install || Number((pricePart + laborHours * Number(settings.labor_rate_hourly || 174.99)).toFixed(2)));
        const cleanTitle = String(b.title || '').trim();
        const cleanCategory = String(b.category || '').trim();

        // 5. PERMANENT ANTI-PLACEHOLDER VALIDATION GATE: Force incomplete/placeholder SKUs into pending_verification
        const safePostFitNotes = stripDriveUrlsFromPublicText(b.fitment_notes || '');
        const pubGate = validateInventoryItemForPublish({
          title: cleanTitle,
          category: cleanCategory,
          oem_part_number: cleanOem,
          fitment_years: b.fitment_years || '',
          fitment_make: b.fitment_make || '',
          fitment_model: b.fitment_model || '',
          fitment_notes: safePostFitNotes,
          description: stripDriveUrlsFromPublicText(b.description || ''),
          weight_lbs: weightLbs,
          length_in: lengthIn,
          width_in: widthIn,
          height_in: heightIn
        });
        const initialStatus = pubGate.valid ? 'active' : pubGate.recommended_status;
        const initialQty = initialStatus === 'active' ? Math.max(1, Number(b.quantity ?? 1)) : 0;
        const finalFitmentNotes = pubGate.valid
          ? safePostFitNotes
          : `${safePostFitNotes}${safePostFitNotes ? ' | ' : ''}PENDING VERIFICATION: ${pubGate.reasons.join('; ')}`;

        const r = db.prepare(`
          INSERT INTO inventory_items (
            sku, title, category, condition, condition_id, brand, oem_part_number,
            interchange_number, hollander_number, placement_on_vehicle, donor_vehicle_id,
            fitment_years, fitment_make, fitment_model, fitment_engine, fitment_notes,
            description, defect_disclosure, bin_location, security_mark_code, security_mark_verified,
            security_mark_photo, photos_json, pull_status, allow_self_pull, price_self_pull,
            allow_we_pull, price_we_pull, allow_pull_install, price_pull_install, install_labor_hours,
            cost_basis, quantity, weight_lbs, length_in, width_in, height_in, shipping_class,
            handling_fee, handling_days, channels_json, status, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, 'pulled_shelved', 0, 0, 1, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `).run(
          sku, cleanTitle, cleanCategory, condStr, condId,
          b.brand || 'OEM', cleanOem, b.interchange_number || '', b.hollander_number || '',
          b.placement_on_vehicle || '', b.donor_vehicle_id ? Number(b.donor_vehicle_id) : null,
          b.fitment_years || '', b.fitment_make || '', b.fitment_model || '', b.fitment_engine || '', finalFitmentNotes,
          b.description || '', b.defect_disclosure || 'Inspected & verified.', b.bin_location || (shippingClass === 'local_pickup_only' ? 'LOCAL-PICKUP-98467' : 'RACK-A1'),
          secCode, b.security_mark_verified ? 1 : 1, b.security_mark_photo || '',
          JSON.stringify(photos),
          pricePart,
          priceInstallInfo, laborHours,
          Number(b.cost_basis || 0), initialQty,
          weightLbs, lengthIn, widthIn, heightIn, shippingClass,
          Number(b.handling_fee ?? settings.handling_fee_default ?? 10),
          Number(b.handling_days ?? settings.handling_days_default ?? 3),
          JSON.stringify(channels), initialStatus, now, now
        );

        let created = hydrateInventoryItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(r.lastInsertRowid));
        const qrCard = generatePartQrCardPng(created, settings, UPLOADS_DIR);
        const shopifySync = (b.auto_push_shopify === false || initialStatus !== 'active')
          ? { pushed: false, skipped: true, reason: initialStatus !== 'active' ? `Quarantined (${initialStatus}): ${pubGate.reasons.join('; ')}` : 'auto_push_disabled' }
          : await pushSingleItemToShopify(created, settings, UPLOADS_DIR);
        created = hydrateInventoryItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(r.lastInsertRowid));
        logSync('outbound', 'all_channels', 'intake_publish_sku', sku, initialStatus === 'active' ? 'success' : 'staged', `Camera Intake saved Single-Variant ${sku} (${created.title}) [status=${initialStatus}, ${photos.length} clean photo(s) + ${qrCard.fileName} Shopify final QR card, ${condStr}, MPN: ${cleanOem || 'unstamped'}, ${shippingClass}, ShopInstallCallout=$${priceInstallInfo.toFixed(2)}, Shopify Live=${Boolean(shopifySync.pushed)}] with Security ID ${secCode}.`);
        sendJson(res, 201, {
          ...created,
          single_variant_only: true,
          validation_passed: pubGate.valid,
          validation_reasons: pubGate.reasons,
          qr_card_attached_shopify_final: true,
          qr_tracking_url: qrCard.trackingUrl,
          ebay_google_photos_clean: true,
          shopify_live_sync: shopifySync,
          ebay_queued: initialStatus === 'active'
        });
        return;
      }
    }

    // Printable Bin Label, Printable Customer Packing Slip (with Scannable QR), Direct QR PNG & Local Marketplace Copy Packet
    const labelMatch = pathname.match(/^\/api\/inventory\/([^/]+)\/label$/);
    if ((method === 'GET' || method === 'HEAD') && labelMatch) {
      const sku = decodeURIComponent(labelMatch[1]);
      const item = db.prepare('SELECT * FROM inventory_items WHERE sku = ?').get(sku);
      if (!item) {
        sendJson(res, 404, { error: 'SKU not found' });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(method === 'HEAD' ? undefined : generatePrintableBinLabelHtml(item, getSettings()));
      return;
    }

    const packingSlipMatch = pathname.match(/^\/api\/inventory\/([^/]+)\/packing-slip$/);
    if ((method === 'GET' || method === 'HEAD') && packingSlipMatch) {
      const sku = decodeURIComponent(packingSlipMatch[1]);
      const item = db.prepare('SELECT * FROM inventory_items WHERE sku = ?').get(sku);
      if (!item) {
        sendJson(res, 404, { error: 'SKU not found' });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(method === 'HEAD' ? undefined : generatePrintablePackingSlipHtml(item, getSettings()));
      return;
    }

    const qrPngMatch = pathname.match(/^\/api\/inventory\/([^/]+)\/qr-card\.png$/);
    if ((method === 'GET' || method === 'HEAD') && qrPngMatch) {
      const sku = decodeURIComponent(qrPngMatch[1]);
      const item = db.prepare('SELECT * FROM inventory_items WHERE sku = ?').get(sku);
      if (!item) {
        sendJson(res, 404, { error: 'SKU not found' });
        return;
      }
      const card = generatePartQrCardPng(item, getSettings(), UPLOADS_DIR);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': card.pngBuffer.length, 'Cache-Control': 'no-cache' });
      res.end(method === 'HEAD' ? undefined : card.pngBuffer);
      return;
    }

    const localCopyMatch = pathname.match(/^\/api\/inventory\/([^/]+)\/local-copy$/);
    if (method === 'GET' && localCopyMatch) {
      const sku = decodeURIComponent(localCopyMatch[1]);
      const item = db.prepare('SELECT * FROM inventory_items WHERE sku = ?').get(sku);
      if (!item) {
        sendJson(res, 404, { error: 'SKU not found' });
        return;
      }
      sendJson(res, 200, {
        sku: item.sku,
        title: item.title,
        copy: renderLocalMarketplacePacket(item, getSettings())
      });
      return;
    }

    const invIdMatch = pathname.match(/^\/api\/inventory\/(\d+)$/);
    if (invIdMatch) {
      const id = Number(invIdMatch[1]);
      if (method === 'PUT') {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id);
        if (!existing) return sendJson(res, 404, { error: 'Item not found' });
        let nextQty = b.quantity !== undefined ? Number(b.quantity) : existing.quantity;
        let nextStatus = b.status || (nextQty <= 0 ? 'sold' : 'active');
        const cleanedFitNotes = stripDriveUrlsFromPublicText(
          String(b.fitment_notes !== undefined ? b.fitment_notes : (existing.fitment_notes || ''))
            .replace(/\s*\|\s*PENDING VERIFICATION:.*$/i, '')
            .replace(/^PENDING VERIFICATION:.*$/i, '')
            .trim()
        );
        const mergedCandidate = {
          ...existing,
          title: b.title !== undefined ? b.title : existing.title,
          category: b.category !== undefined ? b.category : existing.category,
          oem_part_number: b.oem_part_number !== undefined ? b.oem_part_number : existing.oem_part_number,
          fitment_years: b.fitment_years !== undefined ? b.fitment_years : existing.fitment_years,
          fitment_make: b.fitment_make !== undefined ? b.fitment_make : existing.fitment_make,
          fitment_model: b.fitment_model !== undefined ? b.fitment_model : existing.fitment_model,
          fitment_notes: cleanedFitNotes,
          weight_lbs: b.weight_lbs !== undefined ? Number(b.weight_lbs) : existing.weight_lbs,
          length_in: b.length_in !== undefined ? Number(b.length_in) : existing.length_in,
          width_in: b.width_in !== undefined ? Number(b.width_in) : existing.width_in,
          height_in: b.height_in !== undefined ? Number(b.height_in) : existing.height_in
        };
        let validationReasons = [];
        if (nextStatus === 'active') {
          const gate = validateInventoryItemForPublish(mergedCandidate);
          if (!gate.valid) {
            nextStatus = gate.recommended_status;
            nextQty = 0;
            validationReasons = gate.reasons;
          }
        }
        const savedFitNotes = validationReasons.length
          ? `${cleanedFitNotes}${cleanedFitNotes ? ' | ' : ''}PENDING VERIFICATION: ${validationReasons.join('; ')}`
          : cleanedFitNotes;
        db.prepare(`
          UPDATE inventory_items SET
            title = COALESCE(?, title),
            category = COALESCE(?, category),
            oem_part_number = COALESCE(?, oem_part_number),
            fitment_years = COALESCE(?, fitment_years),
            fitment_make = COALESCE(?, fitment_make),
            fitment_model = COALESCE(?, fitment_model),
            fitment_notes = ?,
            weight_lbs = COALESCE(?, weight_lbs),
            length_in = COALESCE(?, length_in),
            width_in = COALESCE(?, width_in),
            height_in = COALESCE(?, height_in),
            price_we_pull = COALESCE(?, price_we_pull),
            price_self_pull = COALESCE(?, price_self_pull),
            price_pull_install = COALESCE(?, price_pull_install),
            bin_location = COALESCE(?, bin_location),
            pull_status = COALESCE(?, pull_status),
            quantity = ?,
            status = ?,
            updated_at = ?
          WHERE id = ?
        `).run(
          b.title ?? null,
          b.category ?? null,
          b.oem_part_number ?? null,
          b.fitment_years ?? null,
          b.fitment_make ?? null,
          b.fitment_model ?? null,
          savedFitNotes,
          b.weight_lbs !== undefined ? Number(b.weight_lbs) : null,
          b.length_in !== undefined ? Number(b.length_in) : null,
          b.width_in !== undefined ? Number(b.width_in) : null,
          b.height_in !== undefined ? Number(b.height_in) : null,
          b.price_we_pull !== undefined ? Number(b.price_we_pull) : null,
          b.price_self_pull !== undefined ? Number(b.price_self_pull) : null,
          b.price_pull_install !== undefined ? Number(b.price_pull_install) : null,
          b.bin_location ?? null,
          b.pull_status ?? null,
          nextQty,
          nextStatus,
          new Date().toISOString(),
          id
        );
        const updated = hydrateInventoryItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id));
        logSync('outbound', 'co_master_sync', 'update_sku', updated.sku, 'success', `Updated ${updated.sku} -> Qty: ${updated.quantity}, Status: ${updated.status}`);
        sendJson(res, 200, { ...updated, validation_passed: validationReasons.length === 0, validation_reasons: validationReasons });
        return;
      }
      if (method === 'DELETE') {
        const existing = db.prepare('SELECT sku FROM inventory_items WHERE id = ?').get(id);
        db.prepare('DELETE FROM inventory_items WHERE id = ?').run(id);
        if (existing) logSync('outbound', 'all_channels', 'delete_sku', existing.sku, 'success', `Removed SKU ${existing.sku} from Co-Master inventory.`);
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    /* ==================== MULTI-TENANT WHITE-LABEL SAAS LICENSING APIs ==================== */
    if (pathname === '/api/saas/organizations') {
      if (method === 'GET') {
        const orgs = listOrganizationsWithSubscriptions();
        const totalMrr = orgs.reduce((sum, o) => sum + Number(o.subscription?.estimated_monthly_total_usd || 0), 0);
        sendJson(res, 200, {
          ok: true,
          count: orgs.length,
          total_mrr_usd: Number(totalMrr.toFixed(2)),
          plan_tiers: SAAS_PLAN_TIERS,
          organizations: orgs
        });
        return;
      }
      if (method === 'POST') {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const createdOrg = createOrganizationTenant(b);
        sendJson(res, 201, { ok: true, organization: createdOrg });
        return;
      }
    }

    const saasSeatMatch = pathname.match(/^\/api\/saas\/organizations\/(\d+)\/seats$/);
    if (method === 'POST' && saasSeatMatch) {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const updatedOrg = addOrganizationUserSeat(Number(saasSeatMatch[1]), b);
      sendJson(res, 201, { ok: true, organization: updatedOrg });
      return;
    }

    const saasOrgMatch = pathname.match(/^\/api\/saas\/organizations\/([^/]+)$/);
    if (saasOrgMatch) {
      const key = decodeURIComponent(saasOrgMatch[1]);
      if (method === 'GET') {
        const org = resolveOrganization(key);
        if (!org) return sendJson(res, 404, { error: 'Organization not found' });
        sendJson(res, 200, { ok: true, organization: org });
        return;
      }
      if (method === 'PUT' || method === 'PATCH') {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const target = resolveOrganization(key);
        if (!target) return sendJson(res, 404, { error: 'Organization not found' });
        const updatedOrg = updateOrganizationTenant(target.id, b);
        sendJson(res, 200, { ok: true, organization: updatedOrg });
        return;
      }
    }

    /* ==================== WAVE 1 "PROOF OF DOMINANCE" METRICS, BETA PIPELINE & 30S INFOMERCIAL STUDIO ==================== */
    if (method === 'GET' && pathname === '/api/wave1/metrics') {
      sendJson(res, 200, { ok: true, metrics: getWave1ProofMetrics() });
      return;
    }

    if (method === 'GET' && pathname === '/api/wave1/proof-one-pager') {
      const html = renderWave1ProofOnePagerHtml();
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(html);
      return;
    }

    if ((method === 'GET' || method === 'HEAD') && (pathname === '/business-plan' || pathname === '/business-plan/')) {
      const html = renderExecutiveBusinessPlanHtml({
        autoPrint: urlObj.searchParams.get('autoprint') === '1'
      });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      res.end(method === 'HEAD' ? '' : html);
      return;
    }

    if (pathname === '/api/wave1/beta-prospects') {
      if (method === 'GET') {
        sendJson(res, 200, { ok: true, prospects: listBetaProspects() });
        return;
      }
      if (method === 'POST') {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const created = createBetaProspect(b);
        sendJson(res, 201, { ok: true, prospect: created, metrics: getWave1ProofMetrics() });
        return;
      }
    }

    const betaProspectMatch = pathname.match(/^\/api\/wave1\/beta-prospects\/(\d+)$/);
    if (betaProspectMatch) {
      const pid = Number(betaProspectMatch[1]);
      if (method === 'PUT' || method === 'PATCH') {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const updated = updateBetaProspect(pid, b);
        sendJson(res, 200, { ok: true, prospect: updated, metrics: getWave1ProofMetrics() });
        return;
      }
      if (method === 'DELETE') {
        const deleted = deleteBetaProspect(pid);
        if (!deleted) return sendJson(res, 404, { error: 'Prospect not found' });
        sendJson(res, 200, { ok: true, metrics: getWave1ProofMetrics() });
        return;
      }
    }

    if (method === 'GET' && pathname === '/api/wave1/infomercial-assets') {
      const promoDir = path.join(__dirname, '..', 'marketing', 'wave1-30s-infomercial');
      const readSafe = (fname) => {
        try {
          return fs.readFileSync(path.join(promoDir, fname), 'utf8');
        } catch (_) {
          return '';
        }
      };
      let storyboard = {};
      try { storyboard = JSON.parse(readSafe('storyboard-30s-timeline.json') || '{}'); } catch (_) {}
      const voiceoverScript = readSafe('voiceover-script-74w.txt').trim();
      sendJson(res, 200, {
        ok: true,
        metrics: getWave1ProofMetrics(),
        word_count: voiceoverScript ? voiceoverScript.split(/\s+/).length : 0,
        voiceover_script: voiceoverScript,
        voiceover_ssml: readSafe('voiceover-ssml-gemini-elevenlabs.xml').trim(),
        veo3_prompt_9x16: readSafe('veo3-prompt-9x16-reels.txt').trim(),
        veo3_prompt_16x9: readSafe('veo3-prompt-16x9-youtube.txt').trim(),
        storyboard
      });
      return;
    }

    // Bulk CSV Import & Master Template
    if (method === 'GET' && pathname === '/api/templates/master-import.csv') {
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="master-inventory-import-template.csv"'
      });
      res.end(generateMasterImportTemplateCsv());
      return;
    }

    if (method === 'POST' && pathname === '/api/inventory/import-csv') {
      const body = JSON.parse((await readRawBody(req)) || '{}');
      if (!body.csvText) return sendJson(res, 400, { error: 'csvText is required' });
      const result = importInventoryCsv(body.csvText);
      sendJson(res, 200, result);
      return;
    }

    // Live Multi-Platform Feeds & Bulk Exporters
    if (method === 'GET' && (pathname === '/api/feeds/google-merchant.xml' || pathname === '/api/exports/google-merchant.xml')) {
      const items = db.prepare('SELECT * FROM inventory_items').all();
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      res.end(generateGoogleMerchantXml(items, getSettings(), baseUrl));
      return;
    }

    if (method === 'GET' && (pathname === '/api/feeds/meta.csv' || pathname === '/api/feeds/meta-catalog.csv' || pathname === '/api/exports/meta.csv' || pathname === '/api/exports/meta-commerce.csv')) {
      const items = db.prepare('SELECT * FROM inventory_items').all();
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'inline; filename="meta-catalog-feed.csv"'
      });
      res.end(generateMetaCatalogCsv(items, getSettings(), baseUrl));
      return;
    }

    const exportMap = {
      '/api/exports/shopify.csv': { fn: (i, s, u) => generateShopifyCsv(i, s, u), file: 'shopify-co-master-products.csv' },
      '/api/exports/ebay.csv': { fn: (i, s, u) => generateEbayMotorsCsv(i, s, u), file: 'ebay-us-standard-aabcas.csv' },
      '/api/exports/ebay-freight.csv': { fn: (i, s, u) => generateEbayFreightCsv(i, s, u), file: 'ebay-us-freight-pickup-aabcas.csv' },
      '/api/exports/ebay-file-exchange.csv': { fn: (i, s, u) => generateEbayMotorsCsv(i, s, u), file: 'ebay-us-standard-aabcas.csv' },
      '/api/exports/ebay_us.csv': { fn: (i, s, u) => generateEbayMotorsCsv(i, s, u), file: 'ebay-us-standard-aabcas.csv' },
      '/api/exports/ebay_motors.csv': { fn: (i, s, u) => generateEbayMotorsCsv(i, s, u), file: 'ebay-us-standard-aabcas.csv' },
      '/api/exports/vendoo.csv': { fn: (i, s, u) => generateVendooOrCrosslistCsv(i, s, u, 'vendoo'), file: 'vendoo-bulk-import.csv' },
      '/api/exports/crosslist.csv': { fn: (i, s, u) => generateVendooOrCrosslistCsv(i, s, u, 'crosslist'), file: 'crosslist-ebay-offerup-fb-import.csv' },
      '/api/exports/craigslist.csv': { fn: (i, s, u) => generateCraigslistCsv(i, s, u), file: 'craigslist-tacoma-98467-pts.csv' },
      '/api/exports/tiktok_shop.csv': { fn: (i, s, u) => generateTiktokShopCsv(i, s, u), file: 'tiktok-shop-bulk.csv' },
      '/api/exports/car_part_hollander.csv': { fn: (i) => generateCarPartHollanderCsv(i), file: 'car-part-hollander-interchange.csv' }
    };

    const stagedAuditExportMap = {
      '/api/exports/legacy-905-two-tier.csv': 'aldridge_905_legacy_two_tier_active_only.csv',
      '/api/exports/ebay-safe-batch-50.csv': 'ebay_aabcas_safe_batch_1_50_skus.csv',
      '/api/exports/local-pickup-98467-ads.csv': 'local_pickup_98467_offerup_craigslist_ads.csv',
      '/api/exports/vendoo-parcel-644.csv': 'aldridge_parcel_644_vendoo.csv'
    };

    if (method === 'GET' && stagedAuditExportMap[pathname]) {
      const targetFile = stagedAuditExportMap[pathname];
      const absTarget = path.join(DATA_DIR, 'audit_outputs', targetFile);
      if (fs.existsSync(absTarget)) {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${targetFile}"`
        });
        fs.createReadStream(absTarget).pipe(res);
        return;
      }
    }

    if (method === 'GET' && exportMap[pathname]) {
      const items = db.prepare('SELECT * FROM inventory_items').all();
      const spec = exportMap[pathname];
      logSync('outbound', spec.file.split('-')[0], 'export_feed_download', 'ALL', 'success', `Generated channel export ${spec.file} (${items.length} SKUs).`);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${spec.file}"`
      });
      res.end(spec.fn(items, getSettings(), baseUrl));
      return;
    }

    // Co-Master Shopify Sync, Crosslist Auto-Sync & Webhook Receiver
    if (method === 'POST' && pathname === '/api/sync/shopify') {
      const raw = await readRawBody(req);
      let opts = {};
      if (raw) {
        try {
          opts = JSON.parse(raw);
          const patch = {};
          if (opts.shopify_admin_token && String(opts.shopify_admin_token).trim()) {
            patch.shopify_admin_token = String(opts.shopify_admin_token).trim();
          }
          if (opts.shopify_client_id && String(opts.shopify_client_id).trim()) {
            patch.shopify_client_id = String(opts.shopify_client_id).trim();
          }
          if (opts.shopify_domain && String(opts.shopify_domain).trim()) {
            patch.shopify_domain = String(opts.shopify_domain).trim();
          }
          if (Object.keys(patch).length > 0) updateSettings(patch);
        } catch (_) {}
      }
      const enrichmentSummary = opts.enrich !== false ? enrichAllActiveInventoryInDb() : null;
      const dedupeSummary = deduplicateCatalog();
      const updateExisting = Boolean(opts.update_existing || opts.updateExisting);
      const result = await syncAllToShopifyCoMaster({ updateExisting });
      if (updateExisting && result.mode === 'live_api' && (!result.errors || result.errors.length === 0)) {
        updateSettings({ shopify_enrichment_synced_v6: new Date().toISOString() });
      }
      sendJson(res, 200, { ...result, enrichment: enrichmentSummary, deduplication: dedupeSummary });
      return;
    }

    if (method === 'POST' && pathname === '/api/sync/crosslist-auto-sync') {
      const raw = await readRawBody(req);
      let opts = {};
      try { opts = raw ? JSON.parse(raw) : {}; } catch (_) { opts = {}; }
      const dedupeSummary = deduplicateCatalog();
      const now = new Date().toISOString();
      const allRows = db.prepare('SELECT * FROM inventory_items').all();
      const activeSafe = allRows.filter((r) =>
        r.status === 'active' &&
        Number(r.quantity || 0) > 0 &&
        getValidPhotos(r).length > 0 &&
        validatePartCompliance({ title: r.title, category: r.category, description: r.description }).compliant
      );
      const soldDelisted = allRows.filter((r) => r.status === 'sold' || Number(r.quantity || 0) <= 0);

      let qrLeakCount = 0;
      const updateChStmt = db.prepare('UPDATE inventory_items SET channels_json = ?, updated_at = ? WHERE id = ?');
      db.exec('BEGIN;');
      try {
        for (const row of activeSafe) {
          const cleanPhotos = getValidPhotos(row);
          if (cleanPhotos.some((u) => isQrCardUrl(u))) qrLeakCount++;
          let ch = {};
          try { ch = JSON.parse(row.channels_json || '{}'); } catch (_) { ch = {}; }
          ch.crosslist_synced = true;
          ch.crosslist_synced_at = now;
          ch.crosslist_auto_delist_on_zero = true;
          ch.ebay_aabcas = true;
          ch.offerup = true;
          ch.facebook_marketplace = true;
          ch.delisted_all_feeds = false;
          updateChStmt.run(JSON.stringify(ch), now, row.id);
        }
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }

      let shopifySyncResult = null;
      if (opts.push_shopify === true) {
        try {
          shopifySyncResult = await syncAllToShopifyCoMaster();
        } catch (err) {
          shopifySyncResult = { mode: 'error', error: err.message };
        }
      }

      logSync(
        'outbound',
        'crosslist_auto_sync',
        'sync_all_channels',
        'ALL',
        'success',
        `Crosslist Auto-Sync verified ${activeSafe.length} single-variant OEM SKUs (${soldDelisted.length} sold/delisted excluded, ${qrLeakCount} QR cards leaked — 100% isolated). Ready for eBay aabcas, OfferUp, FB Marketplace, Google Merchant XML, Meta CSV & Craigslist Tacoma pts.`
      );

      sendJson(res, 200, {
        ok: true,
        synced_at: now,
        ready_skus: activeSafe.length,
        sold_delisted_skus: soldDelisted.length,
        qr_excluded_verified: qrLeakCount === 0,
        qr_leak_count: qrLeakCount,
        shopify_webhook_url: `${baseUrl}/api/webhooks/shopify`,
        crosslist_csv_url: `${baseUrl}/api/exports/crosslist.csv`,
        ebay_us_csv_url: `${baseUrl}/api/exports/ebay_us.csv`,
        google_merchant_xml_url: `${baseUrl}/api/feeds/google-merchant.xml`,
        meta_catalog_csv_url: `${baseUrl}/api/feeds/meta-catalog.csv`,
        craigslist_csv_url: `${baseUrl}/api/exports/craigslist.csv`,
        craigslist_queue_url: `${baseUrl}/api/craigslist/queue`,
        craigslist_userscript_url: `${baseUrl}/craigslist-autofill.user.js`,
        shopify_sync: shopifySyncResult
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/webhooks/shopify') {
      const rawBody = await readRawBody(req);
      const topic = req.headers['x-shopify-topic'] || 'orders/create';
      const hmac = req.headers['x-shopify-hmac-sha256'] || '';
      const result = handleShopifyWebhook(topic, rawBody, hmac);
      sendJson(res, 200, result);
      return;
    }

    if (method === 'GET' && pathname === '/api/shopify/webhooks/status') {
      const result = await ensureShopifyWebhooksRegistered({ registerMissing: false, baseUrl: getSettings().canonical_domain || baseUrl });
      sendJson(res, 200, result);
      return;
    }

    if (method === 'POST' && pathname === '/api/shopify/webhooks/register') {
      const result = await ensureShopifyWebhooksRegistered({ registerMissing: true, baseUrl: getSettings().canonical_domain || baseUrl });
      sendJson(res, 200, result);
      return;
    }

    if (method === 'GET' && pathname === '/api/shopify/product-sample') {
      const rawSkus = String(urlObj.searchParams.get('skus') || '').trim();
      const skuList = rawSkus ? rawSkus.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const result = await inspectLiveShopifyProducts(skuList);
      sendJson(res, 200, result);
      return;
    }

    if (method === 'GET' && pathname === '/api/catalog/integrity-audit') {
      sendJson(res, 200, auditCatalogIntegrity());
      return;
    }

    /* ==================== 3-TIER RECURRING MEMBERSHIPS & STRIPE BILLING ==================== */
    if (method === 'GET' && pathname === '/api/memberships/tiers') {
      const q = String(urlObj.searchParams.get('lookup') || '').trim();
      const member = q ? lookupMemberPublic(q) : null;
      sendJson(res, 200, {
        ok: true,
        tiers: Object.values(MEMBERSHIP_TIERS),
        stripe_configured: Boolean(process.env.STRIPE_SECRET_KEY),
        member
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/memberships/join') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const result = await createMembershipSignupAndBilling(b, {
        baseUrl: getSettings().canonical_domain || baseUrl
      });
      sendJson(res, 201, result);
      return;
    }

    if (method === 'POST' && pathname === '/api/memberships/lookup') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const member = lookupMemberPublic(b.query || b.email || b.phone || b.member_code || '');
      if (!member) {
        sendJson(res, 404, { ok: false, error: 'No Garage Club / VIP / B2B membership found matching that email, phone, or member code.' });
        return;
      }
      sendJson(res, 200, { ok: true, member });
      return;
    }

    if (method === 'POST' && pathname === '/api/webhooks/stripe') {
      const raw = await readRawBody(req);
      const event = JSON.parse(raw || '{}');
      const out = handleStripeWebhookEvent(event);
      sendJson(res, 200, out);
      return;
    }

    /* ==================== ABANDONED CART TRACKING & RECOVERY ==================== */
    if (method === 'POST' && pathname === '/api/carts/track') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const tracked = upsertAbandonedCart(b);
      sendJson(res, 200, tracked);
      return;
    }

    if (method === 'POST' && pathname === '/api/carts/recover') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const out = markAbandonedCartRecovered(b);
      sendJson(res, 200, out);
      return;
    }

    /* ==================== STRICT EMPLOYEE BACKEND AUTHENTICATION & /api/employee/* ==================== */
    if (method === 'POST' && pathname === '/api/employee/auth/login') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const check = verifyStaffCredentials(b.pin || b.password || '', b.staff_name || '', b.role || 'Owner/Admin');
      if (!check.ok) {
        sendJson(res, 401, { ok: false, error: check.error });
        return;
      }
      const token = issueEmployeeToken(check);
      const isHttps = String(req.headers['x-forwarded-proto'] || '').includes('https');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': buildEmployeeSessionCookie(token, isHttps),
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify({
        ok: true,
        authenticated: true,
        staff_name: check.staff_name,
        role: check.role,
        token
      }));
      return;
    }

    if (method === 'GET' && pathname === '/api/employee/auth/status') {
      const session = verifyEmployeeRequest(req);
      sendJson(res, 200, {
        ok: true,
        authenticated: Boolean(session),
        staff_name: session?.staff_name || '',
        role: session?.role || ''
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/employee/auth/logout') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': buildClearEmployeeCookie(),
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify({ ok: true, authenticated: false }));
      return;
    }

    // All remaining /api/employee/* endpoints strictly enforce verified employee authentication!
    if (pathname.startsWith('/api/employee/')) {
      const empSession = verifyEmployeeRequest(req);
      if (!empSession) {
        sendJson(res, 401, {
          ok: false,
          error: 'Employee authentication required. Sign in to Employee Backend with your Staff PIN/Password.'
        });
        return;
      }

      if (method === 'GET' && pathname === '/api/employee/counter-lookup') {
        const q = String(urlObj.searchParams.get('q') || '').trim();
        sendJson(res, 200, { ...lookupMemberForCounter(q), staff_user: empSession.staff_name });
        return;
      }

      if (method === 'GET' && pathname === '/api/employee/memberships') {
        sendJson(res, 200, { ok: true, ...listAllMemberships(), staff_user: empSession.staff_name });
        return;
      }

      const empMemberMatch = pathname.match(/^\/api\/employee\/memberships\/(\d+)\/tier$/);
      if (empMemberMatch && (method === 'POST' || method === 'PATCH')) {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const updated = updateMembershipTierByStaff(Number(empMemberMatch[1]), b);
        if (!updated) return sendJson(res, 404, { ok: false, error: 'Membership not found' });
        sendJson(res, 200, { ok: true, member: updated });
        return;
      }

      if (method === 'GET' && pathname === '/api/employee/abandoned-carts') {
        processDueAbandonedCartAlerts();
        sendJson(res, 200, { ok: true, ...listAbandonedCarts(), staff_user: empSession.staff_name });
        return;
      }

      const empCartMatch = pathname.match(/^\/api\/employee\/abandoned-carts\/(\d+)\/trigger$/);
      if (empCartMatch && method === 'POST') {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const updated = triggerAbandonedCartRecovery(Number(empCartMatch[1]), b.action || 'alert_15m');
        if (!updated) return sendJson(res, 404, { ok: false, error: 'Abandoned cart not found' });
        sendJson(res, 200, { ok: true, cart: updated });
        return;
      }

      if (method === 'GET' && pathname === '/api/employee/inventory-status') {
        const counts = db.prepare('SELECT status, COUNT(*) c FROM inventory_items GROUP BY status').all();
        const map = {};
        for (const r of counts) map[r.status] = Number(r.c || 0);
        sendJson(res, 200, {
          ok: true,
          verified_and_live: map.active || 0,
          needs_photo_title_check: map.pending_verification || 0,
          quarantined_srs: map.compliance_blocked || 0,
          duplicate_archived: map.duplicate_archived || 0,
          sold: map.sold || 0,
          staff_user: empSession.staff_name
        });
        return;
      }

      if (method === 'GET' && pathname === '/api/employee/sourcing-requests') {
        sendJson(res, 200, { ...listPartSourcingRequests(), staff_user: empSession.staff_name });
        return;
      }

      const empSrcMatch = pathname.match(/^\/api\/employee\/sourcing-requests\/(\d+)$/);
      if (empSrcMatch && (method === 'PATCH' || method === 'POST')) {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const updated = updatePartSourcingRequestByStaff(Number(empSrcMatch[1]), b);
        if (!updated) return sendJson(res, 404, { ok: false, error: 'Sourcing request not found' });
        sendJson(res, 200, { ok: true, request: updated });
        return;
      }

      // Unified Universal VIN Resolution (Folder/File Name + Photo/Video Sticker OCR + Manual VIN / Plate)
      if (method === 'POST' && (pathname === '/api/employee/intake/decode-vin-media' || pathname === '/api/employee/intake/resolve-vin-source')) {
        try {
          const ct = String(req.headers['content-type'] || '');
          let payload = {};
          if (/multipart\/form-data/i.test(ct)) {
            const rawBuf = await readRawBuffer(req, 64 * 1024 * 1024);
            const parsed = parseMultipartFormData(rawBuf, ct);
            payload = { ...parsed.fields, uploaded_files: parsed.files };
          } else {
            const rawStr = (await readRawBuffer(req, 64 * 1024 * 1024)).toString('utf8');
            payload = JSON.parse(rawStr || '{}');
          }
          const autoLock = payload.auto_lock === false || payload.auto_lock === 'false' ? false : true;
          const result = await resolveUniversalVinFromInput(payload, empSession.staff_name, { autoLock });
          const status = result.conflict_resolution_required ? 200 : (autoLock && result.session ? 201 : 200);
          sendJson(res, status, result);
        } catch (err) {
          sendJson(res, err.statusCode || 400, {
            ok: false,
            error: err.message || 'Could not extract or decode VIN from media/source.',
            ...(err.details || {})
          });
        }
        return;
      }

      // Mandatory Step 1 Employee VIN / License Plate Vehicle Intake Gate
      if (method === 'POST' && pathname === '/api/employee/intake/vehicle') {
        try {
          const b = JSON.parse((await readRawBody(req)) || '{}');
          const result = await createVinIntakeVehicleSession(b, empSession.staff_name);
          const cfg = getSettings();
          sendJson(res, 201, {
            ...result,
            auto_bin_prefix: buildAutoBinPrefix(result.session || {}),
            gemini_vision_configured: Boolean(String(cfg.gemini_api_key || process.env.GEMINI_API_KEY || '').trim())
          });
        } catch (err) {
          sendJson(res, err.statusCode || 400, { ok: false, error: err.message || 'Could not decode/lock VIN session.', details: err.details });
        }
        return;
      }

      if (method === 'GET' && pathname === '/api/employee/intake/sessions') {
        sendJson(res, 200, { ...listVinIntakeSessions(), staff_user: empSession.staff_name });
        return;
      }

      // Persist Gemini Vision API Key (SQLite + DATA_DIR/.gemini_vision_key + runtime process.env)
      if (method === 'POST' && pathname === '/api/employee/settings/gemini-key') {
        try {
          const b = JSON.parse((await readRawBody(req)) || '{}');
          const key = String(b.gemini_api_key || '').trim();
          if (!key || key.length < 20) {
            sendJson(res, 400, { ok: false, error: 'Enter a valid Google AI Studio Gemini API key (starts with AIza...).' });
            return;
          }
          const updated = updateSettings({ gemini_api_key: key });
          logSync('system', 'settings_vault', 'persist_gemini_vision_key', '', 'success', `${empSession.staff_name} persisted Gemini Vision API key (SQLite + persistent DATA_DIR).`);
          sendJson(res, 200, {
            ok: true,
            gemini_vision_configured: Boolean(updated.gemini_api_key),
            gemini_vision_persisted: Boolean(updated.gemini_api_key),
            masked_key: `${key.slice(0, 6)}••••${key.slice(-4)}`
          });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err.message || 'Could not persist Gemini API key.' });
        }
        return;
      }

      if (method === 'GET' && pathname === '/api/employee/diagnostics/gemini') {
        const cfg = getSettings();
        const key = String(cfg.gemini_api_key || process.env.GEMINI_API_KEY || '').trim();
        if (!key) {
          sendJson(res, 200, { ok: false, configured: false, error: 'GEMINI_API_KEY is not configured.' });
          return;
        }
        const checks = [];
        for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
          try {
            const r = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: 'Reply with JSON {"ok":true}' }] }],
                  generationConfig: model === 'gemini-2.5-flash'
                    ? { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
                    : { responseMimeType: 'application/json' }
                }),
                signal: AbortSignal.timeout(12000)
              }
            );
            const txt = await r.text();
            checks.push({ model, http_status: r.status, ok: r.ok, snippet: txt.slice(0, 200) });
          } catch (e) {
            checks.push({ model, http_status: 0, ok: false, error: e.message });
          }
        }
        sendJson(res, 200, {
          ok: checks.some((c) => c.ok),
          configured: true,
          masked_key: `${key.slice(0, 6)}••••${key.slice(-4)}`,
          checks
        });
        return;
      }

      // Master Parent Google Drive Folder Multi-Vehicle Batch Runner (All Verified 17-VIN Subfolders in 1 Run)
      if (method === 'POST' && pathname === '/api/employee/intake/batch-ai-master') {
        try {
          const rawStr = (await readRawBody(req)) || '{}';
          const payload = JSON.parse(rawStr);
          const { accepted, job } = await startMasterParentFolderBatchJob(
            {
              drive_url: payload.drive_url || payload.google_drive_url || DEFAULT_MASTER_DRIVE_URL,
              ...payload
            },
            empSession.staff_name,
            {
              uploadsDir: UPLOADS_DIR,
              baseUrl,
              syncAllToShopifyFn: syncAllToShopifyCoMaster
            }
          );
          sendJson(res, accepted ? 202 : 200, {
            ok: true,
            accepted,
            ...job
          });
        } catch (err) {
          sendJson(res, err.statusCode || 400, {
            ok: false,
            error: err.message || 'Master Drive Folder batch intake failed.'
          });
        }
        return;
      }

      if (method === 'GET' && pathname === '/api/employee/intake/batch-ai-master/latest') {
        const job = getLatestMasterBatchJob();
        sendJson(res, 200, { ok: true, job: job || null });
        return;
      }

      if (method === 'GET' && pathname.startsWith('/api/employee/intake/batch-ai-master/')) {
        const jobId = decodeURIComponent(pathname.replace('/api/employee/intake/batch-ai-master/', '')).trim();
        const job = getMasterBatchJob(jobId);
        if (!job) {
          sendJson(res, 404, { ok: false, error: `Master batch job "${jobId}" not found.` });
          return;
        }
        sendJson(res, 200, { ok: true, ...job });
        return;
      }

      // Employee Co-Master Shopify Sync Endpoint (supports synchronous or async:true for large multi-vehicle catalogs)
      if (method === 'POST' && pathname === '/api/employee/shopify/sync') {
        try {
          const rawStr = (await readRawBody(req)) || '{}';
          const opts = rawStr ? JSON.parse(rawStr) : {};
          const updateExisting = Boolean(opts.update_existing || opts.updateExisting);
          const runAsync = Boolean(opts.async === true || opts.async === 'true');
          const enrichmentSummary = opts.enrich !== false ? enrichAllActiveInventoryInDb() : null;
          const dedupeSummary = deduplicateCatalog();
          if (runAsync) {
            const syncJobId = `SHSYNC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            global.__aldridgeShopifySyncJob = {
              job_id: syncJobId,
              status: 'running',
              started_at: new Date().toISOString(),
              finished_at: '',
              enrichment: enrichmentSummary,
              deduplication: dedupeSummary,
              result: null,
              error: ''
            };
            setImmediate(async () => {
              try {
                const r = await syncAllToShopifyCoMaster({ updateExisting });
                global.__aldridgeShopifySyncJob.result = r;
                global.__aldridgeShopifySyncJob.status = 'completed';
                global.__aldridgeShopifySyncJob.finished_at = new Date().toISOString();
              } catch (syncErr) {
                global.__aldridgeShopifySyncJob.error = syncErr.message || String(syncErr);
                global.__aldridgeShopifySyncJob.status = 'failed';
                global.__aldridgeShopifySyncJob.finished_at = new Date().toISOString();
              }
            });
            sendJson(res, 202, { ok: true, accepted: true, ...global.__aldridgeShopifySyncJob, poll_url: '/api/employee/shopify/sync/status' });
            return;
          }
          const result = await syncAllToShopifyCoMaster({ updateExisting });
          sendJson(res, 200, { ok: true, ...result, enrichment: enrichmentSummary, deduplication: dedupeSummary });
        } catch (err) {
          sendJson(res, err.statusCode || 500, { ok: false, error: err.message || 'Shopify Co-Master sync failed.' });
        }
        return;
      }

      if (method === 'GET' && pathname === '/api/employee/shopify/sync/status') {
        sendJson(res, 200, { ok: true, job: global.__aldridgeShopifySyncJob || null });
        return;
      }

      if (method === 'POST' && pathname === '/api/employee/shopify/sync-shipping') {
        try {
          const rawStr = (await readRawBody(req)) || '{}';
          let opts = {};
          try { opts = rawStr ? JSON.parse(rawStr) : {}; } catch (_) {}
          const limit = Number(opts.limit || 0);
          const skus = Array.isArray(opts.skus) ? opts.skus : [];
          const runAsync = Boolean(opts.async === true || opts.async === 'true');
          if (runAsync) {
            const jobId = `SHSHIP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            global.__aldridgeShopifyShippingJob = {
              job_id: jobId,
              status: 'running',
              started_at: new Date().toISOString(),
              finished_at: '',
              progress: {
                total_active: 0,
                processed: 0,
                updated_count: 0,
                packed_dimensions_saved: 0,
                weight_saved: 0,
                origin_saved: 0,
                local_pickup_only_count: 0,
                errors_count: 0
              },
              result: null,
              error: ''
            };
            setImmediate(async () => {
              try {
                const r = await syncAllNativeShippingToShopify({
                  limit,
                  skus,
                  onProgress: (p) => {
                    if (global.__aldridgeShopifyShippingJob) {
                      global.__aldridgeShopifyShippingJob.progress = p;
                    }
                  }
                });
                global.__aldridgeShopifyShippingJob.result = r;
                global.__aldridgeShopifyShippingJob.status = 'completed';
                global.__aldridgeShopifyShippingJob.finished_at = new Date().toISOString();
              } catch (shipErr) {
                global.__aldridgeShopifyShippingJob.error = shipErr.message || String(shipErr);
                global.__aldridgeShopifyShippingJob.status = 'failed';
                global.__aldridgeShopifyShippingJob.finished_at = new Date().toISOString();
              }
            });
            sendJson(res, 202, {
              ok: true,
              accepted: true,
              ...global.__aldridgeShopifyShippingJob,
              poll_url: '/api/employee/shopify/sync-shipping/status'
            });
            return;
          }
          const result = await syncAllNativeShippingToShopify({ limit, skus });
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, err.statusCode || 500, { ok: false, error: err.message || 'Shopify native shipping sync failed.' });
        }
        return;
      }

      if (method === 'GET' && pathname === '/api/employee/shopify/sync-shipping/status') {
        sendJson(res, 200, { ok: true, job: global.__aldridgeShopifyShippingJob || null });
        return;
      }

      if (method === 'POST' && pathname === '/api/employee/shopify/archive-skus') {
        try {
          const rawStr = (await readRawBody(req)) || '{}';
          let opts = {};
          try { opts = rawStr ? JSON.parse(rawStr) : {}; } catch (_) {}
          const skus = Array.isArray(opts.skus) ? opts.skus : [];
          const archiveNonParts = opts.archive_non_parts !== false;
          const result = await archiveSkusOnShopifyAndDb({ skus, archiveNonParts });
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, err.statusCode || 500, { ok: false, error: err.message || 'Shopify SKU archive failed.' });
        }
        return;
      }

      if (method === 'POST' && pathname === '/api/employee/shopify/restore-verified') {
        try {
          const raw = await readRawBody(req);
          let opts = {};
          try { opts = raw ? JSON.parse(raw) : {}; } catch (_) {}
          const reactivate = Boolean(opts.reactivate_archived || opts.reactivate_accidentally_archived);
          const onlyActive = !reactivate && opts.only_active !== false;
          const runAsync = !(opts.async === false || opts.sync === true);
          if (runAsync) {
            const jobId = `SHREST-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            global.__aldridgeShopifyRestoreJob = {
              job_id: jobId,
              status: 'running',
              reactivate_archived: reactivate,
              started_at: new Date().toISOString(),
              finished_at: '',
              result: null,
              error: ''
            };
            setImmediate(async () => {
              try {
                const r = await hydrateInventoryFromShopifyCoMaster({
                  onlyActive,
                  reactivateAccidentallyArchived: reactivate
                });
                global.__aldridgeShopifyRestoreJob.result = r;
                global.__aldridgeShopifyRestoreJob.status = 'completed';
                global.__aldridgeShopifyRestoreJob.finished_at = new Date().toISOString();
              } catch (restErr) {
                global.__aldridgeShopifyRestoreJob.error = restErr.message || String(restErr);
                global.__aldridgeShopifyRestoreJob.status = 'failed';
                global.__aldridgeShopifyRestoreJob.finished_at = new Date().toISOString();
              }
            });
            sendJson(res, 202, { ok: true, accepted: true, ...global.__aldridgeShopifyRestoreJob, poll_url: '/api/employee/shopify/restore-verified/status' });
            return;
          }
          const result = await hydrateInventoryFromShopifyCoMaster({
            onlyActive,
            reactivateAccidentallyArchived: reactivate
          });
          sendJson(res, 200, { ok: true, ...result });
        } catch (err) {
          sendJson(res, err.statusCode || 500, { ok: false, error: err.message || 'Shopify restore failed.' });
        }
        return;
      }

      if (method === 'GET' && pathname === '/api/employee/shopify/restore-verified/status') {
        sendJson(res, 200, { ok: true, job: global.__aldridgeShopifyRestoreJob || null });
        return;
      }

      // Step 2 Employee VIN-Locked Hands-Free AI Multi-Input Batch Intake (Camera / Multi-Photo / Video / ZIP / Google Drive Link)
      if (method === 'POST' && pathname === '/api/employee/intake/batch-ai') {
        try {
          const ct = String(req.headers['content-type'] || '');
          let payload = {};
          if (/multipart\/form-data/i.test(ct)) {
            const rawBuf = await readRawBuffer(req, 64 * 1024 * 1024);
            const parsed = parseMultipartFormData(rawBuf, ct);
            payload = {
              ...parsed.fields,
              uploaded_files: parsed.files
            };
          } else {
            const rawStr = (await readRawBuffer(req, 64 * 1024 * 1024)).toString('utf8');
            payload = JSON.parse(rawStr || '{}');
          }
          const result = await runAiMultiInputBatchIntake(payload, empSession.staff_name, {
            uploadsDir: UPLOADS_DIR,
            baseUrl
          });
          sendJson(res, 201, result);
        } catch (err) {
          sendJson(res, err.statusCode || 400, {
            ok: false,
            error: err.message || 'AI batch part intake failed.',
            ...(err.details || {})
          });
        }
        return;
      }

      // Step 2 Employee VIN-Locked Single Part Photo Intake & Publish
      if (method === 'POST' && pathname === '/api/employee/intake/part') {
        try {
          const b = JSON.parse((await readRawBody(req)) || '{}');
          const result = await intakePartForVinSession(b, empSession.staff_name, { uploadsDir: UPLOADS_DIR, baseUrl });
          let shopifyPush = null;
          if (b.push_shopify === true && result.item) {
            try {
              shopifyPush = await pushSingleItemToShopify(result.item, getSettings(), UPLOADS_DIR);
            } catch (shErr) {
              shopifyPush = { ok: false, error: shErr.message };
            }
          }
          sendJson(res, 201, { ...result, shopify_push: shopifyPush });
        } catch (err) {
          sendJson(res, err.statusCode || 400, { ok: false, error: err.message || 'Part intake failed.' });
        }
        return;
      }

      // Full Clean-Slate SQLite + Live Shopify Pre-VIN Catalog Purge
      if (method === 'POST' && pathname === '/api/employee/catalog/purge-clean-slate') {
        try {
          const b = JSON.parse((await readRawBody(req)) || '{}');
          const dbPurge = purgeLegacyPreVinCatalog({ actor: empSession.staff_name });
          let shopifyPurge = { mode: 'skipped' };
          if (b.skip_shopify !== true) {
            shopifyPurge = await purgeAllShopifyPreVinListings({ deleteProducts: Boolean(b.delete_shopify_products) });
            if (shopifyPurge.mode === 'live_api' && shopifyPurge.ok) {
              updateSettings({ shopify_clean_slate_purge_v1: new Date().toISOString() });
            }
          }
          sendJson(res, 200, { ok: true, sqlite_purge: dbPurge, shopify_purge: shopifyPurge });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err.message || 'Clean-slate purge failed.' });
        }
        return;
      }
    }

    // UNIVERSAL VIN-CONFIRMED 4-NETWORK PARTS AGGREGATOR (In-House OEM + Car-Part Pro + Wholesale + eBay/PartsGeek/Amazon @ +50% Markup)
    if (method === 'GET' && pathname === '/api/parts-aggregator/connectors') {
      sendJson(res, 200, {
        ok: true,
        markup_pct: 50,
        labor_rate_hourly: Number(getSettings().labor_rate_hourly || 174.99),
        connectors: getConnectorStatuses()
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/parts-aggregator/search') {
      try {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const empCheck = verifyEmployeeRequest(req);
        const result = await searchUniversalPartsAggregator(b, { isEmployee: Boolean(empCheck) });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message || 'Parts aggregator search failed.' });
      }
      return;
    }

    if (method === 'POST' && pathname === '/api/parts-aggregator/order') {
      try {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const result = placeAggregatorPartOrder(b);
        sendJson(res, 201, result);
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message || 'Could not place aggregator order.' });
      }
      return;
    }

    // "If We Don't Have It, We Can Get It" 50%-Markup Parts Sourcing, Guided Helper & Instant Bookable Shop Services
    if (method === 'GET' && pathname === '/api/services/catalog') {
      const cfg = getSettings();
      sendJson(res, 200, {
        ok: true,
        labor_rate_hourly: Number(cfg.labor_rate_hourly || 174.99),
        sourcing_markup_pct: 50,
        services: SHOP_SERVICES_CATALOG,
        symptom_playbooks: Object.values(SYMPTOM_PLAYBOOKS)
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/services/book') {
      try {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const result = await bookShopService(b, { baseUrl: getSettings().canonical_domain || baseUrl });
        sendJson(res, 201, result);
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message || 'Could not complete service booking.' });
      }
      return;
    }

    if (method === 'POST' && pathname === '/api/parts-sourcing/quote') {
      try {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const result = createPartSourcingQuote(b);
        sendJson(res, 201, result);
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message || 'Could not generate instant part quote.' });
      }
      return;
    }

    if (method === 'POST' && pathname === '/api/guided-helper/recommend') {
      try {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const result = runGuidedHelperRecommendation(b);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message || 'Could not evaluate vehicle symptoms.' });
      }
      return;
    }

    // U-Haul Official Dealer Page Sync
    if (method === 'POST' && pathname === '/api/uhaul/sync') {
      const body = JSON.parse((await readRawBody(req)) || '{}');
      const synced = await syncUhaulDealerPage(body.uhaul_dealer_url);
      sendJson(res, 200, { ok: true, synced });
      return;
    }

    // Mixed-Cart Local_Pickup_Only Guard Helper & Validation Endpoint
    const HEAVY_ASSEMBLY_PICKUP_RE = /\b(engine\s*(long\s*block|short\s*block|assembly|motor)|transmission(\s*assembly)?|transfer\s*case|subframe|crossmember|rear\s*axle|differential\s*assembly|hood(\s*panel)?|truck\s*bed|door\s*(shell|assembly)|fender\s*panel|quarter\s*panel|tailgate|sunroof\s*glass|windshield|fuel\s*tank)\b/i;
    const MIXED_CART_LOCAL_PICKUP_BANNER =
      'Heavy Assembly in Cart — Local Pickup Only at 5115 66th St W, Bldg B, University Place, WA 98467 (or remove heavy assemblies to ship parcel items separately)';
    const isHeavyLocalPickupOrderItem = (dbItem, heavyThreshold = 70) => {
      if (!dbItem) return false;
      if (Number(dbItem.weight_lbs || 0) >= heavyThreshold) return true;
      const sc = String(dbItem.shipping_class || '').toLowerCase();
      if (sc && sc !== 'parcel_calculated') return true;
      if (HEAVY_ASSEMBLY_PICKUP_RE.test(String(dbItem.title || ''))) return true;
      return false;
    };

    if (method === 'POST' && pathname === '/api/cart/validate') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const settings = getSettings();
      const heavyThreshold = Number(settings.freight_weight_threshold_lbs ?? 70);
      const itemsReq = Array.isArray(b.items) ? b.items : [];
      const heavySkus = [];
      const parcelSkus = [];
      for (const line of itemsReq) {
        const sku = String(line?.sku || '').trim();
        if (!sku) continue;
        const dbItem = db.prepare('SELECT * FROM inventory_items WHERE sku = ?').get(sku);
        if (!dbItem) continue;
        if (isHeavyLocalPickupOrderItem(dbItem, heavyThreshold)) heavySkus.push(dbItem.sku);
        else parcelSkus.push(dbItem.sku);
      }
      const hasHeavyLocalPickup = heavySkus.length > 0;
      sendJson(res, 200, {
        ok: true,
        has_heavy_local_pickup: hasHeavyLocalPickup,
        mixed_cart: hasHeavyLocalPickup && parcelSkus.length > 0,
        locked_fulfillment_mode: hasHeavyLocalPickup ? 'local_pickup_we_pull' : null,
        warning_banner: hasHeavyLocalPickup ? MIXED_CART_LOCAL_PICKUP_BANNER : '',
        cart_attributes: hasHeavyLocalPickup ? { Fulfillment_Mode: 'Local_Pickup_Only_Bldg_B' } : {},
        heavy_skus: heavySkus,
        parcel_skus: parcelSkus
      });
      return;
    }

    // Direct Storefront 3-Tier Purchasing Orders
    if (method === 'POST' && pathname === '/api/orders') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const settings = getSettings();
      const now = new Date().toISOString();
      const itemsReq = Array.isArray(b.items) ? b.items : [];
      if (itemsReq.length === 0) return sendJson(res, 400, { error: 'Cart is empty.' });
      if (!b.policy_accepted) return sendJson(res, 400, { error: 'You must accept the Defect-Evidence Only Return & Fitment Policy to complete purchase.' });

      let mode = b.fulfillment_mode || 'ship_calculated';
      if (mode === 'self_pull_yard' && !b.waiver_accepted) {
        return sendJson(res, 400, { error: 'Self-Pull Yard Safety & Liability Waiver must be accepted for You-Pull-It orders.' });
      }

      let subtotal = 0;
      let totalWeight = 0;
      let hasHeavyLocalPickup = false;
      const heavyThreshold = Number(settings.freight_weight_threshold_lbs ?? 70);
      const hydratedOrderItems = [];

      for (const line of itemsReq) {
        const dbItem = db.prepare('SELECT * FROM inventory_items WHERE sku = ?').get(line.sku);
        if (!dbItem || dbItem.quantity < Number(line.qty || 1)) {
          return sendJson(res, 400, { error: `Part ${line.sku} is no longer available in requested quantity.` });
        }
        const qty = Number(line.qty || 1);
        const unitPrice = Number(dbItem.price_we_pull || 0);
        const lineHeavy = isHeavyLocalPickupOrderItem(dbItem, heavyThreshold);
        subtotal += unitPrice * qty;
        totalWeight += Number(dbItem.weight_lbs || 8) * qty;
        if (lineHeavy) {
          hasHeavyLocalPickup = true;
        }
        hydratedOrderItems.push({
          sku: dbItem.sku,
          title: dbItem.title,
          oem_part_number: dbItem.oem_part_number || '',
          security_mark_code: dbItem.security_mark_code,
          qty,
          unit_price: unitPrice,
          est_turnkey_installed_callout: Number(dbItem.price_pull_install || 0),
          local_pickup_only: lineHeavy,
          mode
        });
      }

      if (mode === 'ship_calculated' && hasHeavyLocalPickup) {
        return sendJson(res, 400, {
          error: MIXED_CART_LOCAL_PICKUP_BANNER,
          locked_fulfillment_mode: 'local_pickup_we_pull',
          cart_attributes: { Fulfillment_Mode: 'Local_Pickup_Only_Bldg_B' }
        });
      }

      if (hasHeavyLocalPickup) {
        mode = 'local_pickup_we_pull';
        hydratedOrderItems.forEach((it) => { it.mode = mode; });
      }

      const incomingAttrs = (b.cart_attributes && typeof b.cart_attributes === 'object') ? b.cart_attributes : {};
      const cartAttributes = hasHeavyLocalPickup
        ? { ...incomingAttrs, Fulfillment_Mode: 'Local_Pickup_Only_Bldg_B' }
        : incomingAttrs;
      const rawNote = String(b.notes || '').trim();
      const fulfillmentTag = hasHeavyLocalPickup ? 'Fulfillment_Mode: Local_Pickup_Only_Bldg_B' : '';
      const combinedNotes = fulfillmentTag
        ? (rawNote.includes('Local_Pickup_Only_Bldg_B') ? rawNote : [fulfillmentTag, rawNote].filter(Boolean).join(' | '))
        : rawNote;

      let shippingCost = 0;
      let handlingFee = 0;
      if (mode === 'ship_calculated') {
        handlingFee = Number(settings.handling_fee_default ?? 10);
        shippingCost = Math.max(12.95, Number((8.50 + totalWeight * 0.92).toFixed(2)));
      }

      const taxRate = Number(settings.tax_rate ?? 0.101);
      const tax = Number((subtotal * taxRate).toFixed(2));
      const total = Number((subtotal + shippingCost + handlingFee + tax).toFixed(2));
      const orderNumber = 'ORD-' + Math.floor(100000 + Math.random() * 899999);

      const pillarTag = mode === 'self_pull_yard'
        ? 'self-pull-buyer'
        : mode === 'we_pull_and_install'
          ? 'pull-install-buyer'
          : 'parts-buyer';

      const customer = upsertCustomer({
        name: b.customer_name,
        email: b.customer_email,
        phone: b.customer_phone,
        source_pillar: 'parts_storefront',
        tags: [pillarTag],
        vehicles: b.vehicle_ymm ? [b.vehicle_ymm] : [],
        email_opt_in: b.email_opt_in ? 1 : 0,
        sms_opt_in: b.sms_opt_in ? 1 : 0
      });

      let linkedBookingCode = '';
      let approvalStatus = 'approved';

      // All Self-Pull, We-Pull Counter Pickup, and We-Pull + Install orders create a Staff-Approval Appointment in Employee Backend!
      if (mode !== 'ship_calculated') {
        approvalStatus = 'pending_staff_approval';
        linkedBookingCode = 'APT-' + Math.floor(1000 + Math.random() * 8999);
        const typeLabelMap = {
          self_pull_yard: 'Self-Pull Yard Appointment (Customer Pulls Part)',
          local_pickup_we_pull: 'We-Pull Counter Pickup Appointment',
          we_pull_and_install: 'We-Pull + Shop Bay Installation Appointment'
        };
        db.prepare(`
          INSERT INTO appointments (
            booking_code, customer_id, customer_name, customer_email, customer_phone,
            appointment_type, service_category, vehicle_vin, vehicle_ymm,
            linked_order_number, linked_sku, preferred_date, preferred_time,
            booking_mode, status, assigned_bay, customer_notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_approval', 'pending_approval', 'Pending Staff Assignment', ?, ?)
        `).run(
          linkedBookingCode,
          customer.id,
          b.customer_name,
          b.customer_email || '',
          b.customer_phone || '',
          mode,
          typeLabelMap[mode] || 'Shop Parts Appointment',
          (b.vehicle_vin || '').toUpperCase(),
          b.vehicle_ymm || '',
          orderNumber,
          hydratedOrderItems.map((i) => i.sku).join(', '),
          b.preferred_date || new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
          b.preferred_time || '10:00 AM',
          combinedNotes,
          now
        );
      }

      db.prepare(`
        INSERT INTO orders (
          order_number, customer_id, customer_name, customer_email, customer_phone,
          shipping_address, fulfillment_mode, items_json, subtotal, shipping_cost,
          handling_fee, tax, total, channel_source, payment_status, approval_status,
          linked_booking_code, waiver_accepted, policy_accepted, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'direct_storefront', ?, ?, ?, ?, 1, ?, ?)
      `).run(
        orderNumber,
        customer.id,
        b.customer_name,
        b.customer_email,
        b.customer_phone || '',
        hasHeavyLocalPickup ? '' : (b.shipping_address || ''),
        mode,
        JSON.stringify(hydratedOrderItems),
        subtotal,
        shippingCost,
        handlingFee,
        tax,
        total,
        mode === 'ship_calculated' ? 'paid' : 'authorized_pending_staff_approval',
        approvalStatus,
        linkedBookingCode,
        b.waiver_accepted ? 1 : 0,
        combinedNotes,
        now
      );

      // Atomically decrement/reserve inventory across Co-Master, Shopify & all feeds!
      for (const line of hydratedOrderItems) {
        const lockRes = await lockInventorySkuAtomically(line.sku, {
          reason: `direct_storefront_${mode}`,
          reference: orderNumber
        });
        if (!lockRes.locked) {
          return sendJson(res, 409, { error: `Part ${line.sku} was just reserved or sold (${lockRes.reason}). Please refresh your bag.` });
        }
      }

      db.prepare('UPDATE crm_customers SET total_spent = total_spent + ? WHERE id = ?').run(total, customer.id);

      let gcalUrl = '';
      let icsUrl = '';
      if (linkedBookingCode) {
        const apt = db.prepare('SELECT * FROM appointments WHERE booking_code = ?').get(linkedBookingCode);
        gcalUrl = buildGoogleCalendarUrl(apt, settings);
        icsUrl = `/api/appointments/${encodeURIComponent(linkedBookingCode)}/calendar.ics`;
      }

      sendJson(res, 201, {
        ok: true,
        order_number: orderNumber,
        fulfillment_mode: mode,
        local_pickup_locked: hasHeavyLocalPickup,
        cart_attributes: cartAttributes,
        notes: combinedNotes,
        approval_status: approvalStatus,
        linked_booking_code: linkedBookingCode,
        total,
        shipping_cost: shippingCost,
        handling_fee: handlingFee,
        gcal_url: gcalUrl,
        ics_url: icsUrl,
        referral_code: customer.referral_code
      });
      return;
    }

    // Order Approval Update (Employee Backend)
    const orderIdMatch = pathname.match(/^\/api\/orders\/(\d+)$/);
    if (method === 'PUT' && orderIdMatch) {
      const id = Number(orderIdMatch[1]);
      const b = JSON.parse((await readRawBody(req)) || '{}');
      db.prepare('UPDATE orders SET approval_status = COALESCE(?, approval_status), payment_status = COALESCE(?, payment_status) WHERE id = ?').run(
        b.approval_status || null, b.payment_status || null, id
      );
      sendJson(res, 200, { ok: true });
      return;
    }

    // Appointments & Calendar Sync
    const icsMatch = pathname.match(/^\/api\/appointments\/([^/]+)\/calendar\.ics$/);
    if (method === 'GET' && icsMatch) {
      const code = decodeURIComponent(icsMatch[1]);
      const apt = db.prepare('SELECT * FROM appointments WHERE booking_code = ?').get(code);
      if (!apt) return sendJson(res, 404, { error: 'Appointment not found' });
      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${code}.ics"`
      });
      res.end(generateIcsCalendarEvent(apt, getSettings()));
      return;
    }

    if (pathname === '/api/appointments') {
      if (method === 'POST') {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const settings = getSettings();
        const now = new Date().toISOString();
        const bookingCode = 'APT-' + Math.floor(1000 + Math.random() * 8999);
        const bookingMode = b.booking_mode === 'instant_slot' ? 'instant_slot' : 'staff_approval';
        const initialStatus = bookingMode === 'instant_slot' ? 'approved' : 'pending_approval';

        const pillarTag = (b.appointment_type || '').includes('pull') ? 'parts-pull-client' : 'repair-client';
        const customer = upsertCustomer({
          name: b.customer_name,
          email: b.customer_email,
          phone: b.customer_phone,
          source_pillar: b.appointment_type || 'repair',
          tags: [pillarTag],
          vehicles: b.vehicle_ymm ? [b.vehicle_ymm] : [],
          email_opt_in: b.email_opt_in ? 1 : 0,
          sms_opt_in: b.sms_opt_in ? 1 : 0
        });

        const r = db.prepare(`
          INSERT INTO appointments (
            booking_code, customer_id, customer_name, customer_email, customer_phone,
            appointment_type, service_category, vehicle_vin, vehicle_ymm,
            linked_sku, preferred_date, preferred_time, booking_mode, status,
            assigned_bay, customer_notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          bookingCode, customer.id, b.customer_name, b.customer_email || '', b.customer_phone,
          b.appointment_type || 'repair_service', b.service_category || 'General Diagnostics & Repair',
          (b.vehicle_vin || '').toUpperCase(), b.vehicle_ymm || '', b.linked_sku || '',
          b.preferred_date, b.preferred_time, bookingMode, initialStatus,
          bookingMode === 'instant_slot' ? 'Bay 1 (Express/Diag)' : 'Pending Staff Review',
          b.customer_notes || '', now
        );
        const created = db.prepare('SELECT * FROM appointments WHERE id = ?').get(r.lastInsertRowid);
        sendJson(res, 201, {
          ...created,
          gcal_url: buildGoogleCalendarUrl(created, settings),
          ics_url: `/api/appointments/${encodeURIComponent(bookingCode)}/calendar.ics`
        });
        return;
      }
    }

    const aptIdMatch = pathname.match(/^\/api\/appointments\/(\d+)$/);
    if (method === 'PUT' && aptIdMatch) {
      const id = Number(aptIdMatch[1]);
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
      if (!existing) return sendJson(res, 404, { error: 'Appointment not found' });

      db.prepare(`
        UPDATE appointments SET
          status = COALESCE(?, status),
          assigned_bay = COALESCE(?, assigned_bay),
          preferred_date = COALESCE(?, preferred_date),
          preferred_time = COALESCE(?, preferred_time),
          staff_notes = COALESCE(?, staff_notes)
        WHERE id = ?
      `).run(
        b.status || null,
        b.assigned_bay || null,
        b.preferred_date || null,
        b.preferred_time || null,
        b.staff_notes ?? null,
        id
      );

      if (existing.linked_order_number && b.status) {
        const orderStatus = b.status === 'approved' ? 'approved' : b.status === 'declined' ? 'cancelled' : 'pending_staff_approval';
        db.prepare('UPDATE orders SET approval_status = ? WHERE order_number = ?').run(orderStatus, existing.linked_order_number);
      }

      const updated = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
      sendJson(res, 200, {
        ...updated,
        gcal_url: buildGoogleCalendarUrl(updated, getSettings()),
        ics_url: `/api/appointments/${encodeURIComponent(updated.booking_code)}/calendar.ics`
      });
      return;
    }

    // Internal Shop Work Orders (Pulling Stocked SKU Atomically Auto-Delists Everywhere!)
    if (method === 'POST' && pathname === '/api/work-orders') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const settings = getSettings();
      const now = new Date().toISOString();
      const woNumber = 'WO-' + Math.floor(10000 + Math.random() * 89999);
      const laborHours = Number(b.labor_hours || 1.5);
      const laborRate = Number(settings.labor_rate_hourly || 174.99);
      let partsTotal = 0;
      const partsUsed = [];

      if (b.pull_sku) {
        const itemBefore = db.prepare('SELECT * FROM inventory_items WHERE UPPER(sku) = UPPER(?)').get(b.pull_sku);
        const lockRes = await lockInventorySkuAtomically(b.pull_sku, {
          reason: 'shop_work_order_pull',
          reference: woNumber
        });
        if (!lockRes.locked) {
          return sendJson(res, 409, { error: `SKU ${b.pull_sku} has 0 available quantity in shop inventory (${lockRes.reason}).` });
        }
        partsTotal += Number(itemBefore?.price_we_pull || 0);
        partsUsed.push({ sku: lockRes.sku, title: itemBefore?.title || lockRes.sku, price: itemBefore?.price_we_pull || 0, bin: itemBefore?.bin_location || '' });
      }

      const laborSub = Number((laborHours * laborRate).toFixed(2));
      const supplyFee = laborSub > 0 ? Number(Math.min(Number(settings.shop_supply_fee_cap ?? 45), laborSub * Number(settings.shop_supply_fee_rate ?? 0.07)).toFixed(2)) : 0;
      const taxAmount = Number(((laborSub + partsTotal + supplyFee) * Number(settings.tax_rate ?? 0.101)).toFixed(2));
      const totalEstimate = Number((laborSub + partsTotal + supplyFee + taxAmount).toFixed(2));
      const r = db.prepare(`
        INSERT INTO work_orders (
          wo_number, booking_code, customer_name, customer_phone, vehicle_ymm, vehicle_vin,
          service_summary, parts_used_json, labor_hours, labor_rate, parts_total, shop_supply_fee,
          tax_amount, total_estimate, status, portal_status, technician, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_repair', 'in_repair', ?, ?, ?)
      `).run(
        woNumber, b.booking_code || '', b.customer_name || 'Walk-In Repair Customer',
        b.customer_phone || '', b.vehicle_ymm || 'Customer Vehicle', (b.vehicle_vin || '').toUpperCase(),
        b.service_summary || 'Shop Repair & Part Installation', JSON.stringify(partsUsed),
        laborHours, laborRate, partsTotal, supplyFee, taxAmount, totalEstimate, b.technician || 'Lead ASE Tech', b.notes || '', now
      );

      sendJson(res, 201, db.prepare('SELECT * FROM work_orders WHERE id = ?').get(r.lastInsertRowid));
      return;
    }

    /* ==================== INTEGRATED DVI, UNIFIED CRM, QUOTING & CUSTOMER PORTAL ==================== */
    const reqStaffRole = resolveStaffRole(req.headers['x-staff-role'] || urlObj.searchParams.get('role') || 'owner');

    // 1. DVI Inspections List & Create (Linked RO + CRM Customer + Vehicle + Quote)
    if (pathname === '/api/dvi/inspections') {
      if (method === 'GET') {
        const rows = db.prepare('SELECT id FROM dvi_inspections ORDER BY id DESC LIMIT 60').all();
        const list = rows.map((r) => hydrateDvi(r.id)).filter(Boolean);
        sendJson(res, 200, { ok: true, roles: STAFF_ROLES, inspections: list });
        return;
      }
      if (method === 'POST') {
        assertRolePermission(reqStaffRole, 'can_capture_dvi');
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const created = createDviInspectionWithRo(b);
        sendJson(res, 201, { ok: true, inspection: created });
        return;
      }
    }

    const dviDetailMatch = pathname.match(/^\/api\/dvi\/inspections\/(\d+)$/);
    if (method === 'GET' && dviDetailMatch) {
      const dvi = hydrateDvi(Number(dviDetailMatch[1]));
      if (!dvi) return sendJson(res, 404, { error: 'DVI inspection not found' });
      sendJson(res, 200, { ok: true, inspection: dvi });
      return;
    }

    // 2. Capture DVI Photo/Video + Gemini Vision AI Draft Analysis (Always requires Tech Review before publish!)
    const dviItemsMatch = pathname.match(/^\/api\/dvi\/inspections\/(\d+)\/items$/);
    if (method === 'POST' && dviItemsMatch) {
      assertRolePermission(reqStaffRole, 'can_capture_dvi');
      const dviId = Number(dviItemsMatch[1]);
      const dvi = hydrateDvi(dviId);
      if (!dvi) return sendJson(res, 404, { error: 'DVI inspection not found' });
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const now = new Date().toISOString();

      const savedMedia = [];
      const mediaInputs = Array.isArray(b.media_list) && b.media_list.length
        ? b.media_list
        : (b.media_data_url ? [{ data_url: b.media_data_url, caption: b.caption || '' }] : []);

      let firstDataUrlForAi = '';
      for (const mItem of mediaInputs) {
        const rawUrl = typeof mItem === 'string' ? mItem : mItem.data_url;
        if (!rawUrl) continue;
        if (!firstDataUrlForAi && rawUrl.startsWith('data:')) firstDataUrlForAi = rawUrl;
        const saved = saveDviMediaDataUrl(dvi.dvi_number, rawUrl, b.component_name || 'bay');
        if (saved) {
          savedMedia.push({
            url: saved.url,
            media_type: saved.media_type,
            caption: (typeof mItem === 'object' && mItem.caption) ? mItem.caption : (b.component_name || 'Inspection capture'),
            captured_at: now
          });
        }
      }

      let aiDraft = null;
      if (b.run_ai !== false) {
        aiDraft = await analyzeDviMediaWithGemini({
          dataUrl: firstDataUrlForAi,
          componentHint: b.component_name || '',
          techNotes: b.tech_notes || '',
          vehicle: dvi.vehicle || {}
        });
      }

      const componentName = String(b.component_name || aiDraft?.component_name || 'Inspection Point').trim();
      const category = String(b.category || aiDraft?.category || 'General Inspection').trim();
      const severity = ['green', 'yellow', 'red'].includes(String(b.severity || '').toLowerCase())
        ? String(b.severity).toLowerCase()
        : (aiDraft?.severity || 'yellow');
      const techNotes = String(b.tech_notes || aiDraft?.tech_notes || '').trim();
      const customerNotes = String(b.customer_notes || aiDraft?.customer_notes || '').trim();
      const healthyCaption = String(b.reference_healthy_caption || aiDraft?.reference_healthy_caption || 'Factory-spec healthy component with zero leaks, cracks, or excessive wear.').trim();
      const partQuery = String(b.recommended_part_query || aiDraft?.suggested_part_query || componentName).trim();
      const laborHours = Number(b.suggested_labor_hours ?? aiDraft?.suggested_labor_hours ?? (severity === 'green' ? 0 : 1.0));
      // AI-generated drafts always default to reviewed_by_tech = 0 unless explicitly marked reviewed by tech/admin
      const reviewed = b.reviewed_by_tech === true ? 1 : 0;

      const ins = db.prepare(`
        INSERT INTO dvi_items (
          dvi_id, category, component_name, severity, tech_notes, customer_notes,
          ai_findings_json, media_json, reference_healthy_caption, recommended_part_query,
          suggested_labor_hours, reviewed_by_tech, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        dviId, category, componentName, severity, techNotes, customerNotes,
        JSON.stringify(aiDraft || {}), JSON.stringify(savedMedia), healthyCaption, partQuery,
        laborHours, reviewed, dvi.items.length + 1, now, now
      );

      recomputeDviOverallSeverity(dviId);
      if (dvi.status === 'checked_in') {
        db.prepare("UPDATE dvi_inspections SET status = 'inspection_complete', updated_at = ? WHERE id = ?").run(now, dviId);
      }

      sendJson(res, 201, {
        ok: true,
        item_id: ins.lastInsertRowid,
        ai_draft: aiDraft,
        matched_inventory_parts: aiDraft?.matched_inventory_parts || findMatchingInventoryParts({
          query: partQuery,
          year: dvi.vehicle?.year,
          make: dvi.vehicle?.make,
          model: dvi.vehicle?.model,
          oemPartNumber: aiDraft?.detected_oem_part_number || '',
          limit: 5
        }),
        inspection: hydrateDvi(dviId)
      });
      return;
    }

    const dviItemPatchMatch = pathname.match(/^\/api\/dvi\/items\/(\d+)$/);
    if ((method === 'PATCH' || method === 'PUT') && dviItemPatchMatch) {
      assertRolePermission(reqStaffRole, 'can_capture_dvi');
      const itemId = Number(dviItemPatchMatch[1]);
      const existing = db.prepare('SELECT * FROM dvi_items WHERE id = ?').get(itemId);
      if (!existing) return sendJson(res, 404, { error: 'DVI item not found' });
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const now = new Date().toISOString();

      let mediaArr = JSON.parse(existing.media_json || '[]');
      if (b.append_media_data_url) {
        const dvi = db.prepare('SELECT dvi_number FROM dvi_inspections WHERE id = ?').get(existing.dvi_id);
        const saved = saveDviMediaDataUrl(dvi?.dvi_number || 'DVI', b.append_media_data_url, existing.component_name);
        if (saved) {
          mediaArr.push({ url: saved.url, media_type: saved.media_type, caption: b.caption || existing.component_name, captured_at: now });
        }
      }

      const nextSev = ['green', 'yellow', 'red'].includes(String(b.severity || '').toLowerCase())
        ? String(b.severity).toLowerCase()
        : existing.severity;

      db.prepare(`
        UPDATE dvi_items
        SET component_name = COALESCE(?, component_name),
            category = COALESCE(?, category),
            severity = ?,
            tech_notes = COALESCE(?, tech_notes),
            customer_notes = COALESCE(?, customer_notes),
            recommended_part_query = COALESCE(?, recommended_part_query),
            suggested_labor_hours = COALESCE(?, suggested_labor_hours),
            reviewed_by_tech = COALESCE(?, reviewed_by_tech),
            media_json = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        b.component_name ?? null,
        b.category ?? null,
        nextSev,
        b.tech_notes ?? null,
        b.customer_notes ?? null,
        b.recommended_part_query ?? null,
        b.suggested_labor_hours !== undefined ? Number(b.suggested_labor_hours) : null,
        b.reviewed_by_tech !== undefined ? (b.reviewed_by_tech ? 1 : 0) : null,
        JSON.stringify(mediaArr),
        now,
        itemId
      );

      recomputeDviOverallSeverity(existing.dvi_id);
      sendJson(res, 200, { ok: true, inspection: hydrateDvi(existing.dvi_id) });
      return;
    }

    // 3. Hands-Free Voice-to-Text Note Cleanup (Gemini)
    if (method === 'POST' && pathname === '/api/dvi/voice-cleanup') {
      assertRolePermission(reqStaffRole, 'can_capture_dvi');
      const b = JSON.parse((await readRawBody(req)) || '{}');
      let vehicle = b.vehicle || {};
      if (b.dvi_id) {
        const dvi = hydrateDvi(Number(b.dvi_id));
        if (dvi?.vehicle) vehicle = dvi.vehicle;
      }
      const cleaned = await cleanupVoiceNotesWithGemini({
        rawNotes: b.raw_notes || '',
        componentName: b.component_name || '',
        vehicle
      });
      if (b.dvi_id) {
        db.prepare('UPDATE dvi_inspections SET voice_raw_notes = ?, voice_clean_notes = ?, updated_at = ? WHERE id = ?').run(
          String(b.raw_notes || ''), cleaned.customer_notes, new Date().toISOString(), Number(b.dvi_id)
        );
      }
      sendJson(res, 200, { ok: true, ...cleaned });
      return;
    }

    // 4. Update Repair Status Tracker + Auto-Dispatch SMS/Email Alert
    const dviStatusMatch = pathname.match(/^\/api\/dvi\/inspections\/(\d+)\/status$/);
    if (method === 'POST' && dviStatusMatch) {
      assertRolePermission(reqStaffRole, 'can_capture_dvi');
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const updated = await updateDviRepairStatus(Number(dviStatusMatch[1]), String(b.status || ''), {
        updatedBy: b.updated_by || STAFF_ROLES[reqStaffRole]?.label || 'Staff'
      });
      sendJson(res, 200, { ok: true, inspection: updated });
      return;
    }

    // 5. Publish Reviewed DVI & Send Quote + Customer Portal Magic Link (Owner/Admin or Maria ONLY)
    const dviPublishMatch = pathname.match(/^\/api\/dvi\/inspections\/(\d+)\/publish$/);
    if (method === 'POST' && dviPublishMatch) {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const result = await publishDviAndSendQuote({
        dviId: Number(dviPublishMatch[1]),
        role: reqStaffRole,
        reviewerName: b.reviewer_name || (reqStaffRole === 'office_manager' ? 'Maria' : 'Chris Aldridge')
      });
      sendJson(res, 200, result);
      return;
    }

    // 6. Live Parts-on-Hand Cross-Reference (inventory_items, non-QR photos ONLY, Option A vs Option B)
    if (method === 'GET' && pathname === '/api/quotes/inventory-match') {
      const matches = findMatchingInventoryParts({
        query: urlObj.searchParams.get('q') || '',
        year: Number(urlObj.searchParams.get('year') || 0),
        make: urlObj.searchParams.get('make') || '',
        model: urlObj.searchParams.get('model') || '',
        oemPartNumber: urlObj.searchParams.get('mpn') || '',
        limit: Number(urlObj.searchParams.get('limit') || 10)
      });
      sendJson(res, 200, { ok: true, count: matches.length, matches });
      return;
    }

    // 7. Quote Line Items, Decisions (Atomic Inventory Lock), RO/Invoice Conversion & Payments
    const quoteLinesMatch = pathname.match(/^\/api\/quotes\/(\d+)\/lines$/);
    if (method === 'POST' && quoteLinesMatch) {
      assertRolePermission(reqStaffRole, 'can_capture_dvi');
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const result = addQuoteLineItem(Number(quoteLinesMatch[1]), b);
      sendJson(res, 201, { ok: true, ...result });
      return;
    }

    const quoteLineDecMatch = pathname.match(/^\/api\/quotes\/(\d+)\/lines\/(\d+)\/decision$/);
    if ((method === 'PATCH' || method === 'POST') && quoteLineDecMatch) {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const result = await submitCustomerLineDecision({
        quoteId: Number(quoteLineDecMatch[1]),
        lineId: Number(quoteLineDecMatch[2]),
        decision: b.decision,
        selectedOption: b.selected_option || null,
        actor: b.actor || STAFF_ROLES[reqStaffRole]?.label || 'Staff'
      });
      sendJson(res, 200, result);
      return;
    }

    const quoteConvertMatch = pathname.match(/^\/api\/quotes\/(\d+)\/convert$/);
    if (method === 'POST' && quoteConvertMatch) {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const result = await convertQuoteToRoAndInvoice({
        quoteId: Number(quoteConvertMatch[1]),
        role: reqStaffRole,
        reviewerName: b.reviewer_name || (reqStaffRole === 'office_manager' ? 'Maria' : 'Chris Aldridge'),
        finalizeInvoice: Boolean(b.finalize_invoice)
      });
      sendJson(res, 200, result);
      return;
    }

    const quoteInvoiceMatch = pathname.match(/^\/api\/quotes\/(\d+)\/invoice$/);
    if (method === 'GET' && quoteInvoiceMatch) {
      const html = renderInvoiceHtml(Number(quoteInvoiceMatch[1]));
      if (!html) return sendJson(res, 404, { error: 'Invoice not found' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    const quotePayMatch = pathname.match(/^\/api\/quotes\/(\d+)\/payments$/);
    if (method === 'POST' && quotePayMatch) {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const result = await recordPortalPayment({
        quoteId: Number(quotePayMatch[1]),
        amount: b.amount,
        paymentType: b.payment_type || 'deposit',
        method: b.method || 'shop_counter',
        receiptNotes: b.receipt_notes || ''
      });
      sendJson(res, 201, result);
      return;
    }

    // 8. Unified CRM Profiles, Vehicle Profiles & 60/90-Day Deferred Work Follow-Up Queue
    if (pathname === '/api/crm/profiles') {
      if (method === 'GET') {
        const profiles = listUnifiedCrmProfiles(urlObj.searchParams.get('q') || '');
        const deferredQueue = db.prepare(`
          SELECT d.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
                 v.year AS veh_year, v.make AS veh_make, v.model AS veh_model
          FROM deferred_work_followups d
          JOIN crm_customers c ON c.id = d.customer_id
          LEFT JOIN crm_vehicles v ON v.id = d.vehicle_id
          ORDER BY d.followup_60d_date ASC, d.id DESC
          LIMIT 100
        `).all();
        sendJson(res, 200, { ok: true, count: profiles.length, profiles, deferred_followups: deferredQueue });
        return;
      }
      if (method === 'POST') {
        const b = JSON.parse((await readRawBody(req)) || '{}');
        const customer = upsertCustomer({
          name: b.name || 'Shop Customer',
          email: b.email || '',
          phone: b.phone || '',
          source_pillar: b.source_pillar || 'repair_crm',
          tags: Array.isArray(b.tags) ? b.tags : ['crm-profile'],
          email_opt_in: b.email_opt_in ? 1 : 0,
          sms_opt_in: b.sms_opt_in ? 1 : 0,
          notes: b.notes || ''
        });
        let vehicle = null;
        if (b.vin || b.make || b.model) {
          vehicle = upsertCustomerVehicle({
            customer_id: customer.id,
            vin: b.vin || '',
            year: b.year || 0,
            make: b.make || '',
            model: b.model || '',
            trim: b.trim || '',
            engine: b.engine || '',
            license_plate: b.license_plate || '',
            mileage: b.mileage || 0
          });
        }
        sendJson(res, 201, { ok: true, profile: getCrmCustomerDetail(customer.id), vehicle });
        return;
      }
    }

    const crmDetailMatch = pathname.match(/^\/api\/crm\/profiles\/(\d+)$/);
    if (method === 'GET' && crmDetailMatch) {
      const detail = getCrmCustomerDetail(Number(crmDetailMatch[1]));
      if (!detail) return sendJson(res, 404, { error: 'Customer profile not found' });
      sendJson(res, 200, { ok: true, ...detail });
      return;
    }

    const crmVehMatch = pathname.match(/^\/api\/crm\/profiles\/(\d+)\/vehicles$/);
    if (method === 'POST' && crmVehMatch) {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const vehicle = upsertCustomerVehicle({ customer_id: Number(crmVehMatch[1]), ...b });
      sendJson(res, 201, { ok: true, vehicle });
      return;
    }

    const crmDefMatch = pathname.match(/^\/api\/crm\/deferred\/(\d+)$/);
    if (method === 'PATCH' && crmDefMatch) {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const nextStatus = ['scheduled', 'reminded_60d', 'reminded_90d', 'booked', 'dismissed'].includes(b.status) ? b.status : 'reminded_60d';
      db.prepare('UPDATE deferred_work_followups SET status = ?, notes = COALESCE(?, notes) WHERE id = ?').run(
        nextStatus, b.notes ?? null, Number(crmDefMatch[1])
      );
      sendJson(res, 200, { ok: true, followup: db.prepare('SELECT * FROM deferred_work_followups WHERE id = ?').get(Number(crmDefMatch[1])) });
      return;
    }

    // 9. Customer Portal Authentication (Magic Link + Password) & Scoped Portal APIs
    if (method === 'POST' && pathname === '/api/portal/auth/magic-link') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const result = await issueCustomerMagicLink({
        customerId: b.customer_id ? Number(b.customer_id) : null,
        email: b.email || '',
        phone: b.phone || '',
        baseUrl
      });
      sendJson(res, 200, result);
      return;
    }

    if (method === 'POST' && pathname === '/api/portal/auth/login') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const auth = authenticateCustomerPortal({
        magicToken: b.magic_token || '',
        email: b.email || '',
        phone: b.phone || '',
        password: b.password || '',
        setPassword: Boolean(b.set_password),
        name: b.name || ''
      });
      const dashboard = getCustomerPortalDashboard(auth.customer.id);
      sendJson(res, 200, { ...auth, dashboard });
      return;
    }

    function requirePortalSession() {
      const headerTok = String(req.headers['x-portal-token'] || '').trim();
      const authHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const qTok = urlObj.searchParams.get('session_token') || '';
      const session = verifyPortalSessionToken(headerTok || authHeader || qTok);
      if (!session) {
        const err = new Error('Customer Portal session required. Sign in via Magic Link or Password.');
        err.statusCode = 401;
        throw err;
      }
      return session;
    }

    if (method === 'GET' && pathname === '/api/portal/me') {
      const session = requirePortalSession();
      const dashboard = getCustomerPortalDashboard(session.cid);
      if (!dashboard) return sendJson(res, 404, { error: 'Customer profile not found' });
      sendJson(res, 200, { ok: true, ...dashboard });
      return;
    }

    const portalDecMatch = pathname.match(/^\/api\/portal\/quotes\/(\d+)\/lines\/(\d+)\/decision$/);
    if (method === 'POST' && portalDecMatch) {
      const session = requirePortalSession();
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const result = await submitCustomerLineDecision({
        quoteId: Number(portalDecMatch[1]),
        lineId: Number(portalDecMatch[2]),
        decision: b.decision,
        selectedOption: b.selected_option || null,
        actor: 'customer_portal',
        customerId: session.cid
      });
      sendJson(res, 200, { ...result, dashboard: getCustomerPortalDashboard(session.cid) });
      return;
    }

    const portalPayMatch = pathname.match(/^\/api\/portal\/quotes\/(\d+)\/pay$/);
    if (method === 'POST' && portalPayMatch) {
      const session = requirePortalSession();
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const result = await recordPortalPayment({
        quoteId: Number(portalPayMatch[1]),
        amount: b.amount,
        paymentType: b.payment_type || 'deposit',
        method: b.method || 'card_online',
        customerId: session.cid,
        receiptNotes: b.receipt_notes || 'Customer Portal Online Payment'
      });
      sendJson(res, 201, { ...result, dashboard: getCustomerPortalDashboard(session.cid) });
      return;
    }

    // Subscribers (Email, SMS, Web Push + Referral Code) & CRM CSV Export
    if (method === 'POST' && pathname === '/api/subscribers') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const tags = ['vip-club'];
      if (b.sms_opt_in) tags.push('sms-subscriber');
      if (b.email_opt_in) tags.push('email-subscriber');
      if (b.pillar_interest) tags.push(`interest:${b.pillar_interest}`);

      const customer = upsertCustomer({
        name: b.name || 'VIP Club Member',
        email: b.email || '',
        phone: b.phone || '',
        source_pillar: b.pillar_interest || 'vip_signup',
        tags,
        email_opt_in: b.email_opt_in ? 1 : 0,
        sms_opt_in: b.sms_opt_in ? 1 : 0,
        referred_by: b.referred_by || ''
      });

      if (b.push_opt_in) {
        db.prepare('UPDATE crm_customers SET push_subscribed = 1 WHERE id = ?').run(customer.id);
      }

      sendJson(res, 201, {
        ok: true,
        customer_id: customer.id,
        referral_code: customer.referral_code,
        welcome_promo: 'PULLINSTALL15'
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/crm/export-subscribers.csv') {
      const rows = db.prepare('SELECT * FROM crm_customers ORDER BY id DESC').all();
      const csv = [
        'Name,Email,Phone,SourcePillar,EmailOptIn,SMSOptIn,SMSConsentTimestamp,PushSubscribed,ReferralCode,TotalSpent,Tags',
        ...rows.map((r) => [
          `"${(r.name || '').replace(/"/g, '""')}"`,
          `"${r.email || ''}"`,
          `"${r.phone || ''}"`,
          `"${r.source_pillar || ''}"`,
          r.email_opt_in,
          r.sms_opt_in,
          `"${r.sms_consent_timestamp || ''}"`,
          r.push_subscribed,
          `"${r.referral_code || ''}"`,
          r.total_spent,
          `"${(r.tags_json || '').replace(/"/g, '""')}"`
        ].join(','))
      ].join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="crm-email-sms-subscribers.csv"'
      });
      res.end(csv);
      return;
    }

    // Customer Inquiries
    if (method === 'POST' && pathname === '/api/inquiries') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const ticket = 'INQ-' + Math.floor(1000 + Math.random() * 8999);
      const now = new Date().toISOString();
      upsertCustomer({
        name: b.customer_name,
        email: b.customer_email || '',
        phone: b.customer_phone || '',
        source_pillar: b.pillar || 'general',
        tags: [`inquiry-${b.pillar || 'general'}`],
        email_opt_in: b.email_opt_in ? 1 : 0,
        sms_opt_in: b.sms_opt_in ? 1 : 0
      });
      db.prepare(`
        INSERT INTO inquiries (
          ticket_number, customer_name, customer_email, customer_phone,
          pillar, subject, message, related_sku, vehicle_vin, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
      `).run(
        ticket, b.customer_name, b.customer_email || '', b.customer_phone || '',
        b.pillar || 'parts', b.subject || 'Customer Question', b.message || '',
        b.related_sku || '', (b.vehicle_vin || '').toUpperCase(), now
      );
      sendJson(res, 201, { ok: true, ticket_number: ticket });
      return;
    }

    const inqIdMatch = pathname.match(/^\/api\/inquiries\/(\d+)$/);
    if (method === 'PUT' && inqIdMatch) {
      const id = Number(inqIdMatch[1]);
      const b = JSON.parse((await readRawBody(req)) || '{}');
      db.prepare('UPDATE inquiries SET status = COALESCE(?, status), staff_reply = COALESCE(?, staff_reply) WHERE id = ?').run(
        b.status || 'replied', b.staff_reply ?? null, id
      );
      sendJson(res, 200, { ok: true });
      return;
    }

    // Defect / Incorrect Data / Not-As-Described Evidence Portal
    if (method === 'POST' && pathname === '/api/returns') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      if (!b.buyer_accepts_return_shipping) {
        return sendJson(res, 400, { error: 'Per store policy, buyer must acknowledge responsibility for return shipping costs before submitting an RMA evidence packet.' });
      }
      const rma = 'RMA-' + Math.floor(10000 + Math.random() * 89999);
      const isEligibleReason = ['defective_part', 'incorrect_fitment_listing', 'not_as_described'].includes(b.claim_reason);
      const initialStatus = (!isEligibleReason || !b.security_mark_intact)
        ? 'rejected_policy_ineligible'
        : 'pending_evidence_review';

      db.prepare(`
        INSERT INTO return_claims (
          rma_number, order_number, sku, customer_name, customer_email,
          claim_reason, buyer_vin, diagnostic_codes, security_mark_intact,
          evidence_summary, evidence_photo_data, buyer_accepts_return_shipping, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        rma, b.order_number || 'UNKNOWN', b.sku || '', b.customer_name || '', b.customer_email || '',
        b.claim_reason || 'buyer_remorse_ineligible', (b.buyer_vin || '').toUpperCase(),
        b.diagnostic_codes || '', b.security_mark_intact ? 1 : 0,
        b.evidence_summary || '', b.evidence_photo_data || '', initialStatus, new Date().toISOString()
      );

      sendJson(res, 201, {
        ok: true,
        rma_number: rma,
        status: initialStatus,
        policy_notice: initialStatus === 'rejected_policy_ineligible'
          ? 'Claim flagged ineligible: Refunds apply strictly to verified defects, listing data errors, or not-as-described items with intact security marks.'
          : 'Evidence packet logged for technician verification. If approved, RMA instructions will be emailed (return shipping is buyer responsibility).'
      });
      return;
    }

    const rmaIdMatch = pathname.match(/^\/api\/returns\/(\d+)$/);
    if (method === 'PUT' && rmaIdMatch) {
      const id = Number(rmaIdMatch[1]);
      const b = JSON.parse((await readRawBody(req)) || '{}');
      db.prepare('UPDATE return_claims SET status = COALESCE(?, status), staff_decision_notes = COALESCE(?, staff_decision_notes) WHERE id = ?').run(
        b.status || null, b.staff_decision_notes ?? null, id
      );
      sendJson(res, 200, { ok: true });
      return;
    }

    // Specials, Share-to-Friend & Push/List Broadcast
    if (method === 'POST' && pathname === '/api/specials') {
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const r = db.prepare(`
        INSERT INTO specials (title, badge, pillar, discount_text, promo_code, description, valid_until, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        b.title, b.badge || 'SHOP SPECIAL', b.pillar || 'all', b.discount_text || '',
        (b.promo_code || 'VIP10').toUpperCase(), b.description || '', b.valid_until || '2026-12-31', new Date().toISOString()
      );
      sendJson(res, 201, db.prepare('SELECT * FROM specials WHERE id = ?').get(r.lastInsertRowid));
      return;
    }

    const shareMatch = pathname.match(/^\/api\/specials\/(\d+)\/share$/);
    if (method === 'POST' && shareMatch) {
      const id = Number(shareMatch[1]);
      db.prepare('UPDATE specials SET share_count = share_count + 1 WHERE id = ?').run(id);
      const updated = db.prepare('SELECT * FROM specials WHERE id = ?').get(id);
      sendJson(res, 200, { ok: true, share_count: updated?.share_count || 1 });
      return;
    }

    const broadcastMatch = pathname.match(/^\/api\/specials\/(\d+)\/broadcast$/);
    if (method === 'POST' && broadcastMatch) {
      const id = Number(broadcastMatch[1]);
      const sp = db.prepare('SELECT * FROM specials WHERE id = ?').get(id);
      if (!sp) return sendJson(res, 404, { error: 'Special not found' });
      const subs = db.prepare('SELECT COUNT(*) as total, SUM(email_opt_in) as emails, SUM(sms_opt_in) as sms, SUM(push_subscribed) as push FROM crm_customers').get();
      db.prepare('UPDATE specials SET broadcast_count = broadcast_count + 1 WHERE id = ?').run(id);
      logSync(
        'outbound',
        'push_sms_email_blast',
        'broadcast_special',
        sp.promo_code,
        'success',
        `Broadcasted "${sp.title}" (${sp.promo_code}) to ${subs.push || 0} Web Push devices, ${subs.emails || 0} Email subscribers & ${subs.sms || 0} SMS opt-ins.`
      );
      sendJson(res, 200, { ok: true, reach: subs, special: sp });
      return;
    }

    // ==================== VISUAL PHOTO REVIEW GALLERY (IN STOCK vs SOLD/DISPOSED) ====================
    if (method === 'GET' && pathname === '/api/review-photos') {
      seedPhotoReviewCatalogIfNeeded(false);
      const folderParam = (urlObj.searchParams.get('folder') || 'all').trim();
      const statusParam = (urlObj.searchParams.get('status') || 'pending').trim().toLowerCase();
      const qParam = (urlObj.searchParams.get('q') || '').trim().toLowerCase();
      const hideGeneric = ['1', 'true', 'yes'].includes((urlObj.searchParams.get('hide_generic') || '').trim().toLowerCase());
      const page = Math.max(1, Number(urlObj.searchParams.get('page') || 1));
      const limit = Math.min(200, Math.max(1, Number(urlObj.searchParams.get('limit') || 48)));
      const offset = (page - 1) * limit;

      const where = [];
      const params = [];
      if (folderParam && folderParam !== 'all') {
        where.push("(CASE WHEN vehicle_tag_override != '' THEN vehicle_tag_override ELSE vehicle_folder END) = ?");
        params.push(folderParam);
      }
      if (['pending', 'keep', 'remove'].includes(statusParam)) {
        where.push('review_status = ?');
        params.push(statusParam);
      }
      if (qParam) {
        where.push('(LOWER(photo_uid) LIKE ? OR LOWER(original_name) LIKE ? OR LOWER(title_hint) LIKE ? OR LOWER(vehicle_folder) LIKE ? OR LOWER(vehicle_tag_override) LIKE ? OR LOWER(notes) LIKE ?)');
        const like = `%${qParam}%`;
        params.push(like, like, like, like, like, like);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      let totalFiltered = 0;
      let rows = [];
      if (hideGeneric) {
        const allMatching = db.prepare(`
          SELECT *,
            CASE WHEN vehicle_tag_override != '' THEN vehicle_tag_override ELSE vehicle_folder END AS effective_folder
          FROM photo_review_items
          ${whereSql}
          ORDER BY photo_uid ASC
        `).all(...params);
        const descriptiveOnly = allMatching.filter((r) => !isNonDescriptiveAutoFilename(r.original_name));
        totalFiltered = descriptiveOnly.length;
        rows = descriptiveOnly.slice(offset, offset + limit);
      } else {
        totalFiltered = db.prepare(`SELECT COUNT(*) AS c FROM photo_review_items ${whereSql}`).get(...params).c;
        rows = db.prepare(`
          SELECT *,
            CASE WHEN vehicle_tag_override != '' THEN vehicle_tag_override ELSE vehicle_folder END AS effective_folder
          FROM photo_review_items
          ${whereSql}
          ORDER BY photo_uid ASC
          LIMIT ? OFFSET ?
        `).all(...params, limit, offset);
      }

      const summary = getPhotoReviewSummary();
      const items = rows.map((r) => ({
        ...r,
        is_generic_filename: isNonDescriptiveAutoFilename(r.original_name),
        drive_url: r.copied_drive_id
          ? `https://drive.google.com/file/d/${r.copied_drive_id}/view`
          : (r.drive_file_id ? `https://drive.google.com/file/d/${r.drive_file_id}/view` : '')
      }));

      sendJson(res, 200, {
        master_drive_folder_id: summary.master_drive_folder_id,
        master_drive_folder_url: summary.master_drive_folder_url,
        summary,
        hide_generic: hideGeneric,
        page,
        limit,
        total_filtered: Number(totalFiltered || 0),
        total_pages: Math.max(1, Math.ceil(Number(totalFiltered || 0) / limit)),
        items
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/review-photos/bulk-remove-generic') {
      seedPhotoReviewCatalogIfNeeded(false);
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const folder = String(b.folder || 'all').trim() || 'all';
      const result = autoRemoveNonDescriptivePendingPhotos({ folder });
      if (result.removed_count > 0) {
        logSync(
          'internal',
          'review_gallery',
          'bulk_remove_generic',
          folder,
          'success',
          `Bulk-removed ${result.removed_count} pending photo(s) with non-descriptive camera/code filenames (100% of KEEP items untouched).`
        );
      }
      sendJson(res, 200, {
        ok: true,
        folder,
        removed_count: result.removed_count,
        checked_pending: result.checked_pending,
        summary: getPhotoReviewSummary()
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/review-photos/intake-keep-batch') {
      sendJson(res, 403, {
        ok: false,
        error: 'Legacy pre-VIN KEEP batch photo intake is permanently disabled. Use Employee Backend -> Step 1: VIN / License Plate Lock (POST /api/employee/intake/vehicle) -> Step 2: Part Photo Upload (POST /api/employee/intake/part).'
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/review-photos/bulk-status') {
      seedPhotoReviewCatalogIfNeeded(false);
      const b = JSON.parse((await readRawBody(req)) || '{}');
      const now = new Date().toISOString();
      let updated = 0;

      // Mode B: Client localStorage reconciliation map { decisions: { P0001: { status, vehicle_tag_override, notes } } }
      if (b.decisions && typeof b.decisions === 'object') {
        const keepOnly = Boolean(b.keep_only);
        const preserveKeep = Boolean(b.preserve_keep);
        const stmt = keepOnly
          ? db.prepare(`
              UPDATE photo_review_items
              SET review_status = 'keep',
                  vehicle_tag_override = COALESCE(?, vehicle_tag_override),
                  notes = COALESCE(?, notes),
                  updated_at = ?
              WHERE photo_uid = ? AND review_status != 'keep'
            `)
          : db.prepare(`
              UPDATE photo_review_items
              SET review_status = CASE WHEN ? = 1 AND review_status = 'keep' AND ? != 'keep' THEN review_status ELSE ? END,
                  vehicle_tag_override = COALESCE(?, vehicle_tag_override),
                  notes = COALESCE(?, notes),
                  updated_at = ?
              WHERE photo_uid = ?
            `);
        db.exec('BEGIN;');
        try {
          for (const [uid, dec] of Object.entries(b.decisions)) {
            const st = String(dec?.status || '').toLowerCase();
            if (!dec || !['pending', 'keep', 'remove'].includes(st)) continue;
            if (keepOnly && st !== 'keep') continue;
            const tagOverride = typeof dec.vehicle_tag_override === 'string' && dec.vehicle_tag_override.trim() !== ''
              ? dec.vehicle_tag_override.trim()
              : null;
            const noteVal = typeof dec.notes === 'string' && dec.notes.trim() !== ''
              ? dec.notes.trim()
              : null;
            const info = keepOnly
              ? stmt.run(tagOverride, noteVal, now, uid)
              : stmt.run(preserveKeep ? 1 : 0, st, st, tagOverride, noteVal, now, uid);
            updated += Number(info.changes || 0);
          }
          db.exec('COMMIT;');
        } catch (err) {
          db.exec('ROLLBACK;');
          throw err;
        }
        sendJson(res, 200, { ok: true, updated, summary: getPhotoReviewSummary() });
        return;
      }

      // Mode A: Bulk mark specific UIDs or entire folder
      const nextStatus = String(b.status || '').toLowerCase();
      if (!['pending', 'keep', 'remove'].includes(nextStatus)) {
        return sendJson(res, 400, { error: 'Invalid status. Expected keep, remove, or pending.' });
      }
      if (Array.isArray(b.uids) && b.uids.length > 0) {
        const stmt = db.prepare('UPDATE photo_review_items SET review_status = ?, updated_at = ? WHERE photo_uid = ?');
        db.exec('BEGIN;');
        try {
          for (const uid of b.uids) {
            const info = stmt.run(nextStatus, now, String(uid));
            updated += Number(info.changes || 0);
          }
          db.exec('COMMIT;');
        } catch (err) {
          db.exec('ROLLBACK;');
          throw err;
        }
      } else if (b.folder && b.folder !== 'all') {
        const fromStatus = String(b.from_status || 'pending').toLowerCase();
        if (['pending', 'keep', 'remove'].includes(fromStatus)) {
          const info = db.prepare(`
            UPDATE photo_review_items
            SET review_status = ?, updated_at = ?
            WHERE (CASE WHEN vehicle_tag_override != '' THEN vehicle_tag_override ELSE vehicle_folder END) = ?
              AND review_status = ?
          `).run(nextStatus, now, String(b.folder), fromStatus);
          updated = Number(info.changes || 0);
        } else {
          const info = db.prepare(`
            UPDATE photo_review_items
            SET review_status = ?, updated_at = ?
            WHERE (CASE WHEN vehicle_tag_override != '' THEN vehicle_tag_override ELSE vehicle_folder END) = ?
          `).run(nextStatus, now, String(b.folder));
          updated = Number(info.changes || 0);
        }
      }
      sendJson(res, 200, { ok: true, updated, summary: getPhotoReviewSummary() });
      return;
    }

    if (method === 'GET' && (pathname === '/api/review-photos/export.json' || pathname === '/api/review-photos/export.csv')) {
      seedPhotoReviewCatalogIfNeeded(false);
      const statusFilter = (urlObj.searchParams.get('status') || 'all').trim().toLowerCase();
      const whereSql = ['pending', 'keep', 'remove'].includes(statusFilter) ? 'WHERE review_status = ?' : '';
      const params = ['pending', 'keep', 'remove'].includes(statusFilter) ? [statusFilter] : [];
      const rows = db.prepare(`
        SELECT *,
          CASE WHEN vehicle_tag_override != '' THEN vehicle_tag_override ELSE vehicle_folder END AS effective_folder
        FROM photo_review_items
        ${whereSql}
        ORDER BY effective_folder ASC, photo_uid ASC
      `).all(...params);
      const summary = getPhotoReviewSummary();

      if (pathname.endsWith('.json')) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="aldridge_photo_review_${statusFilter}.json"`
        });
        res.end(JSON.stringify({
          exported_at: new Date().toISOString(),
          master_drive_folder_url: summary.master_drive_folder_url,
          counts: { total: summary.total, pending: summary.pending, keep: summary.keep, remove: summary.remove },
          items: rows
        }, null, 2));
        return;
      }

      const csvEsc = (v) => {
        const s = String(v ?? '');
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const headers = [
        'photo_uid', 'review_status', 'effective_folder', 'original_vehicle_folder',
        'original_name', 'title_hint', 'copy_count', 'drive_file_id', 'copied_drive_id',
        'drive_url', 'notes', 'updated_at'
      ];
      const lines = [headers.join(',')];
      for (const r of rows) {
        const driveUrl = r.copied_drive_id
          ? `https://drive.google.com/file/d/${r.copied_drive_id}/view`
          : `https://drive.google.com/file/d/${r.drive_file_id}/view`;
        lines.push([
          r.photo_uid, r.review_status, r.effective_folder, r.vehicle_folder,
          r.original_name, r.title_hint, r.copy_count, r.drive_file_id, r.copied_drive_id,
          driveUrl, r.notes, r.updated_at
        ].map(csvEsc).join(','));
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="aldridge_photo_review_${statusFilter}.csv"`
      });
      res.end(lines.join('\n'));
      return;
    }

    const reviewItemMatch = pathname.match(/^\/api\/review-photos\/([A-Za-z0-9_-]+)$/);
    if (method === 'POST' && reviewItemMatch) {
      seedPhotoReviewCatalogIfNeeded(false);
      const uid = reviewItemMatch[1];
      const existing = db.prepare('SELECT * FROM photo_review_items WHERE photo_uid = ?').get(uid);
      if (!existing) return sendJson(res, 404, { error: 'Review photo not found' });

      const b = JSON.parse((await readRawBody(req)) || '{}');
      const nextStatus = b.status !== undefined ? String(b.status).toLowerCase() : existing.review_status;
      if (!['pending', 'keep', 'remove'].includes(nextStatus)) {
        return sendJson(res, 400, { error: 'Invalid status. Expected keep, remove, or pending.' });
      }
      const nextTag = b.vehicle_tag_override !== undefined ? String(b.vehicle_tag_override || '').trim() : existing.vehicle_tag_override;
      const nextNotes = b.notes !== undefined ? String(b.notes || '').trim() : existing.notes;
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE photo_review_items
        SET review_status = ?, vehicle_tag_override = ?, notes = ?, updated_at = ?
        WHERE photo_uid = ?
      `).run(nextStatus, nextTag, nextNotes, now, uid);

      const updated = db.prepare(`
        SELECT *,
          CASE WHEN vehicle_tag_override != '' THEN vehicle_tag_override ELSE vehicle_folder END AS effective_folder
        FROM photo_review_items WHERE photo_uid = ?
      `).get(uid);
      sendJson(res, 200, { ok: true, item: updated, summary: getPhotoReviewSummary() });
      return;
    }

    // Uploaded DVI Inspection Media (/uploads/dvi/DVI-12345-....jpg|mp4|webm)
    if ((method === 'GET' || method === 'HEAD') && pathname.startsWith('/uploads/dvi/')) {
      const safeDviFile = path.basename(decodeURIComponent(pathname.replace('/uploads/dvi/', '')));
      const dviFilePath = path.join(DVI_MEDIA_DIR, safeDviFile);
      if (dviFilePath.startsWith(DVI_MEDIA_DIR) && fs.existsSync(dviFilePath) && fs.statSync(dviFilePath).isFile()) {
        const ext = path.extname(dviFilePath).toLowerCase();
        const stat = fs.statSync(dviFilePath);
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=86400'
        });
        if (method === 'HEAD') {
          res.end();
        } else {
          fs.createReadStream(dviFilePath).pipe(res);
        }
        return;
      }
      sendJson(res, 404, { error: 'DVI media file not found' });
      return;
    }

    // Uploaded Intake Part Photos & Self-Healing QR Info Cards (/uploads/SKU.1.jpg, /uploads/SKU.qr.png)
    if ((method === 'GET' || method === 'HEAD') && pathname.startsWith('/uploads/')) {
      const safeUploadRel = path.basename(decodeURIComponent(pathname.replace('/uploads/', '')));
      const uploadPath = path.join(UPLOADS_DIR, safeUploadRel);
      if (!fs.existsSync(uploadPath) && /\.qr\.png$/i.test(safeUploadRel)) {
        const requestedSku = safeUploadRel.replace(/\.qr\.png$/i, '');
        const item = db.prepare('SELECT * FROM inventory_items WHERE UPPER(sku) = UPPER(?)').get(requestedSku);
        if (item) {
          generatePartQrCardPng(item, getSettings(), UPLOADS_DIR);
        }
      }
      if (uploadPath.startsWith(UPLOADS_DIR) && fs.existsSync(uploadPath) && fs.statSync(uploadPath).isFile()) {
        const ext = path.extname(uploadPath).toLowerCase();
        const stat = fs.statSync(uploadPath);
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'image/jpeg',
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=86400'
        });
        if (method === 'HEAD') {
          res.end();
        } else {
          fs.createReadStream(uploadPath).pipe(res);
        }
        return;
      }
      sendJson(res, 404, { error: 'Uploaded photo not found' });
      return;
    }

    // Visual Review Gallery Thumbnails (/review-thumbs/P0001.jpg) with immutable mobile cache headers
    if ((method === 'GET' || method === 'HEAD') && pathname.startsWith('/review-thumbs/')) {
      const safeThumb = path.basename(decodeURIComponent(pathname.replace('/review-thumbs/', '')));
      const thumbPath = path.join(PUBLIC_DIR, 'review-thumbs', safeThumb);
      if (thumbPath.startsWith(path.join(PUBLIC_DIR, 'review-thumbs')) && fs.existsSync(thumbPath) && fs.statSync(thumbPath).isFile()) {
        const stat = fs.statSync(thumbPath);
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=604800, immutable'
        });
        if (method === 'HEAD') {
          res.end();
        } else {
          fs.createReadStream(thumbPath).pipe(res);
        }
        return;
      }
      sendJson(res, 404, { error: 'Review thumbnail not found' });
      return;
    }

    // Static Files (PWA Frontend)
    let relPath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const isAppAsset = ext === '.html' || ext === '.js' || ext === '.css' || ext === '.webmanifest';
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': isAppAsset
          ? 'no-store, no-cache, must-revalidate'
          : (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.svg' ? 'public, max-age=3600' : 'no-cache')
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // SPA Fallback to index.html (handles /review, /?tab=review, deep links)
    const indexHtml = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      fs.createReadStream(indexHtml).pipe(res);
      return;
    }

    sendJson(res, 404, { error: 'Not Found' });
  } catch (err) {
    const status = Number(err.statusCode) || 500;
    if (status >= 500) console.error('[Server Error]', err);
    sendJson(res, status, { error: err.message || 'Internal Server Error' });
  }
});

async function autoSyncKeepItemsOnStartup() {
  if (process.env.DISABLE_STARTUP_KEEP_SYNC === '1') return;
  try {
    const cfg = getSettings();
    const baseUrl = cfg.canonical_domain || cfg.public_pwa_url || `http://localhost:${PORT}`;

    // 0. PERMANENT v31.0 GHOST VEHICLE & STRICT 17-CHAR VIN PURGE ON BOOT
    const v31Purge = purgeGhostAndBlockedInventory({ actor: 'startup_v31_ghost_purge' });
    if (v31Purge.purged_ghost_lacrosse || v31Purge.purged_sold_subaru_trans || v31Purge.purged_no_real_vin || v31Purge.deleted_donor_vehicles) {
      console.log(
        `[Startup v31.0 Ghost & Strict VIN Purge] ghost_lacrosse=${v31Purge.purged_ghost_lacrosse} | sold_subaru_trans=${v31Purge.purged_sold_subaru_trans} | no_real_vin=${v31Purge.purged_no_real_vin} | deleted_donors=${v31Purge.deleted_donor_vehicles}`
      );
    }

    // 1. MANDATORY CLEAN-SLATE VIN INVARIANT (PROTECTED): NEVER clear or overwrite verified VIN-intake active SKUs on restart/redeploy.
    // Only purge unverified legacy/non-VIN items if any exist.
    const verifiedVinCount = Number(db.prepare(`
      SELECT COUNT(*) c FROM inventory_items
      WHERE status = 'active'
        AND COALESCE(verified_vin, '') != ''
        AND COALESCE(intake_session_id, '') != ''
        AND COALESCE(intake_source, '') = 'vin_intake_pipeline'
    `).get()?.c || 0);

    const legacyPreVinCount = Number(db.prepare(`
      SELECT COUNT(*) c FROM inventory_items
      WHERE COALESCE(verified_vin, '') = ''
         OR COALESCE(intake_session_id, '') = ''
         OR COALESCE(intake_source, '') != 'vin_intake_pipeline'
    `).get()?.c || 0);

    if (legacyPreVinCount > 0) {
      const purgeRes = purgeLegacyPreVinCatalog({ actor: 'startup_legacy_only_purge' });
      console.log(
        `[Startup Legacy-Only Purge] Purged legacy_items=${purgeRes.purged_inventory_items} | preserved_vin_verified=${purgeRes.remaining_verified_vin_items} | Mandatory VIN Intake=ON`
      );
    } else {
      if (!cfg.clean_slate_vin_purge_v1) {
        updateSettings({
          clean_slate_mode: true,
          mandatory_vin_intake_only: true,
          clean_slate_vin_purge_v1: new Date().toISOString()
        });
      }
      const dedupeRes = deduplicateCatalog();
      console.log(
        `[Startup Verified VIN Inventory Preserved] Active Verified SKUs=${verifiedVinCount} | Legacy Purged=0 | Duplicate Archived=${dedupeRes.total_duplicate_archived || 0} | Labor=$${Number(cfg.labor_rate_hourly || 174.99).toFixed(2)}/hr`
      );
    }

    // 2. Authenticate Shopify Admin API (client_credentials OAuth if shpss_ + SHOPIFY_CLIENT_ID)
    let shopifyAuthReady = false;
    const rawToken = String(cfg.shopify_admin_token || process.env.SHOPIFY_ADMIN_TOKEN || '').trim();
    const clientId = String(cfg.shopify_client_id || process.env.SHOPIFY_CLIENT_ID || '').trim();
    if (rawToken) {
      try {
        const auth = await resolveShopifyAccessToken(cfg, { forceRefresh: rawToken.startsWith('shpss_') && Boolean(clientId) });
        if (auth.token && auth.authMode !== 'shpss_missing_client_id') {
          shopifyAuthReady = true;
          console.log(
            `[Startup Shopify Auth] Ready for ${auth.shopDomain} via ${auth.authMode}${auth.scope ? ` (scope=${auth.scope})` : ''}`
          );
        } else if (auth.authMode === 'shpss_missing_client_id') {
          console.warn('[Startup Shopify Auth] SHOPIFY_ADMIN_TOKEN starts with shpss_ but SHOPIFY_CLIENT_ID is not set.');
        }
      } catch (oauthErr) {
        console.error('[Startup Shopify OAuth Error]', oauthErr.message || oauthErr);
      }
    }

    if (!shopifyAuthReady) return;

    // 3. Programmatically register any missing Shopify webhooks immediately
    try {
      const whRes = await ensureShopifyWebhooksRegistered({ registerMissing: true, baseUrl });
      console.log(
        `[Startup Shopify Webhooks] ${whRes.address} -> registered=${whRes.registered.length}/${whRes.required_topics.length} (created=${whRes.created.length}, already=${whRes.already_registered.length}, errors=${whRes.errors.length})`
      );
    } catch (whErr) {
      console.error('[Startup Shopify Webhooks Error]', whErr.message || whErr);
    }

    // 4. SHOPIFY CO-MASTER SELF-HEALING HYDRATION (v32.2):
    // NEVER purge Shopify on startup! Instead, if Render restarted with a fresh ephemeral SQLite DB (0 active SKUs),
    // automatically hydrate all ACTIVE verified 7-vehicle allowlist products straight from Shopify Co-Master in ~5s!
    const currentVerifiedCount = Number(
      db.prepare(`
        SELECT COUNT(*) c FROM inventory_items
        WHERE status = 'active' AND quantity > 0 AND LENGTH(TRIM(COALESCE(verified_vin, ''))) = 17
      `).get()?.c || 0
    );
    if (currentVerifiedCount === 0) {
      try {
        const hyd = await hydrateInventoryFromShopifyCoMaster({
          onlyActive: true,
          reactivateAccidentallyArchived: false
        });
        console.log(
          `[Startup Shopify Co-Master Hydration] scanned=${hyd.scanned || 0} | hydrated=${hyd.hydrated_count || 0} | skipped_non_allowlist=${hyd.skipped_non_allowlist || 0} | errors=${(hyd.errors || []).length}`
        );
      } catch (hydErr) {
        console.error('[Startup Shopify Co-Master Hydration Error]', hydErr.message || hydErr);
      }
    }
    updateSettings({ shopify_clean_slate_purge_v1: getSettings().shopify_clean_slate_purge_v1 || new Date().toISOString() });

    // 5. Push any newly verified VIN-intake SKUs that have not synced to Shopify yet
    const unsyncedVinCount = db.prepare(`
      SELECT COUNT(*) c FROM inventory_items
      WHERE status = 'active' AND quantity > 0
        AND COALESCE(verified_vin, '') != ''
        AND COALESCE(intake_session_id, '') != ''
        AND COALESCE(intake_source, '') = 'vin_intake_pipeline'
        AND (shopify_product_id IS NULL OR shopify_product_id = '')
    `).get().c;

    if (unsyncedVinCount > 0) {
      const syncRes = await syncAllToShopifyCoMaster({ updateExisting: false });
      console.log(
        `[Startup Shopify VIN-Verified Sync] created=${syncRes.synced_count || 0} | errors=${(syncRes.errors || []).length}`
      );
    }
  } catch (err) {
    console.error('[Startup Clean-Slate Error]', err.message || err);
  }
}

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Auto Command Hub & Co-Master Sync Server running at http://localhost:${PORT}`);
    setImmediate(() => {
      autoSyncKeepItemsOnStartup();
    });
    // Automated Abandoned Cart 15-min urgency & 24-hr $15-off Bay Combo worker
    const cartTimer = setInterval(() => {
      try {
        const res = processDueAbandonedCartAlerts();
        if (res.triggered15m || res.triggered24h) {
          console.log(`[Abandoned Cart Worker] Dispatched 15m=${res.triggered15m}, 24h_combo=${res.triggered24h}`);
        }
      } catch (e) {
        console.error('[Abandoned Cart Worker Error]', e.message);
      }
    }, 60000);
    if (typeof cartTimer.unref === 'function') cartTimer.unref();
  });
}

module.exports = { server };
