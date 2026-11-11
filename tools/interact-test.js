const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 2 });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + process.cwd() + '/render.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);

  const rowCount = () => p.$$eval('#staff-table tbody tr', r => r.length);
  console.log('categories rendered:', await p.$$eval('.po-cat', c => c.length));
  console.log('filter chips:', await p.$$eval('#filters .po-chip', c => c.map(x => x.textContent).join(' | ')));
  console.log('rows, default (all):', await rowCount());

  for (const label of ['Expired', 'Expiring soon', 'Missing', 'Requires review', 'Needs follow-up', '100-point ID']) {
    await p.evaluate((l) => {
      const b = [...document.querySelectorAll('#filters .po-chip')].find(x => x.textContent.startsWith(l));
      b.click();
    }, label);
    await p.waitForTimeout(120);
    console.log(`  filter "${label}" -> ${await rowCount()} rows | header: ${await p.$eval('#staff-count', e => e.textContent)}`);
  }

  await p.evaluate(() => { const b=[...document.querySelectorAll('#filters .po-chip')].find(x=>x.textContent.startsWith('All staff')); b.click(); });
  await p.waitForTimeout(120);

  console.log('summary columns:', await p.$$eval('#staff-table thead th', t => t.length));
  await p.click('#cols'); await p.waitForTimeout(150);
  console.log('after toggle, columns:', await p.$$eval('#staff-table thead th', t => t.length), '| button:', await p.$eval('#cols', e => e.textContent));
  await p.click('#cols'); await p.waitForTimeout(150);

  await p.fill('#search', 'waller'); await p.waitForTimeout(200);
  console.log('search "waller" ->', await rowCount(), 'rows |', await p.$eval('#staff-count', e => e.textContent));
  await p.fill('#search', ''); await p.waitForTimeout(150);

  await p.click('#refresh'); await p.waitForTimeout(250);
  console.log('refresh called for:', await p.evaluate(() => (window.__refreshed||[]).join(', ')));
  await p.waitForTimeout(1500);
  console.log('refresh button restored:', await p.$eval('#refresh-label', e => e.textContent), '| disabled:', await p.$eval('#refresh', e => e.disabled));

  await p.evaluate(() => document.getElementById('requirements').open = true);
  await p.waitForTimeout(200);
  console.log('requirement rows when opened:', await p.$$eval('#req-table tbody tr', r => r.length));
  console.log('errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close();
})();
