/**
 * 3-Tier Recurring Membership Funnel (Stripe Billing + CRM),
 * Abandoned Cart 15-Min Urgency & 24-Hr Bay Combo Recovery Engine,
 * Strict Employee Backend Authentication (HMAC Session Cookie + Bearer/Header Token),
 * and Instant Counter Member Lookup (Phone / Email / VIN / Member Code).
 */
const crypto = require('node:crypto');
const { db, getSettings, normalizePhoneDigits, upsertCustomer, logSync } = require('./db');

const MEMBERSHIP_TIERS = {
  garage_club_basic: {
    key: 'garage_club_basic',
    name: 'Garage Club Basic',
    short_name: 'Garage Club',
    badge: 'FREE ACCOUNT',
    monthly_price_usd: 0,
    billing_label: '$0 / mo (Free)',
    parts_discount_pct: 0,
    parts_discount_high_pct: 0,
    labor_discount_pct: 10,
    first_labor_only: true,
    perks: [
      'Save vehicles & 17-digit VINs in My Garage',
      '10% off your first certified $174.99/hr bay labor booking',
      'Instant SMS & Email price-drop and rare-donor stock alerts'
    ]
  },
  vip_driver_pass: {
    key: 'vip_driver_pass',
    name: 'VIP Driver / Fleet Pass',
    short_name: 'VIP Driver',
    badge: 'MOST POPULAR',
    monthly_price_usd: 19.99,
    billing_label: '$19.99 / mo',
    parts_discount_pct: 15,
    parts_discount_high_pct: 15,
    labor_discount_pct: 10,
    first_labor_only: false,
    perks: [
      '15% off EVERY photographed OEM part (instant unlock)',
      '10% off certified $174.99/hr shop bay installation labor',
      'Free Tacoma / University Place (98467) local delivery',
      'Priority same-day bay slots + free digital DVI health checks'
    ]
  },
  b2b_dealer_pro: {
    key: 'b2b_dealer_pro',
    name: 'B2B Partner Shop / Dealer Pro',
    short_name: 'Shop Pro Wholesale',
    badge: 'WHOLESALE PRO',
    monthly_price_usd: 79.0,
    billing_label: '$79.00 / mo',
    parts_discount_pct: 20,
    parts_discount_high_pct: 25,
    labor_discount_pct: 15,
    first_labor_only: false,
    perks: [
      '20%–25% wholesale tier pricing across all OEM SKUs (25% on $250+ assemblies)',
      'Instant 4-hour part hold before public buyers',
      'Same-day Pierce County courier drop-off',
      'Priority commercial bay & U-Haul #046117 dispatch access'
    ]
  }
};

function computeMemberPriceForPart(partPrice, tierKey) {
  const retail = Number(partPrice || 0);
  const tier = MEMBERSHIP_TIERS[tierKey] || MEMBERSHIP_TIERS.garage_club_basic;
  const pct = retail >= 250 ? tier.parts_discount_high_pct : tier.parts_discount_pct;
  const discounted = Number((retail * (1 - pct / 100)).toFixed(2));
  return {
    retail_price: retail,
    discount_pct: pct,
    member_price: discounted,
    savings_usd: Number((retail - discounted).toFixed(2))
  };
}

function generateMemberCode(tierKey) {
  const prefix = tierKey === 'b2b_dealer_pro' ? 'B2B' : (tierKey === 'vip_driver_pass' ? 'VIP' : 'GAR');
  return `ALD-${prefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/* ==================== STRICT EMPLOYEE BACKEND AUTHENTICATION ==================== */
function getEmployeeAuthSecret() {
  return (
    process.env.EMPLOYEE_SESSION_SECRET ||
    process.env.SHOPIFY_WEBHOOK_SECRET ||
    crypto.createHash('sha256').update(`aldridge-staff-auth:${process.env.SHOPIFY_ADMIN_TOKEN || 'local-hub-secret-98467'}`).digest('hex')
  );
}

function getConfiguredStaffCredentials() {
  const settings = getSettings();
  const primaryPin = String(
    process.env.EMPLOYEE_ADMIN_PASSWORD ||
    process.env.EMPLOYEE_STAFF_PIN ||
    settings.staff_access_pin ||
    '98467'
  ).trim();
  const techPin = String(process.env.EMPLOYEE_TECH_PIN || '').trim();
  return { primaryPin, techPin };
}

function verifyStaffCredentials(pinOrPassword, staffName = '', role = 'Owner/Admin') {
  const supplied = String(pinOrPassword || '').trim();
  if (!supplied) return { ok: false, error: 'Staff PIN or password is required.' };
  const { primaryPin, techPin } = getConfiguredStaffCredentials();

  const safeEqual = (a, b) => {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  };

  if (safeEqual(supplied, primaryPin)) {
    return {
      ok: true,
      staff_name: String(staffName || '').trim() || 'Chris Aldridge',
      role: ['Owner/Admin', 'Office Manager', 'Technician'].includes(role) ? role : 'Owner/Admin'
    };
  }
  if (techPin && safeEqual(supplied, techPin)) {
    return {
      ok: true,
      staff_name: String(staffName || '').trim() || 'Shop Technician',
      role: 'Technician'
    };
  }
  return { ok: false, error: 'Invalid Staff PIN / Password. Access to Employee Backend denied.' };
}

function issueEmployeeToken({ staff_name, role }) {
  const payload = {
    staff_name: String(staff_name || 'Aldridge Staff'),
    role: String(role || 'Owner/Admin'),
    iat: Date.now(),
    exp: Date.now() + 12 * 60 * 60 * 1000 // 12-hour shift session
  };
  const bodyB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getEmployeeAuthSecret()).update(bodyB64).digest('base64url');
  return `${bodyB64}.${sig}`;
}

function parseCookies(cookieHeader) {
  const out = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function verifyEmployeeToken(token) {
  const raw = String(token || '').trim();
  if (!raw || !raw.includes('.')) return null;
  const [bodyB64, sig] = raw.split('.');
  if (!bodyB64 || !sig) return null;
  const expected = crypto.createHmac('sha256', getEmployeeAuthSecret()).update(bodyB64).digest('base64url');
  const ba = Buffer.from(sig);
  const bb = Buffer.from(expected);
  if (ba.length !== bb.length || !crypto.timingSafeEqual(ba, bb)) return null;
  try {
    const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
    if (!payload?.exp || Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function verifyEmployeeRequest(req) {
  const authHdr = String(req.headers['authorization'] || '').trim();
  if (authHdr.toLowerCase().startsWith('bearer ')) {
    const p = verifyEmployeeToken(authHdr.slice(7).trim());
    if (p) return p;
  }
  const hdrToken = String(req.headers['x-employee-token'] || '').trim();
  if (hdrToken) {
    const p = verifyEmployeeToken(hdrToken);
    if (p) return p;
  }
  const cookies = parseCookies(req.headers['cookie'] || '');
  if (cookies.aldridge_emp_session) {
    const p = verifyEmployeeToken(cookies.aldridge_emp_session);
    if (p) return p;
  }
  return null;
}

function buildEmployeeSessionCookie(token, isHttps = false) {
  const parts = [
    `aldridge_emp_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${12 * 60 * 60}`
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function buildClearEmployeeCookie() {
  return 'aldridge_emp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

/* ==================== 3-TIER RECURRING MEMBERSHIPS + STRIPE CHECKOUT ==================== */
async function createStripeSubscriptionCheckout({ tier, email, fullName, memberCode, baseUrl }) {
  const stripeKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!stripeKey || tier.monthly_price_usd <= 0) {
    return { configured: false, checkout_url: '', session_id: '' };
  }
  const origin = String(baseUrl || 'https://aldridgeautosupply.com').replace(/\/+$/, '');
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('success_url', `${origin}/?member_joined=${encodeURIComponent(memberCode)}&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${origin}/?member_canceled=1`);
  if (email) form.set('customer_email', email);
  form.set('metadata[member_code]', memberCode);
  form.set('metadata[tier_key]', tier.key);
  form.set('metadata[full_name]', fullName);
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', 'usd');
  form.set('line_items[0][price_data][unit_amount]', String(Math.round(tier.monthly_price_usd * 100)));
  form.set('line_items[0][price_data][recurring][interval]', 'month');
  form.set('line_items[0][price_data][product_data][name]', `Aldridge Auto's — ${tier.name}`);
  form.set('line_items[0][price_data][product_data][description]', tier.perks.join(' • '));

  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form.toString(),
    signal: AbortSignal.timeout(12000)
  });
  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => '');
    throw new Error(`Stripe Checkout failed (HTTP ${resp.status}): ${errTxt.slice(0, 180)}`);
  }
  const data = await resp.json();
  return {
    configured: true,
    checkout_url: data.url || '',
    session_id: data.id || ''
  };
}

async function createMembershipSignupAndBilling(payload = {}, { baseUrl = 'https://aldridgeautosupply.com' } = {}) {
  const fullName = String(payload.full_name || payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const phone = String(payload.phone || '').trim();
  const phoneDigits = normalizePhoneDigits(phone);
  const smsOptIn = payload.sms_opt_in === false || payload.sms_opt_in === 0 ? 0 : 1;
  const tierKey = MEMBERSHIP_TIERS[payload.tier_key] ? payload.tier_key : 'garage_club_basic';
  const tier = MEMBERSHIP_TIERS[tierKey];

  const vehicleYear = String(payload.vehicle_year || '').trim();
  const vehicleMake = String(payload.vehicle_make || '').trim();
  const vehicleModel = String(payload.vehicle_model || '').trim();
  const vehicleVin = String(payload.vehicle_vin || '').trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17);

  if (!fullName) {
    const err = new Error('Full Name is required to unlock Member Pricing.');
    err.statusCode = 400;
    throw err;
  }
  if (!email && !phoneDigits) {
    const err = new Error('Please enter an Email or Mobile Phone number so we can save your Garage Club account.');
    err.statusCode = 400;
    throw err;
  }

  const now = new Date().toISOString();

  // 1. Deduplicated CRM lead creation
  const upsertedCust = upsertCustomer({
    name: fullName,
    email,
    phone,
    sms_opt_in: smsOptIn,
    email_opt_in: email ? 1 : 0,
    customer_type: tierKey === 'b2b_dealer_pro' ? 'b2b_shop' : (tierKey === 'vip_driver_pass' ? 'vip_member' : 'garage_club'),
    notes: `Joined ${tier.name} (${tier.billing_label})${vehicleYear || vehicleMake ? ` | Vehicle: ${[vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ')}` : ''}${vehicleVin ? ` | VIN: ${vehicleVin}` : ''}`
  });
  const customerId = typeof upsertedCust === 'object' ? (Number(upsertedCust?.id || 0) || null) : (Number(upsertedCust || 0) || null);

  // 2. Save vehicle into My Garage (`crm_vehicles`) if vehicle info provided
  if (customerId && (vehicleMake || vehicleModel || vehicleVin)) {
    try {
      const yrNum = parseInt(vehicleYear, 10) || 0;
      const existingVeh = vehicleVin
        ? db.prepare('SELECT id FROM crm_vehicles WHERE customer_id = ? AND UPPER(vin) = ?').get(customerId, vehicleVin)
        : db.prepare('SELECT id FROM crm_vehicles WHERE customer_id = ? AND year = ? AND LOWER(make) = LOWER(?) AND LOWER(model) = LOWER(?)').get(customerId, yrNum, vehicleMake, vehicleModel);
      if (!existingVeh) {
        db.prepare(`
          INSERT INTO crm_vehicles (customer_id, vin, year, make, model, trim, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)
        `).run(customerId, vehicleVin, yrNum, vehicleMake, vehicleModel, `Added via ${tier.name} signup`, now, now);
      }
    } catch (_) {}
  }

  // 3. Upsert membership by email or phone_digits
  let existing = null;
  if (email) {
    existing = db.prepare('SELECT * FROM memberships WHERE LOWER(email) = ?').get(email);
  }
  if (!existing && phoneDigits) {
    existing = db.prepare('SELECT * FROM memberships WHERE phone_digits = ?').get(phoneDigits);
  }

  const memberCode = existing?.member_code || generateMemberCode(tierKey);

  // 4. Optional live Stripe Checkout Subscription for paid tiers
  let stripeInfo = { configured: false, checkout_url: '', session_id: '' };
  if (tier.monthly_price_usd > 0) {
    try {
      stripeInfo = await createStripeSubscriptionCheckout({
        tier,
        email,
        fullName,
        memberCode,
        baseUrl
      });
    } catch (err) {
      logSync('outbound', 'stripe_billing', 'checkout_error', memberCode, 'error', err.message);
    }
  }

  const billingMode = tier.monthly_price_usd === 0
    ? 'free_account'
    : (stripeInfo.configured ? 'stripe_checkout' : 'counter_or_stripe_ready');
  const status = stripeInfo.configured ? 'pending_payment' : 'active';

  if (existing) {
    db.prepare(`
      UPDATE memberships
      SET customer_id = COALESCE(?, customer_id),
          full_name = ?,
          email = COALESCE(NULLIF(?, ''), email),
          phone = COALESCE(NULLIF(?, ''), phone),
          phone_digits = COALESCE(NULLIF(?, ''), phone_digits),
          sms_opt_in = ?,
          vehicle_year = COALESCE(NULLIF(?, ''), vehicle_year),
          vehicle_make = COALESCE(NULLIF(?, ''), vehicle_make),
          vehicle_model = COALESCE(NULLIF(?, ''), vehicle_model),
          vehicle_vin = COALESCE(NULLIF(?, ''), vehicle_vin),
          tier_key = ?,
          monthly_price_usd = ?,
          parts_discount_pct = ?,
          labor_discount_pct = ?,
          status = ?,
          billing_mode = ?,
          stripe_checkout_session_id = COALESCE(NULLIF(?, ''), stripe_checkout_session_id),
          updated_at = ?
      WHERE id = ?
    `).run(
      customerId, fullName, email, phone, phoneDigits, smsOptIn,
      vehicleYear, vehicleMake, vehicleModel, vehicleVin,
      tier.key, tier.monthly_price_usd, tier.parts_discount_pct, tier.labor_discount_pct,
      status, billingMode, stripeInfo.session_id, now, existing.id
    );
  } else {
    db.prepare(`
      INSERT INTO memberships (
        org_id, customer_id, member_code, full_name, email, phone, phone_digits, sms_opt_in,
        vehicle_year, vehicle_make, vehicle_model, vehicle_vin,
        tier_key, monthly_price_usd, parts_discount_pct, labor_discount_pct,
        status, billing_mode, stripe_checkout_session_id, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerId, memberCode, fullName, email, phone, phoneDigits, smsOptIn,
      vehicleYear, vehicleMake, vehicleModel, vehicleVin,
      tier.key, tier.monthly_price_usd, tier.parts_discount_pct, tier.labor_discount_pct,
      status, billingMode, stripeInfo.session_id, now, now
    );
  }

  const member = db.prepare('SELECT * FROM memberships WHERE member_code = ?').get(memberCode);
  logSync(
    'inbound',
    'membership_funnel',
    'member_joined',
    memberCode,
    'success',
    `${fullName} enrolled in ${tier.name} ($${tier.monthly_price_usd.toFixed(2)}/mo, billing=${billingMode}, status=${status}).`
  );

  return {
    ok: true,
    member: formatMemberPublic(member),
    tier,
    stripe_checkout_url: stripeInfo.checkout_url || '',
    stripe_configured: stripeInfo.configured
  };
}

function formatMemberPublic(row) {
  if (!row) return null;
  const tier = MEMBERSHIP_TIERS[row.tier_key] || MEMBERSHIP_TIERS.garage_club_basic;
  return {
    id: row.id,
    member_code: row.member_code,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    sms_opt_in: Boolean(row.sms_opt_in),
    vehicle_year: row.vehicle_year,
    vehicle_make: row.vehicle_make,
    vehicle_model: row.vehicle_model,
    vehicle_vin: row.vehicle_vin,
    tier_key: row.tier_key,
    tier_name: tier.name,
    tier_short_name: tier.short_name,
    monthly_price_usd: Number(row.monthly_price_usd || tier.monthly_price_usd),
    parts_discount_pct: Number(row.parts_discount_pct ?? tier.parts_discount_pct),
    parts_discount_high_pct: Number(tier.parts_discount_high_pct ?? tier.parts_discount_pct),
    labor_discount_pct: Number(row.labor_discount_pct ?? tier.labor_discount_pct),
    status: row.status,
    billing_mode: row.billing_mode,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function lookupMemberPublic(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const digits = normalizePhoneDigits(q);
  const lower = q.toLowerCase();
  const upper = q.toUpperCase();
  const row = db.prepare(`
    SELECT * FROM memberships
    WHERE UPPER(member_code) = ?
       OR LOWER(email) = ?
       OR (? != '' AND phone_digits = ?)
       OR (LENGTH(?) >= 8 AND UPPER(vehicle_vin) = ?)
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(upper, lower, digits, digits, upper, upper);
  return formatMemberPublic(row);
}

function handleStripeWebhookEvent(event) {
  const type = String(event?.type || '');
  const obj = event?.data?.object || {};
  const now = new Date().toISOString();

  if (type === 'checkout.session.completed') {
    const memberCode = obj?.metadata?.member_code || '';
    const subId = String(obj?.subscription || '');
    const custId = String(obj?.customer || '');
    if (memberCode) {
      db.prepare(`
        UPDATE memberships
        SET status = 'active',
            stripe_customer_id = COALESCE(NULLIF(?, ''), stripe_customer_id),
            stripe_subscription_id = COALESCE(NULLIF(?, ''), stripe_subscription_id),
            updated_at = ?
        WHERE member_code = ?
      `).run(custId, subId, now, memberCode);
      logSync('inbound', 'stripe_webhook', 'subscription_activated', memberCode, 'success', `Stripe checkout completed (sub=${subId}).`);
      return { ok: true, handled: true, member_code: memberCode };
    }
  }
  if (type === 'customer.subscription.deleted' || type === 'invoice.payment_failed') {
    const subId = String(obj?.subscription || obj?.id || '');
    if (subId) {
      const nextStatus = type === 'customer.subscription.deleted' ? 'canceled' : 'past_due';
      db.prepare('UPDATE memberships SET status = ?, updated_at = ? WHERE stripe_subscription_id = ?').run(nextStatus, now, subId);
      logSync('inbound', 'stripe_webhook', type, subId, 'success', `Updated membership status to ${nextStatus}.`);
      return { ok: true, handled: true, status: nextStatus };
    }
  }
  return { ok: true, handled: false, type };
}

function listAllMemberships() {
  const rows = db.prepare('SELECT * FROM memberships ORDER BY updated_at DESC LIMIT 250').all();
  const formatted = rows.map(formatMemberPublic);
  const activePaid = formatted.filter((m) => m.status === 'active' && m.monthly_price_usd > 0);
  const mrr = Number(activePaid.reduce((s, m) => s + m.monthly_price_usd, 0).toFixed(2));
  return {
    total_members: formatted.length,
    garage_club_count: formatted.filter((m) => m.tier_key === 'garage_club_basic').length,
    vip_driver_count: formatted.filter((m) => m.tier_key === 'vip_driver_pass').length,
    b2b_pro_count: formatted.filter((m) => m.tier_key === 'b2b_dealer_pro').length,
    active_recurring_mrr_usd: mrr,
    members: formatted
  };
}

function updateMembershipTierByStaff(id, patch = {}) {
  const row = db.prepare('SELECT * FROM memberships WHERE id = ?').get(Number(id));
  if (!row) return null;
  const tierKey = MEMBERSHIP_TIERS[patch.tier_key] ? patch.tier_key : row.tier_key;
  const tier = MEMBERSHIP_TIERS[tierKey];
  const nextStatus = ['active', 'pending_payment', 'past_due', 'canceled'].includes(patch.status) ? patch.status : row.status;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE memberships
    SET tier_key = ?, monthly_price_usd = ?, parts_discount_pct = ?, labor_discount_pct = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(tier.key, tier.monthly_price_usd, tier.parts_discount_pct, tier.labor_discount_pct, nextStatus, now, row.id);
  return formatMemberPublic(db.prepare('SELECT * FROM memberships WHERE id = ?').get(row.id));
}

/* ==================== COUNTER MEMBER LOOKUP (PHONE / EMAIL / VIN / NAME) ==================== */
function lookupMemberForCounter(query) {
  const q = String(query || '').trim();
  if (!q) {
    return { ok: true, query: '', matches: [] };
  }
  const like = `%${q.toLowerCase()}%`;
  const digits = normalizePhoneDigits(q);
  const digitsLike = digits ? `%${digits}%` : '__NO_DIGITS__';

  const memberRows = db.prepare(`
    SELECT * FROM memberships
    WHERE LOWER(full_name) LIKE ?
       OR LOWER(email) LIKE ?
       OR LOWER(member_code) LIKE ?
       OR LOWER(vehicle_vin) LIKE ?
       OR phone_digits LIKE ?
    ORDER BY updated_at DESC
    LIMIT 20
  `).all(like, like, like, like, digitsLike);

  const crmRows = db.prepare(`
    SELECT c.*,
      (SELECT GROUP_CONCAT(TRIM(year || ' ' || make || ' ' || model || CASE WHEN vin != '' THEN ' [' || vin || ']' ELSE '' END), ' ; ')
       FROM crm_vehicles cv WHERE cv.customer_id = c.id) AS vehicles_summary
    FROM crm_customers c
    WHERE LOWER(c.name) LIKE ?
       OR LOWER(c.email) LIKE ?
       OR c.phone LIKE ?
       OR EXISTS (SELECT 1 FROM crm_vehicles cv WHERE cv.customer_id = c.id AND LOWER(cv.vin) LIKE ?)
    ORDER BY c.created_at DESC
    LIMIT 20
  `).all(like, like, `%${q}%`, like);

  const byKey = new Map();
  for (const m of memberRows) {
    const fm = formatMemberPublic(m);
    const key = (fm.email || fm.phone || fm.member_code).toLowerCase();
    byKey.set(key, {
      source: 'membership',
      customer_id: m.customer_id || null,
      member: fm,
      vehicles: [fm.vehicle_year, fm.vehicle_make, fm.vehicle_model].filter(Boolean).join(' ') + (fm.vehicle_vin ? ` (VIN: ${fm.vehicle_vin})` : ''),
      abandoned_carts_count: 0
    });
  }
  for (const c of crmRows) {
    const key = String(c.email || c.phone || c.name).toLowerCase();
    if (byKey.has(key)) {
      const ex = byKey.get(key);
      if (c.vehicles_summary && !ex.vehicles) ex.vehicles = c.vehicles_summary;
      ex.customer_id = ex.customer_id || c.id;
    } else {
      byKey.set(key, {
        source: 'crm_only',
        customer_id: c.id,
        member: {
          member_code: 'UNENROLLED',
          full_name: c.name,
          email: c.email || '',
          phone: c.phone || '',
          tier_key: 'garage_club_basic',
          tier_name: 'Walk-In / Not Enrolled Yet',
          tier_short_name: 'Public Retail',
          parts_discount_pct: 0,
          parts_discount_high_pct: 0,
          labor_discount_pct: 0,
          status: 'unenrolled'
        },
        vehicles: c.vehicles_summary || '',
        abandoned_carts_count: 0
      });
    }
  }

  const matches = Array.from(byKey.values()).map((entry) => {
    const em = String(entry.member.email || '').toLowerCase();
    const pd = normalizePhoneDigits(entry.member.phone || '');
    const ac = db.prepare(`
      SELECT COUNT(*) c FROM abandoned_carts
      WHERE status IN ('open', 'alert_15m_sent', 'combo_24h_sent')
        AND ((? != '' AND LOWER(email) = ?) OR (? != '' AND phone_digits = ?))
    `).get(em, em, pd, pd);
    entry.abandoned_carts_count = Number(ac?.c || 0);
    return entry;
  });

  return { ok: true, query: q, count: matches.length, matches };
}

/* ==================== ABANDONED CART 15-MIN URGENCY & 24-HR BAY COMBO RECOVERY ==================== */
function upsertAbandonedCart(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    return { ok: true, skipped: true, reason: 'empty_cart' };
  }
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const alert15Due = new Date(nowMs + 15 * 60 * 1000).toISOString();
  const combo24Due = new Date(nowMs + 24 * 60 * 60 * 1000).toISOString();

  const cartToken = String(payload.cart_token || '').trim() || `CART-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const customerName = String(payload.customer_name || payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const phone = String(payload.phone || '').trim();
  const phoneDigits = normalizePhoneDigits(phone);
  const pushSubJson = payload.push_subscription ? JSON.stringify(payload.push_subscription) : '';
  const fulfillmentMode = String(payload.fulfillment_mode || 'ship_calculated');
  const subtotal = Number(
    payload.subtotal_usd ?? items.reduce((s, it) => s + Number(it.unit_price || it.price_we_pull || 0) * Number(it.qty || 1), 0)
  );

  const existing = db.prepare('SELECT * FROM abandoned_carts WHERE cart_token = ?').get(cartToken);
  if (existing && existing.status !== 'recovered') {
    db.prepare(`
      UPDATE abandoned_carts
      SET customer_name = COALESCE(NULLIF(?, ''), customer_name),
          email = COALESCE(NULLIF(?, ''), email),
          phone = COALESCE(NULLIF(?, ''), phone),
          phone_digits = COALESCE(NULLIF(?, ''), phone_digits),
          push_subscription_json = COALESCE(NULLIF(?, ''), push_subscription_json),
          items_json = ?,
          subtotal_usd = ?,
          fulfillment_mode = ?,
          updated_at = ?
      WHERE id = ?
    `).run(customerName, email, phone, phoneDigits, pushSubJson, JSON.stringify(items), subtotal, fulfillmentMode, nowIso, existing.id);
  } else if (!existing) {
    db.prepare(`
      INSERT INTO abandoned_carts (
        org_id, cart_token, customer_name, email, phone, phone_digits,
        push_subscription_json, items_json, subtotal_usd, fulfillment_mode,
        status, alert_15m_due_at, combo_24h_due_at, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `).run(
      cartToken, customerName, email, phone, phoneDigits, pushSubJson,
      JSON.stringify(items), subtotal, fulfillmentMode, alert15Due, combo24Due, nowIso, nowIso
    );
  }

  const saved = db.prepare('SELECT * FROM abandoned_carts WHERE cart_token = ?').get(cartToken);
  return {
    ok: true,
    cart_token: cartToken,
    cart: formatAbandonedCart(saved)
  };
}

function markAbandonedCartRecovered({ cart_token = '', email = '', phone = '' } = {}) {
  const now = new Date().toISOString();
  const digits = normalizePhoneDigits(phone);
  if (cart_token) {
    db.prepare("UPDATE abandoned_carts SET status = 'recovered', updated_at = ? WHERE cart_token = ?").run(now, String(cart_token).trim());
  }
  if (email || digits) {
    db.prepare(`
      UPDATE abandoned_carts
      SET status = 'recovered', updated_at = ?
      WHERE status IN ('open', 'alert_15m_sent', 'combo_24h_sent')
        AND ((? != '' AND LOWER(email) = ?) OR (? != '' AND phone_digits = ?))
    `).run(now, String(email || '').toLowerCase(), String(email || '').toLowerCase(), digits, digits);
  }
  return { ok: true };
}

function formatAbandonedCart(row) {
  if (!row) return null;
  let items = [];
  try { items = JSON.parse(row.items_json || '[]'); } catch (_) {}
  const skuList = items.map((i) => i.sku).filter(Boolean);
  const firstTitle = items[0]?.title || skuList[0] || 'Single-Unit OEM Part';
  return {
    id: row.id,
    cart_token: row.cart_token,
    customer_name: row.customer_name || 'Guest Shopper',
    email: row.email || '',
    phone: row.phone || '',
    has_push_subscription: Boolean(row.push_subscription_json),
    items,
    skus: skuList,
    subtotal_usd: Number(row.subtotal_usd || 0),
    fulfillment_mode: row.fulfillment_mode,
    status: row.status,
    alert_15m_due_at: row.alert_15m_due_at,
    alert_15m_sent_at: row.alert_15m_sent_at,
    combo_24h_due_at: row.combo_24h_due_at,
    combo_24h_sent_at: row.combo_24h_sent_at,
    recovery_notes: row.recovery_notes || '',
    urgency_sms_copy: `Aldridge Auto's (UP/Tacoma): Only 1 in stock for "${firstTitle}" at our University Place shop — reply HOLD or complete checkout at https://aldridgeautosupply.com to lock it in before another buyer grabs it!`,
    combo_24h_copy: `Aldridge Auto's Bay Combo Offer: Still need "${firstTitle}"? Complete checkout today and take $15 OFF certified bay installation at 5115 66th St W, Bldg B (or FREE 98467 counter pickup)!`,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function listAbandonedCarts() {
  const rows = db.prepare('SELECT * FROM abandoned_carts ORDER BY updated_at DESC LIMIT 100').all();
  const formatted = rows.map(formatAbandonedCart);
  return {
    total: formatted.length,
    open_count: formatted.filter((c) => c.status === 'open').length,
    alert_15m_sent_count: formatted.filter((c) => c.status === 'alert_15m_sent').length,
    combo_24h_sent_count: formatted.filter((c) => c.status === 'combo_24h_sent').length,
    recovered_count: formatted.filter((c) => c.status === 'recovered').length,
    at_risk_revenue_usd: Number(
      formatted
        .filter((c) => ['open', 'alert_15m_sent', 'combo_24h_sent'].includes(c.status))
        .reduce((s, c) => s + c.subtotal_usd, 0)
        .toFixed(2)
    ),
    carts: formatted
  };
}

function triggerAbandonedCartRecovery(cartId, action = 'alert_15m') {
  const row = db.prepare('SELECT * FROM abandoned_carts WHERE id = ?').get(Number(cartId));
  if (!row) return null;
  const now = new Date().toISOString();
  const cart = formatAbandonedCart(row);

  if (action === 'alert_15m') {
    const note = `[${now}] 15-min urgency alert dispatched (${cart.phone || cart.email || 'push/browser'}): ${cart.urgency_sms_copy}`;
    db.prepare(`
      UPDATE abandoned_carts
      SET status = 'alert_15m_sent', alert_15m_sent_at = ?, recovery_notes = ?, updated_at = ?
      WHERE id = ?
    `).run(now, note, now, row.id);
    logSync('outbound', 'abandoned_cart_recovery', 'urgency_15m_alert', cart.skus[0] || cart.cart_token, 'success', note);
  } else if (action === 'combo_24h') {
    const note = `[${now}] 24-hr $15-Off Bay Install Combo dispatched (${cart.phone || cart.email || 'push/browser'}): ${cart.combo_24h_copy}`;
    db.prepare(`
      UPDATE abandoned_carts
      SET status = 'combo_24h_sent', combo_24h_sent_at = ?, recovery_notes = ?, updated_at = ?
      WHERE id = ?
    `).run(now, note, now, row.id);
    logSync('outbound', 'abandoned_cart_recovery', 'bay_combo_24h_offer', cart.skus[0] || cart.cart_token, 'success', note);
  } else if (action === 'recovered' || action === 'dismissed') {
    db.prepare('UPDATE abandoned_carts SET status = ?, updated_at = ? WHERE id = ?').run(action, now, row.id);
  }

  return formatAbandonedCart(db.prepare('SELECT * FROM abandoned_carts WHERE id = ?').get(row.id));
}

function processDueAbandonedCartAlerts() {
  const nowIso = new Date().toISOString();
  let triggered15m = 0;
  let triggered24h = 0;

  const due15m = db.prepare(`
    SELECT id FROM abandoned_carts
    WHERE status = 'open'
      AND alert_15m_sent_at = ''
      AND alert_15m_due_at <= ?
      AND (email != '' OR phone_digits != '' OR push_subscription_json != '')
  `).all(nowIso);
  for (const r of due15m) {
    triggerAbandonedCartRecovery(r.id, 'alert_15m');
    triggered15m++;
  }

  const due24h = db.prepare(`
    SELECT id FROM abandoned_carts
    WHERE status = 'alert_15m_sent'
      AND combo_24h_sent_at = ''
      AND combo_24h_due_at <= ?
      AND (email != '' OR phone_digits != '' OR push_subscription_json != '')
  `).all(nowIso);
  for (const r of due24h) {
    triggerAbandonedCartRecovery(r.id, 'combo_24h');
    triggered24h++;
  }

  return { triggered15m, triggered24h };
}

module.exports = {
  MEMBERSHIP_TIERS,
  computeMemberPriceForPart,
  verifyStaffCredentials,
  issueEmployeeToken,
  verifyEmployeeToken,
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
};
