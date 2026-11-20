/**
 * "If We Don't Have It, We Can Get It" 50%-Markup Parts Sourcing Engine,
 * "Not Sure What You Need?" Guided Symptom Helper,
 * and Instant-Bookable Shop Services & Bay Menu
 *
 * Strictly grounded:
 * - Locked shop labor rate: $174.99/hr (+ 7% shop supplies capped at $45 + 10.1% WA tax)
 * - Exact 50% retail markup over commercial wholesale source cost (retail = wholesale * 1.50)
 * - Zero fake leads or synthetic bookings written to DB
 */

const crypto = require('crypto');
const { db, getSettings, upsertCustomer, logSync } = require('./db');

const LOCKED_SHOP_LABOR_RATE = 174.99;
const DEFAULT_SOURCING_MARKUP_PCT = 50.0;

/* ==================== INSTANT-BOOKABLE SHOP SERVICES & BAY MENU ==================== */
const SHOP_SERVICES_CATALOG = [
  {
    id: 'svc-free-cel-scan',
    code: 'CEL-FREE',
    name: 'FREE Check Engine Light (CEL) & OBD2 Diagnostic Scan',
    short_name: 'Free Check Engine Scan',
    badge: 'FREE • Walk-In or Same-Day Bay',
    highlight: true,
    category: 'diagnostics',
    price_usd: 0.0,
    price_label: '$0.00 (FREE)',
    billing_type: 'one_time',
    duration_label: '20–30 min while you wait',
    cta_label: 'Book FREE CEL Scan ($0.00)',
    summary: 'Full OEM-level OBD2 fault code scan + plain-English explanation of what triggered your dashboard warning light — zero obligation.',
    includes: [
      'Live OEM OBD2 trouble code scan & freeze-frame printout',
      'Plain-English mechanic walkthrough at 5115 66th St W, Bldg B',
      'Transparent written estimate if you want us to fix it'
    ]
  },
  {
    id: 'svc-dvi-wellness',
    code: 'DVI-89',
    name: 'Comprehensive Digital Vehicle Wellness & Pre-Purchase Inspection (DVI)',
    short_name: 'Digital Inspection (DVI)',
    badge: 'MOST POPULAR • Photo/Video Report',
    highlight: true,
    category: 'inspection',
    price_usd: 89.99,
    price_label: '$89.99',
    billing_type: 'one_time',
    duration_label: '60 min bumper-to-bumper',
    cta_label: 'Book DVI Inspection — $89.99',
    summary: '50+ point bumper-to-bumper safety, brake, suspension, fluid & underbody health inspection with high-res photos texted straight to your phone.',
    includes: [
      '50+ point mechanical, brake, tire, battery & fluid health report',
      'Actual photos & mechanic notes sent directly to your phone',
      'Ideal before road trips or buying a used car in Tacoma / UP'
    ]
  },
  {
    id: 'svc-hourly-bay',
    code: 'BAY-HR',
    name: 'Certified Hourly Repair & Deep Diagnostics',
    short_name: 'Hourly Bay Labor',
    badge: 'SELECT 1–8 HRS • $174.99/hr',
    highlight: true,
    category: 'repair',
    price_usd: 174.99,
    price_label: '$174.99 / hr',
    billing_type: 'hourly_block',
    min_hours: 1,
    max_hours: 8,
    default_hours: 1,
    duration_label: 'Selectable 1 to 8 hr bay block',
    cta_label: 'Reserve Certified Bay Time',
    summary: 'Reserve dedicated 5.0★ master technician bay time for electrical troubleshooting, drivability diagnostics, or customer-part installations.',
    includes: [
      'Locked transparent shop rate: $174.99/hr (no surprise dealer markups)',
      'VIP Driver Pass members save 10% automatically ($157.49/hr)',
      'Text/photo progress updates from our University Place bays'
    ]
  },
  {
    id: 'svc-secure-storage',
    code: 'STOR-149',
    name: 'Secure Vehicle / RV / Trailer Storage (University Place 98467)',
    short_name: 'Secure Lot Storage',
    badge: 'RECURRING MONTHLY • 98467 LOT',
    highlight: true,
    category: 'storage',
    price_usd: 149.0,
    price_label: '$149.00 / mo',
    billing_type: 'monthly_recurring',
    duration_label: 'Month-to-month fenced lot',
    cta_label: 'Reserve Storage Spot — $149/mo',
    summary: 'Gated, monitored commercial shop lot storage at 5115 66th St W, University Place, WA for cars, project builds, RVs, boats, and trailers.',
    includes: [
      'Fenced University Place 98467 commercial lot with convenient access',
      'Optional battery tender check & pre-trip safety inspection',
      'Simple month-to-month auto-billing (cancel anytime)'
    ]
  },
  {
    id: 'svc-brakes-pkg',
    code: 'BRK-249',
    name: 'Front or Rear Brake Service Package (Labor + Hardware Clean)',
    short_name: 'Brake Service Package',
    badge: 'SAFETY PACKAGE',
    highlight: false,
    category: 'packages',
    price_usd: 249.0,
    price_label: '$249.00',
    billing_type: 'one_time',
    duration_label: '1.5 hrs in bay',
    cta_label: 'Book Brake Package — $249.00',
    summary: 'Complete front or rear pad & rotor replacement labor, caliper slide-pin lubrication, brake fluid check, and road-test verification.',
    includes: [
      'Pad & rotor swap + caliper bracket cleaning & high-temp lube',
      'Brake hose, line & fluid moisture check included',
      'Parts priced transparently or bring your verified OEM parts'
    ]
  },
  {
    id: 'svc-suspension-pkg',
    code: 'SUSP-299',
    name: 'Suspension, Shocks & Struts Refresh Package',
    short_name: 'Suspension Package',
    badge: 'RIDE & HANDLING',
    highlight: false,
    category: 'packages',
    price_usd: 299.0,
    price_label: '$299.00',
    billing_type: 'one_time',
    duration_label: '2.0 hrs in bay',
    cta_label: 'Book Suspension Service — $299.00',
    summary: 'Pair of front struts or rear shocks installed with full ball-joint, tie-rod, sway-bar link & bushing torque inspection.',
    includes: [
      'Left & right shock/strut replacement labor + torque to OEM spec',
      'Complete front-end steering & bushing safety inspection',
      'Great match with our in-stock Tacoma FOX 2.0 & Subaru struts'
    ]
  },
  {
    id: 'svc-fluid-flush',
    code: 'FLUID-189',
    name: 'Full Synthetic Oil, Coolant & Drivetrain Fluid Wellness Package',
    short_name: 'Fluid Flush Package',
    badge: 'PREVENTIVE CARE',
    highlight: false,
    category: 'packages',
    price_usd: 189.0,
    price_label: '$189.00',
    billing_type: 'one_time',
    duration_label: '1.0 hr in bay',
    cta_label: 'Book Fluid Service — $189.00',
    summary: 'Full synthetic oil & filter service plus cooling system pressure test, fluid top-off, and multi-point safety inspection.',
    includes: [
      'Full synthetic motor oil + OEM-spec filter',
      'Coolant freeze-point test, battery load test & tire pressure reset',
      'Digital inspection scorecard sent to your phone'
    ]
  },
  {
    id: 'svc-fleet-pkg',
    code: 'FLEET-349',
    name: 'Commercial & B2B Fleet Maintenance Package',
    short_name: 'Fleet Service Package',
    badge: 'PRIORITY COMMERCIAL BAY',
    highlight: false,
    category: 'packages',
    price_usd: 349.0,
    price_label: '$349.00',
    billing_type: 'one_time',
    duration_label: 'Same-day turnaround',
    cta_label: 'Book Fleet Service — $349.00',
    summary: 'Priority turnaround for work trucks, vans, and Pierce County commercial fleets — includes full DVI, synthetic service, and priority parts sourcing.',
    includes: [
      'Priority commercial lift slot at 5115 66th St W, Bldg B',
      'Full DOT-ready safety DVI report emailed to fleet manager',
      'Pairs with B2B Pro membership (20–25% wholesale OEM parts)'
    ]
  }
];

/* ==================== WHOLESALE BENCHMARK MATRIX FOR 50% MARKUP SOURCING ==================== */
// Commercial Tier-1 wholesale baseline costs (USD) -> Customer Retail = Wholesale * 1.50 (exact 50% markup)
const WHOLESALE_PART_BENCHMARKS = [
  { match: /\b(transmission|transaxle|gearbox)\b/i, label: 'Tested Used OEM / Reman Transmission Assembly', wholesale: 950, laborHours: 6.0, eta: '2–3 business days (freight to shop)' },
  { match: /\b(engine|motor\s*assembly|long\s*block)\b/i, label: 'Tested Used OEM Engine Assembly', wholesale: 1350, laborHours: 10.0, eta: '2–4 business days (freight to shop)' },
  { match: /\b(differential|transfer\s*case|axle\s*assembly)\b/i, label: 'OEM Differential / Transfer Case Assembly', wholesale: 460, laborHours: 4.0, eta: '1–2 business days' },
  { match: /\b(alternator)\b/i, label: 'Tier-1 Reman / OEM Alternator', wholesale: 148, laborHours: 1.5, eta: 'Same-day commercial courier (98467)' },
  { match: /\b(starter)\b/i, label: 'Tier-1 Reman / OEM Starter Motor', wholesale: 124, laborHours: 1.5, eta: 'Same-day commercial courier (98467)' },
  { match: /\b(battery)\b/i, label: 'Commercial Grade AGM / Flooded Battery', wholesale: 138, laborHours: 0.4, eta: 'Same-day counter pickup / install' },
  { match: /\b(brake\s*pads?|rotors?|caliper|brakes?)\b/i, label: 'Ceramic Brake Pads & Coated Rotors Axle Kit', wholesale: 132, laborHours: 1.5, eta: 'Same-day commercial courier (98467)' },
  { match: /\b(strut|shock|coilover|coil\s*spring)\b/i, label: 'Quick-Strut / OEM Shock Absorber Pair', wholesale: 176, laborHours: 2.0, eta: 'Same-day / Next-morning delivery' },
  { match: /\b(wheel\s*(bearing|hub)|hub\s*assembly)\b/i, label: 'OEM-Spec Wheel Hub & Bearing Assembly', wholesale: 88, laborHours: 1.5, eta: 'Same-day commercial courier (98467)' },
  { match: /\b(control\s*arm|ball\s*joint|tie\s*rod|sway\s*bar|cv\s*axle|half\s*shaft)\b/i, label: 'Heavy-Duty Suspension / CV Axle Assembly', wholesale: 96, laborHours: 1.8, eta: 'Same-day commercial courier (98467)' },
  { match: /\b(radiator|condenser|cooling\s*fan)\b/i, label: 'Direct-Fit OEM-Spec Radiator / Cooling Assembly', wholesale: 128, laborHours: 2.0, eta: 'Same-day / Next-morning delivery' },
  { match: /\b(water\s*pump|thermostat|timing\s*(belt|chain))\b/i, label: 'OEM-Spec Water Pump / Timing Kit', wholesale: 118, laborHours: 3.0, eta: 'Same-day commercial courier (98467)' },
  { match: /\b(a\/c\s*compressor|ac\s*compressor)\b/i, label: 'OEM-Spec A/C Compressor Kit', wholesale: 224, laborHours: 2.5, eta: 'Same-day / Next-morning delivery' },
  { match: /\b(fuel\s*pump|injector)\b/i, label: 'OEM-Spec Fuel Pump Module Assembly', wholesale: 162, laborHours: 2.0, eta: 'Same-day commercial courier (98467)' },
  { match: /\b(ecm|ecu|pcm|bcm|abs\s*(module|pump)|control\s*module|computer)\b/i, label: 'Tested OEM Electronic Control Module', wholesale: 156, laborHours: 1.0, eta: '1–2 business days (PNW OEM network)' },
  { match: /\b(headlight|headlamp|taillight|tail\s*light|mirror|grille)\b/i, label: 'Direct-Fit OEM / CAPA Lighting or Mirror Assembly', wholesale: 98, laborHours: 0.8, eta: 'Next-business-day delivery' },
  { match: /\b(bumper|fender|hood|door\s*shell|tailgate)\b/i, label: 'Verified OEM Body Panel / Door Assembly', wholesale: 240, laborHours: 2.5, eta: '1–2 business days (PNW yard network)' },
  { match: /\b(window\s*regulator|wiper\s*motor|door\s*lock|actuator)\b/i, label: 'Direct-Fit Window Regulator / Actuator Assembly', wholesale: 78, laborHours: 1.2, eta: 'Same-day commercial courier (98467)' },
  { match: /\b(o2\s*sensor|oxygen\s*sensor|maf|mass\s*air|ignition\s*coil|spark\s*plug|sensor)\b/i, label: 'OEM-Spec Sensor / Ignition Component', wholesale: 68, laborHours: 0.7, eta: 'Same-day commercial courier (98467)' },
  { match: /\b(catalytic|muffler|exhaust)\b/i, label: 'CARB / EPA Compliant New Direct-Fit Exhaust Component', wholesale: 290, laborHours: 1.5, eta: '1–2 business days (new compliant only)' }
];

function computeInstalledEstimate(partRetailUsd, laborHours, settings = {}) {
  const rate = Number(settings.labor_rate_hourly || LOCKED_SHOP_LABOR_RATE);
  const supplyRate = Number(settings.shop_supply_fee_rate ?? 0.07);
  const supplyCap = Number(settings.shop_supply_fee_cap ?? 45);
  const taxRate = Number(settings.tax_rate ?? 0.101);
  const laborSub = Number((Math.max(0, Number(laborHours || 0)) * rate).toFixed(2));
  const supplyFee = laborSub > 0 ? Number(Math.min(supplyCap, laborSub * supplyRate).toFixed(2)) : 0;
  const preTax = Number((Number(partRetailUsd || 0) + laborSub + supplyFee).toFixed(2));
  const outTheDoor = Number((preTax * (1 + taxRate)).toFixed(2));
  return { rate, labor_subtotal_usd: laborSub, shop_supplies_usd: supplyFee, pre_tax_usd: preTax, installed_total_usd: outTheDoor };
}

function findInStockMatchesForQuery(partQuery, vehicleMake, vehicleModel, vehicleYear) {
  const qTokens = String(partQuery || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const mk = String(vehicleMake || '').trim().toLowerCase();
  const md = String(vehicleModel || '').trim().toLowerCase();
  const yr = parseInt(vehicleYear, 10) || 0;
  const rows = db.prepare("SELECT id, sku, title, fitment_years, fitment_make, fitment_model, price_we_pull, price_pull_install, install_labor_hours, photos_json FROM inventory_items WHERE status = 'active' AND quantity > 0").all();
  const matches = [];
  for (const r of rows) {
    const hay = `${r.title} ${r.fitment_make} ${r.fitment_model} ${r.fitment_years}`.toLowerCase();
    let score = 0;
    if (mk && hay.includes(mk)) score += 3;
    if (md && hay.includes(md.split(' ')[0])) score += 3;
    if (yr && r.fitment_years) {
      const m = String(r.fitment_years).match(/(\d{4})\s*[-–]\s*(\d{4})/);
      if (m && yr >= Number(m[1]) && yr <= Number(m[2])) score += 2;
      else if (String(r.fitment_years).includes(String(yr))) score += 2;
    }
    let tokenHits = 0;
    for (const tk of qTokens) {
      if (hay.includes(tk)) tokenHits++;
    }
    if (tokenHits > 0) score += tokenHits * 3;
    if (score >= 5 && (tokenHits > 0 || (mk && md))) {
      let photos = [];
      try { photos = JSON.parse(r.photos_json || '[]'); } catch (_) {}
      matches.push({
        sku: r.sku,
        title: r.title,
        price_we_pull: Number(r.price_we_pull || 0),
        price_pull_install: Number(r.price_pull_install || 0),
        photo: photos[0] || '',
        score
      });
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 4);
}

function createPartSourcingQuote(payload = {}) {
  const settings = getSettings();
  const customerName = String(payload.customer_name || payload.name || '').trim();
  const phone = String(payload.phone || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const smsOptIn = payload.sms_opt_in === false ? 0 : 1;
  const vehicleYear = String(payload.vehicle_year || '').trim();
  const vehicleMake = String(payload.vehicle_make || '').trim();
  const vehicleModel = String(payload.vehicle_model || '').trim();
  const vehicleVin = String(payload.vehicle_vin || '').trim().toUpperCase();
  const partQuery = String(payload.part_query || payload.part_needed || payload.symptom_text || '').trim();
  const symptomCategory = String(payload.symptom_category || '').trim();
  const symptomText = String(payload.symptom_text || '').trim();

  if (!customerName || (!phone && !email)) {
    throw new Error('Please enter your name and either a phone number or email so we can text/send your instant quote.');
  }
  if (!partQuery && !symptomText) {
    throw new Error('Please tell us what part you need or what your vehicle is doing.');
  }

  const combinedText = `${partQuery} ${symptomText}`.trim();
  const matchedRule = WHOLESALE_PART_BENCHMARKS.find((b) => b.match.test(combinedText)) || {
    label: 'OEM / Tier-1 Commercial Sourced Replacement Part',
    wholesale: 112,
    laborHours: 1.2,
    eta: 'Same-day / Next-business-day to University Place 98467'
  };

  const wholesaleCost = Number(
    payload.wholesale_cost_override > 0 ? payload.wholesale_cost_override : matchedRule.wholesale
  );
  const markupPct = DEFAULT_SOURCING_MARKUP_PCT; // Exact 50% retail markup over wholesale
  const quotedRetailUsd = Number((wholesaleCost * (1 + markupPct / 100)).toFixed(2));
  const estLaborHours = Number(payload.estimated_labor_hours ?? matchedRule.laborHours);
  const installCalc = computeInstalledEstimate(quotedRetailUsd, estLaborHours, settings);
  const now = new Date().toISOString();
  const requestCode = `SRC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  // Upsert CRM customer & vehicle
  const upsertedCust = upsertCustomer({
    name: customerName,
    email,
    phone,
    sms_opt_in: smsOptIn,
    email_opt_in: email ? 1 : 0,
    source_pillar: 'parts_sourcing_50pct',
    notes: `Part Sourcing ${requestCode}: ${partQuery || symptomText} (${[vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ')})`
  });
  const customerId = typeof upsertedCust === 'object' ? (Number(upsertedCust?.id || 0) || null) : (Number(upsertedCust || 0) || null);

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
        `).run(customerId, vehicleVin, yrNum, vehicleMake, vehicleModel, `Added via Part Finder (${requestCode})`, now, now);
      }
    } catch (_) {}
  }

  const res = db.prepare(`
    INSERT INTO part_sourcing_requests (
      org_id, request_code, customer_id, customer_name, phone, email, sms_opt_in,
      vehicle_year, vehicle_make, vehicle_model, vehicle_vin,
      part_query, symptom_category, symptom_text,
      wholesale_cost_usd, markup_pct, quoted_retail_usd,
      estimated_labor_hours, labor_rate_hourly, installed_total_usd,
      vendor_source_label, eta_label, status, notes, created_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quoted', ?, ?, ?)
  `).run(
    requestCode, customerId, customerName, phone, email, smsOptIn,
    vehicleYear, vehicleMake, vehicleModel, vehicleVin,
    partQuery || matchedRule.label, symptomCategory, symptomText,
    wholesaleCost, markupPct, quotedRetailUsd,
    estLaborHours, installCalc.rate, installCalc.installed_total_usd,
    matchedRule.label, matchedRule.eta,
    `Auto-quoted at exact +${markupPct}% retail markup over $${wholesaleCost.toFixed(2)} commercial wholesale benchmark.`,
    now, now
  );

  const inStockMatches = findInStockMatchesForQuery(partQuery, vehicleMake, vehicleModel, vehicleYear);
  const created = db.prepare('SELECT * FROM part_sourcing_requests WHERE id = ?').get(Number(res.lastInsertRowid));

  logSync(
    'inbound',
    'parts_sourcing_engine',
    'instant_50pct_markup_quote',
    requestCode,
    'success',
    `${customerName} requested "${partQuery || symptomText}" for ${[vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ') || 'vehicle'} -> Wholesale $${wholesaleCost.toFixed(2)} + 50% markup = $${quotedRetailUsd.toFixed(2)} retail (or $${installCalc.installed_total_usd.toFixed(2)} turnkey installed @ $${installCalc.rate}/hr).`
  );

  return {
    ok: true,
    request: created,
    quote: {
      request_code: requestCode,
      part_label: matchedRule.label,
      part_query: partQuery || matchedRule.label,
      wholesale_cost_usd: wholesaleCost,
      markup_pct: markupPct,
      retail_price_usd: quotedRetailUsd,
      estimated_labor_hours: estLaborHours,
      labor_rate_hourly: installCalc.rate,
      installed_total_usd: installCalc.installed_total_usd,
      eta_label: matchedRule.eta,
      pickup_address: '5115 66th St W, Bldg B, University Place, WA 98467'
    },
    in_stock_matches: inStockMatches
  };
}

function listPartSourcingRequests() {
  const rows = db.prepare('SELECT * FROM part_sourcing_requests ORDER BY created_at DESC LIMIT 150').all();
  return {
    ok: true,
    total_requests: rows.length,
    open_count: rows.filter((r) => ['quoted', 'sourcing', 'ordered'].includes(r.status)).length,
    requests: rows
  };
}

function updatePartSourcingRequestByStaff(id, patch = {}) {
  const row = db.prepare('SELECT * FROM part_sourcing_requests WHERE id = ?').get(Number(id));
  if (!row) return null;
  const settings = getSettings();
  const wholesale = patch.wholesale_cost_usd !== undefined && Number(patch.wholesale_cost_usd) > 0
    ? Number(patch.wholesale_cost_usd)
    : Number(row.wholesale_cost_usd);
  const markupPct = patch.markup_pct !== undefined && Number(patch.markup_pct) >= 0
    ? Number(patch.markup_pct)
    : Number(row.markup_pct || DEFAULT_SOURCING_MARKUP_PCT);
  const retail = Number((wholesale * (1 + markupPct / 100)).toFixed(2));
  const laborHours = patch.estimated_labor_hours !== undefined
    ? Number(patch.estimated_labor_hours)
    : Number(row.estimated_labor_hours);
  const installCalc = computeInstalledEstimate(retail, laborHours, settings);
  const status = ['quoted', 'sourcing', 'ordered', 'arrived', 'completed', 'canceled'].includes(patch.status)
    ? patch.status
    : row.status;
  const notes = patch.notes !== undefined ? String(patch.notes) : row.notes;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE part_sourcing_requests
    SET wholesale_cost_usd = ?, markup_pct = ?, quoted_retail_usd = ?,
        estimated_labor_hours = ?, labor_rate_hourly = ?, installed_total_usd = ?,
        status = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(wholesale, markupPct, retail, laborHours, installCalc.rate, installCalc.installed_total_usd, status, notes, now, row.id);

  return db.prepare('SELECT * FROM part_sourcing_requests WHERE id = ?').get(row.id);
}

/* ==================== GUIDED "NOT SURE WHAT YOU NEED?" HELPER ==================== */
const SYMPTOM_PLAYBOOKS = {
  check_engine: {
    key: 'check_engine',
    label: 'Check Engine Light or Dashboard Warning',
    recommended_service_id: 'svc-free-cel-scan',
    headline: 'Start with our FREE Check Engine Light & OBD2 Scan ($0.00)',
    explanation: 'Never guess or throw expensive parts at a check engine light. Pull into our University Place shop and we will scan your computer live for FREE and tell you in plain English what is going on.',
    secondary_service_id: 'svc-dvi-wellness'
  },
  noises_brakes: {
    key: 'noises_brakes',
    label: 'Noises, Shaking, Squealing or Brakes',
    recommended_service_id: 'svc-dvi-wellness',
    headline: 'Recommended: $89.99 Digital Vehicle Wellness Inspection (DVI)',
    explanation: 'Squealing, grinding, steering shake, or clunks over bumps are usually brakes, wheel bearings, or suspension bushings. We put it on the lift, photograph every worn part, and text the report straight to your phone.',
    secondary_service_id: 'svc-brakes-pkg'
  },
  wont_start_electrical: {
    key: 'wont_start_electrical',
    label: "Won't Start, Battery, or Electrical Issue",
    recommended_service_id: 'svc-hourly-bay',
    headline: 'Recommended: 1-Hour Certified Electrical & Starting Diagnostics ($174.99)',
    explanation: 'We test battery load, alternator output, starter draw, relays, and OEM control modules cleanly before replacing a single component.',
    secondary_service_id: 'svc-free-cel-scan'
  },
  overheating_leaks: {
    key: 'overheating_leaks',
    label: 'Overheating, Fluid Leaks, or Smells',
    recommended_service_id: 'svc-dvi-wellness',
    headline: 'Recommended: Cooling & Underbody Pressure Inspection ($89.99 DVI)',
    explanation: 'We pressure-test your radiator, water pump, thermostat, and hoses, inspect underbody leaks, and send clear photos before any repair work starts.',
    secondary_service_id: 'svc-fluid-flush'
  },
  need_part_sourced: {
    key: 'need_part_sourced',
    label: 'Looking for a Specific Part (Not Listed)',
    recommended_service_id: null,
    headline: "If We Don't Have It, We Can Get It — Instant 50%-Markup Quote",
    explanation: 'We source genuine OEM & commercial Tier-1 parts through our Pierce County wholesale network with transparent +50% retail pricing — available for counter pickup or certified bay install.',
    secondary_service_id: 'svc-hourly-bay'
  }
};

function runGuidedHelperRecommendation(payload = {}) {
  const symptomKey = SYMPTOM_PLAYBOOKS[payload.symptom_category] ? payload.symptom_category : 'check_engine';
  const playbook = SYMPTOM_PLAYBOOKS[symptomKey];
  const recommendedService = SHOP_SERVICES_CATALOG.find((s) => s.id === playbook.recommended_service_id) || null;
  const secondaryService = SHOP_SERVICES_CATALOG.find((s) => s.id === playbook.secondary_service_id) || null;

  let sourcingResult = null;
  if (payload.customer_name && (payload.phone || payload.email)) {
    sourcingResult = createPartSourcingQuote({
      ...payload,
      symptom_category: symptomKey,
      part_query: payload.part_query || payload.symptom_text || playbook.label
    });
  }

  return {
    ok: true,
    playbook,
    recommended_service: recommendedService,
    secondary_service: secondaryService,
    sourcing_quote: sourcingResult ? sourcingResult.quote : null,
    in_stock_matches: sourcingResult
      ? sourcingResult.in_stock_matches
      : findInStockMatchesForQuery(payload.symptom_text || payload.part_query || '', payload.vehicle_make, payload.vehicle_model, payload.vehicle_year)
  };
}

/* ==================== INSTANT SHOP SERVICES BOOKING & OPTIONAL STRIPE BILLING ==================== */
async function createStripeServiceCheckout(service, { amountUsd, recurringMonthly, customerEmail, bookingCode, baseUrl }) {
  const secret = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secret || amountUsd <= 0) {
    return { configured: false, checkout_url: '' };
  }
  try {
    const origin = String(baseUrl || 'https://aldridgeautosupply.com').replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('mode', recurringMonthly ? 'subscription' : 'payment');
    params.set('success_url', `${origin}/?service_booked=${encodeURIComponent(bookingCode)}`);
    params.set('cancel_url', `${origin}/?service_canceled=${encodeURIComponent(bookingCode)}`);
    if (customerEmail) params.set('customer_email', customerEmail);
    params.set('line_items[0][price_data][currency]', 'usd');
    params.set('line_items[0][price_data][product_data][name]', service.name);
    params.set('line_items[0][price_data][unit_amount]', String(Math.round(amountUsd * 100)));
    if (recurringMonthly) {
      params.set('line_items[0][price_data][recurring][interval]', 'month');
    }
    params.set('line_items[0][quantity]', '1');
    params.set('metadata[booking_code]', bookingCode);
    params.set('metadata[service_id]', service.id);

    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    if (!resp.ok) return { configured: true, checkout_url: '' };
    const data = await resp.json();
    return { configured: true, checkout_url: data.url || '', session_id: data.id || '' };
  } catch (_) {
    return { configured: true, checkout_url: '' };
  }
}

async function bookShopService(payload = {}, { baseUrl = 'https://aldridgeautosupply.com' } = {}) {
  const serviceId = String(payload.service_id || '').trim();
  const service = SHOP_SERVICES_CATALOG.find((s) => s.id === serviceId);
  if (!service) {
    throw new Error('Selected shop service was not found.');
  }
  const customerName = String(payload.customer_name || payload.name || '').trim();
  const phone = String(payload.phone || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  if (!customerName || (!phone && !email)) {
    throw new Error('Please enter your name and phone or email to confirm your bay reservation.');
  }

  const hours = service.billing_type === 'hourly_block'
    ? Math.max(service.min_hours || 1, Math.min(service.max_hours || 8, Number(payload.hours || service.default_hours || 1)))
    : 1;
  const totalUsd = service.billing_type === 'hourly_block'
    ? Number((service.price_usd * hours).toFixed(2))
    : Number(service.price_usd.toFixed(2));

  const vehicleYear = String(payload.vehicle_year || '').trim();
  const vehicleMake = String(payload.vehicle_make || '').trim();
  const vehicleModel = String(payload.vehicle_model || '').trim();
  const vehicleVin = String(payload.vehicle_vin || '').trim().toUpperCase();
  const vehicleYmm = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ') || String(payload.vehicle_ymm || 'Customer Vehicle').trim();
  const preferredDate = String(payload.preferred_date || new Date(Date.now() + 86400000).toISOString().slice(0, 10)).trim();
  const preferredTime = String(payload.preferred_time || '09:00 AM').trim();
  const customerNotes = String(payload.notes || '').trim();
  const now = new Date().toISOString();
  const bookingCode = `${service.code}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const upsertedCust = upsertCustomer({
    name: customerName,
    email,
    phone,
    sms_opt_in: payload.sms_opt_in === false ? 0 : 1,
    email_opt_in: email ? 1 : 0,
    source_pillar: 'shop_services_menu',
    notes: `Booked ${service.name} (${bookingCode}) — $${totalUsd.toFixed(2)}`
  });
  const customerId = typeof upsertedCust === 'object' ? (Number(upsertedCust?.id || 0) || null) : (Number(upsertedCust || 0) || null);

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
        `).run(customerId, vehicleVin, yrNum, vehicleMake, vehicleModel, `Added via ${service.short_name} (${bookingCode})`, now, now);
      }
    } catch (_) {}
  }

  const staffNotes = `${service.name}${service.billing_type === 'hourly_block' ? ` (${hours} hr @ $${service.price_usd.toFixed(2)}/hr)` : ''} | Quoted Total: $${totalUsd.toFixed(2)}${service.billing_type === 'monthly_recurring' ? '/mo recurring' : ''}`;
  db.prepare(`
    INSERT INTO appointments (
      org_id, booking_code, customer_id, customer_name, customer_email, customer_phone,
      appointment_type, service_category, vehicle_vin, vehicle_ymm,
      preferred_date, preferred_time, booking_mode, status, assigned_bay, staff_notes, customer_notes, created_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'instant_online', 'confirmed', ?, ?, ?, ?)
  `).run(
    bookingCode, customerId, customerName, email, phone,
    service.category === 'storage' ? 'vehicle_storage' : 'shop_service',
    service.name,
    vehicleVin,
    vehicleYmm,
    preferredDate,
    preferredTime,
    service.category === 'storage' ? 'Fenced Lot 98467' : 'Bay 1 — University Place',
    staffNotes,
    customerNotes,
    now
  );

  const stripe = await createStripeServiceCheckout(service, {
    amountUsd: totalUsd,
    recurringMonthly: service.billing_type === 'monthly_recurring',
    customerEmail: email,
    bookingCode,
    baseUrl
  });

  logSync(
    'inbound',
    'shop_services_menu',
    'instant_service_booking',
    bookingCode,
    'success',
    `Confirmed ${service.name} for ${customerName} (${vehicleYmm}) on ${preferredDate} ${preferredTime} — $${totalUsd.toFixed(2)}${service.billing_type === 'monthly_recurring' ? '/mo' : ''}.`
  );

  return {
    ok: true,
    booking_code: bookingCode,
    service: {
      id: service.id,
      name: service.name,
      billing_type: service.billing_type,
      hours: service.billing_type === 'hourly_block' ? hours : null,
      total_usd: totalUsd,
      price_label: service.billing_type === 'hourly_block'
        ? `$${totalUsd.toFixed(2)} (${hours} hr @ $174.99/hr)`
        : service.price_label
    },
    appointment: {
      booking_code: bookingCode,
      customer_name: customerName,
      vehicle_ymm: vehicleYmm,
      preferred_date: preferredDate,
      preferred_time: preferredTime,
      location: 'Aldridge Auto\'s Service & Repair — 5115 66th St W, Bldg B, University Place, WA 98467'
    },
    stripe_checkout_url: stripe.checkout_url || '',
    stripe_configured: stripe.configured
  };
}

module.exports = {
  SHOP_SERVICES_CATALOG,
  SYMPTOM_PLAYBOOKS,
  DEFAULT_SOURCING_MARKUP_PCT,
  createPartSourcingQuote,
  listPartSourcingRequests,
  updatePartSourcingRequestByStaff,
  runGuidedHelperRecommendation,
  bookShopService
};
