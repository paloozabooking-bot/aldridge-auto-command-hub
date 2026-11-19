function generateAllPolicies(settings) {
  const name = settings.business_name || "Aldridge Auto's";
  const addr = `${settings.street_address}, ${settings.city_display || settings.city}, ${settings.state} ${settings.zip}`;
  const phone = settings.phone || '(253) 245-4206';
  const email = settings.email || 'service@aldridgeautos.com';
  const handlingFee = Number(settings.handling_fee_default ?? 10).toFixed(2);
  const handlingDays = Number(settings.handling_days_default ?? 3);
  const freightLbs = Number(settings.freight_weight_threshold_lbs ?? 70);

  return {
    master_return_refund_policy: `RETURN, REFUND & DEFECT-EVIDENCE POLICY — ${name}
Effective Location: ${addr} | Support: ${phone} | ${email}

1. RETURNS NOT ACCEPTED FOR BUYER REMORSE OR WRONG FITMENT (DEFECT-ONLY COVERAGE)
Returns Not Accepted for buyer remorse, change of mind, wrong part ordered, wrong vehicle fitment, or "test-fitting / diagnostic guessing." All Used, Salvaged, and OEM Automotive sales are FINAL except for verified functional defects.
Refunds or replacements are issued STRICTLY AND EXCLUSIVELY (Defect-Only) when a part has:
  (a) A verified functional defect not disclosed in the listing,
  (b) Incorrect technical/interchange data published by ${name}, OR
  (c) Material discrepancy from listing photos/description ("Not As Described").

2. MANDATORY EVIDENCE & ANTI-FRAUD SECURITY MARK VERIFICATION
Before any Return Merchandise Authorization (RMA) is issued, the buyer MUST submit verifiable evidence via our Return Evidence Portal (or platform message thread) within 14 calendar days of delivery:
  • Order Number & Installed Vehicle 17-Digit VIN
  • Clear photos/video of the defect or discrepancy AND diagnostic scan report / OBD-II trouble codes (for mechanical/electronic assemblies)
  • Clear photo confirming our unique Tamper-Evident UV / Paint Security Serial Mark is 100% intact and unaltered.
Parts returned with missing, broken, painted-over, or mismatched security marks, or disassembled housings, are automatically rejected as part-swap fraud and will not be refunded.

3. RETURN SHIPPING RESPONSIBILITY
Return shipping, crating, and transit insurance back to ${addr} are the SOLE RESPONSIBILITY OF THE BUYER. Original outbound shipping and the $${handlingFee} packaging/handling buffer are non-refundable unless ${name} shipped a different SKU than ordered.

4. FITMENT, VIN PROGRAMMING & LABOR EXCLUSION
Buyer is solely responsible for matching OEM Part Numbers prior to purchase (when MPN is "Does Not Apply", match multi-angle photos & message us your valid 17-digit VIN to confirm fitment). Many modern OEM modules, transmissions, throttle bodies, and keys require dealer/OEM scan-tool programming at buyer's expense. This policy covers the PART ONLY and never reimburses third-party installation labor, fluids, programming, towing, or rental vehicles (except in-house labor performed by ${name} in our University Place service bays).

5. HARD SAFETY & EMISSIONS COMPLIANCE BLOCKS
${name} strictly prohibits and never sells SRS airbags, clocksprings/spiral cables, seatbelt retractors/pretensioners, pyrotechnic inflators, or used catalytic converters, and rejects fabricated or invalid-checksum VINs.`,

    master_shipping_fulfillment_policy: `SHIPPING, SINGLE-VARIANT INVENTORY & CERTIFIED SHOP INSTALLATION POLICY — ${name}
Warehouse & Shop Address: ${addr} | Hours: ${settings.hours_weekday} (${settings.hours_weekend})

1. SINGLE-VARIANT INVENTORY GUARANTEE (1 IN STOCK — ZERO DOUBLE-BOOKING)
Every photographed OEM part in our catalog is listed as a SINGLE 1-of-1 SKU variant so a unique part can never be double-sold or accidentally checked out under a conflicting shipping/install option.

2. HANDLING & BENCH-TESTING TIME (${handlingDays} BUSINESS DAYS)
Every shipped parcel order includes a ${handlingDays}-business-day handling buffer so our technicians can perform final inspection/bench checks, photograph the tamper-evident security serial mark, and custom-pack automotive components.

3. CALCULATED PARCEL SHIPPING + $${handlingFee} HANDLING BUFFER (UNDER ${freightLbs} LBS, NON-HAZMAT)
  • Eligible parts under ${freightLbs} lbs ship via Calculated Carrier Parcel Rates (UPS Ground, FedEx Ground/Home, or USPS Ground Advantage) based on exact package weight, L×W×H dimensions, and destination ZIP.
  • A flat $${handlingFee} Packaging & Crating Handling Buffer applies per parcel order to cover high-density foam, double-wall boxes, fluid draining/plugging, and protective wrapping.

4. HEAVY, OVERSIZED & HAZMAT ITEMS (${freightLbs}+ LBS): LOCAL PICKUP ONLY IN UNIVERSITY PLACE, WA 98467
  • Any part or assembly weighing ${freightLbs}+ lbs, exceeding carrier girth limits (>130 in), or containing hazmat/fluids/glass (engines, transmissions, axles, doors, hoods, bumpers, wheel/tire sets, batteries, fuel tanks) is strictly LOCAL PICKUP ONLY at ${settings.street_address}, University Place, WA ${settings.zip}.

5. OPTIONAL CERTIFIED SHOP BAY INSTALLATION (INFORMATIONAL PRICING IN DESCRIPTION)
  • Every listing displays an informational Certified Shop Installation turnkey estimate right inside the Product Description. To have ${name} install a part in our 5.0★ University Place service bays, purchase the single-variant part first to lock in inventory, then book your bay appointment on our website/app or call ${phone}.`,

    master_payment_terms_policy: `PAYMENT, RESERVATION HOLD & PRIVACY / SMS POLICY — ${name}

1. ACCEPTED PAYMENT METHODS
  • Online Storefront & Shopify Checkout: Visa, Mastercard, American Express, Discover, Shop Pay, Apple Pay, Google Pay, PayPal, and Shop Pay Installments.
  • In-Shop Counter (Repair & Local Pickup): Major Credit/Debit Cards, Verified Tap-to-Pay, and Cash.
  • Immediate payment locks in your 1-of-1 OEM part and removes it across all connected channels simultaneously.

2. CERTIFIED SHOP INSTALLATION APPOINTMENTS
  • Certified Shop Installation prices shown inside product descriptions are turnkey estimates (Part + Certified Shop Labor at $${Number(settings.labor_rate_hourly || 135).toFixed(2)}/hr; shop fluids, alignments, or dealer module programming billed only if required).

3. TCPA SMS & EMAIL MARKETING CONSENT
  • By opting into ${name} Text (SMS) or Email alerts on our website, mobile app, intake counter, or U-Haul/Repair check-in, you consent to receive appointment updates, order readiness alerts, and periodic shop/parts specials. Message & data rates may apply. Reply STOP anytime to unsubscribe from SMS or click Unsubscribe in any email. Your phone number and email are never sold to third parties.`,

    // 1. Shopify & Direct Website HTML Template (Includes Certified Shop Install Callout + Direct Website/PWA App Links)
    shopify_direct_html_template: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:860px;margin:0 auto;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;color:#0f172a;">
  <div style="background:#0b1628;color:#ffffff;padding:18px 22px;border-bottom:4px solid #ea580c;">
    <h2 style="margin:0;font-size:20px;letter-spacing:0.3px;">{{BUSINESS_NAME}} — Verified Used OEM Auto Parts</h2>
    <p style="margin:6px 0 0;font-size:13px;color:#cbd5e1;">University Place, WA 98467 &nbsp;|&nbsp; SKU: <strong>{{SKU}}</strong> (1-of-1 Single Unit) &nbsp;|&nbsp; MPN: <strong>{{OEM_PART_NUMBER}}</strong> &nbsp;|&nbsp; Security ID: <strong>{{SECURITY_CODE}}</strong></p>
  </div>
  <div style="padding:20px 22px;background:#ffffff;">
    <h3 style="margin-top:0;color:#0b1628;font-size:18px;">{{TITLE}}</h3>
    <p style="line-height:1.55;font-size:14px;">{{DESCRIPTION}}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;width:32%;"><strong>Condition</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{CONDITION}} — {{DEFECT_DISCLOSURE}}</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Manufacturer Part # (MPN)</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{OEM_PART_NUMBER}} / {{INTERCHANGE_NUMBER}} {{HOLLANDER_NUMBER}}</td></tr>
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Donor Fitment Range</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{FITMENT_YEARS}} {{FITMENT_MAKE}} {{FITMENT_MODEL}} ({{FITMENT_ENGINE}})</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Fitment Notes</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{FITMENT_NOTES}}</td></tr>
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Warehouse Bin / Shipping Spec</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{BIN_LOCATION}} ({{WEIGHT_LBS}} lbs • {{DIMENSIONS_IN}} in • {{SHIPPING_SUMMARY_LABEL}})</td></tr>
    </table>
    {{INSTALL_CALLOUT_HTML}}
    {{DIRECT_APP_CALLOUT_HTML}}
    <div style="background:#fff7ed;border:1px solid #ea580c;border-radius:6px;padding:12px 14px;font-size:12.5px;line-height:1.5;">
      <strong>SHIPPING, LOCAL PICKUP &amp; DEFECT-ONLY RETURN POLICY:</strong><br/>
      • <strong>Single-Variant Stock Protection:</strong> Listed strictly as 1 single physical unit so your part is never double-booked across channels.<br/>
      • <strong>Shipping &amp; $${handlingFee} Handling Buffer:</strong> Eligible non-hazmat items under ${freightLbs} lbs ship Calculated Parcel + $${handlingFee} protective packaging/handling buffer within ${handlingDays} business days (or Free Counter Pickup at 5115 66th St W, Bldg B, University Place, WA 98467). Heavy/oversized/hazmat items (${freightLbs}+ lbs) are strictly <strong>Local Pickup Only in University Place, WA 98467</strong>.<br/>
      • <strong>Returns Not Accepted (Defect-Only Coverage):</strong> Returns Not Accepted for buyer remorse or wrong fitment. Match MPN &amp; photos prior to ordering. Defect-Only claims require OBD-II/photo proof and intact UV/Paint Tamper Serial Mark (<strong>{{SECURITY_CODE}}</strong>); buyer pays return shipping; parts-only coverage.
    </div>
  </div>
</div>`,

    // 2. eBay Motors (aabcas) & External Marketplace HTML Template (100% Policy Compliant — ZERO External URLs, ZERO Domains, ZERO Phone Numbers!)
    ebay_motors_html_template: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:860px;margin:0 auto;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;color:#0f172a;">
  <div style="background:#0b1628;color:#ffffff;padding:18px 22px;border-bottom:4px solid #ea580c;">
    <h2 style="margin:0;font-size:20px;letter-spacing:0.3px;">{{BUSINESS_NAME}} — Verified Used OEM Auto Parts</h2>
    <p style="margin:6px 0 0;font-size:13px;color:#cbd5e1;">University Place, WA 98467 &nbsp;|&nbsp; SKU: <strong>{{SKU}}</strong> (1-of-1 Single Unit) &nbsp;|&nbsp; MPN: <strong>{{OEM_PART_NUMBER}}</strong> &nbsp;|&nbsp; Security ID: <strong>{{SECURITY_CODE}}</strong></p>
  </div>
  <div style="padding:20px 22px;background:#ffffff;">
    <h3 style="margin-top:0;color:#0b1628;font-size:18px;">{{TITLE}}</h3>
    <p style="line-height:1.55;font-size:14px;">{{DESCRIPTION}}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;width:32%;"><strong>Condition</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{CONDITION}} — {{DEFECT_DISCLOSURE}}</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Manufacturer Part # (MPN)</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{OEM_PART_NUMBER}} / {{INTERCHANGE_NUMBER}} {{HOLLANDER_NUMBER}}</td></tr>
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Donor Fitment Range</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{FITMENT_YEARS}} {{FITMENT_MAKE}} {{FITMENT_MODEL}} ({{FITMENT_ENGINE}})</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Fitment Notes</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{FITMENT_NOTES}}</td></tr>
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Warehouse Bin / Shipping Spec</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{BIN_LOCATION}} ({{WEIGHT_LBS}} lbs • {{DIMENSIONS_IN}} in • {{SHIPPING_SUMMARY_LABEL}})</td></tr>
    </table>
    {{INSTALL_CALLOUT_EBAY_HTML}}
    <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:11px 14px;margin-bottom:12px;font-size:12.5px;line-height:1.5;">
      <strong>AUTHENTIC {{BUSINESS_NAME}} SHOP PACKAGING &amp; REPEAT-BUYER CERTIFICATE:</strong><br/>
      Every order ships from our 5.0★ rated University Place, WA 98467 automotive facility with our printed Bench-Inspection Tag, QR Bin Verification Slip, and Repeat-Customer VIP Shop Card enclosed inside the package. Have a 17-digit VIN fitment question or picking up locally in University Place, WA 98467? Send us a message anytime via <strong>eBay Messages</strong>!
    </div>
    <div style="background:#fff7ed;border:1px solid #ea580c;border-radius:6px;padding:12px 14px;font-size:12.5px;line-height:1.5;">
      <strong>SHIPPING, LOCAL PICKUP &amp; DEFECT-ONLY RETURN POLICY:</strong><br/>
      • <strong>Shipping &amp; $${handlingFee} Handling Buffer:</strong> Eligible non-hazmat items under ${freightLbs} lbs ship Calculated Parcel + $${handlingFee} protective packaging/handling buffer within ${handlingDays} business days. Items ${freightLbs}+ lbs (or oversized/hazmat) are strictly <strong>Local Pickup Only in University Place, WA 98467</strong>.<br/>
      • <strong>Returns Not Accepted (Defect-Only Coverage):</strong> Returns Not Accepted for buyer remorse or wrong fitment. Match MPN &amp; photos prior to ordering (message us your valid 17-digit VIN via eBay Messages to confirm). Defect-Only claims require OBD-II/photo proof and intact UV/Paint Tamper Serial Mark (<strong>{{SECURITY_CODE}}</strong>); buyer pays return shipping; parts-only coverage.
    </div>
  </div>
</div>`,

    local_marketplace_template: `{{TITLE}}
MPN: {{OEM_PART_NUMBER}} | Interchange: {{INTERCHANGE_NUMBER}} | Stock SKU: {{SKU}} (1-of-1 Single Unit)
Fits: {{FITMENT_YEARS}} {{FITMENT_MAKE}} {{FITMENT_MODEL}} ({{FITMENT_ENGINE}})
Verified Spec: {{WEIGHT_LBS}} lbs • {{DIMENSIONS_IN}} in

CONDITION: {{CONDITION}}
{{DESCRIPTION}}
Inspection Note: {{DEFECT_DISCLOSURE}}

SINGLE-UNIT PRICING & OPTIONAL SHOP INSTALLATION AT ${name.toUpperCase()} (University Place, WA 98467):
• PART PRICE: {{SHIPPING_OR_PICKUP_LINE}}
• {{PULL_INSTALL_LINE}}

SHOP DIRECT & MOBILE APP:
• Direct Catalog & Installable Mobile App: {{DIRECT_WEBSITE_URL}}
• Location: ${addr} | Shop & Parts: ${phone}${settings.uhaul_phone ? ` | U-Haul #046117: ${settings.uhaul_phone}` : ''}
• Hours: ${settings.hours_weekday}
• All parts carry serialized UV/Paint security marks ({{SECURITY_CODE}}). Returns Not Accepted for remorse/fitment (Defect-Only with security mark & diagnostic proof; buyer covers return shipping).`,

    platform_enforcement_notes: [
      {
        platform: 'Shopify (aldridgesales.myshopify.com) + Live Mobile PWA',
        how_to_apply: '1-Variant Only (Default Title, 1 in stock — zero double-booking); real photos required; Certified Shop Installation price + Direct Website/PWA App links embedded in Body (HTML); <70 lb Calculated Parcel + $10.00 handling; 70+ lb / hazmat Local Pickup Only in 98467.',
        monthly_cost: '$0 extra'
      },
      {
        platform: 'eBay Motors (aabcas)',
        how_to_apply: '1-Variant Only (Qty = 1), ConditionID = 3000 (Used), Certified Shop Installation callout + compliant in-box VIP Shop Card note in HTML (ZERO external URLs/phone numbers), ReturnsNotAccepted (Defect-Only).',
        monthly_cost: '$0 extra'
      },
      {
        platform: 'Vendoo, Google Merchant & Meta Catalog',
        how_to_apply: '1-Variant Only, real photos required, exact carrier weight & L×W×H dimensions, Certified Shop Installation price included in product description text.',
        monthly_cost: '$0 catalog feeds'
      }
    ]
  };
}

module.exports = { generateAllPolicies };
