import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `DEMO_URL=https://xxxx.cloudfront.net npm run dev` proxies every non-app path
// to the real deployment, so the UI can be iterated on locally.
const target = process.env.DEMO_URL || "http://localhost:8080";
const proxied = ["/api", "/video", "/ebs", "/efs", "/nvme"];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(proxied.map((p) => [p, { target, changeOrigin: true, secure: false }])),
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          hls: ["hls.js"],
          charts: ["recharts"],
        },
      },
    },
  },
});
