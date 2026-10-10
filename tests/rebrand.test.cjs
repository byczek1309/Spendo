const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const baseline = {
  "app.js": "1ccd61a3b8f9395f17b1b095d83c40306afea5c67110b0c308f619c8ed3adfe8",
  "backup-core.js": "1a017dfcaf6ed02b3ba9a6b8c88925582b3920c44dba3ec818bed696801e8532",
  "budget-core.js": "179cc4e21e4b38004344f534bf9953f2ae42cc3529df42f795e1379c813d2220",
  "index.html": "16e1ff10bf6bac6b4a0df6d35275cb154f731b6e653e1c45d2c0d826f2664a03",
  "manifest.webmanifest": "0db8258ef0117d6b537c7bccccf9cbebe6ac3400418daba5458dbda3d4fbe4d8",
  "sw.js": "c59ea6dd0b7a86e32ef59e3fead00a9ea61ddcf64d0d83bd62b464181cb71ce7",
  "wrangler.jsonc": "5889caddf63b32b4eade8cdd8cab1def50917350ffede84f616fa7efd68c003a",
  "styles.css": "a910ca9d137aef2725f809258d969777585d406e16dc4161a8612dc6377976b8",
  "icon.svg": "9f5a8a90fb2a1ac66fdb535d677cd84dc8205527bad4946141e4d0b53988410c",
  "icon-192.png": "9d9a5acd64dbee1281cb565201cc465df296066bd0d9ea054a37ae69c92458e5",
  "icon-512.png": "382e3b242c20bc543be3db6d0a59ffe631e30231cafa90512d0057ab5d0932d1",
  "apple-touch-icon.png": "d31d2da932637fe96a0d485621c0f19c8187483c6e7009aec1af8b744a286287"
};
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => fs.readFileSync(file, 'utf8');
const html = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));
assert.match(html, /<title>Pulnora — Twój budżet<\/title>/);
assert.match(html, /<strong>Pulnora<\/strong>/);
assert.match(html, /name="apple-mobile-web-app-title" content="Pulnora"/);
assert.ok(!html.includes('Spendo'));
assert.equal(manifest.name, 'Pulnora — Twój budżet');
assert.equal(manifest.short_name, 'Pulnora');
assert.equal(manifest.id, '/');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, undefined);
const legacyManifest = { ...manifest, name: 'Spendo — Twój budżet', short_name: 'Spendo', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }] };
assert.equal(hash(JSON.stringify(legacyManifest, null, 2) + '\n'), baseline['manifest.webmanifest']);
for (const file of ['app.js', 'backup-core.js']) {
  const content = read(file);
  assert.match(content, /const KEY = 'dzienny\.v1'/);
  assert.equal(hash(content.replaceAll('Pulnora', 'Spendo')), baseline[file], file + ': approved branding and data-safety baseline');
}
assert.match(read('app.js'), /anchor.download = `Pulnora-kopia-/);
assert.match(read('backup-core.js'), /nowszej wersji Pulnora/);
const originalHtml = html.replace('<meta name="apple-mobile-web-app-title" content="Pulnora">', '').replaceAll('Pulnora', 'Spendo');
assert.equal(hash(originalHtml), baseline['index.html']);
const sw = read('sw.js');
assert.match(sw, /const CACHE = 'spendo-v41'/);
assert.equal(hash(sw.replace('spendo-v41','spendo-v38').replace("'/data-safety.js', ", '').replace("'/brand-assets/pulnora-apple-touch-icon-180.png', '/brand-assets/pulnora-icon-192.png', '/brand-assets/pulnora-icon-512.png', '/brand-assets/pulnora-icon-maskable-512.png', '/brand-assets/pulnora-icon.svg', '/brand-assets/pulnora-favicon-32.png', '/brand-assets/pulnora-favicon-48.png'", "'/apple-touch-icon.png', '/icon-192.png', '/icon-512.png'")), baseline['sw.js']);
for (const file of ['budget-core.js', 'wrangler.jsonc', 'styles.css', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
  assert.equal(hash(fs.readFileSync(file)), baseline[file], file + ': unchanged');
}
assert.match(read('budget-core.js'), /STATE_SCHEMA_VERSION = 6/);
for (const icon of manifest.icons) assert.ok(fs.existsSync('.' + icon.src), icon.src);
assert.match(html, /href="\/brand-assets\/pulnora-apple-touch-icon-180.png"/);
assert.match(read('app.js'), /register\('\/sw.js'\)/);
console.log('OK Pulnora name, iOS title, unchanged data/schema/financial code/backup format/PWA identity/icons/deployment/SW scope');
