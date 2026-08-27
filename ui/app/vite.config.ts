import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Konfigurasi Vite yang ramah Tauri.
export default defineConfig({
  plugins: [react()],
  // Tauri mengharapkan port tetap.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: "localhost",
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
