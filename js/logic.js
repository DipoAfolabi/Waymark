/* Pure scheduling and progress rules. No DOM, so tests.html can exercise them directly.
   Dates are local 'YYYY-MM-DD' strings; times are minutes since midnight. */
const Logic = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // Noon keeps date arithmetic clear of daylight-saving jumps.
  const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
  const weekday = (iso) => fromISO(iso).getDay();
  const startOfWeek = (iso, ws = 1) => addDays(iso, -((weekday(iso) - ws + 7) % 7));
  const weekDays = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const fromMin = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const clock = (d = new Date()) => ({ date: toISO(d), min: d.getHours() * 60 + d.getMinutes() });

  function defaultState() {
    const avail = {};
    for (let i = 0; i < 7; i++) {
      const weekend = i === 0 || i === 6;
      avail[i] = { on: true, start: weekend ? 540 : 420, end: weekend ? 1080 : 1260 };
    }
    return {
      version: 1,
      settings: { weekStart: 1, availability: avail, reminders: { on: true, lead: 10, due: true, dueAt: 540 } },
      goals: [], tasks: [], events: [],
      dailyPriorities: {}, weeklyPriorities: {},
    };
  }

  /* ---------- Calendar instances ---------- */
  function occursOn(e, d) {
    const r = e.recurrence;
    if (!r) return d === e.date;
    if (d < e.date || (r.until && d > r.until)) return false;
    return r.freq === 'daily' || r.days.includes(weekday(d));
  }

  function makeInst(state, e, occ, x) {
    const task = e.taskId ? state.tasks.find((t) => t.id === e.taskId) : null;
    const date = x ? x.date : occ;
    const start = x ? x.start : e.start;
    const duration = x ? x.duration : e.duration;
    return {
      key: `${e.id}:${occ}`, eventId: e.id, occ, date, start, duration, end: start + duration,
      title: task ? task.title : (x && x.title) || e.title,
      taskId: e.taskId || null, goalId: task ? task.goalId : null,
      done: task ? !!task.done : false, recurring: !!e.recurrence,
    };
  }

  function instances(state, from, to) {
    const out = [];
    for (const e of state.events) {
      if (!e.recurrence) {
        if (e.date >= from && e.date <= to) out.push(makeInst(state, e, e.date));
        continue;
      }
      const ex = e.exceptions || {};
      for (let d = from < e.date ? e.date : from; d <= to; d = addDays(d, 1)) {
        if (occursOn(e, d) && !ex[d]) out.push(makeInst(state, e, d));
      }
      for (const [occ, x] of Object.entries(ex)) {
        if (!x.deleted && x.date >= from && x.date <= to) out.push(makeInst(state, e, occ, x));
      }
    }
    return out.sort((a, b) => (a.date + fromMin(a.start)).localeCompare(b.date + fromMin(b.start)));
  }

  const findInst = (state, key, date) => instances(state, date, date).find((i) => i.key === key);
  const blockOf = (state, taskId) => state.events.find((e) => e.taskId === taskId) || null;
  const taskInst = (state, taskId) => { const e = blockOf(state, taskId); return e ? makeInst(state, e, e.date) : null; };

  const excluded = (i, ex) => ex && (i.key === ex.key || i.eventId === ex.eventId);

  function conflicts(state, date, start, duration, exclude, extra = []) {
    const end = start + duration;
    const clash = instances(state, date, date).filter((i) => !excluded(i, exclude) && i.start < end && i.end > start);
    const more = extra.filter((b) => b.date === date && b.start < end && b.start + b.duration > start);
    return clash.concat(more.map((b) => ({ ...b, end: b.start + b.duration })));
  }

  function outsideAvailability(state, date, start, duration) {
    const w = state.settings.availability[weekday(date)];
    return !w.on || start < w.start || start + duration > w.end;
  }

  /* ---------- Open slots ---------- */
  function openGaps(state, date, duration, now, opts = {}) {
    const w = state.settings.availability[weekday(date)];
    if (!w.on || date < now.date) return [];
    let cursor = w.start;
    if (date === now.date) cursor = Math.max(cursor, Math.ceil((now.min + 1) / 15) * 15);
    const busy = instances(state, date, date)
      .filter((i) => !excluded(i, opts.exclude))
      .map((i) => ({ start: i.start, end: i.end }))
      .concat((opts.extra || []).filter((b) => b.date === date).map((b) => ({ start: b.start, end: b.start + b.duration })))
      .sort((a, b) => a.start - b.start);
    const gaps = [];
    for (const b of busy) {
      if (b.start - cursor >= duration) gaps.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
    }
    if (w.end - cursor >= duration) gaps.push({ start: cursor, end: w.end });
    return gaps;
  }

  function suggest(state, { duration, from, days = 14, now, limit = 6, exclude, extra }) {
    const out = [];
    const first = from < now.date ? now.date : from;
    for (let i = 0; i < days && out.length < limit; i++) {
      const date = addDays(first, i);
      let onDay = 0;
      for (const g of openGaps(state, date, duration, now, { exclude, extra })) {
        if (onDay >= 2) break;
        out.push({ date, start: g.start }); onDay++;
        const later = Math.ceil((g.start + 240) / 30) * 30;
        if (onDay < 2 && later + duration <= g.end) { out.push({ date, start: later }); onDay++; }
      }
    }
    return out.slice(0, limit);
  }

  // Spreads sessions across the open days of a week, keeping the same time of day where it can.
  function spreadSessions(state, n, duration, weekStart, now) {
    const open = weekDays(weekStart).filter((d) => openGaps(state, d, duration, now).length);
    const picks = [];
    if (!open.length) return picks;
    const extra = [];
    let preferred = null;
    for (let i = 0; i < n; i++) {
      const day = n <= open.length
        ? open[n === 1 ? 0 : Math.round((i * (open.length - 1)) / (n - 1))]
        : open[i % open.length];
      const gaps = openGaps(state, day, duration, now, { extra });
      if (!gaps.length) continue;
      const fits = preferred !== null && gaps.find((g) => g.start <= preferred && preferred + duration <= g.end);
      const start = fits ? preferred : gaps[0].start;
      preferred = start;
      const pick = { date: day, start, duration };
      picks.push(pick); extra.push(pick);
    }
    return picks.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  }

  /* ---------- Changing the schedule ---------- */
  function scheduleTask(state, taskId, { date, start, duration }) {
    const e = blockOf(state, taskId);
    if (e) Object.assign(e, { date, start, duration });
    else state.events.push({ id: uid(), title: '', date, start, duration, taskId });
    const t = state.tasks.find((x) => x.id === taskId);
    if (t && !t.estimate) t.estimate = duration;
  }

  function moveInstance(state, inst, { date, start, duration }, scope = 'one') {
    const e = state.events.find((x) => x.id === inst.eventId);
    if (!e) return;
    if (!e.recurrence) Object.assign(e, { date, start, duration });
    else if (scope === 'all') Object.assign(e, { start, duration });
    else {
      e.exceptions = e.exceptions || {};
      e.exceptions[inst.occ] = { ...e.exceptions[inst.occ], date, start, duration };
    }
  }

  function deleteInstance(state, inst, scope = 'one') {
    const e = state.events.find((x) => x.id === inst.eventId);
    if (!e) return;
    if (!e.recurrence || scope === 'all') state.events = state.events.filter((x) => x !== e);
    else { e.exceptions = e.exceptions || {}; e.exceptions[inst.occ] = { deleted: true }; }
  }

  function createSessions(state, goal, rows) {
    for (const r of rows) {
      const t = {
        id: uid(), goalId: goal.id, title: goal.sessionName || goal.title, session: true,
        estimate: r.duration, due: null, done: false, doneAt: null, milestoneId: null,
      };
      state.tasks.push(t);
      scheduleTask(state, t.id, r);
    }
  }

  /* ---------- Repeating recurring goals ----------
     A goal with `repeat` on fills this week and next from the most recent earlier week that had
     sessions: same weekday, time and length. Each week is filled once (goal.repeatFilled), so a
     session someone removes stays removed. Ids come from goal, date and time, so two devices
     filling the same week write the same records instead of duplicates. */
  const LOOKBACK = 4;
  const daysBetween = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 864e5);

  // A week only partly filled (because some of its days had already passed) is not a fair copy.
  function repeatTemplate(state, goal, week) {
    const marks = goal.repeatFilled || {};
    for (let i = 1; i <= LOOKBACK; i++) {
      const from = addDays(week, -7 * i);
      if (marks[from] === 'partial') continue;
      const sessions = sessionsInWeek(state, goal.id, from);
      if (sessions.length) return { week: from, sessions };
    }
    return null;
  }

  function carryForward(state, now) {
    const cur = startOfWeek(now.date, state.settings.weekStart);
    const out = { changed: false, filled: [] };
    for (const g of state.goals) {
      if (g.type !== 'recurring' || !g.repeat || g.completedAt) continue;
      const marks = g.repeatFilled || {};
      g.repeatFilled = marks;
      for (const week of [cur, addDays(cur, 7)]) {
        if (marks[week]) continue;
        if (sessionsInWeek(state, g.id, week).length) { marks[week] = true; out.changed = true; continue; }
        const tpl = repeatTemplate(state, g, week);
        if (!tpl) continue; // nothing to copy yet; check again once a week has sessions
        const rows = [];
        let skipped = false;
        for (const s of tpl.sessions) {
          if (rows.length >= g.perWeek) break;
          const date = addDays(week, daysBetween(tpl.week, s.inst.date));
          const start = s.inst.start;
          if (date < now.date || (date === now.date && start <= now.min)) { skipped = true; continue; }
          if (g.deadline && date > g.deadline) continue;
          rows.push({ date, start, duration: s.inst.duration });
        }
        for (const r of rows) {
          const id = `r${g.id}${r.date.replace(/-/g, '')}${pad(Math.floor(r.start / 60))}${pad(r.start % 60)}`;
          if (state.tasks.some((t) => t.id === id)) continue;
          state.tasks.push({
            id, goalId: g.id, title: g.sessionName || g.title, session: true, repeated: true,
            estimate: r.duration, due: null, done: false, doneAt: null, milestoneId: null,
          });
          state.events.push({ id: `e${id}`, title: '', date: r.date, start: r.start, duration: r.duration, taskId: id });
        }
        marks[week] = skipped ? 'partial' : true;
        out.changed = true;
        if (rows.length) out.filled.push({ goal: g, week, count: rows.length });
      }
      // Keep the record short: only recent weeks matter.
      const oldest = addDays(cur, -7 * (LOOKBACK + 4));
      for (const w of Object.keys(marks)) if (w < oldest) { delete marks[w]; out.changed = true; }
      g.repeatFilled = marks;
    }
    return out;
  }

  /* ---------- Plain-English entries ----------
     Claude reads the sentence into a small plan (what, which days, a time window).
     Everything about the actual times is decided here, from real open time. */
  const DEFAULT_MINUTES = { task: 30, event: 60, habit: 60 };
  const isISO = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isHM = (v) => typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) && toMin(v) < 1440;

  function cleanPlan(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = ['task', 'event', 'habit'].includes(raw.kind) ? raw.kind : null;
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '';
    if (!kind || !title) return null;
    const minutes = Number(raw.minutes);
    return {
      kind, title,
      minutes: minutes >= 5 && minutes <= 720 ? Math.round(minutes / 5) * 5 : null,
      date: isISO(raw.date) ? raw.date : null,
      time: isHM(raw.time) ? toMin(raw.time) : null,
      after: isHM(raw.after) ? toMin(raw.after) : null,
      before: isHM(raw.before) ? toMin(raw.before) : null,
      days: Array.isArray(raw.days) ? [...new Set(raw.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : null,
      until: isISO(raw.until) ? raw.until : null,
      due: isISO(raw.due) ? raw.due : null,
      goalId: typeof raw.goalId === 'string' ? raw.goalId : null,
      assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.filter((a) => typeof a === 'string').slice(0, 3) : [],
    };
  }

  // The earliest start in a window that is free on the most of these dates.
  function commonStart(state, dates, duration, from, to, now) {
    let best = null;
    for (let t = Math.ceil(from / 15) * 15; t + duration <= to; t += 15) {
      let free = 0;
      for (const d of dates) {
        if (d === now.date && t <= now.min) continue;
        if (outsideAvailability(state, d, t, duration)) continue;
        if (!conflicts(state, d, t, duration).length) free++;
      }
      if (!best || free > best.free) best = { start: t, free };
      if (free === dates.length) break;
    }
    return best;
  }

  function windowFor(state, p, date) {
    const w = state.settings.availability[weekday(date)];
    const from = p.after !== null ? p.after : (w.on ? w.start : 480);
    const to = p.before !== null ? p.before : (w.on ? w.end : 1260);
    return to > from ? { from, to } : { from, to: 1440 };
  }

  // Turns a clean plan into concrete entries: { kind, title, duration, slots[], ... }.
  function resolvePlan(state, p, now) {
    const duration = p.minutes || DEFAULT_MINUTES[p.kind];
    const out = { kind: p.kind, title: p.title, duration, due: p.due, goalId: null, assumptions: p.assumptions, slots: [], recurrence: null, perWeek: null, deadline: null, partial: false };
    if (p.goalId && state.goals.some((g) => g.id === p.goalId && !g.completedAt)) out.goalId = p.goalId;
    const pickOn = (dates) => {
      if (p.time !== null) return p.time;
      const w = windowFor(state, p, dates[0]);
      const best = commonStart(state, dates, duration, w.from, w.to, now);
      return best ? best.start : w.from;
    };

    if (p.kind === 'habit') {
      const days = p.days && p.days.length ? p.days : [1, 3, 5];
      const cur = startOfWeek(now.date, state.settings.weekStart);
      const dates = [];
      for (const d of weekDays(cur).concat(weekDays(addDays(cur, 7)))) {
        if (!days.includes(weekday(d))) continue;
        if (p.until && d > p.until) continue;
        dates.push(d);
      }
      const start = pickOn(dates.filter((d) => d > now.date).length ? dates.filter((d) => d > now.date) : dates);
      for (const d of dates) {
        if (d < now.date || (d === now.date && start <= now.min)) { if (d < addDays(cur, 7)) out.partial = true; continue; }
        out.slots.push({ date: d, start });
      }
      out.perWeek = days.length;
      out.deadline = p.until;
      out.days = days;
      return out;
    }

    if (p.kind === 'event' && p.days && p.days.length) {
      let first = now.date;
      for (let i = 0; i < 7; i++) { const d = addDays(now.date, i); if (p.days.includes(weekday(d))) { first = d; break; } }
      const upcoming = [];
      for (let i = 0; i < 14 && upcoming.length < 6; i++) { const d = addDays(first, i); if (p.days.includes(weekday(d)) && (!p.until || d <= p.until)) upcoming.push(d); }
      const start = pickOn(upcoming.length ? upcoming : [first]);
      let firstDate = first;
      if (first === now.date && start <= now.min) firstDate = upcoming.find((d) => d > now.date) || first;
      out.recurrence = { freq: p.days.length === 7 ? 'daily' : 'weekly', days: p.days, until: p.until };
      out.slots.push({ date: firstDate, start });
      out.upcoming = upcoming.filter((d) => d >= firstDate);
      return out;
    }

    // A single task or event. A task without any "when" stays unscheduled.
    const hasWhen = p.date || p.time !== null || p.after !== null || p.before !== null;
    if (p.kind === 'task' && !hasWhen) return out;
    const date = p.date || now.date;
    let start;
    if (p.time !== null) start = p.time;
    else {
      const w = windowFor(state, p, date);
      const gap = openGaps(state, date, duration, now).map((g) => ({ start: Math.max(g.start, w.from), end: Math.min(g.end, w.to) }))
        .find((g) => g.end - g.start >= duration);
      start = gap ? Math.ceil(gap.start / 15) * 15 : Math.max(w.from, date === now.date ? Math.ceil((now.min + 1) / 15) * 15 : w.from);
    }
    out.slots.push({ date, start: Math.min(start, 1440 - duration) });
    return out;
  }

  // Writes a resolved plan into the state; returns what to show afterwards.
  function applyPlan(state, r, now) {
    if (r.kind === 'task') {
      const id = uid();
      state.tasks.push({ id, goalId: r.goalId, title: r.title, estimate: r.duration, due: r.due, done: false, doneAt: null, session: false, milestoneId: null });
      if (r.slots[0]) scheduleTask(state, id, { ...r.slots[0], duration: r.duration });
      return { taskId: id };
    }
    if (r.kind === 'event') {
      const s = r.slots[0];
      const id = uid();
      state.events.push({ id, title: r.title, date: s.date, start: s.start, duration: r.duration, recurrence: r.recurrence, exceptions: {} });
      return { eventId: id };
    }
    const goal = {
      id: uid(), title: r.title, type: 'recurring', perWeek: r.perWeek, sessionMinutes: r.duration, sessionName: r.title,
      deadline: r.deadline, target: '', repeat: true, milestones: [], completedAt: null, createdAt: now.date, repeatFilled: {},
      color: nextGoalColor(state),
    };
    const cur = startOfWeek(now.date, state.settings.weekStart);
    goal.repeatFilled[cur] = r.partial ? 'partial' : true;
    goal.repeatFilled[addDays(cur, 7)] = true;
    state.goals.push(goal);
    createSessions(state, goal, r.slots.map((s) => ({ ...s, duration: r.duration })));
    return { goalId: goal.id };
  }

  /* ---------- Completion and progress ---------- */
  function syncMilestones(state, today) {
    for (const g of state.goals) {
      for (const m of g.milestones) {
        const linked = state.tasks.filter((t) => t.milestoneId === m.id);
        if (!linked.length) continue;
        const done = linked.every((t) => t.done);
        if (done && !m.done) m.doneAt = today;
        if (!done) m.doneAt = null;
        m.done = done;
      }
    }
  }

  function setTaskDone(state, taskId, done, today) {
    const t = state.tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.done = done;
    t.doneAt = done ? today : null;
    syncMilestones(state, today);
  }

  function removeTask(state, taskId, today) {
    state.tasks = state.tasks.filter((t) => t.id !== taskId);
    state.events = state.events.filter((e) => e.taskId !== taskId);
    syncMilestones(state, today);
  }

  function deleteGoal(state, goalId) {
    const ids = new Set(state.tasks.filter((t) => t.goalId === goalId).map((t) => t.id));
    state.tasks = state.tasks.filter((t) => !ids.has(t.id));
    state.events = state.events.filter((e) => !ids.has(e.taskId));
    state.goals = state.goals.filter((g) => g.id !== goalId);
  }

  // The week a task counts toward: when it was scheduled, or else when it was finished.
  function taskWeekDate(state, t) {
    const e = blockOf(state, t.id);
    return e ? e.date : t.doneAt;
  }

  function sessionsInWeek(state, goalId, weekStart) {
    const end = addDays(weekStart, 6);
    return state.tasks
      .filter((t) => t.goalId === goalId && t.session)
      .map((t) => ({ task: t, inst: taskInst(state, t.id) }))
      .filter((s) => s.inst && s.inst.date >= weekStart && s.inst.date <= end)
      .sort((a, b) => a.inst.date.localeCompare(b.inst.date) || a.inst.start - b.inst.start);
  }

  function recurringProgress(state, goal, weekStart) {
    const sessions = sessionsInWeek(state, goal.id, weekStart);
    const done = sessions.filter((s) => s.task.done).length;
    return {
      weekStart, sessions, target: goal.perWeek, scheduled: sessions.length, done,
      toSchedule: Math.max(0, goal.perWeek - sessions.length),
    };
  }

  function taskProgress(state, goal) {
    const tasks = state.tasks.filter((t) => t.goalId === goal.id && !t.session);
    const done = tasks.filter((t) => t.done);
    const open = tasks.filter((t) => !t.done);
    return {
      tasks, total: tasks.length, done: done.length,
      minutesLeft: open.reduce((n, t) => n + (t.estimate || 0), 0),
      milestonesDone: goal.milestones.filter((m) => m.done).length,
      milestones: goal.milestones.length,
    };
  }

  function overdue(state, today) {
    return state.tasks.filter((t) => {
      if (t.done) return false;
      const e = blockOf(state, t.id);
      return e ? e.date < today : !!t.due && t.due < today;
    });
  }

  function unscheduled(state) {
    return state.tasks.filter((t) => !t.done && !blockOf(state, t.id));
  }

  /* ---------- Colours, streaks and activity ---------- */
  const GOAL_COLORS = 8;
  // A goal keeps the colour someone picked; older goals get a steady one from their id.
  function goalColor(goal) {
    if (!goal) return null;
    if (Number.isInteger(goal.color) && goal.color >= 0 && goal.color < GOAL_COLORS) return goal.color;
    let h = 0;
    for (const c of String(goal.id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % GOAL_COLORS;
  }
  // The least-used colour, for a new goal.
  function nextGoalColor(state) {
    const used = Array(GOAL_COLORS).fill(0);
    for (const g of state.goals) if (!g.completedAt) used[goalColor(g)]++;
    return used.indexOf(Math.min(...used));
  }

  const weekMet = (state, goal, week) => recurringProgress(state, goal, week).done >= goal.perWeek;

  // Weeks in a row the target was met, counting this week only once it is met.
  function weekStreak(state, goal, today) {
    if (!goal || goal.type !== 'recurring') return 0;
    const ws = state.settings.weekStart;
    const cur = startOfWeek(today, ws);
    const floor = goal.createdAt ? startOfWeek(goal.createdAt, ws) : addDays(cur, -7 * 104);
    let w = weekMet(state, goal, cur) ? cur : addDays(cur, -7);
    let n = 0;
    while (w >= floor && n < 520 && weekMet(state, goal, w)) { n++; w = addDays(w, -7); }
    return n;
  }

  function activityByDay(state, from, to, goalId) {
    const m = {};
    for (const t of state.tasks) {
      if (!t.done || !t.doneAt || t.doneAt < from || t.doneAt > to) continue;
      if (goalId && t.goalId !== goalId) continue;
      m[t.doneAt] = (m[t.doneAt] || 0) + 1;
    }
    return m;
  }

  // Days in a row with something done; today counts once it has something.
  function dayStreak(state, today, goalId) {
    const m = activityByDay(state, addDays(today, -730), today, goalId);
    let d = m[today] ? today : addDays(today, -1);
    let n = 0;
    while (m[d]) { n++; d = addDays(d, -1); }
    return n;
  }

  /* ---------- Example week ----------
     Realistic data around today, so a first-time visitor can see every view working.
     Every record is tagged sample: true, so clearSample can remove exactly these. */
  function sampleWeek(state, now) {
    const cur = startOfWeek(now.date, state.settings.weekStart);
    const isPast = (date, start) => date < now.date || (date === now.date && start + 30 <= now.min);

    // A weekly habit with three weeks of history, so the streak and heat map have something to show.
    const gym = {
      id: uid(), title: 'Get stronger', type: 'recurring', perWeek: 3, sessionMinutes: 45, sessionName: 'Workout',
      deadline: null, target: '', repeat: true, milestones: [], completedAt: null,
      createdAt: addDays(cur, -21), color: nextGoalColor(state), repeatFilled: {}, sample: true,
    };
    state.goals.push(gym);
    const upcoming = [0, 1].flatMap((w) => [0, 2, 4].map((o) => addDays(cur, 7 * w + o))).filter((d) => d >= now.date);
    const best = upcoming.length ? commonStart(state, upcoming, 45, 1020, 1260, now) : null;
    const gymStart = best ? best.start : 1080;
    for (let w = -3; w <= 1; w++) {
      const week = addDays(cur, 7 * w);
      createSessions(state, gym, [0, 2, 4].map((o) => ({ date: addDays(week, o), start: w < 0 ? 1080 : gymStart, duration: 45 })));
      gym.repeatFilled[week] = true;
    }

    // A one-time goal with milestones, some tasks scheduled and one left to place.
    const sql = {
      id: uid(), title: 'Learn SQL', type: 'once', target: 'Comfortable writing joins and designing tables',
      perWeek: 3, sessionMinutes: 60, sessionName: '', deadline: addDays(now.date, 30), repeat: false,
      milestones: [
        { id: uid(), title: 'Finish the joins module', date: addDays(now.date, 7), done: false, doneAt: null },
        { id: uid(), title: 'Build a practice database', date: addDays(now.date, 21), done: false, doneAt: null },
      ],
      completedAt: null, createdAt: addDays(cur, -14), color: nextGoalColor(state), sample: true,
    };
    state.goals.push(sql);
    const [m1, m2] = sql.milestones;
    const task = (title, estimate, extra = {}) => {
      const t = { id: uid(), goalId: sql.id, title, estimate, due: null, done: false, doneAt: null, session: false, milestoneId: null, sample: true, ...extra };
      state.tasks.push(t);
      return t;
    };
    task('Read up on the types of JOIN', 30, { milestoneId: m1.id, done: true, doneAt: addDays(now.date, -9) });
    task('Review how indexes work', 30, { done: true, doneAt: addDays(now.date, -5) });
    const practice = task('Practise inner and left joins', 45, { milestoneId: m1.id });
    const queries = task('Write 10 practice queries', 60, { milestoneId: m1.id });
    task('Sketch tables for a recipe database', 45, { milestoneId: m2.id, due: addDays(now.date, 10) });
    // Leave at least an hour before the first one, so nothing feels due the moment it appears.
    const later = now.min + 60 < 1440 ? { date: now.date, min: now.min + 60 } : { date: addDays(now.date, 1), min: 0 };
    for (const t of [practice, queries]) {
      const slot = suggest(state, { duration: t.estimate, from: later.date, days: 7, now: later, limit: 1 })[0];
      if (slot) scheduleTask(state, t.id, { ...slot, duration: t.estimate });
    }

    // One ordinary event later this week.
    for (let i = 1; i <= 6; i++) {
      const d = addDays(now.date, i);
      const w = state.settings.availability[weekday(d)];
      if (!w.on) continue;
      const pick = commonStart(state, [d], 60, Math.max(w.start, 600), Math.min(w.end, 1080), now);
      if (pick && pick.free) {
        state.events.push({ id: uid(), title: 'Coffee with a friend', date: d, start: pick.start, duration: 60, recurrence: null, exceptions: {}, sample: true });
        break;
      }
    }

    // A few everyday wins over the last three weeks, for the heat map.
    [['Tidy up email inbox', 2], ['Plan meals for the week', 4], ['Update resume', 6], ['Call the bank', 8], ['Back up phone photos', 11], ['Renew library books', 13], ['Clean out the closet', 16], ['Pay phone bill', 19]]
      .forEach(([title, ago]) => state.tasks.push({ id: uid(), goalId: null, title, estimate: 30, due: null, done: true, doneAt: addDays(now.date, -ago), session: false, milestoneId: null, sample: true }));

    // Mark everything already in the past as done, then tag what createSessions and scheduleTask made.
    for (const t of state.tasks) {
      if (t.goalId === gym.id) t.sample = true;
      const e = blockOf(state, t.id);
      if (e) e.sample = true;
      if (t.goalId === gym.id && e && isPast(e.date, e.start)) { t.done = true; t.doneAt = e.date; }
    }
    syncMilestones(state, now.date);
    return { goals: 2 };
  }

  const isSample = (r) => !!(r && r.sample);
  const hasSample = (state) => state.goals.some(isSample) || state.tasks.some(isSample) || state.events.some(isSample);

  // Removes example records only, and anything that belongs to an example goal.
  function clearSample(state, today) {
    const goals = new Set(state.goals.filter(isSample).map((g) => g.id));
    state.goals = state.goals.filter((g) => !goals.has(g.id));
    const tasks = new Set(state.tasks.filter((t) => isSample(t) || goals.has(t.goalId)).map((t) => t.id));
    state.tasks = state.tasks.filter((t) => !tasks.has(t.id));
    state.events = state.events.filter((e) => !isSample(e) && !tasks.has(e.taskId));
    for (const t of state.tasks) if (goals.has(t.goalId)) t.goalId = null;
    syncMilestones(state, today);
  }

  /* ---------- Weekly review ---------- */
  function weekReview(state, weekStart, today) {
    const end = addDays(weekStart, 6);
    const inWeek = (d) => d && d >= weekStart && d <= end;
    const completed = state.tasks.filter((t) => t.done && inWeek(taskWeekDate(state, t)));
    const moved = [];
    const stalled = [];
    const shortfalls = [];
    for (const g of state.goals) {
      if (g.completedAt && g.completedAt < weekStart) continue;
      const tasksDone = completed.filter((t) => t.goalId === g.id);
      const milestones = g.milestones.filter((m) => m.done && inWeek(m.doneAt));
      if (tasksDone.length || milestones.length) moved.push({ goal: g, tasks: tasksDone, milestones });
      else if (!g.completedAt) stalled.push(g);
      if (g.type === 'recurring' && !g.completedAt) {
        const p = recurringProgress(state, g, weekStart);
        if (p.scheduled < p.target) shortfalls.push({ goal: g, progress: p });
      }
    }
    const needsTime = state.tasks.filter((t) => {
      if (t.done) return false;
      const e = blockOf(state, t.id);
      return !e || e.date < today;
    });
    return { completed, moved, stalled, shortfalls, needsTime };
  }

  function planReschedule(state, taskIds, weekStart, now) {
    const days = weekDays(weekStart);
    const extra = [];
    const plan = [];
    taskIds.forEach((id, i) => {
      const t = state.tasks.find((x) => x.id === id);
      const e = blockOf(state, id);
      const duration = (e && e.duration) || (t && t.estimate) || 30;
      for (let j = 0; j < 7; j++) {
        const date = days[(i + j) % 7];
        const gaps = openGaps(state, date, duration, now, { extra, exclude: e ? { eventId: e.id } : null });
        if (gaps.length) {
          const pick = { taskId: id, date, start: gaps[0].start, duration };
          plan.push(pick); extra.push(pick);
          return;
        }
      }
    });
    return plan;
  }

  /* ---------- Reminders ---------- */
  const REMINDER_DEFAULTS = { on: true, lead: 10, due: true, dueAt: 540 };
  const reminderSettings = (state) => ({ ...REMINDER_DEFAULTS, ...((state.settings && state.settings.reminders) || {}) });
  // How long after a block starts its reminder still counts, so a page opened a little late still says so.
  const GRACE = 15;

  // Everything that should be alerting right now. Each id is stable, so a device fires it once.
  function dueReminders(state, now) {
    const r = reminderSettings(state);
    const out = [];
    // Example records never alert: they're there to look at, not to act on.
    const sampleEvents = new Set(state.events.filter((e) => e.sample).map((e) => e.id));
    if (r.on) {
      for (const i of instances(state, now.date, now.date)) {
        if (i.done || sampleEvents.has(i.eventId)) continue;
        if (now.min >= i.start - r.lead && now.min < i.start + Math.min(GRACE, i.duration)) {
          out.push({ id: `b:${i.key}:${i.date}:${i.start}`, kind: 'block', title: i.title || 'Untitled event', start: i.start, end: i.end, taskId: i.taskId, key: i.key, date: i.date });
        }
      }
    }
    if (r.due && now.min >= r.dueAt) {
      for (const t of state.tasks) {
        if (!t.done && !t.sample && t.due === now.date) out.push({ id: `d:${t.id}:${now.date}`, kind: 'due', title: t.title, taskId: t.id, date: now.date });
      }
    }
    return out;
  }

  // The next block reminder still to come today, for a status line.
  function nextReminder(state, now) {
    const r = reminderSettings(state);
    if (!r.on) return null;
    const sampleEvents = new Set(state.events.filter((e) => e.sample).map((e) => e.id));
    const next = instances(state, now.date, now.date).find((i) => !i.done && !sampleEvents.has(i.eventId) && i.start - r.lead > now.min);
    return next ? { title: next.title || 'Untitled event', start: next.start, at: Math.max(0, next.start - r.lead) } : null;
  }

  /* Side-by-side placement for overlapping blocks in a day column. */
  function layoutDay(list) {
    const items = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
    let cluster = [];
    let clusterEnd = -1;
    const flush = () => {
      const lanes = [];
      for (const it of cluster) {
        let lane = lanes.findIndex((end) => end <= it.start);
        if (lane < 0) { lane = lanes.length; lanes.push(0); }
        lanes[lane] = it.end;
        it.lane = lane;
      }
      for (const it of cluster) { it.lanes = lanes.length; it.conflict = lanes.length > 1; }
      cluster = [];
    };
    for (const it of items) {
      if (cluster.length && it.start >= clusterEnd) { flush(); clusterEnd = -1; }
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.end);
    }
    if (cluster.length) flush();
    // A cluster can chain blocks that don't touch each other; only real overlaps are flagged.
    for (const a of items) a.conflict = items.some((b) => b !== a && b.start < a.end && b.end > a.start);
    return items;
  }

  const api = {
    toISO, fromISO, addDays, weekday, startOfWeek, weekDays, toMin, fromMin, uid, clock, defaultState,
    occursOn, instances, findInst, blockOf, taskInst, conflicts, outsideAvailability, openGaps, suggest,
    spreadSessions, scheduleTask, moveInstance, deleteInstance, createSessions, syncMilestones, setTaskDone,
    removeTask, deleteGoal, taskWeekDate, sessionsInWeek, recurringProgress, taskProgress, overdue,
    unscheduled, weekReview, planReschedule, layoutDay, reminderSettings, dueReminders, nextReminder, repeatTemplate, carryForward, cleanPlan, resolvePlan, applyPlan,
    GOAL_COLORS, goalColor, nextGoalColor, weekStreak, activityByDay, dayStreak,
    sampleWeek, hasSample, clearSample,
  };
  return api;
})();
