import { Engine } from './engine/Engine';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('No se encontro el contenedor #app.');
}

const engine = new Engine(app);

engine.init().then(() => {
  engine.start();
});
