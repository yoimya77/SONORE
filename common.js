// SONORE — どのファイルからも使う共通の処理
// 通信は一切しません。設定はこのブラウザの中（chrome.storage.local）にだけ保存します。

self.OD = self.OD || (() => {
  const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

  const DEFAULT_SETTINGS = {
    // 開始と終了が同じなら24時間。終了が開始より前なら翌日まで続く。
    slots: [{ start: "00:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    exceptions: [],
    waitMinutes: 10,   // 一時解除をお願いしてから待つ時間
    unlockMinutes: 30  // 一時解除で動画が見られる時間
  };

  const DEFAULT_STATE = {
    requestAt: null,    // 一時解除をお願いした時刻
    unlockUntil: null,  // 一時解除が終わる時刻
    setupPending: false // 入れたばかりで、まだ設定画面で保存していない
  };

  // 待ち終わってから、この時間のうちに「解除する」を押さないと取り消しになる
  const READY_WINDOW_MS = 10 * 60 * 1000;

  function parseTime(text) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(text || "");
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  // base の日に始まる時間帯の [開始, 終了) をミリ秒で返す
  function slotRange(slot, base) {
    const s = parseTime(slot.start);
    const e = parseTime(slot.end);
    if (s === null || e === null) return null;
    const start = new Date(base);
    start.setHours(Math.floor(s / 60), s % 60, 0, 0);
    const end = new Date(base);
    if (e <= s) end.setDate(end.getDate() + 1);
    end.setHours(Math.floor(e / 60), e % 60, 0, 0);
    return [start.getTime(), end.getTime()];
  }

  function inSchedule(settings, now) {
    const d = new Date(now);
    for (const slot of settings.slots || []) {
      const days = slot.days || [];
      // 前の日に始まって日付をまたいでいる時間帯も確かめる
      for (const offset of [0, -1]) {
        const base = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
        if (!days.includes(base.getDay())) continue;
        const r = slotRange(slot, base);
        if (r && now >= r[0] && now < r[1]) return true;
      }
    }
    return false;
  }

  function isUnlocked(state, now) {
    return Boolean(state && state.unlockUntil && now < state.unlockUntil);
  }

  // 時間帯の中で、一時解除もしていない
  function isBlocking(settings, state, now) {
    return inSchedule(settings, now) && !isUnlocked(state, now);
  }

  // 設定や例外を変えられない。入れたばかりで最初に保存するまでは、ロックしない
  function settingsLocked(settings, state, now) {
    return isBlocking(settings, state, now) && !(state && state.setupPending);
  }

  function normalizeHost(text) {
    let s = String(text || "").trim().toLowerCase();
    if (!s) return "";
    s = s.replace(/^[a-z]+:\/\//, "");
    s = s.split(/[\/?#]/)[0];
    s = s.replace(/:\d+$/, "");
    s = s.replace(/^\*\./, "");
    return s;
  }

  // カスタムフィルターと同じく、サブドメインにも効く
  function hostMatches(host, rule) {
    if (!host || !rule) return false;
    return host === rule || host.endsWith("." + rule);
  }

  function isException(settings, hosts) {
    const rules = (settings.exceptions || []).map(normalizeHost).filter(Boolean);
    return hosts.some((h) => rules.some((r) => hostMatches(h, r)));
  }

  function shouldHide(settings, state, now, hosts) {
    return isBlocking(settings, state, now) && !isException(settings, hosts);
  }

  function requestStatus(settings, state, now) {
    if (!state || !state.requestAt) return { phase: "none" };
    const readyAt = state.requestAt + settings.waitMinutes * 60 * 1000;
    if (now < readyAt) return { phase: "waiting", readyAt };
    const expireAt = readyAt + READY_WINDOW_MS;
    if (now < expireAt) return { phase: "ready", expireAt };
    return { phase: "none" };
  }

  // 時間帯の中と外が次に切り替わる時刻（1週間先まで探す）
  function nextChange(settings, now) {
    const current = inSchedule(settings, now);
    const first = Math.floor(now / 60000) * 60000 + 60000;
    for (let t = first; t < now + 8 * 24 * 60 * 60 * 1000; t += 60000) {
      if (inSchedule(settings, t) !== current) return t;
    }
    return null;
  }

  function withDefaults(settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    if (!Array.isArray(s.slots)) s.slots = [];
    if (!Array.isArray(s.exceptions)) s.exceptions = [];
    s.waitMinutes = clampNumber(s.waitMinutes, 0, 180, DEFAULT_SETTINGS.waitMinutes);
    s.unlockMinutes = clampNumber(s.unlockMinutes, 1, 480, DEFAULT_SETTINGS.unlockMinutes);
    return s;
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  async function load() {
    const data = await chrome.storage.local.get(["settings", "state"]);
    const state = Object.assign({}, DEFAULT_STATE, data.state || {});
    // 設定がまだ保存されていないときは、入れたばかりと同じに扱う
    if (!data.settings) state.setupPending = true;
    return { settings: withDefaults(data.settings), state };
  }

  async function ensureDefaults() {
    const data = await chrome.storage.local.get(["settings", "state"]);
    const patch = {};
    if (!data.settings) {
      // 入れたばかり。最初に設定画面で保存するまでは、ロックしない
      patch.settings = DEFAULT_SETTINGS;
      patch.state = Object.assign({}, DEFAULT_STATE, data.state || {}, { setupPending: true });
    } else if (!data.state) {
      patch.state = DEFAULT_STATE;
    }
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatClock(ms, now) {
    const d = new Date(ms);
    const today = new Date(now);
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const sameDay = d.toDateString() === today.toDateString();
    if (sameDay) return hm;
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return `明日 ${hm}`;
    return `${DAY_NAMES[d.getDay()]}曜 ${hm}`;
  }

  function formatCountdown(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${pad(s)}`;
  }

  return {
    DAY_NAMES,
    DEFAULT_SETTINGS,
    DEFAULT_STATE,
    parseTime,
    inSchedule,
    isUnlocked,
    isBlocking,
    settingsLocked,
    normalizeHost,
    hostMatches,
    isException,
    shouldHide,
    requestStatus,
    nextChange,
    withDefaults,
    load,
    ensureDefaults,
    formatClock,
    formatCountdown
  };
})();
