/* ==================== ALDRIDGE AUTO'S INTEGRATED DVI, UNIFIED CRM, QUOTING & CUSTOMER PORTAL ==================== */
(function () {
  'use strict';

  const dviState = {
    role: localStorage.getItem('aldridge_staff_role') || 'owner',
    inspections: [],
    activeDviId: null,
    inventoryMatches: [],
    crmProfiles: [],
    deferredFollowups: [],
    portalSessionToken: localStorage.getItem('aldridge_portal_session') || '',
    portalDashboard: null,
    recognition: null,
    dictating: false
  };

  function hEsc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function notify(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
    else console.log('[Aldridge DVI]', msg);
  }

  function staffHeaders(extra = {}) {
    return {
      'Content-Type': 'application/json',
      'X-Staff-Role': dviState.role,
      ...extra
    };
  }

  /* ==================== OFFLINE BAY INDEXEDDB MEDIA QUEUE ==================== */
  const IDB_NAME = 'aldridge_dvi_offline_bay_v1';
  const IDB_STORE = 'pending_media';

  function openOfflineDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function enqueueOfflineDviPayload(payload) {
    const db = await openOfflineDb();
    if (!db) return false;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).add({ ...payload, queued_at: new Date().toISOString() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function listOfflineDviPayloads() {
    const db = await openOfflineDb();
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function removeOfflineDviPayload(id) {
    const db = await openOfflineDb();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function updateOfflineBadge() {
    const badge = document.getElementById('dvi-offline-queue-badge');
    const flushBtn = document.getElementById('btn-dvi-flush-offline');
    if (!badge) return;
    const pending = await listOfflineDviPayloads().catch(() => []);
    const online = navigator.onLine;
    badge.className = `badge ${online ? (pending.length ? 'badge-warn' : 'badge-ok') : 'badge-err'}`;
    badge.textContent = `${online ? '🟢 Online' : '🔴 Offline Bay Mode'} • Bay Queue: ${pending.length} Pending`;
    if (flushBtn) flushBtn.style.display = online && pending.length > 0 ? 'inline-flex' : 'none';
  }

  window.flushOfflineDviQueue = async function flushOfflineDviQueue() {
    if (!navigator.onLine) {
      notify('Still offline — bay queue will sync automatically when Wi-Fi reconnects.');
      return;
    }
    const items = await listOfflineDviPayloads().catch(() => []);
    if (!items.length) return;
    let synced = 0;
    for (const item of items) {
      try {
        const res = await fetch(`/api/dvi/inspections/${item.dviId}/items`, {
          method: 'POST',
          headers: staffHeaders(),
          body: JSON.stringify(item.body)
        });
        if (res.ok) {
          await removeOfflineDviPayload(item.id);
          synced++;
        }
      } catch (_) {
        break;
      }
    }
    await updateOfflineBadge();
    if (synced > 0) {
      notify(`Synced ${synced} queued bay inspection photo/video capture(s)!`);
      await loadDviInspections();
    }
  };

  /* ==================== STAFF ROLE SWITCHER ==================== */
  function initRoleSwitcher() {
    const sel = document.getElementById('staff-role-select');
    if (!sel) return;
    sel.value = dviState.role;
    sel.addEventListener('change', () => {
      dviState.role = sel.value;
      localStorage.setItem('aldridge_staff_role', dviState.role);
      renderActiveDviWorkspace();
      notify(`Switched active role to ${sel.options[sel.selectedIndex]?.text || dviState.role}`);
    });
  }

  /* ==================== STAFF TAB 4: DVI & LIVE QUOTING ==================== */
  window.toggleNewDviRoForm = function toggleNewDviRoForm(force) {
    const f = document.getElementById('dvi-new-ro-form');
    if (!f) return;
    const show = typeof force === 'boolean' ? force : f.style.display === 'none';
    f.style.display = show ? 'block' : 'none';
  };

  async function loadDviInspections() {
    try {
      const res = await fetch('/api/dvi/inspections', { headers: { 'X-Staff-Role': dviState.role } });
      if (!res.ok) return;
      const data = await res.json();
      dviState.inspections = data.inspections || [];
      if (!dviState.activeDviId && dviState.inspections.length > 0) {
        dviState.activeDviId = dviState.inspections[0].id;
      }
      renderDviRoSelector();
      renderActiveDviWorkspace();
    } catch (err) {
      console.warn('[DVI Load]', err);
    }
  }
  window.loadDviInspections = loadDviInspections;

  function renderDviRoSelector() {
    const el = document.getElementById('dvi-ro-selector-list');
    if (!el) return;
    if (!dviState.inspections.length) {
      el.innerHTML = `<div style="font-size:0.84rem;color:var(--text-secondary);padding:0.5rem 0;">No active DVI Repair Orders yet — click <strong>+ New Repair Order / Start DVI</strong> to check in a vehicle and capture bay photos/videos.</div>`;
      return;
    }
    el.innerHTML = dviState.inspections.map((d) => {
      const active = Number(d.id) === Number(dviState.activeDviId);
      const sevIcon = d.overall_severity === 'red' ? '🔴' : (d.overall_severity === 'yellow' ? '🟡' : '🟢');
      const veh = d.vehicle ? `${d.vehicle.year || ''} ${d.vehicle.make || ''} ${d.vehicle.model || ''}`.trim() : 'Vehicle';
      return `
        <button type="button" class="btn btn-sm ${active ? 'btn-dark' : 'btn-outline'}" style="white-space:nowrap;text-align:left;" onclick="selectActiveDvi(${d.id})">
          ${sevIcon} <strong>${hEsc(d.wo_number || d.dvi_number)}</strong> • ${hEsc(d.customer?.name || 'Guest')} (${hEsc(veh)}) — <em>${hEsc(d.status_label)}</em>
        </button>
      `;
    }).join('');
  }

  window.selectActiveDvi = function selectActiveDvi(id) {
    dviState.activeDviId = Number(id);
    renderDviRoSelector();
    renderActiveDviWorkspace();
  };

  function severityBadgeHtml(sev) {
    if (sev === 'red') return '<span class="dvi-sev dvi-sev-red">🔴 RED — Immediate Attention</span>';
    if (sev === 'yellow') return '<span class="dvi-sev dvi-sev-yellow">🟡 YELLOW — Monitor Soon</span>';
    return '<span class="dvi-sev dvi-sev-green">🟢 GREEN — Good / Pass</span>';
  }

  function renderActiveDviWorkspace() {
    const wrap = document.getElementById('dvi-active-workspace');
    if (!wrap) return;
    const dvi = dviState.inspections.find((x) => Number(x.id) === Number(dviState.activeDviId));
    if (!dvi) {
      wrap.innerHTML = '';
      return;
    }

    const canOfficeAct = dviState.role === 'owner' || dviState.role === 'office_manager';
    const veh = dvi.vehicle || {};
    const vehLabel = `${veh.year || ''} ${veh.make || ''} ${veh.model || ''}`.trim() || 'Customer Vehicle';
    const unreviewed = (dvi.items || []).filter((i) => !i.reviewed_by_tech).length;
    const quote = dvi.quote;

    const statusStepsHtml = (dvi.status_flow || []).map((st) => `
      <button type="button" class="dvi-step-pill ${st.current ? 'current' : (st.completed ? 'done' : '')}" onclick="setDviStatus(${dvi.id}, '${st.code}')">
        ${st.completed ? '✓ ' : ''}${hEsc(st.label)}
      </button>
    `).join('');

    const itemsHtml = (dvi.items || []).length
      ? dvi.items.map((it) => {
        const mediaHtml = (it.media || []).map((m) =>
          m.media_type === 'video'
            ? `<video src="${hEsc(m.url)}" controls playsinline style="width:150px;height:105px;object-fit:cover;border-radius:6px;border:1px solid var(--border);"></video>`
            : `<a href="${hEsc(m.url)}" target="_blank" rel="noopener"><img src="${hEsc(m.url)}" alt="${hEsc(it.component_name)}" style="width:110px;height:82px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" /></a>`
        ).join('');
        return `
          <div class="dvi-item-card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.45rem;">
              <div>
                <strong>${hEsc(it.component_name)}</strong> <span class="badge badge-outline">${hEsc(it.category)}</span>
                ${severityBadgeHtml(it.severity)}
                ${it.reviewed_by_tech ? '<span class="badge badge-ok">✓ Tech Reviewed</span>' : '<span class="badge badge-warn">⚠ AI Draft — Tech Review Required</span>'}
              </div>
              <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
                ${!it.reviewed_by_tech ? `<button type="button" class="btn btn-primary btn-sm" onclick="approveDviItemReview(${it.id})">✓ Approve Tech Review</button>` : ''}
                ${it.severity !== 'green' && quote ? `<button type="button" class="btn btn-outline btn-sm" onclick="lookupInventoryForDviItem(${dvi.id}, '${hEsc(it.recommended_part_query || it.component_name)}', ${it.id}, ${Number(it.suggested_labor_hours || 1)})">🔎 Match Live Inventory</button>` : ''}
              </div>
            </div>
            ${mediaHtml ? `<div style="display:flex;gap:0.45rem;flex-wrap:wrap;margin-bottom:0.45rem;">${mediaHtml}</div>` : ''}
            <div style="font-size:0.82rem;"><strong>Tech Notes:</strong> ${hEsc(it.tech_notes || '—')}</div>
            <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:0.2rem;"><strong>Customer Explanation:</strong> ${hEsc(it.customer_notes || '—')}</div>
          </div>
        `;
      }).join('')
      : '<p style="font-size:0.83rem;color:var(--text-secondary);margin:0;">No inspection points captured yet. Use the mobile camera/video capture box below.</p>';

    const quoteLinesHtml = quote && quote.lines?.length
      ? quote.lines.map((l) => `
        <tr>
          <td>
            <strong>${hEsc(l.title)}</strong><br/>
            ${l.matched_inventory_sku ? `<span class="badge badge-ok">${hEsc(l.in_stock_badge || 'In Stock — Local Shelf/Yard')}</span> <code class="mono">${hEsc(l.matched_inventory_sku)}</code> (${hEsc(l.matched_inventory_bin || 'Shelf')})` : '<span class="badge badge-outline">Order Part</span>'}
          </td>
          <td>
            <div style="font-size:0.78rem;">
              <strong>Opt A (Used OEM Ready):</strong> $${Number(l.option_a_part_price || 0).toFixed(2)}<br/>
              <strong>Opt B (New Order):</strong> $${Number(l.option_b_part_price || 0).toFixed(2)}
            </div>
          </td>
          <td class="mono">${Number(l.labor_hours || 0).toFixed(1)}h = $${Number(l.labor_total || 0).toFixed(2)}</td>
          <td class="mono"><strong>$${Number(l.line_subtotal || 0).toFixed(2)}</strong></td>
          <td><span class="badge ${l.customer_decision === 'approved' ? 'badge-ok' : (l.customer_decision === 'declined' ? 'badge-err' : 'badge-warn')}">${hEsc(l.customer_decision.toUpperCase())}</span>${l.inventory_locked ? '<br/><span style="font-size:0.72rem;color:#15803d;font-weight:700;">🔒 SKU Locked &amp; Auto-Delisted</span>' : ''}</td>
          <td>
            <div style="display:flex;gap:0.25rem;flex-wrap:wrap;">
              <button type="button" class="btn btn-primary btn-sm" onclick="decideQuoteLineStaff(${quote.id}, ${l.id}, 'approved', 'option_a_used_oem')">Approve Opt A</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="decideQuoteLineStaff(${quote.id}, ${l.id}, 'approved', 'option_b_new_order')">Opt B</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="decideQuoteLineStaff(${quote.id}, ${l.id}, 'declined', '${hEsc(l.selected_option)}')">Decline</button>
            </div>
          </td>
        </tr>
      `).join('')
      : '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);">Search live shop inventory below or add a labor/part line item to build this quote.</td></tr>';

    wrap.innerHTML = `
      <div style="background:var(--bg-subtle);border:1px solid var(--border);border-radius:10px;padding:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.75rem;">
          <div>
            <h4 style="margin:0;">${hEsc(dvi.wo_number)} / ${hEsc(dvi.dvi_number)} — ${hEsc(dvi.customer?.name || 'Customer')} • ${hEsc(vehLabel)}</h4>
            <div style="font-size:0.8rem;color:var(--text-secondary);">
              VIN: <code class="mono">${hEsc(veh.vin || 'Not entered')}</code> • Mileage: <strong>${Number(dvi.mileage_in || veh.mileage || 0).toLocaleString()} mi</strong> • Tech: ${hEsc(dvi.technician_name)}
              ${dvi.published_to_customer ? ` • <strong style="color:#15803d;">✓ Published to Customer Portal by ${hEsc(dvi.published_by)}</strong>` : ' • <strong style="color:#b45309;">Draft (Internal Only)</strong>'}
            </div>
          </div>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
            <button type="button" class="btn btn-primary btn-sm" ${(!canOfficeAct || unreviewed > 0) ? 'disabled' : ''} title="${!canOfficeAct ? 'Owner/Admin or Maria (Office Manager) required to publish' : (unreviewed > 0 ? 'Approve all AI draft items before publishing' : 'Publish to Customer Portal & Send Magic Link')}" onclick="publishDviReport(${dvi.id})">
              📤 Publish DVI &amp; Send Magic Link ${unreviewed > 0 ? `(${unreviewed} Unreviewed)` : ''}
            </button>
            ${quote ? `<button type="button" class="btn btn-dark btn-sm" ${!canOfficeAct ? 'disabled' : ''} onclick="convertQuoteInvoice(${quote.id}, true)">🧾 Maria: Convert RO &amp; Final Invoice</button>` : ''}
            ${quote ? `<a href="/api/quotes/${quote.id}/invoice" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🖨 Preview Invoice</a>` : ''}
          </div>
        </div>

        <!-- Status Pipeline (Auto-Alerts Customer on Change) -->
        <div style="margin-bottom:0.9rem;">
          <div style="font-size:0.74rem;font-weight:700;color:var(--text-secondary);margin-bottom:0.35rem;">LIVE REPAIR STATUS TRACKER (CLICK TO ADVANCE &amp; SEND AUTOMATED SMS/EMAIL ALERT):</div>
          <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">${statusStepsHtml}</div>
        </div>

        <div class="grid-2" style="margin-bottom:1rem;">
          <!-- Mobile-First Camera/Video Capture + Gemini Vision + Voice Dictation -->
          <div class="surface-card" style="margin:0;">
            <h4 style="margin:0 0 0.6rem;">📸 In-App Bay Capture (Photo / Short Video + Gemini AI + Voice)</h4>
            <form id="dvi-capture-item-form" onsubmit="submitDviItemCapture(event, ${dvi.id})">
              <div class="grid-2">
                <div class="form-group">
                  <label>Component / Inspection Point *</label>
                  <input type="text" id="dvi-cap-comp" class="input" required placeholder="e.g., Front Brake Caliper, Alternator, Strut" />
                </div>
                <div class="form-group">
                  <label>Severity (or let Gemini suggest)</label>
                  <select id="dvi-cap-sev" class="select">
                    <option value="">🤖 Auto-Detect via Gemini Vision</option>
                    <option value="green">🟢 Green (Good)</option>
                    <option value="yellow">🟡 Yellow (Monitor)</option>
                    <option value="red">🔴 Red (Immediate Attention)</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label>Capture Photo or Short Video (Offline Bay Queue Supported)</label>
                <input type="file" id="dvi-cap-media" class="input" accept="image/*,video/mp4,video/webm,video/quicktime" capture="environment" multiple />
              </div>
              <div class="form-group">
                <label style="display:flex;justify-content:space-between;align-items:center;">
                  <span>Rough Technician Notes (Type or Dictate Hands-Free)</span>
                  <span style="display:flex;gap:0.35rem;">
                    <button type="button" class="btn btn-outline btn-sm" id="btn-dvi-voice-dictate" onclick="toggleVoiceDictation()">🎙️ Dictate</button>
                    <button type="button" class="btn btn-outline btn-sm" onclick="runVoiceCleanup(${dvi.id})">✨ Gemini Clean Notes</button>
                  </span>
                </label>
                <textarea id="dvi-cap-tech-notes" class="textarea" rows="2" placeholder="Speak or type rough bay notes (e.g., front right caliper leaking fluid pads down to 2mm)..."></textarea>
              </div>
              <div class="form-group">
                <label>Customer-Friendly Explanation (Auto-Populated by Gemini / Editable)</label>
                <textarea id="dvi-cap-cust-notes" class="textarea" rows="2" placeholder="Clear plain-English explanation for Customer Portal..."></textarea>
              </div>
              <button type="submit" class="btn btn-primary btn-sm" id="btn-dvi-cap-submit">📸 Upload Media &amp; Run Gemini Vision Draft</button>
            </form>
          </div>

          <!-- Inspection Findings List -->
          <div class="surface-card" style="margin:0;max-height:430px;overflow-y:auto;">
            <h4 style="margin:0 0 0.6rem;">Captured Inspection Points (${(dvi.items || []).length})</h4>
            <div style="display:flex;flex-direction:column;gap:0.65rem;">${itemsHtml}</div>
          </div>
        </div>

        <!-- Live Inventory-Linked Quoting Engine -->
        ${quote ? `
        <div class="surface-card" style="margin:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.65rem;">
            <div>
              <h4 style="margin:0;">💰 Live Inventory-Linked Quote &amp; Invoice Builder (${hEsc(quote.quote_number)}${quote.invoice_number ? ` • ${hEsc(quote.invoice_number)}` : ''})</h4>
              <div style="font-size:0.78rem;color:var(--text-secondary);">Cross-references live <code>inventory_items</code> (<code>qty &gt;= 1</code>, clean non-QR photos) for Option A (Used OEM Ready Today) vs. Option B (New Order).</div>
            </div>
            <div style="display:flex;gap:0.4rem;">
              <input type="search" id="dvi-inv-search-input" class="input" style="max-width:240px;" placeholder="Search part (e.g. alternator, fender)..." value="${hEsc(veh.make || '')}" />
              <button type="button" class="btn btn-dark btn-sm" onclick="searchLiveInventoryForQuote(${dvi.id})">🔎 Lookup On-Hand Stock</button>
            </div>
          </div>
          <div id="dvi-inv-match-results" style="display:flex;gap:0.6rem;overflow-x:auto;padding-bottom:0.5rem;margin-bottom:0.75rem;"></div>

          <div class="table-wrap" style="margin-bottom:0.75rem;">
            <table class="data-table">
              <thead>
                <tr><th>Recommended Repair &amp; Live Stock</th><th>Option A vs Option B</th><th>Labor ($${Number(quote.labor_rate || 174.99).toFixed(2)}/hr)</th><th>Subtotal</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>${quoteLinesHtml}</tbody>
            </table>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:0.75rem;background:var(--bg-subtle);padding:0.75rem 1rem;border-radius:8px;font-size:0.84rem;">
            <div>
              Parts: <strong>$${Number(quote.parts_subtotal || 0).toFixed(2)}</strong> •
              Labor: <strong>$${Number(quote.labor_subtotal || 0).toFixed(2)}</strong> •
              Shop Supplies (7%, cap $45): <strong>$${Number(quote.shop_supply_fee || 0).toFixed(2)}</strong> •
              Tacoma WA Tax (10.1%): <strong>$${Number(quote.tax_amount || 0).toFixed(2)}</strong>
            </div>
            <div style="text-align:right;">
              <span style="font-size:1.05rem;font-weight:800;">Total: $${Number(quote.total_amount || 0).toFixed(2)}</span>
              <span style="margin-left:0.65rem;color:var(--text-secondary);">Paid: $${Number(quote.amount_paid || 0).toFixed(2)} • Balance: <strong>$${Number(quote.balance_due || 0).toFixed(2)}</strong></span>
            </div>
          </div>
        </div>
        ` : ''}
      </div>
    `;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  window.submitDviItemCapture = async function submitDviItemCapture(e, dviId) {
    e.preventDefault();
    const btn = document.getElementById('btn-dvi-cap-submit');
    const comp = document.getElementById('dvi-cap-comp')?.value.trim();
    const sev = document.getElementById('dvi-cap-sev')?.value || '';
    const techNotes = document.getElementById('dvi-cap-tech-notes')?.value.trim() || '';
    const custNotes = document.getElementById('dvi-cap-cust-notes')?.value.trim() || '';
    const fileInput = document.getElementById('dvi-cap-media');

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Uploading & Running Gemini Vision...'; }
    try {
      const mediaList = [];
      for (const f of Array.from(fileInput?.files || []).slice(0, 4)) {
        const dataUrl = await fileToDataUrl(f);
        mediaList.push({ data_url: dataUrl, caption: comp || f.name });
      }
      const body = {
        component_name: comp,
        severity: sev || undefined,
        tech_notes: techNotes,
        customer_notes: custNotes,
        media_list: mediaList,
        run_ai: true,
        reviewed_by_tech: false
      };

      if (!navigator.onLine) {
        await enqueueOfflineDviPayload({ dviId, body });
        await updateOfflineBadge();
        notify('Shop bay offline — saved media to local IndexedDB queue. Will auto-upload on reconnect!');
        return;
      }

      const res = await fetch(`/api/dvi/inspections/${dviId}/items`, {
        method: 'POST',
        headers: staffHeaders(),
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      notify(`Captured "${comp}" (${data.ai_draft?.provider || 'draft'}) — review & approve before publishing!`);
      await loadDviInspections();
      if (data.matched_inventory_parts?.length) {
        renderInventoryMatchCards(dviId, data.matched_inventory_parts, data.item_id, data.ai_draft?.suggested_labor_hours || 1.0);
      }
    } catch (err) {
      if (!navigator.onLine || /Failed to fetch/i.test(String(err.message))) {
        notify('Network dropped in bay — retrying via offline bay queue...');
      } else {
        notify(`Capture error: ${err.message}`);
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📸 Upload Media & Run Gemini Vision Draft'; }
    }
  };

  window.toggleVoiceDictation = function toggleVoiceDictation() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = document.getElementById('btn-dvi-voice-dictate');
    const ta = document.getElementById('dvi-cap-tech-notes');
    if (!SpeechRec) {
      notify('Voice dictation uses Chrome/Safari Web Speech API — type rough notes and click Gemini Clean Notes.');
      return;
    }
    if (dviState.dictating && dviState.recognition) {
      dviState.recognition.stop();
      dviState.dictating = false;
      if (btn) btn.textContent = '🎙️ Dictate';
      return;
    }
    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const transcript = Array.from(ev.results).map((r) => r[0].transcript).join(' ');
      if (ta) ta.value = (ta.value ? ta.value + ' ' : '') + transcript;
    };
    rec.onend = () => {
      dviState.dictating = false;
      if (btn) btn.textContent = '🎙️ Dictate';
    };
    dviState.recognition = rec;
    dviState.dictating = true;
    if (btn) btn.textContent = '⏹ Listening...';
    rec.start();
  };

  window.runVoiceCleanup = async function runVoiceCleanup(dviId) {
    const techEl = document.getElementById('dvi-cap-tech-notes');
    const custEl = document.getElementById('dvi-cap-cust-notes');
    const compEl = document.getElementById('dvi-cap-comp');
    const sevEl = document.getElementById('dvi-cap-sev');
    if (!techEl?.value.trim()) return notify('Dictate or enter rough shop notes first.');
    const res = await fetch('/api/dvi/voice-cleanup', {
      method: 'POST',
      headers: staffHeaders(),
      body: JSON.stringify({ dvi_id: dviId, raw_notes: techEl.value, component_name: compEl?.value || '' })
    });
    const data = await res.json();
    if (!res.ok) return notify(data.error || 'Voice cleanup failed');
    techEl.value = data.tech_notes || techEl.value;
    if (custEl) custEl.value = data.customer_notes || '';
    if (sevEl && !sevEl.value && data.suggested_severity) sevEl.value = data.suggested_severity;
    notify(`Cleaned notes via ${data.provider} — review before saving!`);
  };

  window.approveDviItemReview = async function approveDviItemReview(itemId) {
    const res = await fetch(`/api/dvi/items/${itemId}`, {
      method: 'PATCH',
      headers: staffHeaders(),
      body: JSON.stringify({ reviewed_by_tech: true })
    });
    if (res.ok) {
      notify('Inspection point marked Tech Reviewed ✓');
      await loadDviInspections();
    }
  };

  window.setDviStatus = async function setDviStatus(dviId, status) {
    const res = await fetch(`/api/dvi/inspections/${dviId}/status`, {
      method: 'POST',
      headers: staffHeaders(),
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (!res.ok) return notify(data.error || 'Status update failed');
    notify(`Status updated to "${data.inspection?.status_label}" — automated customer alert queued!`);
    await loadDviInspections();
  };

  window.publishDviReport = async function publishDviReport(dviId) {
    const res = await fetch(`/api/dvi/inspections/${dviId}/publish`, {
      method: 'POST',
      headers: staffHeaders(),
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (!res.ok) return notify(data.error || 'Publish blocked');
    if (navigator.clipboard && data.portal_magic_link) {
      navigator.clipboard.writeText(data.portal_magic_link).catch(() => {});
    }
    notify(`Published to Customer Portal! Magic Link copied: ${data.portal_magic_link}`);
    await loadDviInspections();
  };

  window.lookupInventoryForDviItem = async function lookupInventoryForDviItem(dviId, query, dviItemId, laborHours) {
    const inp = document.getElementById('dvi-inv-search-input');
    if (inp) inp.value = query;
    await searchLiveInventoryForQuote(dviId, dviItemId, laborHours);
  };

  window.searchLiveInventoryForQuote = async function searchLiveInventoryForQuote(dviId, dviItemId = null, defaultHours = 1.0) {
    const dvi = dviState.inspections.find((x) => Number(x.id) === Number(dviId));
    const q = document.getElementById('dvi-inv-search-input')?.value || '';
    const params = new URLSearchParams({
      q,
      year: String(dvi?.vehicle?.year || ''),
      make: String(dvi?.vehicle?.make || ''),
      model: String(dvi?.vehicle?.model || ''),
      limit: '8'
    });
    const res = await fetch(`/api/quotes/inventory-match?${params.toString()}`);
    const data = await res.json();
    renderInventoryMatchCards(dviId, data.matches || [], dviItemId, defaultHours);
  };

  function renderInventoryMatchCards(dviId, matches, dviItemId = null, defaultHours = 1.0) {
    const box = document.getElementById('dvi-inv-match-results');
    const dvi = dviState.inspections.find((x) => Number(x.id) === Number(dviId));
    if (!box || !dvi?.quote) return;
    if (!matches.length) {
      box.innerHTML = `<div style="font-size:0.82rem;color:var(--text-secondary);">No exact on-hand OEM matches found. <button type="button" class="btn btn-outline btn-sm" onclick="addCustomQuoteLine(${dvi.quote.id}, ${dviItemId || 'null'}, ${Number(defaultHours || 1)})">+ Add Option B New Order Line</button></div>`;
      return;
    }
    box.innerHTML = matches.map((m) => `
      <div style="min-width:260px;max-width:280px;background:var(--bg-subtle);border:1px solid #16a34a;border-radius:8px;padding:0.65rem;flex-shrink:0;">
        <div style="display:flex;gap:0.55rem;align-items:center;margin-bottom:0.45rem;">
          <img src="${hEsc(m.primary_photo)}" alt="${hEsc(m.title)}" style="width:54px;height:54px;object-fit:cover;border-radius:6px;" />
          <div style="min-width:0;">
            <span class="badge badge-ok" style="font-size:0.68rem;">${hEsc(m.in_stock_badge)}</span>
            <div style="font-size:0.78rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${hEsc(m.title)}</div>
            <div class="mono" style="font-size:0.7rem;color:var(--text-secondary);">${hEsc(m.sku)} • ${hEsc(m.bin_location)}</div>
          </div>
        </div>
        <div style="font-size:0.76rem;margin-bottom:0.45rem;">
          <strong>Opt A (Used OEM):</strong> $${m.option_a_used_oem_price.toFixed(2)} • <strong>Opt B (New):</strong> $${m.option_b_new_order_price.toFixed(2)}<br/>
          <span style="color:#15803d;font-weight:700;">Customer Saves $${m.savings_amount.toFixed(2)} — Ready Today!</span>
        </div>
        <button type="button" class="btn btn-primary btn-sm" style="width:100%;" onclick='addMatchedPartToQuote(${dvi.quote.id}, ${JSON.stringify(m).replace(/'/g, '&#39;')}, ${dviItemId || 'null'})'>+ Add to Quote (Option A/B)</button>
      </div>
    `).join('');
  }

  window.addMatchedPartToQuote = async function addMatchedPartToQuote(quoteId, match, dviItemId) {
    const res = await fetch(`/api/quotes/${quoteId}/lines`, {
      method: 'POST',
      headers: staffHeaders(),
      body: JSON.stringify({
        dvi_item_id: dviItemId,
        title: `Replace ${match.title}`,
        description: `Verified On-Hand OEM Part (${match.sku}, ${match.bin_location}) vs. New Aftermarket/OEM Order.`,
        severity: 'red',
        selected_option: 'option_a_used_oem',
        matched_inventory_sku: match.sku,
        matched_inventory_title: match.title,
        matched_inventory_bin: match.bin_location,
        matched_inventory_photo: match.primary_photo,
        option_a_part_price: match.option_a_used_oem_price,
        option_b_part_price: match.option_b_new_order_price,
        labor_hours: match.install_labor_hours || 1.2
      })
    });
    const data = await res.json();
    if (!res.ok) return notify(data.error || 'Could not add quote line');
    notify(`Added ${match.sku} (Option A: $${match.option_a_used_oem_price} / Option B: $${match.option_b_new_order_price}) to quote!`);
    await loadDviInspections();
  };

  window.addCustomQuoteLine = async function addCustomQuoteLine(quoteId, dviItemId, laborHours) {
    const title = prompt('Repair / Service Line Title:', 'Brake Pad & Rotor Service');
    if (!title) return;
    const partPrice = Number(prompt('New Order Part Price ($):', '145') || 0);
    const hrs = Number(prompt('Labor Hours (@ $174.99/hr):', String(laborHours || 1.5)) || 1);
    const res = await fetch(`/api/quotes/${quoteId}/lines`, {
      method: 'POST',
      headers: staffHeaders(),
      body: JSON.stringify({
        dvi_item_id: dviItemId,
        title,
        severity: 'yellow',
        selected_option: 'option_b_new_order',
        option_b_part_price: partPrice,
        labor_hours: hrs
      })
    });
    if (res.ok) {
      notify('Added Option B repair line item to quote.');
      await loadDviInspections();
    }
  };

  window.decideQuoteLineStaff = async function decideQuoteLineStaff(quoteId, lineId, decision, selectedOption) {
    const res = await fetch(`/api/quotes/${quoteId}/lines/${lineId}/decision`, {
      method: 'POST',
      headers: staffHeaders(),
      body: JSON.stringify({ decision, selected_option: selectedOption })
    });
    const data = await res.json();
    if (!res.ok) return notify(data.error || 'Decision failed');
    if (data.inventory_lock?.locked) {
      notify(`Approved! Atomically locked 1-in-stock SKU ${data.inventory_lock.sku} & auto-delisted across Shopify/Feeds.`);
    } else if (data.deferred_followup) {
      notify(`Declined — auto-logged 60/90-day deferred follow-up reminder (${data.deferred_followup.followup_60d_date}) in CRM!`);
    } else {
      notify(`Line marked ${decision.toUpperCase()}.`);
    }
    await loadDviInspections();
    await loadUnifiedCrmProfiles();
  };

  window.convertQuoteInvoice = async function convertQuoteInvoice(quoteId, finalizeInvoice) {
    const res = await fetch(`/api/quotes/${quoteId}/convert`, {
      method: 'POST',
      headers: staffHeaders(),
      body: JSON.stringify({ finalize_invoice: finalizeInvoice })
    });
    const data = await res.json();
    if (!res.ok) return notify(data.error || 'Conversion requires Owner/Admin or Maria (Office Manager)');
    notify(`Converted to ${data.invoice_number || 'Active RO'} — opening printable invoice!`);
    if (data.invoice_url) window.open(data.invoice_url, '_blank', 'noopener');
    await loadDviInspections();
  };

  /* ==================== STAFF TAB 5: UNIFIED CRM & DEFERRED FOLLOW-UPS ==================== */
  async function loadUnifiedCrmProfiles(search = '') {
    const profBox = document.getElementById('crm-unified-profiles-list');
    const defBox = document.getElementById('crm-deferred-followups-list');
    if (!profBox && !defBox) return;
    try {
      const res = await fetch(`/api/crm/profiles?q=${encodeURIComponent(search)}`);
      if (!res.ok) return;
      const data = await res.json();
      dviState.crmProfiles = data.profiles || [];
      dviState.deferredFollowups = data.deferred_followups || [];

      if (profBox) {
        profBox.innerHTML = dviState.crmProfiles.length
          ? dviState.crmProfiles.map((c) => `
            <div style="padding:0.7rem;background:var(--bg-subtle);border:1px solid var(--border);border-radius:8px;font-size:0.82rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                <strong>${hEsc(c.name)}</strong>
                <div style="display:flex;gap:0.35rem;">
                  <button type="button" class="btn btn-outline btn-sm" onclick="copyCustomerMagicLink(${c.id})">🔗 Portal Magic Link</button>
                </div>
              </div>
              <div style="color:var(--text-secondary);margin:0.2rem 0;">${hEsc(c.phone || 'No phone')} • ${hEsc(c.email || 'No email')} • Visits: ${c.visit_count} • Spent: $${c.total_spent.toFixed(2)}</div>
              <div style="display:flex;gap:0.35rem;flex-wrap:wrap;margin-top:0.3rem;">
                ${(c.vehicles || []).map((v) => `<span class="badge badge-outline">🚗 ${hEsc(v.year || '')} ${hEsc(v.make)} ${hEsc(v.model)} ${v.vin ? `(${hEsc(v.vin.slice(-6))})` : ''} • ${Number(v.mileage || 0).toLocaleString()} mi</span>`).join('') || '<span style="font-size:0.74rem;color:var(--text-muted);">No vehicles linked yet</span>'}
              </div>
            </div>
          `).join('')
          : '<p style="font-size:0.83rem;color:var(--text-secondary);">No CRM profiles found yet.</p>';
      }

      if (defBox) {
        defBox.innerHTML = dviState.deferredFollowups.length
          ? dviState.deferredFollowups.map((d) => `
            <div style="padding:0.7rem;background:var(--bg-subtle);border:1px solid var(--border);border-radius:8px;font-size:0.82rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                <span>${severityBadgeHtml(d.severity)} <strong>${hEsc(d.title)}</strong></span>
                <span class="mono">Est. $${Number(d.estimated_total || 0).toFixed(2)}</span>
              </div>
              <div style="color:var(--text-secondary);margin:0.25rem 0;">
                ${hEsc(d.customer_name)} (${hEsc(d.customer_phone || d.customer_email)}) • ${hEsc([d.veh_year || '', d.veh_make || '', d.veh_model || ''].filter(Boolean).join(' '))}
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                <span style="font-size:0.75rem;">60d: <strong>${hEsc(d.followup_60d_date)}</strong> • 90d: <strong>${hEsc(d.followup_90d_date)}</strong> • Status: <span class="badge badge-warn">${hEsc(d.status)}</span></span>
                <div style="display:flex;gap:0.3rem;">
                  <button type="button" class="btn btn-outline btn-sm" onclick="markDeferredStatus(${d.id}, 'reminded_60d')">✓ 60d Sent</button>
                  <button type="button" class="btn btn-primary btn-sm" onclick="markDeferredStatus(${d.id}, 'booked')">✓ Re-Booked</button>
                </div>
              </div>
            </div>
          `).join('')
          : '<p style="font-size:0.83rem;color:var(--text-secondary);">No deferred Yellow/Red follow-ups yet. Declined customer recommendations auto-populate here for 60 &amp; 90-day reminders.</p>';
      }
    } catch (err) {
      console.warn('[CRM Load]', err);
    }
  }
  window.loadUnifiedCrmProfiles = loadUnifiedCrmProfiles;

  window.copyCustomerMagicLink = async function copyCustomerMagicLink(customerId) {
    const res = await fetch('/api/portal/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: customerId })
    });
    const data = await res.json();
    if (!res.ok) return notify(data.error || 'Could not generate magic link');
    if (navigator.clipboard) navigator.clipboard.writeText(data.magic_link_url).catch(() => {});
    notify(`Customer Portal Magic Link copied: ${data.magic_link_url}`);
  };

  window.markDeferredStatus = async function markDeferredStatus(id, status) {
    const res = await fetch(`/api/crm/deferred/${id}`, {
      method: 'PATCH',
      headers: staffHeaders(),
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      notify(`Deferred reminder updated -> ${status}`);
      await loadUnifiedCrmProfiles();
    }
  };

  /* ==================== CUSTOMER PORTAL (MAGIC LINK / PASSWORD / INTERACTIVE DVI / PAYMENTS) ==================== */
  async function loadPortalSessionFromToken(magicToken = '') {
    if (magicToken) {
      const res = await fetch('/api/portal/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magic_token: magicToken })
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data.error || 'Magic link expired or invalid.');
        return;
      }
      dviState.portalSessionToken = data.session_token;
      localStorage.setItem('aldridge_portal_session', data.session_token);
      dviState.portalDashboard = data.dashboard;
      renderCustomerPortal();
      if (typeof window.switchCustomerView === 'function') window.switchCustomerView('view-portal');
      return;
    }

    if (!dviState.portalSessionToken) return;
    const res = await fetch('/api/portal/me', {
      headers: { 'X-Portal-Token': dviState.portalSessionToken }
    });
    if (res.ok) {
      dviState.portalDashboard = await res.json();
      renderCustomerPortal();
    } else {
      dviState.portalSessionToken = '';
      localStorage.removeItem('aldridge_portal_session');
    }
  }

  window.portalSignOut = function portalSignOut() {
    dviState.portalSessionToken = '';
    dviState.portalDashboard = null;
    localStorage.removeItem('aldridge_portal_session');
    renderCustomerPortal();
    notify('Signed out of Customer Portal.');
  };

  function renderCustomerPortal() {
    const authCard = document.getElementById('portal-auth-card');
    const dash = document.getElementById('portal-dashboard');
    const hdr = document.getElementById('portal-header-actions');
    if (!authCard || !dash) return;

    const d = dviState.portalDashboard;
    if (!d || !d.customer) {
      authCard.style.display = 'grid';
      dash.style.display = 'none';
      if (hdr) hdr.innerHTML = '';
      return;
    }

    authCard.style.display = 'none';
    dash.style.display = 'block';
    if (hdr) {
      hdr.innerHTML = `
        <span class="badge badge-ok">Signed in: ${hEsc(d.customer.name)}</span>
        <button type="button" class="btn btn-outline btn-sm" onclick="portalSignOut()">Sign Out</button>
      `;
    }

    // 1. Live Repair Status Tracker
    const tracker = document.getElementById('portal-status-tracker');
    const activeDvi = (d.dvis || [])[0];
    if (tracker) {
      if (activeDvi) {
        const steps = (activeDvi.status_flow || []).map((st) => `
          <div class="dvi-step-pill ${st.current ? 'current' : (st.completed ? 'done' : '')}">
            ${st.completed ? '✓ ' : ''}${hEsc(st.label)}
          </div>
        `).join('<span style="color:var(--text-muted);">→</span>');
        tracker.innerHTML = `
          <div class="eyebrow-label">REAL-TIME BAY REPAIR TRACKER • ${hEsc(activeDvi.wo_number || activeDvi.dvi_number)}</div>
          <h3 style="margin:0.15rem 0 0.65rem;">Current Status: ${hEsc(activeDvi.status_label)}</h3>
          <div style="display:flex;gap:0.45rem;align-items:center;flex-wrap:wrap;">${steps}</div>
        `;
      } else {
        tracker.innerHTML = `<h3 style="margin:0;">Welcome back, ${hEsc(d.customer.name)}!</h3><p style="margin:0.35rem 0 0;color:var(--text-secondary);">Your published Digital Vehicle Inspection reports and live repair status tracker will appear here as soon as our shop finishes reviewing your inspection.</p>`;
      }
    }

    // 2. Interactive DVI Reports with Side-by-Side Healthy vs Worn Comparison
    const dviBox = document.getElementById('portal-dvi-reports');
    if (dviBox) {
      dviBox.innerHTML = (d.dvis || []).map((rep) => `
        <div class="surface-card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem;">
            <div>
              <div class="eyebrow-label">INTERACTIVE DIGITAL VEHICLE INSPECTION • ${hEsc(rep.dvi_number)}</div>
              <h3 style="margin:0;">${hEsc(rep.vehicle ? `${rep.vehicle.year || ''} ${rep.vehicle.make || ''} ${rep.vehicle.model || ''}` : 'Your Vehicle')} • ${Number(rep.mileage_in || 0).toLocaleString()} mi</h3>
            </div>
            ${severityBadgeHtml(rep.overall_severity)}
          </div>
          <div style="display:flex;flex-direction:column;gap:0.85rem;">
            ${(rep.items || []).map((it) => `
              <div class="dvi-item-card">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.5rem;">
                  <strong>${hEsc(it.component_name)} (${hEsc(it.category)})</strong>
                  ${severityBadgeHtml(it.severity)}
                </div>
                <p style="margin:0 0 0.6rem;font-size:0.88rem;">${hEsc(it.customer_notes || it.tech_notes)}</p>
                <div class="grid-2">
                  <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:0.65rem;">
                    <div style="font-size:0.72rem;font-weight:800;color:#b45309;margin-bottom:0.35rem;">YOUR VEHICLE — ACTUAL BAY CAPTURE</div>
                    ${(it.media || []).length
                      ? `<div style="display:flex;gap:0.45rem;flex-wrap:wrap;">${it.media.map((m) => m.media_type === 'video' ? `<video src="${hEsc(m.url)}" controls playsinline style="max-width:100%;max-height:190px;border-radius:6px;"></video>` : `<a href="${hEsc(m.url)}" target="_blank" rel="noopener"><img src="${hEsc(m.url)}" alt="${hEsc(it.component_name)}" style="max-width:100%;max-height:190px;border-radius:6px;object-fit:cover;" /></a>`).join('')}</div>`
                      : '<div style="font-size:0.8rem;color:var(--text-secondary);">Visual technician check documented.</div>'}
                  </div>
                  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:0.65rem;">
                    <div style="font-size:0.72rem;font-weight:800;color:#15803d;margin-bottom:0.35rem;">HEALTHY FACTORY REFERENCE SPEC</div>
                    <p style="margin:0;font-size:0.82rem;color:#166534;">✓ ${hEsc(it.reference_healthy_caption || 'Factory-spec healthy component with zero leaks, cracks, or abnormal wear.')}</p>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('');
    }

    // 3. Interactive Line-Item Approvals (Option A vs Option B) + Online Deposit & Final Payment
    const qBox = document.getElementById('portal-quotes-invoices');
    if (qBox) {
      qBox.innerHTML = (d.quotes || []).map((q) => `
        <div class="surface-card" style="border-left:4px solid var(--brand-orange);">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem;">
            <div>
              <div class="eyebrow-label">LINE-ITEM APPROVAL &amp; ONLINE PAYMENT • ${hEsc(q.quote_number)}${q.invoice_number ? ` / ${hEsc(q.invoice_number)}` : ''}</div>
              <h3 style="margin:0;">Approve or Decline Recommended Repairs</h3>
            </div>
            <a href="/api/quotes/${q.id}/invoice" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🖨 Printable Estimate / Invoice</a>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.7rem;margin-bottom:0.85rem;">
            ${(q.lines || []).map((l) => `
              <div style="padding:0.75rem;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;flex-wrap:wrap;">
                  <div style="display:flex;gap:0.65rem;align-items:center;">
                    ${l.matched_inventory_photo ? `<img src="${hEsc(l.matched_inventory_photo)}" alt="${hEsc(l.title)}" style="width:62px;height:62px;object-fit:cover;border-radius:6px;" />` : ''}
                    <div>
                      <strong>${hEsc(l.title)}</strong> ${severityBadgeHtml(l.severity)}
                      <div style="font-size:0.8rem;color:var(--text-secondary);">${hEsc(l.description || '')} • Labor: ${Number(l.labor_hours || 0).toFixed(1)}h ($${Number(l.labor_total || 0).toFixed(2)})</div>
                      ${l.matched_inventory_sku ? `<div style="font-size:0.78rem;color:#15803d;font-weight:700;">★ ${hEsc(l.in_stock_badge)} (${hEsc(l.matched_inventory_sku)})</div>` : ''}
                    </div>
                  </div>
                  <div style="text-align:right;">
                    <span class="badge ${l.customer_decision === 'approved' ? 'badge-ok' : (l.customer_decision === 'declined' ? 'badge-err' : 'badge-warn')}">${hEsc(l.customer_decision.toUpperCase())}</span>
                  </div>
                </div>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.6rem;">
                  ${(l.matched_inventory_sku && (l.in_stock_live || l.inventory_locked)) ? `
                    <button type="button" class="btn btn-primary btn-sm" onclick="portalDecideLine(${q.id}, ${l.id}, 'approved', 'option_a_used_oem')">
                      ✓ Approve Option A: In-Stock Used OEM — $${(Number(l.option_a_part_price || 0) + Number(l.labor_total || 0)).toFixed(2)} (Ready Today)
                    </button>
                  ` : ''}
                  <button type="button" class="btn btn-dark btn-sm" onclick="portalDecideLine(${q.id}, ${l.id}, 'approved', 'option_b_new_order')">
                    ✓ Approve Option B: New Order Part — $${(Number(l.option_b_part_price || 0) + Number(l.labor_total || 0)).toFixed(2)}
                  </button>
                  <button type="button" class="btn btn-outline btn-sm" onclick="portalDecideLine(${q.id}, ${l.id}, 'declined', '${hEsc(l.selected_option)}')">
                    Decline (Remind Me in 60/90 Days)
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;padding:0.85rem;background:#0b1628;color:#fff;border-radius:8px;">
            <div style="font-size:0.84rem;">
              Parts: $${Number(q.parts_subtotal || 0).toFixed(2)} • Labor: $${Number(q.labor_subtotal || 0).toFixed(2)} • Supplies: $${Number(q.shop_supply_fee || 0).toFixed(2)} • WA Tax (10.1%): $${Number(q.tax_amount || 0).toFixed(2)}<br/>
              <strong style="font-size:1.05rem;color:#fbbf24;">Total: $${Number(q.total_amount || 0).toFixed(2)}</strong> • Paid: $${Number(q.amount_paid || 0).toFixed(2)} • <strong>Balance Due: $${Number(q.balance_due || 0).toFixed(2)}</strong>
            </div>
            <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
              ${Number(q.deposit_required || 0) > Number(q.deposit_paid || 0) ? `<button type="button" class="btn btn-primary btn-sm" onclick="portalPayOnline(${q.id}, ${Number(q.deposit_required).toFixed(2)}, 'deposit')">💳 Pay $${Number(q.deposit_required).toFixed(2)} Deposit Online</button>` : ''}
              ${Number(q.balance_due || 0) > 0 ? `<button type="button" class="btn btn-outline btn-sm" style="color:#fff;border-color:#fff;" onclick="portalPayOnline(${q.id}, ${Number(q.balance_due).toFixed(2)}, 'invoice_final')">💳 Pay Full Balance ($${Number(q.balance_due).toFixed(2)})</button>` : '<span class="badge badge-ok">✓ Paid in Full</span>'}
            </div>
          </div>
        </div>
      `).join('');
    }

    // 4. Vehicles & Deferred Reminders
    const vBox = document.getElementById('portal-vehicles-list');
    if (vBox) {
      vBox.innerHTML = (d.vehicles || []).length
        ? d.vehicles.map((v) => `<div style="padding:0.55rem 0;border-bottom:1px solid var(--border);font-size:0.84rem;"><strong>${hEsc(v.year || '')} ${hEsc(v.make)} ${hEsc(v.model)}</strong><br/><span class="mono" style="font-size:0.75rem;color:var(--text-secondary);">VIN: ${hEsc(v.vin || '—')} • ${Number(v.mileage || 0).toLocaleString()} mi</span></div>`).join('')
        : '<p style="font-size:0.82rem;color:var(--text-secondary);">Vehicles from your repair orders will appear here.</p>';
    }
    const defBox = document.getElementById('portal-deferred-list');
    if (defBox) {
      defBox.innerHTML = (d.deferred_followups || []).length
        ? d.deferred_followups.map((f) => `<div style="padding:0.55rem 0;border-bottom:1px solid var(--border);font-size:0.84rem;">${severityBadgeHtml(f.severity)} <strong>${hEsc(f.title)}</strong><br/><span style="font-size:0.76rem;color:var(--text-secondary);">60-Day Reminder: ${hEsc(f.followup_60d_date)} • 90-Day Reminder: ${hEsc(f.followup_90d_date)}</span></div>`).join('')
        : '<p style="font-size:0.82rem;color:var(--text-secondary);">No deferred maintenance items on file.</p>';
    }
  }

  window.portalDecideLine = async function portalDecideLine(quoteId, lineId, decision, selectedOption) {
    const res = await fetch(`/api/portal/quotes/${quoteId}/lines/${lineId}/decision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portal-Token': dviState.portalSessionToken
      },
      body: JSON.stringify({ decision, selected_option: selectedOption })
    });
    const data = await res.json();
    if (!res.ok) return notify(data.error || 'Could not save your selection');
    dviState.portalDashboard = data.dashboard;
    renderCustomerPortal();
    notify(decision === 'approved' ? 'Approved! Your part & bay slot have been reserved.' : 'Declined — logged to your 60/90-day maintenance reminders.');
  };

  window.portalPayOnline = async function portalPayOnline(quoteId, amount, paymentType) {
    if (!confirm(`Confirm online ${paymentType === 'deposit' ? 'deposit' : 'invoice'} payment of $${Number(amount).toFixed(2)} to Aldridge Auto's Service & Repair?`)) return;
    const res = await fetch(`/api/portal/quotes/${quoteId}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portal-Token': dviState.portalSessionToken
      },
      body: JSON.stringify({ amount, payment_type: paymentType, method: 'card_online' })
    });
    const data = await res.json();
    if (!res.ok) return notify(data.error || 'Payment failed');
    dviState.portalDashboard = data.dashboard;
    renderCustomerPortal();
    notify(`Payment confirmed! Receipt ${data.payment_reference} ($${Number(data.amount).toFixed(2)})`);
  };

  /* ==================== BOOTSTRAP & EVENT WIRING ==================== */
  document.addEventListener('DOMContentLoaded', () => {
    initRoleSwitcher();
    updateOfflineBadge();
    window.addEventListener('online', () => { updateOfflineBadge(); window.flushOfflineDviQueue(); });
    window.addEventListener('offline', () => { updateOfflineBadge(); });

    // New DVI RO Form
    const newRoForm = document.getElementById('dvi-new-ro-form');
    if (newRoForm) {
      newRoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          customer_name: document.getElementById('dvi-new-cust-name')?.value.trim(),
          customer_phone: document.getElementById('dvi-new-cust-phone')?.value.trim(),
          customer_email: document.getElementById('dvi-new-cust-email')?.value.trim(),
          vin: document.getElementById('dvi-new-vin')?.value.trim(),
          year: Number(document.getElementById('dvi-new-year')?.value || 0),
          make: document.getElementById('dvi-new-make')?.value.trim(),
          model: document.getElementById('dvi-new-model')?.value.trim(),
          mileage: Number(document.getElementById('dvi-new-mileage')?.value || 0),
          technician_name: document.getElementById('dvi-new-tech')?.value.trim() || 'Lead ASE Tech',
          service_summary: document.getElementById('dvi-new-summary')?.value.trim()
        };
        const res = await fetch('/api/dvi/inspections', {
          method: 'POST',
          headers: staffHeaders(),
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) return notify(data.error || 'Could not create Repair Order');
        newRoForm.reset();
        window.toggleNewDviRoForm(false);
        dviState.activeDviId = data.inspection?.id;
        notify(`Created ${data.inspection?.wo_number} / ${data.inspection?.dvi_number} & linked Unified CRM profile!`);
        await loadDviInspections();
        await loadUnifiedCrmProfiles();
      });
    }

    // Portal Magic Link Form
    const magicForm = document.getElementById('portal-magic-form');
    if (magicForm) {
      magicForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ident = document.getElementById('portal-magic-identifier')?.value.trim() || '';
        const body = ident.includes('@') ? { email: ident } : { phone: ident };
        const res = await fetch('/api/portal/auth/magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        const box = document.getElementById('portal-magic-result');
        if (!res.ok) {
          if (box) { box.style.display = 'block'; box.innerHTML = `<span style="color:#b91c1c;">${hEsc(data.error || 'Not found')}</span>`; }
          return;
        }
        if (box) {
          box.style.display = 'block';
          box.innerHTML = `<strong>✓ Magic Link Ready for ${hEsc(data.customer_name)}:</strong><br/><a href="${hEsc(data.magic_link_url)}" class="btn btn-primary btn-sm" style="margin-top:0.45rem;">Open My Garage Portal Now →</a>`;
        }
      });
    }

    // Portal Password Login / Setup Form
    const setupCb = document.getElementById('portal-pwd-setup-mode');
    if (setupCb) {
      setupCb.addEventListener('change', () => {
        const w = document.getElementById('portal-pwd-name-wrap');
        if (w) w.style.display = setupCb.checked ? 'block' : 'none';
      });
    }
    const pwdForm = document.getElementById('portal-password-form');
    if (pwdForm) {
      pwdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ident = document.getElementById('portal-pwd-identifier')?.value.trim() || '';
        const body = {
          ...(ident.includes('@') ? { email: ident } : { phone: ident }),
          password: document.getElementById('portal-pwd-secret')?.value || '',
          set_password: Boolean(setupCb?.checked),
          name: document.getElementById('portal-pwd-name')?.value.trim() || ''
        };
        const res = await fetch('/api/portal/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) return notify(data.error || 'Login failed');
        dviState.portalSessionToken = data.session_token;
        localStorage.setItem('aldridge_portal_session', data.session_token);
        dviState.portalDashboard = data.dashboard;
        renderCustomerPortal();
        notify(`Welcome to My Garage Portal, ${data.customer?.name}!`);
      });
    }

    // Load DVI & Unified CRM whenever Staff Tabs 4 or 5 are clicked
    document.getElementById('tab-btn-approvals')?.addEventListener('click', () => { loadDviInspections(); updateOfflineBadge(); });
    document.getElementById('tab-btn-crm')?.addEventListener('click', () => { loadUnifiedCrmProfiles(); });
    document.getElementById('mode-staff-btn')?.addEventListener('click', () => { loadDviInspections(); loadUnifiedCrmProfiles(); });

    // Auto-handle ?portal_token=... deep link or existing portal session
    const params = new URLSearchParams(window.location.search);
    const magicTok = params.get('portal_token');
    if (magicTok) {
      loadPortalSessionFromToken(magicTok);
    } else if (dviState.portalSessionToken) {
      loadPortalSessionFromToken('');
    }
    loadDviInspections();
    loadUnifiedCrmProfiles();
  });
})();
