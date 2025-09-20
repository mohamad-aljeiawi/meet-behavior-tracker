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