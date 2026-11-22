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
    autoBinPrefix: 'BAY-B-SHELF',
    vinLabelConflict: null,
    pendingConflict: null,
    vinSource: '',
    pendingDriveUrl: '',
    geminiVisionConfigured: null,
    queuedFiles: [],
    lastBatchResult: null
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
  function computeClientAutoBin(sess) {
    if (!sess) return 'BAY-B-SHELF';
    const yr = String(sess.year || '').trim();
    const yr2 = yr.length >= 4 ? yr.slice(-2) : '';
    const mk = String(sess.make || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const md = String(sess.model || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let tok = md;
    if (mk === 'FIAT' && md.startsWith('500')) tok = 'FIAT500';
    else if (mk === 'CHEVROLET' && md.startsWith('S10')) tok = 'S10';
    else if (!tok || tok.length < 2) tok = mk || 'OEM';
    tok = tok.slice(0, 10);
    return yr2 ? `${tok}-${yr2}-BAYB` : `${tok}-BAYB`;
  }

  function renderEmployeeVinIntakeGate() {
    const host = document.getElementById('employee-vin-intake-gate');
    if (!host) return;
    const locked = aggState.activeVinSession;
    const autoBin = aggState.autoBinPrefix || computeClientAutoBin(locked);
    const conflict = aggState.vinLabelConflict;
    const visionReady = aggState.geminiVisionConfigured === true;
    const visionBadgeHtml = aggState.geminiVisionConfigured === null
      ? '<span class="sku-badge-store">⏳ Checking Gemini Vision AI...</span>'
      : (visionReady
        ? '<span class="sku-badge-live">🟢 Gemini 2.5 Flash Vision Pixel AI: ACTIVE (Persisted)</span>'
        : '<span class="sku-badge-queue">🟡 Filename / Metadata Mode (Save Gemini Key Below for Pixel AI &amp; Sticker OCR)</span>');

    host.innerHTML = `
      <div class="emp-vin-gate-shell">
        <div class="emp-vin-gate-header">
          <div>
            <div class="eyebrow-label" style="margin-bottom:0.15rem;">UNIFIED VIN-FIRST ENGINE (v29) • MASTER PARENT FOLDER FLEET RUNNER + PHOTO/VIDEO OCR + MANUAL VIN</div>
            <h3 style="margin:0;font-family:'Fraunces',Georgia,serif;font-size:1.3rem;">Unified Mandatory VIN / Plate &amp; Hands-Free AI Media Intake</h3>
            <p style="margin:0.25rem 0 0;font-size:0.86rem;color:#5c4b39;">Run your entire multi-vehicle Google Drive fleet in 1 click OR lock a single vehicle via Drive folder title, .zip/file names, VIN sticker photo/video, or manual VIN/Plate.</p>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.45rem;align-items:center;">
            ${visionBadgeHtml}
            <button type="button" class="btn btn-outline btn-sm" id="btn-toggle-gemini-key-box" title="Save and persist your Google AI Studio Gemini Vision API key across restarts">🔑 ${visionReady ? 'Update' : 'Save'} Gemini Vision Key</button>
            <button type="button" class="btn btn-outline btn-sm" id="btn-clean-slate-purge-trigger" title="Archive all pre-VIN legacy Shopify products & verify 0 pre-VIN records in SQLite">🧹 Clean-Slate Purge</button>
          </div>
        </div>

        <div id="emp-gemini-key-box" style="display:none;margin-bottom:0.8rem;padding:0.75rem;background:#fffbeb;border:1.5px solid #f59e0b;border-radius:10px;">
          <div style="font-size:0.76rem;font-weight:800;color:#92400e;margin-bottom:0.35rem;">🔑 PERSIST GEMINI 2.5 FLASH VISION API KEY (SAVED TO SQLITE + PERSISTENT DISK)</div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <input type="password" id="emp-inline-gemini-key-input" class="input mono" style="flex:1;min-width:240px;" placeholder="Paste AIzaSy... Google AI Studio API Key" />
            <button type="button" class="btn btn-primary btn-sm" id="btn-save-inline-gemini-key">Save &amp; Persist Key</button>
          </div>
          <div id="emp-inline-gemini-key-msg" style="margin-top:0.35rem;font-size:0.78rem;"></div>
        </div>

        <!-- MASTER PARENT GOOGLE DRIVE FOLDER MULTI-VEHICLE BATCH RUNNER (v29) -->
        <div class="surface-card" style="margin-bottom:0.95rem;border:2px solid #0f766e;background:#f0fdfa;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;flex-wrap:wrap;">
            <div>
              <div style="font-size:0.74rem;font-weight:800;letter-spacing:0.06em;color:#0f766e;text-transform:uppercase;">🚀 1-CLICK MASTER FLEET RUNNER • ALL VERIFIED 17-VIN SUBFOLDERS</div>
              <h4 style="margin:0.15rem 0 0.25rem;font-size:1.05rem;color:#134e4a;">Master Parent Google Drive Folder Multi-Vehicle Batch Intake</h4>
              <p style="margin:0;font-size:0.82rem;color:#115e59;">Enumerates every subfolder, locks each verified 17-char VIN via NHTSA vPIC, runs Gemini 2.5 Flash Vision + multi-angle dedupe + Sold/SRS filtering, pushes live to Shopify &amp; all feeds, and flags folders missing a 17-char VIN without mis-tagging.</p>
            </div>
            <button type="button" class="btn btn-outline btn-sm" id="btn-master-shopify-sync-now" style="border-color:#0f766e;color:#0f766e;">🛍️ Sync All Verified SKUs to Shopify</button>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.65rem;">
            <input type="url" id="emp-master-drive-url-input" class="input mono" style="flex:1;min-width:280px;font-size:0.8rem;" value="${esc(aggState.masterDriveUrl || 'https://drive.google.com/drive/u/0/folders/1upmnO9StviS4Wasuhy_GFcg8h1el9T4y')}" placeholder="https://drive.google.com/drive/u/0/folders/..." />
            <button type="button" class="btn btn-primary" id="btn-run-master-drive-batch" style="background:#0f766e;border-color:#0f766e;">🚀 Run Master Drive Folder Batch (All 17-VIN Vehicles)</button>
          </div>
          <div id="emp-master-batch-status" style="margin-top:0.65rem;"></div>
        </div>

        <div id="emp-purge-status-out" style="margin-bottom:0.8rem;"></div>

        <div class="grid-2" style="gap:1rem;align-items:start;">
          <!-- STEP 1: UNIFIED VIN RESOLUTION (DRIVE FOLDER / PHOTO-VIDEO STICKER OCR / MANUAL VIN / PLATE) -->
          <div class="surface-card" style="border:2px solid ${locked ? '#16a34a' : '#c2410c'};background:#fffdf9;">
            <div style="font-size:0.75rem;font-weight:800;color:${locked ? '#15803d' : '#9a3412'};text-transform:uppercase;margin-bottom:0.4rem;">
              ${locked ? `✓ STEP 1 LOCKED — SESSION ${esc(locked.session_code)}` : '🔒 STEP 1 (REQUIRED FIRST) — AUTO-EXTRACT OR ENTER VIN'}
            </div>

            <!-- 1A. Quick Auto-Extract VIN from Sticker Photo/Video OR Drive Link -->
            <div style="background:#fef7ed;border:1px solid #fed7aa;border-radius:10px;padding:0.65rem;margin-bottom:0.75rem;">
              <div style="font-size:0.73rem;font-weight:800;color:#9a3412;margin-bottom:0.4rem;">⚡ FAST AUTO-EXTRACT VIN (STICKER PHOTO/VIDEO OR DRIVE FOLDER)</div>
              <div style="display:flex;flex-wrap:wrap;gap:0.45rem;margin-bottom:0.45rem;">
                <label class="btn btn-dark btn-sm" style="cursor:pointer;margin:0;">
                  📸 Scan VIN Sticker Photo / Video
                  <input type="file" id="emp-step1-vin-media-input" accept="image/*,video/*,.zip" capture="environment" style="display:none;" />
                </label>
              </div>
              <div style="display:flex;gap:0.4rem;">
                <input id="emp-step1-drive-extract-input" class="input" type="url" placeholder="Paste Google Drive folder link to auto-read VIN..." value="${esc(aggState.pendingDriveUrl || '')}" style="font-size:0.8rem;" />
                <button type="button" id="btn-step1-extract-drive-vin" class="btn btn-outline btn-sm" style="white-space:nowrap;">☁️ Extract VIN</button>
              </div>
            </div>

            <!-- 1B. Manual 17-Char VIN or License Plate Fallback / Override -->
            <form id="emp-step1-vin-form">
              <div class="form-group">
                <label>17-Character VIN (Manual Entry or Override — NHTSA vPIC Live Decode)</label>
                <input name="vin" class="input mono" maxlength="17" placeholder="Enter 17-char VIN (e.g. JTEBU5JR2C5091234)" value="${esc(locked?.vin || '')}" style="text-transform:uppercase;" />
              </div>
              <div style="text-align:center;font-size:0.74rem;font-weight:800;color:#78716c;margin:0.3rem 0;">— OR LOOK UP BY LICENSE PLATE —</div>
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

            ${aggState.pendingConflict ? (() => {
              const pc = aggState.pendingConflict;
              const fv = pc.folder_vehicle || pc.vin_label_conflict?.folder_vehicle;
              const nv = pc.nhtsa_vehicle || pc.vin_label_conflict?.nhtsa_vehicle;
              const folderLbl = fv ? `${fv.year} ${fv.make} ${fv.model}` : (pc.folder_title || 'Folder Year');
              const nhtsaLbl = nv ? `${nv.year} ${nv.make} ${nv.model}` : 'NHTSA VIN Decode';
              return `
                <div id="emp-vin-conflict-banner" style="margin-top:0.75rem;padding:0.85rem;background:#fffbeb;border:2px solid #d97706;border-radius:12px;font-size:0.82rem;color:#78350f;">
                  <div style="font-weight:800;font-size:0.86rem;color:#9a3412;margin-bottom:0.35rem;">⚠️ FOLDER LABEL vs. NHTSA VIN MISMATCH — CHOOSE TRUE VEHICLE BEFORE LOCKING</div>
                  <div style="margin-bottom:0.55rem;line-height:1.45;">
                    <div><strong>Folder Label:</strong> ${esc(folderLbl)}${fv?.auto_bin_prefix ? ` (Bin: <code>${esc(fv.auto_bin_prefix)}</code>)` : ''}</div>
                    <div><strong>NHTSA vPIC VIN Decode:</strong> ${esc(nhtsaLbl)} • VIN <code class="mono">${esc(nv?.vin || pc.vin_detected || '')}</code>${nv?.auto_bin_prefix ? ` (Bin: <code>${esc(nv.auto_bin_prefix)}</code>)` : ''}</div>
                  </div>
                  <div style="display:flex;flex-direction:column;gap:0.45rem;">
                    <button type="button" id="btn-conflict-use-nhtsa-vin" class="btn btn-primary btn-sm" style="width:100%;">
                      ✓ Use True VIN Decode (${esc(nhtsaLbl)})
                    </button>
                    ${fv ? `
                      <button type="button" id="btn-conflict-trust-folder-year" class="btn btn-dark btn-sm" style="width:100%;">
                        ⚠ Keep Folder Year (${esc(folderLbl)}) &amp; Clear Wrong VIN
                      </button>
                    ` : ''}
                  </div>
                </div>
              `;
            })() : (conflict && conflict.has_conflict ? `
              <div style="margin-top:0.75rem;padding:0.7rem;background:#fef3c7;border:1.5px solid #d97706;border-radius:10px;font-size:0.82rem;color:#78350f;">
                <strong>⚠️ Conflict Resolved:</strong> ${esc(conflict.warning)}
              </div>
            ` : '')}

            ${locked ? `
              <div style="margin-top:0.75rem;padding:0.75rem;background:#ecfdf5;border:1.5px solid #22c55e;border-radius:12px;font-size:0.84rem;">
                <strong>Locked Donor Vehicle${aggState.vinSource ? ` (${esc(aggState.vinSource)})` : ''}:</strong><br/>
                <span style="font-size:1rem;font-weight:800;color:#14532d;">${esc(locked.year)} ${esc(locked.make)} ${esc(locked.model)} ${esc(locked.trim || '')}</span><br/>
                <span class="mono" style="font-size:0.78rem;">VIN: ${esc(locked.vin === 'VIN-TITLE-CHECK' ? 'CLEARED (Flagged for Title-Check)' : locked.vin)} • Session: ${esc(locked.session_code)} • Auto-Bin: ${esc(autoBin)}</span><br/>
                <span>Engine: ${esc(locked.engine || (locked.vin === 'VIN-TITLE-CHECK' ? 'Folder Year Override' : 'Verified'))} • Drive: ${esc(locked.drivetrain || 'Verified')} • Trans: ${esc(locked.transmission || 'Verified')}</span>
              </div>
            ` : ''}
          </div>

          <!-- STEP 2: 100% HANDS-FREE AI MULTI-INPUT BATCH INTAKE (PHOTOS + VIDEOS + .ZIP + DRIVE) -->
          <div class="surface-card" style="position:relative;border:2px solid ${locked ? '#1f1711' : '#d6d3d1'};opacity:${locked ? '1' : '0.68'};">
            <div style="font-size:0.75rem;font-weight:800;color:${locked ? '#1f1711' : '#78716c'};text-transform:uppercase;margin-bottom:0.35rem;">
              ${locked ? '🔓 STEP 2 UNLOCKED — HANDS-FREE AI PHOTO / VIDEO / .ZIP / DRIVE BATCH INTAKE' : '🔒 STEP 2 LOCKED — COMPLETE STEP 1 VIN DECODE FIRST (OR PASTE DRIVE LINK WITH VIN IN FOLDER NAME)'}
            </div>
            <p style="margin:0 0 0.7rem;font-size:0.82rem;color:#5c4b39;">
              Upload <strong>photos</strong>, <strong>walkaround/part videos</strong> (auto keyframe extraction), <strong>.zip archives</strong>, or a <strong>Google Drive folder link</strong>. Smart grouping merges <code>ALD-XXXXXX</code> / <code>ALD-OH-XXX</code> / <code>.1..8</code> angles into <strong>1 listing (Qty: 1)</strong> and automatically filters sold Shopify orders (<code>#1006–#1038</code>) &amp; SRS/seatbelt items.
            </p>
            <form id="emp-step2-batch-form">
              <fieldset ${locked ? '' : 'disabled'} style="border:none;padding:0;margin:0;">
                <div id="emp-ai-dropzone" class="ai-batch-dropzone">
                  <div class="ai-dropzone-actions">
                    <label class="btn btn-primary btn-sm" style="cursor:pointer;margin:0;">
                      📸 Snap Photo / Record Video
                      <input type="file" id="emp-step2-camera-input" accept="image/*,video/*" capture="environment" multiple style="display:none;" />
                    </label>
                    <label class="btn btn-dark btn-sm" style="cursor:pointer;margin:0;">
                      🖼 Upload Photos, Videos or .ZIP
                      <input type="file" id="emp-step2-files-input" accept="image/*,video/*,.zip,application/zip,application/x-zip-compressed" multiple style="display:none;" />
                    </label>
                  </div>
                  <div class="ai-dropzone-hint">Drag &amp; drop part photos, short MP4/MOV clips, or a <code>.zip</code> archive — zero manual part typing required</div>
                  <div id="emp-step2-file-queue" class="ai-file-queue"></div>
                </div>

                <div class="form-group" style="margin-top:0.7rem;">
                  <label for="emp-step2-drive-url">☁️ Or Paste Google Drive Folder / File Link (Auto-Extracts VIN &amp; Unpacks Server-Side)</label>
                  <input id="emp-step2-drive-url" name="drive_url" class="input" type="url" value="${esc(aggState.pendingDriveUrl || '')}" placeholder="https://drive.google.com/drive/folders/... or /file/d/..." />
                </div>

                <div class="grid-3-compact" style="margin-top:0.5rem;">
                  <div class="form-group">
                    <label>Shelf / Bin Prefix (Auto-Filled)</label>
                    <input name="bin_location" class="input mono" value="${esc(autoBin)}" placeholder="${esc(autoBin)}" />
                  </div>
                  <div class="form-group">
                    <label>Multi-Angle Grouping</label>
                    <select name="grouping_mode" class="select">
                      <option value="auto" selected>Auto-Detect &amp; Merge Angles</option>
                      <option value="single_part">All Photos = 1 Part</option>
                      <option value="one_per_photo">1 Photo = 1 Part</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Push Live to Shopify?</label>
                    <select name="push_shopify" class="select">
                      <option value="true" selected>Yes — Push Live Immediately</option>
                      <option value="false">Save to Storefront First</option>
                    </select>
                  </div>
                </div>

                <div id="emp-step2-msg" style="margin:0.65rem 0;"></div>
                <button type="submit" id="emp-step2-submit-btn" class="btn btn-dark" style="width:100%;padding:0.8rem 1rem;font-size:0.95rem;">
                  ⚡ Run Hands-Free AI Intake &amp; Publish All Verified OEM Parts (Qty: 1)
                </button>
              </fieldset>
            </form>
          </div>
        </div>

        <div id="emp-batch-summary-out" style="margin-top:1rem;"></div>
      </div>
    `;

    // Hide legacy pre-VIN camera dropzone underneath so staff ALWAYS uses the unified VIN-locked pipeline
    const staffIntake = document.getElementById('staff-intake');
    if (staffIntake) {
      Array.from(staffIntake.children).forEach((el) => {
        if (el.id !== 'employee-vin-intake-gate') el.style.display = 'none';
      });
    }

    function renderQueuedFiles() {
      const qEl = document.getElementById('emp-step2-file-queue');
      if (!qEl) return;
      if (!aggState.queuedFiles.length) {
        qEl.innerHTML = '';
        return;
      }
      qEl.innerHTML = aggState.queuedFiles.map((f, idx) => {
        const isZip = /\.zip$/i.test(f.name) || /zip/i.test(f.type);
        const isVid = /\.(mp4|mov|webm|m4v|3gp)$/i.test(f.name) || /^video\//i.test(f.type);
        const kb = Math.max(1, Math.round(f.size / 1024));
        const sizeLabel = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
        return `
          <div class="ai-queued-chip ${isZip ? 'is-zip' : ''}">
            <span>${isZip ? '📦' : (isVid ? '🎥' : '📷')} <strong>${esc(f.name)}</strong> <small>(${sizeLabel})</small></span>
            <button type="button" data-rm-file="${idx}" aria-label="Remove file">✕</button>
          </div>
        `;
      }).join('');
      qEl.querySelectorAll('[data-rm-file]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = Number(btn.getAttribute('data-rm-file'));
          aggState.queuedFiles.splice(i, 1);
          renderQueuedFiles();
        });
      });
    }

    function enqueueFiles(fileList) {
      const incoming = Array.from(fileList || []);
      for (const f of incoming) {
        if (aggState.queuedFiles.length >= 75) break;
        const dup = aggState.queuedFiles.some((x) => x.name === f.name && x.size === f.size);
        if (!dup) aggState.queuedFiles.push(f);
      }
      renderQueuedFiles();
    }

    function renderBatchSummary(d) {
      const box = document.getElementById('emp-batch-summary-out');
      if (!box || !d) return;
      const items = d.created_items || [];
      const skipped = d.skipped_items || [];
      const soldCnt = Number(d.blocked_sold_count || 0);
      const srsCnt = Number(d.blocked_srs_count || 0);
      box.innerHTML = `
        <div class="ai-batch-summary-card">
          <div class="ai-batch-summary-top">
            <div>
              <div class="eyebrow-label" style="color:#15803d;margin-bottom:0.15rem;">✓ UNIFIED AI BATCH INTAKE COMPLETE • VIN ${esc(d.session?.vin || '')} • BIN ${esc(d.auto_bin_prefix || '')}</div>
              <h4 style="margin:0;font-family:'Fraunces',Georgia,serif;font-size:1.15rem;color:#14532d;">
                ${items.length} Single-Variant OEM SKU${items.length === 1 ? '' : 's'} Auto-Created &amp; Published Live
              </h4>
            </div>
            <div class="ai-batch-kpis">
              <span>📷 ${d.total_photos_received || 0} Frames/Photos In</span>
              <span>🔗 ${d.duplicate_angles_merged || 0} Angles Merged</span>
              ${soldCnt ? `<span style="background:#fee2e2;color:#991b1b;">🛑 ${soldCnt} Sold Order Blocked</span>` : ''}
              ${srsCnt ? `<span style="background:#fef3c7;color:#92400e;">🛡 ${srsCnt} SRS/Seatbelt Blocked</span>` : ''}
              ${skipped.length ? `<span style="background:#fef3c7;color:#92400e;">⚠ ${skipped.length} Total Flagged</span>` : ''}
            </div>
          </div>

          ${d.vin_label_conflict?.has_conflict ? `
            <div style="margin-bottom:0.75rem;padding:0.65rem;background:#fef3c7;border:1.5px solid #d97706;border-radius:10px;font-size:0.82rem;color:#78350f;">
              <strong>⚠️ Folder Label vs. VIN Conflict:</strong> ${esc(d.vin_label_conflict.warning)}
            </div>
          ` : ''}

          ${items.length ? `
            <div class="ai-sku-cards-grid">
              ${items.map((it) => {
                const sh = it.shopify_push;
                const shBadge = sh && sh.pushed
                  ? '<span class="sku-badge-live">✓ Live on Shopify + QR Tag</span>'
                  : (sh && sh.queued_for_shopify
                    ? '<span class="sku-badge-queue">⏳ Queued for Shopify Sync</span>'
                    : '<span class="sku-badge-store">✓ Live on Storefront &amp; Feeds</span>');
                return `
                  <article class="ai-sku-card">
                    <div class="ai-sku-card-media">
                      ${it.thumbnail ? `<img src="${esc(it.thumbnail)}" alt="${esc(it.title)}" />` : '<div class="ai-sku-noimg">OEM</div>'}
                      <span class="ai-sku-photo-cnt">${it.photo_count} photo${it.photo_count === 1 ? '' : 's'}</span>
                    </div>
                    <div class="ai-sku-card-body">
                      <div class="ai-sku-meta-row">
                        <code class="mono">${esc(it.sku)}</code>
                        ${shBadge}
                      </div>
                      <h5>${esc(it.title)}</h5>
                      <div class="ai-sku-specs">
                        ${it.oem_part_number ? `<span><strong>MPN:</strong> <code>${esc(it.oem_part_number)}</code></span>` : ''}
                        <span><strong>Taxonomy:</strong> <code>${esc(it.taxonomy?.shopify_taxonomy_id || '')}</code></span>
                        <span><strong>Packed:</strong> ${it.weight_lbs} lb (${esc(it.dimensions_in)} in)</span>
                        <span><strong>Bin:</strong> ${esc(it.bin_location)} • <strong>Qty:</strong> ${it.quantity}</span>
                      </div>
                      <div class="ai-sku-price-row">
                        <div>Part Retail: <strong>${money(it.price_we_pull)}</strong></div>
                        <div>Installed ($174.99/hr): <strong>${money(it.price_pull_install)}</strong></div>
                      </div>
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          ` : ''}

          ${skipped.length ? `
            <div class="ai-skipped-box">
              <strong>Filtered / Flagged Items (${skipped.length}):</strong>
              <ul>
                ${skipped.slice(0, 25).map((s) => `<li><strong>${esc(s.filename)}</strong>: ${esc(s.reason)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      `;
    }

    if (aggState.lastBatchResult) {
      renderBatchSummary(aggState.lastBatchResult);
    }
    renderQueuedFiles();

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
          ✓ Clean-Slate Purge Complete: SQLite purged <strong>${d.sqlite_purge.purged_inventory_items}</strong> legacy items &amp; <strong>${d.sqlite_purge.purged_photo_review_items || 0}</strong> photo triage rows • Shopify mode: <strong>${esc(d.shopify_purge.mode)}</strong> (archived: ${d.shopify_purge.archived_count || 0})
        </div>`;
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;">${esc(err.message)}</div>`;
      }
    });

    function validateClientDriveUrl(raw) {
      const s = String(raw || '').trim();
      if (!s) return 'Paste a full Google Drive folder or file URL first.';
      if (/\.{3}|…/.test(s)) {
        return 'Shortened/truncated URL detected ("..."). Copy the full URL directly from your browser address bar (e.g. https://drive.google.com/drive/folders/<ID>).';
      }
      if (!/^https?:\/\/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|file\/d\/|open\?id=|uc\?)/i.test(s)) {
        return 'Enter a full https://drive.google.com/drive/folders/<ID> or https://drive.google.com/file/d/<ID>/view URL.';
      }
      return '';
    }

    function applyVinResolveResponse(d, fallbackSource) {
      if (typeof d.gemini_vision_configured === 'boolean') aggState.geminiVisionConfigured = d.gemini_vision_configured;
      if (d.drive_url) aggState.pendingDriveUrl = d.drive_url;
      if (d.conflict_resolution_required) {
        aggState.pendingConflict = d;
        aggState.activeVinSession = null;
        aggState.vinLabelConflict = d.vin_label_conflict || null;
        aggState.lastBatchResult = null;
        renderEmployeeVinIntakeGate();
        return;
      }
      aggState.pendingConflict = null;
      aggState.activeVinSession = d.session;
      aggState.autoBinPrefix = d.auto_bin_prefix || computeClientAutoBin(d.session);
      aggState.vinLabelConflict = d.vin_label_conflict || null;
      aggState.vinSource = d.vin_source || fallbackSource;
      aggState.lastBatchResult = null;
      renderEmployeeVinIntakeGate();
    }

    // Inline Save & Persist Gemini Vision Key
    host.querySelector('#btn-toggle-gemini-key-box')?.addEventListener('click', () => {
      const box = document.getElementById('emp-gemini-key-box');
      if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
    });
    host.querySelector('#btn-save-inline-gemini-key')?.addEventListener('click', async () => {
      const inp = document.getElementById('emp-inline-gemini-key-input');
      const msg = document.getElementById('emp-inline-gemini-key-msg');
      const keyVal = String(inp?.value || '').trim();
      if (!keyVal || keyVal.length < 20) {
        if (msg) msg.innerHTML = '<span style="color:#b91c1c;font-weight:700;">Paste a valid Google AI Studio key (starts with AIza...).</span>';
        return;
      }
      if (msg) msg.innerHTML = '<span style="color:#9a3412;font-weight:700;">Saving &amp; persisting Gemini Vision key...</span>';
      try {
        const r = await fetch('/api/employee/settings/gemini-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getEmployeeTokenHeader() },
          credentials: 'same-origin',
          body: JSON.stringify({ gemini_api_key: keyVal })
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Sign in to Employee Backend first.');
        aggState.geminiVisionConfigured = true;
        renderEmployeeVinIntakeGate();
      } catch (err) {
        if (msg) msg.innerHTML = `<span style="color:#b91c1c;font-weight:700;">${esc(err.message)}</span>`;
      }
    });

    // Master Parent Folder Multi-Vehicle Batch Runner (v29)
    function renderMasterJobBox(job) {
      const box = document.getElementById('emp-master-batch-status');
      if (!box || !job) return;
      const pct = job.verified_17vin_count > 0
        ? Math.min(100, Math.round((Number(job.completed_folders || 0) / job.verified_17vin_count) * 100))
        : 0;
      const statusBadge = job.status === 'completed'
        ? '<span class="sku-badge-live">✓ COMPLETED</span>'
        : (job.status === 'failed'
          ? '<span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:800;">✕ FAILED</span>'
          : `<span class="sku-badge-store">⚡ RUNNING (${job.completed_folders}/${job.verified_17vin_count} vehicles • ${pct}%)</span>`);

      const perFolderHtml = (job.per_folder_results || []).length
        ? `<div style="margin-top:0.55rem;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.77rem;background:#fff;border:1px solid #ccfbf1;border-radius:8px;">
            <thead><tr style="background:#ccfbf1;color:#134e4a;text-align:left;">
              <th style="padding:5px 8px;">Donor Vehicle (NHTSA Locked)</th>
              <th style="padding:5px 8px;">17-Char VIN</th>
              <th style="padding:5px 8px;">Bin</th>
              <th style="padding:5px 8px;">Photos</th>
              <th style="padding:5px 8px;">SKUs Created</th>
              <th style="padding:5px 8px;">Merged / Blocked</th>
            </tr></thead>
            <tbody>${(job.per_folder_results || []).map((f) => `
              <tr style="border-top:1px solid #e2e8f0;">
                <td style="padding:5px 8px;font-weight:700;">${esc(f.vehicle || f.folder_title)}${f.error ? ` <span style="color:#b91c1c;">(${esc(f.error)})</span>` : ''}</td>
                <td style="padding:5px 8px;" class="mono">${esc(f.vin || '')}</td>
                <td style="padding:5px 8px;" class="mono">${esc(f.bin_location || '')}</td>
                <td style="padding:5px 8px;">${Number(f.photos_received || 0)}</td>
                <td style="padding:5px 8px;font-weight:800;color:#15803d;">${Number(f.created_count || 0)}</td>
                <td style="padding:5px 8px;">${Number(f.angles_merged || 0)} merged • ${Number(f.sold_blocked || 0)} sold • ${Number(f.srs_blocked || 0)} SRS</td>
              </tr>`).join('')}
            </tbody>
          </table></div>`
        : '';

      const needsVinHtml = (job.needs_vin_folders || []).length
        ? `<div style="margin-top:0.65rem;padding:0.65rem 0.8rem;background:#fffbeb;border:1.5px solid #f59e0b;border-radius:10px;">
            <div style="font-size:0.75rem;font-weight:800;color:#92400e;margin-bottom:0.35rem;">⚠️ NEEDS 17-CHAR VIN / PLATE LOOKUP (${job.needs_vin_folders.length} Folders Skipped — Zero Mis-Tagging)</div>
            <ul style="margin:0;padding-left:1.15rem;font-size:0.78rem;color:#78350f;line-height:1.45;">
              ${job.needs_vin_folders.map((nf) => `<li><strong>${esc(nf.title)}</strong> — ${esc(nf.reason || 'Missing 17-char VIN')}</li>`).join('')}
            </ul>
          </div>`
        : '';

      box.innerHTML = `
        <div style="background:#fff;border:1.5px solid #99f6e4;border-radius:10px;padding:0.75rem;font-size:0.82rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.4rem;">
            <div><strong>Master Job <code class="mono">${esc(job.job_id)}</code></strong> • ${job.verified_17vin_count} Verified 17-VIN Vehicles • ${job.needs_vin_count} Needs VIN</div>
            ${statusBadge}
          </div>
          ${job.current_folder ? `<div style="margin-top:0.35rem;color:#0f766e;font-weight:700;">⏳ Currently processing: ${esc(job.current_folder)}</div>` : ''}
          <div style="margin-top:0.4rem;color:#134e4a;">
            <strong>Totals:</strong> ${Number(job.total_photos_received || 0)} photos processed • <strong>${Number(job.total_created_skus || 0)} verified OEM SKUs created</strong> • ${Number(job.total_angles_merged || 0)} duplicate angles merged • ${Number(job.total_sold_blocked || 0)} sold blocked • ${Number(job.total_srs_blocked || 0)} SRS blocked
            ${job.shopify_sync_result ? ` • <strong>Shopify Sync:</strong> ${Number(job.shopify_sync_result.created || 0)} created / ${Number(job.shopify_sync_result.updated || 0)} updated` : ''}
          </div>
          ${perFolderHtml}
          ${needsVinHtml}
        </div>
      `;
    }

    if (aggState.masterBatchJob) renderMasterJobBox(aggState.masterBatchJob);

    host.querySelector('#btn-run-master-drive-batch')?.addEventListener('click', async () => {
      const inp = document.getElementById('emp-master-drive-url-input');
      const box = document.getElementById('emp-master-batch-status');
      const driveUrl = String(inp?.value || '').trim();
      const urlErr = validateClientDriveUrl(driveUrl);
      if (urlErr) {
        if (box) box.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.82rem;">${esc(urlErr)}</div>`;
        return;
      }
      aggState.masterDriveUrl = driveUrl;
      if (box) box.innerHTML = '<div class="agg-loading">🚀 Scanning parent Google Drive folder, verifying all 17-char VINs via NHTSA vPIC &amp; launching fleet batch intake...</div>';
      try {
        const r = await fetch('/api/employee/intake/batch-ai-master', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getEmployeeTokenHeader() },
          credentials: 'same-origin',
          body: JSON.stringify({ drive_url: driveUrl, async: true, push_shopify: true })
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Sign in to Employee Backend first.');
        aggState.masterBatchJob = d;
        renderMasterJobBox(d);
        if (d.status === 'running' && d.job_id) {
          const pollId = setInterval(async () => {
            try {
              const pr = await fetch(`/api/employee/intake/batch-ai-master/${encodeURIComponent(d.job_id)}`, {
                headers: { ...getEmployeeTokenHeader() },
                credentials: 'same-origin'
              });
              const pd = await pr.json();
              if (pr.ok && pd.ok) {
                aggState.masterBatchJob = pd;
                renderMasterJobBox(pd);
                if (pd.status !== 'running') {
                  clearInterval(pollId);
                  if (typeof window.loadBootstrap === 'function') window.loadBootstrap();
                }
              }
            } catch (_) {}
          }, 4000);
        }
      } catch (err) {
        if (box) box.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.82rem;">${esc(err.message)}</div>`;
      }
    });

    host.querySelector('#btn-master-shopify-sync-now')?.addEventListener('click', async () => {
      const box = document.getElementById('emp-master-batch-status');
      if (box) box.innerHTML = '<div class="agg-loading">🛍️ Pushing all verified VIN-intake SKUs live to Shopify Co-Master...</div>';
      try {
        const r = await fetch('/api/employee/shopify/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getEmployeeTokenHeader() },
          credentials: 'same-origin',
          body: JSON.stringify({ async: true })
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Shopify sync failed (sign in first).');
        if (box) box.innerHTML = `<div style="background:#ecfdf5;border:1.5px solid #22c55e;border-radius:10px;padding:0.65rem;font-size:0.82rem;color:#14532d;font-weight:700;">🛍️ Shopify Co-Master Sync started (Job ${esc(d.job_id || 'LIVE')}) — pushing all verified SKUs live to aldridgesales.myshopify.com.</div>`;
      } catch (err) {
        if (box) box.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.82rem;">${esc(err.message)}</div>`;
      }
    });

    // Live-sync Step 1 Google Drive URL straight into Step 2's Drive URL input (exact full URL preserved!)
    const step1DriveInput = host.querySelector('#emp-step1-drive-extract-input');
    const step2DriveInput = host.querySelector('#emp-step2-drive-url');
    if (step1DriveInput) {
      const mirrorDriveUrl = () => {
        const val = String(step1DriveInput.value || '').trim();
        aggState.pendingDriveUrl = val;
        if (step2DriveInput && step2DriveInput.value !== val) {
          step2DriveInput.value = val;
        }
      };
      step1DriveInput.addEventListener('input', mirrorDriveUrl);
      step1DriveInput.addEventListener('change', mirrorDriveUrl);
    }
    if (step2DriveInput) {
      step2DriveInput.addEventListener('input', () => {
        aggState.pendingDriveUrl = String(step2DriveInput.value || '').trim();
      });
    }

    // Conflict Resolution Button 1: Use True NHTSA vPIC VIN Decode
    host.querySelector('#btn-conflict-use-nhtsa-vin')?.addEventListener('click', async () => {
      const pc = aggState.pendingConflict;
      if (!pc) return;
      const out = document.getElementById('emp-step1-msg');
      out.innerHTML = '<p style="color:#9a3412;font-weight:700;">Locking NHTSA vPIC VIN Decode...</p>';
      try {
        const r = await fetch('/api/employee/intake/decode-vin-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getEmployeeTokenHeader() },
          credentials: 'same-origin',
          body: JSON.stringify({
            drive_url: pc.drive_url || aggState.pendingDriveUrl || '',
            folder_title: pc.folder_title || '',
            vin: pc.nhtsa_vehicle?.vin || pc.vin_detected || '',
            confirm_vin_decode: true,
            auto_lock: true
          })
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Could not lock NHTSA VIN decode.');
        applyVinResolveResponse(d, 'confirm_vin_decode');
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.84rem;">${esc(err.message)}</div>`;
      }
    });

    // Conflict Resolution Button 2: Keep Folder Year & Clear Wrong VIN (trust_folder_year: true)
    host.querySelector('#btn-conflict-trust-folder-year')?.addEventListener('click', async () => {
      const pc = aggState.pendingConflict;
      if (!pc) return;
      const fv = pc.folder_vehicle || pc.vin_label_conflict?.folder_vehicle || {};
      const out = document.getElementById('emp-step1-msg');
      out.innerHTML = '<p style="color:#9a3412;font-weight:700;">Locking Folder Year/Make/Model &amp; clearing conflicting VIN for title-check...</p>';
      try {
        const r = await fetch('/api/employee/intake/decode-vin-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getEmployeeTokenHeader() },
          credentials: 'same-origin',
          body: JSON.stringify({
            drive_url: pc.drive_url || aggState.pendingDriveUrl || '',
            folder_title: pc.folder_title || '',
            folder_year: fv.year || '',
            folder_make: fv.make || '',
            folder_model: fv.model || '',
            trust_folder_year: true,
            auto_lock: true
          })
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Could not apply folder-year override.');
        applyVinResolveResponse(d, 'folder_year_override_title_check');
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.84rem;">${esc(err.message)}</div>`;
      }
    });

    // Step 1A: Scan VIN Sticker Photo/Video or .ZIP via unified /api/employee/intake/decode-vin-media
    host.querySelector('#emp-step1-vin-media-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const out = document.getElementById('emp-step1-msg');
      out.innerHTML = '<p style="color:#9a3412;font-weight:700;">🔍 Extracting 17-char VIN from media/filename &amp; decoding via NHTSA vPIC...</p>';
      try {
        const fd = new FormData();
        fd.append('files', file, file.name);
        fd.append('auto_lock', 'true');
        const r = await fetch('/api/employee/intake/decode-vin-media', {
          method: 'POST',
          headers: { ...getEmployeeTokenHeader() },
          credentials: 'same-origin',
          body: fd
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Could not extract VIN from media.');
        applyVinResolveResponse(d, 'media_ocr');
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.84rem;">${esc(err.message)}</div>`;
      }
    });

    // Step 1A: Extract VIN from Google Drive folder link via unified /api/employee/intake/decode-vin-media
    host.querySelector('#btn-step1-extract-drive-vin')?.addEventListener('click', async () => {
      const driveUrl = String(document.getElementById('emp-step1-drive-extract-input')?.value || '').trim();
      const out = document.getElementById('emp-step1-msg');
      const urlErr = validateClientDriveUrl(driveUrl);
      if (urlErr) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.84rem;">${esc(urlErr)}</div>`;
        return;
      }
      // Immediately mirror exact full Drive URL into Step 2!
      aggState.pendingDriveUrl = driveUrl;
      const s2 = document.getElementById('emp-step2-drive-url');
      if (s2) s2.value = driveUrl;

      out.innerHTML = '<p style="color:#9a3412;font-weight:700;">☁️ Reading Drive folder title &amp; decoding VIN via NHTSA vPIC...</p>';
      try {
        const r = await fetch('/api/employee/intake/decode-vin-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getEmployeeTokenHeader() },
          credentials: 'same-origin',
          body: JSON.stringify({ drive_url: driveUrl, auto_lock: true })
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Could not extract VIN from Google Drive folder.');
        applyVinResolveResponse(d, 'folder_name_auto_extract');
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.84rem;">${esc(err.message)}</div>`;
      }
    });

    // Step 1B: Manual 17-Char VIN or License Plate Lock
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
        aggState.pendingConflict = null;
        aggState.activeVinSession = d.session;
        aggState.autoBinPrefix = d.auto_bin_prefix || computeClientAutoBin(d.session);
        aggState.vinLabelConflict = null;
        aggState.vinSource = body.vin ? 'manual_vin_entry' : 'license_plate_lookup';
        if (typeof d.gemini_vision_configured === 'boolean') aggState.geminiVisionConfigured = d.gemini_vision_configured;
        aggState.queuedFiles = [];
        aggState.lastBatchResult = null;
        renderEmployeeVinIntakeGate();
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.84rem;">${esc(err.message)}</div>`;
      }
    });

    host.querySelector('#emp-step2-camera-input')?.addEventListener('change', (e) => {
      enqueueFiles(e.target.files);
      e.target.value = '';
    });

    host.querySelector('#emp-step2-files-input')?.addEventListener('change', (e) => {
      enqueueFiles(e.target.files);
      e.target.value = '';
    });

    const dz = host.querySelector('#emp-ai-dropzone');
    if (dz && locked) {
      dz.addEventListener('dragover', (e) => {
        e.preventDefault();
        dz.classList.add('drag-over');
      });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        dz.classList.remove('drag-over');
        if (e.dataTransfer?.files?.length) enqueueFiles(e.dataTransfer.files);
      });
    }

    host.querySelector('#emp-step2-batch-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!aggState.activeVinSession) return;
      const formEl = e.target;
      const driveUrl = String(formEl.querySelector('[name="drive_url"]')?.value || '').trim();
      const out = document.getElementById('emp-step2-msg');
      if (!aggState.queuedFiles.length && !driveUrl) {
        out.innerHTML = '<div style="color:#b91c1c;font-weight:700;font-size:0.84rem;">Attach at least 1 photo/video, drop a .zip archive, or paste a Google Drive link first.</div>';
        return;
      }
      if (driveUrl) {
        const driveErr = validateClientDriveUrl(driveUrl);
        if (driveErr) {
          out.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.84rem;">${esc(driveErr)}</div>`;
          return;
        }
      }

      const fd = new FormData();
      fd.append('session_code', aggState.activeVinSession.session_code);
      fd.append('bin_location', String(formEl.querySelector('[name="bin_location"]')?.value || autoBin).trim());
      fd.append('grouping_mode', String(formEl.querySelector('[name="grouping_mode"]')?.value || 'auto'));
      fd.append('push_shopify', String(formEl.querySelector('[name="push_shopify"]')?.value || 'true'));
      if (driveUrl) fd.append('drive_url', driveUrl);
      for (const f of aggState.queuedFiles) {
        fd.append('files', f, f.name);
      }

      const btn = document.getElementById('emp-step2-submit-btn');
      if (btn) btn.disabled = true;
      out.innerHTML = '<div class="agg-loading">⚡ Extracting video keyframes, unpacking ZIP/Drive assets, merging ALD-XXXXXX &amp; multi-angle galleries, filtering Sold Orders (#1006–#1038) &amp; SRS/seatbelt items, running AI Vision + taxonomy &amp; pushing live...</div>';
      try {
        const r = await fetch('/api/employee/intake/batch-ai', {
          method: 'POST',
          headers: { ...getEmployeeTokenHeader() },
          credentials: 'same-origin',
          body: fd
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'AI Batch Intake failed.');
        aggState.lastBatchResult = d;
        aggState.queuedFiles = [];
        aggState.pendingDriveUrl = '';
        renderQueuedFiles();
        formEl.querySelector('[name="drive_url"]').value = '';
        out.innerHTML = `<div style="background:#ecfdf5;border:1.5px solid #22c55e;border-radius:10px;padding:0.65rem;font-size:0.84rem;color:#14532d;font-weight:700;">
          ✓ Created ${d.created_count} verified OEM SKU${d.created_count === 1 ? '' : 's'} from ${d.total_photos_received} photo/frame${d.total_photos_received === 1 ? '' : 's'} (${d.duplicate_angles_merged} angles merged • ${d.blocked_sold_count || 0} sold blocked • ${d.blocked_srs_count || 0} SRS blocked).
        </div>`;
        renderBatchSummary(d);
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;font-size:0.84rem;">${esc(err.message)}</div>`;
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  async function refreshGeminiVisionHealth() {
    try {
      const r = await fetch('/api/health');
      if (r.ok) {
        const h = await r.json();
        aggState.geminiVisionConfigured = Boolean(h.gemini_vision_configured);
        renderEmployeeVinIntakeGate();
      }
    } catch (_) {}
  }

  function initV26() {
    renderHeroVinAggregator();
    renderEmployeeVinIntakeGate();
    refreshGeminiVisionHealth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initV26);
  } else {
    initV26();
  }
})();
