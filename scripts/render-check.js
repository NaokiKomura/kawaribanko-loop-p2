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
const existsInTemplate = (selector) => selector.startsWith(".")
  ? new RegExp(`\\bclass=["'][^"']*\\b${selector.slice(1)}\\b`, "i").test(templateHtml)
  : new RegExp(`<${selector}\\b`, "i").test(templateHtml);
const missingTemplateSelectors = [...new Set(templateSelectors)].filter((selector) => !existsInTemplate(selector));
if (missingIds.length || missingTemplateSelectors.length) {
  throw new Error(`index.html と app.js の DOM 契約が壊れています: ${[...missingIds, ...missingTemplateSelectors].join(", ")}`);
}

const diary = JSON.parse(fs.readFileSync(path.join(appDir, "data/diary.json"), "utf8"));
const waitForRender = () => new Promise((resolve) => setImmediate(resolve));

const boot = async (storage = new Map()) => {
  let latestBlob = null;
  let nodes;
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
    replaceChildren(...items) { this.children = []; this.append(...items); }
    querySelector(selector) { return this.selectorMap?.[selector] || null; }
    setAttribute(name, value) { this.attributes = this.attributes || {}; this.attributes[name] = value; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    reset() {
      ["#entry-author", "#entry-mood", "#entry-title", "#entry-body", "#entry-reply-to"].forEach((id) => { nodes[id].value = ""; });
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
  nodes = Object.fromEntries(ids.map((id) => [id, new FakeNode()]));
  nodes["#entry-template"] = { content: { cloneNode: entryFragment } };
  const document = {
    title: "",
    querySelector(selector) { return nodes[selector] || null; },
    createElement(tag) { return new FakeNode(tag); },
    createDocumentFragment() { return new FakeFragment(); }
  };
  class CaptureBlob {
    constructor(parts) { this.text = parts.join(""); latestBlob = this; }
  }
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
    Intl, Date, Map, Math, Object, Array, JSON, Error,
    Blob: CaptureBlob,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }
  };
  vm.runInNewContext(appSource, context, { filename: "app.js" });
  await waitForRender();
  return {
    nodes,
    storage,
    exported() {
      nodes["#export-local"].listeners.click();
      if (!latestBlob) throw new Error("書き出しが Blob を作らなかった");
      return JSON.parse(latestBlob.text);
    },
    async importPayload(payload) {
      nodes["#import-file"].files = [{ text: async () => JSON.stringify(payload) }];
      await nodes["#import-local"].listeners.click();
    }
  };
};

const localEntries = (app) => JSON.parse(app.storage.get("kawaribanko.local-entries.v1") || "[]");

const main = async () => {
  const writers = diary.members.filter((member) => member.id !== "owner");
  if (writers.length < 3 || !diary.entries.length) throw new Error("検証用の日記データに必要な書き手またはページがありません");
  const [firstWriter, secondWriter, thirdWriter] = writers;
  const baseReply = diary.entries[0].id;
  const handoffA = { memberOrder: writers.map((member) => member.id), parentId: "local-a", nextAuthor: secondWriter.id };
  const aStorage = new Map();
  aStorage.set("kawaribanko.draft.v1", JSON.stringify({ author: firstWriter.id, mood: "🫖", title: "下書き", body: "復元される本文", replyTo: baseReply }));
  aStorage.set("kawaribanko.local-entries.v1", JSON.stringify([{
    id: "local-a", author: firstWriter.id, date: "2000-01-01", mood: "☕", title: "__render_check_token_7f3__", body: "正本と混ざる。", replyTo: baseReply, local: true, deleted: false
  }]));
  aStorage.set("kawaribanko.handoff.v1", JSON.stringify(handoffA));
  const a = await boot(aStorage);
  const entries = a.nodes["#entries"];
  const baseCount = diary.entries.length;
  if (entries.children.length !== baseCount + 1) throw new Error("正本とローカル投稿が同じタイムラインに描画されなかった");
  if (a.nodes["#diary-title"].textContent !== diary.title) throw new Error("JSON の title が描画されなかった");
  if (a.nodes["#entry-title"].value !== "下書き" || a.nodes["#entry-reply-to"].value !== baseReply) throw new Error("下書きまたは返信先が復元されなかった");
  if (!a.nodes["#turn-status"].textContent.includes("さんの番")) throw new Error("次の番が表示されなかった");
  if (!a.nodes["#cycle-nav"].children.length) throw new Error("サイクル別の目次が描画されなかった");

  a.nodes["#entry-search"].value = "__render_check_token_7f3__";
  a.nodes["#entry-search"].listeners.input();
  if (entries.children.length !== 1) throw new Error("正本と切り離した検索結果を絞り込めなかった");
  let prevented = false;
  entries.listeners.click({
    preventDefault() { prevented = true; },
    target: { closest: (selector) => selector === "a[data-entry-target]" ? { dataset: { entryTarget: baseReply } } : null }
  });
  if (!prevented || a.nodes["#entry-search"].value || entries.children.length !== baseCount + 1) throw new Error("検索中の返信リンクが表示条件を解除して追えなかった");
  a.nodes["#filters"].listeners.click({ target: { closest: (selector) => selector === "button[data-author]" ? { dataset: { author: firstWriter.id } } : null } });
  prevented = false;
  entries.listeners.click({
    preventDefault() { prevented = true; },
    target: { closest: (selector) => selector === "a[data-entry-target]" ? { dataset: { entryTarget: "local-a" } } : null }
  });
  if (prevented) throw new Error("表示中の返信先まで絞り込みを解除した");
  a.nodes["#filters"].listeners.click({ target: { closest: (selector) => selector === "button[data-author]" ? { dataset: { author: "all" } } : null } });
  a.nodes["#entry-search"].value = "__missing_render_check_token__";
  a.nodes["#entry-search"].listeners.input();
  if (!entries.children[0].textContent.includes("一致する日記はありません")) throw new Error("検索結果ゼロの説明が原因に合っていない");
  a.nodes["#entry-search"].value = "";
  a.nodes["#entry-search"].listeners.input();

  const transferA = a.exported();
  if (transferA.version !== 3 || !transferA.handoff || transferA.handoff.parentId !== "local-a" || Object.keys(transferA.branchSelections).length) throw new Error("version 3 の引き継ぎが書き出されなかった");
  const legacy = await boot(new Map());
  await legacy.importPayload({ version: 1, entries: [transferA.entries[0]] });
  if (localEntries(legacy).length !== 1 || !legacy.nodes["#transfer-status"].textContent.includes("旧形式")) throw new Error("version 1 のバックアップを互換取り込みできなかった");
  const b = await boot(new Map());
  await b.importPayload(transferA);
  if (localEntries(b).length !== 1 || !b.nodes["#turn-status"].textContent.includes(secondWriter.name)) throw new Error("引き継ぎを受けた端末で次の番を案内できなかった");

  b.nodes["#entry-author"].value = secondWriter.id;
  b.nodes["#entry-mood"].value = "🔁";
  b.nodes["#entry-title"].value = "B からの新しい頁";
  b.nodes["#entry-body"].value = "A にだけ届いていない頁。";
  b.nodes["#entry-reply-to"].value = "local-a";
  b.nodes["#entry-form"].listeners.submit({ preventDefault() {} });
  const bEntries = localEntries(b);
  const bNew = bEntries.find((entry) => entry.id !== "local-a");
  if (!bNew || bNew.handoffParentId !== "local-a") throw new Error("新しい頁が受け取った引き継ぎ元を保存しなかった");
  const transferB = b.exported();
  const beforeRoundtrip = localEntries(a);
  await a.importPayload(transferB);
  const afterRoundtrip = localEntries(a);
  if (afterRoundtrip.length !== beforeRoundtrip.length + 1 || !afterRoundtrip.some((entry) => entry.id === bNew.id)) throw new Error("A→B→A の往復で B の新しい頁だけを受け取れなかった");
  if (afterRoundtrip.find((entry) => entry.id === "local-a").body !== beforeRoundtrip.find((entry) => entry.id === "local-a").body) throw new Error("再会したページが往復で変わった");

  const turnBeforeDelete = a.exported().handoff;
  a.nodes["#entries"].listeners.click({
    target: { closest: (selector) => selector === "button.delete-local" ? { dataset: { entryId: bNew.id } } : null }
  });
  const turnAfterDelete = a.exported().handoff;
  if (turnAfterDelete.parentId !== turnBeforeDelete.parentId || turnAfterDelete.nextAuthor !== turnBeforeDelete.nextAuthor || !a.nodes["#turn-status"].textContent.includes(thirdWriter.name)) {
    throw new Error("親ページを端末内で削除すると次の番が巻き戻った");
  }
  a.nodes["#local-bin-list"].listeners.click({
    target: { closest: (selector) => selector === "button.restore-local" ? { dataset: { entryId: bNew.id } } : null }
  });

  const c = await boot(new Map());
  await c.importPayload(transferA);
  c.nodes["#entry-author"].value = thirdWriter.id;
  c.nodes["#entry-mood"].value = "🌿";
  c.nodes["#entry-title"].value = "C からの別の頁";
  c.nodes["#entry-body"].value = "同じ親から別の端末が進んだ頁。";
  c.nodes["#entry-reply-to"].value = "local-a";
  c.nodes["#entry-form"].listeners.submit({ preventDefault() {} });
  const cNew = localEntries(c).find((entry) => entry.id !== "local-a");
  await a.importPayload(c.exported());
  if (a.nodes["#branch-panel"].hidden || a.nodes["#branch-list"].children.length !== 1) throw new Error("同じ引き継ぎ元から進んだ二つの枝を表示しなかった");
  const branchOptions = a.nodes["#branch-list"].children[0].children[1].children;
  const cOption = branchOptions.find((option) => option.dataset.branchRoot === cNew.id);
  if (branchOptions.length !== 2 || !cOption) throw new Error("共通の親の両方の枝を選択肢として残さなかった");
  a.nodes["#branch-list"].listeners.click({
    target: { closest: (selector) => selector === "button[data-branch-parent][data-branch-root]" ? cOption : null }
  });
  const storedSelections = JSON.parse(a.storage.get("kawaribanko.branch-selections.v1") || "{}");
  const chosenTransfer = a.exported();
  if (storedSelections["local-a"] !== cNew.id || chosenTransfer.branchSelections["local-a"] !== cNew.id || chosenTransfer.handoff.parentId !== cNew.id) {
    throw new Error("選んだ枝を端末保存または受け渡しに残せなかった");
  }
  const d = await boot(new Map());
  await d.importPayload(chosenTransfer);
  if (JSON.parse(d.storage.get("kawaribanko.branch-selections.v1") || "{}")["local-a"] !== cNew.id) throw new Error("受け取った端末へ枝の選択を持ち運べなかった");

  const conflicting = JSON.parse(JSON.stringify(transferB));
  conflicting.entries.find((entry) => entry.id === bNew.id).body = "同じ ID なのに本文だけ違う。";
  const beforeConflict = JSON.stringify(localEntries(a));
  await a.importPayload(conflicting);
  if (JSON.stringify(localEntries(a)) !== beforeConflict || !a.nodes["#transfer-status"].textContent.includes("本文")) throw new Error("内容が違う同一 ID を原子的に拒否できなかった");

  const badPosition = {
    version: 3,
    entries: [transferA.entries[0], {
      id: "local-bad-position", author: firstWriter.id, date: "2000-01-02", mood: "🪤", title: "位置を確かめる頁", body: "再会の後に壊れた返信先を置く。", replyTo: "missing-page", handoffParentId: null
    }],
    handoff: transferA.handoff,
    branchSelections: {}
  };
  await d.importPayload(badPosition);
  if (!d.nodes["#transfer-status"].textContent.includes("2件目")) throw new Error("再会を飛ばした後の取り込みエラー位置がずれた");

  process.stdout.write("render-check: DOM contract, reading filters, v1-v3 handoff, deletion, branch choice, roundtrip, and conflicts passed\n");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
