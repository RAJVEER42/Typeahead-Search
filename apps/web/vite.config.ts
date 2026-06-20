import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server on 5173. The API base is read from VITE_API_BASE (defaults to
// http://localhost:8080 in src/lib/api.ts), so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
