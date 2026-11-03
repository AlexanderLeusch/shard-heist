// Downloads every external script named in index.html and checks it against its Subresource Integrity hash.
// ### Run with `npm run test:sri` (needs internet). If a CDN ever served a different file, the browser would refuse it and
// ### the game would show its error screen; this script finds that before a player does.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function main(){
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const tags = [...html.matchAll(/<script src="(https:[^"]+)" integrity="(sha384-[^"]+)"/g)];
  if (!tags.length) throw new Error('no external scripts with integrity hashes found');
  let bad = 0;
  for (const [, url, want] of tags){
    const res = await fetch(url);
    if (!res.ok){ console.error(`✖ ${url}: HTTP ${res.status}`); bad++; continue; }
    const got = 'sha384-' + crypto.createHash('sha384').update(Buffer.from(await res.arrayBuffer())).digest('base64');
    if (got === want) console.log(`✔ ${url}`);
    else { console.error(`✖ ${url}\n  expected ${want}\n  got      ${got}`); bad++; }
  }
  if (bad){ console.error(`${bad} of ${tags.length} scripts failed`); process.exit(1); }
  console.log(`All ${tags.length} library files match their integrity hashes.`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
