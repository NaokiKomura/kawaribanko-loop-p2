(() => {
  "use strict";

  const DATA_URL = "data/diary.json";
  const STORAGE_KEY = "kawaribanko.local-entries.v1";
  const DRAFT_KEY = "kawaribanko.draft.v1";
  const TRANSFER_VERSION = 2;
  const HANDOFF_KEY = "kawaribanko.handoff.v1";
  const limits = { mood: 8, title: 80, body: 1200 };
  const elements = {
    title: document.querySelector("#diary-title"),
    subtitle: document.querySelector("#diary-subtitle"),
    members: document.querySelector("#member-list"),
    filters: document.querySelector("#filters"),
    search: document.querySelector("#entry-search"),
    entries: document.querySelector("#entries"),
    localBin: document.querySelector("#local-bin"),
    localBinList: document.querySelector("#local-bin-list"),
    status: document.querySelector("#status"),
    template: document.querySelector("#entry-template"),
    entryRegion: document.querySelector("#entry-region"),
    form: document.querySelector("#entry-form"),
    author: document.querySelector("#entry-author"),
    mood: document.querySelector("#entry-mood"),
    entryTitle: document.querySelector("#entry-title"),
    body: document.querySelector("#entry-body"),
    replyTo: document.querySelector("#entry-reply-to"),
    clearDraft: document.querySelector("#clear-draft"),
    draftStatus: document.querySelector("#draft-status"),
    exportLocal: document.querySelector("#export-local"),
    importFile: document.querySelector("#import-file"),
    importLocal: document.querySelector("#import-local"),
    transferStatus: document.querySelector("#transfer-status"),
    turnStatus: document.querySelector("#turn-status"),
    turnDetail: document.querySelector("#turn-detail"),
    cycleNav: document.querySelector("#cycle-nav")
  };

  let diary = null;
  let localEntries = [];
  let selectedAuthor = "all";
  let searchTerm = "";
  let handoff = null;

  const formatDate = (date) => {
    const parsed = new Date(`${date}T00:00:00`);
    return Number.isNaN(parsed.valueOf())
      ? date
      : new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(parsed);
  };

  const today = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now - offset).toISOString().slice(0, 10);
  };

  const setStatus = (message, kind = "") => {
    elements.status.textContent = message;
    elements.status.className = `status ${kind}`.trim();
  };

  const safeRead = (key, fallback) => {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      console.warn("Local diary storage could not be read:", error);
      return fallback;
    }
  };

  const safeWrite = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error("Local diary storage could not be saved:", error);
      setStatus("この端末への保存に失敗しました。ブラウザの保存領域を確認してください。", "error");
      return false;
    }
  };

  const safeRemove = (key) => {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error("Local diary storage could not be cleared:", error);
      return false;
    }
  };

  const isLocalEntry = (entry) => entry && typeof entry.id === "string" && entry.id.startsWith("local-")
    && typeof entry.author === "string" && typeof entry.date === "string"
    && typeof entry.mood === "string" && typeof entry.title === "string" && typeof entry.body === "string";

  const loadLocalEntries = () => {
    const stored = safeRead(STORAGE_KEY, []);
    localEntries = Array.isArray(stored)
      ? stored.filter(isLocalEntry).map((entry) => ({
        ...entry,
        local: true,
        origin: entry.origin === "imported" ? "imported" : "local",
        deleted: Boolean(entry.deleted),
        replyTo: typeof entry.replyTo === "string" ? entry.replyTo : null,
        handoffParentId: typeof entry.handoffParentId === "string" ? entry.handoffParentId : null
      }))
      : [];
  };

  const allEntries = () => [...diary.entries, ...localEntries.filter((entry) => !entry.deleted)];

  const memberOrder = () => diary.members.filter((member) => member.id !== "owner").map((member) => member.id);

  const nextAuthorAfter = (author, order = memberOrder()) => {
    const index = order.indexOf(author);
    return index < 0 ? order[0] : order[(index + 1) % order.length];
  };

  const orderedEntries = () => {
    const orderValue = (entry) => Number.isInteger(entry.cycle) ? entry.cycle : Number.MAX_SAFE_INTEGER;
    return allEntries().sort((a, b) => a.date.localeCompare(b.date) || orderValue(a) - orderValue(b) || a.id.localeCompare(b.id));
  };

  const defaultHandoff = () => {
    const latest = orderedEntries().at(-1);
    const order = memberOrder();
    return latest ? { memberOrder: order, parentId: latest.id, nextAuthor: nextAuthorAfter(latest.author, order) } : null;
  };

  const isHandoff = (value, knownIds = new Set(allEntries().map((entry) => entry.id))) => {
    const order = memberOrder();
    return Boolean(value && typeof value === "object" && Array.isArray(value.memberOrder)
      && value.memberOrder.length === order.length && value.memberOrder.every((id, index) => id === order[index])
      && typeof value.parentId === "string" && knownIds.has(value.parentId)
      && typeof value.nextAuthor === "string" && order.includes(value.nextAuthor));
  };

  const loadHandoff = () => {
    const stored = safeRead(HANDOFF_KEY, null);
    handoff = isHandoff(stored) ? stored : defaultHandoff();
  };

  const saveHandoff = (next) => {
    if (!next || !safeWrite(HANDOFF_KEY, next)) return false;
    handoff = next;
    return true;
  };

  const memberFor = (id) => diary.members.find((member) => member.id === id) || {
    id,
    name: "不明な書き手",
    emoji: "✏️",
    color: "#746d65"
  };

  const renderMembers = () => {
    const fragment = document.createDocumentFragment();
    diary.members.forEach((member) => {
      const chip = document.createElement("span");
      chip.className = "member-chip";
      chip.style.setProperty("--member-color", member.color);
      chip.textContent = `${member.emoji} ${member.name}`;
      fragment.append(chip);
    });
    elements.members.replaceChildren(fragment);
  };

  const renderAuthors = () => {
    const fragment = document.createDocumentFragment();
    diary.members.filter((member) => member.id !== "owner").forEach((member) => {
      const option = document.createElement("option");
      option.value = member.id;
      option.textContent = `${member.emoji} ${member.name}`;
      fragment.append(option);
    });
    elements.author.replaceChildren(fragment);
  };

  const renderReplyOptions = () => {
    const previous = elements.replyTo.value;
    const fragment = document.createDocumentFragment();
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "返事を指定しない";
    fragment.append(blank);
    allEntries().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = `${memberFor(entry.author).name}「${entry.title}」`;
      fragment.append(option);
    });
    elements.replyTo.replaceChildren(fragment);
    elements.replyTo.value = previous;
  };

  const renderFilters = () => {
    const fragment = document.createDocumentFragment();
    [{ id: "all", name: "すべて", emoji: "📖", color: "#d95f45" }, ...diary.members].forEach((member) => {
      const button = document.createElement("button");
      const isSelected = member.id === selectedAuthor;
      button.className = "filter";
      button.type = "button";
      button.dataset.author = member.id;
      button.setAttribute("aria-pressed", String(isSelected));
      button.style.setProperty("--filter-color", member.color);
      button.style.setProperty("--filter-bg", `${member.color}18`);
      button.textContent = `${member.emoji} ${member.name}`;
      fragment.append(button);
    });
    elements.filters.replaceChildren(fragment);
  };

  const renderCycleNav = () => {
    const firstByCycle = new Map();
    orderedEntries().forEach((entry) => {
      if (Number.isInteger(entry.cycle) && !firstByCycle.has(entry.cycle)) firstByCycle.set(entry.cycle, entry);
    });
    const fragment = document.createDocumentFragment();
    firstByCycle.forEach((entry, cycle) => {
      const link = document.createElement("a");
      link.href = `#entry-${entry.id}`;
      link.dataset.entryTarget = entry.id;
      link.textContent = `cycle ${cycle}`;
      fragment.append(link);
    });
    elements.cycleNav.replaceChildren(fragment);
  };

  const renderTurn = () => {
    if (!handoff) {
      elements.turnStatus.textContent = "最初のページを待っています。";
      elements.turnDetail.textContent = "順番は、ページが一つできてから案内します。";
      return;
    }
    const next = memberFor(handoff.nextAuthor);
    const parent = allEntries().find((entry) => entry.id === handoff.parentId);
    elements.turnStatus.textContent = `いまは ${next.emoji} ${next.name}さんの番です。`;
    elements.turnDetail.textContent = parent
      ? `「${memberFor(parent.author).name}」の「${parent.title}」を受け取り、次の人を案内しています。順番外の投稿も消しません。`
      : "次の人を案内しています。順番外の投稿も消しません。";
  };

  const replyText = (entry, entriesById) => {
    if (!entry.replyTo) return null;
    const target = entriesById.get(entry.replyTo);
    if (!target) return { id: null, label: "前のページへの返事" };
    return { id: target.id, label: `「${memberFor(target.author).name}」の「${target.title}」への返事` };
  };

  const renderEntries = () => {
    const ordered = orderedEntries();
    const byAuthor = selectedAuthor === "all" ? ordered : ordered.filter((entry) => entry.author === selectedAuthor);
    const query = searchTerm.toLocaleLowerCase("ja-JP");
    const visible = query ? byAuthor.filter((entry) => [entry.title, entry.body, entry.mood, memberFor(entry.author).name].join(" ").toLocaleLowerCase("ja-JP").includes(query)) : byAuthor;
    const entriesById = new Map(allEntries().map((entry) => [entry.id, entry]));
    const repliesByTarget = new Map();
    allEntries().forEach((entry) => {
      if (!entry.replyTo || !entriesById.has(entry.replyTo)) return;
      const replies = repliesByTarget.get(entry.replyTo) || [];
      replies.push(entry);
      repliesByTarget.set(entry.replyTo, replies);
    });
    const fragment = document.createDocumentFragment();

    visible.forEach((entry) => {
      const member = memberFor(entry.author);
      const node = elements.template.content.cloneNode(true);
      const item = node.querySelector(".entry");
      const marker = node.querySelector(".entry-marker");
      const meta = node.querySelector(".entry-meta");
      const date = node.querySelector(".entry-date");
      const origin = node.querySelector(".entry-origin");
      const mood = node.querySelector(".entry-mood");
      const title = node.querySelector("h3");
      const body = node.querySelector(".entry-body");
      const reply = node.querySelector(".reply-note");
      const replyFrom = node.querySelector(".reply-from");
      const actions = node.querySelector(".local-actions");
      const remove = node.querySelector(".delete-local");

      item.id = `entry-${entry.id}`;
      item.tabIndex = -1;
      item.style.setProperty("--member-color", member.color);
      if (entry.local) item.classList.add("entry-local");
      marker.style.background = member.color;
      meta.textContent = `${member.emoji} ${member.name} · ${entry.cycle ? `cycle ${entry.cycle}` : "ローカル"}`;
      date.textContent = formatDate(entry.date);
      if (entry.local) {
        origin.hidden = false;
        origin.textContent = entry.origin === "imported" ? "ほかの端末から取り込んだ投稿" : "このブラウザだけの投稿";
      }
      mood.textContent = entry.mood || "✏️";
      mood.setAttribute("aria-label", `今日の気分: ${entry.mood || "未設定"}`);
      title.textContent = entry.title;
      body.textContent = entry.body;
      const replyInfo = replyText(entry, entriesById);
      if (replyInfo) {
        reply.hidden = false;
        reply.append("↳ ");
        if (replyInfo.id) {
          const link = document.createElement("a");
          link.href = `#entry-${replyInfo.id}`;
          link.dataset.entryTarget = replyInfo.id;
          link.textContent = replyInfo.label;
          reply.append(link);
        } else {
          reply.append(replyInfo.label);
        }
      }
      const replies = repliesByTarget.get(entry.id) || [];
      if (replies.length) {
        replyFrom.hidden = false;
        replyFrom.append("このページへの返事: ");
        replies.forEach((child, index) => {
          if (index) replyFrom.append("、");
          const link = document.createElement("a");
          link.href = `#entry-${child.id}`;
          link.dataset.entryTarget = child.id;
          link.textContent = `「${memberFor(child.author).name}」の「${child.title}」`;
          replyFrom.append(link);
        });
      }
      if (entry.local) {
        actions.hidden = false;
        remove.dataset.entryId = entry.id;
      }
      fragment.append(node);
    });

    elements.entries.replaceChildren(fragment);
    if (visible.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = query
        ? `「${searchTerm}」に一致する日記はありません。検索語を変えてみてください。`
        : selectedAuthor === "all" ? "日記は、まだありません。" : "この書き手の日記は、まだありません。";
      elements.entries.append(empty);
    }
    setStatus(`${visible.length}件の日記を表示しています${query ? `（「${searchTerm}」を検索中）` : ""}`);
    renderLocalBin();
    renderReplyOptions();
    renderCycleNav();
  };

  const renderLocalBin = () => {
    const deleted = localEntries.filter((entry) => entry.deleted);
    elements.localBin.hidden = deleted.length === 0;
    const fragment = document.createDocumentFragment();
    deleted.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "local-bin-row";
      const label = document.createElement("span");
      label.textContent = `「${entry.title}」`;
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "restore-local";
      restore.dataset.entryId = entry.id;
      restore.textContent = "元に戻す";
      row.append(label, restore);
      fragment.append(row);
    });
    elements.localBinList.replaceChildren(fragment);
  };

  const render = () => {
    elements.title.textContent = diary.title || "かわりばんこ";
    document.title = `${elements.title.textContent} — ${diary.subtitle || "交換日記"}`;
    elements.subtitle.textContent = diary.subtitle || "みんなで回す、ひとつの日記帳";
    renderMembers();
    renderAuthors();
    renderFilters();
    renderEntries();
    renderTurn();
    elements.entryRegion.setAttribute("aria-busy", "false");
  };

  const draftValues = () => ({
    author: elements.author.value,
    mood: elements.mood.value,
    title: elements.entryTitle.value,
    body: elements.body.value,
    replyTo: elements.replyTo.value
  });

  const hasDraft = (draft) => Object.values(draft).some((value) => value.trim());

  const updateDraftStatus = (message) => {
    elements.draftStatus.textContent = message;
  };

  const saveDraft = () => {
    const draft = draftValues();
    if (!hasDraft(draft)) {
      if (safeRemove(DRAFT_KEY)) updateDraftStatus("下書きはまだありません。");
      return;
    }
    if (safeWrite(DRAFT_KEY, draft)) updateDraftStatus("下書きをこのブラウザに保存しました。");
  };

  const restoreDraft = () => {
    const draft = safeRead(DRAFT_KEY, null);
    if (!draft || typeof draft !== "object") return;
    ["author", "mood", "title", "body", "replyTo"].forEach((key) => {
      if (typeof draft[key] === "string") elements[key === "title" ? "entryTitle" : key].value = draft[key];
    });
    if (hasDraft(draft)) updateDraftStatus("前回の下書きを復元しました。");
  };

  const validateEntry = (entry) => {
    const messages = [];
    if (!diary.members.some((member) => member.id === entry.author && member.id !== "owner")) messages.push("書き手を選んでください。");
    if (!entry.mood || entry.mood.length > limits.mood) messages.push(`気分は1〜${limits.mood}文字で書いてください。`);
    if (!entry.title || entry.title.length > limits.title) messages.push(`見出しは1〜${limits.title}文字で書いてください。`);
    if (!entry.body || entry.body.length > limits.body) messages.push(`本文は1〜${limits.body}文字で書いてください。`);
    if (entry.replyTo && !allEntries().some((candidate) => candidate.id === entry.replyTo)) messages.push("返事を書く相手を選び直してください。");
    return messages;
  };

  const makeId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  elements.form.addEventListener("input", saveDraft);
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(Object.entries(draftValues()).map(([key, value]) => [key, value.trim()]));
    const messages = validateEntry(values);
    if (messages.length) {
      setStatus(messages.join(" "), "error");
      return;
    }
    const entry = {
      id: makeId(), cycle: null, date: today(), local: true, origin: "local", deleted: false,
      handoffParentId: handoff?.parentId || null, ...values
    };
    const next = [...localEntries, entry];
    if (!safeWrite(STORAGE_KEY, next)) return;
    localEntries = next;
    const nextHandoff = { memberOrder: memberOrder(), parentId: entry.id, nextAuthor: nextAuthorAfter(entry.author) };
    const handoffSaved = saveHandoff(nextHandoff);
    elements.form.reset();
    updateDraftStatus(safeRemove(DRAFT_KEY)
      ? "投稿しました。下書きは消去しました。"
      : "投稿しましたが、下書きの消去には失敗しました。");
    selectedAuthor = "all";
    renderFilters();
    renderEntries();
    renderTurn();
    if (!handoffSaved) setTransferStatus("投稿は保存しましたが、次の番の保存には失敗しました。次の受け渡し前に確認してください。", "error");
    const newEntry = document.querySelector(`#entry-${entry.id}`);
    if (newEntry) newEntry.focus({ preventScroll: true });
  });

  elements.clearDraft.addEventListener("click", () => {
    elements.form.reset();
    updateDraftStatus(safeRemove(DRAFT_KEY) ? "下書きを消しました。" : "下書きを消去できませんでした。");
  });

  elements.filters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-author]");
    if (!button || !diary) return;
    selectedAuthor = button.dataset.author;
    renderFilters();
    renderEntries();
  });

  elements.search.addEventListener("input", () => {
    searchTerm = elements.search.value.trim();
    renderEntries();
  });

  const revealEntry = (event, targetId) => {
    const target = allEntries().find((entry) => entry.id === targetId);
    if (!target) return;
    if (selectedAuthor === "all" && !searchTerm) return;
    event.preventDefault();
    selectedAuthor = "all";
    searchTerm = "";
    elements.search.value = "";
    renderFilters();
    renderEntries();
    requestAnimationFrame(() => document.querySelector(`#entry-${targetId}`)?.focus());
  };

  elements.entries.addEventListener("click", (event) => {
    const entryLink = event.target.closest("a[data-entry-target]");
    if (entryLink) {
      const targetId = entryLink.dataset.entryTarget;
      revealEntry(event, targetId);
      return;
    }
    const remove = event.target.closest("button.delete-local");
    if (remove) {
      const next = localEntries.map((entry) => entry.id === remove.dataset.entryId ? { ...entry, deleted: true } : entry);
      if (safeWrite(STORAGE_KEY, next)) {
        localEntries = next;
        renderEntries();
      }
      return;
    }
  });

  elements.cycleNav.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-entry-target]");
    if (link) revealEntry(event, link.dataset.entryTarget);
  });

  elements.localBinList.addEventListener("click", (event) => {
    const restore = event.target.closest("button.restore-local");
    if (!restore) return;
    const next = localEntries.map((entry) => entry.id === restore.dataset.entryId ? { ...entry, deleted: false } : entry);
    if (safeWrite(STORAGE_KEY, next)) {
      localEntries = next;
      renderEntries();
    }
  });

  const setTransferStatus = (message, kind = "") => {
    elements.transferStatus.textContent = message;
    elements.transferStatus.className = `transfer-status ${kind}`.trim();
  };

  const exportableEntry = (entry) => ({
    id: entry.id,
    cycle: null,
    author: entry.author,
    date: entry.date,
    mood: entry.mood,
    title: entry.title,
    body: entry.body,
    replyTo: entry.replyTo || null,
    handoffParentId: entry.handoffParentId || null,
    deleted: Boolean(entry.deleted)
  });

  const entryIdentity = (entry) => ({
    author: entry.author,
    date: entry.date,
    mood: entry.mood,
    title: entry.title,
    body: entry.body,
    replyTo: entry.replyTo || null,
    handoffParentId: entry.handoffParentId || null
  });

  const identityDifferences = (left, right) => Object.keys(entryIdentity(left)).filter((key) => entryIdentity(left)[key] !== entryIdentity(right)[key]);

  const identityLabel = (field) => ({
    author: "書き手", date: "日付", mood: "気分", title: "見出し", body: "本文", replyTo: "返信先", handoffParentId: "引き継ぎ元"
  }[field]);

  const validateImportedEntries = (data) => {
    if (!data || ![1, TRANSFER_VERSION].includes(data.version) || !Array.isArray(data.entries)) {
      throw new Error("対応していないファイル形式です。");
    }
    const knownEntries = new Map([...diary.entries, ...localEntries].map((entry) => [entry.id, entry]));
    const importEntries = new Map();
    const members = new Set(diary.members.filter((member) => member.id !== "owner").map((member) => member.id));
    const additions = [];
    const reencountered = [];
    data.entries.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") throw new Error(`${index + 1}件目の形式が正しくありません。`);
      if (typeof entry.id !== "string" || !entry.id.startsWith("local-") || entry.id.length > 120) throw new Error(`${index + 1}件目のIDが正しくありません。`);
      if (!members.has(entry.author)) throw new Error(`${index + 1}件目の書き手がこの日記帳にいません。`);
      if (typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) throw new Error(`${index + 1}件目の日付が正しくありません。`);
      if (typeof entry.mood !== "string" || !entry.mood || entry.mood.length > limits.mood) throw new Error(`${index + 1}件目の気分が正しくありません。`);
      if (typeof entry.title !== "string" || !entry.title || entry.title.length > limits.title) throw new Error(`${index + 1}件目の見出しが正しくありません。`);
      if (typeof entry.body !== "string" || !entry.body || entry.body.length > limits.body) throw new Error(`${index + 1}件目の本文が正しくありません。`);
      if (entry.replyTo !== null && entry.replyTo !== undefined && typeof entry.replyTo !== "string") throw new Error(`${index + 1}件目の返信先が正しくありません。`);
      if (data.version === TRANSFER_VERSION && entry.handoffParentId !== null && entry.handoffParentId !== undefined && typeof entry.handoffParentId !== "string") throw new Error(`${index + 1}件目の引き継ぎ元が正しくありません。`);
      const candidate = {
        ...entry, cycle: null, local: true, origin: "imported", deleted: Boolean(entry.deleted), replyTo: entry.replyTo || null,
        handoffParentId: typeof entry.handoffParentId === "string" ? entry.handoffParentId : null
      };
      const previous = knownEntries.get(candidate.id) || importEntries.get(candidate.id);
      if (previous) {
        const differences = identityDifferences(previous, candidate);
        if (differences.length) throw new Error(`ID「${candidate.id}」は ${differences.map(identityLabel).join("・")} が既存のページと食い違います。何も取り込みませんでした。`);
        reencountered.push(candidate.id);
        return;
      }
      importEntries.set(candidate.id, candidate);
      additions.push(candidate);
    });
    const knownIds = new Set([...knownEntries.keys(), ...importEntries.keys()]);
    additions.forEach((entry, index) => {
      if (entry.replyTo && !knownIds.has(entry.replyTo)) {
        throw new Error(`${index + 1}件目の返信先が見つかりません。`);
      }
      if (entry.handoffParentId && !knownIds.has(entry.handoffParentId)) {
        throw new Error(`${index + 1}件目の引き継ぎ元が見つかりません。`);
      }
    });
    const importedHandoff = data.version === TRANSFER_VERSION ? data.handoff : null;
    if (data.version === TRANSFER_VERSION && !isHandoff(importedHandoff, knownIds)) {
      throw new Error("引き継ぎ情報が正しくありません。何も取り込みませんでした。");
    }
    if (importedHandoff) {
      const parent = importEntries.get(importedHandoff.parentId) || knownEntries.get(importedHandoff.parentId);
      if (importedHandoff.nextAuthor !== nextAuthorAfter(parent.author, importedHandoff.memberOrder)) {
        throw new Error("引き継ぎ情報の次の書き手が親ページと一致しません。何も取り込みませんでした。");
      }
    }
    return { additions, reencountered, handoff: importedHandoff, legacy: data.version === 1 };
  };

  elements.exportLocal.addEventListener("click", () => {
    const outgoingHandoff = handoff || defaultHandoff();
    const payload = { version: TRANSFER_VERSION, exportedAt: new Date().toISOString(), entries: localEntries.map(exportableEntry), handoff: outgoingHandoff };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kawaribanko-${today()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setTransferStatus(`${localEntries.length}件の端末内投稿と、次の番を書き出しました。`);
  });

  elements.importLocal.addEventListener("click", async () => {
    const file = elements.importFile.files?.[0];
    if (!file) {
      setTransferStatus("先に取り込む JSON ファイルを選んでください。", "error");
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      const incoming = validateImportedEntries(data);
      const next = [...localEntries, ...incoming.additions];
      if (!safeWrite(STORAGE_KEY, next)) return;
      localEntries = next;
      const handoffSaved = !incoming.handoff || saveHandoff(incoming.handoff);
      elements.importFile.value = "";
      renderEntries();
      renderTurn();
      if (!handoffSaved) {
        setTransferStatus(`${incoming.additions.length}件は取り込みましたが、次の番の保存には失敗しました。`, "error");
      } else if (incoming.legacy) {
        setTransferStatus(`${incoming.additions.length}件を旧形式から取り込みました。次の番はこの端末で推定しています。`);
      } else {
        const skipped = incoming.reencountered.length ? `、再会した${incoming.reencountered.length}件はそのままにしました` : "";
        setTransferStatus(`${incoming.additions.length}件を取り込みました${skipped}。正本の日記は変更していません。`);
      }
    } catch (error) {
      setTransferStatus(`取り込みませんでした: ${error.message}`, "error");
    }
  });

  fetch(DATA_URL, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      if (!Array.isArray(data.members) || !Array.isArray(data.entries)) {
        throw new Error("日記データの形式が正しくありません");
      }
      diary = data;
      loadLocalEntries();
      loadHandoff();
      render();
      restoreDraft();
    })
    .catch((error) => {
      console.error("Diary data could not be loaded:", error);
      elements.entryRegion.setAttribute("aria-busy", "false");
      setStatus("日記を開けませんでした。サーバーを起動して、もう一度読み込んでください。", "error");
    });
})();
