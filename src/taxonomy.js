/**
 * Inter-Platform Automotive Taxonomy, Standard eBay US (ebay.com) Category Routing & Google Merchant Metafields
 *
 * Rules Enforced:
 * 1. Standard eBay US (ebay.com, SiteID=US) ONLY — NEVER eBay Motors (SiteID=eBayMotors).
 * 2. Zero Placeholders: Every part maps to an exact Shopify Standard Product Taxonomy category,
 *    exact multi-level Google Merchant Product Category, and exact Standard eBay US Category ID.
 * 3. Google Merchant & Cross-Channel Metafields:
 *    - brand, mpn, condition ('used' | 'new')
 *    - custom_label_0 = Year Make Model (or 'Universal OEM')
 *    - custom_label_1 = 'Local_Pickup_98467' vs 'Parcel_Ship'
 */

const TAXONOMY_RULES = [
  {
    match: /alternator|generator/i,
    partType: 'Alternators & Generators',
    ebayUsCategoryId: '177697',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Starters, Alternators, ECUs & Wiring > Alternators & Generators',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Electrical & Electronic Systems > Motor Vehicle Alternators',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Electrical & Electronic Systems > Motor Vehicle Alternators',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-4-1'
  },
  {
    match: /\bstarter\b/i,
    partType: 'Starter Motors',
    ebayUsCategoryId: '177699',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Starters, Alternators, ECUs & Wiring > Starters',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Electrical & Electronic Systems > Motor Vehicle Starter Motors',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Electrical & Electronic Systems > Motor Vehicle Starter Motors',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-4-2'
  },
  {
    match: /\b(ecm|ecu|pcm|tcm|bcm|module|computer|fuse\s*box|junction|relay|wiring|harness|amplifier|amp|radio|stereo|infotainment|navigation|display\s*screen|camera|sensor)\b/i,
    partType: 'ECUs, Modules & Automotive Electronics',
    ebayUsCategoryId: '33596',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Starters, Alternators, ECUs & Wiring > ECUs & Computer Modules',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Electrical & Electronic Systems',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Electrical & Electronic Systems',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-4'
  },
  {
    match: /cluster|speedometer|tachometer|gauge/i,
    partType: 'Instrument Clusters & Gauges',
    ebayUsCategoryId: '33675',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Interior Parts & Accessories > Gauges > Instrument Clusters',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor VehicleControls & Displays > Motor Vehicle Gauges & Instrument Clusters',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Interior Fittings',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-8'
  },
  {
    match: /headlight|headlamp|fog\s*light|corner\s*light/i,
    partType: 'Headlight & Front Lamp Assemblies',
    ebayUsCategoryId: '33710',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Lighting & Lamps > Headlight Assemblies',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Lighting > Motor Vehicle Headlights',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Lighting > Motor Vehicle Headlights',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-9-1'
  },
  {
    match: /tail\s*light|taillight|tail\s*lamp|brake\s*light|third\s*brake/i,
    partType: 'Tail Light Assemblies',
    ebayUsCategoryId: '33716',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Lighting & Lamps > Tail Light Assemblies',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Lighting > Motor Vehicle Tail & Brake Lights',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Lighting > Motor Vehicle Tail & Brake Lights',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-9-2'
  },
  {
    match: /mirror/i,
    partType: 'Exterior & Interior Mirrors',
    ebayUsCategoryId: '33649',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Exterior Parts & Accessories > Mirrors > Side View Mirrors',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Frame & Body Parts > Motor Vehicle Mirrors',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Frame & Body Parts > Motor Vehicle Mirrors',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-7-4'
  },
  {
    match: /caliper|rotor|brake|abs\s*pump|master\s*cylinder|booster/i,
    partType: 'Brakes & Brake Hydraulics',
    ebayUsCategoryId: '33563',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Brakes & Brake Parts > Calipers & Brackets',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Braking',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Braking',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-1'
  },
  {
    match: /strut|shock|control\s*arm|knuckle|spindle|sway\s*bar|subframe|steering\s*rack|power\s*steering|tie\s*rod|suspension/i,
    partType: 'Steering & Suspension Components',
    ebayUsCategoryId: '33590',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Steering & Suspension > Shocks, Struts & Assemblies',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Suspension Parts',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Suspension Parts',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-10'
  },
  {
    match: /compressor|condenser|evaporator|heater|blower|hvac|climate\s*control/i,
    partType: 'A/C & Climate Control',
    ebayUsCategoryId: '33543',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Air Conditioning & Heating > A/C Compressors & Clutches',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Climate Control',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Climate Control',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-2'
  },
  {
    match: /radiator|cooling\s*fan|fan\s*shroud|water\s*pump|thermostat|coolant|intercooler/i,
    partType: 'Engine Cooling Components',
    ebayUsCategoryId: '33602',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Engine Cooling Components > Radiators',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Cooling Systems',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Cooling Systems',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-3'
  },
  {
    match: /wheel|rim|tire|hubcap|center\s*cap/i,
    partType: 'Wheels, Tires & Hub Caps',
    ebayUsCategoryId: '179679',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Wheels, Tires & Parts > Wheels',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Wheel Systems',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Wheel Systems',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-12'
  },
  {
    match: /transmission|transfer\s*case|differential|axle|driveshaft|cv\s*joint|torque\s*converter/i,
    partType: 'Transmission & Drivetrain',
    ebayUsCategoryId: '171115',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Transmission & Drivetrain > Automatic Transmission',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Transmission & Drivetrain Parts',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Transmission & Drivetrain Parts',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-11'
  },
  {
    match: /\b(engine\s*assembly|long\s*block|short\s*block|cylinder\s*head|intake\s*manifold|throttle\s*body|fuel\s*pump|injector|valve\s*cover|timing|turbo|supercharger|oil\s*pan)\b/i,
    partType: 'Engines & Engine Components',
    ebayUsCategoryId: '33615',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Engines & Engine Parts > Complete Engines',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Engine Parts',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Engine Parts',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-5'
  },
  {
    match: /bumper|grille|fender|hood|door|liftgate|tailgate|trunk\s*lid|quarter\s*panel|rocker|wiper|window\s*regulator|latch|handle/i,
    partType: 'Exterior Body Panels & Trim',
    ebayUsCategoryId: '33640',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Exterior Parts & Accessories > Bumpers & Reinforcements',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Frame & Body Parts',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Frame & Body Parts',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-7'
  },
  {
    match: /seat|console|dash|trim|visor|headliner|carpet|door\s*panel|steering\s*wheel|shifter|glove\s*box/i,
    partType: 'Interior Trim, Seats & Consoles',
    ebayUsCategoryId: '33701',
    ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Interior Parts & Accessories > Seats, Parts & Accessories',
    googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Interior Fittings',
    shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Interior Fittings',
    shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5-8'
  }
];

const FALLBACK_TAXONOMY = {
  partType: 'OEM Auto Replacement Parts',
  ebayUsCategoryId: '6030',
  ebayUsCategoryName: 'eBay US > Parts & Accessories > Car & Truck Parts & Accessories > Other Car & Truck Parts & Accessories',
  googleProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts',
  shopifyProductCategory: 'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts',
  shopifyTaxonomyId: 'gid://shopify/TaxonomyCategory/vp-2-5'
};

function resolvePartTaxonomyAndMetafields(item, settings = {}) {
  const haystack = `${item?.title || ''} ${item?.part_type || ''} ${item?.category || ''} ${item?.description || ''}`;
  const matched = TAXONOMY_RULES.find((r) => r.match.test(haystack)) || FALLBACK_TAXONOMY;

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
  const brand = String(item?.brand || item?.fitment_make || 'OEM').trim() || 'OEM';
  const rawMpn = String(item?.oem_part_number || '').trim();
  const mpn = !rawMpn || /^does\s+not\s+apply$/i.test(rawMpn) ? 'Does Not Apply' : rawMpn;

  const fitmentYears = item?.fitment_years || item?.fitment_year || '';
  const secMark = item?.security_mark_code || item?.security_mark_id || '';

  const ymm = [fitmentYears, item?.fitment_make, item?.fitment_model]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ') || `${brand} OEM Fitment`;

  const customLabel0 = ymm.slice(0, 100);
  const customLabel1 = isLocalPickupOnly ? 'Local_Pickup_98467' : 'Parcel_Ship';

  const cleanMakeSlug = String(item?.fitment_make || '').replace(/[^A-Za-z0-9]/g, '');
  const cleanModelSlug = String(item?.fitment_model || '').replace(/[^A-Za-z0-9]/g, '');
  const hashtags = [
    '#OEMAutoParts',
    '#TestedOEM',
    '#TacomaAutoParts',
    '#UniversityPlaceWA',
    cleanMakeSlug ? `#${cleanMakeSlug}Parts` : null,
    cleanMakeSlug && cleanModelSlug ? `#${cleanMakeSlug}${cleanModelSlug}` : null
  ].filter(Boolean);

  const seoTags = [
    fitmentYears,
    item?.fitment_make,
    item?.fitment_model,
    matched.partType,
    mpn !== 'Does Not Apply' ? `OEM:${mpn}` : 'MPN:Does Not Apply',
    `Condition:${condNormalized === 'new' ? 'New' : 'Used'}`,
    'Single-Variant-1-In-Stock',
    'Crosslist-OfferUp-FB-Ready',
    customLabel1,
    'Returns Not Accepted - Defect Only',
    item?.bin_location ? `BIN:${item.bin_location}` : null,
    secMark ? `SEC:${secMark}` : null
  ].filter(Boolean);

  return {
    ebaySiteId: 'US', // STRICT: ebay.com US ONLY — NEVER eBayMotors
    ebayUsCategoryId: matched.ebayUsCategoryId,
    ebayUsCategoryName: matched.ebayUsCategoryName,
    googleProductCategory: matched.googleProductCategory,
    shopifyProductCategory: matched.shopifyProductCategory,
    shopifyTaxonomyId: matched.shopifyTaxonomyId,
    partType: matched.partType,
    brand,
    mpn,
    condition: condNormalized,
    identifierExists: mpn !== 'Does Not Apply',
    customLabel0,
    customLabel1,
    seoTags,
    hashtags
  };
}

module.exports = {
  TAXONOMY_RULES,
  FALLBACK_TAXONOMY,
  resolvePartTaxonomyAndMetafields
};
