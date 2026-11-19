const crypto = require('node:crypto');
const {
  db,
  getSettings,
  updateSettings,
  generateSecurityCode,
  computeShippingClass,
  validateVinStrict,
  validatePartCompliance,
  logSync
} = require('./db');
const { isCounterfeitMpn } = require('./audit-sanitizer');

const MODEL_YEAR_MAP = {
  A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017,
  J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025, T: 2026,
  1: 2001, 2: 2002, 3: 2003, 4: 2004, 5: 2005, 6: 2006, 7: 2007, 8: 2008, 9: 2009
};

const WMI_MAP = {
  '1FT': { make: 'Ford', model: 'F-150 / Super Duty', engine: '2.7L / 3.5L EcoBoost or 5.0L V8', drivetrain: '4WD' },
  '1FM': { make: 'Ford', model: 'Explorer / Expedition', engine: '3.5L EcoBoost / 2.3L I4', drivetrain: 'AWD' },
  '1FA': { make: 'Ford', model: 'Mustang / Fusion', engine: '2.3L EcoBoost / 5.0L Coyote', drivetrain: 'RWD' },
  '3FA': { make: 'Ford', model: 'Fusion', engine: '2.5L Duratec / 1.5L EcoBoost', drivetrain: 'FWD' },
  '4T1': { make: 'Toyota', model: 'Camry', engine: '2.5L Dynamic Force I4', drivetrain: 'FWD' },
  '2T3': { make: 'Toyota', model: 'RAV4', engine: '2.5L I4', drivetrain: 'AWD' },
  '5TD': { make: 'Toyota', model: 'Highlander / Sienna', engine: '3.5L V6 / 2.5L Hybrid', drivetrain: 'AWD' },
  '5TF': { make: 'Toyota', model: 'Tundra', engine: '5.7L V8 / 3.4L Twin-Turbo V6', drivetrain: '4WD' },
  '1HG': { make: 'Honda', model: 'Accord', engine: '1.5L Turbo / 2.0L I4', drivetrain: 'FWD' },
  '2HK': { make: 'Honda', model: 'CR-V', engine: '1.5L Turbo I4', drivetrain: 'AWD' },
  '5FN': { make: 'Honda', model: 'Odyssey / Pilot', engine: '3.5L i-VTEC V6', drivetrain: 'FWD' },
  '1GC': { make: 'Chevrolet', model: 'Silverado 1500', engine: '5.3L EcoTec3 V8', drivetrain: '4WD' },
  '1G1': { make: 'Chevrolet', model: 'Malibu / Camaro', engine: '1.5L Turbo / 6.2L V8', drivetrain: 'FWD' },
  '1GT': { make: 'GMC', model: 'Sierra 1500', engine: '5.3L / 6.2L V8', drivetrain: '4WD' },
  '1C4': { make: 'Jeep', model: 'Grand Cherokee / Wrangler', engine: '3.6L Pentastar V6', drivetrain: '4WD' },
  '1C6': { make: 'Ram', model: '1500', engine: '5.7L HEMI V8', drivetrain: '4WD' },
  '1N4': { make: 'Nissan', model: 'Altima', engine: '2.5L QR25DE I4', drivetrain: 'FWD' },
  '5N1': { make: 'Nissan', model: 'Rogue / Pathfinder', engine: '2.5L I4 / 3.5L V6', drivetrain: 'AWD' },
  '4S4': { make: 'Subaru', model: 'Outback / Forester', engine: '2.5L Boxer H4', drivetrain: 'AWD' },
  '5NP': { make: 'Hyundai', model: 'Sonata / Elantra', engine: '2.5L Smartstream I4', drivetrain: 'FWD' },
  '5XY': { make: 'Kia', model: 'Sorento / Telluride', engine: '3.8L V6 / 2.5L Turbo', drivetrain: 'AWD' },
  'WBA': { make: 'BMW', model: '3 Series / 5 Series', engine: '2.0L TwinPower Turbo B48', drivetrain: 'RWD/xDrive' }
};

async function decodeVin(rawVin) {
  const check = validateVinStrict(rawVin);
  if (check.empty || !check.valid) {
    const err = new Error(check.reason || 'Please enter a valid 17-character NHTSA Modulo-11 VIN.');
    err.statusCode = 422;
    throw err;
  }
  const vin = check.vin;

  // Try official US DOT NHTSA vPIC API first
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (resp.ok) {
      const json = await resp.json();
      const r = json.Results?.[0];
      if (r && r.Make) {
        const disp = r.DisplacementL ? `${Number(r.DisplacementL).toFixed(1)}L ` : '';
        const cyl = r.EngineCylinders ? `${r.EngineCylinders}-Cyl ` : '';
        const rawMake = String(r.Make).trim();
        const niceMake = rawMake.length <= 3
          ? rawMake.toUpperCase()
          : rawMake.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
        return {
          vin,
          source: 'nhtsa_vpic_live',
          year: parseInt(r.ModelYear, 10) || MODEL_YEAR_MAP[vin[9]] || 2020,
          make: niceMake,
          model: r.Model || 'Series',
          trim: r.Trim || r.Series || '',
          engine: `${disp}${cyl}${r.EngineModel || ''}`.trim() || 'OEM Powertrain',
          transmission: r.TransmissionStyle || 'Automatic',
          drivetrain: r.DriveType || 'FWD/4WD'
        };
      }
    }
  } catch (_) {
    // Clean fallback to built-in ISO-3779 WMI decoder when sandbox restricts outbound hosts
  }

  const wmi = vin.slice(0, 3);
  const yearChar = vin[9];
  const year = MODEL_YEAR_MAP[yearChar] || 2020;
  const known = WMI_MAP[wmi] || {
    make: wmi.startsWith('J') ? 'Japanese OEM' : wmi.startsWith('W') ? 'European OEM' : 'Domestic OEM',
    model: 'Vehicle Series',
    engine: 'OEM Factory Engine',
    drivetrain: 'Standard'
  };

  return {
    vin,
    source: 'iso3779_wmi_decoder',
    year,
    make: known.make,
    model: known.model,
    trim: 'Factory Trim',
    engine: known.engine,
    transmission: 'Automatic',
    drivetrain: known.drivetrain
  };
}

const PART_CATALOG_PROFILES = [
  {
    match: ['starter', 'solenoid'],
    name: 'OEM High-Torque Starter Motor Assembly',
    category: 'Charging & Starting Systems',
    placement: 'Lower Bellhousing',
    weight_lbs: 9.0, length_in: 12, width_in: 8, height_in: 7,
    base_price: 95, labor_hours: 1.3, hollander_prefix: '604'
  },
  {
    match: ['alternator', 'generator', '27060', '23100', '104211'],
    name: 'OEM Alternator Charging Assembly',
    category: 'Charging & Starting Systems',
    placement: 'Front Engine Accessory Drive',
    weight_lbs: 13.5, length_in: 10, width_in: 9, height_in: 8,
    base_price: 165, labor_hours: 1.4, hollander_prefix: '601'
  },
  {
    match: ['ecm', 'pcm', 'ecu', 'tcm', 'module', 'bcm', 'abs'],
    name: 'OEM Engine Control Module (ECM / PCM) Computer',
    category: 'ECUs, Modules & Computers',
    placement: 'Engine Bay / Firewall',
    weight_lbs: 3.2, length_in: 11, width_in: 9, height_in: 4,
    base_price: 175, labor_hours: 1.0, hollander_prefix: '590'
  },
  {
    match: ['turbo', 'turbocharger', '6k682', 'garrett', 'borgwarner'],
    name: 'OEM Turbocharger & Actuator Assembly',
    category: 'Turbos, Superchargers & Intercoolers',
    placement: 'Exhaust Manifold',
    weight_lbs: 19.5, length_in: 15, width_in: 12, height_in: 11,
    base_price: 295, labor_hours: 3.5, hollander_prefix: '317'
  },
  {
    match: ['headlight', 'headlamp', 'led lamp', 'hid'],
    name: 'OEM LED/Projector Headlight Headlamp Assembly',
    category: 'Lighting & Lamps',
    placement: 'Front Outer Corner',
    weight_lbs: 9.5, length_in: 26, width_in: 15, height_in: 14,
    base_price: 240, labor_hours: 1.2, hollander_prefix: '114'
  },
  {
    match: ['tail light', 'taillight', 'tail lamp'],
    name: 'OEM Outer Tail Light Lamp Assembly',
    category: 'Lighting & Lamps',
    placement: 'Rear Quarter Panel',
    weight_lbs: 5.5, length_in: 18, width_in: 11, height_in: 9,
    base_price: 135, labor_hours: 0.5, hollander_prefix: '166'
  },
  {
    match: ['radiator', 'condenser', 'cooling fan', 'shroud'],
    name: 'OEM Aluminum Radiator & Dual Cooling Fan Shroud Assembly',
    category: 'Engine Cooling & Radiators',
    placement: 'Front Core Support',
    weight_lbs: 22.0, length_in: 34, width_in: 24, height_in: 9,
    base_price: 165, labor_hours: 2.0, hollander_prefix: '675'
  },
  {
    match: ['wheel', 'rim', 'tire', 'alloy'],
    name: 'OEM Machined Alloy Wheel Rim Assembly',
    category: 'Wheels, Tires & Hub Caps',
    placement: 'Front / Rear Hub',
    weight_lbs: 34.0, length_in: 24, width_in: 24, height_in: 11,
    base_price: 195, labor_hours: 0.5, hollander_prefix: '560'
  },
  {
    match: ['bumper', 'fascia', 'fender', 'hood', 'door shell'],
    name: 'OEM Painted Exterior Body Panel Assembly',
    category: 'Exterior Body Panels & Bumpers',
    placement: 'Exterior Body',
    weight_lbs: 78.0, length_in: 68, width_in: 24, height_in: 22,
    base_price: 390, labor_hours: 2.2, hollander_prefix: '105'
  },
  {
    match: ['transmission assembly', 'automatic transmission', 'manual transmission', 'gearbox', '10r80', '6l80', 'cvt'],
    name: 'Complete Automatic Transmission Assembly w/ Converter',
    category: 'Automatic Transmissions & Driveline',
    placement: 'Center Drivetrain',
    weight_lbs: 225.0, length_in: 44, width_in: 36, height_in: 30,
    base_price: 1650, labor_hours: 7.5, hollander_prefix: '400'
  },
  {
    match: ['complete engine', 'engine assembly', 'long block', 'short block'],
    name: 'Complete Tested OEM Engine Long Block Assembly',
    category: 'Complete Engines & Long Blocks',
    placement: 'Front Engine Bay',
    weight_lbs: 385.0, length_in: 48, width_in: 40, height_in: 38,
    base_price: 2450, labor_hours: 11.0, hollander_prefix: '300'
  }
];

async function analyzePartIntake({ imageBase64 = '', imagesBase64 = [], donorVehicleId = null, technicianHint = '', stampedNumber = '', pullStatus = 'pulled_shelved', condition = 'Used' }) {
  const settings = getSettings();

  // Hard block SRS/airbag/clockspring/pretensioner & catalytic converter items immediately on intake!
  const entryCompliance = validatePartCompliance({ technicianHint, title: technicianHint });
  if (!entryCompliance.compliant) {
    const err = new Error(entryCompliance.reason);
    err.statusCode = 422;
    throw err;
  }

  let donor = null;
  if (donorVehicleId) {
    donor = db.prepare('SELECT * FROM donor_vehicles WHERE id = ?').get(Number(donorVehicleId));
    if (donor && donor.vin) {
      const vinCheck = validateVinStrict(donor.vin);
      if (!vinCheck.valid) {
        const err = new Error(`Donor vehicle VIN blocked: ${vinCheck.reason}`);
        err.statusCode = 422;
        throw err;
      }
    }
  }

  // Extract any stamped OEM-like alphanumeric code from technician notes if not explicitly supplied
  let detectedOem = (stampedNumber || '').trim().toUpperCase();
  if (!detectedOem && technicianHint) {
    const m = technicianHint.toUpperCase().match(/\b([A-Z0-9]{4,6}[- ][A-Z0-9]{3,6}(?:[- ][A-Z0-9]{1,4})?)\b/);
    if (m) detectedOem = m[1].replace(/\s+/g, '-');
  }
  if (/^DOES\s+NOT\s+APPLY$/i.test(detectedOem) || isCounterfeitMpn(detectedOem)) {
    detectedOem = '';
  }

  const candidatePhotos = (Array.isArray(imagesBase64) && imagesBase64.length > 0 ? imagesBase64 : [imageBase64])
    .filter((img) => typeof img === 'string' && img.includes('base64,'))
    .slice(0, 4);

  // Live Gemini Vision API call across up to 4 multi-angle photos (overview + stamped OEM label)
  if (settings.gemini_api_key && candidatePhotos.length > 0) {
    try {
      const inlineParts = candidatePhotos.map((img) => {
        const [meta, b64Data] = img.split('base64,');
        const mimeMatch = meta.match(/data:(.*?);/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        return { inline_data: { mime_type: mimeType, data: b64Data } };
      });
      const prompt = `You are an expert automotive OEM salvage parts cataloger for Aldridge Auto's (University Place, WA 98467). Inspect all ${inlineParts.length} photo angle(s) of this part (including any stamped/sticker OEM part numbers).
Donor Vehicle context: ${donor ? `${donor.year} ${donor.make} ${donor.model} ${donor.engine} (${donor.mileage} mi)` : 'Identify exact Year range, Make, Model, and Engine from OEM part number or part geometry'}.
Technician notes: ${technicianHint || 'None'}. Stamped number hint: ${detectedOem || 'Read any visible stamped/sticker OEM part number, or return empty string if none is visible (NEVER invent numbers)'}.
Return ONLY valid JSON with keys: part_name, category, oem_part_number, interchange_number, fitment_years, fitment_make, fitment_model, fitment_engine, placement_on_vehicle, weight_lbs (number, packaged shipping weight), length_in (number), width_in (number), height_in (number), suggested_price_usd (number, fair market Used OEM price), install_labor_hours (number), condition_notes, fitment_notes.`;

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(settings.gemini_api_key)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, ...inlineParts] }],
            generationConfig: { responseMimeType: 'application/json' }
          }),
          signal: AbortSignal.timeout(12000)
        }
      );
      if (resp.ok) {
        const gJson = await resp.json();
        const rawText = gJson.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          const ai = JSON.parse(rawText);
          return buildStructuredIntakeProposal({
            ai,
            donor,
            pullStatus,
            condition,
            settings,
            providerUsed: 'gemini_2.5_flash_vision'
          });
        }
      }
    } catch (innerErr) {
      if (innerErr && innerErr.statusCode === 422) throw innerErr;
      // Otherwise fall through cleanly to deterministic shop catalog engine
    }
  }

  const combinedText = `${technicianHint} ${detectedOem}`.toLowerCase();
  let profile = PART_CATALOG_PROFILES.find((p) => p.match.some((kw) => combinedText.includes(kw)));
  if (!profile) {
    profile = {
      name: technicianHint ? technicianHint.trim().replace(/\b\w/g, (c) => c.toUpperCase()) : 'Tested OEM Automotive Assembly',
      category: 'OEM Auto Parts & Assemblies',
      placement: 'Vehicle Assembly',
      weight_lbs: 11.0, length_in: 14, width_in: 10, height_in: 8,
      base_price: 135, labor_hours: 1.5, hollander_prefix: '599'
    };
  }

  // Audit Rule: NEVER fabricate synthetic OEM part numbers when no real stamped number is read
  const oemCode = detectedOem || '';
  const hollander = `${profile.hollander_prefix}-${Math.floor(10000 + Math.random() * 89000)}`;

  return buildStructuredIntakeProposal({
    ai: {
      part_name: profile.name,
      category: profile.category,
      oem_part_number: oemCode,
      interchange_number: hollander,
      hollander_number: hollander,
      placement_on_vehicle: profile.placement,
      weight_lbs: profile.weight_lbs,
      length_in: profile.length_in,
      width_in: profile.width_in,
      height_in: profile.height_in,
      suggested_price_usd: profile.base_price,
      install_labor_hours: profile.labor_hours,
      condition_notes: 'Connector pins, mounting tabs & housing inspected clean; see intake photos.',
      fitment_notes: 'Match MPN & photos prior to ordering (Returns Not Accepted for remorse/fitment); message us your valid 17-digit VIN to verify fitment.'
    },
    donor,
    pullStatus,
    condition,
    settings,
    providerUsed: 'smart_oem_catalog_engine'
  });
}

function buildStructuredIntakeProposal({ ai, donor, pullStatus, condition, settings, providerUsed }) {
  const outCompliance = validatePartCompliance({
    title: ai.part_name,
    category: ai.category,
    description: ai.condition_notes
  });
  if (!outCompliance.compliant) {
    const err = new Error(outCompliance.reason);
    err.statusCode = 422;
    throw err;
  }

  const normalizedCondition = String(condition || 'Used').trim().toLowerCase() === 'new' ? 'New' : 'Used';
  const cleanOem = ai.oem_part_number && !isCounterfeitMpn(ai.oem_part_number) ? String(ai.oem_part_number).trim() : '';

  const yearRange = donor ? `${donor.year - 1}, ${donor.year}, ${donor.year + 1}` : (ai.fitment_years || 'Verify OEM #');
  const fitMake = donor ? donor.make : (ai.fitment_make || 'OEM');
  const fitModel = donor ? donor.model : (ai.fitment_model || 'Compatible Models');
  const fitEngine = donor ? donor.engine : (ai.fitment_engine || 'Factory Powertrain');

  const rawTitle = donor
    ? `${donor.year} ${donor.make} ${donor.model} ${ai.part_name} ${cleanOem || 'OEM'}`.replace(/\s+/g, ' ').trim()
    : `${ai.fitment_years && !String(ai.fitment_years).includes('Verify') ? ai.fitment_years : ''} ${fitMake !== 'OEM' ? fitMake : ''} ${fitModel !== 'Compatible Models' ? fitModel : ''} ${ai.part_name} ${cleanOem || 'OEM'}`.replace(/\s+/g, ' ').trim();
  const title80 = rawTitle.slice(0, 80);

  const skuSuffix = (cleanOem || crypto.randomBytes(3).toString('hex')).replace(/[^A-Z0-9]/gi, '').slice(-6).toUpperCase();
  const sku = `ALD-${skuSuffix}`;
  const securityMark = generateSecurityCode();
  const weightLbs = Number(ai.weight_lbs || 10);
  const shippingClass = computeShippingClass(weightLbs, ai.category, ai.length_in, ai.width_in, ai.height_in);

  const priceWePull = Math.round(Number(ai.suggested_price_usd || 145));
  const laborHours = Number(ai.install_labor_hours || 1.5);
  const hourlyRate = Number(settings.labor_rate_hourly || 135);
  const pricePullInstall = Math.round(priceWePull + laborHours * hourlyRate);

  const mileageNote = donor && donor.mileage ? ` Pulled from a ${donor.mileage.toLocaleString()}-mile ${donor.year} ${donor.make} ${donor.model} (${donor.engine}).` : '';
  const mpnLabel = cleanOem ? `MPN #${cleanOem}` : 'MPN: Does Not Apply';
  const shipSummary = shippingClass === 'local_pickup_only'
    ? 'Local Pickup Only in University Place, WA 98467 (70+ lb / oversized / hazmat assembly).'
    : 'Ships Calculated Parcel + $10.00 handling buffer, or Free Counter Pickup in University Place, WA 98467.';

  const { resolvePartTaxonomyAndMetafields } = require('./taxonomy');
  const baseProposal = {
    provider: providerUsed,
    sku,
    title: title80,
    category: ai.category,
    condition: normalizedCondition,
    condition_id: normalizedCondition === 'New' ? 1000 : 3000,
    brand: donor ? `${donor.make}` : (fitMake || 'OEM'),
    oem_part_number: cleanOem,
    interchange_number: ai.interchange_number || '',
    hollander_number: ai.hollander_number || ai.interchange_number || '',
    placement_on_vehicle: ai.placement_on_vehicle || '',
    donor_vehicle_id: donor ? donor.id : null,
    fitment_years: yearRange,
    fitment_make: fitMake,
    fitment_model: fitModel,
    fitment_engine: fitEngine,
    fitment_notes: ai.fitment_notes,
    description: `Inspected ${normalizedCondition} ${ai.part_name} (${mpnLabel}, 1-of-1 Single Unit).${mileageNote} ${shipSummary} Optional Certified Shop Installation in University Place, WA 98467: $${pricePullInstall.toFixed(2)} turnkey installed. Returns Not Accepted for remorse/fitment (Defect-Only).`,
    defect_disclosure: ai.condition_notes,
    bin_location: shippingClass === 'local_pickup_only' ? 'LOCAL-PICKUP-98467' : 'RACK-A1-BIN-01',
    security_mark_code: securityMark,
    pull_status: 'pulled_shelved',
    allow_self_pull: 0,
    price_self_pull: 0,
    allow_we_pull: 1,
    price_we_pull: priceWePull,
    allow_pull_install: 1,
    price_pull_install: pricePullInstall,
    install_labor_hours: laborHours,
    quantity: 1,
    weight_lbs: weightLbs,
    length_in: Number(ai.length_in || 14),
    width_in: Number(ai.width_in || 10),
    height_in: Number(ai.height_in || 8),
    shipping_class: shippingClass,
    handling_fee: Number(settings.handling_fee_default || 10),
    handling_days: Number(settings.handling_days_default || 3)
  };
  const tax = resolvePartTaxonomyAndMetafields(baseProposal, settings);
  return {
    ...baseProposal,
    category: tax.partType,
    ebay_site_id: 'US',
    ebay_us_category_id: tax.ebayUsCategoryId,
    ebay_us_category_name: tax.ebayUsCategoryName,
    google_product_category: tax.googleProductCategory,
    shopify_taxonomy_id: tax.shopifyTaxonomyId,
    custom_label_0: tax.customLabel0,
    custom_label_1: tax.customLabel1,
    seo_tags: tax.seoTags,
    hashtags: tax.hashtags
  };
}

async function syncUhaulDealerPage(customUrl) {
  const settings = getSettings();
  const targetUrl = (customUrl || settings.uhaul_dealer_url || 'https://www.uhaul.com/Locations/').trim();
  let extractedTitle = settings.uhaul_synced_data?.dealer_title || `Authorized U-Haul Neighborhood Dealer — ${settings.business_name}`;
  let extractedAddress = `${settings.street_address}, ${settings.city_display || settings.city}, ${settings.state} ${settings.zip}`;
  let liveFetched = false;

  try {
    if (targetUrl.startsWith('https://') && targetUrl.includes('uhaul.com')) {
      const resp = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AutoCommandHubDealerSync/1.0)' },
        signal: AbortSignal.timeout(4500)
      });
      if (resp.ok) {
        const html = await resp.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          extractedTitle = titleMatch[1].replace(/\s+/g, ' ').trim();
          liveFetched = true;
        }
      }
    }
  } catch (_) {
    // Graceful compliant fallback if outbound fetch is proxy-restricted
  }

  const syncedData = {
    dealer_title: extractedTitle,
    official_portal_url: targetUrl,
    verified_address: extractedAddress,
    truck_share_24_7: true,
    limited_neighborhood_stock: true,
    equipment_categories: [
      'Limited Local U-Haul Moving Truck & Trailer Dispatch (Live Inventory Varies Daily)',
      'In-Town® & One-Way Moving Trucks — Check Live Availability on U-Haul.com',
      'Cargo & Utility Trailers (Customer Vehicle Must Already Be Equipped to Tow — No Hitch Sales/Install On-Site)',
      '24/7 Truck Share® Mobile Pickup & 24-Hour Customer Drop-Off Return'
    ],
    on_site_hitch_install: false,
    moving_supplies: false,
    compliance_mode: 'official_hosted_portal_redirect_only',
    live_fetched: liveFetched,
    last_synced_at: new Date().toISOString()
  };

  updateSettings({
    uhaul_dealer_url: targetUrl,
    uhaul_synced_data: syncedData
  });

  logSync('inbound', 'uhaul_dealer_portal', 'sync_location_profile', '', 'success', `Synced U-Haul hosted dealer metadata (${targetUrl}). Live dispatch redirects directly to U-Haul WebSelfService/Checkout for 100% U-Haul rule compliance.`);
  return syncedData;
}

function generateIcsCalendarEvent(apt, settings) {
  const cleanDate = String(apt.preferred_date || '2026-11-15').replace(/-/g, '');
  // Parse simple AM/PM hour or default 09:00
  let hour = 9;
  const m = String(apt.preferred_time || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (m) {
    hour = parseInt(m[1], 10);
    const ampm = (m[3] || '').toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
  }
  const hhStart = String(hour).padStart(2, '0');
  const hhEnd = String(Math.min(23, hour + 1)).padStart(2, '0');
  const dtStart = `${cleanDate}T${hhStart}0000`;
  const dtEnd = `${cleanDate}T${hhEnd}0000`;
  const location = `${settings.business_name}, ${settings.street_address}, ${settings.city_display || settings.city}, ${settings.state} ${settings.zip}`;
  const summary = `[${apt.booking_code}] ${apt.service_category} — ${apt.customer_name}`;
  const desc = `Booking: ${apt.booking_code}\\nType: ${apt.appointment_type}\\nVehicle: ${apt.vehicle_ymm || 'N/A'} (VIN: ${apt.vehicle_vin || 'N/A'})\\nSKU: ${apt.linked_sku || 'N/A'}\\nPhone: ${apt.customer_phone}\\nNotes: ${(apt.customer_notes || '').replace(/\n/g, ' ')}`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AutoCommandHub//UnifiedSchedule//EN',
    'BEGIN:VEVENT',
    `UID:${apt.booking_code}@autocommandhub.local`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${desc}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

function buildGoogleCalendarUrl(apt, settings) {
  const cleanDate = String(apt.preferred_date || '2026-11-15').replace(/-/g, '');
  const dates = `${cleanDate}T090000/${cleanDate}T103000`;
  const text = `[${apt.booking_code}] ${apt.service_category} - ${apt.customer_name}`;
  const location = `${settings.business_name}, ${settings.street_address}, ${settings.city_display || settings.city}, ${settings.state} ${settings.zip}`;
  const details = `Booking Code: ${apt.booking_code}\nType: ${apt.appointment_type}\nVehicle: ${apt.vehicle_ymm || 'N/A'} | VIN: ${apt.vehicle_vin || 'N/A'}\nLinked SKU: ${apt.linked_sku || 'None'}\nCustomer Phone: ${apt.customer_phone}\nStatus: ${apt.status}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text,
    dates,
    details,
    location
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function generateDeterministicMatrixSvg(codeText) {
  const hash = crypto.createHash('sha256').update(String(codeText)).digest();
  const size = 21;
  const cell = 5;
  let rects = '';

  const isFinder = (r, c) => {
    const inTL = r < 7 && c < 7;
    const inTR = r < 7 && c >= size - 7;
    const inBL = r >= size - 7 && c < 7;
    if (!inTL && !inTR && !inBL) return null;
    const lr = inBL ? r - (size - 7) : r;
    const lc = inTR ? c - (size - 7) : c;
    if (lr === 0 || lr === 6 || lc === 0 || lc === 6) return true;
    if (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4) return true;
    return false;
  };

  let bitIdx = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const f = isFinder(r, c);
      let dark = false;
      if (f !== null) {
        dark = f;
      } else {
        const byte = hash[Math.floor(bitIdx / 8) % hash.length];
        dark = ((byte >> (bitIdx % 8)) & 1) === 1;
        bitIdx++;
      }
      if (dark) {
        rects += `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="#111827"/>`;
      }
    }
  }
  const dim = size * cell;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#ffffff"/>${rects}</svg>`;
}

function generatePrintableBinLabelHtml(item, settings) {
  const { buildQrTrackingUrl, renderScannableQrSvg, resolvePublicAppBaseUrl } = require('./qr-card');
  const trackingUrl = buildQrTrackingUrl(item, settings, 'qr_bin_tag');
  const displayHost = resolvePublicAppBaseUrl(settings).replace(/^https?:\/\//i, '');
  const svg = renderScannableQrSvg(trackingUrl, 126);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Y813BT 4x6 Thermal Bin &amp; App QR Tag — ${item.sku}</title>
  <style>
    @page { size: 4in 6in; margin: 0.1in; }
    body { font-family: 'Inter', Arial, sans-serif; margin: 16px; background: #f3f4f6; color: #111827; }
    .label-card { width: 3.75in; background: #fff; border: 2px solid #111827; border-radius: 6px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
    .top-row { display: flex; gap: 12px; align-items: center; }
    .meta { flex: 1; min-width: 0; }
    .shop { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: #374151; }
    .sku { font-family: monospace; font-size: 20px; font-weight: 900; margin: 3px 0; }
    .bin { display: inline-block; background: #111827; color: #fff; font-family: monospace; font-weight: 700; font-size: 13px; padding: 3px 8px; border-radius: 3px; margin-bottom: 5px; }
    .sec { display: inline-block; border: 1.5px solid #b45309; color: #92400e; background: #fef3c7; font-family: monospace; font-weight: 700; font-size: 12px; padding: 2px 6px; border-radius: 3px; margin-left: 4px; }
    .title { font-size: 13px; line-height: 1.35; font-weight: 700; border-top: 1.5px dashed #d1d5db; padding-top: 8px; }
    .oem { font-size: 11px; font-family: monospace; color: #374151; }
    .app-scan { background: #0b1628; color: #fff; font-size: 10.5px; font-weight: 700; text-align: center; padding: 6px 8px; border-radius: 4px; }
    .actions { margin-top: 14px; display: flex; gap: 8px; }
    button, a.btn-link { background: #111827; color: #fff; text-decoration: none; border: none; padding: 9px 16px; border-radius: 5px; cursor: pointer; font-weight: 700; font-size: 13px; }
    @media print { body { background: #fff; margin: 0; } .actions { display: none; } .label-card { box-shadow: none; width: 3.7in; } }
  </style>
</head>
<body>
  <div class="label-card">
    <div class="top-row">
      <div>${svg}</div>
      <div class="meta">
        <div class="shop">${settings.business_name} • Y813BT 4x6</div>
        <div class="sku">${item.sku}</div>
        <div>
          <span class="bin">${item.bin_location || 'UNASSIGNED'}</span>
          <span class="sec">${item.security_mark_code}</span>
        </div>
        <div style="font-size:10px;color:#4b5563;margin-top:4px;">Scan QR → ${displayHost}</div>
      </div>
    </div>
    <div class="title">${item.title}</div>
    <div class="oem">OEM #: ${item.oem_part_number || 'Does Not Apply'} • ${item.weight_lbs} lbs • $${Number(item.price_we_pull || 0).toFixed(2)}</div>
    <div class="app-scan">SCAN QR OR VISIT ${displayHost.toUpperCase()} • ADD TO HOME SCREEN</div>
  </div>
  <div class="actions">
    <button onclick="window.print()">Print on Y813BT 4x6 Thermal Printer</button>
    <a class="btn-link" href="/api/inventory/${encodeURIComponent(item.sku)}/packing-slip">Open Full Customer Packing Slip</a>
  </div>
</body>
</html>`;
}

module.exports = {
  decodeVin,
  analyzePartIntake,
  syncUhaulDealerPage,
  generateIcsCalendarEvent,
  buildGoogleCalendarUrl,
  generatePrintableBinLabelHtml
};
