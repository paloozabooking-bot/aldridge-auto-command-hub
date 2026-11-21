/**
 * Aldridge Auto's v23:
 * 1. Highlighted Storefront Hero: Universal VIN-Confirmed 4-Network Parts Aggregator
 *    (In-House Tested OEM Shelf + Car-Part Pro + Wholesale Suppliers + eBay Motors / PartsGeek / Amazon @ +50% Markup)
 *    with 1-Click Buy Part Now & Book Installed at Shop ($174.99/hr) Checkout
 * 2. Employee Backend Tab 1: Mandatory 17-Char VIN / License Plate Vehicle Intake Gate
 *    (Step 1 VIN/Plate Lock via NHTSA vPIC -> Step 2 Unlocked Part Photo Intake & Publish)
 *    + Clean-Slate Pre-VIN SQLite & Shopify Archive Purge Control
 */
(function () {
  'use strict';

  const aggState = {
    mode: 'vin', // 'vin' | 'plate' | 'ymm'
    activeChannel: 'all',
    lastResponse: null,
    activeVinSession: null,
    uploadedPhotoDataUrls: []
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n) {
    return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getEmployeeTokenHeader() {
    try {
      const tok = sessionStorage.getItem('aldridge_emp_token') || localStorage.getItem('aldridge_emp_token') || '';
      return tok ? { Authorization: `Bearer ${tok}` } : {};
    } catch (_) {
      return {};
    }
  }

  /* ==================== 1. HERO UNIVERSAL VIN-CONFIRMED 4-NETWORK PARTS AGGREGATOR ==================== */
  function renderHeroVinAggregator() {
    const host = document.getElementById('hero-vin-aggregator');
    if (!host) return;

    host.innerHTML = `
      <section class="vin-agg-hero" aria-label="Universal VIN-Confirmed Parts Aggregator">
        <div class="vin-agg-top">
          <div>
            <div class="vin-agg-eyebrow">ONE-STOP VIN-CONFIRMED PARTS AGGREGATOR • RETAIL &amp; B2B WHOLESALE • UNIVERSITY PLACE 98467</div>
            <h2>If We Don't Have It, We Can Get It — Search All 4 Parts Networks by VIN</h2>
            <p class="vin-agg-sub">
              Enter your <strong>17-Character VIN</strong>, <strong>License Plate</strong>, or <strong>Vehicle</strong> to search our <strong>In-House Tested OEM Shelf</strong>, <strong>Car-Part Pro</strong>, <strong>Commercial Wholesale</strong> (PartsTech / Nexpart / Worldpac / O'Reilly / AutoZonePro / NAPA / LKQ), and <strong>eBay Motors / PartsGeek / Amazon</strong> — all in one place with instant checkout or <strong>$174.99/hr 5.0★ Bay Install</strong>.
            </p>
          </div>
          <div class="vin-agg-network-pills">
            <span class="net-pill net-live">✓ In-House OEM Shelf</span>
            <span class="net-pill">Car-Part Pro</span>
            <span class="net-pill">Wholesale Network</span>
            <span class="net-pill">eBay • PartsGeek • Amazon</span>
          </div>
        </div>

        <div class="vin-agg-mode-tabs" role="tablist">
          <button type="button" class="agg-mode-btn ${aggState.mode === 'vin' ? 'active' : ''}" data-agg-mode="vin">17-Character VIN (Recommended)</button>
          <button type="button" class="agg-mode-btn ${aggState.mode === 'plate' ? 'active' : ''}" data-agg-mode="plate">License Plate + State</button>
          <button type="button" class="agg-mode-btn ${aggState.mode === 'ymm' ? 'active' : ''}" data-agg-mode="ymm">Year / Make / Model</button>
        </div>

        <form id="hero-vin-agg-form" class="vin-agg-form">
          <div class="vin-agg-inputs">
            ${aggState.mode === 'vin' ? `
              <div class="agg-field">
                <label for="agg-vin-input">17-Character VIN (NHTSA Confirmed)</label>
                <input id="agg-vin-input" name="vin" class="input mono" maxlength="17" placeholder="e.g. JTEBU5JR2C5091234" style="text-transform:uppercase;" />
              </div>
            ` : aggState.mode === 'plate' ? `
              <div class="agg-field-pair">
                <div class="agg-field">
                  <label for="agg-state-input">State</label>
                  <select id="agg-state-input" name="plate_state" class="select">
                    <option value="WA" selected>WA</option><option value="OR">OR</option><option value="ID">ID</option><option value="CA">CA</option>
                    <option value="TX">TX</option><option value="AZ">AZ</option><option value="NV">NV</option><option value="MT">MT</option>
                    <option value="UT">UT</option><option value="CO">CO</option><option value="AK">AK</option>
                  </select>
                </div>
                <div class="agg-field">
                  <label for="agg-plate-input">License Plate</label>
                  <input id="agg-plate-input" name="license_plate" class="input mono" placeholder="e.g. BXZ1234" style="text-transform:uppercase;" />
                </div>
              </div>
            ` : `
              <div class="agg-field-triple">
                <div class="agg-field"><label for="agg-yr">Year</label><input id="agg-yr" name="vehicle_year" class="input" placeholder="2012" /></div>
                <div class="agg-field"><label for="agg-mk">Make</label><input id="agg-mk" name="vehicle_make" class="input" placeholder="Toyota" /></div>
                <div class="agg-field"><label for="agg-md">Model</label><input id="agg-md" name="vehicle_model" class="input" placeholder="4Runner" /></div>
              </div>
            `}
            <div class="agg-field">
              <label for="agg-part-query">Part Name, OEM Part #, or Symptom</label>
              <input id="agg-part-query" name="part_query" class="input" required placeholder="e.g. Alternator, Front Brake Kit, Radiator, Transmission, ECM..." />
            </div>
            <div class="agg-field agg-submit-col">
              <label>&nbsp;</label>
              <button type="submit" class="btn btn-primary vin-agg-submit">Search All 4 Networks</button>
            </div>
          </div>
        </form>

        <div id="hero-vin-agg-results"></div>
      </section>
    `;

    host.querySelectorAll('[data-agg-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        aggState.mode = btn.getAttribute('data-agg-mode');
        renderHeroVinAggregator();
        if (aggState.lastResponse) renderAggregatorResults(aggState.lastResponse);
      });
    });

    host.querySelector('#hero-vin-agg-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      const out = document.getElementById('hero-vin-agg-results');
      out.innerHTML = '<div class="agg-loading">Decoding VIN via NHTSA vPIC &amp; querying In-House OEM, Car-Part Pro, Commercial Wholesale &amp; National Marketplaces...</div>';
      try {
        const resp = await fetch('/api/parts-aggregator/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getEmployeeTokenHeader() },
          credentials: 'same-origin',
          body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || 'Could not complete aggregator search.');
        aggState.lastResponse = data;
        aggState.activeChannel = 'all';
        renderAggregatorResults(data);
      } catch (err) {
        out.innerHTML = `<div class="agg-error">${esc(err.message)}</div>`;
      }
    });
  }

  function renderAggregatorResults(data) {
    const out = document.getElementById('hero-vin-agg-results');
    if (!out || !data) return;

    const v = data.vehicle || {};
    const vehTitle = [v.year, v.make, v.model, v.trim, v.engine, v.drivetrain].filter(Boolean).join(' ') || 'Vehicle Search';
    const filtered = aggState.activeChannel === 'all'
      ? (data.results || [])
      : (data.results || []).filter((r) => r.channel === aggState.activeChannel);

    const tabs = [
      { key: 'all', label: `All Sources (${data.counts?.total || 0})` },
      { key: 'in_house_oem', label: `In-House OEM (${data.counts?.in_house_oem || 0})` },
      { key: 'car_part_pro', label: `Car-Part Pro (${data.counts?.car_part_pro || 0})` },
      { key: 'wholesale_network', label: `Wholesale (${data.counts?.wholesale_network || 0})` },
      { key: 'national_marketplaces', label: `eBay / PartsGeek / Amazon (${data.counts?.national_marketplaces || 0})` }
    ];

    out.innerHTML = `
      <div class="agg-results-shell">
        <div class="agg-vehicle-lock-banner">
          <div>
            <span class="agg-vin-badge">${v.vin_confirmed ? `✓ VIN CONFIRMED (${esc(v.vin)})` : 'VEHICLE MATCH'}</span>
            <strong>${esc(vehTitle)}</strong>
            <span style="margin-left:8px;opacity:0.85;">• Searching: <strong>${esc(data.part_query)}</strong></span>
          </div>
          ${data.staff_cost_visible ? '<span class="agg-staff-pill">🔓 Staff Mode: Wholesale Cost + 50% Markup Visible</span>' : ''}
        </div>

        ${data.plate_warning ? `<div class="agg-warn-strip">${esc(data.plate_warning)}</div>` : ''}

        <div class="agg-channel-tabs">
          ${tabs.map((t) => `
            <button type="button" class="agg-ch-tab ${aggState.activeChannel === t.key ? 'active' : ''}" data-agg-ch="${esc(t.key)}">${esc(t.label)}</button>
          `).join('')}
        </div>

        <div class="agg-cards-grid">
          ${filtered.map((opt, idx) => `
            <article class="agg-option-card ${opt.channel === 'in_house_oem' ? 'agg-inhouse' : ''}">
              <div class="agg-opt-top">
                <span class="agg-opt-source">${esc(opt.channel_label)}</span>
                <span class="agg-opt-cond">${esc(opt.condition)}</span>
              </div>
              <h4 class="agg-opt-title">${esc(opt.title)}</h4>
              <div class="agg-opt-supplier">${esc(opt.supplier_name)}</div>
              <div class="agg-opt-eta">⏱ ${esc(opt.eta_label)}${opt.warranty_label ? ` • 🛡 ${esc(opt.warranty_label)}` : ''}</div>
              ${opt.staff_cost_visible ? `
                <div class="agg-staff-cost-bar">
                  Wholesale Source: <strong>${money(opt.source_cost_usd)}</strong> → +${opt.markup_pct}% Retail: <strong>${money(opt.retail_price_usd)}</strong>
                </div>
              ` : ''}
              <div class="agg-member-hint">
                VIP Member: <strong>${money(opt.vip_price_usd)}</strong> (-15%) • B2B Pro: <strong>${money(opt.b2b_price_usd)}</strong>
              </div>
              <div class="agg-opt-actions">
                <button type="button" class="btn-buy-clean" data-agg-order="${idx}" data-agg-mode="part_only">
                  <span>Buy Part Now — ${money(opt.retail_price_usd)}</span>
                  <small>Ships Fast or Free 98467 Pickup</small>
                </button>
                <button type="button" class="btn-install-clean" data-agg-order="${idx}" data-agg-mode="bay_install">
                  <span>Book Installed at Shop — ${money(opt.installed_total_usd)}</span>
                  <small>Part + ${opt.labor_hours}h @ $174.99/hr Certified Bay</small>
                </button>
              </div>
            </article>
          `).join('')}
        </div>
      </div>
    `;

    out.querySelectorAll('[data-agg-ch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        aggState.activeChannel = btn.getAttribute('data-agg-ch');
        renderAggregatorResults(data);
      });
    });

    out.querySelectorAll('[data-agg-order]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const opt = filtered[Number(btn.getAttribute('data-agg-order'))];
        const mode = btn.getAttribute('data-agg-mode');
        if (opt) openAggregatorOrderModal(opt, data.vehicle, mode);
      });
    });
  }

  function openAggregatorOrderModal(opt, vehicle, mode) {
    document.getElementById('agg-order-modal')?.remove();
    const isInstall = mode === 'bay_install';
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const wrap = document.createElement('div');
    wrap.id = 'agg-order-modal';
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(20,14,9,0.74);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto;';
    wrap.innerHTML = `
      <div style="background:#fffdf9;border:1.5px solid #e2d2ba;border-radius:18px;max-width:560px;width:100%;padding:1.35rem 1.45rem;position:relative;box-shadow:0 24px 60px rgba(0,0,0,0.34);">
        <button type="button" onclick="document.getElementById('agg-order-modal')?.remove()" style="position:absolute;top:12px;right:14px;background:#f4ece0;border:1px solid #dfd0b8;border-radius:999px;width:32px;height:32px;font-weight:800;cursor:pointer;">✕</button>
        <div class="eyebrow-label" style="margin-bottom:0.2rem;">${isInstall ? 'TURNKEY PART + 5.0★ BAY INSTALL RESERVATION' : 'INSTANT VIN-CONFIRMED PART ORDER'}</div>
        <h3 style="margin:0 0 0.25rem;font-family:'Fraunces',Georgia,serif;color:#1f1711;">${esc(opt.title)}</h3>
        <p style="margin:0 0 0.9rem;font-size:0.88rem;color:#9a3412;font-weight:800;">
          ${esc(opt.supplier_name)} • ${isInstall ? `Turnkey Installed: ${money(opt.installed_total_usd)}` : `Part Total: ${money(opt.retail_price_usd)}`}
        </p>
        <form id="agg-order-form">
          <div class="grid-2" style="gap:0.6rem;">
            <div class="form-group"><label>Full Name *</label><input class="input" name="customer_name" required placeholder="Alex Rivera" /></div>
            <div class="form-group"><label>Mobile Phone (SMS Updates) *</label><input class="input" name="phone" required placeholder="(253) 555-0148" /></div>
          </div>
          <div class="grid-2" style="gap:0.6rem;">
            <div class="form-group"><label>Email</label><input class="input" type="email" name="email" placeholder="alex@email.com" /></div>
            <div class="form-group"><label>VIN (Confirmed)</label><input class="input mono" name="vehicle_vin" value="${esc(vehicle?.vin || '')}" maxlength="17" /></div>
          </div>
          ${isInstall ? `
            <div class="grid-2" style="gap:0.6rem;">
              <div class="form-group"><label>Preferred Bay Date</label><input class="input" type="date" name="preferred_date" value="${tomorrow}" /></div>
              <div class="form-group"><label>Preferred Time</label><select class="select" name="preferred_time"><option>08:30 AM</option><option selected>09:00 AM</option><option>10:30 AM</option><option>01:00 PM</option><option>02:30 PM</option></select></div>
            </div>
          ` : ''}
          <div class="form-group"><label>Notes (Optional)</label><input class="input" name="notes" placeholder="Pickup at 5115 66th St W Bldg B or ship to address..." /></div>
          <div id="agg-order-result" style="margin:0.65rem 0;"></div>
          <button type="submit" class="btn btn-primary" style="width:100%;">${isInstall ? `Confirm Part + Bay Install (${money(opt.installed_total_usd)})` : `Confirm Instant Order (${money(opt.retail_price_usd)})`}</button>
        </form>
      </div>
    `;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);

    document.getElementById('agg-order-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        ...Object.fromEntries(fd.entries()),
        fulfillment_mode: mode,
        part_title: opt.title,
        supplier_name: opt.supplier_name,
        retail_price_usd: opt.retail_price_usd,
        source_cost_usd: opt.source_cost_usd || Number((opt.retail_price_usd / 1.5).toFixed(2)),
        labor_hours: opt.labor_hours || 1.2,
        eta_label: opt.eta_label,
        vehicle_year: vehicle?.year || '',
        vehicle_make: vehicle?.make || '',
        vehicle_model: vehicle?.model || ''
      };
      const out = document.getElementById('agg-order-result');
      out.innerHTML = '<p style="color:#9a3412;font-weight:700;">Confirming VIN-verified order with our parts desk...</p>';
      try {
        const r = await fetch('/api/parts-aggregator/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Could not confirm order');
        out.innerHTML = `
          <div style="background:#ecfdf5;border:1.5px solid #22c55e;border-radius:12px;padding:0.85rem;">
            <div style="font-size:0.75rem;font-weight:800;color:#166534;">✓ CONFIRMED • ORDER ${esc(d.order_code)}${d.booking_code ? ` • BAY ${esc(d.booking_code)}` : ''}</div>
            <p style="margin:0.3rem 0 0;font-size:0.85rem;color:#1f2937;">
              Our parts &amp; service team at <strong>${esc(d.pickup_address)}</strong> has locked your order and will text you final tracking/bay confirmation shortly.
            </p>
          </div>
        `;
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;">${esc(err.message)}</div>`;
      }
    });
  }

  /* ==================== 2. EMPLOYEE BACKEND MANDATORY VIN / LICENSE PLATE INTAKE GATE ==================== */
  function renderEmployeeVinIntakeGate() {
    const host = document.getElementById('employee-vin-intake-gate');
    if (!host) return;
    const locked = aggState.activeVinSession;

    host.innerHTML = `
      <div class="emp-vin-gate-shell">
        <div class="emp-vin-gate-header">
          <div>
            <div class="eyebrow-label" style="margin-bottom:0.15rem;">STRICT SYSTEM INVARIANT • ZERO PRE-VIN LISTINGS ALLOWED</div>
            <h3 style="margin:0;font-family:'Fraunces',Georgia,serif;font-size:1.3rem;">Mandatory VIN / License Plate Vehicle Intake Pipeline</h3>
            <p style="margin:0.25rem 0 0;font-size:0.86rem;color:#5c4b39;">Step 1 is strictly required before ANY part photos can be uploaded or published to the storefront, Shopify, eBay, Google Merchant, or Crosslist.</p>
          </div>
          <button type="button" class="btn btn-outline btn-sm" id="btn-clean-slate-purge-trigger" title="Archive all pre-VIN legacy Shopify products & verify 0 pre-VIN records in SQLite">🧹 Run Clean-Slate Shopify Purge</button>
        </div>

        <div id="emp-purge-status-out" style="margin-bottom:0.8rem;"></div>

        <div class="grid-2" style="gap:1rem;align-items:start;">
          <!-- STEP 1: LOCKED VEHICLE VIN / PLATE DECODER -->
          <div class="surface-card" style="border:2px solid ${locked ? '#16a34a' : '#c2410c'};background:#fffdf9;">
            <div style="font-size:0.75rem;font-weight:800;color:${locked ? '#15803d' : '#9a3412'};text-transform:uppercase;margin-bottom:0.35rem;">
              ${locked ? `✓ STEP 1 LOCKED — SESSION ${esc(locked.session_code)}` : '🔒 STEP 1 (REQUIRED FIRST) — DECODE & LOCK DONOR VEHICLE'}
            </div>
            <form id="emp-step1-vin-form">
              <div class="form-group">
                <label>17-Character VIN (NHTSA vPIC Live Decode)</label>
                <input name="vin" class="input mono" maxlength="17" placeholder="Enter 17-char VIN (e.g. JTEBU5JR2C5091234)" value="${esc(locked?.vin || '')}" style="text-transform:uppercase;" />
              </div>
              <div style="text-align:center;font-size:0.76rem;font-weight:800;color:#78716c;margin:0.35rem 0;">— OR LOOK UP BY LICENSE PLATE —</div>
              <div style="display:grid;grid-template-columns:90px 1fr;gap:0.5rem;">
                <div class="form-group">
                  <label>State</label>
                  <select name="plate_state" class="select">
                    <option value="WA" selected>WA</option><option value="OR">OR</option><option value="ID">ID</option><option value="CA">CA</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>License Plate</label>
                  <input name="license_plate" class="input mono" placeholder="e.g. BXZ1234" style="text-transform:uppercase;" />
                </div>
              </div>
              <div id="emp-step1-msg" style="margin:0.55rem 0;"></div>
              <button type="submit" class="btn btn-primary" style="width:100%;">Decode &amp; Lock Vehicle via NHTSA vPIC</button>
            </form>

            ${locked ? `
              <div style="margin-top:0.85rem;padding:0.75rem;background:#ecfdf5;border:1.5px solid #22c55e;border-radius:12px;font-size:0.84rem;">
                <strong>Locked Donor Vehicle:</strong><br/>
                <span style="font-size:1rem;font-weight:800;color:#14532d;">${esc(locked.year)} ${esc(locked.make)} ${esc(locked.model)} ${esc(locked.trim || '')}</span><br/>
                <span class="mono" style="font-size:0.78rem;">VIN: ${esc(locked.vin)} • Session: ${esc(locked.session_code)}</span><br/>
                <span>Engine: ${esc(locked.engine || 'Verified')} • Drive: ${esc(locked.drivetrain || 'Verified')} • Trans: ${esc(locked.transmission || 'Verified')}</span>
              </div>
            ` : ''}
          </div>

          <!-- STEP 2: PART PHOTO UPLOAD & SINGLE-VARIANT PUBLISH (DISABLED UNTIL STEP 1 LOCKED!) -->
          <div class="surface-card" style="position:relative;border:2px solid ${locked ? '#1f1711' : '#d6d3d1'};opacity:${locked ? '1' : '0.62'};">
            <div style="font-size:0.75rem;font-weight:800;color:${locked ? '#1f1711' : '#78716c'};text-transform:uppercase;margin-bottom:0.35rem;">
              ${locked ? '🔓 STEP 2 UNLOCKED — UPLOAD PART PHOTOS & PUBLISH (1 IN STOCK)' : '🔒 STEP 2 LOCKED — COMPLETE STEP 1 VIN DECODE FIRST'}
            </div>
            <form id="emp-step2-part-form">
              <fieldset ${locked ? '' : 'disabled'} style="border:none;padding:0;margin:0;">
                <div class="form-group">
                  <label>Upload Real Part Photo(s) * (Camera or Shop Folder)</label>
                  <input type="file" id="emp-step2-photo-input" class="input" accept="image/*" multiple />
                  <div id="emp-step2-photo-preview" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;"></div>
                </div>
                <div class="form-group">
                  <label>Specific OEM Part Name *</label>
                  <input name="part_name" class="input" required placeholder="e.g. Front Left Driver Door Shell, Engine Control Module (ECM)" />
                </div>
                <div class="grid-2" style="gap:0.55rem;">
                  <div class="form-group"><label>Stamped OEM Part # (Optional)</label><input name="oem_part_number" class="input mono" placeholder="e.g. 89661-35822" /></div>
                  <div class="form-group"><label>Retail Price (USD) *</label><input name="price_we_pull" type="number" step="0.01" class="input" required value="125.00" /></div>
                </div>
                <div class="grid-2" style="gap:0.55rem;">
                  <div class="form-group"><label>Shelf / Bin Location</label><input name="bin_location" class="input" value="BAY-B-SHELF" /></div>
                  <div class="form-group"><label>Push Live to Shopify?</label><select name="push_shopify" class="select"><option value="true" selected>Yes — Push to Shopify Immediately</option><option value="false">Save to Storefront First</option></select></div>
                </div>
                <div id="emp-step2-msg" style="margin:0.55rem 0;"></div>
                <button type="submit" class="btn btn-dark" style="width:100%;">Publish Single-Variant Verified OEM Part (Qty: 1)</button>
              </fieldset>
            </form>
          </div>
        </div>
      </div>
    `;

    // Hide legacy pre-VIN camera dropzone underneath so staff ALWAYS uses the VIN-locked pipeline
    const staffIntake = document.getElementById('staff-intake');
    if (staffIntake) {
      Array.from(staffIntake.children).forEach((el) => {
        if (el.id !== 'employee-vin-intake-gate') el.style.display = 'none';
      });
    }

    host.querySelector('#btn-clean-slate-purge-trigger')?.addEventListener('click', async () => {
      const out = document.getElementById('emp-purge-status-out');
      out.innerHTML = '<p style="color:#9a3412;font-weight:700;">Running Clean-Slate SQLite + Shopify Pre-VIN Purge...</p>';
      try {
        const r = await fetch('/api/employee/catalog/purge-clean-slate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getEmployeeTokenHeader() },
          credentials: 'same-origin',
          body: JSON.stringify({})
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Purge requires Employee PIN sign-in.');
        out.innerHTML = `<div style="background:#ecfdf5;border:1px solid #22c55e;border-radius:10px;padding:0.65rem;font-size:0.84rem;">
          ✓ Clean-Slate Purge Complete: SQLite purged <strong>${d.sqlite_purge.purged_inventory_items}</strong> legacy items (remaining VIN-verified: <strong>${d.sqlite_purge.remaining_verified_vin_items}</strong>) • Shopify mode: <strong>${esc(d.shopify_purge.mode)}</strong> (archived: ${d.shopify_purge.archived_count || 0})
        </div>`;
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;">${esc(err.message)}</div>`;
      }
    });

    host.querySelector('#emp-step1-vin-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      const out = document.getElementById('emp-step1-msg');
      out.innerHTML = '<p style="color:#9a3412;font-weight:700;">Decoding via NHTSA vPIC...</p>';
      try {
        const r = await fetch('/api/employee/intake/vehicle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getEmployeeTokenHeader() },
          credentials: 'same-origin',
          body: JSON.stringify(body)
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'VIN decode failed (sign in to Employee Backend first).');
        aggState.activeVinSession = d.session;
        aggState.uploadedPhotoDataUrls = [];
        renderEmployeeVinIntakeGate();
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.84rem;">${esc(err.message)}</div>`;
      }
    });

    host.querySelector('#emp-step2-photo-input')?.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []).slice(0, 6);
      aggState.uploadedPhotoDataUrls = [];
      const prev = document.getElementById('emp-step2-photo-preview');
      if (prev) prev.innerHTML = '';
      files.forEach((f) => {
        const reader = new FileReader();
        reader.onload = () => {
          aggState.uploadedPhotoDataUrls.push(reader.result);
          if (prev) {
            const img = document.createElement('img');
            img.src = reader.result;
            img.style.cssText = 'width:58px;height:58px;object-fit:cover;border-radius:8px;border:1px solid #d6c5ae;';
            prev.appendChild(img);
          }
        };
        reader.readAsDataURL(f);
      });
    });

    host.querySelector('#emp-step2-part-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!aggState.activeVinSession) return;
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      body.session_code = aggState.activeVinSession.session_code;
      body.photos = aggState.uploadedPhotoDataUrls;
      body.push_shopify = body.push_shopify === 'true';
      const out = document.getElementById('emp-step2-msg');
      out.innerHTML = '<p style="color:#9a3412;font-weight:700;">Running taxonomy (vp-1-4-*), dimensions, zero-duplicate check &amp; publishing...</p>';
      try {
        const r = await fetch('/api/employee/intake/part', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getEmployeeTokenHeader() },
          credentials: 'same-origin',
          body: JSON.stringify(body)
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Part publish failed.');
        out.innerHTML = `<div style="background:#ecfdf5;border:1.5px solid #22c55e;border-radius:10px;padding:0.7rem;font-size:0.84rem;">
          ✓ Published Single-Variant OEM SKU <strong>${esc(d.item.sku)}</strong> (${esc(d.item.title)}) • Taxonomy: <code>${esc(d.taxonomy.shopify_taxonomy_id)}</code> • Qty: 1
        </div>`;
        aggState.uploadedPhotoDataUrls = [];
        e.target.reset();
        const prev = document.getElementById('emp-step2-photo-preview');
        if (prev) prev.innerHTML = '';
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.84rem;">${esc(err.message)}</div>`;
      }
    });
  }

  function initV23() {
    renderHeroVinAggregator();
    renderEmployeeVinIntakeGate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initV23);
  } else {
    initV23();
  }
})();
