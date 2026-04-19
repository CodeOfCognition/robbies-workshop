"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { ChevronLeft, Mic, Copy, Check, Loader2 } from "lucide-react";
import "./transcriber.css";

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

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Waveform constants
const BAR_W = 3;
const BAR_GAP = 5;
const BAR_PITCH = BAR_W + BAR_GAP;
const VIZ_W = 600;
const VIZ_H = 56;
const VIZ_CY = VIZ_H / 2;
const BAR_COUNT = Math.ceil(VIZ_W / BAR_PITCH) + 2;
const BAR_INTERVAL = 65;

export default function TranscriberPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [statusText, setStatusText] = useState("Tap to speak");
  const [timer, setTimer] = useState("00:00");
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [lastError, setLastError] = useState<TranscribeError | null>(null);
  const [errorCopied, setErrorCopied] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // Audio analysis refs for waveform
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafIdRef = useRef(0);
  const startTimeRef = useRef(0);
  const barLevelsRef = useRef<number[]>([]);
  const lastBarTimeRef = useRef(0);
  const timeDataRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const barsElRef = useRef<SVGGElement>(null);
  const recognizingRef = useRef(false);

  // Tick loop for waveform + timer
  const tickRef = useRef<(() => void) | undefined>(undefined);

  tickRef.current = () => {
    if (!recognizingRef.current) return;
    const now = Date.now();
    const elapsed = Math.floor((now - startTimeRef.current) / 1000);
    setTimer(formatDuration(elapsed));

    const analyser = analyserRef.current;
    const timeData = timeDataRef.current;
    if (analyser && timeData) {
      if (now - lastBarTimeRef.current >= BAR_INTERVAL) {
        lastBarTimeRef.current = now;
        analyser.getFloatTimeDomainData(timeData);
        let sum = 0;
        for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
        const rms = Math.sqrt(sum / timeData.length);
        const level = Math.min(1, Math.pow(rms * 3.2, 0.8) * 1.2);
        barLevelsRef.current.push(level);
        if (barLevelsRef.current.length > BAR_COUNT) barLevelsRef.current.shift();
      }
      const progress = Math.min(1, (now - lastBarTimeRef.current) / BAR_INTERVAL);
      renderBars(progress);
    }
    rafIdRef.current = requestAnimationFrame(() => tickRef.current?.());
  };

  function renderBars(progress: number) {
    const el = barsElRef.current;
    if (!el) return;
    const levels = barLevelsRef.current;
    let svg = "";
    const offset = progress * BAR_PITCH;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const fromRight = levels.length - 1 - i;
      const x = VIZ_W - BAR_W - fromRight * BAR_PITCH - offset;
      if (x < -BAR_W) continue;
      const h = Math.max(2, level * (VIZ_H - 10));
      const y = VIZ_CY - h / 2;
      svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${BAR_W}" height="${h.toFixed(1)}" rx="1.5"/>`;
    }
    el.innerHTML = svg;
  }

  const startRecording = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatusText("Microphone permission denied");
      return;
    }
    streamRef.current = stream;

    // Set up audio analysis for waveform
    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;
    timeDataRef.current = new Float32Array(2048);
    barLevelsRef.current = [];
    lastBarTimeRef.current = 0;

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

      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      // Clean up audio context
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
        audioCtxRef.current = null;
      }
      analyserRef.current = null;
      cancelAnimationFrame(rafIdRef.current);
      if (barsElRef.current) barsElRef.current.innerHTML = "";
      barLevelsRef.current = [];

      const EMPTY_BLOB_THRESHOLD = 1024;
      let silentReason: "empty_blob" | "no_chunks" | "muted_track" | null = null;
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
        setStatusText(
          "Microphone appears silent. Opening a new tab usually fixes this after sleep.",
        );
        return;
      }

      setProcessing(true);
      setStatusText("Processing...");
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
          setStatusText("Transcription failed (config)");
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
          setStatusText(`Transcription failed (network, ${durationMs}ms)`);
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
          setStatusText(`Transcription failed (${res.status})`);
          return;
        }

        const data = await res.json();
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        setTranscriptions((prev) => [{ id, text: data.text }, ...prev]);
        setStatusText("Tap to speak");
      } finally {
        setProcessing(false);
      }
    });

    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    recognizingRef.current = true;
    setIsRecording(true);
    setStatusText("Listening\u2026");
    setTimer("00:00");
    startTimeRef.current = Date.now();
    rafIdRef.current = requestAnimationFrame(() => tickRef.current?.());
  }, []);

  const stopRecording = useCallback(() => {
    recognizingRef.current = false;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setTimer("00:00");
  }, []);

  const copyToClipboard = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafIdRef.current);
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
      }
    };
  }, []);

  return (
    <div className="transcriber-app min-h-dvh flex flex-col px-4 pt-safe">
      <header className="pt-12 pb-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="p-1">
            <ChevronLeft className="w-5 h-5 text-[var(--color-text-dim)]" />
          </Link>
          <div>
            <div className="flex items-center gap-[10px] mb-1">
              <div className="transcriber-dot" />
              <h1 className="transcriber-title">Transcriber</h1>
            </div>
            <p className="transcriber-subtitle ml-[17px]">Speak, and be written</p>
          </div>
        </div>
      </header>

      <div className="transcriber-stage">
        {/* Mic button */}
        <button
          className={`transcriber-mic${isRecording ? " recording" : ""}`}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={processing}
          aria-label={isRecording ? "Stop" : "Record"}
        >
          {processing ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : isRecording ? (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="3" />
            </svg>
          ) : (
            <Mic className="w-6 h-6" />
          )}
        </button>

        {/* Status */}
        <div className="transcriber-status">
          <div className="transcriber-status-text">{statusText}</div>
          {(isRecording || timer !== "00:00") && (
            <div className="transcriber-timer">{timer}</div>
          )}
        </div>

        {/* Waveform */}
        {isRecording && (
          <div className="transcriber-viz-wrap">
            <svg
              className="transcriber-viz"
              viewBox={`0 0 ${VIZ_W} ${VIZ_H}`}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="trFadeL" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="var(--color-bg)" stopOpacity="1" />
                  <stop offset="1" stopColor="var(--color-bg)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <g className="transcriber-viz-bars" ref={barsElRef} />
              <rect className="transcriber-viz-fade-l" x="0" y="0" width="80" height={VIZ_H} />
            </svg>
          </div>
        )}
      </div>

      {/* Error panel */}
      {lastError && (
        <div className="flex justify-center mt-6">
          <div className="transcriber-error max-w-lg">
            <pre>{JSON.stringify(lastError, null, 2)}</pre>
            <button
              className={`transcriber-icon-btn${errorCopied ? " copied" : ""}`}
              onClick={() => {
                navigator.clipboard
                  .writeText(JSON.stringify(lastError, null, 2))
                  .then(() => {
                    setErrorCopied(true);
                    setTimeout(() => setErrorCopied(false), 2000);
                  });
              }}
              title="Copy error"
            >
              {errorCopied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Transcription entries */}
      {transcriptions.length > 0 && (
        <div className="transcriber-entries max-w-lg mx-auto">
          {transcriptions.map((t) => (
            <div key={t.id} className="transcriber-entry">
              <p className="transcriber-entry-text">{t.text}</p>
              <button
                className={`transcriber-icon-btn${copiedId === t.id ? " copied" : ""}`}
                onClick={() => copyToClipboard(t.id, t.text)}
                title="Copy"
              >
                {copiedId === t.id ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
