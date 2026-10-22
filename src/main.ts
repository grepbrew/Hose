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
  const qwen = { id: "Qwen/Qwen3-8B", params: { BF16: 8190735360 }, gpuId: "NVIDIA RTX 4090", gpuName: "RTX 4090", cloud: "SECURE", idleMin: 10 };
  if (name === "off" || name === "on") localStorage.setItem("hose.models", JSON.stringify([{ ...qwen, ...(name === "on" ? { podId: "pod1" } : {}) }]));
  else if (name) localStorage.removeItem("hose.models");
  seed(name);
  network.configure({ handlers });
  await network.enable();
}

createApp(App).mount("#app");
