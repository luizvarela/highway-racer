import type { RunStats } from "./hud";

// Missions: three at a time, drawn from templates. "Total" missions add up
// across runs; "single" missions must be done within one run. Completing one
// pays cash and a fresh mission takes its slot. Also the daily bonus.

export type Stat = "nearMisses" | "takedowns" | "roadblocks" | "escapes" | "distanceKm" | "maxLevel" | "score" | "bestMultiplier" | "copsLost";

export interface MissionTemplate {
  id: string;
  stat: Stat;
  mode: "total" | "single"; // add up across runs, or reach it in one run
  targets: number[]; // one per tier; the tier rises as the player completes missions
  rewards: number[]; // cash per tier
  text: (target: number) => string;
}

const km = (n: number) => `${n} km`;

export const TEMPLATES: MissionTemplate[] = [
  { id: "nm-total", stat: "nearMisses", mode: "total", targets: [10, 25, 60], rewards: [250, 500, 900], text: (t) => `Get ${t} near misses` },
  { id: "nm-run", stat: "nearMisses", mode: "single", targets: [4, 8, 14], rewards: [400, 700, 1000], text: (t) => `${t} near misses in one run` },
  { id: "td-total", stat: "takedowns", mode: "total", targets: [3, 8, 20], rewards: [300, 600, 1000], text: (t) => `Take down ${t} cops` },
  { id: "td-run", stat: "takedowns", mode: "single", targets: [2, 3, 5], rewards: [400, 700, 1000], text: (t) => `${t} takedowns in one run` },
  { id: "rb-total", stat: "roadblocks", mode: "total", targets: [2, 5, 12], rewards: [400, 700, 1000], text: (t) => `Run ${t} roadblocks` },
  { id: "esc-total", stat: "escapes", mode: "total", targets: [2, 5, 10], rewards: [350, 650, 1000], text: (t) => `Escape the police ${t} times` },
  { id: "lost-total", stat: "copsLost", mode: "total", targets: [5, 12, 30], rewards: [250, 500, 900], text: (t) => `Lose ${t} cops` },
  { id: "km-total", stat: "distanceKm", mode: "total", targets: [10, 30, 80], rewards: [300, 600, 1000], text: (t) => `Drive ${km(t)} in total` },
  { id: "km-run", stat: "distanceKm", mode: "single", targets: [2, 4, 7], rewards: [350, 650, 1000], text: (t) => `Drive ${km(t)} in one run` },
  { id: "stars", stat: "maxLevel", mode: "single", targets: [3, 4, 5], rewards: [300, 600, 1000], text: (t) => `Reach ${"★".repeat(t)} wanted` },
  { id: "score-run", stat: "score", mode: "single", targets: [1500, 4000, 10000], rewards: [350, 650, 1000], text: (t) => `Score ${t.toLocaleString("en-US")} in one run` },
  { id: "mult", stat: "bestMultiplier", mode: "single", targets: [2, 3, 4], rewards: [300, 600, 1000], text: (t) => `Reach a x${t} multiplier` },
];

export interface Mission {
  id: string; // template id
  tier: number; // index into targets/rewards
  progress: number; // total missions: carried across runs; single: best of the current run
}

export interface MissionView {
  text: string;
  progress: number;
  target: number;
  reward: number;
  done: boolean;
  single: boolean;
}

export interface MissionResult {
  completed: MissionView[];
  cash: number;
}

export const MISSION_SLOTS = 3;

const template = (m: Mission): MissionTemplate => TEMPLATES.find((t) => t.id === m.id) ?? TEMPLATES[0];
const tierOf = (t: MissionTemplate, tier: number) => Math.min(t.targets.length - 1, Math.max(0, tier));

export function viewMission(m: Mission): MissionView {
  const t = template(m);
  const tier = tierOf(t, m.tier);
  return {
    text: t.text(t.targets[tier]),
    progress: Math.min(m.progress, t.targets[tier]),
    target: t.targets[tier],
    reward: t.rewards[tier],
    done: m.progress >= t.targets[tier],
    single: t.mode === "single",
  };
}

/** A fresh mission from a template not already in `active`; the tier comes from how many were completed. */
export function drawMission(active: Mission[], completedCount: number, random = Math.random): Mission {
  const used = new Set(active.map((m) => m.id));
  const pool = TEMPLATES.filter((t) => !used.has(t.id));
  const t = pool[Math.floor(random() * pool.length)] ?? TEMPLATES[0];
  const tier = tierOf(t, Math.floor(completedCount / 4)); // every 4 completions moves everyone up a tier
  return { id: t.id, tier, progress: 0 };
}

export function initialMissions(random = Math.random): Mission[] {
  const out: Mission[] = [];
  // the first three are deliberately easy and varied: a quick first win matters
  for (const id of ["nm-total", "km-run", "stars"]) out.push({ id, tier: 0, progress: 0 });
  while (out.length < MISSION_SLOTS) out.push(drawMission(out, 0, random));
  return out;
}

/** Top a saved list up to MISSION_SLOTS (older saves, or a template that was removed). */
export function fillMissions(missions: Mission[], completedCount: number, random = Math.random): void {
  while (missions.length < MISSION_SLOTS) missions.push(drawMission(missions, completedCount, random));
}

/** Fold a finished run into the missions. Completed ones are replaced; returns them and the cash. */
export function applyRun(missions: Mission[], stats: RunStats, completedCount: number, random = Math.random): MissionResult {
  const result: MissionResult = { completed: [], cash: 0 };
  for (let i = 0; i < missions.length; i++) {
    const m = missions[i];
    const t = template(m);
    const value = stats[t.stat];
    m.progress = t.mode === "total" ? m.progress + value : Math.max(m.progress, value);
    const view = viewMission(m);
    if (!view.done) continue;
    result.completed.push(view);
    result.cash += view.reward;
    completedCount++;
    missions[i] = drawMission(missions.filter((_, j) => j !== i), completedCount, random);
  }
  // single-run progress never carries over
  for (const m of missions) if (template(m).mode === "single") m.progress = 0;
  return result;
}

/** Live progress during a run, for the HUD: single-run missions show this run's value. */
export function liveViews(missions: Mission[], stats: RunStats): MissionView[] {
  return missions.map((m) => {
    const t = template(m);
    const value = stats[t.stat];
    return viewMission({ ...m, progress: t.mode === "total" ? m.progress + value : value });
  });
}

// ---- daily bonus ----

export const DAILY_REWARDS = [200, 400, 600, 800, 1000];

/** Tests can pin the calendar day. */
export let dateOverride = "";
export const setDateOverride = (d: string): void => {
  dateOverride = d;
};

/** Local calendar day as YYYY-MM-DD, so a day ends at the player's midnight. */
export function today(now = new Date()): string {
  if (dateOverride) return dateOverride;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export interface Daily {
  lastClaim: string; // YYYY-MM-DD, "" = never
  streak: number; // consecutive days claimed, 1..
}

/** Reward on offer today, or null when already claimed. */
export function dailyOffer(d: Daily, date = today()): { day: number; cash: number } | null {
  if (d.lastClaim === date) return null;
  const consecutive = d.lastClaim !== "" && daysBetween(d.lastClaim, date) === 1;
  const day = consecutive ? d.streak + 1 : 1;
  return { day, cash: DAILY_REWARDS[Math.min(day, DAILY_REWARDS.length) - 1] };
}

export function claimDaily(d: Daily, date = today()): number {
  const offer = dailyOffer(d, date);
  if (!offer) return 0;
  d.lastClaim = date;
  d.streak = offer.day;
  return offer.cash;
}
