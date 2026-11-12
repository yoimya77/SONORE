// SONORE — 説明の吹き出し
// 吹き出しは、.tip-host にカーソルを重ねるか、キーボードで中に移ると出てきます（style.css）。
// ここでは、Esc で閉じられるようにしています。カーソルを外すか、ほかへ移ると、また出せるようになります。

for (const tipHost of document.querySelectorAll(".tip-host")) {
  tipHost.addEventListener("mouseleave", () => tipHost.classList.remove("tip-closed"));
  tipHost.addEventListener("focusout", () => tipHost.classList.remove("tip-closed"));
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const tipHost of document.querySelectorAll(".tip-host")) {
    if (tipHost.matches(":hover") || tipHost.contains(document.activeElement)) {
      tipHost.classList.add("tip-closed");
    }
  }
});
