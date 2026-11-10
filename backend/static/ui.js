"use strict";

/* Visual helpers: avatar, waveform, score rings, charts, confetti and voice measurements. */
const UI = (() => {
  const CYAN = "#22e6ff", VIOLET = "#a78bfa", TEAL = "#00f0c0", AMBER = "#ffb547", ROSE = "#ff5c7c";
  const GRID = "rgba(255,255,255,.08)", TEXT = "#8ea3ae";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s) => document.querySelector(s);
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  /* ------------------------------------------------------------ avatar that talks with the audio */
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null, talkAnalyser = null, talkFrame = 0, talkSource = null, talkAudio = null;
  const STATUS = { idle: "READY", speaking: "SPEAKING", listening: "LISTENING", thinking: "THINKING" };

  function unlockAudio() {
    if (!AudioCtx) return;
    if (!audioCtx) {
      audioCtx = new AudioCtx();
      talkAnalyser = audioCtx.createAnalyser();
      talkAnalyser.fftSize = 256;
      talkAnalyser.smoothingTimeConstant = 0.55;
      talkAnalyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  }
  document.addEventListener("pointerdown", unlockAudio, true);
  document.addEventListener("keydown", unlockAudio, true);

  function setMouth(level) {
    const mouth = $("#mouth");
    const height = 6 + level * 30;
    mouth.setAttribute("height", height.toFixed(1));
    mouth.setAttribute("y", (133 - height / 2).toFixed(1));
    mouth.setAttribute("x", (74 + level * 8).toFixed(1));
    mouth.setAttribute("width", (52 - level * 16).toFixed(1));
    document.body.style.setProperty("--talk", level.toFixed(2));
  }

  function mode(name) {
    document.body.dataset.avatar = name;
    $("#avatar-status").textContent = STATUS[name];
  }

  function stopTalking(fromMode) {
    cancelAnimationFrame(talkFrame);
    setMouth(0);
    if (!fromMode || document.body.dataset.avatar === "speaking") mode("idle");
  }

  // Connects an <audio> element to the avatar. If the browser's audio engine is not unlocked yet,
  // the sound plays normally and the mouth moves on a simple rhythm instead.
  function speak(audio) {
    let useAnalyser = false;
    if (talkSource) { talkSource.disconnect(); talkSource = null; }
    talkAudio = audio;
    if (audioCtx && audioCtx.state === "running") {
      try {
        talkSource = audioCtx.createMediaElementSource(audio);
        talkSource.connect(talkAnalyser);
        useAnalyser = true;
      } catch (_) { talkSource = null; }
    }
    const data = new Uint8Array(128);
    const loop = () => {
      let level;
      if (useAnalyser) {
        talkAnalyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 2; i < 40; i++) sum += data[i];
        level = Math.min(1, (sum / 38 / 255) * 2.1);
      } else {
        const t = performance.now() / 1000;
        level = Math.abs(Math.sin(t * 11) * Math.sin(t * 2.7)) * 0.8;
      }
      setMouth(level);
      talkFrame = requestAnimationFrame(loop);
    };
    audio.addEventListener("play", () => { mode("speaking"); cancelAnimationFrame(talkFrame); loop(); });
    for (const ev of ["ended", "pause", "error"]) {
      audio.addEventListener(ev, () => { if (talkAudio === audio) stopTalking(true); });
    }
  }

  /* ------------------------------------------------------------ live waveform */
  function drawWave(samples) {
    const canvas = $("#wave");
    if (!canvas.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, w, h);
    const gradient = g.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, CYAN);
    gradient.addColorStop(0.5, TEAL);
    gradient.addColorStop(1, VIOLET);
    g.strokeStyle = gradient;
    g.lineWidth = 2.5 * dpr;
    g.lineJoin = "round";
    g.shadowBlur = 14 * dpr;
    g.shadowColor = CYAN;
    g.beginPath();
    const step = samples.length / w;
    for (let x = 0; x < w; x += 2) {
      const v = (samples[Math.floor(x * step)] - 128) / 128;
      const y = h / 2 + Math.max(-1, Math.min(1, v * 2.4)) * (h / 2 - 6 * dpr);
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }

  /* ------------------------------------------------------------ measuring the recording */
  function analyzeVoice(samples, rate) {
    const hop = Math.round(rate * 0.03);
    const levels = [];
    for (let i = 0; i + hop <= samples.length; i += hop) {
      let sum = 0;
      for (let j = i; j < i + hop; j++) sum += samples[j] * samples[j];
      levels.push(Math.sqrt(sum / hop));
    }
    const duration = samples.length / rate;
    const sorted = [...levels].sort((a, b) => a - b);
    if (!sorted.length) return { duration };
    const floor = sorted[Math.floor(sorted.length * 0.1)];
    const loud = sorted[Math.floor(sorted.length * 0.95)];
    const threshold = Math.max(0.008, floor * 2.5, loud * 0.12);

    const voiced = levels.map((v) => v > threshold);
    const first = voiced.indexOf(true), last = voiced.lastIndexOf(true);
    if (first < 0) return { duration };

    // pauses of 400 ms or more between the first and last spoken moments
    let pauseFrames = 0, pauseCount = 0, longest = 0, run = 0;
    for (let i = first; i <= last + 1; i++) {
      if (i <= last && !voiced[i]) { run++; continue; }
      if (run * 0.03 >= 0.4) { pauseFrames += run; pauseCount++; longest = Math.max(longest, run); }
      run = 0;
    }
    const span = last - first + 1;

    const spoken = levels.filter((_, i) => voiced[i]);
    const mean = spoken.reduce((a, b) => a + b, 0) / spoken.length;
    const spread = Math.sqrt(spoken.reduce((a, b) => a + (b - mean) ** 2, 0) / spoken.length);
    const variation = mean > 0 ? spread / mean : 1;
    const steadiness = Math.max(0, Math.min(100, ((1.3 - variation) / 0.9) * 100));

    return {
      duration,
      speech_seconds: spoken.length * 0.03,
      pause_ratio: (pauseFrames / span) * 100,
      pause_count: pauseCount,
      longest_pause: longest * 0.03,
      volume_steadiness: steadiness,
      pitch_variation: pitchVariation(samples, rate, voiced, hop),
    };
  }

  // Spread of the voice's pitch in semitones, estimated by autocorrelation on every third spoken frame.
  function pitchVariation(samples, rate, voiced, hop) {
    const size = 1024, minLag = Math.floor(rate / 400), maxLag = Math.ceil(rate / 75);
    const found = [];
    for (let f = 0; f < voiced.length; f += 3) {
      if (!voiced[f]) continue;
      const start = f * hop;
      if (start + size + maxLag >= samples.length) break;
      let energy = 0, best = 0, bestLag = 0;
      for (let i = 0; i < size; i++) energy += samples[start + i] ** 2;
      if (!energy) continue;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let c = 0;
        for (let i = 0; i < size; i++) c += samples[start + i] * samples[start + i + lag];
        if (c > best) { best = c; bestLag = lag; }
      }
      if (bestLag && best / energy > 0.5) found.push(rate / bestLag);
    }
    if (found.length < 5) return 0;
    found.sort((a, b) => a - b);
    const median = found[Math.floor(found.length / 2)];
    const tones = found.map((hz) => 12 * Math.log2(hz / median));
    const mean = tones.reduce((a, b) => a + b, 0) / tones.length;
    return Math.sqrt(tones.reduce((a, b) => a + (b - mean) ** 2, 0) / tones.length);
  }

  /* ------------------------------------------------------------ rings, numbers, stepper */
  function toneColor(ratio) {
    return ratio >= 0.75 ? TEAL : ratio >= 0.55 ? CYAN : ratio >= 0.4 ? AMBER : ROSE;
  }

  function ring(value, max, label, shown) {
    const R = 30, C = 2 * Math.PI * R;
    const wrap = make("div", "ring");
    const inner = make("div", "inner");
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 74 74");
    const circle = (cls) => {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", 37); c.setAttribute("cy", 37); c.setAttribute("r", R);
      if (cls) c.setAttribute("class", cls);
      return c;
    };
    const val = circle("val");
    const color = toneColor(value / max);
    val.style.stroke = color;
    val.style.color = color;
    val.style.strokeDasharray = C;
    val.style.strokeDashoffset = C;
    svg.append(circle(), val);
    inner.append(svg, make("span", "num", shown));
    wrap.append(inner);
    if (label) wrap.append(make("small", "", label));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      val.style.strokeDashoffset = C * (1 - value / max);
    }));
    return wrap;
  }

  function rings(container, scores, labels) {
    container.replaceChildren();
    for (const key of Object.keys(labels)) {
      if (!(key in scores)) continue;
      const v = scores[key];
      container.append(ring(v, 5, labels[key], Number.isInteger(v) ? String(v) : v.toFixed(1)));
    }
  }

  function countUp(node, value, decimals) {
    if (reduced) { node.textContent = value.toFixed(decimals); return; }
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / 900);
      node.textContent = (value * (1 - (1 - p) ** 3)).toFixed(decimals);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // current: 0 = setup, 1..total = questions, total + 1 = report
  function stepper(current, total) {
    const nav = $("#stepper");
    nav.replaceChildren();
    const names = ["Setup"];
    for (let i = 1; i <= total; i++) names.push("Q" + i);
    names.push("Report");
    names.forEach((name, i) => {
      if (i) nav.append(make("span", i <= current ? "step-line done" : "step-line"));
      const step = make("span", i < current ? "step done" : i === current ? "step current" : "step", name);
      if (i === current) step.setAttribute("aria-current", "step");
      nav.append(step);
    });
    const active = nav.querySelector(".current");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function header({ q = "—", avg = "—", best = "—", target = "—" }) {
    $("#chip-q").textContent = q;
    $("#chip-avg").textContent = avg;
    $("#chip-best").textContent = best;
    $("#chip-target").textContent = target;
  }

  /* ------------------------------------------------------------ confetti */
  function confetti() {
    if (reduced) return;
    const canvas = $("#confetti");
    const g = canvas.getContext("2d");
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    const colors = [CYAN, TEAL, VIOLET, "#ffffff"];
    const bits = Array.from({ length: 150 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.5,
      y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 13,
      vy: -Math.random() * 13 - 3,
      size: 4 + Math.random() * 6,
      spin: Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    const start = performance.now();
    const tick = (now) => {
      const t = now - start;
      g.clearRect(0, 0, canvas.width, canvas.height);
      if (t > 2600) return;
      g.globalAlpha = Math.min(1, (2600 - t) / 700);
      for (const b of bits) {
        b.x += b.vx; b.y += b.vy; b.vy += 0.3; b.vx *= 0.99; b.spin += 0.2;
        g.save();
        g.translate(b.x, b.y);
        g.rotate(b.spin);
        g.fillStyle = b.color;
        g.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
        g.restore();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------ charts */
  const charts = {};
  const hasCharts = typeof window.Chart !== "undefined";
  if (hasCharts) {
    Chart.defaults.color = TEXT;
    Chart.defaults.font.family = '"Cascadia Code", Consolas, monospace';
    Chart.defaults.font.size = 11;
    Chart.defaults.borderColor = GRID;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.tooltip.backgroundColor = "#0b131c";
    Chart.defaults.plugins.tooltip.borderColor = "rgba(120,220,255,.35)";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.legend.display = false;
    if (reduced) Chart.defaults.animation = false;
  }

  function draw(id, config) {
    if (!hasCharts) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($("#" + id), config);
  }

  function clearCharts() {
    for (const id of Object.keys(charts)) { charts[id].destroy(); delete charts[id]; }
  }

  function radar(id, labels, series) {
    const palette = [[CYAN, "rgba(34,230,255,.16)"], [VIOLET, "rgba(167,139,250,.08)"]];
    draw(id, {
      type: "radar",
      data: {
        labels,
        datasets: series.map((s, i) => ({
          label: s.label, data: s.values, borderColor: palette[i][0], backgroundColor: palette[i][1],
          borderWidth: 2, borderDash: i ? [5, 4] : [], pointBackgroundColor: palette[i][0], pointRadius: 4, pointHoverRadius: 6,
        })),
      },
      options: {
        scales: { r: { min: 0, max: 5, ticks: { stepSize: 1, backdropColor: "transparent", color: "rgba(142,163,174,.7)" }, grid: { color: GRID }, angleLines: { color: GRID }, pointLabels: { color: "#cfe0e8" } } },
        plugins: { legend: { display: series.length > 1, position: "bottom", labels: { boxWidth: 12, boxHeight: 2 } } },
      },
    });
  }

  const barOptions = (extra) => ({
    borderRadius: 4, maxBarThickness: 30, ...extra,
  });

  function bars(id, labels, values, { color = CYAN, label, horizontal = false, max, min = 0, step, band } = {}) {
    const valueAxis = { min, grid: { color: GRID }, ticks: step ? { stepSize: step } : {} };
    if (max !== undefined) valueAxis.max = max;
    const catAxis = { grid: { display: false } };
    const plugins = band ? [bandPlugin] : [];
    draw(id, {
      type: "bar",
      data: { labels, datasets: [{ label, data: values, backgroundColor: color, ...barOptions() }] },
      options: {
        indexAxis: horizontal ? "y" : "x",
        scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
        plugins: band ? { band } : {},
      },
      plugins,
    });
  }

  const bandPlugin = {
    id: "band",
    beforeDatasetsDraw(chart, _args, opts) {
      const { ctx, chartArea: a, scales: { y } } = chart;
      const top = y.getPixelForValue(opts.to), bottom = y.getPixelForValue(opts.from);
      ctx.save();
      ctx.fillStyle = "rgba(0,240,192,.1)";
      ctx.fillRect(a.left, top, a.width, bottom - top);
      ctx.restore();
    },
  };

  function line(id, labels, values, label) {
    draw(id, {
      type: "line",
      data: { labels, datasets: [{ label, data: values, borderColor: CYAN, backgroundColor: "rgba(34,230,255,.12)", fill: true, borderWidth: 2, tension: 0.3, pointBackgroundColor: CYAN, pointRadius: 5, pointHoverRadius: 7 }] },
      options: { interaction: { mode: "index", intersect: false }, scales: { y: { min: 0, max: 5, ticks: { stepSize: 1 }, grid: { color: GRID } }, x: { grid: { display: false } } } },
    });
  }

  /* ------------------------------------------------------------ voice panels */
  function fillerChips(container, fillers) {
    container.replaceChildren();
    for (const [word, count] of Object.entries(fillers)) container.append(make("span", "", `${word} ×${count}`));
  }

  function voiceTiles(container, v) {
    const paceNote = { good: "Comfortable pace", slow: "A bit slow", fast: "A bit fast" }[v.pace_label];
    const tiles = [
      ["Pace", v.wpm, `wpm · ${paceNote}`],
      ["Filler words", v.filler_count, `${v.words} words spoken`],
      ["Pauses", `${v.pause_ratio}%`, `longest ${v.longest_pause}s`],
      ["Steadiness", v.volume_steadiness, "volume, out of 100"],
      ["Pitch variety", v.pitch_label, v.pitch_variation ? `${v.pitch_variation} semitones` : "not enough voiced audio"],
    ];
    container.replaceChildren();
    for (const [name, value, note] of tiles) {
      const t = make("div", "tile");
      t.append(make("small", "", name), make("b", "", String(value)), make("span", "", note));
      container.append(t);
    }
  }

  function overallRing(container, value) {
    container.replaceChildren(ring(value, 5, "OUT OF 5", value.toFixed(1)));
  }

  return { mode, speak, stopTalking, drawWave, analyzeVoice, rings, overallRing, countUp, stepper, header, confetti, radar, bars, line, clearCharts, fillerChips, voiceTiles };
})();
