import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Proxy /api requests to backend (4000) in dev → no CORS, same-origin.
// Target 127.0.0.1 (NOT localhost): backend binds to loopback IPv4
// (app.listen(PORT,"127.0.0.1")); "localhost" on IPv6-first machines resolves to ::1
// which would cause ECONNREFUSED (Node 17+ verbatim DNS).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    // host:true → expose dev server on the LAN (reach http://<LAN-IP>:5173 from a phone on the same network).
    // allowedHosts:true → allow tunnel hostnames (cloudflared/ngrok) in dev.
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: true },
    },
  },
});
