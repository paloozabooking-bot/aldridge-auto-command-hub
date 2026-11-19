#!/usr/bin/env node
/**
 * Staged Shopify Clean-Catalog Updater (DO NOT RUN WITHOUT USER CONFIRMATION)
 *
 * When executed with SHOPIFY_ADMIN_TOKEN:
 * 1. Updates all 57 verified photographed on-hand SKUs (ALD-OH-001..057) on aldridgesales.myshopify.com
 *    to strictly ONE variant ("Default Title", qty 1), moving Certified Shop Installation pricing
 *    and direct Website / Mobile PWA install links into body_html.
 * 2. Archives (status='draft') or deletes (--purge-photoless) any photo-less 2-variant legacy products.
 */
const path = require('node:path');
const { db, DATA_DIR, getSettings } = require('../src/db');
const { renderShopifyHtml, hasRealPhotos } = require('../src/exporters');
const { isQrCardUrl, generatePartQrCardPng } = require('../src/qr-card');

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

async function shopifyReq(domain, token, method, endpoint, body = null) {
  const res = await fetch(`https://${domain}/admin/api/2024-10${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify ${method} ${endpoint} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function main() {
  const settings = getSettings();
  const domain = (process.env.SHOPIFY_DOMAIN || settings.shopify_domain || 'aldridgesales.myshopify.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const token = (process.env.SHOPIFY_ADMIN_TOKEN || settings.shopify_admin_token || '').trim();
  const purgePhotoless = process.argv.includes('--purge-photoless');
  const dryRun = !process.argv.includes('--execute');

  if (!token && !dryRun) {
    console.error('Missing SHOPIFY_ADMIN_TOKEN. Pass SHOPIFY_ADMIN_TOKEN=shpat_... --execute');
    process.exit(1);
  }

  const localItems = db.prepare("SELECT * FROM inventory_items WHERE sku LIKE 'ALD-OH-%' ORDER BY sku ASC").all();
  console.log(`[Staged Sync] Loaded ${localItems.length} verified on-hand SKUs from command_hub.db (dryRun=${dryRun}).`);

  if (dryRun) {
    for (const item of localItems.slice(0, 3)) {
      const html = renderShopifyHtml(item, settings);
      const qrCard = generatePartQrCardPng(item, settings, UPLOADS_DIR);
      console.log(`  [Preview ${item.sku}] 1-Variant=$${Number(item.price_we_pull).toFixed(2)} | Desc Install=$${Number(item.price_pull_install).toFixed(2)} | CleanPhotos=${hasRealPhotos(item)} | FinalQR=${qrCard.fileName} | HTML len=${html.length}`);
    }
    console.log('Dry-run complete (0 external writes). Re-run with --execute after user confirmation.');
    return;
  }

  // Paginate all Shopify products
  let allShopify = [];
  let pageInfoUrl = `/products.json?limit=250`;
  while (pageInfoUrl) {
    const res = await fetch(`https://${domain}/admin/api/2024-10${pageInfoUrl}`, {
      headers: { 'X-Shopify-Access-Token': token }
    });
    if (!res.ok) throw new Error(`Failed listing Shopify products: HTTP ${res.status}`);
    const data = await res.json();
    allShopify.push(...(data.products || []));
    const link = res.headers.get('link') || '';
    const nextMatch = link.match(/<[^>]*(\/products\.json\?[^>]*page_info=[^>]*)>;\s*rel="next"/);
    pageInfoUrl = nextMatch ? nextMatch[1] : null;
  }

  const bySku = new Map();
  for (const p of allShopify) {
    for (const v of p.variants || []) {
      const s = String(v.sku || '').replace(/-INSTALL$/i, '').trim();
      if (s && !bySku.has(s)) bySku.set(s, p);
    }
  }

  let updated57 = 0;
  for (const item of localItems) {
    const existing = bySku.get(item.sku);
    const bodyHtml = renderShopifyHtml(item, settings);
    const qrCard = generatePartQrCardPng(item, settings, UPLOADS_DIR);
    const isHeavy = Number(item.weight_lbs || 0) >= 70 || item.shipping_class !== 'parcel_calculated';
    const singleVariant = {
      option1: 'Default Title',
      price: Number(item.price_we_pull || 0).toFixed(2),
      sku: item.sku,
      inventory_management: 'shopify',
      inventory_policy: 'deny',
      weight: Number(item.weight_lbs || 10),
      weight_unit: 'lb',
      requires_shipping: !isHeavy,
      taxable: true
    };
    if (existing) {
      if (existing.variants?.[0]?.id) singleVariant.id = existing.variants[0].id;
      const cleanExistingImages = (existing.images || [])
        .filter((img) => img && img.src && !isQrCardUrl(img.src))
        .map((img, idx) => ({ id: img.id, position: idx + 1 }));
      const imagesWithFinalQr = [
        ...cleanExistingImages,
        {
          attachment: qrCard.pngBuffer.toString('base64'),
          filename: qrCard.fileName,
          position: cleanExistingImages.length + 1,
          alt: `${item.sku} (${item.security_mark_code}) — Scan QR to Shop Direct on Aldridge Auto's App`
        }
      ];
      await shopifyReq(domain, token, 'PUT', `/products/${existing.id}.json`, {
        product: {
          id: existing.id,
          title: item.title,
          body_html: bodyHtml,
          options: [{ name: 'Title', values: ['Default Title'] }],
          variants: [singleVariant],
          images: imagesWithFinalQr,
          status: 'active'
        }
      });
      updated57++;
    }
  }

  let cleanedPhotoless = 0;
  for (const p of allShopify) {
    const skus = (p.variants || []).map((v) => String(v.sku || ''));
    const isAldOh = skus.some((s) => /^ALD-OH-/i.test(s));
    const hasImages = Array.isArray(p.images) && p.images.length > 0;
    if (!isAldOh && !hasImages) {
      if (purgePhotoless) {
        await shopifyReq(domain, token, 'DELETE', `/products/${p.id}.json`);
      } else {
        await shopifyReq(domain, token, 'PUT', `/products/${p.id}.json`, {
          product: { id: p.id, status: 'draft' }
        });
      }
      cleanedPhotoless++;
    }
  }

  console.log(`Updated ${updated57} verified ALD-OH single-variant products; cleaned ${cleanedPhotoless} photo-less legacy products.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
