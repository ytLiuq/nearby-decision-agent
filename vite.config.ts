import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createNearbyApiPlugin } from "./server/viteApiPlugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), ...createNearbyApiPlugin(env)],
  };
});