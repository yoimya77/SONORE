// SONORE — 各ページの中で動くスクリプト
// やっていることは、時間帯の中なら「video{display:none}」というスタイルを足すことだけです。
// 映像は見えなくなりますが、音はそのまま流れます。

(() => {
  const OD = self.OD;
  const CSS = "video{display:none!important}";
  let styleEl = null;
  let settings = null;
  let state = null;
  let timer = null;

  // このフレームのサイトと、埋め込まれている場合はいちばん外側のサイト
  function currentHosts() {
    const hosts = [location.hostname];
    try {
      const ancestors = location.ancestorOrigins;
      if (ancestors && ancestors.length) {
        hosts.push(new URL(ancestors[ancestors.length - 1]).hostname);
      }
    } catch (e) {
      // 取れなくても、このフレームのサイトだけで判断する
    }
    return hosts.filter(Boolean);
  }

  function setHidden(hide) {
    if (hide) {
      const root = document.head || document.documentElement;
      if (!root) return;
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.textContent = CSS;
      }
      // ページが書きかわって外れてしまったときも、付け直す
      if (!styleEl.isConnected) root.appendChild(styleEl);
    } else if (styleEl) {
      styleEl.remove();
    }
  }

  function apply() {
    if (!settings) return;
    setHidden(OD.shouldHide(settings, state, Date.now(), currentHosts()));
  }

  // 拡張機能をオフにしたり削除したりしたあとは、隠したままにしない
  function extensionAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function stop() {
    clearInterval(timer);
    setHidden(false);
  }

  async function reload() {
    if (!extensionAlive()) return stop();
    try {
      ({ settings, state } = await OD.load());
      apply();
    } catch (e) {
      stop();
    }
  }

  reload();

  timer = setInterval(() => {
    if (!extensionAlive()) return stop();
    apply();
  }, 15000);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") reload();
  });

  document.addEventListener("visibilitychange", () => {
    if (!extensionAlive()) return stop();
    apply();
  });
})();
