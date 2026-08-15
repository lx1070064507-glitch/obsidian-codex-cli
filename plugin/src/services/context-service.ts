import { createHash } from "node:crypto";

export class ContextService {
  private lastHash: string | null = null;

  compose(notePath: string, noteContent: string, userText: string): string {
    const hash = createHash("sha256")
      .update(`${notePath}\0${noteContent}`)
      .digest("hex");
    if (hash === this.lastHash) {
      return userText;
    }
    this.lastHash = hash;
    return [
      `<<<OBSIDIAN_NOTE path=${JSON.stringify(notePath)}>>>`,
      noteContent,
      "<<<END_OBSIDIAN_NOTE>>>",
      "",
      userText
    ].join("\n");
  }

  reset(): void {
    this.lastHash = null;
  }
}
