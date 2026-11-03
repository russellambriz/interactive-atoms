// Smoke test + screenshots for the mixtures lab.
// Usage: python3 -m http.server 8812 --bind 127.0.0.1
//        node tests/mixtures.cjs [baseUrl]
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8812/solution-colloid-suspension/';
const OUT = path.join(__dirname, '..', 'screenshots');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));

  await page.goto(BASE + '?capture=1&pause=1&laser=1&settle=0', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.mixturesLab && document.getElementById('loading').classList.contains('done'), null, { timeout: 60000 });
  await page.waitForTimeout(700);
  const ready = await page.evaluate(() => window.mixturesLab.state());
  console.log('ready', JSON.stringify(ready));
  if (ready.counts.solution < 10 || ready.counts.colloid < 10 || ready.counts.suspension < 10) {
    errors.push('missing particles ' + JSON.stringify(ready.counts));
  }
  await page.screenshot({ path: path.join(OUT, '11-mixtures-tyndall.png') });

  await page.evaluate(() => { window.mixturesLab.setSettle(1); window.mixturesLab.advance(0.05); });
  await page.waitForTimeout(250);
  const settled = await page.evaluate(() => window.mixturesLab.state());
  console.log('settled', JSON.stringify(settled));
  if (!(settled.meanY.suspension < settled.meanY.colloid - 0.25)) {
    errors.push('suspension did not settle below the colloid: ' + JSON.stringify(settled.meanY));
  }
  if (Math.abs(settled.meanY.solution - ready.meanY.solution) > 0.05) {
    errors.push('solution drifted: ' + ready.meanY.solution + ' -> ' + settled.meanY.solution);
  }
  if (Math.abs(settled.meanY.colloid - ready.meanY.colloid) > 0.2) {
    errors.push('colloid drifted: ' + ready.meanY.colloid + ' -> ' + settled.meanY.colloid);
  }
  if (settled.turb > 0.2) errors.push('turbidity stayed high when settled: ' + settled.turb);
  await page.screenshot({ path: path.join(OUT, '12-mixtures-settled.png') });

  await page.evaluate(() => {
    window.mixturesLab.setMagnify(true);
    window.mixturesLab.setSettle(0.35);
    window.mixturesLab.advance(0.6);
  });
  const mag = await page.evaluate(() => window.mixturesLab.state());
  console.log('magnify', JSON.stringify(mag));
  if (mag.magnify < 0.8) errors.push('magnify did not engage: ' + mag.magnify);
  await page.screenshot({ path: path.join(OUT, '13-mixtures-magnify.png') });

  await page.evaluate(() => window.mixturesLab.stir());
  await page.evaluate(() => window.mixturesLab.advance(1.8));
  const stirred = await page.evaluate(() => window.mixturesLab.state());
  console.log('after stir', JSON.stringify(stirred));
  if (stirred.settle > 0.08) errors.push('stir did not remix: settle=' + stirred.settle);
  if (stirred.meanY.suspension < settled.meanY.suspension + 0.15) {
    errors.push('stir did not lift the suspension: ' + stirred.meanY.suspension + ' vs settled ' + settled.meanY.suspension);
  }

  await page.evaluate(() => { window.mixturesLab.setLaser(false); window.mixturesLab.pause(); });
  const off = await page.evaluate(() => window.mixturesLab.state());
  if (off.laser) errors.push('laser toggle failed');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  mobile.on('console', m => { if (m.type() === 'error') errors.push('[mobile] ' + m.text()); });
  mobile.on('pageerror', e => errors.push('[mobile] pageerror: ' + e.message));
  mobile.on('requestfailed', r => errors.push('[mobile] requestfailed: ' + r.url()));
  await mobile.goto(BASE + '?capture=1&pause=1&laser=1&settle=0.2', { waitUntil: 'domcontentloaded' });
  await mobile.waitForFunction(() => window.mixturesLab && document.getElementById('loading').classList.contains('done'), null, { timeout: 30000 });
  await mobile.evaluate(() => window.mixturesLab.advance(0.2));
  await mobile.screenshot({ path: path.join(OUT, '14-mixtures-mobile.png') });
  const collapsed = await mobile.evaluate(() => document.getElementById('compare').classList.contains('collapsed'));
  console.log('mobile compare collapsed', collapsed);
  if (!collapsed) errors.push('compare table should start collapsed on a phone');

  console.log('errors', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(1);
})().catch(err => { console.error(err); process.exit(1); });
