import { assertResultPath } from "../services/path-policy.js";

export interface ControlStateInput {
  healthReady: boolean;
  hasActiveNote: boolean;
  running: boolean;
}

export interface ControlState {
  canSend: boolean;
  canStop: boolean;
  canSaveResult: boolean;
}

export function deriveControls(input: ControlStateInput): ControlState {
  const ready = input.healthReady && input.hasActiveNote;
  return {
    canSend: ready && !input.running,
    canStop: input.running,
    canSaveResult: ready && !input.running
  };
}

export function filterResultCandidates(paths: string[]): string[] {
  return paths.filter((path) => {
    try {
      assertResultPath(path);
      return true;
    } catch {
      return false;
    }
  });
}
