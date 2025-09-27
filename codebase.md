# content_script.js

```js
// DOM selectors observed on Google Meet as of 2025-09-27. These are brittle and should be
// reviewed if Meet updates its layout.
const TILE_SELECTOR = "main.axUSnc div.dkjMxf";
const NAME_SELECTOR = "div.LqxiJe span.notranslate";
const ACTIVE_INDICATOR_SELECTOR = "div.qg7mD.r6DyN.xm86Be.JBY0Kc.BlxGDf";

const DEBUG_VISUALS = true;
const DEBUG_ATTR = "data-meet-behavior-active";
const DEBUG_PANEL_ID = "meet-behavior-debug-panel";
const DEBUG_STYLE_ID = "meet-behavior-debug-style";

let isTracking = false;
let participantsRoot = null;
let tileObserver = null;
let rootObserver = null;
let pendingEvaluation = false;
let lastEmittedKey = null;
let debugStyleElement = null;
let debugActiveTiles = new Set();
let debugPanel = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "content-script") return;

  switch (message.type) {
    case "start-tracking":
      startTracking();
      break;
    case "stop-tracking":
      stopTracking();
      break;
    default:
      break;
  }
});

function startTracking() {
  if (isTracking) return;
  isTracking = true;
  lastEmittedKey = null;

  if (DEBUG_VISUALS) {
    ensureDebugInfrastructure();
    clearDebugIndicators();
    setDebugPanelMessage("Tracking active. Waiting for speaker...");
  }

  ensureRootObserver();
  attachTileObserver();
  scheduleEvaluation();
}

function stopTracking() {
  if (!isTracking) return;
  isTracking = false;
  lastEmittedKey = null;
  pendingEvaluation = false;

  if (tileObserver) {
    tileObserver.disconnect();
    tileObserver = null;
  }

  if (rootObserver) {
    rootObserver.disconnect();
    rootObserver = null;
  }

  if (DEBUG_VISUALS) {
    clearDebugIndicators();
    setDebugPanelMessage("Tracking stopped");
  }

  participantsRoot = null;
}

function ensureRootObserver() {
  if (rootObserver) return;

  rootObserver = new MutationObserver(() => {
    if (!isTracking) return;
    const attached = attachTileObserver();
    if (attached) {
      scheduleEvaluation();
    }
  });

  if (document.body) {
    rootObserver.observe(document.body, { childList: true, subtree: true });
  }
}

function attachTileObserver() {
  const root = findParticipantsRoot();
  if (!root) return false;

  if (participantsRoot === root && tileObserver) return true;

  participantsRoot = root;

  if (tileObserver) {
    tileObserver.disconnect();
  }

  tileObserver = new MutationObserver(handleParticipantMutations);
  tileObserver.observe(participantsRoot, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
  });
  return true;
}

function handleParticipantMutations(mutations) {
  if (!isTracking) return;
  for (const mutation of mutations) {
    if (mutation.type === "attributes" || mutation.type === "childList") {
      scheduleEvaluation();
      break;
    }
  }
}

function scheduleEvaluation() {
  if (!isTracking || pendingEvaluation) return;
  pendingEvaluation = true;
  const schedule = window.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
  schedule(() => {
    pendingEvaluation = false;
    evaluateActiveSpeakers();
  });
}

function evaluateActiveSpeakers() {
  if (!isTracking) return;
  const tiles = document.querySelectorAll(TILE_SELECTOR);
  if (!tiles.length) {
    if (DEBUG_VISUALS) {
      clearDebugIndicators();
      updateDebugPanelText([]);
    }
    emitSpeakers([]);
    return;
  }

  const speakers = new Set();
  const activeTiles = DEBUG_VISUALS ? [] : null;

  tiles.forEach((tile) => {
    if (!tile || !isElementVisible(tile)) return;
    if (!tile.querySelector(ACTIVE_INDICATOR_SELECTOR)) return;

    const nameNode = tile.querySelector(NAME_SELECTOR);
    const name = nameNode?.textContent?.trim();
    if (name) {
      speakers.add(name);
      if (DEBUG_VISUALS && activeTiles) {
        activeTiles.push(tile);
      }
    }
  });

  const normalized = normalizeSpeakers(Array.from(speakers));

  if (DEBUG_VISUALS) {
    updateDebugIndicators(activeTiles || []);
    updateDebugPanelText(normalized);
  }

  emitSpeakers(normalized);
}

function emitSpeakers(speakers) {
  if (!isTracking) return;
  const normalized = normalizeSpeakers(speakers);
  const key = normalized.join("|");
  if (key === lastEmittedKey) return;
  lastEmittedKey = key;

  chrome.runtime.sendMessage(
    {
      target: "service-worker",
      type: "speaker-update",
      speakers: normalized,
    },
    () => {
      const err = chrome.runtime.lastError;
      if (err && !/Receiving end/.test(err.message || "")) {
        console.warn("[content-script] speaker-update failed:", err.message);
      }
    }
  );
}

function normalizeSpeakers(list) {
  if (!Array.isArray(list)) return [];
  const unique = new Set();
  for (const value of list) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) unique.add(trimmed);
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function isElementVisible(element) {
  if (!(element instanceof Element)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findParticipantsRoot() {
  const primary = document.querySelector("main.axUSnc");
  if (primary) return primary;
  return document.querySelector("#yDmH0d main");
}

function ensureDebugInfrastructure() {
  ensureDebugStyle();
  ensureDebugPanel();
}

function ensureDebugStyle() {
  if (!DEBUG_VISUALS) return;
  if (debugStyleElement?.isConnected) return;
  if (!debugStyleElement) {
    debugStyleElement = document.createElement("style");
    debugStyleElement.id = DEBUG_STYLE_ID;
    debugStyleElement.textContent = `
      [${DEBUG_ATTR}="true"] {
        outline: 3px solid #ff6f00 !important;
        position: relative !important;
      }
      [${DEBUG_ATTR}="true"]::after {
        content: "Speaking";
        position: absolute;
        top: 4px;
        left: 4px;
        background: rgba(255, 111, 0, 0.9);
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        z-index: 2147483647;
        pointer-events: none;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
      }
      #${DEBUG_PANEL_ID} {
        position: fixed;
        bottom: 12px;
        right: 12px;
        background: rgba(0, 0, 0, 0.7);
        color: #fff;
        font-size: 12px;
        line-height: 1.4;
        padding: 6px 10px;
        border-radius: 6px;
        z-index: 2147483647;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
        pointer-events: none;
        font-family: Arial, sans-serif;
        max-width: 260px;
        word-break: break-word;
      }
    `;
  }
  const parent = document.head || document.documentElement || document.body;
  if (parent && !debugStyleElement.isConnected) {
    parent.appendChild(debugStyleElement);
  }
}

function ensureDebugPanel() {
  if (!DEBUG_VISUALS) return;
  if (debugPanel?.isConnected) return;
  if (!debugPanel) {
    debugPanel = document.createElement("div");
    debugPanel.id = DEBUG_PANEL_ID;
  }
  const parent = document.body || document.documentElement;
  if (parent && !debugPanel.isConnected) {
    parent.appendChild(debugPanel);
  }
}

function updateDebugIndicators(activeTiles) {
  if (!DEBUG_VISUALS) return;
  ensureDebugInfrastructure();
  const next = new Set();
  activeTiles.forEach((tile) => {
    if (!(tile instanceof Element)) return;
    tile.setAttribute(DEBUG_ATTR, "true");
    next.add(tile);
  });

  debugActiveTiles.forEach((tile) => {
    if (!(tile instanceof Element)) return;
    if (!next.has(tile)) {
      tile.removeAttribute(DEBUG_ATTR);
    }
  });

  debugActiveTiles = next;
}

function clearDebugIndicators() {
  debugActiveTiles.forEach((tile) => {
    if (tile instanceof Element) {
      tile.removeAttribute(DEBUG_ATTR);
    }
  });
  debugActiveTiles.clear();
}

function updateDebugPanelText(speakers) {
  if (!DEBUG_VISUALS) return;
  if (!isTracking) {
    setDebugPanelMessage("Tracking stopped");
    return;
  }
  if (!speakers || speakers.length === 0) {
    setDebugPanelMessage("Active speakers: (silence)");
  } else {
    setDebugPanelMessage(`Active speakers: ${speakers.join(", ")}`);
  }
}

function setDebugPanelMessage(message) {
  if (!DEBUG_VISUALS) return;
  ensureDebugInfrastructure();
  if (debugPanel) {
    debugPanel.textContent = message;
  }
}

```

# icons\icon-16.png

This is a binary file of the type: Image

# icons\icon-32.png

This is a binary file of the type: Image

# icons\icon-128.png

This is a binary file of the type: Image

# icons\recording.png

This is a binary file of the type: Image

# manifest.json

```json
{
  "manifest_version": 3,
  "name": "Meet Speaker Insights",
  "version": "0.1.0",
  "description": "Popup to capture Google Meet tab audio for diarization and insights.",
  "minimum_chrome_version": "116",

  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "128": "icons/icon-128.png"
  },

  "action": {
    "default_title": "Open Meet Speaker Insights",
    "default_icon": "icons/icon-16.png",
    "default_popup": "popup.html"
  },

  "background": {
    "service_worker": "service-worker.js"
  },

  "content_scripts": [
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["content_script.js"],
      "run_at": "document_idle"
    }
  ],

  "permissions": [
    "tabCapture",
    "offscreen",
    "activeTab",
    "storage",
    "downloads"
  ],

  "host_permissions": [
    "https://meet.google.com/*"
  ]
}


```

# offscreen.html

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Offscreen – Meet Audio Recorder</title>
  </head>
  <body>
    <script src="offscreen.js"></script>
  </body>
</html>

```

# offscreen.js

```js
let recorder;
let chunks = [];

let activeTabId = null;

// streams & nodes
let tabStream = null;
let micStream = null;
let audioContext = null;
let tabSourceNode = null;
let micSourceNode = null;
let mixDestination = null; // MediaStreamDestination for recorder

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target !== "offscreen") return;
  switch (message.type) {
    case "start-recording":
      await startRecording(message.data);
      break;
    case "stop-recording":
      await stopRecording();
      break;
    default:
      console.warn("[offscreen] Unknown message:", message.type);
  }
});

async function startRecording(payload) {
  const { streamId, includeMic, tabId } = normalizePayload(payload);
  activeTabId = typeof tabId === "number" ? tabId : null;

  if (recorder?.state === "recording") {
    throw new Error("startRecording called while already recording");
  }
  await cleanupAll();
  chunks = [];

  try {
    // 1) Get TAB audio (no video)
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
      video: false
    });

    // 2) Optionally get MIC
    if (includeMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
      } catch (e) {
        // If user denies mic, fall back to tab-only
        micStream = null;
        chrome.runtime.sendMessage({
          type: "recording-error",
          target: "popup",
          error: "Microphone permission denied. Continuing with tab-only audio."
        });
      }
    }

    // 3) Build graph
    audioContext = new AudioContext();

    // a) sources
    tabSourceNode = audioContext.createMediaStreamSource(tabStream);
    if (micStream) micSourceNode = audioContext.createMediaStreamSource(micStream);

    // b) mix destination for recorder
    mixDestination = audioContext.createMediaStreamDestination();

    // c) connect to recorder mix: always include tab; include mic if exists
    tabSourceNode.connect(mixDestination);
    if (micSourceNode) micSourceNode.connect(mixDestination);

    // d) monitor to speakers: TAB ONLY (do not route mic to avoid self-echo)
    tabSourceNode.connect(audioContext.destination);
    try { await audioContext.resume(); } catch {}

    // 4) Recorder uses the mixed destination stream
    recorder = new MediaRecorder(mixDestination.stream, { mimeType: "audio/webm;codecs=opus" });
    recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
    recorder.onstop = onRecorderStop;

    recorder.start(1000);
    chrome.runtime.sendMessage({ type: "recording-started", target: "service-worker", tabId: activeTabId });
    window.location.hash = "recording";
    chrome.runtime.sendMessage({ type: "update-icon", target: "service-worker", recording: true });

  } catch (error) {
    console.error("[offscreen] Error starting recording:", error);
    chrome.runtime.sendMessage({ type: "recording-error", target: "popup", error: error.message });
    await cleanupAll();
    window.location.hash = "";
    activeTabId = null;
  }
}

async function stopRecording() {
  try {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    } else {
      await cleanupAll();
      window.location.hash = "";
      chrome.runtime.sendMessage({ type: "update-icon", target: "service-worker", recording: false });
      chrome.runtime.sendMessage({ type: "recording-stopped", target: "service-worker", tabId: activeTabId });
      chrome.runtime.sendMessage({ type: "recording-stopped", target: "popup" });
      activeTabId = null;
    }
  } catch (err) {
    console.error("[offscreen] stopRecording error:", err);
  }
}

async function onRecorderStop() {
  const tabId = activeTabId;
  try {
    const blob = new Blob(chunks, { type: "audio/webm" });
    const url = URL.createObjectURL(blob);
    const filename = "meeting_audio.webm";
    
    // Send download request to service worker since chrome.downloads is not available in offscreen
    chrome.runtime.sendMessage({
      type: "download-recording",
      target: "service-worker",
      url: url,
      filename: filename
    });
  } catch (err) {
    console.error("[offscreen] Finalize error:", err);
    chrome.runtime.sendMessage({ type: "recording-error", target: "popup", error: err?.message || String(err) });
  } finally {
    recorder = undefined;
    chunks = [];
    await cleanupAll();
    window.location.hash = "";
    chrome.runtime.sendMessage({ type: "recording-stopped", target: "service-worker", tabId });
    chrome.runtime.sendMessage({ type: "recording-stopped", target: "popup" });
    activeTabId = null;
  }
}

async function cleanupAll() {
  try {
    // disconnect nodes
    try { tabSourceNode && tabSourceNode.disconnect(); } catch {}
    try { micSourceNode && micSourceNode.disconnect(); } catch {}
    tabSourceNode = micSourceNode = null;

    try { mixDestination && mixDestination.disconnect?.(); } catch {}
    mixDestination = null;

    // close context
    if (audioContext) { try { await audioContext.close(); } catch {} audioContext = null; }

    // stop tracks
    if (tabStream) { try { stopStream(tabStream); } catch {} tabStream = null; }
    if (micStream) { try { stopStream(micStream); } catch {} micStream = null; }

    await new Promise(r => setTimeout(r, 80));
  } catch (err) {
    console.warn("[offscreen] cleanup warn:", err);
  }
}

function stopStream(s) { s.getTracks().forEach(t => t.stop()); }

function normalizePayload(p) {
  if (!p) return { streamId: null, includeMic: false, tabId: null };
  if (typeof p === "string") return { streamId: p, includeMic: false, tabId: null };
  const tabId = typeof p.tabId === "number" ? p.tabId : null;
  return { streamId: p.streamId, includeMic: !!p.includeMic, tabId };
}



```

# permissions.html

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Meet Speaker Insights - Permission Setup</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, Arial, sans-serif; margin: 0; padding: 24px; background: #f5f5f5; color: #212121; }
      main { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 4px 18px rgba(0,0,0,0.08); padding: 28px 32px 32px; display: flex; flex-direction: column; gap: 24px; }
      h1 { font-size: 22px; margin: 0; }
      p { margin: 0; line-height: 1.5; }
      .status-card { border: 1px solid #dcdcdc; border-radius: 10px; padding: 16px; background: #fafafa; display: flex; flex-direction: column; gap: 12px; }
      .status-heading { font-weight: 600; font-size: 16px; }
      .status-message { font-size: 14px; }
      .status-message.success { color: #1b5e20; }
      .status-message.warning { color: #ef6c00; }
      .status-message.error { color: #c62828; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; }
      button { cursor: pointer; border: none; border-radius: 6px; padding: 10px 16px; font-size: 14px; font-weight: 600; transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease; }
      button.primary { background: #1a73e8; color: #fff; }
      button.secondary { background: #e0e0e0; color: #1f1f1f; }
      button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 12px rgba(0,0,0,0.1); }
      button:disabled { opacity: 0.6; cursor: default; box-shadow: none; transform: none; }
      ol { padding-left: 20px; margin: 0; display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #ececec; border-radius: 4px; padding: 2px 4px; }
      a { color: #1a73e8; }
      footer { font-size: 12px; color: #555; text-align: center; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Meet Speaker Insights - Permission Setup</h1>
        <p>Use this helper to make sure Chrome lets the extension capture your microphone when you want it recorded alongside the Meet tab audio.</p>
      </header>

      <section class="status-card">
        <span class="status-heading">Microphone permission</span>
        <span id="micStatus" class="status-message">Checking microphone permission...</span>
        <div class="actions">
          <button id="requestMic" class="primary">Request microphone now</button>
          <button id="refreshStatus" class="secondary">Refresh status</button>
        </div>
        <p id="micHelp" class="status-message warning" hidden>
          Microphone is blocked for this extension. Click the lock icon in the address bar, choose <strong>Site settings</strong>, and set <strong>Microphone</strong> to <strong>Allow</strong> for this extension&rsquo;s origin (<code id="extensionOrigin"></code>). Then come back and refresh.
        </p>
      </section>

      <section>
        <h2>How to unblock the microphone manually</h2>
        <ol>
          <li>Open a tab and visit <code id="siteSettingsUrl">chrome://settings/content/microphone</code>.</li>
          <li>Look for entries that mention <strong id="extensionIdLabel"></strong>. Remove or switch them to <strong>Allow</strong>.</li>
          <li>Return to this page and click <em>Refresh status</em>.</li>
        </ol>
        <p>If Chrome will not let the extension open <code>chrome://</code> pages automatically, copy the link above and paste it in the address bar.</p>
      </section>

      <section>
        <h2>Next steps</h2>
        <p>When the status above shows <strong>Microphone ready</strong>, you can close this tab and start recording from the extension popup again.</p>
      </section>

      <footer>
        Need help? Reopen the popup and click <em>Open permission helper</em> any time.
      </footer>
    </main>

    <script src="permissions.js"></script>
  </body>
</html>

```

# permissions.js

```js
const micStatusEl = document.getElementById('micStatus');
const requestButton = document.getElementById('requestMic');
const refreshButton = document.getElementById('refreshStatus');
const helpEl = document.getElementById('micHelp');
const originEl = document.getElementById('extensionOrigin');
const siteSettingsUrlEl = document.getElementById('siteSettingsUrl');
const extensionIdLabel = document.getElementById('extensionIdLabel');

const extensionOrigin = chrome.runtime.getURL('');
originEl.textContent = extensionOrigin.replace(/\/$/, '');
siteSettingsUrlEl.textContent = 'chrome://settings/content/microphone';
extensionIdLabel.textContent = chrome.runtime.id;

let micPermissionStatus;
let currentState = 'checking';

(async function init() {
  applyMicState('checking');
  await evaluateMicPermission();

  requestButton?.addEventListener('click', requestMicrophone);
  refreshButton?.addEventListener('click', evaluateMicPermission);
})();

async function evaluateMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    applyMicState('unsupported');
    return;
  }

  if (navigator.permissions?.query) {
    try {
      micPermissionStatus = await navigator.permissions.query({ name: 'microphone' });
      applyMicState(micPermissionStatus.state);
      micPermissionStatus.onchange = () => applyMicState(micPermissionStatus.state);
      return;
    } catch (err) {
      console.warn('[permissions] Unable to query microphone permission:', err);
    }
  }

  // Fallback - assume Chrome will prompt on demand.
  applyMicState('prompt');
}

async function requestMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    applyMicState('unsupported');
    return;
  }

  try {
    applyMicState('requesting');
    if (requestButton) {
      requestButton.disabled = true;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    stream.getTracks().forEach(track => track.stop());
    applyMicState('granted');
    await evaluateMicPermission();
  } catch (err) {
    console.warn('[permissions] Microphone request failed:', err);
    applyMicState('denied');
  } finally {
    if (requestButton) {
      requestButton.disabled = requestButton.hidden;
    }
  }
}

function applyMicState(state) {
  currentState = state;

  if (!micStatusEl) return;

  let message = '';
  let messageClass = 'status-message';
  let showHelp = false;
  let showRequest = true;

  switch (state) {
    case 'granted':
      message = 'Microphone ready. The popup can include your mic in recordings.';
      messageClass += ' success';
      showRequest = false;
      break;
    case 'prompt':
      message = 'Click "Request microphone now" and allow the permission when Chrome prompts you.';
      messageClass += ' warning';
      showRequest = true;
      break;
    case 'denied':
      message = 'Chrome is currently blocking the microphone for this extension.';
      messageClass += ' error';
      showHelp = true;
      showRequest = true;
      break;
    case 'requesting':
      message = 'Requesting microphone from Chrome...';
      messageClass += ' warning';
      showRequest = true;
      break;
    case 'unsupported':
      message = 'This browser build does not support requesting microphone access from extensions. Chrome will prompt when you start recording.';
      messageClass += ' warning';
      showRequest = false;
      break;
    case 'checking':
    default:
      message = 'Checking microphone permission...';
      messageClass += ' warning';
      showRequest = false;
      break;
  }

  micStatusEl.className = messageClass;
  micStatusEl.textContent = message;

  if (requestButton) {
    requestButton.hidden = !showRequest;
    requestButton.disabled = requestButton.hidden;
  }

  if (helpEl) {
    helpEl.hidden = !showHelp;
  }
}
```

# popup.html

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { width: 220px; padding: 12px; display: flex; flex-direction: column; gap: 10px; font-family: system-ui, Arial; }
      .button-container { position: relative; height: 40px; }
      button { position: absolute; width: 100%; height: 40px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; opacity: 0; transition: opacity .25s ease; }
      button.visible { opacity: 1; }
      #startRecord { background: #4caf50; color: #fff; display: none; }
      #stopRecord { background: #f44336; color: #fff; display: none; }
      small { color: #666; }
      .mic-status { font-size: 12px; color: #333; border: 1px solid #dcdcdc; border-radius: 6px; padding: 8px; background: #fafafa; display: flex; flex-direction: column; gap: 6px; }
      .mic-status .mic-actions { display: flex; gap: 6px; flex-wrap: wrap; }
      .mic-status button { position: static; width: auto; height: auto; padding: 4px 10px; border-radius: 4px; font-size: 12px; border: none; cursor: pointer; transition: opacity .15s ease; opacity: 1; }
      .mic-status button.primary { background: #2962ff; color: #fff; }
      .mic-status button.secondary { background: #e0e0e0; color: #1f1f1f; }
      .mic-status button.primary:disabled, .mic-status button.secondary:disabled { background: #bbb; color: #666; cursor: default; }
      .mic-status .mic-warning { color: #c62828; }
    </style>
  </head>
  <body>
    <div class="button-container">
      <button id="startRecord">Start Recording (tab)</button>
      <button id="stopRecord">Stop Recording</button>
    </div>

    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#333;">
      <input type="checkbox" id="includeMic" checked />
      Include my microphone in recording
    </label>

    <div id="micStatus" class="mic-status" hidden>
      <strong>Microphone access</strong>
      <span id="micStatusText">Checking...</span>
      <div class="mic-actions">
        <button id="requestMic" type="button" class="primary">Allow microphone</button>
        <button id="openPermissionHelper" type="button" class="secondary">Open permission helper</button>
      </div>
      <small id="micHelp" class="mic-warning" hidden>
        Microphone is blocked. Use the permission helper above or click the lock icon in the address bar and allow the microphone for this extension.
      </small>
    </div>

    <small>Captures active tab audio; mic is mixed into the recording only (not played locally).</small>
    <script src="popup.js"></script>
  </body>
</html>

```

# popup.js

```js
const startButton = document.getElementById("startRecord");
const stopButton  = document.getElementById("stopRecord");
const includeMicEl = document.getElementById("includeMic");
const micStatusBox = document.getElementById("micStatus");
const micStatusText = document.getElementById("micStatusText");
const requestMicButton = document.getElementById("requestMic");
const micHelpEl = document.getElementById("micHelp");
const openPermissionHelperButton = document.getElementById("openPermissionHelper");

let micPermissionState = "unknown";
let micPermissionStatus;

document.addEventListener('DOMContentLoaded', () => {
  showByState();
  initMicPermissionUI();
});

async function showByState() {
  const contexts = await chrome.runtime.getContexts({});
  const offscreenDoc = contexts.find(c => c.contextType === "OFFSCREEN_DOCUMENT");
  const isRecording = !!(offscreenDoc && offscreenDoc.documentUrl.endsWith('#recording'));

  if (isRecording) {
    startButton.style.display = 'none';
    stopButton.style.display  = 'block';
    setTimeout(() => stopButton.classList.add('visible'), 10);
  } else {
    stopButton.style.display  = 'none';
    startButton.style.display = 'block';
    setTimeout(() => startButton.classList.add('visible'), 10);
  }
}

async function initMicPermissionUI() {
  if (!micStatusBox) return;

  micStatusBox.hidden = false;
  applyMicState('checking');

  if (!navigator.mediaDevices?.getUserMedia) {
    applyMicState('unsupported');
    return;
  }

  if (navigator.permissions?.query) {
    try {
      micPermissionStatus = await navigator.permissions.query({ name: 'microphone' });
      applyMicState(micPermissionStatus.state);
      micPermissionStatus.onchange = () => applyMicState(micPermissionStatus.state);
      return;
    } catch (err) {
      console.warn('[popup] Unable to query microphone permission:', err);
    }
  }

  applyMicState('prompt');
}

startButton.addEventListener('click', async () => {
  try {
    const includeMic = !!includeMicEl?.checked;
    if (includeMic && micPermissionState === 'denied') {
      alert('Microphone access is currently blocked. Click "Allow microphone" below or adjust your browser permissions before recording.');
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      alert('Cannot record Chrome system pages. Open Google Meet or any regular tab.');
      return;
    }

    // Ensure offscreen exists with the right reasons (USER_MEDIA + AUDIO_PLAYBACK)
    const contexts = await chrome.runtime.getContexts({});
    const offscreenDoc = contexts.find(c => c.contextType === 'OFFSCREEN_DOCUMENT');
    if (!offscreenDoc) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [
          chrome.offscreen?.Reason?.USER_MEDIA || 'USER_MEDIA',
          chrome.offscreen?.Reason?.AUDIO_PLAYBACK || 'AUDIO_PLAYBACK'
        ],
        justification: 'Capture tab audio and optionally mic; play tab audio locally while recording.'
      });
    }

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

    await chrome.runtime.sendMessage({
      type: 'start-recording',
      target: 'offscreen',
      data: { streamId, includeMic, tabId: tab.id }
    });

    startButton.classList.remove('visible');
    setTimeout(() => {
      startButton.style.display = 'none';
      stopButton.style.display = 'block';
      setTimeout(() => stopButton.classList.add('visible'), 10);
    }, 250);
  } catch (err) {
    console.error('[popup] start error:', err);
    alert('Failed to start: ' + (err?.message || String(err)));
  }
});

stopButton.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' });
    stopButton.classList.remove('visible');
    setTimeout(() => {
      stopButton.style.display = 'none';
      startButton.style.display = 'block';
      setTimeout(() => startButton.classList.add('visible'), 10);
    }, 250);
  } catch (err) {
    console.error('[popup] stop error:', err);
  }
});

openPermissionHelperButton?.addEventListener('click', () => {
  const url = chrome.runtime.getURL('permissions.html');
  chrome.tabs.create({ url }).catch(err => console.warn('[popup] unable to open permission helper:', err));
});

requestMicButton?.addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    applyMicState('unsupported');
    return;
  }

  try {
    requestMicButton.disabled = true;
    micStatusText.textContent = 'Requesting microphone...';

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    stream.getTracks().forEach(track => track.stop());
    applyMicState('granted');
  } catch (err) {
    console.warn('[popup] Microphone request failed:', err);
    applyMicState('denied');
  } finally {
    requestMicButton.disabled = false;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'popup') return;
  if (message.type === 'recording-error' || message.type === 'recording-stopped') {
    if (message.type === 'recording-error' && typeof message.error === 'string' && message.error.toLowerCase().includes('microphone')) {
      applyMicState('denied');
    }
    showByState();
  }
});

function applyMicState(state) {
  micPermissionState = state;

  if (!micStatusBox) return;

  switch (state) {
    case 'granted':
      micStatusText.textContent = 'Microphone ready to mix into your recording.';
      if (requestMicButton) {
        requestMicButton.hidden = true;
        requestMicButton.disabled = false;
      }
      if (micHelpEl) micHelpEl.hidden = true;
      if (includeMicEl) includeMicEl.disabled = false;
      break;
    case 'prompt':
      micStatusText.textContent = 'Click below and allow the microphone before you start recording.';
      if (requestMicButton) {
        requestMicButton.hidden = false;
        requestMicButton.disabled = false;
      }
      if (micHelpEl) micHelpEl.hidden = true;
      if (includeMicEl) includeMicEl.disabled = false;
      break;
    case 'denied':
      micStatusText.textContent = 'Microphone is blocked for this extension.';
      if (requestMicButton) {
        requestMicButton.hidden = false;
        requestMicButton.disabled = false;
      }
      if (includeMicEl) {
        includeMicEl.checked = false;
        includeMicEl.disabled = true;
      }
      if (micHelpEl) micHelpEl.hidden = false;
      break;
    case 'unsupported':
      micStatusText.textContent = 'Browser will ask for microphone permission when the recording starts.';
      if (requestMicButton) {
        requestMicButton.hidden = true;
        requestMicButton.disabled = false;
      }
      if (micHelpEl) micHelpEl.hidden = true;
      if (includeMicEl) includeMicEl.disabled = false;
      break;
    case 'checking':
    default:
      micStatusText.textContent = 'Checking microphone permission...';
      if (requestMicButton) {
        requestMicButton.hidden = true;
        requestMicButton.disabled = false;
      }
      if (micHelpEl) micHelpEl.hidden = true;
      if (includeMicEl) includeMicEl.disabled = false;
      break;
  }
}

```

# README.md

```md
### Title: Meet Speaker Insights Extension

This is a Chrome extension that records the audio from a Google Meet tab and generates a structured JSON timeline of speaker activity.

It also includes a PowerShell script that creates a verification video from the output files.

This is a work in progress and is not yet ready for production.

---

### Acknowledgments

This project was inspired by and builds upon the excellent work from [chrome-recorder-extension](https://github.com/shebisabeen/chrome-recorder-extension) by [@shebisabeen](https://github.com/shebisabeen). The core audio recording methodology and Chrome extension architecture were adapted from that project and enhanced with Google Meet-specific speaker detection capabilities.

---

### TL;DR (The Bottom Line)

- **Goal:** Install and use the Meet Speaker Insights Chrome extension to record Google Meet audio and generate a structured JSON timeline of speaker activity. Optionally, create a verification video from the output files.
- **Use When:** You need to analyze communication patterns, such as speaking time or interruptions, in a Google Meet session for self-improvement or team dynamics analysis.
- **Time:** ~5-10 minutes for setup. Recording time is dependent on meeting length.

---

### 1. BEFORE YOU START (Prerequisites)

- **Purpose:** This document provides instructions for setting up the Meet Speaker Insights extension, recording a meeting, and using the provided PowerShell script to verify the output. The extension works by monitoring the Google Meet user interface to detect active speakers and capturing tab audio.
- **Access:** N/A
- **Tools:**
  - Google Chrome (v116 or newer)
  - PowerShell (for the verification script on Windows)
  - FFmpeg (must be installed and added to your system's PATH for the verification script)
- **Secrets:** N/A

---

### 2. STEP-BY-STEP PROCEDURE

> **IMPORTANT:** Follow these steps in order to ensure a successful setup. The procedure is divided into three parts: setting up the extension, recording a meeting, and optionally creating a verification video.

### Part 1: Extension Setup

#### Step 1: Download and Unpack the Source Code

This step prepares the extension files for installation in your browser.

1.  Obtain the complete source code for the project.
2.  If it is a `.zip` archive, extract it to a permanent folder on your computer (e.g., `C:\Users\YourUser\Documents\chrome-extensions\meet-insights`).

#### Step 2: Load the Extension in Chrome

This step installs the unpacked extension in your browser using Developer Mode.

1.  Open the Google Chrome browser.
2.  Navigate to the extensions page by entering `chrome://extensions` in the address bar.
3.  Enable the **Developer mode** toggle, located in the top-right corner of the page.
4.  Click the **Load unpacked** button that appears on the top-left.
5.  In the file selection dialog, navigate to and select the folder where you extracted the source code.

**Verification:** The "Meet Speaker Insights" extension card appears on the `chrome://extensions` page. You should also see its icon in the Chrome toolbar.

### Part 2: Recording a Meeting

#### Step 3: Start a Recording

This step initiates the audio capture and speaker tracking for an active Google Meet tab.

1.  Join a Google Meet call.
2.  Click the **Meet Speaker Insights** icon in your Chrome toolbar to open the popup.
3.  (Optional) Check the **Include my microphone in recording** box if you want your own audio captured.
    - If microphone permission has not been granted, the popup will guide you to allow it.
4.  Click the **Start Recording** button.

**Verification:** The extension icon in the toolbar changes from the default icon to a red recording symbol.

#### Step 4: Stop Recording and Download Files

This step finalizes the recording and downloads the audio and timeline files.

1.  Click the red recording icon in the Chrome toolbar to open the popup.
2.  Click the **Stop Recording** button.
3.  Your browser will automatically download two files to your default 'Downloads' folder:
    - `meeting_audio.webm`
    - `speaker_timeline.json`

**Verification:** Check your browser's download manager or your 'Downloads' folder for the two generated files.

### Part 3: (Optional) Creating a Verification Video

This part is for Windows users who want to visually verify the accuracy of the speaker timeline against the audio.

#### Step 5: Verify FFmpeg Installation

This step ensures the `verification-video.ps1` script can find and use FFmpeg.

\`\`\`powershell
# Open a PowerShell terminal and run this command.
Get-Command ffmpeg
\`\`\`

**Verification:** PowerShell should output the path to the `ffmpeg.exe` executable. If it returns an error, you must install FFmpeg and add its `bin` directory to your system's PATH environment variable.

#### Step 6: Run the Verification Script

This step runs a PowerShell script that uses FFmpeg to create an MP4 video file, overlaying the speaker names from the JSON file onto a black screen, synchronized with the meeting audio.

1.  Open a PowerShell terminal.
2.  Navigate to the directory containing the project files, including `verification-video.ps1`.
3.  Run the script, providing the full paths to the downloaded audio and JSON files.

\`\`\`powershell
# Replace the placeholder paths with the actual paths to your downloaded files.
.\verification-video.ps1 -JsonPath "<PATH_TO_YOUR_DOWNLOADS>\speaker_timeline.json" -AudioPath "<PATH_TO_YOUR_DOWNLOADS>\meeting_audio.webm"
\`\`\`

**Verification:** A video file named `verification_video.mp4` is created in the script's directory. Playing this video will show a black screen with speaker names appearing and disappearing in sync with the audio.

---

### 3. FINAL VALIDATION (Definition of Done)

- [ ] The `meeting_audio.webm` file has been downloaded and plays the meeting's audio correctly.
- [ ] The `speaker_timeline.json` file has been downloaded and contains a structured list of speaker events with start and end times.
- [ ] (Optional) The `verification_video.mp4` plays correctly and visually displays the speaker names synchronized with the audio track.

---

### 4. TROUBLESHOOTING & ROLLBACK

- **If things go wrong (Rollback):**

  - To completely uninstall the extension, navigate to `chrome://extensions`, find the "Meet Speaker Insights" card, and click **Remove**.

- **Common Problems:**
  - **Symptom:** The extension does not seem to detect any speakers, and the JSON file only shows "SILENCE".
    - **Fix:** This extension relies on specific HTML structure (DOM selectors) in the Google Meet interface. If Google updates its web application, these selectors can break. The extension's `content_script.js` file would need to be updated with the new selectors. This makes the extension fragile and dependent on Meet's UI stability.
  - **Symptom:** My microphone was not included in the recording.
    - **Fix:** Ensure you checked the "Include my microphone" box before starting the recording. If the browser blocked the permission, use the **Open permission helper** button in the popup to diagnose and fix the issue. You may need to manually allow microphone access for the extension in Chrome's site settings.
  - **Error:** In PowerShell: `ffmpeg was not found in your system's PATH.`
    - **Fix:** You must install FFmpeg on your system and add the folder containing `ffmpeg.exe` (usually a `bin` folder) to your system's PATH environment variable so that PowerShell can find it.

---

### Appendix: Application Flow (Mind Map)

This section outlines the architecture and data flow of the extension.

1.  **User Interaction (popup.js & popup.html)**

    - User clicks the extension icon, opening `popup.html`.
    - User clicks "Start Recording".
    - `popup.js` sends a `start-recording` message to the `offscreen.js` document.
    - User clicks "Stop Recording".
    - `popup.js` sends a `stop-recording` message to `offscreen.js`.

2.  **Audio Recording (offscreen.js)**

    - Receives `start-recording` message.
    - Uses `chrome.tabCapture` to get the audio stream from the active Google Meet tab.
    - (Optional) Uses `navigator.mediaDevices.getUserMedia` to get the user's microphone stream.
    - Mixes the audio streams using the Web Audio API.
    - Records the mixed stream using `MediaRecorder`.
    - Sends a `recording-started` message to `service-worker.js`.
    - Receives `stop-recording` message.
    - Stops the `MediaRecorder`, creates a `.webm` audio blob, and sends a `download-recording` message to the service worker.

3.  **Speaker Detection (content_script.js)**

    - Runs only on `meet.google.com` pages.
    - Receives `start-tracking` message from the service worker.
    - Uses a `MutationObserver` to efficiently watch for changes in the Google Meet DOM.
    - When changes occur, it checks for specific CSS classes (`BlxGDf`) and selectors that indicate an active speaker.
    - It extracts the speaker's name from the corresponding DOM element.
    - When the list of active speakers changes, it sends a `speaker-update` message to `service-worker.js` with the names of the current speakers.

4.  **State & Timeline Management (service-worker.js)**
    - Receives `recording-started` message.
      - Initializes the timeline with a "SILENCE" event.
      - Sends a `start-tracking` message to `content_script.js`.
    - Receives `speaker-update` messages.
      - Calculates the elapsed time since the recording started.
      - Closes the previous speaker event in the timeline by setting its `end` time.
      - Adds a new event to the timeline with the new speaker(s) and a `start` time.
    - Receives `recording-stopped` message from `offscreen.js`.
      - Finalizes the last event in the timeline.
      - Creates a `.json` file from the timeline data and triggers a download using the `chrome.downloads` API.
      - Sends a `stop-tracking` message to `content_script.js`.
    - Receives `download-recording` message from `offscreen.js` and triggers the download of the `.webm` file.

```

# service-worker.js

```js
const ICON_DEFAULT = "icons/icon-16.png";
const ICON_RECORDING = "icons/recording.png";
const SILENCE_LABEL = "SILENCE";
const TIMESTAMP_DECIMALS = 3;

let trackingState = {
  active: false,
  tabId: null,
  startTime: null,
  timeline: [],
  lastSpeakersKey: null,
};

chrome.runtime.onMessage.addListener(async (message, sender) => {
  if (message?.target !== "service-worker") return;

  switch (message.type) {
    case "recording-started":
      await handleRecordingStarted(message, sender);
      break;
    case "speaker-update":
      handleSpeakerUpdate(message, sender);
      break;
    case "recording-stopped":
      await handleRecordingStopped();
      break;
    case "update-icon":
      handleUpdateIcon(message);
      break;
    case "download-recording":
      await handleDownloadRecording(message);
      break;
    default:
      break;
  }
});

async function handleRecordingStarted(message, sender) {
  const tabId = typeof message.tabId === "number" ? message.tabId : sender?.tab?.id;
  if (typeof tabId !== "number") {
    console.warn("[service-worker] recording-started received without a tabId");
    return;
  }

  if (trackingState.active && trackingState.tabId !== tabId) {
    await sendStopTrackingMessage();
  }

  trackingState.active = true;
  trackingState.tabId = tabId;
  trackingState.startTime = performance.now();
  trackingState.timeline = [{ speaker: SILENCE_LABEL, start: 0, end: null }];
  trackingState.lastSpeakersKey = createSpeakerKey([]);

  await sendStartTrackingMessage(tabId, trackingState.startTime);
  handleUpdateIcon({ recording: true });
}

function handleSpeakerUpdate(message, sender) {
  if (!trackingState.active) return;
  const senderTabId = sender?.tab?.id;
  if (typeof senderTabId !== "number" || senderTabId !== trackingState.tabId) return;

  const speakers = normalizeSpeakers(message.speakers);
  const nextKey = createSpeakerKey(speakers);
  if (nextKey === trackingState.lastSpeakersKey) return;

  const now = performance.now();
  const seconds = toSeconds(now - trackingState.startTime);
  closeLastEvent(seconds);

  trackingState.timeline.push({
    speaker: formatSpeakerField(speakers),
    start: seconds,
    end: null,
  });

  trackingState.lastSpeakersKey = nextKey;
}

async function handleRecordingStopped() {
  handleUpdateIcon({ recording: false });
  await finalizeTimeline();
}

function handleUpdateIcon(payload) {
  const recording = !!payload?.recording;
  const promise = chrome.action.setIcon({ path: recording ? ICON_RECORDING : ICON_DEFAULT });
  if (promise?.catch) {
    promise.catch(() => {});
  }
}

async function handleDownloadRecording(message) {
  if (!message?.url) return;
  const filename = message.filename || "meeting_audio.webm";

  try {
    await chrome.downloads.download({
      url: message.url,
      filename,
      saveAs: false,
    });
  } catch (err) {
    console.error("[service-worker] Download error:", err);
  } finally {
    setTimeout(() => {
      try { URL.revokeObjectURL(message.url); } catch {}
    }, 1000);
  }
}

async function finalizeTimeline() {
  if (!trackingState.active) {
    await sendStopTrackingMessage();
    resetTrackingState();
    return;
  }

  const now = performance.now();
  const seconds = toSeconds(now - trackingState.startTime);
  closeLastEvent(seconds);

  await downloadTimeline();
  await sendStopTrackingMessage();
  resetTrackingState();
}

function closeLastEvent(endSeconds) {
  const lastEvent = trackingState.timeline[trackingState.timeline.length - 1];
  if (lastEvent && lastEvent.end === null) {
    lastEvent.end = endSeconds;
  }
}

async function downloadTimeline() {
  if (!trackingState.timeline.length) return;

  const json = JSON.stringify(trackingState.timeline, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;

  try {
    const downloadPromise = chrome.downloads.download({
      url,
      filename: "speaker_timeline.json",
      saveAs: false,
    });

    if (downloadPromise?.then) {
      await downloadPromise;
    }
  } catch (err) {
    console.error("[service-worker] Timeline download error:", err);
  }
}

async function sendStartTrackingMessage(tabId, startTime) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      target: "content-script",
      type: "start-tracking",
      recordingStartTime: startTime,
    });
  } catch (err) {
    if (err?.message && !err.message.includes("Receiving end")) {
      console.warn("[service-worker] Unable to start tracking in tab", tabId, err);
    }
  }
}

async function sendStopTrackingMessage() {
  if (typeof trackingState.tabId !== "number") return;
  try {
    await chrome.tabs.sendMessage(trackingState.tabId, {
      target: "content-script",
      type: "stop-tracking",
    });
  } catch (err) {
    if (err?.message && !err.message.includes("Receiving end")) {
      console.warn("[service-worker] Unable to stop tracking in tab", trackingState.tabId, err);
    }
  }
}


function resetTrackingState() {
  trackingState = {
    active: false,
    tabId: null,
    startTime: null,
    timeline: [],
    lastSpeakersKey: null,
  };
}

function normalizeSpeakers(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Set();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) unique.add(trimmed);
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function createSpeakerKey(speakers) {
  if (!speakers || speakers.length === 0) return "";
  return speakers.join("|");
}

function formatSpeakerField(speakers) {
  if (!speakers || speakers.length === 0) return SILENCE_LABEL;
  if (speakers.length === 1) return speakers[0];
  return speakers;
}

function toSeconds(milliseconds) {
  const seconds = milliseconds / 1000;
  return Number(seconds.toFixed(TIMESTAMP_DECIMALS));
}


```

# verification-video.ps1

```ps1
<#
.SYNOPSIS
    Creates a verification video by burning speaker names from a JSON timeline onto an audio file.
#>
param(
    [string]$JsonPath = ".\speaker_timeline.json",
    [string]$AudioPath = ".\meeting_audio.webm",
    [string]$OutputVideoPath = ".\verification_video.mp4"
)

# --- Function to convert seconds to SRT timestamp format ---
function ConvertTo-SrtTime {
    param([double]$Seconds)
    $timespan = [TimeSpan]::FromSeconds($Seconds)
    return $timespan.ToString("hh\:mm\:ss\,fff")
}

# --- Step 1: Check for FFmpeg ---
Write-Host "Checking for FFmpeg..." -ForegroundColor Yellow
$ffmpegCheck = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpegCheck) {
    Write-Host "FATAL: ffmpeg was not found in your system's PATH." -ForegroundColor Red
    exit 1
}
Write-Host "✅ FFmpeg found!" -ForegroundColor Green

# --- Step 2: Read JSON and create SRT content ---
Write-Host "Reading JSON file: $JsonPath" -ForegroundColor Yellow
if (-not (Test-Path $JsonPath)) {
    Write-Host "FATAL: JSON file not found at '$JsonPath'." -ForegroundColor Red
    exit 1
}

$srtPath = Join-Path -Path (Get-Location) -ChildPath "subtitles.srt"
$srtContent = New-Object System.Text.StringBuilder
$timeline = Get-Content -Raw -Path $JsonPath | ConvertFrom-Json
$counter = 1

foreach ($event in $timeline) {
    $startTime = ConvertTo-SrtTime -Seconds $event.start
    $endTime = ConvertTo-SrtTime -Seconds $event.end
    $speakerName = if ($event.speaker -is [array]) { $event.speaker -join ', ' } else { $event.speaker }
    
    [void]$srtContent.AppendLine($counter)
    [void]$srtContent.AppendLine("$startTime --> $endTime")
    [void]$srtContent.AppendLine($speakerName)
    [void]$srtContent.AppendLine()
    $counter++
}

Set-Content -Path $srtPath -Value $srtContent.ToString() -Encoding UTF8
Write-Host "✅ SRT subtitle file created successfully at '$srtPath'." -ForegroundColor Green

# --- Step 3: Generate the video using FFmpeg ---
Write-Host "Generating verification video... (this may take a moment)" -ForegroundColor Yellow

if (-not (Test-Path $AudioPath)) {
    Write-Host "FATAL: Audio file not found at '$AudioPath'." -ForegroundColor Red
    exit 1
}

$fullOutputVideoPath = Join-Path -Path (Get-Location) -ChildPath $OutputVideoPath

# Create a simple temp file name without spaces or special characters
$tempSrtPath = "temp_subs.srt"
Copy-Item -Path $srtPath -Destination $tempSrtPath -Force

# Use the simple path without any escaping
$ffmpegArgs = @(
    "-f", "lavfi",
    "-i", "color=c=black:s=1280x720:r=25",
    "-i", $AudioPath,
    "-vf", "subtitles=${tempSrtPath}:force_style='Alignment=10,FontSize=48,PrimaryColour=&H00FFFFFF&'",
    "-c:a", "aac",
    "-c:v", "libx264",
    "-shortest",
    "-y",
    $fullOutputVideoPath
)

# Execute FFmpeg
Write-Host "Running FFmpeg with args: $($ffmpegArgs -join ' ')" -ForegroundColor Cyan
& ffmpeg @ffmpegArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "----------------------------------------------------" -ForegroundColor Cyan
    Write-Host "✅ Success! Verification video created at: '$fullOutputVideoPath'" -ForegroundColor Green
    Write-Host "----------------------------------------------------" -ForegroundColor Cyan
} else {
    Write-Host "❌ Error: FFmpeg failed to generate the video. Exit code: $LASTEXITCODE" -ForegroundColor Red
}

# Clean up the temporary SRT files
Remove-Item -Path $srtPath -ErrorAction SilentlyContinue
Remove-Item -Path $tempSrtPath -ErrorAction SilentlyContinue
```

