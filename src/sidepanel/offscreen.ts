const port = chrome.runtime.connect({ name: "OFFSCREEN" });

port.postMessage({ type: "PONG", from: "Init Offscreen Ready" });