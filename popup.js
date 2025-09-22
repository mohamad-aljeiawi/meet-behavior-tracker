const startButton = document.getElementById("startRecord");
const stopButton  = document.getElementById("stopRecord");
const includeMicEl = document.getElementById("includeMic");

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

document.addEventListener('DOMContentLoaded', showByState);

startButton.addEventListener('click', async () => {
  try {
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
    const includeMic = !!includeMicEl?.checked;

    await chrome.runtime.sendMessage({
      type: 'start-recording',
      target: 'offscreen',
      data: { streamId, includeMic }
    });

    startButton.classList.remove('visible');
    setTimeout(() => { startButton.style.display = 'none'; stopButton.style.display = 'block'; setTimeout(() => stopButton.classList.add('visible'), 10); }, 250);
  } catch (err) {
    console.error('[popup] start error:', err);
    alert('Failed to start: ' + (err?.message || String(err)));
  }
});

stopButton.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' });
    stopButton.classList.remove('visible');
    setTimeout(() => { stopButton.style.display = 'none'; startButton.style.display = 'block'; setTimeout(() => startButton.classList.add('visible'), 10); }, 250);
  } catch (err) {
    console.error('[popup] stop error:', err);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'popup') return;
  if (message.type === 'recording-error' || message.type === 'recording-stopped') {
    showByState();
  }
});
