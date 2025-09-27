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
