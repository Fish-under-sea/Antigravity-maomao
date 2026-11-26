"use strict";

/**
 * Pure MIT clean-room Composer Working Beam (WebGL2/WebGL1/Canvas2D SDF rounded-rect orbit glow)
 * + Remaining Quota Clockwise Border Halo with automatic cross-fade & strict 0fps idle hibernation.
 *
 * Serialized via installComposerBeam.toString() into Antigravity host over CDP.
 */
function installComposerBeam(config) {
  const KEY = "__agyMaomaoComposerBeam";
  const REV = 3;
  const STYLE_ID = "agy-maomao-composer-beam-style";
  const PAD = 3;
  const CORE_LINE_WIDTH = 1.5;
  const OUTER_HALO_PX = 2.2;

  // Continuous RGB rainbow stops (cyan -> blue -> violet -> magenta -> coral -> gold -> emerald -> cyan)
  const RGB_SPECTRUM_STOPS = [
    [0.08, 0.90, 0.96, 1.0],
    [0.26, 0.56, 1.0, 1.0],
    [0.62, 0.42, 1.0, 1.0],
    [0.95, 0.34, 0.86, 1.0],
    [1.0, 0.42, 0.44, 1.0],
    [0.99, 0.80, 0.24, 1.0],
    [0.20, 0.88, 0.62, 1.0],
  ];

  const VALID_PALETTES = {
    "star-neko": RGB_SPECTRUM_STOPS,
    gemini: [
      [0.26, 0.52, 0.96, 1.0],
      [0.61, 0.45, 0.80, 1.0],
      [0.92, 0.26, 0.21, 1.0],
      [0.98, 0.74, 0.02, 1.0],
      [0.20, 0.66, 0.33, 1.0],
    ],
    aurora: [
      [0.18, 0.90, 0.65, 1.0],
      [0.15, 0.74, 0.97, 1.0],
      [0.39, 0.40, 0.95, 1.0],
      [0.85, 0.27, 0.94, 1.0],
    ],
    prism: RGB_SPECTRUM_STOPS,
    neon: [
      [0.0, 0.85, 1.0, 1.0],
      [0.30, 0.42, 1.0, 1.0],
      [0.84, 0.20, 1.0, 1.0],
      [1.0, 0.20, 0.60, 1.0],
    ],
  };

  const QUOTA_PALETTES = {
    ok: [
      [0.05, 0.62, 0.52, 0.55],
      [0.06, 0.73, 0.51, 1.0],
      [0.20, 0.83, 0.60, 1.0],
      [0.06, 0.73, 0.51, 0.55],
    ],
    warning: [
      [0.85, 0.47, 0.02, 0.55],
      [0.96, 0.62, 0.04, 1.0],
      [0.98, 0.75, 0.14, 1.0],
      [0.96, 0.62, 0.04, 0.55],
    ],
    critical: [
      [0.86, 0.15, 0.15, 0.55],
      [0.94, 0.27, 0.27, 1.0],
      [0.97, 0.44, 0.44, 1.0],
      [0.94, 0.27, 0.27, 0.55],
    ],
  };

  const VERT_SRC = "attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.0,1.0);}";
  const FRAG_SRC = `
precision highp float;
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
uniform vec2 u_res;
uniform float u_dpr;
uniform vec2 u_size;
uniform float u_pad;
uniform float u_radius;
uniform float u_phase;
uniform float u_fade;
uniform float u_dark;
uniform float u_rgb_mode;
uniform vec4 u_colors[8];
uniform int u_count;

float sdRoundedRect(vec2 p, vec2 hs, float r) {
  vec2 q = abs(p) - (hs - r);
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

float perimeterT(vec2 p, vec2 hs, float r) {
  vec2 ih = max(hs - r, vec2(0.0));
  float q = 0.5 * PI * r;
  float L = 4.0 * ih.x + 4.0 * ih.y + 4.0 * q;
  vec2 ap = abs(p);
  float s = 0.0;
  float b1 = ih.y + q + 2.0 * ih.x;
  float b2 = b1 + q;
  float b3 = b2 + 2.0 * ih.y;
  float b4 = b3 + q + 2.0 * ih.x;
  if (ap.x > ih.x && ap.y > ih.y) {
    vec2 v = ap - ih;
    float a = atan(v.y, v.x);
    if (p.x >= 0.0 && p.y >= 0.0) s = ih.y + r * a;
    else if (p.x < 0.0 && p.y >= 0.0) s = b1 + r * (0.5 * PI - a);
    else if (p.x < 0.0) s = b3 + r * a;
    else s = b4 + r * (0.5 * PI - a);
  } else if ((hs.x - ap.x) < (hs.y - ap.y)) {
    s = p.x >= 0.0 ? (p.y >= 0.0 ? p.y : L + p.y) : (b2 + (ih.y - p.y));
  } else {
    s = p.y >= 0.0 ? (ih.y + q + (ih.x - p.x)) : (b3 + q + (p.x + ih.x));
  }
  return fract(s / max(L, 0.001));
}

vec4 pickColor(int i) {
  if (i <= 0) return u_colors[0];
  if (i == 1) return u_colors[1];
  if (i == 2) return u_colors[2];
  if (i == 3) return u_colors[3];
  if (i == 4) return u_colors[4];
  if (i == 5) return u_colors[5];
  if (i == 6) return u_colors[6];
  return u_colors[7];
}

vec4 sampleGrad(float t) {
  if (u_count <= 1) return u_colors[0];
  float x = fract(t) * float(u_count - 1);
  int idx = int(floor(x));
  if (idx > u_count - 2) idx = u_count - 2;
  return mix(pickColor(idx), pickColor(idx + 1), x - float(idx));
}

vec3 rgbSpectrum(float t, float darkMode) {
  // Smooth continuous full-hue RGB cycle; richer high-contrast saturation on light/white surfaces
  vec3 shift = vec3(0.0, 0.333333, 0.666667);
  vec3 darkRgb = clamp(0.55 + 0.45 * cos(TAU * (fract(t) + shift)), 0.0, 1.0);
  vec3 lightRgb = clamp(0.43 + 0.48 * cos(TAU * (fract(t) + shift)), 0.0, 1.0);
  return mix(lightRgb, darkRgb, darkMode);
}

void main() {
  if (u_fade <= 0.001) { gl_FragColor = vec4(0.0); return; }
  vec2 pos = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_dpr;
  vec2 hs = u_size * 0.5;
  float r = min(u_radius, min(hs.x, hs.y));
  vec2 p = pos - (vec2(u_pad) + hs);
  float sd = sdRoundedRect(p, hs, r);
  // Strict tight border band (abs(sd) <= 3.0): zero inner bleed into composer text area!
  if (abs(sd) > 3.0 || sd > 2.6 || sd < -2.2) { gl_FragColor = vec4(0.0); return; }

  float pt = perimeterT(p, hs, r);
  float huePhase = fract(pt - u_phase);

  // Crisp ~1.5px core hairline hugging the exact rounded border (sdBorder = 0 on outer 1px border)
  float sdBorder = sd + 0.45;
  float core = 1.0 - smoothstep(0.42, 0.88, abs(sdBorder));
  // Restrained <=2.2px outer micro-halo only (no muddy cloud!)
  float outerHalo = mix(0.28, 0.34, u_dark) * exp(-max(0.0, sdBorder) / 1.05) * (1.0 - smoothstep(0.0, 2.2, max(0.0, sdBorder)));
  float innerAA = 0.10 * exp(-max(0.0, -sdBorder) / 0.55) * (1.0 - smoothstep(0.0, 1.2, max(0.0, -sdBorder)));

  // Continuous traveling RGB rim + smooth orbiting bright specular highlight crest
  float crest1 = pow(0.5 + 0.5 * cos(TAU * (pt - u_phase)), 2.2);
  float crest2 = 0.35 * pow(0.5 + 0.5 * cos(TAU * (pt - u_phase + 0.5)), 2.6);
  float wave = clamp(mix(0.52, 0.42, u_dark) + mix(0.48, 0.58, u_dark) * crest1 + 0.20 * crest2, 0.0, 1.0);

  vec3 spectrumRgb = rgbSpectrum(huePhase, u_dark);
  vec4 palColor = sampleGrad(huePhase);
  vec3 rgb = mix(palColor.rgb, spectrumRgb, u_rgb_mode);
  // Subtle crisp white highlight on dark mode crest; preserve deep jewel saturation on light surfaces
  rgb = mix(rgb, vec3(1.0), 0.16 * u_dark * core * crest1);

  float energy = core * mix(1.22, 1.08, u_dark) + outerHalo + innerAA;
  float alpha = clamp(energy * wave * mix(palColor.a, 1.0, u_rgb_mode) * u_fade, 0.0, 1.0);
  if (alpha <= 0.001) { gl_FragColor = vec4(0.0); return; }
  gl_FragColor = vec4(rgb * alpha, alpha);
}
`;

  function normalizeConfig(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const sub = src.composerBeam && typeof src.composerBeam === "object" ? src.composerBeam : src;
    const rawPalette = String(sub.palette || "star-neko");
    const palette = rawPalette === "quota" || VALID_PALETTES[rawPalette] ? rawPalette : "star-neko";
    return {
      owner: typeof src.owner === "string" && src.owner ? src.owner : "antigravity-star-suite",
      enabled: Boolean(sub.enabled),
      palette,
      quotaHalo: Boolean(sub.quotaHalo),
      quotaWindow: sub.quotaWindow === "5h" || sub.quotaWindow === "weekly" ? sub.quotaWindow : "auto",
      preview: Boolean(sub.preview),
      sidecarBaseUrl: typeof src.sidecarBaseUrl === "string" ? src.sidecarBaseUrl.replace(/\/+$/, "") : "",
      sidecarToken: typeof src.sidecarToken === "string" ? src.sidecarToken : "",
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

  let active = true;
  let manualWorking = null; // null = auto detect from DOM, boolean = manual override
  let quotaState = null; // { fraction: 0..1, window: '5h'|'weekly', tone: 'ok'|'warning'|'critical' }
  let observer = null;
  let themeAttrObs = null;
  let scanTimer = 0;
  let quotaTimer = 0;
  const instances = new Map(); // cardEl -> cardInstance
  const winListeners = [];

  function addListener(target, type, fn, opts) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, fn, opts);
    winListeners.push([target, type, fn, opts]);
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

  function ensureStyle() {
    const head = document.head || document.documentElement;
    if (!head) return;
    let style = document.getElementById?.(STYLE_ID) || head.querySelector?.("#" + STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      head.appendChild(style);
    }
    style.textContent = `
.maomao-beam-root {
  position: absolute;
  pointer-events: none;
  z-index: 4;
  border-radius: inherit;
  box-sizing: border-box;
}
.maomao-beam-canvas {
  position: absolute;
  inset: -${PAD}px;
  width: calc(100% + ${PAD * 2}px);
  height: calc(100% + ${PAD * 2}px);
  display: block;
  pointer-events: none;
}
.maomao-quota-halo-svg {
  position: absolute;
  inset: -5px;
  width: calc(100% + 10px);
  height: calc(100% + 10px);
  overflow: visible;
  pointer-events: none;
  transition: opacity 320ms cubic-bezier(0.22, 1, 0.36, 1);
}
.maomao-quota-halo-svg[data-dimmed="true"] {
  opacity: 0;
}
.maomao-quota-halo-glow {
  opacity: 0.28;
  filter: blur(2.6px);
  transition: stroke-dasharray 440ms cubic-bezier(0.22, 1, 0.36, 1), stroke-dashoffset 440ms cubic-bezier(0.22, 1, 0.36, 1);
}
.maomao-quota-halo-stroke {
  opacity: 0.88;
  transition: stroke-dasharray 440ms cubic-bezier(0.22, 1, 0.36, 1), stroke-dashoffset 440ms cubic-bezier(0.22, 1, 0.36, 1);
}
`;
  }

  function detectWorking(card) {
    if (cfg.preview) return true;
    if (typeof manualWorking === "boolean") return manualWorking;
    try {
      const scope = card?.closest?.(".surface-composer") || card || document;
      const stopBtn = scope.querySelector?.(
        'button[data-testid*="stop"], button[data-testid*="cancel"], button[aria-label*="Stop"], button[aria-label*="Cancel"], button[aria-label*="停止"], [data-status="running"]'
      );
      if (stopBtn && !stopBtn.disabled && stopBtn.getAttribute?.("aria-hidden") !== "true") {
        return true;
      }
      const telState = window.__agyMaomaoTelemetryBar?.getState?.();
      if (telState && telState.working === true) return true;
    } catch {}
    return false;
  }

  function normalizeFraction(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n > 0 && n < 1) return Math.max(0, Math.min(1, n));
    return Math.max(0, Math.min(1, n / 100));
  }

  function resolveQuotaFromGroups(groups, modelLabel) {
    if (!Array.isArray(groups) || !groups.length) return null;
    const label = String(modelLabel || "").toLowerCase();
    let matched = null;
    if (/claude|gpt/.test(label)) {
      matched = groups.find((g) => /claude|gpt/i.test((g.id || "") + " " + (g.name || "")));
    } else if (/flash/.test(label)) {
      matched = groups.find((g) => /flash/i.test((g.id || "") + " " + (g.name || "")));
    } else if (/gemini|pro|neon|carbon|hydrogen|orchestrator/.test(label)) {
      matched = groups.find((g) => /gemini/i.test((g.id || "") + " " + (g.name || "")));
    }
    if (!matched) matched = groups[0];
    if (!matched || !matched.windows) return null;
    const w5 = matched.windows["5h"] ? normalizeFraction(matched.windows["5h"].remaining) : null;
    const ww = matched.windows.weekly ? normalizeFraction(matched.windows.weekly.remaining) : null;
    let chosen = null;
    let win = "5h";
    if (cfg.quotaWindow === "5h") {
      chosen = w5 ?? ww;
      win = w5 != null ? "5h" : "weekly";
    } else if (cfg.quotaWindow === "weekly") {
      chosen = ww ?? w5;
      win = ww != null ? "weekly" : "5h";
    } else if (w5 != null && ww != null) {
      if (ww < w5) {
        chosen = ww;
        win = "weekly";
      } else {
        chosen = w5;
        win = "5h";
      }
    } else if (w5 != null) {
      chosen = w5;
      win = "5h";
    } else if (ww != null) {
      chosen = ww;
      win = "weekly";
    }
    if (chosen == null) return null;
    const pct = chosen * 100;
    const tone = pct < 20 ? "critical" : pct < 50 ? "warning" : "ok";
    return { fraction: chosen, percent: pct, window: win, tone, groupName: matched.name || "" };
  }

  function currentQuotaInfo(card) {
    if (quotaState && Number.isFinite(quotaState.fraction)) return quotaState;
    try {
      const tel = window.__agyMaomaoTelemetryBar?.getState?.();
      const groups = tel?.data?.quota?.groups || tel?.quota?.groups;
      if (Array.isArray(groups) && groups.length) {
        const modelText = card?.querySelector?.('[data-testid="model-selector-trigger"]')?.textContent || tel?.data?.model || "";
        return resolveQuotaFromGroups(groups, modelText);
      }
    } catch {}
    return null;
  }

  function resolvePaletteColors(paletteKey, quotaTone) {
    if (paletteKey === "quota") {
      return QUOTA_PALETTES[quotaTone] || QUOTA_PALETTES.ok;
    }
    return VALID_PALETTES[paletteKey] || VALID_PALETTES["star-neko"];
  }

  function initWebGl(canvas) {
    if (!canvas || typeof canvas.getContext !== "function") return null;
    let gl = null;
    try {
      const ctxOpts = {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      };
      gl = canvas.getContext("webgl2", ctxOpts) || canvas.getContext("webgl", ctxOpts);
    } catch {
      return null;
    }
    if (!gl || typeof gl.createShader !== "function") return null;

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }

    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      return null;
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(prog);

    return {
      gl,
      prog,
      buf,
      loc: {
        res: gl.getUniformLocation(prog, "u_res"),
        dpr: gl.getUniformLocation(prog, "u_dpr"),
        size: gl.getUniformLocation(prog, "u_size"),
        pad: gl.getUniformLocation(prog, "u_pad"),
        radius: gl.getUniformLocation(prog, "u_radius"),
        phase: gl.getUniformLocation(prog, "u_phase"),
        fade: gl.getUniformLocation(prog, "u_fade"),
        dark: gl.getUniformLocation(prog, "u_dark"),
        rgbMode: gl.getUniformLocation(prog, "u_rgb_mode"),
        colors: gl.getUniformLocation(prog, "u_colors[0]"),
        count: gl.getUniformLocation(prog, "u_count"),
      },
    };
  }

  function roundedRectPathD(w, h, r, pad) {
    const inset = 0.5;
    const rad = Math.max(4, Math.min(r, (w - inset * 2) / 2, (h - inset * 2) / 2));
    const left = pad + inset;
    const top = pad + inset;
    const right = pad + w - inset;
    const bottom = pad + h - inset;
    return (
      `M ${left + rad} ${top} H ${right - rad} A ${rad} ${rad} 0 0 1 ${right} ${top + rad} ` +
      `V ${bottom - rad} A ${rad} ${rad} 0 0 1 ${right - rad} ${bottom} ` +
      `H ${left + rad} A ${rad} ${rad} 0 0 1 ${left} ${bottom - rad} ` +
      `V ${top + rad} A ${rad} ${rad} 0 0 1 ${left + rad} ${top}`
    );
  }

  function sampleRgbSpectrumCss(t, alpha, dark) {
    const tau = Math.PI * 2;
    const f = ((t % 1) + 1) % 1;
    const base = dark ? 0.55 : 0.43;
    const amp = dark ? 0.45 : 0.48;
    const r = Math.round(Math.max(0, Math.min(1, base + amp * Math.cos(tau * f))) * 255);
    const g = Math.round(Math.max(0, Math.min(1, base + amp * Math.cos(tau * (f + 0.333333)))) * 255);
    const b = Math.round(Math.max(0, Math.min(1, base + amp * Math.cos(tau * (f + 0.666667)))) * 255);
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  }

  function pointOnRoundedRect(s, w, h, r, ox, oy) {
    const ihx = Math.max(0, w - 2 * r);
    const ihy = Math.max(0, h - 2 * r);
    const q = Math.PI * r * 0.5;
    const L = 2 * ihx + 2 * ihy + 4 * q;
    let d = ((s % L) + L) % L;
    if (d < ihx) return [ox + r + d, oy];
    d -= ihx;
    if (d < q) {
      const a = -Math.PI * 0.5 + d / Math.max(r, 0.001);
      return [ox + w - r + Math.cos(a) * r, oy + r + Math.sin(a) * r];
    }
    d -= q;
    if (d < ihy) return [ox + w, oy + r + d];
    d -= ihy;
    if (d < q) {
      const a = d / Math.max(r, 0.001);
      return [ox + w - r + Math.cos(a) * r, oy + h - r + Math.sin(a) * r];
    }
    d -= q;
    if (d < ihx) return [ox + w - r - d, oy + h];
    d -= ihx;
    if (d < q) {
      const a = Math.PI * 0.5 + d / Math.max(r, 0.001);
      return [ox + r + Math.cos(a) * r, oy + h - r + Math.sin(a) * r];
    }
    d -= q;
    if (d < ihy) return [ox, oy + h - r - d];
    d -= ihy;
    const a = Math.PI + d / Math.max(r, 0.001);
    return [ox + r + Math.cos(a) * r, oy + r + Math.sin(a) * r];
  }

  function drawCanvas2dBeam(ctx, box, phase, fade, colors, rgbMode, dark) {
    const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    const cssW = box.w + PAD * 2;
    const cssH = box.h + PAD * 2;
    ctx.save();
    ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (fade <= 0.001) {
      ctx.restore();
      return;
    }
    const inset = 0.5;
    const x = PAD + inset;
    const y = PAD + inset;
    const w = Math.max(2, box.w - inset * 2);
    const h = Math.max(2, box.h - inset * 2);
    const r = Math.max(4, Math.min(box.r - inset, w * 0.5, h * 0.5));
    const perimeter = 2 * Math.max(0, w - 2 * r) + 2 * Math.max(0, h - 2 * r) + 2 * Math.PI * r;
    const segs = 48;
    ctx.lineWidth = CORE_LINE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = OUTER_HALO_PX;

    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1.08) / segs;
      const p0 = pointOnRoundedRect(t0 * perimeter, w, h, r, x, y);
      const p1 = pointOnRoundedRect(t1 * perimeter, w, h, r, x, y);
      const crest = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * (t0 - phase)), 2.0);
      const alpha = Math.min(1, ((dark ? 0.42 : 0.54) + (dark ? 0.58 : 0.46) * crest) * fade);
      let strokeCss;
      if (rgbMode >= 0.5) {
        strokeCss = sampleRgbSpectrumCss(t0 - phase, alpha, dark);
      } else {
        const idx = Math.floor((((t0 - phase) % 1) + 1) % 1 * colors.length) % colors.length;
        const c = colors[idx];
        strokeCss = `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${((c[3] ?? 1) * alpha).toFixed(3)})`;
      }
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.strokeStyle = strokeCss;
      ctx.shadowColor = strokeCss;
      ctx.stroke();
    }
    ctx.restore();
  }

  let gradSeq = 0;

  function createCardInstance(card) {
    // Prefer mounting on .surface-composer (overflow: visible in Dream Skin) so outer glow never clips!
    const wrapper = card.parentElement && card.parentElement.matches?.(".surface-composer") ? card.parentElement : null;
    const hostParent = wrapper || card;
    let savedPosition = null;
    try {
      const cs = typeof getComputedStyle === "function" ? getComputedStyle(hostParent) : null;
      if (cs && cs.position === "static") {
        savedPosition = hostParent.style.position || "";
        hostParent.style.position = "relative";
      }
    } catch {}

    const root = document.createElement("div");
    root.className = "maomao-beam-root";
    root.setAttribute("data-maomao-composer-beam", "1");
    root.setAttribute("aria-hidden", "true");

    const canvas = document.createElement("canvas");
    canvas.className = "maomao-beam-canvas";
    canvas.setAttribute("data-testid", "maomao-composer-working-beam");
    root.append(canvas);

    const svgNS = "http://www.w3.org/2000/svg";
    const createSvg = (tag) =>
      typeof document.createElementNS === "function" ? document.createElementNS(svgNS, tag) : document.createElement(tag);

    const haloSvg = createSvg("svg");
    haloSvg.setAttribute("class", "maomao-quota-halo-svg");
    haloSvg.setAttribute("data-testid", "maomao-composer-quota-halo");
    haloSvg.setAttribute("fill", "none");
    haloSvg.setAttribute("aria-hidden", "true");
    haloSvg.style.display = "none";

    const gradId = "maomao-quota-grad-" + (++gradSeq);
    const defs = createSvg("defs");
    const linGrad = createSvg("linearGradient");
    linGrad.setAttribute("id", gradId);
    linGrad.setAttribute("x1", "0%");
    linGrad.setAttribute("y1", "0%");
    linGrad.setAttribute("x2", "100%");
    linGrad.setAttribute("y2", "100%");
    const stop0 = createSvg("stop");
    stop0.setAttribute("offset", "0%");
    const stop1 = createSvg("stop");
    stop1.setAttribute("offset", "55%");
    const stop2 = createSvg("stop");
    stop2.setAttribute("offset", "100%");
    linGrad.append(stop0, stop1, stop2);
    defs.append(linGrad);

    const glowPath = createSvg("path");
    glowPath.setAttribute("class", "maomao-quota-halo-glow");
    glowPath.setAttribute("pathLength", "100");
    glowPath.setAttribute("stroke", `url(#${gradId})`);
    glowPath.setAttribute("stroke-width", "4.2");
    glowPath.setAttribute("stroke-linecap", "round");

    const strokePath = createSvg("path");
    strokePath.setAttribute("class", "maomao-quota-halo-stroke");
    strokePath.setAttribute("pathLength", "100");
    strokePath.setAttribute("stroke", `url(#${gradId})`);
    strokePath.setAttribute("stroke-width", "1.7");
    strokePath.setAttribute("stroke-linecap", "round");

    haloSvg.append(defs, glowPath, strokePath);
    root.append(haloSvg);
    hostParent.append(root);

    const inst = {
      card,
      hostParent,
      wrapper,
      savedPosition,
      root,
      canvas,
      haloSvg,
      stop0,
      stop1,
      stop2,
      glowPath,
      strokePath,
      box: { w: 0, h: 0, r: 19 },
      phase: 0.25,
      fade: 0,
      raf: 0,
      lastTs: 0,
      glState: null,
      glTried: false,
      ctx2d: null,
      ro: null,
      working: false,
    };

    function syncGeometry() {
      // Adhere directly to outer .surface-composer border contour when present (p-px outer border), else card
      const target = wrapper || card;
      const rect = target.getBoundingClientRect?.();
      if (!rect || rect.width < 20 || rect.height < 20) return false;
      let radius = 20;
      try {
        const cs = typeof getComputedStyle === "function" ? getComputedStyle(target) : null;
        const rawR = cs?.borderTopLeftRadius || cs?.borderRadius || "";
        const parsed = parseFloat(rawR);
        if (Number.isFinite(parsed) && parsed > 0) radius = parsed;
      } catch {}
      radius = Math.max(4, Math.min(radius, rect.width * 0.5, rect.height * 0.5));
      inst.box = { w: rect.width, h: rect.height, r: radius };
      root.style.inset = "0";
      root.style.left = "0px";
      root.style.top = "0px";
      root.style.width = rect.width + "px";
      root.style.height = rect.height + "px";
      return true;
    }

    function syncQuotaHalo(beamActive) {
      const q = cfg.quotaHalo ? currentQuotaInfo(card) : null;
      if (!cfg.quotaHalo || !q || inst.box.w < 20 || inst.box.h < 20) {
        haloSvg.style.display = "none";
        return;
      }
      const pad = 5;
      const pct = Math.max(0, Math.min(100, q.fraction * 100));
      const full = pct >= 99.8;
      const empty = pct <= 0.4;
      const basePath = roundedRectPathD(inst.box.w, inst.box.h, inst.box.r, pad);
      const d = full || empty ? basePath + " Z" : basePath;
      const stops =
        q.tone === "critical"
          ? ["#DC2626", "#EF4444", "#F87171"]
          : q.tone === "warning"
            ? ["#D97706", "#F59E0B", "#FBBF24"]
            : ["#0D9488", "#10B981", "#34D399"];

      stop0.setAttribute("stop-color", stops[0]);
      stop1.setAttribute("stop-color", stops[1]);
      stop2.setAttribute("stop-color", stops[2]);
      haloSvg.setAttribute("viewBox", `0 0 ${(inst.box.w + pad * 2).toFixed(1)} ${(inst.box.h + pad * 2).toFixed(1)}`);
      haloSvg.setAttribute("data-tone", q.tone);
      haloSvg.setAttribute("data-window", q.window || "5h");
      haloSvg.setAttribute("data-percent", String(Math.round(pct)));
      // Smooth cross-fade: dim quota halo while rotating working beam is active
      if (beamActive) haloSvg.setAttribute("data-dimmed", "true");
      else haloSvg.removeAttribute("data-dimmed");

      glowPath.setAttribute("d", d);
      strokePath.setAttribute("d", d);
      if (full) {
        glowPath.removeAttribute("stroke-dasharray");
        glowPath.removeAttribute("stroke-dashoffset");
        strokePath.removeAttribute("stroke-dasharray");
        strokePath.removeAttribute("stroke-dashoffset");
      } else if (empty) {
        glowPath.style.display = "none";
        strokePath.setAttribute("stroke-dasharray", "4 4");
        strokePath.removeAttribute("stroke-dashoffset");
      } else {
        glowPath.style.display = "";
        const dash = `${pct.toFixed(2)} 100`;
        glowPath.setAttribute("stroke-dasharray", dash);
        glowPath.setAttribute("stroke-dashoffset", "0");
        strokePath.setAttribute("stroke-dasharray", dash);
        strokePath.setAttribute("stroke-dashoffset", "0");
      }
      haloSvg.style.display = "";
    }

    function stopRaf() {
      if (inst.raf) {
        try {
          cancelAnimationFrame(inst.raf);
        } catch {}
        inst.raf = 0;
      }
      inst.lastTs = 0;
    }

    function clearCanvas() {
      if (inst.glState) {
        try {
          const gl = inst.glState.gl;
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        } catch {}
      } else if (inst.ctx2d) {
        try {
          inst.ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        } catch {}
      }
    }

    function drawFrame(now) {
      inst.raf = 0;
      if (!active || !card.isConnected || document.hidden) {
        inst.lastTs = 0;
        return;
      }
      const ts = typeof now === "number" ? now : Date.now();
      const dt = inst.lastTs ? Math.min(0.05, Math.max(0.001, (ts - inst.lastTs) / 1000)) : 0.016;
      inst.lastTs = ts;

      const wantBeam = cfg.enabled && inst.working;
      if (wantBeam) inst.fade = Math.min(1, inst.fade + dt / 0.42);
      else inst.fade = Math.max(0, inst.fade - dt / 0.48);

      const reduced = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
      // Smoothly accelerate orbit speed while actively thinking/running
      const cycleSeconds = inst.working && !cfg.preview ? 2.15 : 3.0;
      if (!reduced) inst.phase = (inst.phase + dt / cycleSeconds) % 1;

      const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
      const pxW = Math.max(1, Math.round((inst.box.w + PAD * 2) * dpr));
      const pxH = Math.max(1, Math.round((inst.box.h + PAD * 2) * dpr));
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }

      if (inst.fade <= 0.001) {
        clearCanvas();
        canvas.setAttribute("data-active", "false");
        inst.lastTs = 0;
        return; // 0fps idle hibernation!
      }

      canvas.setAttribute("data-active", "true");
      canvas.setAttribute("data-palette", cfg.palette);

      if (!inst.glTried) {
        inst.glTried = true;
        inst.glState = initWebGl(canvas);
        if (!inst.glState && typeof canvas.getContext === "function") {
          inst.ctx2d = canvas.getContext("2d");
        }
      }

      const q = currentQuotaInfo(card);
      const colors = resolvePaletteColors(cfg.palette, q?.tone || "ok");
      // Default star-neko / prism run pure continuous RGB rainbow spectrum; quota respects remaining quota tone
      const rgbMode = cfg.palette === "quota" ? 0.0 : cfg.palette === "star-neko" || cfg.palette === "prism" ? 1.0 : 0.72;
      const easedFade = inst.fade * inst.fade * (3 - 2 * inst.fade);

      if (inst.glState) {
        const { gl, prog, loc } = inst.glState;
        gl.viewport(0, 0, pxW, pxH);
        gl.useProgram(prog);
        const flat = new Float32Array(32);
        const count = Math.min(8, colors.length);
        for (let i = 0; i < count; i++) {
          flat[i * 4] = colors[i][0];
          flat[i * 4 + 1] = colors[i][1];
          flat[i * 4 + 2] = colors[i][2];
          flat[i * 4 + 3] = colors[i][3] ?? 1;
        }
        gl.uniform2f(loc.res, pxW, pxH);
        gl.uniform1f(loc.dpr, dpr);
        gl.uniform2f(loc.size, inst.box.w, inst.box.h);
        gl.uniform1f(loc.pad, PAD);
        gl.uniform1f(loc.radius, Math.max(4, Math.min(inst.box.r, inst.box.w * 0.5, inst.box.h * 0.5)));
        gl.uniform1f(loc.phase, inst.phase);
        gl.uniform1f(loc.fade, easedFade);
        gl.uniform1f(loc.dark, isDark() ? 1.0 : 0.0);
        if (loc.rgbMode) gl.uniform1f(loc.rgbMode, rgbMode);
        gl.uniform4fv(loc.colors, flat);
        gl.uniform1i(loc.count, count);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else if (inst.ctx2d) {
        drawCanvas2dBeam(inst.ctx2d, inst.box, inst.phase, easedFade, colors, rgbMode, isDark());
      }

      const keepRunning = wantBeam ? (!reduced || inst.fade < 1) : inst.fade > 0.001;
      if (keepRunning && typeof requestAnimationFrame === "function") {
        inst.raf = requestAnimationFrame(drawFrame);
      } else {
        inst.lastTs = 0;
      }
    }

    function sync() {
      if (!syncGeometry()) return;
      inst.working = detectWorking(card);
      const beamActive = Boolean(cfg.enabled && inst.working);
      canvas.setAttribute("data-palette", cfg.palette);
      canvas.setAttribute("data-active", beamActive ? "true" : "false");
      syncQuotaHalo(beamActive);

      if (beamActive || inst.fade > 0.001) {
        if (!inst.raf && !document.hidden && typeof requestAnimationFrame === "function") {
          inst.lastTs = 0;
          inst.raf = requestAnimationFrame(drawFrame);
        }
      } else {
        stopRaf();
        clearCanvas();
      }
    }

    if (typeof ResizeObserver === "function") {
      inst.ro = new ResizeObserver(sync);
      try {
        inst.ro.observe(wrapper || card);
        if (wrapper) inst.ro.observe(card);
      } catch {}
    }

    inst.sync = sync;
    inst.stopRaf = stopRaf;
    inst.destroy = () => {
      stopRaf();
      if (inst.ro) {
        try {
          inst.ro.disconnect();
        } catch {}
        inst.ro = null;
      }
      if (inst.glState) {
        try {
          const { gl, prog, buf } = inst.glState;
          gl.deleteBuffer(buf);
          gl.deleteProgram(prog);
          gl.getExtension?.("WEBGL_lose_context")?.loseContext?.();
        } catch {}
        inst.glState = null;
      }
      inst.ctx2d = null;
      root.remove();
      if (savedPosition !== null) {
        try {
          hostParent.style.position = savedPosition;
        } catch {}
      }
    };

    sync();
    return inst;
  }

  function unmountAll() {
    for (const [card, inst] of instances.entries()) {
      try {
        inst.destroy();
      } catch {}
      instances.delete(card);
    }
  }

  function scanCards() {
    if (!active) return;
    if (!cfg.enabled && !cfg.quotaHalo) {
      unmountAll();
      return;
    }
    ensureStyle();
    for (const [card, inst] of instances.entries()) {
      if (!card.isConnected) {
        try {
          inst.destroy();
        } catch {}
        instances.delete(card);
      }
    }
    const cards = document.querySelectorAll?.(".surface-composer-card");
    if (!cards || !cards.length) return;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!card) continue;
      let inst = instances.get(card);
      if (!inst) {
        inst = createCardInstance(card);
        instances.set(card, inst);
      } else {
        inst.sync();
      }
    }
  }

  const EDITABLE_SKIP_SELECTOR =
    '[data-lexical-editor="true"], [contenteditable="true"], textarea, input, [data-maomao-composer-beam]';

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
      scanCards();
    }, 80);
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

  async function pollQuotaFallback() {
    if (!active || document.hidden || (!cfg.quotaHalo && cfg.palette !== "quota")) return;
    if (window.__agyMaomaoTelemetryBar?.getState?.()?.data?.quota?.groups?.length) return;
    if (!cfg.sidecarBaseUrl || typeof fetch !== "function") return;
    try {
      const url = `${cfg.sidecarBaseUrl}/api/maomao/telemetry?token=${encodeURIComponent(cfg.sidecarToken)}`;
      const res = await fetch(url);
      if (!res || !res.ok) return;
      const data = await res.json();
      const groups = data?.quota?.groups || data?.groups;
      if (Array.isArray(groups) && groups.length) {
        const resolved = resolveQuotaFromGroups(groups, data?.model || "");
        if (resolved) {
          quotaState = resolved;
          scanCards();
        }
      }
    } catch {}
  }

  function syncQuotaTimer() {
    if (quotaTimer) {
      clearInterval(quotaTimer);
      quotaTimer = 0;
    }
    if (!active || (!cfg.quotaHalo && cfg.palette !== "quota")) return;
    pollQuotaFallback();
    quotaTimer = setInterval(pollQuotaFallback, 15000);
  }

  if (typeof MutationObserver === "function") {
    observer = new MutationObserver(onMutations);
    try {
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "data-status", "aria-label"] });
    } catch {}
    themeAttrObs = new MutationObserver(() => {
      if (!active || (!cfg.enabled && !cfg.quotaHalo)) return;
      scanCards();
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

  addListener(document, "visibilitychange", () => {
    if (document.hidden) {
      for (const inst of instances.values()) inst.stopRaf();
    } else {
      scanCards();
    }
  });

  function update(nextConfig) {
    cfg = normalizeConfig(nextConfig);
    if (!cfg.enabled && !cfg.quotaHalo) {
      unmountAll();
      if (quotaTimer) {
        clearInterval(quotaTimer);
        quotaTimer = 0;
      }
      const style = document.getElementById?.(STYLE_ID);
      if (style) style.remove();
      return status();
    }
    ensureStyle();
    scanCards();
    syncQuotaTimer();
    return status();
  }

  function setWorking(flag) {
    manualWorking = typeof flag === "boolean" ? flag : null;
    scanCards();
    return status();
  }

  function setQuota(info) {
    if (!info) {
      quotaState = null;
    } else if (Array.isArray(info.groups)) {
      quotaState = resolveQuotaFromGroups(info.groups, info.model || "");
    } else {
      const frac = normalizeFraction(info.fraction ?? info.remaining ?? info.percent);
      if (frac != null) {
        const pct = frac * 100;
        quotaState = {
          fraction: frac,
          percent: pct,
          window: info.window || "5h",
          tone: pct < 20 ? "critical" : pct < 50 ? "warning" : "ok",
        };
      }
    }
    scanCards();
    return status();
  }

  function destroy() {
    active = false;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = 0;
    }
    if (quotaTimer) {
      clearInterval(quotaTimer);
      quotaTimer = 0;
    }
    if (observer) {
      try {
        observer.disconnect();
      } catch {}
      observer = null;
    }
    if (themeAttrObs) {
      try {
        themeAttrObs.disconnect();
      } catch {}
      themeAttrObs = null;
    }
    for (let i = 0; i < winListeners.length; i++) {
      const [target, type, fn, opts] = winListeners[i];
      try {
        target.removeEventListener(type, fn, opts);
      } catch {}
    }
    winListeners.length = 0;
    unmountAll();
    const style = document.getElementById?.(STYLE_ID);
    if (style) style.remove();
    delete window[KEY];
    return { removed: true };
  }

  function status() {
    let activeRafs = 0;
    let workingAny = false;
    for (const inst of instances.values()) {
      if (inst.raf) activeRafs++;
      if (inst.working) workingAny = true;
    }
    return {
      applied: active,
      rev: REV,
      owner: cfg.owner,
      enabled: cfg.enabled,
      palette: cfg.palette,
      quotaHalo: cfg.quotaHalo,
      mountedCards: instances.size,
      working: workingAny,
      activeRafs,
      coreLineWidth: CORE_LINE_WIDTH,
      outerHaloPx: OUTER_HALO_PX,
      rgbSpectrum: cfg.palette !== "quota",
      surfaceMode: detectSurfaceMode(),
      palettes: [...Object.keys(VALID_PALETTES), "quota"],
    };
  }

  if (cfg.enabled || cfg.quotaHalo) {
    ensureStyle();
    scanCards();
    syncQuotaTimer();
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
    setWorking,
    setQuota,
    rescan: scanCards,
  };
  window[KEY] = handle;
  return status();
}

module.exports = {
  COMPOSER_BEAM_REV: 3,
  installComposerBeam,
};
