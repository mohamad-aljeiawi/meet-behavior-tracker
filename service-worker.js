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

