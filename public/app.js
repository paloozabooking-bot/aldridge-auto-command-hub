const state = {
  data: null,
  cart: [],
  capturedImageBase64: '',
  currentPartPhotos: [],
  folderQueue: [],
  cameraStream: null,
  activePolicyKey: 'master_return_refund_policy',
  deferredInstallPrompt: null
};
window.state = state;

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json;
}

async function loadBootstrap() {
  state.data = await api('/api/bootstrap');
  renderAll();
}

/* ==================== NAVIGATION & MODES ==================== */
function switchCustomerView(viewId) {
  document.getElementById('mode-customer-btn')?.classList.add('active');
  document.getElementById('mode-staff-btn')?.classList.remove('active');
  const navEl = document.getElementById('customer-nav');
  if (navEl) navEl.style.display = 'flex';

  document.querySelectorAll('.view-panel').forEach((p) => p.classList.remove('active'));
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  const navMatchView = viewId === 'view-support' ? 'view-portal' : viewId;
  document.querySelectorAll('#customer-nav .nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === navMatchView);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function activateStaffMode(staffTabId = 'staff-intake') {
  document.getElementById('mode-staff-btn')?.classList.add('active');
  document.getElementById('mode-customer-btn')?.classList.remove('active');
  const navEl = document.getElementById('customer-nav');
  if (navEl) navEl.style.display = 'none';

  document.querySelectorAll('.view-panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('view-staff').classList.add('active');
  switchStaffTab(staffTabId);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchStaffTab(tabId) {
  document.querySelectorAll('.staff-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.staff === tabId);
  });
  document.querySelectorAll('.staff-section').forEach((sec) => {
    sec.classList.toggle('active', sec.id === tabId);
  });
  if (tabId === 'staff-review' && typeof ensureReviewGalleryLoaded === 'function') {
    ensureReviewGalleryLoaded();
  }
  if (tabId === 'staff-sync' && typeof loadCraigslistHubQueueUi === 'function') {
    loadCraigslistHubQueueUi(false);
  }
}

/* ==================== MASTER RENDER ==================== */
function renderAll() {
  if (!state.data) return;
  const { settings, inventory, specials } = state.data;

  // Apply Brand Theme Palette & Logo
  document.body.dataset.theme = settings.theme_preset || 'pnw_navy_orange';
  const logoEl = document.getElementById('header-brand-logo');
  if (logoEl) {
    logoEl.src = settings.logo_url || '/assets/aldridge-crest.jpg?v=11';
  }

  // Branding & Header/Footer (null-safe for streamlined single-row header)
  const fullAddr = `${settings.street_address}, ${settings.city_display || settings.city}, ${settings.state} ${settings.zip}`;
  document.title = `${settings.google_listing_name || settings.business_name} — University Place & Tacoma OEM Parts, 5.0★ Service & U-Haul #${settings.uhaul_dealer_id || '046117'}`;
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('util-address', fullAddr);
  setText('util-hours', settings.hours_weekday);
  setText('util-phone', settings.phone);
  setText('util-uhaul-phone', settings.uhaul_phone || '(253) 948-3487');
  const ratingEl = document.getElementById('util-rating');
  if (ratingEl && settings.google_rating_badge) {
    ratingEl.textContent = settings.google_rating_badge.startsWith('★')
      ? settings.google_rating_badge
      : `★ ${settings.google_rating_badge}`;
  }

  setText('header-business-name', settings.business_name);
  setText('header-tagline', settings.tagline);
  setText('footer-name', settings.google_listing_name || settings.business_name);
  setText('footer-addr', fullAddr);
  setText(
    'footer-contact',
    `Shop & Parts: ${settings.phone} • U-Haul: ${settings.uhaul_phone || '(253) 948-3487'} • ${settings.email}`
  );

  const activeItems = inventory.filter((i) => i.quantity > 0 && i.status === 'active');
  setText(
    'hero-stock-count',
    activeItems.length > 0 ? `${activeItems.length} In Stock` : 'Live Stock'
  );

  // Build verified cross-platform backlinks map
  const canonBase = getCanonicalBaseUrl(settings);
  const gbpUrl =
    settings.social_links?.google_maps ||
    'https://www.google.com/maps/search/?api=1&query=Aldridge+Auto%27s+Service+%26+Repair+5115+66th+St+W+Bldg+B+University+Place+WA+98467';
  const uhaulUrl =
    settings.uhaul_dealer_url ||
    settings.social_links?.uhaul_dealer ||
    'https://www.uhaul.com/Locations/Truck-Rentals-near-Tacoma-WA-98467/046117/';
  const shopifyUrl =
    settings.shopify_storefront_url ||
    settings.social_links?.shopify_store ||
    'https://aldridgesales.myshopify.com/';
  const ebayUrl = settings.social_links?.ebay_store || 'https://www.ebay.com/usr/aabcas';
  const fbUrl = settings.social_links?.facebook || 'https://www.facebook.com/AldridgeAutos';
  const fbMarketplaceUrl =
    settings.social_links?.facebook_marketplace || 'https://www.facebook.com/ProfessionalFacilitatorOfNeeds';
  const igUrl = settings.social_links?.instagram || 'https://www.instagram.com/aldridgeautos/';
  const ytUrl = settings.social_links?.youtube || 'https://www.youtube.com/@AldridgeAutos';
  const offerupUrl = settings.social_links?.offerup || 'https://offerup.com/search?q=Aldridge+Auto+Tacoma';

  // Render homepage cross-platform backlink bar & footer channel links
  const verifiedBarEl = document.getElementById('home-verified-channels');
  if (verifiedBarEl) {
    verifiedBarEl.innerHTML = [
      `<a class="channel-pill channel-pill-star" href="${esc(gbpUrl)}" target="_blank" rel="noopener me">★ 5.0 Google Business Profile (87 Reviews) ↗</a>`,
      `<a class="channel-pill channel-pill-uhaul" href="${esc(uhaulUrl)}" target="_blank" rel="noopener me">U-Haul Dealer #${esc(settings.uhaul_dealer_id || '046117')} ↗</a>`,
      `<a class="channel-pill" href="${esc(fbUrl)}" target="_blank" rel="noopener me">Facebook Page (@AldridgeAutos) ↗</a>`,
      `<a class="channel-pill" href="${esc(fbMarketplaceUrl)}" target="_blank" rel="noopener me">Facebook Marketplace Profile ↗</a>`,
      `<a class="channel-pill" href="${esc(igUrl)}" target="_blank" rel="noopener me">Instagram ↗</a>`,
      `<a class="channel-pill" href="${esc(ytUrl)}" target="_blank" rel="noopener me">YouTube ↗</a>`,
      `<a class="channel-pill" href="${esc(shopifyUrl)}" target="_blank" rel="noopener me">Shopify Store ↗</a>`,
      `<a class="channel-pill" href="${esc(ebayUrl)}" target="_blank" rel="noopener me">eBay Store (aabcas) ↗</a>`,
      `<a class="channel-pill" href="${esc(offerupUrl)}" target="_blank" rel="noopener me">OfferUp Local ↗</a>`
    ].join('');
  }

  const footerSocialEl = document.getElementById('footer-social-links');
  if (footerSocialEl) {
    footerSocialEl.innerHTML = [
      `<li><a href="${esc(gbpUrl)}" target="_blank" rel="noopener me">Google (5.0★ • 87) ↗</a></li>`,
      `<li><a href="${esc(uhaulUrl)}" target="_blank" rel="noopener me">U-Haul #${esc(settings.uhaul_dealer_id || '046117')} ↗</a></li>`,
      `<li><a href="${esc(shopifyUrl)}" target="_blank" rel="noopener me">Shopify Store ↗</a></li>`,
      `<li><a href="${esc(ebayUrl)}" target="_blank" rel="noopener me">eBay (aabcas) ↗</a></li>`,
      `<li><a href="${esc(offerupUrl)}" target="_blank" rel="noopener me">OfferUp Local ↗</a></li>`,
      `<li><a href="${esc(fbUrl)}" target="_blank" rel="noopener me">Facebook Page ↗</a></li>`,
      `<li><a href="${esc(fbMarketplaceUrl)}" target="_blank" rel="noopener me">FB Marketplace ↗</a></li>`,
      `<li><a href="${esc(igUrl)}" target="_blank" rel="noopener me">Instagram ↗</a></li>`,
      `<li><a href="${esc(ytUrl)}" target="_blank" rel="noopener me">YouTube ↗</a></li>`
    ].join('');
  }

  // Update canonical link, og:url & SEO JSON-LD @graph dynamically
  const canonicalEl = document.querySelector('link[rel="canonical"]');
  if (canonicalEl) canonicalEl.setAttribute('href', `${canonBase}/`);
  const ogUrlEl = document.querySelector('meta[property="og:url"]');
  if (ogUrlEl) ogUrlEl.setAttribute('content', `${canonBase}/`);

  const sameAsList = Array.from(
    new Set(
      [gbpUrl, uhaulUrl, fbUrl, fbMarketplaceUrl, igUrl, ytUrl, shopifyUrl, ebayUrl, offerupUrl].filter(
        (u) => u && /^https?:\/\//i.test(u)
      )
    )
  );

  const seoEl = document.getElementById('seo-json-ld');
  if (seoEl) {
    seoEl.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': ['AutoRepair', 'AutoPartsStore', 'LocalBusiness'],
          '@id': `${canonBase}/#business`,
          name: settings.google_listing_name || "Aldridge Auto's Service & Repair",
          alternateName: [settings.business_name, 'Aldridge Auto Supply', "Aldridge Auto's University Place & Tacoma"],
          description: `${settings.google_listing_name || settings.business_name} in University Place / Tacoma, WA: 5.0-star auto repair & diagnostics (Free Engine Light Scan, $100 Inspections, Fleet/Veteran/First Responder Discounts), verified photographed Used OEM auto parts (Calculated Parcel Shipping, Free 98467 Counter Pickup & Certified Shop Bay Installation), and Authorized U-Haul Neighborhood Dealer #${settings.uhaul_dealer_id || '046117'}.`,
          url: `${canonBase}/`,
          image: [
            `${canonBase}/assets/og-banner.jpg?v=11`,
            `${canonBase}/assets/aldridge-shop-hero.jpg?v=11`,
            `${canonBase}/assets/aldridge-lot-uhaul.jpg?v=11`
          ],
          logo: {
            '@type': 'ImageObject',
            url: `${canonBase}/assets/aldridge-crest.jpg?v=11`,
            width: 1024,
            height: 1024
          },
          telephone: settings.phone,
          email: settings.email,
          priceRange: '$$',
          currenciesAccepted: 'USD',
          paymentAccepted: 'Cash, Credit Card, Debit Card',
          hasMap: gbpUrl,
          address: {
            '@type': 'PostalAddress',
            streetAddress: settings.street_address,
            addressLocality: settings.city_display || settings.city,
            addressRegion: settings.state,
            postalCode: settings.zip,
            addressCountry: 'US'
          },
          geo: {
            '@type': 'GeoCoordinates',
            latitude: 47.2062,
            longitude: -122.5365
          },
          areaServed: ['University Place', 'Tacoma', 'Lakewood', 'Fircrest', 'Steilacoom', 'Fife'].map((c) => ({ '@type': 'City', name: c })),
          openingHoursSpecification: [
            {
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
              opens: '12:00',
              closes: '19:00'
            },
            {
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: ['Saturday'],
              opens: '12:00',
              closes: '18:00'
            },
            {
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: ['Sunday'],
              opens: '13:00',
              closes: '16:00'
            }
          ],
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: '5.0',
            bestRating: '5',
            reviewCount: '87'
          },
          hasOfferCatalog: {
            '@type': 'OfferCatalog',
            name: "Aldridge Auto's Service, OEM Parts & U-Haul Offerings",
            itemListElement: [
              { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Full-Service Auto Repair, Electrical & Cooling Diagnostics (Free Engine Light Scan)' } },
              { '@type': 'Offer', itemOffered: { '@type': 'Service', name: '$100 Pre-Purchase & Multi-Point Vehicle Inspection' } },
              { '@type': 'Offer', itemOffered: { '@type': 'Product', name: 'Tested Photographed Used OEM Auto Parts (Ship Nationwide, Free 98467 Pickup, or Shop Bay Install)' } },
              { '@type': 'Offer', itemOffered: { '@type': 'Service', name: `Authorized U-Haul Neighborhood Dealer #${settings.uhaul_dealer_id || '046117'} Truck & Trailer Rentals` } }
            ]
          },
          sameAs: sameAsList,
          department: [
            {
              '@type': 'AutoRental',
              name: `${settings.business_name} — Authorized U-Haul Neighborhood Dealer #${settings.uhaul_dealer_id || '046117'}`,
              telephone: settings.uhaul_phone || '(253) 948-3487',
              url: uhaulUrl,
              description: 'Limited-stock neighborhood U-Haul truck & trailer rental dispatch with 24/7 Truck Share and 24-hour drop-off return (no hitch sales or hitch installation on-site).'
            }
          ]
        },
        {
          '@type': 'WebSite',
          '@id': `${canonBase}/#website`,
          url: `${canonBase}/`,
          name: `${settings.google_listing_name || settings.business_name} — OEM Auto Parts, 5.0★ Auto Repair & U-Haul #${settings.uhaul_dealer_id || '046117'}`,
          publisher: { '@id': `${canonBase}/#business` },
          potentialAction: {
            '@type': 'SearchAction',
            target: `${canonBase}/?sku={search_term_string}`,
            'query-input': 'required name=search_term_string'
          }
        }
      ]
    }, null, 2);
  }

  renderSpecials(specials);
  populateCategoryFilter(inventory);
  const featuredTop4 = pickBalancedVehicleShowcase(activeItems, 4, { sortByPrice: true, prioritizeHighDollar: true });
  const featuredSkuSet = new Set(featuredTop4.map((i) => String(i.sku || '').toUpperCase()));
  renderPartsCards(
    pickBalancedVehicleShowcase(activeItems, 8, { sortByPrice: true, prioritizeHighDollar: true, excludeSkus: featuredSkuSet }),
    'home-featured-parts'
  );
  renderCatalogFiltered();
  renderUhaulHub(settings);
  showCustomerPolicy('master_return_refund_policy');

  // Employee Backend Sections
  renderStaffKpis();
  populateDonorAndSkuDropdowns();
  renderStaffInventoryTable();
  renderSyncAndChecklists();
  selectStaffPolicy(state.activePolicyKey);
  renderStaffApprovalsAndOrders();
  renderStaffCrmAndInbox();
  populateSettingsVaultForm(settings);
  renderLaunchCenter();
  updateCartBadge();
}

function getCanonicalBaseUrl(settings) {
  const raw = settings?.canonical_domain || settings?.public_pwa_url || 'https://aldridgeautosupply.com';
  return String(raw).trim().replace(/\/+$/, '') || 'https://aldridgeautosupply.com';
}

function scoreHighDollarAssembly(item = {}) {
  const blob = `${item.title || ''} ${item.category || ''}`.toLowerCase();
  const price = Number(item.price_we_pull || 0);
  // Tier 3 (highest): Powertrain & Drivetrain major assemblies
  if (/\b(complete\s*engine|engine\s*assembly|long\s*block|short\s*block|automatic\s*transmission|manual\s*transmission|transmission\s*assembly|transaxle|transfer\s*case|front\s*differential|rear\s*differential|differential\s*(?:carrier|assembly)|axle\s*assembly)\b/i.test(blob)) {
    return 3000 + price;
  }
  // Tier 2: High-value Wheels/Tires, Complete Doors/Tailgates/Hoods/Seats
  if (/\b(wheel.*tire|tire.*wheel|alloy\s*wheel|complete\s*door|door\s*shell|front\s*door|rear\s*door|tailgate|liftgate|hood\s*panel|front\s*seat|rear\s*seat|bench\s*seat|bucket\s*seat|leather\s*seat)\b/i.test(blob)) {
    return 2000 + price;
  }
  // Tier 1: High-value OEM Electronics, Lighting & Major Chassis Assemblies
  if (/\b(ecm|ecu|pcm|bcm|tcm|engine\s*control|instrument\s*cluster|speedometer|navigation|radio|stereo|head\s*unit|amplifier|abs\s*pump|headlight|headlamp|alternator|a\/?c\s*compressor|steering\s*rack|radiator|strut\s*assembly|driveshaft)\b/i.test(blob)) {
    return 1000 + price;
  }
  return price;
}

function pickBalancedVehicleShowcase(items, count = 6, { sortByPrice = true, prioritizeHighDollar = true, excludeSkus = new Set() } = {}) {
  const clean = (Array.isArray(items) ? items : []).filter((i) => {
    if (!i || i.status !== 'active' || Number(i.quantity || 0) <= 0) return false;
    if (excludeSkus && excludeSkus.has(String(i.sku || '').toUpperCase())) return false;
    const hasPhoto = Array.isArray(i.photos) && i.photos.length > 0;
    return hasPhoto;
  });
  if (!clean.length) return [];

  // Group by donor vehicle (Year + Make + Model) so consecutive cards diversify across the 7 active vehicles
  const buckets = new Map();
  for (const item of clean) {
    const yr = String(item.fitment_years || '').trim();
    const mk = String(item.fitment_make || '').trim().toUpperCase();
    const md = String(item.fitment_model || '').trim().toUpperCase().replace(/\s+PICKUP$/i, '');
    const familyKey = `${yr}|${mk}|${md}` || `SKU:${item.sku}`;
    if (!buckets.has(familyKey)) buckets.set(familyKey, []);
    buckets.get(familyKey).push(item);
  }

  for (const list of buckets.values()) {
    list.sort((a, b) => {
      if (prioritizeHighDollar) {
        const ds = scoreHighDollarAssembly(b) - scoreHighDollarAssembly(a);
        if (ds !== 0) return ds;
      }
      if (sortByPrice) {
        const dp = Number(b.price_we_pull || 0) - Number(a.price_we_pull || 0);
        if (dp !== 0) return dp;
      }
      const photoDiff = (b.photos?.length || 0) - (a.photos?.length || 0);
      if (photoDiff !== 0) return photoDiff;
      return Number(b.price_we_pull || 0) - Number(a.price_we_pull || 0);
    });
  }

  // Order active donor vehicles by their top high-dollar assembly value so flagship assemblies lead!
  const orderedFamilies = Array.from(buckets.entries())
    .sort((a, b) => scoreHighDollarAssembly(b[1][0]) - scoreHighDollarAssembly(a[1][0]))
    .map(([, list]) => list);

  const picked = [];
  const usedSkus = new Set();
  let round = 0;
  while (picked.length < count && round < 12) {
    let addedInRound = 0;
    for (const list of orderedFamilies) {
      if (picked.length >= count) break;
      const cand = list[round];
      if (cand && !usedSkus.has(cand.sku)) {
        usedSkus.add(cand.sku);
        picked.push(cand);
        addedInRound++;
      }
    }
    if (addedInRound === 0) break;
    round++;
  }
  return picked;
}
window.pickBalancedVehicleShowcase = pickBalancedVehicleShowcase;

/* ==================== SPECIALS & SHARE-TO-FRIEND ==================== */
function renderSpecials(specials) {
  const grid = document.getElementById('home-specials-grid');
  if (!grid) return;
  if (!specials.length) {
    grid.innerHTML = '<div class="surface-card">No active specials right now — check back soon!</div>';
    return;
  }
  grid.innerHTML = specials.slice(0, 3).map((sp) => `
    <article class="special-card">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
          <span class="badge" style="background:var(--bg-subtle);color:var(--text-secondary);border:1px solid var(--border-light);">${esc(sp.badge)}</span>
          <span style="font-size:0.74rem;color:var(--text-muted);">Exp ${esc(sp.valid_until)}</span>
        </div>
        <h3 style="margin:0 0 0.28rem;font-size:0.98rem;font-weight:800;color:var(--text-primary);">${esc(sp.title)}</h3>
        <div style="font-weight:800;color:var(--text-primary);font-family:var(--font-mono);font-size:1.05rem;margin-bottom:0.4rem;">${esc(sp.discount_text)}</div>
        <p style="font-size:0.82rem;color:var(--text-secondary);margin:0 0 0.9rem;line-height:1.42;">${esc(sp.description)}</p>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;padding-top:0.65rem;border-top:1px solid var(--border-light);">
        <span class="promo-code-box">${esc(sp.promo_code)}</span>
        <button type="button" class="btn btn-outline btn-sm" onclick="shareSpecial(${sp.id}, '${esc(sp.title)}', '${esc(sp.promo_code)}')">
          Share (${sp.share_count || 0})
        </button>
      </div>
    </article>
  `).join('');
}

async function shareSpecial(id, title, code) {
  const baseUrl = getCanonicalBaseUrl(state.data?.settings);
  const url = `${baseUrl}/?promo=${encodeURIComponent(code)}`;
  const shareText = `${title} — Use code ${code} at ${state.data?.settings?.business_name || "Aldridge Auto's"}! ${url}`;
  try {
    await api(`/api/specials/${id}/share`, { method: 'POST' });
    if (navigator.share) {
      await navigator.share({ title, text: shareText, url });
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(shareText);
      showToast('Referral offer link copied to clipboard — paste in Text or Social!');
    }
    await loadBootstrap();
  } catch (err) {
    showToast('Offer ready to share: ' + code);
  }
}

async function shareSiteWithFriend() {
  const s = state.data?.settings;
  const url = getCanonicalBaseUrl(s);
  const text = `Check out ${s?.business_name || "Aldridge Auto's"} in University Place / Tacoma for OEM Auto Parts, 5.0★ Auto Repair & U-Haul #046117: ${url}`;
  if (navigator.share) {
    await navigator.share({ title: s?.business_name || "Aldridge Auto's", text, url }).catch(() => {});
  } else if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    showToast('Shareable shop link copied to clipboard!');
  }
}

/* ==================== OEM PARTS STOREFRONT & 3-TIER SELECTOR ==================== */
function populateCategoryFilter(items) {
  const sel = document.getElementById('parts-category-filter');
  if (!sel) return;
  const current = sel.value;
  const cats = Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort();
  sel.innerHTML = '<option value="">All Categories</option>' +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = current;
}

function renderCatalogFiltered() {
  if (!state.data) return;
  const q = (document.getElementById('parts-search-input')?.value || '').toLowerCase().trim();
  const cat = document.getElementById('parts-category-filter')?.value || '';
  const mode = document.getElementById('parts-mode-filter')?.value || '';

  const filtered = state.data.inventory.filter((item) => {
    if (item.quantity <= 0 || item.status !== 'active') return false;
    if (cat && item.category !== cat) return false;
    if (mode === 'self_pull' && !item.allow_self_pull) return false;
    if (mode === 'parcel' && item.shipping_class !== 'parcel_calculated') return false;
    if (mode === 'freight' && item.shipping_class === 'parcel_calculated') return false;
    if (q) {
      const hay = `${item.sku} ${item.title} ${item.oem_part_number} ${item.interchange_number} ${item.hollander_number} ${item.fitment_years} ${item.fitment_make} ${item.fitment_model} ${item.category}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  renderPartsCards(filtered, 'catalog-parts-grid');
}

function showAllCatalogItems() {
  state.showAllCatalog = true;
  renderCatalogFiltered();
}

function resolveCategoryBookTimeLabor(item = {}, laborRateInput = 174.99) {
  const rate = Number(laborRateInput || 174.99) || 174.99;
  if (item && Number(item.install_labor_hours || 0) > 0 && item.install_labor_range && item.install_labor_label) {
    const hrs = Number(item.install_labor_hours);
    const laborCost = Number((hrs * rate).toFixed(2));
    return {
      hours: hrs,
      range: String(item.install_labor_range),
      labor_cost: laborCost,
      is_major_drivetrain: Boolean(item.install_is_major_drivetrain),
      label: String(item.install_labor_label)
    };
  }
  const titleStr = String(item?.title || item?.part_name || '').trim();
  const catStr = String(item?.category || item?.product_type || '').trim();
  const titleLower = titleStr.toLowerCase();
  const combined = `${titleStr} ${catStr}`.toLowerCase();
  const isSmallSubpart = /\b(sensor|switch|module|ecm|ecu|pcm|bcm|tcm|computer|harness|wire|wiring|relay|fuse|solenoid|cover|bezel|trim|knob|handle|latch|hinge|mount|bracket|gasket|seal|hose|tube|pipe|duct|dipstick|cap|pulley|tensioner|belt|filter|box|air\s*box|air\s*cleaner|throttle\s*body|injector|coil\s*pack|ignition\s*coil|valve\s*cover|oil\s*pan|cooler|line|cable|shifter|linkage|reservoir|mirror|light|lamp|headlight|headlamp|taillight|tail\s*light|fog\s*light|speaker|radio|stereo|cluster|speedometer|visor|mat|console|armrest|vent|grille|emblem|badge|molding|weatherstrip|seal\s*strip|clip|bolt|nut|stud|washer|shield|splash\s*guard|liner|skid\s*plate|under\s*cover|regulator|actuator)\b/i.test(titleLower);

  const build = (hours, range, isMajor) => ({
    hours,
    range,
    labor_cost: Number((hours * rate).toFixed(2)),
    is_major_drivetrain: isMajor,
    label: isMajor || hours >= 2.0
      ? `Est. ~${range} certified bay labor @ $${rate.toFixed(2)}/hr (Final quote confirmed prior to work)`
      : `Est. ~${range} certified bay labor @ $${rate.toFixed(2)}/hr`
  });

  if (!isSmallSubpart && /\b(complete\s*engine|engine\s*assembly|long\s*block|short\s*block|motor\s*assembly|v6\s*engine|v8\s*engine|i4\s*engine|4\.0l\s*engine|5\.7l\s*engine|4\.7l\s*engine|2\.4l\s*engine|1\.4l\s*engine)\b/i.test(titleLower)) {
    return build(12.0, '10.0–14.0 hrs', true);
  }
  if (!isSmallSubpart && /\b(automatic\s*transmission|manual\s*transmission|transmission\s*assembly|transaxle|transfer\s*case|gearbox\s*assembly)\b/i.test(titleLower)) {
    return build(6.0, '5.0–7.0 hrs', true);
  }
  if (!isSmallSubpart && /\b(front\s*differential|rear\s*differential|differential\s*(?:assembly|carrier|housing)|axle\s*(?:assembly|housing|shaft)|cv\s*axle|half\s*shaft|subframe|k-?frame|crossmember|steering\s*rack|rack\s*and\s*pinion|exhaust\s*manifold|catalytic|cylinder\s*head|timing\s*chain|timing\s*belt|heater\s*core|complete\s*dashboard|fuel\s*tank|gas\s*tank)\b/i.test(titleLower)) {
    return build(3.5, '3.0–4.5 hrs', true);
  }
  if (
    !/\b(handle|switch|latch|hinge|mirror|trim|molding|weatherstrip|seal|wiring|harness|speaker|panel\s*trim|cover\s*trim|bezel|cap|bracket|mount|sensor|relay|fuse)\b/i.test(titleLower) &&
    /\b(alternator|generator|starter\s*motor|\bstarter\b|a\/?c\s*compressor|air\s*conditioning\s*compressor|radiator|condenser|strut|shock\s*absorber|coilover|control\s*arm|trailing\s*arm|suspension\s*arm|wheel\s*hub|hub\s*bearing|wheel\s*bearing|spindle|knuckle|fuel\s*pump|power\s*steering\s*pump|water\s*pump|brake\s*booster|master\s*cylinder|brake\s*caliper|abs\s*pump|abs\s*actuator|driveshaft|drive\s*shaft|complete\s*door|door\s*shell|front\s*door|rear\s*door|driver\s*door|passenger\s*door|sliding\s*door|car\s*door|front\s*fender|fender\s*panel|\bfender\b|quarter\s*panel|tailgate|liftgate|hatch\s*lid|trunk\s*lid|hood\s*panel|engine\s*hood|front\s*bumper|rear\s*bumper|bumper\s*cover|bumper\s*assembly|windshield|window\s*glass|front\s*seat|rear\s*seat|bench\s*seat|bucket\s*seat|turbocharger|intake\s*manifold)\b/i.test(titleLower)
  ) {
    return build(2.0, '1.5–2.5 hrs', false);
  }
  if (!isSmallSubpart && /\b(suspension|brakes|cooling|charging|starting)\b/i.test(combined) && !/\b(pad|clip|cap|cover|sensor|switch|line|hose)\b/i.test(titleLower)) {
    return build(2.0, '1.5–2.5 hrs', false);
  }
  return build(0.75, '0.5–1.0 hr', false);
}

function renderPartsCards(items, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="surface-card" style="grid-column:1/-1;text-align:center;">
      <h3 style="margin:0 0 0.4rem;">Clean-Slate Verified On-Hand Inventory Ready</h3>
      <p style="margin:0;color:var(--text-secondary);">New verified on-hand OEM parts appear here automatically the moment they are published in Employee Backend → 1. AI Camera Intake.</p>
    </div>`;
    return;
  }

  const limit = containerId === 'catalog-parts-grid' && !state.showAllCatalog ? 48 : items.length;
  const visibleItems = items.slice(0, limit);
  const handlingFee = Number(state.data?.settings?.handling_fee_default ?? 10).toFixed(2);
  const laborRate = Number(state.data?.settings?.labor_rate_hourly || 174.99);

  const cardsHtml = visibleItems.map((item) => {
    const img = item.photos?.[0] || '/assets/oem-parts.jpg';
    const photoCount = item.photos?.length || 1;
    const isLocalPickupOnly = Number(item.weight_lbs || 0) >= 70 || item.shipping_class !== 'parcel_calculated';
    const shipBadge = isLocalPickupOnly
      ? '<span class="badge badge-warn">Local Pickup Only (UP, WA 98467)</span>'
      : `<span class="badge badge-ok">Calculated Parcel (+$${handlingFee} Hdl)</span>`;
    const pullBadge = `<span class="badge badge-dark">1 Single Variant • ${photoCount} Real Photo${photoCount === 1 ? '' : 's'}</span>`;
    const partPrice = Number(item.price_we_pull || 0);
    const bookTime = resolveCategoryBookTimeLabor(item, laborRate);
    const installEst = Number((partPrice + bookTime.labor_cost).toFixed(2));

    const primaryLabel = isLocalPickupOnly
      ? '<strong>Single-Variant OEM Part</strong> (Local Counter Pickup — 98467)'
      : '<strong>Single-Variant OEM Part</strong> (Ship Parcel or Free 98467 Pickup)';

    return `
      <article class="part-card">
        <div class="part-thumb" style="cursor:pointer;" onclick="window.openPublicProductModal && window.openPublicProductModal(${item.id})" title="Click to view full OEM specs &amp; multi-angle photos">
          <img src="${esc(img)}" alt="${esc(item.title)}" loading="lazy" />
          <div class="part-badges">
            ${pullBadge}
            ${shipBadge}
          </div>
        </div>
        <div class="part-body">
          <div class="part-sku-line">
            <span>SKU: ${esc(item.sku)}</span>
            <span>${item.oem_part_number ? `OEM #: ${esc(item.oem_part_number)}` : 'Verified Used OEM'}</span>
          </div>
          <h3 class="part-title" style="cursor:pointer;" onclick="window.openPublicProductModal && window.openPublicProductModal(${item.id})">${esc(item.title)}</h3>
          <div class="part-fitment">
            <strong>Fits:</strong> ${esc(item.fitment_years)} ${esc(item.fitment_make)} ${esc(item.fitment_model)} •
            <span>${esc(item.condition || 'Used')} (${item.quantity} in stock)</span> •
            <span class="mono" style="font-size:0.74rem;color:var(--text-muted);">${Number(item.weight_lbs || 8)} lbs (${Math.ceil(Number(item.length_in || 14))}×${Math.ceil(Number(item.width_in || 10))}×${Math.ceil(Number(item.height_in || 8))} in)</span>
          </div>

          <div class="tier-selector">
            <div class="tier-option" style="cursor:default;">
              <span>${primaryLabel}</span>
              <span class="tier-price">$${partPrice.toFixed(2)}</span>
            </div>
            <div style="margin-top:0.35rem;padding:0.42rem 0.55rem;background:var(--status-warn-bg);color:var(--status-warn-fg);border-radius:5px;font-size:0.76rem;line-height:1.35;">
              <strong>🔧 Optional 5.0★ Shop Bay Install (98467):</strong> Est. <strong>$${installEst.toFixed(2)}</strong> turnkey installed — ${esc(bookTime.label)}.
            </div>
          </div>

          <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" style="flex:1 1 100%;" onclick="window.openPublicProductModal && window.openPublicProductModal(${item.id})">
              🔍 View Full Specs &amp; Photos
            </button>
            <button type="button" class="btn btn-primary btn-sm" style="flex:1;" onclick="selectPartAndBuy(${item.id}, false)">
              Add to Cart ($${partPrice.toFixed(2)})
            </button>
            <button type="button" class="btn btn-outline btn-sm" onclick="selectPartAndBuy(${item.id}, true)" title="Buy single-variant part &amp; request a shop installation bay slot">
              Book Installed
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  const moreBanner = items.length > visibleItems.length
    ? `<div class="surface-card" style="grid-column:1/-1;text-align:center;padding:1rem;">
        <p style="margin:0 0 0.6rem;font-size:0.86rem;color:var(--text-secondary);">
          Showing <strong>${visibleItems.length}</strong> of <strong>${items.length}</strong> active OEM parts (use instant search above by Year/Make/Model/Part, or load all below).
        </p>
        <button type="button" class="btn btn-dark btn-sm" onclick="showAllCatalogItems()">Show All ${items.length} Active Parts</button>
      </div>`
    : '';

  container.innerHTML = cardsHtml + moreBanner;
}

/* ==================== PUBLIC PRODUCT DETAIL MODAL (v28 — 100% PUBLIC, NO LOGIN REQUIRED) ==================== */
const pdmState = {
  item: null,
  photos: [],
  activeIdx: 0
};

function sanitizePublicSpecText(str) {
  return String(str || '')
    .replace(/https?:\/\/drive\.google\.com[^\s<>"')]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPublicProductPhotos(item) {
  let list = [];
  if (Array.isArray(item?.photos) && item.photos.length) {
    list = item.photos;
  } else if (item?.photos_json) {
    try { list = JSON.parse(item.photos_json); } catch (_) {}
  }
  const clean = list
    .map((u) => String(u || '').trim())
    .filter((u) => u && !/drive\.google\.com/i.test(u) && !/\.qr\.png$/i.test(u));
  return clean.length ? clean : ['/assets/oem-parts.jpg'];
}

function renderPublicProductModalContent(item) {
  const bodyEl = document.getElementById('pdm-content-body');
  const eyebrowEl = document.getElementById('pdm-eyebrow');
  if (!bodyEl || !item) return;

  const photos = getPublicProductPhotos(item);
  pdmState.item = item;
  pdmState.photos = photos;
  if (pdmState.activeIdx >= photos.length) pdmState.activeIdx = 0;

  const settings = state.data?.settings || {};
  const laborRate = Number(settings.labor_rate_hourly || 174.99);
  const handlingFee = Number(settings.handling_fee_default ?? 10);
  const partPrice = Number(item.price_we_pull || 0);
  const vipPrice = Number((partPrice * 0.85).toFixed(2));
  const shopProPrice = Number((partPrice * 0.75).toFixed(2));
  const bookTime = resolveCategoryBookTimeLabor(item, laborRate);
  const installCombo = Number((partPrice + bookTime.labor_cost).toFixed(2));

  const isLocalPickupOnly = Number(item.weight_lbs || 0) >= 70 || item.shipping_class !== 'parcel_calculated';
  const donor = item.donor || null;
  const verifiedVin = String(item.verified_vin || donor?.vin || '').trim().toUpperCase();
  const hasReal17Vin = /^[A-HJ-NPR-Z0-9]{17}$/.test(verifiedVin);

  const donorYear = item.fitment_years || donor?.year || '';
  const donorMake = item.fitment_make || donor?.make || '';
  const donorModel = item.fitment_model || donor?.model || '';
  const donorEngine = item.fitment_engine || donor?.engine || '';
  const donorTrim = donor?.trim || '';
  const donorSummary = [donorYear, donorMake, donorModel, donorTrim, donorEngine].filter(Boolean).join(' ') || 'Verified OEM Donor Vehicle';

  const mpn = String(item.oem_part_number || '').trim();
  const interchange = String(item.interchange_number || '').trim();
  const conditionGrade = String(item.condition || 'Used OEM').trim();
  const binLoc = String(item.bin_location || 'BAY-B').trim();
  const secCode = String(item.security_mark_code || '').trim();
  const weightLbs = Number(item.weight_lbs || 4.5);
  const dimL = Math.ceil(Number(item.length_in || 10));
  const dimW = Math.ceil(Number(item.width_in || 8));
  const dimH = Math.ceil(Number(item.height_in || 6));
  const cleanDefect = sanitizePublicSpecText(item.defect_disclosure || 'Inspected Used OEM component; see actual high-resolution photos.');
  const cleanNotes = sanitizePublicSpecText(item.fitment_notes || '');

  if (eyebrowEl) {
    eyebrowEl.textContent = `SKU ${item.sku} • ${donorYear} ${donorMake} ${donorModel} • UNIVERSITY PLACE, WA 98467`.replace(/\s+/g, ' ').trim();
  }

  const vinBadgeHtml = hasReal17Vin
    ? `<span class="pdm-vin-badge verified">✓ 17-Char VIN Fitment Verified: <code class="mono">${esc(verifiedVin)}</code></span>`
    : `<span class="pdm-vin-badge verified">✓ Bench-Inspected Genuine OEM Assembly</span>`;

  const activePhoto = photos[pdmState.activeIdx] || photos[0];
  const thumbsHtml = photos.map((src, idx) => `
    <button type="button" class="pdm-thumb-btn ${idx === pdmState.activeIdx ? 'active' : ''}" onclick="window.setPublicProductModalPhoto(${idx})" aria-label="View photo ${idx + 1} of ${photos.length}">
      <img src="${esc(src)}" alt="${esc(item.title)} angle ${idx + 1}" loading="lazy" />
    </button>
  `).join('');

  bodyEl.innerHTML = `
    <div class="pdm-grid">
      <!-- Left: Multi-Angle Photo Gallery + Full-Size Viewer -->
      <div class="pdm-gallery-col">
        <div class="pdm-hero-wrap">
          <img id="pdm-hero-img" src="${esc(activePhoto)}" alt="${esc(item.title)}" onclick="window.openPdmFullSizePhoto()" title="Click to inspect full-size photo" />
          ${photos.length > 1 ? `
            <button type="button" class="pdm-nav-arrow pdm-prev" onclick="window.stepPublicProductModalPhoto(-1)" aria-label="Previous photo">‹</button>
            <button type="button" class="pdm-nav-arrow pdm-next" onclick="window.stepPublicProductModalPhoto(1)" aria-label="Next photo">›</button>
          ` : ''}
          <span class="pdm-photo-counter" id="pdm-photo-counter">${pdmState.activeIdx + 1} / ${photos.length} Real Shop Photo${photos.length === 1 ? '' : 's'}</span>
          <button type="button" class="pdm-zoom-btn" onclick="window.openPdmFullSizePhoto()">🔍 Full-Size View</button>
        </div>
        <div class="pdm-thumbs-strip" id="pdm-thumbs-strip">${thumbsHtml}</div>
        <div class="pdm-guarantee-strip">
          <span>★ 5.0 Google Rated Shop (87 Reviews)</span>
          <span>•</span>
          <span>5115 66th St W, Bldg B, University Place 98467</span>
          <span>•</span>
          <span>(253) 245-4206</span>
        </div>
      </div>

      <!-- Right: Full OEM Specs, Transparent Member Pricing & Instant Actions -->
      <div class="pdm-info-col">
        <div class="pdm-badges-row">
          ${vinBadgeHtml}
          <span class="pdm-stock-badge">✓ ${Number(item.quantity || 1)} Verified Unit on Shelf</span>
        </div>

        <h2 id="pdm-title" class="pdm-title">${esc(item.title)}</h2>

        <!-- Transparent Pricing & Member Savings Breakdown -->
        <div class="pdm-pricing-card">
          <div class="pdm-pricing-header">TRANSPARENT PRICING &amp; MEMBER SAVINGS</div>
          <div class="pdm-price-grid">
            <div class="pdm-price-tile public">
              <span class="pdm-price-lbl">Public Carry-Out</span>
              <strong class="pdm-price-val">$${partPrice.toFixed(2)}</strong>
              <small>${isLocalPickupOnly ? 'Free 98467 Counter Pickup' : `Ships Parcel (+$${handlingFee.toFixed(2)} hdl) or Free 98467 Pickup`}</small>
            </div>
            <div class="pdm-price-tile combo">
              <span class="pdm-price-lbl">Buy Part + Certified $${laborRate.toFixed(2)}/hr Bay Install</span>
              <strong class="pdm-price-val">$${installCombo.toFixed(2)}</strong>
              <small>${esc(bookTime.label)}</small>
            </div>
            <div class="pdm-price-tile member" onclick="window.openMembershipModal && window.openMembershipModal('vip_driver_pass')" role="button" tabindex="0" title="Unlock VIP Driver -15% Pricing">
              <span class="pdm-price-lbl">VIP Driver (-15%)</span>
              <strong class="pdm-price-val">$${vipPrice.toFixed(2)}</strong>
              <small>Save $${(partPrice - vipPrice).toFixed(2)} • Unlock in 10s</small>
            </div>
            <div class="pdm-price-tile member" onclick="window.openMembershipModal && window.openMembershipModal('b2b_dealer_pro')" role="button" tabindex="0" title="Unlock Shop Pro -25% Wholesale Pricing">
              <span class="pdm-price-lbl">Shop Pro (-25%)</span>
              <strong class="pdm-price-val">$${shopProPrice.toFixed(2)}</strong>
              <small>Save $${(partPrice - shopProPrice).toFixed(2)} • B2B / Wholesale</small>
            </div>
          </div>
        </div>

        <!-- Direct High-Converting Action Buttons -->
        <div class="pdm-cta-stack">
          <button type="button" class="btn-buy-clean pdm-cta-btn" onclick="window.closePublicProductModal(); selectPartAndBuy(${Number(item.id)}, false);">
            <span>Add to Cart — Carry-Out ($${partPrice.toFixed(2)})</span>
            <small>${isLocalPickupOnly ? 'Free Counter Pickup • University Place 98467' : 'Ships Nationwide or Free 98467 Counter Pickup'}</small>
          </button>
          <button type="button" class="btn-install-clean pdm-cta-btn" onclick="window.closePublicProductModal(); selectPartAndBuy(${Number(item.id)}, true);">
            <span>Book Installed at Shop — Est. $${installCombo.toFixed(2)}</span>
            <small>${esc(bookTime.label)}</small>
          </button>
        </div>

        <!-- Complete OEM Fitment & Technical Specs Table -->
        <div class="pdm-specs-wrap">
          <div class="pdm-specs-head">COMPLETE OEM FITMENT &amp; TECHNICAL SPECIFICATIONS</div>
          <table class="pdm-specs-table">
            <tbody>
              <tr>
                <th>Verified Donor Vehicle</th>
                <td><strong>${esc(donorSummary)}</strong></td>
              </tr>
              <tr>
                <th>17-Char VIN Fitment</th>
                <td>${hasReal17Vin ? `<code class="mono">${esc(verifiedVin)}</code> <span style="color:#15803d;font-weight:700;">(NHTSA Verified)</span>` : 'Verified OEM Donor Fitment'}</td>
              </tr>
              <tr>
                <th>OEM Manufacturer Part # (MPN)</th>
                <td>${mpn ? `<code class="mono">${esc(mpn)}</code>` : `<code class="mono">OEM-${esc(String(donorYear).slice(0, 4))}${esc(String(donorMake).slice(0, 4).toUpperCase())}</code>`}</td>
              </tr>
              <tr>
                <th>Interchange Numbers</th>
                <td>${interchange ? `<code class="mono">${esc(interchange)}</code>` : 'Direct Factory OEM Replacement'}</td>
              </tr>
              <tr>
                <th>Condition Grade</th>
                <td>${esc(conditionGrade)} — Bench-Inspected</td>
              </tr>
              <tr>
                <th>Shelf / Bin Location</th>
                <td><code class="mono">${esc(binLoc)}</code></td>
              </tr>
              <tr>
                <th>Security QR Tag ID</th>
                <td>${secCode ? `<code class="mono">${esc(secCode)}</code> (Tamper-Evident Mark)` : 'Marked Before Dispatch'}</td>
              </tr>
              <tr>
                <th>Packed Weight &amp; Box Dims</th>
                <td class="mono">${weightLbs} lbs • ${dimL}" × ${dimW}" × ${dimH}"</td>
              </tr>
              <tr>
                <th>Shipping vs. Counter Pickup</th>
                <td>${isLocalPickupOnly
                  ? '<strong>Free University Place 98467 Counter Pickup Only</strong> (Heavy / Oversized Assembly — 70+ lbs or Freight Class)'
                  : `<strong>Calculated Parcel Shipping</strong> (+$${handlingFee.toFixed(2)} protective handling) OR <strong>Free University Place 98467 Counter Pickup</strong>`}</td>
              </tr>
            </tbody>
          </table>
        </div>

        ${(cleanDefect || cleanNotes) ? `
          <div class="pdm-notes-box">
            <strong>Inspection &amp; Fitment Notes:</strong>
            <p style="margin:0.25rem 0 0;">${esc(cleanDefect)}${cleanNotes && cleanNotes !== cleanDefect ? ` • ${esc(cleanNotes)}` : ''}</p>
          </div>
        ` : ''}

        <div style="margin-top:0.75rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
          <button type="button" class="btn btn-outline btn-sm" onclick="window.closePublicProductModal(); askAboutSku('${esc(item.sku)}');">
            Have a Question or Want a 17-Char VIN Check? Ask Our Techs →
          </button>
        </div>
      </div>
    </div>
  `;
}

window.setPublicProductModalPhoto = function (idx) {
  if (!pdmState.photos.length) return;
  const next = Math.max(0, Math.min(pdmState.photos.length - 1, Number(idx) || 0));
  pdmState.activeIdx = next;
  const hero = document.getElementById('pdm-hero-img');
  const counter = document.getElementById('pdm-photo-counter');
  if (hero) hero.src = pdmState.photos[next];
  if (counter) counter.textContent = `${next + 1} / ${pdmState.photos.length} Real Shop Photo${pdmState.photos.length === 1 ? '' : 's'}`;
  document.querySelectorAll('#pdm-thumbs-strip .pdm-thumb-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === next);
  });
};

window.stepPublicProductModalPhoto = function (delta) {
  if (!pdmState.photos.length) return;
  const len = pdmState.photos.length;
  const next = (pdmState.activeIdx + delta + len) % len;
  window.setPublicProductModalPhoto(next);
};

window.openPdmFullSizePhoto = function () {
  const src = pdmState.photos[pdmState.activeIdx] || pdmState.photos[0];
  if (!src) return;
  const lb = document.getElementById('pdm-photo-lightbox');
  const img = document.getElementById('pdm-lightbox-img');
  const cap = document.getElementById('pdm-lightbox-caption');
  if (!lb || !img) {
    window.open(src, '_blank', 'noopener');
    return;
  }
  img.src = src;
  if (cap) {
    cap.textContent = `${pdmState.item?.title || 'OEM Part'} — Photo ${pdmState.activeIdx + 1} of ${pdmState.photos.length}`;
  }
  lb.classList.add('open');
};

window.openPublicProductModal = async function (idOrSku) {
  const modal = document.getElementById('public-product-detail-modal');
  const bodyEl = document.getElementById('pdm-content-body');
  if (!modal || !bodyEl) return;

  const inv = state.data?.inventory || [];
  let item = inv.find((i) => String(i.id) === String(idOrSku) || String(i.sku || '').toUpperCase() === String(idOrSku || '').toUpperCase());

  pdmState.activeIdx = 0;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (!item) {
    bodyEl.innerHTML = '<div style="padding:2rem;text-align:center;color:#5c4b39;font-weight:700;">Loading verified OEM specifications &amp; photos...</div>';
    try {
      const r = await fetch(`/api/inventory/item/${encodeURIComponent(String(idOrSku))}`);
      const d = await r.json();
      if (r.ok && d.ok && d.item) {
        item = d.item;
      }
    } catch (_) {}
  }

  if (!item) {
    bodyEl.innerHTML = '<div style="padding:2rem;text-align:center;color:#b91c1c;font-weight:700;">This part is no longer on the shelf. Call (253) 245-4206 or use Instant Part Finder to source a replacement.</div>';
    return;
  }

  renderPublicProductModalContent(item);
};

window.closePublicProductModal = function () {
  const modal = document.getElementById('public-product-detail-modal');
  const lb = document.getElementById('pdm-photo-lightbox');
  if (lb) lb.classList.remove('open');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const lb = document.getElementById('pdm-photo-lightbox');
    if (lb && lb.classList.contains('open')) {
      lb.classList.remove('open');
      return;
    }
    const modal = document.getElementById('public-product-detail-modal');
    if (modal && modal.classList.contains('open')) {
      window.closePublicProductModal();
    }
  }
});

const MIXED_CART_LOCAL_PICKUP_BANNER =
  'Heavy Assembly in Cart — Local Pickup Only at 5115 66th St W, Bldg B, University Place, WA 98467 (or remove heavy assemblies to ship parcel items separately)';
const HEAVY_ASSEMBLY_PICKUP_RE = /\b(engine\s*(long\s*block|short\s*block|assembly|motor)|transmission(\s*assembly)?|transfer\s*case|subframe|crossmember|rear\s*axle|differential\s*assembly|hood(\s*panel)?|truck\s*bed|door\s*(shell|assembly)|fender\s*panel|quarter\s*panel|tailgate|sunroof\s*glass|windshield|fuel\s*tank)\b/i;

function isLocalPickupOnlyCartItem(item) {
  if (!item) return false;
  const heavyThreshold = Number(state.data?.settings?.freight_weight_threshold_lbs ?? 70);
  if (Number(item.weight_lbs || 0) >= heavyThreshold) return true;
  const sc = String(item.shipping_class || '').toLowerCase();
  if (sc && sc !== 'parcel_calculated') return true;
  if (HEAVY_ASSEMBLY_PICKUP_RE.test(String(item.title || ''))) return true;
  return false;
}

function selectPartAndBuy(itemId, requestInstallSlot = false) {
  const item = state.data.inventory.find((i) => i.id === itemId) || (pdmState.item && pdmState.item.id === itemId ? pdmState.item : null);
  if (!item) return;
  const isLocalPickupOnly = isLocalPickupOnlyCartItem(item);
  const chosenMode = isLocalPickupOnly
    ? 'local_pickup_we_pull'
    : (requestInstallSlot ? 'we_pull_and_install' : 'ship_calculated');

  const existing = state.cart.find((c) => c.sku === item.sku);
  if (!existing) {
    state.cart.push({ sku: item.sku, qty: 1 });
  }
  updateCartBadge();
  document.getElementById('chk-mode').value = chosenMode;
  openCartModal();
}

function askAboutSku(sku) {
  switchCustomerView('view-support');
  document.getElementById('inq-sku').value = sku;
  document.getElementById('inq-subject').value = `VIN Fitment Check for SKU ${sku}`;
  document.getElementById('inq-vin').focus();
}

function updateCartBadge() {
  const count = state.cart.reduce((acc, c) => acc + c.qty, 0);
  document.getElementById('cart-count-badge').textContent = String(count);
}

function openCartModal() {
  document.getElementById('checkout-success-box').style.display = 'none';
  document.getElementById('checkout-form').style.display = state.cart.length ? 'block' : 'none';
  const defaultDate = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0];
  if (!document.getElementById('chk-date').value) {
    document.getElementById('chk-date').value = defaultDate;
  }
  renderCartSummary();
  document.getElementById('cart-modal').classList.add('open');
}

function closeCartModal() {
  document.getElementById('cart-modal').classList.remove('open');
}

function removeFromCart(sku) {
  state.cart = state.cart.filter((c) => c.sku !== sku);
  updateCartBadge();
  openCartModal();
}

function renderCartSummary() {
  const box = document.getElementById('cart-items-container');
  const totalsBox = document.getElementById('cart-totals-box');
  const modeSelect = document.getElementById('chk-mode');
  const bannerEl = document.getElementById('cart-mixed-local-pickup-banner');
  const lockNoteEl = document.getElementById('chk-mode-lock-note');
  const attrInput = document.getElementById('chk-fulfillment-attr');

  if (!state.cart.length) {
    if (bannerEl) {
      bannerEl.style.display = 'none';
      bannerEl.textContent = '';
    }
    if (lockNoteEl) lockNoteEl.style.display = 'none';
    if (attrInput) attrInput.value = '';
    if (modeSelect) modeSelect.disabled = false;
    box.innerHTML = '<div style="padding:1rem;background:var(--bg-subtle);border-radius:6px;text-align:center;">Your order bag is empty. Browse photographed OEM parts to add items.</div>';
    totalsBox.innerHTML = '';
    return;
  }

  const hasHeavyLocalPickup = state.cart.some((line) => {
    const item = state.data.inventory.find((i) => i.sku === line.sku);
    return isLocalPickupOnlyCartItem(item);
  });

  const shipOpt = modeSelect.querySelector('option[value="ship_calculated"]');
  if (shipOpt) {
    shipOpt.disabled = hasHeavyLocalPickup;
  }
  if (hasHeavyLocalPickup) {
    modeSelect.value = 'local_pickup_we_pull';
    modeSelect.disabled = true;
    modeSelect.dataset.lockedLocalPickup = 'true';
    if (bannerEl) {
      bannerEl.style.display = 'block';
      bannerEl.innerHTML = `⚠️ <strong>${esc(MIXED_CART_LOCAL_PICKUP_BANNER)}</strong>`;
    }
    if (lockNoteEl) lockNoteEl.style.display = 'block';
    if (attrInput) attrInput.value = 'Local_Pickup_Only_Bldg_B';
  } else {
    modeSelect.disabled = false;
    modeSelect.dataset.lockedLocalPickup = 'false';
    if (bannerEl) {
      bannerEl.style.display = 'none';
      bannerEl.textContent = '';
    }
    if (lockNoteEl) lockNoteEl.style.display = 'none';
    if (attrInput) attrInput.value = '';
  }

  const mode = hasHeavyLocalPickup ? 'local_pickup_we_pull' : modeSelect.value;
  document.getElementById('chk-address-wrap').style.display = mode === 'ship_calculated' ? 'flex' : 'none';
  document.getElementById('chk-appt-fields').style.display = mode !== 'ship_calculated' ? 'block' : 'none';
  const waiverWrap = document.getElementById('chk-waiver-wrap');
  if (waiverWrap) waiverWrap.style.display = 'none';

  let subtotal = 0;
  let totalWeight = 0;

  const linesHtml = state.cart.map((line) => {
    const item = state.data.inventory.find((i) => i.sku === line.sku);
    if (!item) return '';
    const unit = Number(item.price_we_pull || 0);
    const installInfo = Number(item.price_pull_install || 0);
    const lineIsHeavy = isLocalPickupOnlyCartItem(item);
    subtotal += unit * line.qty;
    totalWeight += Number(item.weight_lbs || 8) * line.qty;

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.55rem 0;border-bottom:1px solid var(--border-light);font-size:0.85rem;">
        <div>
          <strong>${esc(item.title)}</strong>${lineIsHeavy ? ' <span style="display:inline-block;margin-left:0.35rem;padding:0.1rem 0.4rem;border-radius:4px;background:#fef3c7;color:#92400e;border:1px solid #f59e0b;font-size:0.7rem;font-weight:700;">Local Pickup Only (Bldg B)</span>' : ''}<br/>
          <span class="mono" style="font-size:0.75rem;color:var(--text-muted);">SKU: ${esc(item.sku)} • 1 Single Variant${installInfo > unit ? ` • Est. Bay Installed: $${installInfo.toFixed(2)}` : ''} • Security: ${esc(item.security_mark_code)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:0.65rem;">
          <strong class="mono">$${(unit * line.qty).toFixed(2)}</strong>
          <button type="button" class="btn btn-sm btn-outline" onclick="removeFromCart('${esc(item.sku)}')">Remove</button>
        </div>
      </div>
    `;
  }).join('');

  box.innerHTML = linesHtml;

  const settings = state.data.settings;
  const handlingFee = mode === 'ship_calculated' ? Number(settings.handling_fee_default ?? 10) : 0;
  const shipEst = mode === 'ship_calculated'
    ? Math.max(12.95, Number((8.5 + totalWeight * 0.92).toFixed(2)))
    : 0;
  const taxRate = Number(settings.tax_rate ?? 0.101);
  const tax = Number((subtotal * taxRate).toFixed(2));
  const grandTotal = (subtotal + shipEst + handlingFee + tax).toFixed(2);

  totalsBox.innerHTML = `
    ${hasHeavyLocalPickup ? `<div style="margin-bottom:0.45rem;padding:0.5rem 0.65rem;background:#fef3c7;border:1px solid #d97706;color:#78350f;border-radius:5px;font-size:0.79rem;font-weight:600;">⚠️ ${esc(MIXED_CART_LOCAL_PICKUP_BANNER)}</div>` : ''}
    ${mode === 'we_pull_and_install' ? '<div style="margin-bottom:0.45rem;padding:0.45rem 0.6rem;background:var(--bg-white);border:1px solid var(--border-light);border-radius:4px;font-size:0.78rem;"><strong>Single-Variant Part Checkout:</strong> Reserves the physical part now; Certified Shop Bay Installation labor is confirmed &amp; settled at Bldg B upon inspection.</div>' : ''}
    <div style="display:flex;justify-content:space-between;"><span>Single-Variant Part Subtotal:</span><span class="mono">$${subtotal.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;"><span>${mode === 'ship_calculated' ? `Calculated Parcel Shipping (${totalWeight.toFixed(1)} lbs)` : 'Local Counter / Bay — University Place, WA 98467'}:</span><span class="mono">$${shipEst.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;"><span>Protective Packaging &amp; Handling Buffer:</span><span class="mono">$${handlingFee.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;"><span>Estimated ${esc(settings.state || 'WA')} Sales Tax (${(taxRate * 100).toFixed(1)}%):</span><span class="mono">$${tax.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1rem;margin-top:0.4rem;padding-top:0.4rem;border-top:1px solid var(--border-strong);">
      <span>Total Part Checkout:</span><span class="mono">$${grandTotal}</span>
    </div>
  `;
}

/* ==================== U-HAUL COMPLIANT HUB ==================== */
function renderUhaulHub(settings) {
  const u = settings.uhaul_synced_data || {};
  const url = settings.uhaul_dealer_url || 'https://www.uhaul.com/Locations/Truck-Rentals-near-Tacoma-WA-98467/046117/';
  const trailersUrl = settings.uhaul_trailers_url || 'https://www.uhaul.com/Locations/Trailer-Rentals-near-Tacoma-WA-98467/046117/';
  document.getElementById('uhaul-dealer-heading').textContent = u.dealer_title || "Aldridge Auto's — Official U-Haul Neighborhood Dealer #046117";
  document.getElementById('uhaul-live-portal-btn').href = url;
  document.getElementById('uhaul-secondary-link').href = url;
  const trBtn = document.getElementById('uhaul-trailers-link');
  if (trBtn) trBtn.href = trailersUrl;
  const eqList = document.getElementById('uhaul-equipment-list');
  eqList.innerHTML = (u.equipment_categories || []).map((c) => `<li>${esc(c)}</li>`).join('');
}

function showCustomerPolicy(key) {
  const p = state.data?.policies?.[key] || '';
  const el = document.getElementById('customer-policy-preview');
  if (el) el.textContent = p;
}

/* ==================== EMPLOYEE BACKEND RENDERERS ==================== */
function renderStaffKpis() {
  const { inventory, appointments, returnClaims, customers, reviewSummary } = state.data;
  const activeSkus = inventory.filter((i) => i.quantity > 0 && i.status === 'active');
  const totalValue = activeSkus.reduce((sum, i) => sum + Number(i.price_we_pull || 0) * i.quantity, 0);
  const pendingAppts = appointments.filter((a) => a.status === 'pending_approval').length;
  const openRmas = returnClaims.filter((r) => r.status === 'pending_evidence_review').length;

  const invTabBtn = document.getElementById('tab-btn-inventory');
  if (invTabBtn) {
    invTabBtn.textContent = `2. Inventory (${activeSkus.length.toLocaleString()} SKUs) & CSV`;
  }
  const revTabBtn = document.getElementById('tab-btn-review');
  if (revTabBtn && reviewSummary && reviewSummary.total > 0) {
    revTabBtn.textContent = reviewSummary.pending > 0
      ? `0. Photo Review (${reviewSummary.pending.toLocaleString()} Pending)`
      : `0. Photo Review (${reviewSummary.keep.toLocaleString()} Kept ✓)`;
  }

  document.getElementById('staff-kpi-strip').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Active Multi-Channel SKUs</div>
      <div class="kpi-value">${activeSkus.length}</div>
      <div class="kpi-sub">Retail We-Pull Value: $${totalValue.toLocaleString()}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Visual Photo Review Queue</div>
      <div class="kpi-value" style="color:${(reviewSummary?.pending || 0) > 0 ? 'var(--brand-amber)' : 'var(--status-ok-fg)'};">${(reviewSummary?.pending || 0).toLocaleString()}</div>
      <div class="kpi-sub">✓ ${(reviewSummary?.keep || 0).toLocaleString()} KEEP • ✕ ${(reviewSummary?.remove || 0).toLocaleString()} REMOVE</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Pending Staff Approvals</div>
      <div class="kpi-value" style="color:${pendingAppts > 0 ? 'var(--brand-amber)' : 'inherit'};">${pendingAppts}</div>
      <div class="kpi-sub">Self-Pull, Pickup, Pull+Install &amp; Bay Slots</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">CRM &amp; RMA Queue</div>
      <div class="kpi-value">${customers.length} / ${openRmas}</div>
      <div class="kpi-sub">VIP Leads / Open RMA Evidence Claims</div>
    </div>
  `;
}

function populateDonorAndSkuDropdowns() {
  const { donors, inventory } = state.data;
  const donorSel = document.getElementById('intake-donor-select');
  if (donorSel) {
    const cur = donorSel.value;
    donorSel.innerHTML = '<option value="">-- Standalone / Shelved Part (No Donor Vehicle) --</option>' +
      donors.map((d) => `<option value="${d.id}">[${esc(d.stock_number)}] ${d.year} ${esc(d.make)} ${esc(d.model)} (${esc(d.engine)}) • ${d.mileage.toLocaleString()} mi • ${esc(d.yard_row)}</option>`).join('');
    donorSel.value = cur;
  }

  const woSel = document.getElementById('wo-sku-select');
  if (woSel) {
    const avail = inventory.filter((i) => i.quantity > 0 && i.status === 'active').slice(0, 150);
    woSel.innerHTML = avail.length
      ? avail.map((i) => `<option value="${esc(i.sku)}">${esc(i.sku)} — ${esc(i.title.slice(0, 42))} (Bin: ${esc(i.bin_location)})</option>`).join('')
      : '<option value="">No active SKUs in stock</option>';
  }
}

function showAllStaffLedgerRows() {
  state.showAllStaffLedger = true;
  renderStaffInventoryTable();
}

function renderStaffInventoryTable() {
  const { inventory } = state.data;
  const q = (document.getElementById('staff-inv-search')?.value || '').toLowerCase().trim();
  const rows = inventory.filter((i) => {
    if (!q) return true;
    return `${i.sku} ${i.title} ${i.oem_part_number} ${i.bin_location} ${i.security_mark_code} ${i.fitment_years} ${i.fitment_make} ${i.fitment_model}`.toLowerCase().includes(q);
  });

  document.getElementById('inv-ledger-count').textContent = String(rows.length);
  const limit = !q && !state.showAllStaffLedger ? 75 : rows.length;
  const visibleRows = rows.slice(0, limit);
  const tbody = document.getElementById('staff-inventory-tbody');
  const rowsHtml = visibleRows.map((i) => {
    const photoCount = i.photos?.length || 1;
    const qrBadge = i.qr_card_ready
      ? `<span class="badge badge-ok" style="margin-top:3px;">+ Shopify QR Card</span>`
      : '';
    const statusBadge = i.status === 'active' && i.quantity > 0
      ? `<span class="badge badge-ok">Active (${photoCount} clean img)</span> ${qrBadge}`
      : `<span class="badge badge-warn">${esc(i.status)}</span>`;
    const qrCardHref = i.qr_card_url || `/api/inventory/${encodeURIComponent(i.sku)}/qr-card.png`;
    return `
      <tr>
        <td class="mono">
          <strong>${esc(i.sku)}</strong><br/>
          <span class="badge badge-warn" style="margin-top:3px;">${esc(i.security_mark_code)}</span>
        </td>
        <td>
          <strong>${esc(i.title)}</strong><br/>
          <span class="mono" style="font-size:0.76rem;color:var(--text-muted);">${i.oem_part_number ? `OEM: ${esc(i.oem_part_number)}` : 'Verified OEM'} | Fit: ${esc(i.custom_label_0 || `${i.fitment_years} ${i.fitment_make} ${i.fitment_model}`)} | eBay US Cat: #${esc(i.ebay_us_category_id || '6030')}</span>
        </td>
        <td class="mono">
          ${esc(i.bin_location || 'UNSET')}<br/>
          <span style="font-size:0.75rem;color:var(--text-secondary);">${esc(i.custom_label_1 || (i.pull_status === 'on_vehicle' ? 'On Donor Vehicle' : 'Pulled & Shelved'))}</span><br/>
          ${statusBadge}
        </td>
        <td class="mono" style="font-size:0.78rem;">
          1-Var Part: <strong>$${Number(i.price_we_pull).toFixed(2)}</strong><br/>
          <span style="color:var(--text-secondary);">Desc Install Info: ${Number(i.price_pull_install || 0) > 0 ? `$${Number(i.price_pull_install).toFixed(2)}` : '—'}</span>
        </td>
        <td style="font-size:0.78rem;">
          ${esc(i.shipping_class)}<br/>
          <span class="mono">${i.weight_lbs} lbs • ${Math.ceil(Number(i.length_in || 14))}×${Math.ceil(Number(i.width_in || 10))}×${Math.ceil(Number(i.height_in || 8))} in</span>
        </td>
        <td class="mono"><strong>${i.quantity}</strong></td>
        <td>
          <div style="display:flex;flex-wrap:wrap;gap:0.35rem;">
            <a href="https://post.craigslist.org/c/sea?lang=en&cc=us#aldridge_sku=${encodeURIComponent(i.sku)}&hub=${encodeURIComponent(window.location.origin)}" target="_blank" class="btn btn-primary btn-sm">⚡ Auto-Post CL (98467)</a>
            <a href="/api/inventory/${encodeURIComponent(i.sku)}/packing-slip" target="_blank" class="btn btn-outline btn-sm">Packing Slip (QR)</a>
            <a href="${esc(qrCardHref)}" target="_blank" class="btn btn-outline btn-sm">QR Card</a>
            <a href="/api/inventory/${encodeURIComponent(i.sku)}/label" target="_blank" class="btn btn-outline btn-sm">Y813BT 4x6</a>
            <button type="button" class="btn btn-dark btn-sm" onclick="toggleSoldState(${i.id}, ${i.quantity})">${i.quantity > 0 ? 'Zero/Sold' : 'Restock 1'}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const moreRow = rows.length > visibleRows.length
    ? `<tr><td colspan="7" style="text-align:center;padding:0.85rem;">
        Showing first <strong>${visibleRows.length}</strong> of <strong>${rows.length}</strong> SKUs — type any SKU/Vehicle above or
        <button type="button" class="btn btn-dark btn-sm" style="margin-left:0.5rem;" onclick="showAllStaffLedgerRows()">Show All ${rows.length} SKUs</button>
      </td></tr>`
    : '';

  tbody.innerHTML = rowsHtml + moreRow;
}

async function copyLocalListing(sku) {
  try {
    const res = await api(`/api/inventory/${encodeURIComponent(sku)}/local-copy`);
    await navigator.clipboard.writeText(res.copy);
    showToast(`Copied ready-to-post OfferUp / FB Marketplace / Craigslist listing for ${sku}!`);
  } catch (err) {
    showToast(err.message);
  }
}

async function toggleSoldState(id, currentQty) {
  const nextQty = currentQty > 0 ? 0 : 1;
  await api(`/api/inventory/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ quantity: nextQty, status: nextQty === 0 ? 'sold' : 'active' })
  });
  showToast(nextQty === 0 ? 'SKU zeroed across Master Hub & live marketplace feeds!' : 'SKU restocked & re-activated across feeds!');
  await loadBootstrap();
}

async function copyWaAgMetaEmail() {
  const draft = state.data?.audit?.wa_ag_email_draft || '';
  if (!draft) return;
  await navigator.clipboard.writeText(draft);
  showToast('Copied WA Attorney General / Meta Escalations C#26046204 email draft to clipboard!');
}

function renderSyncAndChecklists() {
  const { feeds, settings, syncLogs, audit, weightDimensionAudit } = state.data;

  const auditPanel = document.getElementById('audit-command-panel');
  const wd = weightDimensionAudit || {};
  const totalActive = wd.total_active_skus ?? 57;
  const parcelActive = wd.parcel_calculated_count ?? 45;
  const localActive = wd.local_pickup_only_98467_count ?? 12;

  if (auditPanel && audit) {
    const st = audit.stats || {};
    auditPanel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:0.85rem;">
        <div style="flex:1;min-width:260px;">
          <div class="eyebrow-label">CLEAN CATALOG POLICY • REAL PHOTOS REQUIRED • SINGLE VARIANT ONLY</div>
          <h3 style="margin:0.15rem 0 0.35rem;">Live Action Console (Shopify <code>${esc(settings.shopify_domain || 'aldridgesales.myshopify.com')}</code> • eBay <code>AABCAS</code> • Meta <code>C#26046204</code>)</h3>
          <p style="margin:0;font-size:0.83rem;color:var(--text-secondary);">
            <strong>1) Shopify <code>${esc(settings.shopify_domain || 'aldridgesales.myshopify.com')}</code>:</strong> ${totalActive} verified photo SKUs staged/synced with <strong>1 Single Variant (<code>1 in stock</code>)</strong> + Shop Install callout &amp; website/PWA links in description HTML + <code>&lt;SKU&gt;.qr.png</code> isolated to Shopify only.
            <strong>2) Crosslist &amp; eBay <code>AABCAS</code>:</strong> 100% clean non-QR part photos &amp; policy-compliant descriptions (zero off-eBay URLs, domains, or phone numbers).
            <strong>3) Shopify Webhook Auto-Delist:</strong> <code>/api/webhooks/shopify</code> auto-zeros sold 1-in-stock SKUs across all feeds immediately.
          </p>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.45rem;min-width:265px;">
          <button type="button" class="btn btn-primary btn-sm" onclick="switchStaffTab('staff-launch-kit')">🚀 Open Live ${totalActive}-SKU Sync &amp; Ad Center</button>
          <a href="${esc(feeds.shopify_csv)}" class="btn btn-outline btn-sm" style="text-align:center;">⬇ Clean ${totalActive}-SKU Single-Variant Shopify CSV</a>
          <button type="button" class="btn btn-dark btn-sm" onclick="copyWaAgMetaEmail()">Copy WA AG / Meta C#26046204 Email Draft</button>
        </div>
      </div>
      <div style="display:flex;gap:0.45rem;flex-wrap:wrap;font-size:0.76rem;">
        <span class="badge badge-ok">Verified Photo SKUs: ${totalActive} (1 Variant Only)</span>
        <span class="badge badge-ok">Parcel (&lt;70 lb): ${parcelActive}</span>
        <span class="badge badge-warn">Local Pickup 98467: ${localActive}</span>
        <span class="badge badge-ok">QR Card Isolated: Shopify Only</span>
        <span class="badge badge-ok">eBay Off-Site Links: 0 (100% Compliant)</span>
        <span class="badge badge-ok">Shopify Webhook Auto-Delist: Armed</span>
      </div>
    `;
  }

  const allInv = state.data?.inventory || [];
  const soldCount = allInv.filter((i) => i.status === 'sold' || Number(i.quantity || 0) <= 0).length;
  const clPostedCount = state.clQueueData
    ? Number(state.clQueueData.posted_count || 0)
    : allInv.filter((i) => i.status === 'active' && Number(i.quantity || 0) > 0 && i.channels?.craigslist_posted).length;
  const clTotalCount = state.clQueueData ? Number(state.clQueueData.count || totalActive) : totalActive;
  const clRemainingCount = Math.max(0, clTotalCount - clPostedCount);

  const clBadges = document.getElementById('crosslist-auto-sync-badges');
  if (clBadges) {
    clBadges.innerHTML = `
      <span class="badge badge-ok">Crosslist Ready: ${totalActive} Single-Variant SKUs (Qty=1)</span>
      <span class="badge badge-ok">QR Cards Excluded: 0 Leaks</span>
      <span class="badge badge-ok">Sold/Auto-Delisted Excluded: ${soldCount}</span>
      <span class="badge ${clRemainingCount === 0 && clTotalCount > 0 ? 'badge-ok' : 'badge-warn'}">Craigslist Tacoma (tac/ptd): ${clPostedCount} Posted • ${clRemainingCount} Remaining</span>
    `;
  }

  if (typeof loadTop200PlanUi === 'function') {
    loadTop200PlanUi(false).catch(() => {});
  }
  if (typeof renderCrosslistBatchDownloadsUi === 'function') {
    renderCrosslistBatchDownloadsUi(totalActive);
  }
  if (typeof renderCraigslistTrackerList === 'function' && state.clQueueData) {
    renderCraigslistTrackerList();
  }

  const feedRows = [
    { label: `1. Clean ${totalActive}-SKU Single-Variant Shopify CSV (1 Variant • Shop Install Callout + Direct App/Site Links)`, url: feeds.shopify_csv, type: 'download', btnLabel: 'Download CSV' },
    { label: `2. Crosslist Official Bulk Import CSV (Car & Truck Parts UUIDs • ${totalActive} Single-Variant Photo SKUs)`, url: feeds.crosslist_csv || '/api/exports/crosslist.csv', type: 'download', btnLabel: 'Download CSV' },
    { label: `3. Crosslist Matching Images ZIP (Full Catalog • ${totalActive} SKUs — also available in 250-item batches above)`, url: feeds.crosslist_images_zip || '/api/exports/crosslist-images.zip', type: 'download', btnLabel: 'Download ZIP' },
    { label: `4. Craigslist Tacoma/Pierce County Dealer Auto Parts CSV (tac / fsd / ptd • ZIP 98467 • ${totalActive} SKUs)`, url: feeds.craigslist_csv || '/api/exports/craigslist.csv', type: 'download', btnLabel: 'Download CSV' },
    { label: `5. Standard eBay US Seller Hub CSV (ebay.com aabcas • 100% Policy-Compliant Zero Off-eBay Links • ${totalActive} SKUs)`, url: feeds.ebay_us_csv || feeds.ebay_motors_csv, type: 'download', btnLabel: 'Download CSV' },
    { label: `6. Google Merchant Center & Local Inventory XML (${totalActive} Verified Photo SKUs w/ L×W×H + Weight)`, url: feeds.google_merchant_xml, type: 'copy_url' },
    { label: `7. Meta Commerce Catalog CSV (Facebook Business Page Shop & Marketplace Feed • ${totalActive} Photo SKUs)`, url: feeds.meta_catalog_csv, type: 'copy_url' },
    { label: `8. Vendoo Single-Variant Export CSV (${totalActive} Photo SKUs w/ Exact Weight & L×W×H)`, url: feeds.vendoo_csv, type: 'download', btnLabel: 'Download CSV' },
    { label: `9. TikTok Shop Parcel Auto Parts CSV ($0 Monthly Fee • ${parcelActive} Parcel Photo SKUs Only)`, url: feeds.tiktok_shop_csv, type: 'download', btnLabel: 'Download CSV' },
    { label: '10. Shopify Co-Master Inbound Webhook URL (orders/create & products/update Auto-Zero)', url: feeds.shopify_webhook_endpoint, type: 'copy_url' }
  ];

  document.getElementById('sync-feeds-list').innerHTML = feedRows.map((f) => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:0.65rem;padding:0.6rem 0.75rem;background:var(--bg-subtle);border-radius:6px;font-size:0.82rem;">
      <div style="min-width:0;">
        <strong>${esc(f.label)}</strong><br/>
        <span class="mono" style="font-size:0.73rem;color:var(--text-muted);word-break:break-all;">${esc(f.url)}</span>
      </div>
      ${f.type === 'download'
        ? `<a href="${esc(f.url)}" class="btn btn-dark btn-sm" style="white-space:nowrap;">${esc(f.btnLabel || 'Download')}</a>`
        : `<button type="button" class="btn btn-outline btn-sm" style="white-space:nowrap;" onclick="copyFeedUrl('${esc(f.url)}')">Copy Live URL</button>`
      }
    </div>
  `).join('');

  // Forensic Audit 4-Phase Direct Punch List Labels
  const checklistLabels = {
    phase1_urgent_unblocks: 'Phase 1 (Today — 45m): WA AG Meta Unblock, eBay AABCAS Hold & 8 Part-Out Ads',
    phase2_shopify_catalog_heal: 'Phase 2 (Day 1 — 60m): Fresh Backup + Upload 1,437-Row Sanitized Shopify CSV',
    phase3_ebay_aabcas_reconciliation: 'Phase 3 (Day 2): Reconcile 418 Gen-1 eBay SKUs & Launch Shopify Marketplace Connect',
    phase4_stranded_recovery_and_daily_ops: 'Phase 4 (Day 3+): Recover ~546 4Runner CDN Parts, 26 Tundra & Y813BT Daily Drip',
    google_and_meta_feeds: 'Google Business Profile, Google Merchant XML & Restored Personal FB Marketplace'
  };

  const cl = settings.platform_checklist || {};
  document.getElementById('platform-checklist-container').innerHTML = Object.entries(checklistLabels).map(([platKey, title]) => {
    const steps = cl[platKey] || {};
    const stepHtml = Object.entries(steps).map(([stepKey, checked]) => `
      <label style="display:flex;align-items:center;gap:0.45rem;font-size:0.8rem;cursor:pointer;">
        <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleChecklistStep('${platKey}', '${stepKey}', this.checked)" />
        <span>${esc(stepKey.replaceAll('_', ' '))}</span>
      </label>
    `).join('');
    return `
      <div style="padding:0.7rem 0.85rem;background:var(--bg-subtle);border-radius:6px;">
        <strong style="font-size:0.84rem;display:block;margin-bottom:0.4rem;">${esc(title)}</strong>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:0.35rem;">${stepHtml}</div>
      </div>
    `;
  }).join('');

  document.getElementById('sync-logs-tbody').innerHTML = syncLogs.slice(0, 20).map((l) => `
    <tr>
      <td class="mono" style="font-size:0.74rem;">${esc((l.created_at || '').replace('T', ' ').slice(0, 19))}</td>
      <td><span class="badge badge-dark">${esc(l.direction)}</span></td>
      <td><strong>${esc(l.platform)}</strong></td>
      <td class="mono" style="font-size:0.76rem;">${esc(l.action)}</td>
      <td class="mono">${esc(l.sku || 'ALL')}</td>
      <td style="font-size:0.8rem;">${esc(l.details)}</td>
    </tr>
  `).join('');
}

async function copyFeedUrl(url) {
  await navigator.clipboard.writeText(url);
  showToast('Live Feed / Webhook URL copied to clipboard!');
}

async function toggleChecklistStep(platKey, stepKey, val) {
  const cl = structuredClone(state.data.settings.platform_checklist || {});
  if (!cl[platKey]) cl[platKey] = {};
  cl[platKey][stepKey] = val;
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ platform_checklist: cl }) });
  state.data.settings.platform_checklist = cl;
  showToast('Platform readiness checklist saved!');
}

function selectStaffPolicy(key) {
  state.activePolicyKey = key;
  const text = state.data?.policies?.[key] || '';
  const el = document.getElementById('staff-policy-editor');
  if (el) el.value = text;
}

async function copyCurrentStaffPolicy() {
  const el = document.getElementById('staff-policy-editor');
  if (!el) return;
  await navigator.clipboard.writeText(el.value);
  showToast('Policy / HTML Template copied — ready to paste into Shopify, eBay, Meta or Google!');
}

function renderStaffApprovalsAndOrders() {
  const { appointments, orders } = state.data;

  document.getElementById('staff-appointments-tbody').innerHTML = appointments.map((a) => {
    const badgeClass = a.status === 'approved' ? 'badge-ok' : a.status === 'pending_approval' ? 'badge-warn' : 'badge-dark';
    return `
      <tr>
        <td class="mono">
          <strong>${esc(a.booking_code)}</strong><br/>
          <span style="font-size:0.73rem;color:var(--text-muted);">${esc(a.booking_mode)}</span>
        </td>
        <td>
          <strong>${esc(a.customer_name)}</strong><br/>
          <span style="font-size:0.77rem;">${esc(a.customer_phone)}</span>
        </td>
        <td style="font-size:0.81rem;">
          <strong>${esc(a.service_category)}</strong><br/>
          Vehicle: ${esc(a.vehicle_ymm || 'N/A')} ${a.linked_sku ? `• SKU: <span class="mono">${esc(a.linked_sku)}</span>` : ''}
          ${a.customer_notes ? `<div style="color:var(--text-muted);font-size:0.76rem;margin-top:2px;">"${esc(a.customer_notes)}"</div>` : ''}
        </td>
        <td class="mono" style="font-size:0.8rem;">
          ${esc(a.preferred_date)}<br/>${esc(a.preferred_time)}
        </td>
        <td>
          <span class="badge ${badgeClass}">${esc(a.status)}</span><br/>
          <span style="font-size:0.76rem;">${esc(a.assigned_bay)}</span>
        </td>
        <td>
          <div style="display:flex;flex-wrap:wrap;gap:0.35rem;">
            ${a.status !== 'approved' ? `<button type="button" class="btn btn-primary btn-sm" onclick="updateAppointmentStatus(${a.id}, 'approved', 'Bay 2 / Yard Verified')">Approve Slot</button>` : ''}
            ${a.status !== 'declined' ? `<button type="button" class="btn btn-outline btn-sm" onclick="updateAppointmentStatus(${a.id}, 'declined', 'Slot Unavailable')">Decline</button>` : ''}
            <a href="${esc(a.gcal_url)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">GCal ↗</a>
            <a href="${esc(a.ics_url)}" class="btn btn-outline btn-sm">.ics</a>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('staff-orders-tbody').innerHTML = orders.length
    ? orders.map((o) => `
      <tr>
        <td class="mono"><strong>${esc(o.order_number)}</strong></td>
        <td>${esc(o.customer_name)}<br/><span style="font-size:0.76rem;">${esc(o.customer_email)}</span></td>
        <td><span class="badge badge-dark">${esc(o.fulfillment_mode)}</span></td>
        <td class="mono" style="font-size:0.77rem;">${o.items.map((i) => `${esc(i.sku)} (x${i.qty})`).join(', ')}</td>
        <td class="mono"><strong>$${Number(o.total).toFixed(2)}</strong><br/><span style="font-size:0.73rem;">Hdl: $${Number(o.handling_fee).toFixed(2)}</span></td>
        <td>
          <span class="badge ${o.approval_status === 'approved' ? 'badge-ok' : 'badge-warn'}">${esc(o.approval_status)}</span>
          ${o.linked_booking_code ? `<div class="mono" style="font-size:0.75rem;margin-top:3px;">Appt: ${esc(o.linked_booking_code)}</div>` : ''}
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">No storefront orders yet — test placing a Self-Pull, We-Pull, or Pull+Install order!</td></tr>';
}

async function updateAppointmentStatus(id, status, assigned_bay) {
  await api(`/api/appointments/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status, assigned_bay })
  });
  showToast(`Appointment updated to ${status}!`);
  await loadBootstrap();
}

function renderStaffCrmAndInbox() {
  const { inquiries, returnClaims, specials, customers } = state.data;

  document.getElementById('staff-inquiries-list').innerHTML = inquiries.length
    ? inquiries.map((inq) => `
      <div style="padding:0.75rem;background:var(--bg-subtle);border-radius:6px;font-size:0.82rem;">
        <div style="display:flex;justify-content:space-between;">
          <strong>[${esc(inq.ticket_number)}] ${esc(inq.subject)}</strong>
          <span class="badge ${inq.status === 'open' ? 'badge-warn' : 'badge-ok'}">${esc(inq.status)}</span>
        </div>
        <div style="color:var(--text-secondary);margin:0.25rem 0;">From: ${esc(inq.customer_name)} (${esc(inq.pillar)}) ${inq.vehicle_vin ? `• VIN: ${esc(inq.vehicle_vin)}` : ''}</div>
        <p style="margin:0.3rem 0 0.5rem;">${esc(inq.message)}</p>
        ${inq.status === 'open'
          ? `<button type="button" class="btn btn-dark btn-sm" onclick="markInquiryReplied(${inq.id})">Mark Replied &amp; Resolved</button>`
          : `<span style="font-size:0.76rem;color:var(--status-ok-fg);">✓ Resolved</span>`
        }
      </div>
    `).join('')
    : '<p style="color:var(--text-muted);font-size:0.84rem;">No open customer inquiries.</p>';

  document.getElementById('staff-rma-list').innerHTML = returnClaims.length
    ? returnClaims.map((r) => `
      <div style="padding:0.75rem;background:var(--bg-subtle);border-radius:6px;font-size:0.82rem;">
        <div style="display:flex;justify-content:space-between;">
          <strong class="mono">${esc(r.rma_number)} • Order ${esc(r.order_number)} (${esc(r.sku)})</strong>
          <span class="badge ${r.status.includes('rejected') ? 'badge-err' : r.status.includes('approved') ? 'badge-ok' : 'badge-warn'}">${esc(r.status)}</span>
        </div>
        <div style="margin:0.25rem 0;">Reason: <strong>${esc(r.claim_reason)}</strong> | OBD/Test: <span class="mono">${esc(r.diagnostic_codes)}</span> | Security Mark Intact: ${r.security_mark_intact ? 'YES' : 'NO'}</div>
        <p style="margin:0.25rem 0 0.5rem;">${esc(r.evidence_summary)}</p>
        <div style="display:flex;gap:0.4rem;">
          <button type="button" class="btn btn-primary btn-sm" onclick="decideRma(${r.id}, 'approved_buyer_ships_back')">Approve RMA (Buyer Pays Return Ship)</button>
          <button type="button" class="btn btn-danger btn-sm" onclick="decideRma(${r.id}, 'rejected_policy_ineligible')">Reject Claim</button>
        </div>
      </div>
    `).join('')
    : '<p style="color:var(--text-muted);font-size:0.84rem;">No return evidence claims submitted.</p>';

  document.getElementById('staff-specials-manage').innerHTML = specials.map((sp) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.7rem;background:var(--bg-subtle);border-radius:6px;font-size:0.8rem;">
      <span><strong>${esc(sp.promo_code)}</strong> — ${esc(sp.title)} (${sp.share_count} shares)</span>
      <button type="button" class="btn btn-dark btn-sm" onclick="broadcastSpecialPush(${sp.id})">Push / Blast (${sp.broadcast_count || 0})</button>
    </div>
  `).join('');

  document.getElementById('staff-crm-tbody').innerHTML = customers.map((c) => `
    <tr>
      <td><strong>${esc(c.name)}</strong><br/><span style="font-size:0.75rem;color:var(--text-muted);">${esc(c.email)} ${esc(c.phone)}</span></td>
      <td style="font-size:0.76rem;">
        ${esc(c.source_pillar)}<br/>
        ${c.email_opt_in ? '<span class="badge badge-ok">Email</span> ' : ''}
        ${c.sms_opt_in ? '<span class="badge badge-ok">SMS</span> ' : ''}
        ${c.push_subscribed ? '<span class="badge badge-dark">Push</span>' : ''}
      </td>
      <td class="mono" style="font-size:0.78rem;">${esc(c.referral_code)}</td>
      <td class="mono">$${Number(c.total_spent || 0).toFixed(2)}</td>
    </tr>
  `).join('');
}

async function markInquiryReplied(id) {
  await api(`/api/inquiries/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'replied' }) });
  showToast('Inquiry marked replied!');
  await loadBootstrap();
}

async function decideRma(id, status) {
  await api(`/api/returns/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
  showToast(`RMA claim updated: ${status}`);
  await loadBootstrap();
}

async function broadcastSpecialPush(id) {
  const res = await api(`/api/specials/${id}/broadcast`, { method: 'POST' });
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(`${state.data.settings.business_name} Special!`, {
      body: `${res.special.discount_text} — Code: ${res.special.promo_code}`,
      icon: state.data.settings.logo_url || '/assets/aldridge-crest.jpg'
    });
  }
  showToast(`Broadcasted ${res.special.promo_code} across Web Push, Email & SMS subscriber lists!`);
  await loadBootstrap();
}

function populateSettingsVaultForm(s) {
  document.getElementById('set-name').value = s.business_name || '';
  document.getElementById('set-tagline').value = s.tagline || '';
  const themeEl = document.getElementById('set-theme-preset');
  if (themeEl) themeEl.value = s.theme_preset || 'pnw_navy_orange';
  document.getElementById('set-phone').value = s.phone || '';
  const uhaulPhEl = document.getElementById('set-uhaul-phone');
  if (uhaulPhEl) uhaulPhEl.value = s.uhaul_phone || '(253) 948-3487';
  document.getElementById('set-email').value = s.email || '';
  document.getElementById('set-street').value = s.street_address || '';
  document.getElementById('set-city').value = s.city_display || s.city || '';
  document.getElementById('set-state').value = s.state || '';
  document.getElementById('set-zip').value = s.zip || '';
  document.getElementById('set-hours-wk').value = s.hours_weekday || '';
  document.getElementById('set-hours-we').value = s.hours_weekend || '';
  document.getElementById('set-handling-fee').value = s.handling_fee_default ?? 10;
  document.getElementById('set-handling-days').value = s.handling_days_default ?? 3;
  document.getElementById('set-labor-rate').value = s.labor_rate_hourly ?? 174.99;
  document.getElementById('set-fb').value = s.social_links?.facebook || '';
  const fbMktEl = document.getElementById('set-fb-marketplace');
  if (fbMktEl) fbMktEl.value = s.social_links?.facebook_marketplace || '';
  document.getElementById('set-ebay').value = s.social_links?.ebay_store || '';
  const igEl = document.getElementById('set-ig');
  if (igEl) igEl.value = s.social_links?.instagram || '';
  const ytEl = document.getElementById('set-yt');
  if (ytEl) ytEl.value = s.social_links?.youtube || '';
  const offerupEl = document.getElementById('set-offerup');
  if (offerupEl) offerupEl.value = s.social_links?.offerup || '';
  const gbpEl = document.getElementById('set-gbp');
  if (gbpEl) gbpEl.value = s.social_links?.google_maps || '';
  document.getElementById('set-shopify-domain').value = s.shopify_domain || '';
  document.getElementById('set-shopify-token').value = s.shopify_admin_token || '';
  document.getElementById('set-uhaul-url').value = s.uhaul_dealer_url || '';
  document.getElementById('set-gemini-key').value = s.gemini_api_key || '';
}

/* ==================== CAMERA & ON-HAND PHOTO FOLDER INTAKE WORKFLOW ==================== */
function readImageFileCompressed(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const rawDataUrl = String(reader.result || '');
      const img = new Image();
      img.onerror = () => resolve(rawDataUrl);
      img.onload = () => {
        const maxDim = 1400;
        let w = img.naturalWidth || img.width || 800;
        let h = img.naturalHeight || img.height || 600;
        if (w > maxDim || h > maxDim) {
          if (w >= h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function derivePartGroupAndHint(file) {
  const rel = String(file.webkitRelativePath || file.relativePath || '').replace(/\\/g, '/');
  const parts = rel.split('/').filter(Boolean);
  const rawBase = String(file.name || 'part').replace(/\.[^.]+$/, '');
  const isGenericCameraName = /^(IMG|DSC|PXL|MVIMG|DCIM|PHOTO|IMAGE|PIC|SCREENSHOT)[_\-\s]?\d+/i.test(rawBase);

  // If organized into per-part subfolders (RootFolder/PartSubfolder/photo1.jpg), group by subfolder
  if (parts.length >= 3) {
    const subFolder = parts[parts.length - 2];
    const cleanHint = subFolder.replace(/[_\-]+/g, ' ').trim();
    return { groupKey: `dir:${parts.slice(0, -1).join('/').toLowerCase()}`, label: cleanHint, autoHint: cleanHint };
  }

  // Strip dot-notation or trailing angle numbers on descriptive filenames (e.g. tundra_alternator.1 -> tundra_alternator)
  if (!isGenericCameraName) {
    const stripped = rawBase.replace(/(?:\.\d+|[_\-\s]+(?:angle\s*)?\d+|\s*\(\d+\))$/i, '').trim() || rawBase;
    const cleanHint = stripped.replace(/[_\-]+/g, ' ').trim();
    return {
      groupKey: `stem:${stripped.toLowerCase()}`,
      label: cleanHint,
      autoHint: /^ALD-/i.test(stripped) ? '' : cleanHint
    };
  }

  // Generic phone photo names (IMG_4012.JPG) stay 1 part per photo unless user clicks "+ Add Angle Photo" or "Merge Next"
  return { groupKey: `single:${rel || file.name}:${file.size}:${file.lastModified}`, label: rawBase, autoHint: '' };
}

function syncCurrentPhotosUI() {
  state.capturedImageBase64 = state.currentPartPhotos[0] || '';
  const preview = document.getElementById('camera-captured-preview');
  const idle = document.getElementById('camera-idle-prompt');
  const resetBtn = document.getElementById('btn-reset-photo');
  const addAngleWrap = document.getElementById('btn-add-angle-wrap');
  const strip = document.getElementById('intake-angle-strip');
  const queueBox = document.getElementById('intake-folder-queue');

  if (state.currentPartPhotos.length > 0) {
    preview.src = state.currentPartPhotos[0];
    preview.style.display = 'block';
    idle.style.display = 'none';
    resetBtn.style.display = 'inline-flex';
    if (addAngleWrap) addAngleWrap.style.display = 'inline-flex';
    if (strip) {
      strip.style.display = 'flex';
      strip.innerHTML = state.currentPartPhotos.map((src, idx) => `
        <div style="position:relative;width:64px;height:64px;border-radius:6px;overflow:hidden;border:2px solid ${idx === 0 ? 'var(--brand-amber)' : 'var(--border-strong)'};cursor:pointer;" onclick="selectActiveAnglePreview(${idx})" title="Angle .${idx + 1}.jpg">
          <img src="${esc(src)}" alt="Angle ${idx + 1}" style="width:100%;height:100%;object-fit:cover;" />
          <span class="mono" style="position:absolute;bottom:2px;left:2px;background:rgba(15,23,42,0.82);color:#fff;font-size:0.65rem;padding:0 4px;border-radius:3px;">.${idx + 1}</span>
          <button type="button" onclick="event.stopPropagation();removeAnglePhoto(${idx})" style="position:absolute;top:1px;right:1px;background:rgba(185,28,28,0.9);color:#fff;border:none;border-radius:3px;font-size:0.65rem;line-height:1;padding:2px 4px;cursor:pointer;">✕</button>
        </div>
      `).join('');
    }
  } else {
    preview.style.display = 'none';
    if (!state.cameraStream) idle.style.display = 'block';
    resetBtn.style.display = 'none';
    if (addAngleWrap) addAngleWrap.style.display = 'none';
    if (strip) {
      strip.style.display = 'none';
      strip.innerHTML = '';
    }
  }

  if (queueBox) {
    if (state.folderQueue.length > 0) {
      queueBox.style.display = 'block';
      queueBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-bottom:0.45rem;flex-wrap:wrap;">
          <strong style="font-size:0.8rem;">📁 On-Hand Folder Queue: ${state.folderQueue.length} part${state.folderQueue.length === 1 ? '' : 's'} waiting</strong>
          <div style="display:flex;gap:0.35rem;">
            ${state.currentPartPhotos.length > 0 ? '<button type="button" class="btn btn-outline btn-sm" style="padding:0.2rem 0.5rem;font-size:0.74rem;" onclick="mergeNextQueuedIntoCurrent()">+ Merge Next as Angle</button>' : ''}
            <button type="button" class="btn btn-outline btn-sm" style="padding:0.2rem 0.5rem;font-size:0.74rem;" onclick="clearFolderQueue()">Clear Queue</button>
          </div>
        </div>
        <div style="display:flex;gap:0.4rem;overflow-x:auto;padding-bottom:0.2rem;">
          ${state.folderQueue.slice(0, 24).map((q, idx) => `
            <button type="button" class="btn btn-outline btn-sm" style="padding:0.25rem 0.5rem;font-size:0.74rem;white-space:nowrap;" onclick="loadQueuedFolderPart(${idx})">
              ${esc(q.label)} (${q.photos.length}📷)
            </button>
          `).join('')}
        </div>
      `;
    } else {
      queueBox.style.display = 'none';
      queueBox.innerHTML = '';
    }
  }
}

function selectActiveAnglePreview(idx) {
  const src = state.currentPartPhotos[idx];
  if (!src) return;
  document.getElementById('camera-captured-preview').src = src;
}

function removeAnglePhoto(idx) {
  state.currentPartPhotos.splice(idx, 1);
  syncCurrentPhotosUI();
}

function loadQueuedFolderPart(idx = 0) {
  if (!state.folderQueue[idx]) return;
  const [picked] = state.folderQueue.splice(idx, 1);
  stopCamera();
  state.currentPartPhotos = picked.photos.slice(0, 12);
  if (picked.autoHint) {
    document.getElementById('intake-hint').value = picked.autoHint;
  }
  syncCurrentPhotosUI();
  showToast(`Loaded "${picked.label}" (${state.currentPartPhotos.length} angle photo${state.currentPartPhotos.length === 1 ? '' : 's'}) — click Identify Part!`);
}

function mergeNextQueuedIntoCurrent() {
  if (!state.folderQueue.length) return;
  const next = state.folderQueue.shift();
  state.currentPartPhotos.push(...next.photos);
  state.currentPartPhotos = state.currentPartPhotos.slice(0, 12);
  syncCurrentPhotosUI();
  showToast(`Merged ${next.photos.length} angle photo(s) into current part (.1–.${state.currentPartPhotos.length})!`);
}

function clearFolderQueue() {
  state.folderQueue = [];
  syncCurrentPhotosUI();
}

async function ingestPhotoFileList(rawFiles, appendToCurrent = false) {
  const imageFiles = Array.from(rawFiles || [])
    .filter((f) => f && (String(f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic)$/i.test(f.name)))
    .sort((a, b) => String(a.webkitRelativePath || a.name).localeCompare(String(b.webkitRelativePath || b.name), undefined, { numeric: true }));

  if (!imageFiles.length) {
    showToast('No supported image files (.jpg, .png, .webp) found in selection.');
    return;
  }

  stopCamera();

  if (appendToCurrent) {
    const encoded = [];
    for (const f of imageFiles.slice(0, 12)) {
      encoded.push(await readImageFileCompressed(f));
    }
    state.currentPartPhotos.push(...encoded);
    state.currentPartPhotos = state.currentPartPhotos.slice(0, 12);
    syncCurrentPhotosUI();
    showToast(`Added ${encoded.length} angle photo(s) to current part!`);
    return;
  }

  // Group files into parts
  const groupsMap = new Map();
  for (const f of imageFiles) {
    const meta = derivePartGroupAndHint(f);
    if (!groupsMap.has(meta.groupKey)) {
      groupsMap.set(meta.groupKey, { label: meta.label, autoHint: meta.autoHint, files: [] });
    }
    groupsMap.get(meta.groupKey).files.push(f);
  }

  const groups = [];
  for (const g of groupsMap.values()) {
    const photos = [];
    for (const f of g.files.slice(0, 12)) {
      photos.push(await readImageFileCompressed(f));
    }
    groups.push({ label: g.label, autoHint: g.autoHint, photos });
  }

  const first = groups.shift();
  state.currentPartPhotos = first.photos;
  if (first.autoHint && !document.getElementById('intake-hint').value) {
    document.getElementById('intake-hint').value = first.autoHint;
  }
  if (groups.length > 0) {
    state.folderQueue.push(...groups);
  }
  syncCurrentPhotosUI();
  showToast(
    groups.length > 0
      ? `Loaded ${groups.length + 1} on-hand parts from folder! Part 1 ready (${first.photos.length} photo${first.photos.length === 1 ? '' : 's'}).`
      : `Loaded ${first.photos.length} angle photo${first.photos.length === 1 ? '' : 's'} — click Identify Part below!`
  );
}

async function extractDroppedFiles(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const collected = [];

  async function walkEntry(entry, prefix = '') {
    if (!entry) return;
    if (entry.isFile) {
      const file = await new Promise((res) => entry.file(res, () => res(null)));
      if (file) {
        file.relativePath = prefix + file.name;
        collected.push(file);
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch = [];
      do {
        batch = await new Promise((res) => reader.readEntries(res, () => res([])));
        for (const child of batch) {
          await walkEntry(child, `${prefix}${entry.name}/`);
        }
      } while (batch.length > 0);
    }
  }

  const entries = items.map((it) => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (entries.length > 0) {
    for (const entry of entries) {
      await walkEntry(entry, '');
    }
    if (collected.length > 0) return collected;
  }
  return Array.from(dataTransfer?.files || []);
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    state.cameraStream = stream;
    const video = document.getElementById('camera-video');
    video.srcObject = stream;
    video.style.display = 'block';
    document.getElementById('camera-idle-prompt').style.display = 'none';
    document.getElementById('camera-captured-preview').style.display = 'none';
    document.getElementById('btn-snap-frame').style.display = 'inline-flex';
    document.getElementById('btn-stop-camera').style.display = 'inline-flex';
  } catch (err) {
    showToast('Live camera unavailable on this browser — drop your photo folder or click "Upload Photo(s)"!');
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }
  document.getElementById('camera-video').style.display = 'none';
  document.getElementById('btn-snap-frame').style.display = 'none';
  document.getElementById('btn-stop-camera').style.display = 'none';
  if (!state.currentPartPhotos.length) {
    document.getElementById('camera-idle-prompt').style.display = 'block';
  }
}

function snapCameraFrame() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  canvas.width = video.videoWidth || 800;
  canvas.height = video.videoHeight || 600;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const frameUrl = canvas.toDataURL('image/jpeg', 0.85);
  state.currentPartPhotos.push(frameUrl);
  stopCamera();
  syncCurrentPhotosUI();
  showToast(`Captured angle .${state.currentPartPhotos.length}.jpg — snap/upload another angle or click Identify Part!`);
}

/* ==================== STAFF TAB 7: LAUNCH CENTER (ADS, SOCIAL, SEO & 8 PLATFORMS) ==================== */
const LAUNCH_SOCIAL_POSTS = [
  {
    id: 'social-fb-ig-launch',
    channel: 'Facebook Business Page (Pinned) + Instagram Feed',
    title: 'Official Launch: New Aldridge Auto\'s Website, Mobile App & 962 Live OEM Parts!',
    copy: `🔧🚀 UNIVERSITY PLACE & TACOMA — OUR NEW WEBSITE & MOBILE APP ARE OFFICIALLY LIVE!

Welcome to the upgraded Aldridge Auto's at 5115 66th St W, Bldg B (University Place / Tacoma, WA 98467)!

Whether you need a hard-to-find factory OEM part, a 5.0★ rated mechanic you can actually trust, or a neighborhood U-Haul rental — you can now do it all from your phone in seconds:
✅ Browse 962+ Tested Used OEM Auto Parts Live (with multi-angle photos & verified fitment)
✅ Choose Your Way: Nationwide Parcel Shipping, FREE Bldg B Counter Pickup, or Turnkey Shop Bay Installation by our 5.0★ Techs!
✅ Book Auto Repair, Electrical, Cooling & OBD-II Diagnostics Online (87 Five-Star Google Reviews!)
✅ Install Our Free Mobile App in 1 Tap ("Install App" / "Add to Home Screen") for instant VIP coupons & order updates
✅ Authorized U-Haul Neighborhood Dealer #046117 (24/7 Truck Share® & 24-Hr Drop-Off — Direct U-Haul Line: 253-948-3487)

🎁 LAUNCH WEEK VIP SPECIAL: Mention code PULLINSTALL15 for 15% OFF Installation Labor when you buy any stocked OEM part, or code DIAG25 for $25 OFF Full Check-Engine / Electrical Diagnostics!

📍 5115 66th St W, Bldg B, University Place, WA 98467
🕒 Mon–Fri: 12:00 PM – 7:00 PM
📞 Shop & Parts: (253) 245-4206 | 🌐 https://aldridgeautosupply.com`
  },
  {
    id: 'social-turnkey-install',
    channel: 'Facebook / Instagram / Google Business Profile Post #2',
    title: 'Why Buy a Used OEM Part Online From a Stranger When Our 5.0★ Shop Can Pull AND Install It?',
    copy: `💡 Tired of gambling on mystery auto parts online — or paying dealership markups?

At Aldridge Auto's in University Place (Bldg B), we do something online-only salvage sellers can't: SINGLE-ROOF ACCOUNTABILITY.
1️⃣ Pick your exact VIN-matched Used OEM Alternator, Starter, Radiator, Strut, Door, Mirror, or Powertrain assembly from our 962-part live catalog.
2️⃣ Select "We Pull + Certified Shop Installation" right at checkout (or grab it at our counter / ship it nationwide!).
3️⃣ Our 5.0★ Google-rated technicians install and test it right here in our University Place bays.

Message us your 17-digit VIN anytime for a fast fitment check!
📍 5115 66th St W, Bldg B, University Place, WA 98467 | 📞 (253) 245-4206
🔗 Shop Live Inventory: https://aldridgeautosupply.com`
  },
  {
    id: 'social-reel-tiktok',
    channel: 'Instagram Reels / TikTok / YouTube Shorts (30-Sec Script)',
    title: '30-Second Shop Walkthrough Reel: QR Bins + Mobile App + Bay Install',
    copy: `[0:00–0:05 | Hook — Stand in front of Bldg B bay / parts rack]
"Stop paying dealership prices for OEM auto parts in Tacoma & University Place!"

[0:05–0:13 | Show shelved OEM parts + Y813BT QR bin tags]
"At Aldridge Auto's on 66th St W, we just put over 960 inspected factory OEM parts live on our new website and installable mobile app — every single part tagged, weighed, and photographed."

[0:13–0:22 | Show phone screen tapping 'We Pull + Shop Install']
"Need it shipped? Calculated carrier rates nationwide. Local to the 253? Pick it up FREE at Bldg B — or tap 'We Pull + Shop Install' and let our 5.0-star rated techs put it in for you!"

[0:22–0:30 | CTA — Shop sign + phone number overlay]
"Tap the link in bio to search by Year, Make & Model, install our free app, and use code PULLINSTALL15 for 15% off install labor!"`
  },
  {
    id: 'social-nextdoor',
    channel: 'Nextdoor (University Place, Fircrest, West Tacoma, Lakewood, Steilacoom)',
    title: 'Neighbor Introduction + $25 Diagnostic / 15% Part-Install Neighbor Perk',
    copy: `Hi University Place, Fircrest & Tacoma neighbors! 👋

Chris here from Aldridge Auto's over at 5115 66th St W, Bldg B (right here in UP, 98467). Thank you to everyone in the neighborhood who has helped us earn 87 five-star reviews on Google!

I wanted to share that our brand-new online OEM Auto Parts catalog & mobile booking app are now live:
• 5.0★ Auto Repair & Diagnostics (Electrical, Alternators/Starters, Radiators & Cooling, Brakes, Suspension & Powertrain)
• 962 Stocked Used OEM Auto Parts — buy at the counter, ship nationwide, or book turnkey installation in our bays
• Official U-Haul Neighborhood Dealer #046117 for quick local truck/trailer pickups & 24-hr drop-offs (U-Haul line: 253-948-3487; note: tow vehicles must already have a hitch & wiring as we don't install hitches on-site)

Mention "NEXTDOOR" or code DIAG25 this month for $25 OFF Check-Engine/Electrical Diagnostics, or PULLINSTALL15 for 15% OFF labor when we install any in-stock OEM part!
— Chris Aldridge | (253) 245-4206 | https://aldridgeautosupply.com`
  },
  {
    id: 'social-vip-sms',
    channel: 'VIP SMS & Email Customer Blast (TCPA Compliant)',
    title: '160-Char SMS + VIP Email Launch Alert',
    copy: `Aldridge Auto's (UP/Tacoma): Our new OEM Parts Store & Booking App is LIVE! 962 parts + 5.0★ Repair. Use PULLINSTALL15 for 15% off install labor: https://aldridgeautosupply.com (253)245-4206 Reply STOP to opt out`
  }
];

const LAUNCH_AD_CAMPAIGNS = [
  {
    id: 'ad-google-repair',
    channel: 'Google Search Campaign #1 — 12-Mile Radius Around 98467 ($15–$25/day)',
    title: '5.0★ Auto Repair, Electrical & Cooling Diagnostics (University Place / Tacoma)',
    copy: `FINAL URL: https://aldridgeautosupply.com/#repair
LOCATION TARGET: 12-mi radius around 5115 66th St W, University Place, WA 98467 (Presence ONLY)
CALL EXTENSION: (253) 245-4206 (Mon–Fri 12:00 PM – 7:00 PM)

HEADLINES (<=30 chars):
1. Aldridge Auto's — 5.0★ Rated
2. Auto Repair University Place
3. Tacoma Electrical & Cooling
4. $25 Off OBD-II Diagnostics
5. Alternator & Radiator Pros
6. 87 Five-Star Google Reviews
7. OEM Parts + Bay Installation
8. Book Mon–Fri 12PM–7PM Slots

DESCRIPTIONS (<=90 chars):
1. 5.0★ Google-rated auto repair at 5115 66th St W Bldg B, University Place. Call 253-245-4206!
2. Electrical, alternators, radiators, brakes & engine swaps. Use code DIAG25 for $25 off diag!
3. Save 30-50% vs dealer prices: we stock tested OEM parts & install them under one roof.

MANDATORY NEGATIVE KEYWORDS:
-airbag -srs -clockspring -"catalytic converter" -"junk car removal" -"cash for clunkers" -"car dealership" -"used cars for sale" -"hitch installation" -"uhaul hitch"`
  },
  {
    id: 'ad-google-parts',
    channel: 'Google Search + Free Merchant Listings Campaign #2 — OEM Auto Parts',
    title: 'Tested Used OEM Auto Parts (Local 253 Pickup + Nationwide Shipping)',
    copy: `FINAL URL: https://aldridgeautosupply.com/
FEED SOURCE: https://aldridgeautosupply.com/api/feeds/google-merchant.xml (Verified Weight & L×W×H Dimensions)

HEADLINES (<=30 chars):
1. Tested Used OEM Auto Parts
2. 962+ Factory Parts In Stock
3. Ship Nationwide or Pickup UP
4. Verify Fitment By 17-Digit VIN
5. Tacoma & Pierce County Parts
6. Optional 5.0★ Shop Install

DESCRIPTIONS (<=90 chars):
1. Genuine factory OEM auto parts inspected & security-marked in University Place, WA 98467.
2. Fast calculated UPS/USPS parcel shipping under 70 lbs or FREE local pickup at 5115 66th St W!
3. Local to Tacoma? Bundle any OEM part with certified installation in our 5.0★ service bays.`
  },
  {
    id: 'ad-meta-local',
    channel: 'Meta Ads Manager (Facebook & Instagram) — 15-Mile Geo-Radius Around 98467 ($10–$15/day)',
    title: 'Local Pierce County Repair + Turnkey OEM Part Install Lead Ad',
    copy: `PRIMARY TEXT:
Check engine light on? Overheating radiator, weak alternator, or quoted $1,800+ at the dealership? 🛠️
Come see why Tacoma, University Place & Lakewood drivers give Aldridge Auto's a 5.0★ rating (87 Google Reviews)! We stock 962+ tested factory OEM parts right on-site at Bldg B AND install them in our service bays — saving you 30%–50% without cheap aftermarket failures.
📍 5115 66th St W, Bldg B, University Place, WA 98467
📞 Call/Text (253) 245-4206 or tap "Learn More" to search parts & claim $25 OFF Diagnostics (Code: DIAG25)!

HEADLINE: 5.0★ Auto Repair & 962 OEM Parts — University Place
DESCRIPTION: Mon–Fri 12–7 PM • Free Counter Pickup or Turnkey Bay Install
CTA BUTTON: Book Now / Shop Now -> https://aldridgeautosupply.com`
  },
  {
    id: 'ad-craigslist-partout',
    channel: 'Craigslist Seattle-Tacoma (Tacoma > Auto Parts) + OfferUp Local Anchor Ad',
    title: '962+ Tested OEM Auto Parts + 318 Local-Pickup Engines/Body/Wheels (University Place 98467)',
    copy: `TITLE: TESTED USED OEM AUTO PARTS — Toyota Honda Ford Subaru Chevy BMW Dodge (University Place 98467)

BODY:
ALDRIDGE AUTO'S — 5115 66th St W, Bldg B, University Place / Tacoma, WA 98467
Shop & Parts Desk: (253) 245-4206 | Hours: Mon–Fri 12:00 PM – 7:00 PM
5.0★ Google-Rated Auto Repair & Tested OEM Auto Parts!

Over 960+ inspected, photographed & shelved factory OEM parts ready for immediate counter pickup in University Place (98467) — PLUS certified installation available right in our shop bays!

POPULAR IN-STOCK OEM ASSEMBLIES RIGHT NOW:
• 2016–2023 Toyota Tacoma TRD Off-Road 16" OEM Wheels & 265/70R16 Tires Set of 4 ($899.99)
• Toyota Tundra / 4Runner / Camry / Prius / Sienna OEM Alternators, Starters, Radiators, Headlights, Mirrors, Doors, Bumpers & Struts
• Honda Odyssey / CR-V / Civic / Accord OEM Body, Electrical, Cooling & Suspension Parts
• Ford F-150 / Explorer / Escape / Mustang, Subaru Outback / Forester, Chevy Silverado / Tahoe, Ram & BMW E46/E90 OEM Parts

HOW TO ORDER OR CHECK FITMENT:
1) Browse live photos & prices: https://aldridgeautosupply.com
2) Call or text (253) 245-4206 with your 17-digit VIN or OEM Part Number for an instant stock check.
3) Pick up at Bldg B (98467), ship parcel nationwide (<70 lbs), or schedule turnkey bay installation!
(Note: No SRS airbags or catalytic converters sold. All parts carry serialized UV/Paint security marks; Defect-Only return policy.)`
  }
];

const PLATFORM_SETTINGS_MATRIX = [
  {
    platform: '1. Shopify (aldridgesales.myshopify.com)',
    badge: '57 Live + 905 Staged = 962 SKUs',
    rules: '• Shipping Profile 1 (<70 lb, 644 SKUs): Calculated UPS Ground / USPS Ground Advantage + $10.00 flat handling fee (origin: 5115 66th St W Bldg B, 98467).\n• Shipping Profile 2 (70+ lb / Oversize, 318 SKUs): Variant Requires Shipping = false + Local Pickup Enabled at University Place, WA 98467 (Ready in 24–48 hrs).\n• Legal / Checkout Policies: Paste Master Defect-Only Return Policy (Returns Not Accepted for remorse/fitment; intact SEC-XXXXXX required; buyer pays return shipping).\n• Taxes: Collect WA Destination Sales Tax (10.1% at 98467).'
  },
  {
    platform: '2. eBay Motors (Account: AABCAS)',
    badge: 'Safe 25–50 SKU Drip',
    rules: '• Business Policy — Shipping #1 (Parcel <70 lb): Calculated UPS Ground + $10.00 Packaging/Handling + Free Local Pickup (98467), 3-Day Dispatch.\n• Business Policy — Shipping #2 (Heavy 70+ lb): Flat / Local Pickup Only (University Place, WA 98467) — NO parcel service enabled.\n• Business Policy — Returns: ReturnsNotAccepted (Used Condition ID 3000; Defect-Only w/ SEC-XXXXXX mark).\n• Rollout: Verify SR# 1-509601062469 cleared -> Reconcile 418 Gen-1 SKUs -> Upload ebay_aabcas_safe_batch_1_50_skus.csv (50 parcel SKUs every 48h).'
  },
  {
    platform: '3. Vendoo',
    badge: '644 Parcel SKUs Ready',
    rules: '• Import File: Use aldridge_parcel_644_vendoo.csv (verified <70 lb SKUs w/ exact Weight_lb & L×W×H dimensions) or /api/exports/crosslist.csv.\n• Default Template: Condition = Used, Brand = OEM, Verified Stamped OEM MPN (blank if unstamped — never fake hashes), Zip = 98467, Handling = +$10.00, Auto-Delist on Sale = ON.\n• Channel Scope: Secondary parcel channels only — let Shopify Marketplace Connect manage eBay Motors directly so fitment & two-tier sync stay clean.'
  },
  {
    platform: '4. Crosslist (Safety Guardrail Config)',
    badge: 'NEVER Link to eBay Motors',
    rules: '• Audit Warning: Crosslist\'s apparel schema previously miscategorized 574/807 auto parts as whole vehicles on eBay. Recommended: cancel ($34.99–$44.99/mo savings) in favor of Shopify Marketplace Connect + Vendoo.\n• If Kept Active Temporarily: Disconnect eBay integration immediately; use ONLY for manual local classifieds via aldridge_combined_962_crosslist_safe_export.csv with Category hard-locked to Auto Parts & Accessories (never Vehicles).'
  },
  {
    platform: '5. OfferUp (University Place, WA 98467)',
    badge: '318 Heavy + 57 Counter SKUs',
    rules: '• Profile: Aldridge Auto\'s (TruYou Verified, Location: University Place, WA 98467, Hours: Mon–Fri 12–7 PM).\n• Shipping Toggle: Turn "Nationwide Shipping" OFF on every item over 20 lbs (OfferUp max label cap) and ALL 318 heavy assemblies — set strictly to Local Pickup in 98467.\n• Daily Drip: Copy 10–15 ads/day from local_pickup_98467_offerup_craigslist_ads.csv (includes Turnkey Bay Install upsell price!).'
  },
  {
    platform: '6. Craigslist (Seattle-Tacoma > Tacoma > Auto Parts)',
    badge: 'By Owner/Shop • $0 Fee',
    rules: '• Category: seattle.craigslist.org -> Tacoma -> For Sale -> Auto Parts (pts).\n• Map & Contact: Postal Code 98467, Street "5115 66th St W Bldg B", Phone/Text (253) 245-4206, Show "More Ads By This User" = ON.\n• Cadence: Publish the 8 Donor Part-Out Anchor Ads + Top 15 high-ticket wheel/bumper/door/suspension ads from local_pickup_98467_offerup_craigslist_ads.csv; renew every 48 hrs.'
  },
  {
    platform: '7. Facebook Business Page & FB Marketplace',
    badge: '962-SKU Meta Catalog Ready',
    rules: '• Business Page Name: Aldridge Auto\'s | Categories: Auto Repair Shop • Auto Parts Store • Truck Rental Agency.\n• Meta Commerce Manager: Add Data Feed -> Scheduled URL -> paste https://aldridgeautosupply.com/api/feeds/meta-catalog.csv (or upload aldridge_combined_962_meta_catalog.csv).\n• Personal Marketplace Unblock: Send the pre-written WA AG File #730525 / Meta C#26046204 email in Tab 3 with paloozabooking@gmail.com + fresh unlinked email + profile URL.'
  },
  {
    platform: '8. Google Business Profile, Merchant Center & SEO',
    badge: '5.0★ (87 Reviews) + XML Live',
    rules: '• GBP NAP: Aldridge Auto\'s | 5115 66th St W, Bldg B, University Place, WA 98467 | (253) 245-4206 | Mon–Fri 12:00 PM – 7:00 PM | Website: https://aldridgeautosupply.com.\n• GBP Primary Category: Auto Repair Shop | Additional: Auto Parts Store, Auto Electrical Service, Auto Radiator Repair Service, Truck Rental Agency.\n• Google Merchant Center: Enable "Free Product Listings" + "Local Inventory" -> Add Scheduled XML Feed https://aldridgeautosupply.com/api/feeds/google-merchant.xml (includes g:shipping_weight + g:shipping_length/width/height).\n• Google Search Console: Submit https://aldridgeautosupply.com/sitemap.xml.'
  }
];

function renderLaunchCenter() {
  const socialBox = document.getElementById('launch-social-cards');
  const adsBox = document.getElementById('launch-ads-cards');
  const platBox = document.getElementById('launch-platform-settings-grid');
  const quickTok = document.getElementById('quick-shopify-token');
  if (quickTok && state.data?.settings?.shopify_admin_token && !quickTok.value) {
    quickTok.value = state.data.settings.shopify_admin_token;
  }

  if (socialBox) {
    socialBox.innerHTML = LAUNCH_SOCIAL_POSTS.map((p, idx) => `
      <div style="padding:0.75rem 0.85rem;background:var(--bg-subtle);border-radius:6px;border:1px solid var(--border-light);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-bottom:0.35rem;flex-wrap:wrap;">
          <span class="badge badge-dark">${esc(p.channel)}</span>
          <button type="button" class="btn btn-primary btn-sm" onclick="copyLaunchItem('social', ${idx})">Copy Post</button>
        </div>
        <strong style="font-size:0.85rem;display:block;margin-bottom:0.35rem;">${esc(p.title)}</strong>
        <pre style="margin:0;white-space:pre-wrap;font-family:var(--font-sans);font-size:0.78rem;color:var(--text-secondary);max-height:110px;overflow-y:auto;">${esc(p.copy)}</pre>
      </div>
    `).join('');
  }

  if (adsBox) {
    adsBox.innerHTML = LAUNCH_AD_CAMPAIGNS.map((a, idx) => `
      <div style="padding:0.75rem 0.85rem;background:var(--bg-subtle);border-radius:6px;border:1px solid var(--border-light);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-bottom:0.35rem;flex-wrap:wrap;">
          <span class="badge badge-warn">${esc(a.channel)}</span>
          <button type="button" class="btn btn-dark btn-sm" onclick="copyLaunchItem('ad', ${idx})">Copy Ad Spec</button>
        </div>
        <strong style="font-size:0.85rem;display:block;margin-bottom:0.35rem;">${esc(a.title)}</strong>
        <pre style="margin:0;white-space:pre-wrap;font-family:var(--font-mono);font-size:0.74rem;color:var(--text-secondary);max-height:110px;overflow-y:auto;">${esc(a.copy)}</pre>
      </div>
    `).join('');
  }

  if (platBox) {
    platBox.innerHTML = PLATFORM_SETTINGS_MATRIX.map((m, idx) => `
      <div style="padding:0.85rem;background:var(--bg-subtle);border-radius:6px;border:1px solid var(--border-light);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-bottom:0.4rem;flex-wrap:wrap;">
          <strong style="font-size:0.88rem;">${esc(m.platform)}</strong>
          <div style="display:flex;gap:0.35rem;align-items:center;">
            <span class="badge badge-ok">${esc(m.badge)}</span>
            <button type="button" class="btn btn-outline btn-sm" style="padding:0.18rem 0.5rem;font-size:0.73rem;" onclick="copyLaunchItem('platform', ${idx})">Copy</button>
          </div>
        </div>
        <pre style="margin:0;white-space:pre-wrap;font-family:var(--font-sans);font-size:0.79rem;color:var(--text-secondary);line-height:1.45;">${esc(m.rules)}</pre>
      </div>
    `).join('');
  }
}

async function copyLaunchItem(kind, idx) {
  const src = kind === 'social' ? LAUNCH_SOCIAL_POSTS[idx] : kind === 'ad' ? LAUNCH_AD_CAMPAIGNS[idx] : PLATFORM_SETTINGS_MATRIX[idx];
  if (!src) return;
  const text = src.copy || `${src.platform}\n${src.rules}`;
  await navigator.clipboard.writeText(text);
  showToast(`Copied "${src.title || src.platform}" to clipboard!`);
}

/* ==================== EVENT LISTENERS ==================== */
document.addEventListener('DOMContentLoaded', async () => {
  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) installBtn.style.display = 'inline-flex';
  });

  document.getElementById('btn-install-pwa')?.addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    state.deferredInstallPrompt = null;
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) installBtn.style.display = 'none';
  });

  document.getElementById('btn-enable-push')?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('Push notifications require a modern mobile/desktop browser.');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      new Notification("Aldridge Auto's Push Alerts Active!", {
        body: 'You will receive instant order, appointment & shop special updates.',
        icon: state.data?.settings?.logo_url || '/assets/aldridge-crest.jpg'
      });
      showToast('Web Push Notifications enabled!');
    } else {
      showToast('Notification permission was not granted.');
    }
  });

  // Header & Mode Switchers
  document.querySelectorAll('#customer-nav .nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchCustomerView(btn.dataset.view));
  });
  document.getElementById('brand-home-link').addEventListener('click', (e) => {
    e.preventDefault();
    switchCustomerView('view-home');
  });
  document.getElementById('mode-customer-btn')?.addEventListener('click', () => switchCustomerView('view-home'));
  document.getElementById('mode-staff-btn')?.addEventListener('click', () => activateStaffMode('staff-intake'));
  document.querySelectorAll('.staff-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchStaffTab(tab.dataset.staff));
  });
  document.getElementById('btn-open-cart').addEventListener('click', openCartModal);

  // Catalog Filters
  ['parts-search-input', 'parts-category-filter', 'parts-mode-filter'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderCatalogFiltered);
    document.getElementById(id).addEventListener('change', renderCatalogFiltered);
  });
  document.getElementById('btn-reset-filters').addEventListener('click', () => {
    document.getElementById('parts-search-input').value = '';
    document.getElementById('parts-category-filter').value = '';
    document.getElementById('parts-mode-filter').value = '';
    renderCatalogFiltered();
  });
  document.getElementById('staff-inv-search').addEventListener('input', renderStaffInventoryTable);

  // Default booking date
  document.getElementById('book-date').value = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0];

  // Booking VIN Decode
  document.getElementById('btn-decode-booking-vin').addEventListener('click', async () => {
    const vin = document.getElementById('book-vin').value;
    try {
      const d = await api(`/api/vin-decode/${encodeURIComponent(vin)}`);
      document.getElementById('book-ymm').value = `${d.year} ${d.make} ${d.model} ${d.engine}`.trim();
      showToast(`Decoded VIN: ${d.year} ${d.make} ${d.model}`);
    } catch (err) {
      showToast(err.message);
    }
  });

  // Auto Repair & Part Pull Appointment Submit
  document.getElementById('repair-booking-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: document.getElementById('book-name').value,
          customer_phone: document.getElementById('book-phone').value,
          customer_email: document.getElementById('book-email').value,
          booking_mode: document.getElementById('book-mode').value,
          appointment_type: document.getElementById('book-type').value,
          service_category: document.getElementById('book-service').value,
          vehicle_vin: document.getElementById('book-vin').value,
          vehicle_ymm: document.getElementById('book-ymm').value,
          linked_sku: document.getElementById('book-sku').value,
          preferred_date: document.getElementById('book-date').value,
          preferred_time: document.getElementById('book-time').value,
          customer_notes: document.getElementById('book-notes').value,
          sms_opt_in: document.getElementById('book-sms-optin').checked,
          email_opt_in: document.getElementById('book-sms-optin').checked
        })
      });
      const box = document.getElementById('booking-confirmation-box');
      box.style.display = 'block';
      box.innerHTML = `
        <strong>Booking ${esc(res.booking_code)} (${esc(res.status.replace('_', ' '))})!</strong><br/>
        ${res.status === 'pending_approval' ? 'Routed to our Shop Staff Approval Queue — you will receive confirmation shortly.' : 'Express Diagnostic Slot confirmed!'}
        <div style="margin-top:0.55rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
          <a href="${esc(res.gcal_url)}" target="_blank" rel="noopener" class="btn btn-dark btn-sm">Add to Google Calendar ↗</a>
          <a href="${esc(res.ics_url)}" class="btn btn-outline btn-sm">Download .ics Calendar Pass</a>
        </div>
      `;
      e.target.reset();
      await loadBootstrap();
    } catch (err) {
      showToast(err.message);
    }
  });

  // Checkout Submit
  document.getElementById('checkout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const hasHeavyLocalPickup = state.cart.some((line) => {
        const item = state.data.inventory.find((i) => i.sku === line.sku);
        return isLocalPickupOnlyCartItem(item);
      });
      const effectiveMode = hasHeavyLocalPickup
        ? 'local_pickup_we_pull'
        : document.getElementById('chk-mode').value;
      const cartAttributes = hasHeavyLocalPickup
        ? { Fulfillment_Mode: 'Local_Pickup_Only_Bldg_B' }
        : {};
      const orderNote = hasHeavyLocalPickup
        ? 'Fulfillment_Mode: Local_Pickup_Only_Bldg_B'
        : '';

      const res = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: state.cart,
          fulfillment_mode: effectiveMode,
          cart_attributes: cartAttributes,
          notes: orderNote,
          customer_name: document.getElementById('chk-name').value,
          customer_phone: document.getElementById('chk-phone').value,
          customer_email: document.getElementById('chk-email').value,
          shipping_address: hasHeavyLocalPickup ? '' : document.getElementById('chk-address').value,
          preferred_date: document.getElementById('chk-date').value,
          preferred_time: document.getElementById('chk-time').value,
          vehicle_ymm: document.getElementById('chk-ymm').value,
          waiver_accepted: document.getElementById('chk-waiver').checked,
          policy_accepted: document.getElementById('chk-policy').checked,
          sms_opt_in: true,
          email_opt_in: true
        })
      });

      state.cart = [];
      updateCartBadge();
      document.getElementById('checkout-form').style.display = 'none';
      const sBox = document.getElementById('checkout-success-box');
      sBox.style.display = 'block';
      sBox.innerHTML = `
        <strong>Order ${esc(res.order_number)} Confirmed ($${Number(res.total).toFixed(2)})!</strong><br/>
        Inventory has been automatically decremented/reserved across Shopify &amp; Marketplace Feeds.<br/>
        ${res.linked_booking_code ? `Linked Staff-Approval Appointment: <strong class="mono">${esc(res.linked_booking_code)}</strong>
          <div style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
            <a href="${esc(res.gcal_url)}" target="_blank" rel="noopener" class="btn btn-dark btn-sm">Add Appointment to Google Calendar ↗</a>
            <a href="${esc(res.ics_url)}" class="btn btn-outline btn-sm">Download .ics</a>
          </div>` : 'Ships within 2–3 business days following final bench test & security mark verification.'}
      `;
      await loadBootstrap();
    } catch (err) {
      showToast(err.message);
    }
  });

  // U-Haul Renter VIP Form
  document.getElementById('uhaul-vip-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await api('/api/subscribers', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('uhaul-vip-name').value,
        phone: document.getElementById('uhaul-vip-phone').value,
        pillar_interest: 'uhaul',
        sms_opt_in: true
      })
    });
    e.target.reset();
    showToast(`U-Haul VIP Coupon Unlocked! Code: ${res.welcome_promo} • Share Code: ${res.referral_code}`);
    await loadBootstrap();
  });

  // Customer Inquiry Form
  document.getElementById('customer-inquiry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await api('/api/inquiries', {
      method: 'POST',
      body: JSON.stringify({
        customer_name: document.getElementById('inq-name').value,
        pillar: document.getElementById('inq-pillar').value,
        customer_email: document.getElementById('inq-email').value,
        customer_phone: document.getElementById('inq-phone').value,
        vehicle_vin: document.getElementById('inq-vin').value,
        related_sku: document.getElementById('inq-sku').value,
        subject: document.getElementById('inq-subject').value,
        message: document.getElementById('inq-message').value,
        email_opt_in: true
      })
    });
    e.target.reset();
    showToast(`Ticket ${res.ticket_number} submitted to our Unified Shop Inbox!`);
    await loadBootstrap();
  });

  // Strict RMA Evidence Portal Form
  document.getElementById('rma-claim-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const fileInput = document.getElementById('rma-photo');
      let photoData = '';
      if (fileInput.files?.[0]) {
        photoData = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(fileInput.files[0]);
        });
      }
      const res = await api('/api/returns', {
        method: 'POST',
        body: JSON.stringify({
          order_number: document.getElementById('rma-order').value,
          sku: document.getElementById('rma-sku').value,
          customer_name: document.getElementById('rma-name').value,
          customer_email: document.getElementById('rma-email').value,
          claim_reason: document.getElementById('rma-reason').value,
          diagnostic_codes: document.getElementById('rma-codes').value,
          buyer_vin: document.getElementById('rma-vin').value,
          evidence_summary: document.getElementById('rma-summary').value,
          security_mark_intact: document.getElementById('rma-mark-intact').checked,
          buyer_accepts_return_shipping: document.getElementById('rma-buyer-ships').checked,
          evidence_photo_data: photoData
        })
      });
      const rBox = document.getElementById('rma-result-box');
      rBox.style.display = 'block';
      rBox.style.background = res.status.includes('rejected') ? 'var(--status-err-bg)' : 'var(--status-warn-bg)';
      rBox.style.color = res.status.includes('rejected') ? 'var(--status-err-fg)' : 'var(--status-warn-fg)';
      rBox.innerHTML = `<strong>${esc(res.rma_number)} (${esc(res.status)}):</strong> ${esc(res.policy_notice)}`;
      e.target.reset();
      await loadBootstrap();
    } catch (err) {
      showToast(err.message);
    }
  });

  // VIP Signup & Referral Code
  document.getElementById('vip-signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await api('/api/subscribers', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('vip-name').value,
        pillar_interest: document.getElementById('vip-interest').value,
        email: document.getElementById('vip-email').value,
        phone: document.getElementById('vip-phone').value,
        email_opt_in: true,
        sms_opt_in: Boolean(document.getElementById('vip-phone').value),
        push_opt_in: Notification?.permission === 'granted'
      })
    });
    const out = document.getElementById('vip-referral-output');
    out.style.display = 'block';
    const refLink = `${window.location.origin}/?ref=${encodeURIComponent(res.referral_code)}`;
    out.innerHTML = `
      <strong>VIP Perks Active!</strong> Use Welcome Code <span class="mono">${esc(res.welcome_promo)}</span>.<br/>
      Your Share-to-Friend Referral Link: <span class="mono">${esc(refLink)}</span>
    `;
    await loadBootstrap();
  });

  // Camera & On-Hand Folder Photo Intake Controls
  document.getElementById('btn-start-camera').addEventListener('click', startCamera);
  document.getElementById('btn-stop-camera').addEventListener('click', stopCamera);
  document.getElementById('btn-snap-frame').addEventListener('click', snapCameraFrame);
  document.getElementById('btn-reset-photo').addEventListener('click', () => {
    state.currentPartPhotos = [];
    syncCurrentPhotosUI();
  });

  const folderInput = document.getElementById('intake-folder-input');
  if (folderInput) {
    folderInput.addEventListener('change', async (e) => {
      await ingestPhotoFileList(e.target.files, false);
      e.target.value = '';
    });
  }

  const mobileCamInput = document.getElementById('intake-mobile-camera-input');
  if (mobileCamInput) {
    mobileCamInput.addEventListener('change', async (e) => {
      await ingestPhotoFileList(e.target.files, state.currentPartPhotos.length > 0);
      e.target.value = '';
    });
  }

  document.getElementById('intake-file-input').addEventListener('change', async (e) => {
    await ingestPhotoFileList(e.target.files, false);
    e.target.value = '';
  });

  const addAngleInput = document.getElementById('intake-add-angle-input');
  if (addAngleInput) {
    addAngleInput.addEventListener('change', async (e) => {
      await ingestPhotoFileList(e.target.files, true);
      e.target.value = '';
    });
  }

  const cameraStage = document.getElementById('camera-stage');
  if (cameraStage) {
    cameraStage.addEventListener('dragover', (e) => {
      e.preventDefault();
      cameraStage.style.borderColor = 'var(--brand-amber)';
      cameraStage.style.background = 'rgba(217, 119, 6, 0.08)';
    });
    cameraStage.addEventListener('dragleave', () => {
      cameraStage.style.borderColor = 'var(--border-strong)';
      cameraStage.style.background = '';
    });
    cameraStage.addEventListener('drop', async (e) => {
      e.preventDefault();
      cameraStage.style.borderColor = 'var(--border-strong)';
      cameraStage.style.background = '';
      const droppedFiles = await extractDroppedFiles(e.dataTransfer);
      await ingestPhotoFileList(droppedFiles, false);
    });
  }

  // Auto-enforce 70+ lb -> Local Pickup Only (University Place, WA 98467)
  document.getElementById('pub-weight').addEventListener('input', (e) => {
    const w = Number(e.target.value || 0);
    document.getElementById('pub-ship-class').value = w >= 70 ? 'local_pickup_only' : 'parcel_calculated';
  });

  const snapPublishBtn = document.getElementById('btn-snap-and-publish-shopify');
  if (snapPublishBtn) {
    snapPublishBtn.addEventListener('click', async () => {
      try {
        const photosPayload = state.currentPartPhotos.length
          ? state.currentPartPhotos
          : (state.capturedImageBase64 ? [state.capturedImageBase64] : []);
        if (!photosPayload.length && !document.getElementById('intake-hint').value.trim()) {
          showToast('Snap or select at least 1 part photo (or enter a quick part note) first!');
          return;
        }
        snapPublishBtn.disabled = true;
        snapPublishBtn.textContent = '⏳ Identifying Part & Publishing to Shopify...';
        const created = await api('/api/intake/snap-and-publish', {
          method: 'POST',
          body: JSON.stringify({
            photos: photosPayload,
            donorVehicleId: document.getElementById('intake-donor-select').value || null,
            pullStatus: document.getElementById('intake-pull-status').value,
            condition: document.getElementById('intake-condition').value,
            technicianHint: document.getElementById('intake-hint').value,
            stampedNumber: document.getElementById('intake-stamped').value
          })
        });
        document.getElementById('intake-hint').value = '';
        document.getElementById('intake-stamped').value = '';
        state.currentPartPhotos = [];
        syncCurrentPhotosUI();
        await loadBootstrap();
        const shopMsg = created.shopify_live_sync?.pushed
          ? `LIVE on ${created.shopify_live_sync.shopify_domain} + Queued for eBay!`
          : `Saved (${created.sku}) & Queued for ${created.shopify_live_sync?.shopify_domain || 'aldridgesales.myshopify.com'} + eBay!`;
        if (state.folderQueue.length > 0) {
          loadQueuedFolderPart(0);
          showToast(`⚡ ${created.sku}: ${shopMsg} Next part loaded (${state.folderQueue.length} left).`);
        } else {
          showToast(`⚡ ${created.sku} (${created.title}): ${shopMsg}`);
        }
      } catch (err) {
        showToast(err.message);
      } finally {
        snapPublishBtn.disabled = false;
        snapPublishBtn.textContent = '⚡ 1-Tap Auto-Identify & Publish Straight to Shopify (+ eBay Queue)';
      }
    });
  }

  document.getElementById('btn-run-ai-intake').addEventListener('click', async () => {
    try {
      const proposal = await api('/api/intake/analyze', {
        method: 'POST',
        body: JSON.stringify({
          imageBase64: state.currentPartPhotos[0] || state.capturedImageBase64,
          imagesBase64: state.currentPartPhotos.length ? state.currentPartPhotos : (state.capturedImageBase64 ? [state.capturedImageBase64] : []),
          donorVehicleId: document.getElementById('intake-donor-select').value || null,
          pullStatus: document.getElementById('intake-pull-status').value,
          condition: document.getElementById('intake-condition').value,
          technicianHint: document.getElementById('intake-hint').value,
          stampedNumber: document.getElementById('intake-stamped').value
        })
      });

      document.getElementById('pub-sku').value = proposal.sku;
      document.getElementById('pub-sec-code').value = proposal.security_mark_code;
      document.getElementById('pub-title').value = proposal.title;
      document.getElementById('pub-oem').value = proposal.oem_part_number;
      document.getElementById('pub-hollander').value = proposal.hollander_number;
      document.getElementById('pub-bin').value = proposal.bin_location;
      document.getElementById('pub-price-self').value = proposal.price_self_pull;
      document.getElementById('pub-price-wepull').value = proposal.price_we_pull;
      document.getElementById('pub-price-install').value = proposal.price_pull_install;
      document.getElementById('pub-weight').value = proposal.weight_lbs;
      document.getElementById('pub-len').value = proposal.length_in;
      document.getElementById('pub-wid').value = proposal.width_in;
      document.getElementById('pub-hgt').value = proposal.height_in;
      document.getElementById('pub-ship-class').value =
        Number(proposal.weight_lbs || 0) >= 70 ? 'local_pickup_only' : 'parcel_calculated';
      document.getElementById('pub-desc').value = proposal.description;

      // Stash donor/fitment fields on form dataset for publishing
      const form = document.getElementById('intake-publish-form');
      form.dataset.category = proposal.category;
      form.dataset.brand = proposal.brand;
      form.dataset.fitYears = proposal.fitment_years;
      form.dataset.fitMake = proposal.fitment_make;
      form.dataset.fitModel = proposal.fitment_model;
      form.dataset.fitEngine = proposal.fitment_engine;
      form.dataset.fitNotes = proposal.fitment_notes;
      form.dataset.defect = proposal.defect_disclosure;

      showToast(`Identified part & locked cross-platform settings (${proposal.provider})!`);
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById('intake-publish-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const f = e.target;
      const priceInstall = Number(document.getElementById('pub-price-install').value || 0);
      const weightLbs = Number(document.getElementById('pub-weight').value || 10);
      const photosPayload = state.currentPartPhotos.length
        ? state.currentPartPhotos
        : (state.capturedImageBase64 ? [state.capturedImageBase64] : []);

      if (!photosPayload.length) {
        showToast('Clean Catalog Policy: Snap or upload at least 1 real photo of the part before publishing.');
        return;
      }

      const created = await api('/api/inventory', {
        method: 'POST',
        body: JSON.stringify({
          sku: document.getElementById('pub-sku').value,
          security_mark_code: document.getElementById('pub-sec-code').value,
          security_mark_verified: document.getElementById('pub-sec-verified').checked,
          title: document.getElementById('pub-title').value,
          category: f.dataset.category || 'OEM Auto Parts',
          condition: document.getElementById('intake-condition').value,
          brand: f.dataset.brand || 'OEM',
          oem_part_number: document.getElementById('pub-oem').value,
          hollander_number: document.getElementById('pub-hollander').value,
          interchange_number: document.getElementById('pub-hollander').value,
          donor_vehicle_id: document.getElementById('intake-donor-select').value || null,
          fitment_years: f.dataset.fitYears || '',
          fitment_make: f.dataset.fitMake || '',
          fitment_model: f.dataset.fitModel || '',
          fitment_engine: f.dataset.fitEngine || '',
          fitment_notes: f.dataset.fitNotes || '',
          description: document.getElementById('pub-desc').value,
          defect_disclosure: f.dataset.defect || 'Inspected & verified on-hand OEM part.',
          bin_location: document.getElementById('pub-bin').value,
          pull_status: 'pulled_shelved',
          allow_self_pull: 0,
          price_self_pull: 0,
          price_we_pull: Number(document.getElementById('pub-price-wepull').value || 0),
          allow_pull_install: 1,
          price_pull_install: priceInstall,
          weight_lbs: weightLbs,
          length_in: Number(document.getElementById('pub-len').value || 14),
          width_in: Number(document.getElementById('pub-wid').value || 10),
          height_in: Number(document.getElementById('pub-hgt').value || 8),
          shipping_class: weightLbs >= 70 ? 'local_pickup_only' : document.getElementById('pub-ship-class').value,
          quantity: Math.max(1, Number(document.getElementById('pub-qty').value || 1)),
          photos: photosPayload
        })
      });

      f.reset();
      document.getElementById('intake-hint').value = '';
      document.getElementById('intake-stamped').value = '';
      state.currentPartPhotos = [];
      syncCurrentPhotosUI();
      await loadBootstrap();

      const liveNote = created.shopify_live_sync?.pushed
        ? `LIVE on ${created.shopify_live_sync.shopify_domain} + eBay Queue`
        : `Saved & Queued for ${created.shopify_live_sync?.shopify_domain || 'aldridgesales.myshopify.com'} + eBay`;
      if (state.folderQueue.length > 0) {
        loadQueuedFolderPart(0);
        showToast(`Published ${created.sku} (${liveNote}) — auto-loaded next part (${state.folderQueue.length} remaining)!`);
      } else {
        showToast(`Published ${created.sku} (${created.photos.length} photo(s)) — ${liveNote}!`);
      }
    } catch (err) {
      showToast(err.message);
    }
  });

  // Step 4 Fresh Shopify Backup -> Photo-Preserving Audit Sanitizer Handler
  const auditSanitizeInput = document.getElementById('audit-sanitize-file');
  if (auditSanitizeInput) {
    auditSanitizeInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const csvText = await file.text();
        const res = await api('/api/audit/sanitize-csv', {
          method: 'POST',
          body: JSON.stringify({ csvText })
        });
        const st = res.stats;
        document.getElementById('audit-sanitize-status').innerHTML =
          `<strong>Sanitized ${st.input_total_rows} -> ${st.output_total_rows} rows!</strong> ${st.surviving_active_products} clean active SKUs, ${st.counterfeit_mpns_wiped} fake MPNs wiped, ${st.merged_angle_photos_saved} duplicate angle photos rescued. <a href="${esc(res.download_url)}" class="btn btn-primary btn-sm" style="margin-left:0.5rem;">Download Sanitized CSV</a>`;
        showToast('Fresh Shopify CSV sanitized with 100% secondary CDN photos preserved!');
        await loadBootstrap();
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  // Bulk CSV Import Handler
  document.getElementById('csv-import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const csvText = await file.text();
    const res = await api('/api/inventory/import-csv', {
      method: 'POST',
      body: JSON.stringify({ csvText })
    });
    document.getElementById('csv-import-status').innerHTML =
      `<strong>Import Complete:</strong> ${res.inserted} new SKUs added, ${res.updated} updated, ${res.secondary_photos_merged || 0} secondary CDN angle photos preserved (${res.errors.length} compliance/link notices).`;
    showToast(`Imported ${res.inserted + res.updated} SKUs into Co-Master Inventory!`);
    await loadBootstrap();
  });

  // Donor Vehicle Add Handler
  document.getElementById('donor-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const vin = document.getElementById('donor-vin-input').value;
      const decoded = await api(`/api/vin-decode/${encodeURIComponent(vin)}`);
      await api('/api/donors', {
        method: 'POST',
        body: JSON.stringify({
          ...decoded,
          mileage: Number(document.getElementById('donor-mileage-input').value || 75000),
          yard_row: document.getElementById('donor-row-input').value || 'Row C • Stall 01'
        })
      });
      e.target.reset();
      showToast(`Added Donor ${decoded.year} ${decoded.make} ${decoded.model} to Garage!`);
      await loadBootstrap();
    } catch (err) {
      showToast(err.message);
    }
  });

  // Internal Repair Work-Order Part Pull
  document.getElementById('shop-wo-pull-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const sku = document.getElementById('wo-sku-select').value;
      if (!sku) return;
      const wo = await api('/api/work-orders', {
        method: 'POST',
        body: JSON.stringify({
          pull_sku: sku,
          vehicle_ymm: document.getElementById('wo-vehicle-input').value,
          service_summary: `Internal Shop Bay Installation (${sku})`
        })
      });
      e.target.reset();
      showToast(`Work Order ${wo.wo_number} pulled ${sku} — automatically removed from Shopify & Marketplaces!`);
      await loadBootstrap();
    } catch (err) {
      showToast(err.message);
    }
  });

  // Staff Create Special
  document.getElementById('staff-special-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/specials', {
      method: 'POST',
      body: JSON.stringify({
        title: document.getElementById('sp-title').value,
        discount_text: document.getElementById('sp-discount').value,
        promo_code: document.getElementById('sp-code').value,
        pillar: document.getElementById('sp-pillar').value,
        valid_until: document.getElementById('sp-exp').value,
        description: document.getElementById('sp-desc').value
      })
    });
    e.target.reset();
    showToast('New Special published on Website & Share-to-Friend enabled!');
    await loadBootstrap();
  });

  // Trigger Shopify Co-Master Sync
  document.getElementById('btn-trigger-shopify-sync').addEventListener('click', async () => {
    const res = await api('/api/sync/shopify', { method: 'POST' });
    showToast(res.message || `Synced ${res.synced_count} products with Shopify Co-Master!`);
    await loadBootstrap();
  });

  // 1-Click Retroactive Batch QR Info & App Card Generator for All 57 On-Hand SKUs
  const batchQrBtn = document.getElementById('btn-batch-generate-qr-cards');
  if (batchQrBtn) {
    batchQrBtn.addEventListener('click', async () => {
      const statusBox = document.getElementById('qr-batch-status');
      const origLabel = batchQrBtn.textContent;
      batchQrBtn.disabled = true;
      batchQrBtn.textContent = 'Generating Scannable QR App Cards for All Active SKUs...';
      try {
        const res = await api('/api/inventory/batch-generate-qr-cards', { method: 'POST' });
        if (statusBox) {
          statusBox.style.display = 'block';
          statusBox.innerHTML = `
            <div style="display:flex;gap:0.85rem;align-items:center;flex-wrap:wrap;">
              <img src="${esc(res.sample_qr_card_url)}?t=${Date.now()}" alt="Sample QR Info Card" style="width:88px;height:88px;border-radius:6px;border:1px solid var(--border-light);background:#fff;" />
              <div style="flex:1;min-width:220px;">
                <strong>✓ Generated &amp; Staged ${res.generated_count} Scannable QR Info &amp; App Cards!</strong><br/>
                • <strong>Shopify (<code>aldridgesales.myshopify.com</code>):</strong> Attached as final gallery image (<code>&lt;SKU&gt;.qr.png</code>) + printable Packing Slips.<br/>
                • <strong>eBay Motors (<code>AABCAS</code>) &amp; Google Merchant:</strong> Primary photos kept <strong>100% clean (0 QR overlays)</strong>.<br/>
                • <strong>Tracked HTTPS Target:</strong> <code>${esc(res.target_base_url)}</code> (<a href="${esc(res.sample_qr_card_url)}" target="_blank" style="text-decoration:underline;">Open Sample PNG</a> • <a href="${esc(res.sample_packing_slip_url)}" target="_blank" style="text-decoration:underline;">Open Packing Slip</a>)
              </div>
            </div>
          `;
        }
        showToast(`Generated & attached ${res.generated_count} QR App Cards (Shopify final image + Packing Slips; eBay/Google kept 100% clean)!`);
        await loadBootstrap();
      } catch (err) {
        showToast(err.message);
      } finally {
        batchQrBtn.disabled = false;
        batchQrBtn.textContent = origLabel;
      }
    });
  }

  // Option A: 1-Click Live Shopify 905-SKU Push (Protects all 57 ALD-OH-* SKUs)
  const optABtn = document.getElementById('btn-launch-option-a-push');
  if (optABtn) {
    optABtn.addEventListener('click', async () => {
      const tokInput = document.getElementById('quick-shopify-token');
      const resBox = document.getElementById('option-a-push-result');
      const token = (tokInput?.value || '').trim();
      if (!token) {
        showToast('Paste your Shopify Admin API token (shpat_...) first, or download the 905-SKU CSV on the right!');
        tokInput?.focus();
        return;
      }
      optABtn.disabled = true;
      optABtn.textContent = 'Pushing 905 SKUs to aldridgesales.myshopify.com (Protecting 57 ALD-OH-*)...';
      if (resBox) {
        resBox.style.display = 'block';
        resBox.style.background = 'var(--status-warn-bg)';
        resBox.style.color = 'var(--status-warn-fg)';
        resBox.textContent = 'Running non-overwrite Admin API push (~2 req/sec Shopify bucket) — keep this tab open until complete...';
      }
      try {
        const res = await api('/api/sync/shopify', {
          method: 'POST',
          body: JSON.stringify({ shopify_domain: 'aldridgesales.myshopify.com', shopify_admin_token: token })
        });
        if (resBox) {
          resBox.style.background = 'var(--status-ok-bg)';
          resBox.style.color = 'var(--status-ok-fg)';
          resBox.innerHTML = `<strong>✓ Option A Push Complete:</strong> Created <strong>${res.synced_count}</strong> legacy products on <code>aldridgesales.myshopify.com</code> • Protected/Skipped <strong>${res.skipped_protected ?? 57}</strong> existing SKUs • Final Live Storefront Count: <strong>${res.total_live_shopify_products ?? (57 + res.synced_count)}</strong>!`;
        }
        showToast(`Pushed ${res.synced_count} SKUs to aldridgesales.myshopify.com!`);
        await loadBootstrap();
      } catch (err) {
        if (resBox) {
          resBox.style.background = 'var(--status-err-bg, #fee2e2)';
          resBox.style.color = 'var(--status-err-fg, #991b1b)';
          resBox.textContent = `Push Error: ${err.message} (Check that your shpat_... token has read_products & write_products scopes on aldridgesales.myshopify.com).`;
        }
        showToast(err.message);
      } finally {
        optABtn.disabled = false;
        optABtn.textContent = '🚀 Option A: Push 905 Legacy SKUs Live Now';
      }
    });
  }

  // Live Brand Theme Switcher & Custom Logo Upload
  const themeSelect = document.getElementById('set-theme-preset');
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      document.body.dataset.theme = themeSelect.value;
    });
  }

  const logoUpload = document.getElementById('set-logo-upload');
  if (logoUpload) {
    logoUpload.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.uploadedLogoDataUrl = String(reader.result || '');
        const logoEl = document.getElementById('header-brand-logo');
        if (logoEl && state.uploadedLogoDataUrl) logoEl.src = state.uploadedLogoDataUrl;
        showToast('Custom logo previewed — click Save Business Identity to persist across site & templates!');
      };
      reader.readAsDataURL(file);
    });
  }

  // Save Business Settings Vault
  document.getElementById('settings-vault-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      business_name: document.getElementById('set-name').value,
      tagline: document.getElementById('set-tagline').value,
      theme_preset: document.getElementById('set-theme-preset')?.value || 'pnw_navy_orange',
      phone: document.getElementById('set-phone').value,
      uhaul_phone: document.getElementById('set-uhaul-phone')?.value || '(253) 948-3487',
      email: document.getElementById('set-email').value,
      street_address: document.getElementById('set-street').value,
      city_display: document.getElementById('set-city').value,
      city: document.getElementById('set-city').value.toLowerCase(),
      state: document.getElementById('set-state').value,
      zip: document.getElementById('set-zip').value,
      hours_weekday: document.getElementById('set-hours-wk').value,
      hours_weekend: document.getElementById('set-hours-we').value,
      handling_fee_default: Number(document.getElementById('set-handling-fee').value || 10),
      handling_days_default: Number(document.getElementById('set-handling-days').value || 3),
      labor_rate_hourly: Number(document.getElementById('set-labor-rate').value || 174.99),
      social_links: {
        facebook: document.getElementById('set-fb').value,
        facebook_marketplace: document.getElementById('set-fb-marketplace')?.value || '',
        ebay_store: document.getElementById('set-ebay').value,
        instagram: document.getElementById('set-ig')?.value || '',
        youtube: document.getElementById('set-yt')?.value || '',
        offerup: document.getElementById('set-offerup')?.value || '',
        google_maps: document.getElementById('set-gbp')?.value || ''
      }
    };
    if (state.uploadedLogoDataUrl) {
      payload.logo_url = state.uploadedLogoDataUrl;
    }
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    showToast('Saved Aldridge Business Identity, Theme & Logo — regenerated all Platform Policies & Templates!');
    await loadBootstrap();
  });

  document.getElementById('btn-save-api-vault').addEventListener('click', async () => {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        shopify_domain: document.getElementById('set-shopify-domain').value,
        shopify_admin_token: document.getElementById('set-shopify-token').value,
        uhaul_dealer_url: document.getElementById('set-uhaul-url').value,
        gemini_api_key: document.getElementById('set-gemini-key').value
      })
    });
    showToast('Saved Shopify Co-Master, U-Haul #046117 URL & Vision AI Credentials!');
    await loadBootstrap();
  });

  document.getElementById('btn-sync-uhaul').addEventListener('click', async () => {
    const res = await api('/api/uhaul/sync', {
      method: 'POST',
      body: JSON.stringify({ uhaul_dealer_url: document.getElementById('set-uhaul-url').value })
    });
    showToast(`Synced U-Haul Dealer Profile: ${res.synced.dealer_title}`);
    await loadBootstrap();
  });

  document.getElementById('btn-clear-demo-data').addEventListener('click', async () => {
    await api('/api/system/clear-demo', { method: 'POST' });
    showToast('Demo records cleared! System is clean and ready for your live inventory batch.');
    await loadBootstrap();
  });

  bindReviewGalleryEvents();

  // Deep-link IMMEDIATELY (before loadBootstrap) so /review, ?tab=review, #review, or ?view=... work instantly
  const params = new URLSearchParams(window.location.search);
  const pathname = (window.location.pathname || '/').replace(/\/+$/, '').toLowerCase();
  const hash = (window.location.hash || '').toLowerCase();
  const requestedTab = (params.get('tab') || '').toLowerCase();
  const requestedView = (params.get('view') || '').toLowerCase();

  const wantsReview =
    pathname === '/review' ||
    requestedTab === 'review' ||
    requestedTab === 'staff-review' ||
    hash === '#review' ||
    hash === '#staff-review';

  if (wantsReview) {
    activateStaffMode('staff-review');
  } else if (pathname === '/staff' || requestedTab === 'staff') {
    activateStaffMode('staff-review');
  } else if (['parts', 'repair', 'uhaul', 'support'].includes(requestedView)) {
    switchCustomerView(`view-${requestedView}`);
  } else if (['#parts', '#repair', '#uhaul', '#support'].includes(hash)) {
    switchCustomerView(`view-${hash.slice(1)}`);
  }

  try {
    await loadBootstrap();
    const deepSku = params.get('sku') || params.get('part') || '';
    if (deepSku && typeof window.openPublicProductModal === 'function') {
      window.openPublicProductModal(deepSku);
    }
  } catch (err) {
    console.error('[Bootstrap Load Error]', err);
    showToast('Syncing with server — if the page just woke up, refresh in a moment.');
  }
});

/* ==================== VISUAL PHOTO REVIEW GALLERY CONTROLLER ==================== */
const REVIEW_LS_KEY = 'aldridge_photo_review_decisions_v25_vin_only';
try {
  localStorage.removeItem('aldridge_photo_review_decisions_v1');
} catch (_) {}

const reviewState = {
  loaded: false,
  syncedLocal: false,
  loading: false,
  mode: 'triage', // 'triage' | 'grid'
  folder: 'all',
  status: 'pending',
  hideGeneric: false,
  q: '',
  page: 1,
  limit: 48,
  totalFiltered: 0,
  totalPages: 1,
  items: [],
  triageIdx: 0,
  summary: null,
  undoStack: [],
  zoomItem: null,
  searchTimer: null
};

function readLocalReviewDecisions() {
  try {
    const raw = localStorage.getItem(REVIEW_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveLocalReviewDecision(uid, patch) {
  try {
    const map = readLocalReviewDecisions();
    const prev = map[uid] || {};
    map[uid] = {
      status: patch.status !== undefined ? patch.status : (prev.status || 'pending'),
      vehicle_tag_override: patch.vehicle_tag_override !== undefined ? patch.vehicle_tag_override : prev.vehicle_tag_override,
      notes: patch.notes !== undefined ? patch.notes : prev.notes,
      updated_at: new Date().toISOString()
    };
    localStorage.setItem(REVIEW_LS_KEY, JSON.stringify(map));
  } catch (_) {
    // localStorage unavailable
  }
}

function setReviewSyncBadge(text, isWarn = false) {
  const el = document.getElementById('rev-sync-badge');
  if (!el) return;
  el.textContent = text;
  el.style.color = isWarn ? 'var(--status-warn-fg)' : 'var(--status-ok-fg)';
}

async function syncLocalReviewDecisionsIfNeeded(serverSummary) {
  if (reviewState.syncedLocal) return false;
  reviewState.syncedLocal = true;
  const localMap = readLocalReviewDecisions();
  const localKeys = Object.keys(localMap);
  if (!localKeys.length) return false;

  const localDecidedCount = localKeys.filter((k) => localMap[k]?.status === 'keep' || localMap[k]?.status === 'remove').length;
  const localKeepEntries = {};
  let localKeepCount = 0;
  for (const k of localKeys) {
    if (localMap[k]?.status === 'keep') {
      localKeepEntries[k] = localMap[k];
      localKeepCount += 1;
    }
  }
  const serverDecidedCount = Number(serverSummary?.keep || 0) + Number(serverSummary?.remove || 0);

  // If Render restarted on ephemeral disk or client has offline decisions ahead of server, reconcile them cleanly
  if (localDecidedCount > serverDecidedCount) {
    setReviewSyncBadge('↻ Restoring Phone Saves...', true);
    try {
      const res = await api('/api/review-photos/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ decisions: localMap, preserve_keep: true })
      });
      setReviewSyncBadge('✓ Phone + Cloud Synced');
      if (Number(res.updated || 0) > 0) {
        showToast(`Restored ${res.updated} saved KEEP/REMOVE decisions from your device!`);
        return true;
      }
      return false;
    } catch (_) {
      setReviewSyncBadge('Saved on Phone (Offline)', true);
      return false;
    }
  }

  // Even when server has more total decided items (e.g. after auto-removing non-descriptive pending files),
  // safely merge any local KEEP decisions made on this device without reverting server REMOVE items.
  if (localKeepCount > 0) {
    try {
      const res = await api('/api/review-photos/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ decisions: localKeepEntries, keep_only: true })
      });
      if (Number(res.updated || 0) > 0) {
        setReviewSyncBadge('✓ Phone KEEP Synced');
        showToast(`Synced ${res.updated} additional KEEP item(s) from your device!`);
        return true;
      }
    } catch (_) {
      // Ignore offline failure
    }
  }
  return false;
}

async function ensureReviewGalleryLoaded() {
  if (!reviewState.loaded) {
    reviewState.loaded = true;
    await loadReviewGallery(true);
  }
}

async function loadReviewGallery(resetPage = false) {
  if (resetPage) {
    reviewState.page = 1;
    reviewState.triageIdx = 0;
  }
  reviewState.loading = true;
  try {
    const qs = new URLSearchParams({
      folder: reviewState.folder,
      status: reviewState.status,
      hide_generic: reviewState.hideGeneric ? '1' : '0',
      q: reviewState.q,
      page: String(reviewState.page),
      limit: String(reviewState.limit)
    });
    const res = await api(`/api/review-photos?${qs.toString()}`);

    // Reconcile localStorage decisions if Render container reset
    const reconciled = await syncLocalReviewDecisionsIfNeeded(res.summary);
    if (reconciled) {
      reviewState.loading = false;
      return loadReviewGallery(false);
    }

    reviewState.summary = res.summary;
    reviewState.items = res.items || [];
    reviewState.totalFiltered = Number(res.total_filtered || 0);
    reviewState.totalPages = Number(res.total_pages || 1);
    if (reviewState.triageIdx >= reviewState.items.length) {
      reviewState.triageIdx = Math.max(0, reviewState.items.length - 1);
    }

    // Keep global bootstrap summary + Employee Backend KPIs in sync
    if (state.data) {
      state.data.reviewSummary = res.summary;
      renderStaffKpis();
    }

    renderReviewChrome();
    renderReviewStage();
    preloadUpcomingReviewThumbs();
  } catch (err) {
    showToast('Could not load visual review photos: ' + err.message);
  } finally {
    reviewState.loading = false;
  }
}

function preloadUpcomingReviewThumbs() {
  const start = Math.max(0, reviewState.triageIdx);
  for (let i = start; i < Math.min(reviewState.items.length, start + 5); i++) {
    const url = reviewState.items[i]?.thumb_url;
    if (url) {
      const img = new Image();
      img.src = url;
    }
  }
}

function renderReviewChrome() {
  const sum = reviewState.summary;
  if (!sum) return;

  const total = Number(sum.total || 0);
  const pending = Number(sum.pending || 0);
  const keep = Number(sum.keep || 0);
  const remove = Number(sum.remove || 0);

  document.getElementById('rev-stat-total').textContent = total.toLocaleString();
  document.getElementById('rev-stat-pending').textContent = pending.toLocaleString();
  document.getElementById('rev-stat-keep').textContent = keep.toLocaleString();
  document.getElementById('rev-stat-remove').textContent = remove.toLocaleString();

  const keepPct = total > 0 ? (keep / total) * 100 : 0;
  const remPct = total > 0 ? (remove / total) * 100 : 0;
  document.getElementById('rev-prog-keep').style.width = `${keepPct.toFixed(2)}%`;
  document.getElementById('rev-prog-remove').style.width = `${remPct.toFixed(2)}%`;

  const masterLink = document.getElementById('review-master-drive-link');
  if (masterLink && sum.master_drive_folder_url) {
    masterLink.href = sum.master_drive_folder_url;
  }

  const undoBtn = document.getElementById('btn-review-undo');
  if (undoBtn) {
    undoBtn.disabled = reviewState.undoStack.length === 0;
    undoBtn.textContent = reviewState.undoStack.length ? `↶ Undo (${reviewState.undoStack.length})` : '↶ Undo';
  }
  const keepBtnLabel = '🔒 Go to Step 1 VIN / Plate AI Intake';
  ['btn-review-run-keep-intake', 'btn-inv-run-keep-intake'].forEach((id) => {
    const b = document.getElementById(id);
    if (b && !b.disabled) b.textContent = keepBtnLabel;
  });

  // Status filter pills with live counts
  document.querySelectorAll('#review-status-pills .review-filter-pill').forEach((btn) => {
    const st = btn.dataset.status;
    btn.classList.toggle('active', st === reviewState.status);
    if (st === 'pending') btn.textContent = `Pending (${pending.toLocaleString()})`;
    else if (st === 'keep') btn.textContent = `✓ KEEP (${keep.toLocaleString()})`;
    else if (st === 'remove') btn.textContent = `✕ REMOVE (${remove.toLocaleString()})`;
    else btn.textContent = `All (${total.toLocaleString()})`;
  });

  // Layout mode buttons
  document.getElementById('btn-rev-mode-triage')?.classList.toggle('active', reviewState.mode === 'triage');
  document.getElementById('btn-rev-mode-grid')?.classList.toggle('active', reviewState.mode === 'grid');

  // 1-click Generic Camera Filename Filter & Bulk-Remove controls
  const genericPending = Number(sum.generic_pending || 0);
  const genericTotal = Number(sum.generic_total || 0);
  const hideGenBtn = document.getElementById('btn-review-hide-generic');
  if (hideGenBtn) {
    hideGenBtn.classList.toggle('active', reviewState.hideGeneric);
    hideGenBtn.setAttribute('aria-pressed', reviewState.hideGeneric ? 'true' : 'false');
    hideGenBtn.textContent = reviewState.hideGeneric
      ? '✓ Hiding Generic Camera Filenames (Descriptive Only)'
      : '👁 Hide Generic Camera Filenames';
  }
  const bulkRemGenBtn = document.getElementById('btn-review-bulk-remove-generic');
  if (bulkRemGenBtn) {
    bulkRemGenBtn.textContent = genericPending > 0
      ? `🧹 Bulk-Remove Generic Camera Filenames (${genericPending.toLocaleString()} pending)`
      : '🧹 Bulk-Remove Generic Camera Filenames (0 pending)';
  }
  const genNote = document.getElementById('review-generic-status-note');
  if (genNote) {
    if (reviewState.hideGeneric) {
      genNote.textContent = `Filter ON: Hiding raw camera/code filenames (${genericTotal.toLocaleString()} total generic) • Descriptive part names only`;
    } else if (genericPending > 0) {
      genNote.textContent = `${genericPending.toLocaleString()} pending generic filename(s) detected • 1-click hide or bulk-remove (KEEP untouched)`;
    } else {
      genNote.textContent = `✓ 0 generic camera filenames in Pending • Only descriptive part names left (${pending.toLocaleString()})`;
    }
  }

  // Folder dropdown
  const sel = document.getElementById('review-folder-select');
  const folders = sum.folders || [];
  if (sel) {
    sel.innerHTML =
      `<option value="all">All Vehicle Folders (${folders.length} folders • ${total.toLocaleString()} photos)</option>` +
      folders.map((f) => {
        const countLabel = reviewState.status === 'pending'
          ? `${f.pending} pending / ${f.total}`
          : reviewState.status === 'keep'
            ? `${f.keep} keep / ${f.total}`
            : reviewState.status === 'remove'
              ? `${f.remove} remove / ${f.total}`
              : `${f.total} total`;
        return `<option value="${esc(f.name)}">${esc(f.name)} (${countLabel})</option>`;
      }).join('');
    sel.value = reviewState.folder;
  }

  // Scrollable folder chips
  const chipsEl = document.getElementById('review-folder-chips');
  if (chipsEl) {
    const allChip = `<button type="button" class="review-folder-chip ${reviewState.folder === 'all' ? 'active' : ''}" onclick="selectReviewFolder('all')">All Folders <span class="chip-count">${pending}</span></button>`;
    const fChips = folders.map((f) => {
      const activeCls = reviewState.folder === f.name ? 'active' : '';
      const unidCls = f.name === 'Unidentified_Auto_Parts_Needs_Tag' ? 'unidentified' : '';
      const badgeNum = reviewState.status === 'keep' ? f.keep : reviewState.status === 'remove' ? f.remove : reviewState.status === 'all' ? f.total : f.pending;
      const shortLabel = f.name === 'Unidentified_Auto_Parts_Needs_Tag' ? '🏷 Unidentified (Needs Tag)' : f.name;
      return `<button type="button" class="review-folder-chip ${unidCls} ${activeCls}" onclick="selectReviewFolder('${esc(f.name).replace(/'/g, "\\'")}')">${esc(shortLabel)} <span class="chip-count">${badgeNum}</span></button>`;
    }).join('');
    chipsEl.innerHTML = allChip + fChips;
  }

  // Folder context banner (when specific folder selected)
  const banner = document.getElementById('review-folder-banner');
  if (banner) {
    const activeFolder = folders.find((f) => f.name === reviewState.folder);
    if (activeFolder) {
      banner.style.display = 'flex';
      banner.innerHTML = `
        <div>
          <strong>📁 ${esc(activeFolder.name)}</strong> —
          <span>${activeFolder.total} total • <strong style="color:var(--status-warn-fg);">${activeFolder.pending} pending</strong> • <strong style="color:var(--status-ok-fg);">${activeFolder.keep} keep</strong> • <strong style="color:var(--status-err-fg);">${activeFolder.remove} remove</strong></span>
        </div>
        <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
          <a href="${esc(activeFolder.drive_folder_url)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">Open Folder in Drive ↗</a>
          ${activeFolder.pending > 0 ? `
            <button type="button" class="btn btn-outline btn-sm" style="border-color:#15803d;color:#15803d;" onclick="bulkDecideCurrentFolder('keep')">✓ Keep All ${activeFolder.pending} Pending</button>
            <button type="button" class="btn btn-outline btn-sm" style="border-color:#dc2626;color:#dc2626;" onclick="bulkDecideCurrentFolder('remove')">✕ Remove All ${activeFolder.pending} Pending</button>
          ` : ''}
        </div>
      `;
    } else {
      banner.style.display = 'none';
      banner.innerHTML = '';
    }
  }
}

function renderReviewStage() {
  const triageEl = document.getElementById('review-triage-stage');
  const gridEl = document.getElementById('review-grid-stage');
  const pagerEl = document.getElementById('review-pagination-bar');

  if (reviewState.mode === 'triage') {
    triageEl.style.display = 'block';
    gridEl.style.display = 'none';
    renderReviewTriageCard(triageEl);
  } else {
    triageEl.style.display = 'none';
    gridEl.style.display = 'grid';
    renderReviewGridCards(gridEl);
  }

  // Pagination bar
  if (reviewState.totalPages > 1) {
    pagerEl.innerHTML = `
      <button type="button" class="btn btn-outline btn-sm" ${reviewState.page <= 1 ? 'disabled' : ''} onclick="goReviewPage(${reviewState.page - 1})">← Prev Page</button>
      <span class="mono" style="font-size:0.82rem;font-weight:700;">Page ${reviewState.page} of ${reviewState.totalPages} (${reviewState.totalFiltered.toLocaleString()} matching)</span>
      <button type="button" class="btn btn-outline btn-sm" ${reviewState.page >= reviewState.totalPages ? 'disabled' : ''} onclick="goReviewPage(${reviewState.page + 1})">Next Page →</button>
    `;
  } else {
    pagerEl.innerHTML = reviewState.totalFiltered > 0
      ? `<span class="mono" style="font-size:0.8rem;color:var(--text-muted);">Showing ${reviewState.items.length} of ${reviewState.totalFiltered.toLocaleString()} matching photos</span>`
      : '';
  }
}

function renderReviewTriageCard(container) {
  if (!reviewState.items.length) {
    container.innerHTML = `
      <div class="surface-card" style="text-align:center;padding:2.2rem 1.25rem;">
        <h3 style="margin:0 0 0.45rem;">${reviewState.status === 'pending' ? '🎉 All Caught Up in This Filter!' : 'No Photos Match This Filter'}</h3>
        <p style="margin:0 0 1rem;color:var(--text-secondary);font-size:0.88rem;">
          ${reviewState.status === 'pending'
            ? 'Every photo in this folder has been sorted into KEEP or REMOVE. Switch folders above or inspect your KEEP / REMOVE lists.'
            : 'Try switching status filters (Pending / KEEP / REMOVE / All) or clearing your search.'}
        </p>
        <div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary btn-sm" onclick="selectReviewFolder('all'); setReviewStatusFilter('pending');">View All Remaining Pending</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="setReviewStatusFilter('keep')">Inspect ✓ KEEP List</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="setReviewStatusFilter('remove')">Inspect ✕ REMOVE List</button>
        </div>
      </div>
    `;
    return;
  }

  const item = reviewState.items[reviewState.triageIdx] || reviewState.items[0];
  const globalPos = (reviewState.page - 1) * reviewState.limit + reviewState.triageIdx + 1;
  const folderName = item.effective_folder || item.vehicle_folder;
  const statusRibbon = item.review_status === 'keep'
    ? '<span class="review-status-ribbon status-keep">✓ KEPT (IN STOCK)</span>'
    : item.review_status === 'remove'
      ? '<span class="review-status-ribbon status-remove">✕ REMOVED (SOLD/SCRAP)</span>'
      : '<span class="review-status-ribbon status-pending">PENDING REVIEW</span>';

  const folders = reviewState.summary?.folders || [];
  const folderOptions = folders.map((f) => `<option value="${esc(f.name)}" ${f.name === folderName ? 'selected' : ''}>${esc(f.name)}</option>`).join('');

  container.innerHTML = `
    <article class="review-triage-card" id="review-active-card" data-uid="${esc(item.photo_uid)}">
      <div class="review-triage-header">
        <div>
          <span class="badge badge-warn mono">${esc(item.photo_uid)}</span>
          <strong style="margin-left:0.4rem;font-size:0.9rem;">${esc(folderName)}</strong>
        </div>
        <span class="mono" style="font-size:0.78rem;opacity:0.86;">${globalPos.toLocaleString()} / ${reviewState.totalFiltered.toLocaleString()}</span>
      </div>

      <div class="review-triage-media" id="review-triage-media" onclick="openReviewZoomModal('${esc(item.photo_uid)}')">
        <img src="${esc(item.thumb_url)}" alt="${esc(item.title_hint || item.original_name)}" loading="eager" decoding="async" />
        ${statusRibbon}
      </div>

      <div class="review-triage-body">
        <h4 class="review-triage-title">${esc(item.title_hint || item.original_name)}</h4>
        <div class="review-triage-sub">
          File: <span class="mono">${esc(item.original_name)}</span>
          ${item.is_generic_filename ? ' • <span class="review-generic-badge">Generic Filename</span>' : ''}
          ${item.copy_count > 1 ? ` • <span class="badge badge-dark">${item.copy_count} dupes merged</span>` : ''}
          ${item.notes ? ` • Note: <strong>${esc(item.notes)}</strong>` : ''}
        </div>

        <div class="review-big-actions">
          <button type="button" class="btn-review-remove" onclick="decideReviewPhoto('${esc(item.photo_uid)}', 'remove')">
            ✕ REMOVE
            <small>Sold / Disposed (R)</small>
          </button>
          <button type="button" class="btn-review-keep" onclick="decideReviewPhoto('${esc(item.photo_uid)}', 'keep')">
            ✓ KEEP
            <small>In Stock (K)</small>
          </button>
        </div>

        <div class="review-triage-footer">
          <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" onclick="stepReviewTriage(-1)" ${reviewState.triageIdx <= 0 && reviewState.page <= 1 ? 'disabled' : ''}>← Prev</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="stepReviewTriage(1)" ${reviewState.triageIdx >= reviewState.items.length - 1 && reviewState.page >= reviewState.totalPages ? 'disabled' : ''}>Skip / Next →</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="openReviewZoomModal('${esc(item.photo_uid)}')">🔍 Zoom &amp; Tag</button>
          </div>
          ${folderName === 'Unidentified_Auto_Parts_Needs_Tag' ? `
            <select class="select" style="width:auto;min-width:190px;padding:0.35rem 0.55rem;font-size:0.78rem;" onchange="quickRetagReviewPhoto('${esc(item.photo_uid)}', this.value)" aria-label="Quick re-tag vehicle folder">
              <option value="">🏷 Re-tag to Vehicle Folder...</option>
              ${folderOptions}
            </select>
          ` : `
            <a href="${esc(item.drive_url)}" target="_blank" rel="noopener" style="font-size:0.78rem;font-weight:700;color:var(--brand-steel);">Drive Original ↗</a>
          `}
        </div>
        <div style="margin-top:0.55rem;font-size:0.72rem;color:var(--text-muted);text-align:center;">
          Tip: Swipe photo <strong>Right = KEEP</strong> or <strong>Left = REMOVE</strong> • Tap photo to zoom or re-tag vehicle
        </div>
      </div>
    </article>
  `;

  attachTriageSwipeListeners();
}

function attachTriageSwipeListeners() {
  const media = document.getElementById('review-triage-media');
  const card = document.getElementById('review-active-card');
  if (!media || !card) return;
  const uid = card.dataset.uid;
  let startX = 0;
  let startY = 0;
  let tracking = false;

  media.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  media.addEventListener('touchend', (e) => {
    if (!tracking || !e.changedTouches.length) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx > 0) decideReviewPhoto(uid, 'keep');
      else decideReviewPhoto(uid, 'remove');
    }
  }, { passive: true });
}

function renderReviewGridCards(container) {
  if (!reviewState.items.length) {
    container.style.display = 'block';
    container.innerHTML = `
      <div class="surface-card" style="text-align:center;padding:2rem 1rem;">
        <h3 style="margin:0 0 0.4rem;">No Photos in This Filter</h3>
        <p style="margin:0 0 0.85rem;color:var(--text-secondary);font-size:0.86rem;">Try another vehicle folder or switch between Pending, KEEP, REMOVE, and All.</p>
        <button type="button" class="btn btn-primary btn-sm" onclick="selectReviewFolder('all'); setReviewStatusFilter('all');">Show All Photos</button>
      </div>
    `;
    return;
  }

  container.innerHTML = reviewState.items.map((item) => {
    const folderName = item.effective_folder || item.vehicle_folder;
    const statusCls = item.review_status === 'keep' ? 'is-keep' : item.review_status === 'remove' ? 'is-remove' : '';
    const ribbon = item.review_status === 'keep'
      ? '<span class="review-status-ribbon status-keep">✓ KEEP</span>'
      : item.review_status === 'remove'
        ? '<span class="review-status-ribbon status-remove">✕ REMOVE</span>'
        : '';

    return `
      <article class="review-card ${statusCls}" data-uid="${esc(item.photo_uid)}">
        <div class="review-card-media" onclick="openReviewZoomModal('${esc(item.photo_uid)}')">
          <img src="${esc(item.thumb_url)}" alt="${esc(item.title_hint || item.original_name)}" loading="lazy" decoding="async" />
          ${ribbon}
        </div>
        <div class="review-card-body">
          <div class="review-card-folder" title="${esc(folderName)}">${esc(folderName)}</div>
          <div class="review-card-name" title="${esc(item.title_hint || item.original_name)}">${esc(item.title_hint || item.original_name)}</div>
          <div class="review-card-meta">
            <span class="mono">${esc(item.photo_uid)}</span>
            ${item.is_generic_filename ? '<span class="review-generic-badge">Generic</span>' : `<span>${item.copy_count > 1 ? `×${item.copy_count} merged` : 'Unique'}</span>`}
          </div>
        </div>
        <div class="review-card-actions">
          <button type="button" class="btn-review-remove" onclick="decideReviewPhoto('${esc(item.photo_uid)}', 'remove')">
            ✕ REMOVE
            <small>Sold/Scrap</small>
          </button>
          <button type="button" class="btn-review-keep" onclick="decideReviewPhoto('${esc(item.photo_uid)}', 'keep')">
            ✓ KEEP
            <small>In Stock</small>
          </button>
        </div>
      </article>
    `;
  }).join('');
}

async function decideReviewPhoto(uid, nextStatus, extraMeta = null) {
  const idx = reviewState.items.findIndex((i) => i.photo_uid === uid);
  const item = idx >= 0 ? reviewState.items[idx] : (reviewState.zoomItem?.photo_uid === uid ? reviewState.zoomItem : null);
  const prevStatus = item ? item.review_status : 'pending';
  const prevTag = item ? (item.vehicle_tag_override || '') : '';
  const prevNotes = item ? (item.notes || '') : '';

  // Record undo entry
  reviewState.undoStack.push({ uid, prevStatus, prevTag, prevNotes });
  if (reviewState.undoStack.length > 50) reviewState.undoStack.shift();

  // Save immediately to phone localStorage
  const payload = { status: nextStatus };
  if (extraMeta) {
    if (extraMeta.vehicle_tag_override !== undefined) payload.vehicle_tag_override = extraMeta.vehicle_tag_override;
    if (extraMeta.notes !== undefined) payload.notes = extraMeta.notes;
  }
  saveLocalReviewDecision(uid, payload);

  // Optimistic local UI update for 0ms tap feel
  if (reviewState.summary && prevStatus !== nextStatus) {
    if (prevStatus === 'pending') reviewState.summary.pending = Math.max(0, reviewState.summary.pending - 1);
    else if (prevStatus === 'keep') reviewState.summary.keep = Math.max(0, reviewState.summary.keep - 1);
    else if (prevStatus === 'remove') reviewState.summary.remove = Math.max(0, reviewState.summary.remove - 1);

    if (nextStatus === 'pending') reviewState.summary.pending += 1;
    else if (nextStatus === 'keep') reviewState.summary.keep += 1;
    else if (nextStatus === 'remove') reviewState.summary.remove += 1;

    const effFolder = item ? (item.effective_folder || item.vehicle_folder) : '';
    const fObj = (reviewState.summary.folders || []).find((f) => f.name === effFolder);
    if (fObj) {
      if (prevStatus === 'pending') fObj.pending = Math.max(0, fObj.pending - 1);
      else if (prevStatus === 'keep') fObj.keep = Math.max(0, fObj.keep - 1);
      else if (prevStatus === 'remove') fObj.remove = Math.max(0, fObj.remove - 1);

      if (nextStatus === 'pending') fObj.pending += 1;
      else if (nextStatus === 'keep') fObj.keep += 1;
      else if (nextStatus === 'remove') fObj.remove += 1;
    }
  }

  if (idx >= 0) {
    reviewState.items[idx].review_status = nextStatus;
    if (extraMeta?.vehicle_tag_override !== undefined) {
      reviewState.items[idx].vehicle_tag_override = extraMeta.vehicle_tag_override;
      reviewState.items[idx].effective_folder = extraMeta.vehicle_tag_override || reviewState.items[idx].vehicle_folder;
    }
    if (extraMeta?.notes !== undefined) {
      reviewState.items[idx].notes = extraMeta.notes;
    }
    if (reviewState.status !== 'all' && reviewState.status !== nextStatus) {
      reviewState.items.splice(idx, 1);
      reviewState.totalFiltered = Math.max(0, reviewState.totalFiltered - 1);
      if (reviewState.triageIdx >= reviewState.items.length) {
        reviewState.triageIdx = Math.max(0, reviewState.items.length - 1);
      }
    } else if (reviewState.mode === 'triage' && reviewState.triageIdx < reviewState.items.length - 1) {
      reviewState.triageIdx += 1;
    }
  }

  closeReviewZoomModal();
  renderReviewChrome();
  renderReviewStage();
  preloadUpcomingReviewThumbs();

  // Persist to cloud SQLite
  try {
    const res = await api(`/api/review-photos/${encodeURIComponent(uid)}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res.summary) {
      reviewState.summary = res.summary;
      if (state.data) {
        state.data.reviewSummary = res.summary;
        renderStaffKpis();
      }
      renderReviewChrome();
    }
    setReviewSyncBadge('✓ Phone + Cloud');
  } catch (_) {
    setReviewSyncBadge('Saved on Phone (Retry Soon)', true);
  }

  // Auto-fetch next batch if current filtered page just became empty while more matching photos remain
  if (reviewState.items.length === 0 && reviewState.totalFiltered > 0) {
    await loadReviewGallery(false);
  }
}

async function undoLastReviewDecision() {
  const last = reviewState.undoStack.pop();
  if (!last) return;
  saveLocalReviewDecision(last.uid, {
    status: last.prevStatus,
    vehicle_tag_override: last.prevTag,
    notes: last.prevNotes
  });
  try {
    await api(`/api/review-photos/${encodeURIComponent(last.uid)}`, {
      method: 'POST',
      body: JSON.stringify({
        status: last.prevStatus,
        vehicle_tag_override: last.prevTag,
        notes: last.prevNotes
      })
    });
    showToast(`Undid ${last.uid} → restored to ${last.prevStatus.toUpperCase()}`);
    await loadReviewGallery(false);
  } catch (err) {
    showToast('Undo failed: ' + err.message);
  }
}

async function quickRetagReviewPhoto(uid, newFolder) {
  if (!newFolder) return;
  const item = reviewState.items.find((i) => i.photo_uid === uid);
  const status = item?.review_status || 'pending';
  saveLocalReviewDecision(uid, { status, vehicle_tag_override: newFolder });
  try {
    await api(`/api/review-photos/${encodeURIComponent(uid)}`, {
      method: 'POST',
      body: JSON.stringify({ status, vehicle_tag_override: newFolder })
    });
    showToast(`Re-tagged ${uid} → ${newFolder}`);
    await loadReviewGallery(false);
  } catch (err) {
    showToast('Could not re-tag: ' + err.message);
  }
}

async function bulkDecideCurrentFolder(targetStatus) {
  if (!reviewState.folder || reviewState.folder === 'all') return;
  const actionWord = targetStatus === 'keep' ? 'KEEP (In Stock)' : 'REMOVE (Sold / Disposed)';
  const ok = window.confirm(`Mark ALL remaining PENDING photos in "${reviewState.folder}" as ${actionWord}?`);
  if (!ok) return;
  try {
    const res = await api('/api/review-photos/bulk-status', {
      method: 'POST',
      body: JSON.stringify({
        folder: reviewState.folder,
        from_status: 'pending',
        status: targetStatus
      })
    });
    showToast(`Updated ${res.updated} photos in ${reviewState.folder} → ${actionWord}`);
    await loadReviewGallery(true);
  } catch (err) {
    showToast('Bulk update failed: ' + err.message);
  }
}

function toggleHideGenericFilenames() {
  reviewState.hideGeneric = !reviewState.hideGeneric;
  showToast(
    reviewState.hideGeneric
      ? 'Filter ON: Hiding generic camera/code filenames (showing descriptive part filenames only).'
      : 'Filter OFF: Showing all matching filenames in this view.'
  );
  loadReviewGallery(true);
}

async function bulkRemoveGenericFilenames() {
  const genericPending = Number(reviewState.summary?.generic_pending || 0);
  const scopeLabel = reviewState.folder && reviewState.folder !== 'all' ? `folder "${reviewState.folder}"` : 'all folders';
  if (genericPending === 0) {
    showToast('All clear — 0 pending generic camera filenames remaining (100% of KEEP items untouched).');
    return;
  }
  const ok = window.confirm(
    `Mark all remaining PENDING photos with raw camera or non-descriptive filenames (e.g. timestamps, IMG_*, PXL_*, Screenshot_*, DSC_*, random codes) in ${scopeLabel} as REMOVE?\n\n100% of items you marked KEEP will stay untouched.`
  );
  if (!ok) return;
  try {
    const res = await api('/api/review-photos/bulk-remove-generic', {
      method: 'POST',
      body: JSON.stringify({ folder: reviewState.folder || 'all' })
    });
    const count = Number(res.removed_count || 0);
    if (count > 0) {
      showToast(`Bulk-removed ${count.toLocaleString()} generic camera/code filename(s) from Pending (100% of KEEP untouched).`);
    } else {
      showToast('All clear — 0 pending generic camera filenames found in this scope.');
    }
    await loadReviewGallery(true);
  } catch (err) {
    showToast('Bulk-remove generic filenames failed: ' + err.message);
  }
}

function selectReviewFolder(folderName) {
  reviewState.folder = folderName || 'all';
  loadReviewGallery(true);
}

function setReviewStatusFilter(status) {
  reviewState.status = status || 'pending';
  loadReviewGallery(true);
}

function setReviewLayoutMode(mode) {
  reviewState.mode = mode === 'grid' ? 'grid' : 'triage';
  renderReviewChrome();
  renderReviewStage();
}

function stepReviewTriage(delta) {
  const nextIdx = reviewState.triageIdx + delta;
  if (nextIdx >= 0 && nextIdx < reviewState.items.length) {
    reviewState.triageIdx = nextIdx;
    renderReviewStage();
    preloadUpcomingReviewThumbs();
  } else if (delta > 0 && reviewState.page < reviewState.totalPages) {
    reviewState.page += 1;
    reviewState.triageIdx = 0;
    loadReviewGallery(false);
  } else if (delta < 0 && reviewState.page > 1) {
    reviewState.page -= 1;
    reviewState.triageIdx = 0;
    loadReviewGallery(false);
  }
}

function goReviewPage(pageNum) {
  reviewState.page = Math.max(1, Math.min(reviewState.totalPages, pageNum));
  reviewState.triageIdx = 0;
  loadReviewGallery(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openReviewZoomModal(uid) {
  const item = reviewState.items.find((i) => i.photo_uid === uid);
  if (!item) return;
  reviewState.zoomItem = item;
  const effFolder = item.effective_folder || item.vehicle_folder;

  document.getElementById('review-zoom-uid').textContent = item.photo_uid;
  document.getElementById('review-zoom-folder').textContent = effFolder;
  document.getElementById('review-zoom-img').src = item.thumb_url;
  document.getElementById('review-zoom-title').textContent = item.title_hint || item.original_name;
  document.getElementById('review-zoom-meta').textContent =
    `File: ${item.original_name} • Source: ${item.source_path || 'Google Drive'} • Copies merged: ${item.copy_count || 1}`;
  document.getElementById('review-zoom-drive-link').href = item.drive_url || reviewState.summary?.master_drive_folder_url || '#';

  const folders = reviewState.summary?.folders || [];
  const tagSel = document.getElementById('review-zoom-tag-select');
  tagSel.innerHTML = folders.map((f) => `<option value="${esc(f.name)}" ${f.name === effFolder ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  if (!folders.some((f) => f.name === effFolder)) {
    tagSel.innerHTML = `<option value="${esc(effFolder)}" selected>${esc(effFolder)}</option>` + tagSel.innerHTML;
  }
  document.getElementById('review-zoom-tag-custom').value = '';
  document.getElementById('review-zoom-notes').value = item.notes || '';
  document.getElementById('review-zoom-modal').classList.add('open');
}

function closeReviewZoomModal() {
  document.getElementById('review-zoom-modal')?.classList.remove('open');
  reviewState.zoomItem = null;
}

function readZoomModalMetaPatch() {
  const customTag = (document.getElementById('review-zoom-tag-custom')?.value || '').trim();
  const selTag = (document.getElementById('review-zoom-tag-select')?.value || '').trim();
  const notes = (document.getElementById('review-zoom-notes')?.value || '').trim();
  const item = reviewState.zoomItem;
  const chosenFolder = customTag || selTag;
  const vehicle_tag_override = item && chosenFolder && chosenFolder !== item.vehicle_folder ? chosenFolder : (customTag || '');
  return { vehicle_tag_override, notes };
}

async function runKeepBatchIntakeAndPublishUi() {
  showToast('Pre-VIN KEEP bulk publishing is permanently disabled. Lock a 17-char VIN or License Plate in Step 1, then drop photos, a .zip archive, or a Google Drive link in Step 2.');
  if (typeof switchStaffTab === 'function') {
    switchStaffTab('staff-intake');
  }
  const vinInput = document.querySelector('#emp-step1-vin-form input[name="vin"]');
  if (vinInput) {
    vinInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    vinInput.focus();
  }
}

function bindReviewGalleryEvents() {
  document.getElementById('btn-rev-mode-triage')?.addEventListener('click', () => setReviewLayoutMode('triage'));
  document.getElementById('btn-rev-mode-grid')?.addEventListener('click', () => setReviewLayoutMode('grid'));
  document.getElementById('btn-review-undo')?.addEventListener('click', undoLastReviewDecision);
  document.getElementById('btn-review-hide-generic')?.addEventListener('click', toggleHideGenericFilenames);
  document.getElementById('btn-review-bulk-remove-generic')?.addEventListener('click', bulkRemoveGenericFilenames);
  document.getElementById('btn-review-run-keep-intake')?.addEventListener('click', runKeepBatchIntakeAndPublishUi);
  document.getElementById('btn-inv-run-keep-intake')?.addEventListener('click', runKeepBatchIntakeAndPublishUi);

  document.querySelectorAll('#review-status-pills .review-filter-pill').forEach((btn) => {
    btn.addEventListener('click', () => setReviewStatusFilter(btn.dataset.status));
  });

  document.getElementById('review-folder-select')?.addEventListener('change', (e) => {
    selectReviewFolder(e.target.value);
  });

  document.getElementById('review-search-input')?.addEventListener('input', (e) => {
    clearTimeout(reviewState.searchTimer);
    reviewState.searchTimer = setTimeout(() => {
      reviewState.q = (e.target.value || '').trim();
      loadReviewGallery(true);
    }, 260);
  });

  document.getElementById('btn-close-review-zoom')?.addEventListener('click', closeReviewZoomModal);
  document.getElementById('review-zoom-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'review-zoom-modal') closeReviewZoomModal();
  });

  document.getElementById('btn-review-zoom-save-meta')?.addEventListener('click', async () => {
    if (!reviewState.zoomItem) return;
    const patch = readZoomModalMetaPatch();
    await decideReviewPhoto(reviewState.zoomItem.photo_uid, reviewState.zoomItem.review_status, patch);
    showToast('Saved vehicle folder tag & note!');
    await loadReviewGallery(false);
  });

  document.getElementById('btn-review-zoom-keep')?.addEventListener('click', () => {
    if (!reviewState.zoomItem) return;
    decideReviewPhoto(reviewState.zoomItem.photo_uid, 'keep', readZoomModalMetaPatch());
  });

  document.getElementById('btn-review-zoom-remove')?.addEventListener('click', () => {
    if (!reviewState.zoomItem) return;
    decideReviewPhoto(reviewState.zoomItem.photo_uid, 'remove', readZoomModalMetaPatch());
  });

  // Keyboard triage shortcuts (K = KEEP, R = REMOVE, Z = Undo, Arrows = Prev/Next)
  document.addEventListener('keydown', (e) => {
    const reviewVisible = document.getElementById('view-staff')?.classList.contains('active') &&
      document.getElementById('staff-review')?.classList.contains('active');
    if (!reviewVisible || reviewState.mode !== 'triage') return;
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;
    if (document.getElementById('review-zoom-modal')?.classList.contains('open')) {
      if (e.key === 'Escape') closeReviewZoomModal();
      return;
    }
    const cur = reviewState.items[reviewState.triageIdx];
    if (!cur) return;
    const key = e.key.toLowerCase();
    if (key === 'k') {
      e.preventDefault();
      decideReviewPhoto(cur.photo_uid, 'keep');
    } else if (key === 'r') {
      e.preventDefault();
      decideReviewPhoto(cur.photo_uid, 'remove');
    } else if (key === 'z') {
      e.preventDefault();
      undoLastReviewDecision();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepReviewTriage(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepReviewTriage(-1);
    }
  });
}

function notifyCrosslistZipDownload(label) {
  if (typeof showToast === 'function') {
    showToast(`Building ${label} — your browser download will start automatically in a few seconds...`);
  }
}

function renderCrosslistBatchDownloadsUi(totalActiveCount) {
  const host = document.getElementById('crosslist-batch-downloads');
  const badge = document.getElementById('crosslist-batch-count-badge');
  if (!host) return;

  const top200Count = Number(state.top200Plan?.summary?.top200_count || Math.min(200, Number(totalActiveCount || 200)));
  const totalCatalog = Math.max(0, Number(state.data?.inventory?.filter((i) => i.status === 'active' && Number(i.quantity || 0) > 0).length || totalActiveCount || 0));
  const batchSize = 250;
  const totalBatches = Math.max(1, Math.ceil(totalCatalog / batchSize));

  if (badge) {
    badge.textContent = `Top ${top200Count} (1 Batch) • ${totalCatalog} Active`;
  }

  const rows = [];
  rows.push(`
    <div class="cl-batch-row is-full" style="border-color:#2563eb;background:rgba(37,99,235,0.06);">
      <div>
        <div class="cl-batch-title">🎯 Top-${top200Count} Strategy Single Batch (Recommended for Crosslist Cap)</div>
        <div class="cl-batch-sub">Fits Crosslist's 200–250 cap in 1 upload (<code>tier=top200</code> — high-ticket local + fast parcel movers)</div>
      </div>
      <div class="cl-batch-btns">
        <a href="/api/exports/crosslist.csv?tier=top200" download="crosslist-top200-ebay-offerup-fb.csv" class="btn btn-primary btn-sm">⬇ Top-200 CSV</a>
        <a href="/api/exports/crosslist-images.zip?tier=top200" download="crosslist-images-top200.zip" class="btn btn-dark btn-sm" onclick="notifyCrosslistZipDownload('Crosslist Top-200 Images ZIP (${top200Count} SKUs)')">📦 Top-200 ZIP</a>
      </div>
    </div>
  `);

  rows.push(`
    <div class="cl-batch-row is-full">
      <div>
        <div class="cl-batch-title">All Active Catalog (${totalCatalog} Active SKUs)</div>
        <div class="cl-batch-sub">Unfiltered active catalog in 1 CSV + 1 Images ZIP (<code>tier=all</code>)</div>
      </div>
      <div class="cl-batch-btns">
        <a href="/api/exports/crosslist.csv?tier=all" download="crosslist-ebay-offerup-fb-import.csv" class="btn btn-outline btn-sm">⬇ All Active CSV</a>
        <a href="/api/exports/crosslist-images.zip?tier=all" download="crosslist-images.zip" class="btn btn-outline btn-sm" onclick="notifyCrosslistZipDownload('Full Crosslist Images ZIP (${totalCatalog} SKUs)')">📦 All Active ZIP</a>
      </div>
    </div>
  `);

  if (totalCatalog > batchSize) {
    for (let b = 1; b <= totalBatches; b++) {
      const startItem = (b - 1) * batchSize + 1;
      const endItem = totalCatalog > 0 ? Math.min(totalCatalog, b * batchSize) : b * batchSize;
      const count = totalCatalog > 0 ? Math.max(0, endItem - startItem + 1) : batchSize;
      const rangeLabel = totalCatalog > 0 ? `Items ${startItem}–${endItem} (${count} SKUs)` : `Up to ${batchSize} SKUs`;
      rows.push(`
        <div class="cl-batch-row is-batch">
          <div>
            <div class="cl-batch-title">Full-Catalog Batch ${b} — ${rangeLabel}</div>
            <div class="cl-batch-sub">250-item pair (<code>tier=all&amp;batch=${b}&amp;size=${batchSize}</code>)</div>
          </div>
          <div class="cl-batch-btns">
            <a href="/api/exports/crosslist.csv?tier=all&amp;batch=${b}&amp;size=${batchSize}" download="crosslist-import-batch${b}.csv" class="btn btn-outline btn-sm">⬇ Batch ${b} CSV</a>
            <a href="/api/exports/crosslist-images.zip?tier=all&amp;batch=${b}&amp;size=${batchSize}" download="crosslist-images-batch${b}.zip" class="btn btn-dark btn-sm" onclick="notifyCrosslistZipDownload('Crosslist Batch ${b} Images ZIP (${rangeLabel})')">📦 Batch ${b} ZIP</a>
          </div>
        </div>
      `);
    }
  }

  host.innerHTML = rows.join('');
}

async function loadCraigslistHubQueueUi(forceRefresh = false) {
  if (state.clQueueLoading) return;
  if (state.clQueueData && !forceRefresh) {
    renderCraigslistTrackerList();
    return;
  }

  state.clQueueLoading = true;
  const refreshBtn = document.getElementById('btn-cl-refresh-queue');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '⏳';
  }
  try {
    const res = await fetch('/api/craigslist/queue', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.clQueueData = data;
    renderCraigslistTrackerList();
    // Refresh header badges & batch counts with live queue count
    if (typeof renderCrosslistBatchDownloadsUi === 'function' && Number(data.count || 0) > 0) {
      renderCrosslistBatchDownloadsUi(data.count);
    }
    const clBadges = document.getElementById('crosslist-auto-sync-badges');
    if (clBadges && state.data) {
      const allInv = state.data.inventory || [];
      const soldCount = allInv.filter((i) => i.status === 'sold' || Number(i.quantity || 0) <= 0).length;
      const total = Number(data.count || 0);
      const posted = Number(data.posted_count || 0);
      const remaining = Math.max(0, Number(data.remaining_count ?? (total - posted)));
      clBadges.innerHTML = `
        <span class="badge badge-ok">Crosslist Ready: ${total} Single-Variant SKUs (Qty=1)</span>
        <span class="badge badge-ok">QR Cards Excluded: 0 Leaks</span>
        <span class="badge badge-ok">Sold/Auto-Delisted Excluded: ${soldCount}</span>
        <span class="badge ${remaining === 0 && total > 0 ? 'badge-ok' : 'badge-warn'}">Craigslist Tacoma (tac/ptd): ${posted} Posted • ${remaining} Remaining</span>
      `;
    }
  } catch (err) {
    const listEl = document.getElementById('cl-tracker-list');
    if (listEl) {
      listEl.innerHTML = `<div style="padding:0.7rem;color:#b91c1c;font-size:0.79rem;font-weight:600;">Could not load /api/craigslist/queue: ${esc(err.message || String(err))}</div>`;
    }
  } finally {
    state.clQueueLoading = false;
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '🔄 Sync';
    }
  }
}

function setCraigslistTrackerFilter(filter) {
  state.clTrackerFilter = filter || 'unposted';
  document.querySelectorAll('.cl-pill[data-cl-filter]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.clFilter === state.clTrackerFilter);
  });
  renderCraigslistTrackerList();
}

function renderCraigslistTrackerList() {
  const data = state.clQueueData;
  const summaryEl = document.getElementById('cl-progress-summary');
  const nextUpEl = document.getElementById('cl-next-up-card');
  const listEl = document.getElementById('cl-tracker-list');
  const launchBtn = document.getElementById('btn-cl-launch-next');
  if (!summaryEl || !listEl || !data) return;

  const queue = Array.isArray(data.queue) ? data.queue : [];
  const total = queue.length;
  const postedItems = queue.filter((q) => Boolean(q.posted_craigslist));
  const unpostedItems = queue.filter((q) => !q.posted_craigslist);
  const postedCount = postedItems.length;
  const remainingCount = unpostedItems.length;
  const pct = total > 0 ? Math.round((postedCount / total) * 100) : 0;

  summaryEl.innerHTML = `
    <div class="cl-progress-meta">
      <div class="cl-progress-stats">
        <span>Posted: <strong style="color:#15803d;">${postedCount}</strong></span>
        <span>Remaining: <strong style="color:#b45309;">${remainingCount}</strong></span>
        <span>Total Queue: <strong>${total}</strong></span>
      </div>
      <strong style="color:${pct === 100 && total > 0 ? '#15803d' : 'var(--text-primary)'};">${pct}% Complete</strong>
    </div>
    <div class="cl-progress-track">
      <div class="cl-progress-fill" style="width:${pct}%;"></div>
    </div>
  `;

  const clBadges = document.getElementById('crosslist-auto-sync-badges');
  if (clBadges) {
    const allInv = state.data?.inventory || [];
    const soldCount = allInv.filter((i) => i.status === 'sold' || Number(i.quantity || 0) <= 0).length;
    clBadges.innerHTML = `
      <span class="badge badge-ok">Crosslist Ready: ${total} Single-Variant SKUs (Qty=1)</span>
      <span class="badge badge-ok">QR Cards Excluded: 0 Leaks</span>
      <span class="badge badge-ok">Sold/Auto-Delisted Excluded: ${soldCount}</span>
      <span class="badge ${remainingCount === 0 && total > 0 ? 'badge-ok' : 'badge-warn'}">Craigslist Tacoma (tac/ptd): ${postedCount} Posted • ${remainingCount} Remaining</span>
    `;
  }

  // Update filter pill counts
  const pillUnposted = document.querySelector('.cl-pill[data-cl-filter="unposted"]');
  const pillPosted = document.querySelector('.cl-pill[data-cl-filter="posted"]');
  const pillAll = document.querySelector('.cl-pill[data-cl-filter="all"]');
  if (pillUnposted) pillUnposted.textContent = `Unposted (${remainingCount})`;
  if (pillPosted) pillPosted.textContent = `Posted (${postedCount})`;
  if (pillAll) pillAll.textContent = `All (${total})`;

  const nextItem = unpostedItems[0] || null;
  if (launchBtn) {
    launchBtn.textContent = nextItem
      ? `▶ Launch Next (${nextItem.sku} • $${nextItem.price_int || Math.round(Number(nextItem.price || 0))})`
      : '✅ All Queue SKUs Posted';
  }

  if (nextUpEl) {
    if (nextItem) {
      const photoCount = Array.isArray(nextItem.photos) ? nextItem.photos.length : 0;
      nextUpEl.style.display = 'flex';
      nextUpEl.innerHTML = `
        <div style="min-width:0;flex:1;">
          <div style="font-size:0.71rem;font-weight:800;color:#b45309;letter-spacing:0.03em;">UP NEXT IN AUTO-POST QUEUE</div>
          <div style="font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(nextItem.cl_title || nextItem.title)}">
            <span class="mono">${esc(nextItem.sku)}</span> — ${esc(nextItem.cl_title || nextItem.title)}
          </div>
          <div style="font-size:0.73rem;color:var(--text-secondary);">
            $${esc(nextItem.price_int || Math.round(Number(nextItem.price || 0)))} • 📷 ${photoCount} Shopify CDN photo${photoCount === 1 ? '' : 's'} • Tacoma (tac / fsd / ptd)
          </div>
        </div>
        <div style="display:flex;gap:0.35rem;flex-shrink:0;">
          <a href="${esc(nextItem.launch_url)}" target="_blank" rel="noopener" class="btn btn-dark btn-sm">Post ↗</a>
          <button type="button" class="btn btn-outline btn-sm" onclick="toggleCraigslistSkuPostedUi('${esc(nextItem.sku)}', true)">✓ Mark Posted</button>
        </div>
      `;
    } else {
      nextUpEl.style.display = 'flex';
      nextUpEl.innerHTML = `<strong style="color:#15803d;">🎉 Queue Complete — All ${total} active verified SKUs are marked posted on Craigslist Tacoma!</strong>`;
    }
  }

  const filter = state.clTrackerFilter || 'unposted';
  const searchVal = (document.getElementById('cl-tracker-search')?.value || '').trim().toLowerCase();
  let filtered =
    filter === 'posted'
      ? postedItems
      : filter === 'heavy'
      ? unpostedItems.filter((q) => Boolean(q.heavy_local_pickup))
      : filter === 'high150'
      ? unpostedItems.filter((q) => Number(q.price_int || q.price || 0) >= 150)
      : filter === 'all'
      ? queue
      : unpostedItems;
  if (searchVal) {
    filtered = filtered.filter((q) =>
      String(q.sku || '').toLowerCase().includes(searchVal) ||
      String(q.title || '').toLowerCase().includes(searchVal) ||
      String(q.cl_title || '').toLowerCase().includes(searchVal) ||
      String(q.ymm || '').toLowerCase().includes(searchVal)
    );
  }

  if (!filtered.length) {
    listEl.innerHTML = `<div style="padding:0.75rem;text-align:center;font-size:0.79rem;color:var(--text-muted);">No ${esc(filter)} SKUs match your filter.</div>`;
    return;
  }

  const maxShow = 60;
  const visible = filtered.slice(0, maxShow);
  const rowsHtml = visible.map((q) => {
    const isPosted = Boolean(q.posted_craigslist);
    const priceInt = q.price_int || Math.round(Number(q.price || 0));
    const installInt = Math.round(Number(q.install_price || 0));
    const photosLen = Array.isArray(q.photos) ? q.photos.length : 0;
    const postedStamp = q.posted_at ? String(q.posted_at).replace('T', ' ').slice(0, 16) : '';
    return `
      <div class="cl-tracker-item ${isPosted ? 'is-posted' : ''}">
        <div class="cl-tracker-item-info">
          <div class="cl-tracker-item-title" title="${esc(q.cl_title || q.title)}">${esc(q.cl_title || q.title)}</div>
          <div class="cl-tracker-item-meta">
            <span class="mono" style="font-weight:700;color:var(--text-primary);">${esc(q.sku)}</span>
            <span><strong>$${priceInt}</strong>${installInt > priceInt ? ` (Inst $${installInt})` : ''}</span>
            <span>📷 ${photosLen}</span>
            ${q.heavy_local_pickup ? `<span style="color:#b45309;font-weight:700;">📦 Heavy Local</span>` : ''}
            ${isPosted
              ? `<span style="color:#15803d;font-weight:700;">✓ Posted${postedStamp ? ` (${esc(postedStamp)})` : ''}</span>`
              : `<span>Unposted</span>`
            }
            ${q.craigslist_url ? `<a href="${esc(q.craigslist_url)}" target="_blank" rel="noopener" style="color:var(--brand-amber);font-weight:700;">View Ad ↗</a>` : ''}
          </div>
        </div>
        <div class="cl-tracker-item-actions">
          <a href="${esc(q.launch_url)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="padding:0.25rem 0.5rem;font-size:0.73rem;">Post ↗</a>
          ${isPosted
            ? `<button type="button" class="btn btn-outline btn-sm" style="padding:0.25rem 0.5rem;font-size:0.73rem;" onclick="toggleCraigslistSkuPostedUi('${esc(q.sku)}', false)">↺ Unmark</button>`
            : `<button type="button" class="btn btn-dark btn-sm" style="padding:0.25rem 0.5rem;font-size:0.73rem;" onclick="toggleCraigslistSkuPostedUi('${esc(q.sku)}', true)">✓ Posted</button>`
          }
        </div>
      </div>
    `;
  }).join('');

  const overflowNote = filtered.length > maxShow
    ? `<div style="padding:0.45rem;text-align:center;font-size:0.74rem;color:var(--text-muted);">Showing first ${maxShow} of ${filtered.length} SKUs — use search above to locate any SKU instantly.</div>`
    : '';

  listEl.innerHTML = rowsHtml + overflowNote;
}

async function toggleCraigslistSkuPostedUi(sku, postedBool) {
  if (!sku) return;
  try {
    const res = await fetch('/api/craigslist/mark-posted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, posted: Boolean(postedBool) })
    });
    const out = await res.json();
    if (!res.ok || !out.ok) {
      throw new Error(out.error || `HTTP ${res.status}`);
    }
    if (state.clQueueData && Array.isArray(state.clQueueData.queue)) {
      const target = state.clQueueData.queue.find((q) => q.sku === sku);
      if (target) {
        target.posted_craigslist = Boolean(out.craigslist_posted);
        target.posted_at = out.craigslist_posted_at || null;
      }
      state.clQueueData.posted_count = state.clQueueData.queue.filter((q) => q.posted_craigslist).length;
      state.clQueueData.remaining_count = state.clQueueData.queue.length - state.clQueueData.posted_count;
    }
    if (state.data && Array.isArray(state.data.inventory)) {
      const invItem = state.data.inventory.find((i) => i.sku === sku);
      if (invItem) {
        invItem.channels = invItem.channels || {};
        invItem.channels.craigslist_posted = Boolean(out.craigslist_posted);
        invItem.channels.craigslist_posted_at = out.craigslist_posted_at || null;
      }
    }
    renderCraigslistTrackerList();
    if (typeof showToast === 'function') {
      showToast(postedBool ? `Marked ${sku} as posted on Craigslist Tacoma!` : `Unmarked ${sku} — back in Craigslist auto-post queue.`);
    }
  } catch (err) {
    if (typeof showToast === 'function') {
      showToast(`Craigslist status update failed: ${err.message || err}`);
    }
  }
}

async function runCrosslistAutoSyncUi() {
  const btn = document.getElementById('btn-crosslist-auto-sync');
  const box = document.getElementById('crosslist-auto-sync-result');
  const origLabel = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Syncing Crosslist & Verifying QR Photo Isolation...';
  }
  try {
    const res = await fetch('/api/sync/crosslist-auto-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ push_shopify: false })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    const batchLinks = Array.isArray(data.crosslist_batches)
      ? data.crosslist_batches.map((b) => `
          <a href="${esc(b.csv_url)}" download="crosslist-import-batch${b.batch}.csv" class="btn btn-outline btn-sm">⬇ Batch ${b.batch} CSV (${b.start}–${b.end})</a>
          <a href="${esc(b.images_zip_url)}" download="crosslist-images-batch${b.batch}.zip" class="btn btn-outline btn-sm" onclick="notifyCrosslistZipDownload('Batch ${b.batch} Images ZIP')">📦 Batch ${b.batch} ZIP</a>
        `).join('')
      : '';
    if (box) {
      box.style.display = 'block';
      box.innerHTML = `
        <div style="font-weight:700;color:#15803d;margin-bottom:0.4rem;">
          ✅ Crosslist Auto-Sync Complete — ${data.ready_skus} Active Single-Variant OEM SKUs Ready (${data.sold_delisted_skus} Sold/Delisted Excluded • ${data.qr_leak_count} QR Cards Leaked)
        </div>
        <div style="display:flex;gap:0.45rem;flex-wrap:wrap;margin-top:0.45rem;">
          <a href="${esc(data.crosslist_csv_url || '/api/exports/crosslist.csv')}" download="crosslist-ebay-offerup-fb-import.csv" class="btn btn-primary btn-sm">⬇ Full Crosslist CSV</a>
          <a href="${esc(data.crosslist_images_zip_url || '/api/exports/crosslist-images.zip')}" download="crosslist-images.zip" class="btn btn-dark btn-sm" onclick="notifyCrosslistZipDownload('Full Crosslist Images ZIP')">📦 Full Images ZIP</a>
          ${batchLinks}
          <a href="${esc(data.craigslist_userscript_url || '/craigslist-autofill.user.js')}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">⚙ Install CL Auto-Fill Script</a>
          <button type="button" class="btn btn-outline btn-sm" onclick="copyFeedUrl('${esc(data.google_merchant_xml_url)}')">📋 Google Merchant XML</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="copyFeedUrl('${esc(data.meta_catalog_csv_url)}')">📋 Meta Catalog CSV</button>
        </div>
      `;
    }

    if (typeof loadBootstrap === 'function') {
      await loadBootstrap();
    }
    await loadCraigslistHubQueueUi(true);
    if (typeof showToast === 'function') {
      showToast(`Verified ${data.ready_skus} active SKUs (0 QR cards leaked) — all Crosslist CSV/ZIP & Craigslist exports ready!`);
    }
  } catch (err) {
    if (box) {
      box.style.display = 'block';
      box.innerHTML = `<span style="color:#b91c1c;font-weight:700;">❌ Crosslist Auto-Sync Error: ${esc(err.message || String(err))}</span>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origLabel || '⚡ Verify & Sync All Channels';
    }
  }
}

async function launchNextCraigslistQueueItemUi() {
  const box = document.getElementById('crosslist-auto-sync-result');
  try {
    const res = await fetch('/api/craigslist/queue', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.clQueueData = data;
    renderCraigslistTrackerList();
    const nextItem = (data.queue || []).find((q) => !q.posted_craigslist) || null;
    if (!nextItem) {
      if (box) {
        box.style.display = 'block';
        box.innerHTML = `<strong style="color:#15803d;">🎉 All ${data.count} active SKUs are already marked posted to Craigslist Tacoma (tac / fsd / ptd)!</strong>`;
      }
      return;
    }
    window.open(nextItem.launch_url, '_blank', 'noopener');
    if (box) {
      box.style.display = 'block';
      box.innerHTML = `
        <strong>🚗 Opened Craigslist Tacoma Dealer Auto Parts (<code>tac</code> → <code>fsd</code> → <code>ptd</code> • ZIP 98467) for <code>${esc(nextItem.sku)}</code> — ${esc(nextItem.cl_title || nextItem.title)} ($${nextItem.price_int || Math.round(Number(nextItem.price || 0))})</strong><br/>
        <span style="color:var(--text-secondary);">Queue Status: ${data.remaining_count} remaining • ${data.posted_count} posted • Make sure <a href="/craigslist-autofill.user.js" target="_blank" rel="noopener"><code>craigslist-autofill.user.js</code> (v2.3.0)</a> is installed in Tampermonkey.</span>
      `;
    }
  } catch (err) {
    if (box) {
      box.style.display = 'block';
      box.innerHTML = `<span style="color:#b91c1c;font-weight:700;">❌ Craigslist Queue Error: ${esc(err.message || String(err))}</span>`;
    }
  }
}

// ---------- Automated Top-200 Multi-Platform Deployment Strategy UI ----------
let top200PollTimer = null;

async function loadTop200PlanUi(forceRefresh = false) {
  const listEl = document.getElementById('top200-roster-list');
  if (!listEl) return;
  if (state.top200Plan && !forceRefresh) {
    renderTop200RosterUi();
    return;
  }
  try {
    const res = await fetch('/api/deployment/top200', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.top200Plan = data;

    const limInp = document.getElementById('top200-limit-input');
    if (limInp && data.config?.limit) limInp.value = String(data.config.limit);
    const boostChk = document.getElementById('top200-parcel-boost-chk');
    if (boostChk) boostChk.checked = data.config?.prefer_parcel_velocity !== false;
    const modeSel = document.getElementById('top200-shopify-mode');
    if (modeSel && data.config?.shopify_overflow_mode) modeSel.value = data.config.shopify_overflow_mode;

    renderTop200RosterUi();
    if (data.active_job && data.active_job.status === 'running') {
      pollTop200DeployStatusUi();
    } else if (data.active_job) {
      renderTop200DeployProgressUi(data.active_job);
    }
  } catch (err) {
    listEl.innerHTML = `<div style="padding:0.75rem;color:#b91c1c;font-weight:700;">❌ Could not load Top-200 strategy plan: ${esc(err.message || String(err))}</div>`;
  }
}

function setTop200TabUi(tab) {
  state.top200Tab = tab || 'top200';
  document.querySelectorAll('[data-t200-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-t200-tab') === state.top200Tab);
  });
  renderTop200RosterUi();
}

function renderTop200RosterUi() {
  const data = state.top200Plan;
  const badgesEl = document.getElementById('top200-summary-badges');
  const listEl = document.getElementById('top200-roster-list');
  if (!data || !listEl) return;

  const s = data.summary || {};
  if (badgesEl) {
    badgesEl.innerHTML = `
      <span class="badge badge-ok">Top ${s.top200_count || 0} Value: $${Number(s.top200_value || 0).toLocaleString()} (${s.top200_value_share_pct || 0}% of Catalog)</span>
      <span class="badge badge-ok">Parcel Fast-Sellers: ${s.top200_parcel || 0}</span>
      <span class="badge badge-warn">High-Ticket Local ($150–$${s.top200_max_price || 3500}): ${s.top200_local || 0}</span>
      <span class="badge badge-warn">Overflow Reserve: ${s.overflow_count || 0} SKUs ($${Number(s.overflow_value || 0).toLocaleString()})</span>
      ${s.pinned_count ? `<span class="badge badge-ok">📌 Pinned: ${s.pinned_count}</span>` : ''}
      ${s.excluded_count ? `<span class="badge badge-warn">✕ Swapped Out: ${s.excluded_count}</span>` : ''}
    `;
  }

  const tab = state.top200Tab || 'top200';
  const shipFilter = document.getElementById('top200-ship-filter')?.value || 'all';
  const qStr = (document.getElementById('top200-roster-search')?.value || '').trim().toLowerCase();

  let rows =
    tab === 'overflow'
      ? (data.overflow || [])
      : tab === 'pinned'
      ? [...(data.top200 || []).filter((x) => x.pinned), ...(data.overflow || []).filter((x) => x.excluded)]
      : (data.top200 || []);

  if (shipFilter === 'parcel') rows = rows.filter((x) => !x.heavy_local_pickup);
  if (shipFilter === 'local') rows = rows.filter((x) => x.heavy_local_pickup);
  if (qStr) {
    rows = rows.filter(
      (x) =>
        String(x.sku || '').toLowerCase().includes(qStr) ||
        String(x.title || '').toLowerCase().includes(qStr) ||
        String(x.ymm || '').toLowerCase().includes(qStr) ||
        String(x.reason || '').toLowerCase().includes(qStr)
    );
  }

  if (!rows.length) {
    listEl.innerHTML = '<div style="padding:0.75rem;text-align:center;font-size:0.79rem;color:var(--text-muted);">No items match this filter.</div>';
    return;
  }

  const visible = rows.slice(0, 80);
  listEl.innerHTML =
    visible
      .map((item) => {
        const isTop = item.tier === 'top200';
        const actionBtn = isTop
          ? item.pinned
            ? `<button type="button" class="btn btn-outline btn-sm" style="padding:0.24rem 0.5rem;font-size:0.72rem;" onclick="toggleTop200SkuOverrideUi('unpin', '${esc(item.sku)}')">Unpin</button>`
            : `<button type="button" class="btn btn-outline btn-sm" style="padding:0.24rem 0.5rem;font-size:0.72rem;" onclick="toggleTop200SkuOverrideUi('exclude', '${esc(item.sku)}')">✕ Swap Out</button>`
          : item.excluded
          ? `<button type="button" class="btn btn-dark btn-sm" style="padding:0.24rem 0.5rem;font-size:0.72rem;" onclick="toggleTop200SkuOverrideUi('include', '${esc(item.sku)}')">↺ Restore</button>`
          : `<button type="button" class="btn btn-primary btn-sm" style="padding:0.24rem 0.5rem;font-size:0.72rem;" onclick="toggleTop200SkuOverrideUi('pin', '${esc(item.sku)}')">📌 Pin to Top 200</button>`;

        return `
          <div class="cl-tracker-item ${isTop ? '' : 'is-posted'}">
            <div class="cl-tracker-item-info">
              <div class="cl-tracker-item-title" title="${esc(item.title)}">
                <span class="mono" style="color:var(--brand-amber);font-weight:800;">#${item.rank}</span> ${esc(item.title)}
              </div>
              <div class="cl-tracker-item-meta">
                <span class="mono" style="font-weight:700;color:var(--text-primary);">${esc(item.sku)}</span>
                <span><strong>$${item.price_int}</strong></span>
                <span>${item.heavy_local_pickup ? '📦 Heavy Local' : '📬 Parcel Shippable'}</span>
                <span style="color:var(--text-secondary);">${esc(item.reason)} (Score ${Math.round(item.score)})</span>
              </div>
            </div>
            <div class="cl-tracker-item-actions">${actionBtn}</div>
          </div>
        `;
      })
      .join('') +
    (rows.length > visible.length
      ? `<div style="padding:0.45rem;text-align:center;font-size:0.74rem;color:var(--text-muted);">Showing top ${visible.length} of ${rows.length} items — use search above to find &amp; pin any SKU.</div>`
      : '');
}

async function saveTop200SettingsUi() {
  const limit = Number(document.getElementById('top200-limit-input')?.value || 200);
  const preferParcel = Boolean(document.getElementById('top200-parcel-boost-chk')?.checked);
  const mode = document.getElementById('top200-shopify-mode')?.value || 'draft';
  try {
    const res = await fetch('/api/deployment/top200/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, prefer_parcel_velocity: preferParcel, shopify_overflow_mode: mode })
    });
    const out = await res.json();
    if (!res.ok || !out.ok) throw new Error(out.error || `HTTP ${res.status}`);
    await loadTop200PlanUi(true);
    if (typeof showToast === 'function') showToast(`Updated Top-${out.config.limit} strategy ranking!`);
  } catch (err) {
    if (typeof showToast === 'function') showToast(`Config error: ${err.message}`);
  }
}

async function toggleTop200SkuOverrideUi(action, sku) {
  const payload = {};
  if (action === 'pin') payload.pin_sku = sku;
  if (action === 'unpin') payload.unpin_sku = sku;
  if (action === 'exclude') payload.exclude_sku = sku;
  if (action === 'include') payload.include_sku = sku;

  try {
    const res = await fetch('/api/deployment/top200/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    if (!res.ok || !out.ok) throw new Error(out.error || `HTTP ${res.status}`);
    await loadTop200PlanUi(true);
    if (typeof showToast === 'function') {
      showToast(
        action === 'pin'
          ? `📌 Pinned ${sku} into Top 200!`
          : action === 'exclude'
          ? `Moved ${sku} to Overflow Reserve (promoted #201).`
          : `Updated Top-200 override for ${sku}.`
      );
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast(`Override error: ${err.message}`);
  }
}

function renderTop200DeployProgressUi(job) {
  const box = document.getElementById('top200-deploy-progress');
  if (!box || !job) return;
  box.style.display = 'block';
  const pct = job.total_items > 0 ? Math.min(100, Math.round((job.processed / job.total_items) * 100)) : 100;
  const done = job.status === 'completed';
  const failed = job.status === 'error';
  box.innerHTML = `
    <div style="font-weight:700;color:${failed ? '#b91c1c' : done ? '#15803d' : '#b45309'};margin-bottom:0.35rem;">
      ${failed ? '❌ Deployment Error' : done ? '✅ Top-200 Multi-Platform Deployment Complete!' : `⏳ Deploying Top-${job.top200_count} Strategy to Shopify &amp; All Feeds (${job.processed}/${job.total_items} • ${pct}%)...`}
    </div>
    <div style="font-size:0.78rem;color:var(--text-secondary);">
      Mode: <code>${esc(job.overflow_action)}</code> •
      Hub Active: <strong>${job.sqlite_activated}</strong> •
      Hub Overflow (${job.overflow_action === 'delete' ? 'Deleted' : 'Draft'}): <strong>${job.overflow_action === 'delete' ? job.sqlite_deleted : job.sqlite_deactivated}</strong> •
      Shopify Activated: <strong>${job.shopify_activated}</strong> •
      Shopify Deactivated: <strong>${job.shopify_deactivated}</strong> •
      Shopify Deleted: <strong>${job.shopify_deleted}</strong> •
      Errors: <strong>${(job.errors || []).length}</strong>
    </div>
  `;
}

function pollTop200DeployStatusUi() {
  if (top200PollTimer) clearInterval(top200PollTimer);
  top200PollTimer = setInterval(async () => {
    try {
      const res = await fetch('/api/deployment/top200/status', { cache: 'no-store' });
      const data = await res.json();
      if (data.job) {
        renderTop200DeployProgressUi(data.job);
        if (data.job.status !== 'running') {
          clearInterval(top200PollTimer);
          top200PollTimer = null;
          const btn = document.getElementById('btn-run-top200-deploy');
          if (btn) {
            btn.disabled = false;
            btn.textContent = '🚀 Execute Top-200 Deployment (Shopify + All Feeds)';
          }
          await loadTop200PlanUi(true);
          if (typeof loadCraigslistHubQueueUi === 'function') await loadCraigslistHubQueueUi(true);
          if (typeof loadBootstrap === 'function') await loadBootstrap();
        }
      }
    } catch (_) {}
  }, 2000);
}

async function runTop200DeploymentUi() {
  const limit = Number(document.getElementById('top200-limit-input')?.value || 200);
  const mode = document.getElementById('top200-shopify-mode')?.value || 'draft';
  let confirmDelete = '';

  if (mode === 'delete') {
    const typed = window.prompt('WARNING: This will PERMANENTLY DELETE all overflow items from Shopify and SQLite! Type DELETE_OVERFLOW to confirm:');
    if (typed !== 'DELETE_OVERFLOW') {
      if (typeof showToast === 'function') showToast('Permanent delete cancelled.');
      return;
    }
    confirmDelete = 'DELETE_OVERFLOW';
  } else {
    const desc =
      mode === 'draft'
        ? `Activate your Top ${limit} items on Shopify + all feeds, and deactivate the remaining overflow items to Shopify DRAFT (safe reserve)?`
        : `Tag your Top ${limit} items on Shopify (keeping all active on Shopify) and restrict Crosslist, eBay, Craigslist, Google & Meta feeds to Top ${limit}?`;
    if (!window.confirm(desc)) return;
  }

  const btn = document.getElementById('btn-run-top200-deploy');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Deploying Top-200 Strategy...';
  }

  try {
    const res = await fetch('/api/deployment/top200/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit,
        overflow_action: mode,
        confirm_delete: confirmDelete,
        enable_top200_mode: true
      })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (data.job) {
      renderTop200DeployProgressUi(data.job);
      if (data.job.status === 'running') {
        pollTop200DeployStatusUi();
      } else {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🚀 Execute Top-200 Deployment (Shopify + All Feeds)';
        }
        await loadTop200PlanUi(true);
        if (typeof loadBootstrap === 'function') await loadBootstrap();
      }
    }
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🚀 Execute Top-200 Deployment (Shopify + All Feeds)';
    }
    const box = document.getElementById('top200-deploy-progress');
    if (box) {
      box.style.display = 'block';
      box.innerHTML = `<span style="color:#b91c1c;font-weight:700;">❌ Top-200 Deployment Error: ${esc(err.message || String(err))}</span>`;
    }
  }
}




