// TC-220 — Hose logo. Steps match tests/TEST_CASES.md:
// 1. open /?seed=fresh 2. expect Connect your accounts
// 3. manual: verify logo decoded and capture setup
// 4. open /?seed=none 5. expect What do you want help with?
// 6. manual: verify logo decoded and capture sidebar
const task = await taskSpace('Hose logo integration');
const page = task.page('p1');
const assert = (await import('node:assert/strict')).default;
const checkLogo = async () => {
  await page.waitForFunction(() => [...document.images].some(i => i.getAttribute('src') === '/hose-logo.png' && i.complete && i.naturalWidth === 128));
  assert.equal(await page.evaluate(() => [...document.images].filter(i => i.getAttribute('src') === '/hose-logo.png' && i.complete && i.naturalWidth === 128).length), 1);
};
const capture = async name => {
  try {
    await page.screenshot({ path: `/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence/TC-220-${name}.png` });
  } catch (e) { console.log(`Evidence skipped: ${e.message}`); }
};
await page.goto('http://localhost:5199/?seed=fresh', { waitUntil: 'load' });
await page.waitForSelector('text="Connect your accounts"');
assert.match(await page.snapshot(), /Connect your accounts/);
await checkLogo();
await capture('setup');
await page.goto('http://localhost:5199/?seed=none', { waitUntil: 'load' });
await page.waitForSelector('text="What do you want help with?"');
assert.match(await page.snapshot(), /What do you want help with/);
await checkLogo();
assert.equal(await page.evaluate(async () => {
  const icon = document.querySelector('link[rel="icon"]');
  const image = new Image();
  image.src = icon.href;
  await image.decode();
  return image.naturalWidth;
}), 32);
await capture('sidebar');
console.log('TC-220: PASS (setup logo, sidebar logo, favicon decoded)');
await task.finish({ keep: [] });
