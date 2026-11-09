const fs = require('fs');
const path = require('path');
const REPO = '/home/user/Compliance-Tracker';

const page = fs.readFileSync(path.join(REPO, 'dashboard/index.html'), 'utf8');
const rows = JSON.parse(fs.readFileSync(path.join(REPO, 'data/out/dashboard-rows.json'), 'utf8'));
const tally = JSON.parse(fs.readFileSync(path.join(REPO, 'data/out/requirement-tally.json'), 'utf8'));

/* Minimal stand-in for the dashboard runtime: enough of dash.data / dash.calc /
   dash.onData to exercise the page's own rendering logic against real data. */
const stub = `
<script>
(function(){
  const DATA = {
    staff_compliance: ${JSON.stringify(rows)},
    requirement_tally: ${JSON.stringify(tally)},
  };
  const calcs = {};
  window.dash = {
    data(id){
      if (DATA[id]) return {status:'ok', data:DATA[id], columns:Object.keys(DATA[id][0]||{}), meta:{updatedAt:'2026-11-09'}};
      if (calcs[id]) {
        const inputs = calcs[id].inputs.map(i => (DATA[i]||[]));
        return {status:'ok', data: calcs[id].fn(...inputs), meta:{}};
      }
      return {status:'missing', data:[], message:'no such dataset'};
    },
    calc(id, spec){ calcs[id] = spec; },
    onData(fn){ window.__render = fn; fn(); },
    colors: ['#06316a','#0274bd','#cc3366'],
  };
})();
</script>
`;

const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>html,body{margin:0;padding:0;font:14px system-ui}img{max-width:100%}</style>
</head><body><div id="dash-root">${stub}${page}</div></body></html>`;
fs.writeFileSync('render.html', doc);
console.log('harness written,', doc.length, 'bytes');
