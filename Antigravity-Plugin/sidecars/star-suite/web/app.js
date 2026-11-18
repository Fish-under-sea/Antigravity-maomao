const el = {
  btnRefresh: document.getElementById("btnRefresh"),
  errorBanner: document.getElementById("errorBanner"),
  widgetStatusPill: document.getElementById("widgetStatusPill"),
  widgetPathDesc: document.getElementById("widgetPathDesc"),
  chkWidgetAutoLaunch: document.getElementById("chkWidgetAutoLaunch"),
  btnWidgetRecall: document.getElementById("btnWidgetRecall"),
  btnWidgetStart: document.getElementById("btnWidgetStart"),
  btnWidgetQuit: document.getElementById("btnWidgetQuit"),
  hostStatusPill: document.getElementById("hostStatusPill"),
  hostStatusText: document.getElementById("hostStatusText"),
  chkSkinEnabled: document.getElementById("chkSkinEnabled"),
  outputModeBtns: Array.from(document.querySelectorAll("[data-output-mode]")),
  activeMediaBadge: document.getElementById("activeMediaBadge"),
  activeMediaName: document.getElementById("activeMediaName"),
  btnPickMedia: document.getElementById("btnPickMedia"),
  btnSelectPreset: document.getElementById("btnSelectPreset"),
  pathForm: document.getElementById("pathForm"),
  inputMediaPath: document.getElementById("inputMediaPath"),
  recentWrap: document.getElementById("recentWrap"),
  recentList: document.getElementById("recentList"),
  videoControls: document.getElementById("videoControls"),
  chkVideoMuted: document.getElementById("chkVideoMuted"),
  btnVideoPause: document.getElementById("btnVideoPause"),
  selPlaybackRate: document.getElementById("selPlaybackRate"),
  previewStage: document.getElementById("previewStage"),
  previewImg: document.getElementById("previewImg"),
  previewVideo: document.getElementById("previewVideo"),
  previewScrim: document.getElementById("previewScrim"),
  fitBtns: Array.from(document.querySelectorAll("[data-fit]")),
  btnResetCamera: document.getElementById("btnResetCamera"),
  rngOpacity: document.getElementById("rngOpacity"),
  valOpacity: document.getElementById("valOpacity"),
  rngScrim: document.getElementById("rngScrim"),
  valScrim: document.getElementById("valScrim"),
  rngZoom: document.getElementById("rngZoom"),
  valZoom: document.getElementById("valZoom"),
};

let latestState = null;
let dragging = null;
let loadedVideoSrc = "";
let loadedImgSrc = "";

function setError(message) {
  if (!message) {
    el.errorBanner.textContent = "";
    el.errorBanner.classList.add("hidden");
    return;
  }
  el.errorBanner.textContent = message;
  el.errorBanner.classList.remove("hidden");
}

async function apiFetch(routePath, init = {}) {
  if (window.sidecar && typeof window.sidecar.fetch === "function") {
    return window.sidecar.fetch(routePath, init);
  }
  return fetch("." + routePath, init);
}

async function requestJson(routePath, method = "GET", body = null) {
  const init = { method, headers: {} };
  if (body !== null) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await apiFetch(routePath, init);
  const text = await response.text();
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text };
    }
  }
  if (!response.ok) {
    throw new Error(parsed.error || `请求失败 (${response.status})`);
  }
  return parsed;
}

function updatePreviewMedia(state) {
  const s = state.settings;
  const media = state.activeMedia || {};
  const isVideo = media.mediaKind === "video" && !media.wallpaperError && media.mediaUrl;

  const fitMode = s.fit === "adaptive" ? "cover" : s.fit;
  const opacity = s.enabled ? s.opacity / 100 : 0.25;
  const objectPos = `${s.positionX}% ${s.positionY}%`;
  const transform = `scale(${s.zoom})`;

  if (isVideo) {
    el.previewImg.classList.add("hidden");
    el.previewVideo.classList.remove("hidden");
    if (loadedVideoSrc !== media.mediaUrl) {
      loadedVideoSrc = media.mediaUrl;
      el.previewVideo.src = media.mediaUrl;
    }
    el.previewVideo.muted = s.videoMuted !== false;
    el.previewVideo.playbackRate = Number(s.videoPlaybackRate || 1);
    el.previewVideo.style.objectFit = fitMode;
    el.previewVideo.style.objectPosition = objectPos;
    el.previewVideo.style.opacity = String(opacity);
    el.previewVideo.style.transform = transform;
    if (s.videoPaused) {
      el.previewVideo.pause();
    } else {
      el.previewVideo.play().catch(() => {});
    }
  } else {
    el.previewVideo.classList.add("hidden");
    if (loadedVideoSrc) {
      el.previewVideo.pause();
      el.previewVideo.removeAttribute("src");
      el.previewVideo.load();
      loadedVideoSrc = "";
    }
    el.previewImg.classList.remove("hidden");
    const targetSrc = media.mediaUrl || "./preset-wallpaper.png";
    if (loadedImgSrc !== targetSrc) {
      loadedImgSrc = targetSrc;
      el.previewImg.src = targetSrc;
    }
    el.previewImg.style.objectFit = fitMode;
    el.previewImg.style.objectPosition = objectPos;
    el.previewImg.style.opacity = String(opacity);
    el.previewImg.style.transform = transform;
  }

  const scrimAlpha = Math.max(0, Math.min(0.6, (s.scrim ?? 12) / 100));
  el.previewScrim.style.background = `linear-gradient(180deg, rgba(16, 17, 24, ${scrimAlpha * 0.45}), rgba(10, 12, 18, ${scrimAlpha * 0.72}))`;
}

function renderRecentChips(state) {
  const items = state.recentItems || [];
  if (!items.length) {
    el.recentWrap.classList.add("hidden");
    el.recentList.replaceChildren();
    return;
  }
  el.recentWrap.classList.remove("hidden");
  el.recentList.replaceChildren();
  const activePath = state.settings.mediaType === "preset" ? "" : state.settings.customMediaPath;

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    if (activePath && item.path === activePath) btn.classList.add("active");
    if (!item.exists) btn.classList.add("missing");
    btn.title = item.path;
    btn.textContent = `${item.kind === "video" ? "🎬" : "🖼"} ${item.name}`;
    btn.addEventListener("click", async () => {
      try {
        setError("");
        const next = await requestJson("/api/select-media", "POST", { path: item.path });
        renderState(next);
      } catch (error) {
        setError(error.message);
      }
    });
    el.recentList.appendChild(btn);
  }
}

function renderState(state) {
  latestState = state;
  const s = state.settings;
  const media = state.activeMedia || {};
  const widget = state.widget || {};
  const host = state.status || {};

  // Errors (missing file or widget launch issue)
  setError(state.wallpaperError || widget.error || "");

  // Widget card
  el.chkWidgetAutoLaunch.checked = Boolean(s.widgetAutoLaunch);
  if (!widget.available) {
    el.widgetStatusPill.textContent = "未安装";
    el.widgetStatusPill.className = "pill warn";
    el.widgetPathDesc.textContent = "未找到 StarWidget.exe，请先安装星语桌宠挂件";
  } else if (widget.running) {
    el.widgetStatusPill.textContent = "运行中";
    el.widgetStatusPill.className = "pill ok";
    el.widgetPathDesc.textContent = widget.path || "StarWidget 已在托盘运行";
  } else {
    el.widgetStatusPill.textContent = "已停止";
    el.widgetStatusPill.className = "pill";
    el.widgetPathDesc.textContent = widget.path || "点击唤起即可启动星语桌宠";
  }
  el.btnWidgetStart.disabled = !widget.available;
  el.btnWidgetRecall.disabled = !widget.available;
  el.btnWidgetQuit.disabled = !widget.running;

  // Host connection pill
  if (host.applied) {
    el.hostStatusPill.textContent = "已应用皮肤";
    el.hostStatusPill.className = "pill ok";
  } else if (host.connected) {
    el.hostStatusPill.textContent = "已连接";
    el.hostStatusPill.className = "pill warn";
  } else {
    el.hostStatusPill.textContent = "未连接";
    el.hostStatusPill.className = "pill";
  }
  el.hostStatusText.textContent = host.message || "等待检测 Antigravity";

  // Skin switches & segmented controls
  el.chkSkinEnabled.checked = Boolean(s.enabled);
  for (const btn of el.outputModeBtns) {
    btn.classList.toggle("active", btn.dataset.outputMode === s.outputMode);
  }
  for (const btn of el.fitBtns) {
    btn.classList.toggle("active", btn.dataset.fit === s.fit);
  }

  // Active media metadata
  const badgeText =
    s.mediaType === "video" ? "MP4 / 视频背景" : s.mediaType === "image" ? "自定义图片" : "内置预设";
  el.activeMediaBadge.textContent = badgeText;
  el.activeMediaName.textContent = media.mediaName || state.wallpaper || "Gemini 角色立绘预设";
  el.btnSelectPreset.classList.toggle("hidden", s.mediaType === "preset");
  if (document.activeElement !== el.inputMediaPath) {
    el.inputMediaPath.value = s.mediaType === "preset" ? "" : s.customMediaPath || "";
  }

  // Video playback controls
  const showVideoControls = s.mediaType === "video" || media.mediaKind === "video";
  el.videoControls.classList.toggle("hidden", !showVideoControls);
  el.chkVideoMuted.checked = s.videoMuted !== false;
  el.btnVideoPause.textContent = s.videoPaused ? "继续播放" : "暂停播放";
  el.selPlaybackRate.value = String(s.videoPlaybackRate ?? 1);

  // Sliders
  el.rngOpacity.value = String(s.opacity);
  el.valOpacity.textContent = `${Math.round(s.opacity)}%`;
  el.rngScrim.value = String(s.scrim);
  el.valScrim.textContent = `${Math.round(s.scrim)}%`;
  el.rngZoom.value = String(s.zoom);
  el.valZoom.textContent = `${Number(s.zoom).toFixed(2)}x`;

  renderRecentChips(state);
  updatePreviewMedia(state);
}

async function saveSettings(patch) {
  try {
    setError("");
    const next = await requestJson("/api/settings", "POST", patch);
    renderState(next);
  } catch (error) {
    setError(error.message);
  }
}

async function fetchState() {
  try {
    const next = await requestJson("/api/state", "GET");
    renderState(next);
  } catch (error) {
    setError(error.message);
  }
}

el.btnRefresh.addEventListener("click", async () => {
  try {
    setError("");
    const next = await requestJson("/api/refresh", "POST", {});
    renderState(next);
  } catch (error) {
    setError(error.message);
  }
});

el.chkWidgetAutoLaunch.addEventListener("change", async () => {
  try {
    const res = await requestJson("/api/widget", "POST", {
      action: "autoLaunch",
      value: el.chkWidgetAutoLaunch.checked,
    });
    if (res.state) renderState(res.state);
  } catch (error) {
    setError(error.message);
  }
});

for (const [btn, action] of [
  [el.btnWidgetRecall, "recall"],
  [el.btnWidgetStart, "start"],
  [el.btnWidgetQuit, "quit"],
]) {
  btn.addEventListener("click", async () => {
    try {
      setError("");
      const res = await requestJson("/api/widget", "POST", { action });
      if (res.state) renderState(res.state);
      setTimeout(fetchState, 900);
    } catch (error) {
      setError(error.message);
    }
  });
}

el.chkSkinEnabled.addEventListener("change", () => {
  saveSettings({ enabled: el.chkSkinEnabled.checked });
});

for (const btn of el.outputModeBtns) {
  btn.addEventListener("click", () => {
    saveSettings({ outputMode: btn.dataset.outputMode });
  });
}

for (const btn of el.fitBtns) {
  btn.addEventListener("click", () => {
    saveSettings({ fit: btn.dataset.fit });
  });
}

el.btnPickMedia.addEventListener("click", async () => {
  el.btnPickMedia.disabled = true;
  try {
    setError("");
    const res = await requestJson("/api/pick-media", "POST", {});
    if (res.state) renderState(res.state);
  } catch (error) {
    setError(error.message);
  } finally {
    el.btnPickMedia.disabled = false;
  }
});

el.btnSelectPreset.addEventListener("click", async () => {
  try {
    setError("");
    const next = await requestJson("/api/select-media", "POST", { mediaType: "preset" });
    renderState(next);
  } catch (error) {
    setError(error.message);
  }
});

el.pathForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const target = el.inputMediaPath.value.trim();
  if (!target) return;
  try {
    setError("");
    const next = await requestJson("/api/select-media", "POST", { path: target });
    renderState(next);
  } catch (error) {
    setError(error.message);
  }
});

el.chkVideoMuted.addEventListener("change", () => {
  saveSettings({ videoMuted: el.chkVideoMuted.checked });
});

el.btnVideoPause.addEventListener("click", () => {
  const paused = !latestState?.settings?.videoPaused;
  saveSettings({ videoPaused: paused });
});

el.selPlaybackRate.addEventListener("change", () => {
  saveSettings({ videoPlaybackRate: Number(el.selPlaybackRate.value) });
});

el.btnResetCamera.addEventListener("click", () => {
  saveSettings({ positionX: 50, positionY: 50, zoom: 1 });
});

for (const [input, key, format, output] of [
  [el.rngOpacity, "opacity", (v) => `${Math.round(v)}%`, el.valOpacity],
  [el.rngScrim, "scrim", (v) => `${Math.round(v)}%`, el.valScrim],
  [el.rngZoom, "zoom", (v) => `${Number(v).toFixed(2)}x`, el.valZoom],
]) {
  input.addEventListener("input", () => {
    const val = Number(input.value);
    output.textContent = format(val);
    if (latestState) {
      latestState.settings[key] = val;
      updatePreviewMedia(latestState);
    }
  });
  input.addEventListener("change", () => {
    saveSettings({ [key]: Number(input.value) });
  });
}

el.previewStage.addEventListener("pointerdown", (event) => {
  if (!latestState) return;
  el.previewStage.setPointerCapture(event.pointerId);
  dragging = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    baseX: latestState.settings.positionX,
    baseY: latestState.settings.positionY,
  };
});

el.previewStage.addEventListener("pointermove", (event) => {
  if (!dragging || !latestState) return;
  const rect = el.previewStage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dxPct = ((event.clientX - dragging.startX) / rect.width) * 100;
  const dyPct = ((event.clientY - dragging.startY) / rect.height) * 100;
  latestState.settings.positionX = Math.max(0, Math.min(100, dragging.baseX - dxPct));
  latestState.settings.positionY = Math.max(0, Math.min(100, dragging.baseY - dyPct));
  updatePreviewMedia(latestState);
});

const endDrag = () => {
  if (!dragging || !latestState) return;
  dragging = null;
  saveSettings({
    positionX: Math.round(latestState.settings.positionX * 10) / 10,
    positionY: Math.round(latestState.settings.positionY * 10) / 10,
  });
};

el.previewStage.addEventListener("pointerup", endDrag);
el.previewStage.addEventListener("pointercancel", endDrag);

fetchState();
setInterval(() => {
  if (!dragging) fetchState();
}, 4000);
