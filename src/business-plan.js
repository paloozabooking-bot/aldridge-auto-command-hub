const { getWave1ProofMetrics } = require('./db');

function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(n, decimals = 2) {
  return '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function renderExecutiveBusinessPlanHtml({ autoPrint = false } = {}) {
  const m = getWave1ProofMetrics();
  const cat = m.catalog;
  const auto = m.automation;
  const dvi = m.dvi_turnaround;
  const beta = m.beta_pipeline;

  const dviStatus = dvi.avg_approval_minutes !== null
    ? `${dvi.avg_approval_minutes} min verified avg (${dvi.approved_lines_measured} customer-approved line${dvi.approved_lines_measured === 1 ? '' : 's'})`
    : `Live Tracking Active — ${dvi.published_dvis} published / ${dvi.approved_lines_measured} approved lines logged (Target: < ${dvi.benchmark_minutes} min)`;

  const betaRowsHtml = beta.prospects.length
    ? beta.prospects.map((p) => `
        <tr>
          <td><strong>${escHtml(p.shop_name)}</strong></td>
          <td>${escHtml(p.city)}, ${escHtml(p.county)}</td>
          <td>${escHtml(p.bay_yard_size || '—')}</td>
          <td>${escHtml(p.founder_plan_tier)}</td>
          <td>${fmtMoney(p.monthly_fee_usd, 0)}/mo</td>
          <td>${escHtml(p.onboarding_stage)}</td>
        </tr>`).join('')
    : `<tr><td colspan="6" style="text-align:center;color:#475569;">Open Wave 1 Founder Beta Allocation: 1–3 Independent Pierce &amp; King County Shops/Yards (Live SQLite table <code>saas_beta_prospects</code> currently has 0 fabricated entries).</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Executive Business Plan &amp; Commercial Rollout — ${escHtml(m.shop.name)}</title>
  <style>
    @page {
      size: letter;
      margin: 0.5in 0.55in;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: #0f172a;
      background: #f1f5f9;
      margin: 0;
      padding: 24px 16px 48px;
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .doc-shell {
      max-width: 960px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      padding: 32px 38px 40px;
    }
    .toolbar {
      max-width: 960px;
      margin: 0 auto 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      background: #0b1628;
      color: #e2e8f0;
      padding: 12px 18px;
      border-radius: 10px;
    }
    .toolbar-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 7px;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
      border: 1px solid transparent;
    }
    .btn-primary { background: #ea580c; color: #ffffff; }
    .btn-primary:hover { background: #c2410c; }
    .btn-ghost { background: transparent; color: #e2e8f0; border-color: #475569; }
    .btn-ghost:hover { background: rgba(255,255,255,0.08); }
    .cover {
      background: linear-gradient(135deg, #0b1628 0%, #172a4a 65%, #1e3a5f 100%);
      color: #ffffff;
      padding: 28px 30px;
      border-radius: 10px;
      border-bottom: 5px solid #ea580c;
      margin-bottom: 22px;
    }
    .eyebrow {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: #fb923c;
      margin-bottom: 6px;
    }
    .cover h1 {
      margin: 0 0 8px;
      font-size: 27px;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }
    .cover-sub {
      font-size: 13.5px;
      color: #cbd5e1;
      margin: 0 0 14px;
      max-width: 780px;
    }
    .meta-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 18px;
      font-size: 11.5px;
      color: #e2e8f0;
      padding-top: 12px;
      border-top: 1px solid rgba(255,255,255,0.16);
    }
    .meta-strip strong { color: #ffffff; }
    h2 {
      font-size: 17px;
      color: #0b1628;
      margin: 24px 0 10px;
      padding-bottom: 6px;
      border-bottom: 2px solid #e2e8f0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    h2 .sec-num {
      display: inline-block;
      background: #0b1628;
      color: #fb923c;
      font-size: 11px;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 5px;
      letter-spacing: 0.04em;
    }
    h3 {
      font-size: 14px;
      color: #0f172a;
      margin: 14px 0 6px;
    }
    p { font-size: 13px; margin: 0 0 10px; color: #1e293b; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin: 12px 0 18px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-top: 3px solid #ea580c;
      border-radius: 8px;
      padding: 11px 12px;
    }
    .kpi-label {
      font-size: 10.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #0369a1;
    }
    .kpi-val {
      font-size: 19px;
      font-weight: 800;
      color: #0b1628;
      margin: 4px 0 2px;
    }
    .kpi-note {
      font-size: 11px;
      color: #475569;
      line-height: 1.35;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .box {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 13px 15px;
    }
    .tier-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-top: 4px solid #0b1628;
      border-radius: 8px;
      padding: 14px 15px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .tier-card.featured {
      border-color: #ea580c;
      border-top: 4px solid #ea580c;
      background: #fff7ed;
    }
    .tier-price {
      font-size: 20px;
      font-weight: 800;
      color: #0b1628;
      margin: 4px 0;
    }
    .tier-setup {
      font-size: 11.5px;
      font-weight: 700;
      color: #c2410c;
      margin-bottom: 8px;
    }
    ul {
      margin: 4px 0 8px;
      padding-left: 18px;
      font-size: 12.5px;
      color: #1e293b;
    }
    li { margin-bottom: 4px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin: 8px 0 14px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 7px 9px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #0b1628;
      color: #ffffff;
      font-weight: 700;
      font-size: 11.5px;
    }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .pill {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 10.5px;
      font-weight: 700;
    }
    .pill-green { background: #dcfce7; color: #166534; }
    .pill-amber { background: #ffedd5; color: #9a3412; }
    .pill-blue { background: #e0f2fe; color: #0369a1; }
    .callout {
      background: #fff7ed;
      border-left: 4px solid #ea580c;
      padding: 11px 14px;
      border-radius: 0 8px 8px 0;
      font-size: 12.5px;
      margin: 10px 0 14px;
    }
    .checklist-table td:first-child {
      width: 74px;
      font-weight: 800;
      color: #0b1628;
      white-space: nowrap;
    }
    .page-break { page-break-before: always; break-before: page; }
    .avoid-break { page-break-inside: avoid; break-inside: avoid; }
    .doc-footer {
      margin-top: 22px;
      padding-top: 12px;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 11px;
      color: #64748b;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      background: #e2e8f0;
      padding: 1px 4px;
      border-radius: 4px;
    }
    @media (max-width: 780px) {
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
      .grid-2, .grid-3 { grid-template-columns: 1fr; }
      .doc-shell { padding: 20px 18px; }
    }
    @media print {
      body { background: #ffffff; padding: 0; }
      .toolbar { display: none !important; }
      .doc-shell { box-shadow: none; border-radius: 0; padding: 0; max-width: 100%; }
      a { color: inherit; text-decoration: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div>
      <strong style="color:#fb923c;">Executive Business Plan &amp; Commercial Rollout</strong>
      <span style="font-size:12px;color:#cbd5e1;margin-left:8px;">Live SQLite Snapshot: ${escHtml(m.generated_at)}</span>
    </div>
    <div class="toolbar-actions">
      <a href="/review" class="btn btn-ghost">← Back to /review Command Hub</a>
      <a href="/api/wave1/proof-one-pager" target="_blank" rel="noopener" class="btn btn-ghost">📊 Wave 1 One-Pager</a>
      <button type="button" class="btn btn-primary" onclick="window.print()">📄 Print / Save Business Plan PDF</button>
    </div>
  </div>

  <div class="doc-shell">
    <!-- COVER -->
    <div class="cover avoid-break">
      <div class="eyebrow">CONFIDENTIAL EXECUTIVE BUSINESS PLAN • HYBRID SHOP OS &amp; AI MULTI-CHANNEL OEM PARTS SAAS</div>
      <h1>${escHtml(m.shop.name)} — Command Hub SaaS Rollout</h1>
      <p class="cover-sub">
        The first unified, AI hands-off operating system engineered inside an active 5.0★ Tacoma/University Place repair shop — combining single-photo zero-placeholder OEM parts syndication (Shopify, eBay, Google Merchant, Meta, Craigslist) with mobile Digital Vehicle Inspections (DVI), inventory-linked repair quoting, and atomic 1-of-1 double-sale protection.
      </p>
      <div class="meta-strip">
        <span><strong>Headquarters &amp; Live Proof Lab:</strong> ${escHtml(m.shop.address)}</span>
        <span><strong>Reputation:</strong> ${escHtml(m.shop.google_rating)}</span>
        <span><strong>Platform Domain:</strong> ${escHtml(m.shop.canonical_domain)}</span>
        <span><strong>Locked Shop Rate:</strong> ${fmtMoney(m.shop.labor_rate_hourly)}/hr (7% supplies cap $${m.shop.shop_supply_fee_cap} • ${(m.shop.tax_rate * 100).toFixed(1)}% WA tax)</span>
      </div>
    </div>

    <!-- LIVE VERIFIED SQLITE PROOF SNAPSHOT -->
    <div class="avoid-break">
      <h2><span class="sec-num">01</span> Executive Thesis &amp; Live Verified Production Metrics</h2>
      <p>
        <strong>Core Thesis:</strong> Independent auto repair shops and hybrid recyclers sit on tens of thousands of dollars in tested OEM parts that never get listed because manual cataloging takes 15–25 minutes per part, while paper repair orders and disconnected spreadsheets bleed bay hours and cause costly double-sales. Rather than building theoretical software in a vacuum, we built and battle-tested the <strong>Aldridge Command Hub</strong> directly on our own bays and parts shelves — proving every metric live in SQLite before onboarding regional Pierce &amp; King County founder beta shops.
      </p>
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Verified Clean OEM Catalog</div>
          <div class="kpi-val">${cat.active_clean_skus} SKUs</div>
          <div class="kpi-note"><strong>${fmtMoney(cat.active_retail_value_usd)}</strong> We-Pull retail • ${fmtMoney(cat.active_turnkey_install_value_usd)} turnkey installed • <span class="pill pill-green">${cat.placeholder_violations} Placeholders</span></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">5-Channel Sync &amp; Stock Lock</div>
          <div class="kpi-val">${auto.double_sales_verified} Double-Sales</div>
          <div class="kpi-note">${auto.hands_off_processed_skus} gated SKUs • ${cat.parcel_skus} Parcel + ${cat.local_pickup_skus} Local 98467 • ${cat.pending_verification_skus} pending • ${cat.compliance_blocked_skus} SRS blocked</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Mobile DVI Turnaround</div>
          <div class="kpi-val">${dvi.avg_approval_minutes !== null ? `${dvi.avg_approval_minutes} min` : 'Live Ready'}</div>
          <div class="kpi-note">${escHtml(dviStatus)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Founder Beta Pipeline</div>
          <div class="kpi-val">${beta.live_beta_shops} Live • ${fmtMoney(beta.live_beta_mrr_usd, 0)}/mo</div>
          <div class="kpi-note">Wave 1 target: 1–3 local shops ($0–$2,500/mo) • ${beta.total_prospects} tracked prospects • ${beta.active_tenants_provisioned} active tenant provisioned</div>
        </div>
      </div>
      <div class="callout">
        <strong>Audit Integrity Guarantee:</strong> Every operational figure above is queried directly from our production SQLite database at render time (<code>${escHtml(m.generated_at)}</code>). Photo triage stands at <strong>${auto.photo_triage.keep} KEEP / ${auto.photo_triage.remove} REMOVE / ${auto.photo_triage.pending} PENDING</strong> with <strong>0</strong> fabricated metrics.
      </div>
    </div>

    <!-- MARKET GAP -->
    <div class="avoid-break">
      <h2><span class="sec-num">02</span> Market Gap vs. Hollander / Pinnacle &amp; Tekmetric / Shopmonkey</h2>
      <p>
        The automotive aftermarket software landscape is rigidly split into two incompatible silos. Salvage/yard software ignores the repair bay and modern omnichannel e-commerce, while modern shop management software ignores used OEM parts liquidation. Hybrid shops and independent recyclers are forced to pay for 3–5 disconnected tools and still suffer double-sales.
      </p>
      <table>
        <thead>
          <tr>
            <th style="width:22%;">Capability</th>
            <th style="width:26%;">Hollander / Pinnacle (Legacy Yard)</th>
            <th style="width:26%;">Tekmetric / Shopmonkey (Repair Bay)</th>
            <th style="width:26%;">Aldridge Command Hub (Unified OS)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>1-Photo AI Parts Intake</strong></td>
            <td>Manual keyboard entry &amp; interchange lookup (15–25 min/part)</td>
            <td>Not supported (no used OEM parts cataloging)</td>
            <td><span class="pill pill-green">Native</span> 1 photo → AI YMM, OEM MPN, box dims, Shopify taxonomy</td>
          </tr>
          <tr>
            <td><strong>Zero-Placeholder &amp; SRS Safety Gate</strong></td>
            <td>No automated marketplace compliance filter</td>
            <td>Not applicable</td>
            <td><span class="pill pill-green">Permanent Lock</span> Hard-blocks SRS/airbags &amp; quarantines incomplete SKUs</td>
          </tr>
          <tr>
            <td><strong>5-Channel Auto-Publish &amp; Auto-Delist</strong></td>
            <td>Car-Part / eBay siloed; manual OfferUp/FB/Craigslist</td>
            <td>None</td>
            <td><span class="pill pill-green">Atomic 1-of-1</span> Shopify + eBay + Google + Meta + Craigslist auto-delist</td>
          </tr>
          <tr>
            <td><strong>Mobile DVI + Inventory-Linked Quotes</strong></td>
            <td>None (no service writer / repair bay workflow)</td>
            <td>Strong DVI, but quotes aftermarket parts only</td>
            <td><span class="pill pill-green">Unified</span> Offline bay DVI + Option A (In-Stock Used OEM) vs. Option B</td>
          </tr>
          <tr>
            <td><strong>Tamper-Evident QR Isolation</strong></td>
            <td>Paper tags only</td>
            <td>None</td>
            <td><span class="pill pill-green">Automated</span> <code>&lt;SKU&gt;.qr.png</code> strictly in Shopify last slot; 0 leaks in feeds</td>
          </tr>
          <tr>
            <td><strong>Deployment &amp; Total Cost</strong></td>
            <td>Heavy desktop/server install, multi-year lock-in</td>
            <td>$300–$600+/mo + separate e-commerce &amp; Crosslist stack</td>
            <td><span class="pill pill-blue">Multi-Tenant PWA</span> White-label ready in minutes; transparent SaaS tiers</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ARCHITECTURE -->
    <div class="avoid-break">
      <h2><span class="sec-num">03</span> AI Hands-Off Zero-Placeholder Architecture</h2>
      <div class="grid-2">
        <div class="box">
          <h3 style="margin-top:0;">1. Autonomous Single-Photo Parts Engine</h3>
          <ul>
            <li><strong>Instant Enrichment:</strong> Snap 1 shop photo → Gemini Vision + deterministic OEM rules extract Year, Make, Model, verified OEM Part Number/MPN, shipping weight, packed <code>L × W × H</code> box dimensions, official Shopify <code>vp-1-4-*</code> taxonomy category, and turnkey bay installation quote at locked <strong>${fmtMoney(m.shop.labor_rate_hourly)}/hr</strong>.</li>
            <li><strong>Permanent Publish Gate:</strong> <code>validateInventoryItemForPublish()</code> runs on every create, edit, CSV import, batch intake, and feed export — automatically quarantining generic/placeholder titles or non-YMM records into <code>pending_verification</code> and permanently hard-blocking SRS/airbag/clock-spring items (<code>compliance_blocked</code>).</li>
            <li><strong>Strict Photo Isolation:</strong> Generates tamper-evident <code>&lt;SKU&gt;.qr.png</code> strictly in Shopify's final gallery slot while enforcing <strong>0 QR leaks</strong> across Crosslist, eBay US (<code>aabcas</code>), Google Merchant XML, Meta Commerce Catalog CSV, and Tacoma Craigslist (<code>pts</code>).</li>
          </ul>
        </div>
        <div class="box">
          <h3 style="margin-top:0;">2. Atomic Stock Lock, Mobile DVI &amp; Multi-Tenant SaaS</h3>
          <ul>
            <li><strong>Zero Double-Sales Architecture:</strong> Single-variant <code>1 in stock</code> enforcement across every channel. Shopify webhooks (<code>orders/create</code>, <code>orders/paid</code>, <code>products/update</code>, <code>inventory_levels/update</code>) and in-shop Repair Order part pulls atomically mark the SKU <code>sold</code> and delist across all feeds.</li>
            <li><strong>Offline-First Mobile DVI &amp; CRM:</strong> Technicians capture inspection photos/videos in zero-signal bays via IndexedDB sync, generate customer-ready quotes comparing <strong>Option A (In-Stock Used OEM)</strong> vs. <strong>Option B (New/Aftermarket)</strong>, and capture instant mobile approvals via <code>/portal</code> with 60/90-day deferred work follow-ups.</li>
            <li><strong>Turnkey Multi-Tenant Isolation:</strong> Tenant-scoped <code>organizations</code>, <code>org_subscriptions</code>, and <code>org_users</code> tables isolate white-label branding, labor/tax rates, and role-based seats (Owner, Office Manager, Technician, Customer) per rooftop.</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- COMMERCIAL SAAS PRICING -->
    <div class="page-break avoid-break">
      <h2><span class="sec-num">04</span> Commercial Multi-Tenant SaaS Pricing &amp; Payment Rev-Share</h2>
      <p>
        Pricing is structured to capture high upfront implementation revenue (covering white-label onboarding, catalog sanitization, and channel webhook wiring) paired with sticky high-margin recurring SaaS MRR and scalable transaction revenue share via Stripe Connect.
      </p>
      <div class="grid-3">
        <div class="tier-card">
          <div>
            <div class="eyebrow" style="color:#0369a1;">TIER 1 • INDEPENDENT BAY</div>
            <h3 style="margin:0;">Shop Essentials</h3>
            <div class="tier-price">$149<span style="font-size:13px;font-weight:600;color:#475569;">/mo</span></div>
            <div class="tier-setup">$499 One-Time Setup &amp; White-Label Onboarding</div>
            <ul>
              <li>Mobile-first Digital Vehicle Inspections (DVI) with offline bay capture</li>
              <li>Customer approval portal (<code>/portal</code>) &amp; unified Customer CRM</li>
              <li>Custom shop labor rate, supply fee cap &amp; local tax engine</li>
              <li>White-label PWA storefront, appointment approvals &amp; deferred work alerts</li>
            </ul>
          </div>
          <div style="font-size:11px;color:#475569;border-top:1px solid #e2e8f0;padding-top:8px;"><strong>Ideal Fit:</strong> 2–6 bay independent repair shops modernizing off paper/legacy ROs.</div>
        </div>

        <div class="tier-card featured">
          <div>
            <div class="eyebrow" style="color:#ea580c;">TIER 2 • FLAGSHIP HYBRID OS</div>
            <h3 style="margin:0;">Pro Yard &amp; Multi-Channel</h3>
            <div class="tier-price">$399<span style="font-size:13px;font-weight:600;color:#475569;">/mo + $39/seat</span></div>
            <div class="tier-setup">$1,995 Setup (Full Catalog Audit + 5-Channel Wiring)</div>
            <ul>
              <li>Everything in <strong>Shop Essentials</strong> + role-based seats (Owner, Manager, Techs)</li>
              <li><strong>AI Hands-Off OEM Intake:</strong> 1-photo YMM, MPN, box dims &amp; taxonomy enrichment</li>
              <li>Permanent zero-placeholder &amp; SRS compliance publish gate</li>
              <li>5-Channel live sync (Shopify, eBay, Google Merchant, Meta, Craigslist) + QR isolation</li>
              <li>Atomic 1-of-1 webhook auto-delist + Option A (Used OEM) DVI quoting</li>
            </ul>
          </div>
          <div style="font-size:11px;color:#9a3412;border-top:1px solid #fed7aa;padding-top:8px;"><strong>Ideal Fit:</strong> Hybrid repair + used parts shops &amp; independent dismantlers ($50k–$500k/yr parts).</div>
        </div>

        <div class="tier-card">
          <div>
            <div class="eyebrow" style="color:#0369a1;">TIER 3 • MULTI-ROOFTOP &amp; NETWORK</div>
            <h3 style="margin:0;">Enterprise &amp; Regional Yards</h3>
            <div class="tier-price">$899<span style="font-size:13px;font-weight:600;color:#475569;">/mo</span></div>
            <div class="tier-setup">$4,500+ Setup + Stripe Connect 0.25%–0.50% Rev-Share</div>
            <ul>
              <li>Multi-location tenant federation &amp; centralized regional OEM inventory pool</li>
              <li><strong>Stripe Connect Payment Rev-Share:</strong> 0.25%–0.50% platform fee on processed repair invoices &amp; direct OEM part orders</li>
              <li>Dedicated Shopify/eBay API onboarding, custom webhook pipelines &amp; ERP exports</li>
              <li>Priority SLA, custom domain provisioning &amp; executive analytics reporting</li>
            </ul>
          </div>
          <div style="font-size:11px;color:#475569;border-top:1px solid #e2e8f0;padding-top:8px;"><strong>Ideal Fit:</strong> Multi-rooftop MSOs, regional recyclers &amp; high-volume commercial fleets.</div>
        </div>
      </div>
    </div>

    <!-- PHASED PROLIFERATION WAVES 1-4 -->
    <div class="avoid-break">
      <h2><span class="sec-num">05</span> Phased Proliferation Roadmap (Waves 1–4) &amp; Financial Trajectory</h2>
      <p>
        Growth compounds from verified local proof inside Aldridge Auto's (Wave 1) into Pacific Northwest density (Wave 2), national multi-channel + payment volume (Wave 3), and multi-rooftop enterprise liquidity (Wave 4), targeting <strong>$2.4M–$3.2M Year 3 ARR</strong> and a <strong>$10M–$18M strategic exit valuation</strong> (4×–6× ARR multiple typical of vertical automotive SaaS + payments).
      </p>
      <table>
        <thead>
          <tr>
            <th style="width:15%;">Phase / Horizon</th>
            <th style="width:27%;">Operational Milestones</th>
            <th style="width:24%;">Customer &amp; Channel Footprint</th>
            <th style="width:34%;">Revenue / ARR &amp; Valuation Target</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Wave 1</strong><br/>Months 1–3<br/><span class="pill pill-amber">ACTIVE NOW</span></td>
            <td>Scale flagship catalog (${cat.active_clean_skus} → 500 → 1,000+ clean OEM SKUs / $120k+ retail), verify &lt;15 min DVI approvals, maintain 0 double-sales &amp; 0 placeholders.</td>
            <td>Flagship lab (Aldridge Auto's) + <strong>1–3 Pierce &amp; King County Founder Beta shops</strong>.</td>
            <td><strong>$0 – $2,500/mo MRR</strong> + $50k–$120k+ direct flagship OEM parts &amp; bay install lift.</td>
          </tr>
          <tr>
            <td><strong>Wave 2</strong><br/>Months 4–12<br/><span class="pill pill-blue">PNW SCALE</span></td>
            <td>Launch self-serve tenant provisioning, 30s AI Hands-Off ad campaigns, WA/OR/ID trade demos, and automated Shopify/eBay onboarding playbooks.</td>
            <td>35–55 active paying shops across WA, OR &amp; ID (blend of Tier 1 &amp; Tier 2 + seat expansion).</td>
            <td><strong>$330,000 Year 1 ARR</strong> (Recurring SaaS + Setup Fees + early Stripe Connect volume).</td>
          </tr>
          <tr>
            <td><strong>Wave 3</strong><br/>Year 2<br/><span class="pill pill-blue">NATIONAL</span></td>
            <td>Activate Stripe Connect 0.25%–0.50% payment rev-share across all repair invoices &amp; OEM checkouts; launch partner referral channel &amp; regional parts network.</td>
            <td>180–240 active rooftops nationwide + initial Tier 3 multi-rooftop regional yard groups.</td>
            <td><strong>$1.28M Year 2 ARR</strong> (High-retention vertical SaaS + compounding payments rev-share).</td>
          </tr>
          <tr>
            <td><strong>Wave 4</strong><br/>Year 3<br/><span class="pill pill-green">CATEGORY LEADER</span></td>
            <td>Cross-shop B2B OEM parts brokerage, AI automated interchange pricing intelligence, and enterprise MSO rollouts across major US metros.</td>
            <td>400–550+ active rooftops + Enterprise Tier 3 groups processing high-velocity parts &amp; bay volume.</td>
            <td><strong>$2.4M–$3.2M Year 3 ARR</strong> → <strong>$10M–$18M Strategic Exit Valuation</strong> (Acquirers: Tekmetric, Solera/Hollander, PartsTech, RepairPal, PE roll-ups).</td>
          </tr>
        </tbody>
      </table>

      <h3>Live Pierce &amp; King County Founder Beta Pipeline (Real SQLite Data)</h3>
      <table>
        <thead>
          <tr><th>Shop / Yard Name</th><th>Location</th><th>Size</th><th>Founder Tier</th><th>Monthly Fee</th><th>Stage</th></tr>
        </thead>
        <tbody>${betaRowsHtml}</tbody>
      </table>
    </div>

    <!-- 7-DAY EXECUTION CHECKLIST -->
    <div class="avoid-break">
      <h2><span class="sec-num">06</span> 7-Day Go-Live &amp; Wave 1 Execution Checklist</h2>
      <table class="checklist-table">
        <thead>
          <tr><th>Day</th><th>Priority Execution Milestone</th><th>Verification Standard</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Day 1</td>
            <td><strong>Production Cutover (<code>v19</code>) &amp; Shopify Scope Check:</strong> Deploy latest <code>main</code> build on Render (<code>aldridge-autos-command-hub</code>), confirm <code>/sw.js</code> is <code>v19</code> and locked labor rate is <code>$174.99/hr</code>; verify Shopify Custom App scopes (<code>write_products</code>, <code>write_files</code>, <code>write_inventory</code>, <code>read_orders</code>).</td>
            <td><code>/api/health</code> &amp; <code>/sw.js</code> live on <code>v19</code>; OAuth token exchange green.</td>
          </tr>
          <tr>
            <td>Day 2</td>
            <td><strong>Full 131-SKU Shopify + Crosslist Channel Sync:</strong> Trigger <code>POST /api/sync/shopify</code> (<code>update_existing: true</code>) and <code>POST /api/sync/crosslist-auto-sync</code>; verify <code>ALD-12TOY-COOLANT-RESE-P0840</code>, <code>ALD-KEEP-P0818</code>, and <code>ALD-KEEP-P0294</code> live on Shopify.</td>
            <td>131 active OEM SKUs live; 6 pending &amp; 4 SRS drafted/zeroed; 0 QR leaks outside Shopify final slot.</td>
          </tr>
          <tr>
            <td>Day 3</td>
            <td><strong>Feed &amp; Local Channel Verification:</strong> Confirm Google Merchant Center XML (<code>/api/feeds/google-merchant.xml</code>), Meta Commerce Catalog CSV (<code>/api/feeds/meta-catalog.csv</code>), eBay <code>aabcas</code> Crosslist export, and Tacoma Craigslist <code>pts</code> autofill queue.</td>
            <td>All 5 channels populated strictly with clean single-variant (1 in stock) OEM SKUs.</td>
          </tr>
          <tr>
            <td>Day 4</td>
            <td><strong>First Live Bay Mobile DVI Turnaround Benchmark:</strong> Run 3–5 real customer vehicles through technician mobile DVI capture in <code>/review</code>, quote Option A (In-Stock Used OEM) + Option B at $174.99/hr, and send <code>/portal</code> mobile approval links.</td>
            <td>Real SQLite timestamps recorded in <code>dvi_inspections</code> &amp; <code>quote_line_items</code>; verify &lt;15 min approval speed.</td>
          </tr>
          <tr>
            <td>Day 5</td>
            <td><strong>Publish 30-Second AI Hands-Off Commercial:</strong> Export <code>9:16</code> &amp; <code>16:9</code> assets from Tab 7 Infomercial Studio (or render via Veo 3 + 74-word SSML) and publish to Facebook, Instagram Reels, YouTube Shorts, and Google Business Profile.</td>
            <td>30.0s video live driving local Tacoma/UP shop traffic &amp; Founder Beta inquiries to <code>aldridgeautosupply.com</code>.</td>
          </tr>
          <tr>
            <td>Day 6</td>
            <td><strong>Pierce &amp; King County Founder Beta Outreach (10 Target Shops):</strong> Walk in or call 10 local independent repair shops &amp; hybrid yards with printed copies of this Executive Business Plan PDF + live Wave 1 Proof One-Pager; log every shop in Tab 7 Beta Pipeline.</td>
            <td>10 real local shops logged in <code>saas_beta_prospects</code>; 3+ live bay demos booked.</td>
          </tr>
          <tr>
            <td>Day 7</td>
            <td><strong>Catalog Expansion Sprint &amp; Beta Demo Close:</strong> Intake next batch of 50+ photographed donor parts via 1-photo AI Intake toward the 500-SKU milestone and provision first Founder Beta tenant via <code>/api/saas/organizations</code>.</td>
            <td>Active verified OEM catalog &gt; 180 SKUs; first external Pierce/King County beta tenant provisioned.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="doc-footer">
      <span><strong>${escHtml(m.shop.name)}</strong> • ${escHtml(m.shop.address)} • ${escHtml(m.shop.canonical_domain)}</span>
      <span>Live SQLite Audit Timestamp: ${escHtml(m.generated_at)} • Zero Fabricated Metrics</span>
    </div>
  </div>
  ${autoPrint ? '<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 350); });</script>' : ''}
</body>
</html>`;
}

module.exports = {
  renderExecutiveBusinessPlanHtml
};
