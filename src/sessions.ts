export type SessionListItem = {
  id: string;
  title?: string;
  time?: { updated?: number };
};

export type SessionSelectOption = {
  title: string;
  value: string;
  description?: string;
};

export function sessionDisplayTitle(
  session: SessionListItem,
  fallbackPrefix = "session",
): string {
  const title = session.title?.trim();
  if (title) return title;
  return `${fallbackPrefix} ${session.id.slice(0, 8)}`;
}

export function sortSessionsByUpdated<T extends SessionListItem>(
  sessions: readonly T[],
): T[] {
  return [...sessions].sort(
    (a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0),
  );
}

export function toSessionOptions(
  sessions: readonly SessionListItem[],
): SessionSelectOption[] {
  return sortSessionsByUpdated(sessions).map((session) => {
    const title = sessionDisplayTitle(session);
    const updated = session.time?.updated;
    return {
      title,
      value: session.id,
      description: Number.isFinite(updated)
        ? new Date(updated as number).toLocaleString()
        : undefined,
    };
  });
}
