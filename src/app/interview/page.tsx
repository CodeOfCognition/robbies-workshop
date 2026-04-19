"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2 } from "lucide-react";
import "./interview.css";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
const BACKEND_API_KEY = process.env.NEXT_PUBLIC_WORKSHOP_BACKEND_API_KEY;

function getSupportedMimeType(): string {
  const types = ["audio/webm", "audio/mp4", "audio/ogg"];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

type ViewName = "setup" | "preparing" | "chat" | "summary";

interface FileInfo {
  name: string;
  size: number;
}

interface ChatMessage {
  who: "ai" | "user";
  text: string;
  typing?: boolean;
}

const QUESTIONS = [
  "Let\u2019s start easy \u2014 walk me through the last project you shipped that you\u2019re proud of, and what your specific contribution was.",
  "The role leans heavily on ambiguous, cross-functional work. Tell me about a time priorities collided and how you resolved it.",
  "What\u2019s a piece of feedback you received in the last year that genuinely changed how you work?",
  "Walk me through how you\u2019d redesign our onboarding if you had four weeks and one engineer.",
  "When you think about the senior people you\u2019ve admired, what separated them from the merely competent?",
  "Last one \u2014 what\u2019s a question you haven\u2019t been asked in an interview that you wish you were?",
];

const SAMPLE_ANSWERS = [
  "Sure. Last quarter I led the checkout redesign at my current company \u2014 we\u2019d had an 18% drop-off on the shipping step for eight months. I owned the end-to-end design. Shipped it in March and we pulled drop-off down to 11%.",
  "Yeah, about a year ago we had a sales team pushing for a self-serve tier while our platform team wanted to consolidate auth. Both were called P0. I ran a working session with both leads, mapped the dependencies, and we ended up shipping auth first \u2014 it unblocked 70% of the sales team\u2019s asks anyway.",
  "A staff designer told me I was solving for the artifact, not the decision. I\u2019d been polishing mocks when the team needed a call made. Now I ship rougher earlier and save polish for after the decision.",
];

const INTERVIEW_TYPES = [
  { key: "hr", label: "HR screening" },
  { key: "hm", label: "Hiring manager screen" },
  { key: "system", label: "System design" },
  { key: "culture", label: "Culture fit" },
  { key: "research", label: "Research brainstorm" },
];

const PREP_STEPS = [
  "Reading r\u00e9sum\u00e9",
  "Parsing job description",
  "Shaping interviewer",
  "Drafting questions",
  "Almost ready",
];

const STRENGTHS = [
  {
    title: "Strong opening narrative",
    desc: "You anchored the first answer in a concrete project and carried that specificity across the next two. Interviewers remember specific first.",
  },
  {
    title: "Clear collaboration signal",
    desc: "The JD leans heavily on cross-functional work. You named four partner teams by role, not title \u2014 that reads as real.",
  },
];

const DELTAS = [
  {
    title: "Land the outcome",
    desc: "Two answers (Q3, Q5) ended on activity, not result. Close with a number, a decision, or a changed behavior \u2014 even if it\u2019s small.",
  },
  {
    title: "Shorten the setup",
    desc: "Your average answer spent 38% on context. For a skeptical interviewer, cut that to 15\u201320% and trust them to ask.",
  },
  {
    title: "Own the 2022 gap",
    desc: "You asked me to circle back and we didn\u2019t. Prepare a 2-sentence version of that story \u2014 not defensive, just factual.",
  },
];

const QA_SCORES = ["Strong", "Strong", "OK", "OK", "Strong", "Weak"];

// Waveform constants for compose bar
const BAR_W = 2.5;
const BAR_GAP = 3;
const BAR_PITCH = BAR_W + BAR_GAP;
const VIZ_W = 400;
const VIZ_H = 36;
const VIZ_CY = VIZ_H / 2;
const MAX_BARS = Math.ceil(VIZ_W / BAR_PITCH) + 2;
const BAR_INTERVAL = 60;

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function InterviewPage() {
  const [currentView, setCurrentView] = useState<ViewName>("setup");
  const [resumeFile, setResumeFile] = useState<FileInfo | null>(null);
  const [jobFile, setJobFile] = useState<FileInfo | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [interviewType, setInterviewType] = useState("hr");
  const [dragOverResume, setDragOverResume] = useState(false);
  const [dragOverJob, setDragOverJob] = useState(false);

  // Preparing
  const [prepStepStates, setPrepStepStates] = useState<
    ("idle" | "active" | "done")[]
  >(PREP_STEPS.map(() => "idle"));
  const prepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [isTypingAI, setIsTypingAI] = useState(false);
  const chatLogRef = useRef<HTMLDivElement>(null);

  // Compose bar — clean state machine
  type ComposeState = "idle" | "recording" | "transcribing" | "preview";
  const [composeState, setComposeState] = useState<ComposeState>("idle");
  const [composeTimer, setComposeTimer] = useState("00:00");
  const [previewText, setPreviewText] = useState("");

  // Mic / waveform refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeDataRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const barsRef = useRef<number[]>([]);
  const lastBarTimeRef = useRef(0);
  const recStartRef = useRef(0);
  const rafIdRef = useRef(0);
  const barsElRef = useRef<SVGGElement>(null);

  // MediaRecorder refs (for transcription)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Track question index at recording time so the stop handler uses the right value
  const qIdxAtRecordRef = useRef(0);

  // File input refs
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const jobInputRef = useRef<HTMLInputElement>(null);

  const canCreate = resumeFile !== null && jobFile !== null;

  // --- View transitions ---
  const goToView = useCallback((view: ViewName) => {
    setCurrentView(view);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  // --- Preparing animation ---
  const runPrep = useCallback(() => {
    setPrepStepStates(PREP_STEPS.map(() => "idle"));
    let i = 0;
    if (prepTimerRef.current) clearInterval(prepTimerRef.current);

    setPrepStepStates((prev) => {
      const next = [...prev];
      next[0] = "active";
      return next;
    });

    prepTimerRef.current = setInterval(() => {
      i++;
      setPrepStepStates((prev) => {
        const next = [...prev];
        if (i > 0 && i - 1 < next.length) {
          next[i - 1] = "done";
        }
        if (i >= PREP_STEPS.length) {
          if (prepTimerRef.current) clearInterval(prepTimerRef.current);
          setTimeout(() => {
            goToView("chat");
          }, 400);
          return next;
        }
        next[i] = "active";
        return next;
      });
    }, 720);
  }, [goToView]);

  // --- Chat ---
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }, 50);
  }, []);

  const addAIMessage = useCallback(
    (text: string) => {
      setIsTypingAI(true);
      setMessages((prev) => [...prev, { who: "ai", text, typing: true }]);
      scrollToBottom();

      // After a brief "typing" delay, reveal the message
      setTimeout(() => {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, typing: false } : m
          )
        );
        setIsTypingAI(false);
        scrollToBottom();
      }, 700 + text.length * 8);
    },
    [scrollToBottom]
  );

  const askNextRef = useRef<(idx: number) => void>(undefined);
  askNextRef.current = (idx: number) => {
    if (idx >= QUESTIONS.length) {
      setTimeout(() => {
        addAIMessage(
          "That\u2019s all I\u2019ve got for you. Nice job \u2014 I\u2019ll put together a debrief."
        );
        setTimeout(() => goToView("summary"), 2800);
      }, 600);
      return;
    }
    addAIMessage(QUESTIONS[idx]);
  };

  // Initialize chat when entering chat view
  useEffect(() => {
    if (currentView === "chat" && messages.length === 0) {
      setTimeout(() => askNextRef.current?.(0), 300);
    }
  }, [currentView, messages.length]);

  // Start prep when entering preparing view
  useEffect(() => {
    if (currentView === "preparing") {
      runPrep();
    }
    return () => {
      if (prepTimerRef.current) clearInterval(prepTimerRef.current);
    };
  }, [currentView, runPrep]);

  // --- Recording / waveform ---
  const tickRef = useRef<(() => void) | undefined>(undefined);
  const recognizingRef = useRef(false);

  tickRef.current = () => {
    if (!recognizingRef.current) return;
    const now = Date.now();
    setComposeTimer(formatTime(now - recStartRef.current));

    const analyser = analyserRef.current;
    const timeData = timeDataRef.current;
    if (analyser && timeData) {
      if (now - lastBarTimeRef.current >= BAR_INTERVAL) {
        lastBarTimeRef.current = now;
        analyser.getFloatTimeDomainData(timeData);
        let sum = 0;
        for (let i = 0; i < timeData.length; i++)
          sum += timeData[i] * timeData[i];
        const rms = Math.sqrt(sum / timeData.length);
        const level = Math.min(1, Math.pow(rms * 3.2, 0.8));
        barsRef.current.push(level);
        if (barsRef.current.length > MAX_BARS) barsRef.current.shift();
      }
      renderBars();
    }
    rafIdRef.current = requestAnimationFrame(() => tickRef.current?.());
  };

  function renderBars() {
    const el = barsElRef.current;
    if (!el) return;
    const levels = barsRef.current;
    let svg = "";
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const fromRight = levels.length - 1 - i;
      const x = VIZ_W - BAR_W - fromRight * BAR_PITCH;
      if (x < -BAR_W) continue;
      const h = Math.max(2, level * (VIZ_H - 8));
      const y = VIZ_CY - h / 2;
      svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${BAR_W}" height="${h.toFixed(1)}" rx="1"/>`;
    }
    el.innerHTML = svg;
  }

  const startRecording = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return;
    }
    streamRef.current = stream;

    // Audio analysis for waveform visualization
    const audioCtx = new (window.AudioContext ||
      (
        window as unknown as {
          webkitAudioContext: typeof AudioContext;
        }
      ).webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;
    timeDataRef.current = new Float32Array(2048);

    // MediaRecorder for capturing audio
    const mimeType = getSupportedMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    chunksRef.current = [];

    recorder.addEventListener("dataavailable", (e) => {
      chunksRef.current.push(e.data);
    });

    // Everything after stop happens inside this handler — no race conditions.
    recorder.addEventListener("stop", async () => {
      const mType = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mType });

      // Clean up stream + audio context
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
        audioCtxRef.current = null;
      }
      analyserRef.current = null;
      cancelAnimationFrame(rafIdRef.current);
      if (barsElRef.current) barsElRef.current.innerHTML = "";
      barsRef.current = [];

      const capturedQIdx = qIdxAtRecordRef.current;

      // Silent / empty check
      if (blob.size < 1024) {
        setComposeState("idle");
        return;
      }

      // If backend isn't configured, fall back to mock answer
      if (!BACKEND_URL || !BACKEND_API_KEY) {
        const sample =
          SAMPLE_ANSWERS[capturedQIdx] ||
          "That\u2019s a good question \u2014 here\u2019s how I think about it\u2026";
        setPreviewText(sample);
        setComposeState("preview");
        return;
      }

      // Transcribe via backend
      const ext = mType.includes("mp4") ? "recording.mp4" : "recording.webm";
      const formData = new FormData();
      formData.append("audio_data", blob, ext);

      try {
        const res = await fetch(`${BACKEND_URL}/transcribe`, {
          method: "POST",
          body: formData,
          headers: { "X-API-Key": BACKEND_API_KEY },
        });

        if (!res.ok) {
          // HTTP error — fall back to mock
          const sample =
            SAMPLE_ANSWERS[capturedQIdx] ||
            "That\u2019s a good question \u2014 here\u2019s how I think about it\u2026";
          setPreviewText(sample);
          setComposeState("preview");
          return;
        }

        const data = await res.json();
        const text = data.text?.trim();

        if (!text) {
          setComposeState("idle");
          return;
        }

        setPreviewText(text);
        setComposeState("preview");
      } catch {
        // Network error — fall back to mock
        const sample =
          SAMPLE_ANSWERS[capturedQIdx] ||
          "That\u2019s a good question \u2014 here\u2019s how I think about it\u2026";
        setPreviewText(sample);
        setComposeState("preview");
      }
    });

    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    qIdxAtRecordRef.current = qIdx;

    barsRef.current = [];
    lastBarTimeRef.current = 0;
    recStartRef.current = Date.now();
    recognizingRef.current = true;
    setComposeState("recording");
    setComposeTimer("00:00");
    rafIdRef.current = requestAnimationFrame(() => tickRef.current?.());
  }, [qIdx]);

  const stopRecording = useCallback(() => {
    recognizingRef.current = false;
    setComposeState("transcribing");

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleSend = useCallback(() => {
    const text = previewText.trim();
    if (!text) {
      setComposeState("idle");
      return;
    }
    setMessages((prev) => [...prev, { who: "user", text }]);
    setComposeState("idle");
    setPreviewText("");
    setComposeTimer("00:00");
    const nextIdx = qIdx + 1;
    setQIdx(nextIdx);
    setTimeout(() => askNextRef.current?.(nextIdx), 900);
  }, [previewText, qIdx]);

  const handleDiscard = useCallback(() => {
    setComposeState("idle");
    setPreviewText("");
    setComposeTimer("00:00");
  }, []);

  // Spacebar handler for chat view
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement
      )
        return;
      if (currentView !== "chat") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (composeState === "recording") stopRecording();
        else if (composeState === "idle") startRecording();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [currentView, composeState, startRecording, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognizingRef.current = false;
      cancelAnimationFrame(rafIdRef.current);
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
      }
    };
  }, []);

  // --- File drop handlers ---
  const handleFileDrop = useCallback(
    (
      e: React.DragEvent,
      setter: (f: FileInfo | null) => void,
      setDragOver: (v: boolean) => void
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) setter({ name: f.name, size: f.size });
    },
    []
  );

  const handleFileSelect = useCallback(
    (
      e: React.ChangeEvent<HTMLInputElement>,
      setter: (f: FileInfo | null) => void
    ) => {
      const f = e.target.files?.[0];
      if (f) setter({ name: f.name, size: f.size });
    },
    []
  );

  // --- Reset for "Run again" / "New interview" ---
  const handleRunAgain = useCallback(() => {
    setMessages([]);
    setQIdx(0);
    setComposeState("idle");
    setPreviewText("");
    setComposeTimer("00:00");
    goToView("preparing");
  }, [goToView]);

  const handleNewInterview = useCallback(() => {
    setMessages([]);
    setQIdx(0);
    setComposeState("idle");
    setPreviewText("");
    setComposeTimer("00:00");
    setResumeFile(null);
    setJobFile(null);
    goToView("setup");
  }, [goToView]);

  // --- Render helpers ---
  const renderDropZone = (
    kind: "resume" | "job",
    file: FileInfo | null,
    setter: (f: FileInfo | null) => void,
    inputRef: React.RefObject<HTMLInputElement | null>,
    isDragOver: boolean,
    setDragOver: (v: boolean) => void
  ) => {
    const kicker = kind === "resume" ? "01 \u00b7 R\u00e9sum\u00e9" : "02 \u00b7 Job posting";
    const title =
      kind === "resume" ? "Your r\u00e9sum\u00e9" : "Job you\u2019re applying for";
    const hint =
      kind === "resume"
        ? "Drop a PDF, .docx or .txt \u2014 or click to browse."
        : "The posting, JD, or role description.";

    return (
      <div
        className={`interview-drop${file ? " filled" : ""}${isDragOver ? " dragover" : ""}`}
        onClick={(e) => {
          if (
            !(e.target as HTMLElement).closest(".interview-drop-clear") &&
            inputRef.current
          ) {
            inputRef.current.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
        }}
        onDrop={(e) => handleFileDrop(e, setter, setDragOver)}
      >
        <div className="interview-drop-kicker">{kicker}</div>
        <div className="interview-drop-glyph">
          {kind === "resume" ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <polyline points="14 3 14 8 19 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="13" y2="17" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="6" width="18" height="14" rx="2" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="3" y1="12" x2="21" y2="12" />
            </svg>
          )}
        </div>
        {file ? (
          <div>
            <div className="interview-drop-file-name">{file.name}</div>
            <div className="interview-drop-file-meta">
              {formatSize(file.size)} &middot;{" "}
              {(file.name.split(".").pop() || "").toUpperCase()}
            </div>
          </div>
        ) : (
          <div>
            <div className="interview-drop-title">{title}</div>
            <div className="interview-drop-hint">{hint}</div>
          </div>
        )}
        {file && (
          <button
            className="interview-drop-clear"
            aria-label="Remove"
            onClick={(e) => {
              e.stopPropagation();
              setter(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              width="12"
              height="12"
              strokeWidth="1.6"
            >
              <path
                d="M18 6L6 18M6 6l12 12"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          hidden
          onChange={(e) => handleFileSelect(e, setter)}
        />
      </div>
    );
  };

  return (
    <div className="interview-app min-h-dvh flex flex-col px-4 pt-safe">
      <header className="pt-12 pb-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="p-1">
            <ChevronLeft className="w-5 h-5 text-[var(--color-text-dim)]" />
          </Link>
          <div>
            <div className="flex items-center gap-[10px] mb-1">
              <div className="interview-dot" />
              <h1 className="interview-title">Interview Practice</h1>
            </div>
            <p className="interview-subtitle ml-[17px]">
              Rehearse before the room
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-[760px] w-full mx-auto flex flex-col flex-1">
        {/* ===== SETUP VIEW ===== */}
        {currentView === "setup" && (
          <div className="flex flex-col flex-1">
            <div className="interview-modes">
              <button className="interview-mode-chip active">
                Mock Interview
              </button>
              <button className="interview-mode-chip" disabled>
                Resume Feedback{" "}
                <span className="pill-soon">Soon</span>
              </button>
            </div>

            <div className="interview-drops">
              {renderDropZone(
                "resume",
                resumeFile,
                setResumeFile,
                resumeInputRef,
                dragOverResume,
                setDragOverResume
              )}
              {renderDropZone(
                "job",
                jobFile,
                setJobFile,
                jobInputRef,
                dragOverJob,
                setDragOverJob
              )}
            </div>

            {/* Advanced settings */}
            <div
              className={`interview-advanced${advancedOpen ? " open" : ""}`}
            >
              <button
                className="interview-adv-toggle"
                onClick={() => setAdvancedOpen(!advancedOpen)}
              >
                <svg
                  className="chev"
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <path
                    d="M3 1l4 4-4 4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Interviewer notes
                <span className="text-[var(--color-text-faint)] tracking-[0.04em] normal-case text-[11px] ml-1">
                  &mdash; optional, injected into the prompt
                </span>
              </button>

              <div className="interview-adv-body">
                <div>
                  <div className="interview-adv-label">Interview type</div>
                  <div className="interview-adv-chips">
                    {INTERVIEW_TYPES.map((t) => (
                      <button
                        key={t.key}
                        className={`interview-adv-chip${interviewType === t.key ? " active" : ""}`}
                        onClick={() => setInterviewType(t.key)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="interview-adv-label">
                    Notes for the interviewer
                  </div>
                  <textarea
                    className="interview-adv-textarea"
                    placeholder="e.g. Press me on ambiguous prioritization. Probe the gap in 2022. Play a skeptical-but-fair Director of Eng."
                  />
                </div>

                <div className="interview-adv-row">
                  <div>
                    <div className="interview-adv-row-title">
                      Interviewer speaks aloud
                    </div>
                    <div className="interview-adv-row-sub">
                      Text-to-speech for AI questions &mdash; coming later.
                    </div>
                  </div>
                  <div className="flex items-center">
                    <span
                      className="interview-switch"
                      aria-disabled="true"
                    />
                    <span className="interview-coming-soon">Soon</span>
                  </div>
                </div>
              </div>
            </div>

            <button
              className="interview-primary"
              disabled={!canCreate}
              onClick={() => goToView("preparing")}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              Create interview
            </button>
          </div>
        )}

        {/* ===== PREPARING VIEW ===== */}
        {currentView === "preparing" && (
          <div className="interview-preparing">
            <div className="interview-prep-glyph">
              <svg viewBox="0 0 120 120">
                <circle
                  className="interview-prep-ring r1"
                  cx="60"
                  cy="60"
                  r="54"
                  strokeDasharray="6 8"
                />
                <circle
                  className="interview-prep-ring r2"
                  cx="60"
                  cy="60"
                  r="42"
                  strokeDasharray="3 10"
                />
                <circle
                  className="interview-prep-ring r3"
                  cx="60"
                  cy="60"
                  r="30"
                  strokeDasharray="2 6"
                />
              </svg>
              <div className="interview-prep-core" />
            </div>
            <div className="flex flex-col items-center gap-[10px] text-center">
              <div className="interview-prep-title">
                Preparing your interview
              </div>
              <div className="interview-prep-steps">
                {PREP_STEPS.map((step, i) => (
                  <div
                    key={i}
                    className={`interview-prep-step${prepStepStates[i] === "active" ? " active" : ""}${prepStepStates[i] === "done" ? " done" : ""}`}
                  >
                    {step}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ===== CHAT VIEW ===== */}
        {currentView === "chat" && (
          <div className="flex flex-col flex-1">
            <div className="interview-chat-header">
              <div>
                <div className="interview-chat-role">
                  Senior Product Designer
                </div>
                <div className="interview-chat-company">
                  Northwind &middot; Round 1 &middot; Behavioral
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="interview-voice-toggle"
                  title="Voice mode \u2014 coming later"
                >
                  <span className="interview-voice-dot-off" />
                  Voice &middot; Soon
                </div>
                <div className="interview-chat-counter">
                  <b>{Math.min(qIdx + 1, QUESTIONS.length)}</b> /{" "}
                  {QUESTIONS.length}
                </div>
              </div>
            </div>

            <div className="interview-chat-log" ref={chatLogRef}>
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`interview-msg ${m.who}`}
                >
                  <div className="interview-msg-who">
                    {m.who === "ai" ? "Interviewer" : "You"}
                  </div>
                  <div className="interview-msg-bubble">
                    {m.typing ? (
                      <div className="interview-typing-dots">
                        <span />
                        <span />
                        <span />
                      </div>
                    ) : (
                      m.text
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div
              className={`interview-compose${composeState === "recording" ? " active-viz" : ""}${composeState === "transcribing" ? " transcribing" : ""}${composeState === "preview" ? " previewing" : ""}`}
            >
              <div
                className={`interview-compose-inner${composeState === "recording" ? " recording" : ""}`}
              >
                {/* Mic / action button */}
                {composeState === "transcribing" ? (
                  <div className="interview-mic-btn" style={{ background: "var(--iv-accent)", cursor: "default" }}>
                    <Loader2 className="w-4 h-4 animate-spin text-[#1a1a1a]" />
                  </div>
                ) : composeState === "preview" ? null : (
                  <button
                    className={`interview-mic-btn${composeState === "recording" ? " recording" : ""}`}
                    onClick={
                      composeState === "recording" ? stopRecording : startRecording
                    }
                    disabled={isTypingAI}
                    aria-label="Record answer"
                  >
                    {composeState === "recording" ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <rect x="7" y="7" width="10" height="10" rx="2" fill="#fff" />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="9" y="3" width="6" height="11" rx="3" />
                        <path d="M5 11a7 7 0 0 0 14 0" />
                        <line x1="12" y1="18" x2="12" y2="22" />
                      </svg>
                    )}
                  </button>
                )}

                {/* Body: hint, waveform, transcribing, or preview */}
                <div className="interview-compose-body">
                  {composeState === "idle" && (
                    <div className="interview-compose-hint">
                      Tap to answer{" "}
                      <span className="kbd">Space</span>
                    </div>
                  )}
                  {composeState === "recording" && (
                    <div className="interview-compose-viz-wrap" style={{ display: "flex" }}>
                      <svg
                        className="interview-compose-viz"
                        viewBox={`0 0 ${VIZ_W} ${VIZ_H}`}
                        preserveAspectRatio="none"
                      >
                        <g className="interview-compose-bars" ref={barsElRef} />
                      </svg>
                    </div>
                  )}
                  {composeState === "transcribing" && (
                    <div className="interview-compose-hint">
                      Transcribing&hellip;
                    </div>
                  )}
                  {composeState === "preview" && (
                    <textarea
                      className="interview-preview-textarea"
                      value={previewText}
                      onChange={(e) => setPreviewText(e.target.value)}
                      autoFocus
                    />
                  )}
                </div>

                {/* Timer (recording) */}
                {composeState === "recording" && (
                  <div className="interview-compose-timer">
                    {composeTimer}
                  </div>
                )}

                {/* Preview actions */}
                {composeState === "preview" && (
                  <div className="interview-preview-actions">
                    <button className="interview-preview-send" onClick={handleSend}>
                      Send
                    </button>
                    <button className="interview-preview-discard" onClick={handleDiscard}>
                      Redo
                    </button>
                  </div>
                )}
              </div>
              <div className="flex justify-center mt-3">
                <button
                  className="interview-compose-end-btn"
                  onClick={() => goToView("summary")}
                >
                  End interview
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== SUMMARY VIEW ===== */}
        {currentView === "summary" && (
          <div className="flex flex-col py-3">
            <div className="pb-9">
              <div className="interview-summary-kicker">
                Debrief &middot; Round 1
              </div>
              <h2 className="interview-summary-title">
                Solid. You held the narrative &mdash; lost the landing
                twice.
              </h2>
              <p className="interview-summary-sub">
                Senior Product Designer at Northwind &middot;{" "}
                {QUESTIONS.length} questions, 14 min 32s. Here&rsquo;s
                what an interviewer would likely take from that room.
              </p>
            </div>

            <div className="interview-summary-stats">
              <div className="interview-stat">
                <div className="interview-stat-label">Duration</div>
                <div className="interview-stat-value">14:32</div>
              </div>
              <div className="interview-stat">
                <div className="interview-stat-label">Words spoken</div>
                <div className="interview-stat-value">1,284</div>
              </div>
              <div className="interview-stat">
                <div className="interview-stat-label">Pace</div>
                <div className="interview-stat-value">
                  148 <span className="unit">wpm</span>
                </div>
              </div>
            </div>

            {/* Strengths */}
            <div className="mb-8">
              <div className="flex items-baseline justify-between gap-3 mb-[14px]">
                <div className="interview-section-title">
                  What worked
                </div>
                <div className="interview-section-sub">
                  + Strengths
                </div>
              </div>
              <div className="flex flex-col gap-[10px]">
                {STRENGTHS.map((s, i) => (
                  <div key={i} className="interview-feedback-item">
                    <div className="interview-feedback-marker plus" />
                    <div>
                      <div className="interview-feedback-title">
                        {s.title}
                      </div>
                      <div className="interview-feedback-desc">
                        {s.desc}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Deltas */}
            <div className="mb-8">
              <div className="flex items-baseline justify-between gap-3 mb-[14px]">
                <div className="interview-section-title">
                  What to sharpen
                </div>
                <div className="interview-section-sub">
                  &#x25B3; Deltas
                </div>
              </div>
              <div className="flex flex-col gap-[10px]">
                {DELTAS.map((d, i) => (
                  <div key={i} className="interview-feedback-item">
                    <div className="interview-feedback-marker delta" />
                    <div>
                      <div className="interview-feedback-title">
                        {d.title}
                      </div>
                      <div className="interview-feedback-desc">
                        {d.desc}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Q&A */}
            <div className="mb-8">
              <div className="flex items-baseline justify-between gap-3 mb-[14px]">
                <div className="interview-section-title">
                  Questions &amp; answers
                </div>
                <div className="interview-section-sub">
                  Full transcript
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {QUESTIONS.map((q, i) => (
                  <div key={i} className="interview-qa-item">
                    <div className="interview-qa-summary">
                      <div className="interview-qa-num">
                        Q{String(i + 1).padStart(2, "0")}
                      </div>
                      <div className="interview-qa-q">{q}</div>
                      <div className="interview-qa-score">
                        <b>{QA_SCORES[i] || "\u2014"}</b>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-[10px] flex-wrap mt-5">
              <button
                className="interview-primary"
                style={{ marginTop: 0, alignSelf: "flex-start", width: "auto" }}
                onClick={handleRunAgain}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M23 4v6h-6" />
                  <path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
                  <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
                </svg>
                Run it again
              </button>
              <button
                className="interview-secondary"
                onClick={handleNewInterview}
              >
                New interview
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
