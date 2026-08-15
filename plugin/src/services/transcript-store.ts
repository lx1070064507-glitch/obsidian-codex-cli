import { randomUUID } from "node:crypto";

import type { ChatEntry, ChatRole, ChatSession } from "../domain.js";
import type { VaultFiles } from "../platform/vault-files.js";
import { sanitizeFileStem } from "./path-policy.js";

const TRANSCRIPT_DIRECTORY = "Codex Chats";
const ROLE_LABELS: Record<ChatRole, string> = {
  user: "用户",
  assistant: "Codex",
  system: "系统"
};

type Clock = () => string;

export class TranscriptStore {
  constructor(
    private readonly vault: VaultFiles,
    private readonly now: Clock = () => new Date().toISOString()
  ) {}

  async create(title: string, relatedNote: string): Promise<ChatSession> {
    await this.vault.mkdir(TRANSCRIPT_DIRECTORY);
    const createdAt = this.now();
    const transcriptPath = await this.uniquePath(createdAt.slice(0, 10), title);
    const session: ChatSession = {
      id: randomUUID(),
      title,
      relatedNote,
      transcriptPath,
      codexThreadId: null,
      entries: [],
      status: "active",
      createdAt,
      updatedAt: createdAt
    };
    await this.save(session);
    return session;
  }

  async save(session: ChatSession): Promise<void> {
    session.updatedAt = this.now();
    await this.vault.write(session.transcriptPath, serializeSession(session));
  }

  async load(path: string): Promise<ChatSession> {
    return parseSession(path, await this.vault.read(path));
  }

  async list(): Promise<string[]> {
    return this.vault.listMarkdown(TRANSCRIPT_DIRECTORY);
  }

  private async uniquePath(date: string, title: string): Promise<string> {
    const stem = sanitizeFileStem(title) || "对话";
    let suffix = 1;
    let path = `${TRANSCRIPT_DIRECTORY}/${date}-${stem}.md`;
    while (await this.vault.exists(path)) {
      suffix += 1;
      path = `${TRANSCRIPT_DIRECTORY}/${date}-${stem}-${suffix}.md`;
    }
    return path;
  }
}

function serializeSession(session: ChatSession): string {
  const frontmatter = [
    "---",
    `id: ${JSON.stringify(session.id)}`,
    `title: ${JSON.stringify(session.title)}`,
    `codex_thread_id: ${JSON.stringify(session.codexThreadId)}`,
    `related_note: ${JSON.stringify(session.relatedNote)}`,
    `created_at: ${JSON.stringify(session.createdAt)}`,
    `updated_at: ${JSON.stringify(session.updatedAt)}`,
    `status: ${JSON.stringify(session.status)}`,
    "---",
    "",
    `# ${session.title}`
  ];
  const entries = session.entries.map((entry) => {
    const metadata = Buffer.from(
      JSON.stringify({ id: entry.id, role: entry.role, createdAt: entry.createdAt })
    ).toString("base64");
    return `<!-- codex-entry ${metadata} -->\n## ${ROLE_LABELS[entry.role]}\n\n${entry.content}\n<!-- /codex-entry -->`;
  });
  return [...frontmatter, ...entries, ""].join("\n");
}

function parseSession(path: string, markdown: string): ChatSession {
  const metadata = parseFrontmatter(markdown);
  const entries: ChatEntry[] = [];
  const pattern = /<!-- codex-entry ([A-Za-z0-9+/=]+) -->\n## [^\n]+\n\n([\s\S]*?)\n<!-- \/codex-entry -->/g;
  for (const match of markdown.matchAll(pattern)) {
    const encoded = match[1];
    const content = match[2];
    if (encoded === undefined || content === undefined) {
      continue;
    }
    const entryMetadata = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8")
    ) as Pick<ChatEntry, "id" | "role" | "createdAt">;
    entries.push({ ...entryMetadata, content });
  }
  return {
    id: requiredString(metadata, "id"),
    title: requiredString(metadata, "title"),
    relatedNote: requiredString(metadata, "related_note"),
    transcriptPath: path,
    codexThreadId: nullableString(metadata, "codex_thread_id"),
    entries,
    status: requiredString(metadata, "status") as ChatSession["status"],
    createdAt: requiredString(metadata, "created_at"),
    updatedAt: requiredString(metadata, "updated_at")
  };
}

function parseFrontmatter(markdown: string): Map<string, unknown> {
  const end = markdown.indexOf("\n---", 4);
  if (!markdown.startsWith("---\n") || end < 0) {
    throw new Error("会话文件缺少有效元数据");
  }
  const values = new Map<string, unknown>();
  for (const line of markdown.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      values.set(line.slice(0, separator), JSON.parse(line.slice(separator + 1).trim()));
    }
  }
  return values;
}

function requiredString(values: Map<string, unknown>, key: string): string {
  const value = values.get(key);
  if (typeof value !== "string") {
    throw new Error(`会话元数据无效: ${key}`);
  }
  return value;
}

function nullableString(values: Map<string, unknown>, key: string): string | null {
  const value = values.get(key);
  if (value !== null && typeof value !== "string") {
    throw new Error(`会话元数据无效: ${key}`);
  }
  return value;
}
