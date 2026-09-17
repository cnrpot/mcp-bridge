/**
 * Command execution tools.
 *
 * Long-running commands are first-class: `run_command` can return immediately
 * with an id, and the agent then polls `get_command_output` / stops it with
 * `cancel_command`. Output is kept in memory per command so polling is cheap
 * and incremental.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const scope = require("./scope");
const runtime = require("./runtime");
const guard = require("./guard");
const { spawnOptions, killProcessTree } = require("./shell");

const JOBS_DIR = path.join(require("./runtime").dataDir, "jobs", `${process.pid}-${Date.now()}`);
try {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
} catch {}

const MAX_OUTPUT_CHARS = 400000;
/**
 * Default synchronous wait. Cloudflare quick tunnels answer 524 at ~100s, so a
 * default above that hands the agent a failed HTTP response while the command
 * keeps running with no id to poll. Stay under the proxy deadline.
 */
const DEFAULT_WAIT_MS = 85000;
const HARD_WAIT_MS = 600000;
/**
 * Hard ceiling for any synchronous wait. Tunnel proxies cut an idle request at
 * roughly 100s; past that the agent sees a 524 while the command runs on with
 * no id to poll. Returning at ~85s with the id keeps every transport usable.
 */
const SYNC_WAIT_CAP_MS = 85000;

/** Finished records do not live forever; bound count and age. */
const FINISHED_TTL_MS = 10 * 60 * 1000;
const MAX_FINISHED_RECORDS = 50;

/**
 * Ring-shaped in-memory output with a read cursor.
 *
 * When the tail is trimmed, the cursor must move with it: otherwise the next
 * incremental read either silently skips fresh output or returns
 * "(no new output)" forever after the first trim.
 */
class OutputBuffer {
  constructor(maxChars = MAX_OUTPUT_CHARS) {
    this.maxChars = maxChars;
    this.text = "";
    this.readOffset = 0;
    this.truncated = false;
    this.missedOutput = false;
  }

  append(chunk) {
    this.text += String(chunk);
    if (this.text.length <= this.maxChars) return;

    const overflow = this.text.length - this.maxChars;
    this.text = this.text.slice(overflow);
    if (this.readOffset > overflow) {
      // The cut stayed inside already-read content; shift the cursor.
      this.readOffset -= overflow;
    } else {
      // The cut removed output nobody ever read.
      this.missedOutput = true;
      this.readOffset = 0;
    }
    this.truncated = true;
  }

  readIncremental() {
    const body = this.text.slice(this.readOffset);
    this.readOffset = this.text.length;
    return body;
  }

  readFull() {
    this.readOffset = this.text.length;
    return this.text;
  }
}

/** command_id -> record */
const commands = new Map();
let nextId = 1;

function scheduleRecordExpiry(record) {
  if (record.cleanupTimer) return;
  record.cleanupTimer = setTimeout(() => {
    if (commands.get(record.id) === record && !record.running) commands.delete(record.id);
  }, FINISHED_TTL_MS);
  record.cleanupTimer.unref?.();
}

/** Bound the number of finished records retained for later polling. */
function pruneRecords() {
  const finished = [...commands.values()].filter((record) => !record.running);
  if (finished.length <= MAX_FINISHED_RECORDS) return;
  finished.sort((a, b) => (a.endedAt || a.startedAt) - (b.endedAt || b.startedAt));
  for (const record of finished.slice(0, finished.length - MAX_FINISHED_RECORDS)) {
    if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
    commands.delete(record.id);
  }
}

function startCommand(command, cwd) {
  const id = `cmd-${nextId++}`;
  const logFile = path.join(JOBS_DIR, `${id}.log`);
  let logStream = null;
  try {
    logStream = fs.createWriteStream(logFile, { flags: "a" });
  } catch {}

  const record = {
    id,
    command,
    cwd,
    logFile,
    buffer: new OutputBuffer(),
    // Plain-string view for the structured tool wrappers (dotnet/godot/visual).
    get output() {
      return this.buffer.text;
    },
    exitCode: null,
    signal: null,
    running: true,
    startedAt: Date.now(),
    endedAt: null,
    cleanupTimer: null,
  };

  const prefix = process.platform === 'win32' ? '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; ' : '';
  const child = spawn(prefix + command, spawnOptions({ cwd }));

  record.pid = child.pid;
  record.child = child;
  commands.set(id, record);
  runtime.changed();

  let logBytes = 0;
  const appendChunk = (chunk) => {
    const str = chunk.toString("utf8");
    record.buffer.append(str);
    runtime.changed();
    if (logStream && logStream.writable && logBytes < 4 * 1024 * 1024) {
      try { logStream.write(str); logBytes += Buffer.byteLength(str); } catch {}
    }
  };

  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  if (logStream) logStream.on("error", () => { logStream = null; });
  child.stdout.on("data", appendChunk);
  child.stderr.on("data", appendChunk);

  const finish = (code, signal) => {
    record.running = false;
    record.exitCode = record.cancelled ? -1 : code;
    record.signal = signal;
    record.endedAt = Date.now();
    if (logStream) {
      try { logStream.end(); } catch {}
    }
    scheduleRecordExpiry(record);
    pruneRecords();
    runtime.changed();
  };

  child.on("error", (err) => {
    appendChunk(`\n[spawn error] ${err.message}\n`);
    finish(-1, null);
  });

  child.on("close", (code, signal) => {
    finish(code, signal);
  });

  return record;
}

function readFromOffset(record, offset, maxChars = 32000) {
  if (record.logFile && fs.existsSync(record.logFile)) {
    try {
      const fd = fs.openSync(record.logFile, "r");
      const stat = fs.fstatSync(fd);
      const totalBytes = stat.size;
      const start = Math.max(0, Math.min(Number(offset) || 0, totalBytes));
      const length = Math.min(maxChars, totalBytes - start);
      let content = "";
      if (length > 0) {
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, start);
        content = buf.toString("utf8");
      }
      fs.closeSync(fd);
      return {
        text: content,
        offset: start,
        next_offset: start + Buffer.byteLength(content),
        total_bytes: totalBytes,
      };
    } catch {}
  }

  const full = record.buffer.text;
  const start = Math.max(0, Math.min(Number(offset) || 0, full.length));
  const content = full.slice(start, start + maxChars);
  return {
    text: content,
    offset: start,
    next_offset: start + content.length,
    total_bytes: full.length,
  };
}

function renderRecord(record, incremental) {
  const body = incremental ? record.buffer.readIncremental() : record.buffer.readFull();

  const status = record.running
    ? `still running (${Math.round((Date.now() - record.startedAt) / 1000)}s)`
    : `finished with exit code ${record.exitCode}${record.signal ? ` (signal ${record.signal})` : ""}`;

  const flags = [];
  if (record.buffer.truncated) flags.push("output truncated to the last 400k chars");
  if (record.buffer.missedOutput) flags.push("unread output was discarded by the trim - full:true shows the retained tail");
  const header = `${record.id} | ${record.command}\nstatus: ${status}${
    flags.length ? ` | ${flags.join(" | ")}` : ""
  }`;
  const tail = incremental && !body ? "\n(no new output)" : `\n${"-".repeat(60)}\n${body}`;
  const hint = record.running
    ? `\n\nPoll again with get_command_output {"command_id": "${record.id}"}.`
    : "";
  return header + tail + hint;
}

/**
 * Shared launch path for run_command and the structured tool wrappers
 * (.NET / Godot / run-and-capture). Every launch gets the same three things:
 * the workspace boundary on cwd, the destructive-command confirmation, and a
 * place in the command registry (so output can be polled and it can be killed).
 *
 * wait=false resolves immediately with { id, waited:false }. wait=true polls
 * up to the synchronous cap: a call that crosses the tunnel dies at the
 * proxy's ~100s deadline, so beyond SYNC_WAIT_CAP_MS the command is left
 * running and reported as timedOut with its id, instead of hanging the HTTP
 * request to a 524.
 */
async function runGuarded({ command, cwd, wait = true, timeoutMs } = {}) {
  const epoch = require("./runtime").epoch;
  const resolvedCwd = cwd ? scope.resolvePath(cwd) : scope.primaryRoot();
  if (!resolvedCwd) throw new Error("No folder is open selected.");

  const text = String(command);
  require("./policy").ensureAllowed("run_command");
  const risks = require("./runtime").config.commandConfirm ? ["命令执行确认（命令具备当前用户的系统权限）"] : guard.scan(text);
  if (risks.length && !(await guard.confirm(text, risks, scope.displayPath(resolvedCwd)))) {
    throw new Error(
      `[user refused] This command matches high-risk patterns (${risks.join(
        "; "
      )}) and the user declined it in mcp-bridge.\n` +
        "It was NOT run. Do not retry it or a near variant - ask the user what they actually want instead."
    );
  }

  require("./policy").ensureAllowed("run_command");
  if(require("./runtime").epoch !== epoch)throw new Error("Bridge stopped during confirmation");
  if ([...commands.values()].filter(r => r.running).length >= 8) throw new Error("At most 8 commands may run concurrently");
  const record = startCommand(text, scope.resolvePath(resolvedCwd));
  if (wait === false) {
    return { id: record.id, waited: false, record };
  }

  const requested = Math.min(Number(timeoutMs) || DEFAULT_WAIT_MS, HARD_WAIT_MS);
  const cap = Math.min(requested, SYNC_WAIT_CAP_MS);
  const deadline = Date.now() + cap;
  while (record.running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return {
    id: record.id,
    waited: true,
    record,
    timedOut: record.running,
    timeoutMs: cap,
    durationMs: (record.endedAt || Date.now()) - record.startedAt,
    output: record.buffer.text,
    exitCode: record.exitCode,
    signal: record.signal,
  };
}

/** Programmatic cancel used by run_and_capture; mirrors cancel_command. */
async function stopCommand(id) {
  const record = commands.get(String(id));
  if (!record || !record.running) return record || null;
  record.cancelled = true;
  await killProcessTree(record.child);
  record.running = false;
  record.exitCode = record.exitCode ?? -1;
  record.endedAt = Date.now();
  scheduleRecordExpiry(record);
  pruneRecords();
  runtime.changed();
  return record;
}

const TOOLS = [
  {
    name: "run_command",
    title: "Run Command",
    description:
      "Run a shell command inside the workspace (PowerShell on Windows; the POSIX system shell elsewhere). By default it waits for completion and returns the combined output plus the exit code; pass wait=false for servers, watchers or anything long-running, and you get a command_id back immediately. Poll with get_command_output, stop with cancel_command.",
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string", description: "Command line to execute." },
        cwd: { type: "string", description: "Working directory. Defaults to the workspace root." },
        wait: { type: "boolean", description: "Wait for the command to finish. Defaults to true." },
        timeout_ms: {
          type: "number",
          description:
            "When waiting, give up after this many ms (default 85000, max 600000). The command keeps running and its command_id is returned.",
        },
      },
    },
    async run(args) {
      const result = await runGuarded({
        command: String(args.command),
        cwd: args.cwd,
        wait: args.wait !== false,
        timeoutMs: Number(args.timeout_ms) || DEFAULT_WAIT_MS,
      });

      const record = result.record;
      if (!result.waited) {
        return `started ${record.id} in ${scope.displayPath(record.cwd)}\nPoll with get_command_output {"command_id": "${record.id}"}.`;
      }
      if (result.timedOut) {
        return (
          `${renderRecord(record, false)}\n\n` +
          `[synchronous wait of ${result.timeoutMs} ms elapsed - the command is STILL RUNNING as ${record.id}. ` +
          `Poll it with get_command_output {"command_id":"${record.id}"} or stop it with cancel_command {"command_id":"${record.id}"}.]`
        );
      }
      return renderRecord(record, false);
    },
  },

  {
    name: "get_command_output",
    title: "Get Command Output",
    description:
      "Read output from a command started by run_command. Supports offset cursor for reliable incremental polling, full tail reading, or default incremental delta. Never queued, so it works even while other tools are busy.",
    inputSchema: {
      type: "object",
      required: ["command_id"],
      properties: {
        command_id: { type: "string", description: "Id returned by run_command." },
        offset: { type: "number", description: "Optional byte offset cursor to read from. Enables exact paginated reading." },
        max_chars: { type: "number", description: "Max characters to return when reading with offset (default 32000)." },
        full: { type: "boolean", description: "Return the whole retained tail instead of only the new part." },
      },
    },
    async run(args) {
      const record = commands.get(String(args.command_id));
      if (!record) {
        throw new Error(
          `unknown command_id ${args.command_id}. Known ids: ${[...commands.keys()].join(", ") || "(none)"}`
        );
      }
      if (args.offset != null) {
        const cursor = readFromOffset(record, args.offset, args.max_chars || 32000);
        const status = record.running
          ? `still running (${Math.round((Date.now() - record.startedAt) / 1000)}s)`
          : `finished with exit code ${record.exitCode}${record.signal ? ` (signal ${record.signal})` : ""}`;
        return [
          `[${record.id}] status: ${status} | bytes: ${cursor.offset}-${cursor.next_offset}/${cursor.total_bytes}`,
          cursor.text || "(no new output)",
          `\nNext offset: ${cursor.next_offset}`,
        ].join("\n");
      }
      return renderRecord(record, !args.full);
    },
  },

  {
    name: "list_jobs",
    title: "List Jobs",
    description:
      "List all background commands and jobs, their running state, exit code, elapsed duration, and command line. Useful to check status after reconnection.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max jobs to return (default 20)." },
      },
    },
    async run(args) {
      const all = [...commands.values()];
      if (!all.length) {
        return "No active or recent jobs found.";
      }
      const limit = Number(args.limit) || 20;
      const sorted = all.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
      const lines = sorted.map((r) => {
        const dur = Math.round(((r.endedAt || Date.now()) - r.startedAt) / 1000);
        const status = r.running ? `RUNNING (${dur}s)` : `FINISHED (exit ${r.exitCode}, ${dur}s)`;
        return `- [${r.id}] ${status}: ${r.command} (cwd: ${scope.displayPath(r.cwd)})`;
      });
      return `Jobs (${sorted.length} recorded):\n${lines.join("\n")}\n\nUse get_command_output with command_id to inspect output.`;
    },
  },

  {
    name: "send_command_input",
    title: "Send Command Input",
    description:
      "Write to the stdin of a command started with wait=false. Use this for interactive prompts (y/n confirmations, menu choices, REPL input) and for any program that keeps reading from stdin. Read what the program printed first with get_command_output, so you answer the prompt it actually showed.",
    inputSchema: {
      type: "object",
      required: ["command_id", "input"],
      properties: {
        command_id: { type: "string", description: "Id returned by run_command." },
        input: { type: "string", description: "Text to send. A newline is appended unless raw is true." },
        raw: { type: "boolean", description: "Send exactly as given, with no trailing newline." },
      },
    },
    async run(args) {
      const record = commands.get(String(args.command_id));
      if (!record) throw new Error(`unknown command_id ${args.command_id}`);
      if (!record.running) throw new Error(`${record.id} already finished with exit code ${record.exitCode}`);
      if (!record.child || !record.child.stdin || !record.child.stdin.writable) {
        throw new Error(`${record.id} has no writable stdin`);
      }

      const text = args.raw ? String(args.input ?? "") : `${String(args.input ?? "")}\n`;
      record.child.stdin.write(text);
      return `wrote ${JSON.stringify(text)} to ${record.id}${args.raw ? " (raw)" : " (newline appended)"}`;
    },
  },

  {
    name: "cancel_command",
    title: "Cancel Command",
    description:
      "Stop a running command and its child processes. Never queued, so it can always stop a runaway command. Returns the output produced so far.",
    inputSchema: {
      type: "object",
      required: ["command_id"],
      properties: {
        command_id: { type: "string", description: "Id returned by run_command." },
      },
    },
    async run(args) {
      const record = commands.get(String(args.command_id));
      if (!record) {
        throw new Error(`unknown command_id ${args.command_id}`);
      }
      if (!record.running) {
        return `${record.id} already finished with exit code ${record.exitCode}.`;
      }
      await stopCommand(record.id);
      return `cancelled ${record.id}\n${"-".repeat(60)}\n${record.buffer.text.slice(-4000)}`;
    },
  },
];

async function stopAll() {
  await Promise.all([...commands.values()].filter(r => r.running).map(r => stopCommand(r.id)));
  runtime.changed();
}

async function disposeAll() {
  await stopAll();
  for (const record of commands.values()) {
    if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
    if (record.running) killProcessTree(record.child);
  }
  commands.clear();
}

module.exports = {
  TOOLS,
  disposeAll,
  stopAll,
  OutputBuffer,
  MAX_OUTPUT_CHARS,
  runGuarded,
  stopCommand,
  commands,
  startCommand,
  renderRecord,
};
