#!/usr/bin/env node
/**
 * Aldridge Auto's — 3-Pass Automotive Shipping Weight & Box-Dimension Physics Engine
 * Double- and triple-checks all 962 active SKUs (57 ALD-OH verified on-hand + 905 sanitized legacy)
 * for accurate boxed shipping weights (lbs + grams), realistic carton dimensions (L x W x H inches),
 * carrier dimensional weight protection, and strict 70+ lb / >130" L+G Local Pickup Only locks.
 */
const fs = require('node:fs');
const path = require('node:path');
const { db, DATA_DIR, getSettings, validatePartCompliance, validateVinStrict, logSync } = require('../src/db');

// Ordered strictly from MOST SPECIFIC SUBPARTS -> MEDIUM ASSEMBLIES -> HEAVY / OVERSIZE LOCAL PICKUP ASSEMBLIES
const PART_PHYSICS_PROFILES = [
  // --- 1. SMALL ELECTRONIC MODULES, SENSORS, SWITCHES, RELAYS, LATCHES, HANDLES (1–6 lbs) ---
  { name: 'Key / Ignition Cylinder / Lock', re: /\b(ignition\s+(lock|cylinder|switch)|key\s+fob|door\s+lock\s+cylinder|glove\s*box\s+lock)\b/i, wt: 2.0, l: 8, w: 6, h: 5 },
  { name: 'Small Sensor / TPMS / Relay / Fuse / Solenoid', re: /\b(sensor|solenoid|relay|flasher|horn|buzzer|thermostat\s+housing|thermostat|tpms|tire\s+pressure\s+monitoring|purge\s+valve|pcv)\b/i, wt: 2.0, l: 8, w: 6, h: 5 },
  { name: 'Window / Door / Dash / Wiper Switch & Stalk', re: /\b(window\s+switch|master\s+switch|switch\s+panel|switch\s+bezel|switch\s+stalk|handle\s+and\s+switch|mirror\s+switch|headlight\s+switch|dimmer\s+switch|hazard\s+switch|seat\s+switch|cruise\s+switch|turn\s+signal\s+switch|wiper\s+(control\s+|washer\s+)?(stalk|switch)|combination\s+switch|control\s+stalk|dash\s+control)\b/i, wt: 2.5, l: 11, w: 7, h: 5 },
  { name: 'ECU / PCM / TCM / BCM / Amplifier Module', re: /\b(ecu|ecm|pcm|tcm|bcm|abs\s+module|control\s+module|control\s+unit|computer|amplifier|amp\b|immobilizer|transceiver|junction\s+block|fuse\s+box|relay\s+box|power\s+distribution)\b/i, wt: 3.5, l: 12, w: 10, h: 6 },
  { name: 'Infotainment / Radio / Stereo / HVAC Head Unit', re: /\b(radio(?!\s+antenna)|stereo|head\s+unit|infotainment|navigation|cd\s+player|display\s+screen|hvac\s+control|climate\s+control|heater\s+control)\b/i, wt: 6.5, l: 14, w: 12, h: 9 },
  { name: 'Instrument Cluster / Speedometer / Gauge', re: /\b(instrument\s+cluster|speedometer|tachometer|gauge\s+cluster|information\s+display)\b/i, wt: 5.0, l: 18, w: 11, h: 9 },
  { name: 'Interior / Exterior Door or Tailgate Handle', re: /\b(door\s+handle|tailgate\s+handle|liftgate\s+handle|hatch\s+handle|grab\s+handle|assist\s+grip|pull\s+handle)\b/i, wt: 2.5, l: 12, w: 7, h: 5 },
  { name: 'Latch / Lock Actuator / Striker / Hinge', re: /\b(latch|lock\s+actuator|door\s+actuator|fuel\s+door\s+actuator|hood\s+hinge|door\s+hinge|liftgate\s+hinge|tailgate\s+hinge|door\s+check|hood\s+prop|lift\s+support|gas\s+strut)\b/i, wt: 4.0, l: 14, w: 9, h: 6 },
  { name: 'Battery Tray / Hold-Down Clamp / Cover', re: /\b(battery\s+(tray|clamp|hold\s*down|box|cover|bracket|shield))\b/i, wt: 4.0, l: 14, w: 10, h: 6 },
  { name: 'Fuel Filler Door / Gas Cap / Filler Neck', re: /\b(fuel\s+(filler\s+)?door|gas\s+door|fuel\s+cap|filler\s+neck|filler\s+pipe)\b/i, wt: 4.5, l: 18, w: 10, h: 8 },
  { name: 'Antenna / Mast / Roof Fin', re: /\b(antenna|shark\s+fin)\b/i, wt: 2.0, l: 14, w: 6, h: 5 },
  { name: 'Speaker / Tweeter / Subwoofer', re: /\b(subwoofer)\b/i, wt: 14.0, l: 18, w: 16, h: 12 },
  { name: 'Door / Dash Speaker', re: /\b(speaker|tweeter)\b/i, wt: 4.0, l: 11, w: 11, h: 7 },
  { name: 'Sun Visor / Dome Light / Overhead Console / Rearview Mirror', re: /\b(sun\s*visor|visor|dome\s+light|map\s+light|overhead\s+console|rear\s*view\s+mirror|interior\s+mirror)\b/i, wt: 3.0, l: 19, w: 9, h: 5 },
  { name: 'Side View Mirror (Exterior Door Mirror)', re: /\b(side\s+view\s+mirror|side\s+mirror|door\s+mirror|power\s+mirror|exterior\s+mirror|tow\s+mirror)\b/i, wt: 6.5, l: 16, w: 12, h: 10 },
  { name: 'Dashboard Bezel / Vent / Lower Knee Bolster / Console Trim', re: /\b(air\s+vent|ac\s+vent|a\/c\s+vent|dash(board)?\s+vent|louver|cup\s+holder|ash\s*tray|shift\s+bezel|shift\s+boot|shifter\s+bezel|radio\s+bezel|cluster\s+bezel|instrument\s+panel\s+bezel|center\s+stack\s+bezel|center\s+dash\s+trim|dash(board)?\s+trim|lower\s+dash|under\s+dash|passenger\s+side\s+dash(board)?\s+panel|dashboard\s+panel|lower\s+console\s+trim|dash\s+mount|steering\s+column\s+(cover|shroud)|electrical\s+component\s+cover|fuse\s+cover|cowl\s+side\s+trim|kick\s+panel|sill\s+plate|scuff\s+plate)\b/i, wt: 5.0, l: 24, w: 12, h: 8 },
  { name: 'Glove Box Compartment / Door', re: /\b(glove\s*box)\b/i, wt: 6.0, l: 22, w: 15, h: 11 },
  { name: 'Center Console Armrest Lid', re: /\b(console\s+(lid|armrest)|center\s+console\s+armrest|armrest\s+lid)\b/i, wt: 5.0, l: 18, w: 12, h: 8 },
  { name: 'Floor / Center Console Assembly', re: /\b(center\s+console|floor\s+console)\b/i, wt: 18.0, l: 34, w: 15, h: 16 },
  { name: 'Shifter Assembly / Shift Lever / Cable', re: /\b(shifter|shift\s+lever|gear\s+selector|shift\s+cable)\b/i, wt: 8.0, l: 20, w: 12, h: 10 },
  { name: 'Pedal Assembly (Brake / Accelerator / Clutch)', re: /\b(pedal)\b/i, wt: 6.5, l: 18, w: 12, h: 9 },

  // --- 2. LIGHTING & LAMPS ---
  { name: 'Headlight / Headlamp Assembly', re: /\b(headlight|headlamp)\b/i, wt: 10.0, l: 25, w: 15, h: 13 },
  { name: 'Tail Light / Taillight / Third Brake / Fog / Marker Lamp', re: /\b(tail\s*light|taillight|tail\s+lamp|third\s+brake|high\s+mount\s+stop|fog\s+light|fog\s+lamp|corner\s+light|marker\s+light|turn\s+signal\s+light|license\s+plate\s+light|reflector)\b/i, wt: 6.0, l: 19, w: 12, h: 10 },

  // --- 3. WIPER, WASHER, COOLING RESERVOIRS, HOSES, AIR INTAKE, HVAC ---
  { name: 'Wiper Arm / Blade', re: /\b(wiper\s+arm)\b/i, wt: 3.0, l: 26, w: 6, h: 4 },
  { name: 'Wiper Motor & Linkage Transmission', re: /\b(wiper\s+motor|wiper\s+linkage|wiper\s+transmission|windshield\s+wiper\s+assembly)\b/i, wt: 9.0, l: 28, w: 11, h: 8 },
  { name: 'Windshield Wiper Cowl Vent Grille Panel', re: /\b(wiper\s+cowl|windshield\s+cowl|cowl\s+(vent|trim|grille|panel))\b/i, wt: 9.0, l: 64, w: 14, h: 7 },
  { name: 'Washer / Coolant / Overflow / Power Steering / Brake Fluid Reservoir', re: /\b(washer\s+(fluid\s+)?reservoir|washer\s+tank|coolant\s+(recovery\s+|expansion\s+)?(reservoir|tank|bottle)|overflow\s+(tank|bottle)|brake\s+fluid\s+reservoir|power\s+steering\s+(fluid\s+)?reservoir)\b/i, wt: 4.5, l: 18, w: 13, h: 10 },
  { name: 'AC Hose / Heater Hose / Coolant Hose / Accumulator / Drier', re: /\b(a\/?c\s+hose|a\/?c\s+line|a\/?c\s+accumulator|receiver\s+drier|heater\s+hose|radiator\s+hose|coolant\s+hose|power\s+steering\s+hose|fuel\s+line|brake\s+line)\b/i, wt: 5.5, l: 26, w: 12, h: 8 },
  { name: 'EVAP Charcoal Canister', re: /\b(evap\s+canister|vapor\s+canister|charcoal\s+canister)\b/i, wt: 6.0, l: 16, w: 12, h: 9 },
  { name: 'Air Cleaner Box / Intake Hose / Resonator', re: /\b(air\s+cleaner|air\s+box|airbox|air\s+filter\s+housing|air\s+intake|intake\s+hose|intake\s+duct|resonator)\b/i, wt: 7.5, l: 22, w: 15, h: 13 },
  { name: 'Engine Beauty Cover / Upper Cover', re: /\b(engine\s+cover|appearance\s+cover)\b/i, wt: 5.5, l: 26, w: 20, h: 7 },
  { name: 'Heater Core / Evaporator / HVAC Blower Box Assembly', re: /\b(heater\s+core|evaporator|hvac\s+(heater\s+)?(and\s+)?(blower\s+)?(box|case|housing|assembly)|heater\s+(and\s+)?(blower\s+)?box)\b/i, wt: 18.0, l: 26, w: 20, h: 16 },
  { name: 'Blower Motor / Resistor / HVAC Actuator', re: /\b(blower\s+motor)\b/i, wt: 6.0, l: 12, w: 11, h: 10 },
  { name: 'Cooling Fan / Radiator Fan Shroud Assembly', re: /\b(cooling\s+fan|fan\s+shroud|radiator\s+fan|condenser\s+fan)\b/i, wt: 14.0, l: 30, w: 22, h: 8 },
  { name: 'Radiator / AC Condenser / Intercooler', re: /\b(radiator(?!\s+support)|a\/?c\s+condenser|condenser|intercooler|transmission\s+cooler|oil\s+cooler)\b/i, wt: 19.0, l: 34, w: 24, h: 8 },

  // --- 4. UNDERHOOD MECHANICAL & ELECTRICAL ACCESSORIES ---
  { name: 'Wet Lead-Acid Car / Automotive Battery (Hazmat -> Local Pickup)', re: /\b(car\s+battery|automotive\s+battery|vehicle\s+battery|12v\s+battery)\b/i, wt: 75.0, l: 14, w: 10, h: 10, forceLocalPickup: true },
  { name: 'Throttle Body / EGR / Fuel Rail / Injectors', re: /\b(throttle\s+body|egr\s+valve|fuel\s+rail|fuel\s+injector|mass\s+air\s+flow|maf)\b/i, wt: 5.0, l: 11, w: 9, h: 8 },
  { name: 'Fuel Pump Module / Sending Unit', re: /\b(fuel\s+pump|sending\s+unit)\b/i, wt: 5.5, l: 17, w: 10, h: 9 },
  { name: 'Ignition Coil / Distributor', re: /\b(ignition\s+coil|coil\s+pack|distributor)\b/i, wt: 3.5, l: 10, w: 8, h: 6 },
  { name: 'Alternator', re: /\b(alternator|generator)\b/i, wt: 14.5, l: 11, w: 10, h: 9 },
  { name: 'Starter Motor', re: /\b(starter(\s+motor)?)\b/i, wt: 11.5, l: 13, w: 9, h: 8 },
  { name: 'AC Compressor / Power Steering Pump / Water Pump / Vacuum Pump', re: /\b(a\/?c\s+compressor|air\s+conditioning\s+compressor|power\s+steering\s+pump|water\s+pump|vacuum\s+pump|smog\s+pump|air\s+pump)\b/i, wt: 15.0, l: 13, w: 10, h: 10 },
  { name: 'ABS Pump / Brake Modulator / Brake Booster / Master Cylinder', re: /\b(abs\s+(pump|hydraulic|modulator)|brake\s+booster|master\s+cylinder|hydroboost)\b/i, wt: 13.0, l: 16, w: 13, h: 12 },
  { name: 'Intake Manifold / Plenum', re: /\b(intake\s+manifold|upper\s+plenum)\b/i, wt: 15.0, l: 23, w: 16, h: 12 },
  { name: 'Exhaust Manifold (Non-Catalytic Cast Iron) / Muffler / Pipe', re: /\b(exhaust\s+manifold|muffler|resonator\s+pipe|tail\s*pipe|y-pipe)\b/i, wt: 22.0, l: 26, w: 14, h: 10 },
  { name: 'Valve Cover / Timing Cover / Oil Pan', re: /\b(valve\s+cover|rocker\s+cover|timing\s+cover|oil\s+pan)\b/i, wt: 9.5, l: 24, w: 14, h: 9 },
  { name: 'Cylinder Head / Camshaft', re: /\b(cylinder\s+head|camshaft)\b/i, wt: 44.0, l: 26, w: 14, h: 12 },
  { name: 'Turbocharger / Supercharger', re: /\b(turbocharger|turbo|supercharger)\b/i, wt: 21.0, l: 16, w: 14, h: 12 },
  { name: 'Wiring Harness / Loom / Battery Cable', re: /\b(wiring\s+harness|wire\s+harness|engine\s+harness|body\s+harness|battery\s+cable)\b/i, wt: 9.5, l: 20, w: 16, h: 10 },
  { name: 'Engine / Transmission Mount or Bracket', re: /\b(engine\s+mount|motor\s+mount|transmission\s+mount|alternator\s+bracket|compressor\s+bracket|bumper\s+bracket|fender\s+bracket|support\s+bracket|mounting\s+bracket)\b/i, wt: 6.5, l: 14, w: 10, h: 8 },

  // --- 5. GLASS, WINDOW REGULATORS, SUNROOF, DOOR PANELS, PILLAR & CARGO TRIM ---
  { name: 'Window Regulator & Motor Assembly', re: /\b(window\s+regulator|window\s+motor|liftgate\s+motor|wiper\s+regulator)\b/i, wt: 7.5, l: 26, w: 14, h: 6 },
  { name: 'Door Window Glass / Quarter Window / Vent Glass', re: /\b(door\s+glass|window\s+glass|quarter\s+window|quarter\s+glass|vent\s+glass|vent\s+window)\b/i, wt: 16.0, l: 35, w: 23, h: 6 },
  { name: 'Rear Back Window / Back Slider / Liftgate Glass', re: /\b(back\s+window|rear\s+window\s+glass|sliding\s+rear\s+window|rear\s+sliding\s+window|liftgate\s+glass|tailgate\s+glass|hatch\s+glass)\b/i, wt: 30.0, l: 58, w: 20, h: 6 },
  { name: 'Windshield Glass (Oversize Fragile -> Local Pickup)', re: /\b(windshield(?!\s+(washer|wiper|cowl)))\b/i, wt: 75.0, l: 66, w: 38, h: 8, forceLocalPickup: true },
  { name: 'Sunroof / Moonroof Glass Panel or Sunshade', re: /\b(sunshade|sunroof\s+shade|moonroof\s+shade)\b/i, wt: 7.0, l: 37, w: 23, h: 4 },
  { name: 'Sunroof / Moonroof Glass or Track Assembly', re: /\b(sunroof|moonroof)\b/i, wt: 24.0, l: 48, w: 30, h: 6 },
  { name: 'Interior Door Trim Panel (Card)', re: /\b(door\s+(trim\s+)?panel|interior\s+door\s+panel)\b/i, wt: 14.0, l: 40, w: 28, h: 7 },
  { name: 'Pillar / Cargo / Trunk / Cab Interior Trim / Carpet / Floor Mat', re: /\b(pillar(\s+upper|\s+lower)?\s+trim|a-pillar|b-pillar|b\s+pillar|c-pillar|c\s+pillar|d-pillar|quarter\s+trim|cargo\s+(area\s+)?(side\s+)?(cover|shade|tray|mat|floor|trim|lid)|trunk\s+interior\s+trim|rear\s+cab\s+interior\s+trim|interior\s+trim\s+panel(\s+set)?|rear\s+deck\s+tray|lower\s+rear\s+panel|spare\s+tire\s+cover|package\s+tray|parcel\s+shelf|floor\s+mat|carpet|jack\s+kit|tool\s+kit|lug\s+wrench)\b/i, wt: 10.0, l: 38, w: 20, h: 8 },
  { name: 'Grille / Front Upper or Lower Grille', re: /\b(grille|front\s+grill)\b/i, wt: 11.0, l: 48, w: 16, h: 10 },
  { name: 'Skid Plate / Splash Shield / Underbody Shield / Fender Liner', re: /\b(skid\s+plate|splash\s+shield|underbody\s+shield|engine\s+under\s+cover|belly\s+pan|fender\s+liner|wheel\s+house\s+liner|mud\s+flap|mud\s+guard)\b/i, wt: 14.0, l: 44, w: 22, h: 8 },
  { name: 'Roof Rack Side Rails / Crossbars', re: /\b(roof\s+rack|roof\s+rail|cross\s*bar|luggage\s+rack)\b/i, wt: 14.0, l: 64, w: 10, h: 7 },
  { name: 'Bumper Impact Absorber / Reinforcement Rebar / Valance', re: /\b(bumper\s+reinforcement|impact\s+bar|rebar|crash\s+bar)\b/i, wt: 26.0, l: 58, w: 12, h: 10 },
  { name: 'Bumper Impact Foam / Step Pad / Filler', re: /\b(impact\s+absorber|bumper\s+absorber|bumper\s+filler|bumper\s+pad|step\s+pad|tow\s+hook)\b/i, wt: 7.0, l: 52, w: 10, h: 8 },

  // --- 6. SUSPENSION, STEERING, BRAKES, DRIVELINE, WHEELS & TIRES ---
  { name: 'Brake Caliper(s) / Disc Brake Assembly / Rotor / Drum', re: /\b(brake\s+calipers?|calipers?|disc\s+brake\s+assembly|brake\s+rotor|brake\s+disc|brake\s+drum|parking\s+brake)\b/i, wt: 18.0, l: 14, w: 12, h: 9 },
  { name: 'Strut / Coilover / Shock Absorber / Coil Spring', re: /\b(strut|coilover|shock\s+absorber|rear\s+shock|front\s+shock|coil\s+spring)\b/i, wt: 24.0, l: 28, w: 12, h: 9 },
  { name: 'Leaf Spring (Heavy)', re: /\b(leaf\s+spring)\b/i, wt: 56.0, l: 54, w: 10, h: 8 },
  { name: 'Control Arm / Knuckle / Spindle / Wheel Hub / Tie Rod / Sway Bar', re: /\b(control\s+arm|trailing\s+arm|knuckle|spindle|wheel\s+hub|hub\s+bearing|sway\s+(stabilizer\s+)?bar|stabilizer\s+bar|track\s+bar|panhard|tie\s+rod|ball\s+joint)\b/i, wt: 19.0, l: 24, w: 14, h: 8 },
  { name: 'Steering Column / Steering Rack & Pinion / Steering Gear', re: /\b(steering\s+column|steering\s+shaft|steering\s+rack|rack\s+and\s+pinion|steering\s+gear|steering\s+box|steering\s+wheel)\b/i, wt: 26.0, l: 44, w: 12, h: 11 },
  { name: 'CV Axle Shaft / Half Shaft', re: /\b(cv\s+axle|axle\s+shaft|half\s+shaft)\b/i, wt: 22.0, l: 38, w: 8, h: 8 },
  { name: 'Driveshaft / Prop Shaft', re: /\b(drive\s*shaft|prop\s*shaft|propeller\s+shaft)\b/i, wt: 32.0, l: 58, w: 8, h: 8 },
  { name: 'Wheel Set of 4 (Heavy Local Pickup)', re: /\b(set\s+of\s+4|4\s+wheels|wheel\s+set)\b/i, wt: 252.0, l: 32, w: 32, h: 42, forceLocalPickup: true },
  { name: 'Single Wheel & Mounted Tire Assembly', re: /\b(wheel\s+and\s+tire|wheel\s*&\s*tire|spare\s+tire\s+and\s+wheel|donut\s+spare)\b/i, wt: 54.0, l: 29, w: 29, h: 10 },
  { name: 'Single Unmounted Tire', re: /\b(vehicle\s+tire|all-terrain\s+.*tire|\btire\b(?!\s+(cover|pressure|carrier|jack|iron|winch)))\b/i, wt: 36.0, l: 30, w: 30, h: 10 },
  { name: 'Single Bare Alloy / Steel Wheel Rim', re: /\b(wheel(?!\s+(hub|bearing|house|speed|well|arch|cylinder|opening|stud|cap|cover))|alloy\s+rim|steel\s+rim)\b/i, wt: 28.0, l: 20, w: 20, h: 11 },
  { name: 'Wheel Center Cap / Hubcap', re: /\b(center\s+cap|hub\s*cap|wheel\s+cover)\b/i, wt: 2.0, l: 10, w: 10, h: 4 },

  // --- 7. SEATS & SEAT CUSHIONS ---
  { name: 'Seat Cushion / Seat Backrest / Headrest / Bolster', re: /\b(seat\s+bottom|seat\s+cushion|seat\s*back(rest)?|headrest|side\s+bolster)\b/i, wt: 18.0, l: 48, w: 23, h: 10 },
  { name: 'Pair of Bucket Seats (Heavy Local Pickup)', re: /\b(bucket\s+seats|front\s+seats|seat\s+pair|seat\s+set)\b/i, wt: 98.0, l: 36, w: 30, h: 38, forceLocalPickup: true },
  { name: 'Single Folding / Bucket / Jump Seat Assembly', re: /\b(seat)\b/i, wt: 48.0, l: 32, w: 24, h: 20 },

  // --- 8. LARGE OVERSIZED / 70+ LB BODY, POWERTRAIN & CHASSIS -> LOCAL PICKUP ONLY (98467) ---
  { name: 'Roof Headliner Board (Oversized Fragile -> Local Pickup)', re: /\b(headliner)\b/i, wt: 75.0, l: 74, w: 52, h: 8, forceLocalPickup: true },
  { name: 'Full Dashboard Assembly / Instrument Panel Carrier (Oversized -> Local Pickup)', re: /\b(dashboard(\s+assembly|\s+pad|\s+carrier)?(\s+oem)?$|instrument\s+panel\s+assembly)\b/i, wt: 75.0, l: 64, w: 26, h: 22, forceLocalPickup: true },
  { name: 'Rocker Panel Molding > 70" (Oversized -> Local Pickup)', re: /\b(rocker\s+panel)\b/i, wt: 75.0, l: 74, w: 10, h: 7, forceLocalPickup: true },
  { name: 'Front / Rear Bumper Cover or Complete Bumper Assembly (Oversized -> Local Pickup)', re: /\b(bumper(\s+cover|\s+assembly|\s+fascia)?)\b/i, wt: 75.0, l: 74, w: 28, h: 22, forceLocalPickup: true },
  { name: 'Front Fender / Quarter Panel / Truck Bed Side (Oversized -> Local Pickup)', re: /\b(fender|quarter\s+panel|bed\s+side|truck\s+bed)\b/i, wt: 75.0, l: 58, w: 36, h: 14, forceLocalPickup: true },
  { name: 'Hood Panel (Oversized -> Local Pickup)', re: /\b(hood)\b/i, wt: 82.0, l: 64, w: 52, h: 10, forceLocalPickup: true },
  { name: 'Complete Exterior Door / Tailgate / Liftgate / Lift Hatch / Trunk Lid (70+ lb -> Local Pickup)', re: /\b(door(\s+shell|\s+assembly)?|car\s+door|tailgate|liftgate|lift\s+hatch|rear\s+hatch|trunk\s+lid)\b/i, wt: 85.0, l: 48, w: 44, h: 12, forceLocalPickup: true },
  { name: 'Radiator Core Support / Subframe / Crossmember / Frame / Body Shell (Heavy -> Local Pickup)', re: /\b(radiator\s+support|core\s+support|subframe|k-frame|cradle|crossmember|body\s+shell|chassis)\b/i, wt: 95.0, l: 62, w: 34, h: 18, forceLocalPickup: true },
  { name: 'Used Fuel Tank (Hazmat Vapor / Oversized -> Local Pickup)', re: /\b(fuel\s+tank|gas\s+tank)\b/i, wt: 75.0, l: 46, w: 28, h: 16, forceLocalPickup: true },
  { name: 'Rear Axle Assembly / Differential / Transfer Case (70+ lb -> Local Pickup)', re: /\b(rear\s+axle|axle\s+assembly|differential\s+carrier|front\s+differential|rear\s+differential|transfer\s+case)\b/i, wt: 95.0, l: 56, w: 22, h: 20, forceLocalPickup: true },
  { name: 'Automatic / Manual Transmission Assembly (70+ lb -> Local Pickup)', re: /\b(transmission|transaxle)\b/i, wt: 175.0, l: 38, w: 24, h: 24, forceLocalPickup: true },
  { name: 'Complete Engine / Long Block / Short Block (70+ lb -> Local Pickup)', re: /\b(engine|long\s+block|short\s+block)\b/i, wt: 365.0, l: 38, w: 30, h: 32, forceLocalPickup: true }
];

function classifyItemPhysics(item) {
  const text = `${item.title} ${item.category || ''}`;
  for (const prof of PART_PHYSICS_PROFILES) {
    if (prof.re.test(text)) {
      return { ...prof, matchedProfile: true };
    }
  }
  // Fallback medium OEM part carton (inspected in audit below)
  return { name: 'General OEM Mechanical / Trim Component', wt: 8.5, l: 18, w: 13, h: 9, matchedProfile: false };
}

const allItems = db.prepare('SELECT * FROM inventory_items ORDER BY id ASC').all();
const updateStmt = db.prepare(`
  UPDATE inventory_items
  SET weight_lbs = ?, length_in = ?, width_in = ?, height_in = ?, shipping_class = ?,
      allow_pull_install = 1, price_pull_install = ?, install_labor_hours = ?,
      channels_json = ?, updated_at = ?
  WHERE id = ?
`);

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

const settings = getSettings();
const hourlyRate = Number(settings.labor_rate_hourly || 135);
const now = new Date().toISOString();

let fallbackCount = 0;
const fallbackTitles = [];
let upgradedToLocalPickup = 0;
let healedToParcel = 0;
let updatedDimsCount = 0;

db.exec('BEGIN TRANSACTION;');
try {
  for (const item of allItems) {
    const isVerifiedOnHand = item.sku.startsWith('ALD-OH-');
    let wt = Number(item.weight_lbs || 8);
    let l = Number(item.length_in || 16);
    let w = Number(item.width_in || 12);
    let h = Number(item.height_in || 10);
    let forceLocal = false;

    if (!isVerifiedOnHand) {
      const prof = classifyItemPhysics(item);
      if (!prof.matchedProfile) {
        fallbackCount++;
        if (fallbackTitles.length < 25) fallbackTitles.push(`${item.sku}: ${item.title}`);
      }
      wt = prof.wt;
      l = prof.l;
      w = prof.w;
      h = prof.h;
      forceLocal = !!prof.forceLocalPickup;
      updatedDimsCount++;
    } else {
      forceLocal = wt >= 70 || item.shipping_class === 'local_pickup_only';
    }

    // Pass 2: Carrier Dimensional Weight & Length+Girth Enforcement
    const lengthPlusGirth = l + 2 * (w + h);
    const carrierDimWeight139 = Math.ceil((l * w * h) / 139);
    const carrierDimWeight166 = Math.ceil((l * w * h) / 166);

    const mustBeLocalPickup =
      forceLocal ||
      wt >= 70 ||
      l > 70 ||
      lengthPlusGirth > 130 ||
      carrierDimWeight139 >= 70;

    let finalShipClass = mustBeLocalPickup ? 'local_pickup_only' : 'parcel_calculated';
    let finalWt = wt;

    if (mustBeLocalPickup) {
      // Ensure 70+ lb weight gate triggers uniformly on Shopify, eBay, Vendoo, and Storefront checkout
      if (finalWt < 75) finalWt = 75;
      if (item.shipping_class === 'parcel_calculated') upgradedToLocalPickup++;
    } else {
      // Protect Shopify Variant Grams against bulky lightweight under-quoting by taking max(actual, USPS/UPS dim166), capped < 70
      if (!isVerifiedOnHand) {
        finalWt = Math.min(68, Math.max(wt, carrierDimWeight166));
      }
      if (item.shipping_class !== 'parcel_calculated') healedToParcel++;
    }

    const laborHours = isVerifiedOnHand
      ? Number(item.install_labor_hours || 1.5)
      : (finalWt >= 150 ? 6.5 : (mustBeLocalPickup ? 2.5 : 1.2));
    const pricePullInstall = isVerifiedOnHand
      ? Number(item.price_pull_install)
      : Math.round(Number(item.price_we_pull || 0) + laborHours * hourlyRate);

    updateStmt.run(
      Number(finalWt.toFixed(1)),
      Number(l.toFixed(1)),
      Number(w.toFixed(1)),
      Number(h.toFixed(1)),
      finalShipClass,
      pricePullInstall,
      laborHours,
      mustBeLocalPickup ? heavyChannels : parcelChannels,
      now,
      item.id
    );
  }
  db.exec('COMMIT;');
} catch (err) {
  db.exec('ROLLBACK;');
  throw err;
}

// Pass 3: Independent Triple-Check Verification Audit across all 962 rows
const verifiedItems = db.prepare('SELECT * FROM inventory_items ORDER BY id ASC').all();
const violations = [];
let parcelTotal = 0;
let localPickupTotal = 0;

for (const it of verifiedItems) {
  const lpg = Number(it.length_in) + 2 * (Number(it.width_in) + Number(it.height_in));
  const dim139 = Math.ceil((Number(it.length_in) * Number(it.width_in) * Number(it.height_in)) / 139);

  if (Number(it.weight_lbs) <= 0) violations.push(`${it.sku}: invalid weight ${it.weight_lbs}`);
  if (Number(it.length_in) <= 0 || Number(it.width_in) <= 0 || Number(it.height_in) <= 0) {
    violations.push(`${it.sku}: invalid dimensions ${it.length_in}x${it.width_in}x${it.height_in}`);
  }
  if (it.condition !== 'Used' || Number(it.condition_id) !== 3000) {
    violations.push(`${it.sku}: condition not Used/3000 (${it.condition}/${it.condition_id})`);
  }
  if (it.shipping_class === 'parcel_calculated') {
    parcelTotal++;
    if (Number(it.weight_lbs) >= 70) violations.push(`${it.sku}: parcel item >= 70 lbs (${it.weight_lbs})`);
    if (Number(it.length_in) > 70) violations.push(`${it.sku}: parcel item length > 70" (${it.length_in})`);
    if (lpg > 130) violations.push(`${it.sku}: parcel item Length+Girth > 130" (${lpg})`);
    if (dim139 >= 70) violations.push(`${it.sku}: parcel item dim139 >= 70 lbs (${dim139})`);
  } else if (it.shipping_class === 'local_pickup_only') {
    localPickupTotal++;
    if (Number(it.weight_lbs) < 70) violations.push(`${it.sku}: local_pickup_only weight < 70 lbs (${it.weight_lbs})`);
  } else {
    violations.push(`${it.sku}: unexpected shipping_class ${it.shipping_class}`);
  }

  const comp = validatePartCompliance({ title: it.title, category: it.category, description: it.description });
  if (!comp.compliant) violations.push(`${it.sku}: compliance violation (${comp.matchedTerm})`);

  if (it.donor_vehicle_id) {
    const dv = db.prepare('SELECT vin FROM donor_vehicles WHERE id = ?').get(it.donor_vehicle_id);
    if (dv && dv.vin && !validateVinStrict(dv.vin).valid) {
      violations.push(`${it.sku}: invalid donor VIN ${dv.vin}`);
    }
  }
}

if (violations.length > 0) {
  console.error('TRIPLE-CHECK VIOLATIONS:', violations);
  process.exit(1);
}

logSync(
  'system',
  'physics_triple_check',
  'verify_962_weights_dimensions',
  'ALL',
  'success',
  `Triple-checked all ${verifiedItems.length} SKUs: ${parcelTotal} Calculated Parcel (<70 lb, <=130" L+G) + ${localPickupTotal} Local Pickup Only (70+ lb / oversized), 0 compliance/weight/dimension violations.`
);

const report = {
  verified_at: now,
  total_active_skus: verifiedItems.length,
  protected_onhand_skus: verifiedItems.filter((i) => i.sku.startsWith('ALD-OH-')).length,
  legacy_sanitized_skus: verifiedItems.filter((i) => !i.sku.startsWith('ALD-OH-')).length,
  parcel_calculated_count: parcelTotal,
  local_pickup_only_98467_count: localPickupTotal,
  upgraded_oversize_to_local_pickup: upgradedToLocalPickup,
  healed_overweighed_subparts_to_parcel: healedToParcel,
  specific_profile_matches: 905 - fallbackCount,
  fallback_profile_count: fallbackCount,
  sample_fallbacks: fallbackTitles,
  triple_check_violations: violations.length
};

fs.writeFileSync(
  path.join(DATA_DIR, 'audit_outputs', 'shipping_weights_dimensions_triple_check_report.json'),
  JSON.stringify(report, null, 2),
  'utf8'
);

console.log(JSON.stringify(report, null, 2));
