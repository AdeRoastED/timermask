const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const sizes = { phone_portrait: [390, 844], phone_landscape: [844, 390], tablet: [820, 1180], desktop: [1366, 768] };
  for (const [name, [w, h]] of Object.entries(sizes)) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: name.startsWith('phone'), isMobile: name.startsWith('phone'), deviceScaleFactor: 2, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
    p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
    await p.goto('http://localhost:8765/index.html');
    await p.waitForTimeout(400);
    await p.screenshot({ path: `shots/home_${name}.png` });
    console.log(name, 'errors:', errs);
    await ctx.close();
  }
  await b.close();
})();
