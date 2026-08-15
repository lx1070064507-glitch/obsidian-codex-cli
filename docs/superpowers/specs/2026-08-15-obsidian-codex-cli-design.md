# Obsidian Codex CLI Integration Design

Date: 2026-08-15
Target: `D:\My_DateBase\Obsidian_CodexCli`
Status: Approved for implementation planning

## 1. Objective

Build a Windows-only Obsidian desktop plugin that connects an Obsidian Vault to the locally installed Codex CLI. The plugin provides a native chat sidebar, preserves each complete conversation as a Markdown note, lets the user save selected Codex responses into the active note as conclusions, and commits only notes touched by the current chat.

The design treats Markdown files as durable project memory, Codex sessions as execution context, and Git as the audit and synchronization layer. It does not depend on local CLI chats appearing in ChatGPT history.

## 2. Confirmed Scope

The first release will:

- Support Windows desktop Obsidian only.
- Require `codex.cmd`, Codex CLI `0.147.0`, and Git.
- Use the experimental Codex `app-server` protocol over a local child process.
- Provide a native Obsidian right-sidebar chat view.
- Associate each chat with the active Markdown note.
- Save the full conversation under `Codex Chats/`.
- Save a selected Codex response into the associated note only after explicit user confirmation.
- Run Codex with the Vault as its workspace and allow writes only inside that workspace by default.
- Show approval requests for external commands, network access, or paths outside the Vault.
- Offer only one-time approval and denial in the first release.
- Preview and create Git commits only after explicit confirmation.
- Stage only the chat note and associated note changed by the current chat.

The first release will not support mobile Obsidian, macOS, Linux, multiple Vaults, semantic retrieval, permanent approval rules, automatic ChatGPT chat synchronization, or silent fallback to unrestricted CLI execution.

## 3. Repository Layout

```text
D:\My_DateBase\Obsidian_CodexCli\
|-- .git\
|-- .gitignore
|-- .obsidian\
|   `-- plugins\
|       `-- obsidian-codex-cli\
|           |-- manifest.json
|           |-- main.js
|           `-- styles.css
|-- Codex Chats\
|-- plugin\
|   |-- src\
|   |   |-- main.ts
|   |   |-- chat-view.ts
|   |   |-- codex-client.ts
|   |   |-- transcript-store.ts
|   |   |-- context-service.ts
|   |   |-- git-service.ts
|   |   |-- health-check.ts
|   |   `-- settings.ts
|   |-- tests\
|   |-- package.json
|   |-- tsconfig.json
|   `-- esbuild.config.mjs
|-- docs\
|   `-- superpowers\
|       `-- specs\
`-- AGENTS.md
```

Plugin source remains under `plugin/`. The build writes the three Obsidian runtime artifacts to `.obsidian/plugins/obsidian-codex-cli/`. Dependencies, Obsidian workspace layout, and local plugin settings are excluded from Git.

## 4. Components

### 4.1 Chat View

The right-sidebar view owns presentation and user interaction. It displays health status, messages, streaming output, stop state, approval requests, reconnect actions, save-conclusion actions, commit preview, and final commit results. It uses Obsidian theme variables and desktop-native controls rather than a separate visual design system.

Only one Codex turn may run in a chat at a time. Closing the view does not delete the transcript or session metadata.

### 4.2 Codex Client

The Codex client starts `codex.cmd app-server` as a local child process and communicates through the structured stdio protocol. It owns process lifetime, protocol framing, thread creation and resume, streamed events, cancellation, approval responses, and protocol errors.

All experimental protocol details stay behind this adapter. The plugin refuses to start a chat when the installed Codex version is not exactly `0.147.0` or the expected protocol handshake fails. It does not fall back to `danger-full-access`, approval bypass flags, or unstructured terminal scraping.

### 4.3 Transcript Store

Each chat is stored as `Codex Chats/YYYY-MM-DD-<sanitized-title>.md`. The note begins with YAML metadata containing the Codex session ID, creation and update timestamps, related note path, model when reported, and chat status.

User messages are persisted before dispatch. Codex messages are updated while streaming and finalized when the turn ends. The transcript includes user-visible approval decisions and concise execution summaries. Raw protocol frames, secrets, environment variables, and credentials are never written to the transcript.

### 4.4 Context Service

A new chat requires an active Markdown note. The first turn sends the related note path and its current content to Codex. Later turns send only the new user message unless the related note changed, in which case the updated note content is supplied once. The plugin never scans the entire Vault automatically.

The Codex app-server thread retains conversational context. The plugin does not resend the complete transcript on every turn.

### 4.5 Git Service

The Git service records the relevant note paths and their repository state when the chat starts. Commit preview shows the exact file list, diff, and an editable commit message. After confirmation, the service stages only the current chat note and the associated note if the save-conclusion action changed it.

If a candidate file already had uncommitted changes when the chat began, automatic commit is blocked. This avoids including pre-existing edits from the same file. Unrelated modified or untracked files never enter the staging command.

### 4.6 Health Check and Settings

Startup checks verify:

- The plugin is running in Windows desktop Obsidian.
- The configured `codex.cmd` exists and reports `codex-cli 0.147.0`.
- Codex authentication is usable.
- Git exists.
- The Vault is inside the expected Git repository.
- The Codex app-server protocol handshake succeeds.

Settings allow explicit paths for `codex.cmd` and Git, while defaulting to command discovery. Settings remain local and are not committed.

## 5. User Flow

1. The user opens a Markdown note and activates the Codex sidebar.
2. The user starts a chat. The plugin creates the transcript and stores the initial Git state.
3. The user sends a message. The message is saved before it reaches Codex.
4. The Codex client starts or resumes the app-server thread with the Vault as its working root.
5. Streamed response content appears in the sidebar and is saved incrementally.
6. Approval requests pause the turn and show the exact operation, target, and reason.
7. The user allows the operation once or denies it. The decision is returned to Codex and summarized in the transcript.
8. The completed response offers a Save as conclusion action.
9. Saving a conclusion opens an editable preview, then appends the confirmed text under a `## Codex conclusions` section in the related note.
10. Commit opens a preview listing only eligible chat files. The user reviews the diff and commit message before confirming.

## 6. Permission Model

Codex runs with the Vault as its workspace root, the `workspace-write` sandbox, and a strict human-approval policy. Native web search is disabled in the first release. Shell-based network access, external commands that require escalation, and access outside the Vault must surface an app-server approval request.

Approval is scoped to the current request only. The plugin does not persist allow rules. Git commit is initiated only through the plugin UI; Codex prompts are instructed not to commit, push, delete, or modify repository configuration.

The plugin never enables `--dangerously-bypass-approvals-and-sandbox`, `danger-full-access`, or equivalent configuration.

## 7. Failure Handling

- Missing or incompatible Codex: disable sending and display the detected path and version.
- Missing Git or repository: allow chat and note saving, but disable commit.
- Authentication failure: disable sending and show the relevant Codex login command without attempting to capture credentials.
- App-server exit: preserve the transcript and offer reconnect-and-resume using the stored session ID.
- Unknown protocol message: stop the active request, preserve a sanitized error summary, and require a compatible plugin update.
- Obsidian shutdown or plugin unload: request child-process shutdown, then terminate it if it does not exit within a short timeout. Saved notes remain untouched.
- Pre-existing modifications in a commit candidate: block automatic commit and identify the affected file.
- Git commit failure: leave the working tree unchanged apart from any staging Git already completed; report the error and offer a safe unstage action only after confirmation.

## 8. Testing

### 8.1 Unit Tests

- Transcript naming, frontmatter, append, stream finalization, and sanitization.
- Vault path containment and related-note change detection.
- Candidate file tracking and pre-existing modification blocking.
- Commit message generation and exact staging argument construction.
- Health-check version parsing and executable discovery.

### 8.2 Protocol Tests

A fake app-server process will cover initialization, thread start, thread resume, streamed replies, cancellation, one-time approval, denial, process exit, malformed frames, and unknown messages.

### 8.3 Git Integration Tests

Temporary repositories will verify that only explicit note paths are staged and committed, unrelated changes remain untouched, and pre-existing changes in a candidate file block the commit.

### 8.4 Build Verification

The project must pass type checking, automated tests, and a production build. The resulting `manifest.json`, `main.js`, and `styles.css` must exist in the Vault plugin directory.

## 9. Acceptance Criteria

1. Obsidian loads the plugin and opens the Codex sidebar.
2. Health checks identify Codex CLI `0.147.0`, authentication, and Git accurately.
3. Starting a chat from an active Markdown note creates a related transcript under `Codex Chats/`.
4. Messages and streamed replies survive Obsidian restart without transcript loss.
5. A stored Codex session resumes after reconnecting.
6. Vault-local work follows the configured sandbox, while external operations surface an Obsidian approval prompt.
7. Saving a conclusion modifies only the related note after preview confirmation.
8. Commit preview lists only files touched by the chat.
9. A confirmed commit excludes unrelated repository changes.
10. Pre-existing changes in a candidate note prevent automatic commit.

## 10. Known Constraint

Codex `app-server` is experimental. Version `0.147.0` is the validated protocol baseline for this release. Supporting a later Codex version requires rerunning protocol and end-to-end tests before widening the accepted version range.
