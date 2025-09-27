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
