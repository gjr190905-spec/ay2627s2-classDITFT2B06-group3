'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const front = path.resolve(__dirname, '../../src/public/prototype-exact');
const fixtures = JSON.parse(fs.readFileSync(path.join(front, 'fixtures.json'), 'utf8'));

function loadedBridge() {
  const window = { localStorage: { getItem: () => null, setItem: () => {} }, fetch: async () => { throw Error('Unmocked network request'); } };
  const context = { window, URLSearchParams, console };
  vm.createContext(context);
  for (const file of ['menu-reference-data.js', 'api-bridge.js']) {
    vm.runInContext(fs.readFileSync(path.join(front, file), 'utf8'), context, { filename: file });
  }
  for (const stall of fixtures.stalls) {
    context.window.MakanLiveBridge.normalizeStall({ ...stall, foodCourtName: stall.court_name });
  }
  return context.window;
}

let reference;
let bridge;
beforeAll(() => {
  const w = loadedBridge();
  reference = w.MakanMenuReference;
  bridge = w.MakanLiveBridge;
});

test('all 121 original FC6 dishes resolve to different locally bundled photos even when API provides no image path', () => {
  const images = new Set();
  const binaryHashes = new Set();
  for (const dish of fixtures.menus.filter((m) => m.court_name === 'Food Court 6')) {
    const item = bridge.normalizeMenuItem({ ...dish, image_path: null }, dish.stall_id);
    expect(item.image_path).toMatch(/^fc6\/menu_\d+\.webp$/);
    const filename = path.join(front, 'media', item.image_path);
    expect(fs.existsSync(filename)).toBe(true);
    images.add(item.image_path);
    binaryHashes.add(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'));
  }
  expect(images.size).toBe(121);
  expect(binaryHashes.size).toBe(121);
});

test('the four screenshot items resolve to four correct photos', () => {
  const examples = [
    ['Add-On Side (Normal)', 'fc6/menu_092.webp'],
    ['Add-On Side (Premium)', 'fc6/menu_093.webp'],
    ['Beancurd Skin', 'fc6/menu_086.webp'],
    ['Corn', 'fc6/menu_091.webp'],
  ];
  for (const [index, [name, expected]] of examples.entries()) {
    expect(bridge.normalizeMenuItem({ name, id: 300 + index, stallId: 17 }, 17).image_path).toBe(expected);
  }
});

test('illustrative nutrition is defined for all 121 FC6 dishes and cannot be mistaken for vendor-verified facts', () => {
  const nutrition = new Set();
  for (const dish of fixtures.menus.filter((m) => m.court_name === 'Food Court 6')) {
    const meta = reference.detailsFor(dish, dish.stall_name);
    expect(meta.nutritionIsEstimate).toBe(true);
    expect(meta.nutrition.calories).toBeGreaterThan(0);
    nutrition.add(JSON.stringify(meta.nutrition));
    expect(meta.sizes).toHaveLength(1);
    expect(meta.sizes[0].extraCents).toBe(0);
  }
  expect(nutrition.size).toBe(121);
});

test('98 eligible dishes each have exactly three unpriced reference add-on suggestions', () => {
  let offered = 0;
  for (const dish of fixtures.menus.filter((m) => m.court_name === 'Food Court 6')) {
    const meta = reference.detailsFor(dish, dish.stall_name);
    if (!meta.addons.length) continue;
    offered++;
    expect(meta.addons).toHaveLength(3);
    expect(meta.addons.every((o) => o.isDemo && o.extraCents === 0)).toBe(true);
  }
  expect(offered).toBe(98);
});

test('script loading order and UI detail-animation hooks are preserved', () => {
  const html = fs.readFileSync(path.join(front, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(front, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(front, 'styles.css'), 'utf8');
  expect(html.indexOf('menu-reference-data.js')).toBeGreaterThan(0);
  expect(html.indexOf('menu-reference-data.js')).toBeLessThan(html.indexOf('api-bridge.js'));
  expect(app).toContain('dish-closing');
  expect(app).toContain('function openDish(');
  expect(styles).toContain('@keyframes dish-exit');
});
