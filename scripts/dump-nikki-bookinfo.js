#!/usr/bin/env node
// Dump the raw, Snappy-decompressed Pearpal /note/book/info response to a file
// for manual inspection. Contains both info_from_self and info_from_gm.
//
// Usage:
//   node scripts/dump-nikki-bookinfo.js '<cookie-json>' [out-file]
//
// <cookie-json> is the JSON the /help one-liner prints: {roleid, token, id}.
// Quote it with single quotes so the shell doesn't eat anything. If out-file
// is omitted, defaults to ./nikki-bookinfo-<unix>.json in cwd.

const fs = require('fs');
const path = require('path');
const snappy = require('snappyjs');

const LIFETIME_URL = 'https://pearpal-api.infoldgames.com/v1/strategy/user/note/book/info';
const CLIENT_ID = 1116;

const [,, rawCookie, outFileArg] = process.argv;
if (!rawCookie) {
  console.error('Usage: node scripts/dump-nikki-bookinfo.js \'<cookie-json>\' [out-file]');
  process.exit(1);
}

let cookie;
try {
  cookie = JSON.parse(rawCookie);
} catch (e) {
  console.error('First arg must be the JSON object printed by the console one-liner.');
  process.exit(1);
}
if (!cookie.token || !cookie.id) {
  console.error('JSON must contain at minimum token and id.');
  process.exit(1);
}

const outFile = outFileArg
  ? path.resolve(outFileArg)
  : path.resolve(process.cwd(), `nikki-bookinfo-${Math.floor(Date.now() / 1000)}.json`);

(async () => {
  const res = await fetch(LIFETIME_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, token: cookie.token, openid: cookie.id }),
  });
  const buf = await res.arrayBuffer();

  let json;
  try {
    const decoded = snappy.uncompress(new Uint8Array(buf));
    json = JSON.parse(new TextDecoder().decode(decoded));
  } catch {
    const text = new TextDecoder().decode(buf);
    console.error(`Response was not Snappy-compressed JSON (${buf.byteLength}b). Raw text:`);
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  fs.writeFileSync(outFile, JSON.stringify(json, null, 2));
  const stat = fs.statSync(outFile);
  const selfKeys = json?.info_from_self ? Object.keys(json.info_from_self).length : 0;
  const gmKeys   = json?.info_from_gm   ? Object.keys(json.info_from_gm).length   : 0;
  console.log(`Wrote ${outFile} (${(stat.size / 1024).toFixed(1)} KB)`);
  console.log(`  info_from_self: ${selfKeys} keys`);
  console.log(`  info_from_gm:   ${gmKeys} keys`);
})().catch(err => {
  console.error('Dump failed:', err.message);
  process.exit(1);
});
