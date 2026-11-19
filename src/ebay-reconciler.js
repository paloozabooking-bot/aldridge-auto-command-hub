const fs = require('fs');
const path = require('path');
const { parseCsv, csvEscape: csvEscapeCell } = require('./exporters-csv-utils');
const { isCounterfeitMpn } = require('./audit-sanitizer');

// Normalize directional & positional flags for strict conflict vetoing
function extractPositionProfile(rawTitle) {
  const t = String(rawTitle || '').toLowerCase();
  const hasFront = /\b(front|frt|windshield|hood|headlight|fog\s*light|fender\s*apron)\b/.test(t) && !/\brear\s+wiper\b/.test(t);
  const hasRear = /\b(rear|tail\s*light|tailgate|liftgate|hatch|cargo|trunk|third\s*row|3rd\s*row|second\s*row|2nd\s*row|back\s*door)\b/.test(t);
  const hasLeft = /\b(left|lh|driver|driver's|drv)\b/.test(t) && !/\b(left\s*(and|&|\/)?\s*right|lh\s*(and|&|\/)?\s*rh|pair|set)\b/.test(t);
  const hasRight = /\b(right|rh|passenger|pass)\b/.test(t) && !/\b(left\s*(and|&|\/)?\s*right|lh\s*(and|&|\/)?\s*rh|pair|set)\b/.test(t);
  const hasUpper = /\bupper\b/.test(t) && !/\blower\b/.test(t);
  const hasLower = /\blower\b/.test(t) && !/\bupper\b/.test(t);
  const has2ndRow = /\b(2nd\s*row|second\s*row)\b/.test(t);
  const has3rdRow = /\b(3rd\s*row|third\s*row|jump\s*seat)\b/.test(t);

  return { hasFront, hasRear, hasLeft, hasRight, hasUpper, hasLower, has2ndRow, has3rdRow };
}

function hasPositionConflict(a, b) {
  if (a.hasFront && b.hasRear && !a.hasRear && !b.hasFront) return true;
  if (a.hasRear && b.hasFront && !a.hasFront && !b.hasRear) return true;
  if (a.hasLeft && b.hasRight && !a.hasRight && !b.hasLeft) return true;
  if (a.hasRight && b.hasLeft && !a.hasLeft && !b.hasRight) return true;
  if (a.hasUpper && b.hasLower) return true;
  if (a.hasLower && b.hasUpper) return true;
  if (a.has2ndRow && b.has3rdRow) return true;
  if (a.has3rdRow && b.has2ndRow) return true;
  return false;
}

const STOP_WORDS = new Set([
  '2003', '2004', '2005', '2006', '2007', '2008', '2009', '03', '04', '05', '06', '07', '08', '09',
  '03-09', '2003-2009', '2004-2009', 'toyota', '4runner', 'sr5', 'limited', 'sport', '4x4', '4wd',
  '2wd', 'v6', '4', '0l', '4.0l', '1gr-fe', '1grfe', 'oem', 'oe', 'genuine', 'factory', 'used',
  'assy', 'assembly', 'part', 'parts', 'vehicle', 'car', 'truck', 'suv', 'black', 'gray', 'grey',
  'dark', 'silver', 'charcoal', 'tan', 'cloth', 'leather', 'plastic', 'metal', 'with', 'and', 'for',
  'the', 'side', 'complete', 'set', 'pair', 'left', 'right', 'lh', 'rh', 'driver', 'drivers',
  'passenger', 'front', 'rear', 'upper', 'lower', 'inner', 'outer'
]);

const SYNONYM_MAP = {
  lamp: 'light',
  lamps: 'light',
  lights: 'light',
  taillight: 'taillight',
  headlamp: 'headlight',
  fogs: 'fog',
  shock: 'strut',
  shocks: 'strut',
  struts: 'strut',
  ecu: 'module',
  ecm: 'module',
  pcm: 'module',
  bcm: 'module',
  computer: 'module',
  unit: 'module',
  controller: 'module',
  tank: 'reservoir',
  jug: 'reservoir',
  bottle: 'reservoir',
  underbody: 'skid',
  undercarriage: 'skid',
  splash: 'liner',
  shield: 'plate',
  garnish: 'trim',
  molding: 'trim',
  moulding: 'trim',
  bezel: 'trim',
  cover: 'trim',
  panel: 'panel',
  panels: 'panel',
  propeller: 'drive',
  driveshaft: 'driveshaft',
  propshaft: 'driveshaft',
  trans: 'transmission',
  tranny: 'transmission',
  gearbox: 'transmission',
  calipers: 'caliper',
  rotors: 'rotor',
  mirrors: 'mirror',
  visors: 'visor',
  handles: 'handle',
  switches: 'switch',
  speakers: 'speaker',
  mats: 'mat',
  seats: 'seat'
};

function extractCoreTokens(rawTitle) {
  let t = String(rawTitle || '')
    .toLowerCase()
    .replace(/\btail\s+light\b/g, 'taillight')
    .replace(/\bhead\s+light\b/g, 'headlight')
    .replace(/\bdrive\s+shaft\b/g, 'driveshaft')
    .replace(/\bsun\s+visor\b/g, 'sunvisor')
    .replace(/\brunning\s+board\b/g, 'runningboard')
    .replace(/\btransfer\s+case\b/g, 'transfercase')
    .replace(/\bsteering\s+rack\b/g, 'steeringrack')
    .replace(/\brack\s+and\s+pinion\b/g, 'steeringrack')
    .replace(/\bwindow\s+regulator\b/g, 'windowregulator')
    .replace(/\bdoor\s+panel\b/g, 'doorpanel')
    .replace(/\bdoor\s+trim\b/g, 'doorpanel')
    .replace(/\bquarter\s+glass\b/g, 'quarterglass')
    .replace(/\bskid\s+plate\b/g, 'skidplate')
    .replace(/\bunder\s+cover\b/g, 'skidplate')
    .replace(/\bfender\s+liner\b/g, 'fenderliner')
    .replace(/\bfuel\s+door\b/g, 'fueldoor')
    .replace(/\bglove\s+box\b/g, 'glovebox')
    .replace(/\bwiring\s+harness\b/g, 'wiringharness')
    .replace(/\bblower\s+motor\b/g, 'blowermotor')
    .replace(/\bclimate\s+control\b/g, 'climatecontrol')
    .replace(/\babs\s+pump\b/g, 'abspump')
    .replace(/\bbrake\s+booster\b/g, 'abspump')
    .replace(/\bmaster\s+cylinder\b/g, 'abspump')
    .replace(/\bgrab\s+handle\b/g, 'grabhandle')
    .replace(/\bscuff\s+plate\b/g, 'scuffplate')
    .replace(/\bsill\s+plate\b/g, 'scuffplate')
    .replace(/\bfoot\s+rest\b/g, 'footrest')
    .replace(/[^a-z0-9\s-]/g, ' ');

  const rawWords = t.split(/\s+/).filter(Boolean);
  const tokens = new Set();
  for (const w of rawWords) {
    if (STOP_WORDS.has(w)) continue;
    if (/^\d{4,6}-\d{4,6}[a-z0-9-]*$/i.test(w)) continue; // strip inline MPN from tokens
    if (w.length < 3 && w !== 'ac') continue;
    const mapped = SYNONYM_MAP[w] || w;
    if (!STOP_WORDS.has(mapped)) tokens.add(mapped);
  }
  return tokens;
}

// Guard against matching sub-parts/trim/harnesses to complete major assemblies
function hasPartCategoryConflict(titleA, titleB) {
  const a = titleA.toLowerCase();
  const b = titleB.toLowerCase();

  const aDoorCard = /\b(door\s*(trim|panel|card|molding|moulding)|interior\s*door|side\s*molding)\b/.test(a);
  const bDoorCard = /\b(door\s*(trim|panel|card|molding|moulding)|interior\s*door|side\s*molding)\b/.test(b);
  const aFullDoor = /\bdoor\b/.test(a) && !aDoorCard && !/\b(glass|window|actuator|latch|lock|handle|mirror|check|sensor|seal|weatherstrip|molding|moulding|speaker|harness|fuel)\b/.test(a);
  const bFullDoor = /\bdoor\b/.test(b) && !bDoorCard && !/\b(glass|window|actuator|latch|lock|handle|mirror|check|sensor|seal|weatherstrip|molding|moulding|speaker|harness|fuel)\b/.test(b);
  if ((aDoorCard && bFullDoor) || (bDoorCard && aFullDoor)) return true;
  if ((aFullDoor && /\b(weatherstrip|seal|molding|moulding)\b/.test(b)) || (bFullDoor && /\b(weatherstrip|seal|molding|moulding)\b/.test(a))) return true;

  // Hood vs Hood Latch / Release Lever / Hinge / Strut / Seal
  const aHoodSub = /\bhood\b.*\b(release|lever|cable|latch|hinge|strut|shock|prop|seal|insulation|scoop|molding)\b/.test(a);
  const bHoodSub = /\bhood\b.*\b(release|lever|cable|latch|hinge|strut|shock|prop|seal|insulation|scoop|molding)\b/.test(b);
  const aFullHood = /\bhood\b/.test(a) && !aHoodSub;
  const bFullHood = /\bhood\b/.test(b) && !bHoodSub;
  if ((aFullHood && bHoodSub) || (bFullHood && aHoodSub)) return true;

  // Radiator vs Sight Shield / Cover / Cap / Hose / Overflow
  const aRadSub = /\bradiator\b.*\b(sight\s*shield|cover|trim|cap|hose|support\s*bracket)\b/.test(a);
  const bRadSub = /\bradiator\b.*\b(sight\s*shield|cover|trim|cap|hose|support\s*bracket)\b/.test(b);
  const aFullRad = /\bradiator\b/.test(a) && !aRadSub && !/\b(fan|shroud)\b/.test(a);
  const bFullRad = /\bradiator\b/.test(b) && !bRadSub && !/\b(fan|shroud)\b/.test(b);
  if ((aFullRad && bRadSub) || (bFullRad && aRadSub)) return true;

  // Wiring Harness / Loom vs Non-Harness Panel/Trim
  const aHarness = /\b(wiring|wire\s*harness|harness|loom)\b/.test(a);
  const bHarness = /\b(wiring|wire\s*harness|harness|loom)\b/.test(b);
  if (aHarness !== bHarness) return true;

  // Fender Apron vs Drivetrain / Rocker vs Cargo Interior
  if ((/\bfender\s*apron\b/.test(a) && /\bdrivetrain\b/.test(b)) || (/\bfender\s*apron\b/.test(b) && /\bdrivetrain\b/.test(a))) return true;
  if ((/\brocker\s*panel\b/.test(a) && /\bcargo\b/.test(b)) || (/\brocker\s*panel\b/.test(b) && /\bcargo\b/.test(a))) return true;

  const aSeat = /\bseat\b/.test(a) && !/\b(belt|switch|track|bracket|trim|cover\s+panel|step\s+plate|scuff)\b/.test(a);
  const bSeat = /\bseat\b/.test(b) && !/\b(belt|switch|track|bracket|trim|cover\s+panel|step\s+plate|scuff)\b/.test(b);
  if (aSeat !== bSeat) return true;

  const aTrans = /\b(automatic\s+transmission|transmission\s+assembly|a340f|a750f)\b/.test(a) && !/\b(shifter|mount|pan|cooler|line|cable|module|ecu|crossmember)\b/.test(a);
  const bTrans = /\b(automatic\s+transmission|transmission\s+assembly|a340f|a750f)\b/.test(b) && !/\b(shifter|mount|pan|cooler|line|cable|module|ecu|crossmember)\b/.test(b);
  if (aTrans !== bTrans) return true;

  return false;
}

function computeSimilarity(ebayRow, sanRow) {
  if (!/2004\s+Toyota\s+4Runner/i.test(sanRow.title)) return 0;
  if (!/4Runner/i.test(ebayRow.title)) return 0;

  if (hasPositionConflict(ebayRow.pos, sanRow.pos)) return 0;
  if (hasPartCategoryConflict(ebayRow.title, sanRow.title)) return 0;

  const setA = ebayRow.tokens;
  const setB = sanRow.tokens;
  if (!setA.size || !setB.size) return 0;

  let inter = 0;
  for (const tok of setA) {
    if (setB.has(tok)) inter++;
  }
  if (inter === 0) return 0;

  const union = setA.size + setB.size - inter;
  const jaccard = inter / union;
  const containment = inter / Math.min(setA.size, setB.size);

  // Positional agreement bonus
  let posBonus = 0;
  if ((ebayRow.pos.hasFront && sanRow.pos.hasFront) || (ebayRow.pos.hasRear && sanRow.pos.hasRear)) posBonus += 0.08;
  if ((ebayRow.pos.hasLeft && sanRow.pos.hasLeft) || (ebayRow.pos.hasRight && sanRow.pos.hasRight)) posBonus += 0.08;

  // Price proximity bonus
  const pA = ebayRow.price || 0;
  const pB = sanRow.price || 0;
  let priceBonus = 0;
  if (pA > 0 && pB > 0) {
    const ratio = Math.min(pA, pB) / Math.max(pA, pB);
    if (ratio >= 0.65) priceBonus = 0.06;
  }

  return Number((jaccard * 0.55 + containment * 0.45 + posBonus + priceBonus).toFixed(3));
}

function inferMotorsLeafCategory(title) {
  const t = String(title || '').toLowerCase();
  if (/\balternator\b/.test(t)) return 'Alternators & Generators (177697)';
  if (/\bstarter\b/.test(t)) return 'Starters (177699)';
  if (/\b(ecu|ecm|pcm|bcm|immobilizer|control\s+module|control\s+unit|computer|amplifier)\b/.test(t)) return 'ECUs & Computer Modules (33596)';
  if (/\binstrument\s+cluster|speedometer|gauge\b/.test(t)) return 'Instrument Clusters (33675)';
  if (/\btail\s*light|taillight\b/.test(t)) return 'Tail Light Assemblies (33716)';
  if (/\bhead\s*light|headlight\b/.test(t)) return 'Headlight Assemblies (33710)';
  if (/\bfog\s*light|driving\s*lamp\b/.test(t)) return 'Fog Light Assemblies (33709)';
  if (/\bmirror\b/.test(t)) return 'Mirror Assemblies (33649)';
  if (/\bclimate\s+control|heater\s+control|ac\s+control|hvac\b/.test(t)) return 'HVAC Controls & Control Units (33545)';
  if (/\bblower\s+motor\b/.test(t)) return 'HVAC Blower Motors & Wheels (33546)';
  if (/\bswitch\b/.test(t)) return 'Switches & Controls (33691)';
  if (/\bwiring\s+harness|loom|fuse\s+box\b/.test(t)) return 'Wiring Harnesses, Cables & Connectors (33728)';
  if (/\bdoor\s*(panel|trim|card)\b/.test(t)) return 'Door Panels (33696)';
  if (/\bdoor\b/.test(t) && !/\b(glass|window|handle|latch|lock|actuator|fuel)\b/.test(t)) return 'Doors & Door Skins (179851)';
  if (/\bglass|window\b/.test(t) && !/\b(regulator|motor|switch)\b/.test(t)) return 'Auto Glass (33684)';
  if (/\bwindow\s+regulator|window\s+motor\b/.test(t)) return 'Window Motors & Regulators (33706)';
  if (/\bsteering\s+rack|rack\s+and\s+pinion|steering\s+column|steering\s+shaft\b/.test(t)) return 'Steering Racks & Gear Boxes (33589)';
  if (/\bstrut|shock|coil\s+spring|control\s+arm|knuckle|spindle\b/.test(t)) return 'Shocks, Struts & Assemblies (33590)';
  if (/\bdrive\s*shaft|driveshaft|prop\s*shaft|cv\s*axle\b/.test(t)) return 'Driveshafts & Parts (33729)';
  if (/\btransmission|transfer\s+case\b/.test(t)) return 'Automatic Transmission & Parts (171115)';
  if (/\bbrake|caliper|rotor|abs\b/.test(t)) return 'ABS & Stability Hydraulic Units (33560)';
  if (/\bradiator|cooling\s+fan|fan\s+clutch|shroud|coolant\b/.test(t)) return 'Fans & Kits (33600)';
  if (/\bair\s+filter|intake|throttle\s+body|manifold\b/.test(t)) return 'Air Intake & Fuel Delivery (33558)';
  if (/\bmuffler|exhaust\b/.test(t)) return 'Mufflers & Resonators (33636)';
  if (/\bbumper|fender|hood|grille|running\s+board|roof\s+rack|skid\s+plate\b/.test(t)) return 'Exterior Parts & Accessories (33637)';
  if (/\bseat\b/.test(t)) return 'Seats (33701)';
  return 'Interior Parts & Accessories (33694)';
}

function isProhibitedSrsOrCat(title, bodyHtml) {
  const t = String(title || '');
  const plainBody = String(bodyHtml || '').replace(/<[^>]+>/g, ' ');
  if (/\b(airbag|air\s*bag|srs|clock\s*spring|clockspring|spiral\s*cable|seat\s*belt|seatbelt|pretensioner|catalytic\s*converter|inflatable\s*restraint)\b/i.test(t)) {
    return true;
  }
  if (/\b(driver\s+airbag|passenger\s+airbag|curtain\s+airbag|srs\s+airbag|pyrotechnic|catalytic\s*converter)\b/i.test(plainBody)) {
    return true;
  }
  return false;
}

function isConfirmedSold2004FourRunner(title) {
  const t = String(title || '').toLowerCase();
  if (!/4runner/.test(t)) return false;
  // Confirmed SOLD on 2004 4Runner (Operational Audit Section 2.B):
  // 1) Front seats (driver & passenger bucket/power cloth seats)
  if (/\b(front\s+(left|right|driver|passenger|bucket|cloth|power).*seat|driver\s+side.*seat|passenger\s+side.*seat|front\s+bucket\s+seat)\b/.test(t) && !/\b(belt|switch|track\s+cover|bolt|trim\s+cap|2nd\s+row|3rd\s+row|rear)\b/.test(t)) {
    return 'Confirmed SOLD 2004 4Runner Front Seat (Audit Sec 2.B)';
  }
  // 2) Overhead Consoles (2x Overhead Consoles confirmed SOLD)
  if (/\boverhead\s+(console|map\s*light|sunglass|dome\s*light\s*console)\b/.test(t)) {
    return 'Confirmed SOLD 2004 4Runner Overhead Console (Audit Sec 2.B)';
  }
  // 3) Rear Sway Bar & Torque Converter confirmed SOLD
  if (/\brear\s+(sway\s*bar|stabilizer\s*bar)\b/.test(t) || /\bsway\s*bar\b/.test(t)) {
    return 'Confirmed SOLD 2004 4Runner Sway Bar (Audit Sec 2.B)';
  }
  if (/\btorque\s+converter\b/.test(t)) {
    return 'Confirmed SOLD 2004 4Runner Torque Converter (Audit Sec 2.B)';
  }
  return null;
}

function cleanRealOcrMpn(rawMpn) {
  const m = String(rawMpn || '').trim();
  if (!m || /^does\s+not\s+apply$/i.test(m) || /^n\/?a$/i.test(m) || /^unknown$/i.test(m)) return '';
  if (isCounterfeitMpn(m)) return '';
  return m;
}

function generateEbay418Reconciliation({
  ebayCsvText,
  may1CsvText,
  sanitizedShopifyCsvText
}) {
  const ebayRows = parseCsv(ebayCsvText);
  const may1Rows = parseCsv(may1CsvText);
  const sanRows = parseCsv(sanitizedShopifyCsvText);

  // Index May 1 Gen-1 export by Variant SKU + collect all CDN images per Handle
  const mayBySku = new Map();
  const mayImagesByHandle = new Map();
  for (const r of may1Rows) {
    const h = (r.Handle || '').trim();
    const sku = (r['Variant SKU'] || '').trim();
    const img = (r['Image Src'] || '').trim();
    if (sku) mayBySku.set(sku, r);
    if (h && img) {
      if (!mayImagesByHandle.has(h)) mayImagesByHandle.set(h, []);
      mayImagesByHandle.get(h).push(img);
    }
  }

  // Index Sanitized Aug 4 catalog (905 active + 19 draft + 107 archived)
  const sanItems = [];
  const sanImagesByHandle = new Map();
  for (const r of sanRows) {
    const h = (r.Handle || '').trim();
    const img = (r['Image Src'] || '').trim();
    if (h && img) {
      if (!sanImagesByHandle.has(h)) sanImagesByHandle.set(h, []);
      sanImagesByHandle.get(h).push(img);
    }
  }
  for (const r of sanRows) {
    if (r.Title && r['Variant SKU']) {
      const h = (r.Handle || '').trim();
      const title = r.Title.trim();
      const grams = Number(r['Variant Grams'] || 0);
      sanItems.push({
        sku: r['Variant SKU'].trim(),
        handle: h,
        title,
        status: (r.Status || '').trim(),
        price: Number(r['Variant Price'] || 0),
        weightLbs: Number((grams / 453.592).toFixed(1)),
        requiresShipping: (r['Variant Requires Shipping'] || '').trim() === 'true',
        images: sanImagesByHandle.get(h) || [],
        pos: extractPositionProfile(title),
        tokens: extractCoreTokens(title)
      });
    }
  }

  const sanActive4R = sanItems.filter((x) => x.status === 'active' && /2004\s+Toyota\s+4Runner/i.test(x.title));
  const sanNonActive4R = sanItems.filter((x) => x.status !== 'active' && /2004\s+Toyota\s+4Runner/i.test(x.title));

  // Prepare enriched 418 eBay records
  const enrichedEbay = ebayRows.map((e, idx) => {
    const legacySku = (e['Custom label (SKU)'] || '').trim();
    const itemNumber = (e['Item number'] || '').trim();
    const title = (e.Title || '').trim();
    const price = Number(e['Current price'] || e['Start price'] || 0);
    const watchers = Number(e.Watchers || 0);
    const soldQty = Number(e['Sold quantity'] || 0);
    const startDate = (e['Start date'] || '').trim();
    const catName = (e['eBay category 1 name'] || 'Other').trim();
    const catNum = (e['eBay category 1 number'] || '6755').trim();

    const mayRec = mayBySku.get(legacySku) || null;
    const mayHandle = mayRec ? (mayRec.Handle || '').trim() : '';
    const mayImages = mayHandle ? (mayImagesByHandle.get(mayHandle) || []) : [];
    const realOcrMpn = mayRec ? cleanRealOcrMpn(mayRec['Google Shopping / MPN']) : '';
    const mayWeightLbs = mayRec ? Number((Number(mayRec['Variant Grams'] || 0) / 453.592).toFixed(1)) : 0;
    const mayBodyHtml = mayRec ? (mayRec['Body (HTML)'] || '') : '';

    const prohibited = isProhibitedSrsOrCat(title, mayBodyHtml);
    const soldReason = !prohibited ? isConfirmedSold2004FourRunner(title) : null;

    return {
      rowNo: idx + 1,
      itemNumber,
      legacySku,
      title,
      price,
      watchers,
      soldQty,
      startDate,
      legacyCategory: `${catName} (${catNum})`,
      realOcrMpn,
      mayPrimaryImage: mayImages[0] || '',
      mayAllImages: mayImages,
      mayWeightLbs,
      prohibited,
      soldReason,
      pos: extractPositionProfile(title),
      tokens: extractCoreTokens(title),
      classification: '',
      recommendedAction: '',
      matchedCleanSku: '',
      matchedCleanTitle: '',
      matchedCleanStatus: '',
      matchedCleanPrice: '',
      matchedCleanWeightLbs: '',
      matchedCleanImage: '',
      matchScore: 0,
      duplicateOfItem: ''
    };
  });

  // Step 1: Flag Prohibited SRS/Cat & Confirmed SOLD items first
  const eligibleIndices = [];
  for (let i = 0; i < enrichedEbay.length; i++) {
    const rec = enrichedEbay[i];
    if (rec.prohibited) {
      rec.classification = 'CRITICAL_END_PROHIBITED_SRS_OR_CAT';
      rec.recommendedAction = 'END IMMEDIATELY — Prohibited SRS / Airbag / Seatbelt / Clockspring Violation (Never Relist)';
    } else if (rec.soldReason) {
      rec.classification = 'CRITICAL_END_CONFIRMED_SOLD';
      rec.recommendedAction = `END IMMEDIATELY — ${rec.soldReason}`;
    } else if (!/4Runner/i.test(rec.title)) {
      rec.classification = 'STRANDED_NON_4RUNNER_GEN1_PART';
      rec.recommendedAction = 'END Other-6755 Orphan & Re-Import Cleanly into Shopify Phase 4 (Standalone Nissan VQ35DE Part)';
      rec.matchedCleanStatus = 'not_in_aug04_905';
    } else {
      eligibleIndices.push(i);
    }
  }

  // Step 2: Score all candidate pairs between eligible 4Runner eBay items and the 143 Clean Active 4Runner SKUs
  const candidatePairs = [];
  for (const eIdx of eligibleIndices) {
    const eRec = enrichedEbay[eIdx];
    for (let sIdx = 0; sIdx < sanActive4R.length; sIdx++) {
      const sRec = sanActive4R[sIdx];
      const score = computeSimilarity(eRec, sRec);
      if (score >= 0.56) {
        candidatePairs.push({ eIdx, sIdx, score });
      }
    }
  }

  // Sort candidate pairs highest score first (preferring watched eBay items on ties)
  candidatePairs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return enrichedEbay[b.eIdx].watchers - enrichedEbay[a.eIdx].watchers;
  });

  const assignedEbay = new Set();
  const assignedSanActive = new Map(); // sIdx -> winning eIdx

  for (const pair of candidatePairs) {
    if (assignedEbay.has(pair.eIdx)) continue;
    if (!assignedSanActive.has(pair.sIdx)) {
      // Primary 1-to-1 match to Clean Active 905 SKU!
      assignedEbay.add(pair.eIdx);
      assignedSanActive.set(pair.sIdx, pair.eIdx);
      const eRec = enrichedEbay[pair.eIdx];
      const sRec = sanActive4R[pair.sIdx];

      eRec.matchedCleanSku = sRec.sku;
      eRec.matchedCleanTitle = sRec.title;
      eRec.matchedCleanStatus = 'active_in_905';
      eRec.matchedCleanPrice = sRec.price.toFixed(2);
      eRec.matchedCleanWeightLbs = String(sRec.weightLbs);
      eRec.matchedCleanImage = sRec.images[0] || '';
      eRec.matchScore = pair.score;

      if (eRec.watchers > 0) {
        eRec.classification = 'MATCHED_CLEAN_905_ACTIVE__HAS_WATCHER';
        eRec.recommendedAction = `END Other-6755 & Relist ${sRec.sku} in Motors Category (OR Optional: Edit Custom Label -> ${sRec.sku} to keep ${eRec.watchers} watcher)`;
      } else {
        eRec.classification = 'MATCHED_CLEAN_905_ACTIVE';
        eRec.recommendedAction = `END Other-6755 Orphan -> Relist Clean SKU ${sRec.sku} via Shopify Marketplace Connect`;
      }
    } else if (pair.score >= 0.72) {
      // High-similarity secondary Gen-1 duplicate of an already-matched Clean Active 905 SKU
      assignedEbay.add(pair.eIdx);
      const primaryEbay = enrichedEbay[assignedSanActive.get(pair.sIdx)];
      const eRec = enrichedEbay[pair.eIdx];
      const sRec = sanActive4R[pair.sIdx];

      eRec.classification = 'END_GEN1_DUPLICATE_MULTI_SKU';
      eRec.duplicateOfItem = primaryEbay.itemNumber;
      eRec.matchedCleanSku = sRec.sku;
      eRec.matchedCleanTitle = sRec.title;
      eRec.matchedCleanStatus = 'duplicate_of_active_905';
      eRec.matchedCleanPrice = sRec.price.toFixed(2);
      eRec.matchedCleanWeightLbs = String(sRec.weightLbs);
      eRec.matchedCleanImage = sRec.images[0] || '';
      eRec.matchScore = pair.score;
      eRec.recommendedAction = `END IMMEDIATELY — Gen-1 Duplicate of eBay #${primaryEbay.itemNumber} (Collapsed into Clean SKU ${sRec.sku})`;
    }
  }

  // Step 3: Check remaining unassigned eligible items against Aug 4 Draft/Archived 2004 4Runner SKUs, or Deduplicate Stranded May 1 Pool
  const strandedSeenSignatures = new Map(); // canonical signature -> winning itemNumber

  for (const eIdx of eligibleIndices) {
    if (assignedEbay.has(eIdx)) continue;
    const eRec = enrichedEbay[eIdx];

    // Check against Draft/Archived Aug 4 4Runner items
    let bestNonActive = null;
    let bestNonActiveScore = 0;
    for (const na of sanNonActive4R) {
      const sc = computeSimilarity(eRec, na);
      if (sc > bestNonActiveScore) {
        bestNonActiveScore = sc;
        bestNonActive = na;
      }
    }

    if (bestNonActive && bestNonActiveScore >= 0.62) {
      eRec.matchedCleanSku = bestNonActive.sku;
      eRec.matchedCleanTitle = bestNonActive.title;
      eRec.matchedCleanStatus = `${bestNonActive.status}_in_aug04`;
      eRec.matchedCleanPrice = bestNonActive.price.toFixed(2);
      eRec.matchedCleanWeightLbs = String(bestNonActive.weightLbs);
      eRec.matchedCleanImage = bestNonActive.images[0] || '';
      eRec.matchScore = bestNonActiveScore;
      eRec.classification = bestNonActive.status === 'draft'
        ? 'MATCHED_AUG04_DRAFT_HOLD'
        : 'MATCHED_AUG04_ARCHIVED';
      eRec.recommendedAction = bestNonActive.status === 'draft'
        ? `END Other-6755 — Held in Shopify Draft (${bestNonActive.sku}) Pending Trim-Module Photo Review`
        : `END IMMEDIATELY — Archived Duplicate / Non-Sellable in Clean Catalog (${bestNonActive.sku})`;
      continue;
    }

    // Otherwise this is one of the ~275 Stranded May 1 CDN-illustrated 2004 4Runner parts!
    // Check if another stranded May 1 item has the exact same MPN or near-identical token+position signature
    const posKey = [
      eRec.pos.hasFront ? 'F' : '',
      eRec.pos.hasRear ? 'R' : '',
      eRec.pos.hasLeft ? 'L' : '',
      eRec.pos.hasRight ? 'P' : '',
      eRec.pos.hasUpper ? 'U' : '',
      eRec.pos.hasLower ? 'D' : ''
    ].join('');
    const sortedToks = Array.from(eRec.tokens).sort().join('_');
    const mpnKey = eRec.realOcrMpn ? `MPN:${eRec.realOcrMpn.split(',')[0].trim()}` : '';
    const sig = mpnKey || (sortedToks.length >= 8 ? `TOK:${posKey}:${sortedToks}` : '');

    if (sig && strandedSeenSignatures.has(sig)) {
      const primaryItem = strandedSeenSignatures.get(sig);
      eRec.classification = 'END_GEN1_DUPLICATE_MULTI_SKU';
      eRec.duplicateOfItem = primaryItem;
      eRec.matchedCleanStatus = 'duplicate_stranded_may01';
      eRec.recommendedAction = `END IMMEDIATELY — Duplicate Gen-1 Listing of eBay #${primaryItem}`;
    } else {
      if (sig) strandedSeenSignatures.set(sig, eRec.itemNumber);
      eRec.classification = 'STRANDED_MAY01_CDN_PART__PHASE4_RECOVERY';
      eRec.matchedCleanStatus = 'not_in_aug04_905_recover_phase4';
      eRec.recommendedAction = eRec.watchers > 0
        ? `END Other-6755 Before Full 4Runner Push (Has ${eRec.watchers} watcher) -> Recover Clean May-1 CDN Part + OCR MPN in Phase 4`
        : 'END Other-6755 Orphan -> Recover Clean May-1 CDN Part + Real OCR MPN in Phase 4';
    }
  }

  // Compute summary stats
  const summary = {
    total_ebay_legacy_listings: enrichedEbay.length,
    matched_may01_gen1_records: enrichedEbay.filter((r) => r.mayPrimaryImage || r.mayWeightLbs >= 0).length,
    recovered_real_ocr_mpns: enrichedEbay.filter((r) => Boolean(r.realOcrMpn)).length,
    critical_end_prohibited_srs_or_cat: 0,
    critical_end_confirmed_sold: 0,
    end_gen1_duplicate_multi_sku: 0,
    matched_clean_905_active_total: 0,
    matched_clean_905_active_with_watcher: 0,
    matched_aug04_draft_or_archived: 0,
    stranded_may01_unique_phase4_recovery: 0,
    clean_905_zero_overlap_skus_ready_now: sanItems.filter((x) => x.status === 'active' && !/2004\s+Toyota\s+4Runner/i.test(x.title)).length,
    clean_905_2004_4runner_active_skus: sanActive4R.length
  };

  for (const r of enrichedEbay) {
    if (r.classification === 'CRITICAL_END_PROHIBITED_SRS_OR_CAT') summary.critical_end_prohibited_srs_or_cat++;
    else if (r.classification === 'CRITICAL_END_CONFIRMED_SOLD') summary.critical_end_confirmed_sold++;
    else if (r.classification === 'END_GEN1_DUPLICATE_MULTI_SKU') summary.end_gen1_duplicate_multi_sku++;
    else if (r.classification === 'MATCHED_CLEAN_905_ACTIVE') summary.matched_clean_905_active_total++;
    else if (r.classification === 'MATCHED_CLEAN_905_ACTIVE__HAS_WATCHER') {
      summary.matched_clean_905_active_total++;
      summary.matched_clean_905_active_with_watcher++;
    } else if (r.classification === 'MATCHED_AUG04_DRAFT_HOLD' || r.classification === 'MATCHED_AUG04_ARCHIVED') {
      summary.matched_aug04_draft_or_archived++;
    } else if (r.classification === 'STRANDED_MAY01_CDN_PART__PHASE4_RECOVERY' || r.classification === 'STRANDED_NON_4RUNNER_GEN1_PART') {
      summary.stranded_may01_unique_phase4_recovery++;
    }
  }

  // Emit complete 418-row Reconciliation Mapping CSV
  const headers = [
    'Row_No',
    'eBay_Item_Number',
    'Legacy_Gen1_eBay_SKU',
    'Legacy_eBay_Title',
    'Legacy_eBay_Price_USD',
    'eBay_Watchers',
    'eBay_Sold_Qty',
    'Legacy_eBay_Category',
    'Reconciliation_Classification',
    'Recommended_eBay_Action',
    'Matched_Clean_905_SKU',
    'Matched_Clean_905_Title',
    'Matched_Clean_905_Status',
    'Matched_Clean_905_Price_USD',
    'Matched_Clean_905_Weight_Lbs',
    'Match_Confidence_Score',
    'Duplicate_Of_eBay_Item',
    'Target_eBay_Motors_Leaf_Category',
    'Recovered_May01_Real_OCR_MPN',
    'Gen1_May01_Weight_Lbs',
    'Gen1_May01_Primary_CDN_Image_URL',
    'Matched_Clean_905_CDN_Image_URL'
  ];

  const lines = [headers.join(',')];
  for (const r of enrichedEbay) {
    const targetLeaf = r.prohibited
      ? 'DO NOT LIST (Prohibited SRS / Emissions)'
      : inferMotorsLeafCategory(r.matchedCleanTitle || r.title);

    lines.push([
      r.rowNo,
      r.itemNumber,
      r.legacySku,
      r.title,
      r.price.toFixed(2),
      r.watchers,
      r.soldQty,
      r.legacyCategory,
      r.classification,
      r.recommendedAction,
      r.matchedCleanSku,
      r.matchedCleanTitle,
      r.matchedCleanStatus,
      r.matchedCleanPrice,
      r.matchedCleanWeightLbs,
      r.matchScore ? r.matchScore.toFixed(3) : '',
      r.duplicateOfItem,
      targetLeaf,
      r.realOcrMpn,
      r.mayWeightLbs,
      r.mayPrimaryImage,
      r.matchedCleanImage
    ].map(csvEscapeCell).join(','));
  }

  return {
    csv: lines.join('\n') + '\n',
    summary,
    records: enrichedEbay
  };
}

module.exports = {
  generateEbay418Reconciliation
};
