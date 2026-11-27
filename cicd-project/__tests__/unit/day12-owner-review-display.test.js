'use strict';
const {execFileSync} = require('node:child_process');
const path = require('node:path');
test('customer sees own review details at every moderation status (safe text)', () => {
  const stdout = execFileSync(process.execPath, [path.resolve('scripts/verify-day12-owner-review-display.cjs')], {
    cwd:process.cwd(), encoding:'utf8', timeout:10000,
  });
  expect(stdout).toContain('Verified private owner display: PENDING, APPROVED, REJECTED');
});
