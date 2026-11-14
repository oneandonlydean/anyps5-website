import { DurableObject } from "cloudflare:workers";
import { log, type Env } from "./env";
import { guildState, handle, type CachedMessage, type GuildState, type Job, type KnownMember, type World } from "./events";
import { allSettings, Bot, type Settings } from "./guild";
import { runJob } from "./jobs";

/**
 * The bot's live connection to Discord's gateway, for what slash commands can't see: messages as they're sent (automod,
 * edit and delete logs), members joining and leaving (welcome, autorole, member logs) and bans. One instance holds one
 * WebSocket. The cron calls ensure() every minute, which connects or resumes it when it has dropped; Discord replays
 * what was missed on a resume.
 *
 * Events are handled in memory (events.ts) and anything that calls Discord becomes a job in a queue stored here, which
 * an alarm drains. The alarm is its own invocation with its own limits, so the long-lived socket never waits on Discord
 * and a failed call is retried.
 */

const GATEWAY = "wss://gateway.discord.gg";
const QUERY = "?v=10&encoding=json";
// GUILDS, GUILD_MEMBERS, GUILD_MODERATION, GUILD_MESSAGES, MESSAGE_CONTENT. GUILD_MEMBERS and MESSAGE_CONTENT are
// privileged: they must be switched on for the bot in the Developer Portal, or Discord closes with 4014.
const INTENTS = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 9) | (1 << 15);
/** Close codes that a reconnect can't fix (bad token, disallowed intents). The bot waits an hour, or a deploy. */
const FATAL = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const FATAL_PAUSE_MS = 3600_000;
const MESSAGE_DAYS = 7;
const JOBS_PER_ALARM = 50;
const MAX_ATTEMPTS = 4;

export interface GatewayStatus {
  connected: boolean;
  session: boolean;
  guilds: number;
  queued: number;
  lastEventAgo: number | null;
  stopped?: string;
}

export class Gateway extends DurableObject<Env> implements World {
  private ws?: WebSocket;
  private beat?: ReturnType<typeof setInterval>;
  private acked = true;
  private lastAck = 0;
  private interval = 0;
  private lastEvent = 0;
  private connecting?: Promise<void>;
  private config = new Map<string, Settings>();
  private guilds = new Map<string, GuildState>();
  private nextAlarm: number | null = null;
  /** Server state lives in memory, and a resume doesn't send it again: a fresh instance starts a new session. */
  private seenReady = false;
  private stickies = new Set<string>();
  recent = new Map<string, { at: number; content: string }[]>();
  stickyQueued = new Map<string, number>();
  removedByAutomod = new Map<string, string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_age ON messages(created_at);
      CREATE TABLE IF NOT EXISTS members (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (guild_id, user_id));
      CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, run_at INTEGER NOT NULL, job TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
    `);
  }

  // RPC, from the cron and from the commands that change settings.

  /** Connects if the connection is down or has gone quiet. Called every minute. */
  async ensure(): Promise<GatewayStatus> {
    await this.reload();
    this.ctx.storage.sql.exec("DELETE FROM messages WHERE created_at < ?", this.now() - MESSAGE_DAYS * 86400);
    const stoppedUntil = Number(this.meta("stopped_until") ?? 0);
    if (stoppedUntil > Date.now()) return this.status();
    // Silent for two heartbeats: dead, even if the socket looks open.
    const silent = this.interval > 0 && Date.now() - this.lastAck > this.interval * 2 + 10_000;
    if (!this.ws || silent) await this.reconnect();
    return this.status();
  }

  async reload(): Promise<void> {
    this.config = await allSettings(this.env);
    const { results } = await this.env.DB.prepare("SELECT channel_id FROM stickies WHERE paused = 0").all<{ channel_id: string }>();
    this.stickies = new Set(results.map((r) => r.channel_id));
  }

  status(): GatewayStatus {
    const queued = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox").one().n;
    const stoppedUntil = Number(this.meta("stopped_until") ?? 0);
    return {
      connected: Boolean(this.ws),
      session: Boolean(this.meta("session_id")),
      guilds: this.guilds.size,
      queued,
      lastEventAgo: this.lastEvent ? Math.round((Date.now() - this.lastEvent) / 1000) : null,
      ...(stoppedUntil > Date.now() ? { stopped: `closed with ${this.meta("stopped_code")}; retrying after ${new Date(stoppedUntil).toISOString()}` } : {}),
    };
  }

  // The connection.

  private meta(key: string): string | undefined {
    return this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value;
  }

  private setMeta(key: string, value: string | null): void {
    if (value === null) this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", key);
    else this.ctx.storage.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  private reconnect(): Promise<void> {
    this.connecting ??= this.open().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private async open(): Promise<void> {
    this.drop(4000);
    if (!this.seenReady) this.forgetSession();
    const resumable = Boolean(this.meta("session_id") && this.meta("resume_url"));
    const base = (resumable ? this.meta("resume_url")! : GATEWAY).replace(/^wss:/, "https:").replace(/\/?$/, "/");
    const res = await fetch(`${base}${QUERY}`, { headers: { upgrade: "websocket" } });
    const ws = res.webSocket;
    if (!ws) {
      log("gateway_connect_failed", { status: res.status });
      return;
    }
    ws.accept();
    this.ws = ws;
    this.acked = true;
    ws.addEventListener("message", (e) => {
      if (this.ws !== ws) return;
      try {
        this.receive(JSON.parse(e.data as string));
      } catch (err) {
        log("gateway_event_failed", { error: String(err) });
      }
    });
    ws.addEventListener("close", (e) => this.closed(ws, e.code));
    ws.addEventListener("error", () => this.closed(ws, 1006));
    log("gateway_connecting", { resume: resumable });
  }

  /** Forgets the current socket, closing it if it's still open. */
  private drop(code: number): void {
    if (this.beat) clearInterval(this.beat);
    this.beat = undefined;
    const ws = this.ws;
    this.ws = undefined;
    try {
      ws?.close(code, "reconnecting");
    } catch {
      // Already closed.
    }
  }

  private closed(ws: WebSocket, code: number): void {
    if (this.ws !== ws) return;
    this.drop(1000);
    log("gateway_closed", { code });
    if (FATAL.has(code)) {
      // Retrying a bad token or disallowed intents every minute would only use up the day's logins.
      this.setMeta("stopped_until", String(Date.now() + FATAL_PAUSE_MS));
      this.setMeta("stopped_code", String(code));
      log("gateway_stopped", { code, fix: code === 4014 ? "turn on the Server Members and Message Content intents in the Developer Portal" : "check DISCORD_BOT_TOKEN" });
      return;
    }
    // Discord can't resume these; the next connection starts a new session.
    if (code === 4007 || code === 4009) this.forgetSession();
    this.reconnectSoon();
  }

  /** Reconnects after a pause, unless the cron has reconnected in the meantime. */
  private reconnectSoon(): void {
    setTimeout(() => {
      if (!this.ws) void this.reconnect();
    }, 1000 + Math.random() * 4000);
  }

  private forgetSession(): void {
    this.setMeta("session_id", null);
    this.setMeta("resume_url", null);
    this.setMeta("seq", null);
  }

  private send(payload: unknown): void {
    this.ws?.send(JSON.stringify(payload));
  }

  private heartbeat(): void {
    // No answer to the last heartbeat: the connection is dead even if it looks open. Reconnect and resume.
    if (!this.acked) {
      log("gateway_zombie");
      this.drop(4000);
      void this.reconnect();
      return;
    }
    this.acked = false;
    const seq = this.meta("seq");
    this.send({ op: 1, d: seq ? Number(seq) : null });
  }

  private receive(p: { op: number; d: any; s?: number | null; t?: string | null }): void {
    switch (p.op) {
      case 10: {
        // Hello: heartbeat on Discord's interval, then resume the session or start one.
        const interval = p.d.heartbeat_interval as number;
        const ws = this.ws;
        this.interval = interval;
        this.lastAck = Date.now();
        setTimeout(() => {
          // A newer connection has its own heartbeat.
          if (this.ws !== ws) return;
          this.heartbeat();
          this.beat = setInterval(() => this.heartbeat(), interval);
        }, interval * Math.random());
        const session = this.meta("session_id");
        const token = this.env.DISCORD_BOT_TOKEN;
        if (session) this.send({ op: 6, d: { token, session_id: session, seq: Number(this.meta("seq") ?? 0) } });
        else this.send({ op: 2, d: { token, intents: INTENTS, properties: { os: "linux", browser: "anyps5-bot", device: "anyps5-bot" } } });
        return;
      }
      case 11:
        this.acked = true;
        this.lastAck = Date.now();
        return;
      case 1:
        this.send({ op: 1, d: Number(this.meta("seq") ?? 0) || null });
        return;
      case 7:
        // Discord asks for a reconnect; the session resumes.
        this.drop(4000);
        void this.reconnect();
        return;
      case 9:
        // Invalid session: resumable only if Discord says so.
        if (!p.d) this.forgetSession();
        this.drop(4000);
        this.reconnectSoon();
        return;
      case 0:
        this.lastEvent = Date.now();
        if (p.s) this.setMeta("seq", String(p.s));
        this.dispatch(p.t!, p.d);
    }
  }

  private dispatch(type: string, d: any): void {
    if (type === "READY") {
      this.setMeta("session_id", d.session_id);
      this.setMeta("resume_url", d.resume_gateway_url);
      this.setMeta("stopped_until", null);
      this.seenReady = true;
      log("gateway_ready", { guilds: d.guilds?.length ?? 0 });
      return;
    }
    if (type === "RESUMED") {
      log("gateway_resumed");
      return;
    }
    if (type === "GUILD_CREATE") {
      this.guilds.set(d.id, guildState(d));
      // Members, so role and nickname changes can be logged with what they were before.
      this.send({ op: 8, d: { guild_id: d.id, query: "", limit: 0 } });
      return;
    }
    if (type === "GUILD_DELETE") {
      if (!d.unavailable) this.guilds.delete(d.id);
      return;
    }
    handle(this, type, d);
  }

  // World, for events.ts.

  get botId(): string {
    return this.env.DISCORD_CLIENT_ID;
  }

  hasSticky(channel: string): boolean {
    return this.stickies.has(channel);
  }

  now(): number {
    return Math.floor(Date.now() / 1000);
  }

  settings(guild: string): Settings | undefined {
    return this.config.get(guild);
  }

  guild(guild: string): GuildState | undefined {
    return this.guilds.get(guild);
  }

  message(id: string): CachedMessage | undefined {
    const row = this.ctx.storage.sql.exec<{ data: string }>("SELECT data FROM messages WHERE id = ?", id).toArray()[0];
    return row ? JSON.parse(row.data) : undefined;
  }

  saveMessage(m: CachedMessage): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO messages (id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      m.id,
      JSON.stringify(m),
      m.created_at,
    );
  }

  member(guild: string, user: string): KnownMember | undefined {
    const row = this.ctx.storage.sql.exec<{ data: string }>("SELECT data FROM members WHERE guild_id = ? AND user_id = ?", guild, user).toArray()[0];
    return row ? JSON.parse(row.data) : undefined;
  }

  saveMember(guild: string, user: string, member: KnownMember): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO members (guild_id, user_id, data) VALUES (?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET data = excluded.data",
      guild,
      user,
      JSON.stringify(member),
    );
  }

  forgetMember(guild: string, user: string): void {
    this.ctx.storage.sql.exec("DELETE FROM members WHERE guild_id = ? AND user_id = ?", guild, user);
  }

  enqueue(job: Job, delaySeconds = 0): void {
    const at = Date.now() + delaySeconds * 1000;
    this.ctx.storage.sql.exec("INSERT INTO outbox (run_at, job) VALUES (?, ?)", at, JSON.stringify(job));
    this.wake(at);
  }

  private wake(at: number): void {
    if (this.nextAlarm !== null && this.nextAlarm <= at) return;
    this.nextAlarm = at;
    void this.ctx.storage.setAlarm(at);
  }

  // The queue.

  async alarm(): Promise<void> {
    this.nextAlarm = null;
    const bot = new Bot(this.env);
    const due = this.ctx.storage.sql
      .exec<{ id: number; job: string; attempts: number }>("SELECT id, job, attempts FROM outbox WHERE run_at <= ? ORDER BY id LIMIT ?", Date.now(), JOBS_PER_ALARM)
      .toArray();
    for (const row of due) {
      const job = JSON.parse(row.job) as Job;
      try {
        const next = await runJob(bot, job);
        this.ctx.storage.sql.exec("DELETE FROM outbox WHERE id = ?", row.id);
        for (const n of next) this.enqueue(n.job, n.delay);
      } catch (err) {
        if (row.attempts + 1 >= MAX_ATTEMPTS) {
          this.ctx.storage.sql.exec("DELETE FROM outbox WHERE id = ?", row.id);
          log("gateway_job_dropped", { kind: job.kind, error: String(err) });
        } else {
          this.ctx.storage.sql.exec("UPDATE outbox SET attempts = attempts + 1, run_at = ? WHERE id = ?", Date.now() + 15_000 * 2 ** row.attempts, row.id);
        }
      }
    }
    const next = this.ctx.storage.sql.exec<{ at: number | null }>("SELECT MIN(run_at) AS at FROM outbox").one().at;
    if (next !== null) this.wake(Math.max(next, Date.now()));
  }
}
