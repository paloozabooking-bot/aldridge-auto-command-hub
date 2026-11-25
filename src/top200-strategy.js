const { db, getSettings, updateSettings, logSync, isAllowedActiveDonorVehicle, validatePartCompliance } = require('./db');
const { cleanListingTitle } = require('./audit-sanitizer');
const { resolvePartDimensionsAndWeight } = require('./catalog-enrichment');

const DEFAULT_TOP200_CONFIG = {
  enabled: true,
  limit: 200,
  prefer_parcel_velocity: true,
  shopify_overflow_mode: 'draft', // 'draft' | 'tag_only' | 'delete'
  pinned_skus: [],
  excluded_skus: [],
  deployed_at: null,
  last_deploy_summary: null
};

// High-velocity parcel-shippable OEM categories that turn fast on eBay / Crosslist / OfferUp / FB
const TIER_A_FAST_PARCEL_REGEX = /\b(ecm|ecu|pcm|bcm|tcm|tcu|tipm|control\s*module|fuse\s*(?:and\s*relay\s*)?box|junction\s*box|instrument\s*cluster|speedometer|gauge\s*cluster|climate\s*control|hvac.*control|radio|stereo|amplifier|jbl|headlight|headlamp|tail\s*light|taillight|side.*mirror|door\s*mirror|alternator|starter|a\/?c\s*compressor|abs\b|anti-lock|throttle\s*body|steering\s*rack|rack\s*and\s*pinion|fuel\s*pump|fuel\s*injector|driveshaft|drive\s*shaft|axle\s*shaft|cv\s*axle|caliper|knuckle|wheel\s*hub|strut\s*assembly|ignition\s*coil|mass\s*air|maf\b|bluetooth|blue&me)\b/i;

const TIER_B_SHIPPABLE_REGEX = /\b(radiator|condenser|cooling\s*fan|shifter|wiper\s*motor|window\s*regulator|steering\s*column|control\s*arm|leaf\s*spring|trailer\s*hitch|grille|air\s*intake|air\s*cleaner|fog\s*light|blower\s*motor|center\s*console|door\s*glass|door\s*panel|wheel\s*and\s*tire|spare\s*wheel)\b/i;

function getTop200Config(settingsInput = null) {
  const settings = settingsInput || getSettings();
  const saved = settings?.top200_strategy && typeof settings.top200_strategy === 'object' ? settings.top200_strategy : {};
  const limit = Math.max(10, Math.min(500, Math.round(Number(saved.limit || DEFAULT_TOP200_CONFIG.limit))));
  const pinned = Array.isArray(saved.pinned_skus)
    ? Array.from(new Set(saved.pinned_skus.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)))
    : [];
  const excluded = Array.isArray(saved.excluded_skus)
    ? Array.from(new Set(saved.excluded_skus.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)))
    : [];
  const mode = ['draft', 'tag_only', 'delete'].includes(String(saved.shopify_overflow_mode || ''))
    ? String(saved.shopify_overflow_mode)
    : 'draft';

  return {
    enabled: saved.enabled !== false,
    limit,
    prefer_parcel_velocity: saved.prefer_parcel_velocity !== false,
    shopify_overflow_mode: mode,
    pinned_skus: pinned,
    excluded_skus: excluded,
    deployed_at: saved.deployed_at || null,
    last_deploy_summary: saved.last_deploy_summary || null
  };
}

function updateTop200Config(patch = {}) {
  const current = getTop200Config();
  let pinned = [...current.pinned_skus];
  let excluded = [...current.excluded_skus];

  if (Array.isArray(patch.pinned_skus)) {
    pinned = Array.from(new Set(patch.pinned_skus.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)));
  }
  if (Array.isArray(patch.excluded_skus)) {
    excluded = Array.from(new Set(patch.excluded_skus.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)));
  }

  if (patch.pin_sku) {
    const sku = String(patch.pin_sku).trim().toUpperCase();
    if (sku) {
      if (!pinned.includes(sku)) pinned.push(sku);
      excluded = excluded.filter((x) => x !== sku);
    }
  }
  if (patch.unpin_sku) {
    const sku = String(patch.unpin_sku).trim().toUpperCase();
    pinned = pinned.filter((x) => x !== sku);
  }
  if (patch.exclude_sku) {
    const sku = String(patch.exclude_sku).trim().toUpperCase();
    if (sku) {
      if (!excluded.includes(sku)) excluded.push(sku);
      pinned = pinned.filter((x) => x !== sku);
    }
  }
  if (patch.include_sku) {
    const sku = String(patch.include_sku).trim().toUpperCase();
    excluded = excluded.filter((x) => x !== sku);
  }

  const next = {
    ...current,
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
    limit: patch.limit !== undefined ? Math.max(10, Math.min(500, Math.round(Number(patch.limit) || 200))) : current.limit,
    prefer_parcel_velocity:
      patch.prefer_parcel_velocity !== undefined ? Boolean(patch.prefer_parcel_velocity) : current.prefer_parcel_velocity,
    shopify_overflow_mode:
      ['draft', 'tag_only', 'delete'].includes(String(patch.shopify_overflow_mode || ''))
        ? String(patch.shopify_overflow_mode)
        : current.shopify_overflow_mode,
    pinned_skus: pinned,
    excluded_skus: excluded,
    deployed_at: patch.deployed_at !== undefined ? patch.deployed_at : current.deployed_at,
    last_deploy_summary: patch.last_deploy_summary !== undefined ? patch.last_deploy_summary : current.last_deploy_summary
  };

  updateSettings({ top200_strategy: next });
  return next;
}

function scoreItemForTop200(item, settings, config) {
  const { getValidPhotos, isHeavyLocalPickupItem } = require('./exporters');
  const price = Number(item.price_we_pull || 0);
  const title = cleanListingTitle(item.title || '');
  const isLocal = isHeavyLocalPickupItem(item, settings);
  const photos = getValidPhotos(item);
  const mpn = String(item.oem_part_number || '').trim();
  const hasRealMpn = Boolean(mpn && !/^OEM-/i.test(mpn) && !/does not apply|n\/a|none/i.test(mpn));

  let boost = 0;
  let reason = 'High Price';

  if (config.prefer_parcel_velocity) {
    if (!isLocal) {
      if (TIER_A_FAST_PARCEL_REGEX.test(title)) {
        boost += 65;
        reason = 'Fast-Sell Parcel (Tier A)';
      } else if (TIER_B_SHIPPABLE_REGEX.test(title)) {
        boost += 25;
        reason = 'Shippable Parcel (Tier B)';
      } else {
        boost += 10;
        reason = 'Parcel Shippable';
      }
    } else if (price <= 125) {
      boost -= 35;
      reason = 'Bulky Local Pickup (<= $125)';
    } else {
      reason = 'High-Ticket Local Powerhouse';
    }
  } else {
    reason = isLocal ? 'High-Price Local Pickup' : 'High-Price Parcel';
  }

  if (photos.length >= 2) boost += 5;
  if (hasRealMpn) boost += 8;

  return {
    score: Math.round((price + boost) * 100) / 100,
    boost,
    reason,
    isLocal,
    photoCount: photos.length,
    hasRealMpn,
    cleanTitle: title
  };
}

function getEligibleCatalogRows(rowsInput = null) {
  const { getValidPhotos } = require('./exporters');
  const rows = Array.isArray(rowsInput)
    ? rowsInput
    : db.prepare("SELECT * FROM inventory_items WHERE status IN ('active', 'draft') AND quantity > 0 ORDER BY id DESC").all();

  return rows.filter((r) => {
    if (!r || Number(r.quantity || 0) <= 0) return false;
    if (r.status !== 'active' && r.status !== 'draft') return false;
    if (getValidPhotos(r).length === 0) return false;
    if (!validatePartCompliance({ title: r.title, category: r.category, description: r.description }).compliant) return false;
    if (!isAllowedActiveDonorVehicle(r).allowed) return false;
    return true;
  });
}

function computeTop200Plan(rowsInput = null, settingsInput = null, opts = {}) {
  const { getValidPhotos, resolveExportPhotoUrl } = require('./exporters');
  const { resolvePublicAppBaseUrl } = require('./qr-card');
  const settings = settingsInput || getSettings();
  const config = getTop200Config(settings);
  const limit = Math.max(10, Math.min(500, Math.round(Number(opts.limit || config.limit || 200))));
  const baseUrl = opts.baseUrl || resolvePublicAppBaseUrl(settings) || 'https://aldridgeautosupply.com';

  const pinnedSet = new Set(config.pinned_skus);
  const excludedSet = new Set(config.excluded_skus);
  const eligible = getEligibleCatalogRows(rowsInput);

  const scored = eligible.map((row) => {
    const skuUp = String(row.sku || '').trim().toUpperCase();
    const s = scoreItemForTop200(row, settings, config);
    const pinned = pinnedSet.has(skuUp);
    const excluded = excludedSet.has(skuUp);
    const photos = getValidPhotos(row);
    const thumb = photos[0] ? resolveExportPhotoUrl(photos[0], baseUrl, settings) : '/assets/oem-parts.jpg';
    const dims = resolvePartDimensionsAndWeight({ title: s.cleanTitle, category: row.category });
    let ch = {};
    try { ch = JSON.parse(row.channels_json || '{}'); } catch (_) {}

    return {
      row,
      id: row.id,
      sku: row.sku,
      sku_upper: skuUp,
      title: s.cleanTitle || row.title,
      price: Number(row.price_we_pull || 0),
      price_int: Math.max(1, Math.round(Number(row.price_we_pull || 0))),
      install_price: Number(row.price_pull_install || row.price_we_pull || 0),
      ymm: [row.fitment_years, row.fitment_make, row.fitment_model].filter(Boolean).join(' ').trim(),
      status: row.status,
      shipping_class: s.isLocal ? 'local_pickup_only' : 'parcel_calculated',
      heavy_local_pickup: s.isLocal,
      weight_lbs: Number(row.weight_lbs || dims.weight_lbs || 0),
      photo_count: s.photoCount,
      thumb_url: thumb,
      oem_part_number: row.oem_part_number || '',
      has_real_mpn: s.hasRealMpn,
      shopify_product_id: row.shopify_product_id || '',
      posted_craigslist: Boolean(ch.craigslist_posted),
      score: s.score,
      boost: s.boost,
      reason: pinned ? 'Pinned by Staff' : excluded ? 'Excluded by Staff' : s.reason,
      pinned,
      excluded
    };
  });

  // 1. Pinned items always go first (sorted by score desc)
  // 2. Non-excluded items sorted by score desc, price desc
  // 3. Excluded items always go to Overflow
  const pinnedList = scored.filter((x) => x.pinned).sort((a, b) => b.score - a.score || b.price - a.price);
  const normalList = scored.filter((x) => !x.pinned && !x.excluded).sort((a, b) => b.score - a.score || b.price - a.price || b.id - a.id);
  const excludedList = scored.filter((x) => x.excluded).sort((a, b) => b.score - a.score || b.price - a.price);

  const orderedCandidates = [...pinnedList, ...normalList];
  const top200 = orderedCandidates.slice(0, limit).map((item, idx) => ({ ...item, rank: idx + 1, tier: 'top200' }));
  const overflow = [...orderedCandidates.slice(limit), ...excludedList].map((item, idx) => ({
    ...item,
    rank: limit + idx + 1,
    tier: 'overflow'
  }));

  const sumVal = (arr) => Math.round(arr.reduce((acc, x) => acc + Number(x.price || 0), 0));
  const top200Val = sumVal(top200);
  const overflowVal = sumVal(overflow);
  const totalVal = top200Val + overflowVal;

  const top200SkuSet = new Set(top200.map((x) => x.sku_upper));
  const overflowSkuSet = new Set(overflow.map((x) => x.sku_upper));

  const platformMatrix = [
    {
      platform: 'Shopify (aldridgesales.myshopify.com)',
      limit_rule: 'Unlimited products on Shopify itself — HOWEVER connected apps (Marketplace Connect, Crosslist Shopify Sync) often sync all ACTIVE products.',
      inactive_counts_toward_limit: false,
      recommended_action: 'deactivate_to_draft',
      automation_method: 'Live Shopify Admin GraphQL API (1-Click Deploy: Top 200 → ACTIVE + Top_200_Active tag; Overflow → DRAFT + Overflow_294_Reserve tag; optional Hard Delete available).'
    },
    {
      platform: 'Crosslist (OfferUp + FB Marketplace + eBay Bridge)',
      limit_rule: 'Strict plan inventory cap (~200–250 items). Static, Draft, Inactive, and Delisted items STILL count toward your Crosslist limit!',
      inactive_counts_toward_limit: true,
      recommended_action: 'delete_overflow',
      automation_method: '1-Click Crosslist Top-200 CSV + Images ZIP (single <250 batch) + Tampermonkey Crosslist Overflow Auto-Deleter (/crosslist-cleanup.user.js) to permanently delete non-Top-200 items.'
    },
    {
      platform: 'eBay US (aabcas — Seller Hub)',
      limit_rule: 'Active listings count toward seller/monthly caps. Ended listings do NOT consume active limits.',
      inactive_counts_toward_limit: false,
      recommended_action: 'end_overflow_csv',
      automation_method: '1-Click Top-200 eBay Active CSV (/api/exports/ebay_us.csv?tier=top200) + 1-Click eBay End-Overflow CSV (/api/exports/ebay_us_end_overflow.csv with *Action=End).'
    },
    {
      platform: 'Craigslist Tacoma (tac → fsd → ptd)',
      limit_rule: 'Dealer posting fee / renewal velocity cap — focus strictly on Top 200 highest-ROI & high-demand parts.',
      inactive_counts_toward_limit: false,
      recommended_action: 'queue_top200_and_delete_overflow',
      automation_method: 'Tampermonkey CL Auto-Poster v2.3.0 (/craigslist-autofill.user.js) auto-posts Top 200 + flags/deletes Overflow ads on accounts.craigslist.org.'
    },
    {
      platform: 'Google Merchant XML & Meta Commerce CSV',
      limit_rule: 'No strict 200 cap; auto-aligns with Top 200 when Top-200 Deployment Mode is enabled (?tier=all always available).',
      inactive_counts_toward_limit: false,
      recommended_action: 'auto_filtered_feed',
      automation_method: 'Live feed URLs automatically serve Top 200 when Top-200 Mode is active.'
    }
  ];

  return {
    config: { ...config, limit },
    summary: {
      limit,
      total_eligible: eligible.length,
      top200_count: top200.length,
      top200_parcel: top200.filter((x) => !x.heavy_local_pickup).length,
      top200_local: top200.filter((x) => x.heavy_local_pickup).length,
      top200_value: top200Val,
      top200_min_price: top200.length ? Math.min(...top200.map((x) => x.price_int)) : 0,
      top200_max_price: top200.length ? Math.max(...top200.map((x) => x.price_int)) : 0,
      overflow_count: overflow.length,
      overflow_parcel: overflow.filter((x) => !x.heavy_local_pickup).length,
      overflow_local: overflow.filter((x) => x.heavy_local_pickup).length,
      overflow_value: overflowVal,
      total_catalog_value: totalVal,
      top200_value_share_pct: totalVal > 0 ? Math.round((top200Val / totalVal) * 1000) / 10 : 0,
      pinned_count: pinnedList.length,
      excluded_count: excludedList.length
    },
    platform_matrix: platformMatrix,
    top200,
    overflow,
    top200SkuSet,
    overflowSkuSet
  };
}

/**
 * Filter any inventory rows array by tier:
 *  - tier === 'top200': returns ONLY the ranked Top-200 items (in rank order!)
 *  - tier === 'overflow': returns ONLY the Overflow items
 *  - tier === 'all': returns all items untouched
 *  - tier === 'auto' (default): uses top200 if settings.top200_strategy.enabled is true, else all
 */
function filterItemsByDeploymentTier(items, settingsInput = null, tierInput = 'auto') {
  const settings = settingsInput || getSettings();
  const cfg = getTop200Config(settings);
  const tier = String(tierInput || 'auto').toLowerCase();
  const effectiveTier = tier === 'auto' ? (cfg.enabled ? 'top200' : 'all') : tier;

  if (effectiveTier === 'all') return items;

  const plan = computeTop200Plan(items, settings);
  if (effectiveTier === 'overflow') {
    return plan.overflow.map((x) => x.row);
  }
  return plan.top200.map((x) => x.row);
}

function csvEsc(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Generates official eBay Seller Hub File Exchange CSV (*Action=End) to deactivate all non-Top-200 listings.
 * Ended listings do NOT count against eBay's active seller limits.
 */
function generateEbayEndOverflowCsv(overflowItems = []) {
  const headers = [
    '*Action(SiteID=US|Country=US|Currency=USD|Version=1193)',
    'CustomLabel',
    'ItemID',
    'EndCode',
    'Title',
    'CurrentPrice',
    'Reason'
  ];
  const rows = [headers.join(',')];
  for (const item of overflowItems) {
    rows.push(
      [
        'End',
        item.sku,
        '',
        'NotAvailable',
        cleanListingTitle(item.title || '').slice(0, 80),
        Number(item.price || item.price_we_pull || 0).toFixed(2),
        item.reason || 'Top-200 Platform Limit Optimization (Deactivate Overflow)'
      ].map(csvEsc).join(',')
    );
  }
  return rows.join('\n') + '\n';
}

// Live async job state for Top-200 Shopify + Multi-Platform Deployment
let activeDeployJob = null;

function getTop200DeployJobStatus() {
  return activeDeployJob;
}

async function runTop200DeploymentJob({ overflowAction = 'draft', confirmDelete = '', limit = null, enableTop200Mode = true } = {}) {
  const { resolveShopifyAccessToken, shopifyFetchWithRetry } = require('./exporters');
  const SHOPIFY_GQL_VER = '2025-01';

  const mode = ['draft', 'tag_only', 'delete'].includes(String(overflowAction || '')) ? String(overflowAction) : 'draft';
  if (mode === 'delete' && String(confirmDelete || '').trim() !== 'DELETE_OVERFLOW') {
    throw new Error('Permanent Shopify overflow deletion requires confirm_delete: "DELETE_OVERFLOW".');
  }

  const settings = getSettings();
  if (limit) {
    updateTop200Config({ limit, enabled: Boolean(enableTop200Mode), shopify_overflow_mode: mode });
  } else {
    updateTop200Config({ enabled: Boolean(enableTop200Mode), shopify_overflow_mode: mode });
  }

  const freshSettings = getSettings();
  const plan = computeTop200Plan(null, freshSettings);
  const now = new Date().toISOString();

  activeDeployJob = {
    job_id: `TOP200-${Date.now().toString(36).toUpperCase()}`,
    status: 'running',
    started_at: now,
    finished_at: null,
    overflow_action: mode,
    total_items: plan.top200.length + plan.overflow.length,
    processed: 0,
    top200_count: plan.top200.length,
    overflow_count: plan.overflow.length,
    sqlite_activated: 0,
    sqlite_deactivated: 0,
    sqlite_deleted: 0,
    shopify_connected: false,
    shopify_activated: 0,
    shopify_deactivated: 0,
    shopify_tagged_only: 0,
    shopify_deleted: 0,
    errors: []
  };

  // Phase 1: Update SQLite immediately so all live feeds (Crosslist, eBay, Craigslist, Google, Meta) switch to Top 200 instantly!
  const updateSqlStmt = db.prepare('UPDATE inventory_items SET status = ?, channels_json = ?, updated_at = ? WHERE id = ?');
  const deleteSqlStmt = db.prepare('DELETE FROM inventory_items WHERE id = ?');

  for (const item of plan.top200) {
    let ch = {};
    try { ch = JSON.parse(item.row.channels_json || '{}'); } catch (_) {}
    ch.top200_selected = true;
    ch.top200_rank = item.rank;
    ch.top200_updated_at = now;
    updateSqlStmt.run('active', JSON.stringify(ch), now, item.id);
    activeDeployJob.sqlite_activated++;
  }

  for (const item of plan.overflow) {
    let ch = {};
    try { ch = JSON.parse(item.row.channels_json || '{}'); } catch (_) {}
    ch.top200_selected = false;
    ch.top200_rank = item.rank;
    ch.top200_updated_at = now;
    if (mode === 'delete') {
      deleteSqlStmt.run(item.id);
      activeDeployJob.sqlite_deleted++;
    } else if (mode === 'draft') {
      updateSqlStmt.run('draft', JSON.stringify(ch), now, item.id);
      activeDeployJob.sqlite_deactivated++;
    } else {
      // tag_only: keep active in SQLite (feeds still filter to Top 200 via top200_strategy.enabled)
      updateSqlStmt.run('active', JSON.stringify(ch), now, item.id);
    }
  }

  // Clear cached Crosslist ZIPs so next download immediately reflects Top 200
  if (global.__aldridgeCrosslistZipCache) {
    global.__aldridgeCrosslistZipCache.clear();
  }

  // Phase 2: Push Live Status & Tag Updates to Shopify Co-Master via GraphQL
  try {
    const auth = await resolveShopifyAccessToken(freshSettings, { forceRefresh: true });
    const domain = auth.shopDomain;
    const tokenRef = { token: auth.token };
    const canCallShopify = Boolean(domain && auth.token && auth.authMode !== 'shpss_missing_client_id');
    activeDeployJob.shopify_connected = canCallShopify;

    if (canCallShopify) {
      const gqlUrl = `https://${domain}/admin/api/${SHOPIFY_GQL_VER}/graphql.json`;

      const fetchShopifyProductBySku = async (item) => {
        const directId = String(item.shopify_product_id || '').trim();
        if (directId) {
          const gid = directId.startsWith('gid://') ? directId : `gid://shopify/Product/${directId}`;
          const r = await shopifyFetchWithRetry(
            gqlUrl,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                query: `query GetProd($id: ID!) { product(id: $id) { id status tags } }`,
                variables: { id: gid }
              })
            },
            { authMode: auth.authMode, settings: freshSettings, tokenRef }
          );
          if (r.ok) {
            const j = await r.json();
            if (j?.data?.product?.id) return j.data.product;
          }
        }
        const r = await shopifyFetchWithRetry(
          gqlUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              query: `query FindBySku($q: String!) { products(first: 5, query: $q) { nodes { id status tags } } }`,
              variables: { q: `sku:${item.sku}` }
            })
          },
          { authMode: auth.authMode, settings: freshSettings, tokenRef }
        );
        if (r.ok) {
          const j = await r.json();
          const nodes = j?.data?.products?.nodes || [];
          if (nodes.length > 0) return nodes[0];
        }
        return null;
      };

      const updateProduct = async (prod, targetStatus, addTags = [], removeTags = []) => {
        const nextTagSet = new Set(Array.isArray(prod.tags) ? prod.tags : []);
        for (const rt of removeTags) nextTagSet.delete(rt);
        for (const at of addTags) nextTagSet.add(at);
        const nextTags = Array.from(nextTagSet);

        // Skip mutation if already in exact desired status & tags
        const curTagsSorted = (Array.isArray(prod.tags) ? [...prod.tags] : []).sort().join('|');
        const nextTagsSorted = [...nextTags].sort().join('|');
        if (String(prod.status || '').toUpperCase() === targetStatus && curTagsSorted === nextTagsSorted) {
          return { ok: true, skipped: true };
        }

        const r = await shopifyFetchWithRetry(
          gqlUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              query: `mutation UpdateTop200($product: ProductUpdateInput!) {
                productUpdate(product: $product) {
                  product { id status tags }
                  userErrors { field message }
                }
              }`,
              variables: { product: { id: prod.id, status: targetStatus, tags: nextTags } }
            })
          },
          { authMode: auth.authMode, settings: freshSettings, tokenRef }
        );
        const j = await r.json();
        const errs = j?.data?.productUpdate?.userErrors || j?.errors || [];
        if (!r.ok || errs.length > 0) {
          throw new Error(errs.map((e) => e.message).join('; ') || `HTTP ${r.status}`);
        }
        return { ok: true, skipped: false };
      };

      const deleteProduct = async (prod) => {
        const r = await shopifyFetchWithRetry(
          gqlUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              query: `mutation DeleteOverflow($input: ProductDeleteInput!) {
                productDelete(input: $input) {
                  deletedProductId
                  userErrors { field message }
                }
              }`,
              variables: { input: { id: prod.id } }
            })
          },
          { authMode: auth.authMode, settings: freshSettings, tokenRef }
        );
        const j = await r.json();
        const errs = j?.data?.productDelete?.userErrors || j?.errors || [];
        if (!r.ok || errs.length > 0) {
          throw new Error(errs.map((e) => e.message).join('; ') || `HTTP ${r.status}`);
        }
        return { ok: true };
      };

      // Process Top 200 -> ACTIVE + Top_200_Active
      for (const item of plan.top200) {
        try {
          const prod = await fetchShopifyProductBySku(item);
          if (prod) {
            const addTags = item.pinned ? ['Top_200_Active', 'Top_200_Pinned'] : ['Top_200_Active'];
            await updateProduct(prod, 'ACTIVE', addTags, ['Overflow_294_Reserve']);
            activeDeployJob.shopify_activated++;
          }
        } catch (err) {
          activeDeployJob.errors.push(`${item.sku} (top200): ${err.message || err}`);
        }
        activeDeployJob.processed++;
      }

      // Process Overflow -> DRAFT / TAG_ONLY / DELETE
      for (const item of plan.overflow) {
        try {
          const prod = await fetchShopifyProductBySku(item);
          if (prod) {
            if (mode === 'delete') {
              await deleteProduct(prod);
              activeDeployJob.shopify_deleted++;
            } else if (mode === 'draft') {
              await updateProduct(prod, 'DRAFT', ['Overflow_294_Reserve'], ['Top_200_Active', 'Top_200_Pinned']);
              activeDeployJob.shopify_deactivated++;
            } else {
              await updateProduct(prod, 'ACTIVE', ['Overflow_294_Reserve'], ['Top_200_Active', 'Top_200_Pinned']);
              activeDeployJob.shopify_tagged_only++;
            }
          }
        } catch (err) {
          activeDeployJob.errors.push(`${item.sku} (overflow): ${err.message || err}`);
        }
        activeDeployJob.processed++;
      }
    } else {
      activeDeployJob.processed = activeDeployJob.total_items;
    }

    activeDeployJob.status = 'completed';
    activeDeployJob.finished_at = new Date().toISOString();

    const summarySnapshot = {
      job_id: activeDeployJob.job_id,
      overflow_action: mode,
      top200_count: activeDeployJob.top200_count,
      overflow_count: activeDeployJob.overflow_count,
      shopify_activated: activeDeployJob.shopify_activated,
      shopify_deactivated: activeDeployJob.shopify_deactivated,
      shopify_tagged_only: activeDeployJob.shopify_tagged_only,
      shopify_deleted: activeDeployJob.shopify_deleted,
      error_count: activeDeployJob.errors.length,
      finished_at: activeDeployJob.finished_at
    };
    updateTop200Config({
      enabled: Boolean(enableTop200Mode),
      shopify_overflow_mode: mode,
      deployed_at: activeDeployJob.finished_at,
      last_deploy_summary: summarySnapshot
    });

    logSync(
      'outbound',
      'top200_deployment',
      `deploy_${mode}`,
      'TOP200',
      activeDeployJob.errors.length ? 'partial' : 'success',
      `Top-200 Deployment (${mode}): ${activeDeployJob.top200_count} Top-200 Active, ${activeDeployJob.overflow_count} Overflow (${mode}), Shopify activated=${activeDeployJob.shopify_activated}, deactivated=${activeDeployJob.shopify_deactivated}, deleted=${activeDeployJob.shopify_deleted}, errors=${activeDeployJob.errors.length}.`
    );
  } catch (err) {
    activeDeployJob.status = 'error';
    activeDeployJob.finished_at = new Date().toISOString();
    activeDeployJob.errors.push(err.message || String(err));
  }

  return activeDeployJob;
}

module.exports = {
  DEFAULT_TOP200_CONFIG,
  getTop200Config,
  updateTop200Config,
  scoreItemForTop200,
  computeTop200Plan,
  filterItemsByDeploymentTier,
  generateEbayEndOverflowCsv,
  getTop200DeployJobStatus,
  runTop200DeploymentJob
};
