// Client-side helper for streaming interview agent turns. The Next.js
// route at /api/interview/agent/turn proxies to the AWS backend, which
// emits Server-Sent Events with `delta`, `tool_use`, `done`, and `error`
// payloads. We parse those frames here and dispatch to callbacks.

import type { ProposedMemory } from "@/lib/interview-mapper";

export type AssistantMessage = {
  role: "interviewer";
  text: string;
};

export interface StreamTurnArgs {
  interviewId: string;
  userMessage?: string;
  onDelta?: (text: string) => void;
  onToolUse?: (name: string) => void;
  onDone?: (assistant: AssistantMessage) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
}

export async function streamTurn({
  interviewId,
  userMessage,
  onDelta,
  onToolUse,
  onDone,
  onError,
  signal,
}: StreamTurnArgs): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/interview/agent/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interview_id: interviewId,
        user_message: userMessage ?? null,
      }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    onError?.((err as Error).message || "Network error");
    return;
  }

  if (!res.ok || !res.body) {
    let msg = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    onError?.(msg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    // Read until upstream closes the stream.
    // SSE frames are separated by a blank line.
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let frameEnd: number;
      while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);

        // Each frame is one or more "data: ..." lines. We only emit one
        // data field per frame on the backend, so just join data lines.
        const dataLines = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue;
        const json = dataLines.join("\n");
        let payload: {
          type?: string;
          text?: string;
          name?: string;
          message?: string;
          assistantMessage?: AssistantMessage;
        };
        try {
          payload = JSON.parse(json);
        } catch {
          continue;
        }

        switch (payload.type) {
          case "delta":
            if (payload.text) onDelta?.(payload.text);
            break;
          case "tool_use":
            onToolUse?.(payload.name || "tool");
            break;
          case "done":
            if (payload.assistantMessage) onDone?.(payload.assistantMessage);
            return;
          case "error":
            onError?.(payload.message || "Agent error");
            return;
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    onError?.((err as Error).message || "Stream error");
  }
}

export interface StreamMemoriesArgs {
  interviewId: string;
  onDone?: (proposals: ProposedMemory[]) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
}

export async function streamMemories({
  interviewId,
  onDone,
  onError,
  signal,
}: StreamMemoriesArgs): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/interview/agent/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interview_id: interviewId }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    onError?.((err as Error).message || "Network error");
    return;
  }

  if (!res.ok || !res.body) {
    let msg = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    onError?.(msg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let frameEnd: number;
      while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const dataLines = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue;
        const json = dataLines.join("\n");
        let payload: {
          type?: string;
          message?: string;
          proposals?: ProposedMemory[];
        };
        try {
          payload = JSON.parse(json);
        } catch {
          continue;
        }

        switch (payload.type) {
          case "done":
            onDone?.(payload.proposals || []);
            return;
          case "error":
            onError?.(payload.message || "Agent error");
            return;
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    onError?.((err as Error).message || "Stream error");
  }
}

export interface StreamFeedbackArgs {
  interviewId: string;
  onDelta?: (text: string) => void;
  onDone?: (feedback: string) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
}

export async function streamFeedback({
  interviewId,
  onDelta,
  onDone,
  onError,
  signal,
}: StreamFeedbackArgs): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/interview/agent/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interview_id: interviewId }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    onError?.((err as Error).message || "Network error");
    return;
  }

  if (!res.ok || !res.body) {
    let msg = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    onError?.(msg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let frameEnd: number;
      while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const dataLines = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue;
        const json = dataLines.join("\n");
        let payload: {
          type?: string;
          text?: string;
          message?: string;
          feedback?: string;
        };
        try {
          payload = JSON.parse(json);
        } catch {
          continue;
        }

        switch (payload.type) {
          case "delta":
            if (payload.text) onDelta?.(payload.text);
            break;
          case "done":
            onDone?.(payload.feedback || "");
            return;
          case "error":
            onError?.(payload.message || "Agent error");
            return;
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    onError?.((err as Error).message || "Stream error");
  }
}
