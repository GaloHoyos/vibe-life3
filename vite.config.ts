import { defineConfig } from "vite";

const srcUrl = new URL("./src/", import.meta.url);

const aliasFor = (segment: string): string => {
  const decoded = decodeURIComponent(new URL(segment, srcUrl).pathname);
  // On Windows, URL.pathname yields "/C:/foo/bar" — strip the leading slash.
  return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
};

export default defineConfig({
  resolve: {
    alias: {
      "@engine": aliasFor("engine"),
      "@game": aliasFor("game"),
      "@shared": aliasFor("shared"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
