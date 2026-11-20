/**
 * Inter-Platform Automotive Taxonomy, Official Shopify Standard Product Taxonomy (vp-1-4-*),
 * Standard eBay US (ebay.com) Category Routing, Country of Origin, & Structured Metafields.
 *
 * Strict Anti-Placeholder Rules:
 * 1. Standard eBay US (ebay.com, SiteID=US) ONLY — NEVER eBay Motors (SiteID=eBayMotors).
 * 2. Official Shopify Standard Product Taxonomy category (gid://shopify/TaxonomyCategory/vp-1-4-*)
 *    plus leaf-node lookup hint (`shopifyTaxonomySearch`) resolved dynamically via GraphQL taxonomy API.
 * 3. NEVER output "Does Not Apply", hex/UUID hashes, or YYYY-MAKE tokens as MPN — return verified OEM MPN or "".
 * 4. NEVER output "Universal" as fitment — use exact verified Year/Make/Model only.
 */

const TAXONOMY_RULES = [
  {
    match: /coolant\s*(reservoir|overflow|recovery|expansion)\s*(tank|bottle)?|radiator\s*overflow\s*tank|overflow\s*tank/i,
    partType: 'Radiator Overflow Tanks',
    ebayUsCategoryId: '33602',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Engine Cooling Components > Expansion & Overflow Tanks',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Cooling Systems',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Cooling Systems > Radiator Overflow Tanks',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-22',
    shopifyTaxonomySearch: 'Radiator Overflow Tanks'
  },
  {
    match: /alternator|generator/i,
    partType: 'Alternators & Generators',
    ebayUsCategoryId: '177697',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Starters, Alternators, ECUs & Wiring > Alternators & Generators',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Power & Electrical Systems',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Power & Electrical Systems > Alternators',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-14',
    shopifyTaxonomySearch: 'Motor Vehicle Alternators'
  },
  {
    match: /\bstarter\b/i,
    partType: 'Starter Motors',
    ebayUsCategoryId: '177699',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Starters, Alternators, ECUs & Wiring > Starters',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Power & Electrical Systems',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Power & Electrical Systems > Starter Motors',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-14',
    shopifyTaxonomySearch: 'Starter Motors'
  },
  {
    match: /cluster|speedometer|tachometer|gauge/i,
    partType: 'Instrument Clusters & Gauges',
    ebayUsCategoryId: '33675',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Interior Parts & Accessories > Gauges > Instrument Clusters',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Sensors & Gauges',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Sensors & Gauges',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-16',
    shopifyTaxonomySearch: 'Motor Vehicle Sensors & Gauges'
  },
  {
    match: /\b(abs\s*pump|abs\s*module|anti[- ]lock|caliper|rotor|brake|master\s*cylinder|booster)\b/i,
    partType: 'Brakes & ABS Hydraulics',
    ebayUsCategoryId: '33563',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Brakes & Brake Parts > Calipers & Brackets',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Braking',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Braking',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-1',
    shopifyTaxonomySearch: 'Motor Vehicle Braking'
  },
  {
    match: /\b(ecm|ecu|pcm|tcm|bcm|tpms|mpx|module|computer|fuse\s*box|junction|relay|wiring|harness|amplifier|amp|radio|stereo|infotainment|navigation|display\s*screen|camera|sensor|receiver|combination\s*switch|horns?)\b/i,
    partType: 'ECUs, Modules & Automotive Electronics',
    ebayUsCategoryId: '33596',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Starters, Alternators, ECUs & Wiring > ECUs & Computer Modules',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Power & Electrical Systems',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Power & Electrical Systems',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-14',
    shopifyTaxonomySearch: 'Motor Vehicle Power & Electrical Systems'
  },
  {
    match: /headlight|headlamp|fog\s*light|corner\s*light|parking\s*(light|turn\s*signal)|turn\s*signal\s*(light|lamp)|marker\s*light/i,
    partType: 'Headlight & Front Lamp Assemblies',
    ebayUsCategoryId: '33710',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Lighting & Lamps > Headlight Assemblies',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Lighting',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Lighting',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-12',
    shopifyTaxonomySearch: 'Motor Vehicle Lighting'
  },
  {
    match: /tail\s*light|taillight|tail\s*lamp|brake\s*light|third\s*brake/i,
    partType: 'Tail Light Assemblies',
    ebayUsCategoryId: '33716',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Lighting & Lamps > Tail Light Assemblies',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Lighting',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Lighting',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-12',
    shopifyTaxonomySearch: 'Motor Vehicle Lighting'
  },
  {
    match: /door\s*shell|complete\s*door/i,
    partType: 'Doors & Exterior Door Shells',
    ebayUsCategoryId: '33642',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Exterior Parts & Accessories > Doors & Door Skins',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Frame & Body Parts',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Frame & Body Parts',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-9',
    shopifyTaxonomySearch: 'Motor Vehicle Frame & Body Parts'
  },
  {
    match: /mirror/i,
    partType: 'Exterior & Interior Mirrors',
    ebayUsCategoryId: '33649',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Exterior Parts & Accessories > Mirrors > Side View Mirrors',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Mirrors',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Mirrors',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-13',
    shopifyTaxonomySearch: 'Motor Vehicle Mirrors'
  },
  {
    match: /strut|shock|coil\s*spring|control\s*arm|knuckle|spindle|sway\s*bar|subframe|steering\s*rack|power\s*steering|tie\s*rod|suspension/i,
    partType: 'Steering & Suspension Components',
    ebayUsCategoryId: '33590',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Steering & Suspension > Shocks, Struts & Assemblies',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Suspension Parts',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Suspension Parts',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-17',
    shopifyTaxonomySearch: 'Motor Vehicle Suspension Parts'
  },
  {
    match: /compressor|condenser|evaporator|heater|blower|hvac|climate\s*control/i,
    partType: 'A/C & Climate Control',
    ebayUsCategoryId: '33543',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Air Conditioning & Heating > A/C Compressors & Clutches',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Climate Control',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Climate Control',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-3',
    shopifyTaxonomySearch: 'Motor Vehicle Climate Control'
  },
  {
    match: /radiator|cooling\s*fan|fan\s*shroud|water\s*pump|thermostat|coolant|intercooler|washer\s*(fluid|reservoir|tank)/i,
    partType: 'Engine Cooling & Washer Components',
    ebayUsCategoryId: '33602',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Engine Cooling Components > Radiators',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Cooling Systems',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Cooling Systems',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-22',
    shopifyTaxonomySearch: 'Motor Vehicle Cooling Systems'
  },
  {
    match: /(?<!steering\s)\b(wheels?|rims?|tires?|hubcaps?|center\s*caps?)\b/i,
    partType: 'Wheels, Tires & Hub Caps',
    ebayUsCategoryId: '179679',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Wheels, Tires & Parts > Wheels',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Wheel Systems',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Wheel Systems',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-20',
    shopifyTaxonomySearch: 'Motor Vehicle Wheel Systems'
  },
  {
    match: /transmission|transfer\s*case|differential|axle|drive\s*shaft|driveshaft|cv\s*joint|torque\s*converter|clutch\s*slave/i,
    partType: 'Transmission & Drivetrain',
    ebayUsCategoryId: '171115',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Transmission & Drivetrain > Automatic Transmission',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Transmission & Drivetrain Parts',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Transmission & Drivetrain Parts',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-19',
    shopifyTaxonomySearch: 'Motor Vehicle Transmission & Drivetrain Parts'
  },
  {
    match: /exhaust\s*heat\s*shield|heat\s*shield|muffler|exhaust\s*pipe|tailpipe/i,
    partType: 'Exhaust & Heat Shields',
    ebayUsCategoryId: '33630',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Exhaust & Emission Systems > Heat Shields & Wraps',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Exhaust',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Exhaust',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-7',
    shopifyTaxonomySearch: 'Motor Vehicle Exhaust'
  },
  {
    match: /gas\s*tank|fuel\s*tank|fuel\s*gas\s*filler|fuel\s*filler|charcoal\s*canister/i,
    partType: 'Fuel Systems & Tanks',
    ebayUsCategoryId: '33556',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Air & Fuel Delivery > Fuel Tanks & Filler Necks',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Fuel Systems',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Fuel Systems',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-8',
    shopifyTaxonomySearch: 'Motor Vehicle Fuel Systems'
  },
  {
    match: /air\s*intake|intake\s*box|air\s*cleaner|maf\b/i,
    partType: 'Air Intake & Fuel Delivery',
    ebayUsCategoryId: '33659',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Air & Fuel Delivery > Air Intake Systems',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Air Intake',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Air Intake',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-23',
    shopifyTaxonomySearch: 'Motor Vehicle Air Intake'
  },
  {
    match: /\b(engine\s*assembly|long\s*block|short\s*block|cylinder\s*head|intake\s*manifold|throttle\s*body|fuel\s*(injection\s*)?rail|fuel\s*pump|injector|valve\s*cover|timing|turbo|supercharger|oil\s*pan|harmonic\s*balancer|crankshaft|camshaft|ignition\s*coil)\b/i,
    partType: 'Engines & Engine Components',
    ebayUsCategoryId: '33615',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Engines & Engine Parts > Complete Engines',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Engine Parts',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Engine Parts',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-6',
    shopifyTaxonomySearch: 'Motor Vehicle Engine Parts'
  },
  // Seats -> Motor Vehicle Seating (vp-1-4-15)
  {
    match: /\b(bucket\s*seat|front\s*seat|rear\s*seat|car\s*seats?|seat\s*backrest|seat\s*assembly|seat\s*cushion|bench\s*seat|bolster\s*cushions?)\b/i,
    partType: 'Interior Seats & Seating Assemblies',
    ebayUsCategoryId: '33701',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Interior Parts & Accessories > Seats',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Seating',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Seating',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-15',
    shopifyTaxonomySearch: 'Motor Vehicle Seating'
  },
  // Interior Trim, Door Panels, Consoles & Dash -> Motor Vehicle Interior Fittings (vp-1-4-11)
  {
    match: /door\s*(trim\s*)?panel|interior\s*door|seat|console|dash|trim\s*panel|pillar\s*trim|cloth\s*interior|air\s*vent|bezel|visor|headliner|carpet|steering\s*column\s*(upper\s*|lower\s*)?(cover|shroud)|shifter|glove\s*box|cup\s*holder|armrest/i,
    partType: 'Interior Trim & Door Panels',
    ebayUsCategoryId: '33701',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Interior Parts & Accessories > Door Panels',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Interior Fittings',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Interior Fittings',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-11',
    shopifyTaxonomySearch: 'Motor Vehicle Interior Fittings'
  },
  // Window Glass, Regulators & Wipers -> Motor Vehicle Window Parts & Accessories (vp-1-4-21)
  {
    match: /wiper|windshield\s*wiper|window\s*glass|quarter\s*window|door\s*window|window\s*regulator/i,
    partType: 'Window Glass, Regulators & Wipers',
    ebayUsCategoryId: '179850',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Exterior Parts & Accessories > Glass & Window Parts',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Window Parts & Accessories',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Window Parts & Accessories',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-21',
    shopifyTaxonomySearch: 'Motor Vehicle Window Parts & Accessories'
  },
  {
    match: /front\s*door|rear\s*door|passenger\s*door|driver\s*door/i,
    partType: 'Doors & Exterior Door Shells',
    ebayUsCategoryId: '33642',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Exterior Parts & Accessories > Doors & Door Skins',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Frame & Body Parts',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Frame & Body Parts',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-9',
    shopifyTaxonomySearch: 'Motor Vehicle Frame & Body Parts'
  },
  {
    match: /bumper|grille|fender|hood|liftgate|tailgate|trunk\s*lid|quarter\s*panel|rocker|latch|handle|liner|tow\s*hook|splash\s*guard|roof\s*(rack|rails?)/i,
    partType: 'Exterior Body Panels & Trim',
    ebayUsCategoryId: '33640',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Exterior Parts & Accessories > Bumpers & Reinforcements',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Frame & Body Parts',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Frame & Body Parts',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4-9',
    shopifyTaxonomySearch: 'Motor Vehicle Frame & Body Parts'
  }
];

const FALLBACK_TAXONOMY = {
  partType: 'Motor Vehicle Replacement Parts',
  ebayUsCategoryId: '6030',
  ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Other Car & Truck Parts & Accessories',
  googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts',
  shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts',
  shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-1-4',
  shopifyTaxonomySearch: 'Motor Vehicle Parts'
};

function sanitizeVerifiedMpn(rawMpn) {
  const s = String(rawMpn || '').trim();
  if (!s) return '';
  if (/^(does\s+not\s+apply|n\/a|none|unknown|unverified|generic|oem|null|undefined)$/i.test(s)) return '';
  // Reject random UUID/hex hash fragments like 1C33-4BDF-BC6B or DFCB433B-75DE
  if (/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/i.test(s) || /^[0-9A-F]{8}-[0-9A-F]{4}/i.test(s)) return '';
  // Reject fake Year-Make filename tokens like 2012-TOYOTA, 2003-SUBARU, 2015-FIAT-500, 1996-TOYOTA-CAMRY
  if (/^(19|20)\d{2}-[A-Z]+/i.test(s)) return '';
  if (/^ALD-/i.test(s)) return '';
  return s;
}

function resolveCountryOfOrigin(item = {}) {
  const blob = `${item?.title || ''} ${item?.brand || ''} ${item?.fitment_make || ''} ${item?.description || ''} ${item?.fitment_notes || ''}`.toLowerCase();
  if (/\bhungary\b|68073504aa|0\s*265\s*005\s*873/i.test(blob)) return 'HU';
  if (/\bmade in japan\b|\btoyota\b|\bsubaru\b|\bhonda\b|\bnissan\b|\bmazda\b|\bmitsubishi\b|\blexus\b|\bacura\b|\binfiniti\b|\bdenso\b|\baisin\b|\bpanasonic\b/i.test(blob)) return 'JP';
  if (/\bmagneti\s*marelli\b|\bitaly\b/i.test(blob)) return 'IT';
  if (/\bfiat\b/i.test(blob)) return 'MX'; // North American Fiat 500 Toluca assembly / OEM parts
  if (/\bchevrolet\b|\bchevy\b|\bford\b|\bgmc\b|\bdodge\b|\bchrysler\b|\bjeep\b|\bbuick\b|\bcadillac\b|\banco\b|\btrico\b|\brain-?x\b/i.test(blob)) return 'US';
  if (/\bvolkswagen\b|\bvw\b|\baudi\b|\bbmw\b|\bmercedes\b|\bporsche\b/i.test(blob)) return 'DE';
  if (/\bhyundai\b|\bkia\b/i.test(blob)) return 'KR';
  return 'US';
}

function resolvePartTaxonomyAndMetafields(item, settings = {}) {
  const titleText = String(item?.title || '');
  const fallbackText = `${item?.part_type || ''} ${item?.category || ''}`;
  const matched =
    TAXONOMY_RULES.find((r) => r.match.test(titleText)) ||
    TAXONOMY_RULES.find((r) => r.match.test(fallbackText)) ||
    FALLBACK_TAXONOMY;

  const weight = Number(item?.weight_lbs || 10);
  const threshold = Number(settings?.freight_weight_threshold_lbs || 70);
  const isLocalPickupOnly =
    weight >= threshold ||
    item?.shipping_class === 'local_pickup_only' ||
    item?.shipping_class === 'freight_ltl' ||
    item?.fulfillment_mode === 'local_pickup' ||
    item?.fulfillment_mode === 'local_pickup_only';

  const rawCond = String(item?.condition || 'Used').trim();
  const condNormalized = rawCond.toLowerCase() === 'new' ? 'new' : 'used';
  const brand = String(item?.brand || item?.fitment_make || 'OEM').trim().replace(/\bUniversal\b/gi, '').trim() || 'OEM';
  const mpn = sanitizeVerifiedMpn(item?.oem_part_number);
  const countryCodeOfOrigin = resolveCountryOfOrigin(item);

  const fitmentYears = String(item?.fitment_years || item?.fitment_year || '').replace(/Multi-Fit|Universal/gi, '').trim();
  const fitmentMake = String(item?.fitment_make || '').replace(/Universal\s*OEM|Universal/gi, '').trim();
  const fitmentModel = String(item?.fitment_model || '').replace(/Verify Size \/ Fitment/gi, '').trim();
  const secMark = item?.security_mark_code || item?.security_mark_id || '';

  const ymm = [fitmentYears, fitmentMake, fitmentModel]
    .filter(Boolean)
    .join(' ') || `${brand} ${matched.partType}`;

  const customLabel0 = ymm.slice(0, 100);
  const customLabel1 = isLocalPickupOnly ? 'Local_Pickup_98467' : 'Parcel_Ship';

  // Specific, searchable tags — never generic filler
  const seoTags = Array.from(
    new Set(
      [
        fitmentYears || null,
        fitmentMake || null,
        fitmentModel || null,
        matched.partType,
        mpn ? `MPN:${mpn}` : null,
        mpn || null,
        condNormalized === 'new' ? 'Condition:New' : 'Condition:Used',
        condNormalized === 'new' ? 'New OEM' : 'Used OEM',
        `Origin:${countryCodeOfOrigin}`,
        'Single-Variant-1-In-Stock',
        customLabel1,
        item?.bin_location ? `BIN:${item.bin_location}` : null,
        secMark ? `SEC:${secMark}` : null
      ].filter(Boolean)
    )
  );

  return {
    partType: matched.partType,
    ebayUsCategoryId: matched.ebayUsCategoryId,
    ebayUsCategoryName: matched.ebayUsCategoryName,
    googleProductCategory: matched.googleProductCategory,
    shopifyProductCategory: matched.shopifyProductCategory,
    shopifyTaxonomyId: matched.shopifyTaxonomyId,
    shopifyTaxonomySearch: matched.shopifyTaxonomySearch || matched.partType,
    countryCodeOfOrigin,
    brand,
    mpn,
    condition: condNormalized,
    identifierExists: Boolean(mpn),
    customLabel0,
    customLabel1,
    seoTags
  };
}

module.exports = {
  TAXONOMY_RULES,
  FALLBACK_TAXONOMY,
  sanitizeVerifiedMpn,
  resolveCountryOfOrigin,
  resolvePartTaxonomyAndMetafields
};
