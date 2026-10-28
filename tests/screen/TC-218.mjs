// TC-218 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=strayStorage 2. expect ≈ $2.80/mo 3. click hose-llama 4. click Remove storage · save ≈ $2.80/mo
//   5. expect What do you want help with?
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-218";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=strayStorage`, { waitUntil: "load" });
await page.waitForSelector("text=hose-llama", { state: "visible", timeout: 10000 }).catch(() => {});
const before = await page.snapshot({ scope: "full_page" });
await page.click("text=hose-llama >> nth=0", { label: "open stray storage" });
await page.click("text=Remove storage · save ≈ $2.80/mo", { label: "remove storage" });

// assert: the sidebar listed the stray volume with its charge; after removal it is gone and New pod shows
await page.waitForSelector("text=What do you want help with?", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const ok =
  before.includes("40 GB · ≈ $2.80/mo · not on this Mac") &&
  snap.includes("What do you want help with?") &&
  !snap.includes("hose-llama") &&
  !snap.includes("$2.80/mo");
console.log(`${TC}: ${ok ? "PASS" : "FAIL"}`);

try {
  await page.screenshot({ path: `${EVIDENCE}/${TC}.png`, fullPage: true });
} catch (e) {
  console.log(`${TC}: evidence skipped (${e.message})`);
}
if (!ok) {
  console.log(before, snap);
  process.exitCode = 1;
}

try {
  await task.finish({ keep: [] });
} catch (e) {
  console.log(`${TC}: finish skipped (${e.message})`);
}
