/* One-time, non-destructive integration: modify the live team's app.js at known anchor points.
 * Unlike replacing src/app.js wholesale, this preserves any newer vendor/order/payment routes.
 */
const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '..', 'src', 'app.js');
const original = fs.readFileSync(file, 'utf8');
let updated = original;
function ensure(requireLine, afterLine) {
  if (updated.includes(requireLine)) return;
  if (updated.split(afterLine).length !== 2) {
    throw new Error(`Cannot safely insert ${requireLine}: expected one anchor ${afterLine}. No file modified.`);
  }
  updated = updated.replace(afterLine, `${afterLine}\n${requireLine}`);
}
ensure("const profileRouter = require('./routers/Profile.router');", "const authRouter = require('./routers/Auth.router');");
ensure("const weeklyStatsRouter = require('./routers/VendorWeekly.router');", "const profileRouter = require('./routers/Profile.router');");
ensure("app.use('/api/profile', profileRouter);", "app.use('/api/auth', authRouter);");
ensure("app.use('/api/vendor/weekly-stats', weeklyStatsRouter);", "app.use('/api/profile', profileRouter);");
if (updated !== original) {
  fs.writeFileSync(file, updated, 'utf8');
  console.log('PASS: mounted session-secured profile and vendor weekly stats routes; all other existing app.js content preserved.');
} else {
  console.log('PASS: both routes were already integrated; no changes made.');
}
