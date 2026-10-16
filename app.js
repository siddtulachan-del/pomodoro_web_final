(() => {
  'use strict';

  const DEFAULT_SETTINGS = {
    sprint: 25, sprints: 3, brk: 5, longBrk: 15, longEvery: 4,
    goal: 6, theme: 'system', notifications: false, sound: true, volume: 0.2,
  };
  const LIMITS = {
    sprint: [15, 90], sprints: [1, 8], brk: [5, 30], longBrk: [10, 45],
    longEvery: [2, 8], goal: [1, 12],
  };
  const PRESETS = {
    '25-5': { sprint: 25, brk: 5 },
    '50-10': { sprint: 50, brk: 10 },
    '52-17': { sprint: 52, brk: 17 },
    '90-20': { sprint: 90, brk: 20 },
  };
  const CIRCUMFERENCE = 2 * Math.PI * 150;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const todayKey = () => dateKey(new Date());

  function readStorage(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
    } catch (error) {
      console.warn(`Could not read ${key} from local storage.`, error);
      return fallback;
    }
  }

  function saveStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Could not save ${key} to local storage.`, error);
    }
  }

  function bounded(value, key, fallback) {
    const [min, max] = LIMITS[key];
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(max, Math.max(min, Math.round(number)))
      : fallback;
  }

  function loadSettings() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem('pomodoro.settings') || 'null');
    } catch (error) {
      console.warn('Saved settings could not be parsed; using defaults.', error);
    }
    const saved = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const settings = { ...DEFAULT_SETTINGS, ...saved };
    const presetName = document.body.dataset.preset;
    if (!Object.keys(saved).length && PRESETS[presetName]) {
      Object.assign(settings, PRESETS[presetName], { sprints: 4 });
    }
    Object.keys(LIMITS).forEach(key => {
      settings[key] = bounded(settings[key], key, DEFAULT_SETTINGS[key]);
    });
    $('#theme').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = $$('#theme button');
      const selected = buttons.findIndex(button => button.dataset.theme === settings.theme);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (selected + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
      event.preventDefault();
      buttons[index].focus();
      buttons[index].click();
    });
    if (!['light', 'dark', 'system'].includes(settings.theme)) settings.theme = 'system';
    settings.notifications = settings.notifications === true;
    settings.sound = settings.sound !== false;
    settings.volume = Math.min(1, Math.max(0, Number(settings.volume) || 0));
    return settings;
  }

  let settings = loadSettings();
  let history = readStorage('pomodoro.history', {});
  if (!history || typeof history !== 'object' || Array.isArray(history)) history = {};
  const oldState = readStorage('pomodoro.state', {});
  const validHistory = Object.values(history).filter(record => record && typeof record === 'object');
  const oldFocusTotal = validHistory.reduce((total, record) =>
    total + (Number.isFinite(record.sprints) ? Math.max(0, record.sprints) : 0), 0);
  const state = {
    phase: oldState.phase === 'break' || oldState.phase === 'longBreak'
      ? oldState.phase : 'focus',
    idx: bounded(oldState.idx, 'sprints', 1),
    remaining: Number.isFinite(oldState.remaining)
      ? Math.max(0, Math.round(oldState.remaining)) : settings.sprint * 60,
    running: oldState.running === true && Number.isFinite(oldState.endAt) && oldState.endAt > 0,
    endAt: Number.isFinite(oldState.endAt) ? oldState.endAt : 0,
    day: typeof oldState.day === 'string' ? oldState.day : new Date().toDateString(),
    done: Number.isFinite(oldState.done) ? Math.max(0, Math.round(oldState.done)) : 0,
    focusRounds: Number.isFinite(oldState.focusRounds) ? Math.max(0, Math.round(oldState.focusRounds)) : oldFocusTotal,
    task: typeof oldState.task === 'string' ? oldState.task.slice(0, 120) : '',
  };

  const el = {
    time: $('#time'), phase: $('#phase'), dots: $('#dots'), ring: $('#ring-progress'),
    play: $('#play'), playIcon: $('#play-icon'), skip: $('#skip'), tabs: $('.tabs'),
    sumTotal: $('#sum-total'), sumSub: $('#sum-sub'), sumBar: $('#sum-bar'),
    task: $('#task'), historyList: $('#history-list'), chart: $('#chart'),
    notifications: $('#notifications'), notificationHint: $('#notification-hint'),
    sound: $('#sound-toggle'), soundHint: $('#sound-hint'), volume: $('#volume'),
    volumeValue: $('#volume-value'), focusToggle: $('#focus-toggle'), focusExit: $('#focus-exit'),
  };
  const PLAY_PATH = 'M8 5v14l11-7z';
  const PAUSE_PATH = 'M6 5h4v14H6zM14 5h4v14h-4z';
  let ticker = null;
  let audioContext = null;
  let audioError = false;

  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function phaseSeconds(phase = state.phase) {
    const minutes = phase === 'focus' ? settings.sprint
      : phase === 'longBreak' ? settings.longBrk : settings.brk;
    return minutes * 60;
  }

  function persist() {
    saveStorage('pomodoro.settings', settings);
    saveStorage('pomodoro.state', state);
  }

  function persistHistory() {
    saveStorage('pomodoro.history', history);
  }

  function historyRecord(key) {
    const record = history[key] && typeof history[key] === 'object' ? history[key] : {};
    record.sprints = Number.isFinite(record.sprints) ? Math.max(0, record.sprints) : 0;
    record.sessions = Number.isFinite(record.sessions) ? Math.max(0, record.sessions) : 0;
    record.breaks = Number.isFinite(record.breaks) ? Math.max(0, record.breaks) : 0;
    record.longBreaks = Number.isFinite(record.longBreaks) ? Math.max(0, record.longBreaks) : 0;
    record.focus = Array.isArray(record.focus) ? record.focus.filter(item =>
      item && Number.isFinite(item.minutes) && item.minutes >= 0).map(item => ({
      label: typeof item.label === 'string' ? item.label : '',
      minutes: item.minutes,
    })) : [];
    if (record.focus.length < record.sprints) {
      const missing = record.sprints - record.focus.length;
      record.focus.unshift(...Array.from({ length: missing }, () => ({
        label: '', minutes: settings.sprint,
      })));
    }
    history[key] = record;
    return record;
  }

  Object.keys(history)
    .filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key))
    .forEach(historyRecord);

  function focusEntries(record) {
    if (Array.isArray(record.focus) && record.focus.length) return record.focus;
    const count = Number.isFinite(record.sprints) ? Math.max(0, record.sprints) : 0;
    return Array.from({ length: count }, () => ({ label: '', minutes: settings.sprint }));
  }

  function rollDay() {
    if (state.day !== new Date().toDateString()) {
      state.day = new Date().toDateString();
      const today = history[todayKey()];
      state.done = today && Number.isFinite(today.sessions) ? today.sessions : 0;
    }
  }

  function setPhase(phase, autoRun, at = Date.now()) {
    state.phase = phase;
    state.remaining = phaseSeconds(phase);
    state.running = autoRun;
    if (autoRun) state.endAt = at + state.remaining * 1000;
    else {
      state.endAt = 0;
      clearInterval(ticker);
    }
  }

  function createAudioContext() {
    if (!settings.sound) return;
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      el.soundHint.textContent = 'Sound is not supported in this browser.';
      return;
    }
    try {
      audioContext = audioContext || new AudioContextConstructor();
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(error => {
          audioError = true;
          el.soundHint.textContent = 'Sound could not be started in this browser.';
          console.warn('Audio could not be resumed.', error);
        });
      }
      audioError = false;
      el.soundHint.textContent = 'Play a tone when a phase ends';
    } catch (error) {
      audioError = true;
      el.soundHint.textContent = 'Sound could not be started in this browser.';
      console.warn('Audio is unavailable.', error);
    }
  }

  function beep() {
    if (!settings.sound || !audioContext || audioError || settings.volume <= 0) return;
    [0, 0.25, 0.5].forEach(offset => {
      try {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.frequency.value = 880;
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        const at = audioContext.currentTime + offset;
        gain.gain.setValueAtTime(settings.volume, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
        oscillator.start(at);
        oscillator.stop(at + 0.2);
      } catch (error) {
        console.warn('The phase-end sound could not be played.', error);
      }
    });
    if (navigator.vibrate) navigator.vibrate(160);
  }

  function notifyPhase(phase) {
    if (!settings.notifications || !('Notification' in window)
        || Notification.permission !== 'granted') return;
    const next = phase === 'focus' ? 'Break' : 'Focus';
    try {
      new Notification(`${phase === 'focus' ? 'Focus round' : phase === 'longBreak' ? 'Long break' : 'Break'} complete`, {
        body: `Time for your next ${next.toLowerCase()} phase.`,
        icon: '/icons/icon-192.svg',
        tag: 'pomodoro-phase',
      });
    } catch (error) {
      el.notificationHint.textContent = 'Notifications could not be shown by this browser.';
      console.warn('The phase notification could not be shown.', error);
    }
  }

  function completePhase({ skipped = false, at = Date.now(), notify = true, sound = true } = {}) {
    const completedPhase = state.phase;
    if (!skipped) {
      if (sound) beep();
      if (notify) notifyPhase(completedPhase);
    }
    if (completedPhase === 'focus') {
      const key = dateKey(new Date(at));
      const cycleComplete = state.idx >= settings.sprints;
      if (!skipped) {
        const record = historyRecord(key);
        record.sprints += 1;
        record.focus.push({ label: state.task.trim(), minutes: settings.sprint });
        state.focusRounds += 1;
        if (cycleComplete) {
          record.sessions += 1;
          if (key === todayKey()) state.done += 1;
        }
        persistHistory();
      }

      state.idx = cycleComplete ? 1 : Math.min(settings.sprints, state.idx + 1);
      const longDue = !skipped && state.focusRounds > 0
        && state.focusRounds % settings.longEvery === 0;
      if (longDue) {
        setPhase('longBreak', true, at);
      } else if (cycleComplete) {
        setPhase('focus', false, at);
      } else {
        setPhase('break', true, at);
      }
    } else {
      if (!skipped) {
        const record = historyRecord(dateKey(new Date(at)));
        record.breaks += 1;
        if (completedPhase === 'longBreak') record.longBreaks += 1;
        persistHistory();
      }
      setPhase('focus', true, at);
    }
    rollDay();
    persist();
    render();
  }

  function tick() {
    if (!state.running) return;
    const now = Date.now();
    let transitions = 0;
    while (state.running && state.endAt <= now && transitions < 100) {
      const endedAt = state.endAt;
      const recent = endedAt > now - 60_000;
      completePhase({ at: endedAt, notify: recent, sound: recent });
      transitions += 1;
    }
    if (state.running) state.remaining = Math.max(0, Math.ceil((state.endAt - now) / 1000));
    rollDay();
    render();
  }

  function start() {
    rollDay();
    createAudioContext();
    if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(error => {
      audioError = true;
      console.warn('Audio could not be resumed from the start action.', error);
    });
    state.running = true;
    state.endAt = Date.now() + state.remaining * 1000;
    clearInterval(ticker);
    ticker = setInterval(tick, 250);
    persist();
    render();
  }

  function pause() {
    state.remaining = Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000));
    state.running = false;
    state.endAt = 0;
    clearInterval(ticker);
    persist();
    render();
  }

  function resetTimer() {
    if (!window.confirm('Reset this cycle and return to a fresh focus round?')) return;
    state.idx = 1;
    setPhase('focus', false);
    persist();
    render();
  }

  function formatTime(seconds) {
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function renderTimer() {
    const total = phaseSeconds();
    const progress = 1 - state.remaining / total;
    const isBreak = state.phase !== 'focus';
    el.time.textContent = formatTime(state.remaining);
    el.phase.textContent = state.phase === 'focus' ? 'Focus'
      : state.phase === 'longBreak' ? 'Long break' : 'Break';
    document.body.classList.toggle('on-break', isBreak);
    el.ring.style.strokeDashoffset = state.running || progress > 0
      ? CIRCUMFERENCE * (1 - progress) : CIRCUMFERENCE;
    document.body.classList.toggle('timer-running', state.running);
    el.playIcon.setAttribute('d', state.running ? PAUSE_PATH : PLAY_PATH);
    el.play.setAttribute('aria-label', state.running ? 'Pause timer' : 'Start timer');
    el.skip.hidden = !state.running;
    el.tabs.classList.toggle('is-running', state.running);
    if (el.dots.children.length !== settings.goal) {
      el.dots.replaceChildren(...Array.from({ length: settings.goal }, () => {
        const dot = document.createElement('i');
        dot.setAttribute('aria-hidden', 'true');
        return dot;
      }));
    }
    [...el.dots.children].forEach((dot, index) =>
      dot.classList.toggle('done', index < state.done));
    el.dots.title = `${state.done} of ${settings.goal} cycles today`;
    el.dots.setAttribute('aria-label', `${state.done} of ${settings.goal} cycles completed toward today's goal`);
    el.dots.setAttribute('aria-valuemax', String(settings.goal));
    el.dots.setAttribute('aria-valuenow', String(Math.min(state.done, settings.goal)));
    const favicon = $('#favicon');
    if (favicon) favicon.href = `/icons/favicon-${isBreak ? 'break' : 'focus'}.svg`;
    document.title = state.running
      ? `${formatTime(state.remaining)} · ${el.phase.textContent}`
      : document.body.dataset.pageTitle || 'Pomodoro Timer | Free Focus Timer';
  }

  function presetForCurrentSettings() {
    return Object.entries(PRESETS).find(([, preset]) =>
      settings.sprint === preset.sprint && settings.brk === preset.brk
      && settings.sprints === 4)?.[0] || 'custom';
  }

  function renderSettings() {
    const focus = settings.sprints * settings.sprint;
    let rest = 0;
    for (let round = 1; round <= settings.sprints; round += 1) {
      const longDue = (state.focusRounds + round) % settings.longEvery === 0;
      if (longDue) rest += settings.longBrk;
      else if (round < settings.sprints) rest += settings.brk;
    }
    const total = focus + rest;
    el.sumTotal.textContent = total >= 60
      ? `${Math.floor(total / 60)}h ${total % 60}m` : `${total}m`;
    el.sumSub.textContent = `${focus} min focus, ${rest} min breaks`;

    const segments = [];
    for (let round = 1; round <= settings.sprints; round += 1) {
      segments.push({ type: 'focus', minutes: settings.sprint });
      const longDue = (state.focusRounds + round) % settings.longEvery === 0;
      if (longDue) segments.push({ type: 'long-rest', minutes: settings.longBrk });
      else if (round < settings.sprints) segments.push({ type: 'rest', minutes: settings.brk });
    }
    el.sumBar.replaceChildren(...segments.map(segment => {
      const span = document.createElement('span');
      span.className = segment.type;
      span.style.flex = segment.minutes;
      return span;
    }));

    $$('.stepper').forEach(stepper => {
      const key = stepper.dataset.key;
      const [min, max] = LIMITS[key];
      const input = $('[data-value]', stepper);
      if (document.activeElement !== input) input.value = settings[key];
      input.min = min;
      input.max = max;
      $('[data-d="-1"]', stepper).disabled = settings[key] <= min;
      $('[data-d="1"]', stepper).disabled = settings[key] >= max;
    });
    $$('#theme button').forEach(button =>
      {
        const selected = button.dataset.theme === settings.theme;
        button.setAttribute('aria-checked', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
    $$('#presets button').forEach(button => {
      const selected = button.dataset.preset === presetForCurrentSettings();
      button.setAttribute('aria-pressed', String(selected));
    });
    el.notifications.checked = settings.notifications;
    el.sound.checked = settings.sound;
    el.volume.value = String(settings.volume);
    el.volumeValue.value = `${Math.round(settings.volume * 100)}%`;
    el.volumeValue.textContent = el.volumeValue.value;
    updateNotificationHint();
  }

  function updateNotificationHint() {
    if (!('Notification' in window)) {
      el.notificationHint.textContent = 'Notifications are not supported in this browser.';
    } else if (Notification.permission === 'denied') {
      el.notificationHint.textContent = 'Notifications are blocked. Change this site’s permission in your browser settings.';
    } else {
      el.notificationHint.textContent = settings.notifications
        ? 'Notifications are enabled.' : 'Notifications are off.';
    }
  }

  function totalMinutes(record) {
    return focusEntries(record).reduce((total, item) => total + item.minutes, 0);
  }

  function minutesBetween(start, end) {
    return Object.entries(history).reduce((total, [key, record]) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && key >= start && key <= end
          && record && typeof record === 'object') return total + totalMinutes(record);
      return total;
    }, 0);
  }

  function formatMinutes(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
  }

  function getStreaks() {
    const dates = Object.entries(history)
      .filter(([key, record]) => /^\d{4}-\d{2}-\d{2}$/.test(key)
        && record && (record.sprints > 0 || (Array.isArray(record.focus) && record.focus.length)))
      .map(([key]) => key)
      .sort();
    const set = new Set(dates);
    let current = 0;
    const today = new Date();
    const todayString = dateKey(today);
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    let cursor = set.has(todayString) ? today : yesterday;
    while (set.has(dateKey(cursor))) {
      current += 1;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    }
    let best = 0, run = 0, previousDay = null;
    dates.forEach(key => {
      const [year, month, day] = key.split('-').map(Number);
      const currentDay = Date.UTC(year, month - 1, day) / 86_400_000;
      run = previousDay === currentDay - 1 ? run + 1 : 1;
      best = Math.max(best, run);
      previousDay = currentDay;
    });
    return { current, best };
  }

  function renderChart() {
    const days = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const key = dateKey(date);
      const record = history[key];
      days.push({
        key,
        day: date.toLocaleDateString(undefined, { weekday: 'short' }),
        minutes: record && typeof record === 'object' ? totalMinutes(record) : 0,
      });
    }
    const max = Math.max(1, ...days.map(day => day.minutes));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 700 230');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Focus time over the last seven days: ${days.map(day => `${day.day}, ${day.minutes} minutes`).join('; ')}`);
    svg.classList.add('week-chart');
    const baseline = document.createElementNS(svg.namespaceURI, 'line');
    baseline.setAttribute('x1', '28'); baseline.setAttribute('x2', '672');
    baseline.setAttribute('y1', '184'); baseline.setAttribute('y2', '184');
    baseline.setAttribute('class', 'chart-baseline'); svg.append(baseline);
    days.forEach((day, index) => {
      const x = 48 + index * 92;
      const height = day.minutes ? Math.max(4, day.minutes / max * 135) : 0;
      const rect = document.createElementNS(svg.namespaceURI, 'rect');
      rect.setAttribute('x', String(x)); rect.setAttribute('y', String(184 - height));
      rect.setAttribute('width', '44'); rect.setAttribute('height', String(height));
      rect.setAttribute('rx', '8'); rect.setAttribute('class', 'chart-bar');
      const title = document.createElementNS(svg.namespaceURI, 'title');
      title.textContent = `${day.key}: ${formatMinutes(day.minutes)}`;
      rect.append(title); svg.append(rect);
      const dayLabel = document.createElementNS(svg.namespaceURI, 'text');
      dayLabel.setAttribute('x', String(x + 22)); dayLabel.setAttribute('y', '210');
      dayLabel.setAttribute('text-anchor', 'middle'); dayLabel.setAttribute('class', 'chart-label');
      dayLabel.textContent = day.day; svg.append(dayLabel);
      if (day.minutes) {
        const value = document.createElementNS(svg.namespaceURI, 'text');
        value.setAttribute('x', String(x + 22)); value.setAttribute('y', String(Math.max(18, 174 - height)));
        value.setAttribute('text-anchor', 'middle'); value.setAttribute('class', 'chart-value');
        value.textContent = `${day.minutes}m`; svg.append(value);
      }
    });
    const table = document.createElement('table');
    table.className = 'sr-only';
    const caption = document.createElement('caption'); caption.textContent = 'Daily focus minutes for the last seven days';
    const body = document.createElement('tbody');
    days.forEach(day => {
      const row = document.createElement('tr');
      [day.key, `${day.minutes} minutes`].forEach(text => {
        const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
      });
      body.append(row);
    });
    table.append(caption, body);
    el.chart.replaceChildren(svg, table);
  }

  function renderHistory() {
    const entries = Object.entries(history)
      .filter(([key, record]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && record && typeof record === 'object')
      .sort(([left], [right]) => right.localeCompare(left));
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = 'Completed focus rounds and task labels will appear here.';
      el.historyList.replaceChildren(empty);
      return;
    }
    el.historyList.replaceChildren(...entries.map(([key, record]) => {
      const row = document.createElement('article');
      row.className = 'history-row';
      const info = document.createElement('div');
      const date = document.createElement('h3');
      date.className = 'history-date';
      date.textContent = new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      const tasks = document.createElement('ul');
      tasks.className = 'task-history';
      focusEntries(record).forEach(item => {
        const task = document.createElement('li');
        task.textContent = `${item.label || 'Focus round'} · ${item.minutes} min`;
        tasks.append(task);
      });
      info.append(date);
      if (tasks.childElementCount) info.append(tasks);
      const totals = document.createElement('span');
      totals.className = 'history-totals';
      const rounds = Number.isFinite(record.sprints) ? record.sprints : 0;
      const cycles = Number.isFinite(record.sessions) ? record.sessions : 0;
      const breaks = Number.isFinite(record.breaks) ? record.breaks : 0;
      const longBreaks = Number.isFinite(record.longBreaks) ? record.longBreaks : 0;
      totals.textContent = `${rounds} focus ${rounds === 1 ? 'round' : 'rounds'} · ${cycles} ${cycles === 1 ? 'cycle' : 'cycles'} · ${formatMinutes(totalMinutes(record))} · ${breaks} breaks (${longBreaks} long)`;
      row.append(info, totals);
      return row;
    }));
  }

  function renderStats() {
    const today = todayKey();
    const date = new Date();
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
    const todayRecord = history[today];
    const streaks = getStreaks();
    $('#stat-today').textContent = formatMinutes(todayRecord ? totalMinutes(todayRecord) : 0);
    $('#stat-week').textContent = formatMinutes(minutesBetween(dateKey(monday), today));
    $('#stat-all').textContent = formatMinutes(minutesBetween('0000-01-01', '9999-12-31'));
    $('#stat-current-streak').textContent = `${streaks.current} ${streaks.current === 1 ? 'day' : 'days'}`;
    $('#stat-best-streak').textContent = `${streaks.best} ${streaks.best === 1 ? 'day' : 'days'}`;
    renderChart();
    renderHistory();
  }

  function applyTheme() {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
    document.documentElement.dataset.theme = theme;
    const themeColor = theme === 'dark' ? '#191a1b' : '#f7f6f3';
    $$('meta[name="theme-color"]').forEach(meta => meta.setAttribute('content', themeColor));
  }

  function navigateTo(viewName) {
    const view = ['timer', 'settings', 'stats'].includes(viewName) ? viewName : 'timer';
    $$('.tab').forEach(tab => {
      const active = tab.dataset.view === view;
      tab.classList.toggle('active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    $$('.view').forEach(section => { section.hidden = section.id !== `view-${view}`; });
    if (view === 'settings') renderSettings();
    if (view === 'stats') renderStats();
    if (view === 'timer') renderTimer();
  }

  function downloadFile(filename, contents, type) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJSON() {
    const data = {
      exportedAt: new Date().toISOString(),
      settings,
      history,
      state,
    };
    downloadFile('tomato-time-data.json', JSON.stringify(data, null, 2), 'application/json');
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isValidImport(data) {
    if (!isRecord(data) || !isRecord(data.settings) || !isRecord(data.state) || !isRecord(data.history)) {
      return false;
    }
    const stateFields = data.state;
    if (!['focus', 'break', 'longBreak'].includes(stateFields.phase)
      || !Number.isFinite(stateFields.idx)
      || !Number.isFinite(stateFields.remaining)
      || typeof stateFields.running !== 'boolean'
      || !Number.isFinite(stateFields.endAt)
      || typeof stateFields.day !== 'string'
      || !Number.isFinite(stateFields.done)
      || !Number.isFinite(stateFields.focusRounds)
      || typeof stateFields.task !== 'string') {
      return false;
    }
    return Object.entries(data.history).every(([key, record]) =>
      /^\d{4}-\d{2}-\d{2}$/.test(key)
      && isRecord(record)
      && ['sprints', 'sessions', 'breaks', 'longBreaks'].every(field =>
        record[field] === undefined
        || (Number.isSafeInteger(record[field]) && record[field] >= 0))
      && (record.focus === undefined
        || (Array.isArray(record.focus) && record.focus.every(item =>
          isRecord(item)
          && typeof item.label === 'string'
          && Number.isFinite(item.minutes)
          && item.minutes >= 0))));
  }

  async function importJSON(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (error) {
      console.warn('Could not read or parse JSON backup.', error);
      window.alert('Could not read this file as JSON. Choose a valid Tomato Time JSON export.');
      return;
    }
    if (!isValidImport(data)) {
      window.alert('This file is not a valid Tomato Time JSON backup.');
      return;
    }
    if (!window.confirm('Importing this backup will replace your timer settings, current timer, and stats in this browser. Continue?')) {
      return;
    }

    const imported = {
      'pomodoro.settings': JSON.stringify(data.settings),
      'pomodoro.state': JSON.stringify(data.state),
      'pomodoro.history': JSON.stringify(data.history),
    };
    const previous = {};
    try {
      Object.keys(imported).forEach(key => {
        previous[key] = localStorage.getItem(key);
      });
    } catch (error) {
      console.error('Could not read current data before importing backup.', error);
      window.alert('Could not access browser storage. No data was changed.');
      return;
    }

    try {
      Object.entries(imported).forEach(([key, value]) => localStorage.setItem(key, value));
    } catch (error) {
      console.error('Could not save imported backup to browser storage.', error);
      let restored = true;
      try {
        Object.entries(previous).forEach(([key, value]) => {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        });
      } catch (restoreError) {
        restored = false;
        console.error('Could not fully restore browser data after import failed.', restoreError);
      }
      window.alert(restored
        ? 'Could not save the backup to browser storage. Your existing data was restored.'
        : 'Could not save the backup, and your existing data may not have been fully restored. Reload before continuing.');
      return;
    }
    window.location.reload();
  }

  function clearData() {
    if (!window.confirm('Clear all timer settings, task labels, and stats from this browser? This cannot be undone.')) return;
    Object.keys(localStorage)
      .filter(key => key.startsWith('pomodoro.'))
      .forEach(key => localStorage.removeItem(key));
    window.location.reload();
  }

  function toggleFocusMode(active) {
    document.body.classList.toggle('focus-mode', active);
    el.focusToggle.hidden = active;
    el.focusExit.hidden = !active;
    if (!active && document.fullscreenElement) {
      document.exitFullscreen().catch(error => console.warn('Could not exit fullscreen.', error));
    }
  }

  async function enterFocusMode() {
    toggleFocusMode(true);
    if (document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (error) {
        console.warn('Fullscreen is unavailable; using focus mode instead.', error);
      }
    }
  }

  function render() {
    renderTimer();
    if (!$('#view-settings').hidden) renderSettings();
    if (!$('#view-stats').hidden) renderStats();
  }

  el.play.addEventListener('click', () => state.running ? pause() : start());
  $('#skip').addEventListener('click', () => completePhase({ skipped: true }));
  $('#reset').addEventListener('click', resetTimer);
  $('#reset-cycle-settings').addEventListener('click', resetTimer);
  el.task.value = state.task;
  el.task.addEventListener('input', () => {
    state.task = el.task.value.slice(0, 120);
    persist();
  });

  function updateStepperSetting(key, value) {
    settings[key] = bounded(value, key, settings[key]);
    if (key === 'sprints' && state.idx > settings.sprints) state.idx = settings.sprints;
    if (!state.running && ((key === 'sprint' && state.phase === 'focus')
      || (key === 'brk' && state.phase === 'break')
      || (key === 'longBrk' && state.phase === 'longBreak'))) {
      state.remaining = phaseSeconds();
    }
    persist();
    renderSettings();
    render();
  }

  $$('.stepper').forEach(stepper => {
    stepper.addEventListener('click', event => {
      const button = event.target.closest('button[data-d]');
      if (!button) return;
      const key = stepper.dataset.key;
      updateStepperSetting(key, settings[key] + Number(button.dataset.d));
    });
    $('[data-value]', stepper).addEventListener('change', event => {
      const key = stepper.dataset.key;
      const value = event.target.value === '' ? settings[key] : event.target.value;
      updateStepperSetting(key, value);
      event.target.value = settings[key];
    });
  });

  $('#presets').addEventListener('click', event => {
    const button = event.target.closest('button[data-preset]');
    if (!button || button.dataset.preset === 'custom') return;
    Object.assign(settings, PRESETS[button.dataset.preset], { sprints: 4 });
    if (!state.running && state.phase === 'focus') state.remaining = phaseSeconds();
    persist();
    renderSettings();
    render();
  });

  $('#theme').addEventListener('click', event => {
    const button = event.target.closest('button[data-theme]');
    if (!button) return;
    settings.theme = button.dataset.theme;
    applyTheme();
    persist();
    renderSettings();
  });

  el.notifications.addEventListener('change', async () => {
    if (!el.notifications.checked) {
      settings.notifications = false;
      persist();
      renderSettings();
      return;
    }
    if (!('Notification' in window)) {
      settings.notifications = false;
      el.notificationHint.textContent = 'Notifications are not supported in this browser.';
      renderSettings();
      return;
    }
    if (Notification.permission === 'granted') {
      settings.notifications = true;
    } else if (Notification.permission === 'denied') {
      settings.notifications = false;
      el.notificationHint.textContent = 'Notifications are blocked. Change this site’s permission in your browser settings.';
    } else {
      try {
        const permission = await Notification.requestPermission();
        settings.notifications = permission === 'granted';
        if (permission !== 'granted') {
          el.notificationHint.textContent = permission === 'denied'
            ? 'Notifications were denied. Change this site’s permission in your browser settings.'
            : 'Notifications are still off; enable them in your browser to receive alerts.';
        }
      } catch (error) {
        settings.notifications = false;
        el.notificationHint.textContent = 'The browser could not request notification permission.';
        console.warn('Notification permission could not be requested.', error);
      }
    }
    persist();
    renderSettings();
  });

  el.sound.addEventListener('change', () => {
    settings.sound = el.sound.checked;
    persist();
    renderSettings();
  });
  el.volume.addEventListener('input', () => {
    settings.volume = Number(el.volume.value);
    el.volumeValue.value = `${Math.round(settings.volume * 100)}%`;
    el.volumeValue.textContent = el.volumeValue.value;
    persist();
  });
  $('#export-json').addEventListener('click', exportJSON);
  const importFile = $('#import-json-file');
  $('#import-json').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) importJSON(file);
  });
  $('#clear-data').addEventListener('click', clearData);
  el.focusToggle.addEventListener('click', enterFocusMode);
  el.focusExit.addEventListener('click', () => toggleFocusMode(false));
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) toggleFocusMode(false);
  });

  window.addEventListener('hashchange', () => navigateTo(location.hash.slice(1)));
  navigateTo(location.hash.slice(1));
  window.addEventListener('keydown', event => {
    const target = event.target;
    const typing = target instanceof HTMLElement
      && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if (typing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Space') {
      event.preventDefault();
      state.running ? pause() : start();
    } else if (event.key.toLowerCase() === 's' && state.running) {
      completePhase({ skipped: true });
    } else if (event.key.toLowerCase() === 'r') {
      resetTimer();
    } else if (['1', '2', '3'].includes(event.key)) {
      location.hash = `#${({ '1': 'timer', '2': 'settings', '3': 'stats' })[event.key]}`;
    }
  });

  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
  colorScheme.addEventListener('change', () => {
    if (settings.theme === 'system') applyTheme();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });

  function catchUpAfterReload() {
    if (!state.running) return;
    let transitions = 0;
    while (state.running && state.endAt <= Date.now() && transitions < 100) {
      completePhase({ at: state.endAt, notify: false, sound: false });
      transitions += 1;
    }
    if (state.running) {
      state.remaining = Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000));
      ticker = setInterval(tick, 250);
    }
  }

  rollDay();
  catchUpAfterReload();
  persistHistory();
  persist();
  applyTheme();
  renderSettings();
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.warn('Offline support could not be registered.', error);
    });
  }
})();
