/* Tarkeez — Pomodoro timer. Vanilla JS, no dependencies. Data lives in localStorage only. */
(() => {
  "use strict";

  // ---------- Storage helpers ----------
  const LS = {
    get(key, fallback) {
      try { const v = localStorage.getItem("tarkeez." + key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, val) { try { localStorage.setItem("tarkeez." + key, JSON.stringify(val)); } catch { /* storage full / disabled */ } }
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (n, min, max, d) => { n = Math.round(Number(n)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
  const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- State ----------
  const DEFAULTS = { pomo: 25, short: 5, long: 15, autoBreak: false, autoPomo: false, interval: 4, sound: "bell", volume: 60, tick: false, notify: false, dark: false, ambient: "none", ambientVol: 40 };
  const settings = Object.assign({}, DEFAULTS, LS.get("settings", {}));

  const LANGS = window.LANGS;
  const langInfo = (c) => LANGS.find(l => l.code === c) || LANGS[1];
  const detectLang = () => {
    for (const n of (navigator.languages || [navigator.language || ""])) {
      const c = String(n).toLowerCase().split("-")[0];
      if (LANGS.some(l => l.code === c)) return c;
    }
    return "en";
  };
  // Each language has its own page (/ar/, /en/, /tr/): the page's <html lang> decides.
  const pageLang = document.documentElement.lang;
  let lang = LANGS.some(l => l.code === pageLang) ? pageLang : LS.get("lang", null);
  if (!LANGS.some(l => l.code === lang)) lang = detectLang();
  const ROOT_PATH = document.documentElement.dataset.root || "";
  const PAGE_TITLE = document.title;
  let tasks = LS.get("tasks", []);
  let activeId = LS.get("activeId", null);
  let stats = LS.get("stats", {});

  const savedTimer = LS.get("timer", null);
  const timer = {
    mode: "pomodoro",
    running: false,
    endAt: 0,
    remaining: settings.pomo * 60000,
    duration: settings.pomo * 60000,
    count: 0,          // pomodoros completed in the current day
    countDay: todayKey()
  };
  if (savedTimer && ["pomodoro", "short", "long"].includes(savedTimer.mode)) Object.assign(timer, savedTimer);
  if (timer.countDay !== todayKey()) { timer.count = 0; timer.countDay = todayKey(); }

  const t = (k, vars) => {
    let s = (I18N[lang] && I18N[lang][k]) ?? I18N.en[k] ?? k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b);
    return s;
  };
  const minutesFor = (mode) => mode === "pomodoro" ? settings.pomo : mode === "short" ? settings.short : settings.long;

  const saveTimer = () => LS.set("timer", timer);
  const saveTasks = () => { LS.set("tasks", tasks); LS.set("activeId", activeId); };

  // ---------- Elements ----------
  const el = {
    time: $("#time"), start: $("#startBtn"), skip: $("#skipBtn"), reset: $("#resetBtn"),
    topBar: $("#topBar"), sessionCount: $("#sessionCount"), sessionMsg: $("#sessionMsg"),
    taskList: $("#taskList"), addTask: $("#addTaskBtn"), form: $("#taskForm"), title: $("#taskTitle"),
    est: $("#taskEst"), note: $("#taskNote"), del: $("#taskDeleteBtn"), cancel: $("#taskCancelBtn"),
    currentTask: $("#currentTask"), currentTaskName: $("#currentTaskName"),
    summary: $("#summary"), sumPomos: $("#sumPomos"), sumFinish: $("#sumFinish"), sumHours: $("#sumHours"),
    menuBtn: $("#tasksMenuBtn"), menu: $("#tasksMenu"), toast: $("#toast"),
    settingsDlg: $("#settingsDlg"), statsDlg: $("#statsDlg")
  };

  // ---------- Audio (Web Audio API, synthesized — no files needed) ----------
  let audioCtx = null;
  const ensureAudio = () => {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  };
  const tone = (freq, start, dur, type = "sine", gain = 1) => {
    const ctx = audioCtx; if (!ctx) return;
    const vol = (settings.volume / 100) * 0.35 * gain;
    if (vol <= 0) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    const t0 = ctx.currentTime + start;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  };
  const playAlarm = (kind = settings.sound) => {
    if (kind === "none" || !ensureAudio()) return;
    if (kind === "bell") {
      for (let i = 0; i < 3; i++) { tone(880, i * 0.9, 1.4, "sine"); tone(1320, i * 0.9, 1.0, "sine", 0.4); tone(1760, i * 0.9, 0.6, "sine", 0.2); }
    } else if (kind === "digital") {
      for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) tone(1000, r * 0.9 + i * 0.12, 0.08, "square", 0.35);
    } else if (kind === "soft") {
      [523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.25, 1.6, "triangle", 0.8));
      [523.25, 659.25, 783.99].forEach((f, i) => tone(f, 1.4 + i * 0.25, 1.6, "triangle", 0.8));
    }
  };
  const playTick = () => { if (ensureAudio()) tone(1800, 0, 0.03, "square", 0.08); };

  // ---------- Background focus sounds (generated noise, looped) ----------
  const noiseCache = {};
  const makeNoise = (kind) => {
    if (noiseCache[kind]) return noiseCache[kind];
    const ctx = audioCtx, sr = ctx.sampleRate, len = sr * 6;
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === "white") d[i] = w * 0.25;
        else if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
        else { // rain: pink noise base
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.06; b6 = w * 0.115926;
        }
      }
      if (kind === "rain") { // scattered droplets
        const drops = Math.floor(len / sr * 45);
        for (let k = 0; k < drops; k++) {
          const at = Math.floor(Math.random() * (len - 400)), amp = 0.05 + Math.random() * 0.18;
          for (let j = 0; j < 300; j++) d[at + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / 40);
        }
      }
      const f = Math.floor(sr * 0.05); // fade loop edges so the repeat is seamless
      for (let i = 0; i < f; i++) { const g = i / f; d[i] *= g; d[len - 1 - i] *= g; }
    }
    return (noiseCache[kind] = buf);
  };
  let ambient = null; // { src, gain, kind }
  const stopAmbient = () => {
    if (!ambient) return;
    const a = ambient; ambient = null;
    try { a.gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.25); setTimeout(() => { try { a.src.stop(); } catch { /* already stopped */ } }, 900); } catch { /* ignore */ }
  };
  const startAmbient = (kind, vol = settings.ambientVol) => {
    if (!ensureAudio()) return;
    stopAmbient();
    const src = audioCtx.createBufferSource(); src.buffer = makeNoise(kind); src.loop = true;
    const gain = audioCtx.createGain(); gain.gain.value = 0;
    let node = src;
    if (kind === "rain") { const lp = audioCtx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5000; src.connect(lp); node = lp; }
    node.connect(gain).connect(audioCtx.destination);
    src.start();
    gain.gain.setTargetAtTime((vol / 100) * 0.9, audioCtx.currentTime, 0.4);
    ambient = { src, gain, kind };
  };
  const updateAmbient = () => {
    const want = settings.ambient !== "none" && timer.running && timer.mode === "pomodoro" ? settings.ambient : null;
    if (!want) { if (ambient && !ambient.preview) stopAmbient(); return; }
    if (!ambient || ambient.kind !== want || ambient.preview) startAmbient(want);
    else ambient.gain.gain.setTargetAtTime((settings.ambientVol / 100) * 0.9, audioCtx.currentTime, 0.2);
  };
  let previewTimer = null;
  const previewAmbient = (kind, vol) => {
    if (timer.running && timer.mode === "pomodoro") return; // the live sound is already playing
    clearTimeout(previewTimer);
    if (kind === "none") { stopAmbient(); return; }
    startAmbient(kind, vol); if (ambient) ambient.preview = true;
    previewTimer = setTimeout(stopAmbient, 2500);
  };

  // ---------- Toast ----------
  let toastTimer;
  const toast = (msg) => {
    el.toast.textContent = msg; el.toast.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2600);
  };

  // ---------- Notifications ----------
  const notify = (body) => {
    if (!settings.notify || !("Notification" in window) || Notification.permission !== "granted") return;
    try { const n = new Notification(t("brand"), { body, icon: ROOT_PATH + "img/icon-192.png", tag: "tarkeez" }); n.onclick = () => { window.focus(); n.close(); }; }
    catch { /* some mobile browsers only allow SW notifications */ }
  };

  // ---------- Stats ----------
  const addStats = (pomos, minutes) => {
    const k = todayKey();
    const s = stats[k] || { pomos: 0, minutes: 0 };
    s.pomos += pomos; s.minutes += minutes;
    stats[k] = s; LS.set("stats", stats);
  };

  // ---------- Timer core ----------
  const fmt = (ms) => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60), s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  const currentRemaining = () => timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.remaining;

  let lastShownSec = -1;
  const renderTime = () => {
    const rem = currentRemaining();
    const str = fmt(rem);
    if (el.time.textContent !== str) el.time.textContent = str;
    const pct = timer.duration ? (1 - rem / timer.duration) * 100 : 0;
    el.topBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    // Show the countdown in the tab only once a session is in progress; otherwise keep the page's real title.
    const inProgress = timer.running || rem < timer.duration;
    const wanted = inProgress ? `${str} - ${timer.mode === "pomodoro" ? t("tab_focus") : t("tab_break")} | ${t("brand")}` : PAGE_TITLE;
    if (document.title !== wanted) document.title = wanted;
    const sec = Math.ceil(rem / 1000);
    if (timer.running && settings.tick && timer.mode === "pomodoro" && sec !== lastShownSec && !document.hidden) playTick();
    lastShownSec = sec;
  };

  const renderMode = () => {
    document.body.dataset.mode = timer.mode;
    document.body.classList.toggle("is-running", timer.running);
    document.body.classList.toggle("dark-run", timer.running && settings.dark);
    $$(".mode-btn").forEach(b => { const on = b.dataset.mode === timer.mode; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
    const label = timer.running ? t("pause") : (timer.remaining < timer.duration ? t("resume") : t("start"));
    el.start.textContent = label;
    el.start.classList.toggle("pressed", timer.running);
    el.start.setAttribute("aria-pressed", timer.running);
    el.skip.hidden = !timer.running;
    updateAmbient();
    el.sessionCount.textContent = `#${timer.mode === "pomodoro" ? timer.count + 1 : Math.max(1, timer.count)}`;
    el.sessionMsg.textContent = timer.mode === "pomodoro" ? t("msg_focus") : t("msg_break");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#ba4949";
    renderTime();
  };

  let loop = null;
  const startLoop = () => { if (!loop) loop = setInterval(tick, 250); };
  const stopLoop = () => { clearInterval(loop); loop = null; };

  const tick = () => {
    if (timer.running && Date.now() >= timer.endAt) { complete(false); return; }
    renderTime();
  };

  const setMode = (mode, { auto = false } = {}) => {
    timer.mode = mode;
    timer.duration = minutesFor(mode) * 60000;
    timer.remaining = timer.duration;
    timer.running = false;
    stopLoop();
    if (auto) start(); else { saveTimer(); renderMode(); renderSummary(); }
  };

  const start = () => {
    ensureAudio();
    if (timer.remaining <= 0) timer.remaining = timer.duration;
    timer.running = true;
    timer.endAt = Date.now() + timer.remaining;
    saveTimer(); startLoop(); renderMode(); renderSummary();
  };
  const pause = () => {
    timer.remaining = Math.max(0, timer.endAt - Date.now());
    timer.running = false;
    stopLoop(); saveTimer(); renderMode(); renderSummary();
  };
  const toggle = () => timer.running ? pause() : start();

  // finish current session. skipped=true when the user pressed "skip".
  const complete = (skipped, { silent = false } = {}) => {
    const wasMode = timer.mode;
    const elapsed = timer.duration - currentRemaining();
    timer.running = false; stopLoop();
    if (timer.countDay !== todayKey()) { timer.count = 0; timer.countDay = todayKey(); }

    if (wasMode === "pomodoro") {
      timer.count += 1;
      addStats(1, Math.round(elapsed / 60000));
      const task = tasks.find(x => x.id === activeId && !x.done);
      if (task) { task.act += 1; saveTasks(); renderTasks(); }
      if (!skipped && !silent) { playAlarm(); notify(t("notif_focus_done")); }
      const next = timer.count % settings.interval === 0 ? "long" : "short";
      setMode(next, { auto: settings.autoBreak && !silent });
    } else {
      if (!skipped && !silent) { playAlarm(); notify(t("notif_break_done")); }
      setMode("pomodoro", { auto: settings.autoPomo && !silent });
    }
  };

  // ---------- Tasks ----------
  let editingId = null;

  const renderTasks = () => {
    el.taskList.innerHTML = "";
    if (!tasks.length) {
      const li = document.createElement("li"); li.className = "task-empty"; li.textContent = t("no_tasks");
      el.taskList.appendChild(li);
    }
    for (const task of tasks) {
      const li = document.createElement("li");
      li.className = "task" + (task.id === activeId ? " active" : "") + (task.done ? " done" : "");
      li.dataset.id = task.id;
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-pressed", task.id === activeId);

      const check = document.createElement("button");
      check.type = "button"; check.className = "task__check"; check.dataset.act = "toggle";
      check.setAttribute("aria-label", t("mark_done")); check.setAttribute("aria-pressed", !!task.done);
      check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

      const body = document.createElement("div"); body.className = "task__body";
      const title = document.createElement("span"); title.className = "task__title"; title.textContent = task.title;
      body.appendChild(title);
      if (task.note) { const n = document.createElement("p"); n.className = "task__note"; n.textContent = task.note; body.appendChild(n); }

      const cnt = document.createElement("span"); cnt.className = "task__count"; cnt.dir = "ltr";
      cnt.innerHTML = `${task.act}<small>/${task.est}</small>`;

      const edit = document.createElement("button");
      edit.type = "button"; edit.className = "btn-icon btn-icon--sm task__edit"; edit.dataset.act = "edit";
      edit.setAttribute("aria-label", t("edit"));
      edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>';

      li.append(check, body, cnt, edit);
      el.taskList.appendChild(li);
    }
    const active = tasks.find(x => x.id === activeId);
    el.currentTask.hidden = !active;
    if (active) el.currentTaskName.textContent = active.title;
    renderSummary();
  };

  const renderSummary = () => {
    const pending = tasks.filter(x => !x.done);
    el.summary.hidden = tasks.length === 0;
    if (!tasks.length) return;
    const act = tasks.reduce((a, x) => a + x.act, 0);
    const est = tasks.reduce((a, x) => a + x.est, 0);
    el.sumPomos.textContent = `${act}/${est}`;
    // Estimate finish time: remaining pomodoros + the breaks between them.
    let left = pending.reduce((a, x) => a + Math.max(0, x.est - x.act), 0);
    let ms = 0, c = timer.count;
    if (left > 0 && timer.mode === "pomodoro") { ms += currentRemaining(); left -= 1; c += 1; if (left > 0) ms += (c % settings.interval === 0 ? settings.long : settings.short) * 60000; }
    else if (left > 0) { ms += currentRemaining(); }
    for (let i = 0; i < left; i++) {
      ms += settings.pomo * 60000; c += 1;
      if (i < left - 1) ms += (c % settings.interval === 0 ? settings.long : settings.short) * 60000;
    }
    const locale = langInfo(lang).locale;
    el.sumFinish.textContent = new Date(Date.now() + ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    el.sumHours.textContent = t("hours_left", { h: (ms / 3600000).toFixed(1) });
  };

  const openForm = (task = null, afterEl = null) => {
    editingId = task ? task.id : null;
    el.title.value = task ? task.title : "";
    el.est.value = task ? task.est : 1;
    el.note.value = task ? (task.note || "") : "";
    el.del.hidden = !task;
    if (afterEl) afterEl.after(el.form); else el.addTask.before(el.form);
    $$(".task.editing").forEach(x => x.classList.remove("editing"));
    if (afterEl) afterEl.classList.add("editing");
    el.form.hidden = false; el.addTask.hidden = true;
    el.title.focus();
  };
  const closeForm = () => {
    el.form.hidden = true; el.addTask.hidden = false; editingId = null;
    el.addTask.before(el.form);
    $$(".task.editing").forEach(x => x.classList.remove("editing"));
  };

  el.addTask.addEventListener("click", () => openForm());
  el.cancel.addEventListener("click", closeForm);
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = el.title.value.trim();
    if (!title) { el.title.focus(); return; }
    const est = clamp(el.est.value, 1, 99, 1);
    const note = el.note.value.trim();
    if (editingId) {
      const task = tasks.find(x => x.id === editingId);
      if (task) Object.assign(task, { title, est, note });
    } else {
      const task = { id: uid(), title, est, act: 0, done: false, note };
      tasks.push(task);
      if (!activeId || !tasks.some(x => x.id === activeId && !x.done)) activeId = task.id;
    }
    saveTasks(); closeForm(); renderTasks();
  });
  el.del.addEventListener("click", () => {
    if (!editingId) return;
    tasks = tasks.filter(x => x.id !== editingId);
    if (activeId === editingId) activeId = (tasks.find(x => !x.done) || {}).id || null;
    saveTasks(); closeForm(); renderTasks();
  });
  $$(".stepper__btn").forEach(b => b.addEventListener("click", () => {
    el.est.value = clamp(Number(el.est.value) + Number(b.dataset.step), 1, 99, 1);
  }));

  const taskAction = (li, act) => {
    const task = tasks.find(x => x.id === li.dataset.id);
    if (!task) return;
    if (act === "toggle") {
      task.done = !task.done;
      if (task.done) toast(t("task_done_toast"));
      if (task.done && activeId === task.id) { const nxt = tasks.find(x => !x.done); activeId = nxt ? nxt.id : activeId; }
      saveTasks(); renderTasks();
    } else if (act === "edit") {
      openForm(task, li);
    } else {
      activeId = task.id; saveTasks(); renderTasks();
    }
  };
  el.taskList.addEventListener("click", (e) => {
    const li = e.target.closest(".task"); if (!li) return;
    const btn = e.target.closest("[data-act]");
    taskAction(li, btn ? btn.dataset.act : "select");
  });
  el.taskList.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("task")) { e.preventDefault(); taskAction(e.target, "select"); }
  });

  // Task menu
  const closeMenu = () => { el.menu.hidden = true; el.menuBtn.setAttribute("aria-expanded", "false"); };
  el.menuBtn.addEventListener("click", (e) => { e.stopPropagation(); const open = el.menu.hidden; el.menu.hidden = !open; el.menuBtn.setAttribute("aria-expanded", open); });
  document.addEventListener("click", (e) => { if (!el.menu.hidden && !e.target.closest(".menu-wrap")) closeMenu(); });
  el.menu.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action]"); if (!a) return;
    const action = a.dataset.action;
    if (action === "clear-done") tasks = tasks.filter(x => !x.done);
    if (action === "clear-pomos") tasks.forEach(x => x.act = 0);
    if (action === "clear-all") { if (!confirm(t("confirm_clear_all"))) { closeMenu(); return; } tasks = []; }
    if (!tasks.some(x => x.id === activeId)) activeId = (tasks.find(x => !x.done) || {}).id || null;
    saveTasks(); closeMenu(); closeForm(); renderTasks();
  });

  // ---------- Timer controls ----------
  el.start.addEventListener("click", toggle);
  el.skip.addEventListener("click", () => {
    if (timer.mode === "pomodoro" && !confirm(t("confirm_skip"))) return;
    complete(true);
  });
  el.reset.addEventListener("click", () => setMode(timer.mode));
  $$(".mode-btn").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.mode === timer.mode && !timer.running) return;
    if (timer.running && !confirm(t("confirm_skip"))) return;
    setMode(b.dataset.mode);
  }));

  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" && e.key !== " ") return;
    if (e.target.closest("input, textarea, select, button, [role=button], dialog, a, summary")) return;
    e.preventDefault(); toggle();
  });

  // ---------- Settings ----------
  const S = { ambient: $("#setAmbient"), ambientVol: $("#setAmbientVol"), pomo: $("#setPomo"), short: $("#setShort"), long: $("#setLong"), autoBreak: $("#setAutoBreak"), autoPomo: $("#setAutoPomo"),
    interval: $("#setInterval"), sound: $("#setSound"), volume: $("#setVolume"), tick: $("#setTick"), notify: $("#setNotify"), dark: $("#setDark") };

  const fillSettings = () => {
    S.pomo.value = settings.pomo; S.short.value = settings.short; S.long.value = settings.long;
    S.autoBreak.checked = settings.autoBreak; S.autoPomo.checked = settings.autoPomo; S.interval.value = settings.interval;
    S.sound.value = settings.sound; S.volume.value = settings.volume; S.tick.checked = settings.tick;
    S.notify.checked = settings.notify && ("Notification" in window) && Notification.permission === "granted";
    S.dark.checked = settings.dark;
    S.ambient.value = settings.ambient; S.ambientVol.value = settings.ambientVol;
  };
  S.ambient.addEventListener("change", () => previewAmbient(S.ambient.value, clamp(S.ambientVol.value, 0, 100, 40)));
  const openDialog = (dlg) => { if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", ""); };
  const closeDialog = (dlg) => { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); };

  $("#settingsBtn").addEventListener("click", () => { fillSettings(); openDialog(el.settingsDlg); });
  S.notify.addEventListener("change", async () => {
    if (!S.notify.checked) return;
    if (!("Notification" in window)) { S.notify.checked = false; toast(t("notif_unsupported")); return; }
    if (Notification.permission === "granted") return;
    try { const p = await Notification.requestPermission(); if (p !== "granted") { S.notify.checked = false; toast(t("notif_denied")); } }
    catch { S.notify.checked = false; }
  });
  $("#testSoundBtn").addEventListener("click", () => {
    const prevVol = settings.volume; settings.volume = clamp(S.volume.value, 0, 100, 60);
    ensureAudio(); playAlarm(S.sound.value === "none" ? "bell" : S.sound.value); settings.volume = prevVol;
  });
  $("#saveSettingsBtn").addEventListener("click", () => {
    const oldMinutes = minutesFor(timer.mode);
    Object.assign(settings, {
      pomo: clamp(S.pomo.value, 1, 180, DEFAULTS.pomo), short: clamp(S.short.value, 1, 60, DEFAULTS.short), long: clamp(S.long.value, 1, 120, DEFAULTS.long),
      autoBreak: S.autoBreak.checked, autoPomo: S.autoPomo.checked, interval: clamp(S.interval.value, 1, 12, DEFAULTS.interval),
      sound: S.sound.value, volume: clamp(S.volume.value, 0, 100, 60), tick: S.tick.checked, notify: S.notify.checked, dark: S.dark.checked,
      ambient: ["none", "rain", "white", "brown"].includes(S.ambient.value) ? S.ambient.value : "none", ambientVol: clamp(S.ambientVol.value, 0, 100, 40)
    });
    LS.set("settings", settings);
    // If the current mode's length changed and the timer isn't running, apply it right away.
    if (!timer.running && oldMinutes !== minutesFor(timer.mode)) setMode(timer.mode);
    closeDialog(el.settingsDlg); renderMode(); renderSummary(); toast(t("saved"));
  });

  // ---------- Report ----------
  const renderStats = () => {
    const k = todayKey(); const today = stats[k] || { pomos: 0, minutes: 0 };
    $("#stToday").textContent = today.pomos; $("#stMinutes").textContent = today.minutes;
    let streak = 0; const d = new Date();
    if (!(stats[todayKey(d)] && stats[todayKey(d)].pomos)) d.setDate(d.getDate() - 1);
    while (stats[todayKey(d)] && stats[todayKey(d)].pomos > 0) { streak++; d.setDate(d.getDate() - 1); }
    $("#stStreak").textContent = streak;

    const chart = $("#weekChart"); chart.innerHTML = ""; chart.setAttribute("aria-label", t("chart_label"));
    const days = [];
    for (let i = 6; i >= 0; i--) { const x = new Date(); x.setDate(x.getDate() - i); days.push(x); }
    const vals = days.map(x => (stats[todayKey(x)] || {}).minutes || 0);
    const max = Math.max(25, ...vals);
    const locale = langInfo(lang).locale;
    days.forEach((x, i) => {
      const col = document.createElement("div"); col.className = "bar";
      col.innerHTML = `<span class="bar__val">${vals[i]}</span><span class="bar__fill" style="height:${(vals[i] / max) * 100}%"></span><span class="bar__lbl">${x.toLocaleDateString(locale, { weekday: "short" })}</span>`;
      chart.appendChild(col);
    });
  };
  $("#statsBtn").addEventListener("click", () => { renderStats(); openDialog(el.statsDlg); });
  $("#resetStatsBtn").addEventListener("click", () => { if (confirm(t("confirm_reset_stats"))) { stats = {}; LS.set("stats", stats); renderStats(); } });

  // close dialogs by clicking the backdrop
  [el.settingsDlg, el.statsDlg].forEach(d => d.addEventListener("click", (e) => { if (e.target === d) closeDialog(d); }));

  // ---------- i18n ----------
  const applyLang = () => {
    const html = document.documentElement;
    html.lang = lang; html.dir = langInfo(lang).dir;
    $$("[data-i18n]").forEach(n => {
      const v = t(n.dataset.i18n);
      if (v.includes("<b>")) n.innerHTML = v; else n.textContent = v;
    });
    $$("[data-i18n-ph]").forEach(n => n.placeholder = t(n.dataset.i18nPh));
    $$("[data-i18n-aria]").forEach(n => n.setAttribute("aria-label", t(n.dataset.i18nAria)));
    renderMode(); renderTasks();
  };


  // ---------- Boot ----------
  // Keep duration in sync with settings when idle at full time
  timer.duration = minutesFor(timer.mode) * 60000;
  if (!timer.running && timer.remaining > timer.duration) timer.remaining = timer.duration;
  if (timer.running) {
    if (Date.now() >= timer.endAt) complete(false, { silent: true });   // finished while the page was closed
    else startLoop();
  }
  applyLang();

  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register(ROOT_PATH + "sw.js", { scope: ROOT_PATH || "./" }).catch(() => {}));
  }

  // expose a tiny API for automated tests
  window.__tarkeez = { timer, settings, get tasks() { return tasks; }, complete, setMode, get ambient() { return ambient && ambient.kind; } };
})();
