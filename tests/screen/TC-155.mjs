// TC-155 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click Settings 3. click Keys 4. click Show RunPod API key 5. expect Hide RunPod API key
//   6. manual: evaluate computed `-webkit-text-security` of #runpod-key and #hf-token
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-155";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click('text="Settings"', { label: "open settings" });
await page.waitForSelector("text=Appearance", { state: "visible", timeout: 5000 }).catch(() => {});
await page.click('text="Keys" >> nth=0', { label: "open keys" });
await page.waitForSelector("text=Settings › Keys", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click("loc=role:button[name='Show RunPod API key']", { label: "show runpod key" }).catch((e) => console.log(`${TC}: ${e.message}`));

// assert: the final `expect` step, then the manual masking check.
const hide = await page.waitForSelector("loc=role:button[name='Hide RunPod API key']", { state: "visible", timeout: 5000 }).then(() => true, () => false);
const masks = await page.evaluate(() => ["runpod-key", "hf-token"].map((id) => getComputedStyle(document.getElementById(id)).webkitTextSecurity));
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: hide button=${hide} text-security=${masks.join(",")}`);
const ok = hide && masks[0] === "none" && masks[1] === "disc" && snap.includes("RunPod API key");
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
