"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
  }

  focus() {}
}

class FakeFragment extends FakeNode {}

const entryFragment = () => {
  const fragment = new FakeFragment();
  const item = new FakeNode("li");
  fragment.children = [item];
  fragment.selectorMap = {
    ".entry": item,
    ".entry-marker": new FakeNode(),
    ".entry-meta": new FakeNode(),
    ".entry-date": new FakeNode(),
    ".entry-origin": new FakeNode(),
    ".entry-mood": new FakeNode(),
    h3: new FakeNode("h3"),
    ".entry-body": new FakeNode(),
    ".reply-note": new FakeNode(),
    ".local-actions": new FakeNode(),
    ".delete-local": new FakeNode("button")
  };
  return fragment;
};

const ids = [
  "#diary-title", "#diary-subtitle", "#member-list", "#filters", "#entries",
  "#local-bin", "#local-bin-list", "#status", "#entry-region", "#entry-form",
  "#entry-author", "#entry-mood", "#entry-title", "#entry-body", "#clear-draft", "#draft-status"
];
const nodes = Object.fromEntries(ids.map((id) => [id, new FakeNode()]));
nodes["#entry-template"] = { content: { cloneNode: entryFragment } };
const storage = new Map();
storage.set("kawaribanko.draft.v1", JSON.stringify({ author: "dev", mood: "🫖", title: "下書き", body: "復元される本文" }));
storage.set("kawaribanko.local-entries.v1", JSON.stringify([{
  id: "local-existing", author: "dev", date: "2026-08-09", mood: "☕", title: "ローカルの一頁", body: "正本と混ざる。", local: true, deleted: false
}]));

const document = {
  title: "",
  querySelector(selector) { return nodes[selector] || null; },
  createElement(tag) { return new FakeNode(tag); },
  createDocumentFragment() { return new FakeFragment(); }
};
const diary = JSON.parse(fs.readFileSync(path.join(__dirname, "../app/data/diary.json"), "utf8"));
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
  Error
};

vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8"), context, { filename: "app.js" });

setImmediate(() => {
  setImmediate(() => {
    const entries = nodes["#entries"];
    const form = nodes["#entry-form"];
    if (entries.children.length !== diary.entries.length + 1) throw new Error("正本とローカル投稿が同じタイムラインに描画されなかった");
    if (nodes["#diary-title"].textContent !== diary.title) throw new Error("JSON の title が描画されなかった");
    if (nodes["#entry-title"].value !== "下書き") throw new Error("下書きが復元されなかった");

    nodes["#entry-author"].value = "dev";
    nodes["#entry-mood"].value = "🙂";
    nodes["#entry-title"].value = "投稿の検証";
    nodes["#entry-body"].value = "localStorage に保存する。";
    form.listeners.submit({ preventDefault() {} });
    const saved = JSON.parse(storage.get("kawaribanko.local-entries.v1"));
    if (saved.length !== 2 || saved[1].title !== "投稿の検証") throw new Error("投稿が localStorage に保存されなかった");
    if (entries.children.length !== diary.entries.length + 2) throw new Error("投稿後の再描画に失敗した");

    entries.listeners.click({
      target: { closest: (selector) => selector === "button.delete-local" ? { dataset: { entryId: "local-existing" } } : null }
    });
    if (!JSON.parse(storage.get("kawaribanko.local-entries.v1"))[0].deleted || nodes["#local-bin"].hidden) {
      throw new Error("ローカル投稿の削除が反映されなかった");
    }
    nodes["#local-bin-list"].listeners.click({
      target: { closest: (selector) => selector === "button.restore-local" ? { dataset: { entryId: "local-existing" } } : null }
    });
    if (JSON.parse(storage.get("kawaribanko.local-entries.v1"))[0].deleted) throw new Error("削除した投稿を復元できなかった");
    process.stdout.write("render-check: fetch, DOM rendering, draft restore, local post, delete, and restore passed\n");
  });
});
