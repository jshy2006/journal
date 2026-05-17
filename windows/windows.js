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
    text: `下班路上风很轻，便利店门口的灯把雨水照得像一层薄玻璃。

今天最想记住的是，自己终于没有急着把一天过成清单。慢慢走回家，听完一整首歌，买了一盒热牛奶。那些很小的安稳，好像也能把人接住。

明天想早点起床，把阳台的薄荷修一下。`,
    updatedAt: Date.now() - 1000 * 60 * 4,
    syncedAt: Date.now() - 1000 * 60 * 4,
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
    text: `换了床单，把书桌左边空出来，心里也像被擦过一遍。

原来很多疲惫不是来自事情本身，而是所有东西都挤在一起。晚上打开台灯时，房间终于有了能呼吸的地方。`,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24,
    syncedAt: Date.now() - 1000 * 60 * 60 * 24,
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
    text: `今天没有特别厉害，但没有逃走。这样也值得被认真记下来。

希望以后的我看到这里，会记得这一天其实也很努力。`,
    updatedAt: Date.now() - 1000 * 60 * 60 * 48,
    syncedAt: Date.now() - 1000 * 60 * 60 * 48,
    locked: true
  }
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

const SYNC_ENDPOINT = "/api/state";
const POLL_INTERVAL = 1600;

let entries = normalizeEntries(storage.get("chaomu-windows-entries-v2", null) || storage.get("chaomu-windows-entries-v1", defaultEntries));

let activeEntryId = storage.get("chaomu-windows-active-id", entries[0]?.id);
let autoSyncEnabled = storage.get("chaomu-windows-auto-sync", true);
let uploadTimer = 0;
let saveTimer = 0;
let searchQuery = "";
let sharedUpdatedAt = 0;
let isApplyingSharedState = false;

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
const dayReview = document.querySelector("#dayReview");
const moodMap = document.querySelector("#moodMap");
const moodFilters = document.querySelectorAll(".mood-filter");
const unlockButton = document.querySelector("#unlockButton");
const privateActions = document.querySelectorAll(".private-action");

function getActiveEntry() {
  return entries.find((entry) => entry.id === activeEntryId) || entries[0];
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

function getSharedState() {
  return {
    version: 1,
    activeEntryId,
    updatedAt: Date.now(),
    entries
  };
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
  renderEntryList();
  loadEntry(activeEntryId || entries[0]?.id);
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

function persistEntries(sync = true) {
  storage.set("chaomu-windows-entries-v2", entries);
  storage.set("chaomu-windows-active-id", activeEntryId);
  if (sync) scheduleSharedPush();
}

function formatNowLabel() {
  const now = new Date();
  return `今天 ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
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
    saveStatus.textContent = "本地已保存";
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
    entryList.innerHTML = `<div class="empty-list">没有找到匹配的日记</div>`;
    return;
  }

  entryList.innerHTML = visibleEntries.map((entry) => {
    const preview = entry.locked ? "这篇日记已加锁。" : (entry.text.split("\n").find(Boolean) || "还没有写下内容。");
    const tags = entry.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("");
    const activeClass = entry.id === activeEntryId ? " active" : "";

    return `
      <article class="entry-card${activeClass}" data-entry-id="${escapeHtml(entry.id)}" tabindex="0">
        <div class="entry-topline">
          <span class="mood-chip ${escapeHtml(entry.moodClass)}"></span>
          <time>${escapeHtml(entry.date)}</time>
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
    button.classList.toggle("active", button.dataset.mood === entry.mood);
  });
}

function loadEntry(id) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;

  activeEntryId = entry.id;
  title.textContent = entry.title;
  date.textContent = entry.date;
  mood.textContent = entry.mood;
  weather.textContent = entry.weather;
  place.textContent = entry.place;
  textArea.value = entry.locked ? "这篇日记已加锁。可在私密匣中解锁查看。" : entry.text;
  textArea.disabled = entry.locked;
  editorTags.innerHTML = entry.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("");
  syncMoodButtons(entry);
  updateWordCount();
  saveStatus.textContent = entry.locked ? "已加锁" : "本地已保存";
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
    showDesktopFeedback("请先解锁");
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
  scheduleCloudUpload();
}

function uploadToGoogleDrive() {
  pushSharedState();
}

function scheduleCloudUpload() {
  refreshSyncStatus();

  if (!autoSyncEnabled || !navigator.onLine) return;

  scheduleSharedPush(700);
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
    tags: ["新日记"],
    text: "",
    updatedAt: now,
    syncedAt: 0,
    locked: false
  };

  entries.unshift(entry);
  activeEntryId = entry.id;
  persistEntries();
  switchView("write");
  renderEntryList();
  loadEntry(entry.id);
  textArea.focus();
  scheduleCloudUpload();
}

function renderCalendar() {
  const marked = new Set([1, 2, 4, 7, 8, 9, 11, 13, 14, 15, 16, 17, 19, 21, 24, 26, 28, 30]);
  const week = ["一", "二", "三", "四", "五", "六", "日"];

  calendarGrid.innerHTML = Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    const moodName = day % 5 === 0 ? "温暖" : day % 4 === 0 ? "开心" : day % 6 === 0 ? "低落" : "平静";
    const classes = `${marked.has(day) ? "marked" : ""} ${day === 17 ? "active" : ""}`.trim();
    return `<button class="${classes}" data-day="${day}" data-mood="${moodName}" type="button"><span>${week[index % 7]}</span><strong>${day}</strong><span>${marked.has(day) ? moodName : "未记录"}</span></button>`;
  }).join("");

  calendarGrid.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      calendarGrid.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      dayReview.querySelector("span").textContent = `5月${button.dataset.day}日`;
      dayReview.querySelector("h2").textContent = button.dataset.day === "17" ? "雨停以后" : `${button.dataset.mood}的一天`;
      dayReview.querySelector("p").textContent = button.classList.contains("marked")
        ? `这一天的主要情绪是${button.dataset.mood}，已经收进五月回顾。`
        : "这一天还没有记录，可以从今日书写补一篇。";
    });
  });
}

function renderMoodMap() {
  const moodClasses = ["calm", "bright", "calm", "warm", "low", "calm", "bright", "warm", "calm", "bright", "calm", "warm", "calm", "low", "calm", "bright", "warm", "calm", "calm", "bright", "calm", "warm", "calm", "low", "bright", "calm", "warm", "calm", "bright", "calm", "warm"];

  moodMap.innerHTML = moodClasses.map((moodClass, index) => {
    return `<button class="${moodClass} ${index === 16 ? "active" : ""}" data-day="${index + 1}" type="button">${index + 1}</button>`;
  }).join("");

  moodMap.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      moodMap.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    });
  });
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
    scheduleCloudUpload();
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
    if (action === "添加图片") insertAtCursor("\n[图片：今日照片]\n");
    if (action === "语音") insertAtCursor("\n[语音记录：00:15]\n");
    if (action === "锁定") {
      const entry = getActiveEntry();
      if (!entry) return;
      entry.locked = true;
      persistEntries();
      loadEntry(entry.id);
    }
  });
});

promptButtons.forEach((button) => {
  button.addEventListener("click", () => insertAtCursor(`\n\n${button.textContent}\n`));
});

metaTiles.forEach((button) => {
  button.addEventListener("click", () => {
    const label = button.querySelector("span")?.textContent || "信息";
    showDesktopFeedback(`已打开${label}设置`);
  });
});

moodFilters.forEach((button) => {
  button.addEventListener("click", () => {
    moodFilters.forEach((item) => item.classList.toggle("active", item === button));
    moodMap.querySelectorAll("button").forEach((item) => {
      item.style.opacity = item.classList.contains(button.dataset.mood) ? "1" : "0.35";
    });
  });
});

privateActions.forEach((button) => {
  button.addEventListener("click", () => {
    button.textContent = button.textContent === "查看" ? "已隐藏" : "查看";
  });
});

unlockButton.addEventListener("click", () => {
  const lockedEntry = entries.find((entry) => entry.locked);
  if (!lockedEntry) return;
  lockedEntry.locked = false;
  persistEntries();
  activeEntryId = lockedEntry.id;
  switchView("write");
  loadEntry(lockedEntry.id);
});

textArea.addEventListener("input", () => {
  updateActiveEntry({ text: textArea.value });
  updateWordCount();
  saveLocalDraft();
  scheduleCloudUpload();
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
    uploadToGoogleDrive();
  } else {
    refreshSyncStatus();
  }
});

window.addEventListener("online", scheduleCloudUpload);
window.addEventListener("offline", refreshSyncStatus);

renderCalendar();
renderMoodMap();
renderEntryList();
loadEntry(activeEntryId || entries[0].id);
pullSharedState(true);
window.setInterval(() => pullSharedState(false), POLL_INTERVAL);
