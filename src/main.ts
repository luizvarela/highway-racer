import { Game } from "./game";

const startButton = document.getElementById("btn-start") as HTMLButtonElement;
startButton.disabled = true;
startButton.textContent = "LOADING…";

Game.create(document.getElementById("app")!)
  .then(() => {
    startButton.disabled = false;
    startButton.textContent = "PRESS SPACE OR TAP TO DRIVE";
  })
  .catch((err: unknown) => {
    console.error(err);
    startButton.textContent = "FAILED TO LOAD — RELOAD THE PAGE";
  });
