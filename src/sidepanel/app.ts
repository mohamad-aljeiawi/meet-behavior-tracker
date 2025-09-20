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
