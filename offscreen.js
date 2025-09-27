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


