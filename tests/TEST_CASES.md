# Test cases — Hose (runpod-gpu-llm)

screen: yes
run: `npm test`
app: `npm run dev:mock` (vite on 5199 with `VITE_MOCK=1`: msw fakes RunPod + Hugging Face, `?seed=` picks the precondition)
base: `http://localhost:5199`
screen run: `(npm run dev:mock > /dev/null 2>&1 &) && until curl -sf http://localhost:5199 | grep -q '<title>Hose</title>'; do sleep 1; done && ego-browser nodejs < tests/screen/<id>.mjs`

Seeds (`/?seed=`): `fresh` clears stored keys; any other seed stores the fake key `good-key`. `one` = one endpoint `hose-qwen3-8b`, asleep. `running` = same endpoint with a running RTX 4090 worker ($1.10/hr). `none` = key saved, no endpoints.

| ID | Feature | Type | Precondition | Steps | Expected | Code test | Status |
|----|---------|------|--------------|-------|----------|-----------|--------|
| TC-001 | VRAM estimate | unit | — | vramNeededGb({BF16: 8e9}) | 8e9×2×1.2/1e9 + 2 = 21.2 GB | tests/cost.test.ts > vramNeededGb > bf16 8B | pass |
| TC-002 | GPU pick fits | unit | catalog 16/24/48/80 GB | pickPools(catalog, 21.2) | ["AMPERE_24", "AMPERE_48"] | tests/cost.test.ts > pickPools > picks smallest fit + next | pass |
| TC-003 | GPU pick skips sold out | unit | 24 GB pool availability NONE | pickPools(catalog, 21.2) | first pool AMPERE_48 | tests/cost.test.ts > pickPools > skips NONE | pass |
| TC-004 | Model too big | unit | — | pickPools(catalog, 150) | throws "too big" | tests/cost.test.ts > pickPools > too big | pass |
| TC-005 | Burn rate | unit | running 4090 ($1.10), idle A5000 ($0.69), throttled A5000 | burnRatePerHr(workers, prices) | 1.79 (throttled not billed) | tests/cost.test.ts > burnRatePerHr > sums billed | pass |
| TC-006 | Scale-to-zero guardrail | unit | — | endpointInput(Qwen3-8B, pools, token) | workersMin 0, workersMax 1, idleTimeout 60, name `hose-qwen3-8b…`, minCudaVersion "13.0", FLASHBOOT, cached model ref, disk 45 GB | tests/cost.test.ts > endpointInput > guardrail | pass |
| TC-007 | HF token only when set | unit | no token | endpointInput(preset, pools, "") | env has no HF_TOKEN | tests/cost.test.ts > endpointInput > no token | pass |
| TC-008 | HF model not chat | unit | pipeline_tag text-to-image | parseHfModel(info, true) | {ok: false, reason: "not a chat model"} | tests/cost.test.ts > parseHfModel > not chat | pass |
| TC-009 | HF gated without token | unit | gated "manual", no token | parseHfModel(info, false) | reason "needs Hugging Face token" | tests/cost.test.ts > parseHfModel > gated | pass |
| TC-010 | Stream text | unit | vLLM /stream chunks | streamText(chunks) | concatenated tokens | tests/cost.test.ts > streamText > joins | pass |
| TC-011 | Balance fetch | api | msw myself → 25 | getBalance("good-key") | 25 | tests/api.test.ts > getBalance > ok | pass |
| TC-012 | Bad RunPod key | api | msw 401 | getBalance("bad") | throws "RunPod rejected this key" | tests/api.test.ts > getBalance > 401 | pass |
| TC-013 | List own endpoints | api | msw: hose-qwen3-8b + someone-else | listHoseEndpoints("good-key") | only hose-qwen3-8b | tests/api.test.ts > listHoseEndpoints > filters | pass |
| TC-014 | Today's cost | api | msw billing totalAmount 0.12 | endpointCostToday("good-key", "ep1") | 0.12 | tests/api.test.ts > endpointCostToday > ok | pass |
| TC-015 | Setup happy | screen | fresh | 1. open /?seed=fresh 2. fill RunPod API key = good-key 3. click Save 4. expect Balance $25.00 | meter shows balance, Models view | tests/screen/TC-015.mjs | pass |
| TC-016 | Setup bad key | screen | fresh | 1. open /?seed=fresh 2. fill RunPod API key = bad-key 3. click Save 4. expect RunPod rejected this key | error shown, still on Setup | tests/screen/TC-016.mjs | pass |
| TC-017 | Deploy preset | screen | seed none | 1. open /?seed=none 2. click Deploy 3. expect Asleep | new row under Your models | tests/screen/TC-017.mjs | pass |
| TC-018 | Advanced rejects image model | screen | seed none | 1. open /?seed=none 2. fill Hugging Face model = black-forest-labs/FLUX.1-schnell 3. click Check 4. expect not a chat model | error shown, no Deploy for it | tests/screen/TC-018.mjs | pass |
| TC-019 | Chat reply | screen | seed one | 1. open /?seed=one 2. click Chat 3. fill Message = hi 4. click Send 5. expect Hello from fake GPU | reply rendered | tests/screen/TC-019.mjs | pass |
| TC-020 | Remove model | screen | seed one | 1. open /?seed=one 2. click Remove 3. expect No models yet | list empty | tests/screen/TC-020.mjs | pass |
| TC-021 | Live cost | screen | seed running | 1. open /?seed=running 2. expect Now $1.10/hr | meter shows burn rate | tests/screen/TC-021.mjs | pass |
| TC-022 | Preset GPU tiers | unit | test catalog | pickPools(catalog, vramNeededGb(preset)) per preset | Fast AMPERE_16, Balanced AMPERE_24, Smarter AMPERE_48 | tests/cost.test.ts > PRESETS > %s fits %s | pass |
| TC-023 | Packed 4-bit weights sizing | unit | — | vramNeededGb({BF16: 1e9, U8: 10e9}) | (2 + 10)×1.2 + 2 = 16.4 GB (U8 = 1 byte, safe side) | tests/cost.test.ts > vramNeededGb > u8 packed weights count 1 byte | pass |
| TC-024 | GPU state label | unit | worker lists | gpuState(workers) | [] / throttled → Asleep, initializing → Waking up, idle → Ready, running → Answering | tests/cost.test.ts > gpuState > %j -> %s | pass |
| TC-025 | GPU catalog unwrap | api | msw catalog → `{gpus: [5 GPUs]}` (OpenAPI shape) | getGpus("good-key") | array of 5 | tests/api.test.ts > getGpus > unwraps gpus | pass |
| TC-026 | GPU pick skips non-serverless | unit | cheap 24 GB GPU with pool null | pickPools(catalog, 21.2) | ["AMPERE_24", "AMPERE_48"], no null | tests/cost.test.ts > pickPools > skips null pool | pass |

## Rules

- IDs are never reused. Delete a row only when the feature is gone; keep the ID retired.
- One row per behaviour. A feature with three outcomes has three rows.
- `Type`: `unit` (one function/class), `api` (route or CLI entry), `screen` (ego-browser journey).
- `Status` is the result of the last real run: `pass`, `fail`, `todo`. Never set `pass` without the run output.
- A failing row is fixed in the code, not in this table.
