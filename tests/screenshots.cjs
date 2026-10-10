// Headless smoke test + screenshots.
// Usage: (from repo root) python3 -m http.server 8812 &  then
//        NODE_PATH=<dir with playwright> node tests/screenshots.cjs [baseUrl]
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8812/';
const OUT = path.join(__dirname, '..', 'screenshots');

const shots = [
  { name: '01-carbon-bohr.png', q: '?capture=1', wait: 3500 },
  { name: '02-carbon-quantum.png', q: '?capture=1&view=quantum', wait: 3500 },
  { name: '03-methane-ch4.png', q: '?capture=1&demo=ch4', wait: 4000 },
  { name: '04-carbon-dioxide-co2.png', q: '?capture=1&demo=co2', wait: 4000 },
  { name: '05-nucleus-closeup.png', q: '?capture=1&zoom=nucleus&highlight=proton', wait: 3000 },
];

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [], warnings = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
  for (const s of shots) {
    await page.goto(BASE + s.q, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.atomLab && window.atomLab.world.atoms.length > 0 && document.getElementById('loading').classList.contains('done'), null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.waitForTimeout(s.wait);
    await page.screenshot({ path: path.join(OUT, s.name) });
    const st = await page.evaluate(() => window.atomLab.state());
    console.log(s.name, JSON.stringify({ molecules: st.molecules, bonds: st.bonds, angles: st.angles, fps: st.fps }));
  }

  // interaction test: sandbox → drag H atoms onto carbon, check CH4 forms
  await page.goto(BASE + '?capture=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.atomLab && window.atomLab.world.atoms.length > 0);
  await page.waitForTimeout(800);
  // drag the carbon nucleus with the mouse
  const pos = await page.evaluate(() => { const v = window.atomLab.world.atoms[0].pos.clone().project(window.atomLab.camera); return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight]; });
  await page.mouse.move(pos[0], pos[1]); await page.mouse.down();
  for (let i = 1; i <= 20; i++) { await page.mouse.move(pos[0] + i * 6, pos[1] - i * 2); await page.waitForTimeout(16); }
  await page.mouse.up(); await page.waitForTimeout(600);
  const moved = await page.evaluate(() => window.atomLab.world.atoms[0].pos.toArray().map(v => +v.toFixed(2)));
  console.log('carbon after mouse drag:', moved);
  for (let i = 0; i < 4; i++) { await page.evaluate(() => { window.atomLab.spawn('H'); window.atomLab.advance(4); }); }
  await page.evaluate(() => window.atomLab.advance(6));
  await page.waitForTimeout(1500);
  let st = await page.evaluate(() => window.atomLab.state());
  console.log('spawned 4H (attraction assist):', JSON.stringify(st.molecules), 'angles', st.angles);
  // heat test
  await page.screenshot({ path: path.join(OUT, '06-built-by-spawning-ch4.png') });
  await page.evaluate(() => { window.atomLab.setHeat(1); window.atomLab.advance(8); });
  await page.waitForTimeout(1500);
  st = await page.evaluate(() => window.atomLab.state());
  console.log('after heat=1:', JSON.stringify(st.molecules));
  await page.screenshot({ path: path.join(OUT, '07-heated-dissociation.png') });
  await page.evaluate(() => { window.atomLab.setHeat(0); window.atomLab.advance(10); });
  console.log('after cooling:', JSON.stringify((await page.evaluate(() => window.atomLab.state())).molecules));

  // chemistry checks: free atoms placed near each other, simulated forward
  const chem = await page.evaluate(() => {
    const L = window.atomLab, W = L.world, T = W.atoms[0].pos.constructor;
    const run = (spec) => { L.loadDemo('none'); W.clear(); spec.forEach(([s, x, y, z]) => W.spawn(s, new T(x, y, z))); L.advance(8); return L.state().molecules.map(m => m.formula + ' ' + m.name).join(' | ') + ' angles@sel=' + JSON.stringify(W.molecules[0] && W.measuredAngles(W.molecules[0].atoms.find(a => a.sym !== 'H') || W.atoms[0]).map(x => +x.toFixed(1))); };
    return {
      CO2: run([['C', 0, 0, 0], ['O', -5, 0.5, 0], ['O', 5, -0.5, 0.3]]),
      H2O: run([['O', 0, 0, 0], ['H', -3.5, -2, 0], ['H', 3.5, -2, 0.2]]),
      HCN: run([['C', 0, 0, 0], ['N', 4.5, 0.4, 0], ['H', -4, 0.5, 0.3]]),
      NH3: run([['N', 0, 0, 0], ['H', 4, 0, 0], ['H', -2, 3.4, 0], ['H', -2, -3.4, 0.5]]),
      C2H6: run([['C', -2.5, 0, 0], ['C', 2.5, 0, 0], ['H', -6, 2, 0], ['H', -6, -2, 1], ['H', -4, 0, -4], ['H', 6, 2, 0], ['H', 6, -2, -1], ['H', 4, 0, 4]]),
      CO: run([['C', 0, 0, 0], ['O', 4, 0, 0]]),
    };
  });
  console.log('chemistry:', JSON.stringify(chem, null, 1));

  // keyboard movement
  await page.evaluate(() => window.atomLab.loadDemo('co2'));
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => window.atomLab.world.selected.pos.toArray());
  await page.keyboard.down('d'); await page.waitForTimeout(700); await page.keyboard.up('d');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.atomLab.world.selected.pos.toArray());
  console.log('keyboard D moved selected by', (after[0] - before[0]).toFixed(2), 'molecule:', JSON.stringify((await page.evaluate(() => window.atomLab.state())).molecules));

  // mobile viewport sanity
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  m.on('console', x => { if (x.type() === 'error') errors.push('[mobile] ' + x.text()); });
  m.on('pageerror', e => errors.push('[mobile] pageerror: ' + e.message));
  await m.goto(BASE + '?capture=1&demo=c2h6', { waitUntil: 'networkidle' });
  await m.waitForFunction(() => window.atomLab && document.getElementById('loading').classList.contains('done'), null, { timeout: 90000 });
  await m.waitForTimeout(4000);
  await m.screenshot({ path: path.join(OUT, '08-mobile-ethane.png'), timeout: 90000 });
  console.log('mobile pixelRatio', await m.evaluate(() => window.atomLab.state().pixelRatio));

  console.log('WARNINGS', warnings.length, JSON.stringify(warnings.slice(0, 5)));
  console.log('ERRORS', errors.length, JSON.stringify(errors));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
