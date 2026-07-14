import { defineConfig } from "vite";

const srcUrl = new URL("./src/", import.meta.url);
const rootUrl = new URL("./", import.meta.url);

const pathFor = (segment: string, base: URL): string => {
  const decoded = decodeURIComponent(new URL(segment, base).pathname);
  return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
};

const aliasFor = (segment: string): string => pathFor(segment, srcUrl);
const aliasFromRoot = (segment: string): string => pathFor(segment, rootUrl);

export default defineConfig({
  optimizeDeps: {
    exclude: ["recast-navigation"],
  },
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "@engine": aliasFor("engine"),
      "@game": aliasFor("game"),
      "@shared": aliasFor("shared"),
      "@tests": aliasFromRoot("tests"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
