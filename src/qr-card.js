const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const QRCode = require('qrcode');

function isQrCardUrl(url) {
  return /\.qr\.(png|jpe?g|webp)(\?|$)|qr[-_]card/i.test(String(url || ''));
}

function resolvePublicAppBaseUrl(settings) {
  const candidates = [
    process.env.CANONICAL_DOMAIN,
    process.env.PUBLIC_PWA_URL,
    settings?.canonical_domain,
    settings?.public_pwa_url,
    'https://aldridgeautosupply.com'
  ];
  for (const raw of candidates) {
    const trimmed = String(raw || '').trim().replace(/\/+$/, '');
    if (trimmed && /^https:\/\//i.test(trimmed) && !/localhost|127\.0\.0\.1/i.test(trimmed)) {
      return trimmed;
    }
  }
  return 'https://aldridgeautosupply.com';
}

function buildQrTrackingUrl(itemOrSku, settings, sourceTag = 'qr_part_card') {
  const sku = typeof itemOrSku === 'string'
    ? itemOrSku
    : String(itemOrSku?.sku || 'ALD-PART').trim();
  const base = resolvePublicAppBaseUrl(settings);
  const params = new URLSearchParams({
    utm_source: sourceTag,
    utm_medium: 'qr_scan',
    utm_campaign: 'direct_pwa_repeat_buyer',
    utm_content: sku,
    sku
  });
  return `${base}/?${params.toString()}`;
}

function renderScannableQrSvg(url, sizePx = 180) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const count = qr.modules.size;
  const quiet = 4;
  const total = count + quiet * 2;
  let pathData = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.modules.get(r, c)) {
        pathData += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${pathData}" fill="#0b1628"/></svg>`;
}

/* ==================== PURE-NODE CRISP 5x7 BITMAP FONT & PNG ENCODER ==================== */
const FONT_5X7 = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  '3': [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  'A': [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  'B': [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  'C': [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  'D': [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
  'E': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  'F': [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  'G': [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  'H': [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  'I': [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  'J': [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
  'K': [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  'L': [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  'M': [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  'N': [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  'O': [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  'P': [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  'Q': [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  'R': [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  'S': [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  'T': [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  'U': [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  'V': [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  'W': [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  'X': [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  'Y': [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  'Z': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  '-': [0, 0, 0, 0b11111, 0, 0, 0],
  ':': [0, 0b00100, 0b00100, 0, 0b00100, 0b00100, 0],
  '.': [0, 0, 0, 0, 0, 0b00110, 0b00110],
  ',': [0, 0, 0, 0, 0b00110, 0b00100, 0b01000],
  '/': [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  '\'': [0b00100, 0b00100, 0b00000, 0, 0, 0, 0],
  '&': [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
  '#': [0b01010, 0b11111, 0b01010, 0b01010, 0b11111, 0b01010, 0],
  '+': [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
  '$': [0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100],
  '(': [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ')': [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  '*': [0, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0]
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, crcInput, crcBuf]);
}

function encodeRgbPng(width, height, rgbBuffer) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0 (None)
    rgbBuffer.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0))
  ]);
}

function createCanvasRgb(width, height, r = 255, g = 255, b = 255) {
  const buf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < buf.length; i += 3) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
  }
  return {
    width,
    height,
    buf,
    fillRect(x0, y0, w, h, cr, cg, cb) {
      const xs = Math.max(0, Math.floor(x0));
      const ys = Math.max(0, Math.floor(y0));
      const xe = Math.min(width, Math.floor(x0 + w));
      const ye = Math.min(height, Math.floor(y0 + h));
      for (let y = ys; y < ye; y++) {
        let idx = (y * width + xs) * 3;
        for (let x = xs; x < xe; x++) {
          buf[idx] = cr;
          buf[idx + 1] = cg;
          buf[idx + 2] = cb;
          idx += 3;
        }
      }
    },
    strokeRect(x0, y0, w, h, thickness, cr, cg, cb) {
      this.fillRect(x0, y0, w, thickness, cr, cg, cb);
      this.fillRect(x0, y0 + h - thickness, w, thickness, cr, cg, cb);
      this.fillRect(x0, y0, thickness, h, cr, cg, cb);
      this.fillRect(x0 + w - thickness, y0, thickness, h, cr, cg, cb);
    },
    drawTextCentered(text, centerY, scale, cr, cg, cb) {
      const clean = String(text || '').toUpperCase();
      const charW = 5 * scale;
      const gap = 1 * scale;
      const totalW = clean.length * (charW + gap) - gap;
      let startX = Math.floor((width - totalW) / 2);
      const startY = Math.floor(centerY - (7 * scale) / 2);
      for (let i = 0; i < clean.length; i++) {
        const glyph = FONT_5X7[clean[i]] || FONT_5X7[' '];
        for (let row = 0; row < 7; row++) {
          const bits = glyph[row];
          for (let col = 0; col < 5; col++) {
            if ((bits >> (4 - col)) & 1) {
              this.fillRect(startX + col * scale, startY + row * scale, scale, scale, cr, cg, cb);
            }
          }
        }
        startX += charW + gap;
      }
    }
  };
}

/**
 * Generates a 1000x1000 high-contrast QR-Branded Info & App Card PNG for Shopify's final gallery slot.
 * NEVER overlays primary part photos used by eBay Motors or Google Merchant Center.
 */
function generatePartQrCardPng(item, settings, uploadsDir) {
  const safeSku = String(item?.sku || 'ALD-PART').replace(/[^A-Za-z0-9-]/g, '').toUpperCase() || 'ALD-PART';
  const secCode = String(item?.security_mark_code || 'SEC-VERIFIED').toUpperCase();
  const trackingUrl = buildQrTrackingUrl(safeSku, settings, 'qr_shopify_gallery');
  const displayHost = resolvePublicAppBaseUrl(settings).replace(/^https?:\/\//i, '').toUpperCase();

  const W = 1000;
  const H = 1000;
  const c = createCanvasRgb(W, H, 255, 255, 255);

  // Outer frame
  c.strokeRect(16, 16, W - 32, H - 32, 8, 11, 22, 40); // #0b1628

  // Top Pacific Navy header bar
  c.fillRect(24, 24, W - 48, 118, 11, 22, 40);
  c.drawTextCentered("ALDRIDGE AUTO'S - UNIVERSITY PLACE WA", 62, 4, 255, 255, 255);
  c.drawTextCentered(`${displayHost} - DIRECT MOBILE APP`, 110, 3, 251, 191, 36);

  // Safety Orange callout bar
  c.fillRect(24, 142, W - 48, 52, 234, 88, 12); // #ea580c
  c.drawTextCentered('SCAN CAMERA TO SHOP DIRECT & SAVE ON FEES', 168, 3, 255, 255, 255);

  // High-contrast ISO/IEC 18004 QR Code with generous white quiet zone
  const qr = QRCode.create(trackingUrl, { errorCorrectionLevel: 'M' });
  const modCount = qr.modules.size;
  const quietModules = 4;
  const totalModules = modCount + quietModules * 2;
  const qrBoxTarget = 520;
  const modulePx = Math.floor(qrBoxTarget / totalModules);
  const actualQrBox = totalModules * modulePx;
  const qrStartX = Math.floor((W - actualQrBox) / 2);
  const qrStartY = 218;

  c.strokeRect(qrStartX - 6, qrStartY - 6, actualQrBox + 12, actualQrBox + 12, 4, 11, 22, 40);
  c.fillRect(qrStartX, qrStartY, actualQrBox, actualQrBox, 255, 255, 255);

  for (let row = 0; row < modCount; row++) {
    for (let col = 0; col < modCount; col++) {
      if (qr.modules.get(row, col)) {
        c.fillRect(
          qrStartX + (col + quietModules) * modulePx,
          qrStartY + (row + quietModules) * modulePx,
          modulePx,
          modulePx,
          0, 0, 0
        );
      }
    }
  }

  // Bottom SKU + SEC-XXXXXX Anti-Fraud + App Install Box
  const boxY = 760;
  c.fillRect(48, boxY, W - 96, 192, 248, 250, 252);
  c.strokeRect(48, boxY, W - 96, 192, 4, 11, 22, 40);

  c.drawTextCentered(`PART SKU: ${safeSku}`, boxY + 38, 4, 11, 22, 40);
  c.drawTextCentered(`ANTI-FRAUD TAG: ${secCode}`, boxY + 86, 3, 180, 83, 9);
  c.drawTextCentered("TAP 'ADD TO HOME SCREEN' TO INSTALL APP", boxY + 132, 3, 15, 23, 42);
  c.drawTextCentered('5.0* AUTO REPAIR & BAY INSTALL - 98467', boxY + 168, 2, 71, 85, 105);

  const pngBuffer = encodeRgbPng(W, H, c.buf);
  const fileName = `${safeSku}.qr.png`;
  let absPath = '';
  if (uploadsDir) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    absPath = path.join(uploadsDir, fileName);
    fs.writeFileSync(absPath, pngBuffer);
  }

  return {
    sku: safeSku,
    fileName,
    publicPath: `/uploads/${fileName}`,
    absPath,
    trackingUrl,
    pngBuffer
  };
}

/**
 * Printable Customer In-Box Packing Slip & VIP App QR Card
 */
function generatePrintablePackingSlipHtml(item, settings) {
  const publicBase = resolvePublicAppBaseUrl(settings);
  const displayHost = publicBase.replace(/^https?:\/\//i, '');
  const trackingUrl = buildQrTrackingUrl(item, settings, 'qr_packing_slip');
  const qrSvg = renderScannableQrSvg(trackingUrl, 190);
  const mpn = item.oem_part_number || 'Does Not Apply';
  const partPrice = Number(item.price_we_pull || 0).toFixed(2);
  const installPrice = Number(item.price_pull_install || 0) > Number(item.price_we_pull || 0)
    ? Number(item.price_pull_install).toFixed(2)
    : (Number(item.price_we_pull || 0) + Number(item.install_labor_hours || 1.5) * Number(settings?.labor_rate_hourly || 135)).toFixed(2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Packing Slip &amp; VIP App QR Card — ${item.sku}</title>
  <style>
    @page { size: letter; margin: 0.4in; }
    body { font-family: 'Inter', Arial, sans-serif; margin: 20px; background: #f1f5f9; color: #0f172a; }
    .slip { max-width: 720px; margin: 0 auto; background: #fff; border: 2px solid #0b1628; border-radius: 8px; padding: 24px; box-shadow: 0 6px 18px rgba(0,0,0,0.08); }
    .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #ea580c; padding-bottom: 14px; margin-bottom: 16px; }
    .brand { font-size: 22px; font-weight: 900; color: #0b1628; }
    .sub { font-size: 12px; color: #475569; margin-top: 4px; }
    .sec-badge { background: #fef3c7; border: 2px solid #d97706; color: #92400e; font-family: monospace; font-weight: 800; padding: 6px 10px; border-radius: 6px; font-size: 13px; text-align: right; }
    .part-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 14px; margin-bottom: 16px; }
    .qr-callout { display: flex; gap: 18px; align-items: center; background: #0b1628; color: #fff; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .qr-wrap { background: #fff; padding: 6px; border-radius: 6px; flex-shrink: 0; }
    .policy { font-size: 11.5px; color: #334155; line-height: 1.45; border-top: 1px dashed #cbd5e1; padding-top: 12px; }
    .actions { max-width: 720px; margin: 14px auto 0; display: flex; gap: 10px; }
    button { background: #ea580c; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; font-weight: 800; cursor: pointer; }
    @media print { body { background: #fff; margin: 0; } .actions { display: none; } .slip { box-shadow: none; } }
  </style>
</head>
<body>
  <div class="slip">
    <div class="hdr">
      <div>
        <div class="brand">${settings.business_name || "Aldridge Auto's"} — Bench-Inspected OEM Certificate</div>
        <div class="sub">${settings.street_address || '5115 66th St W, Bldg B'}, ${settings.city_display || 'University Place / Tacoma'}, ${settings.state || 'WA'} ${settings.zip || '98467'} • Shop &amp; Parts: ${settings.phone || '(253) 245-4206'} • ${displayHost}</div>
      </div>
      <div class="sec-badge">
        SKU: ${item.sku}<br/>
        ANTI-FRAUD: ${item.security_mark_code}
      </div>
    </div>

    <div class="part-box">
      <div style="font-size:16px;font-weight:800;margin-bottom:6px;">${item.title}</div>
      <div style="font-size:12.5px;font-family:monospace;color:#334155;">
        Condition: ${item.condition || 'Used'} (1-of-1 Verified Unit) | OEM MPN: ${mpn} | Bin: ${item.bin_location || 'WHSE'} | Pkg: ${item.weight_lbs} lbs
      </div>
      <div style="margin-top:8px;font-size:12.5px;color:#0369a1;font-weight:700;">
        Part Price: $${partPrice} • Optional 5.0★ Certified Shop Bay Installation Estimate (98467): $${installPrice} Turnkey Installed
      </div>
    </div>

    <div class="qr-callout">
      <div class="qr-wrap">${qrSvg}</div>
      <div>
        <div style="color:#fbbf24;font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;">Repeat-Buyer Direct App &amp; VIP Savings • ${displayHost}</div>
        <div style="font-size:17px;font-weight:900;margin:4px 0 6px;">Scan With Your Phone Camera to Shop Direct &amp; Install Our App</div>
        <div style="font-size:12.5px;line-height:1.45;color:#e2e8f0;">
          1. Point your iPhone or Android camera at this QR code (or visit <strong>${publicBase}</strong>) to open our live catalog.<br/>
          2. Tap <strong>"Install App"</strong> or <strong>"Add to Home Screen"</strong> for 1-tap VIN checks, direct repeat-customer pricing (skipping marketplace markups), and 5.0★ repair bay scheduling!
        </div>
      </div>
    </div>

    <div class="policy">
      <strong>Anti-Fraud &amp; Defect-Only Return Verification:</strong> This part was bench-inspected, photographed, and marked with serialized UV/paint security tag <code>${item.security_mark_code}</code> prior to release. Returns are NOT accepted for buyer remorse, wrong ordering, or vehicle fitment mistakes. Verified defective/INAD claims require diagnostic evidence and an intact, unaltered <code>${item.security_mark_code}</code> mark.
    </div>
  </div>
  <div class="actions">
    <button onclick="window.print()">Print Customer Packing Slip &amp; VIP QR Card</button>
  </div>
</body>
</html>`;
}

module.exports = {
  isQrCardUrl,
  resolvePublicAppBaseUrl,
  buildQrTrackingUrl,
  renderScannableQrSvg,
  generatePartQrCardPng,
  generatePrintablePackingSlipHtml
};
