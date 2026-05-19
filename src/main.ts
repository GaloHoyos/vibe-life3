import { Engine } from "@engine/core/Engine";
import { Game } from "@game/Game";
import "./style.css";
import "./game/ui/menu/MenuStyles.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("No se encontro el contenedor #app.");
}

const engine = new Engine(app);
const game = new Game(engine);

game.init().then(() => {
  game.start();
});
