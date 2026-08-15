const readline = require("node:readline");

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let nextApprovalId = 900;
let pendingApproval = null;

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === undefined && pendingApproval !== null && message.id === pendingApproval.id) {
    const decision = message.result?.decision;
    if (decision !== "accept" && decision !== "decline") {
      process.stderr.write(`invalid approval decision: ${String(decision)}\n`);
      process.exitCode = 2;
      lines.close();
      return;
    }
    const turn = pendingApproval.turn;
    pendingApproval = null;
    finishTurn(turn);
    return;
  }

  switch (message.method) {
    case "initialize":
      respond(message.id, {
        userAgent: "fake-codex",
        codexHome: "C:/FakeCodex",
        platformFamily: "windows",
        platformOs: "windows"
      });
      break;
    case "initialized":
      break;
    case "thread/start":
      respond(message.id, { thread: { id: "fake-thread" } });
      break;
    case "thread/resume":
      respond(message.id, { thread: { id: message.params.threadId } });
      break;
    case "turn/start": {
      const turn = { threadId: message.params.threadId, turnId: "fake-turn" };
      respond(message.id, { turn: { id: turn.turnId } });
      const text = message.params.input?.[0]?.text ?? "";
      if (text.includes("APPROVAL")) {
        const id = nextApprovalId++;
        pendingApproval = { id, turn };
        send({
          id,
          method: "item/commandExecution/requestApproval",
          params: { command: "fake-command --check", reason: "integration test" }
        });
      } else {
        finishTurn(turn);
      }
      break;
    }
    case "turn/interrupt":
      respond(message.id, {});
      send({
        method: "turn/completed",
        params: {
          threadId: message.params.threadId,
          turn: { id: message.params.turnId, status: "interrupted", error: null }
        }
      });
      break;
    default:
      if (message.id !== undefined) {
        send({ id: message.id, error: { code: -32601, message: "Method not found" } });
      }
  }
});

function finishTurn(turn) {
  send({
    method: "item/agentMessage/delta",
    params: {
      threadId: turn.threadId,
      turnId: turn.turnId,
      itemId: "fake-item",
      delta: "fake response"
    }
  });
  send({
    method: "turn/completed",
    params: {
      threadId: turn.threadId,
      turn: { id: turn.turnId, status: "completed", error: null }
    }
  });
}

function respond(id, result) {
  send({ id, result });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
