// Browser-only display preferences; nothing here reaches the backend.
const REDUCE_MOTION_KEY = "speaknusa.reduceMotion";

/** Runs in <head> before paint so the class is set without a flash. */
export const REDUCE_MOTION_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(REDUCE_MOTION_KEY)})==="1")document.documentElement.classList.add("reduce-motion")}catch(e){}`;

export function readReduceMotion(): boolean {
  try {
    return localStorage.getItem(REDUCE_MOTION_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeReduceMotion(on: boolean) {
  try {
    localStorage.setItem(REDUCE_MOTION_KEY, on ? "1" : "0");
  } catch {
    // storage blocked: still apply for this page view
  }
  document.documentElement.classList.toggle("reduce-motion", on);
}
