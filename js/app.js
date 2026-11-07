/* Waymark UI: renders the four views from Store.state and routes clicks through data-act. */
(() => {
  const L = Logic;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const main = $('#main');
  const sheet = $('#sheet');
  const S = () => Store.state;
  const ws = () => S().settings.weekStart;

  const ui = {
    calMode: window.innerWidth < 700 ? 'day' : 'week',
    calDate: L.clock().date,
    calScrollPending: true,
    reviewWeek: null,
    goalWeek: {},
    quickKind: 'task',
  };

  /* ---------- Formatting ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => L.fromISO(iso).toLocaleDateString(undefined, opts);
  const fmtTime = (min) => new Date(2000, 0, 1, Math.floor(min / 60), min % 60).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmtDur = (min) => {
    if (!min) return '';
    const h = Math.floor(min / 60); const m = min % 60;
    return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ');
  };
  const fmtRange = (a, b) => {
    const days = a.slice(0, 7) === b.slice(0, 7)
      ? `${fmtDate(a, { month: 'short', day: 'numeric' })}–${L.fromISO(b).getDate()}`
      : `${fmtDate(a, { month: 'short', day: 'numeric' })} – ${fmtDate(b, { month: 'short', day: 'numeric' })}`;
    return days;
  };
  const weekRange = (start) => fmtRange(start, L.addDays(start, 6));
  const relDay = (iso) => {
    const t = L.clock().date;
    if (iso === t) return 'Today';
    if (iso === L.addDays(t, 1)) return 'Tomorrow';
    if (iso === L.addDays(t, -1)) return 'Yesterday';
    return fmtDate(iso);
  };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const nextHalfHour = () => Math.min(Math.ceil((L.clock().min + 1) / 30) * 30, 1410);
  const goalOf = (id) => S().goals.find((g) => g.id === id);
  const taskOf = (id) => S().tasks.find((t) => t.id === id);

  const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5"/></svg>';
  const FLAME = '<svg class="flame" viewBox="0 0 16 16" aria-hidden="true"><path d="M8.7 1c.4 2.3-.9 3.5-2 4.8C5.5 7.1 4 8.6 4 10.8A4 4 0 0 0 8 15a4 4 0 0 0 4-4.1c0-1.7-.7-2.9-1.5-3.8-.1 1.1-.6 1.8-1.4 2.2.7-2.8-.2-6.2-.4-8.3Z"/></svg>';
  const gc = (g) => (g ? `has-goal gc-${L.goalColor(g)}` : '');
  const goalDot = (g) => (g ? `<span class="goal-dot gc-${L.goalColor(g)}" aria-hidden="true"></span>` : '');
  function streakBadge(g) {
    const n = L.weekStreak(S(), g, L.clock().date);
    return n ? `<span class="streak" title="Weekly target met ${plural(n, 'week')} in a row">${FLAME}${n}-week streak</span>` : '';
  }
  const SPARK = '<svg class="spark" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z"/></svg>';
  // Plain-English adding needs Claude from inside the page; it stays hidden where that isn't available.
  const smart = { state: 'loading', fn: null, touched: false };
  const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
  const durOptions = (sel, none) => {
    const list = DURATIONS.includes(sel) || !sel ? DURATIONS : [...DURATIONS, sel].sort((a, b) => a - b);
    return (none ? `<option value="">${esc(none)}</option>` : '') +
      list.map((d) => `<option value="${d}" ${d === sel ? 'selected' : ''}>${fmtDur(d)}</option>`).join('');
  };
  const goalOptions = (sel) => `<option value="">No goal</option>` + S().goals.filter((g) => !g.completedAt)
    .map((g) => `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${esc(g.title)}</option>`).join('');

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg, undo = true) {
    const box = $('#toast');
    box.innerHTML = `<div class="toast-body"><span>${esc(msg)}</span>${undo ? '<button data-act="undo">Undo</button>' : ''}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.innerHTML = ''; }, 6000);
    // A modal dialog sits in the top layer, so keep the toast visible above it.
    if (sheet.open) sheet.after(box);
  }

  /* ---------- Shared pieces ---------- */
  const conflictText = (list) => {
    const names = [...new Set(list.map((c) => c.title || 'another session'))];
    return `Overlaps ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` and ${names.length - 2} more` : ''}`;
  };

  function checkBtn(taskId, done, title) {
    return `<button class="check" role="checkbox" aria-checked="${!!done}" aria-label="Complete ${esc(title)}" data-act="toggle-task" data-id="${taskId}">${CHECK}</button>`;
  }

  function taskMeta(t, { showGoal = true } = {}) {
    const bits = [];
    const g = t.goalId && goalOf(t.goalId);
    if (showGoal && g) bits.push(`${goalDot(g)}${esc(g.title)}`);
    const inst = L.taskInst(S(), t.id);
    if (inst) bits.push(`${relDay(inst.date)}, ${fmtTime(inst.start)} · ${fmtDur(inst.duration)}`);
    else if (t.estimate) bits.push(`Estimate ${fmtDur(t.estimate)}`);
    if (t.due && !t.done) bits.push(`Due ${relDay(t.due)}`);
    return bits.join(' · ');
  }

  function taskRow(t, opts = {}) {
    const inst = L.taskInst(S(), t.id);
    return `<li class="row ${t.done ? 'is-done' : ''}">
      ${opts.num ? `<span class="num">${opts.num}</span>` : ''}
      ${checkBtn(t.id, t.done, t.title)}
      <button class="row-main" data-act="edit-task" data-id="${t.id}">
        <span class="row-title">${esc(t.title)}</span>
        <span class="row-meta">${taskMeta(t, opts)}</span>
      </button>
      ${t.done ? '' : `<button class="btn small" data-act="schedule" data-id="${t.id}" ${opts.hint ? `data-hint="${opts.hint}"` : ''}>${inst ? (opts.moveLabel || 'Move') : 'Schedule'}</button>`}
    </li>`;
  }

  function pips(p) {
    const n = Math.max(p.target, p.scheduled);
    const out = [];
    for (let i = 0; i < n; i++) out.push(`<span class="pip ${i < p.done ? 'done' : i < p.scheduled ? 'scheduled' : ''}"></span>`);
    return `<div class="pips" role="img" aria-label="${p.done} complete, ${p.scheduled} scheduled, weekly target ${p.target}">${out.join('')}</div>`;
  }

  const sessionLine = (p) => p.scheduled
    ? `${p.done} of ${p.scheduled} session${p.scheduled === 1 ? '' : 's'} complete`
    : 'No sessions scheduled yet';
  const targetLine = (p) => `Weekly target: ${plural(p.target, 'session')}` +
    (p.toSchedule ? ` · ${p.toSchedule} still to schedule` : p.done >= p.target ? ' · target met' : ' · all scheduled');

  // Show the current week, or next week when that's where the sessions are.
  function goalDisplayWeek(g) {
    const cur = L.startOfWeek(L.clock().date, ws());
    if (L.sessionsInWeek(S(), g.id, cur).length) return cur;
    const next = L.addDays(cur, 7);
    return L.sessionsInWeek(S(), g.id, next).length ? next : cur;
  }

  function deadlineText(g) {
    if (!g.deadline) return '';
    const days = Math.round((L.fromISO(g.deadline) - L.fromISO(L.clock().date)) / 864e5);
    const when = days < 0 ? `${plural(-days, 'day')} past` : days === 0 ? 'today' : `${plural(days, 'day')} left`;
    return `Deadline ${fmtDate(g.deadline, { month: 'short', day: 'numeric', year: 'numeric' })} · ${when}`;
  }

  /* ---------- Today ---------- */
  // Contour lines for the Today header: Waymark's one decorative flourish.
  const TOPO = '<path d="M172.3 69.1Q173.4 70.0 174.3 71.1Q175.2 72.3 175.6 73.5Q176.0 74.7 175.6 75.9Q175.2 77.1 174.2 78.1Q173.1 79.1 171.6 79.8Q170.0 80.4 168.3 80.9Q166.6 81.3 164.9 81.5Q163.3 81.8 161.8 82.0Q160.3 82.2 159.0 82.4Q157.7 82.7 156.4 82.9Q155.2 83.2 153.9 83.4Q152.6 83.6 151.3 83.7Q150.0 83.8 148.7 83.7Q147.4 83.6 146.1 83.4Q144.8 83.2 143.6 82.9Q142.3 82.7 141.0 82.4Q139.7 82.2 138.2 82.0Q136.7 81.8 135.1 81.5Q133.4 81.3 131.7 80.9Q130.0 80.4 128.4 79.8Q126.9 79.1 125.8 78.1Q124.8 77.1 124.4 75.9Q124.0 74.7 124.4 73.5Q124.8 72.3 125.7 71.1Q126.6 70.0 127.7 69.1Q128.9 68.1 129.9 67.3Q131.0 66.5 131.7 65.8Q132.5 65.1 132.9 64.3Q133.3 63.5 133.6 62.5Q133.9 61.6 134.4 60.6Q134.8 59.6 135.5 58.7Q136.2 57.7 137.2 57.0Q138.3 56.2 139.6 55.7Q141.0 55.2 142.5 54.9Q143.9 54.6 145.5 54.5Q147.0 54.4 148.5 54.4Q150.0 54.4 151.5 54.4Q153.0 54.4 154.5 54.5Q156.1 54.6 157.5 54.9Q159.0 55.2 160.4 55.7Q161.7 56.2 162.8 57.0Q163.8 57.7 164.5 58.7Q165.2 59.6 165.6 60.6Q166.1 61.6 166.4 62.5Q166.7 63.5 167.1 64.3Q167.5 65.1 168.3 65.8Q169.0 66.5 170.1 67.3Q171.1 68.1 172.3 69.1Z"/><path d="M192.0 68.2Q193.2 70.0 194.2 72.0Q195.1 74.0 195.5 76.2Q195.9 78.4 195.3 80.5Q194.7 82.6 192.9 84.4Q191.1 86.1 188.3 87.3Q185.6 88.6 182.2 89.1Q178.9 89.7 175.7 89.8Q172.4 89.9 169.6 89.8Q166.8 89.8 164.5 90.0Q162.3 90.1 160.3 90.7Q158.4 91.3 156.5 92.4Q154.5 93.4 152.3 94.5Q150.0 95.7 147.3 96.7Q144.6 97.6 141.7 98.1Q138.8 98.5 135.8 98.4Q132.8 98.2 130.1 97.4Q127.3 96.7 124.9 95.6Q122.4 94.4 120.3 93.1Q118.1 91.7 116.1 90.2Q114.0 88.8 112.2 87.1Q110.4 85.5 109.0 83.7Q107.6 81.9 106.9 80.0Q106.2 78.0 106.4 75.9Q106.6 73.9 107.8 71.9Q108.9 70.0 110.6 68.3Q112.4 66.6 114.2 65.2Q116.1 63.8 117.6 62.6Q119.1 61.3 120.1 60.0Q121.0 58.6 121.4 57.0Q121.9 55.3 122.2 53.3Q122.6 51.3 123.3 49.2Q124.1 47.1 125.6 45.1Q127.2 43.1 129.6 41.7Q131.9 40.3 134.9 39.7Q137.8 39.1 140.9 39.2Q144.1 39.4 147.0 40.1Q150.0 40.8 152.6 41.8Q155.3 42.7 157.7 43.6Q160.1 44.5 162.4 45.2Q164.7 45.9 167.0 46.6Q169.3 47.2 171.7 48.0Q174.0 48.7 176.2 49.7Q178.4 50.7 180.2 52.0Q182.0 53.3 183.4 54.8Q184.7 56.4 185.8 58.0Q186.8 59.6 187.8 61.3Q188.8 62.9 189.8 64.6Q190.9 66.3 192.0 68.2Z"/><path d="M213.3 67.1Q212.9 70.0 212.2 72.8Q211.5 75.5 210.5 78.2Q209.6 80.9 208.3 83.5Q207.1 86.1 205.1 88.5Q203.1 90.9 200.3 92.8Q197.5 94.8 194.0 96.2Q190.5 97.5 186.6 98.3Q182.7 99.0 179.0 99.4Q175.3 99.8 171.9 100.2Q168.6 100.6 165.7 101.5Q162.7 102.4 159.8 103.9Q156.9 105.4 153.4 107.4Q150.0 109.4 145.8 111.3Q141.6 113.3 136.8 114.5Q132.0 115.8 127.0 115.8Q122.0 115.9 117.6 114.6Q113.3 113.3 110.0 110.8Q106.7 108.4 104.6 105.3Q102.6 102.3 101.5 99.1Q100.4 95.9 99.9 92.9Q99.3 89.9 98.8 87.2Q98.2 84.6 97.5 82.1Q96.8 79.7 96.2 77.3Q95.5 74.9 95.2 72.4Q94.9 70.0 95.2 67.6Q95.5 65.1 96.5 62.8Q97.5 60.4 98.9 58.2Q100.4 56.0 101.9 53.9Q103.4 51.7 104.7 49.4Q106.1 47.1 107.4 44.5Q108.7 41.9 110.3 39.1Q111.9 36.3 114.3 33.5Q116.7 30.7 120.0 28.5Q123.4 26.3 127.6 25.0Q131.8 23.8 136.4 23.9Q141.1 24.0 145.5 25.2Q150.0 26.4 153.8 28.4Q157.7 30.3 160.9 32.3Q164.0 34.4 166.9 36.0Q169.7 37.7 172.7 38.7Q175.6 39.8 179.1 40.5Q182.6 41.1 186.5 41.8Q190.5 42.5 194.5 43.6Q198.6 44.6 202.1 46.4Q205.6 48.2 208.1 50.5Q210.6 52.9 211.9 55.7Q213.2 58.5 213.4 61.4Q213.7 64.3 213.3 67.1Z"/><path d="M235.8 66.1Q233.7 70.0 230.4 73.5Q227.2 76.9 223.8 79.9Q220.5 82.8 217.6 85.5Q214.8 88.2 212.5 90.9Q210.3 93.7 208.2 96.5Q206.2 99.3 203.8 102.2Q201.5 105.0 198.4 107.6Q195.4 110.2 191.5 112.3Q187.7 114.4 183.4 116.0Q179.0 117.6 174.4 118.9Q169.8 120.2 165.0 121.5Q160.2 122.7 155.1 124.1Q150.0 125.5 144.4 126.8Q138.8 128.1 132.6 128.9Q126.5 129.7 120.2 129.5Q113.9 129.2 108.3 127.5Q102.7 125.7 98.5 122.5Q94.3 119.4 92.1 115.1Q89.8 110.9 89.4 106.4Q89.0 101.8 89.6 97.7Q90.2 93.5 90.9 90.0Q91.5 86.5 91.1 83.6Q90.8 80.8 89.2 78.2Q87.5 75.6 85.0 72.8Q82.4 70.0 79.8 66.7Q77.3 63.5 75.6 59.8Q74.0 56.1 73.9 52.4Q73.9 48.6 75.6 45.0Q77.2 41.4 80.2 38.3Q83.2 35.2 87.0 32.4Q90.7 29.7 94.9 27.3Q99.0 24.8 103.4 22.5Q107.8 20.3 112.5 18.3Q117.3 16.3 122.5 14.9Q127.7 13.5 133.3 13.1Q138.9 12.7 144.4 13.4Q150.0 14.1 155.1 15.9Q160.1 17.7 164.4 20.1Q168.7 22.4 172.4 24.8Q176.1 27.1 179.8 28.9Q183.4 30.7 187.5 31.9Q191.7 33.1 196.8 33.9Q201.8 34.8 207.6 35.9Q213.3 37.0 219.0 38.8Q224.6 40.7 229.0 43.6Q233.5 46.5 235.8 50.2Q238.1 53.9 238.0 58.0Q237.9 62.1 235.8 66.1Z"/><path d="M256.5 65.1Q254.4 70.0 250.0 74.3Q245.7 78.6 240.5 82.1Q235.3 85.5 230.7 88.5Q226.0 91.4 222.7 94.3Q219.4 97.2 217.4 100.7Q215.4 104.1 214.0 108.4Q212.6 112.6 210.6 117.2Q208.6 121.9 205.2 126.5Q201.8 131.0 196.6 134.6Q191.5 138.2 185.1 140.4Q178.6 142.6 171.5 143.3Q164.3 144.0 157.2 143.6Q150.0 143.1 143.1 142.0Q136.3 140.9 129.7 139.5Q123.2 138.0 117.0 136.2Q110.7 134.5 104.9 132.2Q99.1 129.9 94.2 126.9Q89.3 123.8 85.7 120.0Q82.2 116.1 80.3 111.7Q78.4 107.4 77.8 103.0Q77.3 98.5 77.2 94.5Q77.2 90.5 76.5 87.0Q75.9 83.5 73.8 80.3Q71.7 77.0 68.1 73.5Q64.5 70.0 60.1 65.8Q55.7 61.6 52.1 56.5Q48.4 51.5 46.9 46.0Q45.3 40.5 46.8 35.3Q48.3 30.1 52.8 25.8Q57.3 21.6 63.9 18.8Q70.5 16.0 78.1 14.5Q85.6 12.9 93.0 12.3Q100.4 11.6 107.2 11.2Q113.9 10.8 120.1 10.2Q126.2 9.6 132.1 8.9Q138.0 8.2 144.0 7.6Q150.0 7.1 156.1 7.1Q162.2 7.2 168.1 8.1Q174.1 9.0 179.6 10.6Q185.1 12.3 190.2 14.5Q195.3 16.6 200.3 18.8Q205.3 21.0 210.6 23.1Q215.9 25.2 221.7 27.4Q227.5 29.6 233.5 32.2Q239.5 34.9 244.8 38.3Q250.2 41.8 253.6 46.1Q257.1 50.5 257.9 55.4Q258.6 60.3 256.5 65.1Z"/><path d="M270.4 64.6Q270.1 70.0 267.5 75.1Q265.0 80.3 260.7 84.8Q256.4 89.4 251.4 93.3Q246.4 97.2 242.0 100.8Q237.5 104.3 234.1 108.2Q230.8 112.1 228.3 116.9Q225.9 121.6 223.4 127.2Q220.9 132.8 217.1 138.7Q213.3 144.6 207.5 149.7Q201.7 154.9 193.9 158.2Q186.0 161.4 177.0 162.2Q168.0 162.9 159.0 161.1Q150.0 159.3 142.0 155.8Q134.1 152.2 127.5 148.0Q121.0 143.7 115.5 139.7Q110.0 135.7 104.9 132.5Q99.7 129.2 94.4 126.6Q89.1 124.0 83.5 121.5Q77.9 119.0 72.5 116.2Q67.0 113.3 62.3 109.8Q57.5 106.3 53.8 102.2Q50.1 98.1 47.4 93.7Q44.6 89.2 42.2 84.5Q39.9 79.9 37.4 74.9Q34.9 70.0 32.3 64.6Q29.6 59.2 27.5 53.2Q25.3 47.3 24.7 40.9Q24.1 34.5 26.2 28.4Q28.3 22.2 33.6 17.1Q38.9 12.1 47.1 8.8Q55.2 5.5 64.8 4.3Q74.5 3.1 84.2 3.5Q93.9 3.9 102.5 5.0Q111.0 6.0 118.2 6.7Q125.3 7.3 131.5 6.8Q137.7 6.3 143.8 4.7Q150.0 3.0 156.9 0.9Q163.8 -1.3 171.6 -2.9Q179.4 -4.6 187.6 -4.9Q195.8 -5.2 203.6 -3.8Q211.5 -2.4 218.2 0.6Q225.0 3.5 230.5 7.5Q236.0 11.5 240.6 15.9Q245.2 20.3 249.2 24.9Q253.3 29.4 257.1 34.1Q260.8 38.8 264.0 43.7Q267.1 48.7 268.9 53.9Q270.6 59.2 270.4 64.6Z"/>';
  const greeting = (min) => (min < 300 ? 'Up late' : min < 720 ? 'Good morning' : min < 1020 ? 'Good afternoon' : 'Good evening');
  function renderToday() {
    const now = L.clock();
    const today = now.date;
    const state = S();
    const picks = (state.dailyPriorities[today] || []).map(taskOf).filter(Boolean);
    const schedule = L.instances(state, today, today);
    L.layoutDay(schedule);
    const overdue = L.overdue(state, today);
    const unsched = L.unscheduled(state).filter((t) => !overdue.includes(t));
    const focus = weeklyItems(L.startOfWeek(today, ws()));
    const openMin = L.openGaps(state, today, 15, now).reduce((n, g) => n + g.end - g.start, 0);
    const nextRem = L.nextReminder(state, now);
    const priorityRows = [0, 1, 2].map((i) => picks[i]
      ? taskRow(picks[i], { num: i + 1 })
      : `<li class="row"><span class="num">${i + 1}</span><button class="btn ghost small" data-act="pick-today">Choose a priority</button></li>`).join('');

    const doneToday = schedule.filter((i) => i.taskId && i.done).length;
    const taskBlocks = schedule.filter((i) => i.taskId).length;
    return `
    <header class="page-head today-head">
      <svg class="topo" viewBox="0 0 300 140" aria-hidden="true" focusable="false">${TOPO}</svg>
      <div><p class="greeting">${greeting(now.min)}</p><h1>${fmtDate(today, { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
      <p class="sub">${taskBlocks ? `${doneToday} of ${taskBlocks} scheduled done · ` : ''}${openMin ? `${fmtDur(openMin)} still open today` : 'No open time left today'}${nextRem ? ` · Next reminder ${fmtTime(nextRem.at)}, ${esc(nextRem.title)}` : ''}</p></div>
    </header>
    <div class="stack">
      <section class="card" aria-label="Quick add">${quickAdd(today)}</section>
      <div class="columns">
        <div class="stack">
          <section class="card">
            <div class="card-head"><h2>Top three priorities</h2>${picks.length ? '<button class="btn ghost small" data-act="pick-today">Change</button>' : ''}</div>
            <ol class="list">${priorityRows}</ol>
          </section>
          <section class="card">
            <div class="card-head"><h2>Today's schedule</h2><a class="btn ghost small" href="#calendar" data-act="go-cal-today">Calendar</a></div>
            ${schedule.length ? `<ul class="list">${schedule.map((i) => scheduleRow(i, now)).join('')}</ul>` : '<p class="empty">Nothing scheduled. Add an event above, or give a task a time from Needs a time.</p>'}
          </section>
        </div>
        <div class="stack">
          ${overdue.length ? `<section class="card alert"><div class="card-head"><h2>Overdue</h2><span class="count">${overdue.length}</span></div><ul class="list">${overdue.map((t) => taskRow(t, { moveLabel: 'Reschedule' })).join('')}</ul></section>`
            : '<section class="card"><div class="card-head"><h2>Overdue</h2></div><p class="empty">Nothing overdue.</p></section>'}
          <section class="card">
            <div class="card-head"><h2>Needs a time</h2>${unsched.length ? `<span class="count">${unsched.length}</span>` : ''}</div>
            ${unsched.length ? `<ul class="list">${unsched.slice(0, 6).map((t) => taskRow(t)).join('')}</ul>${unsched.length > 6 ? `<p class="empty">And ${unsched.length - 6} more. See them in Calendar.</p>` : ''}`
              : `<p class="empty">Every open task has a time.${state.goals.length ? '' : ' <a href="#goals">Set a goal</a> to get started.'}</p>`}
          </section>
          ${focus.length ? `<section class="card"><div class="card-head"><h2>This week's focus</h2></div><ul class="list">${focus.map(focusRow).join('')}</ul></section>` : ''}
        </div>
      </div>
    </div>`;
  }

  function scheduleRow(i, now) {
    const flags = [];
    if (i.conflict) flags.push('<span class="flag">Conflict</span>');
    if (i.taskId && !i.done && i.end <= now.min) flags.push('<span class="flag">Time has passed</span>');
    const g = i.goalId && goalOf(i.goalId);
    const meta = [fmtDur(i.duration), g ? `${goalDot(g)}${esc(g.title)}` : '', i.recurring ? 'Repeats' : '', ...flags].filter(Boolean).join(' · ');
    return `<li class="row ${i.done ? 'is-done' : ''}">
      <span class="time">${fmtTime(i.start)}</span>
      ${i.taskId ? checkBtn(i.taskId, i.done, i.title) : ''}
      <button class="row-main" data-act="open-inst" data-key="${i.key}" data-date="${i.date}">
        <span class="row-title">${esc(i.title)}</span><span class="row-meta">${meta}</span>
      </button></li>`;
  }

  const QUICK_PLACEHOLDER = { task: 'Add a task', event: 'Add an event', smart: 'Try “call Steven Tuesday after 2”' };
  function quickAdd(today) {
    if (ui.quickKind === 'smart' && smart.state !== 'ready') ui.quickKind = 'task';
    const k = ui.quickKind;
    return `<form class="quick" data-form="quick">
      <div class="quick-top">
        <div class="seg" role="radiogroup" aria-label="What to add">
          ${smart.state === 'ready' ? `<label class="seg-smart"><input type="radio" name="kind" value="smart" ${k === 'smart' ? 'checked' : ''}>${SPARK}Describe</label>` : ''}
          <label><input type="radio" name="kind" value="task" ${k === 'task' ? 'checked' : ''}>Task</label>
          <label><input type="radio" name="kind" value="event" ${k === 'event' ? 'checked' : ''}>Event</label>
        </div>
        <input name="title" id="quick-title" placeholder="${QUICK_PLACEHOLDER[k]}" aria-label="${k === 'smart' ? 'Describe what to add' : 'Title'}" autocomplete="off" maxlength="300">
      </div>
      <div class="quick-fields smart" data-kind="smart" ${k === 'smart' ? '' : 'hidden'}>
        <p class="sub">Type it the way you'd say it: a task, an event, or a habit like “SQL practice 45 min every weekday morning until Dec 1”. You'll see a preview before anything is added.</p>
        <button class="btn primary">${SPARK}Plan it</button>
      </div>
      <div class="quick-fields task" data-kind="task" ${k === 'task' ? '' : 'hidden'}>
        <label class="field">Due<input type="date" name="due" value="${today}"></label>
        <label class="field">Estimate<select name="estimate">${durOptions(30, 'None')}</select></label>
        <label class="field">Goal<select name="goalId">${goalOptions()}</select></label>
        <button class="btn primary">Add task</button>
      </div>
      <div class="quick-fields" data-kind="event" ${k === 'event' ? '' : 'hidden'}>
        <label class="field">Date<input type="date" name="date" value="${today}"></label>
        <label class="field">Time<input type="time" name="start" value="${L.fromMin(nextHalfHour())}"></label>
        <label class="field">Length<select name="duration">${durOptions(60)}</select></label>
        <button class="btn primary">Add event</button>
      </div>
    </form>`;
  }

  function weeklyItems(weekStart) {
    return (S().weeklyPriorities[weekStart] || []).map((it) => {
      if (it.type === 'goal') { const g = goalOf(it.id); return g && { kind: 'goal', goal: g }; }
      const t = taskOf(it.id); return t && { kind: 'task', task: t };
    }).filter(Boolean);
  }

  const focusRow = (it) => it.kind === 'task' ? taskRow(it.task)
    : `<li class="row"><a class="row-main" style="text-decoration:none;color:inherit" href="#goal-${it.goal.id}"><span class="row-title">${esc(it.goal.title)}</span><span class="row-meta">Goal</span></a></li>`;

  /* ---------- Goals ---------- */
  function renderGoals() {
    const active = S().goals.filter((g) => !g.completedAt);
    const finished = S().goals.filter((g) => g.completedAt);
    return `<header class="page-head"><div><h1>Goals</h1><p class="sub">Break a goal into tasks, then give those tasks time.</p></div>
      <button class="btn primary" data-act="new-goal">New goal</button></header>
      ${active.length ? `<div class="goal-grid">${active.map(goalCard).join('')}</div>` : `<section class="card"><h2>Start with one goal</h2>
        <ol class="steps"><li>Set a goal: one you finish once, or a weekly target.</li><li>Break it into tasks with time estimates.</li><li>Pick open slots on your calendar.</li><li>Check things off and progress updates itself.</li></ol>
        <p style="margin-top:14px"><button class="btn primary" data-act="new-goal">Create a goal</button></p></section>`}
      ${finished.length ? `<h2 style="margin:24px 0 10px">Completed</h2><div class="goal-grid">${finished.map(goalCard).join('')}</div>` : ''}`;
  }

  function goalCard(g) {
    let body;
    if (g.type === 'recurring') {
      const week = goalDisplayWeek(g);
      const p = L.recurringProgress(S(), g, week);
      const isNext = week !== L.startOfWeek(L.clock().date, ws());
      body = `${pips(p)}<p class="progress-line">${isNext ? 'Next week: ' : ''}${sessionLine(p)}</p><p class="sub">${targetLine(p)}</p>${streakBadge(g)}`;
    } else {
      const p = L.taskProgress(S(), g);
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      body = `<div class="bar"><i style="width:${pct}%"></i></div>
        <p class="progress-line">${p.total ? `${p.done} of ${plural(p.total, 'task')} complete` : 'No tasks yet'}</p>
        <p class="sub">${[g.target ? `Target: ${esc(g.target)}` : '', p.milestones ? `${p.milestonesDone} of ${plural(p.milestones, 'milestone')}` : ''].filter(Boolean).join(' · ')}</p>`;
    }
    return `<a class="card goal-card ${gc(g)}" href="#goal-${g.id}">
      <h2>${goalDot(g)}${esc(g.title)}</h2>${body}
      ${g.deadline ? `<p class="sub">${deadlineText(g)}</p>` : ''}
      ${g.completedAt ? '<span class="tag">Completed</span>' : g.type === 'recurring' && g.repeat ? '<span class="tag">Repeats weekly</span>' : ''}
    </a>`;
  }

  function renderGoalDetail(id) {
    const g = goalOf(id);
    if (!g) return `<a class="back" href="#goals">‹ Goals</a><p class="empty">This goal no longer exists.</p>`;
    const p = L.taskProgress(S(), g);
    const tasks = p.tasks;
    const others = g.type === 'recurring';
    return `<a class="back" href="#goals">‹ Goals</a>
    <header class="page-head ${gc(g)}"><div><h1>${goalDot(g)}${esc(g.title)}</h1>
      <p class="sub">${[g.type === 'recurring' ? `Recurring · ${g.perWeek} a week` : 'One-time', g.target ? `Target: ${esc(g.target)}` : '', deadlineText(g)].filter(Boolean).join(' · ')}</p></div>
      <div class="btn-row"><button class="btn" data-act="edit-goal" data-id="${g.id}">Edit</button>
      <button class="btn" data-act="toggle-goal" data-id="${g.id}">${g.completedAt ? 'Reopen' : 'Mark goal complete'}</button></div></header>
    <div class="columns">
      <div class="stack">
        ${others ? sessionsCard(g) : ''}
        <section class="card">
          <div class="card-head"><h2>${others ? 'Other tasks' : 'Tasks'}</h2>${p.total ? `<span class="count">${p.done} of ${p.total} complete${p.minutesLeft ? ` · ${fmtDur(p.minutesLeft)} left` : ''}</span>` : ''}</div>
          ${!others && p.total ? `<div class="bar"><i style="width:${Math.round((p.done / p.total) * 100)}%"></i></div>` : ''}
          ${tasks.length ? `<ul class="list">${tasks.map((t) => taskRow(t, { showGoal: false })).join('')}</ul>` : `<p class="empty">${others ? 'One-off tasks that support this goal go here.' : 'Break this goal into its first few tasks.'}</p>`}
          <form class="inline-form tasks" data-form="add-task" data-goal="${g.id}">
            <label class="field wide">New task<input name="title" placeholder="What needs doing?" autocomplete="off"></label>
            <label class="field">Estimate<select name="estimate">${durOptions(60, 'None')}</select></label>
            <label class="field">Due<input type="date" name="due"></label>
            ${g.milestones.length ? `<label class="field wide" style="grid-column:1/-1">Counts toward milestone<select name="milestoneId"><option value="">None</option>${g.milestones.map((m) => `<option value="${m.id}">${esc(m.title)}</option>`).join('')}</select></label>` : ''}
            <button class="btn primary">Add task</button>
          </form>
        </section>
      </div>
      <div class="stack">
        <section class="card ${gc(g)}"><div class="card-head"><h2>Activity</h2>${dayStreakText(g.id)}</div>${heatMap(g.id)}</section>
        <section class="card">
          <div class="card-head"><h2>Milestones</h2>${p.milestones ? `<span class="count">${p.milestonesDone} of ${p.milestones}</span>` : ''}</div>
          ${g.milestones.length ? `<ul class="list">${g.milestones.map((m) => milestoneRow(g, m)).join('')}</ul>` : '<p class="empty">Optional checkpoints along the way.</p>'}
          <form class="inline-form" data-form="add-milestone" data-goal="${g.id}">
            <label class="field wide">New milestone<input name="title" placeholder="A checkpoint" autocomplete="off"></label>
            <label class="field">Target date<input type="date" name="date"></label>
            <button class="btn" style="align-self:end">Add</button>
          </form>
        </section>
      </div>
    </div>`;
  }

  function milestoneRow(g, m) {
    const linked = S().tasks.filter((t) => t.milestoneId === m.id);
    const meta = [m.date ? `By ${fmtDate(m.date)}` : '', linked.length ? `${linked.filter((t) => t.done).length} of ${plural(linked.length, 'task')}; completes automatically` : ''].filter(Boolean).join(' · ');
    return `<li class="row ${m.done ? 'is-done' : ''}">
      ${linked.length ? `<span class="check" role="img" aria-label="${m.done ? 'Complete' : 'Not complete'}" aria-checked="${!!m.done}">${CHECK}</span>`
        : `<button class="check" role="checkbox" aria-checked="${!!m.done}" aria-label="Complete ${esc(m.title)}" data-act="toggle-milestone" data-goal="${g.id}" data-id="${m.id}">${CHECK}</button>`}
      <span class="row-main" style="cursor:default"><span class="row-title">${esc(m.title)}</span><span class="row-meta">${meta}</span></span>
      <button class="btn small danger" data-act="del-milestone" data-goal="${g.id}" data-id="${m.id}" aria-label="Remove ${esc(m.title)}">Remove</button>
    </li>`;
  }

  function sessionsCard(g) {
    const week = ui.goalWeek[g.id] || goalDisplayWeek(g);
    const p = L.recurringProgress(S(), g, week);
    const cur = L.startOfWeek(L.clock().date, ws());
    const label = week === cur ? 'This week' : week === L.addDays(cur, 7) ? 'Next week' : weekRange(week);
    return `<section class="card ${gc(g)}" data-testid="sessions">
      <div class="card-head"><h2>Sessions</h2>
        <div class="stepper"><button class="btn icon" data-act="goal-week" data-id="${g.id}" data-week="${L.addDays(week, -7)}" aria-label="Previous week">‹</button>
        <span class="label">${label}<br><span class="sub" style="font-weight:400;font-size:.78rem">${weekRange(week)}</span></span>
        <button class="btn icon" data-act="goal-week" data-id="${g.id}" data-week="${L.addDays(week, 7)}" aria-label="Next week">›</button></div></div>
      ${pips(p)}
      <p class="progress-line">${sessionLine(p)}</p>
      <p class="sub">${targetLine(p)}</p>
      ${streakBadge(g)}
      ${p.sessions.length ? `<ul class="list" style="margin-top:8px">${p.sessions.map((s) => sessionRow(s)).join('')}</ul>` : ''}
      <div class="repeat-line ${g.repeat ? 'is-on' : ''}">
        <p>${g.repeat ? `<b>Repeats weekly.</b> ${repeatHint(g)}` : 'Schedule sessions once, then reuse those times every week.'}</p>
        <button class="btn small ${g.repeat ? 'ghost' : ''}" data-act="toggle-repeat" data-id="${g.id}">${g.repeat ? 'Turn off' : 'Repeat weekly'}</button>
      </div>
      <p style="margin-top:12px"><button class="btn primary" data-act="plan-sessions" data-id="${g.id}" data-week="${week}">Schedule sessions</button></p>
    </section>`;
  }

  function repeatHint(g) {
    const cur = L.startOfWeek(L.clock().date, ws());
    const next = L.addDays(cur, 7);
    if (!L.repeatTemplate(S(), g, next) && !L.sessionsInWeek(S(), g.id, cur).length) return 'Schedule this week\'s sessions and next week fills in with the same times.';
    return 'Each new week gets the same days and times as the last full week. Move or remove any session; removed ones stay removed.';
  }

  function sessionRow({ task, inst }) {
    const clash = L.conflicts(S(), inst.date, inst.start, inst.duration, inst);
    return `<li class="row ${task.done ? 'is-done' : ''}">
      ${checkBtn(task.id, task.done, `${task.title} on ${fmtDate(inst.date)}`)}
      <button class="row-main" data-act="open-inst" data-key="${inst.key}" data-date="${inst.date}">
        <span class="row-title">${fmtDate(inst.date)}, ${fmtTime(inst.start)}</span>
        <span class="row-meta">${esc(task.title)} · ${fmtDur(inst.duration)}${clash.length ? ` · <span class="flag">${esc(conflictText(clash))}</span>` : ''}</span>
      </button>
      ${task.done ? '' : `<button class="btn small" data-act="open-inst" data-key="${inst.key}" data-date="${inst.date}">Move</button>`}
    </li>`;
  }

  /* ---------- Calendar ---------- */
  function renderCalendar() {
    const state = S();
    const start = ui.calMode === 'week' ? L.startOfWeek(ui.calDate, ws()) : ui.calDate;
    const days = ui.calMode === 'week' ? L.weekDays(start) : [ui.calDate];
    const heading = ui.calMode === 'week' ? weekRange(start) : fmtDate(ui.calDate, { weekday: 'long', month: 'long', day: 'numeric' });
    const unsched = L.unscheduled(state);
    return `<header class="page-head"><h1>${heading}</h1>
      <div class="btn-row"><button class="btn" data-act="availability">Availability</button><button class="btn primary" data-act="new-event">New event</button></div></header>
    <div class="cal-bar">
      <div class="seg" role="group" aria-label="Calendar view">
        <button data-act="cal-mode" data-mode="day" aria-pressed="${ui.calMode === 'day'}">Day</button>
        <button data-act="cal-mode" data-mode="week" aria-pressed="${ui.calMode === 'week'}">Week</button>
      </div>
      <span class="spacer"></span>
      <button class="btn icon" data-act="cal-step" data-step="-1" aria-label="Previous ${ui.calMode}">‹</button>
      <button class="btn" data-act="cal-today">Today</button>
      <button class="btn icon" data-act="cal-step" data-step="1" aria-label="Next ${ui.calMode}">›</button>
    </div>
    <div class="cal-layout">
      <div>
        ${calendarGrid(days)}
        <div class="legend"><span><i style="background:var(--accent-soft);border-left:3px solid var(--accent)"></i>Goal or task</span><span><i style="background:var(--event);border-left:3px solid var(--event-edge)"></i>Event</span><span><i style="background:var(--off)"></i>Outside availability</span><span class="block-warn">⚠ Conflict</span></div>
      </div>
      <section class="card"><div class="card-head"><h2>Needs a time</h2>${unsched.length ? `<span class="count">${unsched.length}</span>` : ''}</div>
        ${unsched.length ? `<ul class="list">${unsched.map((t) => taskRow(t, { hint: days[0] })).join('')}</ul>` : '<p class="empty">Every open task has a time.</p>'}</section>
    </div>`;
  }

  function calendarGrid(days) {
    const now = L.clock();
    const state = S();
    const narrow = window.innerWidth < 700;
    const colw = days.length === 1 ? '200px' : narrow ? '92px' : '84px';
    let times = '';
    for (let h = 1; h < 24; h++) times += `<span style="top:calc(${h} * var(--hour))">${fmtTime(h * 60).replace(':00', '')}</span>`;
    const heads = days.map((d) => `<button class="cal-day-head ${d === now.date ? 'is-today' : ''}" data-act="cal-open-day" data-date="${d}" aria-label="Open ${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}">${fmtDate(d, { weekday: 'short' })}<b>${L.fromISO(d).getDate()}</b></button>`).join('');
    const cols = days.map((d) => {
      const w = state.settings.availability[L.weekday(d)];
      const off = (a, b) => (b > a ? `<div class="day-off" style="top:calc(${a / 60} * var(--hour));height:calc(${(b - a) / 60} * var(--hour))"></div>` : '');
      const shade = w.on ? off(0, w.start) + off(w.end, 1440) : off(0, 1440);
      const items = L.layoutDay(L.instances(state, d, d));
      const line = d === now.date ? `<div class="now-line" style="top:calc(${now.min / 60} * var(--hour))"></div>` : '';
      return `<div class="day-col" data-date="${d}">${shade}${line}${items.map(blockHtml).join('')}</div>`;
    }).join('');
    return `<div class="cal-scroll" id="cal-scroll"><div class="cal-grid" style="--days:${days.length};--colw:${colw}">
      <div class="cal-corner"></div>${heads}
      <div class="cal-times" aria-hidden="true">${times}</div>${cols}
    </div></div>`;
  }

  function blockHtml(i) {
    const gap = 2;
    const width = `calc(${100 / i.lanes}% - ${gap + 1}px)`;
    const left = `calc(${(i.lane * 100) / i.lanes}% + 1px)`;
    const label = `${i.title}, ${fmtTime(i.start)} to ${fmtTime(i.end)}${i.conflict ? ', conflict' : ''}${i.done ? ', complete' : ''}`;
    return `<div class="block ${i.taskId ? 'task' : ''} ${i.goalId ? gc(goalOf(i.goalId)) : ''} ${i.done ? 'done' : ''} ${i.conflict ? 'conflict' : ''} ${i.lanes > 1 && ui.calMode === 'week' ? 'tight' : ''}"
        style="top:calc(${i.start / 60} * var(--hour) + 1px);height:calc(${i.duration / 60} * var(--hour) - 2px);left:${left};width:${width}"
        data-key="${i.key}" data-date="${i.date}">
      <button class="block-main" data-act="open-inst" data-key="${i.key}" data-date="${i.date}" aria-label="${esc(label)}">
        <span class="block-title">${i.conflict ? '<span class="block-warn">⚠ </span>' : ''}${esc(i.title)}</span>
        ${i.duration >= 40 ? `<span class="block-time">${fmtTime(i.start)}</span>` : ''}
      </button>
      ${i.taskId ? checkBtn(i.taskId, i.done, i.title) : ''}
      <div class="block-resize"></div>
    </div>`;
  }

  /* Mouse drag to move or resize. Touch users move blocks through the sheet, so scrolling stays free. */
  function setupDrag() {
    let drag = null;
    const snap = (m) => Math.round(m / 15) * 15;
    const hourPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour'));

    main.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      const block = e.target.closest('.block');
      if (!block || e.target.closest('.check')) return;
      const inst = L.findInst(S(), block.dataset.key, block.dataset.date);
      if (!inst) return;
      const col = block.closest('.day-col');
      const rect = col.getBoundingClientRect();
      drag = {
        block, inst, startX: e.clientX, startY: e.clientY, moved: false,
        resize: !!e.target.closest('.block-resize'),
        grabMin: ((e.clientY - rect.top) / hourPx()) * 60 - inst.start,
        date: inst.date, start: inst.start, duration: inst.duration,
      };
      dragActive = true;
    });

    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
      drag.moved = true;
      drag.block.classList.add('dragging');
      const col = document.elementsFromPoint(e.clientX, e.clientY).map((el) => el.closest && el.closest('.day-col')).find(Boolean)
        || drag.block.closest('.day-col');
      const top = col.getBoundingClientRect().top;
      const pointerMin = ((e.clientY - top) / hourPx()) * 60;
      if (drag.resize) {
        drag.duration = Math.max(15, Math.min(1440 - drag.start, snap(pointerMin - drag.start)));
        drag.block.style.height = `calc(${drag.duration / 60} * var(--hour) - 2px)`;
      } else {
        drag.start = Math.max(0, Math.min(1440 - drag.duration, snap(pointerMin - drag.grabMin)));
        drag.date = col.dataset.date;
        if (drag.block.parentElement !== col) col.append(drag.block);
        drag.block.style.top = `calc(${drag.start / 60} * var(--hour) + 1px)`;
      }
    });

    window.addEventListener('pointerup', () => {
      dragActive = false;
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
      if (d.date === d.inst.date && d.start === d.inst.start && d.duration === d.inst.duration) { render(); return; }
      applyMove(d.inst, { date: d.date, start: d.start, duration: d.duration }, 'one');
    });
  }
  let suppressClick = false;
  let dragActive = false;

  function applyMove(inst, slot, scope) {
    Store.commit((s) => L.moveInstance(s, inst, slot, scope));
    const clash = L.conflicts(S(), slot.date, slot.start, slot.duration, inst);
    toast(`${inst.recurring && scope === 'one' ? 'Moved this occurrence to' : 'Moved to'} ${fmtDate(slot.date)}, ${fmtTime(slot.start)}${clash.length ? `. ${conflictText(clash)}` : ''}`);
  }

  /* ---------- Weekly Review ---------- */
  function renderReview() {
    const now = L.clock();
    const cur = L.startOfWeek(now.date, ws());
    const week = ui.reviewWeek || cur;
    const next = L.addDays(week, 7);
    const r = L.weekReview(S(), week, now.date);
    const doneMin = r.completed.reduce((n, t) => {
      const i = L.taskInst(S(), t.id);
      return n + ((i && i.duration) || t.estimate || 0);
    }, 0);
    const needMin = r.needsTime.reduce((n, t) => n + (t.estimate || 0), 0);
    const items = weeklyItems(next);
    const label = week === cur ? 'This week' : week === L.addDays(cur, -7) ? 'Last week' : week === next ? 'Next week' : 'Week';
    return `<header class="page-head"><div><h1>Weekly review</h1><p class="sub">${label}, ${weekRange(week)}</p></div>
      <div class="stepper"><button class="btn icon" data-act="review-week" data-week="${L.addDays(week, -7)}" aria-label="Previous week">‹</button>
      <button class="btn" data-act="review-week" data-week="${cur}">This week</button>
      <button class="btn icon" data-act="review-week" data-week="${next}" aria-label="Next week">›</button></div></header>
    <div class="stack">
      <div class="stats">
        <div class="stat"><b>${r.completed.length}</b><span>completed</span></div>
        <div class="stat"><b>${r.moved.length}</b><span>${r.moved.length === 1 ? 'goal' : 'goals'} moved forward</span></div>
        <div class="stat"><b>${r.needsTime.length}</b><span>still ${r.needsTime.length === 1 ? 'needs' : 'need'} time</span></div>
      </div>
      <section class="card"><div class="card-head"><h2>Your last ${heatWeeks(true)} weeks</h2>${dayStreakText()}</div>${heatMap(null, true)}</section>
      <div class="columns">
        <div class="stack">
          <section class="card"><div class="card-head"><h2>Completed</h2>${doneMin ? `<span class="count">${fmtDur(doneMin)}</span>` : ''}</div>
            ${r.completed.length ? `<ul class="list">${r.completed.map((t) => taskRow(t)).join('')}</ul>` : '<p class="empty">Nothing completed in this week.</p>'}</section>
          <section class="card"><div class="card-head"><h2>Goals that moved forward</h2></div>
            ${r.moved.length ? `<ul class="list">${r.moved.map((m) => movedRow(m, week)).join('')}</ul>` : '<p class="empty">No goal progress in this week.</p>'}
            ${r.stalled.length ? `<p class="sub" style="margin-top:10px">No movement: ${r.stalled.map((g) => `<a href="#goal-${g.id}">${esc(g.title)}</a>`).join(', ')}</p>` : ''}
          </section>
        </div>
        <div class="stack">
          <section class="card"><div class="card-head"><h2>Still needs time</h2>${needMin ? `<span class="count">${fmtDur(needMin)} estimated</span>` : ''}</div>
            ${r.shortfalls.length ? `<ul class="list">${r.shortfalls.map((x) => shortfallRow(x, next)).join('')}</ul>` : ''}
            ${r.needsTime.length ? `<ul class="list">${r.needsTime.map((t) => taskRow(t, { hint: next, moveLabel: 'Reschedule' })).join('')}</ul>
              <p style="margin-top:12px"><button class="btn" data-act="bulk-reschedule" data-week="${next}">Reschedule all into ${weekRange(next)}</button></p>`
              : (r.shortfalls.length ? '' : '<p class="empty">Everything open has a time.</p>')}
          </section>
          <section class="card"><div class="card-head"><h2>Priorities for ${weekRange(next)}</h2><button class="btn ghost small" data-act="pick-week" data-week="${next}">${items.length ? 'Change' : 'Choose'}</button></div>
            ${items.length ? `<ul class="list">${items.map(focusRow).join('')}</ul>` : '<p class="empty">Pick up to three tasks or goals to focus on.</p>'}</section>
        </div>
      </div>
    </div>`;
  }

  // As many weeks as fit the card: about 17 on a phone, up to a year on a wide screen.
  function heatWeeks(wide) {
    const nav = innerWidth >= 800 ? 196 + 64 : 32;
    const content = Math.min(1120, innerWidth - nav);
    const card = wide ? content : (innerWidth >= 1000 ? content * 0.4 - 8 : content);
    const cell = innerWidth >= 800 ? 18 : 16;
    return Math.max(12, Math.min(52, Math.floor((card - 36 - 48) / cell)));
  }
  function dayStreakText(goalId) {
    const n = L.dayStreak(S(), L.clock().date, goalId);
    return n >= 2 ? `<span class="streak">${FLAME}${n}-day streak</span>` : '';
  }
  // A GitHub-style grid: one column per week, one square per day, darker for more done.
  function heatMap(goalId, wide = false) {
    const HEAT_WEEKS = heatWeeks(wide);
    const today = L.clock().date;
    const start = L.addDays(L.startOfWeek(today, ws()), -7 * (HEAT_WEEKS - 1));
    const m = L.activityByDay(S(), start, today, goalId);
    const level = (n) => (n <= 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4);
    let total = 0; let activeDays = 0;
    const months = [];
    const cols = [];
    let lastMonth = null;
    for (let w = 0; w < HEAT_WEEKS; w++) {
      const first = L.addDays(start, w * 7);
      const mon = L.fromISO(first).getMonth();
      months.push(mon !== lastMonth ? `<span>${fmtDate(first, { month: 'short' })}</span>` : '<span></span>');
      lastMonth = mon;
      const cells = [];
      for (let d = 0; d < 7; d++) {
        const iso = L.addDays(first, d);
        if (iso > today) { cells.push('<i class="hm-cell future"></i>'); continue; }
        const n = m[iso] || 0;
        total += n; if (n) activeDays++;
        cells.push(`<i class="hm-cell l${level(n)}${iso === today ? ' today' : ''}" title="${fmtDate(iso)}: ${n ? `${n} done` : 'nothing done'}"></i>`);
      }
      cols.push(`<div class="hm-col">${cells.join('')}</div>`);
    }
    const dayLabels = [0, 1, 2, 3, 4, 5, 6].map((i) => { const d = L.addDays(start, i); return `<span>${i % 2 === 0 ? fmtDate(d, { weekday: 'short' }) : ''}</span>`; }).join('');
    return `<div class="heatmap" style="--weeks:${HEAT_WEEKS}" role="img" aria-label="${total} things done on ${plural(activeDays, 'day')} in the last ${HEAT_WEEKS} weeks">
        <div class="hm-months">${months.join('')}</div>
        <div class="hm-body"><div class="hm-days">${dayLabels}</div><div class="hm-grid">${cols.join('')}</div></div>
      </div>
      <div class="hm-foot"><span>${total ? `${total} done on ${plural(activeDays, 'day')}` : 'Finished tasks fill in squares here.'}</span>
        <span class="hm-legend" aria-hidden="true">Less <i class="hm-cell l0"></i><i class="hm-cell l1"></i><i class="hm-cell l2"></i><i class="hm-cell l3"></i><i class="hm-cell l4"></i> More</span></div>`;
  }

  function movedRow({ goal, tasks, milestones }, week) {
    const bits = [];
    if (goal.type === 'recurring') bits.push(sessionLine(L.recurringProgress(S(), goal, week)));
    const others = tasks.filter((t) => !t.session).length;
    if (others) bits.push(`${plural(others, 'task')} done`);
    if (milestones.length) bits.push(`${plural(milestones.length, 'milestone')} reached`);
    return `<li class="row"><a class="row-main" style="text-decoration:none;color:inherit" href="#goal-${goal.id}"><span class="row-title">${esc(goal.title)}</span><span class="row-meta">${bits.join(' · ')}</span></a></li>`;
  }

  function shortfallRow({ goal, progress }, next) {
    return `<li class="row"><span class="row-main" style="cursor:default"><span class="row-title">${esc(goal.title)}</span>
      <span class="row-meta">${progress.scheduled} of ${progress.target} target sessions scheduled</span></span>
      <button class="btn small" data-act="plan-sessions" data-id="${goal.id}" data-week="${next}">Plan next week</button></li>`;
  }

  /* ---------- Dialogs ---------- */
  function openSheet(html) {
    sheet.innerHTML = html;
    if (!sheet.open) sheet.showModal();
    sheet.scrollTop = 0;
  }
  function closeSheet() { if (sheet.open) sheet.close(); document.body.append($('#toast')); }
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  sheet.addEventListener('close', () => document.body.append($('#toast')));

  const sheetHead = (title, sub) => `<div class="sheet-head"><div><h2 id="sheet-title">${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>
    <button type="button" class="btn icon ghost" data-act="close-sheet" aria-label="Close">×</button></div>`;

  /* Event / block sheet: new appointments, edits, and scheduling tasks all share this. */
  function openBlockSheet(cfg) {
    const state = S();
    const now = L.clock();
    const inst = cfg.inst || null;
    const task = cfg.taskId ? taskOf(cfg.taskId) : inst && inst.taskId ? taskOf(inst.taskId) : null;
    const existing = task ? L.taskInst(state, task.id) : inst;
    const event = existing ? state.events.find((e) => e.id === existing.eventId) : null;
    const recurring = !!(event && event.recurrence);
    const exclude = existing ? { key: existing.key, eventId: task || !recurring ? existing.eventId : null } : null;
    const duration = existing ? existing.duration : cfg.duration || (task && task.estimate) || 60;
    let date = existing ? existing.date : cfg.date || now.date;
    let start = existing ? existing.start : cfg.start ?? nextHalfHour();
    let chipFrom = cfg.hint && cfg.hint > date ? cfg.hint : date;
    if (!existing && task) {
      const first = L.suggest(state, { duration, from: cfg.hint || now.date, now, limit: 1 })[0];
      if (first) { date = first.date; start = first.start; chipFrom = first.date; }
    }
    const goal = task && task.goalId ? goalOf(task.goalId) : null;
    const title = task ? (existing ? 'Move or reschedule' : 'Schedule task') : existing ? 'Edit event' : 'New event';
    const r = event && event.recurrence;
    const repeat = !r ? 'none' : r.freq === 'daily' ? 'daily' : r.days.join() === '1,2,3,4,5' ? 'weekdays' : 'weekly';

    openSheet(`<form class="sheet-form" data-form="block">
      ${sheetHead(title, task ? [task.title, goal && goal.title].filter(Boolean).join(' · ') : '')}
      ${task ? '' : `<label class="field">Title<input name="title" value="${esc(existing ? existing.title : '')}" placeholder="Appointment, class, dinner…" autocomplete="off"></label>`}
      ${recurring ? `<div class="seg" role="radiogroup" aria-label="Apply changes to">
        <label><input type="radio" name="scope" value="one" checked>This occurrence</label>
        <label><input type="radio" name="scope" value="all">All occurrences</label></div>` : ''}
      <div class="form-grid">
        <label class="field" data-only="one">Date<input type="date" name="date" value="${date}"></label>
        <label class="field">Start<input type="time" name="start" value="${L.fromMin(start)}"></label>
        <label class="field">Length<select name="duration">${durOptions(duration)}</select></label>
        ${task ? '' : `<label class="field" data-only="series">Repeat<select name="repeat">
          ${[['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly on…']].map(([v, l]) => `<option value="${v}" ${v === repeat ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>`}
      </div>
      ${task ? '' : `<div class="field" data-only="series" data-weekly hidden><span>Repeat on</span><div class="chips">
        ${[...Array(7).keys()].map((n) => (n + ws()) % 7).map((d) => `<label class="check-line" style="min-width:58px"><input type="checkbox" name="days" value="${d}" ${r && r.days && r.days.includes(d) ? 'checked' : ''}>${fmtDate(L.addDays('2026-11-01', d), { weekday: 'short' })}</label>`).join('')}
      </div></div>
      <label class="field" data-only="series" data-repeating hidden>Ends on (optional)<input type="date" name="until" value="${r && r.until ? r.until : ''}"></label>`}
      <div class="field"><span>Open slots</span><div class="chips" id="slot-chips"></div></div>
      <div class="notes" id="block-notes" aria-live="polite"></div>
      <div class="sheet-actions">
        <div class="left">
          ${task && existing ? `<button type="button" class="btn" data-act="sheet-toggle-done" data-id="${task.id}">${task.done ? 'Mark not done' : 'Mark complete'}</button>` : ''}
          ${existing ? `<button type="button" class="btn danger" data-act="sheet-remove">${task ? (task.session ? 'Remove session' : 'Unschedule') : 'Delete'}</button>` : ''}
        </div>
        <button class="btn primary">${task ? (existing ? 'Save' : 'Schedule') : 'Save'}</button>
      </div>
    </form>`);

    const form = $('form', sheet);
    const read = () => {
      const f = new FormData(form);
      return {
        scope: f.get('scope') || 'one', date: f.get('date'), start: f.get('start') ? L.toMin(f.get('start')) : null,
        duration: Number(f.get('duration')), title: (f.get('title') || '').trim(),
        repeat: f.get('repeat') || 'none', days: f.getAll('days').map(Number), until: f.get('until') || null,
      };
    };

    function refresh() {
      const v = read();
      const isAll = v.scope === 'all';
      const series = !recurring || isAll;
      $$('[data-only=one]', form).forEach((el) => { el.hidden = isAll; });
      $$('[data-only=series]', form).forEach((el) => { el.hidden = !series; });
      const weekly = $('[data-weekly]', form); if (weekly) weekly.hidden = !series || v.repeat !== 'weekly';
      const rep = $('[data-repeating]', form); if (rep) rep.hidden = !series || v.repeat === 'none';

      const ex = isAll && event ? { eventId: event.id } : exclude;
      const notes = [];
      if (v.date && v.start !== null) {
        if (v.start + v.duration > 1440) notes.push(['err', 'This must end by midnight. Choose an earlier start or shorter length.']);
        const clash = L.conflicts(S(), v.date, v.start, v.duration, ex);
        if (clash.length) notes.push(['warn', `Conflict: ${clash.map((c) => `${c.title || 'Session'} (${fmtTime(c.start)}–${fmtTime(c.end)})`).join(', ')}`]);
        if (L.outsideAvailability(S(), v.date, v.start, v.duration)) notes.push(['warn', 'Outside your availability.']);
        if (task && task.due && v.date > task.due) notes.push(['warn', `After this task's due date (${fmtDate(task.due)}).`]);
        if (goal && goal.deadline && v.date > goal.deadline) notes.push(['warn', `After this goal's deadline (${fmtDate(goal.deadline)}).`]);
        if (!notes.length) notes.push(['ok', `Open: ${fmtDate(v.date)}, ${fmtTime(v.start)}–${fmtTime(v.start + v.duration)}`]);
      }
      $('#block-notes', form).innerHTML = notes.map(([k, t]) => `<p class="note ${k === 'ok' ? '' : k}">${esc(t)}</p>`).join('');
      const slots = L.suggest(S(), { duration: v.duration, from: chipFrom, now: L.clock(), exclude: ex, limit: 6 });
      $('#slot-chips', form).innerHTML = slots.length
        ? slots.map((s) => `<button type="button" class="chip" data-act="pick-slot" data-date="${s.date}" data-start="${s.start}" aria-pressed="${s.date === v.date && s.start === v.start}">${fmtDate(s.date)}, ${fmtTime(s.start)}</button>`).join('')
        : '<span class="empty">No open slots of this length in the next two weeks.</span>';
    }

    form.addEventListener('input', (e) => { if (e.target.name === 'date' && e.target.value) chipFrom = e.target.value; refresh(); });
    sheet._pickSlot = (d, s) => { form.elements.date.value = d; form.elements.start.value = L.fromMin(s); refresh(); };
    sheet._remove = () => {
      const scope = read().scope;
      if (task) {
        Store.commit((s) => {
          if (task.session) L.removeTask(s, task.id, L.clock().date);
          else s.events = s.events.filter((e) => e.taskId !== task.id);
        });
        closeSheet();
        toast(task.session ? 'Session removed' : 'Removed from calendar');
      } else {
        Store.commit((s) => L.deleteInstance(s, existing, scope));
        closeSheet();
        toast(recurring && scope === 'one' ? 'Occurrence deleted' : 'Event deleted');
      }
    };
    sheet._submit = () => {
      const v = read();
      const err = (msg) => { $('#block-notes', form).innerHTML = `<p class="note err">${esc(msg)}</p>`; };
      if (!task && !v.title) { err('Give this event a title.'); form.elements.title.focus(); return; }
      if (!v.date || v.start === null) { err('Choose a date and start time.'); return; }
      if (v.start + v.duration > 1440) { err('This must end by midnight. Choose an earlier start or shorter length.'); return; }
      let recurrence = null;
      if (v.repeat === 'daily') recurrence = { freq: 'daily', days: [], until: v.until };
      if (v.repeat === 'weekdays') recurrence = { freq: 'weekly', days: [1, 2, 3, 4, 5], until: v.until };
      if (v.repeat === 'weekly') {
        if (!v.days.length) { err('Pick at least one day to repeat on.'); return; }
        recurrence = { freq: 'weekly', days: v.days, until: v.until };
      }
      const slot = { date: v.date, start: v.start, duration: v.duration };
      const clash = L.conflicts(S(), v.date, v.start, v.duration, v.scope === 'all' && event ? { eventId: event.id } : exclude);
      const suffix = clash.length ? `. ${conflictText(clash)}` : '';
      let msg;
      if (task) {
        Store.commit((s) => L.scheduleTask(s, task.id, slot));
        msg = `${existing ? 'Moved to' : 'Scheduled for'} ${fmtDate(v.date)}, ${fmtTime(v.start)}${suffix}`;
      } else if (!existing) {
        Store.commit((s) => s.events.push({ id: L.uid(), title: v.title, ...slot, recurrence, exceptions: {} }));
        msg = `Added ${fmtDate(v.date)}, ${fmtTime(v.start)}${suffix}`;
      } else if (recurring && v.scope === 'one') {
        Store.commit((s) => {
          L.moveInstance(s, existing, slot, 'one');
          const e = s.events.find((x) => x.id === existing.eventId);
          if (v.title !== e.title) e.exceptions[existing.occ].title = v.title;
        });
        msg = `This occurrence is now ${fmtDate(v.date)}, ${fmtTime(v.start)}${suffix}`;
      } else {
        Store.commit((s) => {
          const e = s.events.find((x) => x.id === existing.eventId);
          e.title = v.title; e.start = v.start; e.duration = v.duration;
          if (recurring) {
            e.recurrence = recurrence;
            if (!recurrence) { e.date = existing.date; e.exceptions = {}; }
          } else {
            e.date = v.date; e.recurrence = recurrence;
          }
        });
        msg = `Saved${suffix}`;
      }
      closeSheet();
      toast(msg);
    };
    refresh();
    if (!task && !existing) form.elements.title.focus();
  }

  /* Schedule several sessions for a recurring goal. */
  function openSessionsSheet(goal, week) {
    const now = L.clock();
    const cur = L.startOfWeek(now.date, ws());
    const firstWeek = week < cur ? cur : week;
    const existing = L.sessionsInWeek(S(), goal.id, firstWeek).length;
    let count = Math.max(1, goal.perWeek - existing);
    let duration = goal.sessionMinutes || 60;
    let weekStart = firstWeek;
    let rows = [];
    const weeks = [...new Set([cur, L.addDays(cur, 7), firstWeek, L.addDays(firstWeek, 7)])].sort();
    const weekLabel = (w) => (w === cur ? `This week (${weekRange(w)})` : w === L.addDays(cur, 7) ? `Next week (${weekRange(w)})` : weekRange(w));

    openSheet(`<form class="sheet-form" data-form="sessions">
      ${sheetHead('Schedule sessions', goal.title)}
      <div class="form-grid">
        <label class="field">How many<input type="number" inputmode="numeric" name="count" min="1" max="14" value="${count}"></label>
        <label class="field">Length<select name="duration">${durOptions(duration)}</select></label>
        <label class="field wide">Week<select name="week">${weeks.map((w) => `<option value="${w}" ${w === weekStart ? 'selected' : ''}>${weekLabel(w)}</option>`).join('')}</select></label>
      </div>
      <p class="sub" id="session-summary"></p>
      <div class="stack" id="session-rows" style="gap:10px"></div>
      <div class="sheet-actions"><button class="btn primary" id="session-save">Schedule</button></div>
    </form>`);
    const form = $('form', sheet);

    const rowNotes = (i) => {
      const r = rows[i];
      const others = rows.filter((_, j) => j !== i).map((x) => ({ ...x, title: 'another session here' }));
      const out = [];
      if (r.start + r.duration > 1440) out.push(['err', 'Must end by midnight.']);
      const clash = L.conflicts(S(), r.date, r.start, r.duration, null, others);
      if (clash.length) out.push(['warn', conflictText(clash)]);
      if (L.outsideAvailability(S(), r.date, r.start, r.duration)) out.push(['warn', 'Outside your availability']);
      if (r.date < now.date) out.push(['warn', 'This date has passed']);
      return out.map(([k, t]) => `<p class="note ${k}">${esc(t)}</p>`).join('');
    };

    function paintRows() {
      const box = $('#session-rows', form);
      box.innerHTML = rows.map((r, i) => `<div class="session-row" data-row="${i}">
        <label class="field">Session ${i + 1}<input type="date" name="r-date" value="${r.date}"></label>
        <label class="field">Start<input type="time" name="r-start" value="${L.fromMin(r.start)}"></label>
        <button type="button" class="btn icon ghost" data-act="session-drop" data-row="${i}" aria-label="Remove session ${i + 1}">×</button>
        <div class="row-notes" style="grid-column:1/-1;display:grid;gap:4px" aria-live="polite">${rowNotes(i)}</div></div>`).join('')
        || '<p class="empty">No open time left in this week. Try the next week.</p>';
      summary();
    }
    function summary() {
      const total = existing2() + rows.length;
      const days = new Set(rows.map((r) => r.date)).size;
      const doubled = days < rows.length ? ` Some days have two, because only ${plural(days, 'open day')} remain.` : '';
      $('#session-summary', form).textContent = `Suggested from your open time. That makes ${total} of ${goal.perWeek} target sessions for this week.${doubled}`;
      $('#session-save', form).textContent = rows.length === 1 ? 'Schedule 1 session' : `Schedule ${rows.length} sessions`;
      $('#session-save', form).disabled = !rows.length;
    }
    const existing2 = () => L.sessionsInWeek(S(), goal.id, weekStart).length;
    function rebuild() {
      rows = L.spreadSessions(S(), count, duration, weekStart, now);
      paintRows();
    }
    form.addEventListener('input', (e) => {
      const n = e.target.name;
      if (n === 'count') { const c = parseInt(e.target.value, 10); if (c >= 1 && c <= 14) { count = c; rebuild(); } return; }
      if (n === 'duration') { duration = Number(e.target.value); rebuild(); return; }
      if (n === 'week') { weekStart = e.target.value; rebuild(); return; }
      const rowEl = e.target.closest('[data-row]');
      if (!rowEl) return;
      const r = rows[Number(rowEl.dataset.row)];
      if (n === 'r-date' && e.target.value) r.date = e.target.value;
      if (n === 'r-start' && e.target.value) r.start = L.toMin(e.target.value);
      $$('.session-row', form).forEach((el, i) => { $('.row-notes', el).innerHTML = rowNotes(i); });
    });
    sheet._dropRow = (i) => { rows.splice(i, 1); count = Math.max(1, rows.length); form.elements.count.value = rows.length || 1; paintRows(); };
    sheet._submit = () => {
      const bad = rows.find((r) => r.start + r.duration > 1440);
      if (bad || !rows.length) return;
      const n = rows.length;
      const first = rows[0];
      Store.commit((s) => L.createSessions(s, s.goals.find((g) => g.id === goal.id), rows));
      ui.goalWeek[goal.id] = L.startOfWeek(first.date, ws());
      closeSheet();
      toast(`${plural(n, 'session')} scheduled`);
    };
    rebuild();
  }

  const COLOR_NAMES = ['Teal', 'Blue', 'Violet', 'Rose', 'Orange', 'Gold', 'Green', 'Slate'];
  function openGoalSheet(goal) {
    const g = goal || { type: 'once' };
    openSheet(`<form class="sheet-form" data-form="goal">
      ${sheetHead(goal ? 'Edit goal' : 'New goal')}
      <label class="field">Goal<input name="title" value="${esc(g.title || '')}" placeholder="Run a 10k, or work out 5 times a week" autocomplete="off"></label>
      <div class="seg" role="radiogroup" aria-label="Goal type">
        <label><input type="radio" name="type" value="once" ${g.type !== 'recurring' ? 'checked' : ''}>One-time</label>
        <label><input type="radio" name="type" value="recurring" ${g.type === 'recurring' ? 'checked' : ''}>Recurring</label>
      </div>
      <label class="field" data-type="once">Target<input name="target" value="${esc(g.target || '')}" placeholder="What does done look like?" autocomplete="off"></label>
      <div class="form-grid" data-type="recurring">
        <label class="field">Times per week<input type="number" inputmode="numeric" name="perWeek" min="1" max="21" value="${g.perWeek || 3}"></label>
        <label class="field">Session length<select name="sessionMinutes">${durOptions(g.sessionMinutes || 60)}</select></label>
        <label class="field wide">Session name<input name="sessionName" value="${esc(g.sessionName || '')}" placeholder="Workout" autocomplete="off"></label>
        <label class="check-line wide"><input type="checkbox" name="repeat" ${(goal ? g.repeat : true) ? 'checked' : ''}>Reuse each week's session times for the next week</label>
      </div>
      <div class="field"><span id="color-label">Colour</span><div class="swatches" role="radiogroup" aria-labelledby="color-label">
        ${Array.from({ length: L.GOAL_COLORS }, (_, i) => { const cur = goal ? L.goalColor(goal) : L.nextGoalColor(S()); return `<label class="swatch gc-${i}"><input type="radio" name="color" value="${i}" ${i === cur ? 'checked' : ''} aria-label="${COLOR_NAMES[i]}"><i></i></label>`; }).join('')}
      </div></div>
      <label class="field">Deadline (optional)<input type="date" name="deadline" value="${g.deadline || ''}"></label>
      ${goal ? '' : `<label class="field">Milestones (optional, one per line)<textarea name="milestones" placeholder="First 5k&#10;Sign up for the race"></textarea></label>`}
      <div class="notes" id="goal-notes" aria-live="polite"></div>
      <div class="sheet-actions">
        ${goal ? `<div class="left"><button type="button" class="btn danger" data-act="del-goal" data-id="${goal.id}">Delete goal</button></div>` : ''}
        <button class="btn primary">${goal ? 'Save' : 'Create goal'}</button>
      </div>
    </form>`);
    const form = $('form', sheet);
    const sync = () => {
      const type = new FormData(form).get('type');
      $$('[data-type]', form).forEach((el) => { el.hidden = el.dataset.type !== type; });
    };
    form.addEventListener('input', sync);
    sync();
    if (!goal) form.elements.title.focus();
    sheet._submit = () => {
      const f = new FormData(form);
      const title = f.get('title').trim();
      if (!title) { $('#goal-notes', form).innerHTML = '<p class="note err">Name your goal.</p>'; form.elements.title.focus(); return; }
      const type = f.get('type');
      const patch = {
        title, type, deadline: f.get('deadline') || null, target: type === 'once' ? f.get('target').trim() : '',
        perWeek: Math.max(1, parseInt(f.get('perWeek'), 10) || 1), sessionMinutes: Number(f.get('sessionMinutes')),
        sessionName: f.get('sessionName').trim(), repeat: type === 'recurring' && !!f.get('repeat'),
        color: Number(f.get('color')) || 0,
      };
      let id = goal && goal.id;
      Store.commit((s) => {
        if (goal) { Object.assign(s.goals.find((x) => x.id === goal.id), patch); L.carryForward(s, L.clock()); return; }
        id = L.uid();
        const milestones = (f.get('milestones') || '').split('\n').map((t) => t.trim()).filter(Boolean)
          .map((t) => ({ id: L.uid(), title: t, date: null, done: false, doneAt: null }));
        s.goals.push({ id, ...patch, milestones, completedAt: null, createdAt: L.clock().date });
      });
      closeSheet();
      if (!goal) location.hash = `#goal-${id}`;
      toast(goal ? 'Goal saved' : 'Goal created');
    };
  }

  function openTaskSheet(task) {
    const goal = task.goalId ? goalOf(task.goalId) : null;
    const inst = L.taskInst(S(), task.id);
    openSheet(`<form class="sheet-form" data-form="task">
      ${sheetHead('Edit task', inst ? `Scheduled ${fmtDate(inst.date)}, ${fmtTime(inst.start)}` : 'Not scheduled')}
      <label class="field">Task<input name="title" value="${esc(task.title)}" autocomplete="off"></label>
      <div class="form-grid">
        <label class="field">Estimate<select name="estimate">${durOptions(task.estimate, 'None')}</select></label>
        <label class="field">Due<input type="date" name="due" value="${task.due || ''}"></label>
        <label class="field wide">Goal<select name="goalId" ${task.session ? 'disabled' : ''}>${goalOptions(task.goalId)}</select></label>
        ${goal && goal.milestones.length && !task.session ? `<label class="field wide">Counts toward milestone<select name="milestoneId"><option value="">None</option>${goal.milestones.map((m) => `<option value="${m.id}" ${m.id === task.milestoneId ? 'selected' : ''}>${esc(m.title)}</option>`).join('')}</select></label>` : ''}
      </div>
      <div class="sheet-actions">
        <div class="left">
          <button type="button" class="btn danger" data-act="del-task" data-id="${task.id}">Delete task</button>
          ${task.done ? '' : `<button type="button" class="btn" data-act="schedule" data-id="${task.id}">${inst ? 'Move' : 'Schedule'}</button>`}
        </div>
        <button class="btn primary">Save</button>
      </div>
    </form>`);
    const form = $('form', sheet);
    sheet._submit = () => {
      const f = new FormData(form);
      const title = f.get('title').trim();
      if (!title) { form.elements.title.focus(); return; }
      Store.commit((s) => {
        const t = s.tasks.find((x) => x.id === task.id);
        t.title = title;
        t.estimate = Number(f.get('estimate')) || null;
        t.due = f.get('due') || null;
        if (!task.session) {
          const nextGoal = f.get('goalId') || null;
          if (nextGoal !== t.goalId) t.milestoneId = null;
          else if (f.has('milestoneId')) t.milestoneId = f.get('milestoneId') || null;
          t.goalId = nextGoal;
        }
        L.syncMilestones(s, L.clock().date);
      });
      closeSheet();
      toast('Task saved');
    };
  }

  /* Priority pickers. Today chooses tasks; a week can also choose whole goals. */
  function openPrioritySheet({ title, sub, selected, withGoals, onSave, due }) {
    const open = S().tasks.filter((t) => !t.done);
    const goals = withGoals ? S().goals.filter((g) => !g.completedAt) : [];
    const box = (type, id, label, meta) => `<label><input type="checkbox" name="pick" value="${type}:${id}" ${selected.includes(`${type}:${id}`) ? 'checked' : ''}><span><span class="row-title">${esc(label)}</span>${meta ? `<span class="row-meta">${meta}</span>` : ''}</span></label>`;
    openSheet(`<form class="sheet-form" data-form="priorities">
      ${sheetHead(title, sub)}
      <div class="pick-list">
        ${goals.length ? `<div class="pick-group">Goals</div>${goals.map((g) => box('goal', g.id, g.title, '')).join('')}` : ''}
        ${withGoals && open.length ? '<div class="pick-group">Tasks</div>' : ''}
        ${open.map((t) => box('task', t.id, t.title, taskMeta(t))).join('')}
        ${!open.length && !goals.length ? '<p class="empty">Nothing open yet. Add one below.</p>' : ''}
      </div>
      <label class="field">Or add a new task<input name="newTask" placeholder="New priority" autocomplete="off"></label>
      <div class="sheet-actions"><span class="sub" id="pick-count" style="margin-right:auto"></span><button class="btn primary">Save</button></div>
    </form>`);
    const form = $('form', sheet);
    const sync = () => {
      const boxes = $$('input[name=pick]', form);
      const n = boxes.filter((b) => b.checked).length + (form.elements.newTask.value.trim() ? 1 : 0);
      boxes.forEach((b) => { b.disabled = !b.checked && n >= 3; });
      form.elements.newTask.disabled = n >= 3 && !form.elements.newTask.value.trim();
      $('#pick-count', form).textContent = `${n} of 3 chosen`;
    };
    form.addEventListener('input', sync);
    sync();
    sheet._submit = () => {
      const picks = $$('input[name=pick]:checked', form).map((b) => b.value);
      const text = form.elements.newTask.value.trim();
      Store.commit((s) => {
        if (text) {
          const id = L.uid();
          s.tasks.push({ id, goalId: null, title: text, estimate: 30, due, done: false, doneAt: null, session: false, milestoneId: null });
          picks.push(`task:${id}`);
        }
        onSave(s, picks.slice(0, 3));
      });
      closeSheet();
      toast('Priorities saved');
    };
  }

  /* ---------- Appearance ----------
     Kept per device: a phone can stay dark while a work laptop stays light. */
  const THEME_KEY = 'waymark.theme';
  const THEME_BG = { light: '#eef1ec', dark: '#0f1512' };
  function themeChoice() {
    try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; }
  }
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    $$('meta[name="theme-color"]').forEach((m) => {
      const own = (m.getAttribute('media') || '').includes('dark') ? 'dark' : 'light';
      m.setAttribute('content', THEME_BG[t === 'system' ? own : t]);
    });
  }
  function setTheme(t) {
    try { if (t === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch { /* still applies for this visit */ }
    applyTheme(t);
  }
  applyTheme(themeChoice());

  function appearanceField() {
    const t = themeChoice();
    const opt = (v, label) => `<label><input type="radio" name="theme" value="${v}" ${t === v ? 'checked' : ''}>${label}</label>`;
    return `<div class="field"><span id="theme-label">Appearance</span>
      <div class="seg" role="radiogroup" aria-labelledby="theme-label">${opt('system', 'System')}${opt('light', 'Light')}${opt('dark', 'Dark')}</div>
      <p class="sub" style="font-weight:400">System matches your device's light or dark setting. This choice is saved on this device.</p></div>`;
  }

  function alertsText(state) {
    return {
      granted: 'On. Reminders also pop up outside the browser.',
      denied: 'Blocked for this page. Reminders still appear inside Waymark. You can allow notifications in your browser settings.',
      default: 'Off. Reminders appear inside Waymark only.',
      unsupported: 'Not available in this view. Reminders appear inside Waymark.',
    }[state] || 'Not available in this view. Reminders appear inside Waymark.';
  }

  function remindersFields() {
    const r = L.reminderSettings(S());
    const leads = [[0, 'At start time'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before']];
    const alerts = alertsState();
    return `<div class="field"><span>Reminders</span>
      <div class="rem-settings">
        <div class="rem-line"><label class="check-line"><input type="checkbox" name="rem-on" ${r.on ? 'checked' : ''}>Scheduled blocks</label>
          <select name="rem-lead" aria-label="When to remind about blocks">${leads.map(([v, t]) => `<option value="${v}" ${v === r.lead ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="rem-line"><label class="check-line"><input type="checkbox" name="rem-due" ${r.due ? 'checked' : ''}>Tasks due today, at</label>
          <input type="time" name="rem-dueAt" value="${L.fromMin(r.dueAt)}" aria-label="Time to remind about tasks due today"></div>
        <label class="check-line"><input type="checkbox" name="rem-sound" ${remLocal.sound ? 'checked' : ''}>Play a sound on this device</label>
        <div class="rem-alerts"><p class="sub" id="alerts-status" style="font-weight:400">Desktop alerts: ${esc(alertsText(alerts))}</p>
          <div class="btn-row">${alerts === 'default' ? '<button type="button" class="btn small" data-act="enable-alerts">Turn on desktop alerts</button>' : ''}
          <button type="button" class="btn small ghost" data-act="test-reminder">Send a test</button></div></div>
        <p class="sub" style="font-weight:400">Reminders go off while Waymark is open on this device, even in a background tab. Keep a tab open during the day so nothing slips by.</p>
      </div></div>`;
  }

  function openSettingsSheet(onlyAvailability) {
    const st = S().settings;
    const order = [...Array(7).keys()].map((n) => (n + st.weekStart) % 7);
    openSheet(`<form class="sheet-form" data-form="settings">
      ${sheetHead(onlyAvailability ? 'Availability' : 'Settings', onlyAvailability ? 'Open-slot suggestions stay inside these hours.' : '')}
      ${onlyAvailability ? '' : `${appearanceField()}<div class="field"><span>Availability</span><p class="sub" style="font-weight:400">Open-slot suggestions stay inside these hours.</p></div>`}
      <div class="stack" style="gap:6px">
        ${order.map((d) => { const a = st.availability[d]; return `<div class="avail-row">
          <label class="check-line"><input type="checkbox" name="on-${d}" ${a.on ? 'checked' : ''}>${fmtDate(L.addDays('2026-11-01', d), { weekday: 'short' })}</label>
          <input type="time" name="start-${d}" value="${L.fromMin(a.start)}" aria-label="${fmtDate(L.addDays('2026-11-01', d), { weekday: 'long' })} start">
          <input type="time" name="end-${d}" value="${L.fromMin(a.end)}" aria-label="${fmtDate(L.addDays('2026-11-01', d), { weekday: 'long' })} end">
        </div>`; }).join('')}
      </div>
      <label class="field">Week starts on<select name="weekStart">
        <option value="1" ${st.weekStart === 1 ? 'selected' : ''}>Monday</option>
        <option value="0" ${st.weekStart === 0 ? 'selected' : ''}>Sunday</option></select></label>
      ${onlyAvailability ? '' : remindersFields()}
      ${onlyAvailability ? '' : `<div class="field"><span>Backup</span>
        <p class="sub" style="font-weight:400">${Store.synced ? 'Your data syncs privately to your Claude account, on any device where you open Waymark signed in. Export a file for an extra copy.' : 'Your data lives in this browser only. Export a file to back it up or move it to another device.'}</p>
        <div class="btn-row"><button type="button" class="btn" data-act="export">Export</button>
        <label class="btn">Import<input type="file" id="import-file" accept="application/json,.json" hidden></label></div></div>`}
      <div class="notes" id="settings-notes" aria-live="polite"></div>
      <div class="sheet-actions"><button class="btn primary">Save</button></div>
    </form>`);
    const form = $('form', sheet);
    // Appearance applies straight away; it doesn't wait for Save.
    form.addEventListener('change', (e) => { if (e.target.name === 'theme') setTheme(e.target.value); });
    const file = $('#import-file', form);
    if (file) {
      file.addEventListener('change', async () => {
        try {
          Store.replace(JSON.parse(await file.files[0].text()));
          closeSheet();
          toast('Backup imported');
        } catch (e) {
          $('#settings-notes', form).innerHTML = `<p class="note err">Could not import: ${esc(e.message)}</p>`;
        }
      });
    }
    sheet._submit = () => {
      const f = new FormData(form);
      const avail = {};
      for (const d of order) {
        const a = st.availability[d];
        const start = f.get(`start-${d}`) ? L.toMin(f.get(`start-${d}`)) : a.start;
        const end = f.get(`end-${d}`) ? L.toMin(f.get(`end-${d}`)) : a.end;
        if (f.get(`on-${d}`) && end <= start) {
          $('#settings-notes', form).innerHTML = `<p class="note err">${fmtDate(L.addDays('2026-11-01', d), { weekday: 'long' })} must end after it starts.</p>`;
          return;
        }
        avail[d] = { on: !!f.get(`on-${d}`), start, end };
      }
      const rem = onlyAvailability ? null : {
        on: !!f.get('rem-on'), lead: Number(f.get('rem-lead')),
        due: !!f.get('rem-due'), dueAt: f.get('rem-dueAt') ? L.toMin(f.get('rem-dueAt')) : L.reminderSettings(S()).dueAt,
      };
      if (!onlyAvailability) { remLocal.sound = !!f.get('rem-sound'); saveRemLocal(); }
      Store.commit((s) => {
        s.settings.availability = avail; s.settings.weekStart = Number(f.get('weekStart'));
        if (rem) s.settings.reminders = rem;
      });
      closeSheet();
      toast('Settings saved');
    };
  }

  async function exportData() {
    if (Store.hosted) {
      const downloads = await window.claude.use('downloads');
      if (!downloads) { toast('Export is not available in this view.', false); return; }
      try {
        await downloads.save({ filename: `waymark-backup-${L.clock().date}.json`, data: JSON.stringify(S(), null, 2) });
      } catch (e) {
        if (e && e.code !== 'declined') toast('Export did not finish.', false);
      }
      return;
    }
    const blob = new Blob([JSON.stringify(S(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `waymark-backup-${L.clock().date}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Celebrations ----------
     A small burst for any finished task; a card for bigger moments (a week's target met, a
     milestone, today's schedule cleared, a goal complete). With reduced motion: no confetti. */
  const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  function colorOf(goal) {
    const probe = document.createElement('span');
    probe.className = goal ? `gc-${L.goalColor(goal)}` : '';
    probe.style.display = 'none';
    document.body.append(probe);
    const v = getComputedStyle(probe).getPropertyValue(goal ? '--g' : '--accent').trim();
    probe.remove();
    return v || '#2c6b66';
  }
  const showTop = (el) => { try { if (typeof el.showPopover === 'function') { if (!el.popover) el.popover = 'manual'; if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } } catch { /* plain fixed layer */ } };
  const hideTop = (el) => { try { if (el.matches && el.matches(':popover-open')) el.hidePopover(); } catch { /* ignore */ } };

  let fx = null;
  function confetti({ x, y, colors, count = 28, power = 1, rain = false }) {
    if (reduceMotion()) return;
    if (!fx) {
      const canvas = document.createElement('canvas');
      canvas.id = 'fx';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.append(canvas);
      fx = { canvas, ctx: canvas.getContext('2d'), parts: [], running: false };
    }
    const { canvas } = fx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== innerWidth * dpr || canvas.height !== innerHeight * dpr) {
      canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    }
    showTop(canvas);
    for (let i = 0; i < count; i++) {
      const a = rain ? Math.PI / 2 + (Math.random() - 0.5) * 0.9 : Math.random() * Math.PI * 2;
      const v = (rain ? 2 + Math.random() * 3 : 3 + Math.random() * 5) * power;
      fx.parts.push({
        x: rain ? Math.random() * innerWidth : x, y: rain ? -10 - Math.random() * innerHeight * 0.3 : y,
        vx: Math.cos(a) * v * (rain ? 0.6 : 1), vy: rain ? v : Math.sin(a) * v - 3 * power,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        w: 5 + Math.random() * 5, h: 3 + Math.random() * 4,
        c: colors[i % colors.length], life: rain ? 220 : 80 + Math.random() * 30, round: Math.random() < 0.3,
      });
    }
    if (fx.running) return;
    fx.running = true;
    const tick = () => {
      const { ctx, parts } = fx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.vy += 0.18; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life--;
        if (p.life <= 0 || p.y > innerHeight + 20) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.min(1, p.life / 25);
        ctx.fillStyle = p.c;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.h / 1.4, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (parts.length) requestAnimationFrame(tick);
      else { fx.running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); hideTop(fx.canvas); }
    };
    requestAnimationFrame(tick);
  }

  const palette = (goal) => [colorOf(goal), colorOf(null), '#f2b84b', '#ef8a6b'];

  let cheerTimer = null;
  function closeCheer() {
    const box = $('#cheer');
    if (!box) return;
    clearTimeout(cheerTimer);
    box.classList.remove('is-in');
    hideTop(box);
    box.innerHTML = '';
  }
  function cheer({ goal, title, sub, streak, icon = 'flame', small = false }) {
    let box = $('#cheer');
    if (!box) {
      box = document.createElement('div');
      box.id = 'cheer';
      box.setAttribute('role', 'status');
      document.body.append(box);
    }
    box.className = goal ? `gc-${L.goalColor(goal)}` : '';
    const mark = icon === 'star'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8Z"/></svg>'
      : icon === 'check' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19.5 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : FLAME;
    box.innerHTML = `<div class="cheer-card">
      <div class="cheer-mark">${mark}</div>
      <div class="cheer-text"><b>${esc(title)}</b>${sub ? `<p>${esc(sub)}</p>` : ''}${streak ? `<p class="streak">${FLAME}${streak}</p>` : ''}</div>
      <button class="btn small" data-act="cheer-close">Nice</button></div>`;
    showTop(box);
    requestAnimationFrame(() => box.classList.add('is-in'));
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(closeCheer, small ? 3500 : 5000);
    const r = box.firstElementChild.getBoundingClientRect();
    confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, colors: palette(goal), count: small ? 50 : 70, power: 1.3 });
    if (!small) confetti({ colors: palette(goal), count: 90, rain: true });
  }

  function dayCleared(today) {
    const list = L.instances(S(), today, today).filter((i) => i.taskId);
    return list.length >= 2 && list.every((i) => i.done);
  }

  function celebrateTask(t, g, { week, weekBefore, msBefore, dayBefore, origin, today }) {
    $$(`.check[data-id="${t.id}"]`).forEach((c) => c.classList.add('just-done'));
    if (g && weekBefore !== null) {
      const p = L.recurringProgress(S(), g, week);
      if (weekBefore < g.perWeek && p.done >= g.perWeek) {
        const n = L.weekStreak(S(), g, today);
        cheer({ goal: g, title: 'Week won', sub: `${p.done} of ${p.target} ${g.sessionName || g.title} sessions done`, streak: n >= 2 ? `${n}-week streak` : n === 1 ? 'Streak started' : '' });
        return;
      }
    }
    if (g && g.milestones.filter((m) => m.done).length > msBefore) {
      const m = g.milestones.filter((x) => x.done && x.doneAt === today).pop();
      cheer({ goal: g, title: 'Milestone reached', sub: m ? m.title : g.title, icon: 'star', small: true });
      return;
    }
    if (!dayBefore && dayCleared(today)) {
      cheer({ title: "Today's schedule, done", sub: 'Every scheduled task for today is finished.', icon: 'check', small: true });
      return;
    }
    const x = origin ? origin.left + origin.width / 2 : innerWidth / 2;
    const y = origin ? origin.top + origin.height / 2 : innerHeight / 3;
    confetti({ x, y, colors: palette(g), count: 26, power: 0.8 });
  }

  /* ---------- Reminders ----------
     Rules live in Logic.dueReminders. What this device has already shown, dismissed or snoozed
     is kept in this browser, so each device alerts once and a dismissal never reaches the others. */
  const REM_KEY = 'waymark.reminders.v1';
  const DAY_MS = 864e5;
  const remLocal = (() => {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(REM_KEY) || '{}') || {}; } catch { d = {}; }
    return { fired: d.fired || {}, dismissed: d.dismissed || {}, snoozed: d.snoozed || {}, sound: d.sound !== false };
  })();
  function saveRemLocal() {
    const cutoff = Date.now() - 2 * DAY_MS;
    for (const map of [remLocal.fired, remLocal.dismissed]) for (const k of Object.keys(map)) if (map[k] < cutoff) delete map[k];
    for (const k of Object.keys(remLocal.snoozed)) if (remLocal.snoozed[k].until < cutoff) delete remLocal.snoozed[k];
    try { localStorage.setItem(REM_KEY, JSON.stringify(remLocal)); } catch { /* reminders still work for this visit */ }
  }

  const alertsState = () => {
    try { return 'Notification' in window ? Notification.permission : 'unsupported'; } catch { return 'unsupported'; }
  };

  let audioCtx = null;
  const unlockAudio = () => {
    try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch { audioCtx = null; }
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio);
  function chime() {
    if (!remLocal.sound || !audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      [[880, 0], [1175, 0.16]].forEach(([f, at]) => {
        const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.exponentialRampToValueAtTime(0.18, t + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.5);
        o.connect(g).connect(audioCtx.destination);
        o.start(t + at); o.stop(t + at + 0.55);
      });
    } catch { /* sound is a nicety */ }
  }

  function remWhen(r, now) {
    if (r.kind === 'due') return 'Due today';
    const diff = r.start - now.min;
    const range = `${fmtTime(r.start)}–${fmtTime(r.end)}`;
    if (diff > 0) return `Starts in ${diff} min · ${range}`;
    if (diff === 0) return `Starting now · ${range}`;
    return `Started ${-diff} min ago · ${range}`;
  }

  function systemAlert(r, now) {
    if (alertsState() !== 'granted') return;
    try {
      const n = new Notification(r.title, { body: remWhen(r, now), tag: r.id });
      n.onclick = () => { try { window.focus(); } catch { /* ignore */ } n.close(); };
    } catch { /* some views allow the permission but not the alert */ }
  }

  // What the tray should show right now: live reminders plus any snoozes that have come due.
  function activeReminders(now) {
    const nowMs = Date.now();
    const state = S();
    const live = L.dueReminders(state, now).filter((r) => !remLocal.dismissed[r.id] && !(remLocal.snoozed[r.id] && remLocal.snoozed[r.id].until > nowMs));
    const ids = new Set(live.map((r) => r.id));
    for (const [id, s] of Object.entries(remLocal.snoozed)) {
      if (s.until > nowMs || ids.has(id) || remLocal.dismissed[id]) continue;
      const t = s.rem.taskId && taskOf(s.rem.taskId);
      if (s.rem.taskId && (!t || t.done)) continue;
      if (!s.rem.taskId && s.rem.key && !L.findInst(state, s.rem.key, s.rem.date)) continue;
      live.push({ ...s.rem, id, snoozedAgain: true, fireKey: `${id}@${s.until}` });
    }
    return live;
  }

  let trayItems = [];
  let raiseTray = false;
  function tickReminders() {
    if (!Store.ready) return;
    const now = L.clock();
    trayItems = activeReminders(now);
    let fresh = false;
    for (const r of trayItems) {
      const key = r.fireKey || r.id;
      if (remLocal.fired[key]) continue;
      remLocal.fired[key] = Date.now();
      fresh = true;
      systemAlert(r, now);
    }
    if (fresh) { chime(); saveRemLocal(); raiseTray = true; }
    renderTray(now);
  }

  function renderTray(now = L.clock()) {
    let tray = $('#reminders');
    if (!tray) {
      tray = document.createElement('section');
      tray.id = 'reminders';
      tray.setAttribute('aria-label', 'Reminders');
      tray.setAttribute('aria-live', 'polite');
      document.body.append(tray);
    }
    const shown = trayItems.slice(0, 3);
    const html = shown.map((r) => {
      const t = r.taskId && taskOf(r.taskId);
      return `<article class="reminder kind-${r.kind}">
        <div class="reminder-text"><span class="reminder-when">${esc(remWhen(r, now))}</span><b>${esc(r.title)}</b></div>
        <div class="reminder-actions">
          ${t && !t.done ? `<button class="btn small primary" data-act="rem-done" data-id="${esc(r.id)}">Mark done</button>` : ''}
          ${r.id.startsWith('test:') ? '' : `<button class="btn small" data-act="rem-snooze" data-id="${esc(r.id)}">Snooze 10 min</button>`}
          <button class="btn small ghost" data-act="rem-dismiss" data-id="${esc(r.id)}">Dismiss</button>
        </div></article>`;
    }).join('') + (trayItems.length > 3 ? `<p class="reminder-more">${trayItems.length - 3} more · <button data-act="rem-dismiss-all">Dismiss all</button></p>` : '');
    // Only redraw when something changed, so cards don't re-animate on every check.
    if (html !== tray._html) { tray.innerHTML = html; tray._html = html; }
    // As a popover the tray sits in the top layer, so it stays visible above an open sheet.
    if (typeof tray.showPopover === 'function') {
      try {
        if (!tray.popover) tray.popover = 'manual';
        const isOpen = tray.matches(':popover-open');
        if (!shown.length) { if (isOpen) tray.hidePopover(); }
        else if (!isOpen) tray.showPopover();
        else if (sheet.open && raiseTray) { tray.hidePopover(); tray.showPopover(); }
      } catch { /* falls back to a plain fixed panel */ }
    }
    raiseTray = false;
    const base = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = trayItems.length ? `(${trayItems.length}) ${base}` : base;
  }

  const remById = (id) => trayItems.find((r) => r.id === id);
  function dismissRem(id) {
    remLocal.dismissed[id] = Date.now();
    delete remLocal.snoozed[id];
    saveRemLocal();
    tickReminders();
  }

  /* ---------- Plain-English quick add ---------- */
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const KIND_LABEL = { task: 'Task', event: 'Event', habit: 'Habit' };

  function smartPrompt(text) {
    const now = L.clock();
    const days = Array.from({ length: 28 }, (_, i) => { const d = L.addDays(now.date, i); return `${d} ${DAY_NAMES[L.weekday(d)]}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}`; });
    const goals = S().goals.filter((g) => !g.completedAt).slice(0, 30).map((g) => `${g.id}: ${g.title}`);
    return `You turn one line a person typed into a planner entry. Reply with only one JSON object.

Now: ${days[0].split(' ')[0]} ${DAY_NAMES[L.weekday(now.date)]}, ${L.fromMin(now.min)}. Use this calendar for dates; do not compute weekdays yourself:
${days.join('\n')}

Their existing goals (id: title):
${goals.length ? goals.join('\n') : '(none)'}

JSON shape:
{"kind": "task" | "event" | "habit", "title": string, "minutes": number | null, "date": "YYYY-MM-DD" | null, "time": "HH:MM" | null, "after": "HH:MM" | null, "before": "HH:MM" | null, "days": number[] | null, "until": "YYYY-MM-DD" | null, "due": "YYYY-MM-DD" | null, "goalId": string | null, "assumptions": string[]}

Rules:
- kind "task": a one-off thing to do (call, email, finish, buy, apply). "event": something fixed in time, usually with other people or a place (meeting, interview, class, appointment); repeating ones use "days". "habit": something they want to practise repeatedly (study, gym, reading, practice).
- "time" only for an exact start ("at 3", "9:30am"). Vague times become a window: morning after 06:00 before 12:00; afternoon after 12:00 before 17:00; evening after 17:00 before 21:00; "after 2" means after 14:00. Hours 1 to 7 without am/pm mean pm.
- "date" is the day it happens (single entries only). A weekday name means the next one on the calendar after today, unless they say today. "due" is a deadline ("by Friday").
- "days" lists weekdays for habits and repeating events: 0 Sun, 1 Mon, 2 Tue, 3 Wed, 4 Thu, 5 Fri, 6 Sat. Weekdays means [1,2,3,4,5]. "3 times a week" without days means [1,3,5].
- "until" is the last date it repeats, if they gave one.
- "minutes" only if they said a length.
- "title": short, in sentence case, without the time words ("Call Steven", "SQL practice").
- "goalId": only when the entry clearly belongs to one of the existing goals above.
- "assumptions": up to 2 short notes on anything you had to guess, for example "Assumed 2 PM". Empty if nothing was guessed.

Line: ${JSON.stringify(text)}`;
  }

  const SMART_ERRORS = {
    not_granted: 'Waymark needs your permission to use Claude for this. You can still add tasks and events by hand.',
    sampling_disabled: 'Claude isn\'t available for your account here. You can still add tasks and events by hand.',
    rate_limited: 'Too many requests right now. Wait a moment and try again.',
    session_expired: 'Sign in to Claude again, then try once more.',
    refused: 'That couldn\'t be turned into an entry. Try rewording it.',
    invalid_json: 'That didn\'t come back in a form Waymark understands. Try again, or reword it.',
    empty_completion: 'Nothing came back. Try rewording it.',
  };
  const HIDE_CODES = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];

  let smartCtl = null;
  async function smartAdd(text, form) {
    if (!smart.fn) return;
    openSheet(`<form class="sheet-form" data-form="smart-wait">
      ${sheetHead('Reading that…', `“${text}”`)}
      <p class="smart-thinking" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Working out what and when</p>
      <div class="sheet-actions"><button type="button" class="btn" data-act="smart-stop">Stop</button></div>
    </form>`);
    sheet._submit = () => {};
    smartCtl = new AbortController();
    const ctl = smartCtl;
    sheet.addEventListener('close', () => ctl.abort(), { once: true });
    let raw;
    try {
      raw = await smart.fn.json(smartPrompt(text), { modelTier: 'quick', signal: smartCtl.signal });
    } catch (e) {
      const code = (e && e.code) || 'upstream_error';
      if (code === 'cancelled') { closeSheet(); return; }
      if (HIDE_CODES.includes(code)) { smart.state = 'off'; ui.quickKind = 'task'; }
      closeSheet();
      toast(SMART_ERRORS[code] || 'Something went wrong reaching Claude. Try again.', false);
      if (HIDE_CODES.includes(code)) render();
      return;
    } finally { smartCtl = null; }
    if (!sheet.open) return; // closed while waiting
    const plan = L.cleanPlan(raw);
    if (!plan) { closeSheet(); toast('That couldn\'t be turned into an entry. Try adding a little more detail.', false); return; }
    openSmartPreview(text, plan, form);
  }

  function slotLine(r) {
    if (r.kind === 'habit') {
      if (!r.slots.length) return 'No sessions fit before the end date.';
      const days = r.days.map((d) => DAY_NAMES[d]).join(', ');
      return `${plural(r.perWeek, 'session')} a week (${days}) at ${fmtTime(r.slots[0].start)}${r.deadline ? `, until ${fmtDate(r.deadline)}` : ''}. Scheduled now: ${r.slots.map((s) => fmtDate(s.date)).join(', ')}. Later weeks repeat automatically.`;
    }
    if (r.recurrence) {
      const s = r.slots[0];
      return `Every ${r.recurrence.days.map((d) => DAY_NAMES[d]).join(', ')} at ${fmtTime(s.start)}–${fmtTime(s.start + r.duration)}${r.recurrence.until ? `, until ${fmtDate(r.recurrence.until)}` : ''}. First one ${relDay(s.date)}.`;
    }
    if (!r.slots.length) return `Not scheduled yet${r.due ? `, due ${relDay(r.due)}` : ''}. It goes to Needs a time.`;
    const s = r.slots[0];
    return `${relDay(s.date)}, ${fmtTime(s.start)}–${fmtTime(s.start + r.duration)}${r.due ? ` · due ${relDay(r.due)}` : ''}`;
  }

  function smartNotes(r) {
    const notes = r.assumptions.map((a) => ['', a]);
    const clashes = [];
    const dates = r.recurrence ? (r.upcoming || []).slice(0, 4) : r.slots.map((s) => s.date);
    const start = r.slots[0] && r.slots[0].start;
    for (const d of dates) {
      if (start === undefined) break;
      const c = L.conflicts(S(), d, start, r.duration);
      if (c.length) clashes.push(`${fmtDate(d)}: ${conflictText(c)}`);
      else if (L.outsideAvailability(S(), d, start, r.duration)) clashes.push(`${fmtDate(d)}: outside your availability`);
    }
    if (clashes.length) notes.push(['warn', clashes.slice(0, 3).join(' · ') + (clashes.length > 3 ? ` · ${clashes.length - 3} more` : '')]);
    if (start !== undefined && start + r.duration > 1440) notes.push(['err', 'This would run past midnight. Choose an earlier time or a shorter length.']);
    return notes;
  }

  function openSmartPreview(text, plan, quickForm) {
    const p = { ...plan };
    let chosenLength = p.minutes !== null;
    let r = L.resolvePlan(S(), p, L.clock());
    const kindSeg = ['task', 'event', 'habit'].map((k) => `<label><input type="radio" name="pkind" value="${k}" ${p.kind === k ? 'checked' : ''}>${KIND_LABEL[k]}</label>`).join('');
    const dayChips = () => [1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" class="chip day-chip" data-day="${d}" aria-pressed="${(p.days || []).includes(d)}">${DAY_NAMES[d]}</button>`).join('');
    openSheet(`<form class="sheet-form" data-form="smart">
      ${sheetHead('Add to Waymark', `From “${text}”`)}
      <div class="seg" role="radiogroup" aria-label="Type of entry">${kindSeg}</div>
      <label class="field">Title<input name="title" value="${esc(p.title)}" autocomplete="off" maxlength="120"></label>
      <div class="form-grid">
        <label class="field" data-show="single">Date<input type="date" name="date"></label>
        <label class="field">Time<input type="time" name="time"></label>
        <label class="field">Length<select name="minutes">${durOptions(r.duration)}</select></label>
        <label class="field" data-show="task">Due (optional)<input type="date" name="due" value="${p.due || ''}"></label>
        <label class="field" data-show="repeat">Until (optional)<input type="date" name="until" value="${p.until || ''}"></label>
      </div>
      <div class="field" data-show="days"><span id="days-label">Repeats on</span><div class="chips" role="group" aria-labelledby="days-label">${dayChips()}</div></div>
      <div class="smart-summary"><b id="smart-kind"></b><p id="smart-when"></p></div>
      <div class="notes" id="smart-notes" aria-live="polite"></div>
      <div class="sheet-actions">
        <div class="left"><button type="button" class="btn ghost" data-act="smart-back">Reword</button></div>
        <button class="btn primary" id="smart-add">Add</button>
      </div>
    </form>`);
    const form = $('form', sheet);
    const el = form.elements;
    const repeating = () => p.kind === 'habit' || (p.kind === 'event' && p.days && p.days.length);
    const paint = (syncFields) => {
      r = L.resolvePlan(S(), p, L.clock());
      $$('[data-show]', form).forEach((n) => {
        const k = n.dataset.show;
        n.hidden = k === 'single' ? repeating() : k === 'task' ? p.kind !== 'task' : k === 'repeat' ? !repeating() : k === 'days' ? p.kind === 'task' : false;
      });
      if (syncFields) {
        const s0 = r.slots[0];
        if (document.activeElement !== el.date) el.date.value = s0 && !repeating() ? s0.date : '';
        if (document.activeElement !== el.time) el.time.value = s0 ? L.fromMin(s0.start) : '';
        $$('.day-chip', form).forEach((c) => c.setAttribute('aria-pressed', String((p.days || []).includes(Number(c.dataset.day)))));
      }
      $('#smart-kind', form).textContent = p.kind === 'habit' ? 'New recurring goal' : p.kind === 'event' ? (r.recurrence ? 'Repeating event' : 'Event') : r.goalId ? `Task for ${goalOf(r.goalId).title}` : 'Task';
      $('#smart-when', form).textContent = slotLine(r);
      const notes = smartNotes(r);
      $('#smart-notes', form).innerHTML = notes.map(([k, t]) => `<p class="note ${k}">${esc(t)}</p>`).join('');
      const blocked = notes.some(([k]) => k === 'err') || (p.kind === 'habit' && !r.slots.length) || (p.kind === 'event' && !r.slots.length);
      $('#smart-add', form).disabled = blocked;
      $('#smart-add', form).textContent = p.kind === 'habit' ? 'Create goal' : p.kind === 'event' ? 'Add event' : 'Add task';
    };
    form.addEventListener('input', (e) => {
      const n = e.target.name;
      if (n === 'pkind') {
        p.kind = e.target.value;
        if (p.kind === 'habit' && !(p.days && p.days.length)) p.days = [1, 3, 5];
        if (!chosenLength) { p.minutes = null; el.minutes.value = String({ task: 30, event: 60, habit: 60 }[p.kind]); }
        paint(true); return;
      }
      if (n === 'title') p.title = el.title.value.trim() || plan.title;
      if (n === 'minutes') { p.minutes = Number(el.minutes.value); chosenLength = true; }
      if (n === 'time') p.time = el.time.value ? L.toMin(el.time.value) : null;
      if (n === 'date') { p.date = el.date.value || null; if (!p.date && p.kind === 'task') p.time = null; }
      if (n === 'due') p.due = el.due.value || null;
      if (n === 'until') p.until = el.until.value || null;
      paint(n === 'date' || n === 'minutes' || n === 'until');
    });
    form.addEventListener('click', (e) => {
      const chip = e.target.closest('.day-chip');
      if (!chip) return;
      const d = Number(chip.dataset.day);
      const set = new Set(p.days || []);
      if (set.has(d)) set.delete(d); else set.add(d);
      if (p.kind === 'habit' && !set.size) return;
      p.days = [...set].sort();
      paint(true);
    });
    sheet._back = () => { closeSheet(); if (quickForm && quickForm.isConnected) { quickForm.elements.title.value = text; quickForm.elements.title.focus(); } };
    sheet._submit = () => {
      r = L.resolvePlan(S(), p, L.clock());
      r.title = p.title;
      let made = null;
      Store.commit((s) => { made = L.applyPlan(s, r, L.clock()); });
      closeSheet();
      if (quickForm && quickForm.isConnected) quickForm.elements.title.value = '';
      const what = p.kind === 'habit' ? `Goal created: ${r.title}, ${plural(r.slots.length, 'session')} scheduled` : `Added: ${r.title}${r.slots[0] ? `, ${relDay(r.slots[0].date)} ${fmtTime(r.slots[0].start)}` : ''}`;
      toast(what);
      if (made && made.goalId) location.hash = `#goal-${made.goalId}`;
    };
    paint(true);
    el.title.focus();
    el.title.select();
  }

  // Find out once whether this view can ask Claude; switch the quick add to Describe if so.
  (async () => {
    if (!(window.claude && typeof window.claude.use === 'function')) { smart.state = 'off'; return; }
    try { smart.fn = await window.claude.use('sample'); } catch { smart.fn = null; }
    smart.state = smart.fn && typeof smart.fn.json === 'function' ? 'ready' : 'off';
    if (smart.state === 'ready' && !smart.touched) ui.quickKind = 'smart';
    const el = document.activeElement;
    if (!sheet.open && !(main.contains(el) && /INPUT|SELECT|TEXTAREA/.test(el.tagName))) render();
  })();

  /* ---------- Repeating sessions ---------- */
  function filledText(filled) {
    if (!filled.length) return '';
    const total = filled.reduce((n, f) => n + f.count, 0);
    const names = [...new Set(filled.map((f) => f.goal.sessionName || f.goal.title))];
    const weeks = [...new Set(filled.map((f) => weekRange(f.week)))];
    return `Added ${plural(total, 'session')} (${names.slice(0, 2).join(', ')}${names.length > 2 ? '…' : ''}) for ${weeks.join(' and ')}, copied from your last full week`;
  }

  // Runs whenever the app draws: on load, at the start of each week, and when data arrives.
  let carrying = false;
  function autoCarry() {
    if (carrying || !Store.ready || Store.issue === 'unreachable' || Store.issue === 'stopped' || sheet.open || dragActive) return;
    const now = L.clock();
    if (!L.carryForward(JSON.parse(JSON.stringify(S())), now).changed) return;
    let result = null;
    carrying = true;
    try { Store.commit((s) => { result = L.carryForward(s, now); }); } finally { carrying = false; }
    if (result && result.filled.length) toast(`${filledText(result.filled)}.`, false);
  }

  /* ---------- Actions ---------- */
  const actions = {
    'smart-stop'() { if (smartCtl) smartCtl.abort(); else closeSheet(); },
    'smart-back'() { if (sheet._back) sheet._back(); },
    'toggle-repeat'(d) {
      const g = goalOf(d.id);
      if (!g) return;
      const on = !g.repeat;
      let result = null;
      carrying = true;
      try {
        Store.commit((s) => {
          const x = s.goals.find((y) => y.id === d.id);
          x.repeat = on;
          if (on) result = L.carryForward(s, L.clock());
        });
      } finally { carrying = false; }
      const filled = result ? filledText(result.filled) : '';
      toast(on ? (filled ? `Repeats weekly. ${filled}` : 'Repeats weekly. New weeks reuse your session times.') : 'No longer repeats. Scheduled sessions stay as they are.');
    },
    'rem-dismiss'(d) { dismissRem(d.id); },
    'rem-dismiss-all'() { trayItems.forEach((r) => { remLocal.dismissed[r.id] = Date.now(); delete remLocal.snoozed[r.id]; }); saveRemLocal(); tickReminders(); },
    'rem-snooze'(d) {
      const r = remById(d.id);
      if (!r) return;
      const { snoozedAgain, fireKey, ...rem } = r;
      remLocal.snoozed[d.id] = { until: Date.now() + 10 * 60000, rem };
      saveRemLocal();
      tickReminders();
      toast(`Snoozed: ${r.title}`, false);
    },
    'rem-done'(d) {
      const r = remById(d.id);
      const t = r && r.taskId && taskOf(r.taskId);
      if (t && !t.done) actions['toggle-task']({ id: t.id });
      dismissRem(d.id);
    },
    async 'enable-alerts'(d, el) {
      const out = $('#alerts-status');
      let result = alertsState();
      if (result === 'default') {
        try { result = await Notification.requestPermission(); } catch { result = 'unsupported'; }
      }
      if (out) out.textContent = `Desktop alerts: ${alertsText(result)}`;
      if (el && (result === 'granted' || result === 'denied' || result === 'unsupported')) el.hidden = true;
    },
    'test-reminder'() {
      unlockAudio();
      const now = L.clock();
      const r = { id: `test:${Date.now()}`, kind: 'block', title: 'Test reminder', start: now.min + 10, end: now.min + 40 };
      systemAlert(r, now);
      chime();
      trayItems = [r, ...trayItems.filter((x) => !x.id.startsWith('test:'))];
      raiseTray = true;
      renderTray(now);
    },
    undo() { Store.undo(); $('#toast').innerHTML = ''; },
    'close-sheet': closeSheet,
    settings() { openSettingsSheet(false); },
    availability() { openSettingsSheet(true); },
    'toggle-task'(d, el) {
      const t = taskOf(d.id);
      if (!t) return;
      const done = !t.done;
      const today = L.clock().date;
      const g = t.goalId && goalOf(t.goalId);
      const inst = L.taskInst(S(), t.id);
      const week = L.startOfWeek(inst ? inst.date : today, ws());
      const weekBefore = g && g.type === 'recurring' && t.session ? L.recurringProgress(S(), g, week).done : null;
      const msBefore = g ? g.milestones.filter((m) => m.done).length : 0;
      const dayBefore = dayCleared(today);
      const origin = el && el.isConnected ? el.getBoundingClientRect() : null;
      Store.commit((s) => L.setTaskDone(s, t.id, done, today));
      toast(done ? `Completed: ${t.title}` : `Reopened: ${t.title}`);
      if (done) celebrateTask(t, g && goalOf(g.id), { week, weekBefore, msBefore, dayBefore, origin, today });
    },
    'sheet-toggle-done'(d) { closeSheet(); actions['toggle-task'](d); },
    'sheet-remove'() { sheet._remove(); },
    schedule(d) { openBlockSheet({ taskId: d.id, hint: d.hint }); },
    'edit-task'(d) { const t = taskOf(d.id); if (t) openTaskSheet(t); },
    'del-task'(d) {
      const t = taskOf(d.id);
      Store.commit((s) => L.removeTask(s, d.id, L.clock().date));
      closeSheet();
      toast(`Deleted: ${t.title}`);
    },
    'open-inst'(d) { const inst = L.findInst(S(), d.key, d.date); if (inst) openBlockSheet({ inst }); },
    'pick-slot'(d) { sheet._pickSlot(d.date, Number(d.start)); },
    'new-event'() { openBlockSheet({ date: ui.calDate < L.clock().date ? L.clock().date : ui.calDate }); },
    'new-goal'() { openGoalSheet(); },
    'edit-goal'(d) { openGoalSheet(goalOf(d.id)); },
    'del-goal'(d) {
      const g = goalOf(d.id);
      Store.commit((s) => L.deleteGoal(s, d.id));
      closeSheet();
      location.hash = '#goals';
      toast(`Deleted goal: ${g.title}`);
    },
    'toggle-goal'(d) {
      const g = goalOf(d.id);
      const completing = !g.completedAt;
      Store.commit((s) => { s.goals.find((x) => x.id === d.id).completedAt = completing ? L.clock().date : null; });
      toast(completing ? 'Goal complete' : 'Goal reopened');
      if (completing) cheer({ goal: g, title: 'Goal complete', sub: g.title, icon: 'star' });
    },
    'cheer-close'() { closeCheer(); },
    'toggle-milestone'(d) {
      Store.commit((s) => {
        const m = s.goals.find((g) => g.id === d.goal).milestones.find((x) => x.id === d.id);
        m.done = !m.done; m.doneAt = m.done ? L.clock().date : null;
      });
      const g = goalOf(d.goal);
      const m = g && g.milestones.find((x) => x.id === d.id);
      if (m && m.done) cheer({ goal: g, title: 'Milestone reached', sub: m.title, icon: 'star', small: true });
    },
    'del-milestone'(d) {
      Store.commit((s) => {
        const g = s.goals.find((x) => x.id === d.goal);
        g.milestones = g.milestones.filter((m) => m.id !== d.id);
        s.tasks.forEach((t) => { if (t.milestoneId === d.id) t.milestoneId = null; });
      });
      toast('Milestone removed');
    },
    'goal-week'(d) { ui.goalWeek[d.id] = d.week; render(); },
    'plan-sessions'(d) { openSessionsSheet(goalOf(d.id), d.week); },
    'session-drop'(d) { sheet._dropRow(Number(d.row)); },
    'cal-mode'(d) { ui.calMode = d.mode; ui.calScrollPending = true; render(); },
    'cal-step'(d) { ui.calDate = L.addDays(ui.calDate, Number(d.step) * (ui.calMode === 'week' ? 7 : 1)); ui.calScrollPending = true; render(); },
    'cal-today'() { ui.calDate = L.clock().date; ui.calScrollPending = true; render(); },
    'cal-open-day'(d) { ui.calDate = d.date; ui.calMode = 'day'; ui.calScrollPending = true; render(); },
    'go-cal-today'() { ui.calDate = L.clock().date; ui.calMode = 'day'; ui.calScrollPending = true; },
    'review-week'(d) { ui.reviewWeek = d.week; render(); },
    'bulk-reschedule'(d) {
      const now = L.clock();
      const week = ui.reviewWeek || L.startOfWeek(now.date, ws());
      const ids = L.weekReview(S(), week, now.date).needsTime.map((t) => t.id);
      const plan = L.planReschedule(S(), ids, d.week, now);
      Store.commit((s) => plan.forEach((p) => L.scheduleTask(s, p.taskId, p)));
      toast(`${plural(plan.length, 'task')} scheduled for ${weekRange(d.week)}${plan.length < ids.length ? `. ${ids.length - plan.length} did not fit` : ''}`);
    },
    'pick-today'() {
      const today = L.clock().date;
      openPrioritySheet({
        title: "Today's top three", sub: fmtDate(today), due: today,
        selected: (S().dailyPriorities[today] || []).map((id) => `task:${id}`),
        onSave: (s, picks) => { s.dailyPriorities[today] = picks.map((p) => p.split(':')[1]); },
      });
    },
    'pick-week'(d) {
      openPrioritySheet({
        title: 'Priorities for the week', sub: weekRange(d.week), withGoals: true, due: L.addDays(d.week, 6),
        selected: (S().weeklyPriorities[d.week] || []).map((i) => `${i.type}:${i.id}`),
        onSave: (s, picks) => { s.weeklyPriorities[d.week] = picks.map((p) => { const [type, id] = p.split(':'); return { type, id }; }); },
      });
    },
    export: exportData,
  };

  document.addEventListener('click', (e) => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
    if (!Store.ready) return;
    const el = e.target.closest('[data-act]');
    if (el) {
      const fn = actions[el.dataset.act];
      if (fn) { if (el.tagName !== 'A') e.preventDefault(); fn(el.dataset, el); }
      return;
    }
    // Clicking empty calendar space starts a new event at that time.
    const col = e.target.closest('.day-col');
    if (col && !e.target.closest('.block')) {
      const y = e.clientY - col.getBoundingClientRect().top;
      const hour = col.getBoundingClientRect().height / 24;
      const start = Math.min(1380, Math.floor((y / hour) * 2) * 30);
      openBlockSheet({ date: col.dataset.date, start });
    }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    e.preventDefault();
    const kind = form.dataset.form;
    if (form.closest('dialog')) { sheet._submit(); return; }
    const f = new FormData(form);
    if (kind === 'quick') submitQuick(form, f);
    if (kind === 'add-task') {
      const title = f.get('title').trim();
      if (!title) { form.elements.title.focus(); return; }
      Store.commit((s) => s.tasks.push({
        id: L.uid(), goalId: form.dataset.goal, title, estimate: Number(f.get('estimate')) || null, due: f.get('due') || null,
        done: false, doneAt: null, session: false, milestoneId: f.get('milestoneId') || null,
      }));
      L.syncMilestones(S(), L.clock().date);
      $('[data-form=add-task] input[name=title]', main).focus();
    }
    if (kind === 'add-milestone') {
      const title = f.get('title').trim();
      if (!title) { form.elements.title.focus(); return; }
      Store.commit((s) => s.goals.find((g) => g.id === form.dataset.goal).milestones.push({ id: L.uid(), title, date: f.get('date') || null, done: false, doneAt: null }));
      $('[data-form=add-milestone] input[name=title]', main).focus();
    }
  });

  function submitQuick(form, f) {
    const title = f.get('title').trim();
    if (!title) { form.elements.title.focus(); return; }
    if (f.get('kind') === 'smart') { smartAdd(title, form); return; }
    if (f.get('kind') === 'task') {
      Store.commit((s) => s.tasks.push({
        id: L.uid(), goalId: f.get('goalId') || null, title, estimate: Number(f.get('estimate')) || null,
        due: f.get('due') || null, done: false, doneAt: null, session: false, milestoneId: null,
      }));
      toast(`Added: ${title}`);
    } else {
      const date = f.get('date');
      if (!date || !f.get('start')) return;
      const start = L.toMin(f.get('start'));
      const duration = Number(f.get('duration'));
      if (start + duration > 1440) { toast('Events must end by midnight.', false); return; }
      Store.commit((s) => s.events.push({ id: L.uid(), title, date, start, duration, recurrence: null, exceptions: {} }));
      const clash = L.conflicts(S(), date, start, duration).filter((c) => c.title !== title);
      toast(`Added ${fmtDate(date)}, ${fmtTime(start)}${clash.length ? `. ${conflictText(clash)}` : ''}`);
    }
    $('#quick-title').focus();
  }

  document.addEventListener('change', (e) => {
    if (e.target.name === 'kind' && e.target.closest('[data-form=quick]')) {
      ui.quickKind = e.target.value;
      smart.touched = true;
      const form = e.target.closest('form');
      $$('[data-kind]', form).forEach((el) => { el.hidden = el.dataset.kind !== ui.quickKind; });
      form.elements.title.placeholder = QUICK_PLACEHOLDER[ui.quickKind];
      form.elements.title.setAttribute('aria-label', ui.quickKind === 'smart' ? 'Describe what to add' : 'Title');
    }
  });

  /* ---------- Render ---------- */
  function route() {
    const hash = location.hash.slice(1) || 'today';
    if (hash.startsWith('goal-')) return { view: 'goals', id: hash.slice(5) };
    return { view: ['today', 'goals', 'calendar', 'review'].includes(hash) ? hash : 'today' };
  }

  function render() {
    if (!Store.ready) {
      main.innerHTML = '<p class="empty" role="status" style="padding-top:24px">Loading your dashboard…</p>';
      return;
    }
    const { view, id } = route();
    const scroller = $('#cal-scroll');
    const keep = scroller && !ui.calScrollPending ? [scroller.scrollTop, scroller.scrollLeft] : null;
    const active = document.activeElement;
    const focusSel = active && active.dataset && active.dataset.act && active.dataset.id
      ? `[data-act="${active.dataset.act}"][data-id="${active.dataset.id}"]` : null;
    const issues = {
      'no-sync': 'Sync is not available in this view, so changes are only kept in this browser. Open Waymark while signed in to Claude to sync.',
      unreachable: 'Your saved data cannot be reached yet, so what you see may be out of date.',
      'save-failed': Store.synced ? 'Your latest changes have not been saved yet. Waymark keeps retrying while this page is open, so leave it open until this message goes away.' : 'Changes could not be saved in this browser. Storage may be full or blocked, so export a backup from Settings.',
      stopped: 'Changes cannot be saved right now, and new ones may be lost. Reload the page when you can.',
    };
    const banner = (Store.issue ? `<div class="banner" role="alert">${issues[Store.issue]}</div>` : '')
      + (Store.recovered ? '<div class="banner" role="alert">Saved data could not be read and was set aside. Import a backup from Settings if you have one.</div>' : '');
    const html = view === 'today' ? renderToday()
      : view === 'goals' ? (id ? renderGoalDetail(id) : renderGoals())
        : view === 'calendar' ? renderCalendar() : renderReview();
    main.innerHTML = banner + html;
    $$('[data-nav]').forEach((a) => {
      if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = `${view[0].toUpperCase()}${view.slice(1)} · Waymark`;
    const next = $('#cal-scroll');
    if (next) {
      if (keep) { [next.scrollTop, next.scrollLeft] = keep; } else {
        const hour = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour'));
        const today = L.clock();
        next.scrollTop = Math.max(0, (Math.min(today.min / 60, 16) - 1.5)) * hour;
        const head = $('.cal-day-head.is-today', next);
        if (head) next.scrollLeft = Math.max(0, head.offsetLeft - 48);
      }
      ui.calScrollPending = false;
    }
    if (focusSel) { const el = $(focusSel, main); if (el) el.focus({ preventScroll: true }); }
    tickReminders();
    autoCarry();
  }

  window.addEventListener('hashchange', () => { ui.calScrollPending = true; render(); window.scrollTo(0, 0); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !sheet.open) render(); });
  // Keep "now" and today's date current, without disturbing anything being typed.
  setInterval(() => {
    const el = document.activeElement;
    if (sheet.open || (el && /INPUT|SELECT|TEXTAREA/.test(el.tagName))) return;
    render();
  }, 60000);

  // Changes from another device must not wipe out typing or a drag in progress.
  let renderDeferred = false;
  const isBusy = () => {
    const el = document.activeElement;
    return dragActive || (main.contains(el) && /INPUT|SELECT|TEXTAREA/.test(el.tagName));
  };
  const renderIfDeferred = () => setTimeout(() => {
    if (renderDeferred && !isBusy()) { renderDeferred = false; render(); }
  }, 0);
  main.addEventListener('focusout', renderIfDeferred);
  window.addEventListener('pointerup', renderIfDeferred);

  Store.subscribe((kind) => {
    if ((kind === 'remote' || kind === 'status') && isBusy()) { renderDeferred = true; return; }
    render();
  });
  setupDrag();
  // Reminders check more often than the page redraws, and keep going in a background tab.
  setInterval(tickReminders, 20000);
  render();
  Store.start();
})();
