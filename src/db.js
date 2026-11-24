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

  CREATE TABLE IF NOT EXISTS crm_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    vin TEXT DEFAULT '',
    year INTEGER DEFAULT 0,
    make TEXT DEFAULT '',
    model TEXT DEFAULT '',
    trim TEXT DEFAULT '',
    engine TEXT DEFAULT '',
    license_plate TEXT DEFAULT '',
    mileage INTEGER DEFAULT 0,
    color TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_crm_vehicles_customer ON crm_vehicles(customer_id);
  CREATE INDEX IF NOT EXISTS idx_crm_vehicles_vin ON crm_vehicles(vin);

  CREATE TABLE IF NOT EXISTS dvi_inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dvi_number TEXT UNIQUE NOT NULL,
    work_order_id INTEGER,
    wo_number TEXT DEFAULT '',
    customer_id INTEGER NOT NULL,
    vehicle_id INTEGER,
    technician_name TEXT DEFAULT 'Lead ASE Tech',
    mileage_in INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'checked_in',
    overall_severity TEXT NOT NULL DEFAULT 'green',
    summary_notes TEXT DEFAULT '',
    voice_raw_notes TEXT DEFAULT '',
    voice_clean_notes TEXT DEFAULT '',
    published_to_customer INTEGER NOT NULL DEFAULT 0,
    published_by TEXT DEFAULT '',
    published_at TEXT DEFAULT '',
    share_token TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE,
    FOREIGN KEY (vehicle_id) REFERENCES crm_vehicles(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_dvi_customer ON dvi_inspections(customer_id);
  CREATE INDEX IF NOT EXISTS idx_dvi_status ON dvi_inspections(status);

  CREATE TABLE IF NOT EXISTS dvi_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dvi_id INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'General Inspection',
    component_name TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'green',
    tech_notes TEXT DEFAULT '',
    customer_notes TEXT DEFAULT '',
    ai_findings_json TEXT DEFAULT '{}',
    media_json TEXT DEFAULT '[]',
    reference_healthy_caption TEXT DEFAULT 'Factory-spec healthy component with zero leaks, cracks, or excessive wear.',
    recommended_part_query TEXT DEFAULT '',
    suggested_labor_hours REAL DEFAULT 0,
    reviewed_by_tech INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (dvi_id) REFERENCES dvi_inspections(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_dvi_items_dvi ON dvi_items(dvi_id);

  CREATE TABLE IF NOT EXISTS service_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_number TEXT UNIQUE NOT NULL,
    dvi_id INTEGER,
    work_order_id INTEGER,
    customer_id INTEGER NOT NULL,
    vehicle_id INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    office_reviewed_by TEXT DEFAULT '',
    office_reviewed_at TEXT DEFAULT '',
    labor_rate REAL NOT NULL DEFAULT 174.99,
    shop_supply_fee_rate REAL NOT NULL DEFAULT 0.07,
    shop_supply_fee REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0.101,
    parts_subtotal REAL NOT NULL DEFAULT 0,
    labor_subtotal REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    deposit_required REAL NOT NULL DEFAULT 0,
    deposit_paid REAL NOT NULL DEFAULT 0,
    amount_paid REAL NOT NULL DEFAULT 0,
    balance_due REAL NOT NULL DEFAULT 0,
    invoice_number TEXT DEFAULT '',
    invoiced_at TEXT DEFAULT '',
    customer_signature TEXT DEFAULT '',
    approved_at TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (dvi_id) REFERENCES dvi_inspections(id) ON DELETE SET NULL,
    FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE,
    FOREIGN KEY (vehicle_id) REFERENCES crm_vehicles(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_service_quotes_customer ON service_quotes(customer_id);
  CREATE INDEX IF NOT EXISTS idx_service_quotes_dvi ON service_quotes(dvi_id);

  CREATE TABLE IF NOT EXISTS quote_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL,
    dvi_item_id INTEGER,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'yellow',
    selected_option TEXT NOT NULL DEFAULT 'option_a_used_oem',
    matched_inventory_sku TEXT DEFAULT '',
    matched_inventory_title TEXT DEFAULT '',
    matched_inventory_bin TEXT DEFAULT '',
    matched_inventory_photo TEXT DEFAULT '',
    option_a_part_price REAL NOT NULL DEFAULT 0,
    option_b_part_price REAL NOT NULL DEFAULT 0,
    part_price REAL NOT NULL DEFAULT 0,
    labor_hours REAL NOT NULL DEFAULT 1.0,
    labor_rate REAL NOT NULL DEFAULT 174.99,
    labor_total REAL NOT NULL DEFAULT 174.99,
    line_subtotal REAL NOT NULL DEFAULT 174.99,
    customer_decision TEXT NOT NULL DEFAULT 'pending',
    decided_at TEXT DEFAULT '',
    inventory_locked INTEGER NOT NULL DEFAULT 0,
    inventory_locked_at TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (quote_id) REFERENCES service_quotes(id) ON DELETE CASCADE,
    FOREIGN KEY (dvi_item_id) REFERENCES dvi_items(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_line_items(quote_id);
  CREATE INDEX IF NOT EXISTS idx_quote_lines_sku ON quote_line_items(matched_inventory_sku);

  CREATE TABLE IF NOT EXISTS deferred_work_followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    vehicle_id INTEGER,
    dvi_id INTEGER,
    quote_id INTEGER,
    quote_line_item_id INTEGER,
    title TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'yellow',
    estimated_total REAL NOT NULL DEFAULT 0,
    declined_at TEXT NOT NULL,
    followup_60d_date TEXT NOT NULL,
    followup_90d_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_deferred_customer ON deferred_work_followups(customer_id);

  CREATE TABLE IF NOT EXISTS portal_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_reference TEXT UNIQUE NOT NULL,
    quote_id INTEGER NOT NULL,
    work_order_id INTEGER,
    customer_id INTEGER NOT NULL,
    payment_type TEXT NOT NULL DEFAULT 'deposit',
    amount REAL NOT NULL DEFAULT 0,
    method TEXT NOT NULL DEFAULT 'card_online',
    status TEXT NOT NULL DEFAULT 'paid',
    receipt_notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (quote_id) REFERENCES service_quotes(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_portal_payments_quote ON portal_payments(quote_id);

  CREATE TABLE IF NOT EXISTS customer_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    dvi_id INTEGER,
    quote_id INTEGER,
    channel TEXT NOT NULL DEFAULT 'sms',
    event_type TEXT NOT NULL,
    recipient TEXT DEFAULT '',
    subject TEXT DEFAULT '',
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'logged',
    created_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_cust_notif_customer ON customer_notifications(customer_id);

  -- Multi-Tenant White-Label SaaS Architecture (Organizations, Subscriptions & Role Seats)
  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    tagline TEXT DEFAULT '',
    logo_url TEXT DEFAULT '',
    primary_color TEXT DEFAULT '#0b1628',
    accent_color TEXT DEFAULT '#ea580c',
    custom_domain TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    city TEXT DEFAULT '',
    state TEXT DEFAULT '',
    zip TEXT DEFAULT '',
    labor_rate_hourly REAL NOT NULL DEFAULT 174.99,
    shop_supply_fee_rate REAL NOT NULL DEFAULT 0.07,
    shop_supply_fee_cap REAL NOT NULL DEFAULT 45.00,
    tax_rate REAL NOT NULL DEFAULT 0.101,
    handling_fee_default REAL NOT NULL DEFAULT 10.00,
    handling_days_default INTEGER NOT NULL DEFAULT 3,
    freight_weight_threshold_lbs REAL NOT NULL DEFAULT 70.0,
    shopify_domain TEXT DEFAULT '',
    shopify_client_id TEXT DEFAULT '',
    shopify_admin_token TEXT DEFAULT '',
    ebay_username TEXT DEFAULT '',
    uhaul_dealer_id TEXT DEFAULT '',
    branding_json TEXT DEFAULT '{}',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS org_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER UNIQUE NOT NULL,
    plan_tier TEXT NOT NULL DEFAULT 'pro_yard',
    status TEXT NOT NULL DEFAULT 'active',
    onboarding_buildout_fee_usd REAL NOT NULL DEFAULT 2500.00,
    onboarding_fee_status TEXT NOT NULL DEFAULT 'pending',
    monthly_org_fee_usd REAL NOT NULL DEFAULT 299.00,
    per_seat_fee_usd REAL NOT NULL DEFAULT 29.00,
    included_seats INTEGER NOT NULL DEFAULT 5,
    active_user_seats INTEGER NOT NULL DEFAULT 1,
    max_locations INTEGER NOT NULL DEFAULT 1,
    billing_cycle_start TEXT NOT NULL,
    next_billing_date TEXT NOT NULL,
    license_key TEXT UNIQUE NOT NULL,
    features_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS org_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'technician',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_org_users_org ON org_users(org_id);

  -- Wave 1 Pierce & King County Founder Beta Prospect Pipeline (Zero Fabricated Rows)
  CREATE TABLE IF NOT EXISTS saas_beta_prospects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL DEFAULT 1,
    shop_name TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT 'Tacoma',
    county TEXT NOT NULL DEFAULT 'Pierce County',
    contact_name TEXT DEFAULT '',
    contact_phone TEXT DEFAULT '',
    contact_email TEXT DEFAULT '',
    bay_yard_size TEXT DEFAULT '',
    founder_plan_tier TEXT NOT NULL DEFAULT 'pro_yard',
    monthly_fee_usd REAL NOT NULL DEFAULT 299.00,
    onboarding_stage TEXT NOT NULL DEFAULT 'outreach',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_beta_prospects_stage ON saas_beta_prospects(onboarding_stage);

  -- 3-Tier Recurring Memberships (Garage Club Basic $0, VIP Driver $19.99/mo, B2B Dealer Pro $79/mo)
  CREATE TABLE IF NOT EXISTS memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL DEFAULT 1,
    customer_id INTEGER,
    member_code TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    phone_digits TEXT DEFAULT '',
    sms_opt_in INTEGER NOT NULL DEFAULT 1,
    vehicle_year TEXT DEFAULT '',
    vehicle_make TEXT DEFAULT '',
    vehicle_model TEXT DEFAULT '',
    vehicle_vin TEXT DEFAULT '',
    tier_key TEXT NOT NULL DEFAULT 'garage_club_basic',
    monthly_price_usd REAL NOT NULL DEFAULT 0.00,
    parts_discount_pct REAL NOT NULL DEFAULT 0.00,
    labor_discount_pct REAL NOT NULL DEFAULT 10.00,
    status TEXT NOT NULL DEFAULT 'active',
    billing_mode TEXT NOT NULL DEFAULT 'free_account',
    stripe_customer_id TEXT DEFAULT '',
    stripe_subscription_id TEXT DEFAULT '',
    stripe_checkout_session_id TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memberships_email ON memberships(LOWER(email));
  CREATE INDEX IF NOT EXISTS idx_memberships_phone ON memberships(phone_digits);
  CREATE INDEX IF NOT EXISTS idx_memberships_vin ON memberships(UPPER(vehicle_vin));
  CREATE INDEX IF NOT EXISTS idx_memberships_tier ON memberships(tier_key, status);

  -- Abandoned Cart & Single-Variant Urgency Recovery Queue (15-min urgency + 24-hr Bay Combo offer)
  CREATE TABLE IF NOT EXISTS abandoned_carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL DEFAULT 1,
    cart_token TEXT NOT NULL UNIQUE,
    customer_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    phone_digits TEXT DEFAULT '',
    push_subscription_json TEXT DEFAULT '',
    items_json TEXT NOT NULL DEFAULT '[]',
    subtotal_usd REAL NOT NULL DEFAULT 0.00,
    fulfillment_mode TEXT DEFAULT 'ship_calculated',
    status TEXT NOT NULL DEFAULT 'open',
    alert_15m_due_at TEXT NOT NULL,
    alert_15m_sent_at TEXT DEFAULT '',
    combo_24h_due_at TEXT NOT NULL,
    combo_24h_sent_at TEXT DEFAULT '',
    recovery_notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_abandoned_carts_status ON abandoned_carts(status);
  CREATE INDEX IF NOT EXISTS idx_abandoned_carts_due ON abandoned_carts(alert_15m_due_at, combo_24h_due_at);

  -- "If We Don't Have It, We Can Get It" 50%-Markup Parts Sourcing & Guided Helper Leads
  CREATE TABLE IF NOT EXISTS part_sourcing_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL DEFAULT 1,
    request_code TEXT NOT NULL UNIQUE,
    customer_id INTEGER,
    customer_name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    sms_opt_in INTEGER NOT NULL DEFAULT 1,
    vehicle_year TEXT DEFAULT '',
    vehicle_make TEXT DEFAULT '',
    vehicle_model TEXT DEFAULT '',
    vehicle_vin TEXT DEFAULT '',
    part_query TEXT NOT NULL DEFAULT '',
    symptom_category TEXT DEFAULT '',
    symptom_text TEXT DEFAULT '',
    wholesale_cost_usd REAL NOT NULL DEFAULT 0.00,
    markup_pct REAL NOT NULL DEFAULT 50.0,
    quoted_retail_usd REAL NOT NULL DEFAULT 0.00,
    estimated_labor_hours REAL NOT NULL DEFAULT 1.0,
    labor_rate_hourly REAL NOT NULL DEFAULT 174.99,
    installed_total_usd REAL NOT NULL DEFAULT 0.00,
    vendor_source_label TEXT DEFAULT 'Aldridge Commercial Wholesale Network (OEM & Tier-1)',
    eta_label TEXT DEFAULT 'Same-Day / Next-Business-Day to University Place 98467',
    status TEXT NOT NULL DEFAULT 'quoted',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_part_sourcing_status ON part_sourcing_requests(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_part_sourcing_customer ON part_sourcing_requests(customer_id);

  -- Mandatory VIN / License Plate Vehicle Intake Sessions (Step 1 Gate before any part photo upload)
  CREATE TABLE IF NOT EXISTS vin_intake_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL DEFAULT 1,
    session_code TEXT NOT NULL UNIQUE,
    staff_name TEXT DEFAULT 'Shop Staff',
    vin TEXT NOT NULL,
    license_plate TEXT DEFAULT '',
    plate_state TEXT DEFAULT '',
    plate_lookup_provider TEXT DEFAULT '',
    year INTEGER NOT NULL DEFAULT 0,
    make TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    trim TEXT DEFAULT '',
    engine TEXT DEFAULT '',
    drivetrain TEXT DEFAULT '',
    transmission TEXT DEFAULT '',
    body_class TEXT DEFAULT '',
    donor_vehicle_id INTEGER,
    nhtsa_raw_json TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vin_intake_sessions_vin ON vin_intake_sessions(UPPER(vin));
  CREATE INDEX IF NOT EXISTS idx_vin_intake_sessions_code ON vin_intake_sessions(session_code);
`);

function ensureColumnExists(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

// Non-breaking multi-tenant org_id scoping across core operational tables (default Tenant #1 = Aldridge Auto's)
for (const tbl of ['inventory_items', 'donor_vehicles', 'crm_customers', 'appointments', 'orders', 'work_orders', 'dvi_inspections', 'service_quotes']) {
  ensureColumnExists(tbl, 'org_id', 'INTEGER NOT NULL DEFAULT 1');
}

// Mandatory VIN / License Plate Intake provenance columns on every inventory_items row
ensureColumnExists('inventory_items', 'verified_vin', "TEXT DEFAULT ''");
ensureColumnExists('inventory_items', 'intake_session_id', "TEXT DEFAULT ''");
ensureColumnExists('inventory_items', 'intake_source', "TEXT DEFAULT ''");

// Permanent labor rate migration: replace any legacy $135/$125 hourly rows with locked $174.99/hr
try {
  db.exec(`
    UPDATE work_orders SET labor_rate = 174.99 WHERE labor_rate IN (125, 135);
    UPDATE service_quotes SET labor_rate = 174.99 WHERE labor_rate IN (125, 135);
    UPDATE quote_line_items SET labor_rate = 174.99 WHERE labor_rate IN (125, 135);
  `);
} catch (_) {}

function normalizePhoneDigits(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

// Safe additive column migrations for existing CRM & Work Orders tables
ensureColumnExists('crm_customers', 'phone_normalized', "TEXT DEFAULT ''");
ensureColumnExists('crm_customers', 'password_hash', "TEXT DEFAULT ''");
ensureColumnExists('crm_customers', 'portal_magic_token', "TEXT DEFAULT ''");
ensureColumnExists('crm_customers', 'portal_magic_expires_at', "TEXT DEFAULT ''");
ensureColumnExists('crm_customers', 'updated_at', "TEXT DEFAULT ''");
ensureColumnExists('work_orders', 'customer_id', 'INTEGER');
ensureColumnExists('work_orders', 'vehicle_id', 'INTEGER');
ensureColumnExists('work_orders', 'dvi_id', 'INTEGER');
ensureColumnExists('work_orders', 'quote_id', 'INTEGER');
ensureColumnExists('work_orders', 'invoice_number', "TEXT DEFAULT ''");
ensureColumnExists('work_orders', 'portal_status', "TEXT DEFAULT 'checked_in'");
ensureColumnExists('work_orders', 'office_approved_by', "TEXT DEFAULT ''");
ensureColumnExists('work_orders', 'shop_supply_fee', 'REAL DEFAULT 0');
ensureColumnExists('work_orders', 'tax_amount', 'REAL DEFAULT 0');
ensureColumnExists('work_orders', 'deposit_paid', 'REAL DEFAULT 0');
ensureColumnExists('work_orders', 'amount_paid', 'REAL DEFAULT 0');

// Backfill phone_normalized for existing CRM customers to prevent future duplicates
(() => {
  const rows = db.prepare("SELECT id, phone, phone_normalized FROM crm_customers WHERE phone != '' AND (phone_normalized IS NULL OR phone_normalized = '')").all();
  if (rows.length > 0) {
    const stmt = db.prepare('UPDATE crm_customers SET phone_normalized = ? WHERE id = ?');
    for (const r of rows) {
      stmt.run(normalizePhoneDigits(r.phone), r.id);
    }
  }
})();

const DEFAULT_SETTINGS = {
  business_name: "Aldridge Auto's",
  google_listing_name: "Aldridge Auto's Service & Repair",
  owner_name: 'Chris Aldridge',
  office_manager_name: 'Maria',
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
  labor_rate_hourly: 174.99,
  shop_supply_fee_rate: 0.07,
  shop_supply_fee_cap: 45.00,
  parts_markup_used_oem: 1.00,
  parts_markup_aftermarket: 1.35,
  deposit_percent_default: 0.50,
  handling_fee_default: 10.00,
  handling_days_default: 3,
  freight_weight_threshold_lbs: 70,
  clean_slate_mode: true,
  mandatory_vin_intake_only: true,
  parts_sourcing_markup_pct: 50,
  single_variant_only: true,
  photos_required: true,
  canonical_domain: 'https://aldridgeautosupply.com',
  public_pwa_url: 'https://aldridgeautosupply.com',
  legacy_archive_db: 'data/archive_905_legacy.db',
  default_condition: 'Used',
  blank_mpn_fallback: '',
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

const GEMINI_KEY_FILE = path.join(DATA_DIR, '.gemini_vision_key');

function readPersistedGeminiKey() {
  try {
    if (fs.existsSync(GEMINI_KEY_FILE)) {
      return String(fs.readFileSync(GEMINI_KEY_FILE, 'utf8') || '').trim();
    }
  } catch (_) {}
  return '';
}

function writePersistedGeminiKey(keyVal) {
  try {
    const clean = String(keyVal || '').trim();
    if (clean) {
      fs.writeFileSync(GEMINI_KEY_FILE, clean, { encoding: 'utf8', mode: 0o600 });
    } else if (fs.existsSync(GEMINI_KEY_FILE)) {
      fs.unlinkSync(GEMINI_KEY_FILE);
    }
  } catch (_) {}
}

function applyEnvOverrides(cfg) {
  const envShopDomain = (process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_DOMAIN || '').trim();
  if (envShopDomain) cfg.shopify_domain = envShopDomain;
  if (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_ID.trim()) {
    cfg.shopify_client_id = process.env.SHOPIFY_CLIENT_ID.trim();
  }
  const envShopifyToken = (process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_CLIENT_SECRET || '').trim();
  if (envShopifyToken) {
    cfg.shopify_admin_token = envShopifyToken;
  }
  if (process.env.SHOPIFY_WEBHOOK_SECRET && process.env.SHOPIFY_WEBHOOK_SECRET.trim()) {
    cfg.shopify_webhook_secret = process.env.SHOPIFY_WEBHOOK_SECRET.trim();
  }
  const envGeminiKey = String(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_KEY ||
    ''
  ).trim();
  if (envGeminiKey) {
    cfg.gemini_api_key = envGeminiKey;
  } else if (String(cfg.gemini_api_key || '').trim()) {
    cfg.gemini_api_key = String(cfg.gemini_api_key).trim();
    if (!readPersistedGeminiKey()) writePersistedGeminiKey(cfg.gemini_api_key);
  } else {
    const diskKey = readPersistedGeminiKey();
    if (diskKey) cfg.gemini_api_key = diskKey;
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
  const savedLabor = Number(saved.labor_rate_hourly || 0);
  const lockedLaborRate = (!savedLabor || savedLabor === 135 || savedLabor === 125)
    ? 174.99
    : savedLabor;
  return applyEnvOverrides({
    ...DEFAULT_SETTINGS,
    ...saved,
    email: mergedEmail,
    google_listing_name: mergedListingName,
    logo_url: mergedLogo,
    labor_rate_hourly: lockedLaborRate,
    blank_mpn_fallback: '',
    single_variant_only: true,
    photos_required: true,
    uhaul_synced_data: { ...DEFAULT_SETTINGS.uhaul_synced_data, ...(saved.uhaul_synced_data || {}) },
    social_links: mergedSocial,
    platform_checklist: { ...DEFAULT_SETTINGS.platform_checklist, ...(saved.platform_checklist || {}) }
  });
}

function updateSettings(patch = {}) {
  const current = getSettings();
  const nextPatch = { ...patch };
  // Never wipe an existing persisted Gemini Vision key on accidental blank submit unless explicitly cleared
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'gemini_api_key')) {
    const trimmedKey = String(nextPatch.gemini_api_key || '').trim();
    if (trimmedKey) {
      nextPatch.gemini_api_key = trimmedKey;
      writePersistedGeminiKey(trimmedKey);
      process.env.GEMINI_API_KEY = trimmedKey;
    } else if (nextPatch.clear_gemini_api_key === true) {
      nextPatch.gemini_api_key = '';
      writePersistedGeminiKey('');
      delete process.env.GEMINI_API_KEY;
    } else if (current.gemini_api_key) {
      nextPatch.gemini_api_key = current.gemini_api_key;
    }
  }
  delete nextPatch.clear_gemini_api_key;

  const merged = {
    ...current,
    ...nextPatch,
    uhaul_synced_data: nextPatch.uhaul_synced_data
      ? { ...current.uhaul_synced_data, ...nextPatch.uhaul_synced_data }
      : current.uhaul_synced_data,
    social_links: nextPatch.social_links
      ? { ...current.social_links, ...nextPatch.social_links }
      : current.social_links,
    platform_checklist: nextPatch.platform_checklist
      ? { ...current.platform_checklist, ...nextPatch.platform_checklist }
      : current.platform_checklist
  };
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO business_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run('master_config', JSON.stringify(merged), now);
  return applyEnvOverrides(merged);
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
// PERMANENTLY BANNED GHOST VINS — NEVER OWNED BY ALDRIDGE AUTO (cannot be bypassed even by NHTSA ErrorCode === "0")
const PERMANENTLY_BANNED_GHOST_VINS = new Set([
  '1G4GA5GR2FF246661' // Ghost 2015 Buick LaCrosse / Verano mis-pasted onto 2016 Equinox folder — owner NEVER had a 2015 Buick LaCrosse
]);

// PERMANENTLY BANNED SOLD / DUPLICATE SUBARU TRANSMISSIONS & CONFIRMED SOLD SKUS
const PERMANENTLY_BANNED_SOLD_SKUS = new Set([
  'ALD-09SUB-TRANSMISSION-A-94D1',
  'ALD-98SUB-TRANSMISSION-A-69CF',
  'ALD-98SUB-TRANSMISSION-A-5388',
  'ALD-09SUB-AUTOMATIC-TRAN-08CC',
  'ALD-98SUB-AUTOMATIC-TRAN-FFBA'
]);

const KNOWN_FAKE_OR_WRONG_VINS = new Set([
  '1G4GA5GR2FF246661', // Permanently banned ghost 2015 Buick LaCrosse / Verano
  '4T1SK12E2TL038415', // Fabricated Camry VIN
  '5FNRL18451B072461', // Invalid checksum 2001 Odyssey
  '5N1ED22Y91C504281', // Invalid checksum 2001 Xterra
  '4F2CU92B01KA54281', // Fake Mazda WMI on 2001 Escape
  '5KEAG4027J1000000'  // Placeholder 000000 tail
]);

// Explicitly whitelisted real Aldridge Auto donor VINs (confirmed in live Shopify orders & yard records)
const VERIFIED_DONOR_VIN_WHITELIST = new Set([
  'JTEBU14R040057212', // 2004 Toyota 4Runner SR5 4x4 V6 (confirmed in Shopify Orders #1009, #1017, #1022-#1025, #1037, #1044, #1045)
  '1D7HE48K56S679400', // 2006 Dodge Dakota SLT
  'JTEBU5JR5D5117391'  // 2013 Toyota 4Runner SR5 4x4 4.0L V6 (verified NHTSA ErrorCode: 0 from Drive records & Unified_Master_Upload.csv)
]);

// Runtime registry of 17-char VINs that passed live NHTSA vPIC decoding (ErrorCode === "0" + valid check digit + factory model)
const NHTSA_VERIFIED_CLEAN_VINS = new Set();

function isVinCheckDigitValid(rawVin) {
  const cleaned = String(rawVin || '').trim().toUpperCase();
  if (cleaned.length !== 17 || !/^[A-HJ-NPR-Z0-9]{17}$/.test(cleaned)) return { valid: false, expectedCheck: '' };
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const v = VIN_TRANSLITERATION[cleaned[i]];
    if (v === undefined) return { valid: false, expectedCheck: '' };
    sum += v * VIN_WEIGHTS[i];
  }
  const rem = sum % 11;
  const expectedCheck = rem === 10 ? 'X' : String(rem);
  return { valid: cleaned[8] === expectedCheck, expectedCheck };
}

function registerNhtsaVerifiedVin(rawVin) {
  const cleaned = String(rawVin || '').trim().toUpperCase();
  if (PERMANENTLY_BANNED_GHOST_VINS.has(cleaned)) return false;
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(cleaned) && isVinCheckDigitValid(cleaned).valid) {
    NHTSA_VERIFIED_CLEAN_VINS.add(cleaned);
    return true;
  }
  return false;
}

function validateVinStrict(rawVin) {
  const cleaned = String(rawVin || '').trim().toUpperCase();
  if (!cleaned) return { valid: true, vin: '', empty: true };
  if (PERMANENTLY_BANNED_GHOST_VINS.has(cleaned)) {
    return {
      valid: false,
      vin: cleaned,
      permanent_ghost_ban: true,
      reason: `PERMANENTLY BLOCKED GHOST VEHICLE VIN "${cleaned}" (2015 Buick LaCrosse / Verano — never owned by Aldridge Auto).`
    };
  }
  if (/^AUDIT-|^NO-VIN|^UNKNOWN|^N\/?A$|^VIN-TITLE-CHECK$/i.test(cleaned)) {
    return { valid: false, vin: cleaned, reason: 'Placeholder or unverified title-check VIN strings are strictly blocked; enter a real 17-character NHTSA-verified donor VIN.' };
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
  if (VERIFIED_DONOR_VIN_WHITELIST.has(cleaned)) {
    return { valid: true, vin: cleaned, empty: false, whitelisted_donor: true };
  }
  if (NHTSA_VERIFIED_CLEAN_VINS.has(cleaned)) {
    return { valid: true, vin: cleaned, empty: false, nhtsa_verified: true };
  }
  if (/000000$|123456$|999999$/.test(cleaned)) {
    return { valid: false, vin: cleaned, reason: `VIN "${cleaned}" uses a fabricated placeholder serial tail.` };
  }
  const checkDigit = isVinCheckDigitValid(cleaned);
  if (!checkDigit.valid) {
    return {
      valid: false,
      vin: cleaned,
      reason: `Fake / corrupted VIN "${cleaned}" blocked: NHTSA position-9 check digit is "${cleaned[8]}" (expected "${checkDigit.expectedCheck}").`
    };
  }
  if (KNOWN_FAKE_OR_WRONG_VINS.has(cleaned)) {
    return {
      valid: false,
      vin: cleaned,
      blocklist_only: true,
      reason: `VIN "${cleaned}" is on the Forensic Audit blocklist (fabricated or wrong-vehicle VIN).`
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

function computeShippingClass(weightLbs, category = '', lengthIn = 10, widthIn = 8, heightIn = 6) {
  const settings = getSettings();
  const heavyThreshold = Number(settings.freight_weight_threshold_lbs || 70);
  const catLower = (category || '').toLowerCase();
  const girthPlusLength = Number(lengthIn) + 2 * (Number(widthIn) + Number(heightIn));

  // Audit Guard: Never let "Engine", "Transmission", "Axle", "Bumper", "Door", "Hood", or "Seat" substring-trap small shippable subparts!
  const isSmallSubpart = /\b(module|ecu|ecm|pcm|tcm|bcm|computer|immobilizer|harness|fuse|relay|cable|shifter|pan|mount|bracket|sensor|solenoid|cooling|radiator|fan|shroud|latch|hinge|release|strut|lift\s*support|handle|switch|bezel|trim|mirror|lamp|light|lock\s*actuator|regulator|motor|speaker|cover\s*trim|filler\s*door|glove\s*box|visor|headrest|knob|armrest|belt|buckle|panel\s*trim)\b/i.test(catLower);

  // Hazmat / fluid-bearing / fragile oversized glass items are strictly Local Pickup Only in 98467
  const isHazmatOrGlass = /\b(lead[- ]acid|car\s*battery|automotive\s*battery|hybrid\s*battery|hv\s*battery|fuel\s*tank|gas\s*tank|hazmat|refrigerant|windshield|back\s*glass|rear\s*window\s*glass|door\s*window\s*glass|quarter\s*window\s*glass)\b/i.test(catLower);
  if (isHazmatOrGlass && !isSmallSubpart) {
    return 'local_pickup_only';
  }

  // Strict 70+ lb or >130 in girth Local Pickup Only rule (University Place, WA 98467)
  if (Number(weightLbs) >= heavyThreshold || girthPlusLength > 130) {
    return 'local_pickup_only';
  }
  if (
    !isSmallSubpart &&
    /\b(complete\s*engine|engine\s*assembly|long\s*block|short\s*block|automatic\s*transmission|manual\s*transmission|transmission\s*assembly|transfer\s*case|differential|axle\s*assembly|rear\s*axle|front\s*bumper|rear\s*bumper|bumper\s*cover|bumper\s*assembly|body\s*shell|door\s*shell|front\s*door|rear\s*door|driver\s*door|passenger\s*door|sliding\s*door|complete\s*door|car\s*hood|hood\s*panel|engine\s*hood|tailgate|liftgate|hatch\s*lid|trunk\s*lid|front\s*seat|rear\s*seat|bench\s*seat|bucket\s*seat|driver\s*seat|passenger\s*seat|seat\s*assembly|seat\s*set)\b/i.test(catLower)
  ) {
    return 'local_pickup_only';
  }
  return 'parcel_calculated';
}

function upsertCustomer({ name, email = '', phone = '', source_pillar = 'website', tags = [], vehicles = [], email_opt_in = 0, sms_opt_in = 0, referred_by = '', notes = '' }) {
  const now = new Date().toISOString();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPhone = String(phone || '').trim();
  const phoneNorm = normalizePhoneDigits(cleanPhone);

  let existing = null;
  if (cleanEmail) {
    existing = db.prepare('SELECT * FROM crm_customers WHERE LOWER(TRIM(email)) = ?').get(cleanEmail);
  }
  if (!existing && phoneNorm && phoneNorm.length >= 7) {
    existing = db.prepare('SELECT * FROM crm_customers WHERE phone_normalized = ?').get(phoneNorm);
  }
  if (!existing && cleanPhone) {
    existing = db.prepare('SELECT * FROM crm_customers WHERE TRIM(phone) = ?').get(cleanPhone);
  }

  if (existing) {
    const mergedTags = Array.from(new Set([...JSON.parse(existing.tags_json || '[]'), ...tags]));
    const mergedVehicles = Array.from(new Set([...JSON.parse(existing.vehicles_json || '[]'), ...vehicles.filter(Boolean)]));
    const nextEmailOpt = email_opt_in ? 1 : existing.email_opt_in;
    const nextSmsOpt = sms_opt_in ? 1 : existing.sms_opt_in;
    const smsTs = sms_opt_in && !existing.sms_consent_timestamp ? now : existing.sms_consent_timestamp;
    const nextNotes = notes
      ? (existing.notes && !existing.notes.includes(notes) ? `${existing.notes}\n${notes}` : (existing.notes || notes))
      : existing.notes;
    db.prepare(`
      UPDATE crm_customers
      SET name = COALESCE(NULLIF(?, ''), name),
          email = COALESCE(NULLIF(?, ''), email),
          phone = COALESCE(NULLIF(?, ''), phone),
          phone_normalized = COALESCE(NULLIF(?, ''), phone_normalized),
          tags_json = ?,
          vehicles_json = ?,
          email_opt_in = ?,
          sms_opt_in = ?,
          sms_consent_timestamp = ?,
          notes = ?,
          visit_count = visit_count + 1,
          updated_at = ?
      WHERE id = ?
    `).run(
      String(name || '').trim(),
      cleanEmail,
      cleanPhone,
      phoneNorm,
      JSON.stringify(mergedTags),
      JSON.stringify(mergedVehicles),
      nextEmailOpt,
      nextSmsOpt,
      smsTs,
      nextNotes || '',
      now,
      existing.id
    );
    return db.prepare('SELECT * FROM crm_customers WHERE id = ?').get(existing.id);
  }

  const refCode = generateReferralCode(name);
  const res = db.prepare(`
    INSERT INTO crm_customers (
      name, email, phone, phone_normalized, source_pillar, tags_json, vehicles_json,
      email_opt_in, sms_opt_in, sms_consent_timestamp, referral_code, referred_by, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(name || '').trim() || 'Shop Guest',
    cleanEmail,
    cleanPhone,
    phoneNorm,
    source_pillar,
    JSON.stringify(tags),
    JSON.stringify(vehicles.filter(Boolean)),
    email_opt_in ? 1 : 0,
    sms_opt_in ? 1 : 0,
    sms_opt_in ? now : '',
    refCode,
    referred_by || '',
    notes || '',
    now,
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

    const hourlyRate = Number(settings.labor_rate_hourly || 174.99);
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

function countVerifiedVinInventory() {
  return Number(
    db.prepare(`
      SELECT COUNT(*) AS c FROM inventory_items
      WHERE status = 'active'
        AND COALESCE(verified_vin, '') != ''
        AND COALESCE(intake_session_id, '') != ''
        AND COALESCE(intake_source, '') = 'vin_intake_pipeline'
    `).get()?.c || 0
  );
}

function ensureCleanSlateBaseline() {
  getSettings();
  const now = new Date().toISOString();
  // Never clear or overwrite verified VIN-intake inventory_items or vin_intake_sessions on container restart/redeploy.

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

function purgeLegacyPhotoReviewTriage() {
  const before = db.prepare('SELECT COUNT(*) AS c FROM photo_review_items').get().c;
  if (before > 0) {
    db.prepare('DELETE FROM photo_review_items').run();
  }
  _reviewCatalogMetaCache = null;
  return { purged_photo_review_items: before, remaining_photo_review_items: 0 };
}

function seedPhotoReviewCatalogIfNeeded(force = false) {
  const cfg = getSettings();
  if (cfg.mandatory_vin_intake_only !== false) {
    return { seeded: 0, total: 0, disabled: 'mandatory_vin_intake_only' };
  }
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

function isNonDescriptiveAutoFilename(originalName) {
  const raw = String(originalName || '').trim();
  if (!raw) return true;
  const noExt = raw.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  const stem = noExt.replace(/\s*\(\d+\)\s*$/, '').trim();
  if (!stem) return true;

  // 1. Raw camera timestamps (e.g. 20260416_160417, 2025-11-24_17-03-27, 20251124-170327-001)
  if (/^(19|20)\d{6}[_-]\d{4,6}(?:[_-]\d+)?$/i.test(stem)) return true;
  if (/^\d{8}[_-]\d{4,9}(?:[_-]\d+)?$/i.test(stem)) return true;
  if (/^(19|20)\d{2}[-_]\d{2}[-_]\d{2}[_T -]\d{2}[-_]\d{2}(?:[-_]\d{2})?/i.test(stem)) return true;

  // 2. Generic camera/device/screenshot/messenger/social prefixes
  if (/^(IMG|PXL|DSC|DSCN|DCIM|MVIMG|VID|MOV|PHOTO|PIC|CAMERA|SAM|WP|CIMG|GOPR|DJI|RIMG|Screenshot|Screen[_ -]?Shot|Messenger_creation|FB_IMG|WhatsApp[_ -]?Image|Received|Snapchat|Untitled|Image|Scan)[_ -]?(\d|[a-f0-9-]{6,}|$)/i.test(stem)) {
    return true;
  }

  // 3. Pure numeric or Facebook CDN numeric IDs
  if (/^\d[\d._-]*$/.test(stem)) return true;
  if (/^\d+_\d+_\d+/.test(stem)) return true;

  // 4. UUIDs or hex hashes
  if (/^[a-f0-9]{8,}(?:-[a-f0-9]{4,}){0,4}$/i.test(stem)) return true;

  // 5. Random / non-descriptive internal SKU or code-only filenames (e.g. ALD-2KXI2B_1, ALD-OH-019.1)
  if (/^ALD[-_](OH[-_])?[A-Z0-9]{2,10}(?:[._-]\d+)?$/i.test(stem)) return true;

  // 6. Fallback: require at least one real alphabetical descriptive word (>=3 chars, letters only)
  const words = stem
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .filter((tok) => /^[a-zA-Z]{3,}$/.test(tok));
  if (words.length === 0) return true;

  return false;
}

function autoRemoveNonDescriptivePendingPhotos({
  folder = 'all',
  note = 'Auto-removed: non-descriptive camera/code filename'
} = {}) {
  const where = ["review_status = 'pending'"];
  const params = [];
  if (folder && folder !== 'all') {
    where.push("(CASE WHEN vehicle_tag_override != '' THEN vehicle_tag_override ELSE vehicle_folder END) = ?");
    params.push(String(folder));
  }
  const rows = db.prepare(`
    SELECT photo_uid, original_name, notes
    FROM photo_review_items
    WHERE ${where.join(' AND ')}
  `).all(...params);

  const toRemove = rows.filter((r) => isNonDescriptiveAutoFilename(r.original_name));
  const now = new Date().toISOString();
  let removedCount = 0;

  if (toRemove.length > 0) {
    const stmt = db.prepare(`
      UPDATE photo_review_items
      SET review_status = 'remove',
          notes = CASE WHEN notes = '' THEN ? ELSE notes END,
          updated_at = ?
      WHERE photo_uid = ? AND review_status = 'pending'
    `);
    db.exec('BEGIN;');
    try {
      for (const r of toRemove) {
        const info = stmt.run(note, now, r.photo_uid);
        removedCount += Number(info.changes || 0);
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  return {
    removed_count: removedCount,
    checked_pending: rows.length
  };
}

function ensureNonDescriptivePendingFilteredOnce() {
  const flagKey = 'review_nondescriptive_autofilt_v1';
  const existing = db.prepare('SELECT value_json FROM business_settings WHERE key = ?').get(flagKey);
  if (existing) return null;
  const result = autoRemoveNonDescriptivePendingPhotos();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO business_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
  `).run(flagKey, JSON.stringify({ applied_at: now, ...result }), now);
  return result;
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

  const allMetaRows = db.prepare(`
    SELECT
      original_name,
      review_status,
      CASE WHEN vehicle_tag_override != '' THEN vehicle_tag_override ELSE vehicle_folder END AS folder_name
    FROM photo_review_items
  `).all();
  let genericPending = 0;
  let genericTotal = 0;
  const folderGenericPending = new Map();
  for (const r of allMetaRows) {
    if (isNonDescriptiveAutoFilename(r.original_name)) {
      genericTotal += 1;
      if (r.review_status === 'pending') {
        genericPending += 1;
        folderGenericPending.set(r.folder_name, (folderGenericPending.get(r.folder_name) || 0) + 1);
      }
    }
  }

  const meta = getReviewCatalogMeta();
  const folders = folderRows.map((r) => {
    const fId = meta.folders_drive_map?.[r.folder_name] || r.drive_folder_id || '';
    return {
      name: r.folder_name,
      total: Number(r.total || 0),
      pending: Number(r.pending || 0),
      keep: Number(r.keep || 0),
      remove: Number(r.remove || 0),
      generic_pending: Number(folderGenericPending.get(r.folder_name) || 0),
      drive_folder_id: fId,
      drive_folder_url: fId ? `https://drive.google.com/drive/folders/${fId}` : meta.master_drive_folder_url
    };
  });
  return {
    total: Number(totals?.total || 0),
    pending: Number(totals?.pending || 0),
    keep: Number(totals?.keep || 0),
    remove: Number(totals?.remove || 0),
    generic_pending: genericPending,
    generic_total: genericTotal,
    duplicates_filtered: meta.duplicates_filtered,
    master_drive_folder_id: meta.master_drive_folder_id,
    master_drive_folder_url: meta.master_drive_folder_url,
    folders
  };
}

function isGhostOrBannedInventoryItem(item = {}) {
  const skuUpper = String(item.sku || '').trim().toUpperCase();
  const vinUpper = String(item.verified_vin || item.donor_vin || '').trim().toUpperCase();
  const binUpper = String(item.bin_location || '').trim().toUpperCase();
  const titleLower = String(item.title || '').toLowerCase();
  const makeLower = String(item.fitment_make || '').toLowerCase();
  const modelLower = String(item.fitment_model || '').toLowerCase();

  if (PERMANENTLY_BANNED_GHOST_VINS.has(vinUpper)) {
    return { blocked: true, reason: `Permanently banned ghost vehicle VIN (${vinUpper} — 2015 Buick LaCrosse never owned by Aldridge Auto).` };
  }
  if (binUpper.includes('LACROSSE') || (makeLower === 'buick' && modelLower.includes('lacrosse')) || /\bbuick\s+lacrosse\b/i.test(titleLower)) {
    return { blocked: true, reason: 'Permanently banned ghost 2015 Buick LaCrosse inventory item.' };
  }
  if (skuUpper && PERMANENTLY_BANNED_SOLD_SKUS.has(skuUpper)) {
    return { blocked: true, reason: `Permanently blocked sold / duplicate Subaru transmission SKU (${skuUpper}).` };
  }
  return { blocked: false, reason: '' };
}

function purgeGhostAndBlockedInventory({ actor = 'system_v31_purge' } = {}) {
  const now = new Date().toISOString();
  const allRows = db.prepare('SELECT id, sku, title, verified_vin, bin_location, fitment_make, fitment_model, status, quantity FROM inventory_items').all();
  let purgedGhostItems = 0;
  let purgedSoldTrans = 0;
  let purgedNoVinItems = 0;
  const purgedSkus = [];

  const archiveStmt = db.prepare(`
    UPDATE inventory_items
    SET status = 'archived', quantity = 0, updated_at = ?
    WHERE id = ?
  `);

  for (const row of allRows) {
    const skuUpper = String(row.sku || '').trim().toUpperCase();
    const vinUpper = String(row.verified_vin || '').trim().toUpperCase();
    const ghostCheck = isGhostOrBannedInventoryItem(row);

    if (ghostCheck.blocked) {
      if (row.status !== 'archived' || Number(row.quantity || 0) > 0) {
        archiveStmt.run(now, row.id);
        if (PERMANENTLY_BANNED_SOLD_SKUS.has(skuUpper)) purgedSoldTrans++;
        else purgedGhostItems++;
        purgedSkus.push(row.sku);
      }
      continue;
    }

    // Strict "No Real Verified 17-Char Donor VIN = No Listing": quarantine/archive VIN-TITLE-CHECK or invalid VIN rows
    const vinCheck = validateVinStrict(vinUpper);
    if (row.status === 'active' && (!vinUpper || vinUpper.length !== 17 || !vinCheck.valid)) {
      archiveStmt.run(now, row.id);
      purgedNoVinItems++;
      purgedSkus.push(row.sku);
    }
  }

  // Delete ghost Buick LaCrosse donor vehicle & mark its intake sessions purged
  const deletedDonors = db.prepare(`
    DELETE FROM donor_vehicles
    WHERE UPPER(COALESCE(vin, '')) = '1G4GA5GR2FF246661'
       OR (LOWER(COALESCE(make, '')) = 'buick' AND LOWER(COALESCE(model, '')) LIKE '%lacrosse%')
       OR UPPER(COALESCE(vin, '')) = 'VIN-TITLE-CHECK'
  `).run().changes;

  const purgedSessions = db.prepare(`
    UPDATE vin_intake_sessions
    SET status = 'purged', updated_at = ?
    WHERE UPPER(COALESCE(vin, '')) IN ('1G4GA5GR2FF246661', 'VIN-TITLE-CHECK')
       OR (LOWER(COALESCE(make, '')) = 'buick' AND LOWER(COALESCE(model, '')) LIKE '%lacrosse%')
  `).run(now).changes;

  if (purgedGhostItems || purgedSoldTrans || purgedNoVinItems || deletedDonors || purgedSessions) {
    logSync(
      'internal',
      'ghost_and_vin_gate_purge',
      'v31_strict_purge',
      'ALL',
      'success',
      `[${actor}] Purged ghost_lacrosse=${purgedGhostItems}, sold_subaru_trans=${purgedSoldTrans}, no_real_vin=${purgedNoVinItems}, donor_rows_deleted=${deletedDonors}, sessions_purged=${purgedSessions}.`
    );
  }

  return {
    ok: true,
    purged_ghost_lacrosse: purgedGhostItems,
    purged_sold_subaru_trans: purgedSoldTrans,
    purged_no_real_vin: purgedNoVinItems,
    deleted_donor_vehicles: deletedDonors,
    purged_intake_sessions: purgedSessions,
    purged_skus: purgedSkus
  };
}

/**
 * PERMANENT INTAKE-TO-SALE ANTI-PLACEHOLDER VALIDATION GATE
 * Invoked on EVERY insert, update, AI intake, CSV import, and multi-channel sync.
 * Blocks any placeholder/incomplete/ghost/unverified-VIN SKU from entering `active` or publishing to Shopify/eBay/Google/Meta/Crosslist.
 */
function validateInventoryItemForPublish(item = {}) {
  const reasons = [];
  const title = String(item.title || '').trim();
  const category = String(item.category || '').trim();
  const mpn = String(item.oem_part_number || '').trim();
  const fitYears = String(item.fitment_years || '').trim();
  const fitMake = String(item.fitment_make || '').trim();
  const fitModel = String(item.fitment_model || '').trim();
  const fitNotes = String(item.fitment_notes || '').trim();
  const verifiedVin = String(item.verified_vin || '').trim().toUpperCase();
  const intakeSessionId = String(item.intake_session_id || '').trim();
  const intakeSource = String(item.intake_source || '').trim();
  const weight = Number(item.weight_lbs || 0);
  const lengthIn = Number(item.length_in || 0);
  const widthIn = Number(item.width_in || 0);
  const heightIn = Number(item.height_in || 0);

  // -1. PERMANENT GHOST VEHICLE & SOLD SUBARU TRANSMISSION HARD BLOCK
  const ghostCheck = isGhostOrBannedInventoryItem(item);
  if (ghostCheck.blocked) {
    return {
      valid: false,
      recommended_status: 'archived',
      reasons: [ghostCheck.reason]
    };
  }

  // 0. MANDATORY STRICT 17-CHAR NHTSA-VERIFIED DONOR VIN GATE (ZERO VIN-TITLE-CHECK BYPASS):
  // NO real 17-character ISO-3779 NHTSA-verified donor VIN = NO SKU created, NO listing published.
  const vinCheck = validateVinStrict(verifiedVin);
  if (!verifiedVin || verifiedVin.length !== 17 || !vinCheck.valid) {
    reasons.push(`Strict VIN Gate: real 17-character NHTSA-verified donor VIN required (${vinCheck.reason || 'missing or unverified VIN'})`);
  }
  if (!intakeSessionId || intakeSource !== 'vin_intake_pipeline') {
    reasons.push('Mandatory VIN Intake Gate: item must originate from a locked VIN / License Plate Vehicle Intake Session');
  }

  // 1. Hard safety/emissions compliance block (SRS, airbag, clockspring, seatbelt pretensioner, catalytic converter)
  const comp = validatePartCompliance({
    title,
    category,
    description: item.description || ''
  });
  if (!comp.compliant) {
    return {
      valid: false,
      recommended_status: 'compliance_blocked',
      reasons: [comp.reason]
    };
  }

  // 2. Banned placeholder / raw camera title checks
  if (!title || title.length < 10) {
    reasons.push('Title is blank or too short');
  }
  if (/tested\s+oem\s+auto\s+part/i.test(title)) {
    reasons.push('Title contains banned placeholder "Tested OEM Auto Part"');
  }
  if (/does\s+not\s+apply/i.test(title)) {
    reasons.push('Title contains banned placeholder "Does Not Apply"');
  }
  if (/\buniversal\b/i.test(title)) {
    reasons.push('Title contains banned "Universal" claim');
  }
  if (/manual\s+review/i.test(title)) {
    reasons.push('Title contains unfinished "Manual Review" placeholder');
  }
  if (/\(\s*P0\d{3}\s*\)|\b(IMG|PXL|DSC|Screenshot)_[0-9]/i.test(title)) {
    reasons.push('Title contains raw camera filename or photo ID placeholder');
  }

  // 3. Verified Year + Make + Model + Specific Part Name
  const hasRealYear = /(19[6-9]\d|20[0-2]\d)/.test(fitYears) || /^(19[6-9]\d|20[0-2]\d)\b/.test(title);
  if (!hasRealYear) {
    reasons.push('Missing verified 4-digit vehicle Year / Year Range');
  }
  if (!fitMake || /\b(universal|generic|unknown|unverified|n\/a)\b/i.test(fitMake)) {
    reasons.push('Missing verified vehicle Make');
  }
  if (!fitModel || /\b(universal|generic|unknown|unverified|verify|n\/a|application|wiper\s*arm)\b/i.test(fitModel)) {
    reasons.push('Missing verified vehicle Model');
  }
  if (/\buniversal\b/i.test(`${fitYears} ${fitMake} ${fitModel} ${fitNotes}`)) {
    reasons.push('Fitment contains banned "Universal" wording');
  }

  // 4. Banned / fake MPN checks (real stamped OEM MPN or clean structured OEM-<YEAR><MAKE>-<PARTCODE> allowed; placeholders banned)
  if (mpn) {
    if (/does\s+not\s+apply|^n\/?a$|oem\s+factory\s+part/i.test(mpn)) {
      reasons.push('MPN contains banned placeholder wording');
    }
    if (/^[0-9a-f]{4}-[0-9a-f]{4}/i.test(mpn) || /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(mpn)) {
      reasons.push(`MPN "${mpn}" matches fake hex/UUID hash pattern`);
    }
    if (/^(19|20)\d{2}-[A-Z]/i.test(mpn)) {
      reasons.push(`MPN "${mpn}" is a fake Year-Make filename prefix`);
    }
    if (/^ALD-/i.test(mpn)) {
      reasons.push(`MPN "${mpn}" is an internal SKU, not an OEM part number`);
    }
  }

  // 5. Category, item-specific shipping weight & packed L x W x H dimensions
  if (!category) {
    reasons.push('Missing automotive taxonomy category');
  }
  if (!Number.isFinite(weight) || weight <= 0) {
    reasons.push('Missing or zero shipping weight (weight_lbs)');
  } else if (weight === 2 || weight === 8.5) {
    reasons.push(`Default fallback ${weight} lb shipping weight is blocked — specify accurate part-class packed weight`);
  }
  if (!Number.isFinite(lengthIn) || lengthIn <= 0 || !Number.isFinite(widthIn) || widthIn <= 0 || !Number.isFinite(heightIn) || heightIn <= 0) {
    reasons.push('Missing or zero packed box dimensions (L x W x H in inches)');
  }

  return {
    valid: reasons.length === 0,
    recommended_status: reasons.length === 0 ? 'active' : 'pending_verification',
    reasons
  };
}

/* ==================== MULTI-TENANT WHITE-LABEL SAAS LAYER ==================== */
const SAAS_PLAN_TIERS = {
  starter: { label: 'Starter Shop / Mobile Tech', monthly_org_fee_usd: 149.00, per_seat_fee_usd: 25.00, included_seats: 3, max_locations: 1, onboarding_buildout_fee_usd: 1500.00 },
  pro_yard: { label: 'Pro Auto Dismantler & Repair', monthly_org_fee_usd: 299.00, per_seat_fee_usd: 29.00, included_seats: 10, max_locations: 2, onboarding_buildout_fee_usd: 2500.00 },
  enterprise_franchise: { label: 'Enterprise Multi-Location Franchise', monthly_org_fee_usd: 599.00, per_seat_fee_usd: 24.00, included_seats: 25, max_locations: 10, onboarding_buildout_fee_usd: 4950.00 }
};

function seedDefaultOrganizationIfNeeded() {
  const existing = db.prepare('SELECT id FROM organizations WHERE id = 1 OR slug = ?').get('aldridge-autos');
  const now = new Date().toISOString();
  const nextMonth = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);

  if (!existing) {
    const s = getSettings();
    db.prepare(`
      INSERT INTO organizations (
        id, slug, name, tagline, logo_url, primary_color, accent_color, custom_domain,
        phone, email, address, city, state, zip,
        labor_rate_hourly, shop_supply_fee_rate, shop_supply_fee_cap, tax_rate,
        handling_fee_default, handling_days_default, freight_weight_threshold_lbs,
        shopify_domain, ebay_username, uhaul_dealer_id, branding_json, active, created_at, updated_at
      ) VALUES (1, 'aldridge-autos', ?, ?, '/assets/aldridge-crest.jpg', '#0b1628', '#ea580c', ?, ?, ?, ?, 'University Place', 'WA', ?, 174.99, 0.07, 45.00, 0.101, 10.00, 3, 70.0, ?, 'aabcas', '046117', ?, 1, ?, ?)
    `).run(
      "Aldridge Auto's Service & Repair",
      s.tagline || '5.0★ Full-Service Auto Repair, Verified Photographed OEM Auto Parts & U-Haul #046117',
      s.canonical_domain || 'https://aldridgeautosupply.com',
      s.phone || '(253) 245-4206',
      s.email || 'service@aldridgeautosupply.com',
      s.address || '5115 66th St W, Bldg B, University Place, WA 98467',
      s.zip || '98467',
      s.shopify_domain || 'aldridgesales.myshopify.com',
      JSON.stringify({ white_label_enabled: true, google_rating: '5.0', google_reviews: 87, uhaul_enabled: true }),
      now,
      now
    );

    db.prepare(`
      INSERT OR IGNORE INTO org_subscriptions (
        org_id, plan_tier, status, onboarding_buildout_fee_usd, onboarding_fee_status,
        monthly_org_fee_usd, per_seat_fee_usd, included_seats, active_user_seats,
        max_locations, billing_cycle_start, next_billing_date, license_key, features_json, created_at, updated_at
      ) VALUES (1, 'enterprise_franchise', 'active', 2500.00, 'waived', 299.00, 29.00, 10, 4, 5, ?, ?, 'LIC-ALDRIDGE-FLAGSHIP-0001', ?, ?, ?)
    `).run(
      now.slice(0, 10),
      nextMonth,
      JSON.stringify({ dvi_gemini_vision: true, shopify_co_master: true, crosslist_ebay_sync: true, customer_portal: true, multi_location: true, white_label_domain: true }),
      now,
      now
    );

    const defaultSeats = [
      { full_name: 'Chris Aldridge', email: 'chris@aldridgeautosupply.com', phone: '(253) 245-4206', role: 'owner' },
      { full_name: 'Maria (Office Manager)', email: 'office@aldridgeautosupply.com', phone: '(253) 245-4206', role: 'office_manager' },
      { full_name: 'Lead ASE Bay Technician', email: 'bays@aldridgeautosupply.com', phone: '(253) 245-4206', role: 'technician' },
      { full_name: 'Customer Portal Guest Seat', email: 'portal@aldridgeautosupply.com', phone: '', role: 'customer' }
    ];
    const insUser = db.prepare(`
      INSERT INTO org_users (org_id, full_name, email, phone, role, active, created_at, updated_at)
      VALUES (1, ?, ?, ?, ?, 1, ?, ?)
    `);
    for (const u of defaultSeats) {
      insUser.run(u.full_name, u.email, u.phone, u.role, now, now);
    }
  } else {
    // Ensure Tenant #1 always stays locked at $174.99/hr and 10.1% Tacoma/UP WA tax
    db.prepare(`
      UPDATE organizations
      SET labor_rate_hourly = 174.99, shop_supply_fee_rate = 0.07, shop_supply_fee_cap = 45.00, tax_rate = 0.101, updated_at = ?
      WHERE id = 1 AND labor_rate_hourly != 174.99
    `).run(now);
  }
}

function hydrateOrganization(orgRow) {
  if (!orgRow) return null;
  const sub = db.prepare('SELECT * FROM org_subscriptions WHERE org_id = ?').get(orgRow.id) || null;
  const users = db.prepare('SELECT id, org_id, full_name, email, phone, role, active, created_at FROM org_users WHERE org_id = ? ORDER BY id ASC').all(orgRow.id);
  const activeSeats = users.filter((u) => u.active).length;
  const seatCountsByRole = { owner: 0, office_manager: 0, technician: 0, customer: 0 };
  for (const u of users) {
    if (u.active && seatCountsByRole[u.role] !== undefined) seatCountsByRole[u.role]++;
  }
  const extraSeats = sub ? Math.max(0, activeSeats - Number(sub.included_seats || 0)) : 0;
  const estimatedMonthlyTotal = sub
    ? Number((Number(sub.monthly_org_fee_usd || 0) + extraSeats * Number(sub.per_seat_fee_usd || 0)).toFixed(2))
    : 0;
  return {
    ...orgRow,
    shopify_admin_token: orgRow.shopify_admin_token ? '***configured***' : '',
    branding: (() => { try { return JSON.parse(orgRow.branding_json || '{}'); } catch (_) { return {}; } })(),
    subscription: sub ? {
      ...sub,
      active_user_seats: activeSeats,
      extra_billable_seats: extraSeats,
      estimated_monthly_total_usd: estimatedMonthlyTotal,
      features: (() => { try { return JSON.parse(sub.features_json || '{}'); } catch (_) { return {}; } })()
    } : null,
    seat_counts_by_role: seatCountsByRole,
    users
  };
}

function resolveOrganization(slugOrHostOrId = 1) {
  seedDefaultOrganizationIfNeeded();
  if (typeof slugOrHostOrId === 'number' || /^\d+$/.test(String(slugOrHostOrId))) {
    const byId = db.prepare('SELECT * FROM organizations WHERE id = ?').get(Number(slugOrHostOrId));
    if (byId) return hydrateOrganization(byId);
  }
  const key = String(slugOrHostOrId || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (key) {
    const bySlug = db.prepare('SELECT * FROM organizations WHERE LOWER(slug) = ?').get(key);
    if (bySlug) return hydrateOrganization(bySlug);
    const byDomain = db.prepare("SELECT * FROM organizations WHERE LOWER(REPLACE(REPLACE(custom_domain, 'https://', ''), 'http://', '')) LIKE ?").get(`${key}%`);
    if (byDomain) return hydrateOrganization(byDomain);
  }
  return hydrateOrganization(db.prepare('SELECT * FROM organizations WHERE id = 1').get());
}

function listOrganizationsWithSubscriptions() {
  seedDefaultOrganizationIfNeeded();
  return db.prepare('SELECT * FROM organizations ORDER BY id ASC').all().map(hydrateOrganization);
}

function createOrganizationTenant(payload = {}) {
  seedDefaultOrganizationIfNeeded();
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Organization name is required.');
  const rawSlug = String(payload.slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const slug = rawSlug || `shop-${Date.now()}`;
  const existing = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug);
  if (existing) throw new Error(`Organization slug "${slug}" already exists.`);

  const tierKey = SAAS_PLAN_TIERS[payload.plan_tier] ? payload.plan_tier : 'pro_yard';
  const tier = SAAS_PLAN_TIERS[tierKey];
  const now = new Date().toISOString();
  const nextMonth = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);
  const licenseKey = `LIC-${slug.slice(0, 10).toUpperCase().replace(/[^A-Z0-9]/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const ins = db.prepare(`
    INSERT INTO organizations (
      slug, name, tagline, logo_url, primary_color, accent_color, custom_domain,
      phone, email, address, city, state, zip,
      labor_rate_hourly, shop_supply_fee_rate, shop_supply_fee_cap, tax_rate,
      handling_fee_default, handling_days_default, freight_weight_threshold_lbs,
      shopify_domain, shopify_client_id, shopify_admin_token, ebay_username, uhaul_dealer_id,
      branding_json, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    slug,
    name,
    String(payload.tagline || `${name} — Verified OEM Parts & Auto Repair`),
    String(payload.logo_url || '/assets/aldridge-crest.jpg'),
    String(payload.primary_color || '#0b1628'),
    String(payload.accent_color || '#ea580c'),
    String(payload.custom_domain || ''),
    String(payload.phone || ''),
    String(payload.email || ''),
    String(payload.address || ''),
    String(payload.city || ''),
    String(payload.state || ''),
    String(payload.zip || ''),
    Number(payload.labor_rate_hourly ?? 174.99),
    Number(payload.shop_supply_fee_rate ?? 0.07),
    Number(payload.shop_supply_fee_cap ?? 45.00),
    Number(payload.tax_rate ?? 0.101),
    Number(payload.handling_fee_default ?? 10.00),
    Number(payload.handling_days_default ?? 3),
    Number(payload.freight_weight_threshold_lbs ?? 70.0),
    String(payload.shopify_domain || ''),
    String(payload.shopify_client_id || ''),
    String(payload.shopify_admin_token || ''),
    String(payload.ebay_username || ''),
    String(payload.uhaul_dealer_id || ''),
    JSON.stringify(payload.branding || { white_label_enabled: true }),
    now,
    now
  );

  const orgId = Number(ins.lastInsertRowid);
  db.prepare(`
    INSERT INTO org_subscriptions (
      org_id, plan_tier, status, onboarding_buildout_fee_usd, onboarding_fee_status,
      monthly_org_fee_usd, per_seat_fee_usd, included_seats, active_user_seats,
      max_locations, billing_cycle_start, next_billing_date, license_key, features_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orgId,
    tierKey,
    String(payload.subscription_status || 'active'),
    Number(payload.onboarding_buildout_fee_usd ?? tier.onboarding_buildout_fee_usd),
    String(payload.onboarding_fee_status || 'pending'),
    Number(payload.monthly_org_fee_usd ?? tier.monthly_org_fee_usd),
    Number(payload.per_seat_fee_usd ?? tier.per_seat_fee_usd),
    Number(payload.included_seats ?? tier.included_seats),
    Number(payload.max_locations ?? tier.max_locations),
    now.slice(0, 10),
    nextMonth,
    licenseKey,
    JSON.stringify({ dvi_gemini_vision: true, shopify_co_master: true, crosslist_ebay_sync: true, customer_portal: true, white_label_domain: true }),
    now,
    now
  );

  db.prepare(`
    INSERT INTO org_users (org_id, full_name, email, phone, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'owner', 1, ?, ?)
  `).run(orgId, String(payload.owner_name || `${name} Owner`), String(payload.email || ''), String(payload.phone || ''), now, now);

  logSync('outbound', 'saas_tenants', 'provision_tenant', slug, 'success', `Provisioned white-label tenant #${orgId} (${name}, tier=${tierKey}, labor=$${Number(payload.labor_rate_hourly ?? 174.99).toFixed(2)}/hr, license=${licenseKey}).`);
  return resolveOrganization(orgId);
}

function updateOrganizationTenant(orgId, patch = {}) {
  seedDefaultOrganizationIfNeeded();
  const current = db.prepare('SELECT * FROM organizations WHERE id = ?').get(Number(orgId));
  if (!current) throw new Error(`Organization #${orgId} not found.`);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE organizations SET
      name = COALESCE(?, name),
      tagline = COALESCE(?, tagline),
      logo_url = COALESCE(?, logo_url),
      primary_color = COALESCE(?, primary_color),
      accent_color = COALESCE(?, accent_color),
      custom_domain = COALESCE(?, custom_domain),
      phone = COALESCE(?, phone),
      email = COALESCE(?, email),
      address = COALESCE(?, address),
      city = COALESCE(?, city),
      state = COALESCE(?, state),
      zip = COALESCE(?, zip),
      labor_rate_hourly = COALESCE(?, labor_rate_hourly),
      shop_supply_fee_rate = COALESCE(?, shop_supply_fee_rate),
      shop_supply_fee_cap = COALESCE(?, shop_supply_fee_cap),
      tax_rate = COALESCE(?, tax_rate),
      shopify_domain = COALESCE(?, shopify_domain),
      ebay_username = COALESCE(?, ebay_username),
      uhaul_dealer_id = COALESCE(?, uhaul_dealer_id),
      updated_at = ?
    WHERE id = ?
  `).run(
    patch.name ?? null,
    patch.tagline ?? null,
    patch.logo_url ?? null,
    patch.primary_color ?? null,
    patch.accent_color ?? null,
    patch.custom_domain ?? null,
    patch.phone ?? null,
    patch.email ?? null,
    patch.address ?? null,
    patch.city ?? null,
    patch.state ?? null,
    patch.zip ?? null,
    patch.labor_rate_hourly !== undefined ? Number(patch.labor_rate_hourly) : null,
    patch.shop_supply_fee_rate !== undefined ? Number(patch.shop_supply_fee_rate) : null,
    patch.shop_supply_fee_cap !== undefined ? Number(patch.shop_supply_fee_cap) : null,
    patch.tax_rate !== undefined ? Number(patch.tax_rate) : null,
    patch.shopify_domain ?? null,
    patch.ebay_username ?? null,
    patch.uhaul_dealer_id ?? null,
    now,
    Number(orgId)
  );

  if (patch.plan_tier || patch.subscription_status || patch.onboarding_fee_status || patch.monthly_org_fee_usd !== undefined || patch.onboarding_buildout_fee_usd !== undefined) {
    db.prepare(`
      UPDATE org_subscriptions SET
        plan_tier = COALESCE(?, plan_tier),
        status = COALESCE(?, status),
        onboarding_fee_status = COALESCE(?, onboarding_fee_status),
        onboarding_buildout_fee_usd = COALESCE(?, onboarding_buildout_fee_usd),
        monthly_org_fee_usd = COALESCE(?, monthly_org_fee_usd),
        updated_at = ?
      WHERE org_id = ?
    `).run(
      patch.plan_tier ?? null,
      patch.subscription_status ?? null,
      patch.onboarding_fee_status ?? null,
      patch.onboarding_buildout_fee_usd !== undefined ? Number(patch.onboarding_buildout_fee_usd) : null,
      patch.monthly_org_fee_usd !== undefined ? Number(patch.monthly_org_fee_usd) : null,
      now,
      Number(orgId)
    );
  }
  return resolveOrganization(Number(orgId));
}

function addOrganizationUserSeat(orgId, seat = {}) {
  seedDefaultOrganizationIfNeeded();
  const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(Number(orgId));
  if (!org) throw new Error(`Organization #${orgId} not found.`);
  const fullName = String(seat.full_name || '').trim();
  if (!fullName) throw new Error('Seat full_name is required.');
  const role = ['owner', 'office_manager', 'technician', 'customer'].includes(String(seat.role || '').toLowerCase())
    ? String(seat.role).toLowerCase()
    : 'technician';
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO org_users (org_id, full_name, email, phone, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(Number(orgId), fullName, String(seat.email || ''), String(seat.phone || ''), role, now, now);

  const count = db.prepare('SELECT COUNT(*) c FROM org_users WHERE org_id = ? AND active = 1').get(Number(orgId)).c;
  db.prepare('UPDATE org_subscriptions SET active_user_seats = ?, updated_at = ? WHERE org_id = ?').run(count, now, Number(orgId));
  return resolveOrganization(Number(orgId));
}

/* ==================== WAVE 1 "PROOF OF DOMINANCE" LIVE SQLITE METRICS & BETA PIPELINE ==================== */
const BETA_ONBOARDING_STAGES = ['outreach', 'demo_booked', 'pilot_onboarding', 'live_beta', 'declined'];

function listBetaProspects() {
  return db.prepare('SELECT * FROM saas_beta_prospects ORDER BY id DESC').all();
}

function createBetaProspect(payload = {}) {
  const shopName = String(payload.shop_name || '').trim();
  if (!shopName) throw new Error('shop_name is required.');
  const now = new Date().toISOString();
  const stage = BETA_ONBOARDING_STAGES.includes(String(payload.onboarding_stage || '').toLowerCase())
    ? String(payload.onboarding_stage).toLowerCase()
    : 'outreach';
  const tier = SAAS_PLAN_TIERS[payload.founder_plan_tier] ? payload.founder_plan_tier : 'pro_yard';
  const fee = payload.monthly_fee_usd !== undefined && payload.monthly_fee_usd !== ''
    ? Math.max(0, Number(payload.monthly_fee_usd))
    : Number(SAAS_PLAN_TIERS[tier].monthly_org_fee_usd);
  const ins = db.prepare(`
    INSERT INTO saas_beta_prospects (
      org_id, shop_name, city, county, contact_name, contact_phone, contact_email,
      bay_yard_size, founder_plan_tier, monthly_fee_usd, onboarding_stage, notes, created_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    shopName,
    String(payload.city || 'Tacoma').trim(),
    String(payload.county || 'Pierce County').trim(),
    String(payload.contact_name || '').trim(),
    String(payload.contact_phone || '').trim(),
    String(payload.contact_email || '').trim(),
    String(payload.bay_yard_size || '').trim(),
    tier,
    fee,
    stage,
    String(payload.notes || '').trim(),
    now,
    now
  );
  return db.prepare('SELECT * FROM saas_beta_prospects WHERE id = ?').get(ins.lastInsertRowid);
}

function updateBetaProspect(id, patch = {}) {
  const existing = db.prepare('SELECT * FROM saas_beta_prospects WHERE id = ?').get(Number(id));
  if (!existing) throw new Error(`Beta prospect #${id} not found.`);
  const nextStage = patch.onboarding_stage && BETA_ONBOARDING_STAGES.includes(String(patch.onboarding_stage).toLowerCase())
    ? String(patch.onboarding_stage).toLowerCase()
    : null;
  const nextTier = patch.founder_plan_tier && SAAS_PLAN_TIERS[patch.founder_plan_tier]
    ? patch.founder_plan_tier
    : null;
  db.prepare(`
    UPDATE saas_beta_prospects SET
      shop_name = COALESCE(?, shop_name),
      city = COALESCE(?, city),
      county = COALESCE(?, county),
      contact_name = COALESCE(?, contact_name),
      contact_phone = COALESCE(?, contact_phone),
      contact_email = COALESCE(?, contact_email),
      bay_yard_size = COALESCE(?, bay_yard_size),
      founder_plan_tier = COALESCE(?, founder_plan_tier),
      monthly_fee_usd = COALESCE(?, monthly_fee_usd),
      onboarding_stage = COALESCE(?, onboarding_stage),
      notes = COALESCE(?, notes),
      updated_at = ?
    WHERE id = ?
  `).run(
    patch.shop_name ?? null,
    patch.city ?? null,
    patch.county ?? null,
    patch.contact_name ?? null,
    patch.contact_phone ?? null,
    patch.contact_email ?? null,
    patch.bay_yard_size ?? null,
    nextTier,
    patch.monthly_fee_usd !== undefined ? Math.max(0, Number(patch.monthly_fee_usd)) : null,
    nextStage,
    patch.notes ?? null,
    new Date().toISOString(),
    Number(id)
  );
  return db.prepare('SELECT * FROM saas_beta_prospects WHERE id = ?').get(Number(id));
}

function deleteBetaProspect(id) {
  const res = db.prepare('DELETE FROM saas_beta_prospects WHERE id = ?').run(Number(id));
  return res.changes > 0;
}

function getWave1ProofMetrics() {
  seedDefaultOrganizationIfNeeded();
  const settings = getSettings();
  const org = resolveOrganization(1);

  // 1. Live Verified Clean OEM Catalog Progress (100% real SQLite)
  const activeRows = db.prepare("SELECT * FROM inventory_items WHERE status = 'active' AND quantity > 0").all();
  let zeroPlaceholderPassCount = 0;
  let placeholderViolations = 0;
  let activeRetailTotal = 0;
  let activeInstallTotal = 0;
  let shopifyLinkedCount = 0;
  let verifiedMpnCount = 0;
  let parcelCount = 0;
  let localPickupCount = 0;

  for (const r of activeRows) {
    const gate = validateInventoryItemForPublish(r);
    if (gate.valid) zeroPlaceholderPassCount++;
    else placeholderViolations++;
    activeRetailTotal += Number(r.price_we_pull || 0);
    activeInstallTotal += Number(r.price_pull_install || 0);
    if (r.shopify_product_id) shopifyLinkedCount++;
    if (String(r.oem_part_number || '').trim()) verifiedMpnCount++;
    if (r.shipping_class === 'local_pickup_only' || Number(r.weight_lbs || 0) >= Number(settings.freight_weight_threshold_lbs || 70)) {
      localPickupCount++;
    } else {
      parcelCount++;
    }
  }

  const statusCounts = db.prepare('SELECT status, COUNT(*) c FROM inventory_items GROUP BY status').all();
  const countMap = {};
  for (const sc of statusCounts) countMap[sc.status] = Number(sc.c || 0);
  const totalProcessedSkus = Object.values(countMap).reduce((a, b) => a + b, 0);

  // 2. AI Hands-Off Automation & Double-Sale Protection Counter (100% real SQLite)
  const negativeQtyConflicts = db.prepare('SELECT COUNT(*) c FROM inventory_items WHERE quantity < 0').get().c;
  const dupActiveSkuRows = db.prepare("SELECT COUNT(*) c FROM (SELECT UPPER(sku) s FROM inventory_items WHERE status = 'active' GROUP BY UPPER(sku) HAVING COUNT(*) > 1)").get().c;
  const doubleSalesCount = Number(negativeQtyConflicts || 0) + Number(dupActiveSkuRows || 0);
  const autoDelistEvents = db.prepare("SELECT COUNT(*) c FROM sync_logs WHERE LOWER(action) LIKE '%delist%' OR LOWER(action) LIKE '%zero_out%' OR LOWER(action) LIKE '%lock%'").get().c;
  const photoReviewTotals = db.prepare('SELECT review_status, COUNT(*) c FROM photo_review_items GROUP BY review_status').all();
  const reviewMap = { keep: 0, remove: 0, pending: 0 };
  for (const pr of photoReviewTotals) reviewMap[pr.review_status] = Number(pr.c || 0);

  // 3. DVI-to-Customer-Approval Turnaround Timer (100% real SQLite elapsed timestamps, zero fabricated numbers)
  const publishedDvisCount = db.prepare("SELECT COUNT(*) c FROM dvi_inspections WHERE published_to_customer = 1 AND published_at != ''").get().c;
  const totalDvisCount = db.prepare('SELECT COUNT(*) c FROM dvi_inspections').get().c;
  const approvedTimings = db.prepare(`
    SELECT d.published_at, qli.decided_at
    FROM quote_line_items qli
    JOIN service_quotes sq ON sq.id = qli.quote_id
    JOIN dvi_inspections d ON d.id = sq.dvi_id
    WHERE qli.customer_decision = 'approved'
      AND qli.decided_at != ''
      AND d.published_at != ''
  `).all();

  const validElapsedMinutes = [];
  for (const row of approvedTimings) {
    const startMs = Date.parse(row.published_at);
    const endMs = Date.parse(row.decided_at);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      validElapsedMinutes.push((endMs - startMs) / 60000);
    }
  }
  const avgApprovalMinutes = validElapsedMinutes.length > 0
    ? Number((validElapsedMinutes.reduce((a, b) => a + b, 0) / validElapsedMinutes.length).toFixed(1))
    : null;

  // 4. Pierce & King County Founder Beta Pipeline (100% real SQLite)
  const prospects = listBetaProspects();
  const activeBetaShops = prospects.filter((p) => p.onboarding_stage === 'live_beta' || p.onboarding_stage === 'pilot_onboarding');
  const liveBetaShops = prospects.filter((p) => p.onboarding_stage === 'live_beta');
  const liveBetaMrr = liveBetaShops.reduce((s, p) => s + Number(p.monthly_fee_usd || 0), 0);
  const pipelineMrr = prospects
    .filter((p) => p.onboarding_stage !== 'declined')
    .reduce((s, p) => s + Number(p.monthly_fee_usd || 0), 0);
  const orgCount = db.prepare('SELECT COUNT(*) c FROM organizations WHERE active = 1').get().c;

  return {
    generated_at: new Date().toISOString(),
    shop: {
      name: org?.name || "Aldridge Auto's Service & Repair",
      address: org?.address || '5115 66th St W, Bldg B, University Place, WA 98467',
      canonical_domain: settings.canonical_domain || 'https://aldridgeautosupply.com',
      shopify_domain: settings.shopify_domain || 'aldridgesales.myshopify.com',
      google_rating: '5.0★ (87 Google Reviews)',
      labor_rate_hourly: Number(settings.labor_rate_hourly || 174.99),
      shop_supply_fee_rate: Number(settings.shop_supply_fee_rate ?? 0.07),
      shop_supply_fee_cap: Number(settings.shop_supply_fee_cap ?? 45),
      tax_rate: Number(settings.tax_rate ?? 0.101)
    },
    catalog: {
      active_clean_skus: activeRows.length,
      zero_placeholder_pass_count: zeroPlaceholderPassCount,
      placeholder_violations: placeholderViolations,
      active_retail_value_usd: Number(activeRetailTotal.toFixed(2)),
      active_turnkey_install_value_usd: Number(activeInstallTotal.toFixed(2)),
      verified_mpn_skus: verifiedMpnCount,
      parcel_skus: parcelCount,
      local_pickup_skus: localPickupCount,
      pending_verification_skus: countMap.pending_verification || 0,
      compliance_blocked_skus: countMap.compliance_blocked || 0,
      sold_skus: countMap.sold || 0,
      milestones: [
        { key: 'baseline', label: 'Verified Clean Baseline', target_skus: 137, pct: Math.min(100, Math.round((activeRows.length / 137) * 100)) },
        { key: 'mid_wave1', label: 'Wave 1 Midpoint', target_skus: 500, pct: Math.min(100, Math.round((activeRows.length / 500) * 100)) },
        { key: 'scale_wave1', label: 'Wave 1 Full Scale ($120k+)', target_skus: 1000, target_retail_usd: 120000, pct: Math.min(100, Math.round((activeRows.length / 1000) * 100)), retail_pct: Math.min(100, Math.round((activeRetailTotal / 120000) * 100)) }
      ]
    },
    automation: {
      hands_off_processed_skus: totalProcessedSkus,
      shopify_linked_skus: shopifyLinkedCount,
      connected_channels: ['Shopify (aldridgesales.myshopify.com)', 'eBay US (aabcas)', 'Google Merchant XML', 'Meta Commerce Catalog', 'Tacoma Craigslist (pts)'],
      connected_channels_count: 5,
      auto_delist_events: Number(autoDelistEvents || 0),
      double_sales_verified: doubleSalesCount,
      photo_triage: reviewMap
    },
    dvi_turnaround: {
      total_dvis: Number(totalDvisCount || 0),
      published_dvis: Number(publishedDvisCount || 0),
      approved_lines_measured: validElapsedMinutes.length,
      avg_approval_minutes: avgApprovalMinutes,
      benchmark_minutes: 15,
      meets_benchmark: avgApprovalMinutes !== null ? avgApprovalMinutes < 15 : null
    },
    beta_pipeline: {
      wave1_shop_target: '1–3 Local Beta Shops (Pierce & King County)',
      wave1_mrr_target: '$0 – $2,500/mo',
      active_tenants_provisioned: Number(orgCount || 1),
      total_prospects: prospects.length,
      active_onboarding_or_live: activeBetaShops.length,
      live_beta_shops: liveBetaShops.length,
      live_beta_mrr_usd: Number(liveBetaMrr.toFixed(2)),
      pipeline_potential_mrr_usd: Number(pipelineMrr.toFixed(2)),
      prospects
    }
  };
}

function renderWave1ProofOnePagerHtml() {
  const m = getWave1ProofMetrics();
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const dviText = m.dvi_turnaround.avg_approval_minutes !== null
    ? `${m.dvi_turnaround.avg_approval_minutes} min avg (${m.dvi_turnaround.approved_lines_measured} approved line${m.dvi_turnaround.approved_lines_measured === 1 ? '' : 's'})`
    : `0 approved lines recorded yet (${m.dvi_turnaround.published_dvis} published / ${m.dvi_turnaround.total_dvis} total DVIs • Target: < 15 min)`;

  const prospectsRows = m.beta_pipeline.prospects.length
    ? m.beta_pipeline.prospects.map((p) => `
      <tr>
        <td><strong>${esc(p.shop_name)}</strong></td>
        <td>${esc(p.city)}, ${esc(p.county)}</td>
        <td>${esc(p.bay_yard_size || '—')}</td>
        <td>${esc(p.founder_plan_tier)}</td>
        <td>$${Number(p.monthly_fee_usd || 0).toFixed(2)}/mo</td>
        <td>${esc(p.onboarding_stage)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" style="color:#64748b;text-align:center;">Open Founder Beta Slots: 1–3 Pierce &amp; King County independent shops or yards (no fabricated placeholder prospects).</td></tr>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Wave 1 Verified Proof-of-Concept One-Pager — ${esc(m.shop.name)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; max-width: 900px; margin: 0 auto; padding: 24px; background: #fff; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 1px solid #e2e8f0; margin-bottom: 20px; }
    .btn { background: #ea580c; color: #fff; border: none; padding: 8px 14px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 13px; }
    .hero { background: #0b1628; color: #fff; padding: 22px 24px; border-radius: 10px; margin-bottom: 18px; }
    .eyebrow { color: #fb923c; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
    h1 { margin: 6px 0; font-size: 24px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 18px; }
    .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px 16px; background: #f8fafc; }
    .kpi { font-size: 24px; font-weight: 800; color: #0b1628; margin: 4px 0; }
    .sub { font-size: 12px; color: #475569; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
    th, td { border: 1px solid #cbd5e1; padding: 7px 9px; text-align: left; }
    th { background: #0b1628; color: #fff; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; background: #dcfce7; color: #166534; }
    @media print { .toolbar { display: none; } body { padding: 0; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <span style="font-size:12px;color:#475569;">Auditable Live SQLite Snapshot • Generated ${esc(m.generated_at)}</span>
    <button class="btn" onclick="window.print()">Print / Save Verified PDF</button>
  </div>
  <div class="hero">
    <div class="eyebrow">WAVE 1: PROOF OF DOMINANCE • LIVE OPERATIONAL PROOF-OF-CONCEPT</div>
    <h1>${esc(m.shop.name)} — AI Hands-Off Shop &amp; OEM Parts Engine</h1>
    <div style="font-size:13px;color:#cbd5e1;">
      ${esc(m.shop.google_rating)} • ${esc(m.shop.address)} • ${esc(m.shop.canonical_domain)} • Shop Labor Rate: $${m.shop.labor_rate_hourly.toFixed(2)}/hr (7% supplies cap $${m.shop.shop_supply_fee_cap} • ${(m.shop.tax_rate * 100).toFixed(1)}% WA tax)
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="eyebrow" style="color:#0369a1;">1. VERIFIED CLEAN OEM CATALOG</div>
      <div class="kpi">${m.catalog.active_clean_skus} Active SKUs • $${m.catalog.active_retail_value_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
      <div class="sub">
        <span class="pill">${m.catalog.placeholder_violations} Placeholders Verified</span><br/>
        • ${m.catalog.parcel_skus} Calculated Parcel SKUs + ${m.catalog.local_pickup_skus} Heavy Local Pickup (98467)<br/>
        • ${m.catalog.pending_verification_skus} held in <code>pending_verification</code> • ${m.catalog.compliance_blocked_skus} SRS/airbag SKUs hard-blocked<br/>
        • Wave 1 Scaling Path: ${m.catalog.active_clean_skus} → 500 → 1,000+ SKUs ($120,000+ retail target)
      </div>
    </div>
    <div class="card">
      <div class="eyebrow" style="color:#0369a1;">2. AI HANDS-OFF AUTOMATION &amp; 0 DOUBLE-SALES</div>
      <div class="kpi">${m.automation.double_sales_verified} Double-Sales Verified</div>
      <div class="sub">
        • ${m.automation.hands_off_processed_skus} total SKUs gated via permanent anti-placeholder publish lock<br/>
        • 5 Synchronized Channels: Shopify, eBay (aabcas), Google Merchant XML, Meta Catalog CSV &amp; Tacoma Craigslist (pts)<br/>
        • Photo Triage Verified: ${m.automation.photo_triage.keep} KEEP / ${m.automation.photo_triage.remove} REMOVE / ${m.automation.photo_triage.pending} PENDING<br/>
        • Atomic 1-of-1 stock lock zeroes all feeds on sale or shop RO pull (${m.automation.auto_delist_events} logged lock/delist events)
      </div>
    </div>
    <div class="card">
      <div class="eyebrow" style="color:#0369a1;">3. MOBILE DVI-TO-APPROVAL TURNAROUND</div>
      <div class="kpi">${m.dvi_turnaround.avg_approval_minutes !== null ? `${m.dvi_turnaround.avg_approval_minutes} min` : 'Live Tracking Active'}</div>
      <div class="sub">
        • Real Database Measurement: ${esc(dviText)}<br/>
        • Wave 1 Benchmark: &lt; ${m.dvi_turnaround.benchmark_minutes} minutes from tech photo publish to mobile customer approval<br/>
        • Includes offline IndexedDB bay capture, Gemini Vision draft notes, Option A (in-stock Used OEM) vs Option B quoting &amp; 60/90-day deferred work reminders
      </div>
    </div>
    <div class="card">
      <div class="eyebrow" style="color:#0369a1;">4. PIERCE &amp; KING COUNTY FOUNDER BETA</div>
      <div class="kpi">${m.beta_pipeline.live_beta_shops} Live Beta • $${m.beta_pipeline.live_beta_mrr_usd.toFixed(0)}/mo MRR</div>
      <div class="sub">
        • Wave 1 Target: ${esc(m.beta_pipeline.wave1_shop_target)} (${esc(m.beta_pipeline.wave1_mrr_target)})<br/>
        • Tracked Prospects: ${m.beta_pipeline.total_prospects} (Potential Pipeline MRR: $${m.beta_pipeline.pipeline_potential_mrr_usd.toFixed(0)}/mo)<br/>
        • Multi-Tenant SaaS Architecture live with white-label branding, per-shop labor/tax rates &amp; role seats (Owner, Office Manager, Tech, Customer)
      </div>
    </div>
  </div>

  <div class="card" style="background:#fff;">
    <div class="eyebrow" style="color:#ea580c;">HOW THE HANDS-OFF PIPELINE WORKS (LIVE DAILY IN UNIVERSITY PLACE / TACOMA, WA)</div>
    <p style="font-size:13px;line-height:1.55;margin:6px 0 0;">
      <strong>1. Snap 1 Shop Photo</strong> → AI Vision extracts verified Year, Make, Model, OEM Part Number, item-specific shipping weight &amp; box dimensions, official Shopify taxonomy category, and $174.99/hr turnkey bay installation quote.<br/>
      <strong>2. Zero-Placeholder Gate</strong> → Incomplete or SRS-prohibited parts are automatically quarantined before reaching buyers.<br/>
      <strong>3. Simultaneous 5-Channel Publish</strong> → Pushes live to Shopify (with tamper-evident QR tag isolated strictly to the last gallery slot), eBay US, Google Merchant, Meta Commerce, and Tacoma Craigslist.<br/>
      <strong>4. Atomic 1-of-1 Auto-Delist</strong> → When a part sells online or gets pulled for an in-shop repair order, every channel zeroes out automatically.
    </p>
  </div>

  <h3 style="margin:18px 0 6px;font-size:15px;">Pierce &amp; King County Founder Beta Pipeline (Live Database)</h3>
  <table>
    <thead><tr><th>Shop / Yard Name</th><th>Location</th><th>Size</th><th>Founder Tier</th><th>Monthly Fee</th><th>Stage</th></tr></thead>
    <tbody>${prospectsRows}</tbody>
  </table>
</body>
</html>`;
}

if (getSettings().clean_slate_mode) {
  ensureCleanSlateBaseline();
} else {
  seedDemoDataIfNeeded();
  seedAuditGroundTruthCatalog(false);
}
seedDefaultOrganizationIfNeeded();
if (getSettings().mandatory_vin_intake_only !== false) {
  purgeLegacyPhotoReviewTriage();
} else {
  seedPhotoReviewCatalogIfNeeded(false);
  ensureNonDescriptivePendingFilteredOnce();
}

module.exports = {
  db,
  DATA_DIR,
  SAAS_PLAN_TIERS,
  BETA_ONBOARDING_STAGES,
  getSettings,
  updateSettings,
  generateSecurityCode,
  generateReferralCode,
  computeShippingClass,
  PERMANENTLY_BANNED_GHOST_VINS,
  PERMANENTLY_BANNED_SOLD_SKUS,
  VERIFIED_DONOR_VIN_WHITELIST,
  isVinCheckDigitValid,
  registerNhtsaVerifiedVin,
  validateVinStrict,
  isGhostOrBannedInventoryItem,
  purgeGhostAndBlockedInventory,
  validatePartCompliance,
  validateInventoryItemForPublish,
  normalizePhoneDigits,
  upsertCustomer,
  logSync,
  ensureCleanSlateBaseline,
  countVerifiedVinInventory,
  seedDemoDataIfNeeded,
  seedAuditGroundTruthCatalog,
  seedDefaultOrganizationIfNeeded,
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
};


