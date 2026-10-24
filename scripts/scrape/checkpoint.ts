/** Progress of one collection step, saved after every item so a run can resume. */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export interface Checkpoint {
  done: string[];
  rows: Record<string, string>[];
}

export function loadCheckpoint(path: string): Checkpoint {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { done: [], rows: [] };
}

/** Written aside, then renamed over the checkpoint, so stopping mid-write loses nothing. */
export function saveCheckpoint(path: string, checkpoint: Checkpoint): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(checkpoint));
  renameSync(`${path}.tmp`, path);
}
