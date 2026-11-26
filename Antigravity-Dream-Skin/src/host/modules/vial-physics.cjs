"use strict";

/**
 * Pure MIT clean-room 1D shallow-water physics & borosilicate glass vial renderer.
 * Designed for Antigravity-Star-Suite ("猫猫壁纸&喵言喵语" v0.4.0).
 *
 * Self-contained factory: createVialEngine(options) uses zero external closures
 * so createVialEngineSource() can be serialized cleanly if needed.
 */
function createVialEngine(options) {
  const opts = options && typeof options === "object" ? options : {};
  const N = Math.max(8, Math.min(64, Math.round(Number(opts.nodes) || 24)));
  const stiffness = Number.isFinite(opts.stiffness) ? opts.stiffness : 38.0;
  const damping = Number.isFinite(opts.damping) ? opts.damping : 3.2;
  const spread = Number.isFinite(opts.spread) ? opts.spread : 22.0;
  const pendOmega = Number.isFinite(opts.pendulumOmega) ? opts.pendulumOmega : 6.4;
  const pendZeta = Number.isFinite(opts.pendulumZeta) ? opts.pendulumZeta : 0.34;
  const sleepDelayMs = Number.isFinite(opts.sleepDelayMs) ? opts.sleepDelayMs : 1100;
  const energyThreshold = Number.isFinite(opts.energyThreshold) ? opts.energyThreshold : 0.00018;

  const h = new Float64Array(N);
  const v = new Float64Array(N);
  const hNext = new Float64Array(N);

  const state = {
    nodes: N,
    h,
    v,
    level: clamp01(opts.initialLevel ?? 0),
    targetLevel: clamp01(opts.initialLevel ?? 0),
    maxTokens: Number.isFinite(opts.maxTokens) && opts.maxTokens > 0 ? opts.maxTokens : 524288,
    usedTokens: Number.isFinite(opts.usedTokens) && opts.usedTokens >= 0 ? opts.usedTokens : 0,
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
    compactedPending: false,
  };

  function clamp01(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  function wake() {
    state.stillMs = 0;
    state.sleeping = false;
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

  function applyDragAccel(ax, ay) {
    const fx = Number.isFinite(ax) ? Math.max(-40, Math.min(40, ax)) : 0;
    const fy = Number.isFinite(ay) ? Math.max(-40, Math.min(40, ay)) : 0;
    if (Math.abs(fx) < 0.01 && Math.abs(fy) < 0.01) return;
    // Lateral acceleration excites damped gravity pendulum and antisymmetric slosh
    state.tiltVel += -fx * 0.085;
    state.tiltVel = Math.max(-6.5, Math.min(6.5, state.tiltVel));
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1) - 0.5;
      v[i] += (-fx * 0.24 * u) + (fy * 0.06 * (0.25 - u * u));
    }
    if (Math.abs(fx) > 3.5 && state.bubbles.length < 16 && state.level > 0.05) {
      spawnBubble(0.2 + Math.random() * 0.6);
    }
    wake();
  }

  function spawnDroplet(xNorm) {
    if (state.droplets.length >= 10) return;
    const x = clamp01(xNorm == null ? (0.3 + Math.random() * 0.4) : xNorm);
    state.droplets.push({
      x,
      y: 0.05,
      vy: 0.22 + Math.random() * 0.18,
      r: 2.0 + Math.random() * 1.4,
      alpha: 0.95,
    });
    wake();
  }

  function spawnBubble(xNorm) {
    if (state.bubbles.length >= 16 || state.level < 0.04) return;
    const x = clamp01(xNorm == null ? (0.14 + Math.random() * 0.72) : xNorm);
    state.bubbles.push({
      x,
      y: 1.0 - Math.random() * Math.min(0.14, state.level * 0.5),
      vy: 0.09 + Math.random() * 0.14,
      r: 1.1 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
      sway: 0.015 + Math.random() * 0.025,
      alpha: 0.45 + Math.random() * 0.4,
    });
  }

  function setTargetLevel(nextLevel, meta) {
    const clamped = clamp01(nextLevel);
    const prevTarget = state.targetLevel;
    state.targetLevel = clamped;
    if (meta && typeof meta === "object") {
      if (Number.isFinite(meta.maxTokens) && meta.maxTokens > 0) state.maxTokens = meta.maxTokens;
      if (Number.isFinite(meta.usedTokens) && meta.usedTokens >= 0) state.usedTokens = meta.usedTokens;
      if (Array.isArray(meta.categories)) state.categories = meta.categories;
      if (typeof meta.compactedPending === "boolean") state.compactedPending = meta.compactedPending;
    }
    const diff = clamped - prevTarget;
    if (Math.abs(diff) > 0.0008) {
      wake();
      if (diff > 0.008) {
        const count = Math.min(4, Math.max(1, Math.round(diff * 24)));
        for (let i = 0; i < count; i++) {
          spawnDroplet(0.25 + (i + 0.5) / count * 0.5);
        }
      } else if (diff < -0.02) {
        // Compaction drop creates an energetic surface ripple
        poke(0.5, -0.55);
      }
    }
  }

  function setHighlightCategory(catKey) {
    const next = catKey || null;
    if (state.highlightCategory !== next) {
      state.highlightCategory = next;
      wake();
    }
  }

  function computeEnergy() {
    let e = 0;
    for (let i = 0; i < N; i++) {
      e += h[i] * h[i] * 2.5 + v[i] * v[i] * 0.25;
    }
    e /= N;
    e += state.tiltAngle * state.tiltAngle * 2.0 + state.tiltVel * state.tiltVel * 0.12;
    e += Math.abs(state.targetLevel - state.level) * 4.0;
    e += state.droplets.length * 0.08;
    return e;
  }

  function step(dtSeconds) {
    const rawDt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0.016;
    const clampedDt = Math.min(0.032, Math.max(0.001, rawDt));
    if (state.sleeping) {
      return { sleeping: true, active: false, energy: 0, level: state.level };
    }

    state.clockSec += clampedDt;

    // Smooth fill easing
    const levelDiff = state.targetLevel - state.level;
    if (Math.abs(levelDiff) > 0.0001) {
      state.level += levelDiff * Math.min(1, clampedDt * 5.2);
    } else {
      state.level = state.targetLevel;
    }

    // Sub-stepped symplectic 1D shallow-water wave & pendulum integration
    const subSteps = 2;
    const sdt = clampedDt / subSteps;
    for (let s = 0; s < subSteps; s++) {
      // Damped gravity pendulum
      const pendAcc = -(pendOmega * pendOmega) * state.tiltAngle - 2 * pendZeta * pendOmega * state.tiltVel;
      state.tiltVel += pendAcc * sdt;
      state.tiltAngle += state.tiltVel * sdt;
      state.tiltAngle = Math.max(-0.42, Math.min(0.42, state.tiltAngle));

      // 1D wave nodes with reflective boundaries + weak coupling to pendulum velocity
      for (let i = 0; i < N; i++) {
        const left = i > 0 ? h[i - 1] : h[i];
        const right = i < N - 1 ? h[i + 1] : h[i];
        const laplacian = left + right - 2 * h[i];
        const u = i / (N - 1) - 0.5;
        const pendDrive = -state.tiltVel * 0.14 * u;
        const acc = -stiffness * h[i] - damping * v[i] + spread * laplacian + pendDrive;
        v[i] += acc * sdt;
        if (v[i] > 12) v[i] = 12;
        else if (v[i] < -12) v[i] = -12;
        hNext[i] = h[i] + v[i] * sdt;
      }
      // Enforce zero-mean conservation so liquid volume stays exact
      let mean = 0;
      for (let i = 0; i < N; i++) mean += hNext[i];
      mean /= N;
      for (let i = 0; i < N; i++) {
        const clampedH = Math.max(-0.35, Math.min(0.35, hNext[i] - mean));
        h[i] = clampedH;
      }
    }

    // Update falling droplets & trigger surface impact ripples
    const surfaceY = 1.0 - state.level;
    for (let i = state.droplets.length - 1; i >= 0; i--) {
      const d = state.droplets[i];
      d.vy += 2.6 * clampedDt;
      d.y += d.vy * clampedDt;
      if (d.y >= surfaceY) {
        poke(d.x, Math.min(0.8, 0.25 + d.vy * 0.25));
        spawnBubble(d.x);
        state.droplets.splice(i, 1);
      }
    }

    // Update rising stardust micro-bubbles
    if (state.level > 0.08 && state.bubbles.length < 7 && Math.random() < clampedDt * 2.2) {
      spawnBubble();
    }
    for (let i = state.bubbles.length - 1; i >= 0; i--) {
      const b = state.bubbles[i];
      b.y -= b.vy * clampedDt;
      b.phase += clampedDt * 3.1;
      if (b.y <= surfaceY + 0.015) {
        state.bubbles.splice(i, 1);
      }
    }

    const energy = computeEnergy();
    state.energy = energy;

    const settled =
      energy < energyThreshold &&
      state.droplets.length === 0 &&
      Math.abs(state.targetLevel - state.level) < 0.0005;

    if (settled) {
      state.stillMs += clampedDt * 1000;
      if (state.stillMs >= sleepDelayMs) {
        for (let i = 0; i < N; i++) {
          h[i] = 0;
          v[i] = 0;
        }
        state.tiltAngle = 0;
        state.tiltVel = 0;
        state.level = state.targetLevel;
        state.energy = 0;
        state.sleeping = true;
      }
    } else {
      state.stillMs = 0;
    }

    return {
      sleeping: state.sleeping,
      active: !state.sleeping,
      energy: state.energy,
      level: state.level,
    };
  }

  function formatTickLabel(tokensVal) {
    if (tokensVal >= 1000000) {
      const m = tokensVal / 1000000;
      return (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + "M";
    }
    return Math.round(tokensVal / 1024) + "k";
  }

  function resolvePalette(level, theme) {
    const dark = theme?.dark !== false;
    const starNeko = theme?.themeStyle !== "official";
    const pct = level * 100;
    if (pct >= 80) {
      return {
        top: dark ? "#fb7185" : "#f43f5e",
        mid: dark ? "#e11d48" : "#e11d48",
        bot: dark ? "#881337" : "#be123c",
        crest: "#ffe4e6",
        glow: "rgba(244, 63, 94, 0.42)",
        drop: "#fda4af",
      };
    }
    if (pct >= 60) {
      return {
        top: dark ? "#fcd34d" : "#f59e0b",
        mid: dark ? "#f59e0b" : "#d97706",
        bot: dark ? "#92400e" : "#b45309",
        crest: "#fef3c7",
        glow: "rgba(245, 158, 11, 0.36)",
        drop: "#fde68a",
      };
    }
    if (starNeko) {
      return {
        top: dark ? "#c4b5fd" : "#a78bfa",
        mid: dark ? "#8b5cf6" : "#7c3aed",
        bot: dark ? "#3b237a" : "#5b21b6",
        crest: "#ede9fe",
        glow: "rgba(167, 139, 250, 0.42)",
        drop: "#ddd6fe",
      };
    }
    return {
      top: dark ? "#34d399" : "#10b981",
      mid: dark ? "#10b981" : "#059669",
      bot: dark ? "#065f46" : "#047857",
      crest: "#d1fae5",
      glow: "rgba(16, 185, 129, 0.38)",
      drop: "#a7f3d0",
    };
  }

  function drawRoundedRectPath(ctx, x, y, w, ht, rTop, rBot) {
    const rt = Math.min(rTop, w * 0.5, ht * 0.5);
    const rb = Math.min(rBot, w * 0.5, ht * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rt, y);
    ctx.lineTo(x + w - rt, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rt);
    ctx.lineTo(x + w, y + ht - rb);
    ctx.quadraticCurveTo(x + w, y + ht, x + w - rb, y + ht);
    ctx.lineTo(x + rb, y + ht);
    ctx.quadraticCurveTo(x, y + ht, x, y + ht - rb);
    ctx.lineTo(x, y + rt);
    ctx.quadraticCurveTo(x, y, x + rt, y);
    ctx.closePath();
  }

  function render(ctx, width, height, theme) {
    if (!ctx || width <= 0 || height <= 0) return;
    const dark = theme?.dark !== false;
    const starNeko = theme?.themeStyle !== "official";
    const pal = resolvePalette(state.level, theme);

    ctx.clearRect(0, 0, width, height);

    const padX = Math.max(10, width * 0.13);
    const padTop = Math.max(10, height * 0.055);
    const padBot = Math.max(10, height * 0.055);
    const tubeW = Math.max(24, width - padX * 2);
    const tubeH = Math.max(40, height - padTop - padBot);
    const tubeX = (width - tubeW) * 0.5;
    const tubeY = padTop;
    const rTop = Math.min(14, tubeW * 0.24);
    const rBot = Math.min(tubeW * 0.48, 30);

    // 1. Subtle ambient back-glow behind borosilicate vial
    if (state.level > 0.02) {
      ctx.save();
      const glowY = tubeY + tubeH * (1 - state.level * 0.55);
      const rad = ctx.createRadialGradient(
        tubeX + tubeW * 0.5, glowY, tubeW * 0.1,
        tubeX + tubeW * 0.5, glowY, tubeW * 1.05
      );
      rad.addColorStop(0, pal.glow);
      rad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rad;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // 2. Outer borosilicate glass backing
    ctx.save();
    drawRoundedRectPath(ctx, tubeX, tubeY, tubeW, tubeH, rTop, rBot);
    const glassBg = ctx.createLinearGradient(tubeX, tubeY, tubeX + tubeW, tubeY);
    if (dark) {
      glassBg.addColorStop(0, starNeko ? "rgba(196, 178, 255, 0.14)" : "rgba(255, 255, 255, 0.10)");
      glassBg.addColorStop(0.28, starNeko ? "rgba(22, 16, 40, 0.56)" : "rgba(16, 18, 28, 0.52)");
      glassBg.addColorStop(0.78, starNeko ? "rgba(18, 14, 34, 0.64)" : "rgba(14, 16, 24, 0.60)");
      glassBg.addColorStop(1, starNeko ? "rgba(216, 198, 255, 0.16)" : "rgba(255, 255, 255, 0.12)");
    } else {
      glassBg.addColorStop(0, "rgba(255, 255, 255, 0.72)");
      glassBg.addColorStop(0.32, starNeko ? "rgba(237, 231, 254, 0.44)" : "rgba(241, 245, 249, 0.46)");
      glassBg.addColorStop(0.8, starNeko ? "rgba(229, 218, 252, 0.52)" : "rgba(226, 232, 240, 0.50)");
      glassBg.addColorStop(1, "rgba(255, 255, 255, 0.78)");
    }
    ctx.fillStyle = glassBg;
    ctx.fill();
    ctx.restore();

    // 3. Clipped inner fluid cavity
    const wall = 3;
    const inX = tubeX + wall;
    const inY = tubeY + wall;
    const inW = tubeW - wall * 2;
    const inH = tubeH - wall * 2;

    ctx.save();
    drawRoundedRectPath(ctx, inX, inY, inW, inH, Math.max(4, rTop - 2), Math.max(6, rBot - 2));
    ctx.clip();

    const baseLineY = inY + inH * (1 - state.level);
    const waveScale = Math.min(26, inH * 0.14);
    const tiltSlope = Math.tan(state.tiltAngle) * (inW * 0.48);

    function surfaceYAt(i, phaseSign) {
      const u = i / (N - 1);
      const tiltOffset = (u - 0.5) * 2 * tiltSlope;
      const idx = phaseSign < 0 ? (N - 1 - i) : i;
      const amp = phaseSign < 0 ? h[idx] * 0.55 : h[i];
      return baseLineY + tiltOffset - amp * waveScale;
    }

    if (state.level > 0.002) {
      // Back secondary meniscus wave (depth parallax)
      ctx.beginPath();
      ctx.moveTo(inX, inY + inH + 4);
      for (let i = 0; i < N; i++) {
        const px = inX + (i / (N - 1)) * inW;
        const py = surfaceYAt(i, -1) - 1.5;
        if (i === 0) ctx.lineTo(px, py);
        else {
          const prevX = inX + ((i - 1) / (N - 1)) * inW;
          const prevY = surfaceYAt(i - 1, -1) - 1.5;
          ctx.quadraticCurveTo(prevX, prevY, (prevX + px) * 0.5, (prevY + py) * 0.5);
        }
      }
      ctx.lineTo(inX + inW, surfaceYAt(N - 1, -1) - 1.5);
      ctx.lineTo(inX + inW, inY + inH + 4);
      ctx.closePath();
      ctx.fillStyle = pal.top;
      ctx.globalAlpha = dark ? 0.34 : 0.28;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Primary liquid body
      ctx.beginPath();
      ctx.moveTo(inX, inY + inH + 4);
      for (let i = 0; i < N; i++) {
        const px = inX + (i / (N - 1)) * inW;
        const py = surfaceYAt(i, 1);
        if (i === 0) ctx.lineTo(px, py);
        else {
          const prevX = inX + ((i - 1) / (N - 1)) * inW;
          const prevY = surfaceYAt(i - 1, 1);
          ctx.quadraticCurveTo(prevX, prevY, (prevX + px) * 0.5, (prevY + py) * 0.5);
        }
      }
      ctx.lineTo(inX + inW, surfaceYAt(N - 1, 1));
      ctx.lineTo(inX + inW, inY + inH + 4);
      ctx.closePath();

      const liqGrad = ctx.createLinearGradient(inX, Math.max(inY, baseLineY - 10), inX, inY + inH);
      liqGrad.addColorStop(0, pal.top);
      liqGrad.addColorStop(0.42, pal.mid);
      liqGrad.addColorStop(1, pal.bot);
      ctx.fillStyle = liqGrad;
      ctx.fill();

      // Optional highlighted category stratum band inside liquid
      if (state.highlightCategory && Array.isArray(state.categories) && state.categories.length) {
        const activeCats = state.categories.filter((c) => c && c.key !== "free" && (c.tokens || 0) > 0);
        const totalTok = activeCats.reduce((acc, c) => acc + (c.tokens || 0), 0);
        if (totalTok > 0) {
          let cursor = 0;
          const liqHeight = Math.max(1, inH * state.level);
          for (let i = 0; i < activeCats.length; i++) {
            const c = activeCats[i];
            const frac = (c.tokens || 0) / totalTok;
            const bandH = frac * liqHeight;
            const bandTop = inY + inH - (cursor + bandH);
            if (c.key === state.highlightCategory) {
              ctx.save();
              ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
              ctx.fillRect(inX, bandTop, inW, Math.max(3, bandH));
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(inX, bandTop, inW, 1.2);
              ctx.fillRect(inX, bandTop + Math.max(3, bandH) - 1.2, inW, 1.2);
              ctx.restore();
              break;
            }
            cursor += bandH;
          }
        }
      }

      // Luminous crest meniscus highlight
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const px = inX + (i / (N - 1)) * inW;
        const py = surfaceYAt(i, 1);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = pal.crest;
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.85;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Rising stardust micro-bubbles
      for (let i = 0; i < state.bubbles.length; i++) {
        const b = state.bubbles[i];
        const bx = inX + (b.x + Math.sin(b.phase) * b.sway) * inW;
        const by = inY + b.y * inH;
        if (by < baseLineY + 2) continue;
        ctx.beginPath();
        ctx.arc(bx, by, b.r, 0, Math.PI * 2);
        ctx.fillStyle = pal.crest;
        ctx.globalAlpha = b.alpha * (dark ? 0.72 : 0.6);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Falling glowing droplets above meniscus
    for (let i = 0; i < state.droplets.length; i++) {
      const d = state.droplets[i];
      const dx = inX + d.x * inW;
      const dy = inY + d.y * inH;
      ctx.save();
      const tailLen = Math.min(18, 4 + d.vy * 12);
      const trail = ctx.createLinearGradient(dx, dy - tailLen, dx, dy + d.r);
      trail.addColorStop(0, "rgba(255,255,255,0)");
      trail.addColorStop(1, pal.drop);
      ctx.strokeStyle = trail;
      ctx.lineWidth = d.r * 1.1;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(dx, dy - tailLen);
      ctx.lineTo(dx, dy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dx, dy, d.r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
    }

    // Laser-etched graduation tick marks (128k / 256k / 384k for 512K scale, or dynamic quarters)
    const maxTok = state.maxTokens > 0 ? state.maxTokens : 524288;
    const ticks = [0.25, 0.5, 0.75];
    ctx.save();
    ctx.font = "600 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (let i = 0; i < ticks.length; i++) {
      const frac = ticks[i];
      const ty = Math.round(inY + inH * (1 - frac)) + 0.5;
      const tickLabel =
        maxTok === 524288 || maxTok === 512000
          ? (frac === 0.25 ? "128k" : frac === 0.5 ? "256k" : "384k")
          : formatTickLabel(maxTok * frac);
      ctx.strokeStyle = dark ? "rgba(236, 228, 255, 0.32)" : "rgba(45, 36, 78, 0.26)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(inX + inW - 11, ty);
      ctx.lineTo(inX + inW - 2, ty);
      ctx.stroke();
      // Left micro-tick
      ctx.beginPath();
      ctx.moveTo(inX + 2, ty);
      ctx.lineTo(inX + 7, ty);
      ctx.stroke();
      ctx.fillStyle = dark ? "rgba(240, 233, 255, 0.72)" : "rgba(38, 28, 68, 0.68)";
      ctx.fillText(tickLabel, inX + inW - 14, ty);
    }
    ctx.restore();

    // Inner specular glass streak on left & soft rim catchlight on right
    const leftSpec = ctx.createLinearGradient(inX, inY, inX + inW * 0.28, inY);
    leftSpec.addColorStop(0, dark ? "rgba(255, 255, 255, 0.24)" : "rgba(255, 255, 255, 0.62)");
    leftSpec.addColorStop(0.55, dark ? "rgba(255, 255, 255, 0.06)" : "rgba(255, 255, 255, 0.16)");
    leftSpec.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = leftSpec;
    ctx.fillRect(inX + 2, inY + 4, inW * 0.26, inH - 8);

    ctx.restore();

    // 4. Outer glass wall contour & top rim highlight
    ctx.save();
    drawRoundedRectPath(ctx, tubeX + 0.5, tubeY + 0.5, tubeW - 1, tubeH - 1, rTop, rBot);
    ctx.strokeStyle = dark
      ? (starNeko ? "rgba(208, 186, 255, 0.42)" : "rgba(255, 255, 255, 0.28)")
      : (starNeko ? "rgba(139, 92, 246, 0.34)" : "rgba(15, 23, 42, 0.22)");
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // Top borosilicate lip accent
    ctx.beginPath();
    ctx.moveTo(tubeX + rTop * 0.7, tubeY + 1.5);
    ctx.lineTo(tubeX + tubeW - rTop * 0.7, tubeY + 1.5);
    ctx.strokeStyle = dark ? "rgba(255, 255, 255, 0.46)" : "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  return {
    state,
    poke,
    applyDragAccel,
    spawnDroplet,
    spawnBubble,
    setTargetLevel,
    setHighlightCategory,
    wake,
    step,
    render,
    getEnergy: () => state.energy,
    isSleeping: () => state.sleeping,
  };
}

function createVialEngineSource() {
  return createVialEngine.toString();
}

module.exports = {
  createVialEngine,
  createVialEngineSource,
};
