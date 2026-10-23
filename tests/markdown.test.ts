import { describe, it, expect } from "vitest";
import { md } from "../src/markdown";

describe("md renders", () => {
  it.each([
    ["**b**", "<strong>b</strong>"],
    ["- a", "<ul>"],
    ["| a | b |\n|---|---|\n| 1 | 2 |", "<table>"],
    ["[x](https://e.com)", '<a href="https://e.com" target="_blank" rel="noreferrer">x</a>'],
    ["```ts\nconst a = 1\n```", '<span class="hljs-keyword">const</span>'],
    ["```ts\nconst a = 1\n```", '<button type="button" class="copy" aria-label="Copy code">Copy</button>'],
  ])("md(%j) contains %s", (src, html) => {
    expect(md(src)).toContain(html);
  });

  it.each(["$x^2$", "$$\\frac12$$", "\\(y\\)", "\\[z\\]", "Area is \\(r^2\\) here", "So\n\\[\nz = 1\n\\]\ndone"])("md(%j) renders KaTeX", (src) => {
    expect(md(src)).toContain('class="katex');
  });

  it("md leaves dollar prices as text", () => {
    expect(md("costs $5 and $10")).not.toContain("katex");
  });
});

describe("md safe", () => {
  it("escapes raw HTML", () => {
    expect(md("<img src=x onerror=alert(1)>")).toContain("&lt;img");
  });

  it("drops javascript: links", () => {
    expect(md("[x](javascript:alert(1))")).not.toContain('href="javascript');
  });

  it("drops images", () => {
    expect(md("![a](https://e.com/a.png)")).not.toContain("<img");
  });

  it("keeps \\[ \\] inside code", () => {
    const html = md("```py\nre.compile(r'\\[a\\]')\n```");

    expect(html).toContain("\\[a\\]");
    expect(html).not.toContain("katex");
  });
});
