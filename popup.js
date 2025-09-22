const startButton = document.getElementById("startRecord");
const stopButton  = document.getElementById("stopRecord");

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

    // Ensure offscreen is created
    const contexts = await chrome.runtime.getContexts({});
    const offscreenDoc = contexts.find(c => c.contextType === 'OFFSCREEN_DOCUMENT');
    if (!offscreenDoc) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Capture tab audio via tabCapture for Meet insights.'
      });
    }

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await chrome.runtime.sendMessage({ type: 'start-recording', target: 'offscreen', data: streamId });

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
  switch (message.type) {
    case 'recording-error':
      alert(message.error);
      showByState();
      break;
    case 'recording-stopped':
      showByState();
      break;
  }
});
