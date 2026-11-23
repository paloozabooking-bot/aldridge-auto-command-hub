/* ==================== WARM RESTAURANT-MENU STOREFRONT, 3-TIER MEMBERSHIPS, ABANDONED CART & STRICT EMPLOYEE AUTH ==================== */
(function () {
  const MEMBER_STORAGE_KEY = 'aldridge_active_member_v1';
  const CART_TOKEN_KEY = 'aldridge_cart_token_v1';

  const menuState = {
    tiers: [],
    member: null,
    employeeSession: { authenticated: false, staff_name: '', role: '', checked: false },
    pendingStaffTab: null,
    activeModalTab: 'join',
    selectedTierKey: 'vip_driver_pass',
    counterDiscountMember: null
  };

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getOrCreateCartToken() {
    let tok = localStorage.getItem(CART_TOKEN_KEY);
    if (!tok) {
      tok = 'CART-' + Math.random().toString(36).slice(2, 10).toUpperCase() + Date.now().toString(36).toUpperCase();
      localStorage.setItem(CART_TOKEN_KEY, tok);
    }
    return tok;
  }

  function loadSavedMember() {
    try {
      const raw = localStorage.getItem(MEMBER_STORAGE_KEY);
      if (raw) menuState.member = JSON.parse(raw);
    } catch (_) {
      menuState.member = null;
    }
  }

  function saveActiveMember(member) {
    menuState.member = member || null;
    if (member) {
      localStorage.setItem(MEMBER_STORAGE_KEY, JSON.stringify(member));
    } else {
      localStorage.removeItem(MEMBER_STORAGE_KEY);
    }
    renderMemberHeaderBar();
    rerenderStorefrontMenus();
  }

  function getEffectiveDiscountMember() {
    return menuState.counterDiscountMember || menuState.member || null;
  }

  function computeTierPrices(partPrice) {
    const retail = Number(partPrice || 0);
    const vip = Number((retail * 0.85).toFixed(2));
    const b2bPct = retail >= 250 ? 25 : 20;
    const b2b = Number((retail * (1 - b2bPct / 100)).toFixed(2));
    return { retail, vip, b2b, b2bPct };
  }

  function computeActiveMemberPrice(partPrice) {
    const m = getEffectiveDiscountMember();
    const retail = Number(partPrice || 0);
    if (!m || m.status === 'canceled' || m.status === 'unenrolled') {
      return { unlocked: false, price: retail, pct: 0, label: '' };
    }
    if (m.tier_key === 'b2b_dealer_pro') {
      const pct = retail >= 250 ? 25 : 20;
      return { unlocked: true, price: Number((retail * (1 - pct / 100)).toFixed(2)), pct, label: `Shop Pro (-${pct}%)` };
    }
    if (m.tier_key === 'vip_driver_pass') {
      return { unlocked: true, price: Number((retail * 0.85).toFixed(2)), pct: 15, label: 'VIP Pass (-15%)' };
    }
    return { unlocked: true, price: retail, pct: 0, label: 'Garage Club (10% 1st Bay Labor)' };
  }

  function toast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
  }

  /* ==================== 1. SHOP SPECIALS & HIGH-MARGIN ASSEMBLIES HERO MENU BAR ==================== */
  const CHEF_SPECIAL_SKUS = [
    'ALD-OH-032',
    'ALD-04TOY-AC-CONDENSER-P0762',
    'ALD-04TOY-DRIVE-AXLE-P0528',
    'ALD-OH-004'
  ];

  function pickChefSpecialItems() {
    const inv = (window.state?.data?.inventory || []).filter((i) => i && i.status === 'active' && Number(i.quantity || 0) > 0 && Array.isArray(i.photos) && i.photos.length > 0);
    if (typeof window.pickBalancedVehicleShowcase === 'function') {
      return window.pickBalancedVehicleShowcase(inv, 4, { sortByPrice: true });
    }
    const picked = [];
    const seenVehicles = new Set();
    const sorted = [...inv].sort((a, b) => Number(b.price_we_pull || 0) - Number(a.price_we_pull || 0));
    for (const item of sorted) {
      if (picked.length >= 4) break;
      const vKey = `${String(item.fitment_make || '').toUpperCase()}|${String(item.fitment_model || '').toUpperCase()}`;
      if (seenVehicles.has(vKey)) continue;
      seenVehicles.add(vKey);
      picked.push(item);
    }
    return picked;
  }

  function renderChefSpecialsMenu() {
    const hosts = [
      document.getElementById('home-chef-specials-menu'),
      document.getElementById('catalog-chef-specials-menu')
    ].filter(Boolean);
    if (!hosts.length) return;

    const specials = pickChefSpecialItems();
    const laborRate = Number(window.state?.data?.settings?.labor_rate_hourly || 174.99);
    const activeMem = getEffectiveDiscountMember();
    const isUnlocked = Boolean(activeMem && ['vip_driver_pass', 'b2b_dealer_pro'].includes(activeMem.tier_key));

    const cardsHtml = specials.map((item) => {
      const img = item.photos?.[0] || '/assets/oem-parts.jpg';
      const partPrice = Number(item.price_we_pull || 0);
      const hours = Number(item.install_labor_hours || 2.0);
      const installCombo = Number(item.price_pull_install || 0) > partPrice
        ? Number(item.price_pull_install)
        : Number((partPrice + hours * laborRate).toFixed(2));
      const { vip, b2b, b2bPct } = computeTierPrices(partPrice);

      return `
        <article class="chef-special-card">
          <div class="chef-special-media" style="cursor:pointer;" onclick="window.openPublicProductModal && window.openPublicProductModal(${Number(item.id)})" title="Click to view full OEM specs &amp; multi-angle photos">
            <img src="${esc(img)}" alt="${esc(item.title)}" loading="lazy" />
            <span class="chef-ribbon">Featured Tested Assembly • Ready for Bay Install</span>
            <span class="chef-stock-pill">Only 1 on Shelf</span>
          </div>
          <div class="chef-special-body">
            <div class="chef-special-sku mono">${esc(item.sku)} • ${esc(item.fitment_years || '')} ${esc(item.fitment_make || '')} ${esc(item.fitment_model || '')}</div>
            <h4 class="pdm-clickable-title" onclick="window.openPublicProductModal && window.openPublicProductModal(${Number(item.id)})">${esc(item.title)}</h4>
            <div class="chef-dual-row">
              <div class="chef-opt">
                <span class="chef-opt-lbl">Option A • Carry-Out</span>
                <strong class="chef-opt-price">$${partPrice.toFixed(2)}</strong>
              </div>
              <div class="chef-opt chef-opt-combo">
                <span class="chef-opt-lbl">Option B • House Special Installed</span>
                <strong class="chef-opt-price">$${installCombo.toFixed(2)}</strong>
              </div>
            </div>
            <div class="member-blur-strip ${isUnlocked ? 'unlocked' : ''}" onclick="window.openMembershipModal('vip_driver_pass')">
              <span>${isUnlocked ? '🔓 Member Unlocked:' : '🔒 Member Pricing:'}</span>
              <span class="member-blur-nums">VIP $${vip.toFixed(2)} • Shop Pro $${b2b.toFixed(2)} (-${b2bPct}%)</span>
              ${isUnlocked ? '' : '<span class="member-unlock-cta">Unlock →</span>'}
            </div>
            <div class="chef-cta-row" style="flex-wrap:wrap;">
              <button type="button" class="btn-specs-clean" style="flex:1 1 100%;" onclick="window.openPublicProductModal && window.openPublicProductModal(${Number(item.id)})">
                🔍 View Full Specs &amp; Photos
              </button>
              <button type="button" class="btn btn-primary btn-sm" style="flex:1;" onclick="selectPartAndBuy(${item.id}, true)">
                Book Installed at Shop
              </button>
              <button type="button" class="btn btn-outline btn-sm" onclick="selectPartAndBuy(${item.id}, false)">
                Add to Cart
              </button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    const html = `
      <div class="chef-menu-board">
        <div class="chef-menu-head">
          <div>
            <div class="chef-eyebrow">ALDRIDGE AUTO'S HOUSE BOARD • 5115 66TH ST W, BLDG B • UNIVERSITY PLACE, WA 98467</div>
            <h3>Shop Specials &amp; High-Margin Tested Assemblies</h3>
            <p>Inspected on our own bench by our 5.0★ mechanics — carry out today or pair with certified <strong>$${laborRate.toFixed(2)}/hr</strong> House Special bay installation &amp; warranty.</p>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
            <button type="button" class="btn btn-primary btn-sm" onclick="window.openMembershipModal('vip_driver_pass')">🔓 Unlock 15%–25% Member Pricing</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="switchCustomerView('view-parts')">View Full Parts Menu →</button>
          </div>
        </div>
        <div class="chef-specials-grid">${cardsHtml}</div>
      </div>
    `;
    hosts.forEach((h) => { h.innerHTML = html; });
  }

  function renderMemberHeaderBar() {
    const bar = document.getElementById('member-club-banner');
    if (!bar) return;
    const m = getEffectiveDiscountMember();
    if (m && m.status !== 'unenrolled') {
      const tierBadge = m.tier_key === 'b2b_dealer_pro'
        ? 'B2B Partner Shop / Dealer Pro (20–25% Off Parts)'
        : (m.tier_key === 'vip_driver_pass'
          ? 'VIP Driver / Fleet Pass (15% Off Parts + 10% Off Bay Labor)'
          : 'Garage Club Basic (My Garage Saved + 10% Off 1st Bay Labor)');
      bar.innerHTML = `
        <div class="member-banner-inner unlocked">
          <div>
            <strong>🔓 Welcome back, ${esc(m.full_name)}!</strong>
            <span>Active Tier: <strong>${esc(tierBadge)}</strong> • Member ID: <code>${esc(m.member_code)}</code>${m.vehicle_make ? ` • Garage: ${esc([m.vehicle_year, m.vehicle_make, m.vehicle_model].filter(Boolean).join(' '))}` : ''}</span>
          </div>
          <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
            ${m.tier_key === 'garage_club_basic' ? '<button type="button" class="btn btn-primary btn-sm" onclick="window.openMembershipModal(\'vip_driver_pass\')">Upgrade to VIP (-15% Parts)</button>' : ''}
            <button type="button" class="btn btn-outline btn-sm" onclick="window.signOutMemberAccount()">Sign Out</button>
          </div>
        </div>
      `;
    } else {
      bar.innerHTML = `
        <div class="member-banner-inner">
          <div>
            <strong>★ 5.0 Google Rated (87 Reviews) • Plain-English Neighborhood Shop Guarantee</strong>
            <span>Public prices stay 100% transparent — join <strong>Garage Club ($0/mo)</strong>, <strong>VIP Driver ($19.99/mo • 15% Off Parts)</strong>, or <strong>Shop Pro ($79/mo • 20–25% Wholesale)</strong> in 10 seconds.</span>
          </div>
          <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
            <button type="button" class="btn btn-primary btn-sm" onclick="window.openMembershipModal('vip_driver_pass')">🔓 Unlock Member Pricing (10s)</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="window.openMembershipModal('garage_club_basic', 'lookup')">Member Sign In</button>
          </div>
        </div>
      `;
    }
  }

  /* ==================== 2. TWO-OPTION "CARRY-OUT VS. HOUSE SPECIAL COMBO" PART CARDS ==================== */
  function renderRestaurantMenuPartsCards(items, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!items.length) {
      container.innerHTML = `<div class="surface-card" style="grid-column:1/-1;text-align:center;">
        <h3 style="margin:0 0 0.4rem;">No Matching In-Stock Parts Found</h3>
        <p style="margin:0;color:var(--text-secondary);">Try clearing filters or call our University Place counter at (253) 245-4206 to check newly arrived donor vehicles.</p>
      </div>`;
      return;
    }

    const limit = containerId === 'catalog-parts-grid' && !window.state?.showAllCatalog ? 48 : items.length;
    const visibleItems = items.slice(0, limit);
    const handlingFee = Number(window.state?.data?.settings?.handling_fee_default ?? 10).toFixed(2);
    const laborRate = Number(window.state?.data?.settings?.labor_rate_hourly || 174.99);
    const activeMem = getEffectiveDiscountMember();
    const isPaidUnlocked = Boolean(activeMem && ['vip_driver_pass', 'b2b_dealer_pro'].includes(activeMem.tier_key));

    const cardsHtml = visibleItems.map((item) => {
      const img = item.photos?.[0] || '/assets/oem-parts.jpg';
      const photoCount = item.photos?.length || 1;
      const isLocalPickupOnly = Number(item.weight_lbs || 0) >= 70 || item.shipping_class !== 'parcel_calculated';
      const partPrice = Number(item.price_we_pull || 0);
      const hours = Number(item.install_labor_hours || 1.2);
      const installEst = Number(item.price_pull_install || 0) > partPrice
        ? Number(item.price_pull_install)
        : Number((partPrice + hours * laborRate).toFixed(2));
      const { vip, b2b, b2bPct } = computeTierPrices(partPrice);
      const activePriceInfo = computeActiveMemberPrice(partPrice);

      const optionASub = isLocalPickupOnly
        ? 'Free 98467 Counter Pickup (Heavy/Oversized Assembly)'
        : `+$${handlingFee} protective crating or FREE 98467 pickup`;

      return `
        <article class="part-card menu-part-card">
          <div class="part-thumb" style="cursor:pointer;" onclick="window.openPublicProductModal && window.openPublicProductModal(${Number(item.id)})" title="Click to view full OEM specs &amp; multi-angle photos">
            <img src="${esc(img)}" alt="${esc(item.title)}" loading="lazy" />
            <div class="part-badges">
              <span class="badge badge-dark">1 on Shelf • ${photoCount} Real Shop Photo${photoCount === 1 ? '' : 's'}</span>
              ${isLocalPickupOnly
                ? '<span class="badge badge-warn">Local Pickup • UP 98467</span>'
                : `<span class="badge badge-ok">Ships Parcel or Free 98467 Pickup</span>`}
            </div>
          </div>
          <div class="part-body">
            <div class="part-sku-line">
              <span>SKU: ${esc(item.sku)}</span>
              <span>${item.oem_part_number ? `OEM #${esc(item.oem_part_number)}` : 'Verified Tested OEM'}</span>
            </div>
            <h3 class="part-title pdm-clickable-title" onclick="window.openPublicProductModal && window.openPublicProductModal(${Number(item.id)})">${esc(item.title)}</h3>
            <div class="part-fitment">
              <strong>Fits:</strong> ${esc(item.fitment_years)} ${esc(item.fitment_make)} ${esc(item.fitment_model)} •
              <span class="mono" style="font-size:0.73rem;color:var(--text-muted);">${Number(item.weight_lbs || 8)} lb (${Math.ceil(Number(item.length_in || 14))}×${Math.ceil(Number(item.width_in || 10))}×${Math.ceil(Number(item.height_in || 8))} in)</span>
            </div>

            <!-- Restaurant Menu Two-Option Choice -->
            <div class="menu-choice-stack">
              <div class="menu-choice-row menu-choice-a">
                <div>
                  <div class="menu-choice-tag">OPTION A — CARRY-OUT / SHIPPED</div>
                  <div class="menu-choice-sub">${optionASub}</div>
                </div>
                <div class="menu-choice-price">
                  ${activePriceInfo.unlocked && activePriceInfo.pct > 0
                    ? `<span class="retail-strike">$${partPrice.toFixed(2)}</span><strong>$${activePriceInfo.price.toFixed(2)}</strong>`
                    : `<strong>$${partPrice.toFixed(2)}</strong>`}
                </div>
              </div>

              <div class="menu-choice-row menu-choice-b">
                <div>
                  <div class="menu-choice-tag">OPTION B — HOUSE SPECIAL (TURNKEY INSTALLED)</div>
                  <div class="menu-choice-sub">Installed at 5115 66th St W • $${laborRate.toFixed(2)}/hr (~${hours.toFixed(1)}h) + Bay Warranty</div>
                </div>
                <div class="menu-choice-price">
                  <strong>$${installEst.toFixed(2)}</strong>
                </div>
              </div>
            </div>

            <!-- Hybrid Dual-Pricing Locked/Blurred Member Badges -->
            <div class="member-blur-strip ${isPaidUnlocked ? 'unlocked' : ''}" onclick="window.openMembershipModal('vip_driver_pass')" role="button" tabindex="0">
              <span>${isPaidUnlocked ? `🔓 ${esc(activePriceInfo.label)}` : '🔒 Member &amp; Shop Pricing:'}</span>
              <span class="member-blur-nums">VIP $${vip.toFixed(2)} • Pro $${b2b.toFixed(2)} (-${b2bPct}%)</span>
              ${isPaidUnlocked ? '' : '<span class="member-unlock-cta">Unlock 10s</span>'}
            </div>

            <div class="menu-card-actions" style="flex-wrap:wrap;">
              <button type="button" class="btn-specs-clean" style="flex:1 1 100%;" onclick="window.openPublicProductModal && window.openPublicProductModal(${Number(item.id)})">
                🔍 View Full Specs &amp; Photos
              </button>
              <button type="button" class="btn btn-primary btn-sm" style="flex:1;" onclick="selectPartAndBuy(${item.id}, true)">
                Book Installed at Shop
              </button>
              <button type="button" class="btn btn-outline btn-sm" onclick="selectPartAndBuy(${item.id}, false)">
                Add to Cart ($${activePriceInfo.unlocked && activePriceInfo.pct > 0 ? activePriceInfo.price.toFixed(2) : partPrice.toFixed(2)})
              </button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    const moreBanner = items.length > visibleItems.length
      ? `<div class="surface-card" style="grid-column:1/-1;text-align:center;padding:1rem;">
          <p style="margin:0 0 0.6rem;font-size:0.86rem;color:var(--text-secondary);">
            Showing <strong>${visibleItems.length}</strong> of <strong>${items.length}</strong> verified on-hand OEM parts.
          </p>
          <button type="button" class="btn btn-dark btn-sm" onclick="showAllCatalogItems()">Show All ${items.length} Active Parts</button>
        </div>`
      : '';

    container.innerHTML = cardsHtml + moreBanner;
  }

  function rerenderStorefrontMenus() {
    renderChefSpecialsMenu();
    if (window.state?.data?.inventory) {
      const active = window.state.data.inventory.filter((i) => i && i.quantity > 0 && i.status === 'active');
      const featured6 = typeof window.pickBalancedVehicleShowcase === 'function'
        ? window.pickBalancedVehicleShowcase(active, 6)
        : active.slice(0, 6);
      renderRestaurantMenuPartsCards(featured6, 'home-featured-parts');
      if (typeof window.renderCatalogFiltered === 'function') window.renderCatalogFiltered();
    }
  }

  /* ==================== 3. 10-SECOND UNLOCK MEMBER PRICING / JOIN CLUB MODAL ==================== */
  function ensureMembershipModalDom() {
    if (document.getElementById('membership-club-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'membership-club-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog" style="max-width:740px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;margin-bottom:0.85rem;">
          <div>
            <div class="eyebrow-label" style="color:#c2410c;">ALDRIDGE AUTO'S GARAGE CLUB • INSTANT MEMBER PRICING</div>
            <h3 style="margin:0.1rem 0 0;">Unlock Member &amp; Shop Wholesale Pricing in 10 Seconds</h3>
          </div>
          <button type="button" class="btn btn-sm btn-outline" onclick="window.closeMembershipModal()">Close ✕</button>
        </div>

        <div style="display:flex;gap:0.5rem;margin-bottom:0.9rem;">
          <button type="button" class="btn btn-sm btn-primary" id="mem-tab-join" onclick="window.switchMemberModalTab('join')">Join &amp; Unlock Now</button>
          <button type="button" class="btn btn-sm btn-outline" id="mem-tab-lookup" onclick="window.switchMemberModalTab('lookup')">Already a Member? Sign In</button>
        </div>

        <div id="mem-pane-join">
          <div class="mem-tier-grid" id="mem-tier-cards">
            <label class="mem-tier-card" data-tier="garage_club_basic" onclick="window.selectMembershipTier('garage_club_basic')">
              <input type="radio" name="mem_tier_key" value="garage_club_basic" />
              <div class="mem-tier-badge">FREE ACCOUNT</div>
              <div class="mem-tier-name">Tier 1 • Garage Club Basic</div>
              <div class="mem-tier-price">$0 <span>/ mo</span></div>
              <ul>
                <li>Saves vehicles &amp; VINs in My Garage</li>
                <li>10% off first bay labor booking</li>
                <li>SMS/Email price-drop &amp; stock alerts</li>
              </ul>
            </label>
            <label class="mem-tier-card selected" data-tier="vip_driver_pass" onclick="window.selectMembershipTier('vip_driver_pass')">
              <input type="radio" name="mem_tier_key" value="vip_driver_pass" checked />
              <div class="mem-tier-badge mem-badge-hot">MOST POPULAR</div>
              <div class="mem-tier-name">Tier 2 • VIP Driver / Fleet Pass</div>
              <div class="mem-tier-price">$19.99 <span>/ mo</span></div>
              <ul>
                <li><strong>15% off ALL OEM parts</strong> immediately</li>
                <li><strong>10% off $174.99/hr</strong> bay labor</li>
                <li>Free Tacoma/UP (98467) local delivery</li>
                <li>Priority same-day bay slots + free DVI</li>
              </ul>
            </label>
            <label class="mem-tier-card" data-tier="b2b_dealer_pro" onclick="window.selectMembershipTier('b2b_dealer_pro')">
              <input type="radio" name="mem_tier_key" value="b2b_dealer_pro" />
              <div class="mem-tier-badge mem-badge-pro">WHOLESALE B2B</div>
              <div class="mem-tier-name">Tier 3 • Partner Shop / Dealer Pro</div>
              <div class="mem-tier-price">$79.00 <span>/ mo</span></div>
              <ul>
                <li><strong>20%–25% wholesale</strong> across all SKUs</li>
                <li>Instant 4-hour part hold before public</li>
                <li>Same-day Pierce County courier drop</li>
                <li>Priority commercial bay &amp; U-Haul access</li>
              </ul>
            </label>
          </div>

          <form id="membership-join-form" style="margin-top:0.9rem;">
            <div class="grid-3">
              <div class="form-group">
                <label for="mem-name">Full Name / Shop Name *</label>
                <input type="text" id="mem-name" class="input" required placeholder="Alex Rivera / Tacoma Auto" />
              </div>
              <div class="form-group">
                <label for="mem-email">Email Address *</label>
                <input type="email" id="mem-email" class="input" required placeholder="you@example.com" />
              </div>
              <div class="form-group">
                <label for="mem-phone">Mobile Phone (SMS Alerts) *</label>
                <input type="tel" id="mem-phone" class="input" required placeholder="(253) 555-0188" />
              </div>
            </div>
            <div class="grid-4" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:0.6rem;">
              <div class="form-group">
                <label for="mem-veh-year">Vehicle Year</label>
                <input type="text" id="mem-veh-year" class="input mono" placeholder="2012" />
              </div>
              <div class="form-group">
                <label for="mem-veh-make">Make</label>
                <input type="text" id="mem-veh-make" class="input" placeholder="Toyota" />
              </div>
              <div class="form-group">
                <label for="mem-veh-model">Model</label>
                <input type="text" id="mem-veh-model" class="input" placeholder="4Runner" />
              </div>
              <div class="form-group">
                <label for="mem-veh-vin">17-Digit VIN (Optional)</label>
                <input type="text" id="mem-veh-vin" class="input mono" maxlength="17" placeholder="JTEBU5JR..." />
              </div>
            </div>
            <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.8rem;margin:0.2rem 0 0.85rem;color:var(--text-secondary);">
              <input type="checkbox" id="mem-sms-optin" checked />
              Send me instant SMS/Email alerts for 1-in-stock price drops, rare donor arrivals &amp; bay install reminders.
            </label>
            <button type="submit" class="btn btn-primary" id="mem-join-submit" style="width:100%;">
              🔓 Unlock Member Pricing &amp; Join Now
            </button>
            <div id="mem-join-status" style="margin-top:0.65rem;font-size:0.83rem;"></div>
          </form>
        </div>

        <div id="mem-pane-lookup" style="display:none;">
          <form id="membership-lookup-form">
            <div class="form-group">
              <label for="mem-lookup-query">Enter Your Email, Phone Number, or Member Code (e.g. ALD-VIP-...)</label>
              <div style="display:flex;gap:0.5rem;">
                <input type="text" id="mem-lookup-query" class="input" required placeholder="email@example.com or (253) 555-0188" />
                <button type="submit" class="btn btn-primary">Unlock Pricing</button>
              </div>
            </div>
            <div id="mem-lookup-status" style="font-size:0.83rem;"></div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) window.closeMembershipModal();
    });

    document.getElementById('membership-join-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = document.getElementById('mem-join-status');
      const btn = document.getElementById('mem-join-submit');
      btn.disabled = true;
      statusEl.textContent = 'Activating membership & saving to My Garage…';
      try {
        const payload = {
          full_name: document.getElementById('mem-name').value.trim(),
          email: document.getElementById('mem-email').value.trim(),
          phone: document.getElementById('mem-phone').value.trim(),
          sms_opt_in: document.getElementById('mem-sms-optin').checked,
          vehicle_year: document.getElementById('mem-veh-year').value.trim(),
          vehicle_make: document.getElementById('mem-veh-make').value.trim(),
          vehicle_model: document.getElementById('mem-veh-model').value.trim(),
          vehicle_vin: document.getElementById('mem-veh-vin').value.trim(),
          tier_key: menuState.selectedTierKey
        };
        const resp = await fetch('/api/memberships/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || 'Signup failed');
        saveActiveMember(data.member);
        if (data.stripe_checkout_url) {
          statusEl.innerHTML = `<span style="color:#15803d;font-weight:700;">Account created (${esc(data.member.member_code)})! Redirecting to Stripe recurring billing…</span>`;
          window.location.href = data.stripe_checkout_url;
          return;
        }
        statusEl.innerHTML = `<span style="color:#15803d;font-weight:700;">✅ Unlocked ${esc(data.member.tier_name)}! Member ID: <code>${esc(data.member.member_code)}</code> — all member prices are now unblurred across the catalog.</span>`;
        toast(`Unlocked ${data.member.tier_name} (${data.member.member_code})!`);
        setTimeout(() => window.closeMembershipModal(), 1200);
      } catch (err) {
        statusEl.innerHTML = `<span style="color:#b91c1c;font-weight:700;">${esc(err.message)}</span>`;
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('membership-lookup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const statusEl = document.getElementById('mem-lookup-status');
      const query = document.getElementById('mem-lookup-query').value.trim();
      statusEl.textContent = 'Checking Garage Club account…';
      try {
        const resp = await fetch('/api/memberships/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || 'Member not found');
        saveActiveMember(data.member);
        statusEl.innerHTML = `<span style="color:#15803d;font-weight:700;">✅ Welcome back ${esc(data.member.full_name)}! ${esc(data.member.tier_name)} unlocked.</span>`;
        toast(`Member pricing unlocked for ${data.member.full_name}`);
        setTimeout(() => window.closeMembershipModal(), 900);
      } catch (err) {
        statusEl.innerHTML = `<span style="color:#b91c1c;font-weight:700;">${esc(err.message)}</span>`;
      }
    });
  }

  window.openMembershipModal = function (tierKey = 'vip_driver_pass', tab = 'join') {
    ensureMembershipModalDom();
    window.selectMembershipTier(tierKey);
    window.switchMemberModalTab(tab);
    document.getElementById('membership-club-modal').classList.add('open');
  };

  window.closeMembershipModal = function () {
    const el = document.getElementById('membership-club-modal');
    if (el) el.classList.remove('open');
  };

  window.switchMemberModalTab = function (tab) {
    menuState.activeModalTab = tab;
    const joinPane = document.getElementById('mem-pane-join');
    const lookupPane = document.getElementById('mem-pane-lookup');
    const bJoin = document.getElementById('mem-tab-join');
    const bLook = document.getElementById('mem-tab-lookup');
    if (joinPane) joinPane.style.display = tab === 'join' ? 'block' : 'none';
    if (lookupPane) lookupPane.style.display = tab === 'lookup' ? 'block' : 'none';
    if (bJoin) bJoin.className = tab === 'join' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
    if (bLook) bLook.className = tab === 'lookup' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline';
  };

  window.selectMembershipTier = function (tierKey) {
    menuState.selectedTierKey = tierKey;
    document.querySelectorAll('#mem-tier-cards .mem-tier-card').forEach((card) => {
      const match = card.dataset.tier === tierKey;
      card.classList.toggle('selected', match);
      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = match;
    });
  };

  window.signOutMemberAccount = function () {
    menuState.counterDiscountMember = null;
    saveActiveMember(null);
    toast('Signed out of Member Pricing view.');
  };

  /* ==================== 4. AUTOMATED ABANDONED CART TRACKING ==================== */
  async function trackCurrentCartSnapshot(extra = {}) {
    const cart = window.state?.cart || [];
    if (!cart.length) return;
    const m = getEffectiveDiscountMember();
    const email = extra.email || document.getElementById('chk-email')?.value?.trim() || m?.email || '';
    const phone = extra.phone || document.getElementById('chk-phone')?.value?.trim() || m?.phone || '';
    const name = extra.name || document.getElementById('chk-name')?.value?.trim() || m?.full_name || '';
    const mode = document.getElementById('chk-mode')?.value || cart[0]?.mode || 'ship_calculated';
    try {
      await fetch('/api/carts/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart_token: getOrCreateCartToken(),
          customer_name: name,
          email,
          phone,
          fulfillment_mode: mode,
          items: cart.map((c) => ({
            sku: c.sku,
            title: c.title,
            unit_price: Number(c.price_we_pull || 0),
            qty: Number(c.qty || 1)
          }))
        })
      });
    } catch (_) {}
  }

  /* ==================== 5. STRICT EMPLOYEE BACKEND AUTHENTICATION GATE ==================== */
  function ensureEmployeeAuthModalDom() {
    if (document.getElementById('employee-auth-gate-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'employee-auth-gate-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog" style="max-width:440px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <div>
            <div class="eyebrow-label" style="color:#c2410c;">AUTHORIZED SHOP STAFF ONLY</div>
            <h3 style="margin:0.1rem 0 0;">Employee Backend Sign In</h3>
          </div>
          <button type="button" class="btn btn-sm btn-outline" onclick="window.closeEmployeeAuthModal()">Cancel</button>
        </div>
        <p style="font-size:0.83rem;color:var(--text-secondary);margin:0 0 0.9rem;">
          Enter your Aldridge Auto's Staff PIN / Password to unlock Inventory, DVI Approvals, CRM Counter Lookup, Abandoned Carts, and API Settings.
        </p>
        <form id="employee-auth-login-form">
          <div class="form-group">
            <label for="emp-auth-role">Staff Role</label>
            <select id="emp-auth-role" class="select">
              <option value="Owner/Admin">Chris Aldridge — Owner / Admin</option>
              <option value="Office Manager">Maria — Office Manager</option>
              <option value="Technician">Shop Technician</option>
            </select>
          </div>
          <div class="form-group">
            <label for="emp-auth-name">Staff Name</label>
            <input type="text" id="emp-auth-name" class="input" value="Chris Aldridge" required />
          </div>
          <div class="form-group">
            <label for="emp-auth-pin">Staff PIN / Password *</label>
            <input type="password" id="emp-auth-pin" class="input mono" required autocomplete="current-password" placeholder="Enter Staff PIN / Password" />
          </div>
          <div id="emp-auth-error" style="color:#b91c1c;font-size:0.82rem;font-weight:700;margin-bottom:0.6rem;"></div>
          <button type="submit" class="btn btn-dark" style="width:100%;">🔐 Unlock Employee Backend</button>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('emp-auth-role').addEventListener('change', (e) => {
      const nameEl = document.getElementById('emp-auth-name');
      if (e.target.value === 'Owner/Admin') nameEl.value = 'Chris Aldridge';
      else if (e.target.value === 'Office Manager') nameEl.value = 'Maria';
      else nameEl.value = 'Shop Technician';
    });

    document.getElementById('employee-auth-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('emp-auth-error');
      errEl.textContent = '';
      try {
        const resp = await fetch('/api/employee/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: document.getElementById('emp-auth-role').value,
            staff_name: document.getElementById('emp-auth-name').value.trim(),
            pin: document.getElementById('emp-auth-pin').value
          })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          throw new Error(data.error || 'Authentication failed');
        }
        menuState.employeeSession = {
          authenticated: true,
          staff_name: data.staff_name,
          role: data.role,
          checked: true
        };
        document.getElementById('emp-auth-pin').value = '';
        window.closeEmployeeAuthModal();
        renderEmployeeSessionStrip();
        if (typeof window.__origActivateStaffMode === 'function') {
          window.__origActivateStaffMode(menuState.pendingStaffTab || 'staff-review');
        }
        loadEmployeeCrmFunnelPanel();
        toast(`Signed in as ${data.staff_name} (${data.role})`);
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  }

  window.openEmployeeAuthModal = function (targetTab = 'staff-review') {
    menuState.pendingStaffTab = targetTab;
    ensureEmployeeAuthModalDom();
    document.getElementById('employee-auth-gate-modal').classList.add('open');
    setTimeout(() => document.getElementById('emp-auth-pin')?.focus(), 80);
  };

  window.closeEmployeeAuthModal = function () {
    const el = document.getElementById('employee-auth-gate-modal');
    if (el) el.classList.remove('open');
  };

  window.employeeLogout = async function () {
    try { await fetch('/api/employee/auth/logout', { method: 'POST' }); } catch (_) {}
    menuState.employeeSession = { authenticated: false, staff_name: '', role: '', checked: true };
    renderEmployeeSessionStrip();
    if (typeof window.switchCustomerView === 'function') window.switchCustomerView('view-home');
    toast('Employee Backend locked & signed out.');
  };

  async function checkEmployeeSessionStatus() {
    try {
      const resp = await fetch('/api/employee/auth/status', { cache: 'no-store' });
      const data = await resp.json();
      menuState.employeeSession = {
        authenticated: Boolean(data.authenticated),
        staff_name: data.staff_name || '',
        role: data.role || '',
        checked: true
      };
    } catch (_) {
      menuState.employeeSession = { authenticated: false, staff_name: '', role: '', checked: true };
    }
    renderEmployeeSessionStrip();
    return menuState.employeeSession.authenticated;
  }

  function renderEmployeeSessionStrip() {
    const host = document.getElementById('employee-session-status-bar');
    if (!host) return;
    if (!menuState.employeeSession.authenticated) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = `
      <div class="emp-session-bar">
        <div>
          <strong>🔐 Authenticated Staff Session:</strong>
          <span>${esc(menuState.employeeSession.staff_name)} (${esc(menuState.employeeSession.role)})</span>
          <span class="emp-legend-pills">
            <span class="status-pill-green">● Verified &amp; Live</span>
            <span class="status-pill-yellow">● Needs Photo/Title Check</span>
            <span class="status-pill-red">● Quarantined / SRS</span>
          </span>
        </div>
        <button type="button" class="btn btn-outline btn-sm" onclick="window.employeeLogout()">Lock &amp; Sign Out</button>
      </div>
    `;
  }

  /* ==================== 6. EMPLOYEE COLOR-CODED STATUS + COUNTER MEMBER LOOKUP + ABANDONED CART RECOVERY ==================== */
  function upgradeStaffInventoryBadges() {
    const tbody = document.getElementById('staff-inventory-tbody');
    if (!tbody || !window.state?.data?.inventory) return;
    const inv = window.state.data.inventory;
    const verified = inv.filter((i) => i.status === 'active' && Number(i.quantity) > 0).length;
    const needsCheck = inv.filter((i) => i.status === 'pending_verification').length;
    const blocked = inv.filter((i) => i.status === 'compliance_blocked').length;

    const summaryHost = document.getElementById('staff-inventory-color-summary');
    if (summaryHost) {
      summaryHost.innerHTML = `
        <div class="emp-status-strip">
          <span class="status-pill-green">🟢 Verified &amp; Live: <strong>${verified}</strong></span>
          <span class="status-pill-yellow">🟡 Needs Photo/Title Check: <strong>${needsCheck}</strong></span>
          <span class="status-pill-red">🔴 Quarantined / SRS: <strong>${blocked}</strong></span>
        </div>
      `;
    }

    tbody.querySelectorAll('tr').forEach((tr) => {
      const skuCell = tr.querySelector('td.mono strong');
      if (!skuCell) return;
      const sku = skuCell.textContent.trim();
      const item = inv.find((i) => i.sku === sku);
      if (!item) return;
      const statusCell = tr.children[2];
      if (!statusCell) return;
      const existingCustom = statusCell.querySelector('.emp-color-badge');
      if (existingCustom) return;
      let pillHtml = '<span class="emp-color-badge status-pill-yellow">🟡 Sold / Inactive</span>';
      if (item.status === 'active' && Number(item.quantity) > 0) {
        pillHtml = '<span class="emp-color-badge status-pill-green">🟢 Verified &amp; Live</span>';
      } else if (item.status === 'pending_verification') {
        pillHtml = '<span class="emp-color-badge status-pill-yellow">🟡 Needs Photo/Title Check</span>';
      } else if (item.status === 'compliance_blocked') {
        pillHtml = '<span class="emp-color-badge status-pill-red">🔴 Quarantined / SRS</span>';
      }
      statusCell.insertAdjacentHTML('beforeend', `<div style="margin-top:4px;">${pillHtml}</div>`);
    });
  }

  async function loadEmployeeCrmFunnelPanel() {
    const host = document.getElementById('employee-crm-funnel-host');
    if (!host || !menuState.employeeSession.authenticated) return;

    try {
      const [cartsRes, memRes] = await Promise.all([
        fetch('/api/employee/abandoned-carts', { cache: 'no-store' }),
        fetch('/api/employee/memberships', { cache: 'no-store' })
      ]);
      if (cartsRes.status === 401 || memRes.status === 401) {
        menuState.employeeSession.authenticated = false;
        return;
      }
      const cartsData = await cartsRes.json();
      const memData = await memRes.json();

      const cartRows = (cartsData.carts || []).length
        ? cartsData.carts.map((c) => {
            const stBadge = c.status === 'recovered'
              ? '<span class="status-pill-green">Recovered</span>'
              : (c.status === 'combo_24h_sent'
                ? '<span class="status-pill-yellow">24h Combo Sent</span>'
                : (c.status === 'alert_15m_sent'
                  ? '<span class="status-pill-yellow">15m Urgency Sent</span>'
                  : '<span class="status-pill-red">Open Abandoned</span>'));
            return `
              <div class="crm-cart-row">
                <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;align-items:center;">
                  <strong>${esc(c.customer_name)}</strong> ${stBadge}
                  <span class="mono" style="font-size:0.78rem;"><strong>$${c.subtotal_usd.toFixed(2)}</strong> • ${esc(c.skus.join(', '))}</span>
                </div>
                <div style="font-size:0.76rem;color:var(--text-secondary);margin:3px 0;">
                  ${esc(c.phone || 'No phone')} • ${esc(c.email || 'No email')} • Push: ${c.has_push_subscription ? 'Yes' : 'Browser'}
                </div>
                <div style="display:flex;gap:0.35rem;flex-wrap:wrap;margin-top:0.35rem;">
                  <button type="button" class="btn btn-primary btn-sm" onclick="window.triggerStaffCartAction(${c.id}, 'alert_15m')">⚡ Send 15m Urgency</button>
                  <button type="button" class="btn btn-dark btn-sm" onclick="window.triggerStaffCartAction(${c.id}, 'combo_24h')">🔧 Send 24h $15-Off Combo</button>
                  <button type="button" class="btn btn-outline btn-sm" onclick="window.triggerStaffCartAction(${c.id}, 'recovered')">✓ Mark Recovered</button>
                </div>
              </div>
            `;
          }).join('')
        : '<div style="font-size:0.82rem;color:var(--text-muted);padding:0.5rem 0;">No abandoned carts tracked yet — carts appear here automatically the moment a customer adds a part to their Order Bag.</div>';

      host.innerHTML = `
        <div class="grid-2" style="margin-bottom:1.35rem;">
          <!-- Instant Counter Member Lookup -->
          <div class="surface-card" style="border-left:4px solid #15803d;">
            <div class="eyebrow-label" style="color:#15803d;">COUNTER CHECKOUT • PHONE / EMAIL / VIN DISCOUNT ENGINE</div>
            <h3 style="margin:0.15rem 0 0.45rem;">Instant Counter Member Lookup (${memData.total_members} Members • $${Number(memData.active_recurring_mrr_usd || 0).toFixed(2)}/mo MRR)</h3>
            <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.65rem;">
              Garage Club Basic: <strong>${memData.garage_club_count}</strong> • VIP Driver ($19.99/mo): <strong>${memData.vip_driver_count}</strong> • B2B Shop Pro ($79/mo): <strong>${memData.b2b_pro_count}</strong>
            </div>
            <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;">
              <input type="search" id="emp-counter-lookup-input" class="input" placeholder="Type customer phone, email, name, member code, or VIN..." onkeydown="if(event.key==='Enter'){event.preventDefault();window.runCounterMemberLookup();}" />
              <button type="button" class="btn btn-primary btn-sm" onclick="window.runCounterMemberLookup()">Lookup</button>
            </div>
            <div id="emp-counter-lookup-results" style="display:flex;flex-direction:column;gap:0.5rem;max-height:280px;overflow-y:auto;"></div>
          </div>

          <!-- Automated Abandoned Cart Recovery Queue -->
          <div class="surface-card" style="border-left:4px solid #c2410c;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
              <div>
                <div class="eyebrow-label" style="color:#c2410c;">15-MIN SINGLE-VARIANT URGENCY &amp; 24-HR $15-OFF BAY COMBO</div>
                <h3 style="margin:0.15rem 0 0.35rem;">Abandoned Cart Recovery (${cartsData.open_count} Open • $${Number(cartsData.at_risk_revenue_usd || 0).toFixed(2)} At Risk)</h3>
              </div>
              <button type="button" class="btn btn-outline btn-sm" onclick="window.reloadEmployeeFunnel()">↻ Refresh</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:0.55rem;max-height:310px;overflow-y:auto;">
              ${cartRows}
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      console.error('[EmployeeFunnel] load error:', err);
    }
  }

  window.reloadEmployeeFunnel = loadEmployeeCrmFunnelPanel;

  window.runCounterMemberLookup = async function () {
    const input = document.getElementById('emp-counter-lookup-input');
    const out = document.getElementById('emp-counter-lookup-results');
    if (!input || !out) return;
    const q = input.value.trim();
    if (!q) {
      out.innerHTML = '<div style="font-size:0.8rem;color:var(--text-muted);">Enter a phone number, email, name, or 17-digit VIN to look up member discounts.</div>';
      return;
    }
    out.innerHTML = '<div style="font-size:0.8rem;color:var(--text-muted);">Searching SQLite members &amp; CRM…</div>';
    try {
      const resp = await fetch(`/api/employee/counter-lookup?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Lookup failed');
      if (!data.matches?.length) {
        out.innerHTML = `<div style="font-size:0.82rem;color:var(--text-secondary);">No matching member or CRM customer for "${esc(q)}". <button type="button" class="btn btn-outline btn-sm" onclick="window.openMembershipModal('vip_driver_pass')">Enroll Walk-In Now</button></div>`;
        return;
      }
      out.innerHTML = data.matches.map((m) => {
        const mem = m.member;
        const badgeCls = mem.tier_key === 'b2b_dealer_pro' ? 'status-pill-green' : (mem.tier_key === 'vip_driver_pass' ? 'status-pill-yellow' : 'badge badge-dark');
        const memJson = esc(JSON.stringify(mem));
        return `
          <div class="crm-cart-row">
            <div style="display:flex;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;align-items:center;">
              <strong>${esc(mem.full_name)}</strong>
              <span class="${badgeCls}">${esc(mem.tier_name)} (${mem.parts_discount_pct}% parts / ${mem.labor_discount_pct}% labor)</span>
            </div>
            <div style="font-size:0.77rem;color:var(--text-secondary);margin:3px 0;">
              ${esc(mem.phone || 'No phone')} • ${esc(mem.email || 'No email')} • Code: <code>${esc(mem.member_code)}</code>
              ${m.vehicles ? `<br/>Vehicle: ${esc(m.vehicles)}` : ''}
            </div>
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.35rem;">
              <button type="button" class="btn btn-primary btn-sm" onclick='window.applyCounterMemberToCheckout(${memJson})'>✓ Apply Tier Discount to Counter Checkout</button>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      out.innerHTML = `<div style="color:#b91c1c;font-size:0.82rem;">${esc(err.message)}</div>`;
    }
  };

  window.applyCounterMemberToCheckout = function (memberObj) {
    menuState.counterDiscountMember = memberObj;
    saveActiveMember(memberObj);
    toast(`Counter checkout discount active: ${memberObj.full_name} — ${memberObj.tier_name}!`);
  };

  window.triggerStaffCartAction = async function (cartId, action) {
    try {
      const resp = await fetch(`/api/employee/abandoned-carts/${cartId}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Action failed');
      toast(action === 'alert_15m' ? '15-min single-variant urgency alert dispatched!' : (action === 'combo_24h' ? '24-hr $15-Off Bay Install Combo sent!' : 'Cart status updated!'));
      loadEmployeeCrmFunnelPanel();
    } catch (err) {
      toast(err.message);
    }
  };

  /* ==================== BOOTSTRAP & HOOKS ==================== */
  document.addEventListener('DOMContentLoaded', async () => {
    loadSavedMember();
    renderMemberHeaderBar();

    // Override renderPartsCards with our Warm Restaurant-Menu Two-Option Card Renderer
    window.renderPartsCards = renderRestaurantMenuPartsCards;

    // Wrap renderAll so Chef's Specials + color-coded employee badges refresh automatically
    if (typeof window.renderAll === 'function') {
      const origRenderAll = window.renderAll;
      window.renderAll = function () {
        origRenderAll.apply(this, arguments);
        renderMemberHeaderBar();
        renderChefSpecialsMenu();
        upgradeStaffInventoryBadges();
      };
    }

    if (typeof window.renderStaffInventory === 'function') {
      const origStaffInv = window.renderStaffInventory;
      window.renderStaffInventory = function () {
        origStaffInv.apply(this, arguments);
        upgradeStaffInventoryBadges();
      };
    }

    // Wrap selectPartAndBuy to track abandoned carts immediately
    if (typeof window.selectPartAndBuy === 'function') {
      const origBuy = window.selectPartAndBuy;
      window.selectPartAndBuy = function () {
        const res = origBuy.apply(this, arguments);
        trackCurrentCartSnapshot();
        return res;
      };
    }

    // Track abandoned cart when customer types email/phone in checkout modal
    ['chk-email', 'chk-phone', 'chk-name'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('blur', () => trackCurrentCartSnapshot());
    });

    // Strict Employee Backend Auth Gate on activateStaffMode()
    if (typeof window.activateStaffMode === 'function') {
      window.__origActivateStaffMode = window.activateStaffMode;
      window.activateStaffMode = async function (staffTabId = 'staff-review') {
        const authed = menuState.employeeSession.checked
          ? menuState.employeeSession.authenticated
          : await checkEmployeeSessionStatus();
        if (!authed) {
          window.openEmployeeAuthModal(staffTabId);
          return;
        }
        window.__origActivateStaffMode(staffTabId);
        renderEmployeeSessionStrip();
        upgradeStaffInventoryBadges();
        if (staffTabId === 'staff-crm') loadEmployeeCrmFunnelPanel();
      };
    }

    // Refresh CRM funnel when Tab 5 is clicked
    const crmTabBtn = document.getElementById('tab-btn-crm');
    if (crmTabBtn) {
      crmTabBtn.addEventListener('click', () => loadEmployeeCrmFunnelPanel());
    }

    // Check auth status on load; if user landed directly on /review while unauthenticated, lock #view-staff & show PIN gate!
    const authed = await checkEmployeeSessionStatus();
    if (!authed && document.getElementById('view-staff')?.classList.contains('active')) {
      if (typeof window.switchCustomerView === 'function') window.switchCustomerView('view-home');
      window.openEmployeeAuthModal('staff-review');
    } else if (authed) {
      loadEmployeeCrmFunnelPanel();
    }

    // Initial render if bootstrap data already loaded
    if (window.state?.data) {
      rerenderStorefrontMenus();
      upgradeStaffInventoryBadges();
    }
  });
})();
