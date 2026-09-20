type LogLevel = "info" | "error";

type LogPayload = Record<string, unknown>;

function emit(level: LogLevel, event: string, payload: LogPayload): void {
  const record = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...payload
  };

  const serialized = JSON.stringify(record);
  if (level === "error") {
    console.error(serialized);
    return;
  }
  console.log(serialized);
}

export const logger = {
  info: (event: string, payload: LogPayload) => emit("info", event, payload),
  error: (event: string, payload: LogPayload) => emit("error", event, payload)
};

export type Logger = typeof logger;
