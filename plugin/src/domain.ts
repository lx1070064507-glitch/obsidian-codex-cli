export type ChatRole = "user" | "assistant" | "system";

export interface ChatEntry {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  relatedNote: string;
  transcriptPath: string;
  codexThreadId: string | null;
  entries: ChatEntry[];
  status: "active" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface ResultNote {
  path: string;
  title: string;
  sourceChat: string;
  relatedNote: string;
  createdAt: string;
  content: string;
}

export interface SaveResultOutcome {
  result: ResultNote;
  linkError: string | null;
}

export interface ApprovalPrompt {
  requestId: string | number;
  kind: "command" | "fileChange";
  title: string;
  detail: string;
  reason: string | null;
}

export interface HealthStatus {
  windows: boolean;
  codexPath: string | null;
  codexVersion: string | null;
  codexCompatible: boolean;
  loggedIn: boolean;
  gitPath: string | null;
  repositoryRoot: string | null;
  readyToChat: boolean;
  readyToCommit: boolean;
  errors: string[];
}
