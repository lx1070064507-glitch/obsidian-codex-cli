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

export interface ComposerShortcutEvent {
  ctrlKey: boolean;
  key: string;
  code: string;
  isComposing: boolean;
  target: EventTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
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

export function handleComposerShortcut(
  event: ComposerShortcutEvent,
  composer: EventTarget,
  send: () => void
): boolean {
  const isEnter = event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter";
  if (!event.ctrlKey || event.isComposing || !isEnter || event.target !== composer) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  send();
  return true;
}
