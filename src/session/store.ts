import { randomUUID } from "node:crypto";
import { basename, dirname } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type {
  CreateSessionInput,
  SessionRecord,
  SessionState,
} from "./types.ts";

export class SessionStore {
  private readonly stateFilePath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(stateFilePath: string) {
    this.stateFilePath = stateFilePath;
  }

  async listSessions(): Promise<SessionRecord[]> {
    await this.queue;
    const state = await this.readState();
    return [...state.sessions].sort((a, b) =>
      a.projectPath === b.projectPath
        ? a.createdAt.localeCompare(b.createdAt)
        : a.projectPath.localeCompare(b.projectPath),
    );
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    await this.queue;
    const state = await this.readState();
    return state.sessions.find((session) => session.id === sessionId);
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    return this.withMutation(async (state) => {
      const projectPath = input.projectPath.trim();

      if (!projectPath) {
        throw new Error("Project path cannot be empty.");
      }

      const defaultTitle = `${basename(projectPath) || "session"} session`;
      const title = input.title?.trim() || defaultTitle;
      const [idPart] = randomUUID().split("-");
      const sessionId = idPart ?? randomUUID();

      const newSession: SessionRecord = {
        id: sessionId,
        projectPath,
        title,
        createdByUserId: input.createdByUserId,
        createdAt: new Date().toISOString(),
      };

      state.sessions.push(newSession);
      return newSession;
    });
  }

  async deleteSession(sessionId: string): Promise<SessionRecord | null> {
    return this.withMutation(async (state) => {
      const index = state.sessions.findIndex((session) => session.id === sessionId);

      if (index === -1) {
        return null;
      }

      const [deletedSession] = state.sessions.splice(index, 1);

      for (const [userId, focusedSessionId] of Object.entries(
        state.focusedSessionByUserId,
      )) {
        if (focusedSessionId === sessionId) {
          delete state.focusedSessionByUserId[userId];
        }
      }

      return deletedSession ?? null;
    });
  }

  async getFocusedSessionId(userId: string): Promise<string | undefined> {
    await this.queue;
    const state = await this.readState();
    return state.focusedSessionByUserId[userId];
  }

  async setFocusedSessionId(userId: string, sessionId: string): Promise<void> {
    await this.withMutation(async (state) => {
      const sessionExists = state.sessions.some((session) => session.id === sessionId);

      if (!sessionExists) {
        throw new Error(`Session ${sessionId} does not exist.`);
      }

      state.focusedSessionByUserId[userId] = sessionId;
    });
  }

  async setSessionChannelId(
    sessionId: string,
    channelId: string | undefined,
  ): Promise<SessionRecord> {
    return this.withMutation(async (state) => {
      const session = state.sessions.find((candidate) => candidate.id === sessionId);

      if (!session) {
        throw new Error(`Session ${sessionId} does not exist.`);
      }

      if (channelId) {
        session.channelId = channelId;
      } else {
        delete session.channelId;
      }

      return session;
    });
  }

  private async withMutation<T>(
    mutate: (state: SessionState) => Promise<T>,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const state = await this.readState();
      const result = await mutate(state);
      await this.writeState(state);
      return result;
    };

    const runPromise = this.queue.then(run, run);
    this.queue = runPromise.then(
      () => undefined,
      () => undefined,
    );

    return runPromise;
  }

  private async readState(): Promise<SessionState> {
    try {
      const file = await readFile(this.stateFilePath, "utf8");
      const parsed = JSON.parse(file) as SessionState;
      return normalizeState(parsed);
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return {
          sessions: [],
          focusedSessionByUserId: {},
        };
      }

      throw error;
    }
  }

  private async writeState(state: SessionState): Promise<void> {
    await mkdir(dirname(this.stateFilePath), {
      recursive: true,
    });

    await writeFile(this.stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

function normalizeState(candidate: unknown): SessionState {
  if (!candidate || typeof candidate !== "object") {
    return {
      sessions: [],
      focusedSessionByUserId: {},
    };
  }

  const state = candidate as SessionState;
  const safeSessions = Array.isArray(state.sessions)
    ? state.sessions.filter(isSessionRecord)
    : [];

  const safeFocusedSessionByUserId: Record<string, string> = {};

  if (
    state.focusedSessionByUserId &&
    typeof state.focusedSessionByUserId === "object"
  ) {
    for (const [userId, sessionId] of Object.entries(
      state.focusedSessionByUserId,
    )) {
      if (typeof userId === "string" && typeof sessionId === "string") {
        safeFocusedSessionByUserId[userId] = sessionId;
      }
    }
  }

  return {
    sessions: safeSessions,
    focusedSessionByUserId: safeFocusedSessionByUserId,
  };
}

function isSessionRecord(candidate: unknown): candidate is SessionRecord {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  const record = candidate as SessionRecord;

  return (
    typeof record.id === "string" &&
    typeof record.projectPath === "string" &&
    typeof record.title === "string" &&
    typeof record.createdByUserId === "string" &&
    typeof record.createdAt === "string" &&
    (typeof record.channelId === "undefined" || typeof record.channelId === "string")
  );
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
