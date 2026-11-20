const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  db,
  DATA_DIR,
  getSettings,
  normalizePhoneDigits,
  upsertCustomer,
  logSync,
  validateVinStrict
} = require('./db');
const { decodeVin } = require('./ai-intake');
const { getValidPhotos, resolveShopifyAccessToken } = require('./exporters');
const { isQrCardUrl } = require('./qr-card');

const DVI_MEDIA_DIR = path.join(DATA_DIR, 'uploads', 'dvi');
if (!fs.existsSync(DVI_MEDIA_DIR)) {
  fs.mkdirSync(DVI_MEDIA_DIR, { recursive: true });
}

const REPAIR_STATUS_FLOW = [
  'checked_in',
  'inspection_complete',
  'awaiting_approval',
  'in_repair',
  'ready_for_pickup',
  'completed'
];

const REPAIR_STATUS_LABELS = {
  checked_in: 'Checked In',
  inspection_complete: 'Inspection Complete',
  awaiting_approval: 'Awaiting Approval',
  in_repair: 'In Repair',
  ready_for_pickup: 'Ready for Pickup',
  completed: 'Completed'
};

const STAFF_ROLES = {
  owner: {
    label: 'Owner / Admin (Chris)',
    can_capture_dvi: true,
    can_publish_dvi: true,
    can_edit_pricing: true,
    can_office_approve: true,
    can_convert_invoice: true,
    can_manage_crm: true
  },
  office_manager: {
    label: 'Office Manager (Maria)',
    can_capture_dvi: true,
    can_publish_dvi: true,
    can_edit_pricing: true,
    can_office_approve: true,
    can_convert_invoice: true,
    can_manage_crm: true
  },
  technician: {
    label: 'Technician (Bay Tech)',
    can_capture_dvi: true,
    can_publish_dvi: false,
    can_edit_pricing: false,
    can_office_approve: false,
    can_convert_invoice: false,
    can_manage_crm: false
  },
  customer: {
    label: 'Customer Portal',
    can_capture_dvi: false,
    can_publish_dvi: false,
    can_edit_pricing: false,
    can_office_approve: false,
    can_convert_invoice: false,
    can_manage_crm: false
  }
};

function resolveStaffRole(roleInput) {
  const key = String(roleInput || 'owner').trim().toLowerCase();
  return STAFF_ROLES[key] ? key : 'owner';
}

function assertRolePermission(roleInput, capability) {
  const roleKey = resolveStaffRole(roleInput);
  const perms = STAFF_ROLES[roleKey];
  if (!perms || !perms[capability]) {
    const err = new Error(`Permission denied for role "${perms?.label || roleKey}": requires ${capability} (Owner/Admin or Office Manager Maria).`);
    err.statusCode = 403;
    throw err;
  }
  return roleKey;
}

function getPortalSigningSecret() {
  const cfg = getSettings();
  return (
    process.env.PORTAL_SESSION_SECRET ||
    cfg.shopify_webhook_secret ||
    `aldridge-portal-${cfg.canonical_domain || 'aldridgeautosupply.com'}-98467`
  );
}

function hashPassword(plainPassword) {
  const pwd = String(plainPassword || '');
  if (pwd.length < 6) {
    const err = new Error('Password must be at least 6 characters.');
    err.statusCode = 400;
    throw err;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(plainPassword, storedHash) {
  if (!storedHash || !String(storedHash).startsWith('scrypt:')) return false;
  const parts = String(storedHash).split(':');
  if (parts.length !== 3) return false;
  const [, salt, expectedHex] = parts;
  const actualBuf = crypto.scryptSync(String(plainPassword || ''), salt, 64);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function createPortalSessionToken(customerId) {
  const payload = Buffer.from(JSON.stringify({
    cid: Number(customerId),
    iat: Date.now(),
    exp: Date.now() + 14 * 24 * 60 * 60 * 1000
  })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getPortalSigningSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyPortalSessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', getPortalSigningSecret())
    .update(payload)
    .digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.cid || Number(parsed.exp) < Date.now()) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

/* ==================== CUSTOMER NOTIFICATIONS (SMS / EMAIL / PORTAL) ==================== */
async function dispatchCustomerNotification({
  customerId,
  dviId = null,
  quoteId = null,
  channel = 'sms',
  eventType = 'status_update',
  subject = '',
  body = ''
}) {
  const customer = db.prepare('SELECT * FROM crm_customers WHERE id = ?').get(customerId);
  if (!customer) return null;
  const settings = getSettings();
  const now = new Date().toISOString();
  const recipient = channel === 'email' ? (customer.email || customer.phone || '') : (customer.phone || customer.email || '');
  let status = 'logged';

  const webhookUrl = channel === 'email' ? settings.email_webhook_url : settings.sms_webhook_url;
  if (webhookUrl && /^https?:\/\//i.test(webhookUrl) && recipient) {
    try {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          event_type: eventType,
          to: recipient,
          customer_name: customer.name,
          subject,
          body,
          shop: settings.google_listing_name || "Aldridge Auto's Service & Repair"
        }),
        signal: AbortSignal.timeout(5000)
      });
      if (resp.ok) status = 'dispatched';
    } catch (_) {
      status = 'logged';
    }
  }

  const r = db.prepare(`
    INSERT INTO customer_notifications (customer_id, dvi_id, quote_id, channel, event_type, recipient, subject, body, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(customerId, dviId, quoteId, channel, eventType, recipient, subject, body, status, now);

  return db.prepare('SELECT * FROM customer_notifications WHERE id = ?').get(r.lastInsertRowid);
}

/* ==================== UNIFIED CRM & VEHICLE PROFILES ==================== */
function upsertCustomerVehicle({
  customer_id,
  vin = '',
  year = 0,
  make = '',
  model = '',
  trim = '',
  engine = '',
  license_plate = '',
  mileage = 0,
  color = '',
  notes = ''
}) {
  const now = new Date().toISOString();
  const cleanVin = String(vin || '').trim().toUpperCase();
  let decYear = Number(year || 0);
  let decMake = String(make || '').trim();
  let decModel = String(model || '').trim();
  let decEngine = String(engine || '').trim();

  if (cleanVin && cleanVin.length === 17) {
    const vCheck = validateVinStrict(cleanVin);
    if (vCheck.valid) {
      const decoded = decodeVin(cleanVin);
      if (decoded && decoded.valid) {
        if (!decYear && decoded.year) decYear = Number(decoded.year);
        if (!decMake && decoded.make) decMake = decoded.make;
        if (!decModel && decoded.model) decModel = decoded.model;
        if (!decEngine && decoded.engine) decEngine = decoded.engine;
      }
    }
  }

  let existing = null;
  if (cleanVin) {
    existing = db.prepare('SELECT * FROM crm_vehicles WHERE customer_id = ? AND UPPER(vin) = ?').get(customer_id, cleanVin);
  }
  if (!existing && decYear && decMake && decModel) {
    existing = db.prepare(
      'SELECT * FROM crm_vehicles WHERE customer_id = ? AND year = ? AND LOWER(make) = LOWER(?) AND LOWER(model) = LOWER(?)'
    ).get(customer_id, decYear, decMake, decModel);
  }

  if (existing) {
    const nextMileage = Math.max(Number(existing.mileage || 0), Number(mileage || 0));
    db.prepare(`
      UPDATE crm_vehicles
      SET vin = COALESCE(NULLIF(?, ''), vin),
          year = CASE WHEN ? > 0 THEN ? ELSE year END,
          make = COALESCE(NULLIF(?, ''), make),
          model = COALESCE(NULLIF(?, ''), model),
          trim = COALESCE(NULLIF(?, ''), trim),
          engine = COALESCE(NULLIF(?, ''), engine),
          license_plate = COALESCE(NULLIF(?, ''), license_plate),
          mileage = ?,
          color = COALESCE(NULLIF(?, ''), color),
          notes = COALESCE(NULLIF(?, ''), notes),
          updated_at = ?
      WHERE id = ?
    `).run(
      cleanVin,
      decYear, decYear,
      decMake, decModel, String(trim || '').trim(), decEngine,
      String(license_plate || '').trim().toUpperCase(),
      nextMileage,
      String(color || '').trim(),
      String(notes || '').trim(),
      now,
      existing.id
    );
    return db.prepare('SELECT * FROM crm_vehicles WHERE id = ?').get(existing.id);
  }

  const res = db.prepare(`
    INSERT INTO crm_vehicles (
      customer_id, vin, year, make, model, trim, engine, license_plate, mileage, color, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    customer_id,
    cleanVin,
    decYear,
    decMake || 'Vehicle',
    decModel || '',
    String(trim || '').trim(),
    decEngine,
    String(license_plate || '').trim().toUpperCase(),
    Number(mileage || 0),
    String(color || '').trim(),
    String(notes || '').trim(),
    now,
    now
  );

  // Sync summary label into crm_customers.vehicles_json
  const ymmLabel = [decYear || '', decMake, decModel].filter(Boolean).join(' ').trim();
  if (ymmLabel) {
    const cust = db.prepare('SELECT vehicles_json FROM crm_customers WHERE id = ?').get(customer_id);
    if (cust) {
      let arr = [];
      try { arr = JSON.parse(cust.vehicles_json || '[]'); } catch (_) { arr = []; }
      if (!arr.includes(ymmLabel)) {
        arr.push(ymmLabel);
        db.prepare('UPDATE crm_customers SET vehicles_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(arr), now, customer_id);
      }
    }
  }

  return db.prepare('SELECT * FROM crm_vehicles WHERE id = ?').get(res.lastInsertRowid);
}

function getCrmCustomerDetail(customerId) {
  const customer = db.prepare('SELECT * FROM crm_customers WHERE id = ?').get(customerId);
  if (!customer) return null;
  const safeCustomer = {
    ...customer,
    password_hash: undefined,
    has_portal_password: Boolean(customer.password_hash),
    tags: JSON.parse(customer.tags_json || '[]'),
    vehicles_summary: JSON.parse(customer.vehicles_json || '[]')
  };
  const vehicles = db.prepare('SELECT * FROM crm_vehicles WHERE customer_id = ? ORDER BY updated_at DESC').all(customerId);
  const dvis = db.prepare('SELECT * FROM dvi_inspections WHERE customer_id = ? ORDER BY id DESC').all(customerId);
  const quotes = db.prepare('SELECT * FROM service_quotes WHERE customer_id = ? ORDER BY id DESC').all(customerId);
  const workOrders = db.prepare('SELECT * FROM work_orders WHERE customer_id = ? ORDER BY id DESC').all(customerId);
  const deferred = db.prepare('SELECT * FROM deferred_work_followups WHERE customer_id = ? ORDER BY id DESC').all(customerId);
  const notifications = db.prepare('SELECT * FROM customer_notifications WHERE customer_id = ? ORDER BY id DESC LIMIT 20').all(customerId);
  return {
    customer: safeCustomer,
    vehicles,
    dvis,
    quotes,
    work_orders: workOrders,
    deferred_followups: deferred,
    notifications
  };
}

function listUnifiedCrmProfiles(searchQuery = '') {
  const q = String(searchQuery || '').trim().toLowerCase();
  const customers = db.prepare('SELECT * FROM crm_customers ORDER BY id DESC LIMIT 250').all();
  const vehiclesAll = db.prepare('SELECT * FROM crm_vehicles').all();
  const deferredAll = db.prepare("SELECT * FROM deferred_work_followups WHERE status IN ('scheduled','reminded_60d','reminded_90d')").all();
  const dvisAll = db.prepare('SELECT id, customer_id, dvi_number, status, overall_severity, updated_at FROM dvi_inspections ORDER BY id DESC').all();

  const vehByCust = new Map();
  for (const v of vehiclesAll) {
    if (!vehByCust.has(v.customer_id)) vehByCust.set(v.customer_id, []);
    vehByCust.get(v.customer_id).push(v);
  }
  const defByCust = new Map();
  for (const d of deferredAll) {
    if (!defByCust.has(d.customer_id)) defByCust.set(d.customer_id, []);
    defByCust.get(d.customer_id).push(d);
  }
  const dviByCust = new Map();
  for (const d of dvisAll) {
    if (!dviByCust.has(d.customer_id)) dviByCust.set(d.customer_id, []);
    dviByCust.get(d.customer_id).push(d);
  }

  return customers
    .map((c) => {
      const vehicles = vehByCust.get(c.id) || [];
      const deferred = defByCust.get(c.id) || [];
      const dvis = dviByCust.get(c.id) || [];
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        source_pillar: c.source_pillar,
        referral_code: c.referral_code,
        total_spent: Number(c.total_spent || 0),
        visit_count: Number(c.visit_count || 1),
        email_opt_in: Boolean(c.email_opt_in),
        sms_opt_in: Boolean(c.sms_opt_in),
        has_portal_password: Boolean(c.password_hash),
        tags: JSON.parse(c.tags_json || '[]'),
        vehicles,
        deferred_followups: deferred,
        recent_dvis: dvis.slice(0, 5),
        created_at: c.created_at
      };
    })
    .filter((c) => {
      if (!q) return true;
      const blob = [
        c.name,
        c.email,
        c.phone,
        c.referral_code,
        ...c.vehicles.map((v) => `${v.vin} ${v.year} ${v.make} ${v.model} ${v.license_plate}`)
      ].join(' ').toLowerCase();
      return blob.includes(q);
    });
}

/* ==================== LIVE INVENTORY CROSS-REFERENCE (NON-QR PHOTOS ONLY) ==================== */
const PART_KEYWORD_SYNONYMS = {
  brake: ['brake', 'caliper', 'rotor', 'pad', 'booster', 'master cylinder', 'abs'],
  alternator: ['alternator', 'generator'],
  starter: ['starter'],
  headlight: ['headlight', 'headlamp', 'lamp', 'light'],
  taillight: ['taillight', 'tail light', 'lamp'],
  mirror: ['mirror', 'side mirror'],
  bumper: ['bumper', 'grille', 'fender', 'hood'],
  strut: ['strut', 'shock', 'coil', 'spring', 'suspension', 'control arm', 'knuckle', 'hub'],
  axle: ['axle', 'cv', 'differential', 'driveshaft'],
  radiator: ['radiator', 'cooling', 'fan', 'condenser', 'ac', 'compressor'],
  window: ['window', 'regulator', 'motor', 'door', 'latch', 'handle'],
  ecu: ['ecu', 'ecm', 'pcm', 'tcm', 'bcm', 'module', 'computer', 'throttle', 'sensor'],
  seat: ['seat', 'console', 'cluster', 'speedometer', 'radio', 'stereo', 'dash'],
  wiper: ['wiper', 'blade', 'arm']
};

function findMatchingInventoryParts({ query = '', year = 0, make = '', model = '', oemPartNumber = '', limit = 8 } = {}) {
  const settings = getSettings();
  const aftermarketMarkup = Number(settings.parts_markup_aftermarket || 1.35);
  const rows = db.prepare("SELECT * FROM inventory_items WHERE status = 'active' AND quantity >= 1 ORDER BY id DESC").all();

  const qRaw = String(query || '').trim().toLowerCase();
  const mpnRaw = String(oemPartNumber || '').trim().toLowerCase();
  const makeRaw = String(make || '').trim().toLowerCase();
  const modelRaw = String(model || '').trim().toLowerCase();
  const yearNum = Number(year || 0);

  const qTokens = qRaw.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  const expandedTokens = new Set(qTokens);
  for (const tok of qTokens) {
    for (const [k, syns] of Object.entries(PART_KEYWORD_SYNONYMS)) {
      if (tok.includes(k) || syns.some((s) => tok.includes(s))) {
        for (const s of syns) expandedTokens.add(s);
      }
    }
  }

  const scored = [];
  for (const row of rows) {
    // Strictly clean non-QR part photos ONLY
    const cleanPhotos = getValidPhotos(row).filter((u) => !isQrCardUrl(u));
    if (!cleanPhotos.length) continue;

    const hayTitle = `${row.title} ${row.category} ${row.placement_on_vehicle} ${row.description}`.toLowerCase();
    const hayFit = `${row.fitment_years} ${row.fitment_make} ${row.fitment_model} ${row.fitment_engine} ${row.fitment_notes}`.toLowerCase();
    const hayMpn = `${row.oem_part_number} ${row.interchange_number} ${row.sku}`.toLowerCase();

    let score = 0;
    const matchReasons = [];

    if (mpnRaw && mpnRaw.length >= 4 && hayMpn.includes(mpnRaw)) {
      score += 100;
      matchReasons.push(`Exact OEM/SKU match (${row.oem_part_number || row.sku})`);
    }
    if (makeRaw && hayFit.includes(makeRaw)) {
      score += 25;
      matchReasons.push(`Make: ${row.fitment_make}`);
    }
    if (modelRaw && hayFit.includes(modelRaw)) {
      score += 35;
      matchReasons.push(`Model: ${row.fitment_model}`);
    }
    if (yearNum > 1970) {
      const yStr = String(yearNum);
      if (hayFit.includes(yStr) || hayTitle.includes(yStr)) {
        score += 20;
        matchReasons.push(`Year: ${yStr}`);
      } else {
        const rangeMatch = String(row.fitment_years || '').match(/(\d{4})\s*[-–]\s*(\d{4})/);
        if (rangeMatch && yearNum >= Number(rangeMatch[1]) && yearNum <= Number(rangeMatch[2])) {
          score += 18;
          matchReasons.push(`Year range: ${row.fitment_years}`);
        }
      }
    }

    let tokenHits = 0;
    for (const tok of expandedTokens) {
      if (hayTitle.includes(tok) || hayMpn.includes(tok)) {
        tokenHits++;
      }
    }
    if (tokenHits > 0) {
      score += tokenHits * 15;
      matchReasons.push(`${tokenHits} part keyword match${tokenHits > 1 ? 'es' : ''}`);
    }

    if (qRaw && hayTitle.includes(qRaw)) {
      score += 30;
    }

    if (score > 0 || (!qRaw && !mpnRaw && !makeRaw && !modelRaw)) {
      const optionAPrice = Number(row.price_we_pull || 0);
      const optionBPrice = Number(Math.max(optionAPrice * aftermarketMarkup, optionAPrice + 45).toFixed(2));
      scored.push({
        sku: row.sku,
        title: row.title,
        category: row.category,
        brand: row.brand,
        oem_part_number: row.oem_part_number || 'Does Not Apply',
        fitment_years: row.fitment_years,
        fitment_make: row.fitment_make,
        fitment_model: row.fitment_model,
        bin_location: row.bin_location || 'Main Shop Shelf',
        quantity: Number(row.quantity || 1),
        in_stock_badge: 'In Stock — Local Shelf/Yard',
        option_a_used_oem_price: optionAPrice,
        option_b_new_order_price: optionBPrice,
        savings_amount: Number((optionBPrice - optionAPrice).toFixed(2)),
        install_labor_hours: Number(row.install_labor_hours || 1.0),
        primary_photo: cleanPhotos[0],
        photos: cleanPhotos,
        match_score: score,
        match_reasons: matchReasons
      });
    }
  }

  scored.sort((a, b) => b.match_score - a.match_score || a.option_a_used_oem_price - b.option_a_used_oem_price);
  return scored.slice(0, Math.max(1, Math.min(30, Number(limit || 8))));
}

/* ==================== ATOMIC INVENTORY LOCKING & MULTI-CHANNEL AUTO-DELIST ==================== */
async function delistSkuOnShopifyLive(item) {
  if (!item || !item.shopify_product_id) {
    return { synced: false, reason: 'no_shopify_product_id' };
  }
  const settings = getSettings();
  try {
    const auth = await resolveShopifyAccessToken(settings);
    if (!auth.token || auth.authMode === 'shpss_missing_client_id') {
      return { synced: false, reason: 'shopify_token_unconfigured' };
    }
    const endpoint = `https://${auth.shopDomain}/admin/api/2025-01/products/${encodeURIComponent(item.shopify_product_id)}.json`;
    const resp = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': auth.token
      },
      body: JSON.stringify({
        product: {
          id: Number(item.shopify_product_id),
          status: 'draft',
          variants: item.shopify_variant_id
            ? [{ id: Number(item.shopify_variant_id), inventory_quantity: 0 }]
            : undefined
        }
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) {
      logSync('outbound', 'shopify_co_master', 'ro_lock_delist_error', item.sku, 'error', `Failed to draft/zero ${item.sku} on Shopify (HTTP ${resp.status})`);
      return { synced: false, http_status: resp.status };
    }
    logSync('outbound', 'shopify_co_master', 'ro_lock_delist_live', item.sku, 'success', `Auto-delisted locked RO/Quote SKU ${item.sku} (Product ${item.shopify_product_id}) on ${auth.shopDomain} -> status=draft, qty=0.`);
    return { synced: true, shopify_product_id: item.shopify_product_id };
  } catch (err) {
    logSync('outbound', 'shopify_co_master', 'ro_lock_delist_error', item.sku, 'error', `Shopify live delist error for ${item.sku}: ${err.message}`);
    return { synced: false, error: err.message };
  }
}

async function lockInventorySkuAtomically(sku, { reason = 'quote_approved_lock', reference = '' } = {}) {
  const cleanSku = String(sku || '').trim();
  if (!cleanSku) return { locked: false, reason: 'empty_sku' };
  const now = new Date().toISOString();

  let lockedRow = null;
  db.exec('BEGIN IMMEDIATE;');
  try {
    const row = db.prepare('SELECT * FROM inventory_items WHERE UPPER(sku) = UPPER(?)').get(cleanSku);
    if (!row) {
      db.exec('ROLLBACK;');
      return { locked: false, reason: 'sku_not_found' };
    }
    if (row.status !== 'active' || Number(row.quantity || 0) < 1) {
      db.exec('ROLLBACK;');
      return { locked: false, reason: 'already_sold_or_reserved', current_status: row.status, current_qty: row.quantity };
    }

    let ch = {};
    try { ch = JSON.parse(row.channels_json || '{}'); } catch (_) { ch = {}; }
    const nextQty = Math.max(0, Number(row.quantity) - 1);
    const nextStatus = nextQty <= 0 ? 'sold' : 'active';
    const nextChannels = JSON.stringify({
      ...ch,
      delisted_all_feeds: nextQty <= 0,
      delisted_at: nextQty <= 0 ? now : ch.delisted_at,
      delist_reason: nextQty <= 0 ? reason : ch.delist_reason,
      reserved_reference: reference,
      crosslist_delist_required: nextQty <= 0,
      ebay_delisted: nextQty <= 0,
      google_merchant_removed: nextQty <= 0,
      meta_catalog_removed: nextQty <= 0,
      craigslist_delisted: nextQty <= 0
    });

    const upd = db.prepare(`
      UPDATE inventory_items
      SET quantity = quantity - 1,
          reserved_qty = reserved_qty + 1,
          status = ?,
          channels_json = ?,
          updated_at = ?
      WHERE id = ? AND status = 'active' AND quantity >= 1
    `).run(nextStatus, nextChannels, now, row.id);

    if (upd.changes !== 1) {
      db.exec('ROLLBACK;');
      return { locked: false, reason: 'race_condition_conflict' };
    }

    lockedRow = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(row.id);
    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    throw err;
  }

  logSync(
    'outbound',
    'all_channels',
    'atomic_inventory_lock_delist',
    lockedRow.sku,
    'success',
    `Atomically locked 1-in-stock SKU ${lockedRow.sku} for ${reference || reason} (qty=${lockedRow.quantity}, status=${lockedRow.status}). Auto-delisted from Google Merchant XML, Meta CSV, Crosslist, eBay aabcas & Craigslist queue.`
  );

  const shopifyDelist = await delistSkuOnShopifyLive(lockedRow);
  return {
    locked: true,
    sku: lockedRow.sku,
    remaining_qty: lockedRow.quantity,
    status: lockedRow.status,
    shopify_delist: shopifyDelist
  };
}

/* ==================== DVI MEDIA UPLOAD + GEMINI VISION + VOICE CLEANUP ==================== */
function saveDviMediaDataUrl(dviNumber, dataUrl, filenameHint = '') {
  const raw = String(dataUrl || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/uploads/')) {
    return { url: raw, media_type: /\.(mp4|webm|mov)(\?|$)/i.test(raw) ? 'video' : 'image' };
  }
  const m = raw.match(/^data:(image|video)\/([a-zA-Z0-9.+_-]+);base64,(.+)$/);
  if (!m) {
    const err = new Error('Unsupported inspection media format. Upload JPG, PNG, WebP, MP4, or WebM.');
    err.statusCode = 400;
    throw err;
  }
  const mediaType = m[1];
  const extRaw = m[2].toLowerCase().replace('jpeg', 'jpg').replace('quicktime', 'mov');
  const ext = ['jpg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov'].includes(extRaw) ? extRaw : (mediaType === 'video' ? 'mp4' : 'jpg');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 18 * 1024 * 1024) {
    const err = new Error('Media file exceeds 18 MB limit. Keep inspection clips short (5–15 seconds).');
    err.statusCode = 413;
    throw err;
  }
  const safeDvi = String(dviNumber || 'DVI').replace(/[^A-Za-z0-9-]/g, '');
  const slug = String(filenameHint || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  const fname = `${safeDvi}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${slug ? '-' + slug : ''}.${ext}`;
  fs.writeFileSync(path.join(DVI_MEDIA_DIR, fname), buf);
  return {
    url: `/uploads/dvi/${fname}`,
    media_type: mediaType,
    mime_type: `${mediaType}/${m[2]}`,
    size_bytes: buf.length,
    base64: m[3]
  };
}

function heuristicDviAnalysis({ componentHint = '', techNotes = '', vehicle = {} }) {
  const blob = `${componentHint} ${techNotes}`.toLowerCase();
  let severity = 'yellow';
  let category = 'General Inspection';
  let laborHours = 1.2;
  let partQuery = componentHint || 'OEM Auto Part';
  let healthyRef = 'Factory-spec healthy component with zero leaks, cracks, or excessive wear.';

  if (/\b(good|ok|pass|healthy|clean|new|within spec|7mm|8mm|9mm|10mm)\b/i.test(blob) && !/\b(leak|worn|metal|crack|broken|bad|fail|seized|torn|play)\b/i.test(blob)) {
    severity = 'green';
    laborHours = 0;
  } else if (/\b(metal on metal|grinding|seized|active leak|pouring|broken|cracked|belt frayed|bald|2mm|1mm|unsafe|fail|severe|red|stuck|dead|no start)\b/i.test(blob)) {
    severity = 'red';
  }

  if (/brake|pad|rotor|caliper/i.test(blob)) {
    category = 'Brakes';
    partQuery = /caliper/i.test(blob) ? 'brake caliper' : 'brake rotor';
    laborHours = severity === 'green' ? 0 : 1.5;
    healthyRef = 'Healthy brake assembly: 8–10mm pad thickness, smooth machined rotor surface, dry caliper seals.';
  } else if (/strut|shock|control arm|ball joint|tie rod|suspension|coil|spring|axle|cv/i.test(blob)) {
    category = 'Suspension & Steering';
    partQuery = /axle|cv/i.test(blob) ? 'cv axle' : (/strut|shock|spring/i.test(blob) ? 'strut coil spring' : 'control arm');
    laborHours = severity === 'green' ? 0 : 1.8;
    healthyRef = 'Healthy suspension: intact rubber boots, zero fluid weeping on strut body, tight ball joint tolerances.';
  } else if (/alternator|starter|battery|electrical|sensor|module|ecu|light|headlight|taillight/i.test(blob)) {
    category = 'Electrical & Battery';
    partQuery = /alternator/i.test(blob) ? 'alternator' : (/starter/i.test(blob) ? 'starter' : (/headlight|lamp/i.test(blob) ? 'headlight' : 'electrical module'));
    laborHours = severity === 'green' ? 0 : 1.2;
    healthyRef = 'Healthy electrical component: clean corrosion-free terminals, 13.8–14.4V charging output, intact lens/housing.';
  } else if (/oil|leak|coolant|radiator|hose|belt|engine|gasket|valve cover/i.test(blob)) {
    category = 'Engine & Fluids';
    partQuery = /radiator|cooling|fan/i.test(blob) ? 'radiator cooling fan' : 'engine assembly';
    laborHours = severity === 'green' ? 0 : 1.5;
    healthyRef = 'Healthy engine bay: dry gasket mating surfaces, clean fluid levels at full mark, firm hoses with zero swelling.';
  } else if (/mirror|bumper|door|window|fender|hood|wiper/i.test(blob)) {
    category = 'Body & Exterior';
    partQuery = componentHint || 'exterior body part';
    laborHours = severity === 'green' ? 0 : 1.0;
    healthyRef = 'Healthy exterior assembly: flush mounting alignment, intact glass/housing, smooth regulator travel.';
  }

  const mpnMatch = blob.match(/\b([a-z0-9]{5,6}[- ]?[a-z0-9]{4,6})\b/i);
  const detectedOem = mpnMatch && /\d/.test(mpnMatch[1]) ? mpnMatch[1].toUpperCase() : '';

  const customerSummary = severity === 'red'
    ? `Immediate Safety / Reliability Attention Recommended: Our technician inspected your ${componentHint || category} and documented significant wear or damage (${techNotes || 'visible wear/leak observed'}). We recommend addressing this promptly to keep your ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} safe and reliable.`
    : severity === 'yellow'
      ? `Monitor / Plan Ahead: Your ${componentHint || category} is showing early signs of wear (${techNotes || 'moderate wear noted'}). It is safe to monitor for now, or we can take care of it today while the vehicle is in the bay.`
      : `Good Condition: Your ${componentHint || category} passed visual inspection with no leaks, damage, or abnormal wear noted.`;

  return {
    provider: 'heuristic_shop_rules',
    component_name: componentHint || `${category} Inspection`,
    category,
    severity,
    tech_notes: techNotes || `Inspected ${componentHint || category}; marked ${severity.toUpperCase()} for technician review.`,
    customer_notes: customerSummary,
    detected_issues: severity === 'green' ? [] : [techNotes || `Observed wear on ${componentHint || category}`],
    detected_oem_part_number: detectedOem,
    suggested_labor_hours: laborHours,
    suggested_part_query: partQuery,
    reference_healthy_caption: healthyRef,
    draft_requires_tech_review: true
  };
}

async function analyzeDviMediaWithGemini({ dataUrl = '', mimeType = 'image/jpeg', componentHint = '', techNotes = '', vehicle = {} }) {
  const settings = getSettings();
  const base64Match = String(dataUrl || '').match(/^data:(image|video)\/([a-zA-Z0-9.+_-]+);base64,(.+)$/);
  let draft = null;

  if (settings.gemini_api_key && base64Match) {
    try {
      const mediaMime = `${base64Match[1]}/${base64Match[2]}`;
      const mediaBase64 = base64Match[3];
      const prompt = [
        `You are an ASE Master Technician assistant at Aldridge Auto's Service & Repair in University Place / Tacoma, WA.`,
        `Analyze this uploaded vehicle inspection ${base64Match[1]} for a ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} ${vehicle.engine || ''}.`,
        componentHint ? `Technician component hint: ${componentHint}` : '',
        techNotes ? `Technician rough notes: ${techNotes}` : '',
        `Return ONLY valid JSON with these exact keys:`,
        `{ "component_name": string, "category": "Brakes"|"Suspension & Steering"|"Engine & Fluids"|"Electrical & Battery"|"Tires & Alignment"|"HVAC & Cooling"|"Exhaust & Drivetrain"|"Body & Exterior", "severity": "green"|"yellow"|"red", "tech_notes": string, "customer_notes": string, "detected_issues": string[], "detected_oem_part_number": string, "suggested_labor_hours": number, "suggested_part_query": string, "reference_healthy_caption": string }`,
        `Keep customer_notes clear, honest, empathetic, non-pushy, and plain-English while keeping tech_notes technically accurate.`
      ].filter(Boolean).join('\n');

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(settings.gemini_api_key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mediaMime, data: mediaBase64 } }
              ]
            }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
          }),
          signal: AbortSignal.timeout(18000)
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim());
        const sev = ['green', 'yellow', 'red'].includes(String(parsed.severity || '').toLowerCase())
          ? String(parsed.severity).toLowerCase()
          : 'yellow';
        draft = {
          provider: 'gemini_2_5_flash',
          component_name: String(parsed.component_name || componentHint || 'Inspected Component').trim(),
          category: String(parsed.category || 'General Inspection').trim(),
          severity: sev,
          tech_notes: String(parsed.tech_notes || techNotes || '').trim(),
          customer_notes: String(parsed.customer_notes || '').trim(),
          detected_issues: Array.isArray(parsed.detected_issues) ? parsed.detected_issues : [],
          detected_oem_part_number: String(parsed.detected_oem_part_number || '').trim(),
          suggested_labor_hours: Number(parsed.suggested_labor_hours || 0),
          suggested_part_query: String(parsed.suggested_part_query || parsed.component_name || componentHint || '').trim(),
          reference_healthy_caption: String(parsed.reference_healthy_caption || 'Factory-spec healthy component with zero leaks, cracks, or wear.').trim(),
          draft_requires_tech_review: true
        };
      }
    } catch (_) {
      draft = null;
    }
  }

  if (!draft) {
    draft = heuristicDviAnalysis({ componentHint, techNotes, vehicle });
  }

  const matchedInventory = draft.severity === 'green'
    ? []
    : findMatchingInventoryParts({
      query: draft.suggested_part_query || draft.component_name,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      oemPartNumber: draft.detected_oem_part_number,
      limit: 5
    });

  return {
    ...draft,
    matched_inventory_parts: matchedInventory
  };
}

async function cleanupVoiceNotesWithGemini({ rawNotes = '', componentName = '', vehicle = {} }) {
  const cleanRaw = String(rawNotes || '').trim();
  if (!cleanRaw) {
    return { provider: 'none', customer_notes: '', tech_notes: '', suggested_severity: 'yellow' };
  }
  const settings = getSettings();

  if (settings.gemini_api_key) {
    try {
      const prompt = [
        `You are a service advisor for Aldridge Auto's Service & Repair (5.0★ shop in University Place, WA).`,
        `Convert the technician's rough voice-dictated shop notes into TWO versions:`,
        `1) "tech_notes": crisp, technically accurate shop record.`,
        `2) "customer_notes": clear, polite, plain-English explanation for the vehicle owner preserving 100% technical accuracy without scary jargon.`,
        `3) "suggested_severity": "green" | "yellow" | "red".`,
        `Vehicle: ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} | Component: ${componentName || 'General'}.`,
        `Raw technician dictation: "${cleanRaw}"`,
        `Return ONLY valid JSON: { "tech_notes": string, "customer_notes": string, "suggested_severity": "green"|"yellow"|"red" }`
      ].join('\n');

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(settings.gemini_api_key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
          }),
          signal: AbortSignal.timeout(12000)
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        const txt = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const parsed = JSON.parse(txt.replace(/^```json\s*|\s*```$/g, '').trim());
        return {
          provider: 'gemini_2_5_flash',
          tech_notes: String(parsed.tech_notes || cleanRaw).trim(),
          customer_notes: String(parsed.customer_notes || cleanRaw).trim(),
          suggested_severity: ['green', 'yellow', 'red'].includes(String(parsed.suggested_severity || '').toLowerCase())
            ? String(parsed.suggested_severity).toLowerCase()
            : 'yellow'
        };
      }
    } catch (_) {}
  }

  // Deterministic plain-English cleanup fallback
  const h = heuristicDviAnalysis({ componentHint: componentName, techNotes: cleanRaw, vehicle });
  const sentence = cleanRaw.charAt(0).toUpperCase() + cleanRaw.slice(1).replace(/\s+/g, ' ').replace(/[.!?]*$/, '.');
  return {
    provider: 'deterministic_cleanup',
    tech_notes: sentence,
    customer_notes: `During our inspection of your ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}${componentName ? ` (${componentName})` : ''}, our technician noted: ${sentence} ${h.severity === 'red' ? 'We recommend addressing this promptly for safety and reliability.' : h.severity === 'yellow' ? 'We recommend planning this service soon or taking care of it today.' : 'Everything inspected within normal operating specification.'}`.replace(/\s+/g, ' ').trim(),
    suggested_severity: h.severity
  };
}

/* ==================== DVI INSPECTIONS & QUOTING ENGINE ==================== */
function recomputeDviOverallSeverity(dviId) {
  const items = db.prepare('SELECT severity FROM dvi_items WHERE dvi_id = ?').all(dviId);
  let overall = 'green';
  if (items.some((i) => i.severity === 'red')) overall = 'red';
  else if (items.some((i) => i.severity === 'yellow')) overall = 'yellow';
  db.prepare('UPDATE dvi_inspections SET overall_severity = ?, updated_at = ? WHERE id = ?').run(overall, new Date().toISOString(), dviId);
  return overall;
}

function hydrateDvi(dviId) {
  const dvi = db.prepare('SELECT * FROM dvi_inspections WHERE id = ?').get(dviId);
  if (!dvi) return null;
  const customer = db.prepare('SELECT id, name, email, phone, referral_code FROM crm_customers WHERE id = ?').get(dvi.customer_id);
  const vehicle = dvi.vehicle_id ? db.prepare('SELECT * FROM crm_vehicles WHERE id = ?').get(dvi.vehicle_id) : null;
  const items = db.prepare('SELECT * FROM dvi_items WHERE dvi_id = ? ORDER BY sort_order ASC, id ASC').all(dvi.id).map((it) => ({
    ...it,
    ai_findings: JSON.parse(it.ai_findings_json || '{}'),
    media: JSON.parse(it.media_json || '[]')
  }));
  const quoteRow = db.prepare('SELECT id FROM service_quotes WHERE dvi_id = ? ORDER BY id DESC LIMIT 1').get(dvi.id);
  const quote = quoteRow ? hydrateQuote(quoteRow.id) : null;
  return {
    ...dvi,
    status_label: REPAIR_STATUS_LABELS[dvi.status] || dvi.status,
    status_flow: REPAIR_STATUS_FLOW.map((code) => ({
      code,
      label: REPAIR_STATUS_LABELS[code],
      completed: REPAIR_STATUS_FLOW.indexOf(code) <= REPAIR_STATUS_FLOW.indexOf(dvi.status),
      current: code === dvi.status
    })),
    customer,
    vehicle,
    items,
    quote
  };
}

function recalculateQuoteTotals(quoteId) {
  const quote = db.prepare('SELECT * FROM service_quotes WHERE id = ?').get(quoteId);
  if (!quote) return null;
  const settings = getSettings();
  const lines = db.prepare('SELECT * FROM quote_line_items WHERE quote_id = ?').all(quoteId);

  // Active total includes pending + approved lines; once customer makes decisions, approved lines drive totals
  const hasAnyApproved = lines.some((l) => l.customer_decision === 'approved');
  const activeLines = hasAnyApproved
    ? lines.filter((l) => l.customer_decision === 'approved')
    : lines.filter((l) => l.customer_decision !== 'declined');

  let partsSubtotal = 0;
  let laborSubtotal = 0;
  for (const l of activeLines) {
    partsSubtotal += Number(l.part_price || 0);
    laborSubtotal += Number(l.labor_total || 0);
  }
  partsSubtotal = Number(partsSubtotal.toFixed(2));
  laborSubtotal = Number(laborSubtotal.toFixed(2));

  const supplyRate = Number(quote.shop_supply_fee_rate ?? settings.shop_supply_fee_rate ?? 0.07);
  const supplyCap = Number(settings.shop_supply_fee_cap ?? 45.00);
  const shopSupplyFee = laborSubtotal > 0
    ? Number(Math.min(supplyCap, laborSubtotal * supplyRate).toFixed(2))
    : 0;

  const taxRate = Number(quote.tax_rate ?? settings.tax_rate ?? 0.101);
  const taxableBase = partsSubtotal + laborSubtotal + shopSupplyFee;
  const taxAmount = Number((taxableBase * taxRate).toFixed(2));
  const totalAmount = Number((taxableBase + taxAmount).toFixed(2));
  const depositPct = Number(settings.deposit_percent_default ?? 0.50);
  const depositRequired = totalAmount >= 250
    ? Number((totalAmount * depositPct).toFixed(2))
    : 0;

  const amountPaid = Number(quote.amount_paid || 0);
  const balanceDue = Number(Math.max(0, totalAmount - amountPaid).toFixed(2));

  db.prepare(`
    UPDATE service_quotes
    SET parts_subtotal = ?,
        labor_subtotal = ?,
        shop_supply_fee = ?,
        tax_amount = ?,
        total_amount = ?,
        deposit_required = ?,
        balance_due = ?,
        updated_at = ?
    WHERE id = ?
  `).run(partsSubtotal, laborSubtotal, shopSupplyFee, taxAmount, totalAmount, depositRequired, balanceDue, new Date().toISOString(), quoteId);

  return hydrateQuote(quoteId);
}

function hydrateQuote(quoteId) {
  const quote = db.prepare('SELECT * FROM service_quotes WHERE id = ?').get(quoteId);
  if (!quote) return null;
  const customer = db.prepare('SELECT id, name, email, phone FROM crm_customers WHERE id = ?').get(quote.customer_id);
  const vehicle = quote.vehicle_id ? db.prepare('SELECT * FROM crm_vehicles WHERE id = ?').get(quote.vehicle_id) : null;
  const lines = db.prepare('SELECT * FROM quote_line_items WHERE quote_id = ? ORDER BY id ASC').all(quoteId).map((l) => {
    let liveStockQty = 0;
    let liveStockStatus = '';
    if (l.matched_inventory_sku) {
      const inv = db.prepare('SELECT quantity, status, bin_location FROM inventory_items WHERE UPPER(sku) = UPPER(?)').get(l.matched_inventory_sku);
      if (inv) {
        liveStockQty = Number(inv.quantity || 0);
        liveStockStatus = inv.status;
      }
    }
    return {
      ...l,
      inventory_locked: Boolean(l.inventory_locked),
      in_stock_live: Boolean(l.matched_inventory_sku && liveStockStatus === 'active' && liveStockQty >= 1),
      live_stock_qty: liveStockQty,
      in_stock_badge: l.inventory_locked
        ? 'Reserved for This Repair Order'
        : (l.matched_inventory_sku && liveStockStatus === 'active' && liveStockQty >= 1
          ? 'In Stock — Local Shelf/Yard'
          : (l.matched_inventory_sku ? 'Out of Stock — Switch to Option B Order' : ''))
    };
  });
  const payments = db.prepare('SELECT * FROM portal_payments WHERE quote_id = ? ORDER BY id DESC').all(quoteId);
  return {
    ...quote,
    customer,
    vehicle,
    lines,
    payments
  };
}

function createDviInspectionWithRo({
  customer_name,
  customer_email = '',
  customer_phone = '',
  vin = '',
  year = 0,
  make = '',
  model = '',
  trim = '',
  engine = '',
  license_plate = '',
  mileage = 0,
  service_summary = 'Digital Vehicle Inspection & Diagnostics',
  technician_name = 'Lead ASE Tech',
  booking_code = '',
  notes = ''
}) {
  const settings = getSettings();
  const now = new Date().toISOString();
  const ymmStr = [year || '', make, model].filter(Boolean).join(' ').trim() || 'Customer Vehicle';

  const customer = upsertCustomer({
    name: customer_name || 'Walk-In Repair Customer',
    email: customer_email,
    phone: customer_phone,
    source_pillar: 'repair_dvi',
    tags: ['repair-customer', 'dvi-active'],
    vehicles: [ymmStr],
    sms_opt_in: customer_phone ? 1 : 0,
    email_opt_in: customer_email ? 1 : 0
  });

  const vehicle = upsertCustomerVehicle({
    customer_id: customer.id,
    vin,
    year,
    make,
    model,
    trim,
    engine,
    license_plate,
    mileage
  });

  const resolvedYmm = [vehicle.year || '', vehicle.make, vehicle.model].filter(Boolean).join(' ').trim() || ymmStr;
  const woNumber = 'RO-' + Math.floor(10000 + Math.random() * 89999);
  const dviNumber = 'DVI-' + Math.floor(10000 + Math.random() * 89999);
  const quoteNumber = 'QT-' + Math.floor(10000 + Math.random() * 89999);
  const shareToken = crypto.randomBytes(16).toString('hex');
  const laborRate = Number(settings.labor_rate_hourly || 135);

  const woRes = db.prepare(`
    INSERT INTO work_orders (
      wo_number, booking_code, customer_id, vehicle_id, customer_name, customer_phone,
      vehicle_ymm, vehicle_vin, service_summary, parts_used_json, labor_hours, labor_rate,
      parts_total, total_estimate, status, portal_status, technician, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1.0, ?, 0, ?, 'checked_in', 'checked_in', ?, ?, ?)
  `).run(
    woNumber, booking_code, customer.id, vehicle.id, customer.name, customer.phone,
    resolvedYmm, vehicle.vin || '', service_summary, laborRate, laborRate,
    technician_name, notes, now
  );
  const workOrderId = woRes.lastInsertRowid;

  const dviRes = db.prepare(`
    INSERT INTO dvi_inspections (
      dvi_number, work_order_id, wo_number, customer_id, vehicle_id, technician_name,
      mileage_in, status, overall_severity, summary_notes, share_token, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'checked_in', 'green', ?, ?, ?, ?)
  `).run(
    dviNumber, workOrderId, woNumber, customer.id, vehicle.id, technician_name,
    Number(mileage || vehicle.mileage || 0), notes || service_summary, shareToken, now, now
  );
  const dviId = dviRes.lastInsertRowid;

  const qtRes = db.prepare(`
    INSERT INTO service_quotes (
      quote_number, dvi_id, work_order_id, customer_id, vehicle_id, status,
      labor_rate, shop_supply_fee_rate, tax_rate, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
  `).run(
    quoteNumber, dviId, workOrderId, customer.id, vehicle.id,
    laborRate, Number(settings.shop_supply_fee_rate ?? 0.07), Number(settings.tax_rate ?? 0.101), now, now
  );
  const quoteId = qtRes.lastInsertRowid;

  db.prepare('UPDATE work_orders SET dvi_id = ?, quote_id = ? WHERE id = ?').run(dviId, quoteId, workOrderId);

  return hydrateDvi(dviId);
}

function addQuoteLineItem(quoteId, payload = {}) {
  const quote = db.prepare('SELECT * FROM service_quotes WHERE id = ?').get(quoteId);
  if (!quote) {
    const err = new Error('Quote not found');
    err.statusCode = 404;
    throw err;
  }
  const settings = getSettings();
  const now = new Date().toISOString();
  const laborRate = Number(payload.labor_rate || quote.labor_rate || settings.labor_rate_hourly || 135);
  const laborHours = Math.max(0, Number(payload.labor_hours ?? 1.0));
  const laborTotal = Number((laborHours * laborRate).toFixed(2));

  let matchedSku = String(payload.matched_inventory_sku || '').trim();
  let matchedTitle = String(payload.matched_inventory_title || '').trim();
  let matchedBin = String(payload.matched_inventory_bin || '').trim();
  let matchedPhoto = String(payload.matched_inventory_photo || '').trim();
  let optionAPrice = Number(payload.option_a_part_price || 0);
  let optionBPrice = Number(payload.option_b_part_price || 0);

  if (matchedSku) {
    const inv = db.prepare('SELECT * FROM inventory_items WHERE UPPER(sku) = UPPER(?)').get(matchedSku);
    if (inv) {
      matchedSku = inv.sku;
      matchedTitle = matchedTitle || inv.title;
      matchedBin = matchedBin || inv.bin_location || 'Main Shop Shelf';
      const cleanPhotos = getValidPhotos(inv).filter((u) => !isQrCardUrl(u));
      matchedPhoto = cleanPhotos[0] || '';
      if (!optionAPrice) optionAPrice = Number(inv.price_we_pull || 0);
      if (!optionBPrice) {
        const markup = Number(settings.parts_markup_aftermarket || 1.35);
        optionBPrice = Number(Math.max(optionAPrice * markup, optionAPrice + 45).toFixed(2));
      }
    }
  } else if (optionBPrice <= 0 && optionAPrice > 0) {
    optionBPrice = Number((optionAPrice * Number(settings.parts_markup_aftermarket || 1.35)).toFixed(2));
  }

  // Strictly block any QR card photo on quote line items
  if (isQrCardUrl(matchedPhoto)) matchedPhoto = '';

  const selectedOption = payload.selected_option === 'option_b_new_order'
    ? 'option_b_new_order'
    : (matchedSku || optionAPrice > 0 ? 'option_a_used_oem' : 'option_b_new_order');
  const partPrice = selectedOption === 'option_a_used_oem' ? optionAPrice : optionBPrice;
  const lineSubtotal = Number((partPrice + laborTotal).toFixed(2));

  const res = db.prepare(`
    INSERT INTO quote_line_items (
      quote_id, dvi_item_id, title, description, severity, selected_option,
      matched_inventory_sku, matched_inventory_title, matched_inventory_bin, matched_inventory_photo,
      option_a_part_price, option_b_part_price, part_price, labor_hours, labor_rate, labor_total,
      line_subtotal, customer_decision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    quoteId,
    payload.dvi_item_id || null,
    String(payload.title || matchedTitle || 'Recommended Repair Service').trim(),
    String(payload.description || '').trim(),
    ['green', 'yellow', 'red'].includes(payload.severity) ? payload.severity : 'yellow',
    selectedOption,
    matchedSku,
    matchedTitle,
    matchedBin,
    matchedPhoto,
    optionAPrice,
    optionBPrice,
    partPrice,
    laborHours,
    laborRate,
    laborTotal,
    lineSubtotal,
    now,
    now
  );

  const hydrated = recalculateQuoteTotals(quoteId);
  return {
    line_id: res.lastInsertRowid,
    quote: hydrated
  };
}

async function submitCustomerLineDecision({ quoteId, lineId, decision, selectedOption = null, actor = 'customer', customerId = null }) {
  const quote = db.prepare('SELECT * FROM service_quotes WHERE id = ?').get(quoteId);
  if (!quote) {
    const err = new Error('Quote not found');
    err.statusCode = 404;
    throw err;
  }
  if (customerId && Number(quote.customer_id) !== Number(customerId)) {
    const err = new Error('Access denied for this quote');
    err.statusCode = 403;
    throw err;
  }
  const line = db.prepare('SELECT * FROM quote_line_items WHERE id = ? AND quote_id = ?').get(lineId, quoteId);
  if (!line) {
    const err = new Error('Quote line item not found');
    err.statusCode = 404;
    throw err;
  }

  const now = new Date().toISOString();
  const nextOption = selectedOption === 'option_b_new_order'
    ? 'option_b_new_order'
    : (selectedOption === 'option_a_used_oem' ? 'option_a_used_oem' : line.selected_option);
  const nextPartPrice = nextOption === 'option_a_used_oem' ? Number(line.option_a_part_price || 0) : Number(line.option_b_part_price || 0);
  const nextLineSubtotal = Number((nextPartPrice + Number(line.labor_total || 0)).toFixed(2));
  const cleanDecision = ['approved', 'declined', 'pending'].includes(decision) ? decision : line.customer_decision;

  let lockResult = null;
  let inventoryLocked = Number(line.inventory_locked || 0);
  let inventoryLockedAt = line.inventory_locked_at || '';

  // Atomic 1-in-stock SKU reservation & multi-channel auto-delist when Option A is approved!
  if (cleanDecision === 'approved' && nextOption === 'option_a_used_oem' && line.matched_inventory_sku && !inventoryLocked) {
    lockResult = await lockInventorySkuAtomically(line.matched_inventory_sku, {
      reason: 'quote_line_approved_lock',
      reference: `${quote.quote_number} / Line #${line.id}`
    });
    if (!lockResult.locked) {
      const err = new Error(`In-stock OEM SKU ${line.matched_inventory_sku} is no longer available (${lockResult.reason}). Please select Option B (New Order) instead.`);
      err.statusCode = 409;
      throw err;
    }
    inventoryLocked = 1;
    inventoryLockedAt = now;
  }

  db.prepare(`
    UPDATE quote_line_items
    SET selected_option = ?,
        part_price = ?,
        line_subtotal = ?,
        customer_decision = ?,
        decided_at = ?,
        inventory_locked = ?,
        inventory_locked_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(nextOption, nextPartPrice, nextLineSubtotal, cleanDecision, now, inventoryLocked, inventoryLockedAt, now, line.id);

  // Declined Yellow/Red items automatically log to CRM for 60/90-day follow-up reminders
  let deferredLogged = null;
  if (cleanDecision === 'declined' && (line.severity === 'yellow' || line.severity === 'red')) {
    const existingDef = db.prepare('SELECT id FROM deferred_work_followups WHERE quote_line_item_id = ?').get(line.id);
    if (!existingDef) {
      const d60 = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const d90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const defRes = db.prepare(`
        INSERT INTO deferred_work_followups (
          customer_id, vehicle_id, dvi_id, quote_id, quote_line_item_id, title, severity,
          estimated_total, declined_at, followup_60d_date, followup_90d_date, status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
      `).run(
        quote.customer_id,
        quote.vehicle_id,
        quote.dvi_id,
        quote.id,
        line.id,
        line.title,
        line.severity,
        nextLineSubtotal,
        now,
        d60,
        d90,
        `Customer declined ${line.severity.toUpperCase()} recommendation on ${quote.quote_number} (${actor}). Auto-scheduled 60-day (${d60}) & 90-day (${d90}) CRM reminders.`,
        now
      );
      deferredLogged = db.prepare('SELECT * FROM deferred_work_followups WHERE id = ?').get(defRes.lastInsertRowid);
    }
  }

  // Update overall quote status based on line decisions
  const allLines = db.prepare('SELECT customer_decision FROM quote_line_items WHERE quote_id = ?').all(quoteId);
  const approvedCount = allLines.filter((x) => x.customer_decision === 'approved').length;
  const declinedCount = allLines.filter((x) => x.customer_decision === 'declined').length;
  let nextQuoteStatus = quote.status;
  if (approvedCount > 0 && approvedCount === allLines.length) nextQuoteStatus = 'approved';
  else if (approvedCount > 0) nextQuoteStatus = 'partially_approved';
  else if (declinedCount === allLines.length && allLines.length > 0) nextQuoteStatus = 'declined';

  db.prepare(`
    UPDATE service_quotes
    SET status = ?,
        approved_at = CASE WHEN ? IN ('approved','partially_approved') AND approved_at = '' THEN ? ELSE approved_at END,
        updated_at = ?
    WHERE id = ?
  `).run(nextQuoteStatus, nextQuoteStatus, now, now, quoteId);

  // Sync DVI status to in_repair if customer approved work
  if (approvedCount > 0 && quote.dvi_id) {
    db.prepare("UPDATE dvi_inspections SET status = 'in_repair', updated_at = ? WHERE id = ? AND status IN ('inspection_complete','awaiting_approval')").run(now, quote.dvi_id);
    if (quote.work_order_id) {
      db.prepare("UPDATE work_orders SET status = 'in_repair', portal_status = 'in_repair' WHERE id = ?").run(quote.work_order_id);
    }
  }

  const updatedQuote = recalculateQuoteTotals(quoteId);
  return {
    ok: true,
    quote: updatedQuote,
    inventory_lock: lockResult,
    deferred_followup: deferredLogged
  };
}

async function updateDviRepairStatus(dviId, nextStatus, { updatedBy = 'Staff' } = {}) {
  if (!REPAIR_STATUS_FLOW.includes(nextStatus)) {
    const err = new Error(`Invalid repair status "${nextStatus}". Valid: ${REPAIR_STATUS_FLOW.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
  const dvi = db.prepare('SELECT * FROM dvi_inspections WHERE id = ?').get(dviId);
  if (!dvi) {
    const err = new Error('DVI inspection not found');
    err.statusCode = 404;
    throw err;
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE dvi_inspections SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now, dviId);
  if (dvi.work_order_id) {
    db.prepare('UPDATE work_orders SET status = ?, portal_status = ? WHERE id = ?').run(nextStatus, nextStatus, dvi.work_order_id);
  }

  const settings = getSettings();
  const statusLabel = REPAIR_STATUS_LABELS[nextStatus];
  const portalUrl = `${settings.canonical_domain || 'https://aldridgeautosupply.com'}/?portal_dvi=${encodeURIComponent(dvi.share_token)}`;
  const msg = `Aldridge Auto's Update (${dvi.dvi_number}): Your vehicle status is now "${statusLabel}". View live photos & quote: ${portalUrl} — Questions? Call ${settings.phone || '(253) 245-4206'}.`;

  await dispatchCustomerNotification({
    customerId: dvi.customer_id,
    dviId: dvi.id,
    channel: 'sms',
    eventType: `status_${nextStatus}`,
    subject: `Repair Status: ${statusLabel} (${dvi.dvi_number})`,
    body: msg
  });

  return hydrateDvi(dviId);
}

async function publishDviAndSendQuote({ dviId, role = 'office_manager', reviewerName = 'Maria' }) {
  assertRolePermission(role, 'can_publish_dvi');
  const dvi = hydrateDvi(dviId);
  if (!dvi) {
    const err = new Error('DVI inspection not found');
    err.statusCode = 404;
    throw err;
  }

  const unreviewedCount = dvi.items.filter((i) => !i.reviewed_by_tech).length;
  if (unreviewedCount > 0) {
    const err = new Error(`${unreviewedCount} AI/draft inspection item(s) still require technician/admin review before publishing to the customer.`);
    err.statusCode = 409;
    throw err;
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE dvi_inspections
    SET published_to_customer = 1,
        published_by = ?,
        published_at = ?,
        status = CASE WHEN status IN ('checked_in','inspection_complete') THEN 'awaiting_approval' ELSE status END,
        updated_at = ?
    WHERE id = ?
  `).run(reviewerName, now, now, dviId);

  if (dvi.work_order_id) {
    db.prepare("UPDATE work_orders SET status = 'awaiting_approval', portal_status = 'awaiting_approval', office_approved_by = ? WHERE id = ?").run(reviewerName, dvi.work_order_id);
  }

  if (dvi.quote) {
    db.prepare(`
      UPDATE service_quotes
      SET status = CASE WHEN status IN ('draft','pending_office_review') THEN 'sent_to_customer' ELSE status END,
          office_reviewed_by = ?,
          office_reviewed_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(reviewerName, now, now, dvi.quote.id);
    recalculateQuoteTotals(dvi.quote.id);
  }

  // Issue a fresh Customer Portal magic link and dispatch alert
  const magic = await issueCustomerMagicLink({ customerId: dvi.customer_id, dviId: dvi.id, quoteId: dvi.quote?.id || null });
  return {
    ok: true,
    dvi: hydrateDvi(dviId),
    portal_magic_link: magic.magic_link_url
  };
}

async function convertQuoteToRoAndInvoice({ quoteId, role = 'office_manager', reviewerName = 'Maria', finalizeInvoice = false }) {
  assertRolePermission(role, 'can_convert_invoice');
  const quote = hydrateQuote(quoteId);
  if (!quote) {
    const err = new Error('Quote not found');
    err.statusCode = 404;
    throw err;
  }
  const now = new Date().toISOString();

  // Lock any approved Option A 1-in-stock SKUs not yet locked
  const lockResults = [];
  for (const line of quote.lines) {
    if (line.customer_decision === 'approved' && line.selected_option === 'option_a_used_oem' && line.matched_inventory_sku && !line.inventory_locked) {
      const r = await lockInventorySkuAtomically(line.matched_inventory_sku, {
        reason: 'ro_conversion_lock',
        reference: `${quote.quote_number} / Line #${line.id}`
      });
      if (r.locked) {
        db.prepare('UPDATE quote_line_items SET inventory_locked = 1, inventory_locked_at = ?, updated_at = ? WHERE id = ?').run(now, now, line.id);
      }
      lockResults.push(r);
    }
  }

  const refreshed = recalculateQuoteTotals(quoteId);
  const invoiceNumber = refreshed.invoice_number || (finalizeInvoice ? `INV-${Math.floor(100000 + Math.random() * 899999)}` : '');
  const nextQuoteStatus = finalizeInvoice ? 'invoiced' : 'converted_to_ro';

  db.prepare(`
    UPDATE service_quotes
    SET status = ?,
        office_reviewed_by = ?,
        office_reviewed_at = COALESCE(NULLIF(office_reviewed_at, ''), ?),
        invoice_number = ?,
        invoiced_at = CASE WHEN ? != '' AND invoiced_at = '' THEN ? ELSE invoiced_at END,
        updated_at = ?
    WHERE id = ?
  `).run(nextQuoteStatus, reviewerName, now, invoiceNumber, invoiceNumber, now, now, quoteId);

  const approvedLines = refreshed.lines.filter((l) => l.customer_decision === 'approved');
  const effectiveLines = approvedLines.length ? approvedLines : refreshed.lines.filter((l) => l.customer_decision !== 'declined');
  const totalHours = Number(effectiveLines.reduce((s, l) => s + Number(l.labor_hours || 0), 0).toFixed(2));
  const partsUsed = effectiveLines.map((l) => ({
    sku: l.matched_inventory_sku || 'ORDER-PART',
    title: l.title,
    option: l.selected_option,
    price: l.part_price
  }));

  if (refreshed.work_order_id) {
    const nextRoStatus = finalizeInvoice ? 'ready_for_pickup' : 'in_repair';
    db.prepare(`
      UPDATE work_orders
      SET parts_used_json = ?,
          labor_hours = ?,
          labor_rate = ?,
          parts_total = ?,
          shop_supply_fee = ?,
          tax_amount = ?,
          total_estimate = ?,
          invoice_number = ?,
          office_approved_by = ?,
          status = ?,
          portal_status = ?
      WHERE id = ?
    `).run(
      JSON.stringify(partsUsed),
      totalHours,
      refreshed.labor_rate,
      refreshed.parts_subtotal,
      refreshed.shop_supply_fee,
      refreshed.tax_amount,
      refreshed.total_amount,
      invoiceNumber,
      reviewerName,
      nextRoStatus,
      nextRoStatus,
      refreshed.work_order_id
    );
  }

  if (refreshed.dvi_id) {
    const nextDviStatus = finalizeInvoice ? 'ready_for_pickup' : 'in_repair';
    await updateDviRepairStatus(refreshed.dvi_id, nextDviStatus, { updatedBy: reviewerName });
  }

  return {
    ok: true,
    quote: hydrateQuote(quoteId),
    invoice_number: invoiceNumber,
    invoice_url: `/api/quotes/${quoteId}/invoice`,
    inventory_locks: lockResults
  };
}

async function recordPortalPayment({ quoteId, amount, paymentType = 'deposit', method = 'card_online', customerId = null, receiptNotes = '' }) {
  const quote = hydrateQuote(quoteId);
  if (!quote) {
    const err = new Error('Quote / Invoice not found');
    err.statusCode = 404;
    throw err;
  }
  if (customerId && Number(quote.customer_id) !== Number(customerId)) {
    const err = new Error('Access denied for this payment');
    err.statusCode = 403;
    throw err;
  }
  const payAmount = Number(Number(amount || 0).toFixed(2));
  if (payAmount <= 0) {
    const err = new Error('Payment amount must be greater than $0.00');
    err.statusCode = 400;
    throw err;
  }
  const now = new Date().toISOString();
  const ref = 'PAY-' + Math.floor(100000 + Math.random() * 899999);

  // Paying a deposit also atomically locks any approved Option A 1-in-stock SKUs immediately!
  const lockResults = [];
  for (const line of quote.lines) {
    if (line.customer_decision === 'approved' && line.selected_option === 'option_a_used_oem' && line.matched_inventory_sku && !line.inventory_locked) {
      const r = await lockInventorySkuAtomically(line.matched_inventory_sku, {
        reason: 'deposit_paid_lock',
        reference: `${quote.quote_number} / ${ref}`
      });
      if (r.locked) {
        db.prepare('UPDATE quote_line_items SET inventory_locked = 1, inventory_locked_at = ?, updated_at = ? WHERE id = ?').run(now, now, line.id);
      }
      lockResults.push(r);
    }
  }

  db.prepare(`
    INSERT INTO portal_payments (payment_reference, quote_id, work_order_id, customer_id, payment_type, amount, method, status, receipt_notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?)
  `).run(ref, quote.id, quote.work_order_id || null, quote.customer_id, paymentType, payAmount, method, receiptNotes || `Online ${paymentType} via Customer Portal`, now);

  const nextDepositPaid = paymentType === 'deposit'
    ? Number((Number(quote.deposit_paid || 0) + payAmount).toFixed(2))
    : Number(quote.deposit_paid || 0);
  const nextAmountPaid = Number((Number(quote.amount_paid || 0) + payAmount).toFixed(2));
  const nextBalance = Number(Math.max(0, Number(quote.total_amount || 0) - nextAmountPaid).toFixed(2));

  db.prepare(`
    UPDATE service_quotes
    SET deposit_paid = ?,
        amount_paid = ?,
        balance_due = ?,
        updated_at = ?
    WHERE id = ?
  `).run(nextDepositPaid, nextAmountPaid, nextBalance, now, quote.id);

  if (quote.work_order_id) {
    db.prepare('UPDATE work_orders SET deposit_paid = ?, amount_paid = ? WHERE id = ?').run(nextDepositPaid, nextAmountPaid, quote.work_order_id);
  }
  db.prepare('UPDATE crm_customers SET total_spent = total_spent + ?, updated_at = ? WHERE id = ?').run(payAmount, now, quote.customer_id);

  await dispatchCustomerNotification({
    customerId: quote.customer_id,
    dviId: quote.dvi_id,
    quoteId: quote.id,
    channel: 'email',
    eventType: `payment_${paymentType}`,
    subject: `Payment Receipt ${ref} — Aldridge Auto's ($${payAmount.toFixed(2)})`,
    body: `Thank you! We received your ${paymentType} payment of $${payAmount.toFixed(2)} (Ref: ${ref}) for ${quote.invoice_number || quote.quote_number}. Remaining balance: $${nextBalance.toFixed(2)}.`
  });

  return {
    ok: true,
    payment_reference: ref,
    amount: payAmount,
    balance_due: nextBalance,
    inventory_locks: lockResults,
    quote: hydrateQuote(quote.id)
  };
}

/* ==================== CUSTOMER PORTAL AUTH (MAGIC LINK + PASSWORD) ==================== */
async function issueCustomerMagicLink({ customerId = null, email = '', phone = '', dviId = null, quoteId = null, baseUrl = '' }) {
  const settings = getSettings();
  let customer = null;
  if (customerId) {
    customer = db.prepare('SELECT * FROM crm_customers WHERE id = ?').get(customerId);
  } else {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const phoneNorm = normalizePhoneDigits(phone);
    if (cleanEmail) {
      customer = db.prepare('SELECT * FROM crm_customers WHERE LOWER(TRIM(email)) = ?').get(cleanEmail);
    }
    if (!customer && phoneNorm && phoneNorm.length >= 7) {
      customer = db.prepare('SELECT * FROM crm_customers WHERE phone_normalized = ?').get(phoneNorm);
    }
  }
  if (!customer) {
    const err = new Error('No customer profile found with that email or phone number.');
    err.statusCode = 404;
    throw err;
  }

  const magicToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE crm_customers SET portal_magic_token = ?, portal_magic_expires_at = ?, updated_at = ? WHERE id = ?').run(
    magicToken, expiresAt, new Date().toISOString(), customer.id
  );

  const origin = (baseUrl || settings.canonical_domain || 'https://aldridgeautosupply.com').replace(/\/+$/, '');
  const magicLinkUrl = `${origin}/?portal_token=${encodeURIComponent(magicToken)}`;

  await dispatchCustomerNotification({
    customerId: customer.id,
    dviId,
    quoteId,
    channel: customer.phone ? 'sms' : 'email',
    eventType: 'portal_magic_link',
    subject: "Your Aldridge Auto's Inspection & Garage Portal Link",
    body: `Aldridge Auto's Service & Repair: View your Digital Vehicle Inspection photos, approve repairs, or pay online here: ${magicLinkUrl} (expires in 72 hours).`
  });

  return {
    ok: true,
    customer_id: customer.id,
    customer_name: customer.name,
    magic_token: magicToken,
    magic_link_url: magicLinkUrl,
    expires_at: expiresAt
  };
}

function authenticateCustomerPortal({ magicToken = '', email = '', phone = '', password = '', setPassword = false, name = '' }) {
  let customer = null;

  if (magicToken) {
    customer = db.prepare('SELECT * FROM crm_customers WHERE portal_magic_token = ?').get(String(magicToken).trim());
    if (!customer) {
      const err = new Error('Invalid or expired portal magic link.');
      err.statusCode = 401;
      throw err;
    }
    if (customer.portal_magic_expires_at && new Date(customer.portal_magic_expires_at).getTime() < Date.now()) {
      const err = new Error('This portal magic link has expired. Request a fresh link below.');
      err.statusCode = 401;
      throw err;
    }
  } else {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const phoneNorm = normalizePhoneDigits(phone);
    if (cleanEmail) {
      customer = db.prepare('SELECT * FROM crm_customers WHERE LOWER(TRIM(email)) = ?').get(cleanEmail);
    }
    if (!customer && phoneNorm && phoneNorm.length >= 7) {
      customer = db.prepare('SELECT * FROM crm_customers WHERE phone_normalized = ?').get(phoneNorm);
    }

    if (setPassword) {
      if (!customer) {
        if (!cleanEmail && !phoneNorm) {
          const err = new Error('Enter your email or phone number to create a Customer Portal account.');
          err.statusCode = 400;
          throw err;
        }
        customer = upsertCustomer({
          name: name || 'Aldridge Customer',
          email: cleanEmail,
          phone: String(phone || '').trim(),
          source_pillar: 'customer_portal',
          tags: ['portal-member']
        });
      }
      const hashed = hashPassword(password);
      db.prepare('UPDATE crm_customers SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashed, new Date().toISOString(), customer.id);
      customer = db.prepare('SELECT * FROM crm_customers WHERE id = ?').get(customer.id);
    } else {
      if (!customer || !customer.password_hash || !verifyPassword(password, customer.password_hash)) {
        const err = new Error('Invalid email/phone or password. Use Magic Link login or set a password first.');
        err.statusCode = 401;
        throw err;
      }
    }
  }

  const sessionToken = createPortalSessionToken(customer.id);
  return {
    ok: true,
    session_token: sessionToken,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      referral_code: customer.referral_code
    }
  };
}

function getCustomerPortalDashboard(customerId) {
  const detail = getCrmCustomerDetail(customerId);
  if (!detail) return null;

  // Customers ONLY see DVI reports explicitly published to them!
  const publishedDvis = detail.dvis
    .filter((d) => Number(d.published_to_customer) === 1)
    .map((d) => hydrateDvi(d.id));

  const visibleQuotes = detail.quotes
    .filter((q) => q.status !== 'draft')
    .map((q) => hydrateQuote(q.id));

  return {
    customer: detail.customer,
    vehicles: detail.vehicles,
    dvis: publishedDvis,
    quotes: visibleQuotes,
    deferred_followups: detail.deferred_followups,
    notifications: detail.notifications
  };
}

function renderInvoiceHtml(quoteId) {
  const quote = hydrateQuote(quoteId);
  if (!quote) return null;
  const cfg = getSettings();
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const vehLabel = quote.vehicle
    ? `${quote.vehicle.year || ''} ${quote.vehicle.make || ''} ${quote.vehicle.model || ''} ${quote.vehicle.vin ? `(VIN: ${quote.vehicle.vin})` : ''} • ${Number(quote.vehicle.mileage || 0).toLocaleString()} mi`
    : 'Customer Vehicle';
  const rowsHtml = quote.lines.map((l) => `
    <tr>
      <td><strong>${esc(l.title)}</strong><div style="font-size:12px;color:#475569;">${esc(l.description || '')}${l.matched_inventory_sku ? ` • SKU: ${esc(l.matched_inventory_sku)}` : ''}</div></td>
      <td>${l.selected_option === 'option_a_used_oem' ? 'Option A: Verified In-Stock OEM Used' : 'Option B: New Order Part'}</td>
      <td style="text-transform:uppercase;font-weight:700;">${esc(l.customer_decision)}</td>
      <td style="text-align:right;">$${Number(l.part_price || 0).toFixed(2)}</td>
      <td style="text-align:right;">${Number(l.labor_hours || 0).toFixed(1)}h ($${Number(l.labor_total || 0).toFixed(2)})</td>
      <td style="text-align:right;"><strong>$${Number(l.line_subtotal || 0).toFixed(2)}</strong></td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(quote.invoice_number || quote.quote_number)} — ${esc(cfg.google_listing_name || "Aldridge Auto's Service & Repair")}</title>
<style>
  body { font-family: Arial, sans-serif; color: #0f172a; margin: 28px; max-width: 900px; }
  .head { display: flex; justify-content: space-between; border-bottom: 3px solid #0b1628; padding-bottom: 14px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  th, td { border-bottom: 1px solid #cbd5e1; padding: 9px 8px; text-align: left; }
  th { background: #f1f5f9; font-weight: 700; }
  .totals { margin-left: auto; width: 320px; font-size: 14px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
  .grand { border-top: 2px solid #0b1628; font-weight: 800; font-size: 17px; padding-top: 8px; margin-top: 6px; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <div class="no-print" style="margin-bottom:14px;">
    <button onclick="window.print()" style="background:#ea580c;color:#fff;border:none;padding:9px 16px;border-radius:6px;font-weight:700;cursor:pointer;">🖨 Print / Save PDF Invoice</button>
  </div>
  <div class="head">
    <div>
      <h1 style="margin:0;color:#0b1628;">${esc(cfg.google_listing_name || "Aldridge Auto's Service & Repair")}</h1>
      <div>${esc(cfg.street_address || '5115 66th St W, Bldg B')}, ${esc(cfg.city_display || 'University Place / Tacoma')}, ${esc(cfg.state || 'WA')} ${esc(cfg.zip || '98467')}</div>
      <div>Phone: ${esc(cfg.phone || '(253) 245-4206')} • ${esc(cfg.canonical_domain || 'https://aldridgeautosupply.com')}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:20px;font-weight:800;color:#ea580c;">${esc(quote.invoice_number || quote.quote_number)}</div>
      <div>Quote Ref: ${esc(quote.quote_number)}</div>
      <div>Date: ${esc((quote.invoiced_at || quote.updated_at || '').slice(0, 10))}</div>
      ${quote.office_reviewed_by ? `<div>Office Approval: <strong>${esc(quote.office_reviewed_by)}</strong></div>` : ''}
    </div>
  </div>
  <div style="display:flex;justify-content:space-between;background:#f8fafc;padding:12px 14px;border-radius:8px;margin-bottom:16px;font-size:13px;">
    <div><strong>Customer:</strong> ${esc(quote.customer?.name || 'Customer')}<br/>${esc(quote.customer?.phone || '')} ${quote.customer?.email ? `• ${esc(quote.customer.email)}` : ''}</div>
    <div style="text-align:right;"><strong>Vehicle:</strong> ${esc(vehLabel)}<br/><strong>Labor Rate:</strong> $${Number(quote.labor_rate || 135).toFixed(2)}/hr</div>
  </div>
  <table>
    <thead>
      <tr><th>Service / Part</th><th>Option</th><th>Decision</th><th style="text-align:right;">Parts</th><th style="text-align:right;">Labor</th><th style="text-align:right;">Subtotal</th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="totals">
    <div><span>Parts Subtotal:</span><span>$${Number(quote.parts_subtotal || 0).toFixed(2)}</span></div>
    <div><span>Labor Subtotal ($${Number(quote.labor_rate || 135).toFixed(2)}/hr):</span><span>$${Number(quote.labor_subtotal || 0).toFixed(2)}</span></div>
    <div><span>Shop Supplies (${Math.round(Number(quote.shop_supply_fee_rate || 0.07) * 100)}%, cap $${Number(cfg.shop_supply_fee_cap || 45).toFixed(0)}):</span><span>$${Number(quote.shop_supply_fee || 0).toFixed(2)}</span></div>
    <div><span>Tacoma / University Place WA Tax (${(Number(quote.tax_rate || 0.101) * 100).toFixed(1)}%):</span><span>$${Number(quote.tax_amount || 0).toFixed(2)}</span></div>
    <div class="grand"><span>Total:</span><span>$${Number(quote.total_amount || 0).toFixed(2)}</span></div>
    <div><span>Amount Paid (incl. Deposits):</span><span>-$${Number(quote.amount_paid || 0).toFixed(2)}</span></div>
    <div style="font-weight:800;color:#b91c1c;"><span>Balance Due:</span><span>$${Number(quote.balance_due || 0).toFixed(2)}</span></div>
  </div>
  <p style="margin-top:24px;font-size:11px;color:#475569;border-top:1px solid #e2e8f0;padding-top:10px;">
    Aldridge Auto's Service &amp; Repair • University Place, WA 98467 • Tested OEM used parts carry our defect-only shop installation backing. Declined safety/maintenance recommendations are logged to your Customer Portal for 60/90-day reminder follow-up.
  </p>
</body>
</html>`;
}

module.exports = {
  DVI_MEDIA_DIR,
  REPAIR_STATUS_FLOW,
  REPAIR_STATUS_LABELS,
  STAFF_ROLES,
  resolveStaffRole,
  assertRolePermission,
  hashPassword,
  verifyPassword,
  createPortalSessionToken,
  verifyPortalSessionToken,
  dispatchCustomerNotification,
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
};
