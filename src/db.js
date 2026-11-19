const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const BUNDLED_DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : BUNDLED_DATA_DIR;
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'command_hub.db');
const BUNDLED_DB_PATH = path.join(BUNDLED_DATA_DIR, 'command_hub.db');
if (DATA_DIR !== BUNDLED_DATA_DIR && !fs.existsSync(DB_PATH) && fs.existsSync(BUNDLED_DB_PATH)) {
  fs.copyFileSync(BUNDLED_DB_PATH, DB_PATH);
}
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS business_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS donor_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_number TEXT UNIQUE NOT NULL,
    vin TEXT NOT NULL,
    year INTEGER NOT NULL,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    trim TEXT DEFAULT '',
    engine TEXT DEFAULT '',
    transmission TEXT DEFAULT '',
    drivetrain TEXT DEFAULT '',
    exterior_color TEXT DEFAULT '',
    paint_code TEXT DEFAULT '',
    mileage INTEGER DEFAULT 0,
    yard_row TEXT DEFAULT '',
    status TEXT DEFAULT 'active_yard',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    condition TEXT NOT NULL DEFAULT 'Used',
    condition_id INTEGER NOT NULL DEFAULT 3000,
    brand TEXT DEFAULT 'OEM',
    oem_part_number TEXT DEFAULT '',
    interchange_number TEXT DEFAULT '',
    hollander_number TEXT DEFAULT '',
    placement_on_vehicle TEXT DEFAULT '',
    donor_vehicle_id INTEGER,
    fitment_years TEXT DEFAULT '',
    fitment_make TEXT DEFAULT '',
    fitment_model TEXT DEFAULT '',
    fitment_engine TEXT DEFAULT '',
    fitment_notes TEXT DEFAULT '',
    description TEXT DEFAULT '',
    defect_disclosure TEXT DEFAULT 'Tested & inspected. Normal cosmetic wear consistent with age; see photos.',
    bin_location TEXT DEFAULT '',
    security_mark_code TEXT NOT NULL,
    security_mark_verified INTEGER DEFAULT 1,
    security_mark_photo TEXT DEFAULT '',
    photos_json TEXT DEFAULT '[]',
    pull_status TEXT NOT NULL DEFAULT 'pulled_shelved',
    allow_self_pull INTEGER DEFAULT 0,
    price_self_pull REAL DEFAULT 0,
    allow_we_pull INTEGER DEFAULT 1,
    price_we_pull REAL NOT NULL DEFAULT 0,
    allow_pull_install INTEGER DEFAULT 1,
    price_pull_install REAL DEFAULT 0,
    install_labor_hours REAL DEFAULT 1.5,
    cost_basis REAL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    reserved_qty INTEGER NOT NULL DEFAULT 0,
    weight_lbs REAL NOT NULL DEFAULT 8.0,
    length_in REAL NOT NULL DEFAULT 14.0,
    width_in REAL NOT NULL DEFAULT 10.0,
    height_in REAL NOT NULL DEFAULT 8.0,
    shipping_class TEXT NOT NULL DEFAULT 'parcel_calculated',
    handling_fee REAL NOT NULL DEFAULT 10.00,
    handling_days INTEGER NOT NULL DEFAULT 3,
    shopify_product_id TEXT DEFAULT '',
    shopify_variant_id TEXT DEFAULT '',
    shopify_inventory_item_id TEXT DEFAULT '',
    channels_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (donor_vehicle_id) REFERENCES donor_vehicles(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS crm_customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    source_pillar TEXT DEFAULT 'website',
    tags_json TEXT DEFAULT '[]',
    vehicles_json TEXT DEFAULT '[]',
    email_opt_in INTEGER DEFAULT 0,
    sms_opt_in INTEGER DEFAULT 0,
    sms_consent_timestamp TEXT DEFAULT '',
    push_subscribed INTEGER DEFAULT 0,
    referral_code TEXT UNIQUE NOT NULL,
    referred_by TEXT DEFAULT '',
    total_spent REAL DEFAULT 0,
    visit_count INTEGER DEFAULT 1,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_code TEXT UNIQUE NOT NULL,
    customer_id INTEGER,
    customer_name TEXT NOT NULL,
    customer_email TEXT DEFAULT '',
    customer_phone TEXT NOT NULL,
    appointment_type TEXT NOT NULL,
    service_category TEXT NOT NULL,
    vehicle_vin TEXT DEFAULT '',
    vehicle_ymm TEXT DEFAULT '',
    linked_order_number TEXT DEFAULT '',
    linked_sku TEXT DEFAULT '',
    preferred_date TEXT NOT NULL,
    preferred_time TEXT NOT NULL,
    booking_mode TEXT NOT NULL DEFAULT 'staff_approval',
    status TEXT NOT NULL DEFAULT 'pending_approval',
    assigned_bay TEXT DEFAULT 'Unassigned',
    staff_notes TEXT DEFAULT '',
    customer_notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    customer_id INTEGER,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT DEFAULT '',
    shipping_address TEXT DEFAULT '',
    fulfillment_mode TEXT NOT NULL,
    items_json TEXT NOT NULL,
    subtotal REAL NOT NULL,
    shipping_cost REAL NOT NULL DEFAULT 0,
    handling_fee REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    channel_source TEXT NOT NULL DEFAULT 'direct_storefront',
    payment_status TEXT NOT NULL DEFAULT 'paid_pending_capture',
    approval_status TEXT NOT NULL DEFAULT 'approved',
    linked_booking_code TEXT DEFAULT '',
    waiver_accepted INTEGER DEFAULT 0,
    policy_accepted INTEGER DEFAULT 1,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS work_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wo_number TEXT UNIQUE NOT NULL,
    booking_code TEXT DEFAULT '',
    customer_name TEXT NOT NULL,
    customer_phone TEXT DEFAULT '',
    vehicle_ymm TEXT NOT NULL,
    vehicle_vin TEXT DEFAULT '',
    service_summary TEXT NOT NULL,
    parts_used_json TEXT DEFAULT '[]',
    labor_hours REAL DEFAULT 1.0,
    labor_rate REAL DEFAULT 125.00,
    parts_total REAL DEFAULT 0,
    total_estimate REAL DEFAULT 125.00,
    status TEXT DEFAULT 'in_progress',
    technician TEXT DEFAULT 'Lead Tech',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_number TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT DEFAULT '',
    customer_phone TEXT DEFAULT '',
    pillar TEXT NOT NULL DEFAULT 'parts',
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    related_sku TEXT DEFAULT '',
    vehicle_vin TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    staff_reply TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS return_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rma_number TEXT UNIQUE NOT NULL,
    order_number TEXT NOT NULL,
    sku TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    claim_reason TEXT NOT NULL,
    buyer_vin TEXT DEFAULT '',
    diagnostic_codes TEXT DEFAULT '',
    security_mark_intact INTEGER NOT NULL DEFAULT 1,
    evidence_summary TEXT NOT NULL,
    evidence_photo_data TEXT DEFAULT '',
    buyer_accepts_return_shipping INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending_evidence_review',
    staff_decision_notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS specials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    badge TEXT NOT NULL,
    pillar TEXT NOT NULL DEFAULT 'all',
    discount_text TEXT NOT NULL,
    promo_code TEXT NOT NULL,
    description TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    share_count INTEGER NOT NULL DEFAULT 0,
    broadcast_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,
    platform TEXT NOT NULL,
    action TEXT NOT NULL,
    sku TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'success',
    details TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS photo_review_items (
    photo_uid TEXT PRIMARY KEY,
    vehicle_folder TEXT NOT NULL,
    original_name TEXT NOT NULL,
    title_hint TEXT DEFAULT '',
    drive_file_id TEXT NOT NULL,
    copied_drive_id TEXT DEFAULT '',
    copied_folder_id TEXT DEFAULT '',
    source_path TEXT DEFAULT '',
    copy_count INTEGER DEFAULT 1,
    size_bytes INTEGER DEFAULT 0,
    thumb_url TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'pending',
    vehicle_tag_override TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_photo_review_status ON photo_review_items(review_status);
  CREATE INDEX IF NOT EXISTS idx_photo_review_folder ON photo_review_items(vehicle_folder);
`);

const DEFAULT_SETTINGS = {
  business_name: "Aldridge Auto's",
  google_listing_name: "Aldridge Auto's Service & Repair",
  owner_name: 'Chris Aldridge',
  google_rating_badge: '5.0 ★ (87 Google Reviews) • #1 Rated in University Place, WA',
  tagline: '5.0★ Auto Repair & Diagnostics • Tested OEM Parts • U-Haul Neighborhood Dealer #046117',
  phone: '(253) 245-4206',
  uhaul_phone: '(253) 948-3487',
  email: 'service@aldridgeautosupply.com',
  street_address: '5115 66th St W, Bldg B',
  city: 'university place',
  city_display: 'University Place / Tacoma',
  state: 'WA',
  zip: '98467',
  country: 'US',
  tax_rate: 0.101,
  hours_weekday: 'Mon–Fri: 12:00 PM – 7:00 PM (U-Haul: 12 PM – 6 PM)',
  hours_weekend: 'Sat: 12:00 PM – 6:00 PM • Sun: 1:00 PM – 4:00 PM (U-Haul Sat–Sun: 2–5 PM + 24hr Return)',
  logo_url: '/assets/aldridge-crest.jpg?v=11',
  theme_preset: 'pnw_navy_orange',
  labor_rate_hourly: 135.00,
  handling_fee_default: 10.00,
  handling_days_default: 3,
  freight_weight_threshold_lbs: 70,
  clean_slate_mode: true,
  single_variant_only: true,
  photos_required: true,
  canonical_domain: 'https://aldridgeautosupply.com',
  public_pwa_url: 'https://aldridgeautosupply.com',
  legacy_archive_db: 'data/archive_905_legacy.db',
  default_condition: 'Used',
  blank_mpn_fallback: 'Does Not Apply',
  return_policy_mode: 'ReturnsNotAccepted_DefectOnly',
  self_pull_yard_fee: 5.00,
  shopify_domain: 'aldridgesales.myshopify.com',
  shopify_storefront_url: 'https://aldridgesales.myshopify.com/',
  shopify_cdn_id: '0779/2571/2103',
  shopify_admin_token: '',
  shopify_webhook_secret: '',
  shopify_location_id: '',
  shopify_co_master_mode: true,
  ebay_seller_id: 'AABCAS',
  ebay_support_sr: '1-509601062469',
  wa_ag_file_number: '730525',
  meta_escalation_case: 'C#26046204',
  thermal_printer_model: 'Y813BT (4x6 Thermal)',
  photo_naming_rule: 'SKU.1.jpg, SKU.2.jpg (Dots Only for BL Bulk Image Uploader — NEVER underscores)',
  uhaul_dealer_url: 'https://www.uhaul.com/Locations/Truck-Rentals-near-Tacoma-WA-98467/046117/',
  uhaul_trailers_url: 'https://www.uhaul.com/Locations/Trailer-Rentals-near-Tacoma-WA-98467/046117/',
  uhaul_supplies_url: 'https://www.uhaul.com/Locations/Supplies-near-Tacoma-WA-98467/046117/',
  uhaul_dealer_id: '046117',
  uhaul_synced_data: {
    dealer_title: "Aldridge Auto's — Authorized U-Haul Neighborhood Dealer #046117",
    uhaul_phone: '(253) 948-3487',
    office_hours: 'Mon–Fri: 12:00 PM – 6:00 PM • Sat–Sun: 2:00 PM – 5:00 PM',
    truck_share_24_7: true,
    limited_neighborhood_stock: true,
    return_24_hour: true,
    equipment_categories: [
      'Limited On-Hand Neighborhood Fleet — Always Verify Live Stock on U-Haul.com or Call (253) 948-3487',
      'In-Town® & One-Way Moving Trucks (Subject to Current Lot Availability)',
      'Utility & Cargo Trailers (Tow Vehicle Must Already Have Hitch & Wiring — No Hitch Sales or Installation On-Site)',
      '24/7 Truck Share® Self-Dispatch & 24-Hour Drop-Off Return at Bldg B'
    ],
    on_site_hitch_install: false,
    moving_supplies: false,
    last_synced_at: null
  },
  ai_vision_provider: 'auto',
  gemini_api_key: '',
  openai_api_key: '',
  google_calendar_email: '',
  sms_webhook_url: '',
  email_webhook_url: '',
  social_links: {
    facebook: 'https://www.facebook.com/AldridgeAutos',
    facebook_marketplace: 'https://www.facebook.com/ProfessionalFacilitatorOfNeeds',
    instagram: 'https://www.instagram.com/aldridgeautos/',
    youtube: 'https://www.youtube.com/@AldridgeAutos',
    tiktok: 'https://www.tiktok.com/',
    ebay_store: 'https://www.ebay.com/usr/aabcas',
    offerup: 'https://offerup.com/search?q=Aldridge+Auto+Tacoma',
    uhaul_dealer: 'https://www.uhaul.com/Locations/Truck-Rentals-near-Tacoma-WA-98467/046117/',
    shopify_store: 'https://aldridgesales.myshopify.com/',
    google_maps: 'https://www.google.com/maps/search/?api=1&query=Aldridge+Auto%27s+Service+%26+Repair+5115+66th+St+W+Bldg+B+University+Place+WA+98467'
  },
  primary_crosslister: 'shopify_co_master_plus_crosslist_offerup_fb_and_craigslist_autofill',
  ebay_routing_mode: 'standard_ebay_us_only_no_ebay_motors',
  craigslist_target: 'seattle.craigslist.org -> Tacoma/Pierce County (tac) -> auto parts - by owner (pts, $0 fee, ZIP 98467)',
  banned_tools: [
    'eBay Motors (SiteID=eBayMotors — DO NOT USE: route strictly to Standard eBay US ebay.com SiteID=US core categories)',
    'Car-Part.com (Out-of-scope: requires licensed WA auto-wrecker credential)',
    'Google Drive HTML viewer links & multi-variant used-part listings'
  ],
  platform_checklist: {
    phase1_urgent_unblocks: {
      step1_reply_wa_ag_730525_meta_c26046204: false,
      step2_verify_ebay_aabcas_sr_1_509601062469_cleared: false,
      step3_post_8_donor_partout_ads_craigslist_offerup: false
    },
    phase2_shopify_catalog_heal: {
      step4_export_untouched_plain_csv_backup: false,
      step5_compliance_cats_srs_sold_dupes_purged: true,
      step6_upload_1437_row_photo_preserving_sanitized_csv: false,
      paste_defect_evidence_return_and_10_handling_policies: false
    },
    phase3_ebay_aabcas_reconciliation: {
      step7a_end_sold_and_8_srs_listings_on_ebay: false,
      step7b_reconcile_418_gen1_skus_in_other_6755: false,
      step7c_push_batches_25_50_via_shopify_marketplace_connect: false,
      cancel_crosslist_subscription_permanently: false
    },
    phase4_stranded_recovery_and_daily_ops: {
      step8_restore_546_stranded_2004_2012_4runner_cdn_parts: false,
      step9_list_6_oct15_and_26_tundra_parts_dot_notation_y813bt: false,
      step10_daily_10_15_heavy_local_drip_offerup_craigslist: false
    },
    google_and_meta_feeds: {
      gbp_aldridge_autos_hours_updated: true,
      google_merchant_xml_feed_linked: false,
      personal_fb_marketplace_restored_via_atg: false
    }
  }
};

function applyEnvOverrides(cfg) {
  if (process.env.SHOPIFY_DOMAIN) cfg.shopify_domain = process.env.SHOPIFY_DOMAIN.trim();
  if (process.env.SHOPIFY_ADMIN_TOKEN && !cfg.shopify_admin_token) {
    cfg.shopify_admin_token = process.env.SHOPIFY_ADMIN_TOKEN.trim();
  }
  if (process.env.SHOPIFY_WEBHOOK_SECRET && !cfg.shopify_webhook_secret) {
    cfg.shopify_webhook_secret = process.env.SHOPIFY_WEBHOOK_SECRET.trim();
  }
  if (process.env.GEMINI_API_KEY && !cfg.gemini_api_key) {
    cfg.gemini_api_key = process.env.GEMINI_API_KEY.trim();
  }
  if (process.env.CANONICAL_DOMAIN) {
    cfg.canonical_domain = process.env.CANONICAL_DOMAIN.trim().replace(/\/+$/, '');
  }
  if (process.env.PUBLIC_PWA_URL) {
    cfg.public_pwa_url = process.env.PUBLIC_PWA_URL.trim().replace(/\/+$/, '');
  }
  if (!cfg.canonical_domain) {
    cfg.canonical_domain = DEFAULT_SETTINGS.canonical_domain;
  }
  if (!cfg.public_pwa_url) {
    cfg.public_pwa_url = cfg.canonical_domain;
  }
  return cfg;
}

function getSettings() {
  const row = db.prepare('SELECT value_json FROM business_settings WHERE key = ?').get('master_config');
  if (!row) {
    const now = new Date().toISOString();
    db.prepare('INSERT INTO business_settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(
      'master_config',
      JSON.stringify(DEFAULT_SETTINGS),
      now
    );
    return applyEnvOverrides(structuredClone(DEFAULT_SETTINGS));
  }
  const saved = JSON.parse(row.value_json);
  const mergedSocial = { ...DEFAULT_SETTINGS.social_links, ...(saved.social_links || {}) };
  if (!mergedSocial.facebook || mergedSocial.facebook === 'https://www.facebook.com/') {
    mergedSocial.facebook = DEFAULT_SETTINGS.social_links.facebook;
  }
  if (!mergedSocial.facebook_marketplace) {
    mergedSocial.facebook_marketplace = DEFAULT_SETTINGS.social_links.facebook_marketplace;
  }
  if (!mergedSocial.instagram || mergedSocial.instagram === 'https://www.instagram.com/') {
    mergedSocial.instagram = DEFAULT_SETTINGS.social_links.instagram;
  }
  if (!mergedSocial.youtube || mergedSocial.youtube === 'https://www.youtube.com/') {
    mergedSocial.youtube = DEFAULT_SETTINGS.social_links.youtube;
  }
  if (!mergedSocial.offerup || mergedSocial.offerup === 'https://offerup.com/') {
    mergedSocial.offerup = DEFAULT_SETTINGS.social_links.offerup;
  }
  if (!mergedSocial.google_maps || mergedSocial.google_maps.includes("Aldridge+Auto's+5115")) {
    mergedSocial.google_maps = DEFAULT_SETTINGS.social_links.google_maps;
  }
  const mergedEmail = !saved.email || saved.email === 'service@aldridgeautos.com'
    ? DEFAULT_SETTINGS.email
    : saved.email;
  const mergedLogo = !saved.logo_url || saved.logo_url === '/assets/aldridge-crest.jpg'
    ? DEFAULT_SETTINGS.logo_url
    : saved.logo_url;
  const mergedListingName = !saved.google_listing_name || saved.google_listing_name === "Aldridge Auto's"
    ? DEFAULT_SETTINGS.google_listing_name
    : saved.google_listing_name;
  return applyEnvOverrides({
    ...DEFAULT_SETTINGS,
    ...saved,
    email: mergedEmail,
    google_listing_name: mergedListingName,
    logo_url: mergedLogo,
    single_variant_only: true,
    photos_required: true,
    uhaul_synced_data: { ...DEFAULT_SETTINGS.uhaul_synced_data, ...(saved.uhaul_synced_data || {}) },
    social_links: mergedSocial,
    platform_checklist: { ...DEFAULT_SETTINGS.platform_checklist, ...(saved.platform_checklist || {}) }
  });
}

function updateSettings(patch) {
  const current = getSettings();
  const merged = {
    ...current,
    ...patch,
    uhaul_synced_data: patch.uhaul_synced_data
      ? { ...current.uhaul_synced_data, ...patch.uhaul_synced_data }
      : current.uhaul_synced_data,
    social_links: patch.social_links
      ? { ...current.social_links, ...patch.social_links }
      : current.social_links,
    platform_checklist: patch.platform_checklist
      ? { ...current.platform_checklist, ...patch.platform_checklist }
      : current.platform_checklist
  };
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO business_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run('master_config', JSON.stringify(merged), now);
  return merged;
}

function generateSecurityCode() {
  return 'SEC-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function generateReferralCode(name = 'VIP') {
  const clean = (name || 'VIP').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4) || 'ALDR';
  return `${clean}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function logSync(direction, platform, action, sku, status, details) {
  db.prepare(`
    INSERT INTO sync_logs (direction, platform, action, sku, status, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(direction, platform, action, sku || '', status || 'success', details, new Date().toISOString());
}

const VIN_TRANSLITERATION = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const KNOWN_FAKE_OR_WRONG_VINS = new Set([
  '1G4GA5GR2FF246661', // Wrong car: 2015 Buick Verano pasted onto 2016 Chevy Equinox
  '4T1SK12E2TL038415', // Fabricated Camry VIN
  'JTEBU14R040057212', // Invalid checksum 2004 4Runner
  '5FNRL18451B072461', // Invalid checksum 2001 Odyssey
  '5N1ED22Y91C504281', // Invalid checksum 2001 Xterra
  '4F2CU92B01KA54281', // Fake Mazda WMI on 2001 Escape
  '5KEAG4027J1000000'  // Placeholder 000000 tail
]);

function validateVinStrict(rawVin) {
  const cleaned = String(rawVin || '').trim().toUpperCase();
  if (!cleaned) return { valid: true, vin: '', empty: true };
  if (/^AUDIT-|^NO-VIN|^UNKNOWN|^N\/?A$/i.test(cleaned)) {
    return { valid: false, vin: cleaned, reason: 'Placeholder VIN strings are blocked; leave VIN blank or enter a real 17-digit stamped VIN.' };
  }
  if (cleaned.length !== 17) {
    return { valid: false, vin: cleaned, reason: `VIN "${cleaned}" must be exactly 17 characters (got ${cleaned.length}).` };
  }
  if (/[IOQ]/.test(cleaned)) {
    return { valid: false, vin: cleaned, reason: `VIN "${cleaned}" contains illegal characters (I, O, or Q are never valid in ISO-3779 VINs).` };
  }
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(cleaned)) {
    return { valid: false, vin: cleaned, reason: `VIN "${cleaned}" contains invalid non-alphanumeric characters.` };
  }
  if (/000000$|123456$|999999$/.test(cleaned)) {
    return { valid: false, vin: cleaned, reason: `VIN "${cleaned}" uses a fabricated placeholder serial tail.` };
  }
  if (KNOWN_FAKE_OR_WRONG_VINS.has(cleaned)) {
    return { valid: false, vin: cleaned, reason: `VIN "${cleaned}" is on the Forensic Audit blocklist (fabricated or wrong-vehicle VIN).` };
  }
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const v = VIN_TRANSLITERATION[cleaned[i]];
    if (v === undefined) return { valid: false, vin: cleaned, reason: `Invalid VIN character at position ${i + 1}.` };
    sum += v * VIN_WEIGHTS[i];
  }
  const rem = sum % 11;
  const expectedCheck = rem === 10 ? 'X' : String(rem);
  if (cleaned[8] !== expectedCheck) {
    return {
      valid: false,
      vin: cleaned,
      reason: `Fake / corrupted VIN "${cleaned}" blocked: NHTSA position-9 check digit is "${cleaned[8]}" (expected "${expectedCheck}").`
    };
  }
  return { valid: true, vin: cleaned, empty: false };
}

const STRICT_PROHIBITED_PART_REGEX = /\b(air\s*bag|airbag|srs|supplemental\s+inflatable\s+restraint|clock\s*spring|clockspring|spiral\s*cable|seat\s*belt\s*retractor|seat\s*belt\s*pretensioner|seatbelt\s*retractor|seatbelt\s*pretensioner|pyrotechnic|inflator|catalytic\s*converter|catalytic|cat\s*converter|manifold\s+with\s+cat|trim\s+panel\s+module|trim\s+component)\b/i;

function validatePartCompliance(fields = {}) {
  const combined = [
    fields.title || '',
    fields.category || '',
    fields.description || '',
    fields.technicianHint || ''
  ].join(' ');
  const m = combined.match(STRICT_PROHIBITED_PART_REGEX);
  if (m) {
    return {
      compliant: false,
      matchedTerm: m[0],
      reason: `Hard Compliance Block: "${m[0]}" (SRS / Airbag / Clockspring / Pretensioner / Catalytic Converter) is strictly prohibited across Shopify, eBay Motors, and Meta.`
    };
  }
  return { compliant: true };
}

function computeShippingClass(weightLbs, category = '', lengthIn = 14, widthIn = 10, heightIn = 8) {
  const settings = getSettings();
  const heavyThreshold = Number(settings.freight_weight_threshold_lbs || 70);
  const catLower = (category || '').toLowerCase();
  const girthPlusLength = Number(lengthIn) + 2 * (Number(widthIn) + Number(heightIn));

  // Audit Guard: Never let "Engine", "Transmission", "Axle", "Bumper", or "Hood" substring-trap small shippable subparts!
  const isSmallSubpart = /\b(module|ecu|ecm|pcm|tcm|bcm|computer|immobilizer|cover|harness|fuse|relay|cable|shifter|pan|mount|bracket|sensor|solenoid|cooling|radiator|fan|shroud|latch|hinge|release|strut|lift support|handle|switch|bezel|trim|mirror|lamp|light)\b/i.test(catLower);

  // Hazmat / fluid-bearing / fragile oversized glass items are strictly Local Pickup Only in 98467
  const isHazmatOrGlass = /\b(lead[- ]acid|car battery|automotive battery|hybrid battery|hv battery|fuel tank|gas tank|hazmat|refrigerant|windshield|back glass)\b/i.test(catLower);
  if (isHazmatOrGlass) {
    return 'local_pickup_only';
  }

  // Strict 70+ lb or >130 in girth Local Pickup Only rule (University Place, WA 98467)
  if (Number(weightLbs) >= heavyThreshold || girthPlusLength > 130) {
    return 'local_pickup_only';
  }
  if (
    !isSmallSubpart &&
    (
      catLower.includes('complete engine') ||
      catLower.includes('long block') ||
      catLower.includes('automatic transmission') ||
      catLower.includes('manual transmission') ||
      catLower.includes('axle assembly') ||
      catLower.includes('rear axle') ||
      catLower.includes('bumper assembly') ||
      catLower.includes('body shell') ||
      catLower.includes('door shell') ||
      catLower.includes('car hood')
    )
  ) {
    return 'local_pickup_only';
  }
  return 'parcel_calculated';
}

function upsertCustomer({ name, email = '', phone = '', source_pillar = 'website', tags = [], vehicles = [], email_opt_in = 0, sms_opt_in = 0, referred_by = '' }) {
  const now = new Date().toISOString();
  let existing = null;
  if (email) {
    existing = db.prepare('SELECT * FROM crm_customers WHERE LOWER(email) = LOWER(?)').get(email);
  }
  if (!existing && phone) {
    existing = db.prepare('SELECT * FROM crm_customers WHERE phone = ?').get(phone);
  }

  if (existing) {
    const mergedTags = Array.from(new Set([...JSON.parse(existing.tags_json || '[]'), ...tags]));
    const mergedVehicles = Array.from(new Set([...JSON.parse(existing.vehicles_json || '[]'), ...vehicles.filter(Boolean)]));
    const nextEmailOpt = email_opt_in ? 1 : existing.email_opt_in;
    const nextSmsOpt = sms_opt_in ? 1 : existing.sms_opt_in;
    const smsTs = sms_opt_in && !existing.sms_consent_timestamp ? now : existing.sms_consent_timestamp;
    db.prepare(`
      UPDATE crm_customers
      SET name = COALESCE(NULLIF(?, ''), name),
          email = COALESCE(NULLIF(?, ''), email),
          phone = COALESCE(NULLIF(?, ''), phone),
          tags_json = ?,
          vehicles_json = ?,
          email_opt_in = ?,
          sms_opt_in = ?,
          sms_consent_timestamp = ?,
          visit_count = visit_count + 1
      WHERE id = ?
    `).run(
      name,
      email,
      phone,
      JSON.stringify(mergedTags),
      JSON.stringify(mergedVehicles),
      nextEmailOpt,
      nextSmsOpt,
      smsTs,
      existing.id
    );
    return db.prepare('SELECT * FROM crm_customers WHERE id = ?').get(existing.id);
  }

  const refCode = generateReferralCode(name);
  const res = db.prepare(`
    INSERT INTO crm_customers (
      name, email, phone, source_pillar, tags_json, vehicles_json,
      email_opt_in, sms_opt_in, sms_consent_timestamp, referral_code, referred_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name || 'Shop Guest',
    email,
    phone,
    source_pillar,
    JSON.stringify(tags),
    JSON.stringify(vehicles.filter(Boolean)),
    email_opt_in ? 1 : 0,
    sms_opt_in ? 1 : 0,
    sms_opt_in ? now : '',
    refCode,
    referred_by || '',
    now
  );
  return db.prepare('SELECT * FROM crm_customers WHERE id = ?').get(res.lastInsertRowid);
}

function seedDemoDataIfNeeded() {
  const settings = getSettings();
  if (settings.clean_slate_mode) return;
  const countRow = db.prepare('SELECT COUNT(*) as c FROM inventory_items').get();
  if (countRow.c > 0) return;

  const now = new Date().toISOString();

  // Seed 2 Donor Vehicles in the Garage
  const d1 = db.prepare(`
    INSERT INTO donor_vehicles (
      stock_number, vin, year, make, model, trim, engine, transmission, drivetrain,
      exterior_color, paint_code, mileage, yard_row, status, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'DV-2019-F150',
    '1FTEW1EP2KFA41892',
    2019,
    'Ford',
    'F-150',
    'XLT SuperCrew',
    '2.7L EcoBoost V6 Twin-Turbo',
    '10-Speed Automatic (10R80)',
    '4WD',
    'Magnetic Gray Metallic',
    'J7',
    68420,
    'Row B • Stall 04',
    'active_yard',
    'Rear-end collision donor; engine & front drivetrain run strong, tested prior to teardown.',
    now
  );

  const d2 = db.prepare(`
    INSERT INTO donor_vehicles (
      stock_number, vin, year, make, model, trim, engine, transmission, drivetrain,
      exterior_color, paint_code, mileage, yard_row, status, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'DV-2018-CAMRY',
    '4T1B11HK2JU592104',
    2018,
    'Toyota',
    'Camry',
    'SE Sedan',
    '2.5L Dynamic Force I4 (A25A-FKS)',
    '8-Speed Direct Shift Automatic',
    'FWD',
    'Celestial Silver',
    '1J9',
    54110,
    'Row A • Stall 11',
    'active_yard',
    'Clean southern car, zero rust, electronics & accessories verified.',
    now
  );

  const defaultChannels = JSON.stringify({
    shopify: true,
    ebay_motors: true,
    google_merchant: true,
    meta_catalog: true,
    offerup: true,
    vendoo_crosslist: true,
    tiktok_shop: true,
    mercari: true,
    car_part: true
  });

  const heavyChannels = JSON.stringify({
    shopify: true,
    ebay_motors: true,
    google_merchant: true,
    meta_catalog: true,
    offerup: true,
    vendoo_crosslist: false,
    tiktok_shop: false,
    mercari: false,
    car_part: true
  });

  const sampleItems = [
    {
      sku: 'ALD-ALT-23100VZ',
      title: '2018-2022 Toyota Camry 2.5L Remanufactured OEM Alternator 150A Assembly',
      category: 'Charging & Starting Systems',
      condition: 'Remanufactured',
      condition_id: 2500,
      brand: 'Denso / Toyota OEM',
      oem_part_number: '27060-F0010',
      interchange_number: '104211-3910',
      hollander_number: '601-10284',
      placement_on_vehicle: 'Front Engine Accessory Drive',
      donor_vehicle_id: d2.lastInsertRowid,
      fitment_years: '2018, 2019, 2020, 2021, 2022',
      fitment_make: 'Toyota',
      fitment_model: 'Camry / RAV4',
      fitment_engine: '2.5L I4 A25A-FKS',
      fitment_notes: 'Verify 3-pin LIN regulator plug & OEM #27060-F0010 prior to purchase.',
      description: 'Bench-tested OEM Denso 150-Amp alternator professionally remanufactured with new bearings, voltage regulator, and slip ring. Load sheet included.',
      defect_disclosure: 'Remanufactured housing shows minor casting marks; pulley & terminals clean and bench-verified at 14.3V.',
      bin_location: 'RACK-A2-BIN-04',
      security_mark_code: 'SEC-9F42A1',
      photos_json: JSON.stringify(['/assets/oem-parts.jpg']),
      pull_status: 'pulled_shelved',
      allow_self_pull: 0,
      price_self_pull: 0,
      allow_we_pull: 1,
      price_we_pull: 189.00,
      allow_pull_install: 1,
      price_pull_install: 349.00,
      install_labor_hours: 1.3,
      cost_basis: 65.00,
      quantity: 2,
      weight_lbs: 13.5,
      length_in: 10,
      width_in: 9,
      height_in: 8,
      shipping_class: 'parcel_calculated',
      channels_json: defaultChannels
    },
    {
      sku: 'ALD-TRB-F150-LH',
      title: '2018-2020 Ford F-150 2.7L EcoBoost Left Driver Turbocharger OEM Garrett',
      category: 'Turbos, Superchargers & Intercoolers',
      condition: 'Used OEM',
      condition_id: 3000,
      brand: 'FoMoCo / Garrett OEM',
      oem_part_number: 'JT4E-6K682-AC',
      interchange_number: 'JL3Z-6K682-C',
      hollander_number: '317-01955L',
      placement_on_vehicle: 'Left (Driver Side) Exhaust Manifold',
      donor_vehicle_id: d1.lastInsertRowid,
      fitment_years: '2018, 2019, 2020',
      fitment_make: 'Ford',
      fitment_model: 'F-150',
      fitment_engine: '2.7L V6 EcoBoost Twin-Turbo',
      fitment_notes: 'Fits 2nd-Gen 2.7L EcoBoost Left Side. Electronic wastegate actuator included.',
      description: 'Pulled from a 68k-mile 2019 Ford F-150 XLT. Zero shaft play beyond factory oil-film spec; dry turbine housing, intact wastegate linkage.',
      defect_disclosure: 'Normal exterior surface oxidation on cast turbine snail (pictured); compressor blades clean with zero nicking.',
      bin_location: 'RACK-B1-BIN-02',
      security_mark_code: 'SEC-7B19D4',
      photos_json: JSON.stringify(['/assets/oem-parts.jpg']),
      pull_status: 'on_vehicle',
      allow_self_pull: 1,
      price_self_pull: 215.00,
      allow_we_pull: 1,
      price_we_pull: 295.00,
      allow_pull_install: 1,
      price_pull_install: 745.00,
      install_labor_hours: 3.6,
      cost_basis: 95.00,
      quantity: 1,
      weight_lbs: 19.0,
      length_in: 15,
      width_in: 12,
      height_in: 11,
      shipping_class: 'parcel_calculated',
      channels_json: defaultChannels
    },
    {
      sku: 'ALD-TRN-10R80-4WD',
      title: '2018-2020 Ford F-150 2.7L 4WD 10-Speed Automatic Transmission 10R80 68k Mi',
      category: 'Automatic Transmissions & Driveline',
      condition: 'Used OEM',
      condition_id: 3000,
      brand: 'Ford OEM',
      oem_part_number: 'JL3P-7000-HB',
      interchange_number: 'JL3Z-7000-E',
      hollander_number: '400-66291',
      placement_on_vehicle: 'Drivetrain Center',
      donor_vehicle_id: d1.lastInsertRowid,
      fitment_years: '2018, 2019, 2020',
      fitment_make: 'Ford',
      fitment_model: 'F-150 4x4',
      fitment_engine: '2.7L EcoBoost V6',
      fitment_notes: 'Requires Ford IDS/FDRS solenoid strategy programming to buyer VIN upon installation.',
      description: 'Complete tested 10R80 4WD transmission assembly with torque converter. Fluid inspected bright red with zero burnt odor; road-tested through all gears.',
      defect_disclosure: 'Heavy palletized assembly — ships LTL Freight to commercial dock/terminal or Free University Place Shop Pickup / Turnkey Shop Install.',
      bin_location: 'PALLET-BAY-03',
      security_mark_code: 'SEC-3E88C0',
      photos_json: JSON.stringify(['/assets/aldridge-shop-hero.jpg']),
      pull_status: 'pulled_shelved',
      allow_self_pull: 0,
      price_self_pull: 0,
      allow_we_pull: 1,
      price_we_pull: 1850.00,
      allow_pull_install: 1,
      price_pull_install: 2790.00,
      install_labor_hours: 7.5,
      cost_basis: 700.00,
      quantity: 1,
      weight_lbs: 235.0,
      length_in: 44,
      width_in: 36,
      height_in: 30,
      shipping_class: 'freight_ltl',
      channels_json: heavyChannels
    },
    {
      sku: 'ALD-WHL-F150-20S',
      title: '2018-2020 Ford F-150 XLT 20" Machined Aluminum OEM Wheel Rim Set + Tires',
      category: 'Wheels, Tires & Hub Caps',
      condition: 'Used OEM',
      condition_id: 3000,
      brand: 'Ford OEM',
      oem_part_number: 'JL3Z-1007-J',
      interchange_number: 'ALY10150U35',
      hollander_number: '560-10150',
      placement_on_vehicle: 'Front & Rear 6x135mm Bolt Pattern',
      donor_vehicle_id: d1.lastInsertRowid,
      fitment_years: '2015, 2016, 2017, 2018, 2019, 2020',
      fitment_make: 'Ford',
      fitment_model: 'F-150 / Expedition',
      fitment_engine: 'All 6-Lug 6x135 Models',
      fitment_notes: 'Includes center caps; TPMS sensors included as bonus (relearn required).',
      description: 'Spin-balanced straight OEM 20x8.5 Ford F-150 alloy wheels with 275/55R20 Michelin tires at 7/32" tread depth.',
      defect_disclosure: 'One wheel has a 1.5-inch light clearcoat scuff on outer lip (close-up photo attached); zero cracks, bends, or repairs.',
      bin_location: 'TIRE-RACK-01',
      security_mark_code: 'SEC-44D1B8',
      photos_json: JSON.stringify(['/assets/aldridge-lot-uhaul.jpg']),
      pull_status: 'on_vehicle',
      allow_self_pull: 1,
      price_self_pull: 620.00,
      allow_we_pull: 1,
      price_we_pull: 720.00,
      allow_pull_install: 1,
      price_pull_install: 810.00,
      install_labor_hours: 1.0,
      cost_basis: 280.00,
      quantity: 1,
      weight_lbs: 148.0,
      length_in: 33,
      width_in: 33,
      height_in: 44,
      shipping_class: 'freight_ltl',
      channels_json: heavyChannels
    },
    {
      sku: 'ALD-RAD-TACOMA-35L',
      title: '2016–2022 Toyota Tacoma 3.5L V6 OEM Aluminum Radiator & Cooling Fan Shroud Assembly',
      category: 'Engine Cooling & Radiators',
      condition: 'Used OEM',
      condition_id: 3000,
      brand: 'Denso / Toyota OEM',
      oem_part_number: '16400-0P400',
      interchange_number: 'CU13565',
      hollander_number: '675-10284',
      placement_on_vehicle: 'Front Core Support',
      donor_vehicle_id: null,
      fitment_years: '2016, 2017, 2018, 2019, 2020, 2021, 2022',
      fitment_make: 'Toyota',
      fitment_model: 'Tacoma',
      fitment_engine: '3.5L V6 (2GR-FKS)',
      fitment_notes: 'Fits 3.5L V6 automatic models; pressure-tested at 18 PSI with zero leaks.',
      description: 'Genuine Toyota/Denso aluminum core radiator with factory cooling fan shroud pulled from a clean 64k-mile Tacoma. Tanks, mounting tabs, and transmission cooler fittings inspected and pressure-tested.',
      defect_disclosure: 'Minor fin marks from normal road use; pressure-tested 100% leak-free.',
      bin_location: 'RACK-B2-BIN-04',
      security_mark_code: 'SEC-RAD400',
      photos_json: JSON.stringify(['/assets/oem-parts.jpg']),
      pull_status: 'pulled_shelved',
      allow_self_pull: 0,
      price_self_pull: 0,
      allow_we_pull: 1,
      price_we_pull: 165.00,
      allow_pull_install: 1,
      price_pull_install: 435.00,
      install_labor_hours: 2.0,
      cost_basis: 68.00,
      quantity: 1,
      weight_lbs: 21.5,
      length_in: 34,
      width_in: 24,
      height_in: 9,
      shipping_class: 'parcel_calculated',
      channels_json: defaultChannels
    }
  ];

  const insertItem = db.prepare(`
    INSERT INTO inventory_items (
      sku, title, category, condition, condition_id, brand, oem_part_number,
      interchange_number, hollander_number, placement_on_vehicle, donor_vehicle_id,
      fitment_years, fitment_make, fitment_model, fitment_engine, fitment_notes,
      description, defect_disclosure, bin_location, security_mark_code, security_mark_verified,
      photos_json, pull_status, allow_self_pull, price_self_pull, allow_we_pull, price_we_pull,
      allow_pull_install, price_pull_install, install_labor_hours, cost_basis, quantity,
      weight_lbs, length_in, width_in, height_in, shipping_class, handling_fee, handling_days,
      channels_json, status, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10.00, 3, ?, 'active', ?, ?
    )
  `);

  for (const item of sampleItems) {
    insertItem.run(
      item.sku, item.title, item.category, item.condition, item.condition_id, item.brand,
      item.oem_part_number, item.interchange_number, item.hollander_number, item.placement_on_vehicle,
      item.donor_vehicle_id, item.fitment_years, item.fitment_make, item.fitment_model,
      item.fitment_engine, item.fitment_notes, item.description, item.defect_disclosure,
      item.bin_location, item.security_mark_code, item.photos_json, item.pull_status,
      item.allow_self_pull, item.price_self_pull, item.allow_we_pull, item.price_we_pull,
      item.allow_pull_install, item.price_pull_install, item.install_labor_hours,
      item.cost_basis, item.quantity, item.weight_lbs, item.length_in, item.width_in,
      item.height_in, item.shipping_class, item.channels_json, now, now
    );
  }

  // Seed Specials
  const insertSpecial = db.prepare(`
    INSERT INTO specials (title, badge, pillar, discount_text, promo_code, description, valid_until, active, share_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  insertSpecial.run(
    'Buy OEM Part + Shop Install Combo',
    'TURNKEY SAVER',
    'parts',
    '15% OFF Installation Labor',
    'PULLINSTALL15',
    'Purchase any stocked or yard-pulled OEM assembly with our "We Pull + We Install" option at Bldg B in University Place and save 15% on bay labor.',
    '2026-12-31',
    22,
    now
  );
  insertSpecial.run(
    'Electrical & Cooling System Diagnostic Promo',
    '5.0★ REPAIR SHOP',
    'repair',
    '$25 OFF Full OBD-II / Electrical Diag',
    'DIAG25',
    'Check-engine light, charging draw, or overheating issue? Get $25 off a full electrical or cooling diagnostic — applied straight toward your repair if completed in-house.',
    '2026-12-31',
    19,
    now
  );
  insertSpecial.run(
    'Direct Website OEM Parts Saver',
    'NO MARKETPLACE FEES',
    'parts',
    '$15 OFF Any $150+ OEM Part Order',
    'DIRECT15',
    'Order directly through Aldridge Auto\'s Master Storefront (Nationwide Ship or Free Bldg B Counter Pickup) and save $15 on any $150+ tested OEM part.',
    '2026-12-31',
    16,
    now
  );

  // Seed sample CRM customer + pending staff-approval appointment + inquiry
  const c1 = upsertCustomer({
    name: 'Marcus Vance',
    email: 'mvance@example.com',
    phone: '(253) 555-0148',
    source_pillar: 'parts',
    tags: ['pull-install-lead', 'vip-sms', 'ford-owner'],
    vehicles: ['2019 Ford F-150 XLT 2.7L'],
    email_opt_in: 1,
    sms_opt_in: 1
  });

  db.prepare(`
    INSERT INTO appointments (
      booking_code, customer_id, customer_name, customer_email, customer_phone,
      appointment_type, service_category, vehicle_vin, vehicle_ymm, linked_sku,
      preferred_date, preferred_time, booking_mode, status, assigned_bay, customer_notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'APT-8421',
    c1.id,
    'Marcus Vance',
    'mvance@example.com',
    '(253) 555-0148',
    'we_pull_and_install',
    'We Pull + Shop Install (Turbocharger)',
    '1FTEW1EP9KFB10293',
    '2019 Ford F-150 2.7L',
    'ALD-TRB-F150-LH',
    '2026-11-14',
    '12:30 PM',
    'staff_approval',
    'pending_approval',
    'Bay 2 (Heavy Line)',
    'Throwing P0299 underboost on driver bank; wants Aldridge Auto\'s to pull ALD-TRB-F150-LH and install it.',
    now
  );

  db.prepare(`
    INSERT INTO inquiries (
      ticket_number, customer_name, customer_email, customer_phone,
      pillar, subject, message, related_sku, vehicle_vin, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(
    'INQ-3019',
    'Elena Rostova',
    'elena.r@example.com',
    '(253) 555-0192',
    'parts',
    'VIN Fitment + Shop Install Quote for ALD-RAD-TACOMA-35L',
    'Hi Chris! Does ALD-RAD-TACOMA-35L fit my 2018 Tacoma TRD Off-Road 3.5L, and do you have an afternoon bay slot next week if I choose the We Pull + Shop Install option?',
    'ALD-RAD-TACOMA-35L',
    '3TMCZ5AN4JM123456',
    now
  );

  logSync('system', 'co_master_hub', 'initial_seed', '', 'success', "Initialized Aldridge Auto's Co-Master SQLite Inventory, Donor Garage, Multi-Channel Feeds & Policy Engine.");
}

function inferPartCategory(title) {
  const t = (title || '').toLowerCase();
  if (/\b(alternator|starter|battery|fuse|ignition)\b/.test(t)) return 'Charging & Starting Systems';
  if (/\b(ecu|ecm|pcm|tcm|control module|switch|cluster|sensor|harness|radio|antenna)\b/.test(t)) return 'ECUs, Modules & Electrical';
  if (/\b(radiator|condenser|fan|shroud|coolant|heater|thermostat|ac |a\/c|compressor)\b/.test(t)) return 'Cooling, Heating & HVAC';
  if (/\b(transmission|transfer case|drive shaft|driveshaft|axle|differential|shifter|flywheel)\b/.test(t)) return 'Transmissions & Driveline';
  if (/\b(headlight|tail light|taillight|fog light|marker light|lamp|turn signal)\b/.test(t)) return 'Lighting & Lamps';
  if (/\b(door|hood|fender|bumper|grille|mirror|quarter panel|rocker|tailgate|hatch|body shell|window|glass|windshield)\b/.test(t)) return 'Exterior Body, Doors & Glass';
  if (/\b(seat|console|dash|visor|trim|panel|carpet|headliner|glove box)\b/.test(t)) return 'Interior, Seats & Trim';
  if (/\b(wheel|rim|tire|hub|brake|caliper|strut|shock|control arm|knuckle|steering)\b/.test(t)) return 'Wheels, Brakes & Suspension';
  return 'Engine & OEM Mechanical Assemblies';
}

function seedAuditGroundTruthCatalog(forceReplace = false) {
  const auditCsvPath = path.join(DATA_DIR, 'audit_sources', 'products_export_1_Aug04.csv');
  if (!fs.existsSync(auditCsvPath)) return { seeded: false, reason: 'no_audit_csv' };

  const existingDonor = db.prepare('SELECT id FROM donor_vehicles WHERE stock_number = ?').get('DV-01-FIAT12');
  if (existingDonor && !forceReplace) {
    return { seeded: false, reason: 'already_seeded' };
  }

  const { AUDIT_DONOR_FLEET, sanitizeShopifyExportCsv } = require('./audit-sanitizer');
  const settings = getSettings();
  const now = new Date().toISOString();
  const rawCsv = fs.readFileSync(auditCsvPath, 'utf8');
  const { sanitizedCsv, stats, cleanActiveItems } = sanitizeShopifyExportCsv(rawCsv);

  const outDir = path.join(DATA_DIR, 'audit_outputs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'aldridge_shopify_sanitized_photo_preserving.csv'), sanitizedCsv, 'utf8');
  fs.writeFileSync(path.join(outDir, 'audit_sanitization_summary.json'), JSON.stringify({ generated_at: now, stats }, null, 2), 'utf8');

  const parcelChannels = JSON.stringify({
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
  const heavyChannels = JSON.stringify({
    shopify: true,
    shopify_marketplace_connect: true,
    ebay_motors: true,
    google_merchant: true,
    meta_catalog: true,
    offerup: true,
    vendoo: false,
    tiktok_shop: false,
    craigslist: true
  });

  db.exec('BEGIN TRANSACTION;');
  try {
    if (forceReplace) {
      db.exec('DELETE FROM inventory_items; DELETE FROM donor_vehicles;');
    }

    const upsertDonor = db.prepare(`
      INSERT INTO donor_vehicles (
        stock_number, vin, year, make, model, trim, engine, transmission, drivetrain,
        exterior_color, paint_code, mileage, yard_row, status, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stock_number) DO UPDATE SET
        vin = excluded.vin, notes = excluded.notes, status = excluded.status
    `);

    const donorLookup = new Map();
    for (const d of AUDIT_DONOR_FLEET) {
      upsertDonor.run(
        d.stock_number, d.vin, d.year, d.make, d.model, d.trim, d.engine, d.transmission,
        d.drivetrain, d.exterior_color, d.paint_code, d.mileage, d.yard_row, d.status, d.notes, now
      );
      const row = db.prepare('SELECT id FROM donor_vehicles WHERE stock_number = ?').get(d.stock_number);
      const modelKey = d.model.split(' ')[0].toLowerCase();
      donorLookup.set(`${d.year}_${d.make.toLowerCase()}_${modelKey}`, row.id);
    }

    const upsertItem = db.prepare(`
      INSERT INTO inventory_items (
        sku, title, category, condition, condition_id, brand, oem_part_number,
        interchange_number, hollander_number, placement_on_vehicle, donor_vehicle_id,
        fitment_years, fitment_make, fitment_model, fitment_engine, fitment_notes,
        description, defect_disclosure, bin_location, security_mark_code, security_mark_verified,
        photos_json, pull_status, allow_self_pull, price_self_pull, allow_we_pull, price_we_pull,
        allow_pull_install, price_pull_install, install_labor_hours, cost_basis, quantity,
        weight_lbs, length_in, width_in, height_in, shipping_class, handling_fee, handling_days,
        channels_json, status, created_at, updated_at
      ) VALUES (
        ?, ?, ?, 'Used', 3000, ?, ?, '', '', '', ?,
        ?, ?, ?, 'Factory OEM', 'Match stamped OEM part number & photos; contact us with 17-digit VIN to confirm.',
        ?, 'Tested & inspected OEM assembly from verified Aldridge Auto''s yard donor; see multi-angle CDN photos.',
        ?, ?, 1, ?, ?, ?, ?, 1, ?, 1, ?, ?, 0, 1,
        ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?
      )
      ON CONFLICT(sku) DO UPDATE SET
        title = excluded.title,
        category = excluded.category,
        oem_part_number = excluded.oem_part_number,
        donor_vehicle_id = COALESCE(excluded.donor_vehicle_id, inventory_items.donor_vehicle_id),
        description = excluded.description,
        photos_json = excluded.photos_json,
        price_we_pull = excluded.price_we_pull,
        price_self_pull = excluded.price_self_pull,
        price_pull_install = excluded.price_pull_install,
        weight_lbs = excluded.weight_lbs,
        shipping_class = excluded.shipping_class,
        updated_at = excluded.updated_at
    `);

    const hourlyRate = Number(settings.labor_rate_hourly || 135);
    for (const item of cleanActiveItems) {
      const category = inferPartCategory(item.title);
      const isHeavyLocalPickup = !item.requires_shipping || Number(item.weight_lbs) >= 70;
      const shippingClass = isHeavyLocalPickup ? 'local_pickup_only' : computeShippingClass(item.weight_lbs, category, 16, 12, 10);
      const donorKey = `${item.fitment_years}_${(item.fitment_make || '').toLowerCase()}_${(item.fitment_model || '').toLowerCase()}`;
      const donorId = donorLookup.get(donorKey) || null;
      const pullStatus = isHeavyLocalPickup ? 'on_vehicle' : 'pulled_shelved';
      const allowSelfPull = isHeavyLocalPickup && item.price_we_pull >= 60 ? 1 : 0;
      const priceSelfPull = allowSelfPull ? Math.round(item.price_we_pull * 0.72) : 0;
      const laborHours = isHeavyLocalPickup ? 3.0 : 1.2;
      const pricePullInstall = Math.round(item.price_we_pull + laborHours * hourlyRate);
      const secHash = crypto.createHash('sha1').update(item.sku).digest('hex').slice(0, 6).toUpperCase();
      const secCode = `SEC-${secHash}`;
      const binLoc = isHeavyLocalPickup ? `YARD-${(item.fitment_model || 'BAY').slice(0, 6).toUpperCase()}` : `SHELF-${item.sku.slice(4, 7)}`;

      upsertItem.run(
        item.sku,
        item.title,
        category,
        item.fitment_make ? `${item.fitment_make} OEM` : 'OEM',
        item.oem_part_number || '',
        donorId,
        item.fitment_years || '',
        item.fitment_make || '',
        item.fitment_model || '',
        item.description || item.title,
        binLoc,
        secCode,
        JSON.stringify(item.photos),
        pullStatus,
        allowSelfPull,
        priceSelfPull,
        item.price_we_pull,
        pricePullInstall,
        laborHours,
        item.weight_lbs,
        isHeavyLocalPickup ? 42 : 16,
        isHeavyLocalPickup ? 28 : 12,
        isHeavyLocalPickup ? 22 : 10,
        shippingClass,
        Number(settings.handling_fee_default || 10),
        Number(settings.handling_days_default || 3),
        isHeavyLocalPickup ? heavyChannels : parcelChannels,
        now,
        now
      );
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  logSync(
    'inbound',
    'operational_audit_baseline',
    'seed_ground_truth_catalog',
    'ALL',
    'success',
    `Integrated Forensic Operational Audit: verified donor vehicles + ${cleanActiveItems.length} clean CDN-illustrated active SKUs (${stats.archived_catalytic} cats, ${stats.archived_srs_or_missing_photo} SRS/no-photo, ${stats.archived_sold_or_ghost} sold/ghost, ${stats.archived_duplicates_merged} duplicates archived; ${stats.merged_angle_photos_saved} secondary CDN angle photos rescued).`
  );
  return { seeded: true, stats, active_count: cleanActiveItems.length };
}

function ensureCleanSlateBaseline() {
  getSettings();
  const now = new Date().toISOString();

  // Ensure verified Modulo-11 yard donor vehicles are available in dropdown (zero fake/placeholder VINs)
  const donorCount = db.prepare('SELECT COUNT(*) as c FROM donor_vehicles').get().c;
  if (donorCount === 0) {
    try {
      const { AUDIT_DONOR_FLEET } = require('./audit-sanitizer');
      const upsertDonor = db.prepare(`
        INSERT OR IGNORE INTO donor_vehicles (
          stock_number, vin, year, make, model, trim, engine, transmission, drivetrain,
          exterior_color, paint_code, mileage, yard_row, status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const d of AUDIT_DONOR_FLEET) {
        if (validateVinStrict(d.vin).valid && !validateVinStrict(d.vin).empty) {
          upsertDonor.run(
            d.stock_number, d.vin, d.year, d.make, d.model, d.trim, d.engine, d.transmission,
            d.drivetrain, d.exterior_color, d.paint_code, d.mileage, d.yard_row, d.status, d.notes, now
          );
        }
      }
    } catch (_) {
      // Optional audit-sanitizer donor fleet
    }
  }

  // Ensure active Storefront Specials exist even on a fresh volume mount
  const specialCount = db.prepare('SELECT COUNT(*) as c FROM specials').get().c;
  if (specialCount === 0) {
    const insertSpecial = db.prepare(`
      INSERT INTO specials (title, badge, pillar, discount_text, promo_code, description, valid_until, active, share_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    insertSpecial.run(
      'Buy OEM Part + Shop Install Combo',
      'TURNKEY SAVER',
      'parts',
      '15% OFF Installation Labor',
      'PULLINSTALL15',
      'Purchase any stocked or yard-pulled OEM assembly with our "We Pull + We Install" option at Bldg B in University Place and save 15% on bay labor.',
      '2026-12-31',
      22,
      now
    );
    insertSpecial.run(
      'Electrical & Cooling System Diagnostic Promo',
      '5.0★ REPAIR SHOP',
      'repair',
      '$25 OFF Full OBD-II / Electrical Diag',
      'DIAG25',
      'Check-engine light, charging draw, or overheating issue? Get $25 off a full electrical or cooling diagnostic — applied straight toward your repair if completed in-house.',
      '2026-12-31',
      19,
      now
    );
    insertSpecial.run(
      'Direct Website OEM Parts Saver',
      'NO MARKETPLACE FEES',
      'parts',
      '$15 OFF Any $150+ OEM Part Order',
      'DIRECT15',
      'Order directly through Aldridge Auto\'s Master Storefront (Nationwide Ship or Free Bldg B Counter Pickup) and save $15 on any $150+ tested OEM part.',
      '2026-12-31',
      16,
      now
    );
  }
}

let _reviewCatalogMetaCache = null;

function resolveReviewCatalogPath() {
  const candidates = [
    path.join(DATA_DIR, 'review_catalog.json'),
    path.join(BUNDLED_DATA_DIR, 'review_catalog.json')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getReviewCatalogMeta() {
  if (_reviewCatalogMetaCache) return _reviewCatalogMetaCache;
  const catalogPath = resolveReviewCatalogPath();
  if (!catalogPath) {
    return {
      master_drive_folder_id: '1GU119_1CurzYNq1vnQXO3e3po4tp1sz4',
      master_drive_folder_url: 'https://drive.google.com/drive/folders/1GU119_1CurzYNq1vnQXO3e3po4tp1sz4',
      duplicates_filtered: 26578,
      folders_drive_map: {}
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    _reviewCatalogMetaCache = {
      master_drive_folder_id: raw.master_drive_folder_id || '1GU119_1CurzYNq1vnQXO3e3po4tp1sz4',
      master_drive_folder_url: raw.master_drive_folder_url || `https://drive.google.com/drive/folders/${raw.master_drive_folder_id || '1GU119_1CurzYNq1vnQXO3e3po4tp1sz4'}`,
      duplicates_filtered: Number(raw.duplicates_filtered || 26578),
      folders_drive_map: raw.folders_drive_map || {}
    };
    return _reviewCatalogMetaCache;
  } catch (_) {
    return {
      master_drive_folder_id: '1GU119_1CurzYNq1vnQXO3e3po4tp1sz4',
      master_drive_folder_url: 'https://drive.google.com/drive/folders/1GU119_1CurzYNq1vnQXO3e3po4tp1sz4',
      duplicates_filtered: 26578,
      folders_drive_map: {}
    };
  }
}

function seedPhotoReviewCatalogIfNeeded(force = false) {
  const existingCount = db.prepare('SELECT COUNT(*) AS c FROM photo_review_items').get().c;
  if (existingCount > 0 && !force) {
    return { seeded: 0, total: existingCount };
  }
  const catalogPath = resolveReviewCatalogPath();
  if (!catalogPath) {
    return { seeded: 0, total: existingCount };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const items = Array.isArray(raw.items) ? raw.items : [];
    if (!items.length) return { seeded: 0, total: existingCount };
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT ${force ? 'OR REPLACE' : 'OR IGNORE'} INTO photo_review_items (
        photo_uid, vehicle_folder, original_name, title_hint, drive_file_id,
        copied_drive_id, copied_folder_id, source_path, copy_count, size_bytes,
        thumb_url, review_status, vehicle_tag_override, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec('BEGIN;');
    try {
      for (const it of items) {
        stmt.run(
          String(it.photo_uid),
          String(it.vehicle_folder || 'Unidentified_Auto_Parts_Needs_Tag'),
          String(it.original_name || ''),
          String(it.title_hint || ''),
          String(it.drive_file_id || ''),
          String(it.copied_drive_id || ''),
          String(it.copied_folder_id || ''),
          String(it.source_path || ''),
          Number(it.copy_count || 1),
          Number(it.size_bytes || 0),
          String(it.thumb_url || `/review-thumbs/${it.photo_uid}.jpg`),
          String(it.review_status || 'pending'),
          String(it.vehicle_tag_override || ''),
          String(it.notes || ''),
          now
        );
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
    _reviewCatalogMetaCache = null;
    const total = db.prepare('SELECT COUNT(*) AS c FROM photo_review_items').get().c;
    return { seeded: items.length, total };
  } catch (err) {
    console.error('[ReviewCatalog Seed Error]', err.message);
    return { seeded: 0, total: existingCount };
  }
}

function getPhotoReviewSummary() {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN review_status = 'keep' THEN 1 ELSE 0 END) AS keep,
      SUM(CASE WHEN review_status = 'remove' THEN 1 ELSE 0 END) AS remove
    FROM photo_review_items
  `).get();
  const folderRows = db.prepare(`
    SELECT
      CASE WHEN vehicle_tag_override != '' THEN vehicle_tag_override ELSE vehicle_folder END AS folder_name,
      COUNT(*) AS total,
      SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN review_status = 'keep' THEN 1 ELSE 0 END) AS keep,
      SUM(CASE WHEN review_status = 'remove' THEN 1 ELSE 0 END) AS remove,
      MAX(copied_folder_id) AS drive_folder_id
    FROM photo_review_items
    GROUP BY folder_name
    ORDER BY
      CASE WHEN folder_name = 'Unidentified_Auto_Parts_Needs_Tag' THEN 1 ELSE 0 END,
      total DESC,
      folder_name ASC
  `).all();
  const meta = getReviewCatalogMeta();
  const folders = folderRows.map((r) => {
    const fId = meta.folders_drive_map?.[r.folder_name] || r.drive_folder_id || '';
    return {
      name: r.folder_name,
      total: Number(r.total || 0),
      pending: Number(r.pending || 0),
      keep: Number(r.keep || 0),
      remove: Number(r.remove || 0),
      drive_folder_id: fId,
      drive_folder_url: fId ? `https://drive.google.com/drive/folders/${fId}` : meta.master_drive_folder_url
    };
  });
  return {
    total: Number(totals?.total || 0),
    pending: Number(totals?.pending || 0),
    keep: Number(totals?.keep || 0),
    remove: Number(totals?.remove || 0),
    duplicates_filtered: meta.duplicates_filtered,
    master_drive_folder_id: meta.master_drive_folder_id,
    master_drive_folder_url: meta.master_drive_folder_url,
    folders
  };
}

if (getSettings().clean_slate_mode) {
  ensureCleanSlateBaseline();
} else {
  seedDemoDataIfNeeded();
  seedAuditGroundTruthCatalog(false);
}
seedPhotoReviewCatalogIfNeeded(false);

module.exports = {
  db,
  DATA_DIR,
  getSettings,
  updateSettings,
  generateSecurityCode,
  generateReferralCode,
  computeShippingClass,
  validateVinStrict,
  validatePartCompliance,
  upsertCustomer,
  logSync,
  ensureCleanSlateBaseline,
  seedDemoDataIfNeeded,
  seedAuditGroundTruthCatalog,
  seedPhotoReviewCatalogIfNeeded,
  getReviewCatalogMeta,
  getPhotoReviewSummary
};


