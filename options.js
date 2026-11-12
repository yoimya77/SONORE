// SONORE — 設定画面

const $ = (id) => document.getElementById(id);
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 月曜はじまりで並べる

let dirty = false;
let locked = false;

// 入力が足りないときだけ、時間帯の下に注意を出す
function updateWarning(row) {
  const s = OD.parseTime(row.querySelector(".start").value);
  const e = OD.parseTime(row.querySelector(".end").value);
  const days = row.querySelectorAll(".days input:checked").length;
  const warning = row.querySelector(".slot-warning");

  let text = "";
  if (s === null || e === null) text = "開始と終了の時刻を入力してください。";
  else if (days === 0) text = "曜日が選ばれていないため、この時間帯は使われません。";
  warning.textContent = text;
  warning.hidden = !text;
}

function addSlotRow(slot) {
  const row = $("slotTemplate").content.firstElementChild.cloneNode(true);
  row.querySelector(".start").value = slot.start;
  row.querySelector(".end").value = slot.end;

  const daysBox = row.querySelector(".days");
  for (const d of DAY_ORDER) {
    const label = document.createElement("label");
    label.className = "day";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(d);
    input.checked = (slot.days || []).includes(d);
    input.setAttribute("aria-label", `${OD.DAY_NAMES[d]}曜日`);
    const span = document.createElement("span");
    span.textContent = OD.DAY_NAMES[d];
    span.setAttribute("aria-hidden", "true");
    label.append(input, span);
    daysBox.append(label);
  }

  row.querySelector(".remove").addEventListener("click", () => {
    row.remove();
    markDirty();
  });
  row.addEventListener("input", () => updateWarning(row));
  row.addEventListener("change", () => updateWarning(row));

  $("slots").append(row);
  updateWarning(row);
}

function fillForm(settings) {
  $("slots").replaceChildren();
  for (const slot of settings.slots) addSlotRow(slot);
  $("exceptions").value = settings.exceptions.join("\n");
  $("waitMinutes").value = settings.waitMinutes;
  $("unlockMinutes").value = settings.unlockMinutes;
  dirty = false;
}

function readForm() {
  const slots = [];
  for (const row of $("slots").querySelectorAll(".slot")) {
    const start = row.querySelector(".start").value;
    const end = row.querySelector(".end").value;
    if (OD.parseTime(start) === null || OD.parseTime(end) === null) {
      return { error: "時刻が入力されていない時間帯があります。入力するか、削除してください。" };
    }
    const days = [...row.querySelectorAll(".days input:checked")].map((el) => Number(el.value));
    slots.push({ start, end, days });
  }

  const exceptions = [...new Set(
    $("exceptions").value.split(/\r?\n/).map(OD.normalizeHost).filter(Boolean)
  )];

  const waitMinutes = Number($("waitMinutes").value);
  const unlockMinutes = Number($("unlockMinutes").value);
  if (!Number.isInteger(waitMinutes) || waitMinutes < 0 || waitMinutes > 180) {
    return { error: "承認までの待ち時間は、0〜180分の整数で入力してください。" };
  }
  if (!Number.isInteger(unlockMinutes) || unlockMinutes < 1 || unlockMinutes > 480) {
    return { error: "解除できる時間は、1〜480分の整数で入力してください。" };
  }

  return { settings: { slots, exceptions, waitMinutes, unlockMinutes } };
}

function showMessage(text, isError) {
  const el = $("saveMsg");
  el.textContent = text;
  el.classList.toggle("error", Boolean(isError));
}

function markDirty() {
  dirty = true;
  showMessage("", false);
}

function setLocked(value) {
  locked = value;
  $("fields").disabled = value;
  $("save").disabled = value;
  $("lockBanner").hidden = !value;
}

async function checkLock() {
  const { settings, state } = await OD.load();
  $("setupBanner").hidden = !state.setupPending;
  setLocked(OD.settingsLocked(settings, state, Date.now()));
}

$("addSlot").addEventListener("click", () => {
  addSlotRow({ start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] });
  markDirty();
});

$("form").addEventListener("input", markDirty);

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  // 保存する直前にも、遮断時間帯に入っていないか確かめる
  const current = await OD.load();
  if (OD.settingsLocked(current.settings, current.state, Date.now())) {
    setLocked(true);
    showMessage("遮断時間帯に入ったため、保存できませんでした。", true);
    return;
  }
  const result = readForm();
  if (result.error) {
    showMessage(result.error, true);
    return;
  }
  const patch = { settings: result.settings };
  // 最初の保存が済んだら、ここからはロックする
  if (current.state.setupPending) {
    patch.state = Object.assign({}, current.state, { setupPending: false });
  }
  await chrome.storage.local.set(patch);
  dirty = false;
  fillForm(OD.withDefaults(result.settings));
  showMessage("設定を保存しました。", false);
  checkLock();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  // 別の場所（ポップアップなど）で変わったときは、編集中でなければ反映する
  if (changes.settings && !dirty) {
    const { settings } = await OD.load();
    fillForm(settings);
  }
  checkLock();
});

// 表示板は横90個、縦22個。左に名前、右にバージョン。両はしを4個ずつあける
function drawLogo() {
  const cols = 90;
  const version = "v" + chrome.runtime.getManifest().version;
  const canvas = $("logo");
  SonoreDots.draw(canvas, cols, 22, [
    { text: "SONORE", col: 4, row: 3, color: "ink" },
    // 小さい文字の下の線を、名前の下の線（上から17個め）にそろえる
    { text: version, col: cols - 4 - SonoreDots.width(version, true), row: 10, small: true, color: "ink" }
  ]);
  canvas.setAttribute("aria-label", `SONORE バージョン ${version.slice(1)}`);
}

(async () => {
  drawLogo();
  // 明るい表示と暗い表示が切り替わったら、表示板の色を描きなおす
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawLogo);
  const { settings } = await OD.load();
  fillForm(settings);
  await checkLock();
  setInterval(checkLock, 5000);
})();
