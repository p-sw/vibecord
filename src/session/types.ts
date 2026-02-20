export interface SessionRecord {
  id: string;
  projectPath: string;
  title: string;
  createdByUserId: string;
  createdAt: string;
  channelId?: string;
  codexThreadId?: string;
}

export interface SessionState {
  sessions: SessionRecord[];
  focusedSessionByUserId: Record<string, string>;
}

export interface CreateSessionInput {
  projectPath: string;
  title?: string;
  createdByUserId: string;
}
