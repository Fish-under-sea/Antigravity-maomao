"use strict";

const { createVialEngineSource } = require("./vial-physics.cjs");

/**
 * Pure MIT clean-room Telemetry Bottom Toolbar (3 Icons / Adaptive Stats Bar),
 * 512K Borosilicate Shallow-Water Vial Popover, and 53-Week Usage Dashboard Modal.
 *
 * Serialized via installTelemetryBar.toString() into Antigravity host over CDP:
 * 100% self-contained (zero external require() or outer closure references).
 */
function installTelemetryBar(config) {
  const KEY = "__agyMaomaoTelemetryBar";
  const REV = 8;
  const HOST_ID = "agy-maomao-telemetry-host";
  const POPOVER_ID = "agy-maomao-telemetry-popover-host";
  const DASHBOARD_ID = "agy-maomao-dashboard-host";
  const STYLE_STORAGE_KEY = "maomao_vial_style_v1";
  const TAKEOVER_STORAGE_KEY = "maomao_telemetry_takeover_v1";

  function normalizeConfig(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const sub = src.telemetry && typeof src.telemetry === "object" ? src.telemetry : src;
    const rawBarMode = String(sub.barMode || "auto");
    const barMode = ["auto", "icons", "full", "off"].includes(rawBarMode) ? rawBarMode : "auto";
    const rawVialStyle = String(sub.vialStyle || "vial");
    return {
      owner: typeof src.owner === "string" && src.owner ? src.owner : "antigravity-star-suite",
      enabled: sub.enabled !== false && barMode !== "off",
      barMode,
      vialEnabled: sub.vialEnabled !== false,
      vialStyle: rawVialStyle === "bar" ? "bar" : "vial",
      quotaEnabled: sub.quotaEnabled !== false,
      themeStyle: (src.themeStyle || src.glass?.themeStyle) === "official" ? "official" : "star-neko",
      sidecarBaseUrl: typeof src.sidecarBaseUrl === "string" ? src.sidecarBaseUrl.replace(/\/+$/, "") : "",
      sidecarToken: typeof src.sidecarToken === "string" ? src.sidecarToken : "",
      conversationId: typeof src.conversationId === "string" ? src.conversationId : "",
      pollOpenMs: Math.max(500, Math.min(30000, Number(sub.pollOpenMs) || 2000)),
      pollClosedMs: Math.max(1000, Math.min(60000, Number(sub.pollClosedMs) || 5000)),
      takeoverExternal: Boolean(sub.takeoverExternal),
    };
  }

  let cfg = normalizeConfig(config);

  if (window[KEY]) {
    if (window[KEY].owner === cfg.owner && window[KEY].rev === REV && typeof window[KEY].update === "function") {
      window[KEY].update(config);
      return window[KEY].status();
    }
    try {
      window[KEY].destroy();
    } catch {}
  }

  if (typeof document === "undefined" || !document.body) {
    return { applied: false, reason: "no-dom" };
  }

  // ---- Inline Self-Contained 24-Node 1D Shallow-Water Vial Physics Engine ----
  function makeVialEngine(options) {
    const opts = options && typeof options === "object" ? options : {};
    const N = Math.max(8, Math.min(64, Math.round(Number(opts.nodes) || 24)));
    const stiffness = 38.0;
    const damping = 3.2;
    const spread = 22.0;
    const pendOmega = 6.4;
    const pendZeta = 0.34;
    const sleepDelayMs = 1100;
    const energyThreshold = 0.00018;

    const h = new Float64Array(N);
    const v = new Float64Array(N);
    const hNext = new Float64Array(N);

    const st = {
      nodes: N,
      h,
      v,
      level: 0,
      targetLevel: 0,
      maxTokens: 524288,
      usedTokens: 0,
      tiltAngle: 0,
      tiltVel: 0,
      droplets: [],
      bubbles: [],
      stillMs: 0,
      sleeping: true,
      clockSec: 0,
      energy: 0,
      highlightCategory: null,
      categories: [],
    };

    function clamp01(x) {
      const n = Number(x);
      return !Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n;
    }

    function wake() {
      st.stillMs = 0;
      st.sleeping = false;
    }

    function poke(xNorm, strength) {
      const x = clamp01(xNorm == null ? 0.5 : xNorm);
      const amp = Number.isFinite(strength) ? Math.max(-1.6, Math.min(1.6, strength)) : 0.45;
      const center = x * (N - 1);
      const sigma = Math.max(1.4, N * 0.11);
      const inv2s2 = 0.5 / (sigma * sigma);
      for (let i = 0; i < N; i++) {
        const d = i - center;
        v[i] += amp * Math.exp(-(d * d) * inv2s2) * 3.6;
      }
      wake();
    }

    function spawnDroplet(xNorm) {
      if (st.droplets.length >= 10) return;
      st.droplets.push({
        x: clamp01(xNorm == null ? 0.3 + Math.random() * 0.4 : xNorm),
        y: 0.05,
        vy: 0.24 + Math.random() * 0.16,
        r: 2.0 + Math.random() * 1.3,
      });
      wake();
    }

    function spawnBubble(xNorm) {
      if (st.bubbles.length >= 16 || st.level < 0.04) return;
      st.bubbles.push({
        x: clamp01(xNorm == null ? 0.14 + Math.random() * 0.72 : xNorm),
        y: 1.0 - Math.random() * Math.min(0.14, st.level * 0.5),
        vy: 0.09 + Math.random() * 0.14,
        r: 1.1 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2,
        sway: 0.015 + Math.random() * 0.024,
        alpha: 0.45 + Math.random() * 0.4,
      });
    }

    function applyDragAccel(ax, ay) {
      const fx = Number.isFinite(ax) ? Math.max(-40, Math.min(40, ax)) : 0;
      const fy = Number.isFinite(ay) ? Math.max(-40, Math.min(40, ay)) : 0;
      if (Math.abs(fx) < 0.01 && Math.abs(fy) < 0.01) return;
      st.tiltVel = Math.max(-6.5, Math.min(6.5, st.tiltVel - fx * 0.085));
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1) - 0.5;
        v[i] += -fx * 0.24 * u + fy * 0.06 * (0.25 - u * u);
      }
      if (Math.abs(fx) > 3.5 && st.bubbles.length < 16 && st.level > 0.05) {
        spawnBubble(0.2 + Math.random() * 0.6);
      }
      wake();
    }

    function setTargetLevel(nextLevel, meta) {
      const clamped = clamp01(nextLevel);
      const prev = st.targetLevel;
      st.targetLevel = clamped;
      if (meta && typeof meta === "object") {
        if (Number.isFinite(meta.maxTokens) && meta.maxTokens > 0) st.maxTokens = meta.maxTokens;
        if (Number.isFinite(meta.usedTokens) && meta.usedTokens >= 0) st.usedTokens = meta.usedTokens;
        if (Array.isArray(meta.categories)) st.categories = meta.categories;
      }
      const diff = clamped - prev;
      if (Math.abs(diff) > 0.0008) {
        wake();
        if (diff > 0.008) {
          const count = Math.min(4, Math.max(1, Math.round(diff * 24)));
          for (let i = 0; i < count; i++) spawnDroplet(0.25 + ((i + 0.5) / count) * 0.5);
        } else if (diff < -0.02) {
          poke(0.5, -0.55);
        }
      }
    }

    function setHighlightCategory(catKey) {
      const next = catKey || null;
      if (st.highlightCategory !== next) {
        st.highlightCategory = next;
        wake();
      }
    }

    function computeEnergy() {
      let e = 0;
      for (let i = 0; i < N; i++) e += h[i] * h[i] * 2.5 + v[i] * v[i] * 0.25;
      e /= N;
      e += st.tiltAngle * st.tiltAngle * 2.0 + st.tiltVel * st.tiltVel * 0.12;
      e += Math.abs(st.targetLevel - st.level) * 4.0 + st.droplets.length * 0.08;
      return e;
    }

    function step(dtSeconds) {
      const clampedDt = Math.min(0.032, Math.max(0.001, Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0.016));
      if (st.sleeping) return { sleeping: true, active: false, energy: 0 };
      st.clockSec += clampedDt;
      const diff = st.targetLevel - st.level;
      if (Math.abs(diff) > 0.0001) st.level += diff * Math.min(1, clampedDt * 5.2);
      else st.level = st.targetLevel;

      const sdt = clampedDt * 0.5;
      for (let s = 0; s < 2; s++) {
        const pAcc = -(pendOmega * pendOmega) * st.tiltAngle - 2 * pendZeta * pendOmega * st.tiltVel;
        st.tiltVel += pAcc * sdt;
        st.tiltAngle = Math.max(-0.42, Math.min(0.42, st.tiltAngle + st.tiltVel * sdt));
        for (let i = 0; i < N; i++) {
          const left = i > 0 ? h[i - 1] : h[i];
          const right = i < N - 1 ? h[i + 1] : h[i];
          const u = i / (N - 1) - 0.5;
          const acc = -stiffness * h[i] - damping * v[i] + spread * (left + right - 2 * h[i]) - st.tiltVel * 0.14 * u;
          v[i] = Math.max(-12, Math.min(12, v[i] + acc * sdt));
          hNext[i] = h[i] + v[i] * sdt;
        }
        let mean = 0;
        for (let i = 0; i < N; i++) mean += hNext[i];
        mean /= N;
        for (let i = 0; i < N; i++) h[i] = Math.max(-0.35, Math.min(0.35, hNext[i] - mean));
      }

      const surfaceY = 1.0 - st.level;
      for (let i = st.droplets.length - 1; i >= 0; i--) {
        const d = st.droplets[i];
        d.vy += 2.6 * clampedDt;
        d.y += d.vy * clampedDt;
        if (d.y >= surfaceY) {
          poke(d.x, Math.min(0.8, 0.25 + d.vy * 0.25));
          spawnBubble(d.x);
          st.droplets.splice(i, 1);
        }
      }

      if (st.level > 0.08 && st.bubbles.length < 7 && Math.random() < clampedDt * 2.2) spawnBubble();
      for (let i = st.bubbles.length - 1; i >= 0; i--) {
        const b = st.bubbles[i];
        b.y -= b.vy * clampedDt;
        b.phase += clampedDt * 3.1;
        if (b.y <= surfaceY + 0.015) st.bubbles.splice(i, 1);
      }

      const energy = computeEnergy();
      st.energy = energy;
      if (energy < energyThreshold && st.droplets.length === 0 && Math.abs(st.targetLevel - st.level) < 0.0005) {
        st.stillMs += clampedDt * 1000;
        if (st.stillMs >= sleepDelayMs) {
          for (let i = 0; i < N; i++) {
            h[i] = 0;
            v[i] = 0;
          }
          st.tiltAngle = 0;
          st.tiltVel = 0;
          st.level = st.targetLevel;
          st.energy = 0;
          st.sleeping = true;
        }
      } else {
        st.stillMs = 0;
      }
      return { sleeping: st.sleeping, active: !st.sleeping, energy: st.energy };
    }

    function drawRounded(ctx, x, y, w, ht, rt, rb) {
      const r1 = Math.min(rt, w * 0.5, ht * 0.5);
      const r2 = Math.min(rb, w * 0.5, ht * 0.5);
      ctx.beginPath();
      ctx.moveTo(x + r1, y);
      ctx.lineTo(x + w - r1, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r1);
      ctx.lineTo(x + w, y + ht - r2);
      ctx.quadraticCurveTo(x + w, y + ht, x + w - r2, y + ht);
      ctx.lineTo(x + r2, y + ht);
      ctx.quadraticCurveTo(x, y + ht, x, y + ht - r2);
      ctx.lineTo(x, y + r1);
      ctx.quadraticCurveTo(x, y, x + r1, y);
      ctx.closePath();
    }

    function render(ctx, width, height, theme) {
      if (!ctx || width <= 0 || height <= 0) return;
      const dark = theme?.dark !== false;
      const starNeko = theme?.themeStyle !== "official";
      const pct = st.level * 100;
      const pal =
        pct >= 80
          ? { top: "#fb7185", mid: "#e11d48", bot: "#881337", crest: "#ffe4e6", glow: "rgba(244,63,94,0.40)", drop: "#fda4af" }
          : pct >= 60
            ? { top: "#fcd34d", mid: "#f59e0b", bot: "#92400e", crest: "#fef3c7", glow: "rgba(245,158,11,0.34)", drop: "#fde68a" }
            : starNeko
              ? { top: "#c4b5fd", mid: "#8b5cf6", bot: "#3b237a", crest: "#ede9fe", glow: "rgba(167,139,250,0.42)", drop: "#ddd6fe" }
              : { top: "#34d399", mid: "#10b981", bot: "#065f46", crest: "#d1fae5", glow: "rgba(16,185,129,0.38)", drop: "#a7f3d0" };

      ctx.clearRect(0, 0, width, height);
      const padX = Math.max(10, width * 0.13);
      const padY = Math.max(10, height * 0.055);
      const tubeW = Math.max(24, width - padX * 2);
      const tubeH = Math.max(40, height - padY * 2);
      const tubeX = (width - tubeW) * 0.5;
      const tubeY = padY;
      const rTop = Math.min(14, tubeW * 0.24);
      const rBot = Math.min(tubeW * 0.48, 30);

      if (st.level > 0.02) {
        ctx.save();
        const gy = tubeY + tubeH * (1 - st.level * 0.55);
        const rad = ctx.createRadialGradient(tubeX + tubeW * 0.5, gy, tubeW * 0.1, tubeX + tubeW * 0.5, gy, tubeW);
        rad.addColorStop(0, pal.glow);
        rad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = rad;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }

      ctx.save();
      drawRounded(ctx, tubeX, tubeY, tubeW, tubeH, rTop, rBot);
      const gBg = ctx.createLinearGradient(tubeX, tubeY, tubeX + tubeW, tubeY);
      if (dark) {
        gBg.addColorStop(0, starNeko ? "rgba(196,178,255,0.14)" : "rgba(255,255,255,0.10)");
        gBg.addColorStop(0.3, starNeko ? "rgba(22,16,40,0.58)" : "rgba(16,18,28,0.54)");
        gBg.addColorStop(0.8, starNeko ? "rgba(18,14,34,0.66)" : "rgba(14,16,24,0.62)");
        gBg.addColorStop(1, starNeko ? "rgba(216,198,255,0.16)" : "rgba(255,255,255,0.12)");
      } else {
        gBg.addColorStop(0, "rgba(255,255,255,0.74)");
        gBg.addColorStop(0.35, starNeko ? "rgba(237,231,254,0.45)" : "rgba(241,245,249,0.46)");
        gBg.addColorStop(1, "rgba(255,255,255,0.78)");
      }
      ctx.fillStyle = gBg;
      ctx.fill();
      ctx.restore();

      const wall = 3;
      const inX = tubeX + wall;
      const inY = tubeY + wall;
      const inW = tubeW - wall * 2;
      const inH = tubeH - wall * 2;

      ctx.save();
      drawRounded(ctx, inX, inY, inW, inH, Math.max(4, rTop - 2), Math.max(6, rBot - 2));
      ctx.clip();

      const baseLineY = inY + inH * (1 - st.level);
      const waveScale = Math.min(26, inH * 0.14);
      const tiltSlope = Math.tan(st.tiltAngle) * (inW * 0.48);
      const sy = (i, sign) => {
        const u = i / (N - 1);
        const idx = sign < 0 ? N - 1 - i : i;
        return baseLineY + (u - 0.5) * 2 * tiltSlope - (sign < 0 ? h[idx] * 0.55 : h[i]) * waveScale;
      };

      if (st.level > 0.002) {
        ctx.beginPath();
        ctx.moveTo(inX, inY + inH + 4);
        for (let i = 0; i < N; i++) {
          const px = inX + (i / (N - 1)) * inW;
          const py = sy(i, -1) - 1.5;
          if (i === 0) ctx.lineTo(px, py);
          else {
            const prevX = inX + ((i - 1) / (N - 1)) * inW;
            const prevY = sy(i - 1, -1) - 1.5;
            ctx.quadraticCurveTo(prevX, prevY, (prevX + px) * 0.5, (prevY + py) * 0.5);
          }
        }
        ctx.lineTo(inX + inW, sy(N - 1, -1) - 1.5);
        ctx.lineTo(inX + inW, inY + inH + 4);
        ctx.closePath();
        ctx.fillStyle = pal.top;
        ctx.globalAlpha = dark ? 0.34 : 0.28;
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.beginPath();
        ctx.moveTo(inX, inY + inH + 4);
        for (let i = 0; i < N; i++) {
          const px = inX + (i / (N - 1)) * inW;
          const py = sy(i, 1);
          if (i === 0) ctx.lineTo(px, py);
          else {
            const prevX = inX + ((i - 1) / (N - 1)) * inW;
            const prevY = sy(i - 1, 1);
            ctx.quadraticCurveTo(prevX, prevY, (prevX + px) * 0.5, (prevY + py) * 0.5);
          }
        }
        ctx.lineTo(inX + inW, sy(N - 1, 1));
        ctx.lineTo(inX + inW, inY + inH + 4);
        ctx.closePath();
        const lGrad = ctx.createLinearGradient(inX, Math.max(inY, baseLineY - 10), inX, inY + inH);
        lGrad.addColorStop(0, pal.top);
        lGrad.addColorStop(0.45, pal.mid);
        lGrad.addColorStop(1, pal.bot);
        ctx.fillStyle = lGrad;
        ctx.fill();

        if (st.highlightCategory && Array.isArray(st.categories) && st.categories.length) {
          const activeCats = st.categories.filter((c) => c && c.key !== "free" && (c.tokens || 0) > 0);
          const totalTok = activeCats.reduce((acc, c) => acc + (c.tokens || 0), 0);
          if (totalTok > 0) {
            let cursor = 0;
            const liqH = Math.max(1, inH * st.level);
            for (let i = 0; i < activeCats.length; i++) {
              const c = activeCats[i];
              const bh = ((c.tokens || 0) / totalTok) * liqH;
              const top = inY + inH - (cursor + bh);
              if (c.key === st.highlightCategory) {
                ctx.fillStyle = "rgba(255,255,255,0.34)";
                ctx.fillRect(inX, top, inW, Math.max(3, bh));
                break;
              }
              cursor += bh;
            }
          }
        }

        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const px = inX + (i / (N - 1)) * inW;
          const py = sy(i, 1);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = pal.crest;
        ctx.lineWidth = 1.7;
        ctx.globalAlpha = 0.85;
        ctx.stroke();
        ctx.globalAlpha = 1;

        for (let i = 0; i < st.bubbles.length; i++) {
          const b = st.bubbles[i];
          const bx = inX + (b.x + Math.sin(b.phase) * b.sway) * inW;
          const by = inY + b.y * inH;
          if (by < baseLineY + 2) continue;
          ctx.beginPath();
          ctx.arc(bx, by, b.r, 0, Math.PI * 2);
          ctx.fillStyle = pal.crest;
          ctx.globalAlpha = b.alpha * 0.7;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      for (let i = 0; i < st.droplets.length; i++) {
        const d = st.droplets[i];
        const dx = inX + d.x * inW;
        const dy = inY + d.y * inH;
        const tail = Math.min(18, 4 + d.vy * 12);
        const tr = ctx.createLinearGradient(dx, dy - tail, dx, dy + d.r);
        tr.addColorStop(0, "rgba(255,255,255,0)");
        tr.addColorStop(1, pal.drop);
        ctx.strokeStyle = tr;
        ctx.lineWidth = d.r;
        ctx.beginPath();
        ctx.moveTo(dx, dy - tail);
        ctx.lineTo(dx, dy);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(dx, dy, d.r, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }

      // Laser-etched tick lines: 128k / 256k / 384k (or dynamic quarters)
      const maxTok = st.maxTokens > 0 ? st.maxTokens : 524288;
      const ticks = [0.25, 0.5, 0.75];
      ctx.font = "600 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      for (let i = 0; i < ticks.length; i++) {
        const frac = ticks[i];
        const ty = Math.round(inY + inH * (1 - frac)) + 0.5;
        const label =
          maxTok === 524288 || maxTok === 512000
            ? frac === 0.25
              ? "128k"
              : frac === 0.5
                ? "256k"
                : "384k"
            : Math.round((maxTok * frac) / 1000) + "k";
        ctx.strokeStyle = dark ? "rgba(236,228,255,0.32)" : "rgba(45,36,78,0.26)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(inX + inW - 11, ty);
        ctx.lineTo(inX + inW - 2, ty);
        ctx.moveTo(inX + 2, ty);
        ctx.lineTo(inX + 7, ty);
        ctx.stroke();
        ctx.fillStyle = dark ? "rgba(240,233,255,0.74)" : "rgba(38,28,68,0.70)";
        ctx.fillText(label, inX + inW - 14, ty);
      }

      const spec = ctx.createLinearGradient(inX, inY, inX + inW * 0.28, inY);
      spec.addColorStop(0, dark ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.62)");
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spec;
      ctx.fillRect(inX + 2, inY + 4, inW * 0.26, inH - 8);
      ctx.restore();

      ctx.save();
      drawRounded(ctx, tubeX + 0.5, tubeY + 0.5, tubeW - 1, tubeH - 1, rTop, rBot);
      ctx.strokeStyle = dark
        ? starNeko
          ? "rgba(208,186,255,0.44)"
          : "rgba(255,255,255,0.28)"
        : starNeko
          ? "rgba(139,92,246,0.34)"
          : "rgba(15,23,42,0.22)";
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.restore();
    }

    return {
      state: st,
      poke,
      applyDragAccel,
      spawnDroplet,
      setTargetLevel,
      setHighlightCategory,
      wake,
      step,
      render,
      isSleeping: () => st.sleeping,
    };
  }

  // ---- Runtime State ----
  let active = true;
  let hostEl = null;
  let shadow = null;
  let toolbarRoot = null;
  let popoverHost = null;
  let popoverShadow = null;
  let dashboardHost = null;
  let dashboardShadow = null;
  let popoverOpen = false;
  let dashboardOpen = false;
  let dashboardRange = "all";
  let dashboardData = null;
  let telemetryData = null;
  let logModelFilter = "";
  let logSortBy = "time";
  let logSortDir = "desc";
  let expandedCallKey = "";
  let compactMode = false; // true = pure 3 icons
  let densityTier = "wide"; // "wide" | "medium" | "icons"
  let yieldedExternal = false;
  let userTakeover = cfg.takeoverExternal;
  let vialStyle = cfg.vialStyle;
  let highlightCategory = null;
  let hoveredHeatmapDay = null;
  let pollTimer = 0;
  let scanTimer = 0;
  let vialRaf = 0;
  let lastVialTs = 0;
  let vialCanvas = null;
  let vialCtx = null;
  let mutationObs = null;
  let themeAttrObs = null;
  let resizeObs = null;
  let popoverPos = null; // { left, top } once dragged
  let popoverDragging = false;
  let fetchInFlight = false;
  let lastToolbarCssKey = "";
  let lastPopoverCssKey = "";
  let lastDashboardCssKey = "";
  let lastToolbarSig = "";
  let lastPopoverSig = "";
  let lastDashboardFrameSig = "";
  let dashboardDataVersion = 0;
  let dashboardAbortCtrl = null;
  const dashboardCache = new Map(); // range -> { data, at }
  const DASHBOARD_CACHE_TTL_MS = 30000;
  const globalListeners = [];
  const vialEngine = makeVialEngine({ nodes: 24 });

  try {
    const savedStyle = window.localStorage?.getItem(STYLE_STORAGE_KEY);
    if (savedStyle === "vial" || savedStyle === "bar") vialStyle = savedStyle;
    if (window.localStorage?.getItem(TAKEOVER_STORAGE_KEY) === "1") userTakeover = true;
  } catch {}

  function addGlobalListener(target, type, fn, opts) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, fn, opts);
    globalListeners.push([target, type, fn, opts]);
  }

  function detectHostDark() {
    try {
      const html = document.documentElement;
      const body = document.body;
      const attr = html?.getAttribute?.("data-theme") || body?.getAttribute?.("data-theme");
      if (attr === "dark") return true;
      if (attr === "light") return false;
      if (
        html?.classList?.contains?.("dark") ||
        body?.classList?.contains?.("dark") ||
        body?.classList?.contains?.("dark-theme")
      ) {
        return true;
      }
      if (
        html?.classList?.contains?.("light") ||
        body?.classList?.contains?.("light") ||
        body?.classList?.contains?.("light-theme")
      ) {
        return false;
      }
      if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)")?.matches) {
        return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  function detectIsGlass() {
    try {
      return Boolean(
        document.documentElement?.classList?.contains?.("agy-dream-active-v2") ||
          document.getElementById?.("agy-dream-wallpaper-v2")
      );
    } catch {
      return false;
    }
  }

  function detectSurfaceMode() {
    const dark = detectHostDark();
    const glass = detectIsGlass();
    return glass ? (dark ? "glass-dark" : "glass-light") : (dark ? "dark" : "light");
  }

  function isDark() {
    return detectHostDark();
  }

  function escHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtTokens(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return "0";
    if (v >= 1000000) return (v / 1000000).toFixed(2) + "M";
    if (v >= 10000) return (v / 1000).toFixed(1) + "k";
    if (v >= 1000) return (v / 1000).toFixed(2) + "k";
    return String(Math.round(v));
  }

  function fmtBytes(bytes) {
    const b = Number(bytes);
    if (!Number.isFinite(b) || b <= 0) return "0 B";
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + " GB";
    if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
    if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
    return Math.round(b) + " B";
  }

  function fmtCost(usd) {
    const c = Number(usd);
    if (!Number.isFinite(c) || c < 0) return "$0.00";
    if (c < 0.01 && c > 0) return "<$0.01";
    return "$" + c.toFixed(2);
  }

  function fmtResetCountdown(resetAt) {
    if (!resetAt) return "";
    const ts = typeof resetAt === "number" ? resetAt : Date.parse(resetAt);
    if (!Number.isFinite(ts)) return "";
    const diffMs = ts - Date.now();
    if (diffMs <= 0) return "已重置";
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return mins + "m";
    const hrs = Math.floor(mins / 60);
    const remM = mins % 60;
    if (hrs < 24) return hrs + "h" + (remM ? remM + "m" : "");
    const days = Math.floor(hrs / 24);
    const remH = hrs % 24;
    return days + "d" + (remH ? remH + "h" : "");
  }

  function normalizeQuotaRemaining(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return null;
    if (n > 0 && n < 1) return Math.max(0, Math.min(100, n * 100));
    return Math.max(0, Math.min(100, n));
  }

  function detectConversationId() {
    if (cfg.conversationId) return cfg.conversationId;
    try {
      const m = /\/c\/([a-zA-Z0-9_-]+)/.exec(String(window.location?.pathname || ""));
      if (m) return m[1];
      const el = document.querySelector?.("[data-cascade-id], [data-conversation-id]");
      if (el) {
        return el.getAttribute("data-cascade-id") || el.getAttribute("data-conversation-id") || "";
      }
    } catch {}
    return "";
  }

  function detectWorkingState() {
    try {
      const stopBtn = document.querySelector?.(
        '.surface-composer button[data-testid*="stop"], .surface-composer button[data-testid*="cancel"], .surface-composer button[aria-label*="Stop"], .surface-composer button[aria-label*="停止"]'
      );
      return Boolean(stopBtn && !stopBtn.disabled);
    } catch {
      return false;
    }
  }

  function hasExternalPulseBar() {
    try {
      const el = document.querySelector?.("#ag-pulse-status-bar, .ag-pulse-status-bar, [data-ag-pulse]");
      if (!el || !el.isConnected) return false;
      if (typeof getComputedStyle === "function") {
        const cs = getComputedStyle(el);
        if (cs && (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0")) return false;
      }
      if (typeof el.getBoundingClientRect === "function") {
        const rect = el.getBoundingClientRect();
        if (rect && (rect.width <= 4 || rect.height <= 4)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function findToolbarAnchor() {
    try {
      const footer =
        document.querySelector?.(".agy-composer-footer") ||
        document.querySelector?.('[data-testid="input-box-bottom-toolbar"]');
      if (footer) return footer;
      const modelBtn = document.querySelector?.('[data-testid="model-selector-trigger"]');
      if (modelBtn && modelBtn.parentElement) return modelBtn.parentElement;
    } catch {}
    return null;
  }

  function findRightActionGroup(anchor) {
    if (!anchor || !anchor.children || !anchor.children.length) return null;
    const rightSelector =
      '[data-testid="permissions-selector-trigger"], [data-testid="input-send-button"], [data-testid="input-cancel-button"], [data-testid*="send"], [data-testid*="stop"], [data-testid*="cancel"], button[aria-label*="Send"], button[aria-label*="Stop"], button[aria-label*="发送"]';
    const isSelfOrExt = (el) =>
      !el ||
      el === hostEl ||
      el.id === HOST_ID ||
      el.id === "ag-pulse-status-bar" ||
      el.hasAttribute?.("data-maomao-telemetry-bar") ||
      el.hasAttribute?.("data-ag-pulse");

    const candidates = [];
    for (let i = 0; i < anchor.children.length; i++) {
      const ch = anchor.children[i];
      if (!isSelfOrExt(ch)) candidates.push(ch);
    }
    if (!candidates.length) return null;

    // Priority 1: direct child holding permissions ("极速") / mic / send / cancel controls
    for (let i = 0; i < candidates.length; i++) {
      const ch = candidates[i];
      if (ch.querySelector?.('[data-testid="model-selector-trigger"]')) continue;
      if (ch.matches?.(rightSelector) || ch.querySelector?.(rightSelector)) return ch;
    }
    // Priority 2: trailing shrink-0 action group (when distinct from left model group)
    for (let i = candidates.length - 1; i >= 1; i--) {
      const ch = candidates[i];
      if (ch.querySelector?.('[data-testid="model-selector-trigger"]')) continue;
      if (ch.classList?.contains?.("shrink-0") || /\bshrink-0\b/.test(String(ch.className || ""))) return ch;
    }
    // Priority 3: last sibling when footer has left + right containers
    if (candidates.length >= 2) {
      const last = candidates[candidates.length - 1];
      if (!last.querySelector?.('[data-testid="model-selector-trigger"]')) return last;
    }
    return null;
  }

  function ringColorForPercent(pct) {
    if (pct >= 80) return "#ef4444";
    if (pct >= 60) return "#f59e0b";
    return "#22c55e";
  }

  function categoryColor(cat, idx) {
    if (cat?.key === "free") return "rgba(148, 163, 184, 0.22)";
    const palette = [
      "#a855f7",
      "#8b5cf6",
      "#38bdf8",
      "#22d3ee",
      "#34d399",
      "#f472b6",
      "#fbbf24",
      "#fb923c",
      "#818cf8",
    ];
    return palette[idx % palette.length];
  }

  function categoryDisplayLabel(label) {
    const map = {
      "System Prompt": "系统提示",
      Skills: "技能定义",
      Tools: "工具声明",
      MCP: "MCP 工具",
      "Chat Messages": "对话消息",
      Messages: "对话消息",
      Thinking: "思考过程",
      "Tool Outputs": "工具输出",
      Media: "图像媒体",
      Files: "引用文件",
      Other: "其他上下文",
      Free: "剩余空间",
    };
    return map[label] || label || "其他";
  }

  function groupCategories(cats) {
    const list = Array.isArray(cats) ? cats.filter((c) => c && c.key !== "free" && (c.tokens || 0) > 0) : [];
    let system = 0;
    let convo = 0;
    let tools = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const lbl = String(c.label || c.key || "").toLowerCase();
      if (/system|skill|rule|prompt/.test(lbl)) system += c.tokens || 0;
      else if (/tool|mcp|function/.test(lbl)) tools += c.tokens || 0;
      else convo += c.tokens || 0;
    }
    return { system, convo, tools };
  }

  // ---- Shadow DOM CSS Builders ----
  function buildToolbarCss() {
    const dark = detectHostDark();
    const glass = detectIsGlass();
    const starNeko = cfg.themeStyle !== "official";
    const fg = dark ? "#f3edfc" : "#1a162b";
    const muted = dark ? "rgba(226, 214, 255, 0.74)" : "rgba(38, 32, 64, 0.78)";
    const hoverBg = glass
      ? dark
        ? starNeko
          ? "rgba(167, 139, 250, 0.18)"
          : "rgba(255, 255, 255, 0.11)"
        : starNeko
          ? "rgba(255, 255, 255, 0.56)"
          : "rgba(255, 255, 255, 0.62)"
      : dark
        ? starNeko
          ? "rgba(167, 139, 250, 0.14)"
          : "rgba(255, 255, 255, 0.08)"
        : "rgba(15, 23, 42, 0.065)";
    const pillBorder = dark
      ? starNeko
        ? "rgba(196, 174, 255, 0.22)"
        : "rgba(255, 255, 255, 0.14)"
      : starNeko
        ? "rgba(139, 92, 246, 0.22)"
        : "rgba(15, 23, 42, 0.14)";
    const hoverBlur = glass ? "-webkit-backdrop-filter: blur(12px) saturate(145%); backdrop-filter: blur(12px) saturate(145%);" : "";
    return `
:host {
  display: inline-flex;
  align-items: center;
  align-self: center;
  height: 28px;
  flex-shrink: 0;
  margin-inline: 2px 4px;
  vertical-align: middle;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.tb-wrap {
  display: inline-flex;
  align-items: center;
  height: 28px;
  color: ${fg};
  user-select: none;
}
.tb-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 9999px;
  background: transparent;
  box-shadow: none;
  color: ${muted};
  font: inherit;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, box-shadow 150ms ease, padding 160ms ease, gap 160ms ease;
}
.tb-pill:hover,
.tb-pill:focus-visible,
.tb-pill[aria-expanded="true"],
.tb-pill[data-active="1"] {
  background: ${hoverBg};
  ${hoverBlur}
  border-color: ${dark ? (starNeko ? "rgba(210, 188, 255, 0.34)" : "rgba(255, 255, 255, 0.22)") : (starNeko ? "rgba(139, 92, 246, 0.30)" : "rgba(15, 23, 42, 0.20)")};
  box-shadow: ${dark ? "0 2px 10px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.12)" : "0 2px 8px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.72)"};
  color: ${fg};
  outline: none;
}
.tb-seg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.tb-sep {
  width: 1px;
  height: 12px;
  background: ${pillBorder};
  flex-shrink: 0;
  transition: width 160ms ease, opacity 140ms ease;
}
.tb-label {
  display: inline-block;
  overflow: hidden;
  max-width: 260px;
  opacity: 1;
  transition: max-width 180ms ease, opacity 140ms ease, margin 180ms ease;
}
.tb-wrap[data-compact="icons"] .tb-pill {
  padding: 0 8px;
  gap: 8px;
}
.tb-wrap[data-compact="icons"] .tb-seg {
  gap: 0;
}
.tb-wrap[data-compact="icons"] .tb-sep {
  width: 0;
  opacity: 0;
}
.tb-wrap[data-compact="icons"] .tb-label {
  max-width: 0;
  opacity: 0;
  margin: 0;
}
.tb-takeover {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 7px;
  border-radius: 9999px;
  border: 1px solid ${pillBorder};
  background: ${hoverBg};
  color: ${fg};
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
svg {
  display: block;
  flex-shrink: 0;
}
`;
  }

  function buildPopoverCss() {
    const dark = detectHostDark();
    const glass = detectIsGlass();
    const starNeko = cfg.themeStyle !== "official";
    const bg = glass
      ? dark
        ? starNeko
          ? "rgba(21, 16, 36, 0.80)"
          : "rgba(15, 17, 24, 0.82)"
        : starNeko
          ? "rgba(250, 247, 255, 0.78)"
          : "rgba(255, 255, 255, 0.82)"
      : dark
        ? starNeko
          ? "rgba(20, 17, 30, 0.98)"
          : "rgba(18, 20, 28, 0.98)"
        : "rgba(255, 255, 255, 0.98)";
    const cardBg = glass
      ? dark
        ? starNeko
          ? "rgba(38, 30, 62, 0.50)"
          : "rgba(255, 255, 255, 0.06)"
        : starNeko
          ? "rgba(237, 229, 254, 0.48)"
          : "rgba(255, 255, 255, 0.56)"
      : dark
        ? starNeko
          ? "rgba(36, 30, 56, 0.72)"
          : "rgba(255, 255, 255, 0.045)"
        : starNeko
          ? "rgba(243, 239, 253, 0.82)"
          : "rgba(241, 245, 249, 0.86)";
    const border = dark
      ? starNeko
        ? "rgba(196, 172, 255, 0.28)"
        : "rgba(255, 255, 255, 0.14)"
      : starNeko
        ? "rgba(124, 58, 237, 0.22)"
        : "rgba(15, 23, 42, 0.14)";
    const fg = dark ? "#f5f0ff" : "#1a162b";
    const muted = dark ? "rgba(226, 214, 255, 0.70)" : "rgba(56, 46, 88, 0.74)";
    const accent = starNeko ? (dark ? "#c084fc" : "#7c3aed") : (dark ? "#34d399" : "#059669");
    const popBlur = glass ? "backdrop-filter: blur(12px) saturate(140%); -webkit-backdrop-filter: blur(12px) saturate(140%);" : "backdrop-filter: none; -webkit-backdrop-filter: none;";
    const popShadow = glass
      ? `0 22px 54px rgba(0, 0, 0, ${dark ? "0.52" : "0.16"}), inset 0 1px 0 rgba(255, 255, 255, ${dark ? "0.18" : "0.92"})`
      : `0 18px 44px rgba(0, 0, 0, ${dark ? "0.48" : "0.14"}), inset 0 1px 0 rgba(255, 255, 255, ${dark ? "0.08" : "0.95"})`;

    const thumbColor = dark
      ? "rgba(196, 181, 253, 0.14)"
      : "rgba(109, 86, 178, 0.18)";
    const thumbHover = dark
      ? "rgba(196, 181, 253, 0.38)"
      : "rgba(109, 86, 178, 0.40)";

    return `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
* {
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: ${thumbColor} transparent;
}
::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
::-webkit-scrollbar-button {
  display: none !important;
  width: 0;
  height: 0;
}
::-webkit-scrollbar-track,
::-webkit-scrollbar-track-piece,
::-webkit-scrollbar-corner {
  background: transparent !important;
}
::-webkit-scrollbar-thumb {
  background: ${thumbColor};
  border-radius: 9999px;
  border: 0;
}
::-webkit-scrollbar-thumb:hover {
  background: ${thumbHover};
}
.pop {
  width: 552px;
  max-width: calc(100vw - 24px);
  max-height: min(680px, calc(100vh - 36px));
  display: flex;
  flex-direction: column;
  border-radius: 18px;
  background: ${bg};
  border: 1px solid ${border};
  color: ${fg};
  ${popBlur}
  contain: layout style;
  box-shadow: ${popShadow};
  overflow: hidden;
  font-size: 12px;
}
.pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 13px;
  border-bottom: 1px solid ${border};
  cursor: grab;
  user-select: none;
  background: ${dark ? "rgba(255,255,255,0.03)" : "rgba(139,92,246,0.05)"};
}
.pop-head:active { cursor: grabbing; }
.pop-model {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-weight: 650;
  font-size: 12.5px;
}
.pop-model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pop-role {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 9999px;
  background: ${cardBg};
  border: 1px solid ${border};
  color: ${accent};
  flex-shrink: 0;
}
.pop-head-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.chip-btn {
  border: 1px solid ${border};
  background: ${cardBg};
  color: ${fg};
  border-radius: 8px;
  padding: 3px 8px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.chip-btn:hover {
  border-color: ${accent};
}
.pop-body {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 13px;
  overflow-y: auto;
}
.vial-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 8px 6px;
  border-radius: 14px;
  background: ${cardBg};
  border: 1px solid ${border};
}
.vial-canvas {
  width: 112px;
  height: 224px;
  display: block;
  cursor: pointer;
}
.bar-fallback {
  width: 44px;
  height: 210px;
  border-radius: 14px;
  background: ${dark ? "rgba(0,0,0,0.34)" : "rgba(15,23,42,0.08)"};
  border: 1px solid ${border};
  position: relative;
  overflow: hidden;
  margin: 7px 0;
}
.bar-fallback-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 12px;
  background: linear-gradient(180deg, #c084fc 0%, #7c3aed 100%);
  transition: height 280ms ease;
}
.vial-readout {
  text-align: center;
  margin-top: 6px;
  font-variant-numeric: tabular-nums;
}
.vial-pct {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.15;
}
.vial-tok {
  font-size: 10.5px;
  color: ${muted};
  margin-top: 2px;
}
.right-col {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.metrics-grid {
  display: grid;
  grid-template-columns: 0.82fr 1.38fr 0.95fr 0.85fr;
  gap: 5px;
}
.metric-card {
  padding: 6px 7px;
  border-radius: 10px;
  background: ${cardBg};
  border: 1px solid ${border};
  font-variant-numeric: tabular-nums;
  min-width: 0;
}
.metric-k {
  font-size: 10px;
  color: ${muted};
}
.metric-v {
  font-size: 11.5px;
  font-weight: 650;
  margin-top: 2px;
  white-space: nowrap;
  letter-spacing: -0.01em;
}
.metric-unit {
  font-size: 9.5px;
  font-weight: 500;
  opacity: 0.78;
  margin-left: 2px;
}
.section {
  padding: 8px 9px;
  border-radius: 12px;
  background: ${cardBg};
  border: 1px solid ${border};
}
.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: ${muted};
  margin-bottom: 6px;
}
.seg-bar {
  display: flex;
  height: 7px;
  gap: 1px;
  border-radius: 9999px;
  overflow: hidden;
  background: ${dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"};
  margin-bottom: 7px;
}
.seg-slice {
  height: 100%;
  transition: opacity 120ms ease, filter 120ms ease;
}
.seg-slice[data-hl="1"] {
  filter: brightness(1.35);
}
.group-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 6px;
  font-size: 10.5px;
  color: ${muted};
  font-variant-numeric: tabular-nums;
}
.cat-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cat-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px 5px;
  border-radius: 7px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: default;
}
.cat-row:hover, .cat-row[data-hl="1"] {
  background: ${dark ? "rgba(196, 172, 255, 0.14)" : "rgba(139, 92, 246, 0.10)"};
}
.cat-dot {
  width: 8px;
  height: 8px;
  border-radius: 2.5px;
  flex-shrink: 0;
}
.cat-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cat-tok { color: ${muted}; }
.cat-pct { min-width: 38px; text-align: right; font-weight: 600; }
.compact-btn {
  width: 100%;
  padding: 7px 10px;
  border-radius: 10px;
  border: 1px solid rgba(244, 63, 94, 0.55);
  background: linear-gradient(90deg, rgba(244, 63, 94, 0.24), rgba(245, 158, 11, 0.24));
  color: ${dark ? "#ffe4e6" : "#9f1239"};
  font: inherit;
  font-weight: 650;
  font-size: 11.5px;
  cursor: pointer;
}
.compact-btn:hover { filter: brightness(1.1); }
.quota-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.quota-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.quota-name {
  font-size: 11px;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
}
.quota-bars {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.qbar-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
  color: ${muted};
  font-variant-numeric: tabular-nums;
}
.qbar-track {
  height: 5px;
  border-radius: 9999px;
  background: ${dark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.10)"};
  overflow: hidden;
}
.qbar-fill {
  height: 100%;
  border-radius: 9999px;
}
.pop-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 13px;
  border-top: 1px solid ${border};
  font-size: 11px;
  color: ${muted};
}
.pop-foot-actions {
  display: flex;
  gap: 6px;
}
.archive-note {
  font-size: 10.5px;
  color: ${accent};
  margin-top: 4px;
}
`;
  }

  function buildDashboardCss() {
    const dark = detectHostDark();
    const glass = detectIsGlass();
    const starNeko = cfg.themeStyle !== "official";
    const bg = glass
      ? dark
        ? starNeko
          ? "rgba(20, 15, 34, 0.82)"
          : "rgba(15, 17, 25, 0.84)"
        : starNeko
          ? "rgba(252, 250, 255, 0.82)"
          : "rgba(255, 255, 255, 0.85)"
      : dark
        ? starNeko
          ? "rgba(18, 15, 28, 0.98)"
          : "rgba(16, 18, 26, 0.98)"
        : "rgba(255, 255, 255, 0.98)";
    const cardBg = glass
      ? dark
        ? "rgba(255, 255, 255, 0.055)"
        : "rgba(237, 229, 254, 0.42)"
      : dark
        ? "rgba(255, 255, 255, 0.045)"
        : "rgba(244, 241, 253, 0.72)";
    const border = dark ? "rgba(196, 172, 255, 0.24)" : "rgba(124, 58, 237, 0.20)";
    const fg = dark ? "#f5f0ff" : "#1a162b";
    const muted = dark ? "rgba(226, 214, 255, 0.70)" : "rgba(56, 46, 88, 0.74)";
    const dashThumb = dark ? "rgba(196, 181, 253, 0.14)" : "rgba(109, 86, 178, 0.18)";
    const dashThumbHover = dark ? "rgba(196, 181, 253, 0.38)" : "rgba(109, 86, 178, 0.40)";
    const rowHover = dark ? "rgba(196, 181, 253, 0.08)" : "rgba(124, 58, 237, 0.07)";
    const ctrlBg = dark ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.05)";
    const modalBlur = glass ? "backdrop-filter: blur(12px) saturate(140%); -webkit-backdrop-filter: blur(12px) saturate(140%);" : "backdrop-filter: none; -webkit-backdrop-filter: none;";
    const backdropBg = dark ? "rgba(8, 6, 16, 0.56)" : "rgba(15, 23, 42, 0.28)";
    return `
:host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
* {
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: ${dashThumb} transparent;
}
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-button { display: none !important; width: 0; height: 0; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-track-piece, ::-webkit-scrollbar-corner { background: transparent !important; }
::-webkit-scrollbar-thumb { background: ${dashThumb}; border-radius: 9999px; border: 0; }
::-webkit-scrollbar-thumb:hover { background: ${dashThumbHover}; }
.backdrop {
  position: fixed;
  inset: 0;
  background: ${backdropBg};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.modal {
  width: min(980px, 92vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  background: ${bg};
  ${modalBlur}
  contain: layout style;
  border: 1px solid ${border};
  color: ${fg};
  box-shadow: 0 28px 72px rgba(0, 0, 0, ${dark ? "0.55" : "0.18"}), inset 0 1px 0 rgba(255, 255, 255, ${dark ? "0.14" : "0.92"});
  overflow: hidden;
  font-size: 12px;
}
.m-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 16px;
  border-bottom: 1px solid ${border};
}
.m-title { font-size: 14px; font-weight: 700; }
.m-ranges { display: flex; gap: 6px; }
.r-btn {
  border: 1px solid ${border};
  background: ${cardBg};
  color: ${muted};
  border-radius: 9999px;
  padding: 4px 10px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.r-btn[data-active="1"] {
  background: ${starNeko ? "rgba(167,139,250,0.28)" : "rgba(16,185,129,0.24)"};
  color: ${fg};
  border-color: ${starNeko ? "#c084fc" : "#34d399"};
}
.m-body {
  padding: 14px 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.kpi {
  padding: 10px 12px;
  border-radius: 12px;
  background: ${cardBg};
  border: 1px solid ${border};
  font-variant-numeric: tabular-nums;
}
.kpi-l { font-size: 11px; color: ${muted}; }
.kpi-v { font-size: 18px; font-weight: 700; margin-top: 3px; }
.card {
  padding: 12px;
  border-radius: 14px;
  background: ${cardBg};
  border: 1px solid ${border};
}
.card-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-weight: 600;
}
.heat-grid {
  display: grid;
  grid-template-columns: repeat(53, 1fr);
  grid-template-rows: repeat(7, 10px);
  grid-auto-flow: column;
  gap: 2px;
  overflow-x: auto;
}
.h-cell {
  width: 100%;
  min-width: 8px;
  height: 10px;
  border-radius: 2px;
  background: ${dark ? "rgba(255,255,255,0.06)" : "rgba(109,86,178,0.10)"};
}
.h-cell[data-lv="1"] { background: ${starNeko ? (dark ? "rgba(167,139,250,0.32)" : "rgba(139,92,246,0.26)") : "rgba(52,211,153,0.30)"}; }
.h-cell[data-lv="2"] { background: ${starNeko ? (dark ? "rgba(167,139,250,0.58)" : "rgba(139,92,246,0.50)") : "rgba(16,185,129,0.55)"}; }
.h-cell[data-lv="3"] { background: ${starNeko ? (dark ? "rgba(192,132,252,0.82)" : "rgba(124,58,237,0.74)") : "rgba(16,185,129,0.80)"}; }
.h-cell[data-lv="4"] { background: ${starNeko ? (dark ? "#e879f9" : "#9333ea") : "#059669"}; }
.model-row {
  display: grid;
  grid-template-columns: 180px 1fr 78px 66px 66px;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-variant-numeric: tabular-nums;
}
.m-bar-track {
  height: 6px;
  border-radius: 9999px;
  background: ${dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)"};
  overflow: hidden;
}
.m-bar-fill {
  height: 100%;
  border-radius: 9999px;
  background: linear-gradient(90deg, #8b5cf6, #e879f9);
}
.log-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.log-select, .log-dir-btn {
  height: 26px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid ${border};
  background: ${ctrlBg};
  color: ${fg};
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  outline: none;
}
.log-select option {
  background: ${dark ? "#1b162d" : "#faf7ff"};
  color: ${fg};
}
.log-dir-btn:hover, .log-select:hover {
  border-color: ${starNeko ? "#c084fc" : "#34d399"};
}
.log-table-wrap {
  max-height: 310px;
  overflow: auto;
  border-radius: 10px;
  border: 1px solid ${border};
}
.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.log-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: left;
  padding: 8px 9px;
  font-size: 11px;
  font-weight: 600;
  color: ${muted};
  background: ${dark ? "rgba(24, 19, 40, 0.96)" : "rgba(246, 242, 254, 0.96)"};
  border-bottom: 1px solid ${border};
  white-space: nowrap;
}
.log-row {
  cursor: pointer;
  border-bottom: 1px solid ${dark ? "rgba(196, 181, 253, 0.08)" : "rgba(124, 58, 237, 0.08)"};
  transition: background-color 120ms ease;
}
.log-row:hover {
  background: ${rowHover};
}
.log-row td {
  padding: 7px 9px;
  vertical-align: middle;
  white-space: nowrap;
}
.log-chev {
  display: inline-block;
  width: 12px;
  color: ${muted};
  font-size: 10px;
}
.log-model-main {
  font-weight: 600;
  color: ${fg};
}
.log-model-sub {
  font-size: 10px;
  color: ${muted};
  margin-top: 1px;
}
.tok-in { color: ${fg}; }
.tok-cache { color: ${starNeko ? (dark ? "#c4b5fd" : "#6d28d9") : (dark ? "#38bdf8" : "#0284c7")}; font-weight: 600; }
.tok-out { color: ${starNeko ? (dark ? "#f0abfc" : "#a21caf") : (dark ? "#34d399" : "#047857")}; }
.tok-sep { opacity: 0.42; margin: 0 3px; }
.log-status-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.log-pill {
  display: inline-flex;
  align-items: center;
  padding: 1.5px 7px;
  border-radius: 9999px;
  font-size: 10.5px;
  font-weight: 600;
}
.log-pill-ok {
  background: rgba(16, 185, 129, 0.16);
  color: ${dark ? "#6ee7b7" : "#047857"};
  border: 1px solid rgba(16, 185, 129, 0.34);
}
.log-pill-err {
  background: rgba(244, 63, 94, 0.16);
  color: ${dark ? "#fda4af" : "#be123c"};
  border: 1px solid rgba(244, 63, 94, 0.38);
}
.log-detail-row td {
  padding: 8px 14px 10px 28px;
  background: ${dark ? "rgba(14, 10, 26, 0.56)" : "rgba(124, 58, 237, 0.04)"};
  border-bottom: 1px solid ${border};
  white-space: normal;
}
.log-detail-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  font-size: 11px;
  color: ${muted};
}
.log-detail-grid strong {
  color: ${fg};
  font-weight: 600;
}
.log-detail-err {
  margin-top: 6px;
  padding: 6px 9px;
  border-radius: 7px;
  background: rgba(244, 63, 94, 0.14);
  border: 1px solid rgba(244, 63, 94, 0.36);
  color: ${dark ? "#fecdd3" : "#9f1239"};
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  word-break: break-word;
}
`;
  }

  // ---- SVG Icons for the 3-Icon Bottom Bar ----
  function renderSpeedometerSvg(tps) {
    const val = Number.isFinite(tps) ? Math.max(0, Math.min(120, tps)) : 0;
    const deg = tps == null ? -75 : Math.round(-85 + (val / 120) * 170);
    return (
      `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="M4.5 17.5a9 9 0 1 1 15 0" stroke-opacity="0.88"/>` +
      `<path d="M7.5 15.8a5.8 5.8 0 0 1 9 0" stroke-opacity="0.32" stroke-width="1.5"/>` +
      `<line x1="12" y1="14.5" x2="12" y2="7.5" style="transform-origin:12px 14.5px;transform:rotate(${deg}deg)"/>` +
      `<circle cx="12" cy="14.5" r="1.6" fill="currentColor" stroke="none"/>` +
      `</svg>`
    );
  }

  function renderDatabaseSvg() {
    return (
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/>` +
      `<path d="M4.5 5.5v5.5c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8V5.5"/>` +
      `<path d="M4.5 11v6.5c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8V11"/>` +
      `</svg>`
    );
  }

  function renderContextRingSvg(percent) {
    const pct = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
    const r = 7.4;
    const c = 2 * Math.PI * r;
    const dashOffset = (c * (1 - pct / 100)).toFixed(2);
    const color = ringColorForPercent(pct);
    return (
      `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">` +
      `<circle cx="10" cy="10" r="${r}" stroke="currentColor" stroke-opacity="0.22" stroke-width="2.2"/>` +
      `<circle cx="10" cy="10" r="${r}" stroke="${color}" stroke-width="2.3" stroke-linecap="round" ` +
      `stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${dashOffset}" transform="rotate(-90 10 10)"/>` +
      `</svg>`
    );
  }

  // ---- Toolbar Rendering ----
  function renderToolbar() {
    if (!toolbarRoot) return;
    const t = telemetryData || {};
    const ctx = t.context || {};
    const liveTps = Number.isFinite(t.latestTps) ? t.latestTps : Number.isFinite(t.tps) ? t.tps : null;
    const totalTok = Number.isFinite(t.totalTokens) ? t.totalTokens : ctx.usedTokens || 0;
    const cachePct = Number.isFinite(t.cacheHitPercent) ? Math.round(t.cacheHitPercent) : null;
    const usedPct = Number.isFinite(ctx.usedPercent) ? ctx.usedPercent : 0;
    const pctPrefix = ctx.compactedPending ? "≈" : "";
    const ringColor = ringColorForPercent(usedPct);
    const surfaceMode = detectSurfaceMode();

    const tbCssKey = `${surfaceMode}:${cfg.themeStyle}`;
    const styleEl = toolbarRoot.querySelector?.("style");
    if (styleEl && (tbCssKey !== lastToolbarCssKey || !styleEl.textContent)) {
      lastToolbarCssKey = tbCssKey;
      styleEl.textContent = buildToolbarCss();
    }

    const body = toolbarRoot.querySelector?.('[data-role="tb-container"]');
    if (!body) return;

    const effectiveDensity =
      cfg.barMode === "icons"
        ? "icons"
        : cfg.barMode === "full"
          ? "wide"
          : densityTier;

    const tbSig = [
      surfaceMode,
      yieldedExternal ? 1 : 0,
      effectiveDensity,
      popoverOpen ? 1 : 0,
      liveTps != null ? liveTps.toFixed(1) : "",
      Math.round(totalTok),
      cachePct != null ? cachePct : "",
      Math.round(usedPct),
      pctPrefix,
    ].join("|");
    if (tbSig === lastToolbarSig && body.children && body.children.length > 0) return;
    lastToolbarSig = tbSig;

    if (yieldedExternal) {
      body.innerHTML =
        `<button type="button" class="tb-takeover" data-role="takeover" title="检测到外部 AG Pulse，点击一键接管为猫猫光学遥测">` +
        `<span>✦ 接管遥测</span></button>`;
      return;
    }

    const effectiveCompact = effectiveDensity === "icons";
    const speedLabel = liveTps != null ? liveTps.toFixed(1) + " tok/s" : "-- tok/s";
    const tokLabelWide =
      fmtTokens(totalTok) + (cachePct != null ? " · 缓存命中 " + cachePct + "%" : " tok");
    const tokLabelMedium =
      cachePct != null ? "缓存命中 " + cachePct + "%" : fmtTokens(totalTok) + " tok";
    const tokLabel = effectiveDensity === "medium" ? tokLabelMedium : tokLabelWide;
    const ctxPctText = pctPrefix + Math.round(usedPct) + "%";
    const ctxLabel = effectiveDensity === "wide" ? "上下文 " + ctxPctText : ctxPctText;
    const pillTitle = `点击查看 512K 上下文试管与配额详情 · 速度 ${speedLabel} · ${tokLabelWide} · 上下文 ${ctxPctText}`;

    body.innerHTML =
      `<div class="tb-wrap" data-testid="maomao-telemetry-bar" data-surface="${surfaceMode}" data-compact="${effectiveCompact ? "icons" : "full"}" data-density="${effectiveDensity}">` +
      `<button type="button" class="tb-pill" data-role="telemetry-pill" data-testid="maomao-telemetry-pill" aria-expanded="${popoverOpen ? "true" : "false"}" data-active="${popoverOpen ? "1" : "0"}" title="${escHtml(pillTitle)}">` +
      `<span class="tb-seg" data-role="speed">${renderSpeedometerSvg(liveTps)}<span class="tb-label">${escHtml(speedLabel)}</span></span>` +
      `<span class="tb-sep" aria-hidden="true"></span>` +
      `<span class="tb-seg" data-role="tokens">${renderDatabaseSvg()}<span class="tb-label">${escHtml(tokLabel)}</span></span>` +
      `<span class="tb-sep" aria-hidden="true"></span>` +
      `<span class="tb-seg" data-role="context" style="color:${ringColor}">${renderContextRingSvg(usedPct)}<span class="tb-label">${escHtml(ctxLabel)}</span></span>` +
      `</button>` +
      `</div>`;
  }

  // ---- Vial Canvas rAF Loop (Strict 0fps Hibernation!) ----
  function stopVialLoop() {
    if (vialRaf) {
      try {
        cancelAnimationFrame(vialRaf);
      } catch {}
      vialRaf = 0;
    }
    lastVialTs = 0;
  }

  function renderVialFrameOnce() {
    if (!vialCanvas || !vialCtx) return;
    const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    const cssW = 112;
    const cssH = 224;
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (vialCanvas.width !== pxW || vialCanvas.height !== pxH) {
      vialCanvas.width = pxW;
      vialCanvas.height = pxH;
    }
    vialCtx.save?.();
    vialCtx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
    vialEngine.render(vialCtx, cssW, cssH, { dark: isDark(), themeStyle: cfg.themeStyle });
    vialCtx.restore?.();
  }

  function tickVial(now) {
    vialRaf = 0;
    if (!active || !popoverOpen || document.hidden || vialStyle !== "vial" || !cfg.vialEnabled) {
      lastVialTs = 0;
      return;
    }
    const ts = typeof now === "number" ? now : Date.now();
    const dt = lastVialTs ? Math.min(0.032, Math.max(0.001, (ts - lastVialTs) / 1000)) : 0.016;
    lastVialTs = ts;

    const res = vialEngine.step(dt);
    renderVialFrameOnce();

    if (!res.sleeping && typeof requestAnimationFrame === "function") {
      vialRaf = requestAnimationFrame(tickVial);
    } else {
      lastVialTs = 0; // 0fps hibernation achieved!
    }
  }

  function wakeVialLoop() {
    if (!active || !popoverOpen || document.hidden || vialStyle !== "vial" || !cfg.vialEnabled) return;
    vialEngine.wake();
    renderVialFrameOnce();
    if (!vialRaf && typeof requestAnimationFrame === "function") {
      lastVialTs = 0;
      vialRaf = requestAnimationFrame(tickVial);
    }
  }

  // ---- Insert `/compact` into Antigravity Composer ----
  function fillCompactCommand() {
    const cmd = "/compact";
    try {
      const editor =
        document.querySelector?.('.surface-composer [data-lexical-editor="true"]') ||
        document.querySelector?.('.surface-composer [contenteditable="true"]') ||
        document.querySelector?.(".surface-composer textarea");
      if (editor) {
        editor.focus?.();
        if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
          editor.value = cmd;
          editor.dispatchEvent?.(new Event("input", { bubbles: true }));
        } else {
          let inserted = false;
          try {
            if (typeof document.execCommand === "function") {
              inserted = document.execCommand("insertText", false, cmd);
            }
          } catch {}
          if (!inserted) {
            editor.textContent = cmd;
            editor.dispatchEvent?.(new Event("input", { bubbles: true }));
          }
        }
        closePopover();
        return true;
      }
      navigator.clipboard?.writeText?.(cmd);
    } catch {}
    closePopover();
    return false;
  }

  // ---- Popover Rendering & Drag Physics ----
  function positionPopover() {
    if (!popoverHost) return;
    if (popoverPos) {
      const maxL = Math.max(12, (window.innerWidth || 1280) - 564);
      const maxT = Math.max(12, (window.innerHeight || 720) - 420);
      popoverHost.style.left = Math.max(12, Math.min(maxL, popoverPos.left)) + "px";
      popoverHost.style.top = Math.max(12, Math.min(maxT, popoverPos.top)) + "px";
      popoverHost.style.bottom = "auto";
      return;
    }
    const anchorRect = hostEl?.getBoundingClientRect?.();
    const vw = Number(window.innerWidth) || 1280;
    const vh = Number(window.innerHeight) || 720;
    const popW = Math.min(552, vw - 24);
    const left = anchorRect ? Math.max(12, Math.min(vw - popW - 12, anchorRect.right - popW)) : Math.max(12, vw - popW - 24);
    const bottom = anchorRect ? Math.max(16, vh - anchorRect.top + 10) : 72;
    popoverHost.style.left = Math.round(left) + "px";
    popoverHost.style.top = "auto";
    popoverHost.style.bottom = Math.round(bottom) + "px";
  }

  function renderPopover() {
    if (!popoverOpen || !popoverShadow) return;
    const t = telemetryData || {};
    const ctx = t.context || {};
    const maxTok = Number(ctx.maxTokens) > 0 ? Number(ctx.maxTokens) : 524288;
    const usedTok = Number(ctx.usedTokens) >= 0 ? Number(ctx.usedTokens) : 0;
    const usedPct = Number.isFinite(ctx.usedPercent) ? ctx.usedPercent : maxTok > 0 ? (usedTok / maxTok) * 100 : 0;
    const modelName = String(t.model || "Waiting for session...");
    const roleName = t.role ? String(t.role) : ctx.hasOrchestrator ? "Orchestrator" : "";
    const ttftText = Number.isFinite(t.ttftSeconds) ? t.ttftSeconds.toFixed(2) + "s" : "--";
    const tpsText = Number.isFinite(t.tps) ? t.tps.toFixed(1) + " tok/s" : "--";
    const cachePctText = Number.isFinite(t.cacheHitPercent) ? t.cacheHitPercent.toFixed(1) + "%" : "--";
    const costText = fmtCost(t.costUsd);
    const cats = Array.isArray(ctx.categories) ? ctx.categories : [];
    const grouped = groupCategories(cats);
    const quotaGroups = Array.isArray(t.quota?.groups) ? t.quota.groups : [];
    const subagents = Array.isArray(t.subagents) ? t.subagents : [];
    const subTotalTok = subagents.reduce((s, item) => s + (Number(item?.totalTokens || item?.usedTokens) || 0), 0);
    const subTotalCost = subagents.reduce((s, item) => s + (Number(item?.costUsd) || 0), 0);
    const cacheBytes = Number(t.cacheSizeBytes) || 0;
    const useVial = cfg.vialEnabled && vialStyle === "vial";

    vialEngine.setTargetLevel(usedPct / 100, { maxTokens: maxTok, usedTokens: usedTok, categories: cats });
    if (popoverDragging) return;

    const surfaceMode = detectSurfaceMode();
    const popCssKey = `${surfaceMode}:${cfg.themeStyle}`;
    const styleEl = popoverShadow.querySelector?.("style");
    if (styleEl && (popCssKey !== lastPopoverCssKey || !styleEl.textContent)) {
      lastPopoverCssKey = popCssKey;
      styleEl.textContent = buildPopoverCss();
    }
    const wrap = popoverShadow.querySelector?.('[data-role="pop-mount"]');
    if (!wrap) return;

    const catSig = cats.map((c) => `${c?.key || ""}:${c?.tokens || 0}:${c?.percent || 0}`).join(",");
    const quotaSig = cfg.quotaEnabled
      ? quotaGroups
          .map(
            (g) =>
              `${g?.id || g?.name || ""}:${g?.windows?.["5h"]?.remaining ?? ""}:${g?.windows?.weekly?.remaining ?? ""}`
          )
          .join(",")
      : "";
    const popSig = [
      surfaceMode,
      useVial ? "vial" : "bar",
      modelName,
      roleName,
      ttftText,
      tpsText,
      cachePctText,
      costText,
      usedTok,
      maxTok,
      usedPct.toFixed(1),
      ctx.compactions || 0,
      ctx.compactedPending ? 1 : 0,
      t.rounds || 0,
      cacheBytes,
      catSig,
      quotaSig,
      subagents.length,
      subTotalTok,
      subTotalCost,
    ].join("|");
    if (popSig === lastPopoverSig && wrap.children && wrap.children.length > 0) {
      if (useVial && vialCanvas && !vialEngine.isSleeping()) wakeVialLoop();
      return;
    }
    lastPopoverSig = popSig;

    const segHtml = cats
      .filter((c) => c && c.key !== "free" && (c.percent || 0) > 0)
      .map((c, idx) => {
        const w = Math.max(0.6, Number(c.percent) || 0).toFixed(2);
        return `<span class="seg-slice" data-cat="${escHtml(c.key || idx)}" data-hl="${highlightCategory === c.key ? "1" : "0"}" style="width:${w}%;background:${categoryColor(c, idx)}"></span>`;
      })
      .join("");

    const catRowsHtml = cats.slice(0, 10).map((c, idx) => {
      const k = String(c.key || idx);
      const pct = c.percent != null ? Number(c.percent).toFixed(1) + "%" : "-";
      return (
        `<div class="cat-row" data-cat-row="${escHtml(k)}" data-hl="${highlightCategory === k ? "1" : "0"}">` +
        `<span class="cat-dot" style="background:${categoryColor(c, idx)}"></span>` +
        `<span class="cat-name">${escHtml(categoryDisplayLabel(c.label))}</span>` +
        `<span class="cat-tok">${escHtml(fmtTokens(c.tokens))}</span>` +
        `<span class="cat-pct">${escHtml(pct)}</span>` +
        `</div>`
      );
    }).join("");

    const compactHtml =
      usedPct >= 80
        ? `<button type="button" class="compact-btn" data-role="compact-btn" data-testid="maomao-compact-btn">⚡ 上下文已达 ${Math.round(usedPct)}%，一键填入 /compact</button>`
        : "";

    const quotaHtml =
      cfg.quotaEnabled && quotaGroups.length
        ? `<div class="section" data-testid="maomao-quota-section"><div class="section-title"><span>模型配额池 (5h / 周)</span></div><div class="quota-grid">` +
          quotaGroups
            .map((g) => {
              const r5 = g.windows?.["5h"] ? normalizeQuotaRemaining(g.windows["5h"].remaining) : null;
              const rw = g.windows?.weekly ? normalizeQuotaRemaining(g.windows.weekly.remaining) : null;
              const c5 = r5 == null ? "#94a3b8" : r5 < 20 ? "#ef4444" : r5 < 50 ? "#f59e0b" : "#10b981";
              const cw = rw == null ? "#94a3b8" : rw < 20 ? "#ef4444" : rw < 50 ? "#f59e0b" : "#10b981";
              const rst5 = fmtResetCountdown(g.windows?.["5h"]?.resetAt);
              const rstw = fmtResetCountdown(g.windows?.weekly?.resetAt);
              return (
                `<div class="quota-item"><div class="quota-name"><span>${escHtml(g.name || g.id)}</span></div><div class="quota-bars">` +
                `<div class="qbar-wrap"><div>5h: ${r5 == null ? "--" : Math.round(r5) + "%"}${rst5 ? " · " + escHtml(rst5) : ""}</div><div class="qbar-track"><div class="qbar-fill" style="width:${r5 ?? 0}%;background:${c5}"></div></div></div>` +
                `<div class="qbar-wrap"><div>周: ${rw == null ? "--" : Math.round(rw) + "%"}${rstw ? " · " + escHtml(rstw) : ""}</div><div class="qbar-track"><div class="qbar-fill" style="width:${rw ?? 0}%;background:${cw}"></div></div></div>` +
                `</div></div>`
              );
            })
            .join("") +
          `</div></div>`
        : "";

    const subHtml =
      subagents.length > 0
        ? `<div class="section" data-testid="maomao-subagents-section"><div class="section-title"><span>子智能体消耗 (${subagents.length})</span><span>${escHtml(fmtTokens(subTotalTok))} · ${escHtml(fmtCost(subTotalCost))}</span></div></div>`
        : "";

    wrap.innerHTML =
      `<div class="pop" data-maomao-telemetry-popover="1" data-surface="${detectSurfaceMode()}" data-testid="maomao-vial-popover">` +
      `<div class="pop-head" data-role="drag-handle">` +
      `<div class="pop-model"><span class="pop-model-name" title="${escHtml(modelName)}">${escHtml(modelName)}</span>` +
      (roleName ? `<span class="pop-role">${escHtml(roleName)}</span>` : "") +
      `</div>` +
      `<div class="pop-head-actions">` +
      `<button type="button" class="chip-btn" data-role="toggle-style" data-testid="maomao-vial-style-toggle">${useVial ? "极简长条" : "实体试管"}</button>` +
      `<button type="button" class="chip-btn" data-role="refresh">刷新</button>` +
      `<button type="button" class="chip-btn" data-role="close">✕</button>` +
      `</div></div>` +
      `<div class="pop-body">` +
      `<div class="vial-col" data-vial-mode="${useVial ? "vial" : "bar"}">` +
      (useVial
        ? `<canvas class="vial-canvas" data-role="vial-canvas" width="112" height="224" title="点击轻戳液面 / 拖拽标题栏晃动"></canvas>`
        : `<div class="bar-fallback" data-testid="maomao-minimal-bar"><div class="bar-fallback-fill" style="height:${Math.min(100, Math.max(0, usedPct)).toFixed(1)}%"></div></div>`) +
      `<div class="vial-readout"><div class="vial-pct" style="color:${ringColorForPercent(usedPct)}">${ctx.compactedPending ? "≈" : ""}${usedPct.toFixed(1)}%</div>` +
      `<div class="vial-tok">${escHtml(fmtTokens(usedTok))} / ${escHtml(fmtTokens(maxTok))}</div></div>` +
      `</div>` +
      `<div class="right-col">` +
      `<div class="metrics-grid">` +
      `<div class="metric-card"><div class="metric-k">TTFT</div><div class="metric-v">${escHtml(ttftText)}</div></div>` +
      `<div class="metric-card"><div class="metric-k">输出速度</div><div class="metric-v" data-testid="maomao-metric-tps">${Number.isFinite(t.tps) ? escHtml(t.tps.toFixed(1)) + '<span class="metric-unit">tok/s</span>' : "--"}</div></div>` +
      `<div class="metric-card"><div class="metric-k">缓存命中</div><div class="metric-v">${escHtml(cachePctText)}</div></div>` +
      `<div class="metric-card"><div class="metric-k">参考费用</div><div class="metric-v">${escHtml(costText)}</div></div>` +
      `</div>` +
      compactHtml +
      `<div class="section"><div class="section-title"><span>上下文拆解</span><span>${ctx.compactions > 0 ? "已压缩 " + ctx.compactions + " 次" : (t.rounds || 0) + " 轮"}</span></div>` +
      `<div class="seg-bar">${segHtml}</div>` +
      `<div class="group-pills"><span>系统 ${escHtml(fmtTokens(grouped.system))}</span><span>·</span><span>对话 ${escHtml(fmtTokens(grouped.convo))}</span><span>·</span><span>工具 ${escHtml(fmtTokens(grouped.tools))}</span></div>` +
      `<div class="cat-list">${catRowsHtml || '<div style="opacity:.6">等待会话数据…</div>'}</div>` +
      `</div>` +
      quotaHtml +
      subHtml +
      `</div></div>` +
      `<div class="pop-foot"><span>本地轨迹缓存: ${escHtml(fmtBytes(cacheBytes))}</span>` +
      `<div class="pop-foot-actions">` +
      `<button type="button" class="chip-btn" data-role="open-dashboard" data-testid="maomao-open-dashboard">用量看板</button>` +
      `</div></div>` +
      `</div>`;

    vialCanvas = wrap.querySelector?.('[data-role="vial-canvas"]') || null;
    vialCtx = vialCanvas && typeof vialCanvas.getContext === "function" ? vialCanvas.getContext("2d") : null;
    if (useVial && vialCanvas) {
      wakeVialLoop();
    } else {
      stopVialLoop();
    }
  }

  function ensurePopoverHost() {
    if (popoverHost && popoverHost.isConnected) return;
    popoverHost = document.createElement("div");
    popoverHost.id = POPOVER_ID;
    popoverHost.style.position = "fixed";
    popoverHost.style.zIndex = "2147482000";
    popoverHost.style.pointerEvents = "auto";
    document.body.append(popoverHost);

    popoverShadow = typeof popoverHost.attachShadow === "function" ? popoverHost.attachShadow({ mode: "open" }) : popoverHost;
    lastPopoverCssKey = "";
    lastPopoverSig = "";
    const style = document.createElement("style");
    const mount = document.createElement("div");
    mount.setAttribute("data-role", "pop-mount");
    popoverShadow.append(style, mount);

    // Dragging titlebar sloshes liquid in real time via applyDragAccel!
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;
    let prevX = 0;
    let prevY = 0;
    let prevVx = 0;
    let prevVy = 0;
    let prevTs = 0;

    mount.addEventListener("pointerdown", (e) => {
      const target = e?.target;
      if (target?.closest?.("button")) return;
      const handle = target?.closest?.('[data-role="drag-handle"]');
      if (handle) {
        popoverDragging = true;
        const rect = popoverHost.getBoundingClientRect?.() || { left: 100, top: 100 };
        baseLeft = rect.left;
        baseTop = rect.top;
        startX = prevX = e.clientX || 0;
        startY = prevY = e.clientY || 0;
        prevVx = 0;
        prevVy = 0;
        prevTs = Date.now();
        e.preventDefault?.();
        return;
      }
      const canvasEl = target?.closest?.('[data-role="vial-canvas"]');
      if (canvasEl) {
        const rect = canvasEl.getBoundingClientRect?.();
        const xNorm = rect && rect.width > 0 ? ((e.clientX || 0) - rect.left) / rect.width : 0.5;
        vialEngine.poke(xNorm, 0.72);
        vialEngine.spawnDroplet(xNorm);
        wakeVialLoop();
      }
    });

    mount.addEventListener("pointermove", (e) => {
      const canvasEl = e?.target?.closest?.('[data-role="vial-canvas"]');
      if (canvasEl && !popoverDragging) {
        const rect = canvasEl.getBoundingClientRect?.();
        const xNorm = rect && rect.width > 0 ? ((e.clientX || 0) - rect.left) / rect.width : 0.5;
        vialEngine.poke(xNorm, 0.12);
        wakeVialLoop();
      }
    });

    addGlobalListener(window, "pointermove", (e) => {
      if (!popoverDragging || !popoverOpen) return;
      const now = Date.now();
      const dt = Math.max(8, now - prevTs) / 1000;
      const cx = e.clientX || 0;
      const cy = e.clientY || 0;
      const vx = (cx - prevX) / dt;
      const vy = (cy - prevY) / dt;
      const ax = (vx - prevVx) * 0.014;
      const ay = (vy - prevVy) * 0.014;
      prevX = cx;
      prevY = cy;
      prevVx = vx;
      prevVy = vy;
      prevTs = now;

      popoverPos = { left: baseLeft + (cx - startX), top: baseTop + (cy - startY) };
      positionPopover();
      vialEngine.applyDragAccel(ax, ay);
      wakeVialLoop();
    });

    addGlobalListener(window, "pointerup", () => {
      popoverDragging = false;
    });

    mount.addEventListener("pointerover", (e) => {
      const row = e?.target?.closest?.("[data-cat-row]");
      if (row) {
        const k = row.getAttribute("data-cat-row");
        if (k !== highlightCategory) {
          highlightCategory = k;
          vialEngine.setHighlightCategory(k);
          wakeVialLoop();
          const slices = mount.querySelectorAll?.("[data-cat]");
          if (slices) {
            for (let i = 0; i < slices.length; i++) {
              slices[i].setAttribute("data-hl", slices[i].getAttribute("data-cat") === k ? "1" : "0");
            }
          }
        }
      }
    });

    mount.addEventListener("pointerout", (e) => {
      if (highlightCategory && !e?.relatedTarget?.closest?.("[data-cat-row]")) {
        highlightCategory = null;
        vialEngine.setHighlightCategory(null);
        wakeVialLoop();
        const slices = mount.querySelectorAll?.("[data-cat]");
        if (slices) {
          for (let i = 0; i < slices.length; i++) slices[i].setAttribute("data-hl", "0");
        }
      }
    });

    mount.addEventListener("click", (e) => {
      const btn = e?.target?.closest?.("button[data-role]");
      if (!btn) return;
      const role = btn.getAttribute("data-role");
      if (role === "close") closePopover();
      else if (role === "refresh") void fetchTelemetry();
      else if (role === "compact-btn") fillCompactCommand();
      else if (role === "open-dashboard") openDashboard();
      else if (role === "toggle-style") {
        vialStyle = vialStyle === "vial" ? "bar" : "vial";
        try {
          window.localStorage?.setItem(STYLE_STORAGE_KEY, vialStyle);
        } catch {}
        renderPopover();
      }
    });
  }

  function openPopover() {
    if (!active) return;
    popoverOpen = true;
    ensurePopoverHost();
    popoverHost.style.display = "block";
    positionPopover();
    renderToolbar();
    renderPopover();
    reschedulePolling();
    void fetchTelemetry();
  }

  function closePopover() {
    popoverOpen = false;
    stopVialLoop();
    if (popoverHost) popoverHost.style.display = "none";
    renderToolbar();
    reschedulePolling();
  }

  // ---- 53-Week Usage Dashboard Glass Modal ----
  function build53WeekCells(daysList) {
    const map = new Map();
    let maxVal = 1;
    for (let i = 0; i < daysList.length; i++) {
      const d = daysList[i];
      if (!d || !d.date) continue;
      const score = Number(d.tokens) || Number(d.requests) || 0;
      map.set(String(d.date), d);
      if (score > maxVal) maxVal = score;
    }
    const totalDays = 53 * 7;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cells = [];
    for (let offset = totalDays - 1; offset >= 0; offset--) {
      const dt = new Date(today.getTime() - offset * 86400000);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const day = String(dt.getDate()).padStart(2, "0");
      const key = `${y}-${m}-${day}`;
      const rec = map.get(key);
      const score = rec ? Number(rec.tokens) || Number(rec.requests) || 0 : 0;
      let lv = 0;
      if (score > 0) {
        const ratio = score / maxVal;
        lv = ratio > 0.72 ? 4 : ratio > 0.42 ? 3 : ratio > 0.16 ? 2 : 1;
      }
      cells.push({
        date: key,
        requests: Number(rec?.requests) || 0,
        tokens: Number(rec?.tokens) || 0,
        lv,
      });
    }
    return cells;
  }

  function syncRangeButtonHighlight() {
    if (!dashboardShadow) return;
    const mount = dashboardShadow.querySelector?.('[data-role="dash-mount"]');
    if (!mount) return;
    const btns = mount.querySelectorAll?.("[data-range]");
    if (!btns) return;
    for (let i = 0; i < btns.length; i++) {
      btns[i].setAttribute("data-active", btns[i].getAttribute("data-range") === dashboardRange ? "1" : "0");
    }
  }

  async function fetchDashboard(range) {
    const targetRange = range || dashboardRange || "all";
    dashboardRange = targetRange;
    syncRangeButtonHighlight();

    // Serve immediately from client-side 30s TTL range cache for zero-latency switching
    const cached = dashboardCache.get(targetRange);
    if (cached && Date.now() - cached.at < DASHBOARD_CACHE_TTL_MS) {
      dashboardData = cached.data;
      dashboardDataVersion++;
      if (dashboardOpen) renderDashboard();
      return;
    }

    if (!cfg.sidecarBaseUrl || typeof fetch !== "function") {
      if (dashboardOpen) renderDashboard();
      return;
    }

    if (dashboardAbortCtrl) {
      try {
        dashboardAbortCtrl.abort();
      } catch {}
      dashboardAbortCtrl = null;
    }
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    dashboardAbortCtrl = ctrl;

    try {
      const url = `${cfg.sidecarBaseUrl}/api/maomao/usage?range=${encodeURIComponent(targetRange)}&token=${encodeURIComponent(cfg.sidecarToken)}`;
      const res = await (ctrl ? fetch(url, { signal: ctrl.signal }) : fetch(url));
      if (ctrl && ctrl.signal.aborted) return;
      if (targetRange !== dashboardRange) return;
      if (res && res.ok) {
        const json = await res.json();
        if (ctrl && ctrl.signal.aborted) return;
        if (targetRange !== dashboardRange) return;
        dashboardData = json;
        dashboardDataVersion++;
        dashboardCache.set(targetRange, { data: json, at: Date.now() });
      }
    } catch {}
    finally {
      if (dashboardAbortCtrl === ctrl) dashboardAbortCtrl = null;
    }
    if (dashboardOpen && targetRange === dashboardRange) renderDashboard();
  }

  function fmtCallTime(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "--";
    const dt = new Date(n);
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    const hh = String(dt.getHours()).padStart(2, "0");
    const mi = String(dt.getMinutes()).padStart(2, "0");
    const ss = String(dt.getSeconds()).padStart(2, "0");
    return `${mm}月${dd}日 ${hh}:${mi}:${ss}`;
  }

  function fmtSec(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "--";
    const s = n / 1000;
    return (s >= 10 ? s.toFixed(1) : s.toFixed(2)) + " s";
  }

  function fmtCompactTokUpper(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return "0";
    if (v >= 1000000) return (v / 1000000).toFixed(2) + "M";
    if (v >= 100000) return Math.round(v / 1000) + "K";
    if (v >= 10000) return (v / 1000).toFixed(1) + "K";
    if (v >= 1000) return (v / 1000).toFixed(2) + "K";
    return String(Math.round(v));
  }

  function buildFilteredCallRowsHtml() {
    const d = dashboardData || {};
    const rawCalls = Array.isArray(d.recentCalls) ? d.recentCalls : [];
    const callModelSet = new Set();
    for (let i = 0; i < rawCalls.length; i++) {
      if (rawCalls[i]?.model) callModelSet.add(String(rawCalls[i].model));
    }
    const callModels = [...callModelSet].sort();
    if (logModelFilter && !callModelSet.has(logModelFilter)) logModelFilter = "";

    const filteredCalls = rawCalls
      .map((c, idx) => ({ c, key: String(c?.requestId || (c?.timestampMs || 0) + "-" + idx) }))
      .filter(({ c }) => !logModelFilter || String(c?.model || "") === logModelFilter);

    const sortMetric = (c) => {
      if (logSortBy === "tps") return Number.isFinite(Number(c?.tps)) ? Number(c.tps) : -1;
      if (logSortBy === "ttft") return Number.isFinite(Number(c?.ttftMs)) ? Number(c.ttftMs) : -1;
      if (logSortBy === "cache") return Number.isFinite(Number(c?.cacheHitRate)) ? Number(c.cacheHitRate) : -1;
      if (logSortBy === "duration") return Number.isFinite(Number(c?.durationMs)) ? Number(c.durationMs) : -1;
      return Number.isFinite(Number(c?.timestampMs)) ? Number(c.timestampMs) : 0;
    };
    filteredCalls.sort((a, b) => {
      const diff = sortMetric(a.c) - sortMetric(b.c);
      return logSortDir === "asc" ? diff : -diff;
    });

    const rowsHtml = filteredCalls.length
      ? filteredCalls
          .map(({ c, key }) => {
            const expanded = expandedCallKey === key;
            const tpsVal = Number(c?.tps);
            const tpsDisplay = Number.isFinite(tpsVal) && tpsVal > 0 ? Math.round(tpsVal) + " tok/s" : "--";
            const cacheVal = Number(c?.cacheHitRate);
            const cacheDisplay = Number.isFinite(cacheVal) ? cacheVal.toFixed(1) + "%" : "--";
            const isOk = c?.status !== "error" && !c?.error;
            const statusPill = isOk
              ? `<span class="log-pill log-pill-ok">已完成</span>`
              : `<span class="log-pill log-pill-err">异常</span>`;
            const detailRow = expanded
              ? `<tr class="log-detail-row" data-testid="maomao-call-detail"><td colspan="7">` +
                `<div class="log-detail-grid">` +
                `<span>思考 Token: <strong>${escHtml(fmtCompactTokUpper(c?.thinkingTokens ?? 0))}</strong></span>` +
                `<span>回复 Token: <strong>${escHtml(fmtCompactTokUpper(c?.responseTokens ?? 0))}</strong></span>` +
                (Number(c?.cacheWriteTokens) > 0
                  ? `<span>缓存写入: <strong>${escHtml(fmtCompactTokUpper(c.cacheWriteTokens))}</strong></span>`
                  : "") +
                `<span>重试次数: <strong>${escHtml(String(c?.retries ?? 0))}</strong></span>` +
                `<span>会话 ID: <strong>${escHtml(c?.conversationId || "--")}</strong></span>` +
                `<span>Request ID: <strong>${escHtml(c?.requestId || "--")}</strong></span>` +
                `</div>` +
                (c?.error ? `<div class="log-detail-err">${escHtml(c.error)}</div>` : "") +
                `</td></tr>`
              : "";

            return (
              `<tr class="log-row" data-call-key="${escHtml(key)}" data-expanded="${expanded ? "1" : "0"}">` +
              `<td><span class="log-chev">${expanded ? "▾" : "▸"}</span>${escHtml(fmtCallTime(c?.timestampMs))}</td>` +
              `<td><div class="log-model-main">${escHtml(c?.model || "Unknown")}</div><div class="log-model-sub">${escHtml(c?.provider || "Antigravity")}</div></td>` +
              `<td>${escHtml(fmtSec(c?.ttftMs))}</td>` +
              `<td>${escHtml(tpsDisplay)}</td>` +
              `<td><span class="tok-in">${escHtml(fmtCompactTokUpper(c?.inputTokens ?? 0))}</span><span class="tok-sep">/</span><span class="tok-cache">${escHtml(fmtCompactTokUpper(c?.cacheReadTokens ?? 0))}</span><span class="tok-sep">/</span><span class="tok-out">${escHtml(fmtCompactTokUpper(c?.outputTokens ?? 0))}</span></td>` +
              `<td>${escHtml(cacheDisplay)}</td>` +
              `<td><span class="log-status-wrap"><span>${escHtml(fmtSec(c?.durationMs))}</span>${statusPill}</span></td>` +
              `</tr>` +
              detailRow
            );
          })
          .join("")
      : `<tr><td colspan="7" style="text-align:center;padding:18px;opacity:.65">当前时间范围内暂无模型调用日志</td></tr>`;

    return { callModels, count: filteredCalls.length, rowsHtml };
  }

  function renderDashboardLogsOnly() {
    if (!dashboardOpen || !dashboardShadow) return;
    const mount = dashboardShadow.querySelector?.('[data-role="dash-mount"]');
    const tbody = mount?.querySelector?.('[data-role="log-tbody"]');
    if (!tbody) {
      renderDashboard();
      return;
    }
    const { count, rowsHtml } = buildFilteredCallRowsHtml();
    tbody.innerHTML = rowsHtml;
    const countEl = mount.querySelector?.('[data-role="log-count"]');
    if (countEl) countEl.textContent = `模型调用日志 (${count})`;
    const dirBtn = mount.querySelector?.('[data-role="log-sort-dir"]');
    if (dirBtn) dirBtn.textContent = logSortDir === "asc" ? "↑ 升序" : "↓ 降序";
  }

  function renderDashboard() {
    if (!dashboardOpen || !dashboardShadow) return;
    const surfaceMode = detectSurfaceMode();
    const dashCssKey = `${surfaceMode}:${cfg.themeStyle}`;
    const styleEl = dashboardShadow.querySelector?.("style");
    if (styleEl && (dashCssKey !== lastDashboardCssKey || !styleEl.textContent)) {
      lastDashboardCssKey = dashCssKey;
      styleEl.textContent = buildDashboardCss();
    }
    const mount = dashboardShadow.querySelector?.('[data-role="dash-mount"]');
    if (!mount) return;

    const frameSig = `${surfaceMode}|${dashboardRange}|${dashboardDataVersion}`;
    if (frameSig === lastDashboardFrameSig && mount.children && mount.children.length > 0) {
      syncRangeButtonHighlight();
      return;
    }
    lastDashboardFrameSig = frameSig;

    const d = dashboardData || {};
    const days = Array.isArray(d.days) ? d.days : [];
    const models = Array.isArray(d.models) ? d.models : [];
    const cells = build53WeekCells(days);
    const maxModelTok = Math.max(1, ...models.map((m) => Number(m?.tokens) || 0));

    const ranges = [
      { id: "today", label: "今天" },
      { id: "week", label: "本周" },
      { id: "30d", label: "30天" },
      { id: "all", label: "全部" },
    ];

    const cellsHtml = cells
      .map(
        (c) =>
          `<span class="h-cell" data-lv="${c.lv}" data-day="${escHtml(c.date)}" title="${escHtml(c.date)}: ${c.requests} 次请求 / ${escHtml(fmtTokens(c.tokens))} Token"></span>`
      )
      .join("");

    const modelsHtml = models
      .map((m) => {
        const name = String(m.model || m.name || "Unknown");
        const tok = Number(m.tokens) || 0;
        const pct = Math.max(3, Math.round((tok / maxModelTok) * 100));
        const cache = Number.isFinite(m.cacheHitPercent) ? Math.round(m.cacheHitPercent) + "%" : "--";
        return (
          `<div class="model-row">` +
          `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(name)}">${escHtml(name)}</span>` +
          `<div class="m-bar-track"><div class="m-bar-fill" style="width:${pct}%"></div></div>` +
          `<span style="text-align:right">${escHtml(fmtTokens(tok))}</span>` +
          `<span style="text-align:right;opacity:.8">${escHtml(cache)}</span>` +
          `<span style="text-align:right;font-weight:600">${escHtml(fmtCost(m.costUsd))}</span>` +
          `</div>`
        );
      })
      .join("");

    const sortOptions = [
      { id: "time", label: "时间" },
      { id: "tps", label: "速度" },
      { id: "ttft", label: "首字响应" },
      { id: "cache", label: "缓存命中" },
      { id: "duration", label: "耗时" },
    ];

    const { callModels, count: callCount, rowsHtml: callRowsHtml } = buildFilteredCallRowsHtml();

    const callLogsHtml =
      `<div class="card" data-testid="maomao-call-logs">` +
      `<div class="card-h">` +
      `<span data-role="log-count">模型调用日志 (${callCount})</span>` +
      `<div class="log-controls">` +
      `<select class="log-select" data-role="log-model-filter" aria-label="按模型筛选">` +
      `<option value=""${logModelFilter === "" ? " selected" : ""}>全部模型</option>` +
      callModels
        .map((m) => `<option value="${escHtml(m)}"${logModelFilter === m ? " selected" : ""}>${escHtml(m)}</option>`)
        .join("") +
      `</select>` +
      `<select class="log-select" data-role="log-sort-by" aria-label="排序字段">` +
      sortOptions
        .map((o) => `<option value="${o.id}"${logSortBy === o.id ? " selected" : ""}>按${o.label}</option>`)
        .join("") +
      `</select>` +
      `<button type="button" class="log-dir-btn" data-role="log-sort-dir">${logSortDir === "asc" ? "↑ 升序" : "↓ 降序"}</button>` +
      `</div></div>` +
      `<div class="log-table-wrap"><table class="log-table"><thead><tr>` +
      `<th>时间</th><th>模型 / 提供方</th><th>首字响应</th><th>速度</th><th>输入 / 缓读 / 输出</th><th>缓存命中</th><th>耗时 / 状态</th>` +
      `</tr></thead><tbody data-role="log-tbody">${callRowsHtml}</tbody></table></div>` +
      `</div>`;

    mount.innerHTML =
      `<div class="backdrop" data-role="dash-backdrop">` +
      `<div class="modal" data-surface="${surfaceMode}" data-testid="maomao-usage-dashboard">` +
      `<div class="m-head">` +
      `<div class="m-title">✦ 喵言喵语 · 用量看板 (53 周热力图)</div>` +
      `<div class="m-ranges">` +
      ranges
        .map(
          (r) =>
            `<button type="button" class="r-btn" data-range="${r.id}" data-active="${dashboardRange === r.id ? "1" : "0"}">${r.label}</button>`
        )
        .join("") +
      `<button type="button" class="r-btn" data-role="dash-close">✕</button>` +
      `</div></div>` +
      `<div class="m-body">` +
      `<div class="kpi-row">` +
      `<div class="kpi"><div class="kpi-l">总请求数</div><div class="kpi-v">${escHtml(String(d.totalRequests ?? 0))}</div></div>` +
      `<div class="kpi"><div class="kpi-l">累计 Token</div><div class="kpi-v">${escHtml(fmtTokens(d.totalTokens ?? 0))}</div></div>` +
      `<div class="kpi"><div class="kpi-l">缓存命中率</div><div class="kpi-v">${d.cacheHitPercent != null ? Number(d.cacheHitPercent).toFixed(1) + "%" : "--"}</div></div>` +
      `<div class="kpi"><div class="kpi-l">参考费用</div><div class="kpi-v">${escHtml(fmtCost(d.costUsd))}</div></div>` +
      `</div>` +
      `<div class="card"><div class="card-h"><span>53 周活跃热力图</span><span data-role="heatmap-tip" style="font-size:11px;opacity:.72">${hoveredHeatmapDay ? escHtml(hoveredHeatmapDay) : "近 371 天"}</span></div>` +
      `<div class="heat-grid" data-testid="maomao-heatmap-53w">${cellsHtml}</div></div>` +
      `<div class="card"><div class="card-h"><span>模型消耗分布</span></div>` +
      (modelsHtml || `<div style="opacity:.65">暂无模型统计记录</div>`) +
      `</div>` +
      callLogsHtml +
      `</div></div></div>`;
  }

  function openDashboard() {
    if (!active) return;
    dashboardOpen = true;
    if (!dashboardHost || !dashboardHost.isConnected) {
      dashboardHost = document.createElement("div");
      dashboardHost.id = DASHBOARD_ID;
      dashboardHost.style.position = "fixed";
      dashboardHost.style.inset = "0";
      dashboardHost.style.zIndex = "2147482500";
      document.body.append(dashboardHost);
      dashboardShadow =
        typeof dashboardHost.attachShadow === "function" ? dashboardHost.attachShadow({ mode: "open" }) : dashboardHost;
      lastDashboardCssKey = "";
      lastDashboardFrameSig = "";
      const style = document.createElement("style");
      const mount = document.createElement("div");
      mount.setAttribute("data-role", "dash-mount");
      dashboardShadow.append(style, mount);

      mount.addEventListener("pointerover", (e) => {
        const cell = e?.target?.closest?.(".h-cell");
        if (cell) {
          const tip = cell.getAttribute("title") || "";
          const label = mount.querySelector?.('[data-role="heatmap-tip"]');
          if (label && tip) label.textContent = tip;
        }
      });

      mount.addEventListener("change", (e) => {
        const target = e?.target;
        const role = target?.getAttribute?.("data-role");
        if (role === "log-model-filter") {
          logModelFilter = String(target.value || "");
          expandedCallKey = "";
          renderDashboardLogsOnly();
        } else if (role === "log-sort-by") {
          logSortBy = String(target.value || "time");
          renderDashboardLogsOnly();
        }
      });

      mount.addEventListener("click", (e) => {
        const target = e?.target;
        if (target?.getAttribute?.("data-role") === "dash-backdrop" || target?.closest?.('[data-role="dash-close"]')) {
          closeDashboard();
          return;
        }
        const rangeBtn = target?.closest?.("[data-range]");
        if (rangeBtn) {
          void fetchDashboard(rangeBtn.getAttribute("data-range"));
          return;
        }
        const dirBtn = target?.closest?.('[data-role="log-sort-dir"]');
        if (dirBtn) {
          logSortDir = logSortDir === "asc" ? "desc" : "asc";
          renderDashboardLogsOnly();
          return;
        }
        const logRow = target?.closest?.("tr[data-call-key]");
        if (logRow) {
          const k = logRow.getAttribute("data-call-key") || "";
          expandedCallKey = expandedCallKey === k ? "" : k;
          renderDashboardLogsOnly();
        }
      });
    }
    dashboardHost.style.display = "block";
    renderDashboard();
    void fetchDashboard(dashboardRange);
  }

  function closeDashboard() {
    dashboardOpen = false;
    if (dashboardAbortCtrl) {
      try {
        dashboardAbortCtrl.abort();
      } catch {}
      dashboardAbortCtrl = null;
    }
    if (dashboardHost) dashboardHost.style.display = "none";
  }

  // ---- Network Polling (2s open / 5s closed / pause on blur or hidden) ----
  let windowBlurred = false;

  async function fetchTelemetry() {
    if (!active || fetchInFlight || !cfg.enabled || !cfg.sidecarBaseUrl || typeof fetch !== "function") return null;
    fetchInFlight = true;
    try {
      const cid = detectConversationId();
      const qs = `conversationId=${encodeURIComponent(cid)}&token=${encodeURIComponent(cfg.sidecarToken)}`;
      const res = await fetch(`${cfg.sidecarBaseUrl}/api/maomao/telemetry?${qs}`);
      if (res && res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") {
          telemetryData = data;
          renderToolbar();
          if (popoverOpen) renderPopover();
        }
      }
    } catch {}
    finally {
      fetchInFlight = false;
    }
    return telemetryData;
  }

  function clearPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = 0;
    }
  }

  function reschedulePolling() {
    clearPolling();
    if (!active || !cfg.enabled || document.hidden || windowBlurred) return;
    const ms = popoverOpen ? cfg.pollOpenMs : cfg.pollClosedMs;
    pollTimer = setInterval(() => {
      if (!active || document.hidden || windowBlurred) return;
      void fetchTelemetry();
    }, ms);
  }

  // ---- Mount & Width Folding Observer ----
  function syncCompactWidth(anchor) {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect?.();
    if (rect && rect.width > 0) {
      const nextTier = rect.width < 480 ? "icons" : rect.width < 680 ? "medium" : "wide";
      const nextCompact = nextTier === "icons";
      if (nextTier !== densityTier || nextCompact !== compactMode) {
        densityTier = nextTier;
        compactMode = nextCompact;
        renderToolbar();
      }
    }
  }

  function ensureMounted() {
    if (!active) return;
    if (!cfg.enabled || cfg.barMode === "off") {
      unmountToolbar();
      return;
    }
    const anchor = findToolbarAnchor();
    if (!anchor) return;

    const extPresent = hasExternalPulseBar();
    yieldedExternal = cfg.barMode === "auto" && extPresent && !userTakeover;
    const beforeNode = findRightActionGroup(anchor);

    if (!hostEl || !hostEl.isConnected || hostEl.parentElement !== anchor) {
      if (hostEl) hostEl.remove();
      hostEl = document.createElement("span");
      hostEl.id = HOST_ID;
      hostEl.setAttribute("data-maomao-telemetry-bar", "1");
      shadow = typeof hostEl.attachShadow === "function" ? hostEl.attachShadow({ mode: "open" }) : hostEl;
      toolbarRoot = shadow;
      lastToolbarCssKey = "";
      lastToolbarSig = "";

      const style = document.createElement("style");
      const container = document.createElement("span");
      container.setAttribute("data-role", "tb-container");
      shadow.append(style, container);

      container.addEventListener("click", (e) => {
        e?.stopPropagation?.();
        const btn = e?.target?.closest?.("button[data-role]");
        if (!btn) return;
        const role = btn.getAttribute("data-role");
        if (role === "takeover") {
          takeover();
          return;
        }
        if (popoverOpen) closePopover();
        else openPopover();
      });

      if (beforeNode && typeof anchor.insertBefore === "function") {
        anchor.insertBefore(hostEl, beforeNode);
      } else {
        anchor.append(hostEl);
      }

      if (resizeObs) {
        try {
          resizeObs.disconnect();
        } catch {}
      }
      if (typeof ResizeObserver === "function") {
        resizeObs = new ResizeObserver(() => syncCompactWidth(anchor));
        try {
          resizeObs.observe(anchor);
        } catch {}
      }
    } else if (beforeNode && hostEl.nextSibling !== beforeNode && typeof anchor.insertBefore === "function") {
      anchor.insertBefore(hostEl, beforeNode);
    }

    syncCompactWidth(anchor);
    renderToolbar();
  }

  function unmountToolbar() {
    if (resizeObs) {
      try {
        resizeObs.disconnect();
      } catch {}
      resizeObs = null;
    }
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
    }
    shadow = null;
    toolbarRoot = null;
    lastToolbarCssKey = "";
    lastToolbarSig = "";
  }

  function takeover() {
    userTakeover = true;
    yieldedExternal = false;
    try {
      window.localStorage?.setItem(TAKEOVER_STORAGE_KEY, "1");
    } catch {}
    renderToolbar();
    return status();
  }

  const EDITABLE_SKIP_SELECTOR =
    '[data-lexical-editor="true"], [contenteditable="true"], textarea, input, #agy-maomao-telemetry-host, #agy-maomao-telemetry-popover-host, #agy-maomao-dashboard-host';

  function isEditableMutation(rec) {
    const t = rec?.target;
    const el = t && t.nodeType === 3 ? t.parentElement : t;
    if (!el || typeof el.closest !== "function") return false;
    return Boolean(el.closest(EDITABLE_SKIP_SELECTOR));
  }

  function scheduleScan() {
    if (!active || scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      ensureMounted();
    }, 90);
  }

  function onMutations(records) {
    if (!active || !Array.isArray(records) || !records.length) return;
    for (let i = 0; i < records.length; i++) {
      if (!isEditableMutation(records[i])) {
        scheduleScan();
        return;
      }
    }
  }

  if (typeof MutationObserver === "function") {
    mutationObs = new MutationObserver(onMutations);
    try {
      mutationObs.observe(document.body, { childList: true, subtree: true });
    } catch {}
    themeAttrObs = new MutationObserver(() => {
      if (!active || !cfg.enabled || cfg.barMode === "off") return;
      renderToolbar();
      if (popoverOpen) renderPopover();
      if (dashboardOpen) renderDashboard();
    });
    try {
      if (document.documentElement) {
        themeAttrObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      }
      if (document.body) {
        themeAttrObs.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] });
      }
    } catch {}
  }

  addGlobalListener(document, "visibilitychange", () => {
    if (document.hidden) {
      clearPolling();
      stopVialLoop();
    } else {
      reschedulePolling();
      void fetchTelemetry();
      if (popoverOpen) wakeVialLoop();
    }
  });
  addGlobalListener(window, "blur", () => {
    windowBlurred = true;
    clearPolling();
  });
  addGlobalListener(window, "focus", () => {
    windowBlurred = false;
    reschedulePolling();
    void fetchTelemetry();
  });
  addGlobalListener(document, "keydown", (e) => {
    if (e?.key === "Escape") {
      if (dashboardOpen) closeDashboard();
      else if (popoverOpen) closePopover();
    }
  });
  addGlobalListener(document, "pointerdown", (e) => {
    if (!popoverOpen || dashboardOpen) return;
    const t = e?.target;
    const path = typeof e?.composedPath === "function" ? e.composedPath() : [];
    if (path.includes(hostEl) || path.includes(popoverHost)) return;
    if (t && (hostEl?.contains?.(t) || popoverHost?.contains?.(t))) return;
    closePopover();
  });

  function update(nextConfig) {
    const prevStyle = cfg.vialStyle;
    cfg = normalizeConfig(nextConfig);
    if (cfg.vialStyle !== prevStyle) vialStyle = cfg.vialStyle;
    if (cfg.takeoverExternal) userTakeover = true;
    if (!cfg.enabled || cfg.barMode === "off") {
      closeDashboard();
      closePopover();
      clearPolling();
      unmountToolbar();
      return status();
    }
    ensureMounted();
    if (popoverOpen) renderPopover();
    if (dashboardOpen) renderDashboard();
    reschedulePolling();
    return status();
  }

  function destroy() {
    active = false;
    clearPolling();
    stopVialLoop();
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = 0;
    }
    if (mutationObs) {
      try {
        mutationObs.disconnect();
      } catch {}
      mutationObs = null;
    }
    if (themeAttrObs) {
      try {
        themeAttrObs.disconnect();
      } catch {}
      themeAttrObs = null;
    }
    for (let i = 0; i < globalListeners.length; i++) {
      const [target, type, fn, opts] = globalListeners[i];
      try {
        target.removeEventListener(type, fn, opts);
      } catch {}
    }
    globalListeners.length = 0;
    unmountToolbar();
    if (popoverHost) {
      popoverHost.remove();
      popoverHost = null;
      popoverShadow = null;
    }
    if (dashboardAbortCtrl) {
      try {
        dashboardAbortCtrl.abort();
      } catch {}
      dashboardAbortCtrl = null;
    }
    dashboardCache.clear();
    if (dashboardHost) {
      dashboardHost.remove();
      dashboardHost = null;
      dashboardShadow = null;
    }
    lastToolbarCssKey = "";
    lastPopoverCssKey = "";
    lastDashboardCssKey = "";
    lastToolbarSig = "";
    lastPopoverSig = "";
    lastDashboardFrameSig = "";
    vialCanvas = null;
    vialCtx = null;
    delete window[KEY];
    return { removed: true };
  }

  function status() {
    return {
      applied: active,
      rev: REV,
      owner: cfg.owner,
      enabled: cfg.enabled,
      mounted: Boolean(hostEl && hostEl.isConnected),
      barMode: cfg.barMode,
      surfaceMode: detectSurfaceMode(),
      densityTier: cfg.barMode === "icons" ? "icons" : cfg.barMode === "full" ? "wide" : densityTier,
      compact: cfg.barMode === "icons" || (cfg.barMode === "auto" && compactMode),
      yielded: yieldedExternal,
      popoverOpen,
      dashboardOpen,
      vialStyle,
      vialSleeping: vialEngine.isSleeping(),
      vialRafActive: Boolean(vialRaf),
    };
  }

  function getState() {
    return {
      data: telemetryData,
      quota: telemetryData?.quota || null,
      working: detectWorkingState(),
      conversationId: detectConversationId(),
      vialStyle,
      popoverOpen,
    };
  }

  if (cfg.enabled && cfg.barMode !== "off") {
    ensureMounted();
    reschedulePolling();
    void fetchTelemetry();
  }

  const handle = {
    rev: REV,
    owner: cfg.owner,
    lastSeen: Date.now(),
    touch() {
      handle.lastSeen = Date.now();
      return true;
    },
    update,
    destroy,
    status,
    openPopover,
    closePopover,
    openDashboard,
    closeDashboard,
    takeover,
    refresh: fetchTelemetry,
    getState,
    rescan: ensureMounted,
  };
  window[KEY] = handle;
  return status();
}

module.exports = {
  TELEMETRY_BAR_REV: 8,
  createVialEngineSource,
  installTelemetryBar,
};
