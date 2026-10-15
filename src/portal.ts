// Web-portal integration. The game only talks to `Portal`; today there is a
// CrazyGames implementation (SDK v3) and a no-op one for every other host
// (GitHub Pages, local dev). Another portal (e.g. Poki) is one more class.
//
// The CrazyGames SDK is only loaded in a CrazyGames build (VITE_PORTAL) or
// with ?portal=crazygames, so other hosts never fetch it.

export type AdResult = "finished" | "skipped"; // skipped = error, cooldown, adblock, no fill

export interface AdHooks {
  /** the ad really started playing: mute and pause */
  started(): void;
}

export interface Portal {
  readonly name: string;
  /** rewarded ads can be offered on this host */
  readonly hasRewarded: boolean;
  /** skip the title screen: the first run starts as soon as loading ends (CrazyGames: "land directly in gameplay") */
  readonly landInGameplay: boolean;
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  /** a big moment (new best score); the portal may celebrate it */
  happytime(): void;
  midgameAd(hooks: AdHooks): Promise<AdResult>;
  rewardedAd(hooks: AdHooks): Promise<AdResult>;
  /** localStorage-like save store; synced to the player's account where supported */
  readonly storage: Pick<Storage, "getItem" | "setItem">;
  /** the host asks for audio off (e.g. CrazyGames' muteAudio setting) */
  onForcedMute(cb: (muted: boolean) => void): void;
}

const localStore: Portal["storage"] = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable: progress just isn't persisted */
    }
  },
};

class NoPortal implements Portal {
  readonly name = "none";
  readonly hasRewarded = false;
  readonly landInGameplay = false;
  readonly storage = localStore;
  loadingStart(): void {}
  loadingStop(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  happytime(): void {}
  midgameAd(): Promise<AdResult> {
    return Promise.resolve("skipped");
  }
  rewardedAd(): Promise<AdResult> {
    return Promise.resolve("skipped");
  }
  onForcedMute(): void {}
}

// ---- CrazyGames SDK v3 (https://docs.crazygames.com/sdk/) ----

interface CrazySdk {
  init(): Promise<void>;
  environment: "local" | "crazygames" | "disabled";
  ad: {
    requestAd(
      type: "midgame" | "rewarded",
      cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void },
    ): void;
  };
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings: { muteAudio: boolean };
    addSettingsChangeListener(cb: (s: { muteAudio: boolean }) => void): void;
  };
  data: Pick<Storage, "getItem" | "setItem">;
}

const SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";

class CrazyPortal implements Portal {
  readonly name = "crazygames";
  readonly hasRewarded = true;
  readonly landInGameplay = true;
  readonly storage: Portal["storage"];
  private playing = false;

  constructor(private readonly sdk: CrazySdk) {
    this.storage = sdk.data;
  }

  // the SDK must never break the game: every call is guarded
  private safe(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      console.warn("CrazyGames SDK call failed", e);
    }
  }

  loadingStart(): void {
    this.safe(() => this.sdk.game.loadingStart());
  }

  loadingStop(): void {
    this.safe(() => this.sdk.game.loadingStop());
  }

  gameplayStart(): void {
    if (this.playing) return;
    this.playing = true;
    this.safe(() => this.sdk.game.gameplayStart());
  }

  gameplayStop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.safe(() => this.sdk.game.gameplayStop());
  }

  happytime(): void {
    this.safe(() => this.sdk.game.happytime());
  }

  private ad(type: "midgame" | "rewarded", hooks: AdHooks): Promise<AdResult> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (r: AdResult) => {
        if (done) return;
        done = true;
        resolve(r);
      };
      try {
        this.sdk.ad.requestAd(type, {
          adStarted: () => hooks.started(),
          adFinished: () => finish("finished"),
          adError: () => finish("skipped"),
        });
      } catch {
        finish("skipped");
      }
    });
  }

  midgameAd(hooks: AdHooks): Promise<AdResult> {
    return this.ad("midgame", hooks);
  }

  rewardedAd(hooks: AdHooks): Promise<AdResult> {
    return this.ad("rewarded", hooks);
  }

  onForcedMute(cb: (muted: boolean) => void): void {
    this.safe(() => {
      cb(this.sdk.game.settings.muteAudio);
      this.sdk.game.addSettingsChangeListener((s) => cb(s.muteAudio));
    });
  }
}

function loadScript(src: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    s.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error("load failed"));
    };
    document.head.appendChild(s);
  });
}

function wantedPortal(): string {
  const fromUrl = new URLSearchParams(location.search).get("portal");
  return fromUrl ?? (import.meta.env.VITE_PORTAL as string | undefined) ?? "none";
}

/** Pick and initialise the portal. Never rejects: falls back to no portal. */
export async function createPortal(): Promise<Portal> {
  if (wantedPortal() !== "crazygames") return new NoPortal();
  try {
    await loadScript(SDK_URL, 8000);
    const sdk = (window as unknown as { CrazyGames?: { SDK: CrazySdk } }).CrazyGames?.SDK;
    if (!sdk) throw new Error("SDK missing");
    await sdk.init();
    if (sdk.environment === "disabled") throw new Error("SDK disabled on this domain");
    return new CrazyPortal(sdk);
  } catch (e) {
    console.warn("CrazyGames SDK unavailable, running without a portal:", e);
    return new NoPortal();
  }
}
