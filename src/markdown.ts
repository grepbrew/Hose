import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/common";
import katex from "@vscode/markdown-it-katex";
import "katex/dist/katex.min.css";

// CJS with exports.default: Vite's dep interop hands back { default: plugin }, Node (vitest) the plugin itself
const katexPlugin = (katex as unknown as { default?: typeof katex }).default ?? katex;

// Replies land in v-html inside a webview that can read the saved keys: html:false escapes any HTML the model writes,
// markdown-it's validateLink drops javascript:/file:/data: links, and images are off (no remote loads from a reply).
const it = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight: (code, lang) => (hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : ""),
})
  .use(katexPlugin, { throwOnError: false })
  .disable("image");

// links open in the default browser: tauri-plugin-opener sends target=_blank clicks there instead of navigating Hose away
it.renderer.rules.link_open = (tokens, i, opts, _env, self) => {
  tokens[i].attrSet("target", "_blank");
  tokens[i].attrSet("rel", "noreferrer");
  return self.renderToken(tokens, i, opts);
};
const fence = it.renderer.rules.fence!;
it.renderer.rules.fence = (...a) => `<div class="code"><button type="button" class="copy" aria-label="Copy code">Copy</button>${fence(...a)}</div>`;

// Qwen and DeepSeek write math as \( \) and \[ \]; the KaTeX plugin reads only $ and $$, so rewrite them outside code
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;
const dollars = (src: string) =>
  src
    .split(CODE)
    .map((s, i) => (i % 2 ? s : s.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`).replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`)))
    .join("");

// ponytail: every streamed token re-renders the whole chat, so cache by text; cleared at 200 entries, LRU if that churns
const memo = new Map<string, string>();
export function md(src: string): string {
  let html = memo.get(src);
  if (html === undefined) {
    if (memo.size > 200) memo.clear();
    memo.set(src, (html = it.render(dollars(src))));
  }
  return html;
}
