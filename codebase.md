# .gitignore

```
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

```

# manifest.json

```json
{
  "manifest_version": 3,
  "name": "Meet Speaker Insights",
  "version": "0.1.0",
  "description": "Side panel for Google Meet speaker insights (Lit + Tailwind v4)",
  "icons": {
    "16": "public/icon-16.png",
    "32": "public/icon-32.png",
    "128": "public/icon-128.png"
  },
  "action": {
    "default_title": "Open Meet Speaker Insights"
  },
  "permissions": [
    "sidePanel",
    "storage",
    "downloads",
    "offscreen",
    "tabCapture"
  ],
  "host_permissions": ["https://meet.google.com/*"],
  "background": {
    "service_worker": "src/background.ts",
    "type": "module"
  },
  "side_panel": {
    "default_path": "src/sidepanel/app.html"
  },
  "content_scripts": [
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["src/content/meet.ts"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["src/sidepanel/offscreen.html"],
      "matches": ["<all_urls>"]
    }
  ]
}

```

# package.json

```json
{
  "name": "meet-behavior-tracker",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.2.0",
    "@tailwindcss/vite": "^4.1.13",
    "typescript": "~5.8.3",
    "vite": "^7.1.6",
    "@types/chrome": "^0.1.12"
  },
  "dependencies": {
    "@tailwindcss/postcss": "^4.1.13",
    "lit": "^3.3.1",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.13"
  }
}

```

# postcss.config.mjs

```mjs
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

```

# public\icon-16.png

This is a binary file of the type: Image

# public\icon-32.png

This is a binary file of the type: Image

# public\icon-128.png

This is a binary file of the type: Image

# src\background.ts

```ts
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

```

# src\content\meet.ts

```ts
console.log("[Meet Speaker Insights] content script running");

```

# src\sidepanel\app.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Meet Speaker Insights</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body class="h-screen w-full bg-white text-gray-900 dark:bg-zinc-900 dark:text-zinc-50">
    <app-root></app-root>
    <script type="module" src="/src/sidepanel/app.ts"></script>
  </body>
</html>

```

# src\sidepanel\app.ts

```ts
import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import tailwindStyles from "../style.css?inline";

const sheet = new CSSStyleSheet();
sheet.replaceSync(tailwindStyles);

const ui_panel_port = chrome.runtime.connect({ name: "UI_PANEL" });
@customElement("app-root")
export class AppRoot extends LitElement {
  @state()
  recording = false;

  static styles = [sheet, css``];

  connectedCallback() {
    super.connectedCallback();
    ui_panel_port.onMessage.addListener((msg) => {
      console.log("📨 Msg from UI_PANEL:", msg);
    });

    ui_panel_port.postMessage({ type: "PONG", from: "Init Panel Ready" });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    ui_panel_port.onMessage.removeListener((msg) => {
      console.log("📨 Msg from UI_PANEL:", msg);
    });
  }

  render() {
    return html`
      <div class="p-4 flex flex-col h-full">
        <header class="pb-4 border-b border-zinc-700">
          <h1 class="text-xl font-bold">Meet Speaker Insights</h1>
          <span
            class="text-sm ${this.recording ? "text-red-500" : "text-gray-400"}"
          >
            ${this.recording ? "● Recording" : "Idle"}
          </span>
        </header>

        <main class="flex-grow flex flex-col justify-center items-center gap-4">
          <p>Panel Ready (Lit + Tailwind v4)</p>
          <div class="flex gap-3">
            <button
              @click=${() => (this.recording = true)}
              class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            >
              Start
            </button>
            <button
              @click=${() => (this.recording = false)}
              class="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded"
            >
              Stop
            </button>
          </div>
        </main>

        <footer
          class="text-center text-xs text-gray-500 pt-4 border-t border-zinc-700"
        >
          v0.1 — init step
        </footer>
      </div>
    `;
  }
}

```

# src\sidepanel\offscreen.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Offscreen Recorder</title>
  </head>
  <body>
    <script type="module" src="/src/sidepanel/offscreen.ts"></script>
  </body>
</html>

```

# src\sidepanel\offscreen.ts

```ts
const port = chrome.runtime.connect({ name: "OFFSCREEN" });

port.postMessage({ type: "PONG", from: "Init Offscreen Ready" });
```

# src\style.css

```css
@import "tailwindcss";
```

# src\types.ts

```ts

```

# src\vite-env.d.ts

```ts
/// <reference types="vite/client" />

```

# tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src"]
}

```

# vite.config.ts

```ts
import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [
    crx({ manifest }), 
    tailwindcss() // التكامل صحيح تمامًا
  ], 
  build: {
    target: "es2020",
    sourcemap: true, // ممتاز لتصحيح الأخطاء
  },
});
```

