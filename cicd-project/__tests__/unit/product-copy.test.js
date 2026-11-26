'use strict';
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../../src/public/prototype-exact/app.js'), 'utf8');

test('main customer-facing pages use polished product wording', () => {
  expect(app).not.toContain('container footer-disclaimer');
  expect(app).toContain("'Terms of Use'");
  expect(app).toContain("'Privacy & Data'");
  expect(app).toContain('campus food discovery, pre-ordering and pickup tracking');
  expect(app).not.toContain('This is a demo:');
});

test('Terms are transparent about the educational deployment', () => {
  expect(app).toContain('student-built demonstration');
  expect(app).toContain('not an official Singapore Polytechnic canteen ordering service');
  expect(app).toContain('not verified with operators');
});

test('unverified dish options are not presented as available to purchase', () => {
  expect(app).toContain("v.isDemo?'Unavailable'");
  expect(app).toContain('disabled aria-disabled');
  expect(app).toContain("sizeIsDemo?'Price unavailable'");
  expect(app).toContain('Nutrition is estimated and may vary');
});
