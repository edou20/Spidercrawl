import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendUrl = process.env.VITE_BACKEND_URL || "http://127.0.0.1:3200";
const devHost = process.env.VITE_HOST || "0.0.0.0";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "spidercrawl-app-slash-redirect",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url === "/app") {
            response.statusCode = 302;
            response.setHeader("Location", "/app/");
            response.end();
            return;
          }
          next();
        });
      },
    },
  ],
  base: "/app/",
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    host: devHost,
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
    proxy: {
      "/v1": backendUrl,
      "/health": backendUrl,
    },
  },
});
