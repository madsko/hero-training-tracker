// Hero Training Tracker — main app
// Vanilla JS, no dependencies. State lives in localStorage.

(() => {
  const STORAGE_KEY = 'hero-training-tracker-v1';
  const COLORS = [
    { name: 'yellow', hex: '#e9bf5c', soft: 'rgba(233, 191, 92, 0.18)' },
    { name: 'red',    hex: '#9c3c37', soft: 'rgba(156, 60, 55, 0.22)' },
    { name: 'maroon', hex: '#662422', soft: 'rgba(102, 36, 34, 0.32)' },
    { name: 'gold',   hex: '#aa8238', soft: 'rgba(170, 130, 56, 0.22)' },
    { name: 'sky',    hex: '#b5e3ea', soft: 'rgba(181, 227, 234, 0.16)' },
  ];

  // Pool the daily random challenge rotates through.
  const CHALLENGES = [
    { name: 'Plank hold',      goal: 60, unit: 'sec',      icon: '⏱️' },
    { name: 'Wall sit',        goal: 90, unit: 'sec',      icon: '🧱' },
    { name: 'Side plank',      goal: 60, unit: 'sec/side', icon: '➕' },
    { name: 'Tricep dips',     goal: 20, unit: 'reps',     icon: '💺' },
    { name: 'Deep squat hold', goal: 60, unit: 'sec',      icon: '🧘' },
  ];

  function challengeForDay(dateKey) {
    let sum = 0;
    for (let i = 0; i < dateKey.length; i++) sum += dateKey.charCodeAt(i);
    return CHALLENGES[sum % CHALLENGES.length];
  }

  // ------- State -------
  const defaultState = () => ({
    exercises: [],
    challengeLogs: {},
    celebratedToday: '',
    settings: { notificationsEnabled: false },
  });

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      // Light shape repair so older partial states don't crash.
      if (!parsed.exercises) parsed.exercises = [];
      if (!parsed.challengeLogs) parsed.challengeLogs = {};
      if (!('celebratedToday' in parsed)) parsed.celebratedToday = '';
      if (!parsed.settings) parsed.settings = { notificationsEnabled: false };
      return parsed;
    } catch (e) {
      console.warn('Failed to load state, starting fresh.', e);
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = loadState();

  // ------- Date helpers -------
  // Days roll over at 4 AM — a log made between midnight and 4 AM counts as the previous day.
  const ROLLOVER_HOUR = 4;
  const pad = n => String(n).padStart(2, '0');
  function ymd(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function effectiveNow() {
    const d = new Date();
    d.setHours(d.getHours() - ROLLOVER_HOUR);
    return d;
  }
  const todayKey = () => ymd(effectiveNow());
  function daysAgo(n) {
    const d = effectiveNow();
    d.setDate(d.getDate() - n);
    return d;
  }
  function formatPrettyDate(d) {
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // ------- Streak / completion logic -------
  function isComplete(ex, dayKey) {
    return (ex.logs[dayKey] || 0) >= ex.goal;
  }
  function currentStreak(ex) {
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const key = ymd(daysAgo(i));
      if (isComplete(ex, key)) streak++;
      else if (i === 0) continue; // today not yet complete doesn't break streak
      else break;
    }
    return streak;
  }
  function bestStreak(ex) {
    const keys = Object.keys(ex.logs).sort();
    let best = 0, run = 0, prev = null;
    for (const k of keys) {
      if (!isComplete(ex, k)) { run = 0; prev = null; continue; }
      if (prev) {
        const prevDate = new Date(prev + 'T00:00:00');
        const curDate = new Date(k + 'T00:00:00');
        const diff = Math.round((curDate - prevDate) / 86400000);
        run = diff === 1 ? run + 1 : 1;
      } else {
        run = 1;
      }
      best = Math.max(best, run);
      prev = k;
    }
    return best;
  }

  // Debt: each day, unmet goal accrues; overshoot pays it down;
  // then the running balance halves (50% rolls forward).
  function currentDebt(ex) {
    if (!ex.goal) return 0;
    const keys = Object.keys(ex.logs).sort();
    if (keys.length === 0) return 0;
    const todayK = todayKey();
    let debt = 0;
    const start = new Date(keys[0] + 'T00:00:00');
    const today = new Date(todayK + 'T00:00:00');
    for (let d = new Date(start); d < today; d.setDate(d.getDate() + 1)) {
      const k = ymd(d);
      const log = ex.logs[k] || 0;
      debt = Math.max(0, debt - Math.max(0, log - ex.goal));
      debt += Math.max(0, ex.goal - log);
      debt *= 0.5;
    }
    const todayLog = ex.logs[todayK] || 0;
    debt = Math.max(0, debt - Math.max(0, todayLog - ex.goal));
    return Math.round(debt);
  }

  // Global streak: consecutive days where every exercise that existed on
  // that day hit its goal. Today not-yet-complete doesn't break the streak.
  function globalStreak() {
    if (state.exercises.length === 0) return 0;
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const key = ymd(daysAgo(i));
      const relevant = state.exercises.filter(ex => {
        if (!ex.createdAt) return true;
        return ymd(new Date(ex.createdAt)) <= key;
      });
      if (relevant.length === 0) break;
      const allDone = relevant.every(ex => isComplete(ex, key));
      if (allDone) streak++;
      else if (i === 0) continue;
      else break;
    }
    return streak;
  }

  // ------- Toast -------
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // ------- Render -------
  function render() {
    renderDayHeader();
    renderDailyChallenge();
    renderToday();
    renderHistory();
    renderManage();
    updateNotifStatus();
  }

  function renderDailyChallenge() {
    const slot = document.getElementById('dailyChallenge');
    const key = todayKey();
    const c = challengeForDay(key);
    const done = !!state.challengeLogs[key];
    const color = COLORS[0]; // yellow accent for the featured card
    slot.innerHTML = `
      <div class="daily-challenge-card ${done ? 'completed' : ''}">
        <div class="card-head">
          <div class="card-icon" style="background: ${color.soft}; color: ${color.hex};">${escapeHTML(c.icon)}</div>
          <div class="card-info">
            <p class="challenge-label">Daily Challenge</p>
            <h3 class="card-name">${escapeHTML(c.name)}${done ? ' <span class="card-check">✓</span>' : ''}</h3>
            <p class="card-progress-text">${c.goal} ${escapeHTML(c.unit)}</p>
          </div>
        </div>
        ${done ? '' : `
          <div class="quick-actions" style="margin-top:12px;">
            <button class="quick-btn done" data-action="challenge-done">✓ Complete</button>
          </div>
        `}
      </div>
    `;
  }

  // Vanilla DOM confetti — fires once when everything for today gets done.
  function confetti() {
    const colors = ['#e9bf5c', '#9c3c37', '#b5e3ea', '#aa8238', '#662422'];
    const container = document.createElement('div');
    container.className = 'confetti-container';
    for (let i = 0; i < 90; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = (Math.random() * 0.3) + 's';
      piece.style.animationDuration = (2.2 + Math.random() * 1.8) + 's';
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      container.appendChild(piece);
    }
    document.body.appendChild(container);
    setTimeout(() => container.remove(), 5500);
  }

  function isAllDoneToday() {
    const key = todayKey();
    const allEx = state.exercises.every(ex => isComplete(ex, key));
    const challengeDone = !!state.challengeLogs[key];
    return allEx && challengeDone;
  }

  function maybeCelebrate() {
    const key = todayKey();
    if (state.celebratedToday === key) return;
    if (!isAllDoneToday()) return;
    state.celebratedToday = key;
    saveState();
    confetti();
    toast('🎉 All done today!');
  }

  function completeChallenge() {
    const key = todayKey();
    if (state.challengeLogs[key]) return;
    state.challengeLogs[key] = true;
    saveState();
    render();
    maybeCelebrate();
  }

  function renderDayHeader() {
    const now = effectiveNow();
    document.getElementById('dayLabel').textContent = 'Today';
    document.getElementById('dayDate').textContent = formatPrettyDate(now);

    const key = todayKey();
    const completed = state.exercises.filter(ex => isComplete(ex, key)).length;
    document.getElementById('completedToday').textContent = `${completed} / ${state.exercises.length}`;

    const streakEl = document.getElementById('streakStat');
    const streak = globalStreak();
    if (streak > 0) {
      document.getElementById('streakValue').textContent = streak;
      streakEl.hidden = false;
    } else {
      streakEl.hidden = true;
    }
  }

  function renderToday() {
    const list = document.getElementById('exerciseList');
    const empty = document.getElementById('emptyState');
    if (state.exercises.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    const key = todayKey();
    list.innerHTML = state.exercises.map(ex => {
      const done = ex.logs[key] || 0;
      const pct = Math.min(100, Math.round((done / ex.goal) * 100));
      const completed = done >= ex.goal;
      const streak = currentStreak(ex);
      const debt = currentDebt(ex);
      const color = colorFor(ex);

      const quickAdds = (ex.quickAdds || [5, 10, 25]).slice(0, 4);
      const firstQuick = quickAdds[0] || 5;
      const quickButtons = quickAdds.map(amt =>
        `<button class="quick-btn" data-action="add" data-id="${ex.id}" data-amount="${amt}">+${amt}</button>`
      ).join('');

      return `
        <div class="exercise-card ${completed ? 'completed' : ''}" data-id="${ex.id}">
          <div class="card-head" data-action="detail" data-id="${ex.id}">
            <div class="card-icon" style="background: ${color.soft}; color: ${color.hex};">${escapeHTML(ex.icon || '⭐')}</div>
            <div class="card-info">
              <h3 class="card-name">${escapeHTML(ex.name)}${completed ? ' <span class="card-check">✓</span>' : ''}</h3>
              <p class="card-progress-text"><strong>${done}</strong> / ${ex.goal} ${escapeHTML(ex.unit || '')}${debt > 0 ? ` <span class="card-debt">· ${debt} debt</span>` : ''}</p>
            </div>
            ${streak > 0 ? `<span class="card-streak ${streak > 0 ? 'active' : ''}">🔥 ${streak}</span>` : ''}
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${pct}%; background: ${color.hex};"></div>
          </div>
          <div class="quick-actions">
            ${quickButtons}
            <button class="quick-btn custom" data-action="custom" data-id="${ex.id}">Custom</button>
            <button class="quick-btn dec" data-action="add" data-id="${ex.id}" data-amount="-${firstQuick}" aria-label="Subtract ${firstQuick}">−${firstQuick}</button>
            ${completed ? '' : `<button class="quick-btn done" data-action="done" data-id="${ex.id}">✓ Done</button>`}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderHistory() {
    const content = document.getElementById('historyContent');
    if (state.exercises.length === 0) {
      content.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 40px 20px;">No exercises yet. Add one to see history.</p>`;
      return;
    }

    content.innerHTML = state.exercises.map(ex => {
      const color = colorFor(ex);
      const days = [];
      for (let i = 29; i >= 0; i--) {
        const d = daysAgo(i);
        const key = ymd(d);
        const done = ex.logs[key] || 0;
        const complete = done >= ex.goal;
        const partial = done > 0 && !complete;
        const isToday = i === 0;
        days.push({ key, done, complete, partial, isToday, dayNum: d.getDate() });
      }

      const completedCount = days.filter(d => d.complete).length;
      const streak = currentStreak(ex);
      const best = bestStreak(ex);

      return `
        <div class="history-card">
          <div class="history-head">
            <div class="card-icon" style="background: ${color.soft}; color: ${color.hex};">${escapeHTML(ex.icon || '⭐')}</div>
            <div>
              <h3 style="margin: 0; font-size: 16px;">${escapeHTML(ex.name)}</h3>
              <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">Goal: ${ex.goal} ${escapeHTML(ex.unit || '')}</p>
            </div>
          </div>
          <div class="calendar">
            ${days.map(d => `
              <div class="cal-cell ${d.complete ? 'completed' : d.partial ? 'partial' : ''} ${d.isToday ? 'today' : ''}"
                   title="${d.key}: ${d.done}/${ex.goal}"
                   style="${d.complete ? `background: ${color.hex};` : ''}">
                ${d.complete ? '✓' : d.partial ? d.dayNum : ''}
              </div>
            `).join('')}
          </div>
          <div class="history-stats">
            <div class="history-stat">
              <span class="history-stat-value">${completedCount}</span>
              <span class="history-stat-label">Done / 30d</span>
            </div>
            <div class="history-stat">
              <span class="history-stat-value">${streak}</span>
              <span class="history-stat-label">Current 🔥</span>
            </div>
            <div class="history-stat">
              <span class="history-stat-value">${best}</span>
              <span class="history-stat-label">Best 🏆</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderManage() {
    const list = document.getElementById('manageList');
    if (state.exercises.length === 0) {
      list.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 24px;">No exercises yet.</p>`;
      return;
    }
    list.innerHTML = state.exercises.map(ex => {
      const color = colorFor(ex);
      const debt = currentDebt(ex);
      return `
        <div class="manage-item" data-id="${ex.id}">
          <div class="card-icon" style="background: ${color.soft}; color: ${color.hex};">${escapeHTML(ex.icon || '⭐')}</div>
          <div class="info">
            <p class="info-name">${escapeHTML(ex.name)}</p>
            <p class="info-sub">${ex.goal} ${escapeHTML(ex.unit || '')} / day${ex.notificationEnabled && ex.notificationTime ? ` · ⏰ ${ex.notificationTime}` : ''}${debt > 0 ? ` · <span class="card-debt">${debt} debt</span>` : ''}</p>
          </div>
          <button class="icon-btn" data-manage="edit" data-id="${ex.id}" title="Edit">✎</button>
          <button class="icon-btn danger" data-manage="delete" data-id="${ex.id}" title="Delete">🗑</button>
        </div>
      `;
    }).join('');
  }

  function updateNotifStatus() {
    const btn = document.getElementById('enableNotifBtn');
    const hint = document.getElementById('notifStatusHint');
    if (!('Notification' in window)) {
      btn.textContent = 'Not supported';
      btn.disabled = true;
      hint.textContent = "This browser doesn't support notifications.";
      return;
    }
    const perm = Notification.permission;
    if (perm === 'granted' && state.settings.notificationsEnabled) {
      btn.textContent = 'Enabled';
      btn.classList.add('btn-secondary');
      hint.textContent = 'Reminders only fire while the app is open — iOS pauses background timers.';
    } else if (perm === 'denied') {
      btn.textContent = 'Blocked';
      btn.disabled = true;
      hint.textContent = 'Notifications are blocked in your browser settings.';
    } else {
      btn.textContent = 'Enable';
      btn.disabled = false;
      hint.textContent = 'Enable to receive in-app reminders. They only fire while the app is open.';
    }
  }

  // ------- Helpers -------
  function colorFor(ex) {
    return COLORS.find(c => c.name === ex.color) || COLORS[0];
  }
  function escapeHTML(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function uuid() {
    return 'x-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  // ------- Actions -------
  function logAmount(id, amount) {
    const ex = state.exercises.find(e => e.id === id);
    if (!ex) return;
    const key = todayKey();
    const before = ex.logs[key] || 0;
    const after = Math.max(0, before + amount);
    ex.logs[key] = after;
    saveState();
    render();
    const card = document.querySelector(`.exercise-card[data-id="${id}"]`);
    if (card) {
      card.classList.remove('card-pulse');
      void card.offsetWidth;
      card.classList.add('card-pulse');
    }
    if (amount > 0 && before < ex.goal && after >= ex.goal) {
      toast(`🎉 ${ex.name} goal hit!`);
    } else if (amount > 0) {
      toast(`+${amount} ${ex.unit || ''} ${ex.name}`);
    } else {
      toast(`Removed ${Math.abs(amount)}`);
    }
    maybeCelebrate();
  }

  function deleteExercise(id) {
    const ex = state.exercises.find(e => e.id === id);
    if (!ex) return;
    if (!confirm(`Delete "${ex.name}" and all its history? This can't be undone.`)) return;
    state.exercises = state.exercises.filter(e => e.id !== id);
    saveState();
    render();
    toast('Exercise deleted');
  }

  // ------- Edit modal -------
  let editingId = null;
  let pendingColor = COLORS[0].name;

  function openEditModal(id) {
    editingId = id;
    const isNew = !id;
    document.getElementById('editModalTitle').textContent = isNew ? 'New exercise' : 'Edit exercise';
    const ex = isNew ? null : state.exercises.find(e => e.id === id);
    document.getElementById('fieldName').value = ex?.name || '';
    document.getElementById('fieldGoal').value = ex?.goal || '';
    document.getElementById('fieldUnit').value = ex?.unit || 'reps';
    document.getElementById('fieldIcon').value = ex?.icon || '💪';
    document.getElementById('fieldQuickAdds').value = (ex?.quickAdds || [5, 10, 25]).join(', ');
    document.getElementById('fieldNotifTime').value = ex?.notificationTime || '08:00';
    document.getElementById('fieldNotifEnabled').checked = !!ex?.notificationEnabled;
    pendingColor = ex?.color || COLORS[0].name;
    renderColorOptions();
    document.getElementById('editModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('fieldName').focus(), 50);
  }

  function renderColorOptions() {
    const wrap = document.getElementById('colorOptions');
    wrap.innerHTML = COLORS.map(c => `
      <button type="button" class="color-swatch ${c.name === pendingColor ? 'selected' : ''}"
              data-color="${c.name}" style="background: ${c.hex};" aria-label="${c.name}"></button>
    `).join('');
  }

  function closeEditModal() {
    document.getElementById('editModal').classList.add('hidden');
    editingId = null;
  }

  // ------- Detail modal -------
  function openDetail(id) {
    const ex = state.exercises.find(e => e.id === id);
    if (!ex) return;
    const color = colorFor(ex);
    const key = todayKey();
    const done = ex.logs[key] || 0;
    const pct = Math.min(100, Math.round((done / ex.goal) * 100));
    const debt = currentDebt(ex);

    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = daysAgo(i);
      const k = ymd(d);
      const dDone = ex.logs[k] || 0;
      days.push({
        key: k, done: dDone,
        complete: dDone >= ex.goal,
        partial: dDone > 0 && dDone < ex.goal,
        isToday: i === 0,
        dayNum: d.getDate(),
      });
    }

    document.getElementById('detailContent').innerHTML = `
      <div class="detail-head">
        <div class="card-icon" style="background: ${color.soft}; color: ${color.hex};">${escapeHTML(ex.icon || '⭐')}</div>
        <div>
          <h3 class="detail-name">${escapeHTML(ex.name)}</h3>
          <p class="detail-meta">Goal: ${ex.goal} ${escapeHTML(ex.unit || '')} per day</p>
        </div>
      </div>
      <div class="progress-bar" style="margin-bottom:8px;">
        <div class="progress-fill" style="width:${pct}%; background:${color.hex};"></div>
      </div>
      <p style="text-align:center; margin: 0 0 16px; font-size:14px; color: var(--text-muted);">
        <strong style="color:var(--text); font-size:18px;">${done}</strong> / ${ex.goal} today
      </p>
      ${debt > 0 ? `<div class="detail-debt-banner">⚠ ${debt} ${escapeHTML(ex.unit || '')} in debt — log extra to pay it down</div>` : ''}
      <div class="detail-stats">
        <div class="detail-stat">
          <span class="detail-stat-value">${currentStreak(ex)}</span>
          <span class="detail-stat-label">Current 🔥</span>
        </div>
        <div class="detail-stat">
          <span class="detail-stat-value">${bestStreak(ex)}</span>
          <span class="detail-stat-label">Best 🏆</span>
        </div>
        <div class="detail-stat">
          <span class="detail-stat-value">${days.filter(d => d.complete).length}</span>
          <span class="detail-stat-label">Done / 30d</span>
        </div>
      </div>
      <h4 style="margin: 0 0 8px; font-size:13px; color: var(--text-muted); text-transform:uppercase; letter-spacing:0.06em;">Last 30 days</h4>
      <div class="calendar">
        ${days.map(d => `
          <div class="cal-cell ${d.complete ? 'completed' : d.partial ? 'partial' : ''} ${d.isToday ? 'today' : ''}"
               title="${d.key}: ${d.done}/${ex.goal}"
               style="${d.complete ? `background:${color.hex};` : ''}">
            ${d.complete ? '✓' : d.partial ? d.dayNum : ''}
          </div>
        `).join('')}
      </div>
    `;
    document.getElementById('detailModal').classList.remove('hidden');
  }

  function closeDetail() {
    document.getElementById('detailModal').classList.add('hidden');
  }

  // ------- Custom-log modal -------
  let logTargetId = null;
  function openLogModal(id) {
    logTargetId = id;
    const ex = state.exercises.find(e => e.id === id);
    if (!ex) return;
    document.getElementById('logModalTitle').textContent = `Log ${ex.name}`;
    document.getElementById('logAmount').value = '';
    document.getElementById('logModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('logAmount').focus(), 50);
  }
  function closeLogModal() {
    document.getElementById('logModal').classList.add('hidden');
    logTargetId = null;
  }

  // ------- Notifications -------
  async function requestNotifications() {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      state.settings.notificationsEnabled = true;
      saveState();
      toast('Notifications enabled');
      new Notification('Hero Training', { body: 'Reminders will fire while the app is open.' });
    } else {
      toast('Permission not granted');
    }
    updateNotifStatus();
  }

  // Foreground reminder loop. Fires once per (exercise, day) at scheduled time.
  const firedToday = new Set();
  function notifKey(exId, key) { return `${exId}|${key}`; }

  function checkReminders() {
    if (!state.settings.notificationsEnabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date();
    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const cur = `${hh}:${mm}`;
    const key = todayKey();
    for (const ex of state.exercises) {
      if (!ex.notificationEnabled || !ex.notificationTime) continue;
      if (ex.notificationTime !== cur) continue;
      const k = notifKey(ex.id, key);
      if (firedToday.has(k)) continue;
      if (isComplete(ex, key)) { firedToday.add(k); continue; }
      const done = ex.logs[key] || 0;
      try {
        new Notification(`Time for ${ex.name}`, {
          body: `${done}/${ex.goal} ${ex.unit || ''} so far today`,
          icon: 'icon.png',
          tag: k,
        });
        firedToday.add(k);
      } catch (e) {
        console.warn('Notification failed', e);
      }
    }
  }

  // Clear firedToday and re-render at the day rollover so the new day appears.
  function scheduleRolloverReset() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(ROLLOVER_HOUR, 0, 30, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next - now;
    setTimeout(() => {
      firedToday.clear();
      render();
      scheduleRolloverReset();
    }, ms);
  }

  // ------- Event wiring -------
  function init() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        tab.classList.add('active');
        document.querySelector(`.view[data-view="${tab.dataset.view}"]`).classList.add('active');
      });
    });

    // Today view click delegation
    document.getElementById('exerciseList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'add') {
        logAmount(id, Number(btn.dataset.amount));
      } else if (action === 'custom') {
        openLogModal(id);
      } else if (action === 'done') {
        const ex = state.exercises.find(x => x.id === id);
        if (ex) {
          const cur = ex.logs[todayKey()] || 0;
          const remaining = Math.max(0, ex.goal - cur);
          if (remaining > 0) logAmount(id, remaining);
        }
      } else if (action === 'detail') {
        openDetail(id);
      }
    });

    // Daily challenge click delegation
    document.getElementById('dailyChallenge').addEventListener('click', (e) => {
      if (e.target.closest('[data-action="challenge-done"]')) completeChallenge();
    });

    // Manage delegation
    document.getElementById('manageList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-manage]');
      if (!btn) return;
      if (btn.dataset.manage === 'edit') openEditModal(btn.dataset.id);
      if (btn.dataset.manage === 'delete') deleteExercise(btn.dataset.id);
    });

    document.getElementById('addExerciseBtn').addEventListener('click', () => openEditModal(null));
    document.getElementById('emptyAddBtn').addEventListener('click', () => openEditModal(null));

    // Modal close
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const which = btn.dataset.close;
        if (which === 'edit') closeEditModal();
        if (which === 'detail') closeDetail();
        if (which === 'log') closeLogModal();
      });
    });
    // Click outside modal to close
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
      });
    });
    document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
    document.getElementById('logCancelBtn').addEventListener('click', closeLogModal);

    // Color picker delegation
    document.getElementById('colorOptions').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-color]');
      if (!btn) return;
      pendingColor = btn.dataset.color;
      renderColorOptions();
    });

    // Edit form submit
    document.getElementById('editForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('fieldName').value.trim();
      const goal = parseInt(document.getElementById('fieldGoal').value, 10);
      const unit = document.getElementById('fieldUnit').value.trim();
      const icon = document.getElementById('fieldIcon').value.trim() || '⭐';
      const quickAddsRaw = document.getElementById('fieldQuickAdds').value;
      const quickAdds = quickAddsRaw.split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n) && n > 0)
        .slice(0, 4);
      const notificationTime = document.getElementById('fieldNotifTime').value || '';
      const notificationEnabled = document.getElementById('fieldNotifEnabled').checked;

      if (!name || !goal || goal < 1) return;

      if (editingId) {
        const ex = state.exercises.find(e => e.id === editingId);
        if (ex) {
          Object.assign(ex, {
            name, goal, unit, icon, color: pendingColor,
            quickAdds: quickAdds.length ? quickAdds : [5, 10, 25],
            notificationTime, notificationEnabled,
          });
        }
        toast('Saved');
      } else {
        state.exercises.push({
          id: uuid(),
          name, goal, unit, icon, color: pendingColor,
          quickAdds: quickAdds.length ? quickAdds : [5, 10, 25],
          notificationTime, notificationEnabled,
          createdAt: new Date().toISOString(),
          logs: {},
        });
        toast('Exercise added');
        // Jump to Today view to show it
        document.querySelector('.tab[data-view="today"]').click();
      }
      saveState();
      render();
      closeEditModal();
    });

    // Log form submit
    document.getElementById('logForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const amount = parseInt(document.getElementById('logAmount').value, 10);
      if (!Number.isFinite(amount) || amount < 1) return;
      if (logTargetId) logAmount(logTargetId, amount);
      closeLogModal();
    });

    // Notifications
    document.getElementById('enableNotifBtn').addEventListener('click', requestNotifications);

    // Data export / import / reset
    document.getElementById('exportBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hero-training-${todayKey()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Exported');
    });
    document.getElementById('importBtn').addEventListener('click', () => {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.exercises)) throw new Error('Invalid file');
        if (!confirm('Replace current data with this backup?')) return;
        state = {
          exercises: data.exercises,
          challengeLogs: data.challengeLogs || {},
          celebratedToday: data.celebratedToday || '',
          settings: data.settings || { notificationsEnabled: false },
        };
        saveState();
        render();
        toast('Imported');
      } catch (err) {
        alert('Could not import: ' + err.message);
      } finally {
        e.target.value = '';
      }
    });
    document.getElementById('resetBtn').addEventListener('click', () => {
      if (!confirm('Delete ALL exercises and history? This cannot be undone.')) return;
      state = defaultState();
      saveState();
      render();
      toast('Reset complete');
    });

    // Esc closes modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
      }
    });

    render();

    // Reminder loop — check once a minute, aligned to start of minute.
    const tick = () => { checkReminders(); };
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    setTimeout(() => {
      tick();
      setInterval(tick, 60 * 1000);
    }, msToNextMinute);
    // Also check immediately so a reload at the right minute still fires.
    tick();

    scheduleRolloverReset();

    // Service worker — for offline caching. Best effort; won't break anything.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
