// TC-192 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click Settings 3. click Keys 4. fill Hugging Face token = hf-good 5. click Save
//   6. click Settings 7. click Keys 8. fill Hugging Face token = (empty) 9. click Save
//   10. manual: evaluate localStorage `hose.keys`
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-192";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

const openKeys = async () => {
  await page.click('text="Settings"', { label: "open settings" });
  await page.waitForSelector("text=Appearance", { state: "visible", timeout: 5000 }).catch(() => {});
  await page.click('text="Keys" >> nth=0', { label: "open keys" });
  await page.waitForSelector("text=Settings › Keys", { state: "visible", timeout: 10000 }).catch(() => {});
};
const save = async (what) => {
  await page.click('text="Save"', { label: what });
  await page.waitForFunction(() => !document.getElementById("hf-token"), undefined, { timeout: 5000 }).catch(() => {});
};

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await openKeys();
await page.fill("#hf-token", "hf-good");
await save("save hf token");
await openKeys();
await page.fill("#hf-token", "");
await save("save cleared token");

// assert: the manual step, then still in the shell (sidebar), not first-run Setup
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("hose.keys") ?? "{}"));
const snap = await page.snapshot({ scope: "full_page" });
console.log(`${TC}: hose.keys runpod=${saved.runpod} hf=${JSON.stringify(saved.hf)}`);
const ok = saved.hf === "" && saved.runpod === "good-key" && snap.includes("New pod") && !snap.includes("Connect your accounts");
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
