chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.error("sidePanel error", err);
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureOffscreen();
});

async function ensureOffscreen() {
  const hasDoc = await chrome.offscreen.hasDocument();
  if (!hasDoc) {
    await chrome.offscreen.createDocument({
      url: "src/sidepanel/offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Needed to prepare audio recording",
    });
  }
}
ensureOffscreen();

chrome.runtime.onConnect.addListener((port) => {
  console.log("🔌 Connected to:", port.name);
});
