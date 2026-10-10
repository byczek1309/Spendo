const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const baseline = {
  "app.js": "bc8f95fd560c80a7277b1e929affd0ce1905d2ffd9658bd7a11c93e36898ffe5",
  "backup-core.js": "9f62d30da63c9f38cd0e78683e001d6d85e2923920f53dfc8f3dd0d76a45551a",
  "budget-core.js": "179cc4e21e4b38004344f534bf9953f2ae42cc3529df42f795e1379c813d2220",
  "index.html": "5dc12a1e544f6db67b7584958e5fbe27009403db7237bdaddebe9999dc6176ff",
  "manifest.webmanifest": "0db8258ef0117d6b537c7bccccf9cbebe6ac3400418daba5458dbda3d4fbe4d8",
  "sw.js": "c59ea6dd0b7a86e32ef59e3fead00a9ea61ddcf64d0d83bd62b464181cb71ce7",
  "wrangler.jsonc": "5889caddf63b32b4eade8cdd8cab1def50917350ffede84f616fa7efd68c003a",
  "styles.css": "f793871eaba7381ff0a76bfba34e65868b303757176f5f33b231fce4a8a5934e",
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
const legacyManifest = { ...manifest, name: 'Spendo — Twój budżet', short_name: 'Spendo' };
assert.equal(hash(JSON.stringify(legacyManifest, null, 2) + '\n'), baseline['manifest.webmanifest']);
for (const file of ['app.js', 'backup-core.js']) {
  const content = read(file);
  assert.match(content, /const KEY = 'dzienny\.v1'/);
  assert.equal(hash(content.replaceAll('Pulnora', 'Spendo')), baseline[file], file + ': branding only');
}
assert.match(read('app.js'), /anchor.download = `Pulnora-kopia-/);
assert.match(read('backup-core.js'), /nowszej wersji Pulnora/);
const originalHtml = html.replace('<meta name="apple-mobile-web-app-title" content="Pulnora">', '').replaceAll('Pulnora', 'Spendo');
assert.equal(hash(originalHtml), baseline['index.html']);
const sw = read('sw.js');
assert.match(sw, /const CACHE = 'spendo-v39'/);
assert.equal(hash(sw.replace('spendo-v39','spendo-v38')), baseline['sw.js']);
for (const file of ['budget-core.js', 'wrangler.jsonc', 'styles.css', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
  assert.equal(hash(fs.readFileSync(file)), baseline[file], file + ': unchanged');
}
assert.match(read('budget-core.js'), /STATE_SCHEMA_VERSION = 6/);
for (const icon of manifest.icons) assert.ok(fs.existsSync('.' + icon.src), icon.src);
assert.match(html, /href="\/apple-touch-icon.png"/);
assert.match(read('app.js'), /register\('\/sw.js'\)/);
console.log('OK Pulnora name, iOS title, unchanged data/schema/financial code/backup format/PWA identity/icons/deployment/SW scope');
