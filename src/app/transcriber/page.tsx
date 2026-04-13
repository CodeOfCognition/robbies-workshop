"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  Mic,
  Square,
  Copy,
  Check,
  Loader2,
} from "lucide-react";

interface Transcription {
  id: string;
  text: string;
}

type TranscribeError =
  | {
      stage: "http";
      status: number;
      statusText: string;
      bodyText: string;
      durationMs: number;
      blobSize: number;
      blobType: string;
    }
  | {
      stage: "network";
      name: string;
      message: string;
      cause?: string;
      durationMs: number;
      blobSize: number;
      blobType: string;
    }
  | {
      stage: "config";
      message: string;
    }
  | {
      stage: "silent";
      reason: "empty_blob" | "no_chunks" | "muted_track";
      blobSize: number;
      blobType: string;
      chunkCount: number;
      nonEmptyChunkCount: number;
      trackMuted: boolean;
      trackReadyState: MediaStreamTrackState;
    };

function reportTranscribeError(err: TranscribeError) {
  try {
    fetch("/api/telemetry/transcribe-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(err),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
const BACKEND_API_KEY = process.env.NEXT_PUBLIC_WORKSHOP_BACKEND_API_KEY;

function getSupportedMimeType(): string {
  const types = ["audio/webm", "audio/mp4", "audio/ogg"];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export default function TranscriberPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Tap the mic to start recording.");
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [lastError, setLastError] = useState<TranscribeError | null>(null);
  const [errorCopied, setErrorCopied] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = getSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      let nonEmptyChunkCount = 0;

      recorder.addEventListener("dataavailable", (e) => {
        chunksRef.current.push(e.data);
        if (e.data && e.data.size > 0) nonEmptyChunkCount += 1;
      });

      recorder.addEventListener("stop", async () => {
        const mType = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mType });

        const audioTrack = stream.getAudioTracks()[0];
        const trackMuted = audioTrack?.muted ?? false;
        const trackReadyState = audioTrack?.readyState ?? "ended";

        // Stop mic access
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const EMPTY_BLOB_THRESHOLD = 1024;
        let silentReason: "empty_blob" | "no_chunks" | "muted_track" | null =
          null;
        if (nonEmptyChunkCount === 0) silentReason = "no_chunks";
        else if (blob.size < EMPTY_BLOB_THRESHOLD) silentReason = "empty_blob";
        else if (trackMuted) silentReason = "muted_track";

        if (silentReason) {
          const err: TranscribeError = {
            stage: "silent",
            reason: silentReason,
            blobSize: blob.size,
            blobType: blob.type,
            chunkCount: chunksRef.current.length,
            nonEmptyChunkCount,
            trackMuted,
            trackReadyState,
          };
          setLastError(err);
          reportTranscribeError(err);
          setStatus(
            "Microphone appears silent. Opening a new tab usually fixes this after sleep.",
          );
          return;
        }

        setProcessing(true);
        setStatus("Processing transcription...");
        setLastError(null);

        const ext = mType.includes("mp4") ? "recording.mp4" : "recording.webm";
        const formData = new FormData();
        formData.append("audio_data", blob, ext);

        const started = performance.now();
        try {
          if (!BACKEND_URL || !BACKEND_API_KEY) {
            const err: TranscribeError = {
              stage: "config",
              message:
                "Missing NEXT_PUBLIC_BACKEND_URL or NEXT_PUBLIC_WORKSHOP_BACKEND_API_KEY",
            };
            setLastError(err);
            reportTranscribeError(err);
            setStatus("Transcription failed (config)");
            return;
          }

          let res: Response;
          try {
            res = await fetch(`${BACKEND_URL}/transcribe`, {
              method: "POST",
              body: formData,
              headers: { "X-API-Key": BACKEND_API_KEY },
            });
          } catch (e) {
            const durationMs = Math.round(performance.now() - started);
            const errObj = e as Error & { cause?: unknown };
            const err: TranscribeError = {
              stage: "network",
              name: errObj?.name ?? "Error",
              message: errObj?.message ?? String(e),
              cause:
                errObj?.cause !== undefined ? String(errObj.cause) : undefined,
              durationMs,
              blobSize: blob.size,
              blobType: blob.type,
            };
            setLastError(err);
            reportTranscribeError(err);
            setStatus(`Transcription failed (network, ${durationMs}ms)`);
            return;
          }

          if (!res.ok) {
            const durationMs = Math.round(performance.now() - started);
            const bodyText = await res.text().catch(() => "");
            const err: TranscribeError = {
              stage: "http",
              status: res.status,
              statusText: res.statusText,
              bodyText,
              durationMs,
              blobSize: blob.size,
              blobType: blob.type,
            };
            setLastError(err);
            reportTranscribeError(err);
            setStatus(`Transcription failed (${res.status})`);
            return;
          }

          const data = await res.json();
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          setTranscriptions((prev) => [{ id, text: data.text }, ...prev]);
          setStatus("Transcription completed. Tap the mic to record again.");
        } finally {
          setProcessing(false);
        }
      });

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setStatus("Recording...");
    } catch {
      setStatus("Microphone access denied.");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const copyToClipboard = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  return (
    <div className="min-h-dvh pb-8 animate-fade-in">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[var(--color-bg)]/95 backdrop-blur-sm border-b border-[var(--color-border)] px-4 py-4 flex items-center gap-3">
        <Link href="/" className="p-1">
          <ChevronLeft className="w-5 h-5 text-[var(--color-text-dim)]" />
        </Link>
        <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-wide">
          TRANSCRIBER
        </h2>
      </header>

      <div className="px-4 pt-8 flex flex-col items-center">
        {/* Record Button */}
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={processing}
          className="w-20 h-20 rounded-full flex items-center justify-center transition-all active:scale-95 disabled:opacity-50"
          style={{
            backgroundColor: isRecording ? "#ef4444" : "var(--color-amber)",
            boxShadow: isRecording
              ? "0 0 20px rgba(239,68,68,0.4)"
              : "0 0 20px rgba(245,158,11,0.2)",
          }}
        >
          {processing ? (
            <Loader2 className="w-8 h-8 text-black animate-spin" />
          ) : isRecording ? (
            <Square className="w-7 h-7 text-white" fill="white" />
          ) : (
            <Mic className="w-8 h-8 text-black" />
          )}
        </button>

        {/* Status */}
        <p className="mt-4 mb-2 text-sm text-[var(--color-text-dim)] text-center font-[family-name:var(--font-mono)]">
          {status}
        </p>

        {/* Error detail */}
        {lastError && (
          <div className="mb-8 w-full max-w-lg">
            <div className="bg-[var(--color-surface)] border border-red-500/40 rounded-xl p-3">
              <div className="flex items-start gap-2">
                <pre className="flex-1 text-[11px] leading-snug text-red-300 font-[family-name:var(--font-mono)] whitespace-pre-wrap break-all overflow-x-auto">
                  {JSON.stringify(lastError, null, 2)}
                </pre>
                <button
                  onClick={() => {
                    navigator.clipboard
                      .writeText(JSON.stringify(lastError, null, 2))
                      .then(() => {
                        setErrorCopied(true);
                        setTimeout(() => setErrorCopied(false), 2000);
                      });
                  }}
                  className="shrink-0 p-1.5 text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] transition-colors"
                  title="Copy error"
                >
                  {errorCopied ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        {!lastError && <div className="mb-6" />}

        {/* Recording pulse indicator */}
        {isRecording && (
          <div className="mb-6 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs text-red-400 font-[family-name:var(--font-mono)]">
              RECORDING
            </span>
          </div>
        )}

        {/* Transcriptions */}
        {transcriptions.length > 0 && (
          <div className="w-full max-w-lg space-y-3 stagger">
            {transcriptions.map((t) => (
              <div
                key={t.id}
                className="flex items-start gap-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4"
              >
                <p className="flex-1 text-sm text-[var(--color-text)] leading-relaxed">
                  {t.text}
                </p>
                <button
                  onClick={() => copyToClipboard(t.id, t.text)}
                  className="shrink-0 p-1.5 text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] transition-colors"
                  title="Copy to clipboard"
                >
                  {copiedId === t.id ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {transcriptions.length === 0 && !isRecording && !processing && (
          <div className="mt-8 text-center animate-fade-up">
            <Mic
              className="w-16 h-16 mx-auto mb-4 text-[var(--color-text-faint)]"
              strokeWidth={1}
            />
            <p className="text-[var(--color-text-dim)] mb-1">
              No transcriptions yet
            </p>
            <p className="text-[var(--color-text-faint)] text-sm">
              Record some audio to get started
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
