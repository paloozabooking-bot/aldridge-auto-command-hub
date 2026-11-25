// ==UserScript==
// @name         Aldridge Auto's — Craigslist Tacoma Auto Parts Bulk Auto-Poster
// @namespace    https://aldridgeautosupply.com/
// @version      2.4.0
// @description  Auto-advances Seattle-Tacoma -> Tacoma/Pierce County (tac) -> For Sale By Dealer -> Auto Parts, auto-fills Top-200 strategy listings from aldridgeautosupply.com/api/craigslist/queue, attaches Shopify CDN photos via GM_xmlhttpRequest + DataTransfer, syncs posted SKUs across Render restarts, auto-loads next unposted part after publish, and cleans SOLD + Overflow ads on accounts.craigslist.org.
// @author       Aldridge Auto's
// @match        https://post.craigslist.org/*
// @match        https://seattle.craigslist.org/*
// @match        https://accounts.craigslist.org/*
// @updateURL    https://aldridgeautosupply.com/craigslist-autofill.user.js
// @downloadURL  https://aldridgeautosupply.com/craigslist-autofill.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      aldridgeautosupply.com
// @connect      cdn.shopify.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '2.4.0';
  const DEFAULT_HUB = 'https://aldridgeautosupply.com';
  const START_POST_URL = 'https://post.craigslist.org/c/sea?lang=en&cc=us';
  const MAX_CL_PHOTOS = 24;

  // Persistent Tampermonkey storage keys (survive cross-subdomain redirects)
  const GM_KEYS = {
    HUB: 'aldridge_cl_hub_origin_v2',
    POSTED: 'aldridge_cl_posted_skus_v2',
    SKIPPED: 'aldridge_cl_skipped_skus_v2',
    ACTIVE: 'aldridge_cl_active_item_v2',
    PENDING_PUBLISH: 'aldridge_cl_pending_publish_v2',
    AUTO_ADVANCE: 'aldridge_cl_auto_advance_v2',
    POSTING_MODE: 'aldridge_cl_posting_mode_v2', // 'dealer' (default: fsd/ptd) or 'owner' (fso/pts)
    QUEUE_FILTER: 'aldridge_cl_queue_filter_v2', // 'all' | 'heavy' | 'high150'
    VEHICLE_FILTER: 'aldridge_cl_vehicle_filter_v2',
    HUD_COLLAPSED: 'aldridge_cl_hud_collapsed_v2'
  };

  // ---------- Storage Helpers (GM_* with localStorage fallback) ----------
  function gmGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') {
        const val = GM_getValue(key, undefined);
        if (val !== undefined) return val;
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw);
    } catch (_) {}
    return fallback;
  }

  function gmSet(key, val) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, val);
      }
    } catch (_) {}
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  function gmDelete(key) {
    try {
      if (typeof GM_deleteValue === 'function') {
        GM_deleteValue(key);
      }
    } catch (_) {}
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }

  function getHubOrigin() {
    const saved = String(gmGet(GM_KEYS.HUB, DEFAULT_HUB) || DEFAULT_HUB).trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(saved) ? saved : DEFAULT_HUB;
  }

  function getPostedMap() {
    const val = gmGet(GM_KEYS.POSTED, {});
    return val && typeof val === 'object' && !Array.isArray(val) ? val : {};
  }

  function savePostedMap(map) {
    gmSet(GM_KEYS.POSTED, map || {});
  }

  function getSkippedList() {
    const val = gmGet(GM_KEYS.SKIPPED, []);
    return Array.isArray(val) ? val : [];
  }

  function addSkippedSku(sku) {
    if (!sku) return;
    const list = getSkippedList();
    if (!list.includes(sku)) {
      list.push(sku);
      gmSet(GM_KEYS.SKIPPED, list);
    }
  }

  function getActiveItem() {
    const val = gmGet(GM_KEYS.ACTIVE, null);
    return val && typeof val === 'object' && val.sku ? val : null;
  }

  function setActiveItem(item) {
    if (!item || !item.sku) {
      gmDelete(GM_KEYS.ACTIVE);
      return;
    }
    gmSet(GM_KEYS.ACTIVE, item);
  }

  function isAutoAdvanceEnabled() {
    return gmGet(GM_KEYS.AUTO_ADVANCE, true) !== false;
  }

  function getPostingMode() {
    return gmGet(GM_KEYS.POSTING_MODE, 'dealer') === 'owner' ? 'owner' : 'dealer';
  }

  // ---------- Loop & Safety Guards ----------
  function stepGuardKey(stepName) {
    return `aldridge_cl_step_done:${window.location.pathname}${window.location.search}:${stepName}`;
  }

  function hasStepRunOnThisUrl(stepName) {
    try {
      return sessionStorage.getItem(stepGuardKey(stepName)) === '1';
    } catch (_) {
      return false;
    }
  }

  function markStepRunOnThisUrl(stepName) {
    try {
      sessionStorage.setItem(stepGuardKey(stepName), '1');
    } catch (_) {}
  }

  function hasCaptchaChallenge() {
    const selectors = [
      'iframe[src*="captcha"]',
      'iframe[src*="hcaptcha"]',
      'iframe[src*="recaptcha"]',
      'iframe[src*="turnstile"]',
      '.g-recaptcha',
      '.h-captcha',
      '[data-sitekey]'
    ];
    if (document.querySelector(selectors.join(','))) return true;
    const bodyText = (document.body?.innerText || '').toLowerCase();
    return bodyText.includes('verify you are human') || bodyText.includes('please complete the captcha');
  }

  function hasBillingOrPaymentScreen() {
    const search = window.location.search.toLowerCase();
    if (search.includes('s=pay') || search.includes('s=billing') || search.includes('s=checkout')) return true;
    if (document.querySelector('input[name*="card"], input[autocomplete="cc-number"], iframe[src*="stripe"]')) return true;
    const h = (document.querySelector('h1, h2, .postingheader')?.innerText || '').toLowerCase();
    return h.includes('billing') || h.includes('payment') || h.includes('credit card');
  }

  function getVisibleValidationErrors() {
    const errNodes = Array.from(document.querySelectorAll('.err, .error, .bigerror, .formnote.err, #postingForm .err'));
    const msgs = [];
    for (const el of errNodes) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const txt = (el.innerText || '').trim();
      if (txt && !msgs.includes(txt)) msgs.push(txt);
    }
    return msgs;
  }

  // ---------- Network Helpers (GM_xmlhttpRequest bypasses CORS & CL CSP) ----------
  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          timeout: 25000,
          ...options,
          onload: (resp) => resolve(resp),
          onerror: (err) => reject(new Error(err?.error || err?.statusText || 'GM_xmlhttpRequest network error')),
          ontimeout: () => reject(new Error(`Request timed out: ${options.url}`))
        });
        return;
      }
      // Fallback for non-Tampermonkey environments
      fetch(options.url, {
        method: options.method || 'GET',
        headers: options.headers || undefined,
        body: options.data || undefined
      })
        .then(async (res) => {
          const isBlob = options.responseType === 'blob';
          const payload = isBlob ? await res.blob() : await res.text();
          resolve({
            status: res.status,
            statusText: res.statusText,
            response: payload,
            responseText: isBlob ? '' : payload,
            responseHeaders: `content-type: ${res.headers.get('content-type') || ''}`
          });
        })
        .catch(reject);
    });
  }

  async function apiGetJson(url) {
    const resp = await gmRequest({
      method: 'GET',
      url,
      headers: { Accept: 'application/json' }
    });
    let data = null;
    try {
      data = JSON.parse(resp.responseText || '{}');
    } catch (_) {
      data = null;
    }
    return { status: resp.status, ok: resp.status >= 200 && resp.status < 300, data };
  }

  async function apiPostJson(url, bodyObj) {
    const resp = await gmRequest({
      method: 'POST',
      url,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      data: JSON.stringify(bodyObj || {})
    });
    let data = null;
    try {
      data = JSON.parse(resp.responseText || '{}');
    } catch (_) {
      data = null;
    }
    return { status: resp.status, ok: resp.status >= 200 && resp.status < 300, data };
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl).split(',');
    const meta = parts[0] || '';
    const b64 = parts[1] || '';
    const mimeMatch = meta.match(/data:([^;]+)/i);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binStr = atob(b64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  function extractHeader(headersStr, name) {
    const re = new RegExp(`^${name}:\\s*(.+)$`, 'im');
    const m = String(headersStr || '').match(re);
    return m ? m[1].trim() : '';
  }

  function guessImageMime(url, headerMime, blobType) {
    const raw = (blobType || headerMime || '').split(';')[0].trim().toLowerCase();
    if (raw.startsWith('image/')) return raw;
    const cleanUrl = String(url || '').split('?')[0].toLowerCase();
    if (cleanUrl.endsWith('.png')) return 'image/png';
    if (cleanUrl.endsWith('.webp')) return 'image/webp';
    if (cleanUrl.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }

  async function fetchImageBlob(url) {
    if (String(url).startsWith('data:')) {
      return dataUrlToBlob(url);
    }
    const resp = await gmRequest({
      method: 'GET',
      url,
      responseType: 'blob',
      headers: { Accept: 'image/jpeg,image/png,image/webp,image/*,*/*;q=0.8' }
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`HTTP ${resp.status} fetching image`);
    }
    const headerMime = extractHeader(resp.responseHeaders, 'content-type');
    if (resp.response instanceof Blob && resp.response.size > 0) {
      const mime = guessImageMime(url, headerMime, resp.response.type);
      return resp.response.type === mime ? resp.response : new Blob([resp.response], { type: mime });
    }
    if (resp.response instanceof ArrayBuffer && resp.response.byteLength > 0) {
      const mime = guessImageMime(url, headerMime, '');
      return new Blob([resp.response], { type: mime });
    }
    throw new Error('Empty image response');
  }

  // Convert WebP/AVIF/non-standard images to JPEG via <canvas> so Craigslist accepts 100% of Shopify CDN photos
  async function normalizeBlobForCraigslist(blob, url) {
    const mime = (blob.type || '').toLowerCase();
    const needsConvert = !mime || (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/gif');
    if (!needsConvert && blob.size <= 10 * 1024 * 1024) {
      return { blob, ext: mime === 'image/png' ? 'png' : mime === 'image/gif' ? 'gif' : 'jpg', mime };
    }
    try {
      const objUrl = URL.createObjectURL(blob);
      try {
        const img = await new Promise((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('Image decode failed'));
          el.src = objUrl;
        });
        const maxDim = 2048;
        let w = img.naturalWidth || img.width || 1200;
        let h = img.naturalHeight || img.height || 900;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        if (jpegBlob && jpegBlob.size > 0) {
          return { blob: jpegBlob, ext: 'jpg', mime: 'image/jpeg' };
        }
      } finally {
        URL.revokeObjectURL(objUrl);
      }
    } catch (err) {
      console.warn('[Aldridge CL] Canvas conversion fallback for', url, err);
    }
    const fallbackMime = mime && mime.startsWith('image/') ? mime : 'image/jpeg';
    return { blob, ext: fallbackMime.includes('png') ? 'png' : 'jpg', mime: fallbackMime };
  }

  function isQrCardPhoto(url) {
    return /\.qr\.png(\?|$)|\/qr[-_]|qr_card/i.test(String(url || ''));
  }

  function extractCleanPhotoUrls(item, hubOrigin) {
    const raw = [];
    if (Array.isArray(item?.photo_urls)) raw.push(...item.photo_urls);
    if (Array.isArray(item?.photos)) raw.push(...item.photos);
    if (Array.isArray(item?.photo_data_urls)) raw.push(...item.photo_data_urls);

    const seen = new Set();
    const out = [];
    for (const entry of raw) {
      const s = String(entry || '').trim();
      if (!s || isQrCardPhoto(s)) continue;
      let normalized = s;
      if (!s.startsWith('data:') && !/^https?:\/\//i.test(s)) {
        try {
          normalized = new URL(s, hubOrigin).href;
        } catch (_) {
          continue;
        }
      }
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= MAX_CL_PHOTOS) break;
    }
    return out;
  }

  // ---------- Queue & Posted Tracking ----------
  let cachedQueueState = null;

  function getQueueFilter() {
    const v = String(gmGet(GM_KEYS.QUEUE_FILTER, 'top200') || 'top200');
    return ['top200', 'all', 'heavy', 'high150'].includes(v) ? v : 'top200';
  }

  function getVehicleFilter() {
    return String(gmGet(GM_KEYS.VEHICLE_FILTER, '') || '').trim();
  }

  function isSkuPosted(sku, serverFlag = false) {
    if (serverFlag) return true;
    const postedMap = getPostedMap();
    return Boolean(postedMap[sku]);
  }

  async function syncPostedBatchToServer(hubOrigin, skuEntries) {
    if (!skuEntries.length) return;
    try {
      const res = await apiPostJson(`${hubOrigin}/api/craigslist/sync-posted`, {
        posted: skuEntries
      });
      if (res.ok) {
        const postedMap = getPostedMap();
        let changed = false;
        for (const e of skuEntries) {
          if (postedMap[e.sku] && postedMap[e.sku].syncedToServer !== true) {
            postedMap[e.sku] = { ...postedMap[e.sku], syncedToServer: true };
            changed = true;
          }
        }
        if (changed) savePostedMap(postedMap);
        return;
      }
    } catch (_) {}

    const postedMap = getPostedMap();
    let changed = false;
    for (const e of skuEntries) {
      try {
        const res = await apiPostJson(`${hubOrigin}/api/craigslist/mark-posted`, {
          sku: e.sku,
          craigslist_url: e.url || undefined,
          craigslist_post_id: e.postId || undefined
        });
        if (res.ok || res.status === 404) {
          if (postedMap[e.sku]) {
            postedMap[e.sku] = { ...postedMap[e.sku], syncedToServer: true };
            changed = true;
          }
        }
      } catch (_) {}
    }
    if (changed) savePostedMap(postedMap);
  }

  async function syncUnsyncedPostedToServer(hubOrigin) {
    const postedMap = getPostedMap();
    const entries = Object.entries(postedMap)
      .filter(([, meta]) => meta && meta.syncedToServer === false)
      .map(([sku, meta]) => ({ sku, postedAt: meta.postedAt, url: meta.url, postId: meta.postId }));
    if (!entries.length) return;
    await syncPostedBatchToServer(hubOrigin, entries);
  }

  async function markSkuPostedEverywhere(sku, hubOrigin, extra = {}) {
    if (!sku) return;
    const postedMap = getPostedMap();
    const nowIso = new Date().toISOString();
    postedMap[sku] = {
      postedAt: nowIso,
      url: extra.url || null,
      postId: extra.postId || null,
      syncedToServer: false
    };
    savePostedMap(postedMap);

    // Clear active & pending publish if matching this SKU
    const active = getActiveItem();
    if (active && active.sku === sku) {
      setActiveItem(null);
    }
    gmDelete(GM_KEYS.PENDING_PUBLISH);

    try {
      const res = await apiPostJson(`${hubOrigin}/api/craigslist/mark-posted`, {
        sku,
        craigslist_url: extra.url || undefined,
        craigslist_post_id: extra.postId || undefined
      });
      if (res.ok) {
        postedMap[sku].syncedToServer = true;
        savePostedMap(postedMap);
      }
    } catch (err) {
      console.warn('[Aldridge CL] Deferred server mark-posted sync for', sku, err);
    }
  }

  async function loadQueue(hubOrigin, forceRefresh = false) {
    if (cachedQueueState && !forceRefresh) return cachedQueueState;
    try {
      await syncUnsyncedPostedToServer(hubOrigin);
    } catch (_) {}

    const qFilter = getQueueFilter();
    const vFilter = getVehicleFilter();
    const params = new URLSearchParams();
    params.set('tier', qFilter === 'all' ? 'all' : 'top200');
    params.set('sort', qFilter === 'heavy' ? 'heavy_first' : 'price_desc');
    if (qFilter === 'heavy') params.set('heavy_only', '1');
    if (qFilter === 'high150') params.set('min_price', '150');
    if (vFilter) params.set('vehicle', vFilter);

    const res = await apiGetJson(`${hubOrigin}/api/craigslist/queue?${params.toString()}`);
    if (!res.ok || !res.data || !Array.isArray(res.data.queue)) {
      throw new Error(`Failed to load /api/craigslist/queue (HTTP ${res.status})`);
    }
    const postedMap = getPostedMap();
    const skippedSet = new Set(getSkippedList());
    const queue = res.data.queue;
    const serverWasReset = Number(res.data.posted_count || 0) === 0 && Object.keys(postedMap).length > 0;

    // Two-way reconciliation:
    // - If Render restarted and wiped ephemeral SQLite (server posted_count === 0 while GM has history), bulk-reconcile back to server
    // - Otherwise mirror both server-posted marks and explicit staff unmarks cleanly
    let mapUpdated = false;
    const missingOnServer = [];
    for (const q of queue) {
      if (q.posted_craigslist && !postedMap[q.sku]) {
        postedMap[q.sku] = {
          postedAt: q.posted_at || new Date().toISOString(),
          url: q.craigslist_url || null,
          postId: q.craigslist_post_id || null,
          syncedToServer: true
        };
        mapUpdated = true;
      } else if (!q.posted_craigslist && postedMap[q.sku]) {
        if (serverWasReset || postedMap[q.sku].syncedToServer === false) {
          const meta = postedMap[q.sku];
          missingOnServer.push({
            sku: q.sku,
            postedAt: meta.postedAt,
            url: meta.url,
            postId: meta.postId
          });
        } else {
          delete postedMap[q.sku];
          mapUpdated = true;
        }
      }
    }
    if (mapUpdated) savePostedMap(postedMap);
    if (missingOnServer.length > 0) {
      syncPostedBatchToServer(hubOrigin, missingOnServer).catch(() => {});
    }

    const postedItems = queue.filter((q) => isSkuPosted(q.sku, q.posted_craigslist));
    const unpostedItems = queue.filter((q) => !isSkuPosted(q.sku, q.posted_craigslist) && !skippedSet.has(q.sku));

    cachedQueueState = {
      raw: res.data,
      queue,
      postedItems,
      unpostedItems,
      vehicleSummary: res.data.vehicle_summary || {},
      totalCount: queue.length,
      postedCount: postedItems.length,
      remainingCount: unpostedItems.length
    };
    return cachedQueueState;
  }

  function buildLaunchUrl(sku, hubOrigin) {
    return `${START_POST_URL}#aldridge_sku=${encodeURIComponent(sku)}&hub=${encodeURIComponent(hubOrigin)}`;
  }

  function parseHashParams() {
    const hashStr = window.location.hash ? window.location.hash.slice(1) : '';
    if (!hashStr) return {};
    const hp = new URLSearchParams(hashStr);
    const sku = hp.get('aldridge_sku') || '';
    const hub = hp.get('hub') || '';
    return { sku: sku.trim(), hub: hub.trim().replace(/\/+$/, '') };
  }

  async function resolveCurrentPart(hubOrigin, queueState) {
    const { sku: hashSku } = parseHashParams();
    if (hashSku) {
      const fromQueue = queueState.queue.find((q) => q.sku === hashSku);
      if (fromQueue) {
        setActiveItem(fromQueue);
        return fromQueue;
      }
      // Fallback: fetch directly by SKU if not in queue array
      const itemRes = await apiGetJson(`${hubOrigin}/api/craigslist/item/${encodeURIComponent(hashSku)}`);
      if (itemRes.ok && itemRes.data && !itemRes.data.sold) {
        setActiveItem(itemRes.data);
        return itemRes.data;
      }
    }

    const active = getActiveItem();
    if (active && active.sku && !isSkuPosted(active.sku, false)) {
      const freshFromQueue = queueState.queue.find((q) => q.sku === active.sku);
      if (freshFromQueue && !freshFromQueue.posted_craigslist) {
        const merged = { ...active, ...freshFromQueue };
        setActiveItem(merged);
        return merged;
      }
      if (!freshFromQueue) {
        // Might have been sold or removed; check live item endpoint
        const check = await apiGetJson(`${hubOrigin}/api/craigslist/item/${encodeURIComponent(active.sku)}`);
        if (check.ok && check.data && !check.data.sold) {
          const merged = { ...active, ...check.data };
          setActiveItem(merged);
          return merged;
        }
      }
    }

    const next = queueState.unpostedItems[0] || null;
    setActiveItem(next);
    return next;
  }

  async function navigateToNextUnposted(hubOrigin, excludeSku = '') {
    const q = await loadQueue(hubOrigin, true);
    const next = q.unpostedItems.find((item) => item.sku !== excludeSku) || null;
    if (!next) {
      setActiveItem(null);
      updateHud({
        status: `🎉 Queue Complete! All ${q.totalCount} active SKUs are posted to Craigslist Tacoma.`,
        statusType: 'success',
        queueState: q,
        activeItem: null
      });
      return null;
    }
    setActiveItem(next);
    window.location.href = buildLaunchUrl(next.sku, hubOrigin);
    return next;
  }

  // ---------- DOM & Form Helpers ----------
  function setNativeValue(el, val) {
    if (!el || val === undefined || val === null) return false;
    const strVal = String(val);
    try {
      el.focus();
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(el, strVal);
      } else {
        el.value = strVal;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    } catch (_) {
      el.value = strVal;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }

  function setCheckbox(el, checked) {
    if (!el) return;
    if (Boolean(el.checked) !== Boolean(checked)) {
      el.click();
      if (Boolean(el.checked) !== Boolean(checked)) {
        el.checked = Boolean(checked);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  function selectRadioAndSubmit(radio, stepName) {
    if (!radio || hasStepRunOnThisUrl(stepName)) return false;
    markStepRunOnThisUrl(stepName);

    const form = radio.closest('form') || document.querySelector('form');
    radio.checked = true;
    radio.click();
    radio.dispatchEvent(new Event('input', { bubbles: true }));
    radio.dispatchEvent(new Event('change', { bubbles: true }));

    setTimeout(() => {
      const btn =
        form?.querySelector('button[type="submit"], button.pickbutton, button[name="go"], input[type="submit"]') ||
        document.querySelector('button.pickbutton, button[name="go"], button[type="submit"], input[type="submit"]');
      if (btn && !btn.disabled) {
        btn.click();
      } else if (form) {
        form.submit();
      }
    }, 350);
    return true;
  }

  function getRadioLabelText(radio) {
    const label = radio.closest('label') || (radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) : null);
    if (label && (label.innerText || label.textContent || '').trim()) {
      return (label.innerText || label.textContent || '').trim().toLowerCase();
    }
    const parent = radio.closest('li, .selection-list-item, .radio-option, p, div');
    if (parent && parent.querySelectorAll('input[type="radio"]').length === 1) {
      return (parent.innerText || parent.textContent || '').trim().toLowerCase();
    }
    const nextTxt = (radio.nextSibling?.textContent || '').trim();
    return (nextTxt || radio.value || '').trim().toLowerCase();
  }

  function findSubmitButton(form, preferredTextRegex = null) {
    const scope = form || document;
    const buttons = Array.from(scope.querySelectorAll('button, input[type="submit"]')).filter((b) => {
      if (b.disabled) return false;
      const st = window.getComputedStyle(b);
      return st.display !== 'none' && st.visibility !== 'hidden';
    });
    if (preferredTextRegex) {
      const matched = buttons.find((b) => preferredTextRegex.test((b.innerText || b.value || '').trim()));
      if (matched) return matched;
    }
    return (
      scope.querySelector('button.done.bigbutton, button.continue.bigbutton, button.submit_button, button[name="go"][type="submit"], button[name="go"], button[type="submit"], input[type="submit"]') ||
      buttons.find((b) => /continue|done with images|next/i.test((b.innerText || b.value || '').trim())) ||
      null
    );
  }

  function waitForElement(finderFn, timeoutMs = 10000, intervalMs = 250) {
    return new Promise((resolve) => {
      const initial = finderFn();
      if (initial) return resolve(initial);
      const start = Date.now();
      const timer = setInterval(() => {
        const found = finderFn();
        if (found) {
          clearInterval(timer);
          resolve(found);
        } else if (Date.now() - start >= timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, intervalMs);
    });
  }

  function findBestFileInput() {
    const candidates = Array.from(document.querySelectorAll('input[type="file"]'));
    if (!candidates.length) return null;
    // Prefer Craigslist plupload moxie-shim multi-file input first
    const moxie = candidates.find((el) => el.closest('.moxie-shim, #plupload, #uploader') && el.multiple);
    if (moxie) return moxie;
    const multi = candidates.find((el) => el.multiple);
    if (multi) return multi;
    return candidates[0];
  }

  function countUploadedThumbnails() {
    // Prefer unique .imgbox containers so nested <img> tags are never double-counted
    const boxes = document.querySelectorAll('.images .imgbox, #thumbs .imgbox, .thumbs .imgbox, figure.imgbox');
    if (boxes.length > 0) return boxes.length;
    const imgs = document.querySelectorAll('.images img[src*="images.craigslist.org"], #uploader img[src*="images.craigslist.org"], #thumbs img');
    return imgs.length;
  }

  function isImageUploadBusy() {
    const busyNodes = Array.from(document.querySelectorAll('.loading, .uploading, .progress, .spinner, #loading'));
    return busyNodes.some((el) => {
      const st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity || 1) > 0;
    });
  }

  // ---------- Floating HUD Panel ----------
  let hudState = {
    status: 'Initializing...',
    statusType: 'info',
    queueState: null,
    activeItem: null,
    extraHtml: '',
    onExtraBind: null
  };

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function updateHud(patch) {
    hudState = { ...hudState, ...patch };
    renderHud();
  }

  function renderHud() {
    if (!document.body) return;
    let bar = document.getElementById('aldridge-cl-hud-v2');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'aldridge-cl-hud-v2';
      bar.style.cssText = [
        'position:fixed',
        'bottom:14px',
        'right:14px',
        'z-index:2147483647',
        'background:#0b1628',
        'color:#f8fafc',
        'border:2px solid #ea580c',
        'border-radius:10px',
        'padding:11px 14px',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
        'font-size:12.5px',
        'line-height:1.4',
        'width:360px',
        'max-width:calc(100vw - 24px)',
        'box-shadow:0 12px 32px rgba(0,0,0,0.45)'
      ].join(';');
      document.body.appendChild(bar);
    }

    const collapsed = Boolean(gmGet(GM_KEYS.HUD_COLLAPSED, false));
    const autoOn = isAutoAdvanceEnabled();
    const mode = getPostingMode();
    const q = hudState.queueState;
    const item = hudState.activeItem;
    const hubOrigin = getHubOrigin();
    const photoCount = item ? extractCleanPhotoUrls(item, hubOrigin).length : 0;

    const statusColors = {
      info: '#93c5fd',
      success: '#4ade80',
      warn: '#fbbf24',
      error: '#f87171'
    };
    const statusColor = statusColors[hudState.statusType] || '#93c5fd';

    if (collapsed) {
      bar.style.width = 'auto';
      bar.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-weight:800;color:#fbbf24;">⚡ Aldridge CL v${SCRIPT_VERSION}</span>
          ${item ? `<span style="background:#1e293b;padding:2px 6px;border-radius:4px;font-family:monospace;">${escapeHtml(item.sku)}</span>` : ''}
          <button id="ald-hud-toggle" style="background:#1e293b;color:#fff;border:1px solid #334155;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:11px;">Expand</button>
        </div>
      `;
      document.getElementById('ald-hud-toggle')?.addEventListener('click', () => {
        gmSet(GM_KEYS.HUD_COLLAPSED, false);
        renderHud();
      });
      return;
    }

    const qFilter = getQueueFilter();
    const vFilter = getVehicleFilter();
    const vehicleOptions = Object.entries(q?.vehicleSummary || {})
      .sort((a, b) => b[1] - a[1])
      .map(
        ([veh, cnt]) =>
          `<option value="${escapeHtml(veh)}"${vFilter === veh ? ' selected' : ''}>${escapeHtml(veh)} (${cnt})</option>`
      )
      .join('');

    bar.style.width = '368px';
    bar.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div style="font-weight:800;color:#fbbf24;font-size:13px;">⚡ Aldridge CL Auto-Poster v${SCRIPT_VERSION}</div>
        <button id="ald-hud-toggle" title="Collapse" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:4px;padding:1px 7px;cursor:pointer;font-size:11px;">–</button>
      </div>

      ${q ? `
        <div style="display:flex;gap:8px;font-size:11px;color:#cbd5e1;margin-bottom:6px;background:#13233f;padding:5px 8px;border-radius:6px;">
          <span>Posted: <strong style="color:#4ade80;">${q.postedCount}</strong></span>
          <span>•</span>
          <span>Remaining: <strong style="color:#fbbf24;">${q.remainingCount}</strong></span>
          <span>•</span>
          <span>Queue: <strong>${q.totalCount}</strong></span>
        </div>
        <div style="display:flex;gap:5px;margin-bottom:7px;">
          <select id="ald-sel-qfilter" style="flex:1;background:#13233f;color:#f8fafc;border:1px solid #334155;border-radius:5px;padding:4px 6px;font-size:11px;">
            <option value="top200"${qFilter === 'top200' ? ' selected' : ''}>Top 200 Strategy ($↓)</option>
            <option value="heavy"${qFilter === 'heavy' ? ' selected' : ''}>Top 200 Heavy Local Only</option>
            <option value="high150"${qFilter === 'high150' ? ' selected' : ''}>Top 200 High-Ticket ($150+)</option>
            <option value="all"${qFilter === 'all' ? ' selected' : ''}>All 494 Parts ($↓)</option>
          </select>
          <select id="ald-sel-vfilter" style="flex:1;background:#13233f;color:#f8fafc;border:1px solid #334155;border-radius:5px;padding:4px 6px;font-size:11px;">
            <option value="">All Donor Vehicles</option>
            ${vehicleOptions}
          </select>
        </div>
      ` : ''}

      ${item ? `
        <div style="background:#111f38;border:1px solid #1e3a5f;border-radius:6px;padding:7px 9px;margin-bottom:7px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
            <span style="font-family:monospace;font-weight:700;color:#fff;font-size:12px;">${escapeHtml(item.sku)}</span>
            <span style="color:#4ade80;font-weight:800;">$${escapeHtml(item.price_int || Math.round(Number(item.price || 0)))}</span>
          </div>
          <div style="color:#e2e8f0;font-size:11.5px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(item.cl_title || item.title || '')}">${escapeHtml(item.cl_title || item.title || '')}</div>
          <div style="color:#94a3b8;font-size:11px;margin-top:2px;">📷 ${photoCount} Shopify photo(s) • ${item.heavy_local_pickup ? '📦 Heavy Local' : '📬 Parcel/Pickup'} • ${mode === 'dealer' ? 'Dealer (fsd/ptd)' : 'Owner (fso/pts)'}</div>
        </div>
      ` : ''}

      <div style="color:${statusColor};font-weight:600;margin-bottom:8px;word-break:break-word;">${escapeHtml(hudState.status)}</div>

      ${hudState.extraHtml || ''}

      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;">
        <button id="ald-btn-auto" style="flex:1;background:${autoOn ? '#166534' : '#475569'};color:#fff;border:none;border-radius:5px;padding:5px 7px;font-size:11px;font-weight:700;cursor:pointer;">
          Auto: ${autoOn ? 'ON' : 'OFF'}
        </button>
        <button id="ald-btn-mode" style="flex:1;background:#1e3a5f;color:#fff;border:1px solid #334155;border-radius:5px;padding:5px 7px;font-size:11px;font-weight:700;cursor:pointer;">
          ${mode === 'dealer' ? 'Dealer (fsd)' : 'Owner (fso)'}
        </button>
      </div>

      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px;">
        ${item ? `
          <button id="ald-btn-mark-next" style="flex:1;background:#ea580c;color:#fff;border:none;border-radius:5px;padding:6px 8px;font-size:11.5px;font-weight:700;cursor:pointer;">✓ Mark Posted &amp; Next</button>
          <button id="ald-btn-skip" style="background:#334155;color:#fff;border:none;border-radius:5px;padding:6px 9px;font-size:11.5px;font-weight:700;cursor:pointer;">⏭ Skip</button>
        ` : `
          <button id="ald-btn-start-queue" style="flex:1;background:#16a34a;color:#fff;border:none;border-radius:5px;padding:6px 8px;font-size:11.5px;font-weight:700;cursor:pointer;">▶ Load Next Unposted SKU</button>
        `}
        <button id="ald-btn-refresh" title="Reload Queue" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:5px;padding:6px 8px;font-size:11.5px;cursor:pointer;">🔄</button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:10px;color:#64748b;">
        <span>Hub: ${escapeHtml(hubOrigin.replace(/^https?:\/\//, ''))}</span>
        <a href="#" id="ald-btn-reset-local" style="color:#94a3b8;text-decoration:underline;">Reset local cache</a>
      </div>
    `;

    document.getElementById('ald-hud-toggle')?.addEventListener('click', () => {
      gmSet(GM_KEYS.HUD_COLLAPSED, true);
      renderHud();
    });

    const applyFilterChange = async () => {
      const nf = document.getElementById('ald-sel-qfilter')?.value || 'all';
      const nv = document.getElementById('ald-sel-vfilter')?.value || '';
      gmSet(GM_KEYS.QUEUE_FILTER, nf);
      gmSet(GM_KEYS.VEHICLE_FILTER, nv);
      setActiveItem(null);
      try {
        updateHud({ status: 'Applying queue filter & loading highest-value unposted SKU...', statusType: 'info' });
        const fresh = await loadQueue(hubOrigin, true);
        const nextMatch = fresh.unpostedItems[0] || null;
        setActiveItem(nextMatch);
        updateHud({
          status: nextMatch
            ? `Filter applied (${fresh.remainingCount} remaining). Ready for ${nextMatch.sku} ($${nextMatch.price_int}).`
            : `No unposted SKUs match this filter (${fresh.postedCount} posted).`,
          statusType: nextMatch ? 'success' : 'warn',
          queueState: fresh,
          activeItem: nextMatch
        });
      } catch (err) {
        updateHud({ status: `Filter reload error: ${err.message}`, statusType: 'error' });
      }
    };
    document.getElementById('ald-sel-qfilter')?.addEventListener('change', applyFilterChange);
    document.getElementById('ald-sel-vfilter')?.addEventListener('change', applyFilterChange);

    document.getElementById('ald-btn-auto')?.addEventListener('click', () => {
      const nextVal = !isAutoAdvanceEnabled();
      gmSet(GM_KEYS.AUTO_ADVANCE, nextVal);
      updateHud({ status: nextVal ? 'Auto-advance enabled.' : 'Auto-advance paused by user.', statusType: 'info' });
    });

    document.getElementById('ald-btn-mode')?.addEventListener('click', () => {
      const nextMode = getPostingMode() === 'dealer' ? 'owner' : 'dealer';
      gmSet(GM_KEYS.POSTING_MODE, nextMode);
      updateHud({
        status: `Switched mode to ${nextMode === 'dealer' ? 'For Sale By Dealer (fsd / ptd)' : 'For Sale By Owner (fso / pts)'}.`,
        statusType: 'info'
      });
    });

    document.getElementById('ald-btn-mark-next')?.addEventListener('click', async () => {
      if (!item) return;
      updateHud({ status: `Marking ${item.sku} posted & loading next unposted SKU...`, statusType: 'warn' });
      await markSkuPostedEverywhere(item.sku, hubOrigin);
      await navigateToNextUnposted(hubOrigin, item.sku);
    });

    document.getElementById('ald-btn-skip')?.addEventListener('click', async () => {
      if (!item) return;
      addSkippedSku(item.sku);
      setActiveItem(null);
      updateHud({ status: `Skipped ${item.sku}. Loading next unposted SKU...`, statusType: 'warn' });
      await navigateToNextUnposted(hubOrigin, item.sku);
    });

    document.getElementById('ald-btn-start-queue')?.addEventListener('click', async () => {
      updateHud({ status: 'Loading next unposted part from Command Hub...', statusType: 'info' });
      await navigateToNextUnposted(hubOrigin);
    });

    document.getElementById('ald-btn-refresh')?.addEventListener('click', async () => {
      try {
        updateHud({ status: 'Refreshing /api/craigslist/queue...', statusType: 'info' });
        const fresh = await loadQueue(hubOrigin, true);
        const cur = await resolveCurrentPart(hubOrigin, fresh);
        updateHud({
          status: `Queue synced: ${fresh.remainingCount} remaining, ${fresh.postedCount} posted.`,
          statusType: 'success',
          queueState: fresh,
          activeItem: cur
        });
      } catch (err) {
        updateHud({ status: `Queue refresh error: ${err.message}`, statusType: 'error' });
      }
    });

    document.getElementById('ald-btn-reset-local')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!window.confirm('Clear local Tampermonkey posted/skipped SKU cache? (Server-side posted status on aldridgeautosupply.com will remain intact.)')) return;
      gmDelete(GM_KEYS.POSTED);
      gmDelete(GM_KEYS.SKIPPED);
      gmDelete(GM_KEYS.ACTIVE);
      gmDelete(GM_KEYS.PENDING_PUBLISH);
      cachedQueueState = null;
      updateHud({ status: 'Local Tampermonkey cache cleared. Reloading queue...', statusType: 'warn' });
      runController().catch(() => {});
    });

    if (typeof hudState.onExtraBind === 'function') {
      try {
        hudState.onExtraBind();
      } catch (_) {}
    }
  }

  // ---------- Image Attachment Pipeline (GM_xmlhttpRequest + DataTransfer) ----------
  async function attachShopifyPhotosToInput(item, hubOrigin, fileInput) {
    let photoUrls = extractCleanPhotoUrls(item, hubOrigin);
    if (!photoUrls.length) {
      const res = await apiGetJson(`${hubOrigin}/api/craigslist/item/${encodeURIComponent(item.sku)}`);
      if (res.ok && res.data) {
        item = { ...item, ...res.data };
        setActiveItem(item);
        photoUrls = extractCleanPhotoUrls(item, hubOrigin);
      }
    }
    if (!photoUrls.length) {
      updateHud({ status: `No clean part photos found for ${item.sku}.`, statusType: 'warn' });
      return { uploaded: 0, done: false };
    }

    const safeSku = String(item.sku || 'ALDRIDGE').replace(/[^a-zA-Z0-9_-]/g, '_');
    const files = [];
    let failedCount = 0;

    // Fetch photos in parallel batches of 3 via GM_xmlhttpRequest
    const concurrency = 3;
    for (let i = 0; i < photoUrls.length; i += concurrency) {
      const batch = photoUrls.slice(i, i + concurrency);
      updateHud({
        status: `Fetching Shopify CDN photos (${Math.min(i + batch.length, photoUrls.length)}/${photoUrls.length}) via GM_xmlhttpRequest...`,
        statusType: 'info'
      });

      const results = await Promise.all(
        batch.map(async (url, offset) => {
          const idx = i + offset;
          try {
            const rawBlob = await fetchImageBlob(url);
            const norm = await normalizeBlobForCraigslist(rawBlob, url);
            return new File([norm.blob], `${safeSku}_${idx + 1}.${norm.ext}`, {
              type: norm.mime,
              lastModified: Date.now()
            });
          } catch (err) {
            failedCount++;
            console.warn(`[Aldridge CL] Photo ${idx + 1} failed (${url}):`, err);
            return null;
          }
        })
      );

      for (const f of results) {
        if (f) files.push(f);
      }
    }

    if (!files.length) {
      updateHud({
        status: `Failed to download Shopify CDN photos for ${item.sku} (${failedCount} failed). Click Re-Attach to retry.`,
        statusType: 'error'
      });
      return { uploaded: 0, done: false };
    }

    // Classic single-file uploader fallback (no multiple attribute)
    if (!fileInput.multiple) {
      const idxKey = `aldridge_cl_classic_img_idx:${item.sku}`;
      const curIdx = Number(sessionStorage.getItem(idxKey) || '0');
      if (curIdx >= files.length) {
        sessionStorage.removeItem(idxKey);
        return { uploaded: files.length, done: true };
      }
      const singleDt = new DataTransfer();
      singleDt.items.add(files[curIdx]);
      fileInput.files = singleDt.files;
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      sessionStorage.setItem(idxKey, String(curIdx + 1));
      updateHud({
        status: `Uploading photo ${curIdx + 1}/${files.length} (classic uploader)...`,
        statusType: 'info'
      });
      const addForm = fileInput.closest('form');
      if (addForm) {
        setTimeout(() => {
          const submitBtn = addForm.querySelector('button[type="submit"], input[type="submit"]');
          if (submitBtn) submitBtn.click();
          else addForm.submit();
        }, 400);
      }
      return { uploaded: curIdx + 1, done: false };
    }

    // Modern multi-file uploader (DataTransfer injection into Craigslist file input)
    const beforeCount = countUploadedThumbnails();
    const dt = new DataTransfer();
    for (const file of files) {
      dt.items.add(file);
    }

    try {
      fileInput.files = dt.files;
    } catch (_) {
      const filesSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
      if (filesSetter) filesSetter.call(fileInput, dt.files);
    }
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    updateHud({
      status: `Injected ${files.length}/${photoUrls.length} Shopify CDN photo(s) into Craigslist uploader — waiting for thumbnails...`,
      statusType: 'info'
    });

    // Wait up to 2.5s to verify Craigslist plupload picked up the files; if not, also dispatch a drop fallback
    await new Promise((r) => setTimeout(r, 2500));
    if (countUploadedThumbnails() === beforeCount && !isImageUploadBusy()) {
      const dropTarget =
        document.querySelector('#uploader, .dropzone, #plupload, form.add, .images') || fileInput.parentElement;
      if (dropTarget) {
        try {
          const dropEvt = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
          dropTarget.dispatchEvent(dropEvt);
        } catch (_) {}
      }
    }

    // Wait for Craigslist AJAX uploads to finish (max 35s)
    const waitStart = Date.now();
    let lastCount = countUploadedThumbnails();
    let stableSince = Date.now();
    while (Date.now() - waitStart < 35000) {
      await new Promise((r) => setTimeout(r, 700));
      const curCount = countUploadedThumbnails();
      const busy = isImageUploadBusy();
      if (curCount !== lastCount) {
        lastCount = curCount;
        stableSince = Date.now();
        updateHud({
          status: `Uploading photos to Craigslist... (${curCount}/${files.length} thumbnails ready)`,
          statusType: 'info'
        });
      }
      if (curCount >= beforeCount + files.length && !busy) {
        break;
      }
      if (curCount > beforeCount && !busy && Date.now() - stableSince >= 3000) {
        break;
      }
    }

    const finalCount = countUploadedThumbnails();
    const uploadedOk = finalCount > beforeCount ? finalCount - beforeCount : files.length;
    updateHud({
      status: `✓ Attached ${uploadedOk}/${photoUrls.length} Shopify CDN photo(s)${failedCount ? ` (${failedCount} skipped)` : ''}!`,
      statusType: 'success'
    });
    return { uploaded: uploadedOk, done: uploadedOk > 0 };
  }

  // ---------- Publish Confirmation Detection ----------
  function detectPublishConfirmation() {
    const host = window.location.hostname.toLowerCase();
    const search = window.location.search.toLowerCase();
    const bodyText = (document.body?.innerText || '').toLowerCase();

    // Never treat login forms as publish confirmation
    if (document.querySelector('input[type="password"]')) return null;

    const confirmPhrases = [
      'thanks for posting with us',
      'your posting can be seen at',
      'view your post',
      'has been published',
      'posting has been published',
      'further action is required to publish',
      'check your email for a link to publish',
      'manage your post'
    ];
    const hasConfirmText = confirmPhrases.some((p) => bodyText.includes(p));
    const hasConfirmQuery =
      search.includes('s=redirect') ||
      search.includes('s=finish') ||
      search.includes('s=mailoop') ||
      search.includes('s=posted');

    const pending = gmGet(GM_KEYS.PENDING_PUBLISH, null);
    const recentPending = pending && pending.sku && Date.now() - Number(pending.clickedAt || 0) < 120000;

    // On accounts.craigslist.org after clicking Publish
    const accountsPostPublish =
      host === 'accounts.craigslist.org' &&
      recentPending &&
      (hasConfirmText || bodyText.includes('active') || window.location.pathname.includes('/login/home'));

    if (!hasConfirmText && !hasConfirmQuery && !accountsPostPublish) {
      return null;
    }

    // Try to extract published CL listing URL & 10-digit Post ID
    const liveLink = Array.from(document.querySelectorAll('a[href]')).find((a) =>
      /^https?:\/\/[a-z0-9-]+\.craigslist\.org\/.+\/\d{8,12}\.html/i.test(a.href)
    );
    const liveUrl = liveLink ? liveLink.href : null;
    const idMatch = (liveUrl || bodyText).match(/\b(\d{10})\b/);
    const postId = idMatch ? idMatch[1] : null;

    return {
      sku: (pending && pending.sku) || getActiveItem()?.sku || null,
      url: liveUrl,
      postId
    };
  }

  let autoNextCountdownTimer = null;

  async function handlePublishConfirmed(confirmInfo, hubOrigin) {
    const sku = confirmInfo.sku;
    if (!sku) return;

    updateHud({
      status: `✅ Publish detected for ${sku}! Saving to Tampermonkey & Command Hub...`,
      statusType: 'success'
    });

    await markSkuPostedEverywhere(sku, hubOrigin, {
      url: confirmInfo.url,
      postId: confirmInfo.postId
    });

    const freshQueue = await loadQueue(hubOrigin, true);
    const nextItem = freshQueue.unpostedItems.find((q) => q.sku !== sku) || null;

    if (!nextItem) {
      updateHud({
        status: `🎉 Published ${sku}! Queue complete (${freshQueue.postedCount}/${freshQueue.totalCount} posted).`,
        statusType: 'success',
        queueState: freshQueue,
        activeItem: null,
        extraHtml: ''
      });
      return;
    }

    setActiveItem(nextItem);
    let secs = 3;

    const launchNow = () => {
      if (autoNextCountdownTimer) clearInterval(autoNextCountdownTimer);
      window.location.href = buildLaunchUrl(nextItem.sku, hubOrigin);
    };

    const renderCountdown = () => {
      updateHud({
        status: `✅ ${sku} marked posted! Auto-loading next unposted SKU ${nextItem.sku} ($${nextItem.price_int}) in ${secs}s...`,
        statusType: 'success',
        queueState: freshQueue,
        activeItem: nextItem,
        extraHtml: `
          <div style="display:flex;gap:6px;margin-bottom:6px;">
            <button id="ald-btn-next-now" style="flex:1;background:#16a34a;color:#fff;border:none;border-radius:5px;padding:6px 8px;font-size:11.5px;font-weight:700;cursor:pointer;">▶ Load ${escapeHtml(nextItem.sku)} Now</button>
            <button id="ald-btn-stop-next" style="background:#991b1b;color:#fff;border:none;border-radius:5px;padding:6px 9px;font-size:11.5px;font-weight:700;cursor:pointer;">⏸ Stop</button>
          </div>
        `,
        onExtraBind: () => {
          document.getElementById('ald-btn-next-now')?.addEventListener('click', launchNow);
          document.getElementById('ald-btn-stop-next')?.addEventListener('click', () => {
            if (autoNextCountdownTimer) clearInterval(autoNextCountdownTimer);
            autoNextCountdownTimer = null;
            updateHud({
              status: `Paused auto-next. Ready for ${nextItem.sku} whenever you click Load Next.`,
              statusType: 'warn',
              extraHtml: ''
            });
          });
        }
      });
    };

    renderCountdown();
    if (isAutoAdvanceEnabled()) {
      autoNextCountdownTimer = setInterval(() => {
        secs -= 1;
        if (secs <= 0) {
          launchNow();
        } else {
          renderCountdown();
        }
      }, 1000);
    }
  }

  // ---------- Main Craigslist Step Router ----------
  async function runController() {
    const hashParams = parseHashParams();
    if (hashParams.hub && /^https?:\/\//i.test(hashParams.hub)) {
      gmSet(GM_KEYS.HUB, hashParams.hub);
    }
    const hubOrigin = getHubOrigin();
    const host = window.location.hostname.toLowerCase();

    // Check publish confirmation FIRST (handles both post.craigslist.org & accounts.craigslist.org)
    const confirmInfo = detectPublishConfirmation();
    if (confirmInfo && confirmInfo.sku) {
      await handlePublishConfirmed(confirmInfo, hubOrigin);
      return;
    }

    // On accounts.craigslist.org dashboard (when logged in): scan for SOLD + non-Top-200 overflow ads & offer 1-click delete
    if (host === 'accounts.craigslist.org') {
      if (document.querySelector('input[type="password"]')) return;
      const postingRows = Array.from(document.querySelectorAll('table.accthp_postings tbody tr, tr.posting-row'));
      if (!postingRows.length) return;
      try {
        const planRes = await apiGetJson(`${hubOrigin}/api/deployment/top200`);
        if (!planRes.ok || !planRes.data) return;
        const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40);
        const soldSkus = new Set((planRes.data.sold_skus || []).map((s) => String(s).toUpperCase()));
        const soldTitles = new Set((planRes.data.sold_items || []).map((x) => normKey(x.title)).filter((t) => t.length >= 16));
        const overflowTitles = new Set((planRes.data.overflow || []).map((x) => normKey(x.title)).filter((t) => t.length >= 16));
        const overflowSkus = new Set((planRes.data.overflow_skus || []).map((s) => String(s).toUpperCase()));
        const soldRows = [];
        const overflowRows = [];
        for (const tr of postingRows) {
          const rowTxt = (tr.innerText || '').trim();
          const upperTxt = rowTxt.toUpperCase();
          const normRow = rowTxt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          const delBtn = tr.querySelector('form[action*="delete"] input[type="submit"], form[action*="delete"] button, input[value="delete"], button[value="delete"]');
          if (!delBtn) continue;

          const isSold =
            Array.from(soldSkus).some((sku) => upperTxt.includes(sku)) ||
            Array.from(soldTitles).some((t) => normRow.includes(t));
          if (isSold) {
            tr.style.outline = '3px solid #dc2626';
            tr.style.backgroundColor = 'rgba(220,38,38,0.14)';
            soldRows.push({ tr, delBtn, kind: 'SOLD' });
            continue;
          }

          const isOverflow =
            Array.from(overflowSkus).some((sku) => upperTxt.includes(sku)) ||
            Array.from(overflowTitles).some((t) => normRow.includes(t));
          if (isOverflow) {
            tr.style.outline = '2px solid #ea580c';
            tr.style.backgroundColor = 'rgba(234,88,12,0.09)';
            overflowRows.push({ tr, delBtn, kind: 'OVERFLOW' });
          }
        }
        const orderedTargets = [...soldRows, ...overflowRows];
        updateHud({
          status: orderedTargets.length
            ? `Found ${soldRows.length} SOLD (red) + ${overflowRows.length} Overflow (orange) ad(s) on your CL dashboard.`
            : `✅ Craigslist dashboard clean — 0 SOLD or non-Top-200 overflow ads detected.`,
          statusType: orderedTargets.length ? 'warn' : 'success',
          extraHtml: orderedTargets.length
            ? `<button id="ald-btn-cl-del-overflow" style="width:100%;background:#dc2626;color:#fff;border:none;border-radius:6px;padding:7px 10px;font-size:12px;font-weight:800;cursor:pointer;margin-bottom:6px;">🗑 Delete Next ${orderedTargets[0].kind} Ad (${orderedTargets.length} total)</button>`
            : '',
          onExtraBind: () => {
            document.getElementById('ald-btn-cl-del-overflow')?.addEventListener('click', () => {
              if (!orderedTargets.length) return;
              const next = orderedTargets[0];
              if (!window.confirm(`Delete highlighted ${next.kind} ad from Craigslist? (${soldRows.length} sold, ${overflowRows.length} overflow found)`)) return;
              next.delBtn.click();
            });
          }
        });
      } catch (_) {}
      return;
    }

    // Load live queue from Hub
    let queueState = null;
    try {
      queueState = await loadQueue(hubOrigin, false);
    } catch (err) {
      updateHud({
        status: `Could not reach ${hubOrigin}/api/craigslist/queue: ${err.message}`,
        statusType: 'error'
      });
      return;
    }

    const activeItem = await resolveCurrentPart(hubOrigin, queueState);

    // Landing on seattle.craigslist.org: show non-intrusive HUD with Start button
    if (host === 'seattle.craigslist.org') {
      updateHud({
        status: activeItem
          ? `Ready! Click "Start Auto-Post Queue" to post ${activeItem.sku} ($${activeItem.price_int}).`
          : `All ${queueState.totalCount} active SKUs are already posted!`,
        statusType: activeItem ? 'info' : 'success',
        queueState,
        activeItem,
        extraHtml: activeItem
          ? `<button id="ald-btn-seattle-go" style="width:100%;background:#16a34a;color:#fff;border:none;border-radius:6px;padding:7px 10px;font-size:12px;font-weight:800;cursor:pointer;margin-bottom:6px;">▶ Start Auto-Post Queue (${escapeHtml(activeItem.sku)})</button>`
          : '',
        onExtraBind: () => {
          document.getElementById('ald-btn-seattle-go')?.addEventListener('click', () => {
            if (activeItem) {
              setActiveItem(activeItem);
              window.location.href = buildLaunchUrl(activeItem.sku, hubOrigin);
            }
          });
        }
      });
      return;
    }

    // From here on we are on post.craigslist.org
    updateHud({
      status: activeItem ? `Active SKU: ${activeItem.sku}` : 'No unposted SKUs remaining in queue!',
      statusType: activeItem ? 'info' : 'success',
      queueState,
      activeItem
    });

    if (!activeItem) return;

    // Pause cleanly on CAPTCHA or billing/payment screens
    if (hasCaptchaChallenge()) {
      updateHud({
        status: '⏸ Human verification / CAPTCHA detected — please complete it and click Continue.',
        statusType: 'warn'
      });
      return;
    }
    if (hasBillingOrPaymentScreen()) {
      updateHud({
        status: '⏸ Payment / Billing screen detected — review & complete checkout manually.',
        statusType: 'warn'
      });
      return;
    }

    const autoOn = isAutoAdvanceEnabled();
    const mode = getPostingMode();

    // ----- STEP 0: Area / Site Picker (post.craigslist.org root -> seattle-tacoma) -----
    const areaSelect = document.querySelector('select[name="areaabb"], select[name="n"]');
    if (areaSelect && !document.querySelector('input[name="PostingTitle"]')) {
      const seaOpt = Array.from(areaSelect.options).find(
        (o) => o.value === 'sea' || /seattle.?tacoma/i.test(o.text)
      );
      if (seaOpt && autoOn && !hasStepRunOnThisUrl('area_sea')) {
        markStepRunOnThisUrl('area_sea');
        updateHud({ status: 'Auto-selecting Seattle-Tacoma (sea)...', statusType: 'info' });
        setNativeValue(areaSelect, seaOpt.value);
        setTimeout(() => {
          const btn = findSubmitButton(areaSelect.closest('form'));
          if (btn) btn.click();
          else areaSelect.closest('form')?.submit();
        }, 350);
        return;
      }
    }

    // ----- STEP 1: Subarea Picker (Seattle-Tacoma -> Tacoma / Pierce County = tac) -----
    const subareaRadios = Array.from(document.querySelectorAll('input[type="radio"][name="n"]'));
    if (subareaRadios.length > 0) {
      const tacRadio = subareaRadios.find((r) => {
        const lbl = getRadioLabelText(r);
        return r.value === 'tac' || /\btacoma\b|pierce/i.test(lbl);
      });
      if (tacRadio) {
        if (autoOn) {
          updateHud({ status: 'Auto-advancing: Tacoma / Pierce County (tac)...', statusType: 'info' });
          selectRadioAndSubmit(tacRadio, 'subarea_tac');
        } else {
          tacRadio.checked = true;
          updateHud({ status: 'Selected Tacoma / Pierce County (Auto-Advance paused).', statusType: 'warn' });
        }
        return;
      }
    }

    // ----- STEP 2 & 3: Posting Type (For Sale By Dealer = fsd) & Category (Auto Parts = ptd) -----
    const idRadios = Array.from(document.querySelectorAll('input[type="radio"][name="id"]'));
    if (idRadios.length > 0) {
      // 2a. Posting Type screen ("for sale by dealer" / fsd — or "for sale by owner" / fso)
      const wantDealer = mode === 'dealer';
      const typeRadio = idRadios.find((r) => {
        const lbl = getRadioLabelText(r);
        if (wantDealer) {
          return r.value === 'fsd' || /\bfor sale by dealer\b/i.test(lbl);
        }
        return r.value === 'fso' || /\bfor sale by owner\b/i.test(lbl);
      });
      if (typeRadio) {
        const labelStr = wantDealer ? 'For Sale By Dealer (fsd)' : 'For Sale By Owner (fso)';
        if (autoOn) {
          updateHud({ status: `Auto-advancing: ${labelStr}...`, statusType: 'info' });
          selectRadioAndSubmit(typeRadio, `type_${wantDealer ? 'fsd' : 'fso'}`);
        } else {
          typeRadio.checked = true;
          updateHud({ status: `Selected ${labelStr} (Auto-Advance paused).`, statusType: 'warn' });
        }
        return;
      }

      // 2b. Category screen ("auto parts - by dealer" / ptd / 156 — excluding wheels/tires/motorcycle/boat/rv/heavy/aviation)
      const excludeCatRegex = /wheel|tire|motorcycle|boat|rv|camp|trailer|heavy|aviation|aircraft|farm|bicycle|car\s*&\s*truck/i;
      const catRadio =
        idRadios.find((r) => {
          const lbl = getRadioLabelText(r);
          if (excludeCatRegex.test(lbl)) return false;
          if (wantDealer) {
            return r.value === '156' || r.value === 'ptd' || /\bauto parts\b.*by dealer/i.test(lbl);
          }
          return r.value === '122' || r.value === 'pts' || /\bauto parts\b.*by owner/i.test(lbl);
        }) ||
        idRadios.find((r) => {
          const lbl = getRadioLabelText(r);
          return !excludeCatRegex.test(lbl) && /^\s*auto parts\b/i.test(lbl);
        });

      if (catRadio) {
        const catLabel = wantDealer ? 'Auto Parts - By Dealer (ptd)' : 'Auto Parts - By Owner (pts)';
        if (autoOn) {
          updateHud({ status: `Auto-advancing: ${catLabel}...`, statusType: 'info' });
          selectRadioAndSubmit(catRadio, `cat_${wantDealer ? 'ptd' : 'pts'}`);
        } else {
          catRadio.checked = true;
          updateHud({ status: `Selected ${catLabel} (Auto-Advance paused).`, statusType: 'warn' });
        }
        return;
      }
    }

    // ----- STEP 3b: Optional Neighborhood / Sub-location Picker -----
    const locRadios = Array.from(document.querySelectorAll('input[type="radio"][name="nh"], input[type="radio"][name="subarea"]'));
    if (locRadios.length > 0 && !document.querySelector('input[name="PostingTitle"]')) {
      const upRadio =
        locRadios.find((r) => /university place|tacoma/i.test(getRadioLabelText(r))) || locRadios[0];
      if (upRadio && autoOn) {
        updateHud({ status: 'Auto-advancing: University Place / Tacoma neighborhood...', statusType: 'info' });
        selectRadioAndSubmit(upRadio, 'neighborhood');
        return;
      }
    }

    // ----- STEP 4: Main Listing Edit Form -----
    const titleInput = document.querySelector('input[name="PostingTitle"]');
    const bodyInput = document.querySelector('textarea[name="PostingBody"]');
    if (titleInput && bodyInput) {
      const validationErrors = getVisibleValidationErrors();
      if (validationErrors.length > 0) {
        updateHud({
          status: `⚠ Craigslist form validation note: ${validationErrors[0]}`,
          statusType: 'warn'
        });
      }

      if (!titleInput.dataset.aldridgeFilled) {
        titleInput.dataset.aldridgeFilled = '1';
        updateHud({ status: `Verifying live stock & filling all fields for ${activeItem.sku}...`, statusType: 'info' });

        // Live 410 sold-SKU verification + merge with queue item
        let item = { ...activeItem };
        try {
          const liveRes = await apiGetJson(`${hubOrigin}/api/craigslist/item/${encodeURIComponent(activeItem.sku)}`);
          if (liveRes.status === 410 || liveRes.data?.sold) {
            addSkippedSku(activeItem.sku);
            setActiveItem(null);
            updateHud({
              status: `⛔ ${activeItem.sku} was SOLD / delisted (qty=0). Auto-loading next unposted SKU...`,
              statusType: 'error'
            });
            setTimeout(() => navigateToNextUnposted(hubOrigin, activeItem.sku), 2000);
            return;
          }
          if (liveRes.ok && liveRes.data) {
            item = { ...item, ...liveRes.data };
            setActiveItem(item);
          }
        } catch (err) {
          console.warn('[Aldridge CL] Using /api/craigslist/queue payload directly:', err.message);
        }

        const clTitle = (item.cl_title || `${item.title || item.sku} (OEM Tested — Tacoma)`).slice(0, 70);
        const priceInt = item.price_int || Math.max(1, Math.round(Number(item.price || 0)));
        const zipCode = item.zip || '98467';
        const geoArea = item.geographic_area || 'University Place / Tacoma WA 98467';
        const clBody = item.cl_body || item.title || '';

        setNativeValue(titleInput, clTitle);
        setNativeValue(document.querySelector('input[name="price"]'), priceInt);
        setNativeValue(document.querySelector('input[name="GeographicArea"]'), geoArea);
        setNativeValue(document.querySelector('input[name="postal"]'), zipCode);
        setNativeValue(bodyInput, clBody);

        // Posting Details (Make/Manufacturer, Model/MPN, Fitment, Condition, Language)
        setNativeValue(document.querySelector('input[name="sale_manufacturer"]'), item.brand || 'OEM');
        setNativeValue(document.querySelector('input[name="sale_model"]'), item.mpn_or_fitment || item.mpn || item.ymm || '');
        setNativeValue(document.querySelector('input[name="auto_make_model"]'), item.ymm || '');

        const condSelect = document.querySelector('select[name="condition"]');
        if (condSelect) {
          const wantNew = String(item.condition || '').toLowerCase() === 'new';
          const opt =
            Array.from(condSelect.options).find((o) =>
              wantNew ? /^new$/i.test(o.text.trim()) : /^good$/i.test(o.text.trim())
            ) ||
            Array.from(condSelect.options).find((o) =>
              wantNew ? /new/i.test(o.text) : /good|excellent/i.test(o.text)
            );
          if (opt) {
            setNativeValue(condSelect, opt.value);
            // Sync jQuery UI selectmenu label if Craigslist uses it
            const uiBtnText = condSelect.parentElement?.querySelector('.ui-selectmenu-text');
            if (uiBtnText) uiBtnText.textContent = opt.text;
          }
        }

        const langSelect = document.querySelector('select[name="language"]');
        if (langSelect && !langSelect.value) {
          const engOpt = Array.from(langSelect.options).find((o) => /english/i.test(o.text));
          if (engOpt) {
            setNativeValue(langSelect, engOpt.value);
            const uiLangText = langSelect.parentElement?.querySelector('.ui-selectmenu-text');
            if (uiLangText) uiLangText.textContent = engOpt.text;
          }
        }

        // Location / Map fields
        setNativeValue(document.querySelector('input[name="xstreet0"]'), item.street || '5115 66th St W, Bldg B');
        setNativeValue(document.querySelector('input[name="xstreet1"]'), item.cross_street || 'Bridgeport Way W');
        setNativeValue(document.querySelector('input[name="city"]'), item.city || 'University Place');

        // Contact info (never overwrite already-filled account email)
        const emailInput = document.querySelector('input[name="FromEMail"]');
        if (emailInput && !emailInput.value.trim()) {
          setNativeValue(emailInput, item.email || 'service@aldridgeautosupply.com');
        }
        const contactNameInput = document.querySelector('input[name="contact_name"]');
        if (contactNameInput) {
          setNativeValue(contactNameInput, item.contact_name || "Aldridge Auto's");
        }
        const phoneInput = document.querySelector('input[name="contact_phone"]');
        if (phoneInput && (item.phone || !phoneInput.value.trim())) {
          setNativeValue(phoneInput, item.phone || '(253) 245-4206');
        }
        setCheckbox(document.querySelector('input[name="contact_phone_ok"]'), true);
        setCheckbox(document.querySelector('input[name="contact_text_ok"]'), true);
        setCheckbox(document.querySelector('input[name="show_more_ads"], input[name="see_my_other"]'), true);

        const privacyRadios = Array.from(document.querySelectorAll('input[type="radio"][name="Privacy"]'));
        if (privacyRadios.length > 0 && !privacyRadios.some((r) => r.checked)) {
          const relay = privacyRadios.find((r) => r.value === 'C') || privacyRadios[0];
          if (relay) relay.click();
        }

        const photoCount = extractCleanPhotoUrls(item, hubOrigin).length;
        updateHud({
          status:
            autoOn && validationErrors.length === 0
              ? `✓ Filled all fields for ${item.sku} ($${priceInt}, ${photoCount} photos queued). Continuing to Map/Photos...`
              : `✓ Filled all fields for ${item.sku} ($${priceInt}). Click "Continue" to attach ${photoCount} Shopify photos.`,
          statusType: 'success',
          activeItem: item
        });

        if (autoOn && validationErrors.length === 0 && !hasStepRunOnThisUrl('edit_submit')) {
          markStepRunOnThisUrl('edit_submit');
          setTimeout(() => {
            if (!isAutoAdvanceEnabled() || hasCaptchaChallenge() || getVisibleValidationErrors().length > 0) return;
            const form = titleInput.closest('form');
            const btn = findSubmitButton(form, /continue/i);
            if (btn) btn.click();
          }, 1100);
        }
      }
      return;
    }

    // ----- STEP 5: Map / Geoverify Confirmation Screen -----
    const isGeoVerify =
      window.location.search.includes('s=geoverify') ||
      Boolean(document.querySelector('#leafletForm, #map.leaflet-container'));
    if (isGeoVerify) {
      updateHud({
        status: autoOn
          ? 'Auto-advancing: Confirming University Place / Tacoma 98467 map pin...'
          : 'Map pin screen ready — click Continue to attach photos.',
        statusType: 'info'
      });
      if (autoOn && !hasStepRunOnThisUrl('geoverify')) {
        markStepRunOnThisUrl('geoverify');
        setTimeout(() => {
          if (!isAutoAdvanceEnabled() || hasCaptchaChallenge()) return;
          const form = document.querySelector('#leafletForm') || document.querySelector('form');
          const btn = findSubmitButton(form, /continue/i);
          if (btn) btn.click();
        }, 700);
      }
      return;
    }

    // ----- STEP 6: Image Upload Screen (GM_xmlhttpRequest + DataTransfer) -----
    const isImagePage =
      window.location.search.includes('s=editimage') ||
      Boolean(document.querySelector('#uploader, #plupload, .images, input[type="file"]'));
    if (isImagePage) {
      updateHud({
        status: `Waiting for Craigslist uploader input to attach ${activeItem.sku} Shopify CDN photos...`,
        statusType: 'info',
        extraHtml: `<button id="ald-btn-reattach" style="width:100%;background:#0284c7;color:#fff;border:none;border-radius:5px;padding:6px 8px;font-size:11.5px;font-weight:700;cursor:pointer;margin-bottom:6px;">📷 Re-Attach Shopify CDN Photos</button>`,
        onExtraBind: () => {
          document.getElementById('ald-btn-reattach')?.addEventListener('click', async () => {
            const inp = findBestFileInput();
            if (!inp) {
              updateHud({ status: 'File input not found on page.', statusType: 'error' });
              return;
            }
            await attachShopifyPhotosToInput(activeItem, hubOrigin, inp);
          });
        }
      });

      const fileInput = await waitForElement(findBestFileInput, 10000, 250);
      if (fileInput && !fileInput.dataset.aldridgeUploaded) {
        fileInput.dataset.aldridgeUploaded = '1';
        const uploadRes = await attachShopifyPhotosToInput(activeItem, hubOrigin, fileInput);
        if (uploadRes.done && uploadRes.uploaded > 0 && isAutoAdvanceEnabled() && !hasStepRunOnThisUrl('images_done')) {
          markStepRunOnThisUrl('images_done');
          updateHud({
            status: `✓ Uploaded ${uploadRes.uploaded} Shopify CDN photo(s)! Auto-advancing to Preview...`,
            statusType: 'success'
          });
          setTimeout(() => {
            if (!isAutoAdvanceEnabled() || hasCaptchaChallenge()) return;
            const doneBtn = findSubmitButton(document, /done with images/i);
            if (doneBtn) doneBtn.click();
          }, 900);
        }
      } else if (!fileInput) {
        updateHud({
          status: 'Could not detect Craigslist file upload input. Click "use classic uploader" or Re-Attach.',
          statusType: 'warn'
        });
      }
      return;
    }

    // ----- STEP 7: Draft Preview / Publish Screen -----
    const publishButtons = Array.from(document.querySelectorAll('button, input[type="submit"]')).filter((b) =>
      /\bpublish\b/i.test((b.innerText || b.value || '').trim())
    );
    const isPreviewPage = window.location.search.includes('s=preview') || publishButtons.length > 0;
    if (isPreviewPage) {
      for (const btn of publishButtons) {
        if (btn.dataset.aldridgePublishHooked) continue;
        btn.dataset.aldridgePublishHooked = '1';
        btn.addEventListener('click', () => {
          gmSet(GM_KEYS.PENDING_PUBLISH, {
            sku: activeItem.sku,
            clickedAt: Date.now()
          });
        });
      }

      updateHud({
        status: `✅ Ready to Publish ${activeItem.sku}! Review & click "Publish" — next unposted SKU will auto-load after publish.`,
        statusType: 'success'
      });
    }
  }

  // Run on page idle + hash changes
  setTimeout(() => {
    runController().catch((err) => {
      console.error('[Aldridge CL Auto-Poster]', err);
      updateHud({ status: `Error: ${err.message || err}`, statusType: 'error' });
    });
  }, 400);

  window.addEventListener('hashchange', () => {
    runController().catch((err) => console.error('[Aldridge CL Auto-Poster]', err));
  });
})();
