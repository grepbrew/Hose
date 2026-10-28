// TC-163 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=none 2. click New pod 3. click Choose a model yourself 4. click Reads images 5. expect Gemma-4-26B-A4B
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-163";
const EVIDENCE = `${(await import("node:os")).homedir()}/Work/GitHub/gruda/hose/tests/screen/evidence`;

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");
const listed = () => page.evaluate(() => [...document.querySelectorAll("button.result .ellipsis")].map((e) => e.textContent.trim()));

// act
await page.goto(`${BASE}/?seed=none`, { waitUntil: "load" });
await page.click("loc=role:button[name='New pod']", { label: "new pod" });
await page.click('text="Choose a model yourself"', { label: "choose a model" });
await page.waitForSelector("text=Fast replies · A40 >> nth=0", { state: "visible", timeout: 10000 }).catch(() => {});
await page.click("loc=role:button[name='Reads images']", { label: "image models only" });

// assert
await page.waitForSelector("text=Gemma-4-26B-A4B", { state: "visible", timeout: 10000 }).catch(() => {});
const names = await listed();
const snap = await page.snapshot({ scope: "full_page" });
const pills = (snap.match(/reads images/g) ?? []).length;
console.log(`${TC}: ${names.join(", ")} · ${pills} pills`);
const ok = names.join(",") === "Qwen3.5-4B,Qwen3.5-9B,Qwen3.8-27B,Gemma-4-26B-A4B" && pills >= 4 && !snap.includes("Phi-4-mini");
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
