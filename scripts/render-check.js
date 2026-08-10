"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appDir = path.join(__dirname, "../app");
const index = fs.readFileSync(path.join(appDir, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(appDir, "app.js"), "utf8");
const templateMatch = index.match(/<template\b[^>]*\bid=["']entry-template["'][^>]*>([\s\S]*?)<\/template>/i);

if (!templateMatch) throw new Error("index.html に #entry-template がありません");
const templateHtml = templateMatch[1];
const idSelectors = [...appSource.matchAll(/document\.querySelector\(\s*["'](#[\w-]+)["']\s*\)/g)].map((match) => match[1]);
const templateSelectors = [...appSource.matchAll(/node\.querySelector\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
const missingIds = [...new Set(idSelectors)].filter((selector) => !new RegExp(`\\bid=["']${selector.slice(1)}["']`, "i").test(index));
const existsInTemplate = (selector) => {
  if (selector.startsWith(".")) return new RegExp(`\\bclass=["'][^"']*\\b${selector.slice(1)}\\b`, "i").test(templateHtml);
  return new RegExp(`<${selector}\\b`, "i").test(templateHtml);
};
const missingTemplateSelectors = [...new Set(templateSelectors)].filter((selector) => !existsInTemplate(selector));
if (missingIds.length || missingTemplateSelectors.length) {
  throw new Error(`index.html と app.js の DOM 契約が壊れています: ${[...missingIds, ...missingTemplateSelectors].join(", ")}`);
}

class FakeNode {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = { setProperty() {} };
    this.classList = { add() {} };
    this.listeners = {};
    this.hidden = false;
    this.value = "";
  }

  append(...items) {
    items.forEach((item) => {
      if (item instanceof FakeFragment) this.children.push(...item.children);
      else this.children.push(item);
    });
  }

  replaceChildren(...items) {
    this.children = [];
    this.append(...items);
  }

  querySelector(selector) {
    return this.selectorMap?.[selector] || null;
  }

  setAttribute(name, value) {
    this.attributes = this.attributes || {};
    this.attributes[name] = value;
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  reset() {
    this.resetCalled = true;
    [nodes["#entry-author"], nodes["#entry-mood"], nodes["#entry-title"], nodes["#entry-body"], nodes["#entry-reply-to"]].forEach((node) => { node.value = ""; });
  }

  click() {}
  focus() {}
}

class FakeFragment extends FakeNode {}

const entryFragment = () => {
  const fragment = new FakeFragment();
  const item = new FakeNode("li");
  fragment.children = [item];
  fragment.selectorMap = Object.fromEntries(templateSelectors.map((selector) => [selector, selector === ".entry" ? item : new FakeNode(selector)]));
  return fragment;
};

const ids = [...new Set(idSelectors)];
const nodes = Object.fromEntries(ids.map((id) => [id, new FakeNode()]));
nodes["#entry-template"] = { content: { cloneNode: entryFragment } };
const storage = new Map();
storage.set("kawaribanko.draft.v1", JSON.stringify({ author: "dev", mood: "🫖", title: "下書き", body: "復元される本文", replyTo: "c2-feedback" }));
storage.set("kawaribanko.local-entries.v1", JSON.stringify([{
  id: "local-existing", author: "dev", date: "2026-08-09", mood: "☕", title: "ローカルの一頁", body: "正本と混ざる。", local: true, deleted: false
}]));

const document = {
  title: "",
  querySelector(selector) { return nodes[selector] || null; },
  createElement(tag) { return new FakeNode(tag); },
  createDocumentFragment() { return new FakeFragment(); }
};
const diary = JSON.parse(fs.readFileSync(path.join(appDir, "data/diary.json"), "utf8"));
const context = {
  console,
  document,
  localStorage: {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  },
  fetch: async () => ({ ok: true, json: async () => diary }),
  requestAnimationFrame: (callback) => callback(),
  Intl,
  Date,
  Map,
  Math,
  Object,
  Array,
  JSON,
  Error,
  Blob: class {},
  URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }
};

vm.runInNewContext(appSource, context, { filename: "app.js" });

setImmediate(async () => {
  const entries = nodes["#entries"];
  const form = nodes["#entry-form"];
  if (entries.children.length !== diary.entries.length + 1) throw new Error("正本とローカル投稿が同じタイムラインに描画されなかった");
  if (nodes["#diary-title"].textContent !== diary.title) throw new Error("JSON の title が描画されなかった");
  if (nodes["#entry-title"].value !== "下書き" || nodes["#entry-reply-to"].value !== "c2-feedback") throw new Error("下書きまたは返信先が復元されなかった");

  nodes["#entry-author"].value = "dev";
  nodes["#entry-mood"].value = "🙂";
  nodes["#entry-title"].value = "投稿の検証";
  nodes["#entry-body"].value = "localStorage に保存する。";
  nodes["#entry-reply-to"].value = "c2-feedback";
  form.listeners.submit({ preventDefault() {} });
  let saved = JSON.parse(storage.get("kawaribanko.local-entries.v1"));
  if (saved.length !== 2 || saved[1].title !== "投稿の検証" || saved[1].replyTo !== "c2-feedback") throw new Error("返信付き投稿が localStorage に保存されなかった");
  if (entries.children.length !== diary.entries.length + 2) throw new Error("投稿後の再描画に失敗した");

  entries.listeners.click({
    target: { closest: (selector) => selector === "button.delete-local" ? { dataset: { entryId: "local-existing" } } : null }
  });
  if (!JSON.parse(storage.get("kawaribanko.local-entries.v1"))[0].deleted || nodes["#local-bin"].hidden) throw new Error("ローカル投稿の削除が反映されなかった");
  nodes["#local-bin-list"].listeners.click({
    target: { closest: (selector) => selector === "button.restore-local" ? { dataset: { entryId: "local-existing" } } : null }
  });
  if (JSON.parse(storage.get("kawaribanko.local-entries.v1"))[0].deleted) throw new Error("削除した投稿を復元できなかった");

  nodes["#import-file"].files = [{ text: async () => JSON.stringify({ version: 1, entries: [{
    id: "local-imported", author: "slides", date: "2026-08-10", mood: "📦", title: "持ち運びの検証", body: "別の端末から届く。", replyTo: "c2-feedback"
  }] }) }];
  await nodes["#import-local"].listeners.click();
  saved = JSON.parse(storage.get("kawaribanko.local-entries.v1"));
  if (saved.length !== 3 || saved[2].origin !== "imported") throw new Error("検証済みの投稿を取り込めなかった");
  await nodes["#import-local"].listeners.click();
  if (JSON.parse(storage.get("kawaribanko.local-entries.v1")).length !== 3) throw new Error("ID 衝突した取り込みが既存投稿を変えた");
  nodes["#entry-search"].value = "持ち運び";
  nodes["#entry-search"].listeners.input();
  if (entries.children.length !== 1) throw new Error("検索結果を絞り込めなかった");

  process.stdout.write("render-check: DOM contract, fetch, replies, draft, local post, delete/restore, import, and search passed\n");
});
