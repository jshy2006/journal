const defaultEntries = [
  {
    id: "entry-rain",
    title: "雨停以后",
    date: "今天 21:34",
    mood: "平静",
    moodClass: "calm",
    weather: "雨后多云",
    place: "回家路上",
    tags: ["日常", "散步", "夜晚"],
    text: "便利店门口的灯把雨水照得像一层薄玻璃。今天终于没有急着把一天过成清单。",
    note: "散步，热牛奶，薄荷。",
    image: "../assets/illustrations/diary-desk.png",
    updatedAt: 0,
    syncedAt: 0,
    locked: false
  },
  {
    id: "entry-room",
    title: "把房间收亮一点",
    date: "昨天 23:06",
    mood: "开心",
    moodClass: "bright",
    weather: "晴",
    place: "卧室",
    tags: ["家", "整理"],
    text: "换了床单，把书桌左边空出来，心里也像被擦过一遍。",
    note: "整理书桌和床单。",
    image: "../assets/illustrations/mobile-writing.png",
    updatedAt: 0,
    syncedAt: 0,
    locked: false
  },
  {
    id: "entry-future",
    title: "给未来的自己",
    date: "5月15日 22:18",
    mood: "温暖",
    moodClass: "warm",
    weather: "微风",
    place: "书桌前",
    tags: ["成长", "给自己"],
    text: "今天没有特别厉害，但没有逃走。这样也值得被认真记下来。",
    note: "没有逃走，也值得记录。",
    image: "../assets/illustrations/secure-sync.png",
    updatedAt: 0,
    syncedAt: 0,
    locked: true
  }
];

const SYNC_ENDPOINT = "/api/state";
const POLL_INTERVAL = 1600;

const titleInput = document.querySelector("#mobileTitle");
const textInput = document.querySelector("#mobileText");
const syncStatus = document.querySelector("#syncStatus");
const heroSyncText = document.querySelector("#heroSyncText");
const navButtons = document.querySelectorAll(".bottom-nav button");
const views = document.querySelectorAll(".app-view");
const toolButtons = document.querySelectorAll(".mobile-tools button");
const toolPanel = document.querySelector("#toolPanel");
const timelineList = document.querySelector("#timelineList");
const readerTitle = document.querySelector("#readerTitle");
const readerDate = document.querySelector("#readerDate");
const readerText = document.querySelector("#readerText");
const readerCard = document.querySelector("#readerCard");
const calendarGrid = document.querySelector("#calendarGrid");
const toggleSyncButton = document.querySelector("#toggleSyncButton");
const profileSync = document.querySelector("#profileSync");

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

let syncTimer = 0;
let sharedUpdatedAt = Number(storage.get("chaomu-shared-updated-at", "0"));
let autoSync = storage.get("chaomu-android-auto-sync", "on") === "on";
let isApplyingSharedState = false;
let activeEntryId = storage.getJson("chaomu-android-active-id", null) || storage.get("chaomu-android-active-id", "entry-rain");
let entries = normalizeEntries(storage.getJson("chaomu-shared-entries-v1", null) || defaultEntries);

const legacyTitle = storage.get("chaomu-android-title", "");
const legacyText = storage.get("chaomu-android-text", "");
const hasLegacyDraft = Boolean(legacyTitle || legacyText);

if (hasLegacyDraft) {
  const firstEntry = entries[0];
  firstEntry.title = legacyTitle || firstEntry.title;
  firstEntry.text = legacyText || firstEntry.text;
  firstEntry.note = getNote(firstEntry.text);
  firstEntry.date = formatNowLabel();
  firstEntry.updatedAt = Date.now();
  activeEntryId = firstEntry.id;
}

function normalizeEntries(items) {
  const source = Array.isArray(items) && items.length ? items : defaultEntries;
  return source.map((entry, index) => ({
    ...defaultEntries[index % defaultEntries.length],
    ...entry,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    updatedAt: Number(entry.updatedAt || 0),
    syncedAt: Number(entry.syncedAt || 0),
    locked: Boolean(entry.locked)
  }));
}

function getActiveEntry() {
  return entries.find((entry) => entry.id === activeEntryId) || entries[0];
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

function getSharedState() {
  return {
    version: 1,
    activeEntryId,
    updatedAt: Date.now(),
    entries
  };
}

function persistEntries(sync = true) {
  storage.setJson("chaomu-shared-entries-v1", entries);
  storage.setJson("chaomu-shared-updated-at", sharedUpdatedAt);
  storage.set("chaomu-android-active-id", activeEntryId);
  if (sync) scheduleSharedPush();
}

function applySharedState(state) {
  if (!state || !Array.isArray(state.entries)) return;

  isApplyingSharedState = true;
  entries = normalizeEntries(state.entries);
  activeEntryId = entries.some((entry) => entry.id === state.activeEntryId)
    ? state.activeEntryId
    : entries[0]?.id;
  sharedUpdatedAt = Number(state.updatedAt || Date.now());
  persistEntries(false);
  renderTimeline();
  loadEditor();
  loadReader(Math.max(0, entries.findIndex((entry) => entry.id === activeEntryId)));
  syncToggleState();
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

function loadEditor() {
  const entry = getActiveEntry();
  if (!entry) return;
  titleInput.value = entry.title;
  textInput.value = entry.locked ? "这篇日记已加锁。可在私密匣中解锁查看。" : entry.text;
  textInput.disabled = entry.locked;
}

function saveAndSync() {
  const entry = getActiveEntry();
  if (!entry || entry.locked) return;

  entry.title = titleInput.value.trim() || "未命名日记";
  entry.text = textInput.value;
  entry.note = getNote(textInput.value);
  entry.date = formatNowLabel();
  entry.updatedAt = Date.now();
  syncStatus.textContent = autoSync ? "本地已保存 · 等待同步" : "本地已保存 · 同步已暂停";
  heroSyncText.textContent = autoSync ? "正在准备同步" : "自动同步已暂停";
  renderTimeline();
  persistEntries();
}

function switchView(target) {
  views.forEach((view) => view.classList.toggle("active", view.dataset.view === target));
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.target === target));
}

function setToolPanel(type) {
  const copy = {
    photo: ["图片素材", "已添加 2 张今日照片，可继续补充。"],
    voice: ["语音记录", "语音入口已打开，后续接入录音权限。"],
    private: ["私密保护", "这篇日记已标记为私密，上传前会加密。"]
  };
  const [heading, detail] = copy[type];
  toolPanel.innerHTML = `<strong>${heading}</strong><span>${detail}</span>`;
}

function renderTimeline() {
  timelineList.innerHTML = entries.slice(0, 3).map((entry, index) => `
    <article class="${entry.id === activeEntryId ? "active" : ""}" data-entry="${index}">
      <time>${escapeHtml(index === 0 ? "今天" : entry.date.split(" ")[0] || "最近")}</time>
      <div>
        <strong>${escapeHtml(entry.title)}</strong>
        <p>${escapeHtml(entry.note || getNote(entry.text))}</p>
      </div>
    </article>
  `).join("");

  timelineList.querySelectorAll("article").forEach((item) => {
    item.addEventListener("click", () => loadReader(Number(item.dataset.entry)));
  });
}

function loadReader(index) {
  const entry = entries[index] || entries[0];
  if (!entry) return;

  timelineList.querySelectorAll("article").forEach((item) => {
    item.classList.toggle("active", item.dataset.entry === String(index));
  });
  readerTitle.textContent = entry.title;
  readerDate.textContent = entry.date;
  readerText.textContent = entry.locked ? "这篇日记已加锁。" : entry.text;
  readerCard.querySelector("img").src = entry.image;
  readerCard.querySelector("img").alt = entry.title;
}

function renderCalendar() {
  const marked = new Set([1, 2, 4, 7, 8, 9, 11, 13, 14, 15, 16, 17, 19, 21, 24, 26, 28, 30]);
  calendarGrid.innerHTML = Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    const classes = `${marked.has(day) ? "marked" : ""} ${day === 17 ? "active" : ""}`.trim();
    return `<button class="${classes}" data-day="${day}" type="button">${day}</button>`;
  }).join("");

  calendarGrid.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      calendarGrid.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    });
  });
}

function syncToggleState() {
  profileSync.textContent = autoSync ? "自动同步已开启" : "自动同步已暂停";
  toggleSyncButton.textContent = autoSync ? "暂停同步" : "开启同步";
  heroSyncText.textContent = autoSync ? "同步服务已连接" : "自动同步已暂停";
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

renderCalendar();
renderTimeline();
loadEditor();
loadReader(Math.max(0, entries.findIndex((entry) => entry.id === activeEntryId)));
syncToggleState();

if (hasLegacyDraft) {
  persistEntries();
} else {
  pullSharedState(true);
}

window.setInterval(() => pullSharedState(false), POLL_INTERVAL);
