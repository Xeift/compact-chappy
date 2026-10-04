(() => {
  const DEFAULTS = {
    contentWidth: 1920,
    fontSize: 14,
    lineHeight: 1.35,
    paragraphGap: 4,
    messageGap: 8,
    square: true,
    hideDisclaimer: false,
    enhancedThinkingDisplay: true
  };

  const DENSITY_PRESETS = {
    compact: { fontSize: 14, lineHeight: 1.35, paragraphGap: 4, messageGap: 8 },
    normal: { fontSize: 16, lineHeight: 1.5, paragraphGap: 10, messageGap: 16 },
    relaxed: { fontSize: 17, lineHeight: 1.7, paragraphGap: 14, messageGap: 24 }
  };

  let settings = { ...DEFAULTS };
  let panelHost = null;
  let panel = null;
  let toggleButton = null;
  let panelOpen = false;

  const storageGet = (defaults) =>
    new Promise((resolve) => chrome.storage.sync.get(defaults, resolve));

  const storageSet = (values) =>
    new Promise((resolve) => chrome.storage.sync.set(values, resolve));

  function updateLayoutBounds() {
    const root = document.documentElement;
    const sidebar =
      document.querySelector('nav[aria-label="Chat history"]') ||
      document.querySelector("nav");

    const sidebarWidth = sidebar
      ? Math.max(0, Math.round(sidebar.getBoundingClientRect().width))
      : 0;

    const availableWidth = Math.max(320, window.innerWidth - sidebarWidth * 2 - 32);
    root.style.setProperty("--cui-available-width", `${availableWidth}px`);
  }

  function applySettings() {
    const root = document.documentElement;

    root.classList.add("cui-layout");
    root.classList.toggle("cui-square", Boolean(settings.square));
    root.classList.toggle("cui-hide-disclaimer", Boolean(settings.hideDisclaimer));
    root.classList.toggle(
      "cui-enhanced-thinking",
      Boolean(settings.enhancedThinkingDisplay)
    );

    root.style.setProperty("--cui-content-width", `${settings.contentWidth}px`);
    root.style.setProperty("--cui-font-size", `${settings.fontSize}px`);
    root.style.setProperty("--cui-line-height", String(settings.lineHeight));
    root.style.setProperty("--cui-paragraph-gap", `${settings.paragraphGap}px`);
    root.style.setProperty("--cui-message-gap", `${settings.messageGap}px`);

    updateLayoutBounds();
    markDisclaimer();
    refreshPanelValues();
  }

  function markDisclaimer() {
    const targetText = "ChatGPT can make mistakes. Check important info.";

    for (const el of document.querySelectorAll("body div")) {
      if ((el.textContent || "").trim() === targetText) {
        el.dataset.cuiDisclaimer = "true";
      }
    }
  }

  async function injectTiming() {
    const timingInjection = await chrome.runtime.sendMessage({
      type: "inject-timing"
    });

    if (!timingInjection?.ok) {
      throw new Error(
        timingInjection?.error || "Failed to inject timing script"
      );
    }
  }

  async function updateSettings(patch) {
    settings = { ...settings, ...patch };
    applySettings();
    await storageSet(settings);

    if (
      Object.hasOwn(patch, "enhancedThinkingDisplay") &&
      settings.enhancedThinkingDisplay
    ) {
      await injectTiming();
    }
  }

  function isActuallyVisible(el) {
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const style = getComputedStyle(el);

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      style.pointerEvents !== "none"
    );
  }

  function getProfileButton() {
    let candidates = [
      ...document.querySelectorAll('[aria-label*="profile menu" i]')
    ].filter(isActuallyVisible);

    if (!candidates.length) {
      candidates = [...document.querySelectorAll('button, [role="button"]')].filter((el) => {
        if (!isActuallyVisible(el)) return false;

        const rect = el.getBoundingClientRect();
        const text = (el.textContent || "").trim();

        return (
          rect.left < 320 &&
          rect.top > window.innerHeight * 0.65 &&
          /Free|Upgrade|Plus|Pro/i.test(text)
        );
      });
    }

    if (!candidates.length) return null;

    return candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();

      return br.bottom - ar.bottom || br.width - ar.width;
    })[0];
  }

  function positionToggleButton() {
    if (!toggleButton) return;

    const profile = getProfileButton();
    if (!profile) return;

    const rect = profile.getBoundingClientRect();
    const compact = rect.width < 120;

    if (toggleButton.parentElement !== document.body) {
      document.body.appendChild(toggleButton);
    }

    const gap = 6;

    toggleButton.style.left = `${Math.round(rect.left)}px`;
    toggleButton.style.top = `${Math.max(6, Math.round(rect.top - rect.height - gap))}px`;
    toggleButton.style.width = `${Math.round(rect.width)}px`;
    toggleButton.style.height = `${Math.round(rect.height)}px`;
    toggleButton.style.marginLeft = "0";
    toggleButton.classList.toggle("cui-toggle-compact", compact);
  }

  function ensureToggleButton() {
    const profile = getProfileButton();
    if (!profile) return;

    const existing = document.getElementById("cui-layout-toggle");

    if (existing) {
      toggleButton = existing;
      positionToggleButton();
      return;
    }

    const button = document.createElement("button");
    button.id = "cui-layout-toggle";
    button.type = "button";
    button.setAttribute("aria-label", "Open Compact Chappy settings");
    button.setAttribute("data-open", "false");
    button.innerHTML = `
      <svg class="cui-toggle-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 5h16M4 12h10M4 19h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/>
        <path d="M17 9v6M14 12h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/>
      </svg>
      <span class="cui-toggle-label">Layout</span>
    `;

    button.addEventListener("click", () => setPanelOpen(!panelOpen));

    document.body.appendChild(button);
    toggleButton = button;
    positionToggleButton();
  }

  function setPanelOpen(open) {
    panelOpen = open;
    ensurePanel();

    if (!panelHost || !toggleButton) return;

    panelHost.hidden = !open;
    toggleButton.setAttribute("data-open", String(open));
    toggleButton.setAttribute("aria-expanded", String(open));

    if (open) {
      positionPanel();
      refreshPanelValues();
    }
  }

  function positionPanel() {
    if (!panelHost || panelHost.hidden || !toggleButton) return;

    const rect = toggleButton.getBoundingClientRect();
    const width = Math.min(320, Math.max(280, window.innerWidth - 16));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const bottom = Math.max(8, window.innerHeight - rect.top + 8);

    panelHost.style.left = `${left}px`;
    panelHost.style.bottom = `${bottom}px`;
    panelHost.style.width = `${width}px`;
  }

  function getPresetName() {
    for (const [name, preset] of Object.entries(DENSITY_PRESETS)) {
      if (
        preset.fontSize === Number(settings.fontSize) &&
        preset.lineHeight === Number(settings.lineHeight) &&
        preset.paragraphGap === Number(settings.paragraphGap) &&
        preset.messageGap === Number(settings.messageGap)
      ) {
        return name;
      }
    }
    return null;
  }

  function ensurePanel() {
    if (panelHost?.isConnected && panel) return;

    if (panelHost && !panelHost.isConnected) {
      panelHost = null;
      panel = null;
    }

    panelHost = document.createElement("div");
    panelHost.id = "cui-panel-host";
    panelHost.hidden = true;
    panelHost.style.position = "fixed";
    panelHost.style.zIndex = "2147483647";

    const shadow = panelHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          color-scheme: dark;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        * {
          box-sizing: border-box;
          border-radius: 0 !important;
        }

        .panel {
          width: 100%;
          max-height: calc(100vh - 120px);
          overflow: auto;
          background: #09090b;
          color: #f4f4f5;
          border: 1px solid #3f3f46;
          box-shadow: 0 18px 40px rgba(0, 0, 0, .45);
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 12px 10px;
          border-bottom: 1px solid #27272a;
          background: #18181b;
        }

        .title {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: .02em;
        }

        .close {
          width: 28px;
          height: 28px;
          min-height: 28px;
          padding: 0;
          display: grid;
          place-items: center;
          border: 0;
          background: transparent;
          color: #a1a1aa;
          cursor: pointer;
        }

        .close svg {
          width: 16px;
          height: 16px;
          display: block;
        }

        .close:hover {
          color: #fafafa;
          background: #27272a;
        }

        .body {
          padding: 12px;
          display: grid;
          gap: 14px;
        }

        .section {
          display: grid;
          gap: 8px;
        }

        .label-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }

        .label {
          font-size: 12px;
          font-weight: 650;
          color: #e4e4e7;
        }

        .value {
          font: 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          color: #a1a1aa;
        }

        .presets {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
        }

        .presets.three {
          grid-template-columns: repeat(3, 1fr);
        }

        button {
          border: 1px solid #3f3f46;
          background: #18181b;
          color: #d4d4d8;
          min-height: 30px;
          padding: 0 8px;
          cursor: pointer;
          font: 600 11px/1 system-ui, sans-serif;
        }

        button:hover,
        button[data-active="true"] {
          background: #27272a;
          border-color: #71717a;
          color: #fafafa;
        }

        input[type="range"] {
          appearance: none;
          -webkit-appearance: none;
          width: 100%;
          height: 16px;
          margin: 0;
          background: transparent;
          cursor: pointer;
        }

        input[type="range"]::-webkit-slider-runnable-track {
          height: 4px;
          border: 0;
          border-radius: 0;
          background: #3f3f46;
        }

        input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          -webkit-appearance: none;
          width: 12px;
          height: 16px;
          margin-top: -6px;
          border: 0;
          border-radius: 0;
          background: #d4d4d8;
        }

        input[type="range"]:hover::-webkit-slider-thumb {
          background: #fafafa;
        }

        input[type="range"]::-moz-range-track {
          height: 4px;
          border: 0;
          border-radius: 0;
          background: #3f3f46;
        }

        input[type="range"]::-moz-range-thumb {
          width: 12px;
          height: 16px;
          border: 0;
          border-radius: 0;
          background: #d4d4d8;
        }

        .toggle-row {
          min-height: 34px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          border-top: 1px solid #27272a;
          padding-top: 10px;
        }

        .toggle-copy {
          display: grid;
          gap: 2px;
        }

        .toggle-title {
          font-size: 12px;
          font-weight: 650;
        }

        .toggle-note {
          font-size: 11px;
          color: #71717a;
        }

        .switch {
          appearance: none;
          width: 34px;
          height: 18px;
          border: 1px solid #52525b;
          background: #27272a;
          position: relative;
          cursor: pointer;
          flex: 0 0 auto;
        }

        .switch::after {
          content: "";
          position: absolute;
          width: 12px;
          height: 12px;
          left: 2px;
          top: 2px;
          background: #71717a;
        }

        .switch:checked {
          background: #52525b;
          border-color: #a1a1aa;
        }

        .switch:checked::after {
          left: 18px;
          background: #fafafa;
        }

        .footer {
          padding: 10px 12px 12px;
          border-top: 1px solid #27272a;
        }

        .reset {
          width: 100%;
          min-height: 32px;
        }
      </style>

      <div class="panel" role="dialog" aria-label="Compact Chappy settings">
        <div class="header">
          <div class="title">Compact Chappy</div>
          <button class="close" type="button" aria-label="Close">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.25 3.25 12.75 12.75M12.75 3.25 3.25 12.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/>
            </svg>
          </button>
        </div>

        <div class="body">
          <div class="section">
            <div class="label-row">
              <div class="label">Content width / side margins</div>
              <div class="value" data-value="contentWidth"></div>
            </div>
            <input data-setting="contentWidth" type="range" min="640" max="2400" step="20">
            <div class="presets">
              <button type="button" data-width="768">768</button>
              <button type="button" data-width="1280">1280</button>
              <button type="button" data-width="1920">1920</button>
              <button type="button" data-width="2400">2400</button>
            </div>
          </div>

          <div class="section">
            <div class="label">Text density</div>
            <div class="presets three">
              <button type="button" data-density="compact">Compact</button>
              <button type="button" data-density="normal">Normal</button>
              <button type="button" data-density="relaxed">Relaxed</button>
            </div>
          </div>

          <div class="section">
            <div class="label-row">
              <div class="label">Font size</div>
              <div class="value" data-value="fontSize"></div>
            </div>
            <input data-setting="fontSize" type="range" min="12" max="20" step="0.5">
          </div>

          <div class="section">
            <div class="label-row">
              <div class="label">Line height</div>
              <div class="value" data-value="lineHeight"></div>
            </div>
            <input data-setting="lineHeight" type="range" min="1.15" max="1.9" step="0.05">
          </div>

          <div class="section">
            <div class="label-row">
              <div class="label">Paragraph spacing</div>
              <div class="value" data-value="paragraphGap"></div>
            </div>
            <input data-setting="paragraphGap" type="range" min="0" max="18" step="1">
          </div>

          <div class="section">
            <div class="label-row">
              <div class="label">Message spacing</div>
              <div class="value" data-value="messageGap"></div>
            </div>
            <input data-setting="messageGap" type="range" min="0" max="32" step="1">
          </div>

          <label class="toggle-row">
            <span class="toggle-copy">
              <span class="toggle-title">Square corners</span>
              <span class="toggle-note">Remove rounded corners from the main UI</span>
            </span>
            <input class="switch" data-setting="square" type="checkbox">
          </label>

          <label class="toggle-row">
            <span class="toggle-copy">
              <span class="toggle-title">Hide disclaimer</span>
              <span class="toggle-note">Hide “ChatGPT can make mistakes. Check important info.”</span>
            </span>
            <input class="switch" data-setting="hideDisclaimer" type="checkbox">
          </label>

          <label class="toggle-row">
            <span class="toggle-copy">
              <span class="toggle-title">Enhanced thinking display</span>
              <span class="toggle-note">Show the live response timing timeline</span>
            </span>
            <input class="switch" data-setting="enhancedThinkingDisplay" type="checkbox">
          </label>
        </div>

        <div class="footer">
          <button class="reset" type="button">Reset to defaults</button>
        </div>
      </div>
    `;

    panel = shadow;

    shadow.querySelector(".close").addEventListener("click", () => setPanelOpen(false));

    shadow.querySelectorAll("input[data-setting]").forEach((input) => {
      const key = input.dataset.setting;

      input.addEventListener("input", () => {
        const value =
          input.type === "checkbox"
            ? input.checked
            : Number(input.value);

        updateSettings({ [key]: value });
      });
    });

    shadow.querySelectorAll("[data-width]").forEach((button) => {
      button.addEventListener("click", () => {
        updateSettings({ contentWidth: Number(button.dataset.width) });
      });
    });

    shadow.querySelectorAll("[data-density]").forEach((button) => {
      button.addEventListener("click", () => {
        const preset = DENSITY_PRESETS[button.dataset.density];
        if (preset) updateSettings(preset);
      });
    });

    shadow.querySelector(".reset").addEventListener("click", () => {
      updateSettings({ ...DEFAULTS });
    });

    document.body.appendChild(panelHost);
  }

  function refreshPanelValues() {
    if (!panel) return;

    const valueText = {
      contentWidth: `${settings.contentWidth}px`,
      fontSize: `${settings.fontSize}px`,
      lineHeight: Number(settings.lineHeight).toFixed(2),
      paragraphGap: `${settings.paragraphGap}px`,
      messageGap: `${settings.messageGap}px`
    };

    panel.querySelectorAll("[data-value]").forEach((node) => {
      node.textContent = valueText[node.dataset.value] ?? "";
    });

    panel.querySelectorAll("input[data-setting]").forEach((input) => {
      const key = input.dataset.setting;
      if (input.type === "checkbox") {
        input.checked = Boolean(settings[key]);
      } else {
        input.value = settings[key];
      }
    });

    panel.querySelectorAll("[data-width]").forEach((button) => {
      button.dataset.active = String(Number(button.dataset.width) === Number(settings.contentWidth));
    });

    const presetName = getPresetName();
    panel.querySelectorAll("[data-density]").forEach((button) => {
      button.dataset.active = String(button.dataset.density === presetName);
    });
  }

  function handleOutsidePointer(event) {
    if (!panelOpen || !panelHost || !toggleButton) return;
    const path = event.composedPath();
    if (path.includes(panelHost) || path.includes(toggleButton)) return;
    setPanelOpen(false);
  }

  function installObserver() {
    let queued = false;

    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;

      requestAnimationFrame(() => {
        queued = false;

        const root = document.documentElement;
        root.classList.add("cui-layout");
        root.classList.toggle("cui-square", Boolean(settings.square));
        root.classList.toggle("cui-hide-disclaimer", Boolean(settings.hideDisclaimer));
        root.classList.toggle(
          "cui-enhanced-thinking",
          Boolean(settings.enhancedThinkingDisplay)
        );

        ensureToggleButton();
        ensurePanel();
        updateLayoutBounds();
        markDisclaimer();
        positionToggleButton();

        if (panelHost) panelHost.hidden = !panelOpen;
        if (panelOpen) positionPanel();
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  async function init() {
    settings = await storageGet(DEFAULTS);
    applySettings();

    if (settings.enhancedThinkingDisplay) {
      await injectTiming();
    }
    ensureToggleButton();
    ensurePanel();
    installObserver();

    window.addEventListener(
      "resize",
      () => {
        updateLayoutBounds();
        positionToggleButton();
        positionPanel();
      },
      { passive: true }
    );
    document.addEventListener("pointerdown", handleOutsidePointer, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && panelOpen) setPanelOpen(false);
    });
  }

  init();
})();
