/* Saves goals, tasks and the schedule.
   Hosted on claude.ai: one private document per record in the signed-in person's own
   database subtree, so edits on different devices merge record by record and arrive live.
   Anywhere else (localhost): this browser's localStorage. One level of undo either way. */
const Store = (() => {
  const KEY = 'waymark.v1';
  const KINDS = { goal: 'goals', task: 'tasks', event: 'events' };
  const META = 'meta';
  const clone = (v) => JSON.parse(JSON.stringify(v));

  let state = Logic.defaultState();
  let snapshot = null;
  let notify = () => {};
  let ready = false;
  let recovered = false;
  let issue = null;        // null | 'no-sync' | 'unreachable' | 'save-failed' | 'stopped'

  // Sync mode only
  let collection = null;
  let remote = {};         // doc id -> body, as last heard from the database
  const pending = new Map(); // doc id -> body, or null to delete, not yet sent
  const inflight = new Map(); // the same, being sent now
  let flushing = false;
  let retryTimer = null;
  let loadTimer = null;
  let definitive = false;

  const setIssue = (next) => { if (issue !== next) { issue = next; notify('status'); } };

  function normalize(raw) {
    const base = Logic.defaultState();
    if (!raw || !Array.isArray(raw.goals) || !Array.isArray(raw.tasks) || !Array.isArray(raw.events)) {
      throw new Error('This does not look like a Waymark file.');
    }
    return { ...base, ...raw, settings: { ...base.settings, ...raw.settings } };
  }

  /* ---------- Record documents ---------- */
  function toDocs(s) {
    const docs = {};
    for (const [kind, field] of Object.entries(KINDS)) {
      for (const rec of s[field]) docs[`${kind}~${rec.id}`] = rec;
    }
    docs[META] = { settings: s.settings, dailyPriorities: s.dailyPriorities, weeklyPriorities: s.weeklyPriorities, version: s.version };
    return docs;
  }

  function fromDocs(docs) {
    const s = Logic.defaultState();
    const meta = docs[META];
    if (meta) {
      s.settings = { ...s.settings, ...clone(meta.settings || {}) };
      s.dailyPriorities = clone(meta.dailyPriorities || {});
      s.weeklyPriorities = clone(meta.weeklyPriorities || {});
    }
    for (const [id, body] of Object.entries(docs)) {
      const field = KINDS[id.split('~')[0]];
      if (field && body) s[field].push(clone(body));
    }
    // A stable order on every device: when each record was created.
    for (const field of Object.values(KINDS)) s[field].sort((a, b) => (a._at || 0) - (b._at || 0) || String(a.id).localeCompare(String(b.id)));
    return s;
  }

  // Remote data with anything this device hasn't finished sending laid over it.
  function merged() {
    const docs = { ...remote };
    for (const map of [inflight, pending]) {
      for (const [id, body] of map) { if (body === null) delete docs[id]; else docs[id] = body; }
    }
    return fromDocs(docs);
  }

  function queueDiff(before, after) {
    let stamp = Date.now();
    for (const field of Object.values(KINDS)) {
      for (const rec of after[field]) if (!rec._at) rec._at = stamp++;
    }
    const a = toDocs(before);
    const b = toDocs(after);
    for (const id of Object.keys(b)) {
      if (JSON.stringify(a[id]) !== JSON.stringify(b[id])) pending.set(id, clone(b[id]));
    }
    for (const id of Object.keys(a)) if (!(id in b)) pending.set(id, null);
    flush();
  }

  async function flush() {
    if (flushing || !collection) return;
    flushing = true;
    let delay = 1000;
    while (pending.size) {
      const [id, body] = pending.entries().next().value;
      pending.delete(id);
      inflight.set(id, body);
      try {
        const ref = collection.doc(id);
        await (body === null ? ref.delete() : ref.set(body));
        inflight.delete(id);
        if (body === null) delete remote[id]; else remote[id] = body;
        delay = 1000;
        if (issue === 'save-failed') setIssue(null);
      } catch (e) {
        inflight.delete(id);
        if (!pending.has(id)) pending.set(id, body);
        const transient = e && (e.code === 'unavailable' || e.code === 'resource_exhausted');
        setIssue('save-failed');
        flushing = false;
        // Try again later; a new change or returning to the page also retries.
        clearTimeout(retryTimer);
        retryTimer = setTimeout(flush, transient ? Math.min(delay * 2, 30000) : 60000);
        return;
      }
    }
    flushing = false;
  }

  function applySnapshot(snap) {
    const docs = {};
    snap.docs.forEach((d) => { docs[d.id] = d.data(); });
    remote = docs;
    if (!snap.metadata.fromCache) {
      definitive = true;
      clearTimeout(loadTimer);
      if (issue === 'unreachable') setIssue(null);
    }
    // Wait for real data, so a new device doesn't flash an empty dashboard.
    if (!ready && !definitive && !snap.docs.length) return;
    const next = merged();
    const changed = JSON.stringify(next) !== JSON.stringify(state);
    state = next;
    if (!ready) { ready = true; notify('ready'); } else if (changed) notify('remote');
  }

  function listen() {
    collection.onSnapshot(applySnapshot, (e) => {
      if (e && e.code === 'unavailable') { setTimeout(listen, 5000); return; }
      setIssue('stopped');
    });
  }

  /* ---------- localStorage (not hosted, or sync not available in this view) ---------- */
  function loadLocal() {
    let text = null;
    try { text = localStorage.getItem(KEY); } catch { /* storage may be blocked */ }
    if (text) {
      try {
        state = normalize(JSON.parse(text));
      } catch {
        // Keep the unreadable copy rather than overwrite it, and say so in the UI.
        try { localStorage.setItem(`${KEY}.corrupt.${Date.now()}`, text); } catch { /* nothing more to do */ }
        recovered = true;
      }
    }
    window.addEventListener('storage', (e) => {
      if (e.key === KEY && e.newValue) { state = normalize(JSON.parse(e.newValue)); notify('remote'); }
    });
    ready = true;
  }

  function saveLocal() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      if (issue === 'save-failed') setIssue(null);
    } catch {
      setIssue('save-failed');
    }
  }

  /* ---------- Starting up ---------- */
  async function start() {
    const hosted = !!(window.claude && typeof window.claude.use === 'function');
    if (!hosted) { loadLocal(); notify('ready'); return; }
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    const id = user ? await user.id() : null;
    if (!db || !id) {
      loadLocal();
      issue = 'no-sync';
      notify('ready');
      return;
    }
    collection = db.collection(`data/users/${id}`);
    loadTimer = setTimeout(() => {
      setIssue('unreachable');
      if (!ready) { ready = true; notify('ready'); }
    }, 10000);
    listen();
    const retry = () => { if (pending.size) flush(); };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) retry(); });
  }

  /* ---------- Changing things ---------- */
  function persist(before) {
    if (collection) queueDiff(before, state);
    else saveLocal();
    notify('local');
  }

  function commit(fn) {
    const before = clone(state);
    try {
      fn(state);
    } catch (e) {
      // Usually a record another device just deleted. Leave everything as it was.
      console.error(e);
      state = before;
      notify('local');
      return;
    }
    snapshot = JSON.stringify(before);
    persist(before);
  }

  function undo() {
    if (!snapshot) return;
    const before = state;
    state = JSON.parse(snapshot);
    snapshot = null;
    persist(before);
  }

  function replace(raw) {
    const next = normalize(raw);
    const before = state;
    snapshot = JSON.stringify(before);
    state = next;
    persist(before);
  }

  return {
    start, commit, undo, replace,
    get state() { return state; },
    get ready() { return ready; },
    get issue() { return issue; },
    get recovered() { return recovered; },
    get synced() { return !!collection; },
    get hosted() { return !!(window.claude && typeof window.claude.use === 'function'); },
    subscribe(fn) { notify = fn; },
  };
})();
