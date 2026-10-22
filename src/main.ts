import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

// Mock mode for screen tests: fake RunPod/HF answer every request. `?seed=` picks the precondition.
if (import.meta.env.DEV && import.meta.env.VITE_MOCK) {
  const { network } = await import("virtual:msw");
  const { handlers, seed } = await import("../tests/mocks/handlers");
  const name = new URLSearchParams(location.search).get("seed");
  if (name === "fresh") localStorage.clear();
  else if (name) localStorage.setItem("hose.keys", JSON.stringify({ runpod: "good-key", hf: "", vllm: "k1" }));
  // qwen is stored in the pre-2026-10-22 shape (no key/name) so every seed exercises the migration
  const qwen = { id: "Qwen/Qwen3-8B", params: { BF16: 8190735360 }, gpuId: "NVIDIA RTX 4090", gpuName: "RTX 4090", cloud: "SECURE", idleMin: 10 };
  const mistral = {
    key: "k-mistral",
    name: "Mistral-7B · A40",
    id: "mistralai/Mistral-7B-Instruct-v0.3",
    params: { BF16: 7248023552 },
    gpuId: "NVIDIA A40",
    gpuName: "A40",
    cloud: "SECURE",
    idleMin: 10,
    pastPodIds: ["old1"],
    spentPast: 1.24,
    last:{ dataCenter: "EU Romania 1", vcpu: 9, memoryGb: 50, diskGb: 42, image: "vllm/vllm-openai:v0.32.0", startedAt: "2026-10-21T09:00:00Z", runSpend: 0 },
  };
  const models = { off: [qwen], on: [{ ...qwen, podId: "pod1" }], two: [{ ...qwen, podId: "pod1" }, mistral] }[name ?? ""];
  if (models) localStorage.setItem("hose.models", JSON.stringify(models));
  else if (name) localStorage.removeItem("hose.models");
  for (const k of ["hose.sel", "hose.details", "hose.theme"]) if (name) localStorage.removeItem(k);
  seed(name);
  network.configure({ handlers });
  await network.enable();
}

// Appearance (Settings menu): System follows macOS, Light/Dark override it via data-theme.
try {
  const theme = localStorage.getItem("hose.theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}

createApp(App).mount("#app");
