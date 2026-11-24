const { parseCsv } = require('./exporters-csv-utils');

// Verified 14-Vehicle Donor Fleet from Forensic Operational Audit (Section 2.B)
const AUDIT_DONOR_FLEET = [
  {
    stock_number: 'DV-01-FIAT12',
    vin: '3C3CFFBR7CT380721',
    year: 2012,
    make: 'Fiat',
    model: '500 Pop',
    trim: 'Pop Hatchback (Red)',
    engine: '1.4L MultiAir I4',
    transmission: '5-Speed Manual',
    drivetrain: 'FWD',
    exterior_color: 'Rosso Red',
    paint_code: 'PR1',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #1',
    status: 'active_yard',
    notes: 'Valid VIN 3C3CFFBR7CT380721. Audit note: seats NOT in confirmed 6-car seat list; clock spring ALD-E9QGQ8 & duplicate body shell ALD-WYC04P archived.'
  },
  {
    stock_number: 'DV-02-4RUN04',
    vin: 'JTEBU14R040057212',
    year: 2004,
    make: 'Toyota',
    model: '4Runner',
    trim: 'SR5 4x4 (Black)',
    engine: '4.0L 1GR-FE V6',
    transmission: 'A340F Automatic',
    drivetrain: '4WD',
    exterior_color: 'Black',
    paint_code: '202',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #2',
    status: 'active_yard',
    notes: 'Confirmed real yard donor VIN JTEBU14R040057212 (verified in Shopify Orders #1009, #1017, #1022-#1025, #1037, #1044, #1045).'
  },
  {
    stock_number: 'DV-03-FIAT15',
    vin: '3C3CFFAR2FT502634',
    year: 2015,
    make: 'Fiat',
    model: '500 Pop',
    trim: 'Pop Hatchback (White)',
    engine: '1.4L MultiAir I4',
    transmission: '5-Speed Manual',
    drivetrain: 'FWD',
    exterior_color: 'Bianco White',
    paint_code: 'PW3',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #3',
    status: 'active_yard',
    notes: 'Valid VIN 3C3CFFAR2FT502634. Rear seats ONLY in stock (front seat ALD-RXE802 archived); duplicate body shells, hoods, ECUs & cats deduplicated/archived.'
  },
  {
    stock_number: 'DV-04-TUNDRA10',
    vin: '5TFHW5F12AX134337',
    year: 2010,
    make: 'Toyota',
    model: 'Tundra',
    trim: 'Limited CrewMax 4x4',
    engine: '5.7L i-FORCE V8',
    transmission: '6-Speed Automatic',
    drivetrain: '4WD',
    exterior_color: 'Silver / Tan Leather',
    paint_code: '1D6',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #4',
    status: 'active_yard',
    notes: 'Valid VIN 5TFHW5F12AX134337. Transmission, rear differential & ALL doors SOLD (ALD-WXWTJ7 archived); cat manifold ALD-T4AOV6 archived.'
  },
  {
    stock_number: 'DV-05-FOREST98',
    vin: 'JF1SF655XWH765781',
    year: 1998,
    make: 'Subaru',
    model: 'Forester',
    trim: 'L Wagon',
    engine: '2.5L DOHC EJ25 Boxer',
    transmission: '4-Speed Automatic',
    drivetrain: 'AWD',
    exterior_color: 'Green / Gray',
    paint_code: 'OEM',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #5',
    status: 'active_yard',
    notes: 'Valid VIN JF1SF655XWH765781 (misplaced S10 VIN rows corrected). Photo-less airbag seat ALD-L3GWNO & cat exhaust ALD-WMM183 archived.'
  },
  {
    stock_number: 'DV-06-OUTBACK03',
    vin: '4S3BH686936656339',
    year: 2003,
    make: 'Subaru',
    model: 'Outback',
    trim: 'Limited Wagon',
    engine: '2.5L SOHC EJ25 Boxer',
    transmission: '5-Speed Manual',
    drivetrain: 'AWD',
    exterior_color: 'Two-Tone',
    paint_code: 'OEM',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #6',
    status: 'active_yard',
    notes: 'Valid VIN 4S3BH686936656339. Photo-less rows ALD-HCFDPM & ALD-1R4U4A plus catalytic converters ALD-3OUQD8 & ALD-PU2GWH archived.'
  },
  {
    stock_number: 'DV-07-S10-98',
    vin: '1GCCS1449WK235424',
    year: 1998,
    make: 'Chevrolet',
    model: 'S10',
    trim: 'Base Standard Cab',
    engine: '2.2L Vortec I4',
    transmission: '5-Speed Manual',
    drivetrain: 'RWD',
    exterior_color: 'Standard',
    paint_code: 'OEM',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #7',
    status: 'active_yard',
    notes: 'Valid VIN 1GCCS1449WK235424. Duplicate manual trans, ECU & rear bumper SKUs deduplicated; cat exhaust ALD-ONMP4L archived.'
  },
  {
    stock_number: 'DV-08-DAKOTA06',
    vin: '1D7HE48K56S679400',
    year: 2006,
    make: 'Dodge',
    model: 'Dakota',
    trim: 'Quad Cab 2WD',
    engine: '4.7L Magnum V8',
    transmission: 'Automatic',
    drivetrain: 'RWD',
    exterior_color: 'Standard',
    paint_code: 'OEM',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #8',
    status: 'active_yard',
    notes: 'Valid VIN 1D7HE48K56S679400. Confirmed SOLD hood, driver door panel ALD-YIS3S3, radio bezel ALD-GC27GR, radiator shroud ALD-T4F60R & seats archived.'
  },
  {
    stock_number: 'DV-09-EQUINOX16',
    vin: 'AUDIT-NO-VIN-EQX16',
    year: 2016,
    make: 'Chevrolet',
    model: 'Equinox',
    trim: 'LT / LS (White)',
    engine: '2.4L Ecotec I4',
    transmission: '6-Speed Automatic',
    drivetrain: 'FWD/AWD',
    exterior_color: 'Summit White',
    paint_code: 'GAZ',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #9',
    status: 'awaiting_vin',
    notes: 'Ghost 2015 Buick LaCrosse VIN 1G4GA5GR2FF246661 PERMANENTLY BANNED & PURGED; Equinox locked until real 17-char Equinox VIN is verified.'
  },
  {
    stock_number: 'DV-10-4RUN13',
    vin: 'JTEBU5JR5D5117391',
    year: 2013,
    make: 'Toyota',
    model: '4Runner',
    trim: 'SR5 4x4 (5th Gen)',
    engine: '4.0L 1GR-FE V6',
    transmission: '5-Speed Automatic',
    drivetrain: '4WD',
    exterior_color: 'Standard',
    paint_code: 'OEM',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #10',
    status: 'active_yard',
    notes: 'NHTSA vPIC ErrorCode 0 verified VIN JTEBU5JR5D5117391 (2013 Toyota 4Runner 4.0L V6 4WD — matched from Google Drive folder & Unified_Master_Upload.csv).'
  },
  {
    stock_number: 'DV-11-CAMRY96',
    vin: 'JT2BG12K3T0403962',
    year: 1996,
    make: 'Toyota',
    model: 'Camry',
    trim: 'Base Sedan (Confirmed 1996)',
    engine: '2.2L 5S-FE I4',
    transmission: 'Automatic (SOLD)',
    drivetrain: 'FWD',
    exterior_color: 'Standard',
    paint_code: 'OEM',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #11',
    status: 'active_yard',
    notes: 'Real VIN JT2BG12K3T0403962 restored (fake 4T1SK12E2TL038415 scrubbed). Auto trans ALD-FN19XF SOLD & archived; 12x seat SKUs collapsed to 1 front + 1 rear.'
  },
  {
    stock_number: 'DV-12-ODYSSEY01',
    vin: 'AUDIT-NO-VIN-ODY01',
    year: 2001,
    make: 'Honda',
    model: 'Odyssey',
    trim: 'Base Minivan',
    engine: '3.5L J35A1 V6',
    transmission: 'Automatic',
    drivetrain: 'FWD',
    exterior_color: 'Standard',
    paint_code: 'OEM',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #12',
    status: 'awaiting_vin',
    notes: 'Fixed "Odessey" -> "Odyssey" typo; invalid checksum VIN 5FNRL18451B072461 scrubbed — locked until real 17-char VIN is supplied.'
  },
  {
    stock_number: 'DV-13-XTERRA01',
    vin: '5N1ED28T81C544357',
    year: 2001,
    make: 'Nissan',
    model: 'Xterra',
    trim: 'XE / SE 4x4',
    engine: '3.3L VG33E V6',
    transmission: 'Automatic',
    drivetrain: '4WD',
    exterior_color: 'Standard',
    paint_code: 'OEM',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #13',
    status: 'active_yard',
    notes: 'Verified real 17-char NHTSA VIN 5N1ED28T81C544357 (fake checksum 5N1ED22Y91C504281 scrubbed).'
  },
  {
    stock_number: 'DV-14-ESCAPE01',
    vin: 'AUDIT-NO-VIN-ESC01',
    year: 2001,
    make: 'Ford',
    model: 'Escape',
    trim: 'XLT / Base 4x4 (Confirmed 2001)',
    engine: '3.0L Duratec V6',
    transmission: 'Automatic',
    drivetrain: '4WD',
    exterior_color: 'Standard',
    paint_code: 'OEM',
    mileage: 0,
    yard_row: 'Bldg B • Donor Fleet #14',
    status: 'awaiting_vin',
    notes: 'Fake Mazda-prefix VIN 4F2CU92B01KA54281 scrubbed — locked until real 17-char Ford Escape VIN is supplied.'
  }
];

// Explicit Hard-Archive SKUs from Operational Audit Section 2.B & Phase 2 Step 5
const PROHIBITED_CAT_SKUS = new Set([
  'ALD-ZFD9PQ', 'ALD-EJO3MO', 'ALD-FIR1D3', 'ALD-T4AOV6', 'ALD-GHS5WH',
  'ALD-B01ILN', 'ALD-3OUQD8', 'ALD-PU2GWH', 'ALD-WMM183', 'ALD-ONMP4L'
]);

const PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS = new Set([
  'ALD-E9QGQ8', 'ALD-BFEVH2', 'ALD-KBGEF7', 'ALD-N897ZE', 'ALD-UV7C3K',
  'ALD-C14537', 'ALD-UIG6N9', 'ALD-P9EK3B', 'ALD-EHJDO3', 'ALD-9T4S88',
  'ALD-8LUJOS', 'ALD-VSYFP4', 'ALD-DDVLKF',
  'ALD-HCFDPM', 'ALD-1R4U4A', 'ALD-L3GWNO',
  // Visually verified SRS/airbag modules & steering wheel airbag caught on photo audit:
  'ALD-9FJP71', 'ALD-EUCT8U', 'ALD-H51N50', 'ALD-IBRLF3'
]);

const CONFIRMED_SOLD_OR_GHOST_SKUS = new Set([
  // Permanently blocked sold / duplicate Subaru transmissions
  'ALD-09SUB-TRANSMISSION-A-94D1',
  'ALD-98SUB-TRANSMISSION-A-69CF',
  'ALD-98SUB-TRANSMISSION-A-5388',
  'ALD-09SUB-AUTOMATIC-TRAN-08CC',
  'ALD-98SUB-AUTOMATIC-TRAN-FFBA',
  // Non-physical service flyer accidentally ingested into parts catalog
  'ALD-KE39JK', // [SERVICE] Auto Repair Service Advertisement flyer (not a physical part)
  // Confirmed Sold Parts
  'ALD-WXWTJ7', // 2010 Tundra Front Right Door (ALL doors sold)
  'ALD-FN19XF', // 1996 Camry Engine/Auto Trans (sold)
  'ALD-HKOW5U', 'ALD-C74GDF', 'ALD-KW3SEC', 'ALD-3XSMH3', 'ALD-N705TV', // 2004 4Runner Front Seats (sold)
  'ALD-T9XQPR', 'ALD-GSSKE6', // 2004 4Runner Overhead Consoles (sold)
  'ALD-MA08N5', // 2004 4Runner Sway Bar (sold)
  'ALD-RXE802', // 2015 Fiat Front Seat (rear seats ONLY in stock)
  'ALD-YIS3S3', 'ALD-GC27GR', 'ALD-T4F60R', // 2006 Dakota Door Panel, Radio Bezel, Radiator Shroud (sold)
  // Non-existent seats (vehicles NOT on confirmed 6-car seat list)
  'ALD-GXEHSC', 'ALD-8I86HM', // 2016 Equinox seats
  'ALD-50TY17', 'ALD-88NDJ4', // 2006 Dakota seats
  'ALD-UP2L4D', 'ALD-BBVK7J', 'ALD-IX3PNC', 'ALD-VQ8X8M', 'ALD-UB9MKJ', 'ALD-ZLAAEN', 'ALD-F11RI2' // 2012 Fiat seats
]);

// Single-Assembly Duplicate Collapse Map: duplicateSku -> survivingPrimarySku (merges CDN angle photos!)
const DUPLICATE_MERGE_TO_PRIMARY = {
  // 2004 4Runner A340F Transmissions (3 -> 1)
  'ALD-7A0GMY': 'ALD-TEOZ5N',
  'ALD-ZG70ZX': 'ALD-TEOZ5N',
  // 2004 4Runner Hood Latch (2 -> 1)
  'ALD-MOM12O': 'ALD-GCL91V',
  // 2012 Fiat Body Shells (2 -> 1) & Wiper Linkage (2 -> 1)
  'ALD-WYC04P': 'ALD-YSLJ9V',
  'ALD-K9BBNB': 'ALD-URESQF',
  // 2015 Fiat Body Shells (3 -> 1), Hoods (2 -> 1), ECUs (2 -> 1)
  'ALD-GDGG7Z': 'ALD-GJX0UV',
  'ALD-7AOM2M': 'ALD-GJX0UV',
  'ALD-POZ447': 'ALD-FOVXNN',
  'ALD-LF1U7I': 'ALD-HWMRIM',
  // 2012/2013 4Runner Transmission Oil Pans (2 -> 1)
  'ALD-ZH0C79': 'ALD-75YT9N',
  // 1998 Chevy S10 Manual Transmissions, ECUs & Rear Bumpers
  'ALD-UHFXBM': 'ALD-8CSMID',
  'ALD-1UK1V6': 'ALD-ZV8XDH',
  'ALD-4AJEN8': 'ALD-RU47HH',
  // 2015 Fiat Rear Seats (3 -> 1)
  'ALD-7ZJT78': 'ALD-QNBBDD',
  'ALD-EWRJH5': 'ALD-QNBBDD',
  // 2012/2013 4Runner Rear Seats (8 -> 1, keep ALD-DK8EDP $350; keep front ALD-U6F7QY)
  'ALD-QD9XEH': 'ALD-DK8EDP',
  'ALD-YT930B': 'ALD-DK8EDP',
  'ALD-74X2OH': 'ALD-DK8EDP',
  'ALD-FQE9LP': 'ALD-DK8EDP',
  'ALD-RT5G6B': 'ALD-DK8EDP',
  'ALD-0YLXYI': 'ALD-DK8EDP',
  'ALD-RLKJ35': 'ALD-DK8EDP',
  // 2004 4Runner 2nd-Row Rear Seats (13 -> 1, keep ALD-X9DV4F $350)
  'ALD-VZAPCP': 'ALD-X9DV4F',
  'ALD-95CL32': 'ALD-X9DV4F',
  'ALD-GKOCGQ': 'ALD-X9DV4F',
  'ALD-VRKJCO': 'ALD-X9DV4F',
  'ALD-FP3SG3': 'ALD-X9DV4F',
  'ALD-GSHYZR': 'ALD-X9DV4F',
  'ALD-U6ET6F': 'ALD-X9DV4F',
  'ALD-DI52YO': 'ALD-X9DV4F',
  'ALD-Q9YFW9': 'ALD-X9DV4F',
  'ALD-MQNR02': 'ALD-X9DV4F',
  'ALD-4N1M48': 'ALD-X9DV4F',
  'ALD-J2KDKE': 'ALD-X9DV4F',
  // 2003 Subaru Outback Front Seats (keep ALD-RG2JBP) & Rear Seats (keep ALD-DTWY63)
  'ALD-GWSZH8': 'ALD-RG2JBP',
  'ALD-8B9BZA': 'ALD-DTWY63',
  'ALD-1TS4VI': 'ALD-DTWY63',
  'ALD-0BJ7HL': 'ALD-DTWY63',
  'ALD-6GQLI3': 'ALD-DTWY63',
  // 1998 Subaru Forester Front Seats (keep ALD-F5ANI8) & Rear Seats (keep ALD-DJWYZO)
  'ALD-A0PGVN': 'ALD-F5ANI8',
  'ALD-GRYQ4C': 'ALD-F5ANI8',
  'ALD-CS1EMQ': 'ALD-F5ANI8',
  'ALD-Z9TU3X': 'ALD-F5ANI8',
  'ALD-AUC9C2': 'ALD-DJWYZO',
  // 1996 Toyota Camry Front Seats (keep ALD-5AA22T) & Rear Seats (keep ALD-QSKBB1)
  'ALD-DM0QGG': 'ALD-5AA22T',
  'ALD-D86TRL': 'ALD-5AA22T',
  'ALD-8TJ7KW': 'ALD-5AA22T',
  'ALD-J07HBZ': 'ALD-QSKBB1',
  'ALD-EGMAMZ': 'ALD-QSKBB1',
  'ALD-2KXI2B': 'ALD-QSKBB1',
  'ALD-Q4BREJ': 'ALD-QSKBB1',
  'ALD-M3WUC9': 'ALD-QSKBB1',
  'ALD-SY2LGZ': 'ALD-QSKBB1',
  'ALD-PQK93T': 'ALD-QSKBB1'
};

// Detects Gemini's Jul 24 counterfeit sequential MPNs across legacy rows (while allowing clean structured OEM-<YEAR><MAKE>-<PARTCODE>)
const COUNTERFEIT_MPN_REGEX = /^(GM80\d+|FT50\d+|SU\d+(?:AA)?|OEM-\d+|5101\d+(?:AA)?|75\d{2,4}-\d{4,5})$/i;
const STRUCTURED_OEM_MPN_REGEX = /^OEM-(?:19|20)\d{2}[A-Z]{2,5}-[A-Z0-9]{2,14}$/i;

// Fake / Wrong-Car VINs to scrub from HTML bodies
const INVALID_VINS = [
  '1G4GA5GR2FF246661', // Permanently banned ghost 2015 Buick LaCrosse / Verano on 2016 Equinox
  '5FNRL18451B072461', // Invalid checksum on 2001 Odyssey
  '5N1ED22Y91C504281', // Invalid checksum on 2001 Xterra
  '4F2CU92B01KA54281'  // Fake Mazda WMI on 2001 Ford Escape
];

function isCounterfeitMpn(mpn) {
  if (!mpn) return false;
  const s = String(mpn).trim();
  if (STRUCTURED_OEM_MPN_REGEX.test(s)) return false;
  return COUNTERFEIT_MPN_REGEX.test(s);
}

function isGoogleDriveViewerUrl(url) {
  if (!url) return false;
  return /drive\.google\.com\/(file\/d\/|open\?id=)/i.test(String(url));
}

function cleanListingTitle(rawTitle) {
  if (!rawTitle) return '';
  let t = String(rawTitle).trim();
  // Fix known vehicle typos & model-year errors from Audit Section 2.B
  t = t.replace(/\bOdessey\b/gi, 'Odyssey');
  t = t.replace(/\b1998\s+Toyota\s+Camry\b/gi, '1996 Toyota Camry');
  t = t.replace(/\b2002\s+Ford\s+Escape\b/gi, '2001 Ford Escape');
  t = t.replace(/\bs10\b/g, 'S10');
  // Strip counterfeit sequential MPNs injected into titles e.g. "(FT50005544)"
  t = t.replace(/\(\s*(GM80\d+|FT50\d+|SU\d+(?:AA)?|OEM-\d+|5101\d+(?:AA)?|75\d{2,4}-\d{4,5})\s*\)/gi, '');
  const wasClipped = /\.{2,}$/.test(t);
  // Strip trailing ellipsis
  t = t.replace(/\.{2,}$/g, '').trim();
  // Strip " - Local Pickup Only" suffix even when truncated to "- Lo", "- L", or "-"
  t = t.replace(/\s*-\s*(?:Local(?:\s+Pickup(?:\s+Only)?)?|Lo[a-z]*|L)?$/i, '').trim();

  // Convert "Parting Out [Vehicle] : [Part]" -> "[Year Make Model] [Part] OEM"
  if (/^Parting Out\s+/i.test(t) && t.includes(':')) {
    const idx = t.indexOf(':');
    let veh = t.slice(0, idx).replace(/^Parting Out\s+/i, '').trim();
    let part = t.slice(idx + 1).trim();

    if (wasClipped) {
      part = part
        // Strip dangling clipped prepositions/conjunctions ("with ...", "wi...", "and ...", "an...")
        .replace(/\s+(?:with|wit|wi|w)\s+\S{1,5}$/i, (m) => {
          if (/with\s+Fu$/i.test(m)) return ' with Fuse Box';
          if (/with\s+Oxyge$/i.test(m)) return ' with O2 Sensor';
          if (/with\s+Hea$/i.test(m)) return ' with Headrests';
          if (/with\s+Ti$/i.test(m)) return ' with Tip';
          if (/with\s+Tran$/i.test(m)) return ' with Transfer Case';
          return '';
        })
        .replace(/\s+(?:with|wit|wi|w|and|an|for|w\/|\()$/i, '')
        // Restore clipped compound automotive phrases first
        .replace(/\bAssemb(?:l)?$/i, 'Assembly')
        .replace(/\bAssem$/i, 'Assembly')
        .replace(/\bAsse$/i, 'Assembly')
        .replace(/\bAss$/i, 'Assembly')
        .replace(/\b(Vent|Tube|Shifter|Bumper|Cleaner)\s+As?$/i, '$1 Assembly')
        .replace(/\b(Bezel|Panel|Linkage|Support|Box|Cluster)\s+As(?:s)?$/i, '$1 Assembly')
        .replace(/\bInstrument\s+Cl(?:us(?:t(?:e)?)?)?$/i, 'Instrument Cluster')
        .replace(/\bControl\s+Modu(?:l)?$/i, 'Control Module')
        .replace(/\bControl\s+Un(?:i)?$/i, 'Control Unit')
        .replace(/\bControl\s+U$/i, 'Control Unit')
        .replace(/\bPowertrain\s+Co(?:ntro)?$/i, 'Powertrain Control Module')
        .replace(/\bEngine\s+Contro$/i, 'Engine Control Module')
        .replace(/\bBody\s+Contro$/i, 'Body Control Module')
        .replace(/\bManual\s+Transm(?:iss)?$/i, 'Manual Transmission')
        .replace(/\bAutomatic\s+Transm(?:iss)?$/i, 'Automatic Transmission')
        .replace(/\bMaster\s+Cyl(?:i(?:n(?:de)?)?)?$/i, 'Master Cylinder')
        .replace(/\bCylinder\s+and\s+B$/i, 'Cylinder and Booster')
        .replace(/\bShock\s+Absorber\s+and\s+Coi$/i, 'Shock and Coil Spring')
        .replace(/\bStrut\s+and\s+Coil$/i, 'Strut and Coil Spring')
        .replace(/\bSound\s+De$/i, 'Sound Deadener')
        .replace(/\bCombination\s+S(?:w)?$/i, 'Combination Switch')
        .replace(/\bMulti-Function\s+Combination$/i, 'Combination Switch')
        .replace(/\bSteering\s+Column\s+Combination$/i, 'Column Switch')
        .replace(/\bSteering\s+Col$/i, 'Steering Column')
        .replace(/\bPower\s+Steerin$/i, 'Power Steering Pump')
        .replace(/\bPower\s+Steering\s+F$/i, 'Power Steering Reservoir')
        .replace(/\bDriver\s+Side\s+Stee$/i, 'Steering Knuckle')
        .replace(/\bFront\s+Left\s+Dr$/i, 'Front Left Door')
        .replace(/\bDriver\s+Side\s+D$/i, 'Driver Side Door')
        .replace(/\bFuel\s+Filler\s+D$/i, 'Fuel Filler Door')
        .replace(/\bGlove\s+Box\s+Doo$/i, 'Glove Box Door')
        .replace(/\bGlove\s+Box\s+Com$/i, 'Glove Box')
        .replace(/\bSide\s+Doo$/i, 'Side Door')
        .replace(/\bDoor\s+Sh(?:e)?$/i, 'Door Shell')
        .replace(/\bCup\s+Holder\s+T$/i, 'Cup Holder Trim')
        .replace(/\bLower\s+Dash\s+Tr$/i, 'Lower Dash Trim')
        .replace(/\bTrim\s+Pa$/i, 'Trim Panel')
        .replace(/\b(?:Door|Glass|Side)\s+Pa$/i, (m) => `${m.slice(0, -2)}Panel`)
        .replace(/\bPillar\s+Tri$/i, 'Pillar Trim')
        .replace(/\bCowl\s+Vent\s+Gri$/i, 'Cowl Vent Grille')
        .replace(/\bWindshield\s+Wi$/i, 'Windshield Wiper Linkage')
        .replace(/\bWindshield\s+Co$/i, 'Windshield Cowl')
        .replace(/\bExhaust\s+Hange$/i, 'Exhaust Hanger')
        .replace(/\bExhaust\s+Syste$/i, 'Exhaust System')
        .replace(/\bNavigation\s+Syste$/i, 'Navigation System')
        .replace(/\bSubwoofer\s+Enclos$/i, 'Subwoofer Enclosure')
        .replace(/\bAir\s+Filter\s+Housi$/i, 'Air Filter Housing')
        .replace(/\bHeater\s+Bo$/i, 'Heater Box')
        .replace(/\bShifter\s+Bo$/i, 'Shifter Boot')
        .replace(/\bMount\s+Brack$/i, 'Mount Bracket')
        .replace(/\bOwner's\s+Manual\s+Se$/i, "Owner's Manual Set")
        .replace(/\bTurn\s+Signal\s+Ligh$/i, 'Turn Signal Light')
        .replace(/\bFan\s+and\s+Shr$/i, 'Fan and Shroud')
        .replace(/\bFan\s+Sp$/i, 'Fan Speed Resistor')
        .replace(/\bEngine\s+Cooling\s+F$/i, 'Engine Cooling Fan')
        .replace(/\bRadiator\s+Cool$/i, 'Radiator Cooling Fan')
        .replace(/\bEngine\s+Coolan$/i, 'Engine Coolant Reservoir')
        .replace(/\bWasher\s+Fluid$/i, 'Washer Fluid Reservoir')
        .replace(/\bFront\s+Wheel\s+H$/i, 'Front Wheel Hub')
        .replace(/\bTruck\s+Bed\s+Sid$/i, 'Truck Bed Side Panel')
        .replace(/\bTruck\s+Front\s+Chas$/i, 'Front Chassis Frame')
        .replace(/\bEvaporative\s+Emis$/i, 'Evap Charcoal Canister')
        .replace(/\bBrake\s+Roto$/i, 'Brake Rotor')
        .replace(/\bFender\s+Lin$/i, 'Fender Liner')
        .replace(/\bRight\s+Fend$/i, 'Right Fender')
        .replace(/\bFrame\s+Sect(?:i)?$/i, 'Frame Section')
        .replace(/\bEnd\s+Body\s+F$/i, 'Front Body Frame')
        .replace(/\bRight\s+Pass$/i, 'Right Passenger Seat')
        .replace(/\bControl\s+Ar$/i, 'Control Arm')
        .replace(/\bLower\s+Contr?$/i, 'Lower Control Arm')
        .replace(/\bCab\s+Interio$/i, 'Cab Interior Trim')
        .replace(/\bWindow\s+Glas$/i, 'Window Glass')
        .replace(/\bInterior\s+Rearvie$/i, 'Rearview Mirror')
        .replace(/\bJack\s+Tool\s+K$/i, 'Jack Tool Kit')
        .replace(/\bStrut\s+Knuc$/i, 'Strut Knuckle')
        .replace(/\bFixed\s+W$/i, 'Fixed Window Glass')
        .replace(/\bDriver\s+Side\s+Fixed$/i, 'Driver Quarter Glass')
        .replace(/\bRear\s+Sliding$/i, 'Rear Sliding Window')
        .replace(/\bBeze?$/i, 'Bezel')
        .replace(/\bPane?$/i, 'Panel')
        .replace(/\bDispla$/i, 'Display')
        .replace(/\bSteering\s+Whee$/i, 'Steering Wheel')
        .replace(/\bPassenger\s+Sea$/i, 'Passenger Seat')
        .replace(/\bCar\s+Se$/i, 'Car Seat')
        .replace(/\bFront\s+Passeng$/i, 'Front Passenger Seat')
        .replace(/\bCalipe$/i, 'Caliper')
        .replace(/\bCove$/i, 'Cover')
        .replace(/\bReser(?:v(?:o(?:i)?)?)?$/i, 'Reservoir')
        .replace(/\bRese?$/i, 'Reservoir')
        .replace(/\bManifo(?:l)?$/i, 'Manifold')
        .replace(/\bFuel\s+R$/i, 'Fuel Rail')
        .replace(/\(Tan$/i, 'Tan')
        .replace(/\s+(?:with|and|for|w\/|\()$/i, '')
        .replace(/\s*-\s*$/g, '')
        .trim();
    }

    // Shorten verbose trim clutter so part name always fits inside 80-char eBay Motors limit
    veh = veh
      .replace(/\bPop Manual Base Model\b/gi, 'Pop')
      .replace(/\bManual Base Model Standard Cab\b/gi, '')
      .replace(/\bV8 Limited Crewmax 4x4 Auto\b/gi, 'CrewMax 5.7L 4x4')
      .replace(/\bLimited AWD Manual\b/gi, 'AWD')
      .replace(/\bBase Automatic\b/gi, '2.2L')
      .replace(/\bBase 4x4 Auto\b/gi, '4x4')
      .replace(/\bSR5 4x4 V6\b/gi, 'SR5 4x4')
      .replace(/\bL AWD Auto\b/gi, 'AWD')
      .replace(/\b2WD QuadCab Auto\b/gi, 'Quad Cab')
      .replace(/\bBase\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const combined = `${veh} ${part}`;
    t = /\bOEM\b/i.test(combined) ? combined : `${combined} OEM`;
  }

  t = t.replace(/\(\s*([A-Za-z0-9 ]+)$/, '$1').replace(/\s{2,}/g, ' ').trim();
  if (t.length > 80) {
    t = t.slice(0, 80).replace(/\s+\S*$/, '').trim();
  }
  return t;
}

function sanitizeHtmlBody(rawHtml, cleanTitle) {
  if (!rawHtml) return '';
  let html = String(rawHtml);
  // Rebrand legacy business name to Aldridge Auto's
  html = html.replace(/Aldridge Auto's (Service|Sales)\s*(&amp;|&)\s*Repair/gi, "Aldridge Auto's");
  html = html.replace(/\bOdessey\b/gi, 'Odyssey');
  // Replace H1 "Parting Out ..." with clean title
  html = html.replace(/<h1([^>]*)>[\s\S]*?<\/h1>/i, `<h1$1>${cleanTitle}</h1>`);
  // Scrub counterfeit MPN line in HTML
  html = html.replace(
    /(<b>Part Number:<\/b>\s*<span[^>]*>)\s*(GM80\d+|FT50\d+|SU\d+(?:AA)?|OEM-\d+|5101\d+(?:AA)?|75\d{2,4}-\d{4,5})\s*(<\/span>)/gi,
    '$1Verify Stamped OEM # in Photos$3'
  );
  // Restore real 1996 Camry VIN
  if (/1996 Toyota Camry|1998 Toyota Camry/i.test(html)) {
    html = html.replace(/4T1SK12E2TL038415/g, 'JT2BG12K3T0403962');
  }
  // Fix misplaced S10 VIN inside Forester descriptions
  if (/Subaru Forester/i.test(html)) {
    html = html.replace(/1GCCS1449WK235424/g, 'JF1SF655XWH765781');
  }
  // Fix misplaced Camry VIN inside 2004 4Runner descriptions
  if (/2004 Toyota 4Runner/i.test(html)) {
    html = html.replace(/4T1SK12E2TL038415/g, 'See Donor Stock DV-02-4RUN04');
  }
  // Scrub invalid / wrong-car VINs
  for (const badVin of INVALID_VINS) {
    html = html.replaceAll(badVin, 'Verified Yard Donor (Contact w/ VIN to Confirm)');
  }
  return html;
}

function healWeightAndShipping(title, currentGrams, currentRequiresShipping) {
  const t = (title || '').toLowerCase();
  const grams = Math.round(Number(currentGrams || 0));

  // 1. Small engine/transmission/hood subcomponents falsely locked at 68,038g (150lb) or 18,144g (40lb)
  const isSmallSubpart = /\b(control module|ecu|ecm|pcm|tcm|immobilizer|wiring harness|fuse box|relay|sensor|solenoid|engine cover|shifter cable|shifter assembly|oil pan|transmission pan|engine mount|transmission mount|support bracket|hood latch|hood hinge|hood release|hood lift|hood cowl|door handle|door lock|door switch|window switch|mirror switch|seat switch|seat release|seat adjustment)\b/i.test(t);
  if (isSmallSubpart && (grams >= 18000 || String(currentRequiresShipping).toLowerCase() === 'false')) {
    const healedGrams = /\b(wiring harness|mount|oil pan|transmission pan|shifter assembly)\b/i.test(t) ? 4536 : 2268; // 10 lb or 5 lb
    return { grams: healedGrams, requiresShipping: 'true', healedReason: 'unlocked_small_part_from_heavy_trap' };
  }

  // 2. Oversized / Local-Pickup-Only structural assemblies falsely set to 907g (2.0 lbs)
  const isOversizedLocal = /\b(body shell|chassis|truck bed|quarter panel|roof panel|complete door|door shell|front door|rear door|sliding window|dashboard|dashboard assembly|seat set|bench seat|bucket seat|front seat|rear seat|passenger seat|driver seat|car seat|second row|running board|subframe|bumper assembly|front bumper|rear bumper|car hood|\bhood\b)\b/i.test(t) &&
    !isSmallSubpart &&
    !/\b(door panel|dash bezel|dash trim|dash control|dashboard bezel|dashboard panel|dashboard air|trim|bezel|handle|speaker|mirror|latch|hinge|cover|cushion)\b/i.test(t);

  if (isOversizedLocal && grams <= 3628) {
    return { grams: 34019, requiresShipping: 'false', healedReason: 'fixed_2lb_heavy_body_or_seat_to_local_freight' };
  }

  // 3. Medium mechanical assemblies (15-32 lbs) falsely set to 907g (2.0 lbs)
  const isMediumMechanical = /\b(alternator|starter|compressor|power steering pump|radiator|condenser|strut|shock|drive shaft|driveshaft|cv axle|axle shaft|steering rack|brake caliper|brake booster|wiper transmission|cylinder head|intake manifold|exhaust manifold|door panel)\b/i.test(t);
  if (isMediumMechanical && grams <= 1814) {
    return { grams: 9072, requiresShipping: 'true', healedReason: 'fixed_2lb_mechanical_part_to_20lb_parcel' };
  }

  return {
    grams: grams > 0 ? grams : 3628,
    requiresShipping: String(currentRequiresShipping || 'true').toLowerCase() === 'false' ? 'false' : 'true',
    healedReason: null
  };
}

function parseVehicleFitmentFromTitle(cleanTitle) {
  const m = cleanTitle.match(/^((?:19|20)\d{2})\s+(Toyota|Fiat|Chevrolet|Chevy|Subaru|Dodge|Honda|Nissan|Ford)\s+([A-Za-z0-9]+)/i);
  if (!m) return { year: '', make: '', model: '' };
  const make = m[2].toLowerCase() === 'chevy' ? 'Chevrolet' : m[2];
  return { year: m[1], make, model: m[3] };
}

function csvEscapeCell(val) {
  const s = val === null || val === undefined ? '' : String(val);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Deterministic Photo-Preserving Shopify Export Sanitizer
 * Implements Phase 2 Steps 5 & 6 of operational_audit.md without losing a single secondary CDN angle photo.
 */
function sanitizeShopifyExportCsv(csvText) {
  const { headers, rows } = parseCsv(csvText, { includeHeaders: true });
  if (!rows.length) {
    return { sanitizedCsv: '', stats: { error: 'Empty CSV' }, cleanActiveItems: [] };
  }

  // Group rows by Handle to preserve every primary + secondary CDN photo
  const groups = new Map();
  const handleOrder = [];
  for (const row of rows) {
    const h = (row.Handle || '').trim();
    if (!h) continue;
    if (!groups.has(h)) {
      groups.set(h, { primary: null, secondaries: [] });
      handleOrder.push(h);
    }
    const g = groups.get(h);
    if (row.Title && !g.primary) {
      g.primary = { ...row };
    } else {
      g.secondaries.push({ ...row });
    }
  }

  // Map SKU -> Handle so duplicate SKUs can donate their CDN photos to the surviving primary SKU
  const skuToHandle = new Map();
  for (const [h, g] of groups.entries()) {
    if (g.primary && g.primary['Variant SKU']) {
      skuToHandle.set(g.primary['Variant SKU'].trim().toUpperCase(), h);
    }
  }

  const stats = {
    input_total_rows: rows.length,
    input_unique_handles: groups.size,
    input_secondary_photo_rows: rows.length - groups.size,
    archived_catalytic: 0,
    archived_srs_or_missing_photo: 0,
    archived_sold_or_ghost: 0,
    archived_duplicates_merged: 0,
    merged_angle_photos_saved: 0,
    draft_laundered_trim_hold: 0,
    counterfeit_mpns_wiped: 0,
    weights_healed_small_150lb: 0,
    weights_healed_heavy_2lb: 0,
    weights_healed_medium_2lb: 0,
    titles_cleaned_parting_out: 0,
    surviving_active_products: 0,
    output_total_rows: 0
  };

  // First pass: merge duplicate assembly CDN photos onto their surviving primary handle
  for (const [dupSku, targetSku] of Object.entries(DUPLICATE_MERGE_TO_PRIMARY)) {
    const dupH = skuToHandle.get(dupSku);
    const targetH = skuToHandle.get(targetSku);
    if (!dupH || !targetH || dupH === targetH) continue;
    const dupGroup = groups.get(dupH);
    const targetGroup = groups.get(targetH);
    if (!dupGroup?.primary || !targetGroup?.primary) continue;

    const existingUrls = new Set(
      [targetGroup.primary['Image Src'], ...targetGroup.secondaries.map((s) => s['Image Src'])].filter(Boolean)
    );
    const donorUrls = [dupGroup.primary['Image Src'], ...dupGroup.secondaries.map((s) => s['Image Src'])].filter(
      (u) => u && !isGoogleDriveViewerUrl(u) && !existingUrls.has(u)
    );

    for (const url of donorUrls) {
      const blankSec = {};
      headers.forEach((col) => { blankSec[col] = ''; });
      blankSec.Handle = targetH;
      blankSec['Image Src'] = url;
      blankSec['Image Position'] = String(targetGroup.secondaries.length + 2);
      blankSec['Image Alt Text'] = targetGroup.primary.Title || targetSku;
      targetGroup.secondaries.push(blankSec);
      existingUrls.add(url);
      stats.merged_angle_photos_saved++;
    }
  }

  const explicitSrsRegex = /\b(air\s*bag|airbag|clock\s*spring|clockspring|seat\s*belt|seatbelt|srs|pretensioner|inflator)\b/i;
  const launderedTrimRegex = /trim panel module|trim component/i;
  const catKeywordRegex = /\b(catalytic|cat\s+converter|manifold\s+with\s+cat)\b/i;

  const outLines = [headers.map(csvEscapeCell).join(',')];
  const cleanActiveItems = [];

  for (const h of handleOrder) {
    const g = groups.get(h);
    if (!g.primary) continue;
    const p = g.primary;
    const sku = (p['Variant SKU'] || h).trim().toUpperCase();
    const origTitle = p.Title || '';
    const origBody = p['Body (HTML)'] || '';

    // 1. Clean title & HTML body + wipe counterfeit sequential MPNs
    const cleanedTitle = cleanListingTitle(origTitle);
    if (cleanedTitle !== origTitle) stats.titles_cleaned_parting_out++;
    p.Title = cleanedTitle;
    p['Body (HTML)'] = sanitizeHtmlBody(origBody, cleanedTitle);
    p.Vendor = "Aldridge Auto's";

    if (isCounterfeitMpn(p['Google Shopping / MPN'])) {
      p['Google Shopping / MPN'] = '';
      stats.counterfeit_mpns_wiped++;
    }
    if (isGoogleDriveViewerUrl(p['Image Src'])) {
      p['Image Src'] = '';
    }

    // 2. Heal inverted weights
    const weightRes = healWeightAndShipping(cleanedTitle, p['Variant Grams'], p['Variant Requires Shipping']);
    p['Variant Grams'] = String(weightRes.grams);
    p['Variant Requires Shipping'] = weightRes.requiresShipping;
    if (weightRes.healedReason === 'unlocked_small_part_from_heavy_trap') stats.weights_healed_small_150lb++;
    if (weightRes.healedReason === 'fixed_2lb_heavy_body_or_seat_to_local_freight') stats.weights_healed_heavy_2lb++;
    if (weightRes.healedReason === 'fixed_2lb_mechanical_part_to_20lb_parcel') stats.weights_healed_medium_2lb++;

    // 3. Determine Compliance / Sold / Duplicate / Laundered Status
    let archiveReason = null;
    if (PROHIBITED_CAT_SKUS.has(sku) || catKeywordRegex.test(`${origTitle} ${origBody}`)) {
      archiveReason = 'PROHIBITED_CATALYTIC_CONVERTER';
      stats.archived_catalytic++;
    } else if (
      PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS.has(sku) ||
      !p['Image Src'] ||
      explicitSrsRegex.test(`${origTitle} ${origBody}`)
    ) {
      archiveReason = 'PROHIBITED_SRS_OR_NO_PHOTO';
      stats.archived_srs_or_missing_photo++;
    } else if (CONFIRMED_SOLD_OR_GHOST_SKUS.has(sku)) {
      archiveReason = 'CONFIRMED_SOLD_OR_GHOST_STOCK';
      stats.archived_sold_or_ghost++;
    } else if (DUPLICATE_MERGE_TO_PRIMARY[sku]) {
      archiveReason = `DUPLICATE_MERGED_INTO_${DUPLICATE_MERGE_TO_PRIMARY[sku]}`;
      stats.archived_duplicates_merged++;
    }

    if (archiveReason) {
      p.Status = 'archived';
      p.Published = 'false';
      p['Variant Inventory Qty'] = '0';
      p.Tags = [p.Tags, `AUDIT:${archiveReason}`].filter(Boolean).join(', ');
    } else if (launderedTrimRegex.test(origBody)) {
      p.Status = 'draft';
      p.Published = 'false';
      p.Tags = [p.Tags, 'AUDIT:STAFF_SRS_PHOTO_REVIEW_HOLD'].filter(Boolean).join(', ');
      stats.draft_laundered_trim_hold++;
    } else {
      p.Status = 'active';
      p.Published = 'true';
      stats.surviving_active_products++;

      const allPhotos = [
        p['Image Src'],
        ...g.secondaries.map((s) => s['Image Src']).filter((u) => u && !isGoogleDriveViewerUrl(u))
      ].filter(Boolean);
      const fit = parseVehicleFitmentFromTitle(cleanedTitle);
      cleanActiveItems.push({
        sku,
        handle: h,
        title: cleanedTitle,
        description: p['Body (HTML)'],
        price_we_pull: parseFloat(p['Variant Price'] || '0') || 0,
        weight_lbs: Number((weightRes.grams / 453.592).toFixed(1)),
        requires_shipping: weightRes.requiresShipping === 'true',
        oem_part_number: p['Google Shopping / MPN'] || '',
        photos: allPhotos,
        fitment_years: fit.year,
        fitment_make: fit.make,
        fitment_model: fit.model,
        tags: p.Tags || ''
      });
    }

    // Emit Primary Row
    outLines.push(headers.map((col) => csvEscapeCell(p[col] ?? '')).join(','));
    stats.output_total_rows++;

    // Emit Strictly Clean Secondary Image Rows (ONLY Handle, Image Src, Image Position, Image Alt Text)
    g.secondaries.forEach((sec, idx) => {
      const imgUrl = (sec['Image Src'] || '').trim();
      if (!imgUrl || isGoogleDriveViewerUrl(imgUrl)) return;
      const cleanSec = {};
      headers.forEach((col) => { cleanSec[col] = ''; });
      cleanSec.Handle = h;
      cleanSec['Image Src'] = imgUrl;
      cleanSec['Image Position'] = String(idx + 2);
      cleanSec['Image Alt Text'] = cleanedTitle.slice(0, 70);
      outLines.push(headers.map((col) => csvEscapeCell(cleanSec[col])).join(','));
      stats.output_total_rows++;
    });
  }

  return {
    sanitizedCsv: outLines.join('\n') + '\n',
    stats,
    cleanActiveItems
  };
}

const DIRECT_PUNCH_LIST = [
  {
    phase: 'Phase 1 (Today — 45m)',
    step: 1,
    key: 'wa_ag_meta_reply',
    title: 'Reply to WA Attorney General / Meta Escalations (File #730525 / Meta Case C#26046204)',
    detail: 'Email CRC@ATG.WA.GOV with: (1) paloozabooking@gmail.com, (2) a brand-new email never linked to Meta, and (3) exact Facebook profile URL to unlock Personal FB Marketplace.'
  },
  {
    phase: 'Phase 1 (Today — 45m)',
    step: 2,
    key: 'ebay_aabcas_hold_check',
    title: 'Verify eBay AABCAS Selling Hold Cleared (SR: 1-509601062469)',
    detail: 'Check Seller Hub -> Overview on AABCAS to confirm the Oct 14 balance payment lifted the Oct 15 restriction; request callback citing SR 1-509601062469 if banner remains.'
  },
  {
    phase: 'Phase 1 (Today — 45m)',
    step: 3,
    key: 'manual_partout_ads',
    title: 'Post 8 Active Donor Vehicle Part-Out Ads Manually on Craigslist (pta) & OfferUp',
    detail: 'Zero CSV needed: post vehicle part-out ads on Craigslist Seattle-Tacoma (keep phone/address in contact fields, not body) and OfferUp with raw local photos.'
  },
  {
    phase: 'Phase 2 (Day 1 — 60m)',
    step: 4,
    key: 'shopify_fresh_backup',
    title: 'Export Untouched Plain-CSV Backup from Shopify (aldridge-auto-service-repair)',
    detail: 'Products -> Export -> All products -> Plain CSV. Never open in Excel without Plain Text import.'
  },
  {
    phase: 'Phase 2 (Day 1 — Automated)',
    step: 5,
    key: 'shopify_compliance_sold_purge',
    title: 'Archive Cats, SRS/Airbags, Sold Stock & Collapse Multi-SKU Duplicates (Automated)',
    detail: 'Executed automatically by src/audit-sanitizer.js while merging extra angle CDN URLs onto surviving SKUs.'
  },
  {
    phase: 'Phase 2 (Day 1 — Automated)',
    step: 6,
    key: 'shopify_upload_sanitized_csv',
    title: 'Upload Photo-Preserving Sanitized Shopify CSV (100% Fake MPNs Wiped + Weights Healed)',
    detail: 'Download /api/audit/sanitized-shopify.csv (all secondary CDN photo rows preserved with blank Option1/Price) and import into Shopify.'
  },
  {
    phase: 'Phase 3 (Day 2)',
    step: 7,
    key: 'ebay_418_sku_reconcile',
    title: 'Reconcile 418 Legacy Gen-1 eBay AABCAS Listings Before Turning On Shopify Marketplace Connect',
    detail: 'End sold + 8 SRS items on eBay; align Custom Label SKUs or end Other (6755) orphans, then push clean batches of 25–50 via Shopify Marketplace Connect (NEVER Crosslist).'
  },
  {
    phase: 'Phase 4 (Day 3+)',
    step: 8,
    key: 'recover_546_4runner_cdn',
    title: 'Restore ~546 Stranded 2004 & 2012 Toyota 4Runner CDN-Hosted Parts (May 1 & May 27 Exports)',
    detail: 'Filter against sold/SRS/cat blocklists, preserve 377 real OCR MPNs from May 1 export, and import in <=400-row batches.'
  },
  {
    phase: 'Phase 4 (Ongoing)',
    step: 9,
    key: 'clear_oct15_and_tundra_queue',
    title: 'List 6 Oct 15 Items + 26 Tundra Parts w/ Raw JPGs (SKU.1.jpg Dots Only) & Y813BT 4x6 Labels',
    detail: 'Never use Google Drive viewer URLs; upload raw photos via Shopify Mobile or BL Bulk Image Uploader (SKU.1.jpg) and print 4x6 Y813BT bin labels.'
  },
  {
    phase: 'Phase 4 (Daily)',
    step: 10,
    key: 'daily_local_heavy_drip',
    title: 'Drip-Post 10–15 High-Value Heavy Parts (>$100) Daily to OfferUp & Craigslist',
    detail: 'Post doors, beds, transmissions, and wheel sets locally while WA AG / Meta Case C#26046204 restores Personal FB Marketplace.'
  }
];

function generateDraftTrimHoldsCsv(sanitizedCsvText) {
  const rows = parseCsv(sanitizedCsvText);
  const drafts = new Map();

  for (const r of rows) {
    const h = (r.Handle || '').trim();
    if (!h) continue;
    if (r.Status === 'draft') {
      drafts.set(h, {
        handle: h,
        sku: (r['Variant SKU'] || '').trim(),
        title: (r.Title || '').trim(),
        price: (r['Variant Price'] || '0.00').trim(),
        grams: Number(r['Variant Grams'] || 0),
        requiresShipping: (r['Variant Requires Shipping'] || '').trim(),
        bodyHtml: r['Body (HTML)'] || '',
        images: r['Image Src'] ? [r['Image Src'].trim()] : []
      });
    } else if (!r.Title && drafts.has(h) && r['Image Src']) {
      drafts.get(h).images.push(r['Image Src'].trim());
    }
  }

  const outHeaders = [
    'Review_No',
    'SKU',
    'Handle',
    'Clean_Title',
    'Price_USD',
    'Weight_Lbs',
    'Shipping_Mode',
    'Current_Shopify_Status',
    'Recommended_Action',
    'Decoded_Audit_Reason',
    'Primary_CDN_Image_Link',
    'All_CDN_Image_Links',
    'Image_Count'
  ];

  const items = [];
  const csvLines = [outHeaders.join(',')];
  let idx = 1;

  for (const d of drafts.values()) {
    const plain = d.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const snippetMatch = plain.match(/.{0,55}(?:Supplemental Inflatable Restraint|trim panel module|trim component).{0,55}/i);
    const rawSnippet = snippetMatch ? snippetMatch[0].trim() : 'Laundered trim keyword in legacy HTML';

    let recommendedAction = 'ACTIVATE (Verify No Live Airbag/Pyro)';
    let decodedReason = '';

    if (/Supplemental Inflatable Restraint|houses the driver's side trim panel module/i.test(plain)) {
      recommendedAction = 'ARCHIVE IMMEDIATELY (Live SIR Driver Airbag Wheel)';
      decodedReason = `Contains 'Supplemental Inflatable Restraint' / driver airbag module ("${rawSnippet}")`;
    } else if (/dashboard/i.test(d.title)) {
      recommendedAction = 'CHECK PHOTO (Activate ONLY if Bare Dash w/o Passenger Airbag)';
      decodedReason = `Dash shell mentions passenger airbag cover/opening ("${rawSnippet}")`;
    } else if (/webbing and buckle|'SIDE trim panel module'/i.test(plain)) {
      recommendedAction = 'CHECK PHOTO CLOSELY (Archive if Belt Webbing or Curtain Airbag Attached)';
      decodedReason = `Pillar trim mentions seatbelt webbing or 'SIDE airbag' stamp ("${rawSnippet}")`;
    } else if (/climate control/i.test(d.title)) {
      recommendedAction = 'SAFE TO ACTIVATE (HVAC/Clock Display w/ Indicator Lamp Only)';
      decodedReason = `Electronic clock/HVAC bezel only has 'passenger airbag indicator' light ("${rawSnippet}")`;
    } else if (/seat/i.test(d.title)) {
      recommendedAction = 'ACTIVATE FOR LOCAL PICKUP (Seat w/ Non-Pyro Buckle Receiver)';
      decodedReason = `Seat assembly mentions 'trim component buckle' = seatbelt buckle ("${rawSnippet}")`;
    } else {
      recommendedAction = 'SAFE TO ACTIVATE (Plastic Interior Trim Only)';
      decodedReason = `Plastic interior trim panel / cutout ("${rawSnippet}")`;
    }

    const weightLbs = Number((d.grams / 453.592).toFixed(1));
    const shippingMode = d.requiresShipping === 'false' ? 'Local Pickup / LTL Only' : 'Parcel Ship (+$10 Hdl)';
    const primaryUrl = d.images[0] || '';
    const allUrls = d.images.join(' | ');

    const item = {
      review_no: idx++,
      sku: d.sku,
      handle: d.handle,
      title: d.title,
      price: d.price,
      weight_lbs: weightLbs,
      shipping_mode: shippingMode,
      status: 'draft',
      recommended_action: recommendedAction,
      decoded_reason: decodedReason,
      primary_image: primaryUrl,
      images: d.images,
      image_count: d.images.length
    };
    items.push(item);

    csvLines.push([
      item.review_no,
      item.sku,
      item.handle,
      item.title,
      item.price,
      item.weight_lbs,
      item.shipping_mode,
      item.status,
      item.recommended_action,
      item.decoded_reason,
      item.primary_image,
      allUrls,
      item.image_count
    ].map(csvEscapeCell).join(','));
  }

  return {
    csv: csvLines.join('\n') + '\n',
    items
  };
}

module.exports = {
  AUDIT_DONOR_FLEET,
  PROHIBITED_CAT_SKUS,
  PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS,
  CONFIRMED_SOLD_OR_GHOST_SKUS,
  DUPLICATE_MERGE_TO_PRIMARY,
  DIRECT_PUNCH_LIST,
  isCounterfeitMpn,
  isGoogleDriveViewerUrl,
  cleanListingTitle,
  sanitizeHtmlBody,
  healWeightAndShipping,
  sanitizeShopifyExportCsv,
  generateDraftTrimHoldsCsv
};
