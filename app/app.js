(() => {
  "use strict";

  const DATA_URL = "data/diary.json";
  const elements = {
    subtitle: document.querySelector("#diary-subtitle"),
    members: document.querySelector("#member-list"),
    filters: document.querySelector("#filters"),
    entries: document.querySelector("#entries"),
    status: document.querySelector("#status"),
    template: document.querySelector("#entry-template"),
    entryRegion: document.querySelector("section[aria-live]")
  };

  let diary = null;
  let selectedAuthor = "all";

  const formatDate = (date) => {
    const parsed = new Date(`${date}T00:00:00`);
    return Number.isNaN(parsed.valueOf())
      ? date
      : new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(parsed);
  };

  const setStatus = (message, kind = "") => {
    elements.status.textContent = message;
    elements.status.className = `status ${kind}`.trim();
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
    if (!entry.replyTo) return "";
    const target = entriesById.get(entry.replyTo);
    if (!target) return "前のページへの返事";
    return `「${memberFor(target.author).name}」の「${target.title}」への返事`;
  };

  const renderEntries = () => {
    const ordered = [...diary.entries].sort((a, b) => a.date.localeCompare(b.date) || a.cycle - b.cycle);
    const visible = selectedAuthor === "all" ? ordered : ordered.filter((entry) => entry.author === selectedAuthor);
    const entriesById = new Map(diary.entries.map((entry) => [entry.id, entry]));
    const fragment = document.createDocumentFragment();

    visible.forEach((entry) => {
      const member = memberFor(entry.author);
      const node = elements.template.content.cloneNode(true);
      const item = node.querySelector(".entry");
      const marker = node.querySelector(".entry-marker");
      const meta = node.querySelector(".entry-meta");
      const date = node.querySelector(".entry-date");
      const mood = node.querySelector(".entry-mood");
      const title = node.querySelector("h3");
      const body = node.querySelector(".entry-body");
      const reply = node.querySelector(".reply-note");

      item.style.setProperty("--member-color", member.color);
      marker.style.background = member.color;
      meta.textContent = `${member.emoji} ${member.name}`;
      date.textContent = formatDate(entry.date);
      mood.textContent = entry.mood || "✏️";
      mood.setAttribute("aria-label", `今日の気分: ${entry.mood || "未設定"}`);
      title.textContent = entry.title;
      body.textContent = entry.body;
      const replyLabel = replyText(entry, entriesById);
      if (replyLabel) {
        reply.hidden = false;
        reply.textContent = `↳ ${replyLabel}`;
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
  };

  const render = () => {
    elements.subtitle.textContent = diary.subtitle || "みんなで回す、ひとつの日記帳";
    renderMembers();
    renderFilters();
    renderEntries();
    elements.entryRegion.setAttribute("aria-busy", "false");
  };

  elements.filters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-author]");
    if (!button || !diary) return;
    selectedAuthor = button.dataset.author;
    renderFilters();
    renderEntries();
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
      render();
    })
    .catch((error) => {
      console.error("Diary data could not be loaded:", error);
      elements.entryRegion.setAttribute("aria-busy", "false");
      setStatus("日記を開けませんでした。サーバーを起動して、もう一度読み込んでください。", "error");
    });
})();
