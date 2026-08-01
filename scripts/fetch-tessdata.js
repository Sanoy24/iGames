#!/usr/bin/env node
/**
 * Vendors the English tesseract.js language data onto this machine so the
 * Telebirr-screenshot OCR endpoint never has to fetch it from a CDN at
 * request time. Runs as `postinstall` — the project's deploy process is
 * "upload dist/, then npm install" (not a git checkout on the server), so
 * this is the one hook guaranteed to run there; a file committed to the repo
 * would not otherwise reach the server.
 *
 * Idempotent (skips if already downloaded) and non-fatal on failure — if the
 * fetch fails (e.g. this host's known outbound-egress issues), `npm install`
 * still succeeds and TelebirrScreenshotOcrService just falls back to
 * tesseract.js's own default CDN fetch on first OCR use instead.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const TESSDATA_DIR = path.join(__dirname, '..', 'tessdata');
const DEST = path.join(TESSDATA_DIR, 'eng.traineddata.gz');
// Same file/version tesseract.js itself would fetch by default (jsDelivr-hosted).
const SOURCE_URL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz';

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          download(res.headers.location, dest, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Unexpected status ${res.statusCode} fetching ${url}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(DEST) && fs.statSync(DEST).size > 0) {
    console.log('[fetch-tessdata] eng.traineddata.gz already present — skipping download');
    return;
  }

  fs.mkdirSync(TESSDATA_DIR, { recursive: true });
  const tmpDest = `${DEST}.download`;
  try {
    console.log(`[fetch-tessdata] downloading ${SOURCE_URL} ...`);
    await download(SOURCE_URL, tmpDest);
    fs.renameSync(tmpDest, DEST);
    console.log(`[fetch-tessdata] saved to ${DEST}`);
  } catch (err) {
    console.warn(`[fetch-tessdata] WARNING: could not download eng.traineddata.gz — ${err.message}`);
    console.warn('[fetch-tessdata] Telebirr-screenshot OCR will fetch language data over the network on first use instead.');
    try { fs.unlinkSync(tmpDest); } catch {}
  }
}

main();
