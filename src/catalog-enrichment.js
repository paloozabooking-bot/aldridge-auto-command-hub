/**
 * Grounded OEM Catalog Enrichment, Anti-Placeholder Sanitization,
 * Item-Specific Packed Dimensions/Weights, Country of Origin & $174.99/hr Bay Pricing
 *
 * Strictly enforces:
 * - Zero placeholder titles ("Tested OEM Auto Part (P0xxx)"), zero fake hex/year-make MPNs,
 *   zero "Does Not Apply", zero "Universal" fitment claims, zero 0x0x0 or 2 lb defaults.
 * - Photo-verified & Clean-Launch-Exports-verified OEM metadata for every active SKU.
 * - Hard-blocks all visually verified SRS/airbag SKUs (ALD-9FJP71, ALD-EUCT8U, ALD-H51N50, ALD-IBRLF3).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  db,
  getSettings,
  computeShippingClass,
  validateInventoryItemForPublish,
  isGhostOrBannedInventoryItem,
  purgeGhostAndBlockedInventory,
  logSync
} = require('./db');
const { PROHIBITED_CAT_SKUS, PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS, cleanListingTitle } = require('./audit-sanitizer');
const {
  resolvePartTaxonomyAndMetafields,
  sanitizeVerifiedMpn,
  resolveStructuredOemMpn,
  resolveCountryOfOrigin
} = require('./taxonomy');

const SHOP_LABOR_RATE_LOCKED = 174.99;

// Strip internal Google Drive photo links from any customer-facing text (fitment_notes, description, body_html, exports)
function stripDriveUrlsFromPublicText(text) {
  return String(text || '')
    .replace(/\s*\|\s*Drive\s+Photo\s+Ref\s*:\s*https?:\/\/[^\s|<"]+/gi, '')
    .replace(/\bDrive\s+Photo\s+Ref\s*:\s*https?:\/\/[^\s|<"]+/gi, '')
    .replace(/https?:\/\/drive\.google\.com\/[^\s|<",)]+/gi, '')
    .replace(/\s*\|\s*\|/g, ' |')
    .replace(/^\s*\|\s*|\s*\|\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Visually verified perceptual-hash (dHash distance = 0) photo pairs representing the exact same image/part
const VISUAL_PERCEPTUAL_HASH_EQUIVALENCES = [
  ['P0319.jpg', 'P0458.jpg'] // dHash distance = 0: 2004 Toyota 4Runner ECM 89661-35822
];

// Visually verified duplicate physical part photos (archived cleanly by deduplicateCatalog() to prevent double-sales)
const DUPLICATE_PHYSICAL_PART_SKUS = new Set([
  'ALD-04TOY-INTERIOR-D-P-P0458' // Exact perceptual-hash duplicate photo (P0458.jpg == P0319.jpg) of 2004 Toyota 4Runner ECM 89661-35822 (ALD-04TOY-GAS-TANK-P0319)
]);

// Grounded SKU enrichment map: verified from Clean Launch Exports CSVs + direct 131-SKU visual photo audit
const VERIFIED_SKU_ENRICHMENTS = {
  'ALD-12TOY-COOLANT-RESE-P0840': {
    title: '2010-2020 Toyota 4Runner 4.0L V6 Radiator Coolant Overflow Reservoir Tank OEM 16470-31050',
    years: '2010-2020',
    make: 'Toyota',
    model: '4Runner',
    trim: 'SR5 / Trail / Limited',
    engine: '4.0L 1GR-FE V6 / 2.7L 2TR-FE I4',
    brand: 'Toyota DENSO OEM',
    mpn: '16470-31050',
    interchange: '1647031050',
    placement: 'Engine Bay Front Right',
    price: 55,
    laborHours: 0.6,
    origin: 'JP',
    notes: 'Visually verified genuine DENSO-molded translucent white Toyota coolant overflow recovery tank with 3 intact mounting ears, factory cap, and overflow hose.'
  },
  // === 37 Clean Launch Exports Verified Legacy SKUs (100% Photo-Verified) ===
  'ALD-1UK1V6': { title: '1998 Chevrolet S10 Engine Control Module (ECM/PCM) Delco OEM 16204850', years: '1998-2000', make: 'Chevrolet', model: 'S-10', trim: '2WD / 4WD', engine: '2.2L / 4.3L', brand: 'GM Delco OEM', mpn: '16204850', price: 150, laborHours: 1.0, origin: 'US', notes: 'Visually verified finned aluminum Delco Electronics VCM/PCM stamped HDW NO. 16204850 with clean mounting ears and connector bay.' },
  'ALD-1VNJTD': { title: '2012-2017 Fiat 500 Pop ABS Anti-Lock Brake Control Module OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 180, laborHours: 1.5, origin: 'MX' },
  'ALD-2K89Y8': { title: '2012-2014 Fiat 500 Pop Instrument Gauge Cluster Speedometer OEM', years: '2012-2014', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 180, laborHours: 1.0, origin: 'MX' },
  'ALD-4AEHOC': { title: '2012-2017 Fiat 500 Pop Steering Column Upper Shroud Cover OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 35, laborHours: 0.5, origin: 'MX' },
  'ALD-52QC24': { title: '2012-2017 Fiat 500 Pop Radiator Cooling Fan Shroud Assembly OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 95, laborHours: 1.5, origin: 'MX' },
  'ALD-714368': { title: '2000-2004 Subaru Outback Front Right Passenger Complete Door Shell w/ Mirror Green/Silver OEM', years: '2000-2004', make: 'Subaru', model: 'Outback', trim: 'AWD Two-Tone Wagon', engine: '2.5L EJ25 H4', placement: 'Front Right Passenger', price: 350, laborHours: 2.5, origin: 'JP', notes: 'Complete two-tone Green/Silver front right passenger exterior door shell with OUTBACK lower body cladding, exterior handle, and side mirror.' },
  'ALD-7MSUTT': { title: '2005-2008 Ford Escape 2.3L I4 Fuel Injection Rail Assembly w/ Injectors & Harness OEM 4M5G-9D280-FB', years: '2005-2008', make: 'Ford', model: 'Escape', trim: '2WD / 4x4', engine: '2.3L Duratec I4', brand: 'Ford OEM', mpn: '4M5G-9D280-FB', interchange: 'LF60-13-150', price: 85, laborHours: 1.5, origin: 'US', notes: 'Visually verified aluminum fuel injection rail stamped 4M5G-9D280-FB / LF60 13 150 complete with green fuel injectors, retaining clips, and factory wiring harness.' },
  'ALD-84PFJ8': { title: '2012-2017 Fiat 500 Pop Passenger Dashboard Trim Bezel Panel Red OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 110, laborHours: 0.8, origin: 'MX' },
  'ALD-88IUR4': { title: '1998-2004 Chevrolet S10 Front Parking Turn Signal Light Lamp OEM', years: '1998-2004', make: 'Chevrolet', model: 'S-10', trim: 'Pickup', engine: '2.2L / 4.3L', price: 35, laborHours: 0.5, origin: 'US' },
  'ALD-95CL32': { title: '2003-2009 Toyota 4Runner SR5 4x4 Rear Bench Seat Assembly OEM', years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 4x4', engine: '4.0L 1GR-FE V6', price: 180, laborHours: 1.0, origin: 'JP' },
  'ALD-AS41YA': { title: '1998-2003 Chevrolet S10 5-Speed Manual Transmission Shifter Lever Knob & Boot OEM', years: '1998-2003', make: 'Chevrolet', model: 'S-10', trim: 'Pickup 5-Speed Manual', engine: '2.2L / 4.3L', price: 65, laborHours: 0.6, origin: 'US', notes: 'Visually verified 5-speed manual shift lever stick with embossed 1-2-3-4-5-R knob and intact black rubber floor boot.' },
  'ALD-BVZI50': { title: '1998-2004 Chevrolet S10 Front Headlight Headlamp Assembly OEM', years: '1998-2004', make: 'Chevrolet', model: 'S-10', trim: 'Pickup', engine: '2.2L / 4.3L', price: 100, laborHours: 0.8, origin: 'US' },
  'ALD-DJWYZO': { title: '1998-2002 Subaru Forester AWD Rear Seat Backrest Assembly OEM', years: '1998-2002', make: 'Subaru', model: 'Forester', trim: 'AWD', engine: '2.5L EJ25 H4', price: 150, laborHours: 0.8, origin: 'JP' },
  'ALD-F9LJ83': { title: '2003-2009 Toyota 4Runner SR5 4x4 Front CV Axle Drive Shaft OEM', years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 4x4', engine: '4.0L 1GR-FE V6', price: 75, laborHours: 2.0, origin: 'JP' },
  'ALD-FQ8SPY': { title: '1992-1996 Toyota Camry 2.2L Rear Quarter Window Glass OEM', years: '1992-1996', make: 'Toyota', model: 'Camry', trim: 'Sedan', engine: '2.2L 5S-FE I4', price: 65, laborHours: 1.5, origin: 'JP' },
  'ALD-FT1CFA': { title: '2012-2017 Fiat 500 Pop Engine Coolant Overflow Reservoir Tank OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 45, laborHours: 0.5, origin: 'MX' },
  'ALD-J0ZIRX': { title: '2012-2017 Fiat 500 Pop Dashboard Glove Box Compartment Door OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 75, laborHours: 0.5, origin: 'MX' },
  'ALD-JOAVVP': { title: '2012-2017 Fiat 500 Pop Rear Shock Absorber & Coil Spring Assembly OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 75, laborHours: 1.5, origin: 'MX' },
  'ALD-KNYU65': { title: '2001-2004 Ford Escape 4x4 Dual Radiator Cooling Fan Assembly OEM', years: '2001-2004', make: 'Ford', model: 'Escape', trim: '4x4', engine: '3.0L Duratec V6', price: 120, laborHours: 1.5, origin: 'US' },
  'ALD-LXJKA9': { title: '2012-2017 Fiat 500 Pop Body Control Module (BCM) w/ Integrated Interior Fuse Box OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', brand: 'Mopar / Fiat OEM', placement: 'Interior Lower Left Dash', price: 95, laborHours: 1.0, origin: 'MX', notes: 'Visually verified gray Mopar/Fiat Body Computer BCM with 12 integrated mini blade fuses, 3 intact multi-pin harness ports, and unbroken mounting ears.' },
  'ALD-M0E8R2': { title: '2012-2017 Fiat 500 Pop HVAC Heater A/C Climate Control Unit OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 85, laborHours: 0.8, origin: 'MX' },
  'ALD-MOWZ49': { title: '2012-2017 Fiat 500 Pop Interior Dashboard Air Vent Trim Bezel OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 35, laborHours: 0.5, origin: 'MX' },
  'ALD-O7ZBUN': { title: '2000-2004 Subaru Outback AWD Rear Right Passenger Door Shell OEM', years: '2000-2004', make: 'Subaru', model: 'Outback', trim: 'AWD Wagon', engine: '2.5L EJ25 H4', price: 300, laborHours: 2.5, origin: 'JP' },
  'ALD-Q5GZ91': { title: '1998-2004 Chevrolet S10 Body Control Module (BCM) GM OEM 16268395', years: '1998-2004', make: 'Chevrolet', model: 'S-10', trim: 'Pickup', engine: '2.2L / 4.3L', brand: 'GM OEM', mpn: '16268395', interchange: 'CHAU', price: 50, laborHours: 1.0, origin: 'US', notes: 'Visually verified GM Body Control Module stamped P/N 16268395 (CHAU) with intact Purple, Blue, and Brown multi-pin connector ports.' },
  'ALD-QBGQ07': { title: '2000-2004 Subaru Outback AWD Rear Left Driver Door Shell OEM', years: '2000-2004', make: 'Subaru', model: 'Outback', trim: 'AWD Wagon', engine: '2.5L EJ25 H4', price: 220, laborHours: 2.5, origin: 'JP' },
  'ALD-S3YFOK': { title: '2012-2017 Fiat 500 Pop 5-Speed Manual Shifter Assembly w/ Leather Boot, Knob & Lower Console Trim OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback 5-Speed', engine: '1.4L MultiAir I4', price: 145, laborHours: 1.0, origin: 'MX', notes: 'Visually verified 5-speed manual transmission shifter knob, stitched leather boot, power window switch cluster, and lower center dash console surround.' },
  'ALD-SUS2L8': { title: '2012-2017 Fiat 500 Pop Instrument Gauge Cluster Surround Bezel OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 45, laborHours: 0.5, origin: 'MX' },
  'ALD-T9HJRS': { title: '2012-2017 Fiat 500 Pop Front Exterior Fender Panel OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 180, laborHours: 2.0, origin: 'MX' },
  'ALD-UB9MKJ': { title: '2012-2017 Fiat 500 Pop Front Bucket Seat Assembly OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 220, laborHours: 1.0, origin: 'MX' },
  'ALD-UJEHSI': { title: '2012-2017 Fiat 500 Pop Factory AM/FM CD Stereo Radio Receiver OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 75, laborHours: 0.8, origin: 'MX' },
  'ALD-URESQF': { title: '2012-2017 Fiat 500 Pop Windshield Wiper Linkage & Motor Assembly OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 85, laborHours: 1.2, origin: 'MX' },
  'ALD-VDM77C': { title: '1998-2004 Chevrolet S10 Front Bucket Seat Assembly OEM', years: '1998-2004', make: 'Chevrolet', model: 'S-10', trim: 'Pickup', engine: '2.2L / 4.3L', price: 180, laborHours: 1.0, origin: 'US' },
  'ALD-VIJNRY': { title: '2012-2014 Fiat 500 Pop 1.4L Engine Control Module (ECM/PCM) OEM', years: '2012-2014', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 180, laborHours: 1.0, origin: 'IT' },
  'ALD-YGM6IP': { title: '2012-2017 Fiat 500 Pop Front Right Passenger Door Shell OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 400, laborHours: 2.5, origin: 'MX' },
  'ALD-YYK0SE': { title: '2012-2017 Fiat 500 Pop Dashboard Center Air Vent Grille Assembly OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 55, laborHours: 0.5, origin: 'MX' },
  'ALD-ZCWYEV': { title: '2003-2009 Toyota 4Runner SR5 4x4 Engine Bay Fuse Relay Box OEM', years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 4x4', engine: '4.0L 1GR-FE V6', price: 75, laborHours: 1.0, origin: 'JP' },
  'ALD-ZX8PU8': { title: '2012-2017 Fiat 500 Pop Blue&Me Bluetooth Hands-Free Telematics Convergence Module OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', brand: 'Magneti Marelli / Fiat OEM', placement: 'Interior Behind Glove Box / Rear Quarter', price: 95, laborHours: 0.8, origin: 'IT', notes: 'Visually verified Magneti Marelli Blue&Me Convergence Bluetooth hands-free telematics module with intact blue multi-pin connector port and black vented housing.' },

  // === Directly Photo-Inspected & Visual Audit Corrected SKUs (131-SKU Contact Sheet Audit) ===
  'ALD-04TOY-CENTER-CONSO-P0339': {
    title: '2003-2009 Toyota 4Runner Instrument Cluster Dash Bezel Trim w/ Air Vent OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Sport / Limited', engine: '4.0L 1GR-FE V6 / 4.7L V8',
    price: 95, laborHours: 0.6, origin: 'JP', placement: 'Dashboard Left / Instrument Cluster Surround',
    notes: 'Visually verified dash bezel trim surround featuring 3 silver-ringed gauge pods, left dash A/C vent louver, and dimmer switch housing.'
  },
  'ALD-04TOY-CHARCOAL-CAN-P0523': {
    title: '2003-2009 Toyota 4Runner Center Floor Console Assembly w/ Shifter Bezel & Armrest OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6',
    price: 155, laborHours: 1.0, origin: 'JP', placement: 'Interior Center Floor',
    notes: 'Visually verified complete charcoal/gray center floor console housing with padded armrest lid, rear window switch cutouts, cupholder bay, and gated automatic shifter trim plate.'
  },
  'ALD-04TOY-DRIVE-AXLE-P0528': {
    title: '2003-2009 Toyota 4Runner 4WD Complete Front Differential Assembly WITH Both CV Drive Axles & ADD Actuator OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Sport / Limited 4WD', engine: '4.0L 1GR-FE V6',
    price: 595, laborHours: 4.5, origin: 'JP', placement: 'Front Drivetrain Assembly (Complete)',
    notes: 'Visually verified COMPLETE 4WD front differential carrier assembly INCLUDING factory ADD (Automatic Disconnecting Differential) actuator, mounting brackets, AND both left & right CV drive axle half-shafts. 30-day verified mechanical defect-only warranty (buyer must verify axle gear ratio by VIN prior to installation).'
  },
  'ALD-04TOY-DRIVER-SEAT-P0306': {
    title: '2003-2009 Toyota 4Runner Interior Junction Block Fuse Box Assembly OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6',
    price: 95, laborHours: 0.8, origin: 'JP', placement: 'Interior Dash Lower Left',
    notes: 'Visually verified genuine Toyota interior junction block fuse box with intact blade fuses, relays, and multi-pin wiring harness connectors.'
  },
  'ALD-04TOY-FRONT-DIFFER-P0287': {
    title: '2003-2009 Toyota 4Runner Theft Warning Security Control Module OEM 08190-35820',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6',
    brand: 'Toyota OEM', mpn: '08190-35820', interchange: '137000-3000',
    price: 65, laborHours: 0.6, origin: 'PH', placement: 'Interior Under Dash',
    notes: 'Visually verified stamped TOYOTA THEFT WARNING 08190-35820 / 137000-3000 12V Security Control Module (Made in the Philippines) with factory mounting bracket.'
  },
  'ALD-04TOY-AC-CONDENSER-P0762': {
    title: '2003-2009 Toyota 4Runner 4.0L V6 4WD Automatic Transmission Assembly OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited 4WD', engine: '4.0L 1GR-FE V6',
    price: 950, laborHours: 5.5, origin: 'JP', placement: 'Center Drivetrain (4WD)',
    notes: 'Visually verified complete OEM 4WD automatic transmission assembly with clean cast aluminum bellhousing and transfer-case mating tailhousing. Local Pickup Only in University Place, WA 98467 or certified in-bay installation.'
  },
  'ALD-04TOY-AIR-INTAKE-B-P0297': {
    title: '2003-2009 Toyota 4Runner Chassis Body Electronic Control Module OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6',
    price: 95, laborHours: 0.6, origin: 'JP', placement: 'Interior Dash / Kick Panel',
    notes: 'Visually verified black Toyota/DENSO molded electronic control module with intact mounting tabs and white multi-pin connector port.'
  },
  'ALD-04TOY-CLIMATE-CONT-P0322': {
    title: '2003-2009 Toyota 4Runner Transponder Key Immobilizer ECU Control Module w/ Bracket OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6',
    price: 85, laborHours: 0.8, origin: 'JP', placement: 'Interior Dash / Immobilizer Bay',
    notes: 'Visually verified genuine Toyota Transponder Key Immobilizer ECU module mounted in factory steel bracket.'
  },
  'ALD-04TOY-ENGINE-ECU-C-P0301': {
    title: '2003-2009 Toyota 4Runner Automatic Transmission Floor Shifter Assembly w/ Knob OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6',
    price: 95, laborHours: 1.0, origin: 'JP', placement: 'Center Floor Console',
    notes: 'Visually verified complete automatic transmission floor shifter assembly with black shift knob, shift-lock mechanism, and mounting base.'
  },
  'ALD-04TOY-FRONT-BRAKE-P0470': {
    title: '2003-2009 Toyota 4Runner HVAC A/C Heater Climate Control Unit w/ Digital Display OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6',
    price: 115, laborHours: 0.8, origin: 'JP', placement: 'Center Dashboard',
    notes: 'Visually verified 3-dial automatic HVAC climate control module with top silver-bezel digital clock/temp display and rear defrost / A/C push buttons.'
  },
  'ALD-04TOY-FUEL-TANK-ST-P0310': {
    title: '2003-2009 Toyota 4Runner Engine Bay Fuse & Relay Box Assembly w/ Cover OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6',
    price: 85, laborHours: 0.8, origin: 'JP', placement: 'Engine Bay Left',
    notes: 'Visually verified under-hood engine bay fuse and relay distribution box complete with relays, fuses, fuse puller, and top/bottom covers.'
  },
  'ALD-04TOY-GAS-TANK-P0319': {
    title: '2004 Toyota 4Runner 4.0L V6 Engine Control Module (ECM/ECU) DENSO OEM 89661-35822',
    years: '2004', make: 'Toyota', model: '4Runner', trim: 'SR5 / Sport / Limited 4.0L', engine: '4.0L 1GR-FE V6',
    brand: 'Toyota DENSO OEM', mpn: '89661-35822', interchange: '275000-1402',
    price: 185, laborHours: 1.0, origin: 'JP', placement: 'Behind Glove Box',
    notes: 'Visually verified stamped TOYOTA ENGINE CONTROL 89661-35822 / DENSO 275000-1402 12V ECM computer with factory steel mounting brackets.'
  },
  'ALD-04TOY-HORNS-SET-OF-P0226': {
    title: '2003-2009 Toyota 4Runner Rear Cargo Quarter Interior Trim Panel Gray OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6',
    price: 95, laborHours: 0.8, origin: 'JP', placement: 'Rear Cargo Interior Quarter',
    notes: 'Visually verified gray molded rear cargo area interior quarter trim panel with wheel-well contour and integrated storage pocket.'
  },
  'ALD-04TOY-RADIATOR-P0324': {
    title: '2003-2009 Toyota 4Runner Complete Dashboard Pad & Instrument Carrier Shell Gray/Black OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6',
    price: 225, laborHours: 3.5, origin: 'JP', placement: 'Front Cabin Full Dashboard',
    notes: 'Visually verified complete two-tone gray/black dashboard upper pad and instrument carrier assembly (SRS airbag removed — compliant). Local Pickup Only in University Place, WA 98467.'
  },
  'ALD-12TOY-ABS-MODULE-P1027': {
    title: '2010-2020 Toyota 4Runner Hydraulic Brake Booster Master Cylinder & ABS Pump Module OEM',
    years: '2010-2020', make: 'Toyota', model: '4Runner', trim: 'SR5 / Trail / Limited', engine: '4.0L 1GR-FE V6',
    price: 185, laborHours: 2.0, origin: 'JP', placement: 'Engine Bay Firewall',
    notes: 'Visually verified integrated Toyota electric hydraulic brake booster, master cylinder reservoir, and ABS pump actuator module.'
  },

  'ALD-KEEP-P0818': { title: '2000-2004 Subaru Outback Front Right Passenger Interior Door Trim Panel Tan OEM', years: '2000-2004', make: 'Subaru', model: 'Outback', trim: 'Limited / Base Wagon', engine: '2.5L EJ25 H4', price: 115, laborHours: 0.8, origin: 'JP', placement: 'Front Right Passenger Interior Door', notes: 'Tan/Beige vinyl & leatherette interior door card with armrest handle and speaker grille. Clean mounting clips.' },
  'ALD-KEEP-P0691': { title: '2000-2004 Subaru Outback Front Passenger Tan Leather Bucket Seat Assembly OEM', years: '2000-2004', make: 'Subaru', model: 'Outback', trim: 'Limited Leather', engine: '2.5L EJ25 H4', price: 195, laborHours: 1.0, origin: 'JP', placement: 'Front Right Passenger', notes: 'Tan leather bucket seat complete with adjustable headrest, seat tracks, and buckle latch.' },
  'ALD-KEEP-P0314': { title: '2000-2004 Subaru Outback Front Left Driver Complete Door Shell w/ Mirror Green/Silver OEM', years: '2000-2004', make: 'Subaru', model: 'Outback', trim: 'AWD Two-Tone Wagon', engine: '2.5L EJ25 H4', price: 325, laborHours: 2.5, origin: 'JP', placement: 'Front Left Driver', notes: 'Complete two-tone Green/Silver exterior door shell with OUTBACK lower body cladding, exterior handle, and side mirror.' },
  'ALD-KEEP-P0298': { title: '2000-2004 Subaru Outback Rear Right Passenger Interior Door Trim Panel Tan OEM', years: '2000-2004', make: 'Subaru', model: 'Outback', trim: 'Limited / Base Wagon', engine: '2.5L EJ25 H4', price: 95, laborHours: 0.6, origin: 'JP', placement: 'Rear Right Passenger Interior Door', notes: 'Tan/Beige rear door trim card with armrest pull handle and integrated lower speaker grille.' },
  'ALD-KEEP-P0299': { title: '2000-2004 Subaru Outback Rear Left Driver Interior Door Trim Panel Tan OEM', years: '2000-2004', make: 'Subaru', model: 'Outback', trim: 'Limited / Base Wagon', engine: '2.5L EJ25 H4', price: 95, laborHours: 0.6, origin: 'JP', placement: 'Rear Left Driver Interior Door', notes: 'Tan/Beige rear left interior door trim card with armrest handle and lower speaker grille.' },
  'ALD-KEEP-P0294': { title: '2003-2009 Toyota 4Runner Keyless Entry Door Control Receiver Module OEM 89741-35040', years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6', mpn: '89741-35040', interchange: '156800-0210', price: 75, laborHours: 0.6, origin: 'JP', brand: 'Toyota DENSO OEM', notes: 'Stamped TOYOTA 89741-35040 / DENSO 156800-0210 Door Control Receiver Module with factory steel mounting bracket.' },
  'ALD-KEEP-P0731': { title: '2000-2004 Subaru Legacy Outback Windshield Washer Fluid Reservoir Tank w/ Pump OEM', years: '2000-2004', make: 'Subaru', model: 'Legacy', trim: 'L / Outback', engine: '2.5L EJ25 H4', price: 45, laborHours: 0.6, origin: 'JP', notes: 'Factory washer fluid reservoir bottle complete with yellow flip cap and washer pump motor.' },
  'ALD-GRUA1L': { title: '2012-2017 Fiat 500 Pop Passenger Dashboard Trim Panel Red w/ 500 Emblem & Vent OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback (Rosso Red)', engine: '1.4L MultiAir I4', price: 110, laborHours: 0.8, origin: 'MX', notes: 'Gloss Rosso Red passenger-side dashboard trim panel complete with chrome 500 badge, round air vent, and hazard/defrost buttons.' },
  'ALD-IKVYWQ': { title: '2012-2017 Fiat 500 ABS Anti-Lock Brake Pump & Hydraulic Control Module OEM P68073251AG', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', mpn: 'P68073251AG', interchange: '68073251AG', price: 165, laborHours: 2.0, origin: 'MX', brand: 'Mopar / Fiat OEM', notes: 'Stamped P68073251AG ABS hydraulic pump block and electronic control module. Clean brake line threads and connector pins.' },
  'ALD-NX7MB7': { title: '2012-2017 Fiat 500 Bosch Yaw Rate ESC Stability Sensor Module OEM 68073504AA', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', mpn: '68073504AA', interchange: '0265005873', price: 85, laborHours: 0.8, origin: 'HU', brand: 'Bosch / Fiat OEM', notes: 'Stamped BOSCH 0 265 005 873 / Chrysler 68073504AA Made in Hungary yaw rate / stability sensor.' },
  'ALD-PKNW51': { title: '2012-2014 Fiat 500 1.4L Engine Control Module (ECM/PCM) Magneti Marelli OEM P68093995AP', years: '2012-2014', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', mpn: 'P68093995AP', interchange: 'P05150504AB', price: 185, laborHours: 1.0, origin: 'IT', brand: 'Magneti Marelli / Fiat OEM', notes: 'Stamped P68093995AP / P05150504AB Magneti Marelli engine control computer. Clean dual multi-pin connector housing.' },
  'ALD-RAWZXP': { title: '2012-2014 Fiat 500 Speedometer Instrument Gauge Cluster w/ Ivory Bezel 140 MPH OEM', years: '2012-2014', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 145, laborHours: 1.0, origin: 'MX', notes: 'Concentric 140 MPH instrument cluster gauge assembly with ivory/beige surround hood and MENU/ESC buttons.' },
  'ALD-KEEP-P0544': { title: '2010-2013 Toyota 4Runner 4WD Control Computer Module AISIN OEM 89533-35290', years: '2010-2013', make: 'Toyota', model: '4Runner', trim: 'SR5 / Trail 4WD', engine: '4.0L 1GR-FE V6', mpn: '89533-35290', interchange: '363811-11710', price: 145, laborHours: 0.8, origin: 'JP', brand: 'Toyota AISIN OEM', notes: 'Stamped TOYOTA 89533-35290 / AISIN 363811-11710 4WD Control Computer (29), Made in Japan.' },
  'ALD-KEEP-P0545': { title: '2010-2013 Toyota 4Runner Radio Audio USB Interface Module Panasonic OEM 861A0-48030', years: '2010-2013', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6', mpn: '861A0-48030', interchange: 'CX-US099BAJ', price: 95, laborHours: 0.8, origin: 'JP', brand: 'Toyota Panasonic OEM', notes: 'Stamped Panasonic Model 861A0-48030 / Ref CX-US099BAJ Audio USB Interface Module, Made in Japan.' },
  'ALD-KEEP-P0547': { title: '2012-2017 Fiat 500 Rear Shock Absorber & Coil Spring Suspension Assembly OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 75, laborHours: 1.5, origin: 'MX', notes: 'Used OEM rear shock absorber and coil spring assembly. Dry damper body with intact mounting bushings.' },
  'ALD-KEEP-P0562': { title: '2010-2013 Toyota 4Runner TPMS Tire Pressure Monitor Computer Module DENSO OEM 89769-35100', years: '2010-2013', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6', mpn: '89769-35100', interchange: '158600-1120', price: 95, laborHours: 0.8, origin: 'JP', brand: 'Toyota DENSO OEM', notes: 'Stamped TOYOTA 89769-35100 / DENSO 158600-1120 Tire Pressure Monitor Computer, Made in Japan.' },
  'ALD-KEEP-P0577': { title: '2010-2013 Toyota 4Runner Park Assist Clearance Warning Sonar Computer OEM 89340-35030', years: '2010-2013', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6', mpn: '89340-35030', interchange: 'ADC3008000A', price: 110, laborHours: 0.8, origin: 'JP', brand: 'Toyota OEM', notes: 'Stamped TOYOTA 89340-35030 / ADC3008000A Clearance Warning Sonar Computer (B9).' },
  'ALD-KEEP-P0648': { title: '2010-2013 Toyota 4Runner MPX Multiplex Network Body Control Module DENSO OEM 89221-35102', years: '2010-2013', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6', mpn: '89221-35102', interchange: '238000-3570', price: 165, laborHours: 1.0, origin: 'JP', brand: 'Toyota DENSO OEM', notes: 'Stamped TOYOTA 89221-35102 / DENSO 238000-3570 MPX Body Control Module (F5), Made in Japan.' },
  'ALD-KEEP-P0737': { title: '2010-2013 Toyota 4Runner Fuel Pump Control Driver Module DENSO OEM 89570-60050', years: '2010-2013', make: 'Toyota', model: '4Runner', trim: 'SR5 / Limited', engine: '4.0L 1GR-FE V6', mpn: '89570-60050', interchange: '204993-4731', price: 115, laborHours: 0.8, origin: 'JP', brand: 'Toyota DENSO OEM', notes: 'Stamped TOYOTA 89570-60050 / DENSO 204993-4731 Fuel Pump Driver Module with aluminum heat sink and bracket, Made in Japan.' },
  'ALD-15FIA-MANUAL-REVIE-P0264': { title: '2012-2017 Fiat 500 Pop Rear 50/50 Split Folding Seat Backrest Pair w/ Headrests Charcoal OEM', years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4', price: 195, laborHours: 1.0, origin: 'MX', notes: 'Matched left and right rear folding seat backrest pair in black/charcoal cloth with round headrests.' },

  // === Specific Outlier & Non-Universal Fitment Fixes ===
  'ALD-9JGBGF': { title: '2010-2014 Subaru Outback Legacy Factory Stereo Radio Head Unit OEM', years: '2010-2014', make: 'Subaru', model: 'Outback', trim: 'Legacy / Outback', engine: '2.5L H4 / 3.6L H6', price: 145, laborHours: 1.0, origin: 'JP' },
  'ALD-00UNI-AERO-BLADE-W-P0131': { title: 'Aero Blade 22-Inch All-Season Beam Windshield Wiper Blades (J-Hook Fitment)', years: '22-Inch Blade', make: 'Aero', model: '22-Inch J-Hook Wiper Arm', condition: 'New', price: 22, laborHours: 0, origin: 'US', brand: 'Aero' },
  'ALD-00UNI-ANCO-18-INCH-P0005': { title: 'ANCO 18-Inch All-Season Windshield Wiper Blade (J-Hook / Pin Arm Fitment)', years: '18-Inch Blade', make: 'ANCO', model: '18-Inch Wiper Arm', condition: 'New', price: 22, laborHours: 0, origin: 'US', brand: 'ANCO' },
  'ALD-00UNI-RAIN-X-LATIT-P0047': { title: 'Rain-X Latitude 2-In-1 Water Repellency 22-Inch Wiper Blades Pair', years: '22-Inch Pair', make: 'Rain-X', model: '22-Inch Wiper Arm', condition: 'New', price: 28, laborHours: 0, origin: 'US', brand: 'Rain-X' },
  'ALD-00UNI-RAINX-FUSION-P0009': { title: 'Rain-X Fusion 20-Inch Beam Windshield Wiper Blade', years: '20-Inch Blade', make: 'Rain-X', model: '20-Inch Wiper Arm', condition: 'New', price: 22, laborHours: 0, origin: 'US', brand: 'Rain-X' },
  'ALD-00UNI-TOTALPRO-WAT-P0093': { title: 'TOTALPRO Engine Water Pump Replacement Assembly FVC-9106', years: 'FVC-9106 Spec', make: 'TOTALPRO', model: 'FVC-9106 Application', mpn: 'FVC-9106', condition: 'New', price: 65, laborHours: 2.5, origin: 'US', brand: 'TOTALPRO' },
  'ALD-00UNI-TRICO-RAINGU-P0007': { title: 'Trico RainGuard 18-Inch Windshield Wiper Blade', years: '18-Inch Blade', make: 'Trico', model: '18-Inch Wiper Arm', condition: 'New', price: 22, laborHours: 0, origin: 'US', brand: 'Trico' },
  'ALD-00KIA-FRONT-GRILLE-P0090': { title: '2012-2017 Kia Rio Front Upper Radiator Grille Assembly OEM', years: '2012-2017', make: 'Kia', model: 'Rio', origin: 'KR' },
  'ALD-00SUB-14-INCH-WHEE-P0096': { title: '1995-2001 Subaru Impreza 14-Inch OEM Wheel Cover Hubcap', years: '1995-2001', make: 'Subaru', model: 'Impreza', origin: 'JP' },
  'ALD-08FOR-08-SIDE-MIRR-P0038': { title: '2008-2011 Ford Focus Exterior Side View Mirror Assembly OEM', years: '2008-2011', make: 'Ford', model: 'Focus', origin: 'US' },
  'ALD-09CHE-GMC-TIMING-C-P0169': { title: '2009-2017 Chevrolet Traverse GMC Acadia 3.6L V6 Timing Chain Kit', years: '2009-2017', make: 'Chevrolet', model: 'Traverse / GMC Acadia 3.6L', condition: 'New', origin: 'US', brand: 'GM / Aftermarket' },

  // === Visually Verified Canonical Seat Assemblies & Photo-Verified Duplicate Labels ===
  'ALD-15FIA-REAR-SEATS-P1036': {
    title: '2012-2017 Fiat 500 Pop Complete Rear Bench Seat & 50/50 Folding Backrest Set Charcoal OEM',
    years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4',
    placement: 'Rear Interior Cabin', price: 265, laborHours: 1.0, origin: 'MX',
    notes: 'Visually verified complete charcoal/black cloth rear seating set including bottom bench cushion and matched 50/50 split folding backrest pair with round headrests.'
  },
  'ALD-15FIA-SEAT-P0710': {
    title: '2012-2017 Fiat 500 Pop Rear 50/50 Folding Seat Backrest Pair Charcoal OEM',
    years: '2012-2017', make: 'Fiat', model: '500 Pop', trim: 'Pop Hatchback', engine: '1.4L MultiAir I4',
    placement: 'Rear Interior Cabin', price: 185, laborHours: 1.0, origin: 'MX'
  },
  'ALD-98SUB-FRONT-SEAT-P1608': {
    title: '1998-2002 Subaru Forester Front Bucket Seat Pair Gray Cloth OEM',
    years: '1998-2002', make: 'Subaru', model: 'Forester', trim: 'AWD', engine: '2.5L EJ25 H4',
    placement: 'Front Interior Cabin', price: 185, laborHours: 1.0, origin: 'JP',
    preferredPhotos: ['/review-thumbs/P1465.jpg', '/review-thumbs/P1528.jpg', '/review-thumbs/P1539.jpg', '/review-thumbs/P1493.jpg', '/review-thumbs/P1512.jpg', '/review-thumbs/P0991.jpg'],
    notes: 'Visually verified matched pair of gray cloth front bucket seats with headrests, seat tracks, and intact bolsters.'
  },
  'ALD-98SUB-CAR-SEAT-P1051': {
    title: '1998-2002 Subaru Forester Front Bucket Seat Gray Cloth OEM',
    years: '1998-2002', make: 'Subaru', model: 'Forester', trim: 'AWD', engine: '2.5L EJ25 H4',
    placement: 'Front Interior Cabin', price: 185, laborHours: 1.0, origin: 'JP'
  },
  'ALD-98SUB-GRAY-CLOTH-I-P0070': {
    title: '1998-2002 Subaru Forester Front Bucket Seat Pair Gray Cloth OEM',
    years: '1998-2002', make: 'Subaru', model: 'Forester', trim: 'AWD', engine: '2.5L EJ25 H4',
    placement: 'Front Interior Cabin', price: 185, laborHours: 1.0, origin: 'JP'
  },
  'ALD-98SUB-REAR-SEAT-P0858': {
    title: '1998-2002 Subaru Forester Complete Rear Bench Seat & 60/40 Folding Backrest Set Gray Cloth OEM',
    years: '1998-2002', make: 'Subaru', model: 'Forester', trim: 'AWD', engine: '2.5L EJ25 H4',
    placement: 'Rear Interior Cabin', price: 265, laborHours: 1.0, origin: 'JP',
    preferredPhotos: ['/review-thumbs/P0858.jpg', '/review-thumbs/P1608.jpg'],
    notes: 'Visually verified complete gray cloth 60/40 split folding rear backrest with headrests and matching rear bench bottom cushion.'
  },
  'ALD-03SUB-LIMITED-FRON-P0078': {
    title: '2000-2004 Subaru Outback Limited Front Tan Leather Bucket Seat Pair OEM',
    years: '2000-2004', make: 'Subaru', model: 'Outback', trim: 'Limited Wagon', engine: '2.5L EJ25 H4',
    placement: 'Front Interior Cabin', price: 265, laborHours: 1.0, origin: 'JP',
    notes: 'Visually verified matched pair of Limited tan leather front bucket seats with headrests and mounting tracks.'
  },
  'ALD-OH-025': {
    title: '2000-2004 Subaru Outback Limited Wagon Complete Rear Tan Leather Bench Seat & Backrest Set OEM',
    years: '2000-2004', make: 'Subaru', model: 'Outback', trim: 'Limited Wagon', engine: '2.5L EJ25 H4',
    placement: 'Rear Interior Cabin', price: 265, laborHours: 1.0, origin: 'JP',
    notes: 'Visually verified Limited tan leather rear bench bottom cushion and matching folding rear seat backrest.'
  },
  'ALD-03SUB-REAR-SEAT-P1456': {
    title: '2000-2004 Subaru Outback Limited Rear Tan Leather Seat Backrest OEM',
    years: '2000-2004', make: 'Subaru', model: 'Outback', trim: 'Limited Wagon', engine: '2.5L EJ25 H4',
    placement: 'Rear Interior Cabin', price: 265, laborHours: 1.0, origin: 'JP',
    preferredPhotos: ['/review-thumbs/P1456.jpg']
  },
  'ALD-04TOY-REAR-SEAT-P0976': {
    title: '2003-2009 Toyota 4Runner Complete 60/40 Rear Bench Seat Assembly Gray Cloth OEM',
    years: '2003-2009', make: 'Toyota', model: '4Runner', trim: 'SR5 4x4', engine: '4.0L 1GR-FE V6',
    placement: 'Rear Interior Cabin', price: 265, laborHours: 1.0, origin: 'JP',
    notes: 'Visually verified complete 60/40 split folding gray cloth second-row rear bench seat assembly with headrests.'
  },
  'ALD-96TOY-CAR-SEATS-P0782': {
    title: '1996 Toyota Camry Complete Rear Bench Seat & Folding Backrest Set OEM',
    years: '1996', make: 'Toyota', model: 'Camry', trim: 'Sedan', engine: '2.2L 5S-FE I4',
    placement: 'Rear Interior Cabin', price: 265, laborHours: 1.0, origin: 'JP',
    notes: 'Visually verified complete rear bench and folding backrest velour cloth seating set.'
  },
  'ALD-98SUB-SIDE-MARKER-P0092': {
    title: '1998-2000 Subaru Forester Front Corner Side Marker & Turn Signal Lights Pair L+R OEM',
    years: '1998-2000', make: 'Subaru', model: 'Forester', trim: 'AWD', engine: '2.5L EJ25 H4',
    placement: 'Front Left & Right Corners', price: 55, laborHours: 0.5, origin: 'JP',
    notes: 'Visually verified matched Left + Right pair of front corner amber/clear parking & side marker lamp assemblies with intact lenses.'
  },
  'ALD-10FOR-FUEL-GAS-FIL-P0159': {
    title: '2010-2013 Ford Transit Connect Fuel Gas Filler Housing Pocket & Door Hinge Assembly',
    years: '2010-2013', make: 'Ford', model: 'Transit Connect', trim: 'XL / XLT', engine: '2.0L I4',
    condition: 'New', placement: 'Rear Left Quarter Fuel Door', price: 55, laborHours: 0.8, origin: 'US',
    notes: 'Visually verified new boxed fuel filler neck housing pocket with integrated spring door hinge.'
  }
};

// DETERMINISTIC PART-SPECIFIC PHYSICAL WEIGHT (lb) & PACKED DIMENSIONS (L x W x H in) MATRIX (v32.6)
// ZERO generic 8.5 lb, 14x10x7, or 4.5 lb / 10x8x6 fallbacks on bulky assemblies!
// Precedence:
//   1) Tiny hardware / sensors / switches / modules (explicitly excluded from bulky assembly rules)
//   2) Heavy & oversized assemblies (engines, transmissions, differentials, subframes, frames, doors, hoods,
//      tailgates, sunroofs/moonroofs, fenders, bumpers, seats, glass, dashboards, headliners, fuel tanks,
//      running boards, ladder racks, batteries, tires/wheels, exhausts)
//   3) Mid-size mechanical, lighting, body trim, HVAC housing & suspension/chassis assemblies
//   4) Small interior/electrical/bolt-on sub-components
const DIMENSION_RULES = [
  // 1. Ultra-specific small switches, sensors, latches, bezels, relays, modules & brackets (1.5–3.5 lbs, 10 x 8 x 6 in)
  // Guarded so "Door Assembly", "Sunroof Assembly", "Intake Manifold with Throttle Body", "HVAC Housing with Harness" NEVER match here!
  { match: /\b(sensor|switch|relay|solenoid|knob|lock\s*actuator|door\s*handle|exterior\s*handle|interior\s*handle|grab\s*handle|hood\s*latch|door\s*latch|trunk\s*latch|tailgate\s*latch|hinge|filler\s*cap|oil\s*cap|radiator\s*cap|gas\s*cap|air\s*vent|dash\s*vent|bezel|cover\s*trim|horn|ignition\s*coil|coil\s*pack|fuel\s*injector|injector|clamp|retainer|hold\s*down|bolt|clip|owner'?s?\s*manual|mirror\s*glass|sun\s*visor|headrest|armrest|cup\s*holder|ash\s*tray|clock|display\s*screen|backup\s*camera|rear\s*camera|keyless|tpms|tire\s*pressure\s*monitor|yaw\s*rate|oxygen|o2\s*sensor|maf\s*sensor|camshaft|crankshaft|foot\s*rest|pedal\s*cover|stop\s*plate|bumper.*bracket|skirt\s*bracket|support\s*cover\s*trim|mounting\s*bracket|battery\s*terminal|dome\s*light|receiver\s*drier)\b/i, weight: 1.5, l: 10, w: 8, h: 6, labor: 0.6 },
  { match: /\b(ecm|ecu|pcm|bcm|tcm|tcu|control\s*module|warning\s*module|airbag\s*module|abs\s*module|body\s*control|engine\s*control|computer|fuse\s*(?:and\s*relay\s*)?box|relay\s*box|junction\s*box|junction\s*block|tipm|climate\s*control|hvac\s*control|heater\s*control|ac\s*control\s*panel|amplifier|bluetooth|blue&me|convergence|audio\s*receiver|tuner\s*assembly)\b/i, weight: 3.5, l: 10, w: 8, h: 6, labor: 0.8 },

  // 2. Engines / Long Blocks / Short Blocks / Engine Cores (320.0 lbs, 36 x 30 x 32 in, Local_Pickup_Only)
  { match: /\b(complete\s*engine|engine\s*assembly|engine\s*core|engine\s+(?:\d\.\d[lL]\s+)?(?:\d-?cyl\s+)?(?:[a-z0-9-]+\s+){0,3}assembly|engine\s*long\s*block|long\s*block|short\s*block|motor\s*assembly)\b/i, exclude: /\b(window|wiper|blower|fan|starter|seat|mirror|washer|sunroof|door|abs|pump|mount|cover|under\s*cover|skid|accessory|belt|pulley|tensioner|bay|trim|intake|coolant|wiring|harness|filter|air\s*box|splash|shield|control|module|ecm|ecu|pcm|sensor|valve)\b/i, weight: 320.0, l: 36, w: 30, h: 32, labor: 12.0, localPickup: true },

  // 3. Transmissions / Transaxles / Transfer Cases (145.0 lbs, 32 x 24 x 22 in, Local_Pickup_Only)
  { match: /\b(automatic\s*transmission|manual\s*transmission|transmission\s*assembly|transaxle|gearbox\s*assembly|cvt\s*transmission|transfer\s*case)\b/i, exclude: /\b(mount|crossmember|oil\s*pan|cooler|line|hose|cable|shifter|sensor|switch|module|tcm|tcu|dipstick|bracket)\b/i, weight: 145.0, l: 32, w: 24, h: 22, labor: 6.0, localPickup: true },

  // 4. Tire Sets & Wheel/Tire Assemblies (must precede bare wheel/tire)
  { match: /\b(set\s*of\s*[234]\s*(?:wheels?|tires?)|[234]\s*(?:wheels?|tires?)\s*set|wheel\s*(?:and|&|\+|with)\s*tire\s*set)\b/i, weight: 120.0, l: 32, w: 32, h: 32, labor: 0.75, localPickup: true },
  { match: /\b(wheel\s*(?:and|&|\+|with)\s*tire|tire\s*(?:and|&|\+|with)\s*wheel|spare\s*tire\s*assembly|complete\s*wheel.*tire|mounted\s*tire)\b/i, weight: 45.0, l: 28, w: 28, h: 11, labor: 0.5 },
  { match: /\btires?\b/i, exclude: /\b(pressure|tpms|sensor|monitor|cover|carrier|winch|jack|wrench|tool|hoist|bracket|well|liner)\b/i, weight: 32.0, l: 28, w: 28, h: 10, labor: 0.5 },
  { match: /\b(alloy\s*wheel|steel\s*wheel|wheel\s*rim|\brim\b)\b/i, exclude: /\b(cover|hubcap|center\s*cap|lug|nut|stud|sensor|hub|bearing|speed|well|liner|arch|steering|flywheel)\b/i, weight: 24.0, l: 20, w: 20, h: 9, labor: 0.5 },

  // 5. Differentials / Axle Housings / Subframes / Frame Sections (72–85 lbs, Local_Pickup_Only)
  { match: /\b(front\s*differential|rear\s*differential|differential\s*carrier|differential\s*assembly|third\s*member|rear\s*axle\s*(?:assembly|beam)|front\s*axle\s*assembly|axle\s*(?:housing|beam))\b/i, weight: 85.0, l: 48, w: 18, h: 16, labor: 3.5, localPickup: true },
  { match: /\b(frame\s*section|frame\s*cut|frame\s*rail|chassis\s*frame|subframe|k-?frame|front\s*subframe\s*crossmember|rear\s*subframe)\b/i, weight: 75.0, l: 48, w: 30, h: 14, labor: 3.5, localPickup: true },

  // 6. Sunroof / Moonroof Assemblies & Glass (48 lbs, 44 x 36 x 8 in, Local_Pickup_Only)
  { match: /\b(sunroof|moonroof)\b/i, exclude: /\b(switch|motor|shade\s*clip|drain|seal|trim\s*ring|control|console)\b/i, weight: 48.0, l: 44, w: 36, h: 8, labor: 2.5, localPickup: true },

  // 7. Complete Doors / Tailgates / Liftgates / Hoods / Fenders / Quarter Panels / Bumpers / Seats / Glass / Dashboards / Headliners / Bed Liners / Racks / Fuel Tanks / Batteries
  { match: /\b(door\s*assembly|door\s*shell|complete\s*door)\b/i, exclude: /\b(panel|trim|card|handle|latch|hinge|mirror|regulator|lock|actuator|switch|speaker|wiring|harness|fuel\s*door|gas\s*door|glove\s*box)\b/i, weight: 62.0, l: 48, w: 30, h: 14, labor: 2.0, localPickup: true },
  { match: /\b(front\s*(?:left|right)?\s*(?:driver|passenger)?\s*(?:side)?\s*door|rear\s*(?:left|right)?\s*(?:driver|passenger)?\s*(?:side)?\s*door|sliding\s*door|car\s*door)\b/i, exclude: /\b(panel|trim|card|handle|latch|hinge|mirror|glass|window|regulator|lock|actuator|switch|speaker|wiring|harness|check|strap|seal|weatherstrip|molding|sill|scuff|fuel\s*door|gas\s*door|glove\s*box)\b/i, weight: 62.0, l: 48, w: 30, h: 14, labor: 2.0, localPickup: true },
  { match: /\b(tailgate|liftgate|hatch\s*lid|rear\s*hatch|trunk\s*lid|deck\s*lid)\b/i, exclude: /\b(handle|latch|hinge|strut|support|cable|switch|camera|emblem|trim|panel|glass|window|motor|wiper|lock|actuator)\b/i, weight: 60.0, l: 54, w: 28, h: 12, labor: 2.0, localPickup: true },
  { match: /\b(hood\s*panel|hood\s*assembly|engine\s*hood|car\s*hood|\bhood\b)\b/i, exclude: /\b(latch|hinge|prop|rod|strut|support|cowl|scoop|release|cable|insulator|pad|liner|trim|seal|weatherstrip|emblem|deflector|bug\s*shield)\b/i, weight: 58.0, l: 56, w: 48, h: 10, labor: 2.0, localPickup: true },
  { match: /\b(front\s*seat|rear\s*seat|bench\s*seat|bucket\s*seat|driver\s*seat|passenger\s*seat|car\s*seats?|seat\s*assembly|seat\s*pair|seat\s*set|3rd\s*row\s*seat|second\s*row\s*seat|\bseat\b)\b/i, exclude: /\b(belt|buckle|retractor|switch|motor|heater|module|sensor|trim|bezel|cover\s*trim|rail\s*cover|bracket|handle|lever|knob|headrest|armrest)\b/i, weight: 55.0, l: 42, w: 28, h: 24, labor: 1.5, localPickup: true },
  { match: /\b(bed\s*liner|truck\s*bed\s*liner)\b/i, weight: 45.0, l: 72, w: 56, h: 18, labor: 1.0, localPickup: true },
  { match: /\b(ladder\s*rack|truck\s*bed.*rack|bed\s*rack|running\s*board|step\s*bar|nerf\s*bar|side\s*step)\b/i, weight: 48.0, l: 72, w: 14, h: 10, labor: 1.5, localPickup: true },
  { match: /\b(front\s*bumper|rear\s*bumper|bumper\s*cover|bumper\s*assembly|bumper\s*reinforcement|bumper\s*bar)\b/i, exclude: /\b(bracket|clip|retainer|sensor|reflector|filler|grille|fog|light|lamp|trim|molding|valence|skirt\s*bracket|tow\s*hook\s*cover|cap)\b/i, weight: 38.0, l: 68, w: 20, h: 18, labor: 2.0, localPickup: true },
  { match: /\b(fender\s*apron|inner\s*fender\s*apron)\b/i, weight: 28.0, l: 40, w: 22, h: 14, labor: 2.5, localPickup: true },
  { match: /\b(fender\s*assembly|fender\s*panel|front\s*fender|\bfender\b|quarter\s*panel|bed\s*panel|truck\s*bed\s*side|bedside)\b/i, exclude: /\b(liner|flare|trim|molding|emblem|badge|bracket|apron|splash|mud\s*flap)\b/i, weight: 34.0, l: 48, w: 30, h: 14, labor: 2.0, localPickup: true },
  { match: /\b(dashboard\s*assembly|dashboard\s*frame|complete\s*dashboard|dash\s*pad\s*assembly|instrument\s*panel\s*assembly|interior\s*front\s*cabin\s*assembly)\b/i, exclude: /\b(trim|bezel|vent|switch|cluster|glove|speaker|cover|mat)\b/i, weight: 45.0, l: 56, w: 22, h: 18, labor: 3.5, localPickup: true },
  { match: /\b(roof\s*headliner|headliner\s*assembly|interior\s*headliner|floor\s*carpet|carpet\s*assembly)\b/i, weight: 28.0, l: 64, w: 44, h: 8, labor: 2.0, localPickup: true },
  { match: /\b(fuel\s*tank|gas\s*tank)\b/i, exclude: /\b(cap|door|strap|filler\s*neck|filler\s*housing|pump|sending\s*unit|sensor|shield)\b/i, weight: 38.0, l: 44, w: 24, h: 16, labor: 3.0, localPickup: true },
  { match: /\b(battery\s*assembly|12v\s*battery|car\s*battery|automotive\s*battery)\b/i, exclude: /\b(tray|hold\s*down|clamp|retainer|cable|terminal|sensor|cover|box|bracket|blanket)\b/i, weight: 42.0, l: 13, w: 10, h: 10, labor: 0.5, localPickup: true },
  { match: /\b(windshield|back\s*window|rear\s*window\s*glass|rear\s*(?:power\s*)?sliding\s*window|sliding\s*rear.*window|back\s*glass)\b/i, exclude: /\b(wiper|washer|motor|linkage|arm|blade|reservoir|pump|switch|cowl|molding|trim|seal|mirror)\b/i, weight: 42.0, l: 58, w: 34, h: 8, labor: 2.0, localPickup: true },
  { match: /\b(exhaust\s*assembly|exhaust\s*muffler|muffler\s*assembly|cat-?back|exhaust\s*pipe|tailpipe|resonator\s*pipe)\b/i, exclude: /\b(manifold|tip|hanger|clamp|gasket|heat\s*shield|sensor)\b/i, weight: 34.0, l: 54, w: 16, h: 12, labor: 2.0, localPickup: true },

  // 8. Large Parcel / Bulky Trim, Glass, Cooling, Chassis, Suspension & Exhaust Components (9–38 lbs, real packed box LxWxH)
  { match: /\b(door\s*glass|door\s*window\s*glass|quarter\s*glass|quarter\s*window|side\s*window\s*glass|vent\s*glass)\b/i, weight: 16.0, l: 34, w: 24, h: 6, labor: 1.5 },
  { match: /\b(roof\s*rack|luggage\s*rack|roof\s*rail|crossbar)\b/i, weight: 22.0, l: 60, w: 12, h: 8, labor: 1.0 },
  { match: /\b(rocker\s*panel|side\s*skirt|front\s*valance|rear\s*valance|air\s*dam|rear\s*spoiler|wing\s*spoiler)\b/i, weight: 14.0, l: 62, w: 10, h: 8, labor: 1.5 },
  { match: /\b(door\s*trim\s*panel|interior\s*door\s*panel|door\s*panel\s*assembly|door\s*panel\s*trim|door\s*panel|door\s*card)\b/i, weight: 12.0, l: 36, w: 24, h: 6, labor: 0.75 },
  { match: /\b(quarter\s*panel.*trim|rear\s*cargo\s*cover|trunk\s*shade|sound\s*deadening\s*panel)\b/i, weight: 9.0, l: 36, w: 20, h: 8, labor: 0.75 },
  { match: /\b(radiator\s*cooling\s*assembly|radiator\s*assembly|radiator\s*core\s*support|core\s*support|\bradiator\b)\b/i, exclude: /\b(cap|hose|bracket|overflow|reservoir|fan|shroud|support\s*cover|trim)\b/i, weight: 22.0, l: 32, w: 24, h: 8, labor: 2.0 },
  { match: /\b(a\/?c\s*condenser|condenser\s*assembly|\bcondenser\b)\b/i, weight: 14.0, l: 30, w: 22, h: 6, labor: 2.0 },
  { match: /\b(cooling\s*fan|fan\s*shroud|fan\s*clutch.*blade|radiator\s*fan|fan\s*assembly)\b/i, weight: 14.0, l: 26, w: 20, h: 8, labor: 1.5 },
  { match: /\b(steering\s*rack|rack\s*and\s*pinion)\b/i, weight: 28.0, l: 46, w: 12, h: 10, labor: 3.5 },
  { match: /\b(driveshaft|drive\s*shaft|propeller\s*shaft)\b/i, weight: 26.0, l: 54, w: 8, h: 8, labor: 2.0 },
  { match: /\b(steering\s*column)\b/i, weight: 22.0, l: 36, w: 12, h: 10, labor: 2.0 },
  { match: /\b(leaf\s*spring|trailer\s*hitch|tow\s*hitch|receiver\s*hitch)\b/i, weight: 38.0, l: 50, w: 12, h: 10, labor: 2.0 },
  { match: /\b(transmission\s*crossmember|crossmember)\b/i, weight: 22.0, l: 34, w: 10, h: 8, labor: 2.0 },
  { match: /\b(strut\s*(?:and|&)?\s*spring|strut\s*assembly|coilover|front\s*strut|shock.*coil)\b/i, weight: 18.0, l: 26, w: 10, h: 10, labor: 2.0 },
  { match: /\b(cv\s*axle|axle\s*shaft|half\s*shaft)\b/i, weight: 18.0, l: 30, w: 8, h: 8, labor: 2.0 },
  { match: /\b(intake\s*manifold|exhaust\s*manifold|intercooler|turbocharger|\bturbo\b)\b/i, weight: 18.0, l: 22, w: 14, h: 12, labor: 2.5 },
  { match: /\b(hvac\s*blower\s*motor\s*housing|blower\s*motor\s*housing|heater\s*box|hvac\s*housing|evaporator\s*box|heater\s*core\s*housing)\b/i, weight: 16.0, l: 24, w: 18, h: 14, labor: 2.5 },
  { match: /\b(cargo\s*storage\s*box|storage\s*box\s*assembly|center\s*console|subwoofer.*enclosure|subwoofer\s*speaker)\b/i, weight: 14.0, l: 26, w: 16, h: 12, labor: 1.0 },
  { match: /\b(control\s*arm|suspension\s*arm|trailing\s*arm|sway\s*bar|stabilizer\s*bar)\b/i, weight: 14.0, l: 24, w: 14, h: 8, labor: 2.0 },
  { match: /\b(spare\s*tire\s*jack|scissor\s*jack|jack\s*tool\s*kit)\b/i, weight: 11.0, l: 20, w: 8, h: 6, labor: 0.5 },
  { match: /\b(front\s*grille|radiator\s*grille|grille\s*assembly|\bgrille\b)\b/i, weight: 10.0, l: 42, w: 14, h: 8, labor: 0.75 },
  { match: /\b(fender\s*flare|fender\s*liner|wheel\s*well\s*liner|splash\s*shield|engine\s*under\s*cover|skid\s*plate|under\s*cover)\b/i, weight: 9.0, l: 32, w: 22, h: 8, labor: 0.75 },
  { match: /\b(rear\s*shock|shock\s*absorber|coil\s*spring)\b/i, weight: 10.0, l: 24, w: 6, h: 6, labor: 1.5 },
  { match: /\b(alternator|generator|a\/?c\s*compressor|air\s*conditioning\s*compressor|brake\s*caliper|caliper|wheel\s*hub|spindle|knuckle|brake\s*rotor|brake\s*booster|abs\s*pump|abs\s*actuator|power\s*steering\s*pump|cylinder\s*head|flywheel|torque\s*converter|transmission\s*oil\s*pan|oil\s*pan)\b/i, weight: 16.0, l: 14, w: 12, h: 10, labor: 2.0 },
  { match: /\b(starter|master\s*cylinder|water\s*pump|oil\s*pump|fuel\s*pump\s*module|timing\s*chain|timing\s*belt|heater\s*core|engine\s*mount|accessory\s*belt\s*system)\b/i, weight: 12.5, l: 14, w: 12, h: 10, labor: 2.0 },

  // 9. Medium Parcel Lighting, Mirrors, Intake/Air Boxes, Wiper Linkages & Regulators (6–9 lbs, real box LxWxH)
  { match: /\b(headlight|headlamp)\b/i, weight: 9.0, l: 22, w: 14, h: 12, labor: 0.75 },
  { match: /\b(tail\s*light|taillight|tail\s*lamp)\b/i, weight: 6.0, l: 18, w: 12, h: 10, labor: 0.75 },
  { match: /\b(side\s*view\s*(?:door\s*)?mirror|exterior\s*(?:view\s*)?mirror|side\s*mirror|door\s*mirror|wing\s*mirror)\b/i, weight: 6.5, l: 16, w: 12, h: 10, labor: 0.75 },
  { match: /\b(air\s*filter\s*box|air\s*intake\s*box|air\s*cleaner\s*box|air\s*filter\s*housing|wiper\s*motor.*linkage|wiper\s*linkage|window\s*regulator|charcoal\s*canister|evaporative\s*emissions|engine\s*cover|body\s*wiring\s*harness|wiring\s*harness)\b/i, weight: 7.5, l: 18, w: 12, h: 10, labor: 1.0 },
  { match: /\b(instrument\s*cluster|speedometer|gauge\s*cluster|radio|stereo|head\s*unit|navigation|infotainment|glove\s*box|overhead\s*console|dash\s*panel|dash\s*trim|dashboard\s*trim|pillar\s*trim|trim\s*panel|cargo\s*trim|wheel\s*cover|hubcap|cowl|shifter|heat\s*shield|spare\s*tire\s*cover|mud\s*flap|splash\s*guard|speaker\s*set|accelerator.*pedal|gas\s*pedal|battery\s*tray)\b/i, weight: 6.0, l: 16, w: 12, h: 8, labor: 0.75 },
  { match: /\b(kick\s*panel|scuff\s*plate)\b/i, weight: 4.0, l: 18, w: 10, h: 6, labor: 0.5 },
  { match: /\b(wiper\s*arm)\b/i, weight: 3.5, l: 22, w: 4, h: 3, labor: 0.5 },

  // 10. Small Mechanical / Fluid / Wiper Components (4.5 lbs, 12 x 10 x 6 in)
  { match: /\b(wiper\s*blade|fuel\s*(gas\s*)?filler\s*(housing|pocket|door\s*hinge)|fuel\s*door|clutch\s*slave|clutch\s*cable|throttle\s*body|fuel\s*rail|blower\s*motor|wiper\s*motor|window\s*motor|reservoir|overflow\s*tank|washer\s*tank|coolant\s*tank|fog\s*light|parking\s*light|turn\s*signal|side\s*marker|rear\s*view\s*mirror|rearview\s*mirror)\b/i, weight: 4.5, l: 12, w: 10, h: 6, labor: 0.75 }
];

/**
 * REALISTIC PART-CATEGORY BOOK-TIME LABOR MATRIX ($174.99/hr) — v32.3
 * Replaces flat 1.0 hr / 1.5 hr fallback with certified shop book-time estimates:
 *  - Engine Assemblies / Long Blocks / Short Blocks: 12.0 hrs (10.0–14.0 hrs, +$2,099.88)
 *  - Automatic/Manual Transmissions & Transfer Cases: 6.0 hrs (5.0–7.0 hrs, +$1,049.94)
 *  - Differentials, Axles, Subframes, Steering Racks & Exhaust Manifolds: 3.5 hrs (3.0–4.5 hrs, +$612.47)
 *  - Alternators, Starters, A/C Compressors, Radiators, Struts, Control Arms, Hub Bearings, Fuel Pumps, Doors & Fenders: 2.0 hrs (1.5–2.5 hrs, +$349.98)
 *  - Sensors, Switches, Mirrors, Headlights/Taillights, Shifters, Trim, Modules & Small Bolt-Ons: 0.75 hr (0.5–1.0 hr, +$131.24)
 */
function resolveCategoryBookTimeLabor(item = {}, laborRateInput = SHOP_LABOR_RATE_LOCKED) {
  const rate = Number(laborRateInput || SHOP_LABOR_RATE_LOCKED) || SHOP_LABOR_RATE_LOCKED;
  const titleStr = String(item.title || item.part_name || '').trim();
  const catStr = String(item.category || item.product_type || '').trim();
  const titleLower = titleStr.toLowerCase();
  const combined = `${titleStr} ${catStr}`.toLowerCase();

  // Guard: small engine/trans/door accessories & electronics must NEVER jump into 12-hr engine or 6-hr trans tiers
  const isSmallSubpartOrAccessory = /\b(sensor|switch|module|ecm|ecu|pcm|bcm|tcm|computer|harness|wire|wiring|relay|fuse|solenoid|cover|bezel|trim|knob|handle|latch|hinge|mount|bracket|gasket|seal|hose|tube|pipe|duct|dipstick|cap|pulley|tensioner|belt|filter|box|air\s*box|air\s*cleaner|throttle\s*body|injector|coil\s*pack|ignition\s*coil|valve\s*cover|oil\s*pan|cooler|line|cable|shifter|linkage|reservoir|mirror|light|lamp|headlight|headlamp|taillight|tail\s*light|fog\s*light|speaker|radio|stereo|cluster|speedometer|visor|mat|console|armrest|vent|grille|emblem|badge|molding|weatherstrip|seal\s*strip|clip|bolt|nut|stud|washer|shield|splash\s*guard|liner|skid\s*plate|under\s*cover|regulator|actuator)\b/i.test(titleLower);

  const buildTier = (tier, hours, range, isMajor) => {
    const laborCost = Number((hours * rate).toFixed(2));
    const rateTxt = `$${rate.toFixed(2)}/hr`;
    const label = isMajor
      ? `Est. ~${range} certified bay labor @ ${rateTxt} (Final quote confirmed prior to work)`
      : `Est. ~${range} certified bay labor @ ${rateTxt}${hours >= 2.0 ? ' (Final quote confirmed prior to work)' : ''}`;
    return {
      tier,
      hours,
      range,
      rate,
      labor_cost: laborCost,
      is_major_drivetrain: isMajor,
      label
    };
  };

  // Tier 5: Engine Assemblies / Engine Cores / Long Blocks / Short Blocks (12.0 hrs | 10.0–14.0 hrs)
  if (
    !isSmallSubpartOrAccessory &&
    /\b(complete\s*engine|engine\s*assembly|engine\s*core|engine\s+(?:\d\.\d[lL]\s+)?(?:\d-?cyl\s+)?(?:[a-z0-9-]+\s+){0,3}assembly|long\s*block|short\s*block|motor\s*assembly|v6\s*engine|v8\s*engine|i4\s*engine|4\.0l\s*engine|5\.7l\s*engine|4\.7l\s*engine|2\.4l\s*engine|1\.4l\s*engine)\b/i.test(titleLower)
  ) {
    return buildTier('engine_assembly', 12.0, '10.0–14.0 hrs', true);
  }

  // Tier 4: Automatic / Manual Transmissions, Transaxles & Transfer Cases (6.0 hrs | 5.0–7.0 hrs)
  if (
    !isSmallSubpartOrAccessory &&
    /\b(automatic\s*transmission|manual\s*transmission|transmission\s*assembly|transaxle|transfer\s*case|gearbox\s*assembly)\b/i.test(titleLower)
  ) {
    return buildTier('transmission_transfer_case', 6.0, '5.0–7.0 hrs', true);
  }

  // Tier 3: Differentials, Axles, Subframes, Steering Racks & Exhaust Manifolds/Cats (3.5 hrs | 3.0–4.5 hrs)
  if (
    !isSmallSubpartOrAccessory &&
    /\b(front\s*differential|rear\s*differential|differential\s*(?:assembly|carrier|housing)|axle\s*(?:assembly|housing|shaft)|cv\s*axle|half\s*shaft|subframe|k-?frame|crossmember|steering\s*rack|rack\s*and\s*pinion|exhaust\s*manifold|catalytic|cylinder\s*head|timing\s*chain|timing\s*belt|heater\s*core|complete\s*dashboard|dashboard\s*assembly|fuel\s*tank|gas\s*tank|frame\s*section|frame\s*rail)\b/i.test(titleLower)
  ) {
    return buildTier('drivetrain_chassis_major', 3.5, '3.0–4.5 hrs', true);
  }

  // Tier 2: Alternators, Starters, A/C Compressors, Radiators, Struts, Control Arms, Hub Bearings, Fuel Pumps, Doors, Fenders, Hoods, Tailgates, Bumpers, Sunroofs & Seats (2.0 hrs | 1.5–2.5 hrs)
  if (
    !/\b(handle|switch|latch|hinge|mirror|trim|molding|weatherstrip|seal|wiring|harness|speaker|panel\s*trim|cover\s*trim|bezel|cap|bracket|mount|sensor|relay|fuse)\b/i.test(titleLower) &&
    /\b(alternator|generator|starter\s*motor|\bstarter\b|a\/?c\s*compressor|air\s*conditioning\s*compressor|radiator|condenser|strut|shock\s*absorber|coilover|control\s*arm|trailing\s*arm|suspension\s*arm|wheel\s*hub|hub\s*bearing|wheel\s*bearing|spindle|knuckle|fuel\s*pump|power\s*steering\s*pump|water\s*pump|brake\s*booster|master\s*cylinder|brake\s*caliper|abs\s*pump|abs\s*actuator|driveshaft|drive\s*shaft|complete\s*door|door\s*shell|door\s*assembly|front\s*door|rear\s*door|driver\s*door|passenger\s*door|sliding\s*door|car\s*door|front\s*fender|fender\s*panel|fender\s*assembly|\bfender\b|quarter\s*panel|tailgate|liftgate|hatch\s*lid|trunk\s*lid|hood\s*panel|hood\s*assembly|engine\s*hood|front\s*bumper|rear\s*bumper|bumper\s*cover|bumper\s*assembly|windshield|window\s*glass|door\s*glass|quarter\s*glass|sunroof|moonroof|front\s*seat|rear\s*seat|bench\s*seat|bucket\s*seat|turbocharger|intake\s*manifold)\b/i.test(titleLower)
  ) {
    return buildTier('mid_mechanical_body', 2.0, '1.5–2.5 hrs', false);
  }

  // Also check if a broad category matches mid-tier mechanical when title has no small-part markers
  if (!isSmallSubpartOrAccessory && /\b(suspension|brakes|cooling|charging|starting)\b/i.test(combined) && !/\b(pad|clip|cap|cover|sensor|switch|line|hose)\b/i.test(titleLower)) {
    return buildTier('mid_mechanical_body', 2.0, '1.5–2.5 hrs', false);
  }

  // Tier 1: Sensors, Switches, Mirrors, Headlights/Taillights, Shifters, Trim, Modules & Small Bolt-Ons (0.75 hr | 0.5–1.0 hr)
  return buildTier('bolt_on_electrical_trim', 0.75, '0.5–1.0 hr', false);
}

function resolvePartDimensionsAndWeight(item = {}) {
  const titleStr = typeof item === 'string' ? item : String(item.title || '');
  const catStr = typeof item === 'string' ? '' : String(item.category || '');
  const bookTime = resolveCategoryBookTimeLabor({ title: titleStr, category: catStr });
  const matchesRule = (r, txt) => r.match.test(txt) && (!r.exclude || !r.exclude.test(txt));
  // Match specific title FIRST so broad category names never shadow light components
  const matched =
    DIMENSION_RULES.find((r) => matchesRule(r, titleStr)) ||
    DIMENSION_RULES.find((r) => matchesRule(r, `${titleStr} ${catStr}`));

  if (matched) {
    // Allow Vision-verified weight/dim refinement ONLY within +/- 30% of deterministic class bounds
    let finalWeight = matched.weight;
    const visionW = Number(item.vision_weight_lbs || 0);
    if (visionW > 0 && visionW !== 8.5 && visionW !== 2 && visionW >= matched.weight * 0.7 && visionW <= matched.weight * 1.3) {
      finalWeight = Number(visionW.toFixed(1));
    }
    return {
      weight_lbs: finalWeight,
      length_in: matched.l,
      width_in: matched.w,
      height_in: matched.h,
      labor_hours: bookTime.hours,
      labor_range: bookTime.range,
      labor_label: bookTime.label,
      is_major_drivetrain: bookTime.is_major_drivetrain,
      local_pickup_only: Boolean(matched.localPickup)
    };
  }

  // Deterministic category-tier fallback (ZERO 8.5 lb, ZERO 14x10x7 / 14x10x8!)
  const combined = `${titleStr} ${catStr}`.toLowerCase();
  if (/engine|drivetrain|transmission|axle|differential|exhaust/i.test(combined)) {
    return { weight_lbs: 18.0, length_in: 16, width_in: 12, height_in: 10, labor_hours: bookTime.hours, labor_range: bookTime.range, labor_label: bookTime.label, is_major_drivetrain: bookTime.is_major_drivetrain, local_pickup_only: false };
  }
  if (/suspension|brake|steering|cooling|radiator|hvac|fuel|charging|starting/i.test(combined)) {
    return { weight_lbs: 14.0, length_in: 16, width_in: 12, height_in: 10, labor_hours: bookTime.hours, labor_range: bookTime.range, labor_label: bookTime.label, is_major_drivetrain: bookTime.is_major_drivetrain, local_pickup_only: false };
  }
  return { weight_lbs: 4.5, length_in: 10, width_in: 8, height_in: 6, labor_hours: bookTime.hours, labor_range: bookTime.range, labor_label: bookTime.label, is_major_drivetrain: bookTime.is_major_drivetrain, local_pickup_only: false };
}

function normalizeVehicleTitleCasing(title) {
  return String(title || '')
    .replace(/\b4runner\b/gi, '4Runner')
    .replace(/\bRainx\b/gi, 'Rain-X')
    .replace(/\bRain X\b/gi, 'Rain-X')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripOffPlatformViolations(text = '') {
  return stripDriveUrlsFromPublicText(text)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b(?:www\.)?[a-z0-9-]+\.(?:com|net|org|io|app|shop|store|myshopify\.com)(?:\/\S*)?/gi, '')
    .replace(/\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '')
    .replace(/\b5115\s+66th\s+St\s+W(?:,?\s*Bldg\s*B)?(?:,?\s*University\s+Place(?:\s*\/\s*Tacoma)?,?\s*WA\s*98467)?/gi, '')
    .replace(/\bUniversity\s+Place\s*\/\s*Tacoma,?\s*WA\s*98467/gi, '')
    .replace(/\bUniversity\s+Place,?\s*WA\s*98467/gi, '')
    .replace(/\bservice@aldridgeautosupply\.com\b/gi, '')
    .replace(/Optional\s+Certified\s+Shop\s+Bay\s+Installation[\s\S]*/i, '')
    .replace(/Returns\s+Not\s+Accepted[\s\S]*/i, '')
    .replace(/\s*\|\s*\|/g, ' |')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function dedupeSentences(text = '') {
  const sentences = String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const s of sentences) {
    const key = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.join(' ');
}

function isGenericBoilerplateNote(note = '') {
  const s = String(note || '').trim().toLowerCase();
  if (!s || s.length < 12) return true;
  return /^(inspected & verified\.?|clean tested assembly\.?|used oem — inspected on-site|used oem — pulled & inspected on-site|new in-stock replacement part)/i.test(s);
}

/**
 * Builds a clean, concise, unique part-specific description directly from Gemini Vision
 * inspection notes + verified donor fitment + real/structured OEM MPN + physical shipping specs.
 * ZERO phone numbers, ZERO street addresses, ZERO URLs, ZERO policy walls, ZERO repeated sentences!
 */
function buildRichStructuredDescription(item = {}, settings = {}) {
  const { mpn, hasStampedMpn } = resolveStructuredOemMpn(item);
  const isNew = String(item.condition || 'Used').toLowerCase() === 'new';
  const fitmentLine = [item.fitment_years, item.fitment_make, item.fitment_model, item.fitment_engine]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' ');
  const isLocalPickup = item.shipping_class === 'local_pickup_only' || Number(item.weight_lbs || 0) >= Number(settings.freight_weight_threshold_lbs || 70);
  const donorVin = String(item.verified_vin || '').trim().toUpperCase();

  // Preserve unique Gemini Vision inspection details (never overwrite with generic boilerplate)
  const rawDefect = stripOffPlatformViolations(item.defect_disclosure || '');
  const visionDetail = rawDefect && !isGenericBoilerplateNote(rawDefect)
    ? rawDefect
    : (isNew
      ? 'New OEM factory replacement component with intact mounting points and clean finish.'
      : `Inspected Used OEM ${item.category || 'component'} removed from verified donor vehicle with intact mounting tabs and connectors; inspect all photos for exact cosmetic condition.`);

  const mpnLine = hasStampedMpn
    ? `Stamped OEM Part Number: ${mpn}${item.interchange_number ? ` (Interchange: ${item.interchange_number})` : ''}.`
    : `OEM Reference Code: ${mpn}.`;

  const fitmentSentence = fitmentLine
    ? `Donor Vehicle Fitment: ${fitmentLine}${donorVin.length === 17 ? ` (Donor VIN: ${donorVin})` : ''}.`
    : '';

  const specLine = `Physical Spec: ${Number(item.weight_lbs)} lbs, packed ${Math.round(Number(item.length_in))} x ${Math.round(Number(item.width_in))} x ${Math.round(Number(item.height_in))} in (${isLocalPickup ? 'Local Pickup Only' : 'Parcel Shipping Eligible'}).`;

  const parts = [
    `${cleanListingTitle(item.title || '')}.`,
    visionDetail.endsWith('.') ? visionDetail : `${visionDetail}.`,
    fitmentSentence,
    mpnLine,
    specLine
  ].filter(Boolean);

  return dedupeSentences(stripOffPlatformViolations(parts.join(' ')));
}

function enrichAllActiveInventoryInDb() {
  // 0. PERMANENT GHOST VEHICLE & STRICT VIN PURGE FIRST (Purges 2015 Buick LaCrosse 1G4GA5GR2FF246661, 5 sold Subaru transmissions, VIN-TITLE-CHECK)
  const ghostPurge = purgeGhostAndBlockedInventory({ actor: 'enrichAllActiveInventoryInDb_v31' });

  const settings = getSettings();
  const laborRate = Number(settings.labor_rate_hourly || SHOP_LABOR_RATE_LOCKED);
  const donors = db.prepare('SELECT * FROM donor_vehicles').all();
  const rows = db.prepare("SELECT * FROM inventory_items WHERE status IN ('active', 'pending_verification', 'inactive')").all();
  const now = new Date().toISOString();

  let updatedCount = 0;
  let complianceBlockedCount = 0;
  let pendingVerificationCount = 0;
  const blockedSkus = [];
  const pendingSkus = [];

  const blockStmt = db.prepare("UPDATE inventory_items SET status = 'compliance_blocked', quantity = 0, updated_at = ? WHERE id = ?");
  const archiveStmt = db.prepare("UPDATE inventory_items SET status = 'archived', quantity = 0, updated_at = ? WHERE id = ?");
  const pendingStmt = db.prepare("UPDATE inventory_items SET status = 'pending_verification', quantity = 0, fitment_notes = ?, updated_at = ? WHERE id = ?");
  const updateStmt = db.prepare(`
    UPDATE inventory_items SET
      title = ?,
      category = ?,
      condition = ?,
      condition_id = ?,
      brand = ?,
      oem_part_number = ?,
      interchange_number = ?,
      placement_on_vehicle = ?,
      fitment_years = ?,
      fitment_make = ?,
      fitment_model = ?,
      fitment_engine = ?,
      fitment_notes = ?,
      description = ?,
      defect_disclosure = ?,
      price_we_pull = ?,
      allow_pull_install = ?,
      price_pull_install = ?,
      install_labor_hours = ?,
      weight_lbs = ?,
      length_in = ?,
      width_in = ?,
      height_in = ?,
      shipping_class = ?,
      status = ?,
      quantity = ?,
      updated_at = ?
    WHERE id = ?
  `);

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const row of rows) {
      const skuUpper = String(row.sku || '').toUpperCase();
      if (isGhostOrBannedInventoryItem(row).blocked) {
        archiveStmt.run(now, row.id);
        continue;
      }
      if (PROHIBITED_CAT_SKUS.has(skuUpper) || PROHIBITED_SRS_AND_MISSING_PHOTO_SKUS.has(skuUpper)) {
        blockStmt.run(now, row.id);
        complianceBlockedCount++;
        blockedSkus.push(row.sku);
        continue;
      }

      if (DUPLICATE_PHYSICAL_PART_SKUS.has(skuUpper)) {
        const dupNote = 'PENDING VERIFICATION: Quarantined duplicate physical part photo (prevents double-sale of single-unit OEM part).';
        pendingStmt.run(dupNote, now, row.id);
        pendingVerificationCount++;
        pendingSkus.push({ sku: row.sku, title: row.title, reasons: ['Duplicate physical part photo quarantined'] });
        continue;
      }

      const enrich = VERIFIED_SKU_ENRICHMENTS[skuUpper] || null;
      const title = cleanListingTitle(normalizeVehicleTitleCasing(enrich?.title || row.title));
      const fitmentYears = String(enrich?.years || row.fitment_years || '').replace(/Multi-Fit|Universal/gi, '').trim();
      const fitmentMake = String(enrich?.make || row.fitment_make || '').replace(/Universal\s*OEM|Universal/gi, '').trim();
      const fitmentModel = String(enrich?.model || row.fitment_model || '').replace(/Verify Size \/ Fitment/gi, '').trim();
      const condition = enrich?.condition || row.condition || 'Used';
      const conditionId = condition.toLowerCase() === 'new' ? 1000 : 3000;

      // Match donor vehicle by verified VIN first, then make/model
      const matchedDonor =
        donors.find((d) => row.verified_vin && String(d.vin || '').toUpperCase() === String(row.verified_vin).toUpperCase()) ||
        donors.find((d) =>
          fitmentMake &&
          d.make.toLowerCase() === fitmentMake.toLowerCase() &&
          fitmentModel &&
          fitmentModel.toLowerCase().includes(d.model.split(' ')[0].toLowerCase())
        );
      const fitmentEngine = enrich?.engine || row.fitment_engine || matchedDonor?.engine || '';
      const brand = enrich?.brand || (fitmentMake ? `${fitmentMake} OEM` : (row.brand || 'OEM'));
      const cleanInterchange = sanitizeVerifiedMpn(enrich?.interchange || row.interchange_number);
      const placement = enrich?.placement || row.placement_on_vehicle || '';

      const tax = resolvePartTaxonomyAndMetafields({
        ...row,
        title,
        category: '',
        brand,
        condition,
        oem_part_number: enrich?.mpn !== undefined ? enrich.mpn : row.oem_part_number,
        fitment_years: fitmentYears,
        fitment_make: fitmentMake,
        fitment_model: fitmentModel,
        verified_vin: row.verified_vin || matchedDonor?.vin || ''
      }, settings);

      const resolvedMpn = tax.mpn;
      const dims = resolvePartDimensionsAndWeight({
        title,
        category: tax.partType,
        install_labor_hours: row.install_labor_hours
      });
      const priceWePull = Number(enrich?.price ?? row.price_we_pull ?? 75);
      const laborHours = Number(enrich?.laborHours !== undefined ? enrich.laborHours : dims.labor_hours);
      const pricePullInstall = laborHours > 0
        ? Number((priceWePull + laborHours * laborRate).toFixed(2))
        : priceWePull;
      const shippingClass = dims.local_pickup_only
        ? 'local_pickup_only'
        : computeShippingClass(dims.weight_lbs, `${tax.partType} ${title}`, dims.length_in, dims.width_in, dims.height_in);
      const origin = resolveCountryOfOrigin({
        verified_vin: row.verified_vin || matchedDonor?.vin || '',
        title,
        brand,
        fitment_make: fitmentMake,
        description: enrich?.notes || ''
      });

      // Preserve unique Gemini Vision inspection notes! Never overwrite specific Vision notes with canned boilerplate.
      const existingDefectClean = stripOffPlatformViolations(row.defect_disclosure || '');
      const defectDisclosure = !isGenericBoilerplateNote(existingDefectClean)
        ? existingDefectClean
        : (enrich?.notes
          ? stripOffPlatformViolations(enrich.notes)
          : (condition.toLowerCase() === 'new'
            ? 'New OEM factory component; verify connector and mounting geometry against photos.'
            : `Inspected Used OEM ${tax.partType} removed from ${fitmentYears} ${fitmentMake} ${fitmentModel}; mounting tabs and connectors intact as photographed.`));

      const fitmentNotesParts = [
        fitmentYears || fitmentMake ? `Verified Fitment: ${[fitmentYears, fitmentMake, fitmentModel, enrich?.trim || matchedDonor?.trim || '', fitmentEngine].filter(Boolean).join(' ')}` : '',
        row.verified_vin ? `Donor VIN: ${String(row.verified_vin).toUpperCase()}` : '',
        resolvedMpn ? `OEM MPN: ${resolvedMpn}${cleanInterchange ? ` / ${cleanInterchange}` : ''}` : '',
        `Origin: ${origin}`
      ].filter(Boolean);
      const cleanFitmentNotes = stripOffPlatformViolations(fitmentNotesParts.join(' | '));

      const enrichedCandidate = {
        ...row,
        title,
        category: tax.partType,
        condition,
        brand,
        oem_part_number: resolvedMpn,
        interchange_number: cleanInterchange,
        fitment_years: fitmentYears,
        fitment_make: fitmentMake,
        fitment_model: fitmentModel,
        fitment_engine: fitmentEngine,
        fitment_notes: cleanFitmentNotes,
        defect_disclosure: defectDisclosure,
        price_we_pull: priceWePull,
        install_labor_hours: laborHours,
        weight_lbs: dims.weight_lbs,
        length_in: dims.length_in,
        width_in: dims.width_in,
        height_in: dims.height_in,
        shipping_class: shippingClass
      };
      const richDescription = buildRichStructuredDescription(enrichedCandidate, { ...settings, labor_rate_hourly: laborRate });

      // MANDATORY ZERO-TOLERANCE VALIDATION GATE:
      // Any SKU lacking verified 17-char VIN/Year/Make/Model/Part Name/Weight/Dims is quarantined/archived!
      const gate = validateInventoryItemForPublish({ ...enrichedCandidate, description: richDescription });
      if (!gate.valid) {
        if (gate.recommended_status === 'compliance_blocked') {
          blockStmt.run(now, row.id);
          complianceBlockedCount++;
          blockedSkus.push(row.sku);
        } else if (gate.recommended_status === 'archived') {
          archiveStmt.run(now, row.id);
        } else {
          const reasonNote = `${cleanFitmentNotes} | PENDING VERIFICATION: ${gate.reasons.join('; ')}`;
          pendingStmt.run(reasonNote, now, row.id);
          pendingVerificationCount++;
          pendingSkus.push({ sku: row.sku, title, reasons: gate.reasons });
        }
        continue;
      }

      let nextPhotosJson = row.photos_json;
      if (Array.isArray(enrich?.preferredPhotos) && enrich.preferredPhotos.length) {
        let existingPhotos = [];
        try { existingPhotos = JSON.parse(row.photos_json || '[]').filter(Boolean); } catch (_) {}
        const hasCdn = existingPhotos.some((u) => /^https:\/\/cdn\.shopify\.com\//i.test(String(u)));
        if (!hasCdn) {
          const ordered = [...enrich.preferredPhotos];
          const seen = new Set(ordered);
          for (const ep of existingPhotos) {
            // Keep P1608.jpg exclusively on the Forester rear seat listing (not front bucket seat pair)
            if (skuUpper === 'ALD-98SUB-FRONT-SEAT-P1608' && /P1608\.jpg$/i.test(ep)) continue;
            if (!seen.has(ep)) {
              seen.add(ep);
              ordered.push(ep);
            }
          }
          nextPhotosJson = JSON.stringify(ordered.slice(0, 10));
        }
      }

      updateStmt.run(
        title,
        tax.partType,
        condition,
        conditionId,
        brand,
        resolvedMpn,
        cleanInterchange,
        placement,
        fitmentYears,
        fitmentMake,
        fitmentModel,
        fitmentEngine,
        cleanFitmentNotes,
        richDescription,
        defectDisclosure,
        priceWePull,
        laborHours > 0 ? 1 : 0,
        pricePullInstall,
        laborHours,
        dims.weight_lbs,
        dims.length_in,
        dims.width_in,
        dims.height_in,
        shippingClass,
        'active',
        1,
        now,
        row.id
      );
      if (nextPhotosJson && nextPhotosJson !== row.photos_json) {
        db.prepare('UPDATE inventory_items SET photos_json = ? WHERE id = ?').run(nextPhotosJson, row.id);
      }
      updatedCount++;
    }
    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    throw err;
  }

  // PERMANENT DEDUPLICATION GATE: Automatically merge & archive duplicate physical parts immediately after enrichment
  const dedupeResult = deduplicateCatalog();

  const finalCounts = {};
  for (const r of db.prepare('SELECT status, COUNT(*) c FROM inventory_items GROUP BY status').all()) {
    finalCounts[r.status] = Number(r.c || 0);
  }

  logSync(
    'internal',
    'catalog_enrichment',
    'sanitize_enrich_174_99',
    'ALL',
    'success',
    `Enriched ${finalCounts.active || 0} unique single-variant OEM SKUs at $${laborRate.toFixed(2)}/hr labor; quarantined ${complianceBlockedCount} SRS SKUs (${blockedSkus.join(', ')}), ${finalCounts.pending_verification || 0} pending_verification SKUs, and ${finalCounts.duplicate_archived || 0} duplicate_archived SKUs.`
  );

  return {
    ok: true,
    labor_rate_hourly: laborRate,
    enriched_active_skus: finalCounts.active || 0,
    compliance_blocked_count: complianceBlockedCount,
    compliance_blocked_skus: blockedSkus,
    pending_verification_count: finalCounts.pending_verification || 0,
    pending_verification_skus: pendingSkus,
    duplicate_archived_count: finalCounts.duplicate_archived || 0,
    deduplication: dedupeResult
  };
}

/* ==================== PERMANENT CATALOG DEDUPLICATION ENGINE ==================== */

function parseYearBounds(text) {
  const s = String(text || '');
  const rangeMatch = s.match(/\b(19\d{2}|20\d{2})\s*[-–/]\s*(19\d{2}|20\d{2})\b/);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const singleMatch = s.match(/\b(19\d{2}|20\d{2})\b/);
  if (singleMatch) {
    const y = Number(singleMatch[1]);
    return { min: y, max: y };
  }
  return null;
}

function normalizeVehicleGroup(item) {
  const makeRaw = String(item.fitment_make || '').trim().toLowerCase();
  const modelRaw = String(item.fitment_model || '').trim().toLowerCase();
  const titleRaw = String(item.title || '').trim().toLowerCase();

  let make = makeRaw
    .replace(/\boem\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!make) {
    const mk = titleRaw.match(/\b(toyota|subaru|fiat|chevrolet|chevy|ford|honda|kia|nissan|dodge|jeep|gmc|mazda|hyundai|bmw|mercedes|volkswagen|audi)\b/);
    make = mk ? mk[1] : '';
  }
  if (make === 'chevy') make = 'chevrolet';

  let model = modelRaw
    .replace(/\b(pop|limited|sr5|awd|4wd|4x4|2wd|wagon|sedan|hatchback|pickup|base|sport|trail|crewmax|l|lx|ex|le|se|xle|sxt|gt)\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
  if (model === 's10' || modelRaw.includes('s-10') || modelRaw.includes('s10')) model = 's10';
  if (model.startsWith('500')) model = '500';
  if (model.startsWith('4runner')) model = '4runner';
  if (model.startsWith('outback')) model = 'outback';
  if (model.startsWith('forester')) model = 'forester';
  if (model.startsWith('legacy')) model = 'legacy';
  if (model.startsWith('camry')) model = 'camry';

  const yearBounds = parseYearBounds(item.fitment_years) || parseYearBounds(item.title);
  return { make, model, yearBounds };
}

function vehicleGenerationsMatch(a, b) {
  if (!a.make || !b.make || a.make !== b.make) return false;
  if (!a.model || !b.model || a.model !== b.model) return false;
  if (a.yearBounds && b.yearBounds) {
    return a.yearBounds.min <= b.yearBounds.max && b.yearBounds.min <= a.yearBounds.max;
  }
  return true;
}

function extractPlacementSide(text) {
  const s = String(text || '').toLowerCase();
  const hasFront = /\bfront\b/.test(s);
  const hasRear = /\b(rear|2nd\s*row|second\s*row|back\s*seat|bench)\b/.test(s);
  const hasLeft = /\b(left|driver|lh)\b/.test(s);
  const hasRight = /\b(right|passenger|rh)\b/.test(s);

  if (hasFront && hasLeft && !hasRight) return 'front_left';
  if (hasFront && hasRight && !hasLeft) return 'front_right';
  if (hasRear && hasLeft && !hasRight) return 'rear_left';
  if (hasRear && hasRight && !hasLeft) return 'rear_right';
  if (hasFront && !hasRear) return 'front';
  if (hasRear && !hasFront) return 'rear';
  if (hasLeft && !hasRight) return 'left';
  if (hasRight && !hasLeft) return 'right';
  return 'general';
}

/**
 * Maps an item's title + placement to a strict normalized physical component key.
 * Distinct placements (e.g. front_left vs front_right, front vs rear) NEVER produce the same key.
 * Distinct sub-components (e.g. bolster cushions vs rear seat, dash cluster vs cluster bezel,
 * interior junction fuse box vs engine bay fuse box) NEVER produce the same key.
 */
function normalizePartComponentKey(item) {
  const title = String(item.title || '').toLowerCase();
  const placement = String(item.placement_on_vehicle || '').toLowerCase();
  const combined = `${title} ${placement}`;
  const side = extractPlacementSide(combined);

  // 1. Seats (strictly separate front vs rear vs bolster cushions)
  if (/\bbolster\s*cushion/i.test(title)) return `seat_bolster_cushions::${side}`;
  if (/\b(seat|seats|bench\s*seat|bucket\s*seat|backrest)\b/i.test(title) && !/\b(belt|switch|motor|rail\s*cover|heater\s*switch)\b/i.test(title)) {
    if (side.startsWith('rear')) return 'seat_assembly::rear';
    if (side.startsWith('front')) return 'seat_assembly::front';
    return 'seat_assembly::general';
  }

  // 2. Interior Door Trim Panels vs Exterior Door Shells (strictly preserve L/R & F/R!)
  if (/\b(door\s*trim\s*panel|interior\s*door\s*trim|door\s*panel|door\s*card)\b/i.test(title)) {
    return `door_trim_panel::${side}`;
  }
  if (/\b(door\s*shell|complete\s*door|passenger\s*door|driver\s*door|rear\s*passenger\s*door)\b/i.test(title) && !/\b(window|glass|regulator|handle|hinge|latch|receiver|module|trim|panel|glove\s*box|filler)\b/i.test(title)) {
    return `door_shell::${side}`;
  }

  // 3. Engine Control Module (ECM / PCM / Engine ECU)
  if (/\b(engine\s*control\s*module|ecm\/pcm|ecm\/ecu|\becm\b|\bpcm\b)\b/i.test(title)) {
    return 'ecm_pcm_module';
  }

  // 4. Instrument Gauge Cluster / Speedometer (distinct from Surround Bezel!)
  if (/\b(cluster\s*surround\s*bezel|dash\s*bezel\s*trim|cluster\s*dash\s*bezel)\b/i.test(title)) {
    return 'instrument_cluster_bezel';
  }
  if (/\b(instrument\s*(gauge\s*)?cluster|speedometer)\b/i.test(title)) {
    return 'instrument_gauge_cluster';
  }

  // 5. ABS Anti-Lock Brake Pump / Hydraulic Control Module
  if (/\b(abs\s*anti-lock|abs\s*pump|abs\s*module|hydraulic\s*brake\s*booster.*abs)\b/i.test(title)) {
    return 'abs_brake_pump_module';
  }

  // 6. Fuse & Relay Boxes (strictly separate Engine Bay vs Interior Junction Block)
  if (/\b(fuse|relay)\b/i.test(title) && /\bbox\b/i.test(title) && !/\bbcm\b|\bbody\s*control\b/i.test(title)) {
    if (/\binterior|junction\s*block\b/i.test(combined)) return 'fuse_box::interior';
    if (/\bengine\s*bay\b/i.test(combined)) return 'fuse_box::engine_bay';
    return 'fuse_box::general';
  }

  // 7. Rear / Front Shock Absorber & Coil Spring Assemblies
  if (/\b(shock\s*absorber|coil\s*spring|fox\s*2\.0.*shocks|strut\s*assembly)\b/i.test(title)) {
    return `shock_strut_assembly::${side}`;
  }

  // 8. Dashboard Trim Bezel Panel (Passenger / Main colored dash panel vs Air Vents)
  if (/\b(center\s*air\s*vent|air\s*vent\s*grille)\b/i.test(title)) return 'dash_air_vent::center';
  if (/\bair\s*vent\s*trim\s*bezel\b/i.test(title)) return 'dash_air_vent::side';
  if (/\b(passenger\s*dashboard\s*trim|dashboard\s*trim\s*bezel\s*panel)\b/i.test(title)) {
    return 'dash_trim_panel::passenger';
  }

  // 9. Distinct single-unit mechanical/electrical assemblies
  if (/\b(body\s*control\s*module|\bbcm\b)\b/i.test(title)) return 'body_control_module';
  if (/\b(yaw\s*rate|esc\s*stability\s*sensor)\b/i.test(title)) return 'yaw_rate_sensor';
  if (/\b(climate\s*control|hvac\s*heater|a\/c\s*heater)\b/i.test(title)) return 'hvac_climate_control';
  if (/\b(glove\s*box)\b/i.test(title)) return 'glove_box_door';
  if (/\b(center\s*floor\s*console)\b/i.test(title)) return 'center_floor_console';
  if (/\b(radiator\s*cooling\s*fan|dual\s*radiator\s*cooling\s*fan)\b/i.test(title)) return 'radiator_cooling_fan';
  if (/\b(coolant\s*overflow\s*reservoir)\b/i.test(title)) return 'coolant_overflow_reservoir';
  if (/\b(washer\s*fluid\s*reservoir)\b/i.test(title)) return 'washer_fluid_reservoir';
  if (/\b(stereo\s*radio|radio\s*receiver|radio\s*head\s*unit)\b/i.test(title)) return 'factory_stereo_radio';
  if (/\b(automatic\s*transmission\s*(assembly|oem))\b/i.test(title) && !/\bshifter\b/i.test(title)) return 'automatic_transmission';
  if (/\b(complete\s*front\s*differential)\b/i.test(title)) return 'complete_front_differential';

  return null;
}

const _photoFingerprintCache = new Map();

function resolveLocalPhotoFilePath(photoUrl) {
  const p = String(photoUrl || '').trim();
  if (!p) return null;
  if (p.startsWith('/review-thumbs/')) {
    const c1 = path.join(__dirname, '..', 'public', p.replace(/^\/+/, ''));
    if (fs.existsSync(c1)) return c1;
    const c2 = path.join(__dirname, '..', 'data', 'review-thumbs', path.basename(p));
    if (fs.existsSync(c2)) return c2;
  }
  if (p.startsWith('/uploads/')) {
    const c = path.join(__dirname, '..', 'data', p.replace(/^\/+/, ''));
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function getVisualEquivalenceCanonicalName(photoUrl) {
  const base = path.basename(String(photoUrl || '').split('?')[0]).toLowerCase();
  for (const pair of VISUAL_PERCEPTUAL_HASH_EQUIVALENCES) {
    const lowerPair = pair.map((x) => x.toLowerCase());
    if (lowerPair.includes(base)) return `vhash::${lowerPair[0]}`;
  }
  return '';
}

function computePhotoFingerprint(photoUrl) {
  const norm = String(photoUrl || '').trim();
  if (!norm) return null;
  if (_photoFingerprintCache.has(norm)) return _photoFingerprintCache.get(norm);

  const fp = resolveLocalPhotoFilePath(norm);
  let sha256 = '';
  if (fp) {
    try {
      const buf = fs.readFileSync(fp);
      sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    } catch (_) {}
  }
  const vhash = getVisualEquivalenceCanonicalName(norm);
  const out = {
    url: norm,
    basename: path.basename(norm.split('?')[0]).toLowerCase(),
    sha256,
    vhash
  };
  _photoFingerprintCache.set(norm, out);
  return out;
}

function computeItemPhotoFingerprints(item) {
  let photos = [];
  try { photos = JSON.parse(item.photos_json || '[]'); } catch (_) {}
  if (!Array.isArray(photos)) photos = [];
  return photos
    .filter((p) => p && !/\/qr-cards\//i.test(String(p)))
    .map(computePhotoFingerprint)
    .filter(Boolean);
}

function photosVisuallyOverlap(fpsA, fpsB) {
  for (const a of fpsA) {
    for (const b of fpsB) {
      if (a.url && b.url && a.url === b.url) return { match: true, reason: `shared_photo_url:${a.basename}` };
      if (a.sha256 && b.sha256 && a.sha256 === b.sha256) return { match: true, reason: `matching_photo_sha256:${a.sha256.slice(0, 12)}` };
      if (a.vhash && b.vhash && a.vhash === b.vhash) return { match: true, reason: `matching_perceptual_hash:${a.vhash}` };
    }
  }
  return { match: false, reason: '' };
}

function scoreCanonicalListing(item, photoFps) {
  let score = 0;
  const skuUpper = String(item.sku || '').toUpperCase();
  const title = String(item.title || '');
  const mpn = sanitizeVerifiedMpn(item.oem_part_number);

  if (DUPLICATE_PHYSICAL_PART_SKUS.has(skuUpper)) score -= 500;
  if (item.status === 'active') score += 60;
  if (mpn) score += 120;
  if (item.shopify_product_id) score += 25;
  score += Math.min(8, photoFps.length) * 14;
  if (/\bcomplete\b|\bset\b|\bpair\b|\b60\/40\b|\b50\/50\b/i.test(title)) score += 35;
  if (/\bw\/|\bwith\b|\bcover\b|\bheadrests?\b|\bivory\b|\bred\b|\btan\b|\bcharcoal\b|\bgray\b|\bblack\b/i.test(title)) score += 18;
  if (!/MANUAL-REVIE/i.test(skuUpper)) score += 15;
  score += Math.min(300, Number(item.price_we_pull || 0)) * 0.12;
  score += Math.min(120, title.length) * 0.1;
  return score;
}

/**
 * Detects all duplicate physical-part clusters across candidate inventory rows
 * using Year/Make/Model + Normalized Part Component + Visual/Photo Fingerprints.
 */
function findCatalogDuplicateGroups({ includePending = false } = {}) {
  const statuses = includePending ? "('active', 'pending_verification')" : "('active')";
  const rows = db.prepare(`SELECT * FROM inventory_items WHERE status IN ${statuses} ORDER BY id ASC`).all();
  const n = rows.length;
  if (n < 2) return [];

  const meta = rows.map((r) => ({
    row: r,
    veh: normalizeVehicleGroup(r),
    compKey: normalizePartComponentKey(r),
    mpn: sanitizeVerifiedMpn(r.oem_part_number),
    fps: computeItemPhotoFingerprints(r)
  }));

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const edgeReasons = new Map();
  const addReason = (i, j, reason) => {
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (!edgeReasons.has(key)) edgeReasons.set(key, []);
    edgeReasons.get(key).push(reason);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = meta[i];
      const b = meta[j];

      // 1. Visual / Photo Fingerprint match (URL overlap, SHA-256 byte match, or perceptual hash match)
      const visual = photosVisuallyOverlap(a.fps, b.fps);
      if (visual.match) {
        union(i, j);
        addReason(i, j, visual.reason);
        continue;
      }

      // 2. Same Donor Vehicle Generation + Same Normalized Physical Part Component
      if (a.compKey && b.compKey && a.compKey === b.compKey && vehicleGenerationsMatch(a.veh, b.veh)) {
        // Never merge if BOTH have distinct verified non-empty OEM MPNs (proves two different parts)
        if (a.mpn && b.mpn && a.mpn.toUpperCase() !== b.mpn.toUpperCase()) {
          continue;
        }
        union(i, j);
        addReason(i, j, `same_vehicle_and_component:${a.veh.make}_${a.veh.model}::${a.compKey}`);
      }
    }
  }

  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(i);
  }

  const groups = [];
  for (const idxs of buckets.values()) {
    if (idxs.length < 2) continue;
    const scored = idxs
      .map((idx) => ({
        idx,
        item: meta[idx].row,
        fps: meta[idx].fps,
        compKey: meta[idx].compKey,
        score: scoreCanonicalListing(meta[idx].row, meta[idx].fps)
      }))
      .sort((x, y) => y.score - x.score || x.item.id - y.item.id);

    const reasons = [];
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const k = idxs[a] < idxs[b] ? `${idxs[a]}:${idxs[b]}` : `${idxs[b]}:${idxs[a]}`;
        if (edgeReasons.has(k)) reasons.push(...edgeReasons.get(k));
      }
    }

    groups.push({
      canonical: scored[0],
      duplicates: scored.slice(1),
      reasons: Array.from(new Set(reasons))
    });
  }

  return groups;
}

/**
 * PERMANENT CATALOG DEDUPLICATION GATE:
 * Runs on startup, before every export, and before every Shopify/Crosslist sync.
 * Keeps ONLY the single richest canonical listing per physical part, merges unique photos
 * from duplicates into the canonical listing, and archives duplicates as
 * `status = 'duplicate_archived'`, `quantity = 0`.
 */
function deduplicateCatalog({ dryRun = false } = {}) {
  const groups = findCatalogDuplicateGroups({ includePending: true });
  const now = new Date().toISOString();
  const mergedReports = [];

  if (!groups.length) {
    const existingArchived = Number(
      db.prepare("SELECT COUNT(*) c FROM inventory_items WHERE status = 'duplicate_archived'").get()?.c || 0
    );
    return {
      ok: true,
      dry_run: Boolean(dryRun),
      duplicate_groups_found: 0,
      duplicates_archived_now: 0,
      total_duplicate_archived: existingArchived,
      merges: []
    };
  }

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      duplicate_groups_found: groups.length,
      duplicates_archived_now: groups.reduce((s, g) => s + g.duplicates.length, 0),
      merges: groups.map((g) => ({
        canonical_sku: g.canonical.item.sku,
        canonical_title: g.canonical.item.title,
        archived_skus: g.duplicates.map((d) => ({ sku: d.item.sku, title: d.item.title })),
        reasons: g.reasons
      }))
    };
  }

  let archivedNow = 0;
  db.exec('BEGIN IMMEDIATE;');
  try {
    const updateCanonicalPhotosStmt = db.prepare(`
      UPDATE inventory_items
      SET photos_json = ?, updated_at = ?
      WHERE id = ?
    `);
    const archiveDupStmt = db.prepare(`
      UPDATE inventory_items
      SET status = 'duplicate_archived',
          quantity = 0,
          channels_json = ?,
          fitment_notes = ?,
          updated_at = ?
      WHERE id = ?
    `);

    for (const grp of groups) {
      const winner = grp.canonical.item;
      let mergedPhotos = [];
      const seenUrls = new Set();
      const seenShas = new Set();
      const seenVhashes = new Set();

      const addPhotosFrom = (fps, skipVhashOnly = false) => {
        for (const fp of fps) {
          if (!fp.url) continue;
          if (seenUrls.has(fp.url)) continue;
          if (fp.sha256 && seenShas.has(fp.sha256)) continue;
          if (skipVhashOnly && fp.vhash && seenVhashes.has(fp.vhash)) continue;
          seenUrls.add(fp.url);
          if (fp.sha256) seenShas.add(fp.sha256);
          if (fp.vhash) seenVhashes.add(fp.vhash);
          mergedPhotos.push(fp.url);
        }
      };

      // Winner's photos always lead the gallery
      addPhotosFrom(grp.canonical.fps, false);

      const archivedSkus = [];
      for (const dup of grp.duplicates) {
        const dItem = dup.item;
        const dSkuUpper = String(dItem.sku || '').toUpperCase();
        // Merge unique non-duplicate photos from duplicate SKU into canonical listing (skip exact dHash=0 dup photo)
        if (!DUPLICATE_PHYSICAL_PART_SKUS.has(dSkuUpper)) {
          addPhotosFrom(dup.fps, true);
        }

        let ch = {};
        try { ch = JSON.parse(dItem.channels_json || '{}'); } catch (_) {}
        ch.duplicate_archived = true;
        ch.merged_into_sku = winner.sku;
        ch.delisted_all_feeds = true;
        ch.crosslist_delist_required = true;
        ch.duplicate_archived_at = now;
        ch.duplicate_reasons = grp.reasons;

        const cleanBaseNote = stripDriveUrlsFromPublicText(dItem.fitment_notes || '')
          .replace(/\s*\|\s*DUPLICATE ARCHIVED.*$/i, '')
          .trim();
        const dupNote = `${cleanBaseNote ? cleanBaseNote + ' | ' : ''}DUPLICATE ARCHIVED -> Merged into canonical SKU ${winner.sku}`;

        archiveDupStmt.run(JSON.stringify(ch), dupNote, now, dItem.id);
        archivedNow++;
        archivedSkus.push({ sku: dItem.sku, title: dItem.title });
      }

      // Cap gallery cleanly at 10 photos and persist if expanded
      mergedPhotos = mergedPhotos.slice(0, 10);
      const nextPhotosJson = JSON.stringify(mergedPhotos);
      if (mergedPhotos.length > 0 && nextPhotosJson !== winner.photos_json) {
        updateCanonicalPhotosStmt.run(nextPhotosJson, now, winner.id);
      }

      mergedReports.push({
        canonical_sku: winner.sku,
        canonical_title: winner.title,
        merged_photo_count: mergedPhotos.length,
        archived_skus: archivedSkus,
        reasons: grp.reasons
      });
    }
    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    throw err;
  }

  const totalDuplicateArchived = Number(
    db.prepare("SELECT COUNT(*) c FROM inventory_items WHERE status = 'duplicate_archived'").get()?.c || 0
  );

  if (archivedNow > 0) {
    logSync(
      'internal',
      'catalog_deduplication',
      'deduplicate_catalog',
      'ALL',
      'success',
      `Archived ${archivedNow} duplicate SKU(s) across ${groups.length} physical-part cluster(s); merged unique photos into canonical listings (${mergedReports.map((m) => `${m.canonical_sku} <- [${m.archived_skus.map((a) => a.sku).join(',')}]`).join(' ; ')}).`
    );
  }

  return {
    ok: true,
    dry_run: false,
    duplicate_groups_found: groups.length,
    duplicates_archived_now: archivedNow,
    total_duplicate_archived: totalDuplicateArchived,
    merges: mergedReports
  };
}

/**
 * Universal Automated Catalog Integrity Auditor across all items.
 * Enforces component vs. title, taxonomy, fitment, pricing, weight/dims, Drive-link exclusion, and zero-duplicate rules.
 */
function auditCatalogIntegrity() {
  const settings = getSettings();
  const rows = db.prepare('SELECT * FROM inventory_items ORDER BY sku').all();
  const activeRows = rows.filter((r) => r.status === 'active');
  const violations = [];
  const seenPrimaryPhotos = new Map();

  for (const r of activeRows) {
    const sku = String(r.sku || '').trim();
    const title = String(r.title || '').trim();
    const tax = resolvePartTaxonomyAndMetafields(r, settings);
    const weight = Number(r.weight_lbs || 0);
    const price = Number(r.price_we_pull || 0);
    const rowIssues = [];

    const gate = validateInventoryItemForPublish(r);
    if (!gate.valid) rowIssues.push(`publish_gate: ${gate.reasons.join('; ')}`);

    if (/drive\.google\.com|Drive Photo Ref/i.test(`${r.fitment_notes || ''} ${r.description || ''}`)) {
      rowIssues.push('drive_url_leak_in_public_text');
    }
    if (!String(tax.shopifyTaxonomyId || '').startsWith('gid://shopify/TaxonomyCategory/vp-1-4')) {
      rowIssues.push(`invalid_taxonomy_prefix: ${tax.shopifyTaxonomyId}`);
    }
    // Component vs. Weight / Price / Taxonomy consistency rules
    if (/door\s*trim\s*panel|interior\s*door\s*trim/i.test(title) && weight >= 40) {
      rowIssues.push(`door_trim_panel_overweight: ${weight}lb (expected ~12lb, not door shell weight)`);
    }
    if (/shifter\s*lever|floor\s*shifter/i.test(title) && (weight >= 40 || price >= 250)) {
      rowIssues.push(`shifter_mismatched_as_full_transmission: ${weight}lb / $${price}`);
    }
    if (/(fuse\s*box|control\s*module|ecm|ecu|bcm|immobilizer|theft\s*warning)/i.test(title) && weight >= 25) {
      rowIssues.push(`electronic_module_overweight: ${weight}lb`);
    }
    if (/complete\s*front\s*differential.*both\s*(cv\s*)?drive\s*axles/i.test(title) && (weight < 90 || price < 500 || r.shipping_class !== 'local_pickup_only')) {
      rowIssues.push(`complete_front_diff_bundle_underconfigured: ${weight}lb / $${price} / ${r.shipping_class}`);
    }
    const girthPlusLength = Number(r.length_in || 0) + 2 * (Number(r.width_in || 0) + Number(r.height_in || 0));
    if ((weight >= 70 || girthPlusLength > 130) && r.shipping_class !== 'local_pickup_only') {
      rowIssues.push(`heavy_or_oversized_not_local_pickup: ${weight}lb / girth+L=${girthPlusLength}in`);
    }
    if (/\bseat\b/i.test(title) && !/bolster|cushion|cover|belt|switch/i.test(title) && weight < 35) {
      rowIssues.push(`seat_assembly_underweight: ${weight}lb`);
    }
    if (Number(r.quantity) !== 1) {
      rowIssues.push(`non_single_unit_qty: ${r.quantity}`);
    }

    let photos = [];
    try { photos = JSON.parse(r.photos_json || '[]'); } catch (_) {}
    if (photos[0]) {
      if (seenPrimaryPhotos.has(photos[0])) {
        rowIssues.push(`duplicate_primary_photo_with_${seenPrimaryPhotos.get(photos[0])}`);
      } else {
        seenPrimaryPhotos.set(photos[0], sku);
      }
    }

    if (rowIssues.length) {
      violations.push({ sku, title, issues: rowIssues });
    }
  }

  // Zero-duplicate enforcement across active single-variant OEM listings
  const remainingDupes = findCatalogDuplicateGroups({ includePending: false });
  for (const grp of remainingDupes) {
    violations.push({
      sku: grp.canonical.item.sku,
      title: grp.canonical.item.title,
      issues: [`duplicate_listing_cluster_with:${grp.duplicates.map((d) => d.item.sku).join(',')} (${grp.reasons.join('; ')})`]
    });
  }

  return {
    ok: violations.length === 0,
    total_items: rows.length,
    active_items: activeRows.length,
    pending_verification: rows.filter((r) => r.status === 'pending_verification').length,
    compliance_blocked: rows.filter((r) => r.status === 'compliance_blocked').length,
    duplicate_archived: rows.filter((r) => r.status === 'duplicate_archived').length,
    duplicate_groups_count: remainingDupes.length,
    violations_count: violations.length,
    violations
  };
}

module.exports = {
  SHOP_LABOR_RATE_LOCKED,
  DUPLICATE_PHYSICAL_PART_SKUS,
  VERIFIED_SKU_ENRICHMENTS,
  stripDriveUrlsFromPublicText,
  stripOffPlatformViolations,
  dedupeSentences,
  resolveCategoryBookTimeLabor,
  resolvePartDimensionsAndWeight,
  buildRichStructuredDescription,
  normalizeVehicleGroup,
  normalizePartComponentKey,
  computeItemPhotoFingerprints,
  findCatalogDuplicateGroups,
  deduplicateCatalog,
  enrichAllActiveInventoryInDb,
  auditCatalogIntegrity
};
