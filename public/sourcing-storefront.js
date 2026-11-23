/**
 * Aldridge Auto's v22 Storefront Experience:
 * 1. Interactive Step-by-Step Vehicle Selector (1. Year -> 2. Make -> 3. Model -> 4. Part System)
 *    + Quick-Tap Vehicle Pills + Clean 12-per-page Pagination
 * 2. Zero-Jargon 2-Button Part Cards ("Add to Cart" + "Book Installed at Shop")
 * 3. "If We Don't Have It, We Can Get It" 50%-Markup Instant Part Finder & Quote Modal
 * 4. "Not Sure What You Need?" Guided Symptom Helper Popup
 * 5. Instant-Bookable Shop Services & Bay Menu (FREE $0 CEL Scan, $89.99 DVI, $174.99/hr 1-8hr Bay, $149/mo Storage, Packages)
 * 6. Employee CRM Part Sourcing Queue inside Tab 5 CRM
 */
(function () {
  'use strict';

  const PAGE_SIZE = 12;
  const v22State = {
    year: '',
    make: '',
    model: '',
    system: '',
    quickPill: 'all',
    page: 1,
    services: [],
    playbooks: [],
    laborRate: 174.99
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

  function getActiveCatalog() {
    const inv = (window.state && window.state.data && Array.isArray(window.state.data.inventory))
      ? window.state.data.inventory
      : [];
    return inv.filter((i) => i && i.status === 'active' && Number(i.quantity || 0) > 0);
  }

  function expandItemYears(item) {
    const raw = String(item.fitment_years || item.title || '');
    const m = raw.match(/\b(19\d{2}|20\d{2})\s*[-–]\s*(19\d{2}|20\d{2})\b/);
    if (m) {
      const a = Math.min(Number(m[1]), Number(m[2]));
      const b = Math.max(Number(m[1]), Number(m[2]));
      const yrs = [];
      for (let y = a; y <= b; y++) yrs.push(y);
      return yrs;
    }
    const single = raw.match(/\b(19\d{2}|20\d{2})\b/);
    return single ? [Number(single[1])] : [];
  }

  function normalizeModelLabel(item) {
    const raw = String(item.fitment_model || '').trim();
    if (!raw) return '';
    if (/^500\b/i.test(raw)) return '500';
    if (/^s-?10\b/i.test(raw)) return 'S10';
    if (/traverse/i.test(raw)) return 'Traverse / Acadia';
    return raw;
  }

  function resolvePartSystem(item) {
    const hay = `${item.title || ''} ${item.category || ''}`.toLowerCase();
    if (/\b(transmission|differential|axle|driveshaft|shifter|clutch|intake\s*manifold|timing|water\s*pump|fuel\s*rail|fuel\s*injection)\b/.test(hay)) return 'Engine & Drivetrain';
    if (/\b(brake|abs|strut|shock|fox\s*2\.0|suspension\s*arm|control\s*arm|coil\s*spring)\b/.test(hay)) return 'Brakes & Suspension';
    if (/\b(ecm|ecu|pcm|bcm|module|computer|fuse|relay|cluster|speedometer|radio|stereo|switch|sensor|immobilizer|keyless|blue&me)\b/.test(hay)) return 'Electrical & Modules';
    if (/\b(seat|console|door\s*trim|dashboard|dash\s*bezel|glove\s*box|air\s*vent|bolster|overhead|spare\s*tire\s*cover|owner'?s\s*manual|shroud)\b/.test(hay)) return 'Interior & Seats';
    if (/\b(door\s*shell|complete\s*door|rear\s*passenger\s*door|fender|grille|mirror|roof\s*rack|roof\s*rail|hood|fuel.*filler|hubcap|wheel\s*cover|heat\s*shield)\b/.test(hay)) return 'Body, Doors & Trim';
    if (/\b(radiator|coolant|cooling\s*fan|hvac|climate\s*control|a\/c|heater)\b/.test(hay)) return 'Cooling & HVAC';
    if (/\b(window|wiper|washer\s*fluid)\b/.test(hay)) return 'Glass & Wipers';
    if (/\b(headlight|headlamp|parking|side\s*marker|turn\s*signal\s*light|tail\s*light)\b/.test(hay)) return 'Lighting';
    return 'OEM Assemblies';
  }

  function computeCleanInstallPrice(item) {
    const base = Number(item.price_we_pull || 0);
    const hrs = Number(item.install_labor_hours || 0);
    const rate = Number(window.state?.data?.settings?.labor_rate_hourly || v22State.laborRate || 174.99);
    if (hrs <= 0) return Number(item.price_pull_install || base);
    return Number((base + hrs * rate).toFixed(2));
  }

  function getActiveMemberObj() {
    try {
      const raw = localStorage.getItem('aldridge_member_profile_v1') || localStorage.getItem('aldridge_active_member');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  /* ==================== 1. ZERO-JARGON 2-BUTTON PART CARD ==================== */
  function renderCleanZeroJargonCard(item) {
    const photos = (item.photos && item.photos.length) ? item.photos : ['/assets/oem-parts.jpg'];
    const basePrice = Number(item.price_we_pull || 0);
    const installPrice = computeCleanInstallPrice(item);
    const isHeavy = item.shipping_class === 'local_pickup_only' || Number(item.weight_lbs || 0) >= 70;
    const fitmentLine = [item.fitment_years, item.fitment_make, item.fitment_model].filter(Boolean).join(' ').trim() || 'Verified OEM Fitment';
    const mpn = String(item.oem_part_number || '').trim();
    const member = getActiveMemberObj();
    let displayBuyPrice = basePrice;
    let memberRibbon = '';
    if (member && Number(member.parts_discount_pct || 0) > 0) {
      const pct = (member.tier_key === 'b2b_dealer_pro' && basePrice >= 250) ? 25 : Number(member.parts_discount_pct);
      displayBuyPrice = Number((basePrice * (1 - pct / 100)).toFixed(2));
      memberRibbon = `<div class="member-blur-strip unlocked" onclick="window.openMembershipModal && window.openMembershipModal()" role="button" tabindex="0"><span>🔓 ${esc(member.tier_short_name || 'Member')} (-${pct}%)</span><span class="member-blur-nums">${money(displayBuyPrice)}</span></div>`;
    } else {
      const vipPrice = Number((basePrice * 0.85).toFixed(2));
      const proPct = basePrice >= 250 ? 25 : 20;
      const proPrice = Number((basePrice * (1 - proPct / 100)).toFixed(2));
      memberRibbon = `<div class="member-blur-strip" onclick="window.openMembershipModal && window.openMembershipModal('vip_driver_pass')" role="button" tabindex="0"><span>🔒 Member Pricing:</span><span class="member-blur-nums">VIP ${money(vipPrice)} • Pro ${money(proPrice)}</span><span class="member-unlock-cta">Unlock 10s</span></div>`;
    }

    const buySubtext = isHeavy ? 'Free Counter Pickup • University Place 98467' : 'Ships Fast or Free 98467 Counter Pickup';
    const hasInstall = Number(item.install_labor_hours || 0) > 0;

    return `
      <article class="clean-part-card" data-sku="${esc(item.sku)}">
        <div class="clean-part-media" style="cursor:pointer;" onclick="window.openPublicProductModal && window.openPublicProductModal(${Number(item.id)})" title="Click to inspect full OEM specs &amp; multi-angle photos">
          <img src="${esc(photos[0])}" alt="${esc(item.title)}" loading="lazy" />
          <span class="clean-part-badge ${isHeavy ? 'pickup-badge' : ''}">${isHeavy ? '📍 Ready at 98467 Shop' : '✓ In Stock • Ready Today'}</span>
          ${photos.length > 1 ? `<span class="clean-part-photo-pill">📷 ${photos.length} Photos</span>` : ''}
        </div>
        <div class="clean-part-body">
          <div class="clean-part-fitment">Fits ${esc(fitmentLine)}</div>
          <h3 class="clean-part-title pdm-clickable-title" onclick="window.openPublicProductModal && window.openPublicProductModal(${Number(item.id)})">${esc(item.title)}</h3>
          ${mpn ? `<span class="clean-part-mpn">OEM # ${esc(mpn)}</span>` : ''}
          ${memberRibbon}
          <div class="clean-part-actions">
            <button type="button" class="btn-specs-clean" onclick="window.openPublicProductModal && window.openPublicProductModal(${Number(item.id)})">
              🔍 View Full Specs &amp; Photos
            </button>
            <button type="button" class="btn-buy-clean" onclick="window.selectPartAndBuy && window.selectPartAndBuy(${Number(item.id)}, false)">
              <span>Add to Cart — ${money(displayBuyPrice)}</span>
              <small>${buySubtext}</small>
            </button>
            ${hasInstall ? `
              <button type="button" class="btn-install-clean" onclick="window.selectPartAndBuy && window.selectPartAndBuy(${Number(item.id)}, true)">
                <span>Book Installed at Shop — ${money(installPrice)}</span>
                <small>Part + 5.0★ Certified Bay Install</small>
              </button>
            ` : ''}
          </div>
        </div>
      </article>
    `;
  }

  /* ==================== 2. INTERACTIVE VEHICLE SELECTOR + QUICK PILLS + 12/PAGE PAGINATION ==================== */
  const QUICK_PILLS = [
    { key: 'all', label: 'All Verified Parts' },
    { key: 'toyota_4runner', label: 'Toyota 4Runner', make: 'Toyota', model: '4Runner' },
    { key: 'fiat_500', label: 'Fiat 500', make: 'Fiat', model: '500' },
    { key: 'subaru_outback', label: 'Subaru Outback', make: 'Subaru', model: 'Outback' },
    { key: 'subaru_forester', label: 'Subaru Forester', make: 'Subaru', model: 'Forester' },
    { key: 'chevy_s10', label: 'Chevy S10', make: 'Chevrolet', model: 'S10' },
    { key: 'toyota_camry', label: 'Toyota Camry', make: 'Toyota', model: 'Camry' },
    { key: 'toyota_trucks', label: 'Tacoma / Tundra', make: 'Toyota', models: ['Tacoma', 'Tundra'] },
    { key: 'other_makes', label: 'Ford / Honda / Kia', makes: ['Ford', 'Honda', 'Kia'] }
  ];

  function matchesVehicleFilters(item, { ignoreYear, ignoreMake, ignoreModel, ignoreSystem } = {}) {
    if (!ignoreYear && v22State.year) {
      const yrs = expandItemYears(item);
      if (!yrs.includes(Number(v22State.year))) return false;
    }
    if (!ignoreMake && v22State.make) {
      if (String(item.fitment_make || '').toLowerCase() !== v22State.make.toLowerCase()) return false;
    }
    if (!ignoreModel && v22State.model) {
      if (normalizeModelLabel(item).toLowerCase() !== v22State.model.toLowerCase()) return false;
    }
    if (!ignoreSystem && v22State.system) {
      if (resolvePartSystem(item) !== v22State.system) return false;
    }
    if (v22State.quickPill && v22State.quickPill !== 'all') {
      const pill = QUICK_PILLS.find((p) => p.key === v22State.quickPill);
      if (pill) {
        if (pill.make && String(item.fitment_make || '').toLowerCase() !== pill.make.toLowerCase()) return false;
        if (pill.model && normalizeModelLabel(item).toLowerCase() !== pill.model.toLowerCase()) return false;
        if (pill.models && !pill.models.some((m) => normalizeModelLabel(item).toLowerCase().includes(m.toLowerCase()))) return false;
        if (pill.makes && !pill.makes.some((mk) => String(item.fitment_make || '').toLowerCase() === mk.toLowerCase())) return false;
      }
    }
    return true;
  }

  function renderVehicleSelectorBar() {
    const host = document.getElementById('vehicle-selector-bar');
    if (!host) return;
    const all = getActiveCatalog();
    if (!all.length) return;

    // Cascading options
    const yearsSet = new Set();
    for (const it of all) {
      for (const y of expandItemYears(it)) yearsSet.add(y);
    }
    const years = Array.from(yearsSet).sort((a, b) => b - a);

    const makePool = all.filter((it) => !v22State.year || expandItemYears(it).includes(Number(v22State.year)));
    const makes = Array.from(new Set(makePool.map((i) => String(i.fitment_make || '').trim()).filter(Boolean))).sort();

    const modelPool = makePool.filter((it) => !v22State.make || String(it.fitment_make || '').toLowerCase() === v22State.make.toLowerCase());
    const models = Array.from(new Set(modelPool.map(normalizeModelLabel).filter(Boolean))).sort();

    const sysPool = modelPool.filter((it) => !v22State.model || normalizeModelLabel(it).toLowerCase() === v22State.model.toLowerCase());
    const systems = Array.from(new Set(sysPool.map(resolvePartSystem))).sort();

    host.innerHTML = `
      <div class="vehicle-selector-card">
        <div class="vehicle-selector-head">
          <h3>Step-by-Step Vehicle Selector</h3>
          <span style="font-size:0.82rem;color:#6c5945;font-weight:700;">Pick your car to see ONLY parts that fit — zero clutter</span>
        </div>
        <div class="vehicle-steps-grid">
          <div class="vehicle-step-box">
            <label class="vehicle-step-label" for="vs-year">1. Year</label>
            <select id="vs-year" class="select">
              <option value="">Any Year</option>
              ${years.map((y) => `<option value="${y}" ${String(v22State.year) === String(y) ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
          </div>
          <div class="vehicle-step-box">
            <label class="vehicle-step-label" for="vs-make">2. Make</label>
            <select id="vs-make" class="select">
              <option value="">Any Make</option>
              ${makes.map((m) => `<option value="${esc(m)}" ${v22State.make === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
            </select>
          </div>
          <div class="vehicle-step-box">
            <label class="vehicle-step-label" for="vs-model">3. Model</label>
            <select id="vs-model" class="select">
              <option value="">Any Model</option>
              ${models.map((m) => `<option value="${esc(m)}" ${v22State.model === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
            </select>
          </div>
          <div class="vehicle-step-box">
            <label class="vehicle-step-label" for="vs-system">4. Part System</label>
            <select id="vs-system" class="select">
              <option value="">All Systems</option>
              ${systems.map((s) => `<option value="${esc(s)}" ${v22State.system === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="vehicle-quick-pills" role="group" aria-label="Quick Vehicle Filters">
          ${QUICK_PILLS.map((p) => `
            <button type="button" class="vehicle-pill ${v22State.quickPill === p.key ? 'active' : ''}" data-qpill="${esc(p.key)}">${esc(p.label)}</button>
          `).join('')}
        </div>
      </div>
    `;

    host.querySelector('#vs-year')?.addEventListener('change', (e) => {
      v22State.year = e.target.value;
      v22State.quickPill = 'all';
      v22State.page = 1;
      renderVehicleSelectorBar();
      renderDeclutteredCatalog();
    });
    host.querySelector('#vs-make')?.addEventListener('change', (e) => {
      v22State.make = e.target.value;
      v22State.model = '';
      v22State.quickPill = 'all';
      v22State.page = 1;
      renderVehicleSelectorBar();
      renderDeclutteredCatalog();
    });
    host.querySelector('#vs-model')?.addEventListener('change', (e) => {
      v22State.model = e.target.value;
      v22State.quickPill = 'all';
      v22State.page = 1;
      renderVehicleSelectorBar();
      renderDeclutteredCatalog();
    });
    host.querySelector('#vs-system')?.addEventListener('change', (e) => {
      v22State.system = e.target.value;
      v22State.page = 1;
      renderDeclutteredCatalog();
    });
    host.querySelectorAll('[data-qpill]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-qpill');
        v22State.quickPill = key;
        v22State.year = '';
        v22State.make = '';
        v22State.model = '';
        v22State.system = '';
        v22State.page = 1;
        renderVehicleSelectorBar();
        renderDeclutteredCatalog();
      });
    });
  }

  function renderDeclutteredCatalog() {
    const grid = document.getElementById('catalog-parts-grid');
    if (!grid) return;

    const search = String(document.getElementById('parts-search-input')?.value || '').trim().toLowerCase();
    const catFilter = String(document.getElementById('parts-category-filter')?.value || '').trim();
    const modeFilter = String(document.getElementById('parts-mode-filter')?.value || '').trim();

    const filtered = getActiveCatalog().filter((item) => {
      if (!matchesVehicleFilters(item)) return false;
      if (catFilter && item.category !== catFilter) return false;
      if (modeFilter === 'parcel' && (item.shipping_class === 'local_pickup_only' || Number(item.weight_lbs || 0) >= 70)) return false;
      if (modeFilter === 'freight' && !(item.shipping_class === 'local_pickup_only' || Number(item.weight_lbs || 0) >= 70)) return false;
      if (search) {
        const hay = `${item.title} ${item.sku} ${item.oem_part_number || ''} ${item.fitment_years || ''} ${item.fitment_make || ''} ${item.fitment_model || ''} ${item.category || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (v22State.page > totalPages) v22State.page = totalPages;
    const startIdx = (v22State.page - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

    const metaEl = document.getElementById('catalog-results-meta');
    if (metaEl) {
      const showingText = total > 0
        ? `Showing ${startIdx + 1}–${Math.min(total, startIdx + PAGE_SIZE)} of ${total} verified OEM parts`
        : '0 matching parts currently on our shelf';
      metaEl.innerHTML = `
        <span>${showingText}</span>
        <span>Don't see your part? <button type="button" class="btn btn-outline btn-sm" style="margin-left:6px;" onclick="window.openPartSourcingModal && window.openPartSourcingModal()">We Can Get It (Instant Quote)</button></span>
      `;
    }

    if (pageItems.length === 0) {
      grid.innerHTML = `
        <div class="zero-results-sourcing-box">
          <h3>We don't have that exact part on our shelf — but we can get it fast!</h3>
          <p style="color:#5c4b39;max-width:560px;margin:0 auto 1rem;">
            Tell us what you need and our University Place shop will source it through our commercial wholesale network at a transparent <strong>+50% retail markup</strong> (or bundle it with 5.0★ bay installation).
          </p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button type="button" class="btn btn-primary" onclick="window.openPartSourcingModal({ part_query: ${JSON.stringify(search || v22State.system || '')}, vehicle_year: ${JSON.stringify(v22State.year)}, vehicle_make: ${JSON.stringify(v22State.make)}, vehicle_model: ${JSON.stringify(v22State.model)} })">Get Instant 50%-Markup Quote</button>
            <button type="button" class="btn btn-outline" onclick="document.getElementById('btn-reset-filters')?.click()">Show All Parts</button>
          </div>
        </div>
      `;
    } else {
      grid.innerHTML = pageItems.map(renderCleanZeroJargonCard).join('');
    }

    // Pagination bar (12 parts per page)
    const pagEl = document.getElementById('catalog-pagination-bar');
    if (pagEl) {
      if (totalPages <= 1) {
        pagEl.innerHTML = '';
      } else {
        let btns = `<button type="button" class="page-btn" data-pg="${v22State.page - 1}" ${v22State.page <= 1 ? 'disabled' : ''}>← Prev</button>`;
        for (let p = 1; p <= totalPages; p++) {
          btns += `<button type="button" class="page-btn ${p === v22State.page ? 'active' : ''}" data-pg="${p}">${p}</button>`;
        }
        btns += `<button type="button" class="page-btn" data-pg="${v22State.page + 1}" ${v22State.page >= totalPages ? 'disabled' : ''}>Next →</button>`;
        pagEl.innerHTML = btns;
        pagEl.querySelectorAll('[data-pg]').forEach((b) => {
          b.addEventListener('click', () => {
            const next = Number(b.getAttribute('data-pg'));
            if (next >= 1 && next <= totalPages) {
              v22State.page = next;
              renderDeclutteredCatalog();
              document.getElementById('vehicle-selector-bar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          });
        });
      }
    }

    // Keep Home "Fresh Off the Shelf" crisp & balanced across 6 distinct donor vehicles (never 6 consecutive Fiat 500s!)
    const homeFeatured = document.getElementById('home-featured-parts');
    if (homeFeatured) {
      const catalog = getActiveCatalog();
      const top6 = typeof window.pickBalancedVehicleShowcase === 'function'
        ? window.pickBalancedVehicleShowcase(catalog, 6)
        : catalog.slice(0, 6);
      if (top6.length) homeFeatured.innerHTML = top6.map(renderCleanZeroJargonCard).join('');
    }
  }

  /* ==================== 3. SHOP SERVICES & BAY MENU + SOURCING BANNER ==================== */
  function renderSourcingBanner() {
    const host = document.getElementById('home-sourcing-banner');
    if (!host) return;
    host.innerHTML = `
      <div class="sourcing-hero-banner">
        <div>
          <div style="font-size:0.74rem;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#fdba74;">COMMERCIAL WHOLESALE NETWORK • UNIVERSITY PLACE 98467</div>
          <h3>If We Don't Have It, We Can Get It — Instant Part Finder</h3>
          <p>Looking for an alternator, brake kit, engine, transmission, or module not currently on our shelf? Get an instant quote priced at our honest <strong>+50% over wholesale</strong> — counter pickup or installed in our 5.0★ bays.</p>
        </div>
        <div style="display:flex;gap:0.65rem;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" onclick="window.openPartSourcingModal && window.openPartSourcingModal()">Instant Part Finder Quote</button>
          <button type="button" class="btn btn-outline" style="background:rgba(255,255,255,0.1);color:#fff;border-color:rgba(255,255,255,0.35);" onclick="window.openGuidedHelperModal && window.openGuidedHelperModal()">Not Sure What You Need?</button>
        </div>
      </div>
    `;
  }

  function buildServiceMenuHtml(services) {
    return `
      <section class="services-menu-section" id="shop-services-menu">
        <div class="services-menu-header">
          <div>
            <div class="eyebrow-label" style="margin-bottom:0;">INSTANT BOOKABLE BAY MENU • 5115 66TH ST W, BLDG B • UNIVERSITY PLACE, WA 98467</div>
            <h2>Shop Services &amp; Certified Bay Menu</h2>
            <p style="margin:0;color:#5c4b39;font-size:0.9rem;">Clear menu pricing with zero guesswork — book your bay slot or storage spot online in seconds.</p>
          </div>
          <button type="button" class="btn btn-dark btn-sm" onclick="window.openGuidedHelperModal && window.openGuidedHelperModal()">Not Sure Which Service? Ask Our Helper</button>
        </div>
        <div class="services-menu-grid">
          ${services.map((svc) => {
            const isFree = Number(svc.price_usd) === 0;
            const isHourly = svc.billing_type === 'hourly_block';
            return `
              <div class="service-menu-card ${svc.highlight ? 'featured-svc' : ''}" data-svc-card="${esc(svc.id)}">
                <span class="service-badge ${isFree ? 'free-badge' : ''}">${esc(svc.badge)}</span>
                <div class="service-price-row">
                  <span class="service-price-big ${isFree ? 'free-price' : ''}" data-svc-price="${esc(svc.id)}">${esc(svc.price_label)}</span>
                  <span style="font-size:0.76rem;color:#6c5945;font-weight:700;">${esc(svc.duration_label)}</span>
                </div>
                <h3 style="margin:0;font-size:1rem;color:#1f1711;line-height:1.3;">${esc(svc.name)}</h3>
                <p style="margin:0;font-size:0.84rem;color:#5c4b39;line-height:1.45;">${esc(svc.summary)}</p>
                <ul class="service-includes">
                  ${(svc.includes || []).map((inc) => `<li>${esc(inc)}</li>`).join('')}
                </ul>
                ${isHourly ? `
                  <div class="hourly-picker-row">
                    <label for="hrs-${esc(svc.id)}">Bay Hours (1–8 hrs):</label>
                    <select id="hrs-${esc(svc.id)}" class="select" style="width:auto;padding:0.28rem 0.55rem;" onchange="window.updateHourlyServicePrice('${esc(svc.id)}', this.value)">
                      ${[1, 2, 3, 4, 5, 6, 7, 8].map((h) => `<option value="${h}">${h} hr${h > 1 ? 's' : ''} — ${money(h * svc.price_usd)}</option>`).join('')}
                    </select>
                  </div>
                ` : ''}
                <button type="button" class="btn ${isFree ? 'btn-primary' : 'btn-dark'}" style="width:100%;margin-top:auto;" onclick="window.openServiceBookingModal('${esc(svc.id)}')">
                  ${esc(svc.cta_label)}
                </button>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }

  window.updateHourlyServicePrice = function (svcId, hrs) {
    const svc = v22State.services.find((s) => s.id === svcId);
    if (!svc) return;
    const el = document.querySelector(`[data-svc-price="${svcId}"]`);
    if (el) el.textContent = `${money(Number(hrs || 1) * svc.price_usd)}`;
  };

  async function loadAndRenderShopServices() {
    try {
      const r = await fetch('/api/services/catalog');
      const d = await r.json();
      if (d && d.ok && Array.isArray(d.services)) {
        v22State.services = d.services;
        v22State.playbooks = d.symptom_playbooks || [];
        v22State.laborRate = Number(d.labor_rate_hourly || 174.99);
        const html = buildServiceMenuHtml(d.services);
        const h1 = document.getElementById('home-shop-services-menu');
        const h2 = document.getElementById('repair-shop-services-menu');
        if (h1) h1.innerHTML = html;
        if (h2) h2.innerHTML = html;
      }
    } catch (_) {}
  }

  /* ==================== 4. MODAL SHELL HELPER ==================== */
  function openCustomModal(id, innerHtml) {
    document.getElementById(id)?.remove();
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.className = 'modal-backdrop';
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(20,14,9,0.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto;';
    wrap.innerHTML = `
      <div style="background:#fffdf9;border:1.5px solid #e2d2ba;border-radius:18px;max-width:660px;width:100%;max-height:92vh;overflow-y:auto;padding:1.35rem 1.45rem;box-shadow:0 24px 60px rgba(0,0,0,0.32);position:relative;">
        <button type="button" aria-label="Close" onclick="document.getElementById('${id}')?.remove()" style="position:absolute;top:12px;right:14px;background:#f4ece0;border:1px solid #dfd0b8;border-radius:999px;width:32px;height:32px;font-weight:800;cursor:pointer;">✕</button>
        ${innerHtml}
      </div>
    `;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
  }

  /* ==================== 5. "IF WE DON'T HAVE IT, WE CAN GET IT" 50%-MARKUP SOURCING MODAL ==================== */
  window.openPartSourcingModal = function (prefill = {}) {
    openCustomModal('part-sourcing-modal', `
      <div class="eyebrow-label" style="margin-bottom:0.25rem;">IF WE DON'T HAVE IT, WE CAN GET IT • +50% OVER WHOLESALE</div>
      <h2 style="margin:0 0 0.35rem;font-family:'Fraunces',Georgia,serif;color:#1f1711;">Instant Part Finder &amp; Shop Quote</h2>
      <p style="margin:0 0 1rem;font-size:0.88rem;color:#5c4b39;">Tell us your car and what you need. We check our live shelf AND commercial wholesale network (priced transparently at +50% markup) plus optional 5.0★ bay installation.</p>
      <form id="part-sourcing-form">
        <div class="grid-2" style="gap:0.65rem;">
          <div class="form-group"><label>Your Name *</label><input class="input" name="customer_name" required placeholder="Alex Rivera" /></div>
          <div class="form-group"><label>Mobile Phone (SMS Quote) *</label><input class="input" name="phone" required placeholder="(253) 555-0148" /></div>
        </div>
        <div class="grid-2" style="gap:0.65rem;">
          <div class="form-group"><label>Email</label><input class="input" type="email" name="email" placeholder="alex@email.com" /></div>
          <div class="form-group"><label>VIN (Optional — Fastest Fitment Match)</label><input class="input" name="vehicle_vin" placeholder="17-digit VIN" maxlength="17" /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1.2fr 1.2fr;gap:0.55rem;">
          <div class="form-group"><label>Year</label><input class="input" name="vehicle_year" value="${esc(prefill.vehicle_year || v22State.year || '')}" placeholder="2015" /></div>
          <div class="form-group"><label>Make</label><input class="input" name="vehicle_make" value="${esc(prefill.vehicle_make || v22State.make || '')}" placeholder="Toyota" /></div>
          <div class="form-group"><label>Model</label><input class="input" name="vehicle_model" value="${esc(prefill.vehicle_model || v22State.model || '')}" placeholder="4Runner" /></div>
        </div>
        <div class="form-group">
          <label>What part do you need, or what's happening with your car? *</label>
          <textarea class="input" name="part_query" rows="3" required placeholder="Example: Alternator, front brake pads & rotors, driver side headlight, or 'car squeals when braking'">${esc(prefill.part_query || '')}</textarea>
        </div>
        <div id="part-sourcing-result" style="margin:0.75rem 0;"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Get My Instant Quote</button>
      </form>
    `);

    document.getElementById('part-sourcing-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      const out = document.getElementById('part-sourcing-result');
      out.innerHTML = '<p style="color:#9a3412;font-weight:700;">Checking shelf & commercial wholesale network...</p>';
      try {
        const r = await fetch('/api/parts-sourcing/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Could not calculate quote');
        const q = d.quote;
        const inStockHtml = (d.in_stock_matches || []).length
          ? `<div style="margin-top:0.65rem;padding:0.6rem;background:#ecfdf5;border:1px solid #86efac;border-radius:10px;font-size:0.83rem;">
              <strong>Good news — similar verified OEM parts already in stock today:</strong>
              <ul style="margin:0.35rem 0 0;padding-left:1.1rem;">
                ${d.in_stock_matches.map((m) => `<li><strong>${esc(m.title)}</strong> — ${money(m.price_we_pull)} <button type="button" class="btn btn-outline btn-sm" style="margin-left:6px;padding:2px 8px;" onclick="document.getElementById('part-sourcing-modal')?.remove(); window.openPartDetail && window.openPartDetail('${esc(m.sku)}')">View</button></li>`).join('')}
              </ul>
            </div>`
          : '';
        out.innerHTML = `
          <div style="background:#fff7ed;border:1.5px solid #fb923c;border-radius:12px;padding:0.9rem;">
            <div style="font-size:0.75rem;font-weight:800;color:#9a3412;text-transform:uppercase;">Quote Confirmed • Ref ${esc(q.request_code)}</div>
            <h4 style="margin:0.2rem 0 0.45rem;color:#1f1711;">${esc(q.part_label)}</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-bottom:0.65rem;">
              <div style="background:#fff;border:1px solid #e5d5bc;border-radius:10px;padding:0.6rem;">
                <div style="font-size:0.73rem;color:#6c5945;font-weight:700;">SOURCED PART ONLY (+50% Markup)</div>
                <div style="font-size:1.3rem;font-weight:800;color:#1f1711;">${money(q.retail_price_usd)}</div>
                <div style="font-size:0.74rem;color:#5c4b39;">${esc(q.eta_label)}</div>
              </div>
              <div style="background:#fff;border:1px solid #fdba74;border-radius:10px;padding:0.6rem;">
                <div style="font-size:0.73rem;color:#9a3412;font-weight:700;">TURNKEY INSTALLED AT SHOP</div>
                <div style="font-size:1.3rem;font-weight:800;color:#9a3412;">${money(q.installed_total_usd)}</div>
                <div style="font-size:0.74rem;color:#5c4b39;">Includes ~${q.estimated_labor_hours} hr @ ${money(q.labor_rate_hourly)}/hr + tax</div>
              </div>
            </div>
            <p style="margin:0 0 0.6rem;font-size:0.82rem;color:#4f4032;">Our parts desk at <strong>5115 66th St W, Bldg B</strong> has your request (${esc(q.request_code)}) and will verify exact VIN fitment & text you confirmation.</p>
            <button type="button" class="btn btn-dark btn-sm" onclick="document.getElementById('part-sourcing-modal')?.remove(); window.openServiceBookingModal('svc-hourly-bay')">Reserve Certified Bay Slot Now</button>
            ${inStockHtml}
          </div>
        `;
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;">${esc(err.message)}</div>`;
      }
    });
  };

  /* ==================== 6. "NOT SURE WHAT YOU NEED?" GUIDED HELPER POPUP ==================== */
  window.openGuidedHelperModal = function () {
    let selectedSymptom = 'check_engine';
    openCustomModal('guided-helper-modal', `
      <div class="eyebrow-label" style="margin-bottom:0.25rem;">PLAIN-ENGLISH MECHANIC HELPER • ZERO JARGON</div>
      <h2 style="margin:0 0 0.35rem;font-family:'Fraunces',Georgia,serif;color:#1f1711;">Not Sure What You Need? Tell Us What Your Car Is Doing</h2>
      <p style="margin:0 0 0.85rem;font-size:0.88rem;color:#5c4b39;">Tap what sounds closest and we will point you to the exact right fix — never guess or buy the wrong part.</p>
      <div class="symptom-tile-grid" id="guided-symptom-tiles">
        <button type="button" class="symptom-tile active" data-sym="check_engine">🟡 Check Engine Light On</button>
        <button type="button" class="symptom-tile" data-sym="noises_brakes">🔊 Noises / Shaking / Brakes</button>
        <button type="button" class="symptom-tile" data-sym="wont_start_electrical">⚡ Won't Start / Electrical</button>
        <button type="button" class="symptom-tile" data-sym="overheating_leaks">🌡️ Overheating / Leaks</button>
        <button type="button" class="symptom-tile" data-sym="need_part_sourced">🔎 Need a Specific Part</button>
      </div>
      <form id="guided-helper-form">
        <div class="grid-2" style="gap:0.65rem;">
          <div class="form-group"><label>Your Name *</label><input class="input" name="customer_name" required placeholder="Alex Rivera" /></div>
          <div class="form-group"><label>Phone (for text recommendation) *</label><input class="input" name="phone" required placeholder="(253) 555-0148" /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1.2fr 1.2fr;gap:0.55rem;">
          <div class="form-group"><label>Year</label><input class="input" name="vehicle_year" placeholder="2012" /></div>
          <div class="form-group"><label>Make</label><input class="input" name="vehicle_make" placeholder="Toyota" /></div>
          <div class="form-group"><label>Model</label><input class="input" name="vehicle_model" placeholder="4Runner" /></div>
        </div>
        <div class="form-group">
          <label>Describe what you hear, feel, or see (plain English is best!)</label>
          <textarea class="input" name="symptom_text" rows="2" placeholder="Example: Steering wheel shakes when braking on I-5, or check engine light came on yesterday"></textarea>
        </div>
        <div id="guided-helper-result" style="margin:0.75rem 0;"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Show My Recommended Next Step</button>
      </form>
    `);

    document.querySelectorAll('#guided-symptom-tiles [data-sym]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedSymptom = btn.getAttribute('data-sym');
        document.querySelectorAll('#guided-symptom-tiles [data-sym]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('guided-helper-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      body.symptom_category = selectedSymptom;
      const out = document.getElementById('guided-helper-result');
      out.innerHTML = '<p style="color:#9a3412;font-weight:700;">Matching your symptoms to our shop bays...</p>';
      try {
        const r = await fetch('/api/guided-helper/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Could not evaluate symptoms');
        const pb = d.playbook;
        const recSvc = d.recommended_service;
        out.innerHTML = `
          <div style="background:#ecfdf5;border:1.5px solid #34d399;border-radius:12px;padding:0.9rem;">
            <div style="font-size:0.74rem;font-weight:800;color:#065f46;text-transform:uppercase;">Mechanic Recommendation</div>
            <h4 style="margin:0.2rem 0 0.35rem;color:#1f1711;">${esc(pb.headline)}</h4>
            <p style="margin:0 0 0.7rem;font-size:0.85rem;color:#374151;">${esc(pb.explanation)}</p>
            <div style="display:flex;gap:0.55rem;flex-wrap:wrap;">
              ${recSvc ? `<button type="button" class="btn btn-primary btn-sm" onclick="document.getElementById('guided-helper-modal')?.remove(); window.openServiceBookingModal('${esc(recSvc.id)}')">${esc(recSvc.cta_label)}</button>` : ''}
              ${d.sourcing_quote ? `<button type="button" class="btn btn-dark btn-sm" onclick="document.getElementById('guided-helper-modal')?.remove(); window.openPartSourcingModal({ part_query: ${JSON.stringify(body.symptom_text || '')}, vehicle_year: ${JSON.stringify(body.vehicle_year || '')}, vehicle_make: ${JSON.stringify(body.vehicle_make || '')}, vehicle_model: ${JSON.stringify(body.vehicle_model || '')} })">Sourced Part Est: ${money(d.sourcing_quote.retail_price_usd)}</button>` : ''}
            </div>
          </div>
        `;
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;">${esc(err.message)}</div>`;
      }
    });
  };

  /* ==================== 7. INSTANT SHOP SERVICE BOOKING MODAL ==================== */
  window.openServiceBookingModal = function (serviceId) {
    const svc = v22State.services.find((s) => s.id === serviceId);
    if (!svc) return;
    const pickedHours = svc.billing_type === 'hourly_block'
      ? Number(document.getElementById(`hrs-${svc.id}`)?.value || svc.default_hours || 1)
      : 1;
    const totalUsd = svc.billing_type === 'hourly_block' ? pickedHours * svc.price_usd : svc.price_usd;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    openCustomModal('service-booking-modal', `
      <div class="eyebrow-label" style="margin-bottom:0.25rem;">INSTANT BAY RESERVATION • 5115 66TH ST W, BLDG B • 98467</div>
      <h2 style="margin:0 0 0.25rem;font-family:'Fraunces',Georgia,serif;color:#1f1711;">${esc(svc.name)}</h2>
      <p style="margin:0 0 0.9rem;font-size:0.9rem;color:#9a3412;font-weight:800;">
        ${svc.billing_type === 'hourly_block' ? `${money(totalUsd)} (${pickedHours} hr @ $174.99/hr)` : esc(svc.price_label)} • ${esc(svc.duration_label)}
      </p>
      <form id="service-booking-form">
        ${svc.billing_type === 'hourly_block' ? `
          <div class="form-group">
            <label>Select Bay Time Block (1–8 hrs @ $174.99/hr)</label>
            <select name="hours" class="select">
              ${[1, 2, 3, 4, 5, 6, 7, 8].map((h) => `<option value="${h}" ${h === pickedHours ? 'selected' : ''}>${h} Hour${h > 1 ? 's' : ''} — ${money(h * svc.price_usd)}</option>`).join('')}
            </select>
          </div>
        ` : ''}
        <div class="grid-2" style="gap:0.65rem;">
          <div class="form-group"><label>Full Name *</label><input class="input" name="customer_name" required placeholder="Alex Rivera" /></div>
          <div class="form-group"><label>Mobile Phone (SMS Confirmation) *</label><input class="input" name="phone" required placeholder="(253) 555-0148" /></div>
        </div>
        <div class="grid-2" style="gap:0.65rem;">
          <div class="form-group"><label>Email</label><input class="input" type="email" name="email" placeholder="alex@email.com" /></div>
          <div class="form-group"><label>Vehicle (Year Make Model)</label><input class="input" name="vehicle_ymm" placeholder="2012 Toyota 4Runner" /></div>
        </div>
        <div class="grid-2" style="gap:0.65rem;">
          <div class="form-group"><label>Preferred Date</label><input class="input" type="date" name="preferred_date" value="${tomorrow}" /></div>
          <div class="form-group">
            <label>Preferred Time</label>
            <select class="select" name="preferred_time">
              <option>08:30 AM</option><option selected>09:00 AM</option><option>10:30 AM</option>
              <option>01:00 PM</option><option>02:30 PM</option><option>04:00 PM</option>
            </select>
          </div>
        </div>
        <div class="form-group"><label>Notes (Optional)</label><input class="input" name="notes" placeholder="Any noises, codes, or RV/trailer length for storage..." /></div>
        <div id="service-booking-result" style="margin:0.75rem 0;"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Confirm Instant Reservation</button>
      </form>
    `);

    document.getElementById('service-booking-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      body.service_id = svc.id;
      const out = document.getElementById('service-booking-result');
      out.innerHTML = '<p style="color:#9a3412;font-weight:700;">Confirming your bay reservation...</p>';
      try {
        const r = await fetch('/api/services/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error || 'Could not confirm booking');
        if (d.stripe_checkout_url) {
          window.location.href = d.stripe_checkout_url;
          return;
        }
        out.innerHTML = `
          <div style="background:#ecfdf5;border:1.5px solid #22c55e;border-radius:12px;padding:0.9rem;">
            <div style="font-size:0.75rem;font-weight:800;color:#166534;text-transform:uppercase;">Confirmed • Booking Code ${esc(d.booking_code)}</div>
            <h4 style="margin:0.2rem 0 0.35rem;color:#1f1711;">${esc(d.service.name)} — ${esc(d.service.price_label)}</h4>
            <p style="margin:0;font-size:0.84rem;color:#374151;">
              Scheduled for <strong>${esc(d.appointment.preferred_date)} at ${esc(d.appointment.preferred_time)}</strong><br/>
              📍 ${esc(d.appointment.location)}
            </p>
          </div>
        `;
      } catch (err) {
        out.innerHTML = `<div style="color:#b91c1c;font-weight:700;">${esc(err.message)}</div>`;
      }
    });
  };

  /* ==================== 8. WIRE CLEAN OVERRIDES & RESET HOOKS ==================== */
  function overrideRenderHooks() {
    window.renderPartCard = renderCleanZeroJargonCard;
    window.renderCatalog = renderDeclutteredCatalog;
    window.renderCatalogFiltered = renderDeclutteredCatalog;
    window.renderPartsCards = function (items, containerId) {
      if (containerId === 'catalog-parts-grid') {
        renderDeclutteredCatalog();
        return;
      }
      const el = document.getElementById(containerId);
      if (!el) return;
      const list = Array.isArray(items) ? items : [];
      if (!list.length) {
        el.innerHTML = '';
        return;
      }
      el.innerHTML = list.map(renderCleanZeroJargonCard).join('');
    };
  }

  function initV22Storefront() {
    overrideRenderHooks();
    renderSourcingBanner();
    loadAndRenderShopServices();

    // Wire search/filter/reset inputs cleanly to reset to page 1
    ['parts-search-input', 'parts-category-filter', 'parts-mode-filter'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', () => {
        v22State.page = 1;
        renderDeclutteredCatalog();
      });
      document.getElementById(id)?.addEventListener('change', () => {
        v22State.page = 1;
        renderDeclutteredCatalog();
      });
    });

    document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
      v22State.year = '';
      v22State.make = '';
      v22State.model = '';
      v22State.system = '';
      v22State.quickPill = 'all';
      v22State.page = 1;
      const si = document.getElementById('parts-search-input');
      const cf = document.getElementById('parts-category-filter');
      const mf = document.getElementById('parts-mode-filter');
      if (si) si.value = '';
      if (cf) cf.value = '';
      if (mf) mf.value = '';
      renderVehicleSelectorBar();
      renderDeclutteredCatalog();
    });

    // Wait briefly for app.js bootstrap inventory, re-assert clean hooks, and render selector + paginated grid
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      if (getActiveCatalog().length > 0 || attempts > 35) {
        clearInterval(poll);
        overrideRenderHooks();
        renderVehicleSelectorBar();
        renderDeclutteredCatalog();
      }
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initV22Storefront);
  } else {
    initV22Storefront();
  }
})();
