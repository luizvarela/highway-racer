import { defineConfig } from "vite";

export default defineConfig({
  // stamped into asset URLs so phones fetch fresh models and images after each deploy
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
});
