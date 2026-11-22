const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { server } = require('./server');
const { db, DATA_DIR, computeShippingClass, validateVinStrict, validatePartCompliance } = require('./db');
const { isCounterfeitMpn, cleanListingTitle } = require('./audit-sanitizer');

// Minimal valid 1x1 JPEG base64 fixture for multi-angle upload verification
const TINY_JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

async function runVerification() {
  // 0. Verify Legacy 905-SKU Archive DB Exists & Integrity = OK
  const archivePath = path.join(DATA_DIR, 'archive_905_legacy.db');
  assert.ok(fs.existsSync(archivePath), 'data/archive_905_legacy.db backup exists');
  const archiveDb = new DatabaseSync(archivePath);
  const archiveCount = archiveDb.prepare('SELECT COUNT(*) AS c FROM inventory_items').get().c;
  const archiveIntegrity = archiveDb.prepare('PRAGMA integrity_check').get().integrity_check;
  archiveDb.close();
  assert.ok(archiveCount >= 905, `Legacy archive preserves >= 905 rows (found ${archiveCount})`);
  assert.strictEqual(archiveIntegrity, 'ok', 'Legacy archive SQLite integrity_check = ok');
  console.log(`  ✓ Legacy Archive DB verified (data/archive_905_legacy.db • ${archiveCount} rows • integrity=${archiveIntegrity})`);

  // Ensure clean slate at start if a prior interrupted test left temporary rows
  db.prepare("DELETE FROM inventory_items").run();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`[Verify] Testing Auto Command Hub on ${base}...`);

  let createdParcel = null;
  let createdHeavy = null;
  let orderJson = null;
  let rmaJson = null;

  try {
    // 1. Clean-Slate Bootstrap & Locked Policies Check
    const bootRes = await fetch(`${base}/api/bootstrap`);
    assert.strictEqual(bootRes.status, 200);
    const boot = await bootRes.json();
    assert.strictEqual(boot.inventory.length, 0, 'Active inventory starts cleanly at 0 items');
    assert.strictEqual(boot.settings.clean_slate_mode, true, 'Clean-slate mode locked active');
    assert.ok(
      boot.policies.master_return_refund_policy.includes('RETURNS NOT ACCEPTED FOR BUYER REMORSE OR WRONG FITMENT'),
      'Defect-Only Returns Not Accepted policy locked'
    );
    assert.ok(
      boot.policies.master_shipping_fulfillment_policy.includes('University Place, WA 98467') &&
        boot.policies.master_shipping_fulfillment_policy.includes('$10.00'),
      'Shipping policy locks Calculated Parcel + $10.00 handling & 70+ lb Local Pickup Only in University Place, WA 98467'
    );
    console.log('  ✓ Clean-Slate Active DB (0 items) & Locked Storefront Policies verified');

    // 2. Modulo-11 VIN Decoder & Fake VIN Hard Blocks
    const validVinRes = await fetch(`${base}/api/vin-decode/5TFHW5F12AX134337`);
    assert.strictEqual(validVinRes.status, 200);
    const validVinJson = await validVinRes.json();
    assert.strictEqual(validVinJson.make, 'Toyota');

    const runnerVinRes = await fetch(`${base}/api/vin-decode/JTEBU14R040057212`);
    assert.strictEqual(runnerVinRes.status, 200, 'Whitelisted real donor VIN JTEBU14R040057212 decodes cleanly as 2004 Toyota 4Runner');
    const dakotaVinRes = await fetch(`${base}/api/vin-decode/1D7HE48K56S679400`);
    assert.strictEqual(dakotaVinRes.status, 200, 'Whitelisted real donor VIN 1D7HE48K56S679400 decodes cleanly as 2006 Dodge Dakota');

    const badCheckVinRes = await fetch(`${base}/api/vin-decode/5FNRL18451B072461`);
    assert.strictEqual(badCheckVinRes.status, 422, 'Fake checksum VIN 5FNRL18451B072461 hard-blocked with 422');
    assert.strictEqual(validateVinStrict('1FTEW1EP2KFA41892').valid, true);
    console.log('  ✓ Strict NHTSA Modulo-11 VIN Decoder, Verified Donor Whitelist & Fake-VIN 422 Hard Blocks verified');

    // 3. Hard Safety & Emissions Blocks (SRS / Airbags / Clockspring / Catalytic Converters)
    for (const bannedHint of ['Clockspring Airbag Spiral Cable', 'Front OEM Catalytic Converter Assembly', 'Seatbelt Pretensioner Retractor']) {
      const srsIntake = await fetch(`${base}/api/intake/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technicianHint: bannedHint, condition: 'Used' })
      });
      assert.strictEqual(srsIntake.status, 422, `Banned item "${bannedHint}" hard-blocked on intake`);

      const srsPub = await fetch(`${base}/api/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: 'ALD-BANNED-TEST', title: bannedHint, price_we_pull: 99 })
      });
      assert.strictEqual(srsPub.status, 422, `Banned item "${bannedHint}" hard-blocked on inventory publish`);
    }
    assert.strictEqual(validatePartCompliance({ title: 'Trim Panel Module' }).compliant, false, 'Laundered SRS placeholder blocked');
    console.log('  ✓ SRS / Airbag / Clockspring / Seatbelt / Catalytic 422 Hard Blocks verified');

    // 4. On-Hand Multi-Angle Photo Intake (< 70 lb Parcel, Blank MPN -> Does Not Apply, Used Condition)
    const intakeRes = await fetch(`${base}/api/intake/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        donorVehicleId: boot.donors[0].id,
        pullStatus: 'on_vehicle',
        condition: 'Used',
        technicianHint: 'OEM Starter Motor',
        stampedNumber: '' // Blank MPN to verify "Does Not Apply" across exporters
      })
    });
    assert.strictEqual(intakeRes.status, 200);
    const proposal = await intakeRes.json();
    assert.strictEqual(proposal.condition, 'Used');
    assert.strictEqual(proposal.oem_part_number, '');
    assert.strictEqual(proposal.shipping_class, 'parcel_calculated');

    const createRes = await fetch(`${base}/api/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...proposal,
        photos: [TINY_JPEG_DATA_URL, TINY_JPEG_DATA_URL]
      })
    });
    assert.strictEqual(createRes.status, 201);
    createdParcel = await createRes.json();
    assert.strictEqual(createdParcel.condition, 'Used');
    assert.strictEqual(createdParcel.photos.length, 2);
    assert.ok(createdParcel.photos[0].endsWith(`${createdParcel.sku}.1.jpg`), 'Dot-notation .1.jpg persisted');
    assert.ok(createdParcel.photos[1].endsWith(`${createdParcel.sku}.2.jpg`), 'Dot-notation .2.jpg persisted');

    const imgFetch = await fetch(`${base}${createdParcel.photos[0]}`);
    assert.strictEqual(imgFetch.status, 200);
    assert.strictEqual(imgFetch.headers.get('content-type'), 'image/jpeg');

    const labelRes = await fetch(`${base}/api/inventory/${encodeURIComponent(createdParcel.sku)}/label`);
    assert.strictEqual(labelRes.status, 200);
    const labelHtml = await labelRes.text();
    assert.ok(labelHtml.includes('Y813BT 4x6') && labelHtml.includes(createdParcel.security_mark_code));

    // 5. Heavy 75 lb On-Hand Part -> Locked Local Pickup Only (University Place, WA 98467)
    const heavyCreateRes = await fetch(`${base}/api/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: 'ALD-HVY75TEST',
        title: '2010 Toyota Tundra Rear Differential Carrier Assembly OEM',
        category: 'Drivetrain & Axles',
        condition: 'Used OEM', // Must normalize to 'Used'
        oem_part_number: 'GM80000013', // Counterfeit sequential MPN must auto-wipe -> Does Not Apply
        bin_location: 'LOCAL-PICKUP-98467',
        pull_status: 'pulled_shelved',
        price_we_pull: 450,
        weight_lbs: 75,
        length_in: 32,
        width_in: 24,
        height_in: 18,
        quantity: 1,
        photos: [TINY_JPEG_DATA_URL]
      })
    });
    assert.strictEqual(heavyCreateRes.status, 201);
    createdHeavy = await heavyCreateRes.json();
    assert.strictEqual(createdHeavy.condition, 'Used', 'Condition strictly normalized to Used');
    assert.strictEqual(createdHeavy.oem_part_number, '', 'Counterfeit MPN wiped on save');
    assert.strictEqual(createdHeavy.shipping_class, 'local_pickup_only', '75 lb item locked to local_pickup_only');

    // 6. Verify Cross-Platform Exporters (Shopify CSV, Vendoo CSV, eBay Motors CSV, All Feeds)
    const shopifyCsv = await (await fetch(`${base}/api/exports/shopify.csv`)).text();
    assert.ok(!shopifyCsv.includes('Does Not Apply'), 'Shopify CSV never emits Does Not Apply placeholder');
    assert.ok(shopifyCsv.includes(',used,'), 'Shopify CSV sets Google Shopping / Condition = used');
    assert.ok(shopifyCsv.includes('Returns Not Accepted (Defect-Only)'), 'Shopify CSV embeds Defect-Only return metafield');
    assert.ok(shopifyCsv.includes('Local Pickup Only — University Place, WA 98467 (70+ lb)'), 'Shopify CSV marks 70+ lb Local Pickup Only');
    assert.ok(shopifyCsv.includes(`${createdParcel.sku}.2.jpg`), 'Shopify CSV preserves secondary .2.jpg angle row');

    const vendooCsv = await (await fetch(`${base}/api/exports/vendoo.csv`)).text();
    assert.ok(!vendooCsv.includes('Does Not Apply'), 'Vendoo CSV never emits Does Not Apply placeholder');
    assert.ok(vendooCsv.includes('Calculated Parcel + $10.00 Handling'), 'Vendoo CSV locks Calculated Parcel + $10.00 Handling');
    assert.ok(vendooCsv.includes('Local Pickup Only — University Place, WA 98467'), 'Vendoo CSV locks 70+ lb Local Pickup Only');
    assert.ok(vendooCsv.includes('Returns Not Accepted (Defect-Only)'), 'Vendoo CSV locks Defect-Only Returns');
    assert.ok(vendooCsv.includes(`${createdParcel.sku}.2.jpg`), 'Vendoo CSV includes Additional_Images .2.jpg');

    const ebayCsv = await (await fetch(`${base}/api/exports/ebay_motors.csv`)).text();
    assert.ok(
      ebayCsv.includes(',3000,Used —') &&
        !ebayCsv.includes('Does Not Apply') &&
        ebayCsv.includes('Calculated,UPSGround,10.00') &&
        ebayCsv.includes('ReturnsNotAccepted') &&
        ebayCsv.includes('US_Pickup') &&
        ebayCsv.includes('University Place, WA 98467'),
      'eBay Motors CSV enforces Condition 3000 Used, zero Does Not Apply placeholders, Calculated + $10.00 handling, US_Pickup in 98467, and ReturnsNotAccepted'
    );

    const feedEndpoints = [
      '/api/feeds/google-merchant.xml',
      '/api/feeds/meta-catalog.csv',
      '/api/exports/crosslist.csv',
      '/api/exports/tiktok_shop.csv',
      '/api/exports/car_part_hollander.csv',
      '/api/templates/master-import.csv'
    ];
    for (const ep of feedEndpoints) {
      const r = await fetch(`${base}${ep}`);
      assert.strictEqual(r.status, 200, `Feed ${ep} returned 200`);
    }
    console.log('  ✓ Multi-Angle Dot-Notation Uploads + Locked Shopify, Vendoo & eBay Exporters verified');

    // 7. Storefront Checkout Enforcement: 75 lb Heavy Item Blocks Parcel Shipping (400), Allows Local Pickup (201)
    const blockedParcelOrder = await fetch(`${base}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ sku: createdHeavy.sku, qty: 1 }],
        fulfillment_mode: 'ship_calculated',
        customer_name: 'Heavy Parcel Test',
        customer_email: 'heavy@example.com',
        customer_phone: '253-555-0199',
        shipping_address: '123 Main St, Seattle, WA 98101',
        policy_accepted: true
      })
    });
    assert.strictEqual(blockedParcelOrder.status, 400, '70+ lb item blocked from parcel shipping checkout');

    // 3-Tier Self-Pull Order + RMA Buyer Remorse Rejection
    const orderRes = await fetch(`${base}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ sku: createdParcel.sku, qty: 1 }],
        fulfillment_mode: 'self_pull_yard',
        customer_name: 'Test Self-Pull Buyer',
        customer_email: 'selfpull@example.com',
        customer_phone: '253-555-0100',
        preferred_date: '2026-11-20',
        preferred_time: '12:30 PM',
        vehicle_ymm: '2010 Toyota Tundra',
        waiver_accepted: true,
        policy_accepted: true
      })
    });
    assert.strictEqual(orderRes.status, 201);
    orderJson = await orderRes.json();

    const rmaRes = await fetch(`${base}/api/returns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_number: orderJson.order_number,
        sku: createdParcel.sku,
        customer_name: 'Test Self-Pull Buyer',
        customer_email: 'selfpull@example.com',
        claim_reason: 'buyer_remorse_ineligible',
        diagnostic_codes: 'NONE',
        buyer_vin: '5TFHW5F12AX134337',
        evidence_summary: 'Ordered wrong year by mistake',
        security_mark_intact: true,
        buyer_accepts_return_shipping: true
      })
    });
    assert.strictEqual(rmaRes.status, 201);
    rmaJson = await rmaRes.json();
    assert.strictEqual(rmaJson.status, 'rejected_policy_ineligible');

    // 8. Preserved Audit Export Endpoints Check
    assert.strictEqual(computeShippingClass(69.9, 'Alternator', 12, 10, 8), 'parcel_calculated');
    assert.strictEqual(computeShippingClass(70, 'Heavy Axle Housing', 48, 14, 12), 'local_pickup_only');
    assert.strictEqual(isCounterfeitMpn('GM80000013'), true);
    assert.ok(cleanListingTitle('Parting Out 2001 Honda Odessey Base : Alternator').includes('2001 Honda Odyssey Alternator OEM'));
    for (const auditEp of ['/api/audit/sanitized-shopify.csv', '/api/audit/ebay-418-reconciliation.csv', '/api/audit/draft-trim-holds.csv']) {
      const ar = await fetch(`${base}${auditEp}`);
      assert.strictEqual(ar.status, 200, `Preserved audit export ${auditEp} still accessible`);
    }
    console.log('  ✓ Heavy 70+ lb Parcel Checkout Block, Defect-Only RMA Gate & Preserved Audit Exports verified');
  } finally {
    // 9. Always clean up all temporary verification rows & test upload JPEGs so active DB stays at 0 items
    db.prepare('DELETE FROM inventory_items').run();
    if (orderJson?.order_number) db.prepare('DELETE FROM orders WHERE order_number = ?').run(orderJson.order_number);
    if (orderJson?.linked_booking_code) db.prepare('DELETE FROM appointments WHERE booking_code = ?').run(orderJson.linked_booking_code);
    if (rmaJson?.rma_number) db.prepare('DELETE FROM return_claims WHERE rma_number = ?').run(rmaJson.rma_number);
    db.prepare("DELETE FROM crm_customers WHERE email IN ('selfpull@example.com', 'heavy@example.com')").run();
    const upDir = path.join(DATA_DIR, 'uploads');
    if (fs.existsSync(upDir)) {
      for (const f of fs.readdirSync(upDir)) {
        fs.unlinkSync(path.join(upDir, f));
      }
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    server.close();
  }

  const finalCount = db.prepare('SELECT COUNT(*) AS c FROM inventory_items').get().c;
  assert.strictEqual(finalCount, 0, 'Active DB cleanly restored to 0 items after verification');
  console.log('[Verify] ALL END-TO-END CHECKS PASSED! Active inventory_items = 0.');
}

runVerification().catch((err) => {
  console.error('[Verify Failed]', err);
  process.exit(1);
});
