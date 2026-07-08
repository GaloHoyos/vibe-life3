import "./vitest.node.setup";
import { afterEach } from "vitest";

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});
