// ==UserScript==
// @name         Aldridge Auto's — Crosslist Top-200 & Sold Auto-Deleter
// @namespace    https://aldridgeautosupply.com/
// @version      1.1.0
// @description  Syncs your Top-200 active roster AND Sold SKU list from aldridgeautosupply.com/api/deployment/top200, highlights SOLD (red) and non-Top-200 Overflow (orange) items (Active, Draft, Inactive, or Delisted) on Crosslist, selects them in 1 click, and auto-deletes them across pages so sold items never double-sell and inactive/overflow items never block your 200-item Crosslist cap.
// @author       Aldridge Auto's
// @match        https://app.crosslist.com/*
// @match        https://*.crosslist.com/*
// @updateURL    https://aldridgeautosupply.com/crosslist-cleanup.user.js
// @downloadURL  https://aldridgeautosupply.com/crosslist-cleanup.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      aldridgeautosupply.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.1.0';
  const HUB_ORIGIN = 'https://aldridgeautosupply.com';

  let planData = null;
  let top200SkuSet = new Set();
  let top200TitleSet = new Set();
  let overflowSkuSet = new Set();
  let overflowTitleSet = new Set();
  let soldSkuSet = new Set();
  let soldTitleSet = new Set();
  let lastScan = { keep: [], sold: [], overflow: [], unknown: [] };
  let autoDeleteRunning = false;

  function normTitle(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .slice(0, 64);
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function gmGetJson(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          headers: { Accept: 'application/json' },
          timeout: 25000,
          onload: (resp) => {
            try {
              resolve({ ok: resp.status >= 200 && resp.status < 300, status: resp.status, data: JSON.parse(resp.responseText || '{}') });
            } catch (err) {
              reject(err);
            }
          },
          onerror: (err) => reject(new Error(err?.error || 'GM_xmlhttpRequest failed')),
          ontimeout: () => reject(new Error('Request timed out'))
        });
        return;
      }
      fetch(url)
        .then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json() }))
        .then(resolve)
        .catch(reject);
    });
  }

  async function loadTop200Plan() {
    const res = await gmGetJson(`${HUB_ORIGIN}/api/deployment/top200`);
    if (!res.ok || !res.data || !Array.isArray(res.data.top200)) {
      throw new Error(`Could not load Top-200 plan (HTTP ${res.status})`);
    }
    planData = res.data;
    top200SkuSet = new Set((planData.top200 || []).map((x) => String(x.sku || '').trim().toUpperCase()));
    top200TitleSet = new Set((planData.top200 || []).map((x) => normTitle(x.title)).filter(Boolean));
    overflowSkuSet = new Set((planData.overflow || []).map((x) => String(x.sku || '').trim().toUpperCase()));
    overflowTitleSet = new Set((planData.overflow || []).map((x) => normTitle(x.title)).filter(Boolean));
    soldSkuSet = new Set((planData.sold_skus || []).map((s) => String(s || '').trim().toUpperCase()).filter(Boolean));
    soldTitleSet = new Set((planData.sold_items || []).map((x) => normTitle(x.title)).filter((t) => t.length >= 20));
    return planData;
  }

  // Detect Crosslist inventory rows/cards (supports table rows, grid cards, and React virtual lists)
  function findInventoryRowElements() {
    const tableRows = Array.from(document.querySelectorAll('tbody tr, [role="row"]')).filter((el) => {
      if (el.closest('thead')) return false;
      const txt = (el.innerText || '').trim();
      return txt.length > 15 && Boolean(el.querySelector('input[type="checkbox"], [role="checkbox"]'));
    });
    if (tableRows.length > 0) return tableRows;

    const cards = Array.from(document.querySelectorAll('[class*="listing"], [class*="product"], [class*="item-card"], [data-testid*="listing"], [data-testid*="product"]')).filter((el) => {
      const txt = (el.innerText || '').trim();
      return txt.length > 15 && Boolean(el.querySelector('input[type="checkbox"], [role="checkbox"]'));
    });
    return cards;
  }

  function classifyRow(rowEl) {
    const text = (rowEl.innerText || '').trim();
    const skuMatch = text.match(/\b(ALD-[A-Z0-9-]+)\b/i);
    const foundSku = skuMatch ? skuMatch[1].toUpperCase() : '';

    if (foundSku) {
      if (soldSkuSet.has(foundSku)) return { bucket: 'sold', sku: foundSku, reason: 'SOLD — Delist Immediately' };
      if (top200SkuSet.has(foundSku)) return { bucket: 'keep', sku: foundSku, reason: 'In Top 200 SKU' };
      if (overflowSkuSet.has(foundSku)) return { bucket: 'overflow', sku: foundSku, reason: 'Overflow Reserve SKU' };
      // Any ALD- SKU not in active Top 200 (e.g. sold/legacy/archived) should also be cleared to free Crosslist cap
      return { bucket: 'overflow', sku: foundSku, reason: 'Non-Top-200 / Legacy ALD SKU' };
    }

    const normRow = normTitle(text);
    for (const t of soldTitleSet) {
      if (t.length >= 22 && normRow.includes(t.slice(0, 36))) {
        return { bucket: 'sold', sku: '', reason: 'Matched SOLD Title' };
      }
    }
    for (const t of top200TitleSet) {
      if (t.length >= 22 && normRow.includes(t.slice(0, 36))) {
        return { bucket: 'keep', sku: '', reason: 'Matched Top 200 Title' };
      }
    }
    for (const t of overflowTitleSet) {
      if (t.length >= 22 && normRow.includes(t.slice(0, 36))) {
        return { bucket: 'overflow', sku: '', reason: 'Matched Overflow Title' };
      }
    }
    return { bucket: 'unknown', sku: '', reason: 'Unmatched item' };
  }

  function setRowCheckbox(rowEl, desiredChecked) {
    const cb = rowEl.querySelector('input[type="checkbox"]');
    if (cb) {
      if (Boolean(cb.checked) !== Boolean(desiredChecked)) {
        cb.click();
      }
      return true;
    }
    const ariaCb = rowEl.querySelector('[role="checkbox"]');
    if (ariaCb) {
      const isChecked = ariaCb.getAttribute('aria-checked') === 'true';
      if (isChecked !== Boolean(desiredChecked)) {
        ariaCb.click();
      }
      return true;
    }
    return false;
  }

  function scanAndHighlightPage() {
    const rows = findInventoryRowElements();
    const keep = [];
    const sold = [];
    const overflow = [];
    const unknown = [];

    for (const row of rows) {
      const info = classifyRow(row);
      row.dataset.aldridgeBucket = info.bucket;
      if (info.bucket === 'keep') {
        row.style.outline = '2px solid #16a34a';
        row.style.backgroundColor = 'rgba(22, 163, 74, 0.06)';
        keep.push({ el: row, ...info });
      } else if (info.bucket === 'sold') {
        row.style.outline = '3px solid #dc2626';
        row.style.backgroundColor = 'rgba(220, 38, 38, 0.14)';
        sold.push({ el: row, ...info });
      } else if (info.bucket === 'overflow') {
        row.style.outline = '2px solid #ea580c';
        row.style.backgroundColor = 'rgba(234, 88, 12, 0.08)';
        overflow.push({ el: row, ...info });
      } else {
        row.style.outline = '';
        unknown.push({ el: row, ...info });
      }
    }

    lastScan = { keep, sold, overflow, unknown };
    return lastScan;
  }

  function selectRemovableRowsOnPage(mode = 'both') {
    const scan = scanAndHighlightPage();
    // Always uncheck Top 200 & unknown rows first so we NEVER accidentally delete a Top 200 item!
    for (const k of scan.keep) setRowCheckbox(k.el, false);
    for (const u of scan.unknown) setRowCheckbox(u.el, false);
    let selected = 0;
    for (const s of scan.sold) {
      if (setRowCheckbox(s.el, true)) selected++;
    }
    for (const o of scan.overflow) {
      const want = mode !== 'sold_only';
      if (setRowCheckbox(o.el, want) && want) selected++;
    }
    return {
      selected,
      keepCount: scan.keep.length,
      soldCount: scan.sold.length,
      overflowCount: scan.overflow.length
    };
  }

  function findBulkDeleteButton() {
    const btns = Array.from(document.querySelectorAll('button, [role="button"]')).filter((b) => {
      if (b.disabled) return false;
      const st = window.getComputedStyle(b);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      if (b.closest('#aldridge-crosslist-cleaner-hud')) return false;
      const txt = (b.innerText || b.getAttribute('aria-label') || b.title || '').trim();
      return /\b(delete|remove)\b/i.test(txt) && !/cancel|keep|undo/i.test(txt);
    });
    return btns[0] || null;
  }

  function findConfirmModalDeleteButton() {
    const modals = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], .modal, [class*="modal"], [class*="dialog"]'));
    for (const m of modals) {
      const btn = Array.from(m.querySelectorAll('button')).find((b) => {
        if (b.disabled) return false;
        const txt = (b.innerText || '').trim();
        return /\b(delete|confirm|yes,?\s*delete|remove)\b/i.test(txt) && !/cancel/i.test(txt);
      });
      if (btn) return btn;
    }
    return null;
  }

  function findNextPageButton() {
    const btns = Array.from(document.querySelectorAll('button, a')).filter((b) => {
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      if (b.closest('#aldridge-crosslist-cleaner-hud')) return false;
      const txt = (b.innerText || b.getAttribute('aria-label') || b.title || '').trim();
      return /^(next|›|»|>)$/i.test(txt) || /next\s*page/i.test(txt);
    });
    return btns[0] || null;
  }

  async function autoDeleteLoop(mode = 'both') {
    if (autoDeleteRunning) return;
    const label = mode === 'sold_only' ? 'SOLD' : 'SOLD + non-Top-200 Overflow';
    if (!window.confirm(`Permanently DELETE all ${label} items (Active, Draft, Inactive, or Delisted) on Crosslist so sold parts never double-sell and your ${planData?.summary?.top200_count || 200} Top-200 items fit cleanly within your Crosslist plan limit?`)) {
      return;
    }

    autoDeleteRunning = true;
    let totalDeleted = 0;
    try {
      for (let page = 1; page <= 25 && autoDeleteRunning; page++) {
        renderHud(`Scanning page ${page} for ${label} items...`, 'info');
        const { selected } = selectRemovableRowsOnPage(mode);

        if (selected === 0) {
          const nextBtn = findNextPageButton();
          if (nextBtn) {
            renderHud(`Page ${page} clean (0 ${label}). Advancing to next page...`, 'info');
            nextBtn.click();
            await new Promise((r) => setTimeout(r, 2200));
            continue;
          }
          renderHud(`✅ Cleanup complete! Deleted ${totalDeleted} ${label} item(s). Only Top-200 items remain!`, 'success');
          break;
        }

        renderHud(`Selected ${selected} ${label} item(s) on page ${page}. Triggering Crosslist bulk delete...`, 'warn');
        await new Promise((r) => setTimeout(r, 500));

        const delBtn = findBulkDeleteButton();
        if (!delBtn) {
          renderHud(`Selected ${selected} item(s) — click Crosslist's Delete button manually (could not auto-locate button).`, 'warn');
          break;
        }
        delBtn.click();
        await new Promise((r) => setTimeout(r, 900));

        const confirmBtn = findConfirmModalDeleteButton();
        if (confirmBtn) {
          confirmBtn.click();
          totalDeleted += selected;
          renderHud(`Deleted ${selected} item(s) (total: ${totalDeleted}). Waiting for Crosslist refresh...`, 'success');
          await new Promise((r) => setTimeout(r, 2600));
        } else {
          renderHud(`Clicked Delete for ${selected} item(s) — confirm the Crosslist dialog if prompted.`, 'warn');
          break;
        }
      }
    } finally {
      autoDeleteRunning = false;
      scanAndHighlightPage();
      renderHud(`Cleanup finished (deleted ~${totalDeleted} item(s)). Ready for Top-200 CSV + ZIP upload!`, 'success');
    }
  }

  function renderHud(statusMsg = 'Ready to scan Crosslist inventory.', statusType = 'info') {
    if (!document.body) return;
    let hud = document.getElementById('aldridge-crosslist-cleaner-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'aldridge-crosslist-cleaner-hud';
      hud.style.cssText = [
        'position:fixed',
        'bottom:14px',
        'right:14px',
        'z-index:2147483647',
        'background:#0b1628',
        'color:#f8fafc',
        'border:2px solid #dc2626',
        'border-radius:10px',
        'padding:11px 14px',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
        'font-size:12.5px',
        'width:375px',
        'max-width:calc(100vw - 24px)',
        'box-shadow:0 12px 32px rgba(0,0,0,0.45)'
      ].join(';');
      document.body.appendChild(hud);
    }

    const colors = { info: '#93c5fd', success: '#4ade80', warn: '#fbbf24', error: '#f87171' };
    const s = planData?.summary;

    hud.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div style="font-weight:800;color:#fca5a5;font-size:13px;">🧹 Aldridge Crosslist Top-200 &amp; Sold Cleaner v${SCRIPT_VERSION}</div>
        <button id="ald-cl-close" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:4px;padding:1px 7px;cursor:pointer;font-size:11px;">×</button>
      </div>
      ${s ? `
        <div style="display:flex;gap:7px;flex-wrap:wrap;font-size:11px;color:#cbd5e1;margin-bottom:6px;background:#13233f;padding:5px 8px;border-radius:6px;">
          <span>Keep: <strong style="color:#4ade80;">${s.top200_count}</strong></span>
          <span>•</span>
          <span>Overflow: <strong style="color:#fb923c;">${s.overflow_count}</strong></span>
          <span>•</span>
          <span>Sold: <strong style="color:#f87171;">${s.sold_cleanup_count || 0}</strong></span>
          <span>•</span>
          <span>Value: <strong>$${Number(s.top200_value || 0).toLocaleString()}</strong></span>
        </div>
      ` : ''}
      <div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">
        On Page: <strong style="color:#4ade80;">${lastScan.keep.length} Keep</strong> •
        <strong style="color:#f87171;">${lastScan.sold.length} Sold</strong> •
        <strong style="color:#fb923c;">${lastScan.overflow.length} Overflow</strong> •
        <span>${lastScan.unknown.length} Other</span>
      </div>
      <div style="color:${colors[statusType] || '#93c5fd'};font-weight:600;margin-bottom:8px;">${escapeHtml(statusMsg)}</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;">
        <button id="ald-cl-scan" style="flex:1;background:#1e3a5f;color:#fff;border:1px solid #334155;border-radius:5px;padding:6px 8px;font-size:11px;font-weight:700;cursor:pointer;">🔍 Scan</button>
        <button id="ald-cl-select-sold" style="flex:1;background:#991b1b;color:#fff;border:none;border-radius:5px;padding:6px 8px;font-size:11px;font-weight:700;cursor:pointer;">🔴 Sold Only</button>
        <button id="ald-cl-select" style="flex:1;background:#b45309;color:#fff;border:none;border-radius:5px;padding:6px 8px;font-size:11px;font-weight:700;cursor:pointer;">☑ Sold+Over</button>
      </div>
      <div style="display:flex;gap:5px;margin-top:5px;">
        <button id="ald-cl-autodel" style="flex:1;background:${autoDeleteRunning ? '#475569' : '#dc2626'};color:#fff;border:none;border-radius:5px;padding:6px 8px;font-size:11.5px;font-weight:800;cursor:pointer;">
          ${autoDeleteRunning ? '⏹ Stop Auto-Delete' : '🗑 Auto-Delete Sold + Overflow'}
        </button>
      </div>
      <div style="margin-top:6px;font-size:10.5px;color:#94a3b8;display:flex;justify-content:space-between;">
        <a href="${HUB_ORIGIN}/api/exports/crosslist.csv?tier=top200" target="_blank" style="color:#93c5fd;text-decoration:underline;">⬇ Top-200 CSV</a>
        <a href="${HUB_ORIGIN}/api/exports/crosslist-images.zip?tier=top200" target="_blank" style="color:#93c5fd;text-decoration:underline;">📦 Top-200 ZIP</a>
        <a href="${HUB_ORIGIN}/api/exports/top200-deployment-kit.zip" target="_blank" style="color:#4ade80;text-decoration:underline;">🚀 Full Kit ZIP</a>
      </div>
    `;

    document.getElementById('ald-cl-close')?.addEventListener('click', () => hud.remove());
    document.getElementById('ald-cl-scan')?.addEventListener('click', () => {
      const scan = scanAndHighlightPage();
      renderHud(
        `Scanned: ${scan.keep.length} Keep (green), ${scan.sold.length} SOLD (red), ${scan.overflow.length} Overflow (orange).`,
        scan.sold.length || scan.overflow.length ? 'warn' : 'success'
      );
    });
    document.getElementById('ald-cl-select-sold')?.addEventListener('click', () => {
      const res = selectRemovableRowsOnPage('sold_only');
      renderHud(`Selected ${res.selected} SOLD item(s) (Top 200 safely unchecked). Delete in Crosslist to prevent double-selling.`, res.selected ? 'warn' : 'success');
    });
    document.getElementById('ald-cl-select')?.addEventListener('click', () => {
      const res = selectRemovableRowsOnPage('both');
      renderHud(`Selected ${res.selected} Sold + Overflow item(s) (Top 200 safely unchecked).`, res.selected ? 'warn' : 'success');
    });
    document.getElementById('ald-cl-autodel')?.addEventListener('click', () => {
      if (autoDeleteRunning) {
        autoDeleteRunning = false;
        renderHud('Stopped auto-delete loop.', 'warn');
      } else {
        autoDeleteLoop('both');
      }
    });
  }

  async function init() {
    try {
      renderHud('Syncing Top-200 + Sold roster from aldridgeautosupply.com...', 'info');
      await loadTop200Plan();
      const scan = scanAndHighlightPage();
      renderHud(
        `Synced Top ${planData.summary.top200_count} (${planData.summary.overflow_count} overflow, ${planData.summary.sold_cleanup_count || 0} sold). On page: ${scan.sold.length} sold, ${scan.overflow.length} overflow.`,
        scan.sold.length || scan.overflow.length ? 'warn' : 'success'
      );
    } catch (err) {
      renderHud(`Sync error: ${err.message}`, 'error');
    }
  }

  setTimeout(() => init(), 1200);
})();
