export type RequestId = string | number;

export interface RpcRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}

export interface RpcNotification {
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  id: RequestId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface InitializeParams {
  clientInfo: { name: string; title: string; version: string };
  capabilities: { experimentalApi: boolean; requestAttestation: boolean };
}

export interface InitializeResult {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export interface ThreadResult {
  thread: { id: string };
}

export interface TurnResult {
  turn: { id: string };
}

export interface AgentMessageDelta {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface TurnCompleted {
  threadId: string;
  turn: {
    id: string;
    status: "completed" | "interrupted" | "failed" | "inProgress";
    error: { message?: string } | null;
  };
}

export interface CommandApprovalRequest {
  command?: string;
  cwd?: string;
  reason?: string | null;
}

export type PatchChangeKind =
  | { type: "add" }
  | { type: "delete" }
  | { type: "update"; move_path: string | null };

export interface FileUpdateChange {
  path: string;
  kind: PatchChangeKind;
  diff: string;
}

export interface FileChangePatchUpdated {
  threadId: string;
  turnId: string;
  itemId: string;
  changes: FileUpdateChange[];
}

export interface FileChangeApprovalRequest {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  reason?: string | null;
  grantRoot?: string | null;
}

export type ApprovalDecision = "accept" | "decline" | "cancel";
