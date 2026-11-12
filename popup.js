// SONORE — ポップアップ

const $ = (id) => document.getElementById(id);

let settings = null;
let state = null;
let host = "";
let nextCache = { minute: -1, value: null };

async function activeHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = new URL(tab.url);
      if (url.protocol === "http:" || url.protocol === "https:") return url.hostname;
    }
  } catch (e) {
    // 取れないページ（brave:// など）では表示しない
  }
  return "";
}

function nextChange(now) {
  const minute = Math.floor(now / 60000);
  if (nextCache.minute !== minute) {
    nextCache = { minute, value: OD.nextChange(settings, now) };
  }
  return nextCache.value;
}

async function saveState(patch) {
  state = Object.assign({}, state, patch);
  await chrome.storage.local.set({ state });
  render();
}

async function saveSettings(patch) {
  settings = Object.assign({}, settings, patch);
  nextCache.minute = -1;
  await chrome.storage.local.set({ settings });
  render();
}

function showPhase(phase) {
  for (const el of document.querySelectorAll("#unlock [data-phase]")) {
    el.hidden = el.dataset.phase !== phase;
  }
}

// 表示板は横44個、縦21個。文字は真ん中に置く。
// 数字（残り時間）は、上と下の余白がどちらも点4個になる。漢字は上下とも3個
const MATRIX_COLS = 44;
const MATRIX_ROWS = 21;

// 残り時間。100分以上は表示板に入らないので、「時間:分」にする
function matrixCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total >= 100 * 60) {
    const minutes = Math.ceil(total / 60);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  }
  return OD.formatCountdown(ms);
}

// 表示板に入りきらない文字は、右から左に流す。駅の発車標と同じ動き
const TICK_MS = 70;   // 点1個ぶん動くまでの時間
// 流れる文字と、次に来る同じ文字のあいだ（点の数）。
// 表示板の幅と同じにして、文字が全部流れ終わってから、次が入ってくるようにする
const TICK_GAP = MATRIX_COLS;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let ticker = null;    // { text, color, offset }
let tickTimer = null;

function paintTicker() {
  const span = SonoreDots.width(ticker.text) + TICK_GAP;
  const col = MATRIX_COLS - ticker.offset;
  SonoreDots.draw($("matrix"), MATRIX_COLS, MATRIX_ROWS, [
    { text: ticker.text, col, row: 3, color: ticker.color },
    { text: ticker.text, col: col + span, row: 3, color: ticker.color }
  ]);
}

function stopTicker() {
  clearInterval(tickTimer);
  tickTimer = null;
  ticker = null;
}

// 文字を止めたまま、真ん中に出す
function drawMatrix(text, color, label) {
  stopTicker();
  const canvas = $("matrix");
  const col = Math.round((MATRIX_COLS - SonoreDots.width(text)) / 2);
  SonoreDots.draw(canvas, MATRIX_COLS, MATRIX_ROWS, [{ text, col, row: 3, color }]);
  canvas.setAttribute("aria-label", label);
}

// 文字を流す。動きを減らす設定のときは、かわりに短い文字を止めて出す
function scrollMatrix(text, shortText, color, label) {
  if (reduceMotion.matches) return drawMatrix(shortText, color, label);
  $("matrix").setAttribute("aria-label", label);
  if (ticker && ticker.text === text && ticker.color === color) return; // 流れている途中は、そのまま続ける
  stopTicker();
  // 最初は、文字の先が表示板の左のほうまで来たところから始める
  ticker = { text, color, offset: MATRIX_COLS - 4 };
  paintTicker();
  tickTimer = setInterval(() => {
    const span = SonoreDots.width(ticker.text) + TICK_GAP;
    ticker.offset += 1;
    if (ticker.offset >= MATRIX_COLS + span) ticker.offset -= span;
    paintTicker();
  }, TICK_MS);
}

// 状態の文字と、その吹き出し。吹き出しがないときは、下線も出さない
function setStatus(text, tip) {
  const line = $("statusLine");
  const tipEl = $("statusTip");
  line.textContent = text;
  tipEl.textContent = tip || "";
  tipEl.hidden = !tip;
  line.classList.toggle("has-tip", Boolean(tip));
  if (tip) {
    line.tabIndex = 0;
    line.setAttribute("aria-describedby", "statusTip");
  } else {
    line.removeAttribute("tabindex");
    line.removeAttribute("aria-describedby");
  }
}

function render() {
  if (!settings) return;
  const now = Date.now();
  const inSchedule = OD.inSchedule(settings, now);
  const unlocked = OD.isUnlocked(state, now);
  const exception = host ? OD.isException(settings, [host]) : false;
  const locked = OD.settingsLocked(settings, state, now);
  const next = nextChange(now);
  const req = OD.requestStatus(settings, state, now);

  // 赤は、映像が隠れているあいだだけ使う
  let mode;
  if (!inSchedule) {
    mode = "showing";
    drawMatrix("休止", "ink", "遮断時間外");
    setStatus(next ? `${OD.formatClock(next, now)} から遮断` : "遮断時間帯が設定されていません");
  } else if (unlocked) {
    mode = "unlocked";
    drawMatrix(matrixCountdown(state.unlockUntil - now), "ink", "一時解除中");
    setStatus("一時解除中", "時間が来たら、遮断を再開します。");
  } else if (exception) {
    mode = "exception";
    drawMatrix("例外", "ink", "例外指定サイト");
    setStatus("このサイトでは遮断しません");
  } else if (req.phase === "waiting") {
    mode = "hiding";
    drawMatrix(matrixCountdown(req.readyAt - now), "red", "承認待ち");
    setStatus("承認待ち", "待っているあいだに、本当に必要か考えてください。");
  } else if (req.phase === "ready") {
    mode = "hiding";
    drawMatrix("承認", "red", "承認されました");
    setStatus("承認されました", `${OD.formatClock(req.expireAt, now)} までに実行しないと、申請は失効します。`);
  } else {
    mode = "hiding";
    scrollMatrix("映像遮断中", "遮断", "red", "映像遮断中");
    setStatus(next ? `${OD.formatClock(next, now)} まで` : "遮断時間帯はずっと続きます");
  }
  document.body.dataset.mode = mode;

  // 一時解除は、時間帯の中で、例外ではないサイトのときだけ
  const showUnlock = inSchedule && !exception;
  $("unlock").hidden = !showUnlock;
  if (showUnlock) {
    if (unlocked) {
      showPhase("unlocked");
    } else {
      showPhase(req.phase);
      if (req.phase === "none") {
        $("noteNone").textContent = settings.waitMinutes > 0
          ? `${settings.waitMinutes}分待つと、${settings.unlockMinutes}分間 映像を表示できます。`
          : `すぐに、${settings.unlockMinutes}分間 映像を表示できます。`;
      } else if (req.phase === "ready") {
        $("btnUnlockLabel").textContent = `${settings.unlockMinutes}分間 解除`;
      }
    }
  }

  // 例外の指定と解除は、遮断していない時間だけできる（入れたばかりで、最初に保存するまでは別）
  const canEditException = Boolean(host) && !locked;
  $("btnException").hidden = !canEditException;
  if (canEditException) {
    $("btnException").textContent = exception ? `${host} の例外をやめる` : `${host} を例外にする`;
  }
}

$("btnRequest").addEventListener("click", () => {
  saveState({ requestAt: Date.now() });
});

$("btnCancelWait").addEventListener("click", () => {
  saveState({ requestAt: null });
});

$("btnCancelReady").addEventListener("click", () => {
  saveState({ requestAt: null });
});

$("btnUnlock").addEventListener("click", () => {
  const now = Date.now();
  if (OD.requestStatus(settings, state, now).phase !== "ready") return render();
  saveState({ requestAt: null, unlockUntil: now + settings.unlockMinutes * 60 * 1000 });
});

$("btnRelock").addEventListener("click", () => {
  saveState({ unlockUntil: null });
});

$("btnOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

$("btnException").addEventListener("click", async () => {
  if (!host) return;
  // 押す直前にもう一度確かめる
  ({ settings, state } = await OD.load());
  if (OD.settingsLocked(settings, state, Date.now())) return render();
  const list = settings.exceptions.map(OD.normalizeHost).filter(Boolean);
  const matched = list.filter((rule) => OD.hostMatches(host, rule));
  const next = matched.length
    ? list.filter((rule) => !matched.includes(rule))
    : list.concat(host);
  saveSettings({ exceptions: next });
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  ({ settings, state } = await OD.load());
  nextCache.minute = -1;
  render();
});

(async () => {
  host = await activeHost();
  ({ settings, state } = await OD.load());
  render();
  setInterval(render, 1000);
  // 明るい表示と暗い表示が切り替わったら、表示板の色を描きなおす
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (ticker) paintTicker();
    else render();
  });
  reduceMotion.addEventListener("change", render);
})();
