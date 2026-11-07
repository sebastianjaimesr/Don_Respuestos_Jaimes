(async()=>{
const { chromium } = require('playwright');
const fs = require('fs');
const parts = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
p.on('console', (m) => console.log('console:', m.text()));
p.on('pageerror', (e) => console.log('err:', e.message));
for (const part of parts) {
  await p.goto(`http://localhost:8899/render.html?part=${part}&size=1400`);
  await p.waitForFunction(() => window.__listo, null, { timeout: 120000 });
  const d = await p.evaluate(() => window.__listo);
  fs.writeFileSync(`out-${part}.png`, Buffer.from(d.split(',')[1], 'base64'));
  console.log('ok', part);
}
await b.close();
})();
