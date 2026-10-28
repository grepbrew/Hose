// TC-191 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=on 2. click Settings 3. click Keys 4. fill RunPod API key = other-key 5. click Save 6. expect $10.00
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-191";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=on`, { waitUntil: "load" });
await page.click('text="Settings"', { label: "open settings" });
await page.waitForSelector("text=Appearance", { state: "visible", timeout: 5000 }).catch(() => {});
await page.click('text="Keys" >> nth=0', { label: "open keys" });
await page.waitForSelector("text=Settings › Keys", { state: "visible", timeout: 10000 }).catch(() => {});
await page.fill("#runpod-key", "other-key");
await page.click('text="Save"', { label: "save new key" });

// assert: the new account's balance shows within 3 s (the money poll used to wait up to 30 s)
const shown = await page.waitForSelector('text="$10.00"', { state: "visible", timeout: 3000 }).then(() => true, () => false);
const snap = await page.snapshot({ scope: "full_page" });
const ok = shown && !snap.includes("$25.00");
console.log(`${TC}: balance $10.00=${shown}`);
console.log(`${TC}: ${ok ? "PASS" : "FAIL"}`);

try {
  await page.screenshot({ path: `${EVIDENCE}/${TC}.png`, fullPage: true });
} catch (e) {
  console.log(`${TC}: evidence skipped (${e.message})`);
}
if (!ok) {
  console.log(snap);
  process.exitCode = 1;
}

try {
  await task.finish({ keep: [] });
} catch (e) {
  console.log(`${TC}: finish skipped (${e.message})`);
}
