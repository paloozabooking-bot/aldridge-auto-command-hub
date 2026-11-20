const fs = require('node:fs');
const path = require('node:path');
const {
  db,
  DATA_DIR,
  getSettings,
  generateSecurityCode,
  computeShippingClass,
  validatePartCompliance,
  isNonDescriptiveAutoFilename,
  logSync
} = require('./db');
const {
  PROHIBITED_CAT_SKUS,
  PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS,
  isCounterfeitMpn,
  cleanListingTitle
} = require('./audit-sanitizer');
const { resolvePartTaxonomyAndMetafields } = require('./taxonomy');
const { generatePartQrCardPng } = require('./qr-card');
const { syncAllToShopifyCoMaster } = require('./exporters');

const PUBLIC_REVIEW_THUMBS_DIR = path.join(__dirname, '..', 'public', 'review-thumbs');

const PART_SPEC_RULES = [
  {
    match: /automatic\s+transmission|manual\s+transmission|\btransmission\b(?!.*(mount|sensor|cooler|cable|pan|shifter))/i,
    category: 'Automatic Transmissions & Driveline',
    placement: 'Center Drivetrain',
    price: 1150, laborHours: 7.5, weight: 215, l: 42, w: 34, h: 28,
    defect: 'Complete tested OEM transmission assembly pulled from verified donor. Drain/inspect fluid & flush cooler lines during installation. Local pickup or shop bay install in University Place, WA 98467.'
  },
  {
    match: /\bdifferential\b/i,
    category: 'Transmission & Drivetrain',
    placement: 'Front / Rear Axle',
    price: 425, laborHours: 4.0, weight: 85, l: 24, w: 18, h: 16,
    defect: 'Tested OEM differential assembly pulled from verified donor; inspect seals and refill with OEM-spec gear oil prior to operation.'
  },
  {
    match: /\bfox\b.*shock|performance\s+series.*shock/i,
    category: 'Steering & Suspension Components',
    placement: 'Rear Left & Right',
    price: 325, laborHours: 1.5, weight: 20, l: 28, w: 10, h: 8,
    brandOverride: 'FOX Racing',
    defect: 'Clean matched pair of FOX 2.0 Performance Series reservoir shocks; bodies and shafts inspected.'
  },
  {
    match: /sliding\s+rear\s+back\s+window|back\s+window\s+glass|back\s+glass/i,
    category: 'Exterior Body Panels & Trim',
    placement: 'Rear Cab Window',
    price: 295, laborHours: 2.2, weight: 38, l: 60, w: 22, h: 8,
    defect: 'OEM power sliding rear back window glass assembly. Fragile oversized glass — Local Pickup or Certified Shop Bay Installation at 5115 66th St W, Bldg B, University Place, WA 98467.'
  },
  {
    match: /\b(front\s+seat\s+pair|rear\s+seat|rear\s+seats|bench\s+seat|car\s+seats)\b/i,
    category: 'Interior Trim, Seats & Consoles',
    placement: 'Interior Cabin',
    price: 265, laborHours: 1.2, weight: 76, l: 52, w: 26, h: 24,
    defect: 'Clean OEM interior seat assembly pulled from verified donor; normal age-consistent wear shown in photos. Oversized local pickup or bay install in University Place, WA 98467.'
  },
  {
    match: /\b(front\s+seat|driver\s+seat|drivers?\s+seat|passenger\s+seat|\bseat\b)\b(?!.*(cover|switch|belt|cushion|bolster))/i,
    category: 'Interior Trim, Seats & Consoles',
    placement: 'Front Interior Cabin',
    price: 185, laborHours: 1.0, weight: 72, l: 38, w: 24, h: 24,
    defect: 'Tested OEM seat assembly pulled from verified donor; rails and upholstery inspected as photographed. Oversized local pickup or bay install in University Place, WA 98467.'
  },
  {
    match: /\b(rear\s+passenger\s+door|front\s+door|rear\s+door|driver\s+door)\b(?!.*(panel|trim|window|handle|latch|mirror|hinge))/i,
    category: 'Exterior Body Panels & Trim',
    placement: 'Exterior Side Door',
    price: 295, laborHours: 2.0, weight: 78, l: 48, w: 42, h: 12,
    defect: 'Straight OEM exterior door shell assembly pulled from verified donor. Oversized local pickup or certified bay install in University Place, WA 98467.'
  },
  {
    match: /\b(gas\s+tank|fuel\s+tank)\b(?!.*(strap|cap|door|hinge|pump|sender))/i,
    category: 'Air & Fuel Delivery',
    placement: 'Underbody Rear',
    price: 195, laborHours: 2.5, weight: 32, l: 44, w: 20, h: 16,
    defect: 'Clean drained OEM fuel tank assembly; hazmat/oversize rules require Local Pickup or Shop Bay Installation at 5115 66th St W, Bldg B, University Place, WA 98467.'
  },
  {
    match: /\b(engine\s+ecu|ecu\s+computer|ecm|pcm)\b/i,
    category: 'ECUs, Modules & Automotive Electronics',
    placement: 'Engine Bay / Cabin',
    price: 175, laborHours: 1.0, weight: 3.5, l: 11, w: 9, h: 4,
    defect: 'Tested OEM engine computer module; pins straight & clean. Verify exact part number and any immobilizer/key programming required for your VIN.'
  },
  {
    match: /\babs\s+module\b/i,
    category: 'Brakes & Brake Hydraulics',
    placement: 'Engine Bay',
    price: 185, laborHours: 1.8, weight: 8.5, l: 12, w: 10, h: 8,
    defect: 'Tested OEM ABS hydraulic pump/control module; ports sealed and connector pins inspected.'
  },
  {
    match: /\bintake\s+manifold\b/i,
    category: 'Engines & Engine Components',
    placement: 'Upper Engine',
    price: 165, laborHours: 2.5, weight: 16, l: 22, w: 14, h: 12,
    defect: 'Clean inspected OEM intake manifold; mounting flanges straight. Install with new OEM gaskets.'
  },
  {
    match: /\b(drive\s*shaft|driveshaft)\b/i,
    category: 'Transmission & Drivetrain',
    placement: 'Underbody Center',
    price: 145, laborHours: 1.5, weight: 24, l: 54, w: 8, h: 8,
    defect: 'Straight OEM driveshaft assembly pulled from verified donor; yokes and U-joints inspected.'
  },
  {
    match: /\b(drive\s+axle|cv\s+axle|axle\s+shaft)\b/i,
    category: 'Transmission & Drivetrain',
    placement: 'Front / Rear Drivetrain',
    price: 115, laborHours: 1.8, weight: 18, l: 32, w: 8, h: 8,
    defect: 'Tested OEM axle shaft assembly; splines clean and boots inspected.'
  },
  {
    match: /\b(strut\s+assembly|struts|shocks)\b/i,
    category: 'Steering & Suspension Components',
    placement: 'Front / Rear Suspension',
    price: 145, laborHours: 1.8, weight: 24, l: 28, w: 12, h: 10,
    defect: 'Clean matched OEM strut assembly pair pulled from verified donor; springs and mounts intact.'
  },
  {
    match: /\b(roof\s+rack|roof\s+rail)\b/i,
    category: 'Exterior Body Panels & Trim',
    placement: 'Roof',
    price: 145, laborHours: 1.0, weight: 14, l: 64, w: 10, h: 6,
    defect: 'Clean OEM roof rack/rail hardware pulled from verified donor; mounting points intact.'
  },
  {
    match: /\b(stereo|head\s+unit|radio)\b/i,
    category: 'ECUs, Modules & Automotive Electronics',
    placement: 'Center Dash',
    price: 145, laborHours: 1.0, weight: 6.5, l: 12, w: 10, h: 8,
    defect: 'Tested OEM factory stereo head unit; faceplate buttons and rear harness connectors intact.'
  },
  {
    match: /\b(instrument\s+cluster|speedometer)\b/i,
    category: 'Instrument Clusters & Gauges',
    placement: 'Driver Dash',
    price: 135, laborHours: 1.0, weight: 4.5, l: 18, w: 10, h: 8,
    defect: 'Tested OEM speedometer instrument cluster; clear lens and rear connector pins intact.'
  },
  {
    match: /\b(door\s+trim\s+panel|door\s+panel)\b/i,
    category: 'Interior Trim, Seats & Consoles',
    placement: 'Interior Door',
    price: 125, laborHours: 0.8, weight: 12, l: 36, w: 24, h: 6,
    defect: 'Clean OEM interior door trim panel; mounting tabs and armrest surface inspected as pictured.'
  },
  {
    match: /\b(radiator)\b/i,
    category: 'Engine Cooling Components',
    placement: 'Front Core Support',
    price: 125, laborHours: 2.0, weight: 18, l: 34, w: 24, h: 7,
    defect: 'Pressure-checked OEM radiator assembly; clean fins and undamaged inlet/outlet necks.'
  },
  {
    match: /\b(ac\s+condenser|condenser)\b/i,
    category: 'A/C & Climate Control',
    placement: 'Front Core Support',
    price: 95, laborHours: 2.0, weight: 13, l: 32, w: 22, h: 6,
    defect: 'Clean OEM A/C condenser assembly; fins straight and fittings undamaged.'
  },
  {
    match: /\b(timing\s+chain\s+kit|timing\s+belt\s+kit|water\s+pump\s+and\s+timing)\b/i,
    category: 'Engines & Engine Components',
    placement: 'Front Engine Timing Cover',
    price: 125, laborHours: 4.5, weight: 9, l: 14, w: 11, h: 7,
    conditionOverride: 'New',
    defect: 'New unused boxed timing kit as photographed; verify engine displacement and VIN fitment prior to install.'
  },
  {
    match: /\bwater\s+pump\b/i,
    category: 'Engine Cooling Components',
    placement: 'Front Engine',
    price: 65, laborHours: 2.5, weight: 5.5, l: 10, w: 9, h: 7,
    conditionOverride: 'New',
    defect: 'New boxed replacement water pump as photographed; confirm OEM/interchange part number prior to installation.'
  },
  {
    match: /\b(brake\s+master\s+cylinder|brake\s+booster)\b/i,
    category: 'Brakes & Brake Hydraulics',
    placement: 'Firewall Engine Bay',
    price: 125, laborHours: 1.8, weight: 13, l: 14, w: 12, h: 12,
    defect: 'Clean OEM brake master cylinder / booster assembly pulled from verified donor; ports capped.'
  },
  {
    match: /\b(brake\s+caliper|calipers)\b/i,
    category: 'Brakes & Brake Hydraulics',
    placement: 'Front Hub',
    price: 115, laborHours: 1.5, weight: 18, l: 14, w: 12, h: 8,
    defect: 'Clean matched OEM brake caliper pair; bleeder screws and slide surfaces inspected.'
  },
  {
    match: /\b(climate\s+control|hvac\s+control)\b/i,
    category: 'A/C & Climate Control',
    placement: 'Center Dash',
    price: 110, laborHours: 0.8, weight: 3.5, l: 12, w: 8, h: 6,
    defect: 'Tested OEM climate control module; knobs, buttons, and rear harness plugs intact.'
  },
  {
    match: /\b(door\s+window|window\s+glass)\b/i,
    category: 'Exterior Body Panels & Trim',
    placement: 'Side Door',
    price: 110, laborHours: 1.3, weight: 14, l: 34, w: 22, h: 5,
    defect: 'Clean OEM tempered door window glass; no cracks or chips, carefully boxed for safe transit or 98467 counter pickup.'
  },
  {
    match: /\b(center\s+console|overhead\s+console)\b/i,
    category: 'Interior Trim, Seats & Consoles',
    placement: 'Interior Cabin',
    price: 110, laborHours: 0.8, weight: 10, l: 24, w: 14, h: 12,
    defect: 'Clean OEM console assembly; mounting points and latches intact.'
  },
  {
    match: /\b(grille|grile)\b/i,
    category: 'Exterior Body Panels & Trim',
    placement: 'Front Bumper / Hood',
    price: 105, laborHours: 0.7, weight: 7, l: 38, w: 12, h: 8,
    defect: 'Clean OEM front grille assembly; mounting tabs inspected as shown.'
  },
  {
    match: /\b(side\s+mirror|mirror)\b/i,
    category: 'Exterior & Interior Mirrors',
    placement: 'Exterior Door',
    price: 95, laborHours: 0.7, weight: 5.5, l: 14, w: 10, h: 8,
    defect: 'Tested OEM side view mirror assembly; glass clear and mounting studs intact.'
  },
  {
    match: /\b(fuse\s+box|relay)\b/i,
    category: 'ECUs, Modules & Automotive Electronics',
    placement: 'Engine Bay / Cabin',
    price: 95, laborHours: 1.0, weight: 4.5, l: 12, w: 10, h: 6,
    defect: 'Tested OEM fuse/relay junction box; zero melted terminals or corrosion.'
  },
  {
    match: /\b(air\s+intake\s+box|maf)\b/i,
    category: 'Air & Fuel Delivery',
    placement: 'Engine Bay',
    price: 95, laborHours: 0.6, weight: 7, l: 18, w: 14, h: 12,
    defect: 'Clean OEM air cleaner intake box & MAF housing; latches intact.'
  },
  {
    match: /\b(window\s+regulator|wiper\s+motor)\b/i,
    category: 'Exterior Body Panels & Trim',
    placement: 'Door / Cowl',
    price: 85, laborHours: 1.2, weight: 6.5, l: 22, w: 10, h: 6,
    defect: 'Bench-tested OEM motor/regulator assembly; smooth operation verified.'
  },
  {
    match: /\b(suspension\s+arm|control\s+arm)\b/i,
    category: 'Steering & Suspension Components',
    placement: 'Underbody Suspension',
    price: 85, laborHours: 1.5, weight: 11, l: 20, w: 12, h: 6,
    defect: 'Straight OEM suspension arm pulled from verified donor; bushings inspected.'
  },
  {
    match: /\b(combination\s+switch|wiper\s+switch|turn\s+signal)\b/i,
    category: 'ECUs, Modules & Automotive Electronics',
    placement: 'Steering Column',
    price: 75, laborHours: 0.9, weight: 2.5, l: 12, w: 8, h: 5,
    defect: 'Tested OEM multifunction column switch; clean detents and intact harness plugs.'
  },
  {
    match: /\b(charcoal\s+canister|vapor\s+canister)\b/i,
    category: 'Air & Fuel Delivery',
    placement: 'Underbody Rear',
    price: 85, laborHours: 1.0, weight: 6, l: 16, w: 10, h: 8,
    defect: 'Clean OEM EVAP charcoal canister; nipples and electrical connector intact.'
  },
  {
    match: /\b(bolster\s+cushions?|d-pillar|pillar\s+trim|gray\s+cloth\s+interior|spare\s+tire\s+cover)\b/i,
    category: 'Interior Trim, Seats & Consoles',
    placement: 'Interior Cabin',
    price: 75, laborHours: 0.5, weight: 8, l: 26, w: 16, h: 8,
    defect: 'Clean OEM interior trim/cushion component pulled from verified donor; normal light wear shown in photos.'
  },
  {
    match: /\b(hood\s+cowl|coolant\s+reservoir|washer\s+fluid\s+reservoir|hood\s+latch|exhaust\s+heat\s+shield|fuel\s+tank\s+straps|fuel\s+gas\s+filler|clutch\s+slave|horns?|side\s+marker|wheel\s+cover)\b/i,
    category: 'Exterior Body Panels & Trim',
    placement: 'Vehicle Specific',
    price: 55, laborHours: 0.7, weight: 5, l: 16, w: 10, h: 7,
    defect: 'Inspected OEM component pulled from verified donor; mounting points intact.'
  },
  {
    match: /\bowner'?s?\s+manual\b/i,
    category: 'Interior Trim, Seats & Consoles',
    placement: 'Glove Box',
    price: 38, laborHours: 0, weight: 2, l: 10, w: 7, h: 2,
    defect: 'Original factory OEM Owner\'s Manual booklet; clean legible pages.'
  },
  {
    match: /\bwiper\s+blade/i,
    category: 'Exterior Body Panels & Trim',
    placement: 'Front Windshield',
    price: 22, laborHours: 0.25, weight: 1.5, l: 25, w: 4, h: 3,
    conditionOverride: 'New',
    defect: 'New retail windshield wiper blade as photographed; free quick install available at Bldg B counter.'
  }
];

function fixCommonPartTypos(text) {
  return String(text || '')
    .replace(/\bForrester\b/gi, 'Forester')
    .replace(/\bGrile\b/gi, 'Grille')
    .replace(/\bdriveres\b/gi, 'Driver')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseClean(text) {
  const KEEP_UPPER = new Set(['OEM', 'ABS', 'AC', 'A/C', 'ECU', 'ECM', 'PCM', 'MAF', 'AWD', '4WD', '2WD', 'FWD', 'RWD', 'V6', 'V8', 'I4', 'FOX', 'GMC', 'GM', 'ANCO', 'TOTALPRO', 'LED', 'HID', 'L+R', 'S-10', 'F150', 'F-150', 'HVAC', 'EVAP']);
  return fixCommonPartTypos(text)
    .split(/\s+/)
    .map((word) => {
      const stripped = word.replace(/^[^A-Za-z0-9+]+|[^A-Za-z0-9+]+$/g, '');
      if (KEEP_UPPER.has(stripped.toUpperCase())) {
        return word.replace(stripped, stripped.toUpperCase());
      }
      if (/^[0-9]+(\.[0-9]+)?L$/i.test(stripped)) return word.toUpperCase();
      if (/^[A-Z]{2,}[0-9-]+$/i.test(stripped) && /\d/.test(stripped) && stripped.length >= 5) {
        return word.toUpperCase();
      }
      if (/^[a-z]/.test(word)) {
        return word[0].toUpperCase() + word.slice(1);
      }
      return word;
    })
    .join(' ');
}

function isUsefulHint(hint) {
  const h = String(hint || '').trim();
  if (!h) return false;
  if (isNonDescriptiveAutoFilename(h)) return false;
  if (/^(messenger\s+creation|received\s+\d+|img\s+\d+|pxl\s+\d+|ald\s+[a-z0-9]{4,8}|sku\s+toy)/i.test(h)) return false;
  if (/^[a-f0-9]{8}\s+[a-f0-9]{4}\s+[a-f0-9]{4}/i.test(h)) return false;
  if (/^\d{8}\s+\d{6}$/.test(h)) return false;
  return true;
}

function parseVehicleFolder(folderName, combinedText = '') {
  const folder = String(folderName || '').trim();
  const txt = fixCommonPartTypos(combinedText);

  // 1. Direct Year or Year-Range + Make + Model in folder name (e.g. "2012 Toyota 4Runner", "2016-2023 Toyota Tacoma")
  const direct = folder.match(/^((?:19|20)\d{2}(?:-(?:19|20)\d{2})?)\s+([A-Za-z0-9-]+)\s+(.+)$/);
  if (direct) {
    return {
      fitment_years: direct[1],
      fitment_make: direct[2],
      fitment_model: direct[3].trim()
    };
  }

  // 2. Try extracting Year/Range + Make + Model from descriptive filename/hint (great for Misc folders!)
  const knownMakes = ['Toyota', 'Subaru', 'Fiat', 'Chevrolet', 'GMC', 'Ford', 'Honda', 'Kia', 'Nissan', 'Mazda', 'Dodge', 'Lexus'];
  const makePattern = knownMakes.join('|');
  const fromText = txt.match(new RegExp(`((?:19|20)\\d{2}(?:-(?:19|20)\\d{2})?|\\b0\\d\\b)\\s+(${makePattern})\\s+([A-Za-z0-9-]+)`, 'i'));
  if (fromText) {
    let yr = fromText[1];
    if (/^\d{2}$/.test(yr)) yr = `20${yr}`;
    const mk = knownMakes.find((m) => m.toLowerCase() === fromText[2].toLowerCase()) || fromText[2];
    return {
      fitment_years: yr,
      fitment_make: mk,
      fitment_model: titleCaseClean(fromText[3])
    };
  }

  // 3. Make + Model without year (e.g. "Kia Rio Front Grille", "Subaru Impreza 14 inch wheel cover")
  const makeModelOnly = txt.match(new RegExp(`\\b(${makePattern})\\s+([A-Za-z0-9-]+)`, 'i'));
  if (makeModelOnly) {
    const mk = knownMakes.find((m) => m.toLowerCase() === makeModelOnly[1].toLowerCase()) || makeModelOnly[1];
    return {
      fitment_years: '',
      fitment_make: mk,
      fitment_model: titleCaseClean(makeModelOnly[2])
    };
  }

  // 4. Fallback for Unidentified / Universal retail parts (e.g. wiper blades, water pumps)
  if (/unidentified/i.test(folder)) {
    return {
      fitment_years: 'Multi-Fit',
      fitment_make: 'Universal OEM',
      fitment_model: 'Verify Size / Fitment'
    };
  }

  const folderMake = knownMakes.find((m) => folder.toLowerCase().includes(m.toLowerCase())) || 'OEM';
  return {
    fitment_years: '',
    fitment_make: folderMake,
    fitment_model: folder.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*Misc\b/i, '').trim() || 'Vehicle Specific'
  };
}

function matchDonorVehicle(donors, vehicleMeta) {
  if (!Array.isArray(donors) || !donors.length) return null;
  const yrNum = parseInt(String(vehicleMeta.fitment_years || '').slice(0, 4), 10);
  const mk = String(vehicleMeta.fitment_make || '').toLowerCase();
  const mdl = String(vehicleMeta.fitment_model || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!yrNum || !mk) return null;
  return donors.find((d) => {
    const dMdl = String(d.model || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return Number(d.year) === yrNum &&
      String(d.make || '').toLowerCase() === mk &&
      (dMdl.includes(mdl) || mdl.includes(dMdl));
  }) || null;
}

function extractAngleAndBase(originalName) {
  const raw = String(originalName || '').trim();
  const noExt = raw.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  const noCopy = noExt.replace(/\s*\(\d+\)\s*$/, '').trim();

  // Case 1: Internal ALD SKU code (e.g. ALD-VDM77C_1, ALD-OH-016.1, ALD-NX7MB7)
  const aldMatch = noCopy.match(/^(ALD-(?:OH-)?[A-Z0-9]{2,10})(?:[._-](\d+))?$/i);
  if (aldMatch) {
    return {
      kind: 'ald_code',
      baseKey: aldMatch[1].toUpperCase(),
      explicitSku: aldMatch[1].toUpperCase(),
      angleNum: Number(aldMatch[2] || 1)
    };
  }

  // Case 2: Generic camera/messenger/timestamp filename (keep individual — don't merge separate parts!)
  if (isNonDescriptiveAutoFilename(raw)) {
    return {
      kind: 'generic',
      baseKey: null,
      explicitSku: null,
      angleNum: 1
    };
  }

  // Case 3: Descriptive part filename (strip trailing .1, .15, _2, " 1" angle indices)
  let angleNum = 1;
  let stem = noCopy;
  const dotAngle = stem.match(/^(.+?)[._](\d{1,2})$/);
  if (dotAngle) {
    stem = dotAngle[1];
    angleNum = Number(dotAngle[2]);
  } else {
    const spaceAngle = stem.match(/^(.+?)\s+(\d{1,2})$/);
    if (spaceAngle && !/\b(inch|in|set\s+of|pair|series|v6|v8)\b/i.test(spaceAngle[1].slice(-12))) {
      stem = spaceAngle[1];
      angleNum = Number(spaceAngle[2]);
    }
  }

  const normalizedKey = fixCommonPartTypos(stem)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return {
    kind: 'descriptive',
    baseKey: normalizedKey,
    explicitSku: null,
    angleNum,
    cleanStem: fixCommonPartTypos(stem.replace(/[-_]+/g, ' '))
  };
}

function groupKeepPhotosIntoParts(keepRows) {
  const groupsMap = new Map();
  for (const row of keepRows) {
    const effFolder = (row.vehicle_tag_override || row.vehicle_folder || 'Unidentified_Auto_Parts_Needs_Tag').trim();
    const parsed = extractAngleAndBase(row.original_name);
    let groupKey;
    if (parsed.kind === 'ald_code') {
      groupKey = `ald::${effFolder}::${parsed.baseKey}`;
    } else if (parsed.kind === 'descriptive' && parsed.baseKey) {
      groupKey = `desc::${effFolder}::${parsed.baseKey}`;
    } else {
      groupKey = `uid::${row.photo_uid}`;
    }

    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, {
        groupKey,
        kind: parsed.kind,
        effectiveFolder: effFolder,
        explicitSku: parsed.explicitSku,
        cleanStem: parsed.cleanStem || '',
        photos: []
      });
    }
    groupsMap.get(groupKey).photos.push({
      ...row,
      effective_folder: effFolder,
      angleNum: parsed.angleNum
    });
  }

  const groups = [];
  for (const g of groupsMap.values()) {
    g.photos.sort((a, b) => (a.angleNum - b.angleNum) || String(a.photo_uid).localeCompare(String(b.photo_uid)));
    groups.push(g);
  }
  return groups;
}

function buildDeterministicSku(group, vehicleMeta) {
  if (group.explicitSku) {
    return group.explicitSku.replace(/[^A-Z0-9-]/g, '').toUpperCase();
  }
  const primaryUid = String(group.photos[0]?.photo_uid || 'P0000').toUpperCase();
  const yr = String(vehicleMeta.fitment_years || '').match(/\d{2}$/)?.[0] ||
    String(vehicleMeta.fitment_years || '').match(/(?:19|20)(\d{2})/)?.[1] || '00';
  const mk = String(vehicleMeta.fitment_make || 'OEM').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'OEM';
  const rawSlug = (group.cleanStem || '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(new RegExp(`\\b${vehicleMeta.fitment_make || '___'}\\b`, 'ig'), '')
    .replace(new RegExp(`\\b${vehicleMeta.fitment_model || '___'}\\b`, 'ig'), '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 12)
    .replace(/-+$/, '');
  if (rawSlug.length >= 3) {
    return `ALD-${yr}${mk}-${rawSlug}-${primaryUid}`.replace(/--+/g, '-').slice(0, 32);
  }
  return `ALD-KEEP-${primaryUid}`;
}

function extractRealMpn(text) {
  const raw = String(text || '');
  // Match genuine OEM / aftermarket MPN patterns like 35010-0W110, FVC-9106, 16400-5PA-A01 (exclude ALD-* SKUs and years)
  const matches = raw.match(/\b([A-Z0-9]{3,6}-[A-Z0-9]{4,6}(?:-[A-Z0-9]{2,5})?)\b/gi) || [];
  for (const cand of matches) {
    const up = cand.toUpperCase();
    if (up.startsWith('ALD-') || up.startsWith('SEC-') || /^(19|20)\d{2}-(19|20)\d{2}$/.test(up)) continue;
    if (!/\d/.test(up)) continue;
    if (/^[0-9-]+$/.test(up) && up.length < 8) continue;
    if (isCounterfeitMpn(up)) continue;
    return up;
  }
  return '';
}

function inferSpecAndBuildItem(group, donors, settings) {
  const primary = group.photos[0];
  const allNotes = group.photos.map((p) => String(p.notes || '').trim()).filter((n) => n && !/^Auto-removed:/i.test(n));
  const mergedNotes = [...new Set(allNotes)].join(' | ');
  const bestHint = group.photos.map((p) => String(p.title_hint || '').trim()).find(isUsefulHint) || '';

  // Choose the cleanest human-readable source text for title
  let baseTitleRaw = '';
  if (group.kind === 'descriptive' && group.cleanStem) {
    baseTitleRaw = group.cleanStem;
  } else if (bestHint) {
    baseTitleRaw = bestHint;
  } else if (mergedNotes) {
    baseTitleRaw = mergedNotes;
  }

  const vehicleMeta = parseVehicleFolder(group.effectiveFolder, `${baseTitleRaw} ${bestHint} ${mergedNotes}`);
  const donor = matchDonorVehicle(donors, vehicleMeta);
  const ymmPrefix = [vehicleMeta.fitment_years, vehicleMeta.fitment_make, vehicleMeta.fitment_model]
    .filter((v) => v && v !== 'Multi-Fit' && v !== 'Universal OEM' && v !== 'Verify Size / Fitment')
    .join(' ')
    .trim();

  let title = '';
  if (baseTitleRaw) {
    const cleanedBase = titleCaseClean(baseTitleRaw);
    const hasMakeOrModel = vehicleMeta.fitment_make &&
      vehicleMeta.fitment_make !== 'Universal OEM' &&
      cleanedBase.toLowerCase().includes(vehicleMeta.fitment_make.toLowerCase());
    title = hasMakeOrModel || !ymmPrefix
      ? cleanedBase
      : `${ymmPrefix} ${cleanedBase}`;
    if (!/\b(oem|wiper\s+blade|water\s+pump|timing\s+chain|fox)\b/i.test(title)) {
      title = `${title} OEM`;
    }
  } else {
    const refTag = group.explicitSku || primary.photo_uid;
    title = ymmPrefix
      ? `${ymmPrefix} Tested OEM Auto Part (${refTag})`
      : `Tested OEM Auto Part (${refTag})`;
  }
  title = cleanListingTitle(title).slice(0, 80);

  const searchBlob = `${title} ${baseTitleRaw} ${bestHint} ${mergedNotes} ${primary.original_name}`.toLowerCase();
  const matchedRule = PART_SPEC_RULES.find((r) => r.match.test(searchBlob));

  const taxonomy = resolvePartTaxonomyAndMetafields({
    title,
    category: matchedRule?.category || 'OEM Auto Parts',
    brand: matchedRule?.brandOverride || '',
    fitment_years: vehicleMeta.fitment_years,
    fitment_make: vehicleMeta.fitment_make,
    fitment_model: vehicleMeta.fitment_model
  }, settings);

  const condition = matchedRule?.conditionOverride || 'Used';
  const conditionId = condition === 'New' ? 1000 : 3000;
  const priceWePull = matchedRule ? matchedRule.price : 85;
  const laborHours = matchedRule ? matchedRule.laborHours : 1.0;
  const laborRate = Number(settings.labor_rate_hourly || 174.99);
  const pricePullInstall = laborHours > 0
    ? Number((priceWePull + laborHours * laborRate).toFixed(2))
    : priceWePull;
  const weightLbs = matchedRule ? matchedRule.weight : 8.5;
  const lengthIn = matchedRule ? matchedRule.l : 14;
  const widthIn = matchedRule ? matchedRule.w : 10;
  const heightIn = matchedRule ? matchedRule.h : 8;
  const category = matchedRule ? matchedRule.category : (taxonomy.partType || 'OEM Auto Parts');
  const shippingClass = computeShippingClass(weightLbs, `${category} ${title}`, lengthIn, widthIn, heightIn);

  let brand = matchedRule?.brandOverride || '';
  if (!brand) {
    if (/\b(anco)\b/i.test(title)) brand = 'ANCO';
    else if (/\b(trico)\b/i.test(title)) brand = 'Trico';
    else if (/\b(rain-?x)\b/i.test(title)) brand = 'Rain-X';
    else if (/\b(totalpro)\b/i.test(title)) brand = 'TOTALPRO';
    else if (/\b(aero\s+blade)\b/i.test(title)) brand = 'Aero';
    else if (vehicleMeta.fitment_make && vehicleMeta.fitment_make !== 'Universal OEM') brand = `${vehicleMeta.fitment_make} OEM`;
    else brand = 'OEM';
  }

  const oemPartNumber = extractRealMpn(`${title} ${bestHint} ${mergedNotes} ${primary.original_name}`);
  const sku = buildDeterministicSku(group, vehicleMeta);

  const driveUrls = group.photos
    .map((p) => p.copied_drive_id
      ? `https://drive.google.com/file/d/${p.copied_drive_id}/view`
      : (p.drive_file_id ? `https://drive.google.com/file/d/${p.drive_file_id}/view` : ''))
    .filter(Boolean);

  const shipSummary = shippingClass === 'local_pickup_only'
    ? 'Local Pickup Only at 5115 66th St W, Bldg B, University Place, WA 98467 (oversized/heavy/hazmat assembly).'
    : `Calculated Parcel Shipping (+ $${Number(settings.handling_fee_default ?? 10).toFixed(2)} handling) or Free We-Pull Counter Pickup at 5115 66th St W, Bldg B, University Place, WA 98467.`;

  const installSummary = laborHours > 0
    ? `Optional Certified Shop Bay We-Install Pricing at Aldridge Auto's (5115 66th St W, Bldg B, University Place, WA 98467): ~$${pricePullInstall.toFixed(2)} turnkey installed (~${laborHours.toFixed(1)} hrs certified tech labor @ $${laborRate.toFixed(0)}/hr).`
    : `Counter pickup available at Aldridge Auto's Service & Repair, 5115 66th St W, Bldg B, University Place, WA 98467.`;

  const descriptionParts = [
    `${title} — Single-Variant Verified OEM Inventory (1 physical unit in stock).`,
    donor
      ? `Pulled from verified donor ${donor.year} ${donor.make} ${donor.model} ${donor.trim || ''} (${donor.engine}, Stock #${donor.stock_number}).`
      : (ymmPrefix ? `Donor vehicle folder: ${ymmPrefix}.` : 'Verified on-hand shop inventory.'),
    mergedNotes ? `Inspection Notes: ${mergedNotes}.` : '',
    `We-Pull Part Price: $${priceWePull.toFixed(2)}. ${installSummary}`,
    shipSummary
  ].filter(Boolean);

  const fitmentNotesParts = [
    'Match photos & OEM part number prior to purchase (Returns Not Accepted for remorse/fitment; Defect-Only evidence policy).',
    mergedNotes ? `Review Note: ${mergedNotes}` : '',
    `Review UIDs: ${group.photos.map((p) => p.photo_uid).join(', ')}`,
    driveUrls[0] ? `Drive Source: ${driveUrls[0]}` : ''
  ].filter(Boolean);

  const binLocation = donor?.stock_number
    ? `${donor.stock_number}-SHELF`
    : (group.effectiveFolder === 'Unidentified_Auto_Parts_Needs_Tag' ? 'BLDG-B-COUNTER' : 'BLDG-B-KEEP');

  // Collect real local review-thumb paths for every photo angle in this group
  const localPhotos = [];
  for (const p of group.photos) {
    const thumbFile = `${p.photo_uid}.jpg`;
    if (fs.existsSync(path.join(PUBLIC_REVIEW_THUMBS_DIR, thumbFile))) {
      localPhotos.push(`/review-thumbs/${thumbFile}`);
    }
  }

  return {
    sku,
    title,
    category,
    condition,
    condition_id: conditionId,
    brand,
    oem_part_number: oemPartNumber,
    interchange_number: '',
    hollander_number: '',
    placement_on_vehicle: matchedRule?.placement || 'Vehicle Specific',
    donor_vehicle_id: donor ? donor.id : null,
    fitment_years: vehicleMeta.fitment_years || (donor ? String(donor.year) : ''),
    fitment_make: vehicleMeta.fitment_make || (donor ? donor.make : ''),
    fitment_model: vehicleMeta.fitment_model || (donor ? donor.model : ''),
    fitment_engine: donor ? donor.engine : '',
    fitment_notes: fitmentNotesParts.join(' | '),
    description: descriptionParts.join(' '),
    defect_disclosure: matchedRule?.defect || 'Tested & inspected OEM assembly pulled from verified donor. Normal cosmetic wear consistent with age; see actual photos.',
    bin_location: binLocation,
    photos: localPhotos,
    photo_uids: group.photos.map((p) => p.photo_uid),
    drive_urls: driveUrls,
    pull_status: 'pulled_shelved',
    allow_self_pull: 0,
    price_self_pull: 0,
    allow_we_pull: 1,
    price_we_pull: priceWePull,
    allow_pull_install: laborHours > 0 ? 1 : 0,
    price_pull_install: pricePullInstall,
    install_labor_hours: laborHours,
    quantity: 1,
    weight_lbs: weightLbs,
    length_in: lengthIn,
    width_in: widthIn,
    height_in: heightIn,
    shipping_class: shippingClass,
    handling_fee: Number(settings.handling_fee_default ?? 10),
    handling_days: Number(settings.handling_days_default ?? 3)
  };
}

async function runKeepBatchIntakeAndPublish({
  pushShopify = true,
  baseUrl = '',
  uploadsDir = path.join(DATA_DIR, 'uploads')
} = {}) {
  const settings = getSettings();
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const keepRows = db.prepare(`
    SELECT *,
      CASE WHEN vehicle_tag_override != '' THEN vehicle_tag_override ELSE vehicle_folder END AS effective_folder
    FROM photo_review_items
    WHERE review_status = 'keep'
    ORDER BY effective_folder ASC, photo_uid ASC
  `).all();

  if (!keepRows.length) {
    return {
      ok: true,
      keep_photos_total: 0,
      part_groups_total: 0,
      skus_created: 0,
      skus_updated: 0,
      multi_angle_photos_merged: 0,
      compliance_blocked: [],
      skipped_no_photo: [],
      qr_cards_generated: 0,
      total_active_inventory_skus: db.prepare("SELECT COUNT(*) c FROM inventory_items WHERE status = 'active' AND quantity > 0").get().c,
      shopify_sync: { mode: 'skipped_empty', synced_count: 0, message: 'No KEEP photos found in 0. Photo Review yet.' },
      feeds_and_exports: buildExportLinks(baseUrl)
    };
  }

  const donors = db.prepare('SELECT * FROM donor_vehicles').all();
  const groups = groupKeepPhotosIntoParts(keepRows);
  const now = new Date().toISOString();
  const defaultChannels = JSON.stringify({
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

  // Build map of existing inventory items by SKU and by referenced photo_uid to guarantee ZERO duplicates
  const existingRows = db.prepare('SELECT * FROM inventory_items').all();
  const existingBySku = new Map();
  const existingByPhotoUid = new Map();
  for (const row of existingRows) {
    existingBySku.set(String(row.sku || '').toUpperCase(), row);
    const matches = String(row.photos_json || '').match(/P\d{4,5}/g) || [];
    for (const uid of matches) {
      existingByPhotoUid.set(uid.toUpperCase(), row);
    }
    const noteMatches = String(row.fitment_notes || '').match(/P\d{4,5}/g) || [];
    for (const uid of noteMatches) {
      existingByPhotoUid.set(uid.toUpperCase(), row);
    }
  }

  let skusCreated = 0;
  let skusUpdated = 0;
  let multiAngleMerged = 0;
  let qrGenerated = 0;
  const complianceBlocked = [];
  const skippedNoPhoto = [];
  const processedSkus = [];
  const usedSkusThisRun = new Set();

  const insertStmt = db.prepare(`
    INSERT INTO inventory_items (
      sku, title, category, condition, condition_id, brand, oem_part_number,
      interchange_number, hollander_number, placement_on_vehicle, donor_vehicle_id,
      fitment_years, fitment_make, fitment_model, fitment_engine, fitment_notes,
      description, defect_disclosure, bin_location, security_mark_code, security_mark_verified,
      photos_json, pull_status, allow_self_pull, price_self_pull, allow_we_pull, price_we_pull,
      allow_pull_install, price_pull_install, install_labor_hours, quantity,
      weight_lbs, length_in, width_in, height_in, shipping_class, handling_fee, handling_days,
      channels_json, status, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
      ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE inventory_items SET
      title = ?, category = ?, condition = ?, condition_id = ?, brand = ?,
      oem_part_number = CASE WHEN oem_part_number != '' THEN oem_part_number ELSE ? END,
      placement_on_vehicle = ?, donor_vehicle_id = COALESCE(?, donor_vehicle_id),
      fitment_years = ?, fitment_make = ?, fitment_model = ?, fitment_engine = ?, fitment_notes = ?,
      description = ?, defect_disclosure = ?, bin_location = ?, photos_json = ?,
      allow_we_pull = 1, price_we_pull = ?, allow_pull_install = ?, price_pull_install = ?,
      install_labor_hours = ?, weight_lbs = ?, length_in = ?, width_in = ?, height_in = ?,
      shipping_class = ?, handling_fee = ?, handling_days = ?, updated_at = ?
    WHERE id = ?
  `);

  db.exec('BEGIN;');
  try {
    for (const group of groups) {
      if (group.photos.length > 1) {
        multiAngleMerged += group.photos.length - 1;
      }

      const candidate = inferSpecAndBuildItem(group, donors, settings);

      // Hard compliance block check (SRS / airbag / clock spring / catalytic converter)
      const comp = validatePartCompliance({
        title: `${candidate.title} ${group.photos.map((p) => `${p.original_name} ${p.title_hint}`).join(' ')}`,
        category: candidate.category,
        description: candidate.description
      });
      if (!comp.compliant) {
        complianceBlocked.push({
          photo_uids: candidate.photo_uids,
          original_name: group.photos[0]?.original_name || '',
          matched_term: comp.matchedTerm,
          reason: comp.reason
        });
        continue;
      }

      const skuUpper = String(candidate.sku || '').toUpperCase();
      if (PROHIBITED_CAT_SKUS.has(skuUpper) || PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS.has(skuUpper)) {
        complianceBlocked.push({
          photo_uids: candidate.photo_uids,
          original_name: group.photos[0]?.original_name || candidate.sku,
          matched_term: 'Forensic Audit SRS/Catalytic SKU Blocklist',
          reason: `Hard Compliance Block: SKU ${skuUpper} is on the Forensic Audit prohibited SRS/airbag/catalytic blocklist.`
        });
        continue;
      }

      if (!candidate.photos.length) {
        skippedNoPhoto.push({
          photo_uids: candidate.photo_uids,
          original_name: group.photos[0]?.original_name || ''
        });
        continue;
      }

      // Check existing by SKU or by any already-ingested photo_uid
      let existing = existingBySku.get(candidate.sku.toUpperCase()) || null;
      if (!existing) {
        for (const uid of candidate.photo_uids) {
          if (existingByPhotoUid.has(uid.toUpperCase())) {
            existing = existingByPhotoUid.get(uid.toUpperCase());
            break;
          }
        }
      }

      if (existing) {
        // Preserve already-synced Shopify CDN URLs if present; otherwise ensure all group photo angles are attached
        let finalPhotos = candidate.photos;
        try {
          const prevPhotos = JSON.parse(existing.photos_json || '[]');
          const cdnOnly = prevPhotos.filter((u) => /^https:\/\/cdn\.shopify\.com\//i.test(String(u)));
          if (cdnOnly.length > 0) {
            finalPhotos = prevPhotos;
          }
        } catch (_) {}

        updateStmt.run(
          candidate.title, candidate.category, candidate.condition, candidate.condition_id, candidate.brand,
          candidate.oem_part_number,
          candidate.placement_on_vehicle, candidate.donor_vehicle_id,
          candidate.fitment_years, candidate.fitment_make, candidate.fitment_model, candidate.fitment_engine, candidate.fitment_notes,
          candidate.description, candidate.defect_disclosure, candidate.bin_location, JSON.stringify(finalPhotos),
          candidate.price_we_pull, candidate.allow_pull_install, candidate.price_pull_install,
          candidate.install_labor_hours, candidate.weight_lbs, candidate.length_in, candidate.width_in, candidate.height_in,
          candidate.shipping_class, candidate.handling_fee, candidate.handling_days, now,
          existing.id
        );
        skusUpdated++;
        processedSkus.push(existing.sku);
        continue;
      }

      // Guarantee unique SKU within this batch even if two misc items collided
      let finalSku = candidate.sku;
      if (usedSkusThisRun.has(finalSku.toUpperCase())) {
        finalSku = `${finalSku.slice(0, 24)}-${candidate.photo_uids[0]}`.toUpperCase();
      }
      usedSkusThisRun.add(finalSku.toUpperCase());

      const secCode = generateSecurityCode();
      insertStmt.run(
        finalSku, candidate.title, candidate.category, candidate.condition, candidate.condition_id,
        candidate.brand, candidate.oem_part_number, candidate.interchange_number, candidate.hollander_number,
        candidate.placement_on_vehicle, candidate.donor_vehicle_id,
        candidate.fitment_years, candidate.fitment_make, candidate.fitment_model, candidate.fitment_engine,
        candidate.fitment_notes, candidate.description, candidate.defect_disclosure, candidate.bin_location,
        secCode, JSON.stringify(candidate.photos),
        candidate.pull_status, candidate.allow_self_pull, candidate.price_self_pull, candidate.price_we_pull,
        candidate.allow_pull_install, candidate.price_pull_install, candidate.install_labor_hours,
        1, // STRICT single-variant 1 in stock!
        candidate.weight_lbs, candidate.length_in, candidate.width_in, candidate.height_in,
        candidate.shipping_class, candidate.handling_fee, candidate.handling_days,
        defaultChannels, now, now
      );
      skusCreated++;
      processedSkus.push(finalSku);
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  // Generate QR Info & App Cards for all processed active SKUs so Shopify gets final QR card
  for (const sku of processedSkus) {
    const item = db.prepare('SELECT * FROM inventory_items WHERE sku = ?').get(sku);
    if (item) {
      try {
        generatePartQrCardPng(item, settings, uploadsDir);
        qrGenerated++;
      } catch (_) {}
    }
  }

  let shopifySync = {
    mode: 'skipped_by_request',
    synced_count: 0,
    message: 'Skipped Shopify push by request flag.'
  };
  if (pushShopify) {
    try {
      shopifySync = await syncAllToShopifyCoMaster();
    } catch (err) {
      shopifySync = {
        mode: 'error',
        synced_count: 0,
        error: err.message,
        message: `Inventory SKUs saved locally (${skusCreated} created, ${skusUpdated} updated), but Shopify API returned: ${err.message}. You can still download the ready Shopify CSV or retry after checking Settings Vault.`
      };
    }
  }

  const activeTotals = db.prepare(`
    SELECT
      COUNT(*) AS active_count,
      SUM(CASE WHEN shipping_class = 'parcel_calculated' THEN 1 ELSE 0 END) AS parcel_count,
      SUM(CASE WHEN shipping_class != 'parcel_calculated' THEN 1 ELSE 0 END) AS local_pickup_count,
      ROUND(COALESCE(SUM(price_we_pull), 0), 2) AS total_we_pull_value,
      ROUND(COALESCE(SUM(price_pull_install), 0), 2) AS total_install_value
    FROM inventory_items
    WHERE status = 'active' AND quantity > 0
  `).get();

  logSync(
    'outbound',
    'keep_batch_intake',
    'batch_intake_publish',
    `KEEP-${keepRows.length}`,
    shopifySync.mode === 'error' ? 'partial' : 'success',
    `Converted ${keepRows.length} KEEP photos (${multiAngleMerged} extra angles merged) -> ${skusCreated} new + ${skusUpdated} updated single-variant SKUs (${complianceBlocked.length} SRS/compliance blocked). Shopify: ${shopifySync.mode} (${shopifySync.synced_count || 0} pushed).`
  );

  return {
    ok: true,
    keep_photos_total: keepRows.length,
    part_groups_total: groups.length,
    skus_created: skusCreated,
    skus_updated: skusUpdated,
    multi_angle_photos_merged: multiAngleMerged,
    compliance_blocked: complianceBlocked,
    skipped_no_photo: skippedNoPhoto,
    qr_cards_generated: qrGenerated,
    total_active_inventory_skus: Number(activeTotals?.active_count || 0),
    parcel_calculated_count: Number(activeTotals?.parcel_count || 0),
    local_pickup_only_98467_count: Number(activeTotals?.local_pickup_count || 0),
    total_we_pull_value: Number(activeTotals?.total_we_pull_value || 0),
    total_install_value: Number(activeTotals?.total_install_value || 0),
    shopify_sync: shopifySync,
    feeds_and_exports: buildExportLinks(baseUrl)
  };
}

function buildExportLinks(baseUrl = '') {
  const prefix = String(baseUrl || '').replace(/\/+$/, '');
  return {
    shopify_csv: `${prefix}/api/exports/shopify.csv`,
    google_merchant_xml: `${prefix}/api/feeds/google-merchant.xml`,
    meta_catalog_csv: `${prefix}/api/feeds/meta-catalog.csv`,
    crosslist_csv: `${prefix}/api/exports/crosslist.csv`,
    ebay_us_csv: `${prefix}/api/exports/ebay_us.csv`,
    craigslist_csv: `${prefix}/api/exports/craigslist.csv`
  };
}

module.exports = {
  parseVehicleFolder,
  groupKeepPhotosIntoParts,
  runKeepBatchIntakeAndPublish
};
