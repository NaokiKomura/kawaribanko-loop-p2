(() => {
  "use strict";

  const DATA_URL = "data/diary.json";
  const STORAGE_KEY = "kawaribanko.local-entries.v1";
  const DRAFT_KEY = "kawaribanko.draft.v1";
  const limits = { mood: 8, title: 80, body: 1200 };
  const elements = {
    title: document.querySelector("#diary-title"),
    subtitle: document.querySelector("#diary-subtitle"),
    members: document.querySelector("#member-list"),
    filters: document.querySelector("#filters"),
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
    clearDraft: document.querySelector("#clear-draft"),
    draftStatus: document.querySelector("#draft-status")
  };

  let diary = null;
  let localEntries = [];
  let selectedAuthor = "all";

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
    && typeof entry.title === "string" && typeof entry.body === "string";

  const loadLocalEntries = () => {
    const stored = safeRead(STORAGE_KEY, []);
    localEntries = Array.isArray(stored)
      ? stored.filter(isLocalEntry).map((entry) => ({ ...entry, local: true, deleted: Boolean(entry.deleted) }))
      : [];
  };

  const allEntries = () => [...diary.entries, ...localEntries.filter((entry) => !entry.deleted)];

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

  const replyText = (entry, entriesById) => {
    if (!entry.replyTo) return null;
    const target = entriesById.get(entry.replyTo);
    if (!target) return { id: null, label: "前のページへの返事" };
    return { id: target.id, label: `「${memberFor(target.author).name}」の「${target.title}」への返事` };
  };

  const renderEntries = () => {
    const orderValue = (entry) => Number.isInteger(entry.cycle) ? entry.cycle : Number.MAX_SAFE_INTEGER;
    const ordered = allEntries().sort((a, b) => a.date.localeCompare(b.date) || orderValue(a) - orderValue(b) || a.id.localeCompare(b.id));
    const visible = selectedAuthor === "all" ? ordered : ordered.filter((entry) => entry.author === selectedAuthor);
    const entriesById = new Map(allEntries().map((entry) => [entry.id, entry]));
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
        origin.textContent = "このブラウザだけの投稿";
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
          link.dataset.replyTarget = replyInfo.id;
          link.textContent = replyInfo.label;
          reply.append(link);
        } else {
          reply.append(replyInfo.label);
        }
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
      empty.textContent = "この書き手の日記は、まだありません。";
      elements.entries.append(empty);
    }
    setStatus(`${visible.length}件の日記を表示しています`);
    renderLocalBin();
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
    elements.entryRegion.setAttribute("aria-busy", "false");
  };

  const draftValues = () => ({
    author: elements.author.value,
    mood: elements.mood.value,
    title: elements.entryTitle.value,
    body: elements.body.value
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
    ["author", "mood", "title", "body"].forEach((key) => {
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
    const entry = { id: makeId(), cycle: null, date: today(), local: true, deleted: false, ...values };
    const next = [...localEntries, entry];
    if (!safeWrite(STORAGE_KEY, next)) return;
    localEntries = next;
    elements.form.reset();
    updateDraftStatus(safeRemove(DRAFT_KEY)
      ? "投稿しました。下書きは消去しました。"
      : "投稿しましたが、下書きの消去には失敗しました。");
    selectedAuthor = "all";
    renderFilters();
    renderEntries();
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

  elements.entries.addEventListener("click", (event) => {
    const replyLink = event.target.closest("a[data-reply-target]");
    if (replyLink) {
      const targetId = replyLink.dataset.replyTarget;
      const target = allEntries().find((entry) => entry.id === targetId);
      if (target && selectedAuthor !== "all" && target.author !== selectedAuthor) {
        event.preventDefault();
        selectedAuthor = "all";
        renderFilters();
        renderEntries();
        requestAnimationFrame(() => document.querySelector(`#entry-${targetId}`)?.focus());
      }
      return;
    }
    const remove = event.target.closest("button.delete-local");
    if (remove) {
      localEntries = localEntries.map((entry) => entry.id === remove.dataset.entryId ? { ...entry, deleted: true } : entry);
      if (safeWrite(STORAGE_KEY, localEntries)) renderEntries();
      return;
    }
  });

  elements.localBinList.addEventListener("click", (event) => {
    const restore = event.target.closest("button.restore-local");
    if (!restore) return;
    localEntries = localEntries.map((entry) => entry.id === restore.dataset.entryId ? { ...entry, deleted: false } : entry);
    if (safeWrite(STORAGE_KEY, localEntries)) renderEntries();
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
      render();
      restoreDraft();
    })
    .catch((error) => {
      console.error("Diary data could not be loaded:", error);
      elements.entryRegion.setAttribute("aria-busy", "false");
      setStatus("日記を開けませんでした。サーバーを起動して、もう一度読み込んでください。", "error");
    });
})();
