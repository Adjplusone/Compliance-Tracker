const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [name, w, h] of [['desktop', 1400, 900], ['laptop', 1280, 800], ['narrow', 1024, 800], ['phone', 400, 800]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto('file://' + process.cwd() + '/render.html', { waitUntil: 'networkidle' });
    await p.waitForTimeout(600);
    const m = await p.evaluate(() => {
      const box = document.querySelector('#staff .po-scroll');
      const tbl = document.querySelector('#staff-table');
      const r = box.getBoundingClientRect();
      return {
        boxW: Math.round(box.clientWidth), tableW: Math.round(tbl.scrollWidth),
        hScroll: tbl.scrollWidth > box.clientWidth + 1,
        boxH: Math.round(box.clientHeight), contentH: Math.round(box.scrollHeight),
        vScroll: box.scrollHeight > box.clientHeight + 1,
        boxTop: Math.round(r.top), boxBottom: Math.round(r.bottom),
        pageWide: document.documentElement.scrollWidth > window.innerWidth + 1,
        cols: document.querySelectorAll('#staff-table thead th').length,
      };
    });
    console.log(`${name.padEnd(8)} ${w}px | cols ${m.cols} | table ${m.tableW}px in ${m.boxW}px box -> sideways scroll: ${m.hScroll ? 'YES' : 'no'} | box height ${m.boxH} (content ${m.contentH}, scrolls: ${m.vScroll}) | page scrolls sideways: ${m.pageWide ? 'YES' : 'no'}`);
    if (name === 'desktop') {
      await p.click('#cols'); await p.waitForTimeout(250);
      const f = await p.evaluate(() => {
        const box = document.querySelector('#staff .po-scroll');
        const tbl = document.querySelector('#staff-table');
        return { cols: document.querySelectorAll('#staff-table thead th').length,
                 tableW: Math.round(tbl.scrollWidth), boxW: Math.round(box.clientWidth),
                 boxH: Math.round(box.clientHeight) };
      });
      console.log(`         full view | cols ${f.cols} | table ${f.tableW}px in ${f.boxW}px box (expected to scroll sideways, inside a ${f.boxH}px box)`);
    }
    await p.close();
  }
  await b.close();
})();
