// TC-066 — ego-browser screen test.
// Run the `screen run:` line from tests/TEST_CASES.md: it starts the mock dev server, waits for it, then pipes this file.
//
// steps:
//   1. open /?seed=starting 2. click Qwen3-8B · RTX 4090 3. expect Pulling image vllm/vllm-openai:v0.32.0 4. expect Loading weights took 12.3 seconds
//
// One TaskSpace per run; pass/fail comes from the snapshot assertion. The PNG is evidence only.
const BASE = "http://localhost:5199"; // must equal `base:` in TEST_CASES.md. process.env is NOT passed into ego's node runtime.
const TC = "TC-066";
const EVIDENCE = "/Users/you/Work/GitHub/gruda/hose/tests/screen/evidence";

const task = await taskSpace(`${TC} screen test`);
const page = task.page("p1");

// act
await page.goto(`${BASE}/?seed=starting`, { waitUntil: "load" });
await page.click("text=Qwen3-8B · RTX 4090 >> nth=0", { label: "open starting pod" });

// assert: both log lines shown; manual: the composer is disabled while Starting (snapshot doesn't show disabled)
await page.waitForSelector("text=Loading weights took 12.3 seconds", { state: "visible", timeout: 10000 }).catch(() => {});
const snap = await page.snapshot({ scope: "full_page" });
const locked = await page.evaluate(() => {
  const send = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Send");
  return document.querySelector('textarea[aria-label="Message"]').disabled && send.disabled;
});
const ok =
  /log "Startup log"[\s\S]*Pulling image vllm\/vllm-openai:v0\.32\.0[\s\S]*Loading weights took 12\.3 seconds/.test(snap) && locked;
console.log(`${TC}: ${ok ? "PASS" : "FAIL"}`);

try {
  await page.screenshot({ path: `${EVIDENCE}/${TC}.png`, fullPage: true });
} catch (e) {
  console.log(`${TC}: evidence skipped (${e.message})`);
}
if (!ok) {
  console.log({ locked });
  console.log(snap);
  process.exitCode = 1;
}

try {
  await task.finish({ keep: [] });
} catch (e) {
  console.log(`${TC}: finish skipped (${e.message})`);
}
