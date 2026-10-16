import { DefaultLoadingManager } from "three";
import { Game } from "./game";

// Models and images keep their file names between deploys; a build stamp makes
// browsers fetch the new ones instead of serving a cached copy.
const build = typeof __BUILD__ === "string" ? __BUILD__ : "";
if (build) {
  DefaultLoadingManager.setURLModifier((url) =>
    /^(data|blob):/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}v=${build}`,
  );
}
import { createPortal } from "./portal";

const startButton = document.getElementById("btn-start") as HTMLButtonElement;
startButton.disabled = true;
startButton.textContent = "LOADING…";

createPortal()
  .then(async (portal) => {
    portal.loadingStart();
    const game = await Game.create(document.getElementById("app")!, portal);
    portal.loadingStop();
    game.begin(); // after loadingStop: the portal may start gameplay right away
  })
  .then(() => {
    startButton.disabled = false;
    startButton.textContent = "PRESS SPACE OR TAP TO DRIVE";
  })
  .catch((err: unknown) => {
    console.error(err);
    startButton.textContent = "FAILED TO LOAD — RELOAD THE PAGE";
  });
