import { Game } from "./game";
import { createPortal } from "./portal";

const startButton = document.getElementById("btn-start") as HTMLButtonElement;
startButton.disabled = true;
startButton.textContent = "LOADING…";

createPortal()
  .then(async (portal) => {
    portal.loadingStart();
    await Game.create(document.getElementById("app")!, portal);
    portal.loadingStop();
  })
  .then(() => {
    startButton.disabled = false;
    startButton.textContent = "PRESS SPACE OR TAP TO DRIVE";
  })
  .catch((err: unknown) => {
    console.error(err);
    startButton.textContent = "FAILED TO LOAD — RELOAD THE PAGE";
  });
