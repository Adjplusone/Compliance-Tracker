const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const url = 'file://' + process.cwd() + '/render.html';
  const errs = [];
  for (const [name, w, h, scheme] of [
    ['desktop-light', 1400, 1150, 'light'],
    ['desktop-dark', 1400, 1150, 'dark'],
    ['phone-light', 400, 1000, 'light'],
  ]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 2 });
    p.on('console', m => { if (m.type() === 'error') errs.push(`${name}: ${m.text()}`); });
    p.on('pageerror', e => errs.push(`${name}: ${e.message}`));
    await p.goto(url, { waitUntil: 'networkidle' });
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${name}.png` });
    if (name === 'phone-light') {
      const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      console.log('phone horizontal page scroll:', over ? 'YES (bug)' : 'no');
    }
    const n = await p.evaluate(() => ({
      rows: document.querySelectorAll('#staff-table tbody tr').length,
      tiles: [...document.querySelectorAll('.po-tile-n')].map(e => e.textContent),
      reqRows: document.querySelectorAll('#req-table tbody tr').length,
    }));
    console.log(name, '| staff rows:', n.rows, '| requirement rows:', n.reqRows, '| tiles:', n.tiles.join(' '));
    await p.close();
  }
  console.log('console/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close();
})();
