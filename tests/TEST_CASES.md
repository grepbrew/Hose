# Test cases — Hose (runpod-gpu-llm)

screen: yes
run: `npm test`
app: `npm run dev:mock` (vite on 5199 with `VITE_MOCK=1`: msw fakes RunPod + Hugging Face, `?seed=` picks the precondition)
base: `http://localhost:5199`
screen run: `(npm run dev:mock > /dev/null 2>&1 &) && until curl -sf http://localhost:5199 | grep -q '<title>Hose</title>'; do sleep 1; done && ego-browser nodejs < tests/screen/<id>.mjs`

Seeds (`/?seed=`): `fresh` clears stored keys; any other seed stores the fake key `good-key`. `none` = key saved, no saved models, no pods. `off` = saved model Qwen3-8B on RTX 4090 Secure, no pod. `on` = same model with a ready RUNNING pod (cost $0.89/hr).

Retired (serverless, replaced by Pods 2026-10-22): TC-002–007, 010, 013, 014, 017, 019–022, 024–026.

| ID | Feature | Type | Precondition | Steps | Expected | Code test | Status |
|----|---------|------|--------------|-------|----------|-----------|--------|
| TC-001 | VRAM estimate | unit | — | vramNeededGb({BF16: 8e9}) | 8e9×2×1.2/1e9 + 2 = 21.2 GB | tests/cost.test.ts > vramNeededGb > bf16 8B | pass |
| TC-008 | HF model not chat | unit | pipeline_tag text-to-image | parseHfModel(info, true) | {ok: false, reason: "not a chat model"} | tests/cost.test.ts > parseHfModel > not chat | pass |
| TC-009 | HF gated without token | unit | gated "manual", no token | parseHfModel(info, false) | reason "needs Hugging Face token" | tests/cost.test.ts > parseHfModel > gated | pass |
| TC-011 | Balance fetch | api | msw myself → 25 | getBalance("good-key") | 25 | tests/api.test.ts > getBalance > ok | pass |
| TC-012 | Bad RunPod key | api | msw 401 | getBalance("bad") | throws "RunPod rejected this key" | tests/api.test.ts > getBalance > 401 | pass |
| TC-015 | Setup happy | screen | fresh | 1. open /?seed=fresh 2. fill RunPod API key = good-key 3. click Save 4. expect Balance $25.00 | meter shows balance, Models view | tests/screen/TC-015.mjs | pass |
| TC-016 | Setup bad key | screen | fresh | 1. open /?seed=fresh 2. fill RunPod API key = bad-key 3. click Save 4. expect RunPod rejected this key | error shown, still on Setup | tests/screen/TC-016.mjs | pass |
| TC-018 | Advanced rejects image model | screen | seed none | 1. open /?seed=none 2. fill Hugging Face model = black-forest-labs/FLUX.1-schnell 3. click Check 4. expect not a chat model | error shown, no Deploy for it | tests/screen/TC-018.mjs | pass |
| TC-023 | Packed 4-bit weights sizing | unit | — | vramNeededGb({BF16: 1e9, U8: 10e9}) | (2 + 10)×1.2 + 2 = 16.4 GB (U8 = 1 byte, safe side) | tests/cost.test.ts > vramNeededGb > u8 packed weights count 1 byte | pass |
| TC-027 | GPU cards | unit | catalog: A4000 16 GB, A5000 24 GB sold out, 4090 24 GB, A40 48 GB, one community-only GPU | gpuCards(catalog, "SECURE", 21.2) | sorted by secure price; A4000 fits=false "Too small"; A5000 fits=false "Sold out"; 4090 + A40 fit; community-only GPU absent | tests/cost.test.ts > gpuCards > secure cards | pass |
| TC-028 | Pod input | unit | — | podInput(Qwen3-8B, "NVIDIA GeForce RTX 4090", "SECURE", "hf_x", "k1", 10, "WD") | name `hose-qwen3-8b`, pinned vllm image, gpu {id, count 1, minCudaVersion "13.0"}, ports ["8000/http"], disk 45, env MODEL/HOSE_KEY/HOSE_IDLE_MIN "10"/HOSE_WATCHDOG/HF_TOKEN, bash entrypoint runs watchdog + vllm serve | tests/cost.test.ts > podInput > full | pass |
| TC-029 | Pod input without HF token | unit | no token | podInput(preset, gpu, "SECURE", "", "k1", 10, "WD") | env has no HF_TOKEN | tests/cost.test.ts > podInput > no token | pass |
| TC-030 | Stream text | unit | SSE fixture from spike | sseText(fixture) | concatenated delta content, `[DONE]` ignored | tests/cost.test.ts > sseText > joins deltas | pass |
| TC-031 | Burn rate | unit | pods RUNNING $0.89, EXITED $0.24 | burnRatePerHr(pods) | 0.89 | tests/cost.test.ts > burnRatePerHr > running only | pass |
| TC-032 | Watchdog decision | unit | — | should_stop(now, booted_at, last, ready, idle_s=600, boot_s=1200) cases | not ready + 19 min → false; not ready + 21 min → true; ready + 9 min idle → false; ready + 11 min idle → true | tests/watchdog_test.py | pass |
| TC-033 | List own pods | api | msw pods: hose-qwen3-8b + someone-else | listHosePods("good-key") | only hose-qwen3-8b | tests/api.test.ts > listHosePods > filters | pass |
| TC-034 | Pod ready check | api | msw proxy /v1/models 200 for ready pod, 404 for booting pod | podReady(id, "k1") | true / false | tests/api.test.ts > podReady > %s | pass |
| TC-035 | Chat stream | api | msw proxy SSE "Hello from fake GPU" in 3 chunks | chatStream(id, "k1", model, msgs, onText) | onText ends with "Hello from fake GPU" | tests/api.test.ts > chatStream > collects | pass |
| TC-036 | GPU picker fits | screen | seed none | 1. open /?seed=none 2. click Choose GPU 3. expect RTX 4090 | only fitting cards shown, sorted by price | tests/screen/TC-036.mjs | pass |
| TC-037 | Turn on | screen | seed none | 1. open /?seed=none 2. click Choose GPU 3. click RTX 4090 4. click Turn on 5. expect On | model row shows On after Starting | tests/screen/TC-037.mjs | pass |
| TC-038 | Chat reply | screen | seed on | 1. open /?seed=on 2. click Chat 3. fill Message = hi 4. click Send 5. expect Hello from fake GPU | streamed reply rendered | tests/screen/TC-038.mjs | pass |
| TC-039 | Turn off | screen | seed on | 1. open /?seed=on 2. click Turn off 3. expect Off | row shows Off, pod deleted | tests/screen/TC-039.mjs | pass |
| TC-040 | Live cost | screen | seed on | 1. open /?seed=on 2. expect Now $0.89/hr | meter shows pod cost | tests/screen/TC-040.mjs | pass |
| TC-041 | Keys in one Keychain item | unit | Keychain item `keys` = {runpod r1, hf h1, vllm v1} | loadKeys() | returns the 3 keys with exactly one Keychain read | tests/secrets.test.ts > loadKeys > one read | pass |
| TC-042 | Move old per-key items into one | unit | old items `runpod` = r1, `hf` = h1, no `keys` item | loadKeys() | returns r1/h1, writes item `keys`, deletes `runpod` and `hf` | tests/secrets.test.ts > loadKeys > migrates legacy items | pass |
| TC-043 | Save writes one item | unit | empty Keychain | saveKeys({runpod r1, hf "", vllm v1}) | only item `keys` exists, holding that JSON | tests/secrets.test.ts > saveKeys > one item | pass |

## Rules

- IDs are never reused. Delete a row only when the feature is gone; keep the ID retired.
- One row per behaviour. A feature with three outcomes has three rows.
- `Type`: `unit` (one function/class), `api` (route or CLI entry), `screen` (ego-browser journey).
- `Status` is the result of the last real run: `pass`, `fail`, `todo`. Never set `pass` without the run output.
- A failing row is fixed in the code, not in this table.
