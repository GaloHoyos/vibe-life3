import { Engine } from "@engine/core/Engine";
import { Game } from "@game/Game";
import "./style.css";
import "./game/ui/menu/MenuStyles.css";
import "./game/editor/ui/EditorStyles.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("No se encontro el contenedor #app.");
}

const engine = new Engine(app);
// Optional direct boot is deliberately URL-driven so browser smoke tests can
// exercise a level without relying on menu timing or persisted state.
const bootIntoLevel = new URLSearchParams(window.location.search).get("level") ?? undefined;
const game = new Game(engine, { bootIntoLevel });

game.init().then(() => {
  game.start();
});
