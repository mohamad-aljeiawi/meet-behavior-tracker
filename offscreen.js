let recorder;
let activeStream = null;
let chunks = [];

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

async function startRecording(streamId) {
  if (recorder?.state === "recording") {
    throw new Error("startRecording called while already recording");
  }

  // Ensure any previous stream is closed
  await stopAllTracks();
  chunks = [];

  try {
    // Acquire TAB audio only (no microphone)
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    activeStream = tabStream;

    // Record tab stream directly (no AudioContext mixing, no echo)
    recorder = new MediaRecorder(tabStream, {
      mimeType: "audio/webm;codecs=opus"
    });

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunks.push(ev.data);
      }
    };

    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);

        // Prefer Chrome downloads API for better UX
        const filename = `meet-audio-${new Date().toISOString().replace(/[:]/g, "-")}.webm`;
        try {
          await chrome.downloads.download({ url, filename, saveAs: true });
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        console.error("[offscreen] Finalize error:", err);
        chrome.runtime.sendMessage({
          type: "recording-error",
          target: "popup",
          error: err?.message || String(err)
        });
      } finally {
        recorder = undefined;
        chunks = [];
        await stopAllTracks();
        window.location.hash = "";
        chrome.runtime.sendMessage({ type: "recording-stopped", target: "service-worker" });
      }
    };

    // Start recording; optional timeslice emits smaller chunks to keep UI responsive
    recorder.start(1000);
    window.location.hash = "recording";
    chrome.runtime.sendMessage({ type: "update-icon", target: "service-worker", recording: true });
  } catch (error) {
    console.error("[offscreen] Error starting recording:", error);
    chrome.runtime.sendMessage({ type: "recording-error", target: "popup", error: error.message });
  }
}

async function stopRecording() {
  try {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    } else {
      // No active recording, ensure cleanup
      await stopAllTracks();
      window.location.hash = "";
      chrome.runtime.sendMessage({ type: "update-icon", target: "service-worker", recording: false });
    }
  } catch (err) {
    console.error("[offscreen] stopRecording error:", err);
  }
}

async function stopAllTracks() {
  try {
    if (activeStream) {
      activeStream.getTracks().forEach(t => t.stop());
      activeStream = null;
    }
    // Small delay to let tracks settle
    await new Promise(r => setTimeout(r, 80));
  } catch (err) {
    console.warn("[offscreen] stopAllTracks warn:", err);
  }
}
