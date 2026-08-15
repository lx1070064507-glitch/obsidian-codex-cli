import type { ResultNote } from "../domain.js";
import type { VaultFiles } from "../platform/vault-files.js";
import { assertResultPath, sanitizeFileStem } from "./path-policy.js";

const RESULT_DIRECTORY = "Codex Results";

type Clock = () => string;
type CreateResultInput = Omit<ResultNote, "path" | "createdAt">;

export class ResultStore {
  constructor(
    private readonly vault: VaultFiles,
    private readonly now: Clock = () => new Date().toISOString()
  ) {}

  async create(input: CreateResultInput): Promise<ResultNote> {
    await this.vault.mkdir(RESULT_DIRECTORY);
    const createdAt = this.now();
    const path = await this.uniquePath(createdAt.slice(0, 10), input.title);
    const result: ResultNote = { path, createdAt, ...input };
    await this.vault.write(path, serializeResult(result));
    await this.appendLink(result);
    return result;
  }

  async list(): Promise<string[]> {
    return this.vault.listMarkdown(RESULT_DIRECTORY);
  }

  async read(path: string): Promise<ResultNote> {
    const normalized = assertResultPath(path);
    return parseResult(normalized, await this.vault.read(normalized));
  }

  private async uniquePath(date: string, title: string): Promise<string> {
    const stem = sanitizeFileStem(title) || "成果";
    let suffix = 1;
    let path = `${RESULT_DIRECTORY}/${date}-${stem}.md`;
    while (await this.vault.exists(path)) {
      suffix += 1;
      path = `${RESULT_DIRECTORY}/${date}-${stem}-${suffix}.md`;
    }
    return path;
  }

  private async appendLink(result: ResultNote): Promise<void> {
    const note = await this.vault.read(result.relatedNote);
    const target = result.path.slice(0, -3);
    const link = `[[${target}|${result.title}]]`;
    if (!note.includes(link)) {
      await this.vault.write(result.relatedNote, `${note.replace(/\s*$/, "")}\n\n${link}\n`);
    }
  }
}

function serializeResult(result: ResultNote): string {
  return [
    "---",
    `title: ${JSON.stringify(result.title)}`,
    `source_chat: ${JSON.stringify(result.sourceChat)}`,
    `related_note: ${JSON.stringify(result.relatedNote)}`,
    `created_at: ${JSON.stringify(result.createdAt)}`,
    "---",
    "",
    result.content,
    ""
  ].join("\n");
}

function parseResult(path: string, markdown: string): ResultNote {
  const end = markdown.indexOf("\n---", 4);
  if (!markdown.startsWith("---\n") || end < 0) {
    throw new Error("成果文件缺少有效元数据");
  }
  const metadata = new Map<string, unknown>();
  for (const line of markdown.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      metadata.set(line.slice(0, separator), JSON.parse(line.slice(separator + 1).trim()));
    }
  }
  const contentStart = end + 5;
  const content = markdown.slice(contentStart).replace(/^\n/, "").replace(/\n$/, "");
  return {
    path,
    title: readString(metadata, "title"),
    sourceChat: readString(metadata, "source_chat"),
    relatedNote: readString(metadata, "related_note"),
    createdAt: readString(metadata, "created_at"),
    content
  };
}

function readString(values: Map<string, unknown>, key: string): string {
  const value = values.get(key);
  if (typeof value !== "string") {
    throw new Error(`成果元数据无效: ${key}`);
  }
  return value;
}
