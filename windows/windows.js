const SEEDED_ENTRY_IDS = new Set(["entry-rain", "entry-room", "entry-future"]);
const SEEDED_ASSET_MARKER = "../assets/";
const FALLBACK_IMAGE = "../assets/chaomu-logo.svg";
const SYNC_ENDPOINT = "/api/state";
const POLL_INTERVAL = 1600;
const MOODS = [
  { name: "平静", className: "calm" },
  { name: "开心", className: "bright" },
  { name: "温暖", className: "warm" },
  { name: "低落", className: "low" }
];

const storage = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
};

const moodButtons = document.querySelectorAll(".mood-button");
const dayCells = document.querySelectorAll(".day-cell");
const sideNavItems = document.querySelectorAll(".side-nav-item");
const toolButtons = document.querySelectorAll(".tool-button");
const promptButtons = document.querySelectorAll(".prompt-list button");
const metaTiles = document.querySelectorAll(".meta-tile");
const workspaceViews = document.querySelectorAll(".workspace-view");
const textArea = document.querySelector("#journalText");
const wordCount = document.querySelector("#wordCount");
const saveStatus = document.querySelector("#saveStatus");
const title = document.querySelector("#entryTitle");
const date = document.querySelector("#entryDate");
const mood = document.querySelector("#entryMood");
const weather = document.querySelector("#entryWeather");
const place = document.querySelector("#entryPlace");
const entryList = document.querySelector("#entryList");
const editorTags = document.querySelector("#editorTags");
const newEntryButton = document.querySelector("#newEntryButton");
const globalSearch = document.querySelector("#globalSearch");
const manualSyncButton = document.querySelector("#manualSyncButton");
const sidebarSyncPanel = document.querySelector("#sidebarSyncPanel");
const sidebarSyncTitle = document.querySelector("#sidebarSyncTitle");
const sidebarSyncText = document.querySelector("#sidebarSyncText");
const calendarGrid = document.querySelector("#calendarGrid");
const calendarSummary = document.querySelector("#calendarSummary");
const dayReview = document.querySelector("#dayReview");
const moodMap = document.querySelector("#moodMap");
const moodFilters = document.querySelectorAll(".mood-filter");
const moodSummaryPill = document.querySelector("#moodSummaryPill");
const moodSummaryText = document.querySelector("#moodSummaryText");
const unlockButton = document.querySelector("#unlockButton");
const privateList = document.querySelector("#privateList");
const privateSummary = document.querySelector("#privateSummary");
const imageUploadInput = document.querySelector("#imageUploadInput");
const voiceUploadInput = document.querySelector("#voiceUploadInput");
const attachmentRow = document.querySelector("#attachmentRow");
const entryImagePreview = document.querySelector("#entryImagePreview");
const entryImageLabel = document.querySelector("#entryImageLabel");
const entryImageText = document.querySelector("#entryImageText");
const statEntries = document.querySelector("#statEntries");
const statImages = document.querySelector("#statImages");
const statPrivate = document.querySelector("#statPrivate");
const statPlaces = document.querySelector("#statPlaces");

let deletedEntryIds = new Set(storage.get("chaomu-shared-deleted-entry-ids-v1", []));
SEEDED_ENTRY_IDS.forEach((id) => deletedEntryIds.add(id));

let entries = normalizeEntries(
  storage.get("chaomu-windows-entries-v2", null) ||
  storage.get("chaomu-windows-entries-v1", [])
);
let activeEntryId = storage.get("chaomu-windows-active-id", entries[0]?.id || "");
if (!entries.some((entry) => entry.id === activeEntryId)) {
  activeEntryId = entries[0]?.id || "";
}

let autoSyncEnabled = storage.get("chaomu-windows-auto-sync", true);
let sharedUpdatedAt = Number(storage.get("chaomu-shared-updated-at", 0));
let uploadTimer = 0;
let saveTimer = 0;
let searchQuery = "";
let isApplyingSharedState = false;

function normalizeAttachment(item) {
  if (!item || typeof item !== "object") return null;
  const name = String(item.name || "").trim();
  const dataUrl = String(item.dataUrl || "").trim();
  if (!name && !dataUrl) return null;
  return {
    name: name || "未命名文件",
    type: String(item.type || ""),
    dataUrl,
    uploadedAt: Number(item.uploadedAt || 0)
  };
}

function normalizeEntries(items) {
  if (!Array.isArray(items)) return [];

  return items
    .filter((entry) => entry && entry.id && !deletedEntryIds.has(String(entry.id)) && !SEEDED_ENTRY_IDS.has(String(entry.id)))
    .map((entry) => {
      const images = Array.isArray(entry.images)
        ? entry.images.map(normalizeAttachment).filter(Boolean)
        : [];
      const legacyImage = String(entry.image || "");
      const safeImage = legacyImage.includes(SEEDED_ASSET_MARKER) ? "" : legacyImage;
      if (!images.length && safeImage.startsWith("data:image")) {
        images.push({
          name: "已上传图片",
          type: "image",
          dataUrl: safeImage,
          uploadedAt: Number(entry.updatedAt || 0)
        });
      }

      return {
        id: String(entry.id),
        title: String(entry.title || "新的日记"),
        date: String(entry.date || ""),
        mood: String(entry.mood || "平静"),
        moodClass: String(entry.moodClass || moodClassForName(entry.mood) || "calm"),
        weather: String(entry.weather || "未填写"),
        place: String(entry.place || "未填写"),
        tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
        text: String(entry.text || ""),
        note: String(entry.note || getNote(entry.text || "")),
        image: images[0]?.dataUrl || safeImage,
        images,
        voice: normalizeAttachment(entry.voice),
        updatedAt: Number(entry.updatedAt || 0),
        syncedAt: Number(entry.syncedAt || 0),
        locked: Boolean(entry.locked)
      };
    });
}

function moodClassForName(name) {
  return MOODS.find((item) => item.name === name)?.className;
}

function getActiveEntry() {
  return entries.find((entry) => entry.id === activeEntryId);
}

function getNote(text) {
  return (text || "").split("\n").find((line) => line.trim())?.trim().slice(0, 28) || "还没有写下内容。";
}

function formatNowLabel() {
  const now = new Date();
  return `今天 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function entryDateObject(entry) {
  const value = Number(entry?.updatedAt || entry?.syncedAt || 0);
  return value ? new Date(value) : new Date();
}

function formatTimeAgo(time) {
  if (!time) return "尚未同步";
  const diff = Math.max(0, Date.now() - time);
  const minute = 1000 * 60;
  if (diff < minute) return "刚刚保存";
  if (diff < minute * 60) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < minute * 60 * 24) return `${Math.floor(diff / (minute * 60))} 小时前`;
  return `${Math.floor(diff / (minute * 60 * 24))} 天前`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSharedState() {
  return {
    version: 1,
    activeEntryId,
    updatedAt: Date.now(),
    entries,
    deletedEntryIds: Array.from(deletedEntryIds)
  };
}

function persistEntries(sync = true) {
  storage.set("chaomu-windows-entries-v2", entries);
  storage.set("chaomu-windows-active-id", activeEntryId);
  storage.set("chaomu-shared-deleted-entry-ids-v1", Array.from(deletedEntryIds));
  storage.set("chaomu-shared-updated-at", sharedUpdatedAt);
  if (sync) scheduleSharedPush();
}

function applySharedState(state) {
  if (!state || !Array.isArray(state.entries)) return;

  isApplyingSharedState = true;
  if (Array.isArray(state.deletedEntryIds)) {
    state.deletedEntryIds.forEach((id) => deletedEntryIds.add(String(id)));
  }
  SEEDED_ENTRY_IDS.forEach((id) => deletedEntryIds.add(id));
  entries = normalizeEntries(state.entries);
  activeEntryId = entries.some((entry) => entry.id === state.activeEntryId)
    ? state.activeEntryId
    : entries[0]?.id || "";
  sharedUpdatedAt = Number(state.updatedAt || Date.now());
  persistEntries(false);
  refreshAll();
  isApplyingSharedState = false;
}

async function pullSharedState(force = false) {
  if (!autoSyncEnabled) return;

  try {
    const response = await fetch(SYNC_ENDPOINT, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();
    const nextUpdatedAt = Number(state.updatedAt || 0);
    if (force || nextUpdatedAt > sharedUpdatedAt) {
      applySharedState(state);
    }
    refreshSyncStatus();
  } catch {
    setSyncMini("offline", "同步服务未连接", "只能本机保存");
  }
}

async function pushSharedState() {
  if (!autoSyncEnabled || isApplyingSharedState) return;

  try {
    setSyncMini("uploading", "同步中", "正在写入预览服务");
    const response = await fetch(SYNC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getSharedState())
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();
    sharedUpdatedAt = Number(state.updatedAt || Date.now());
    if (Array.isArray(state.deletedEntryIds)) {
      state.deletedEntryIds.forEach((id) => deletedEntryIds.add(String(id)));
    }
    entries.forEach((entry) => {
      entry.syncedAt = Date.now();
    });
    persistEntries(false);
    setSyncMini("synced", "预览已同步", "刚刚保存");
  } catch {
    setSyncMini("offline", "同步失败", "稍后自动重试");
  }
}

function scheduleSharedPush(delay = 500) {
  if (!autoSyncEnabled || isApplyingSharedState) return;
  window.clearTimeout(uploadTimer);
  uploadTimer = window.setTimeout(pushSharedState, delay);
}

function updateWordCount() {
  wordCount.textContent = `${textArea.value.replace(/\s/g, "").length} 字`;
}

function setSyncMini(state, titleText, detailText) {
  sidebarSyncPanel.className = `sync-mini ${state}`;
  sidebarSyncTitle.textContent = titleText;
  sidebarSyncText.textContent = detailText;
}

function refreshSyncStatus() {
  const entry = getActiveEntry();

  if (!autoSyncEnabled) {
    setSyncMini("paused", "后台同步暂停", "仅本地保存");
    return;
  }

  if (!navigator.onLine) {
    setSyncMini("offline", "离线待同步", "联网后继续");
    return;
  }

  if (entry && entry.updatedAt > (entry.syncedAt || 0)) {
    setSyncMini("pending", "预览待同步", "正在排队");
    return;
  }

  setSyncMini("synced", "预览已同步", formatTimeAgo(entry?.syncedAt));
}

function showDesktopFeedback(message) {
  saveStatus.textContent = message;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveStatus.textContent = getActiveEntry() ? "本地已保存" : "等待新建";
  }, 1200);
}

function switchView(viewName) {
  workspaceViews.forEach((view) => view.classList.toggle("active", view.dataset.view === viewName));
  sideNavItems.forEach((item) => item.classList.toggle("active", item.dataset.view === viewName));
}

function renderEntryList() {
  const normalized = searchQuery.trim().toLowerCase();
  const visibleEntries = entries.filter((entry) => {
    if (!normalized) return true;
    const haystack = [entry.title, entry.text, entry.mood, entry.weather, entry.place, ...entry.tags].join(" ").toLowerCase();
    return haystack.includes(normalized);
  });

  if (!visibleEntries.length) {
    entryList.innerHTML = `<div class="empty-list">${entries.length ? "没有找到匹配的日记" : "还没有日记，点击右上角 + 新建。"}</div>`;
    return;
  }

  entryList.innerHTML = visibleEntries.map((entry) => {
    const preview = entry.locked ? "这篇日记已加锁。" : getNote(entry.text);
    const tags = entry.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("");
    const activeClass = entry.id === activeEntryId ? " active" : "";

    return `
      <article class="entry-card${activeClass}" data-entry-id="${escapeHtml(entry.id)}" tabindex="0">
        <div class="entry-topline">
          <span class="mood-chip ${escapeHtml(entry.moodClass)}"></span>
          <time>${escapeHtml(entry.date || "未记录时间")}</time>
        </div>
        <h3>${escapeHtml(entry.title)}</h3>
        <p>${escapeHtml(preview)}</p>
        <div class="tag-row">${tags}</div>
      </article>
    `;
  }).join("");

  entryList.querySelectorAll(".entry-card").forEach((card) => {
    const activate = () => loadEntry(card.dataset.entryId);
    card.addEventListener("click", activate);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  });
}

function syncMoodButtons(entry) {
  moodButtons.forEach((button) => {
    button.classList.toggle("active", Boolean(entry) && button.dataset.mood === entry.mood);
  });
}

function setEditorControls(entry) {
  const hasEntry = Boolean(entry);
  textArea.disabled = !hasEntry || entry.locked;
  moodButtons.forEach((button) => {
    button.disabled = !hasEntry || entry.locked;
  });
  toolButtons.forEach((button) => {
    button.disabled = !hasEntry || (entry.locked && button.title !== "删除日记");
  });
}

function renderAttachments(entry) {
  if (!entry) {
    attachmentRow.innerHTML = "";
    return;
  }

  const chips = [];
  if (entry.images.length) {
    chips.push(`<span class="attachment-pill">图片 ${entry.images.length} 张</span>`);
  }
  if (entry.voice) {
    chips.push(`<span class="attachment-pill">语音 ${escapeHtml(entry.voice.name)}</span>`);
  }
  if (entry.locked) {
    chips.push(`<span class="attachment-pill danger">已加锁</span>`);
  }
  attachmentRow.innerHTML = chips.join("");
}

function renderVisual(entry) {
  const image = entry?.image || entry?.images?.[0]?.dataUrl || FALLBACK_IMAGE;
  entryImagePreview.src = image;
  entryImagePreview.alt = entry?.title || "日记图片预览";
  entryImageLabel.textContent = entry ? "日记图片" : "日记图片";
  entryImageText.textContent = entry?.images?.length ? entry.images[0].name : "还没有上传图片";
}

function showEmptyEditor() {
  activeEntryId = "";
  title.textContent = "暂无日记";
  date.textContent = "新建后开始记录";
  mood.textContent = "未填写";
  weather.textContent = "未填写";
  place.textContent = "未填写";
  textArea.value = "";
  textArea.placeholder = "点击 + 新建一篇日记。";
  editorTags.innerHTML = "";
  syncMoodButtons(null);
  updateWordCount();
  saveStatus.textContent = "等待新建";
  setEditorControls(null);
  renderAttachments(null);
  renderVisual(null);
  persistEntries(false);
}

function loadEntry(id) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) {
    showEmptyEditor();
    renderEntryList();
    refreshSyncStatus();
    return;
  }

  activeEntryId = entry.id;
  title.textContent = entry.title;
  date.textContent = entry.date || "未记录时间";
  mood.textContent = entry.mood;
  weather.textContent = entry.weather;
  place.textContent = entry.place;
  textArea.value = entry.locked ? "这篇日记已加锁。可在私密匣中解锁查看。" : entry.text;
  textArea.placeholder = "写下今天。";
  editorTags.innerHTML = entry.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("");
  syncMoodButtons(entry);
  updateWordCount();
  saveStatus.textContent = entry.locked ? "已加锁" : "本地已保存";
  setEditorControls(entry);
  renderAttachments(entry);
  renderVisual(entry);
  persistEntries(false);
  renderEntryList();
  refreshSyncStatus();
}

function updateActiveEntry(patch) {
  const entry = getActiveEntry();
  if (!entry || entry.locked) return;

  Object.assign(entry, patch, {
    updatedAt: Date.now(),
    date: formatNowLabel()
  });
  entry.note = getNote(entry.text);

  if (entry.title === "新的日记") {
    const firstLine = entry.text.split("\n").find((line) => line.trim());
    if (firstLine) {
      entry.title = firstLine.trim().slice(0, 16);
      title.textContent = entry.title;
    }
  }

  date.textContent = entry.date;
  persistEntries();
  renderEntryList();
  renderCalendar();
  renderMoodMap();
  renderPrivateList();
  refreshStats();
  refreshSyncStatus();
}

function saveLocalDraft() {
  window.clearTimeout(saveTimer);
  saveStatus.textContent = "保存中";
  saveTimer = window.setTimeout(() => {
    saveStatus.textContent = "本地已保存";
  }, 180);
}

function insertAtCursor(snippet) {
  const entry = getActiveEntry();
  if (!entry || entry.locked) {
    showDesktopFeedback(entry ? "请先解锁" : "请先新建日记");
    return;
  }

  const start = textArea.selectionStart;
  const end = textArea.selectionEnd;
  textArea.value = `${textArea.value.slice(0, start)}${snippet}${textArea.value.slice(end)}`;
  textArea.selectionStart = textArea.selectionEnd = start + snippet.length;
  textArea.focus();
  updateActiveEntry({ text: textArea.value });
  updateWordCount();
  saveLocalDraft();
  scheduleSharedPush(700);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve({
        name: file.name,
        type: file.type,
        dataUrl: String(reader.result || ""),
        uploadedAt: Date.now()
      });
    });
    reader.addEventListener("error", reject);
    reader.readAsDataURL(file);
  });
}

async function uploadImages(fileList) {
  const entry = getActiveEntry();
  if (!entry || entry.locked) {
    showDesktopFeedback(entry ? "请先解锁" : "请先新建日记");
    return;
  }

  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;

  try {
    const attachments = await Promise.all(files.map(readFileAsDataUrl));
    const images = [...attachments, ...entry.images].slice(0, 8);
    updateActiveEntry({ images, image: images[0]?.dataUrl || "" });
    renderAttachments(entry);
    renderVisual(entry);
    showDesktopFeedback(`已上传 ${attachments.length} 张图片`);
  } catch {
    showDesktopFeedback("图片上传失败");
  } finally {
    imageUploadInput.value = "";
  }
}

async function uploadVoice(fileList) {
  const entry = getActiveEntry();
  if (!entry || entry.locked) {
    showDesktopFeedback(entry ? "请先解锁" : "请先新建日记");
    return;
  }

  const file = Array.from(fileList || []).find((item) => item.type.startsWith("audio/"));
  if (!file) return;

  try {
    const voice = await readFileAsDataUrl(file);
    updateActiveEntry({ voice });
    renderAttachments(entry);
    showDesktopFeedback("语音已上传");
  } catch {
    showDesktopFeedback("语音上传失败");
  } finally {
    voiceUploadInput.value = "";
  }
}

function lockActiveEntry() {
  const entry = getActiveEntry();
  if (!entry) return;
  entry.locked = true;
  entry.updatedAt = Date.now();
  persistEntries();
  loadEntry(entry.id);
  renderPrivateList();
  refreshStats();
}

function deleteActiveEntry() {
  const entry = getActiveEntry();
  if (!entry) {
    showDesktopFeedback("没有可删除的日记");
    return;
  }

  const confirmed = window.confirm(`删除《${entry.title || "这篇日记"}》？此操作无法撤销。`);
  if (!confirmed) return;

  deletedEntryIds.add(entry.id);
  entries = entries.filter((item) => item.id !== entry.id);
  activeEntryId = entries[0]?.id || "";
  persistEntries();
  refreshAll();
  showDesktopFeedback("日记已删除");
}

function createEntry() {
  const now = Date.now();
  const entry = {
    id: `entry-${now}`,
    title: "新的日记",
    date: formatNowLabel(),
    mood: "平静",
    moodClass: "calm",
    weather: "未填写",
    place: "未填写",
    tags: [],
    text: "",
    note: "还没有写下内容。",
    image: "",
    images: [],
    voice: null,
    updatedAt: now,
    syncedAt: 0,
    locked: false
  };

  entries.unshift(entry);
  activeEntryId = entry.id;
  persistEntries();
  switchView("write");
  refreshAll();
  textArea.focus();
}

function entriesByDay() {
  const byDay = new Map();
  entries.forEach((entry) => {
    const day = entryDateObject(entry).getDate();
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(entry);
  });
  return byDay;
}

function renderDayReview(entry, day) {
  dayReview.querySelector("span").textContent = `5月${day}日`;
  dayReview.querySelector("h2").textContent = entry ? entry.title : "还没有日记";
  dayReview.querySelector("p").textContent = entry
    ? (entry.locked ? "这篇日记已加锁。" : getNote(entry.text))
    : "这一天还没有记录，可以从今日书写补一篇。";
  dayReview.querySelector("img").src = entry?.image || entry?.images?.[0]?.dataUrl || FALLBACK_IMAGE;
  dayReview.querySelector(".tag-row").innerHTML = entry?.tags?.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("") || "";
}

function renderCalendar() {
  const byDay = entriesByDay();
  const today = new Date().getDate();
  const week = ["一", "二", "三", "四", "五", "六", "日"];

  calendarSummary.textContent = `${byDay.size} / 31 天`;
  calendarGrid.innerHTML = Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    const dayEntries = byDay.get(day) || [];
    const entry = dayEntries[0];
    const classes = `${entry ? "marked" : ""} ${day === today ? "active" : ""}`.trim();
    return `<button class="${classes}" data-day="${day}" type="button"><span>${week[index % 7]}</span><strong>${day}</strong><span>${entry ? escapeHtml(entry.mood) : "未记录"}</span></button>`;
  }).join("");

  calendarGrid.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      calendarGrid.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderDayReview((byDay.get(Number(button.dataset.day)) || [])[0], Number(button.dataset.day));
    });
  });

  renderDayReview((byDay.get(today) || entries)[0], today);
}

function renderMoodMap() {
  const byDay = entriesByDay();
  const today = new Date().getDate();
  const counts = MOODS.reduce((result, item) => ({ ...result, [item.className]: 0 }), {});

  entries.forEach((entry) => {
    if (counts[entry.moodClass] !== undefined) counts[entry.moodClass] += 1;
  });

  moodMap.innerHTML = Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    const entry = (byDay.get(day) || [])[0];
    const moodClass = entry?.moodClass || "empty";
    const activeClass = day === today ? " active" : "";
    return `<button class="${moodClass}${activeClass}" data-day="${day}" type="button">${day}</button>`;
  }).join("");

  moodMap.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      moodMap.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    });
  });

  const total = entries.length || 1;
  moodFilters.forEach((button) => {
    const moodInfo = MOODS.find((item) => item.className === button.dataset.mood);
    const percent = Math.round(((counts[button.dataset.mood] || 0) / total) * 100);
    button.innerHTML = `<span class="${button.dataset.mood}"></span>${moodInfo?.name || "情绪"} ${entries.length ? `${percent}%` : "0%"}`;
  });

  const topMood = MOODS.reduce((best, item) => (counts[item.className] > counts[best.className] ? item : best), MOODS[0]);
  moodSummaryPill.textContent = entries.length ? `${topMood.name}最多` : "暂无情绪";
  moodSummaryText.textContent = entries.length
    ? `已根据 ${entries.length} 篇日记整理情绪分布。`
    : "写下日记并选择心情后，这里会汇总情绪分布。";
}

function renderPrivateList() {
  const lockedEntries = entries.filter((entry) => entry.locked);
  privateSummary.textContent = `${lockedEntries.length} 篇`;

  if (!lockedEntries.length) {
    privateList.innerHTML = `<div class="empty-list">还没有加锁日记</div>`;
    return;
  }

  privateList.innerHTML = lockedEntries.map((entry) => `
    <article>
      <span>${escapeHtml(entry.date || "未记录时间")}</span>
      <strong>${escapeHtml(entry.title)}</strong>
      <button class="private-action" data-entry-id="${escapeHtml(entry.id)}" type="button">解锁</button>
    </article>
  `).join("");

  privateList.querySelectorAll(".private-action").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = entries.find((item) => item.id === button.dataset.entryId);
      if (!entry) return;
      entry.locked = false;
      entry.updatedAt = Date.now();
      activeEntryId = entry.id;
      persistEntries();
      switchView("write");
      refreshAll();
    });
  });
}

function refreshStats() {
  const imageCount = entries.reduce((total, entry) => total + entry.images.length, 0);
  const lockedCount = entries.filter((entry) => entry.locked).length;
  const places = new Set(entries.map((entry) => entry.place).filter((value) => value && value !== "未填写"));

  statEntries.textContent = String(entries.length);
  statImages.textContent = String(imageCount);
  statPrivate.textContent = String(lockedCount);
  statPlaces.textContent = String(places.size);
}

function refreshAll() {
  renderEntryList();
  loadEntry(activeEntryId || entries[0]?.id || "");
  renderCalendar();
  renderMoodMap();
  renderPrivateList();
  refreshStats();
}

moodButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const entry = getActiveEntry();
    if (!entry || entry.locked) return;

    const moodClass = ["calm", "bright", "warm", "low"].find((name) => button.classList.contains(name)) || "calm";
    moodButtons.forEach((item) => item.classList.toggle("active", item === button));
    mood.textContent = button.dataset.mood;
    updateActiveEntry({ mood: button.dataset.mood, moodClass });
    saveLocalDraft();
  });
});

dayCells.forEach((button) => {
  button.addEventListener("click", () => {
    dayCells.forEach((item) => item.classList.toggle("active", item === button));
    showDesktopFeedback(`已切换到${button.querySelector("strong")?.textContent || ""}日`);
  });
});

sideNavItems.forEach((button) => {
  button.addEventListener("click", () => {
    switchView(button.dataset.view);
  });
});

toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.title;
    if (action === "加粗") insertAtCursor("**重点**");
    if (action === "斜体") insertAtCursor("*感受*");
    if (action === "引用") insertAtCursor("\n> 今天想记住的一句话\n");
    if (action === "上传图片") imageUploadInput.click();
    if (action === "上传语音") voiceUploadInput.click();
    if (action === "锁定") lockActiveEntry();
    if (action === "删除日记") deleteActiveEntry();
  });
});

promptButtons.forEach((button) => {
  button.addEventListener("click", () => insertAtCursor(`\n\n${button.textContent}\n`));
});

metaTiles.forEach((button) => {
  button.addEventListener("click", () => {
    const label = button.querySelector("span")?.textContent || "信息";
    showDesktopFeedback(getActiveEntry() ? `已打开${label}设置` : "请先新建日记");
  });
});

moodFilters.forEach((button) => {
  button.addEventListener("click", () => {
    moodFilters.forEach((item) => item.classList.toggle("active", item === button));
    moodMap.querySelectorAll("button").forEach((item) => {
      if (item.classList.contains("empty")) {
        item.style.opacity = "0.35";
        return;
      }
      item.style.opacity = item.classList.contains(button.dataset.mood) ? "1" : "0.35";
    });
  });
});

unlockButton.addEventListener("click", () => {
  const lockedEntry = entries.find((entry) => entry.locked);
  if (!lockedEntry) {
    showDesktopFeedback("没有加锁日记");
    return;
  }
  lockedEntry.locked = false;
  lockedEntry.updatedAt = Date.now();
  persistEntries();
  activeEntryId = lockedEntry.id;
  switchView("write");
  refreshAll();
});

textArea.addEventListener("input", () => {
  updateActiveEntry({ text: textArea.value });
  updateWordCount();
  saveLocalDraft();
});

newEntryButton.addEventListener("click", createEntry);

globalSearch.addEventListener("input", (event) => {
  searchQuery = event.target.value;
  switchView("write");
  renderEntryList();
});

manualSyncButton.addEventListener("click", () => {
  autoSyncEnabled = !autoSyncEnabled;
  storage.set("chaomu-windows-auto-sync", autoSyncEnabled);
  if (autoSyncEnabled) {
    pushSharedState();
  } else {
    refreshSyncStatus();
  }
});

imageUploadInput.addEventListener("change", (event) => uploadImages(event.target.files));
voiceUploadInput.addEventListener("change", (event) => uploadVoice(event.target.files));

window.addEventListener("online", () => scheduleSharedPush());
window.addEventListener("offline", refreshSyncStatus);

persistEntries(false);
refreshAll();
pullSharedState(true);
window.setInterval(() => pullSharedState(false), POLL_INTERVAL);
