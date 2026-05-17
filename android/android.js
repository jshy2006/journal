const SEEDED_ENTRY_IDS = new Set(["entry-rain", "entry-room", "entry-future"]);
const SEEDED_ASSET_MARKER = "../assets/illustrations/";
const SYNC_ENDPOINT = "/api/state";
const POLL_INTERVAL = 1600;

const titleInput = document.querySelector("#mobileTitle");
const textInput = document.querySelector("#mobileText");
const syncStatus = document.querySelector("#syncStatus");
const heroSyncText = document.querySelector("#heroSyncText");
const navButtons = document.querySelectorAll(".bottom-nav button");
const views = document.querySelectorAll(".app-view");
const toolButtons = document.querySelectorAll(".mobile-tools button[data-tool]");
const toolPanel = document.querySelector("#toolPanel");
const timelineList = document.querySelector("#timelineList");
const readerTitle = document.querySelector("#readerTitle");
const readerDate = document.querySelector("#readerDate");
const readerText = document.querySelector("#readerText");
const readerCard = document.querySelector("#readerCard");
const calendarGrid = document.querySelector("#calendarGrid");
const toggleSyncButton = document.querySelector("#toggleSyncButton");
const profileSync = document.querySelector("#profileSync");
const newEntryButton = document.querySelector("#newMobileEntryButton");
const deleteEntryButton = document.querySelector("#deleteMobileEntryButton");
const imageUploadInput = document.querySelector("#mobileImageUpload");
const voiceUploadInput = document.querySelector("#mobileVoiceUpload");
const photoStrip = document.querySelector("#photoStrip");
const photoCount = document.querySelector("#photoCount");
const mobileMoodButtons = document.querySelectorAll("#mobileMoods button");
const timelineCount = document.querySelector("#timelineCount");
const mobileCalendarSummary = document.querySelector("#mobileCalendarSummary");
const profileEntryCount = document.querySelector("#profileEntryCount");
const profileImageCount = document.querySelector("#profileImageCount");
const profilePrivateCount = document.querySelector("#profilePrivateCount");

const storage = {
  get(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  },
  getJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  },
  setJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      syncStatus.textContent = "本地预览";
      return false;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      syncStatus.textContent = "本地预览";
      return false;
    }
  }
};

let deletedEntryIds = new Set(storage.getJson("chaomu-shared-deleted-entry-ids-v1", []));
SEEDED_ENTRY_IDS.forEach((id) => deletedEntryIds.add(id));

let syncTimer = 0;
let sharedUpdatedAt = Number(storage.get("chaomu-shared-updated-at", "0"));
let autoSync = storage.get("chaomu-android-auto-sync", "on") === "on";
let isApplyingSharedState = false;
let activeEntryId = storage.get("chaomu-android-active-id", "");
let entries = normalizeEntries(storage.getJson("chaomu-shared-entries-v1", []));
if (!entries.some((entry) => entry.id === activeEntryId)) {
  activeEntryId = entries[0]?.id || "";
}

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
        moodClass: String(entry.moodClass || "calm"),
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

function getActiveEntry() {
  return entries.find((entry) => entry.id === activeEntryId);
}

function getNote(text) {
  return (text || "").split("\n").find((line) => line.trim())?.trim().slice(0, 24) || "还没有写下内容。";
}

function formatNowLabel() {
  const now = new Date();
  return `今天 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function entryDateObject(entry) {
  const value = Number(entry?.updatedAt || entry?.syncedAt || 0);
  return value ? new Date(value) : new Date();
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
  storage.setJson("chaomu-shared-entries-v1", entries);
  storage.setJson("chaomu-shared-deleted-entry-ids-v1", Array.from(deletedEntryIds));
  storage.setJson("chaomu-shared-updated-at", sharedUpdatedAt);
  storage.set("chaomu-android-active-id", activeEntryId);
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
  renderAll();
  isApplyingSharedState = false;
}

async function pullSharedState(force = false) {
  if (!autoSync) return;

  try {
    const response = await fetch(SYNC_ENDPOINT, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();
    const nextUpdatedAt = Number(state.updatedAt || 0);
    if (force || nextUpdatedAt > sharedUpdatedAt) {
      applySharedState(state);
    }
  } catch {
    syncStatus.textContent = "同步服务未连接 · 本机保存";
    heroSyncText.textContent = "同步服务未连接";
  }
}

async function pushSharedState() {
  if (!autoSync || isApplyingSharedState) return;

  try {
    syncStatus.textContent = "正在同步预览服务";
    heroSyncText.textContent = "正在同步";
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
    syncStatus.textContent = "预览已同步";
    heroSyncText.textContent = "同步服务已同步";
  } catch {
    syncStatus.textContent = "同步失败 · 稍后自动重试";
    heroSyncText.textContent = "同步服务重试中";
  }
}

function scheduleSharedPush(delay = 600) {
  if (!autoSync || isApplyingSharedState) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(pushSharedState, delay);
}

function createEntry(options = {}) {
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
  if (options.switchToWrite !== false) switchView("write");
  renderAll();
  if (options.focus !== false) textInput.focus();
  return entry;
}

function ensureActiveEntry(options = {}) {
  return getActiveEntry() || createEntry({ focus: false, ...options });
}

function loadEditor() {
  const entry = getActiveEntry();
  if (!entry) {
    titleInput.value = "";
    textInput.value = "";
    titleInput.disabled = false;
    textInput.disabled = false;
    renderToolPanel();
    renderPhotoStrip();
    return;
  }

  titleInput.value = entry.title === "新的日记" ? "" : entry.title;
  textInput.value = entry.locked ? "这篇日记已加锁。" : entry.text;
  titleInput.disabled = entry.locked;
  textInput.disabled = entry.locked;
  renderToolPanel(entry);
  renderPhotoStrip(entry);
  syncMoodButtons(entry);
}

function saveAndSync() {
  const entry = ensureActiveEntry();
  if (!entry || entry.locked) return;

  entry.title = titleInput.value.trim() || "未命名日记";
  entry.text = textInput.value;
  entry.note = getNote(textInput.value);
  entry.date = formatNowLabel();
  entry.updatedAt = Date.now();
  syncStatus.textContent = autoSync ? "本地已保存 · 等待同步" : "本地已保存 · 同步已暂停";
  heroSyncText.textContent = autoSync ? "正在准备同步" : "自动同步已暂停";
  renderTimeline();
  renderCalendar();
  renderStats();
  persistEntries();
}

function switchView(target) {
  views.forEach((view) => view.classList.toggle("active", view.dataset.view === target));
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.target === target));
}

function renderToolPanel(entry = getActiveEntry()) {
  if (!entry) {
    toolPanel.innerHTML = `<strong>附件</strong><span>还没有上传图片或语音。</span>`;
    return;
  }

  const imageText = entry.images.length ? `图片 ${entry.images.length} 张` : "暂无图片";
  const voiceText = entry.voice ? `语音 ${entry.voice.name}` : "暂无语音";
  toolPanel.innerHTML = `<strong>附件</strong><span>${escapeHtml(imageText)} · ${escapeHtml(voiceText)}</span>`;
}

function setToolPanel(type) {
  const entry = getActiveEntry();
  if (type === "photo") {
    imageUploadInput.click();
    return;
  }
  if (type === "voice") {
    voiceUploadInput.click();
    return;
  }
  if (type === "private") {
    const target = ensureActiveEntry();
    target.locked = !target.locked;
    target.updatedAt = Date.now();
    persistEntries();
    loadEditor();
    renderTimeline();
    renderStats();
    toolPanel.innerHTML = `<strong>私密保护</strong><span>${target.locked ? "这篇日记已加锁。" : "这篇日记已解除私密。"}</span>`;
  }
}

function renderTimeline() {
  timelineCount.textContent = `${entries.length} 天`;

  if (!entries.length) {
    timelineList.innerHTML = `
      <article class="active">
        <time>暂无</time>
        <div>
          <strong>还没有日记</strong>
          <p>新建一篇后会出现在这里。</p>
        </div>
      </article>
    `;
    return;
  }

  timelineList.innerHTML = entries.slice(0, 20).map((entry, index) => `
    <article class="${entry.id === activeEntryId ? "active" : ""}" data-entry="${index}">
      <time>${escapeHtml(index === 0 ? "今天" : entry.date.split(" ")[0] || "最近")}</time>
      <div>
        <strong>${escapeHtml(entry.title)}</strong>
        <p>${escapeHtml(entry.locked ? "这篇日记已加锁。" : entry.note || getNote(entry.text))}</p>
      </div>
    </article>
  `).join("");

  timelineList.querySelectorAll("article[data-entry]").forEach((item) => {
    item.addEventListener("click", () => loadReader(Number(item.dataset.entry)));
  });
}

function loadReader(index) {
  const entry = entries[index] || entries[0];
  if (!entry) {
    readerTitle.textContent = "还没有日记";
    readerDate.textContent = "暂无记录";
    readerText.textContent = "新建一篇日记后，这里会显示正文。";
    readerCard.querySelector("img").src = "../assets/illustrations/diary-desk.png";
    return;
  }

  activeEntryId = entry.id;
  persistEntries(false);
  timelineList.querySelectorAll("article").forEach((item) => {
    item.classList.toggle("active", item.dataset.entry === String(index));
  });
  readerTitle.textContent = entry.title;
  readerDate.textContent = entry.date || "未记录时间";
  readerText.textContent = entry.locked ? "这篇日记已加锁。" : entry.text || "还没有写下内容。";
  readerCard.querySelector("img").src = entry.image || entry.images[0]?.dataUrl || "../assets/illustrations/diary-desk.png";
  readerCard.querySelector("img").alt = entry.title;
  loadEditor();
}

function renderCalendar() {
  const daysWithEntries = new Set(entries.map((entry) => entryDateObject(entry).getDate()));
  const today = new Date().getDate();
  mobileCalendarSummary.textContent = `${daysWithEntries.size} / 31`;
  calendarGrid.innerHTML = Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    const classes = `${daysWithEntries.has(day) ? "marked" : ""} ${day === today ? "active" : ""}`.trim();
    return `<button class="${classes}" data-day="${day}" type="button">${day}</button>`;
  }).join("");

  calendarGrid.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      calendarGrid.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    });
  });
}

function syncMoodButtons(entry = getActiveEntry()) {
  mobileMoodButtons.forEach((button) => {
    button.classList.toggle("active", Boolean(entry) && button.dataset.class === entry.moodClass);
  });
}

function renderPhotoStrip(entry = getActiveEntry()) {
  const images = entry?.images || [];
  photoCount.textContent = `${images.length} 张`;

  if (!images.length) {
    photoStrip.innerHTML = `<div class="empty-photo">还没有上传图片</div>`;
    return;
  }

  photoStrip.innerHTML = images.slice(0, 4).map((image) => `
    <img src="${escapeHtml(image.dataUrl)}" alt="${escapeHtml(image.name)}">
  `).join("");
}

function renderStats() {
  const imageCount = entries.reduce((count, entry) => count + entry.images.length, 0);
  profileEntryCount.textContent = String(entries.length);
  profileImageCount.textContent = String(imageCount);
  profilePrivateCount.textContent = String(entries.filter((entry) => entry.locked).length);
}

function syncToggleState() {
  profileSync.textContent = autoSync ? "自动同步已开启" : "自动同步已暂停";
  toggleSyncButton.textContent = autoSync ? "暂停同步" : "开启同步";
  heroSyncText.textContent = autoSync ? "同步服务已连接" : "自动同步已暂停";
}

function renderAll() {
  renderTimeline();
  loadEditor();
  loadReader(Math.max(0, entries.findIndex((entry) => entry.id === activeEntryId)));
  renderCalendar();
  renderStats();
  syncToggleState();
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
  const entry = ensureActiveEntry();
  if (entry.locked) return;
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;

  try {
    const attachments = await Promise.all(files.map(readFileAsDataUrl));
    entry.images = [...attachments, ...entry.images].slice(0, 8);
    entry.image = entry.images[0]?.dataUrl || "";
    entry.updatedAt = Date.now();
    entry.date = formatNowLabel();
    persistEntries();
    renderAll();
    toolPanel.innerHTML = `<strong>图片已上传</strong><span>刚刚添加 ${attachments.length} 张图片。</span>`;
  } catch {
    toolPanel.innerHTML = `<strong>图片上传失败</strong><span>请重新选择图片。</span>`;
  } finally {
    imageUploadInput.value = "";
  }
}

async function uploadVoice(fileList) {
  const entry = ensureActiveEntry();
  if (entry.locked) return;
  const file = Array.from(fileList || []).find((item) => item.type.startsWith("audio/"));
  if (!file) return;

  try {
    entry.voice = await readFileAsDataUrl(file);
    entry.updatedAt = Date.now();
    entry.date = formatNowLabel();
    persistEntries();
    renderAll();
    toolPanel.innerHTML = `<strong>语音已上传</strong><span>${escapeHtml(entry.voice.name)}</span>`;
  } catch {
    toolPanel.innerHTML = `<strong>语音上传失败</strong><span>请重新选择音频文件。</span>`;
  } finally {
    voiceUploadInput.value = "";
  }
}

function deleteActiveEntry() {
  const entry = getActiveEntry();
  if (!entry) return;
  const confirmed = window.confirm(`删除《${entry.title || "这篇日记"}》？此操作无法撤销。`);
  if (!confirmed) return;

  deletedEntryIds.add(entry.id);
  entries = entries.filter((item) => item.id !== entry.id);
  activeEntryId = entries[0]?.id || "";
  persistEntries();
  renderAll();
  syncStatus.textContent = "日记已删除";
}

titleInput.addEventListener("input", saveAndSync);
textInput.addEventListener("input", saveAndSync);

navButtons.forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.target));
});

toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    toolButtons.forEach((item) => item.classList.toggle("active", item === button));
    setToolPanel(button.dataset.tool);
  });
});

mobileMoodButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const entry = ensureActiveEntry({ switchToWrite: false });
    if (entry.locked) return;
    entry.mood = button.dataset.mood;
    entry.moodClass = button.dataset.class;
    entry.updatedAt = Date.now();
    entry.date = formatNowLabel();
    persistEntries();
    syncMoodButtons(entry);
    renderTimeline();
    renderCalendar();
  });
});

newEntryButton.addEventListener("click", () => createEntry());
deleteEntryButton.addEventListener("click", deleteActiveEntry);
imageUploadInput.addEventListener("change", (event) => uploadImages(event.target.files));
voiceUploadInput.addEventListener("change", (event) => uploadVoice(event.target.files));

toggleSyncButton.addEventListener("click", () => {
  autoSync = !autoSync;
  try {
    localStorage.setItem("chaomu-android-auto-sync", autoSync ? "on" : "off");
  } catch {
    // Ignore storage failures in private browsing.
  }
  syncToggleState();
  if (autoSync) {
    pullSharedState(true);
    scheduleSharedPush();
  }
});

persistEntries(false);
renderAll();
pullSharedState(true);
window.setInterval(() => pullSharedState(false), POLL_INTERVAL);
