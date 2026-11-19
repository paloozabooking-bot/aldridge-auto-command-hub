// ==UserScript==
// @name         Aldridge Auto's — Craigslist Tacoma Auto Parts ($0 pts) Bulk Auto-Filler
// @namespace    https://aldridgeautosupply.com/
// @version      1.0.2
// @description  Automatically selects Tacoma/Pierce County -> For Sale By Owner -> Auto Parts ($0 fee, ZIP 98467), fills Title, Price, Condition, OEM Make/Model/MPN, Description, and attaches clean part photos from Aldridge Command Hub!
// @match        https://post.craigslist.org/*
// @match        https://seattle.craigslist.org/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'aldridge_cl_active_payload_v1';

  // Capture SKU & Hub Origin from URL hash (#aldridge_sku=ALD-...&hub=https://...)
  const hashStr = window.location.hash ? window.location.hash.slice(1) : '';
  if (hashStr.includes('aldridge_sku=')) {
    const hp = new URLSearchParams(hashStr);
    const sku = hp.get('aldridge_sku');
    const hub = hp.get('hub');
    if (sku && hub) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sku, hub, step: 'init' }));
    }
  }

  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
  } catch (_) {
    saved = null;
  }
  if (!saved || !saved.sku || !saved.hub) return;

  function showBanner(msg, extraBtnHtml = '') {
    let bar = document.getElementById('aldridge-cl-helper-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'aldridge-cl-helper-bar';
      bar.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:999999;background:#0b1628;color:#fff;border:2px solid #ea580c;border-radius:8px;padding:12px 16px;font-family:Arial,sans-serif;font-size:13px;max-width:380px;box-shadow:0 8px 24px rgba(0,0,0,0.35);';
      document.body.appendChild(bar);
    }
    bar.innerHTML = `<div style="font-weight:800;color:#fbbf24;margin-bottom:4px;">⚡ Aldridge Craigslist Auto-Filler (${saved.sku})</div><div>${msg}</div>${extraBtnHtml}`;
  }

  function setNativeValue(el, val) {
    if (!el || val === undefined || val === null) return;
    el.focus();
    el.value = String(val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function runStep() {
    // 1. Subarea Picker (Seattle -> Tacoma / Pierce County = 'tac' or value '5')
    const subareaRadios = Array.from(document.querySelectorAll('input[type="radio"][name="n"]'));
    if (subareaRadios.length > 0 && document.body.innerText.toLowerCase().includes('tacoma')) {
      const tacRadio = subareaRadios.find((r) => {
        const lbl = (r.closest('label')?.innerText || '').toLowerCase();
        return lbl.includes('tacoma');
      });
      if (tacRadio) {
        showBanner('Selecting Tacoma / Pierce County...');
        tacRadio.click();
        tacRadio.closest('form')?.querySelector('button[type="submit"], button.pickbutton')?.click();
        return;
      }
    }

    // 2. Posting Type Picker -> "for sale by owner" ('fso')
    const typeRadios = Array.from(document.querySelectorAll('input[type="radio"][name="id"]'));
    if (typeRadios.length > 0) {
      const fsoRadio = typeRadios.find((r) => r.value === 'fso' || (r.closest('label')?.innerText || '').toLowerCase().includes('for sale by owner'));
      if (fsoRadio) {
        showBanner('Selecting For Sale By Owner ($0 Auto Parts)...');
        fsoRadio.click();
        fsoRadio.closest('form')?.querySelector('button[type="submit"], button.pickbutton')?.click();
        return;
      }

      // 3. Category Picker -> "auto parts - by owner" (value '122' or label 'auto parts')
      const ptsRadio = typeRadios.find((r) => r.value === '122' || (r.closest('label')?.innerText || '').toLowerCase().includes('auto parts'));
      if (ptsRadio) {
        showBanner('Selecting Auto Parts - By Owner (pts — $0 Fee)...');
        ptsRadio.click();
        ptsRadio.closest('form')?.querySelector('button[type="submit"], button.pickbutton')?.click();
        return;
      }
    }

    // 4. Main Listing Form (Title, Price, ZIP 98467, Description, Condition, OEM Make/MPN)
    const titleInput = document.querySelector('input[name="PostingTitle"]');
    const bodyInput = document.querySelector('textarea[name="PostingBody"]');
    if (titleInput && bodyInput && !titleInput.dataset.aldridgeFilled) {
      titleInput.dataset.aldridgeFilled = '1';
      showBanner('Fetching SKU specs & clean photos from Command Hub...');
      const res = await fetch(`${saved.hub}/api/craigslist/item/${encodeURIComponent(saved.sku)}`);
      if (res.status === 410) {
        sessionStorage.removeItem(STORAGE_KEY);
        showBanner(`⛔ STOP: ${saved.sku} was SOLD / auto-delisted via Shopify webhook (qty=0). Do NOT post this item.`);
        return;
      }
      if (!res.ok) {
        showBanner(`Could not load ${saved.sku} from Hub (HTTP ${res.status}).`);
        return;
      }
      const item = await res.json();
      if (item.sold) {
        sessionStorage.removeItem(STORAGE_KEY);
        showBanner(`⛔ STOP: ${saved.sku} is marked SOLD (qty=0). Do NOT post.`);
        return;
      }
      saved.item = item;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));

      setNativeValue(titleInput, item.cl_title);
      setNativeValue(document.querySelector('input[name="price"]'), item.price_int);
      setNativeValue(document.querySelector('input[name="postal"]'), item.zip || '98467');
      setNativeValue(document.querySelector('input[name="GeographicArea"]'), 'University Place / Tacoma WA 98467');
      setNativeValue(bodyInput, item.cl_body);
      setNativeValue(document.querySelector('input[name="sale_manufacturer"]'), item.brand || 'OEM');
      setNativeValue(document.querySelector('input[name="sale_model"]'), item.mpn_or_fitment || '');
      setNativeValue(document.querySelector('input[name="auto_make_model"]'), item.ymm || '');

      // Condition dropdown (Craigslist 'good' = 40 / 'excellent' = 30)
      const condSelect = document.querySelector('select[name="condition"]');
      if (condSelect) {
        const goodOpt = Array.from(condSelect.options).find((o) => /good|excellent/i.test(o.text));
        if (goodOpt) setNativeValue(condSelect, goodOpt.value);
      }

      showBanner('✓ Auto-filled Title, Price, ZIP 98467 ($0 pts), Specs & Description! Click "Continue" below to auto-attach clean non-QR part photos.');
      return;
    }

    // 5. Image Upload Step (<input type="file" name="file" multiple>)
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput && !fileInput.dataset.aldridgeUploaded) {
      fileInput.dataset.aldridgeUploaded = '1';
      let item = saved.item;
      if (!item) {
        const res = await fetch(`${saved.hub}/api/craigslist/item/${encodeURIComponent(saved.sku)}`);
        if (res.ok) item = await res.json();
      }
      if (item && Array.isArray(item.photo_data_urls) && item.photo_data_urls.length > 0) {
        showBanner(`Attaching ${item.photo_data_urls.length} clean high-res part photo(s) (QR cards excluded)...`);
        const dt = new DataTransfer();
        for (let i = 0; i < item.photo_data_urls.length; i++) {
          const resp = await fetch(item.photo_data_urls[i]);
          const blob = await resp.blob();
          const ext = blob.type.includes('png') ? 'png' : 'jpg';
          dt.items.add(new File([blob], `${saved.sku}.${i + 1}.${ext}`, { type: blob.type || 'image/jpeg' }));
        }
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        showBanner(
          `✓ Attached ${dt.files.length} clean photo(s)! Click "Done with Images" -> "Publish" on Craigslist.`,
          `<button id="aldridge-mark-cl-posted" style="margin-top:8px;background:#ea580c;color:#fff;border:none;padding:6px 10px;border-radius:5px;font-weight:700;cursor:pointer;width:100%;">✓ Mark ${saved.sku} Posted in Hub</button>`
        );
        document.getElementById('aldridge-mark-cl-posted')?.addEventListener('click', async () => {
          await fetch(`${saved.hub}/api/craigslist/mark-posted`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sku: saved.sku })
          });
          sessionStorage.removeItem(STORAGE_KEY);
          let nextBtn = '';
          try {
            const qRes = await fetch(`${saved.hub}/api/craigslist/queue`);
            if (qRes.ok) {
              const qData = await qRes.json();
              const nextItem = (qData.queue || []).find((q) => !q.posted_craigslist && q.sku !== saved.sku);
              if (nextItem) {
                nextBtn = `<a href="${nextItem.launch_url}" style="display:block;margin-top:8px;background:#16a34a;color:#fff;text-decoration:none;text-align:center;padding:7px 10px;border-radius:5px;font-weight:700;">➡ Next Unposted SKU: ${nextItem.sku} ($${nextItem.price})</a>`;
              }
            }
          } catch (_) {}
          showBanner(`✓ Marked ${saved.sku} posted in Command Hub (Tacoma pts • $0 • ZIP 98467)!`, nextBtn);
        });
      }
    }
  }

  setTimeout(() => {
    runStep().catch((err) => console.warn('[Aldridge CL Helper]', err));
  }, 550);
})();
