function generateAllPolicies(settings) {
  const name = settings.business_name || "Aldridge Auto's";
  const addr = `${settings.street_address}, ${settings.city_display || settings.city}, ${settings.state} ${settings.zip}`;
  const phone = settings.phone || '(253) 245-4206';
  const email = settings.email || 'service@aldridgeautosupply.com';
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
Buyer is solely responsible for matching OEM Part Numbers prior to purchase (when an OEM MPN is not stamped on the part, match multi-angle photos & message us your valid 17-digit VIN to confirm fitment). Many modern OEM modules, transmissions, throttle bodies, and keys require dealer/OEM scan-tool programming at buyer's expense. This policy covers the PART ONLY and never reimburses third-party installation labor, fluids, programming, towing, or rental vehicles (except in-house labor performed by ${name} in our University Place service bays).

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
  • Certified Shop Installation prices shown inside product descriptions are turnkey estimates (Part + Certified Shop Labor at $${Number(settings.labor_rate_hourly || 174.99).toFixed(2)}/hr; shop fluids, alignments, or dealer module programming billed only if required).

3. TCPA SMS & EMAIL MARKETING CONSENT
  • By opting into ${name} Text (SMS) or Email alerts on our website, mobile app, intake counter, or U-Haul/Repair check-in, you consent to receive appointment updates, order readiness alerts, and periodic shop/parts specials. Message & data rates may apply. Reply STOP anytime to unsubscribe from SMS or click Unsubscribe in any email. Your phone number and email are never sold to third parties.`,

    // 1. Clean Cross-Platform OEM HTML Template (ZERO phone numbers, ZERO street addresses, ZERO off-platform URLs, ZERO policy walls!)
    shopify_direct_html_template: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:820px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;color:#0f172a;">
  <div style="background:#0f172a;color:#ffffff;padding:14px 18px;border-bottom:3px solid #d97706;">
    <h2 style="margin:0;font-size:18px;font-weight:700;">{{TITLE}}</h2>
    <p style="margin:4px 0 0;font-size:12.5px;color:#cbd5e1;">SKU: <strong>{{SKU}}</strong> &nbsp;|&nbsp; MPN: <strong>{{OEM_PART_NUMBER}}</strong> &nbsp;|&nbsp; Qty: <strong>1 Single Verified Unit</strong></p>
  </div>
  <div style="padding:16px 18px;background:#ffffff;">
    <p style="margin:0 0 14px;line-height:1.55;font-size:14px;color:#1e293b;">{{INSPECTION_SUMMARY}}</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;width:32%;"><strong>Condition</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{CONDITION}}</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>OEM Part Number (MPN)</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{OEM_PART_NUMBER}}{{INTERCHANGE_SUFFIX}}</td></tr>
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Donor Vehicle Fitment</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{FITMENT_LINE}}</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Verified Donor VIN</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{DONOR_VIN}}</td></tr>
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Placement &amp; Bin</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{PLACEMENT}} &bull; Bin {{BIN_LOCATION}}</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Packed Weight &amp; Dimensions</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{WEIGHT_LBS}} lbs &bull; {{DIMENSIONS_IN}} in &bull; {{SHIPPING_SUMMARY_LABEL}}</td></tr>
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Country of Origin</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{COUNTRY_OF_ORIGIN}}</td></tr>
    </table>
  </div>
</div>`,

    // 2. eBay US HTML Template (100% unified with Shopify clean OEM spec card — ZERO URLs, ZERO phone numbers, ZERO addresses, ZERO policy walls!)
    ebay_motors_html_template: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:820px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;color:#0f172a;">
  <div style="background:#0f172a;color:#ffffff;padding:14px 18px;border-bottom:3px solid #d97706;">
    <h2 style="margin:0;font-size:18px;font-weight:700;">{{TITLE}}</h2>
    <p style="margin:4px 0 0;font-size:12.5px;color:#cbd5e1;">SKU: <strong>{{SKU}}</strong> &nbsp;|&nbsp; MPN: <strong>{{OEM_PART_NUMBER}}</strong> &nbsp;|&nbsp; Qty: <strong>1 Single Verified Unit</strong></p>
  </div>
  <div style="padding:16px 18px;background:#ffffff;">
    <p style="margin:0 0 14px;line-height:1.55;font-size:14px;color:#1e293b;">{{INSPECTION_SUMMARY}}</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;width:32%;"><strong>Condition</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{CONDITION}}</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>OEM Part Number (MPN)</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{OEM_PART_NUMBER}}{{INTERCHANGE_SUFFIX}}</td></tr>
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Donor Vehicle Fitment</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{FITMENT_LINE}}</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Verified Donor VIN</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{DONOR_VIN}}</td></tr>
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Placement &amp; Bin</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{PLACEMENT}} &bull; Bin {{BIN_LOCATION}}</td></tr>
      <tr><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Packed Weight &amp; Dimensions</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{WEIGHT_LBS}} lbs &bull; {{DIMENSIONS_IN}} in &bull; {{SHIPPING_SUMMARY_LABEL}}</td></tr>
      <tr style="background:#f8fafc;"><td style="padding:8px 10px;border:1px solid #e2e8f0;"><strong>Country of Origin</strong></td><td style="padding:8px 10px;border:1px solid #e2e8f0;">{{COUNTRY_OF_ORIGIN}}</td></tr>
    </table>
  </div>
</div>`,

    local_marketplace_template: `{{TITLE}}
MPN: {{OEM_PART_NUMBER}} | Stock SKU: {{SKU}} (1-of-1 Single Unit)
Donor Fitment: {{FITMENT_LINE}} | Donor VIN: {{DONOR_VIN}}
Condition: {{CONDITION}}
Visual Inspection: {{INSPECTION_SUMMARY}}
Physical Spec: {{WEIGHT_LBS}} lbs | {{DIMENSIONS_IN}} in | {{SHIPPING_SUMMARY_LABEL}}
Bin Location: {{BIN_LOCATION}}`,

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
