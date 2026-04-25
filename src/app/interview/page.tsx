"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import "./interview.css";
import {
  type Profile,
  type Job,
  type InterviewRecord,
  type Memory,
  type TranscriptMsg,
  type ProposedMemory,
  type InterviewType,
} from "@/lib/interview-mapper";
import {
  listProfiles,
  createProfile,
  updateProfile as apiUpdateProfile,
  deleteProfile as apiDeleteProfile,
  uploadResume,
  deleteResume,
  getResumeSignedUrl,
  listJobs,
  createJob,
  updateJob as apiUpdateJob,
  deleteJob as apiDeleteJob,
  listInterviews,
  createInterview,
  updateInterview,
  deleteInterview as apiDeleteInterview,
} from "@/lib/interview-store";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
const BACKEND_API_KEY = process.env.NEXT_PUBLIC_WORKSHOP_BACKEND_API_KEY;

const PANE_KEY = "interview.pane";
const ACTIVE_PROFILE_KEY = "interview.activeProfileId";

// ===========================================================================
//  IN-APP CONFIRM / ALERT  (replaces window.confirm and window.alert)
// ===========================================================================
interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  hideCancel?: boolean;
}
interface ActiveDialog extends ConfirmRequest {
  resolve: (ok: boolean) => void;
}

// Module-level dispatcher installed by the mounted ConfirmModalHost. Lets
// any component (or non-component code) call askConfirm / showAlert without
// prop-drilling.
let dialogDispatch: ((req: ActiveDialog) => void) | null = null;

function askConfirm(req: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    if (!dialogDispatch) {
      // Fallback so we never silently break — but the host should always be
      // mounted while the page is live.
      resolve(true);
      return;
    }
    dialogDispatch({ ...req, resolve });
  });
}

function showAlert(title: string, message?: string): Promise<void> {
  return askConfirm({
    title,
    message,
    hideCancel: true,
    confirmLabel: "OK",
  }).then(() => undefined);
}

// ===========================================================================
//  TYPES
// ===========================================================================
type Pane = "interviews" | "jobs" | "profile";
type OverlayName = "prep" | "chat" | "summary" | null;
type ComposeState = "idle" | "recording" | "transcribing" | "preview";

interface Store {
  activeProfileId: string;
  profiles: Profile[];
  jobs: Job[];
  interviews: InterviewRecord[];
}

interface ChatMessage {
  who: "ai" | "user";
  text: string;
  typing?: boolean;
}

// ===========================================================================
//  CONSTANTS / SEED DATA
// ===========================================================================
const QUESTIONS = [
  "Let’s start easy — walk me through the last project you shipped that you’re proud of, and what your specific contribution was.",
  "Tell me about a time priorities collided across teams and how you resolved it.",
  "What’s a piece of feedback you received in the last year that genuinely changed how you work?",
  "Walk me through how you’d approach the first 30 days in this role.",
  "When you think about senior people you’ve admired, what separated them from the merely competent?",
  "Last one — what’s a question you haven’t been asked in an interview that you wish you were?",
];

const PREP_STEPS = [
  "Reading your résumé",
  "Reviewing job + research",
  "Recalling past memories",
  "Drafting questions",
  "Almost ready",
];

const TYPE_LABELS: Record<InterviewType, string> = {
  hr: "HR screening",
  hm: "Hiring manager",
  other: "Other",
};

const SAMPLE_FEEDBACK = `Overall, this read as a **mid-confidence** round. You opened cleanly and held a clear narrative for the first three answers, then started losing the landing as the questions got harder. The interviewer would walk away remembering your specifics — not your conclusions.

## What worked

- **Anchored the opening in a real project.** First answer named a system, a team size, and a constraint. That bought trust for the next two answers to also be specific.
- **Collaboration signal was clean.** You named four partner teams by role, not title — reads as someone who actually shipped with them, not someone who's reciting an org chart.
- **Voice settled around minute four.** Hedges dropped, sentences tightened. That version of you should show up sooner.

## What to sharpen

- **Land the outcome.** Two answers ended on activity ("we ran research, we shipped a prototype") instead of result. Close on a number, a decision, or a changed behavior — even one is enough.
- **Shorten the setup.** Your average answer spent ~38% on context before getting to the action. Aim for 15–20%. You can trust the interviewer to ask follow-ups if they need more background.
- **One "I made the call" story is missing.** Your prioritization example slid into "we discussed and aligned." For HM rounds especially, they need to hear you owning a decision that wasn't unanimous.

## Net read

Strong specificity, soft endings. Fix the closes and this is a confident round.`;

const EMPTY_STORE: Store = {
  activeProfileId: "",
  profiles: [],
  jobs: [],
  interviews: [],
};

// ===========================================================================
//  MARKDOWN RENDERER
// ===========================================================================
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

function inlineFmt(s: string): string {
  s = escapeHtml(s);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?:^|\W)\*([^*]+)\*(?=\W|$)/g, (m) =>
    m.replace(/\*([^*]+)\*/, "<em>$1</em>")
  );
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );
  return s;
}

function renderMarkdown(src: string): string {
  if (!src || !src.trim()) return "";
  const lines = src.split("\n");
  const out: string[] = [];
  let inList: "ul" | "ol" | null = null;
  let inPara = false;
  const closeBlocks = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
    if (inPara) {
      out.push("</p>");
      inPara = false;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      closeBlocks();
      continue;
    }
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      closeBlocks();
      const level = Math.min(h[1].length, 3);
      out.push(`<h${level}>${inlineFmt(h[2])}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeBlocks();
      out.push("<hr>");
      continue;
    }
    const ul = /^[\-\*]\s+(.+)$/.exec(line);
    const ol = /^\d+\.\s+(.+)$/.exec(line);
    if (ul) {
      if (inPara) {
        out.push("</p>");
        inPara = false;
      }
      if (inList !== "ul") {
        if (inList) out.push(`</${inList}>`);
        out.push("<ul>");
        inList = "ul";
      }
      out.push(`<li>${inlineFmt(ul[1])}</li>`);
      continue;
    }
    if (ol) {
      if (inPara) {
        out.push("</p>");
        inPara = false;
      }
      if (inList !== "ol") {
        if (inList) out.push(`</${inList}>`);
        out.push("<ol>");
        inList = "ol";
      }
      out.push(`<li>${inlineFmt(ol[1])}</li>`);
      continue;
    }
    const bq = /^>\s?(.*)$/.exec(line);
    if (bq) {
      closeBlocks();
      out.push(`<blockquote>${inlineFmt(bq[1])}</blockquote>`);
      continue;
    }
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
    if (!inPara) {
      out.push("<p>");
      inPara = true;
    } else {
      out.push("<br>");
    }
    out.push(inlineFmt(line));
  }
  closeBlocks();
  return out.join("\n");
}

// ===========================================================================
//  HELPERS
// ===========================================================================
function fmtSize(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
function fmtDate(ts: number): string {
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + " min ago";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + "h ago";
  if (diff < 86_400_000 * 7) return Math.floor(diff / 86_400_000) + "d ago";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const dateStr = d.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { year: "numeric", month: "short", day: "numeric" }
  );
  const timeStr = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateStr} · ${timeStr}`;
}
function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}
function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function getSupportedMimeType(): string {
  const types = ["audio/webm", "audio/mp4", "audio/ogg"];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

// Waveform constants
const BAR_W = 2.5;
const BAR_GAP = 3;
const BAR_PITCH = BAR_W + BAR_GAP;
const VIZ_W = 400;
const VIZ_H = 36;
const VIZ_CY = VIZ_H / 2;
const MAX_BARS = Math.ceil(VIZ_W / BAR_PITCH) + 2;
const BAR_INTERVAL = 60;

// ===========================================================================
//  COMPONENT
// ===========================================================================
export default function InterviewPage() {
  // --- Persistent store ---
  const [store, setStore] = useState<Store>(EMPTY_STORE);
  const [hydrated, setHydrated] = useState(false);
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [profiles, jobs, interviews] = await Promise.all([
          listProfiles(),
          listJobs(),
          listInterviews(),
        ]);
        if (cancelled) return;
        let activeProfileId = "";
        try {
          const stored = localStorage.getItem(ACTIVE_PROFILE_KEY);
          if (stored && profiles.some((p) => p.id === stored)) {
            activeProfileId = stored;
          }
        } catch {}
        if (!activeProfileId && profiles.length > 0) {
          activeProfileId = profiles[0].id;
        }
        setStore({ activeProfileId, profiles, jobs, interviews });
      } catch (err) {
        console.error("[interview] hydrate failed:", err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !store.activeProfileId) return;
    try {
      localStorage.setItem(ACTIVE_PROFILE_KEY, store.activeProfileId);
    } catch {}
  }, [store.activeProfileId, hydrated]);

  // --- Nav ---
  const [pane, setPane] = useState<Pane>("interviews");
  useEffect(() => {
    if (!hydrated) return;
    try {
      const p = localStorage.getItem(PANE_KEY);
      if (p === "interviews" || p === "jobs" || p === "profile") setPane(p);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);
  const switchPane = useCallback((p: Pane) => {
    setPane(p);
    try {
      localStorage.setItem(PANE_KEY, p);
    } catch {}
    setEditingJobId(null);
    setEditingProfileId(null);
    window.scrollTo({ top: 0 });
  }, []);

  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);

  // --- Modal ---
  const [modalOpen, setModalOpen] = useState(false);
  const [modalProfileId, setModalProfileId] = useState<string | null>(null);
  const [modalJobId, setModalJobId] = useState<string | null>(null);
  const [modalType, setModalType] = useState<InterviewType>("hr");
  const [modalNotes, setModalNotes] = useState("");

  const openModal = useCallback(
    (presetJobId?: string) => {
      const def =
        store.profiles.find((p) => p.id === store.activeProfileId) ||
        store.profiles[0];
      setModalProfileId(def ? def.id : null);
      setModalJobId(presetJobId ?? null);
      setModalType("hr");
      setModalNotes("");
      setModalOpen(true);
    },
    [store.profiles, store.activeProfileId]
  );

  // --- Overlay ---
  const [overlay, setOverlay] = useState<OverlayName>(null);
  useEffect(() => {
    document.body.style.overflow = overlay ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [overlay]);

  // --- Active interview (during a session) ---
  const activeInterviewRef = useRef<{
    id: string;
    jobId: string;
    profileId: string;
    type: InterviewType;
    notes: string;
    startedAt: number;
    transcript: TranscriptMsg[];
    qIdx: number;
  } | null>(null);

  const [chatRole, setChatRole] = useState("—");
  const [chatCompany, setChatCompany] = useState("—");
  const [qIdx, setQIdx] = useState(0);

  // --- Prep ---
  const [prepStates, setPrepStates] = useState<("idle" | "active" | "done")[]>(
    PREP_STEPS.map(() => "idle")
  );
  const prepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Chat ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const chatOverlayRef = useRef<HTMLDivElement>(null);

  // --- Compose / mic ---
  const [composeState, setComposeState] = useState<ComposeState>("idle");
  const [composeTimer, setComposeTimer] = useState("00:00");
  const [previewText, setPreviewText] = useState("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeDataRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const barsRef = useRef<number[]>([]);
  const lastBarTimeRef = useRef(0);
  const recStartRef = useRef(0);
  const rafIdRef = useRef(0);
  const barsElRef = useRef<SVGGElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognizingRef = useRef(false);

  // --- Summary ---
  const [viewingInterview, setViewingInterview] =
    useState<InterviewRecord | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState<string>("");
  const [feedbackMd, setFeedbackMd] = useState<string | null>(null);
  const [memoriesStatus, setMemoriesStatus] = useState<string>("");
  const [memoriesWaiting, setMemoriesWaiting] = useState<boolean>(false);
  const [proposedMemories, setProposedMemories] = useState<ProposedMemory[]>(
    []
  );
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  // -----------------------------------------------------------------
  //  Modal start
  // -----------------------------------------------------------------
  const startInterview = useCallback(() => {
    if (!modalJobId || !modalProfileId) return;
    const job = store.jobs.find((j) => j.id === modalJobId);
    if (!job) return;
    const id = "iv_" + Date.now().toString(36);
    activeInterviewRef.current = {
      id,
      jobId: modalJobId,
      profileId: modalProfileId,
      type: modalType,
      notes: modalNotes,
      startedAt: Date.now(),
      transcript: [],
      qIdx: 0,
    };
    setChatRole(job.role || "Role");
    setChatCompany(`${job.company || "Company"} · ${TYPE_LABELS[modalType]}`);
    setMessages([]);
    setQIdx(0);
    setModalOpen(false);
    setOverlay("prep");
  }, [modalJobId, modalProfileId, modalType, modalNotes, store.jobs]);

  // -----------------------------------------------------------------
  //  Prep animation
  // -----------------------------------------------------------------
  useEffect(() => {
    if (overlay !== "prep") return;
    setPrepStates(PREP_STEPS.map(() => "idle"));
    let i = 0;
    if (prepTimerRef.current) clearInterval(prepTimerRef.current);
    setPrepStates((prev) => {
      const next = [...prev];
      next[0] = "active";
      return next;
    });
    prepTimerRef.current = setInterval(() => {
      i++;
      setPrepStates((prev) => {
        const next = [...prev];
        if (i > 0 && i - 1 < next.length) next[i - 1] = "done";
        if (i >= PREP_STEPS.length) {
          if (prepTimerRef.current) clearInterval(prepTimerRef.current);
          setTimeout(() => setOverlay("chat"), 400);
          return next;
        }
        next[i] = "active";
        return next;
      });
    }, 720);
    return () => {
      if (prepTimerRef.current) clearInterval(prepTimerRef.current);
    };
  }, [overlay]);

  // -----------------------------------------------------------------
  //  Chat — askNext + scrolling
  // -----------------------------------------------------------------
  const scrollChatBottom = useCallback(() => {
    setTimeout(() => {
      const el = chatOverlayRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 50);
  }, []);

  const addAIMessage = useCallback(
    (text: string, onDone?: () => void) => {
      setMessages((prev) => [...prev, { who: "ai", text, typing: true }]);
      scrollChatBottom();
      const delay = 700 + Math.min(text.length * 8, 1800);
      setTimeout(() => {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, typing: false } : m
          )
        );
        scrollChatBottom();
        onDone?.();
      }, delay);
    },
    [scrollChatBottom]
  );

  const askNextRef = useRef<(() => void) | null>(null);
  askNextRef.current = () => {
    const iv = activeInterviewRef.current;
    if (!iv) return;
    if (iv.qIdx >= QUESTIONS.length) {
      setTimeout(() => {
        addAIMessage(
          "That’s all I’ve got for you. Nice job — I’ll put a debrief together.",
          () => setTimeout(goToSummary, 600)
        );
      }, 600);
      return;
    }
    setQIdx(iv.qIdx + 1);
    addAIMessage(QUESTIONS[iv.qIdx]);
  };

  useEffect(() => {
    if (overlay === "chat" && messages.length === 0) {
      setTimeout(() => askNextRef.current?.(), 300);
    }
  }, [overlay, messages.length]);

  // -----------------------------------------------------------------
  //  Recording / waveform / transcription
  // -----------------------------------------------------------------
  const tickRef = useRef<(() => void) | null>(null);
  tickRef.current = () => {
    if (!recognizingRef.current) return;
    const now = Date.now();
    setComposeTimer(fmtTime(now - recStartRef.current));
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

  const cleanupAudio = useCallback(() => {
    cancelAnimationFrame(rafIdRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    if (barsElRef.current) barsElRef.current.innerHTML = "";
    barsRef.current = [];
  }, []);

  const startRecording = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return;
    }
    streamRef.current = stream;

    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const audioCtx = new Ctx();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;
    timeDataRef.current = new Float32Array(2048);

    const mimeType = getSupportedMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    chunksRef.current = [];

    recorder.addEventListener("dataavailable", (e) => {
      chunksRef.current.push(e.data);
    });

    recorder.addEventListener("stop", async () => {
      const mType = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mType });
      cleanupAudio();

      if (blob.size < 1024) {
        setComposeState("idle");
        return;
      }

      if (!BACKEND_URL || !BACKEND_API_KEY) {
        setPreviewText(
          "(Transcription backend not configured — this is a placeholder answer. Edit before sending.)"
        );
        setComposeState("preview");
        return;
      }

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
          setPreviewText(
            "(Transcription failed — please type your answer here.)"
          );
          setComposeState("preview");
          return;
        }
        const data = await res.json();
        const text = (data.text || "").trim();
        if (!text) {
          setComposeState("idle");
          return;
        }
        setPreviewText(text);
        setComposeState("preview");
      } catch {
        setPreviewText(
          "(Transcription failed — please type your answer here.)"
        );
        setComposeState("preview");
      }
    });

    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    barsRef.current = [];
    lastBarTimeRef.current = 0;
    recStartRef.current = Date.now();
    recognizingRef.current = true;
    setComposeState("recording");
    setComposeTimer("00:00");
    rafIdRef.current = requestAnimationFrame(() => tickRef.current?.());
  }, [cleanupAudio]);

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
      setPreviewText("");
      return;
    }
    const iv = activeInterviewRef.current;
    if (!iv) return;
    setMessages((prev) => [...prev, { who: "user", text }]);
    iv.transcript.push({ role: "interviewer", text: QUESTIONS[iv.qIdx] });
    iv.transcript.push({ role: "candidate", text });
    iv.qIdx++;
    setComposeState("idle");
    setPreviewText("");
    setComposeTimer("00:00");
    setTimeout(() => askNextRef.current?.(), 900);
  }, [previewText]);

  const handleDiscard = useCallback(() => {
    setComposeState("idle");
    setPreviewText("");
    setComposeTimer("00:00");
  }, []);

  // Spacebar handler in chat
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement
      )
        return;
      if (overlay !== "chat") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (composeState === "recording") stopRecording();
        else if (composeState === "idle") startRecording();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [overlay, composeState, startRecording, stopRecording]);

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
        try {
          audioCtxRef.current.close();
        } catch {}
      }
    };
  }, []);

  // -----------------------------------------------------------------
  //  Summary
  // -----------------------------------------------------------------
  const goToSummary = useCallback(() => {
    const iv = activeInterviewRef.current;
    if (!iv) {
      setOverlay(null);
      return;
    }
    const dur = Date.now() - iv.startedAt;
    const job = storeRef.current.jobs.find((j) => j.id === iv.jobId);
    const typeLabel = TYPE_LABELS[iv.type];

    const ivRecord: InterviewRecord = {
      id: iv.id,
      jobId: iv.jobId,
      profileId: iv.profileId,
      type: iv.type,
      notes: iv.notes,
      title: typeLabel,
      createdAt: iv.startedAt,
      durationMs: dur,
      questions: iv.qIdx,
      status: "done",
      transcript: iv.transcript.slice(),
      feedback: null,
      proposedMemories: null,
    };
    setStore((prev) => ({
      ...prev,
      interviews: [ivRecord, ...prev.interviews],
    }));
    setViewingInterview(ivRecord);
    // Persist with empty feedback/memories. The patches below await this
    // promise so they target the DB-assigned UUID, not the local id.
    const createdInterviewPromise: Promise<InterviewRecord | null> =
      createInterview({
        profileId: ivRecord.profileId,
        jobId: ivRecord.jobId,
        type: ivRecord.type,
        title: ivRecord.title,
        notes: ivRecord.notes,
        status: ivRecord.status,
        durationMs: ivRecord.durationMs,
        questions: ivRecord.questions,
        transcript: ivRecord.transcript,
        feedback: null,
        proposedMemories: null,
      })
        .then((row) => {
          setStore((prev) => ({
            ...prev,
            interviews: prev.interviews.map((x) =>
              x.id === ivRecord.id ? row : x
            ),
          }));
          setViewingInterview(row);
          return row;
        })
        .catch((err) => {
          console.error("[interview] persist new interview failed:", err);
          return null;
        });
    setTranscriptOpen(false);
    setFeedbackMd(null);
    setFeedbackStatus("Generating…");
    setMemoriesWaiting(true);
    setMemoriesStatus("Pending");
    setProposedMemories([]);
    setOverlay("summary");

    const proposedTexts = [
      `${typeLabel}${job ? " · " + job.company : ""}: held the narrative in opening, lost the landing on questions 3 and 5. Lean on a number or decision to close.`,
      `Setup-to-payoff ratio averaged ~38%. For ${job ? job.company : "next round"}, target 15–20% setup before getting to the action.`,
      `Collaboration framing reads strong when partner teams are named by role. Keep the "I made the call" frame for prioritization stories.`,
    ];

    setTimeout(async () => {
      setFeedbackMd(SAMPLE_FEEDBACK);
      setFeedbackStatus("Ready");
      const persisted = await createdInterviewPromise;
      const targetId = persisted?.id ?? ivRecord.id;
      setStore((prev) => ({
        ...prev,
        interviews: prev.interviews.map((x) =>
          x.id === targetId ? { ...x, feedback: SAMPLE_FEEDBACK } : x
        ),
      }));
      if (persisted) {
        updateInterview(persisted.id, { feedback: SAMPLE_FEEDBACK }).catch(
          (err) =>
            console.error("[interview] persist feedback failed:", err)
        );
      }
      setMemoriesWaiting(false);
      setMemoriesStatus("Drafting…");
      const all: ProposedMemory[] = [];
      proposedTexts.forEach((text, i) => {
        setTimeout(() => {
          const pm: ProposedMemory = {
            id: "pm_" + Date.now().toString(36) + i,
            text,
            state: "pending",
          };
          all.push(pm);
          setProposedMemories((prev) => [...prev, pm]);
          const snapshot = all.slice();
          setStore((prev) => ({
            ...prev,
            interviews: prev.interviews.map((x) =>
              x.id === targetId ? { ...x, proposedMemories: snapshot } : x
            ),
          }));
          if (i === proposedTexts.length - 1) {
            setMemoriesStatus(`${proposedTexts.length} proposed`);
            if (persisted) {
              updateInterview(persisted.id, {
                proposedMemories: snapshot,
              }).catch((err) =>
                console.error(
                  "[interview] persist proposedMemories failed:",
                  err
                )
              );
            }
          }
        }, 600 + i * 700);
      });
    }, 1800);

    activeInterviewRef.current = null;
  }, []);

  const openPastInterview = useCallback((ivId: string) => {
    const iv = storeRef.current.interviews.find((x) => x.id === ivId);
    if (!iv) return;
    setViewingInterview(iv);
    setTranscriptOpen(false);
    setFeedbackMd(iv.feedback);
    setFeedbackStatus(iv.feedback ? "Ready" : "");
    const pendingPMs = (iv.proposedMemories || []).filter(
      (p) => p.state === "pending"
    );
    setProposedMemories(pendingPMs);
    setMemoriesWaiting(false);
    setMemoriesStatus(
      pendingPMs.length > 0 ? `${pendingPMs.length} pending` : ""
    );
    setOverlay("summary");
  }, []);

  const handleAcceptMemory = useCallback(
    (pm: ProposedMemory) => {
      if (!viewingInterview) return;
      const profileId =
        viewingInterview.profileId || storeRef.current.activeProfileId;
      const profile = storeRef.current.profiles.find((p) => p.id === profileId);
      if (!profile) return;

      const memId =
        "m_" +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 5);
      const newMem: Memory = {
        id: memId,
        text: pm.text,
        createdAt: Date.now(),
      };
      const updatedMemories = [newMem, ...(profile.memories || [])];
      const interviewRow = storeRef.current.interviews.find(
        (x) => x.id === viewingInterview.id
      );
      const updatedProposed = (interviewRow?.proposedMemories || []).map((y) =>
        y.id === pm.id ? { ...y, state: "accepted" as const, memId } : y
      );

      setStore((prev) => ({
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === profile.id ? { ...p, memories: updatedMemories } : p
        ),
        interviews: prev.interviews.map((x) =>
          x.id === viewingInterview.id
            ? { ...x, proposedMemories: updatedProposed }
            : x
        ),
      }));
      setProposedMemories((prev) => prev.filter((p) => p.id !== pm.id));

      Promise.all([
        apiUpdateProfile(profile.id, { memories: updatedMemories }),
        updateInterview(viewingInterview.id, {
          proposedMemories: updatedProposed,
        }),
      ]).catch((err) =>
        console.error("[interview] persist memory accept failed:", err)
      );
    },
    [viewingInterview]
  );

  const handleRejectMemory = useCallback(
    (pm: ProposedMemory) => {
      if (!viewingInterview) return;
      const interviewRow = storeRef.current.interviews.find(
        (x) => x.id === viewingInterview.id
      );
      const updatedProposed = (interviewRow?.proposedMemories || []).map((y) =>
        y.id === pm.id ? { ...y, state: "rejected" as const } : y
      );

      setStore((prev) => ({
        ...prev,
        interviews: prev.interviews.map((x) =>
          x.id === viewingInterview.id
            ? { ...x, proposedMemories: updatedProposed }
            : x
        ),
      }));
      setProposedMemories((prev) => prev.filter((p) => p.id !== pm.id));

      updateInterview(viewingInterview.id, {
        proposedMemories: updatedProposed,
      }).catch((err) =>
        console.error("[interview] persist memory reject failed:", err)
      );
    },
    [viewingInterview]
  );

  // -----------------------------------------------------------------
  //  Render: counts
  // -----------------------------------------------------------------
  const navCounts = useMemo(
    () => ({
      interviews: store.interviews.length,
      jobs: store.jobs.length,
      profiles: store.profiles.length,
    }),
    [store]
  );

  // -----------------------------------------------------------------
  //  Job actions
  // -----------------------------------------------------------------
  // Inline name-prompt modal state (replaces window.prompt for add profile / add job)
  const [namePrompt, setNamePrompt] = useState<
    null | { kind: "profile" | "job" }
  >(null);

  const addJob = useCallback(() => {
    const profileId = storeRef.current.activeProfileId;
    if (!profileId) {
      void showAlert(
        "Create a profile first",
        "You need an active profile before adding a job."
      );
      return;
    }
    setNamePrompt({ kind: "job" });
  }, []);

  const submitNewJob = useCallback(
    async (values: Record<string, string>) => {
      const profileId = storeRef.current.activeProfileId;
      if (!profileId) return;
      try {
        const created = await createJob({
          profileId,
          company: values.company,
          role: values.role,
          url: "",
          posting: "",
          research: "",
        });
        setStore((prev) => ({ ...prev, jobs: [created, ...prev.jobs] }));
        setEditingJobId(created.id);
        setNamePrompt(null);
      } catch (err) {
        void showAlert(
          "Could not create job",
          err instanceof Error ? err.message : "Unknown error"
        );
      }
    },
    []
  );

  const deleteJob = useCallback(async (id: string) => {
    const ok = await askConfirm({
      title: "Delete this job?",
      message: "Any past interviews tied to it will also be deleted.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiDeleteJob(id);
      setStore((prev) => ({
        ...prev,
        jobs: prev.jobs.filter((j) => j.id !== id),
        interviews: prev.interviews.filter((iv) => iv.jobId !== id),
      }));
      setEditingJobId(null);
    } catch (err) {
      void showAlert(
        "Could not delete job",
        err instanceof Error ? err.message : "Unknown error"
      );
    }
  }, []);

  const updateJob = useCallback(async (id: string, patch: Partial<Job>) => {
    setStore((prev) => ({
      ...prev,
      jobs: prev.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
    }));
    try {
      await apiUpdateJob(id, patch);
    } catch (err) {
      console.error("[interview] updateJob failed:", err);
      try {
        const fresh = await listJobs();
        setStore((prev) => ({ ...prev, jobs: fresh }));
      } catch {}
    }
  }, []);

  // -----------------------------------------------------------------
  //  Profile actions
  // -----------------------------------------------------------------
  const addProfile = useCallback(() => {
    setNamePrompt({ kind: "profile" });
  }, []);

  const submitNewProfile = useCallback(
    async (values: Record<string, string>) => {
      try {
        const created = await createProfile({
          name: values.name,
          memories: [],
        });
        setStore((prev) => ({
          ...prev,
          profiles: [created, ...prev.profiles],
          activeProfileId: prev.activeProfileId || created.id,
        }));
        setEditingProfileId(created.id);
        setNamePrompt(null);
      } catch (err) {
        void showAlert(
          "Could not create profile",
          err instanceof Error ? err.message : "Unknown error"
        );
      }
    },
    []
  );

  const updateProfile = useCallback(
    async (id: string, patch: Partial<Profile>) => {
      setStore((prev) => ({
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === id ? { ...p, ...patch } : p
        ),
      }));
      try {
        await apiUpdateProfile(id, patch);
      } catch (err) {
        console.error("[interview] updateProfile failed:", err);
        try {
          const fresh = await listProfiles();
          setStore((prev) => ({ ...prev, profiles: fresh }));
        } catch {}
      }
    },
    []
  );

  const setActiveProfile = useCallback((id: string) => {
    setStore((prev) => ({ ...prev, activeProfileId: id }));
  }, []);

  const deleteProfile = useCallback(async (id: string) => {
    const ok = await askConfirm({
      title: "Delete this profile?",
      message:
        "Its jobs, interviews, and résumé will also be deleted. This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiDeleteProfile(id);
      setStore((prev) => {
        const profiles = prev.profiles.filter((p) => p.id !== id);
        const jobs = prev.jobs.filter((j) => j.profileId !== id);
        const interviews = prev.interviews.filter((iv) => iv.profileId !== id);
        let activeProfileId = prev.activeProfileId;
        if (activeProfileId === id) {
          activeProfileId = profiles[0]?.id ?? "";
        }
        return { activeProfileId, profiles, jobs, interviews };
      });
      setEditingProfileId(null);
    } catch (err) {
      void showAlert(
        "Could not delete profile",
        err instanceof Error ? err.message : "Unknown error"
      );
    }
  }, []);

  const deleteInterview = useCallback(async (id: string) => {
    const ok = await askConfirm({
      title: "Delete this interview?",
      message: "The transcript and feedback will be removed.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiDeleteInterview(id);
      setStore((prev) => ({
        ...prev,
        interviews: prev.interviews.filter((iv) => iv.id !== id),
      }));
      setOverlay(null);
      setViewingInterview(null);
      setMessages([]);
    } catch (err) {
      void showAlert(
        "Could not delete interview",
        err instanceof Error ? err.message : "Unknown error"
      );
    }
  }, []);

  // ===========================================================================
  //  RENDER
  // ===========================================================================
  return (
    <div className="iv-workspace">
      <div className="app">
        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="brand">
            <a className="back" href="/" aria-label="Back to workshop">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path
                  d="M15 18l-6-6 6-6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
            <h1>
              <span className="dot" />
              Interview
            </h1>
          </div>

          <div className="nav">
            <div className="nav-section">Workspace</div>
            <button
              className={`nav-item${pane === "interviews" ? " active" : ""}`}
              onClick={() => switchPane("interviews")}
            >
              <span className="nav-marker" />
              Interviews
              <span className="nav-count">{navCounts.interviews}</span>
            </button>
            <button
              className={`nav-item${pane === "jobs" ? " active" : ""}`}
              onClick={() => switchPane("jobs")}
            >
              <span className="nav-marker" />
              Jobs
              <span className="nav-count">{navCounts.jobs}</span>
            </button>
            <button
              className={`nav-item${pane === "profile" ? " active" : ""}`}
              onClick={() => switchPane("profile")}
            >
              <span className="nav-marker" />
              Profiles
              <span className="nav-count">{navCounts.profiles}</span>
            </button>
          </div>
        </aside>

        {/* MAIN */}
        <main className="main">
          {hydrated && store.profiles.length === 0 ? (
            <section className="empty-state">
              <h2>Welcome</h2>
              <p>Create your first profile to get started.</p>
              <button className="btn-primary" onClick={addProfile}>
                Create profile
              </button>
            </section>
          ) : (
            <>
              {pane === "interviews" && (
                <InterviewsPane
                  store={store}
                  onNewInterview={() => openModal()}
                  onOpenInterview={openPastInterview}
                />
              )}
              {pane === "jobs" &&
                (editingJobId ? (
                  <JobDetail
                    key={editingJobId}
                    jobId={editingJobId}
                    store={store}
                    onBack={() => setEditingJobId(null)}
                    onUpdate={updateJob}
                    onDelete={deleteJob}
                    onStartInterview={(jid) => openModal(jid)}
                  />
                ) : (
                  <JobsList
                    store={store}
                    onOpen={(id) => setEditingJobId(id)}
                    onAdd={addJob}
                  />
                ))}
              {pane === "profile" &&
                (editingProfileId ? (
                  <ProfileDetail
                    key={editingProfileId}
                    profileId={editingProfileId}
                    store={store}
                    onBack={() => setEditingProfileId(null)}
                    onUpdate={updateProfile}
                    onSetActive={setActiveProfile}
                    onDelete={deleteProfile}
                  />
                ) : (
                  <ProfilesList
                    store={store}
                    onOpen={(id) => setEditingProfileId(id)}
                    onAdd={addProfile}
                  />
                ))}
            </>
          )}
        </main>
      </div>

      {/* CONFIRM / ALERT MODAL HOST */}
      <ConfirmModalHost />

      {/* NAME PROMPT MODAL (add profile / add job) */}
      {namePrompt && (
        <NamePromptModal
          kind={namePrompt.kind}
          onCancel={() => setNamePrompt(null)}
          onSubmit={
            namePrompt.kind === "profile" ? submitNewProfile : submitNewJob
          }
        />
      )}

      {/* MODAL */}
      {modalOpen && (
        <NewInterviewModal
          store={store}
          profileId={modalProfileId}
          jobId={modalJobId}
          type={modalType}
          notes={modalNotes}
          onProfile={setModalProfileId}
          onJob={setModalJobId}
          onType={setModalType}
          onNotes={setModalNotes}
          onClose={() => setModalOpen(false)}
          onStart={startInterview}
          onGotoProfiles={() => {
            setModalOpen(false);
            switchPane("profile");
          }}
          onGotoJobs={() => {
            setModalOpen(false);
            switchPane("jobs");
          }}
        />
      )}

      {/* PREP OVERLAY */}
      {overlay === "prep" && (
        <div className="stage-overlay">
          <div className="stage-inner">
            <div className="preparing">
              <div className="prep-glyph">
                <svg viewBox="0 0 120 120">
                  <circle
                    className="prep-ring r1"
                    cx="60"
                    cy="60"
                    r="54"
                    strokeDasharray="6 8"
                  />
                  <circle
                    className="prep-ring r2"
                    cx="60"
                    cy="60"
                    r="42"
                    strokeDasharray="3 10"
                  />
                  <circle
                    className="prep-ring r3"
                    cx="60"
                    cy="60"
                    r="30"
                    strokeDasharray="2 6"
                  />
                </svg>
                <div className="prep-core" />
              </div>
              <div className="prep-status">
                <div className="prep-title">Preparing your interview</div>
                <div className="prep-steps">
                  {PREP_STEPS.map((step, i) => (
                    <div
                      key={i}
                      className={`prep-step${prepStates[i] === "active" ? " active" : ""}${prepStates[i] === "done" ? " done" : ""}`}
                    >
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHAT OVERLAY */}
      {overlay === "chat" && (
        <div className="stage-overlay" ref={chatOverlayRef}>
          <div className="stage-inner">
            <div className="stage-header">
              <button
                className="stage-back"
                onClick={async () => {
                  const ok = await askConfirm({
                    title: "Exit interview?",
                    message: "Progress will be lost.",
                    confirmLabel: "Exit",
                    destructive: true,
                  });
                  if (!ok) return;
                  activeInterviewRef.current = null;
                  setMessages([]);
                  setComposeState("idle");
                  setPreviewText("");
                  cleanupAudio();
                  setOverlay(null);
                }}
                aria-label="Exit"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    d="M15 18l-6-6 6-6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <div className="stage-meta">
                <div className="stage-role">{chatRole}</div>
                <div className="stage-company">{chatCompany}</div>
              </div>
              <div className="stage-counter">
                <b>{Math.min(qIdx + 1, QUESTIONS.length)}</b> /{" "}
                {QUESTIONS.length}
              </div>
            </div>

            <div className="chat-log" ref={chatLogRef}>
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.who}`}>
                  <div className="msg-who">
                    {m.who === "ai" ? "Interviewer" : "You"}
                  </div>
                  <div className="msg-bubble">
                    {m.typing ? (
                      <div className="typing-dots">
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

            <div className="compose">
              <div
                className={`compose-inner${composeState === "recording" ? " recording" : ""}${composeState === "preview" ? " preview" : ""}`}
              >
                {composeState === "preview" ? (
                  <>
                    <textarea
                      className="preview-textarea"
                      value={previewText}
                      onChange={(e) => setPreviewText(e.target.value)}
                      autoFocus
                    />
                    <div className="preview-actions">
                      <button
                        className="compose-discard"
                        onClick={handleDiscard}
                      >
                        Redo
                      </button>
                      <button className="compose-send" onClick={handleSend}>
                        Send →
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      className={`mic-btn${composeState === "recording" ? " recording" : ""}${composeState === "transcribing" ? " transcribing" : ""}`}
                      onClick={
                        composeState === "transcribing"
                          ? undefined
                          : composeState === "recording"
                          ? stopRecording
                          : startRecording
                      }
                      disabled={composeState === "transcribing"}
                      aria-label="Record"
                    >
                      {composeState === "transcribing" ? (
                        <span className="mic-spinner" />
                      ) : composeState === "recording" ? (
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <rect
                            x="7"
                            y="7"
                            width="10"
                            height="10"
                            rx="2"
                            fill="#fff"
                          />
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
                    <div className="compose-body">
                      {composeState === "idle" && (
                        <div className="compose-hint">
                          Tap to answer{" "}
                          <span className="kbd">Space</span>
                        </div>
                      )}
                      {composeState === "recording" && (
                        <div className="compose-viz-wrap">
                          <svg
                            className="compose-viz"
                            viewBox={`0 0 ${VIZ_W} ${VIZ_H}`}
                            preserveAspectRatio="none"
                          >
                            <g className="compose-bars" ref={barsElRef} />
                          </svg>
                        </div>
                      )}
                      {composeState === "transcribing" && (
                        <div className="compose-hint">
                          Transcribing&hellip;
                        </div>
                      )}
                    </div>
                    {composeState === "recording" && (
                      <div className="compose-timer">{composeTimer}</div>
                    )}
                  </>
                )}
              </div>
              <div className="compose-end">
                <button
                  className="compose-end-btn"
                  onClick={() => goToSummary()}
                >
                  End interview
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUMMARY OVERLAY */}
      {overlay === "summary" && viewingInterview && (
        <SummaryOverlay
          interview={viewingInterview}
          store={store}
          feedbackMd={feedbackMd}
          feedbackStatus={feedbackStatus}
          memoriesWaiting={memoriesWaiting}
          memoriesStatus={memoriesStatus}
          proposedMemories={proposedMemories}
          transcriptOpen={transcriptOpen}
          onToggleTranscript={() => setTranscriptOpen((v) => !v)}
          onAccept={handleAcceptMemory}
          onReject={handleRejectMemory}
          onDelete={() => deleteInterview(viewingInterview.id)}
          onClose={() => {
            setOverlay(null);
            setViewingInterview(null);
            setMessages([]);
          }}
        />
      )}
    </div>
  );
}

// ===========================================================================
//  SUB-COMPONENTS
// ===========================================================================

function InterviewsPane({
  store,
  onNewInterview,
  onOpenInterview,
}: {
  store: Store;
  onNewInterview: () => void;
  onOpenInterview: (id: string) => void;
}) {
  const sorted = [...store.interviews].sort(
    (a, b) => b.createdAt - a.createdAt
  );
  return (
    <section>
      <div className="pane-head">
        <div className="pane-title-wrap">
          <div className="pane-kicker">Workspace · 01</div>
          <h2 className="pane-title">Interviews</h2>
          <div className="pane-sub">
            Past sessions and a button to start a new one.
          </div>
        </div>
        <button className="btn btn-primary" onClick={onNewInterview}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          New interview
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="empty">
          <div className="e-title">No interviews yet</div>
          <div className="e-sub">
            Start one when you’re ready — your first session will live here.
          </div>
        </div>
      ) : (
        <div className="inv-list">
          {sorted.map((iv, i) => {
            const job = store.jobs.find((j) => j.id === iv.jobId);
            const role = job ? job.role : "—";
            const company = job ? job.company : "—";
            const num = String(sorted.length - i).padStart(2, "0");
            const typeLabel = iv.title || TYPE_LABELS[iv.type] || "Interview";
            return (
              <div
                key={iv.id}
                className="inv-row"
                onClick={() => onOpenInterview(iv.id)}
              >
                <div className="inv-num">{num}</div>
                <div>
                  <div className="inv-name">
                    {role} · {company}
                  </div>
                  <div className="inv-meta">
                    <span className="inv-tag done">{typeLabel}</span>
                    <span>{fmtDate(iv.createdAt)}</span>
                    <span style={{ color: "var(--muted-2)" }}>·</span>
                    <span>{iv.questions || 6} Qs</span>
                    <span style={{ color: "var(--muted-2)" }}>·</span>
                    <span>{fmtDur(iv.durationMs || 0)}</span>
                  </div>
                </div>
                <div className="inv-stat" />
                <div className="inv-arrow">→</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function JobsList({
  store,
  onOpen,
  onAdd,
}: {
  store: Store;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const sorted = [...store.jobs].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <section>
      <div className="pane-head">
        <div className="pane-title-wrap">
          <div className="pane-kicker">Workspace · 02</div>
          <h2 className="pane-title">Jobs</h2>
          <div className="pane-sub">
            Postings you’re applying to. Each holds the JD plus your research
            notes.
          </div>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add job
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="empty">
          <div className="e-title">No jobs yet</div>
          <div className="e-sub">Add a job posting to start preparing for it.</div>
        </div>
      ) : (
        <div className="inv-list">
          {sorted.map((j, i) => {
            const num = String(sorted.length - i).padStart(2, "0");
            const interviewCount = store.interviews.filter(
              (iv) => iv.jobId === j.id
            ).length;
            const hasResearch = j.research && j.research.trim().length > 30;
            return (
              <div
                key={j.id}
                className="inv-row"
                onClick={() => onOpen(j.id)}
              >
                <div className="inv-num">{num}</div>
                <div>
                  <div className="inv-name">
                    {j.role} · {j.company}
                  </div>
                  <div className="inv-meta">
                    <span className={`inv-tag${hasResearch ? " done" : ""}`}>
                      {hasResearch ? "Researched" : "No research"}
                    </span>
                    <span>
                      {interviewCount} interview
                      {interviewCount === 1 ? "" : "s"}
                    </span>
                    <span style={{ color: "var(--muted-2)" }}>·</span>
                    <span>{fmtDate(j.createdAt)}</span>
                  </div>
                </div>
                <div className="inv-stat" />
                <div className="inv-arrow">→</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function JobDetail({
  jobId,
  store,
  onBack,
  onUpdate,
  onDelete,
  onStartInterview,
}: {
  jobId: string;
  store: Store;
  onBack: () => void;
  onUpdate: (id: string, patch: Partial<Job>) => void;
  onDelete: (id: string) => void;
  onStartInterview: (id: string) => void;
}) {
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job) {
    return (
      <div className="empty">
        <div className="e-title">Job not found</div>
      </div>
    );
  }
  return (
    <section>
      <button className="detail-back" onClick={onBack}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            d="M15 18l-6-6 6-6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        All jobs
      </button>

      <div className="pane-head">
        <div className="pane-title-wrap">
          <div className="pane-kicker">Job · {job.company}</div>
          <h2 className="pane-title">{job.role}</h2>
          <div className="pane-sub">
            {job.company} · added {fmtDate(job.createdAt)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => onDelete(jobId)}>
            Delete
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onStartInterview(jobId)}
          >
            Start interview
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="field-grid">
        <Field
          label="Company"
          value={job.company}
          onChange={(v) => onUpdate(jobId, { company: v })}
        />
        <Field
          label="Role"
          value={job.role}
          onChange={(v) => onUpdate(jobId, { role: v })}
        />
        <Field
          label="Posting URL (optional)"
          value={job.url}
          onChange={(v) => onUpdate(jobId, { url: v })}
          placeholder="https://…"
        />
      </div>

      <SecHead title="Job posting" sub="posting.md" />
      <MdCard
        filename="posting.md"
        value={job.posting}
        placeholder="Paste the job description here."
        onSave={(v) => onUpdate(jobId, { posting: v })}
      />

      <SecHead title="Research" sub="research.md" />
      <MdCard
        filename="research.md"
        value={job.research}
        placeholder="Notes about the company, the team, the role. Anything you want me to keep in mind during the interview."
        onSave={(v) => onUpdate(jobId, { research: v })}
      />
    </section>
  );
}

function ProfilesList({
  store,
  onOpen,
  onAdd,
}: {
  store: Store;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const sorted = [...store.profiles].sort(
    (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
  );
  return (
    <section>
      <div className="pane-head">
        <div className="pane-title-wrap">
          <div className="pane-kicker">Workspace · 03</div>
          <h2 className="pane-title">Profiles</h2>
          <div className="pane-sub">
            A profile holds your résumé and modular memories that travel between
            interviews.
          </div>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add profile
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="empty">
          <div className="e-title">No profiles yet</div>
          <div className="e-sub">
            A profile holds your résumé and memories that travel between
            interviews.
          </div>
        </div>
      ) : (
        <div className="inv-list">
          {sorted.map((p, i) => {
            const num = String(sorted.length - i).padStart(2, "0");
            const memCount = (p.memories || []).length;
            return (
              <div
                key={p.id}
                className="inv-row"
                onClick={() => onOpen(p.id)}
              >
                <div className="inv-num">{num}</div>
                <div>
                  <div className="inv-name">{p.name || "Untitled"}</div>
                  <div className="inv-meta">
                    <span>
                      {memCount} {memCount === 1 ? "memory" : "memories"}
                    </span>
                  </div>
                </div>
                <div className="inv-stat" />
                <div className="inv-arrow">→</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProfileDetail({
  profileId,
  store,
  onBack,
  onUpdate,
  onSetActive,
  onDelete,
}: {
  profileId: string;
  store: Store;
  onBack: () => void;
  onUpdate: (id: string, patch: Partial<Profile>) => void;
  onSetActive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) {
    return (
      <div className="empty">
        <div className="e-title">Profile not found</div>
      </div>
    );
  }
  const isActive = profile.id === store.activeProfileId;

  const [resumeBusy, setResumeBusy] = useState(false);
  const pickResume = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.docx,.txt";
    input.onchange = async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      setResumeBusy(true);
      try {
        const updated = await uploadResume(profileId, f);
        // Reflect server truth (storagePath, etc.) in the local store.
        onUpdate(profileId, { resume: updated.resume });
      } catch (err) {
        void showAlert(
          "Could not upload résumé",
          err instanceof Error ? err.message : "Unknown error"
        );
      } finally {
        setResumeBusy(false);
      }
    };
    input.click();
  };

  const removeResume = async () => {
    setResumeBusy(true);
    try {
      await deleteResume(profileId);
      onUpdate(profileId, { resume: null });
    } catch (err) {
      void showAlert(
        "Could not remove résumé",
        err instanceof Error ? err.message : "Unknown error"
      );
    } finally {
      setResumeBusy(false);
    }
  };

  const openResume = async () => {
    try {
      const url = await getResumeSignedUrl(profileId);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      void showAlert(
        "Could not open résumé",
        err instanceof Error ? err.message : "Unknown error"
      );
    }
  };

  const addMemory = () => {
    const newMem: Memory = {
      id: "m_" + Date.now().toString(36),
      text: "",
      createdAt: Date.now(),
    };
    onUpdate(profileId, { memories: [newMem, ...(profile.memories || [])] });
  };

  const updateMemory = (memId: string, text: string) => {
    const trimmed = text.trim();
    let memories = (profile.memories || []).map((m) =>
      m.id === memId ? { ...m, text: trimmed } : m
    );
    if (!trimmed) memories = memories.filter((m) => m.id !== memId);
    onUpdate(profileId, { memories });
  };

  const deleteMemory = (memId: string) => {
    onUpdate(profileId, {
      memories: (profile.memories || []).filter((m) => m.id !== memId),
    });
  };

  return (
    <section>
      <div className="pane-head">
        <button
          className="btn btn-ghost"
          onClick={onBack}
          style={{ marginRight: 12 }}
        >
          ← Profiles
        </button>
        <div className="pane-title-wrap">
          <div className="pane-kicker">
            {isActive ? "Active profile" : "Profile"}
          </div>
          <h2 className="pane-title">{profile.name || "Untitled"}</h2>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!isActive && (
            <button
              className="btn btn-ghost"
              onClick={() => onSetActive(profile.id)}
            >
              Set active
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => onDelete(profile.id)}
            style={{ color: "var(--danger, #d96666)" }}
          >
            Delete profile
          </button>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <Field
          label="Name"
          value={profile.name}
          onChange={(v) => onUpdate(profileId, { name: v })}
        />
      </div>

      <SecHead title="Current résumé" sub="resume" />
      {profile.resume ? (
        <div className="file-pill">
          <div className="file-pill-glyph">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <polyline points="14 3 14 8 19 8" />
            </svg>
          </div>
          <div className="file-pill-info">
            <div className="file-pill-name">{profile.resume.name}</div>
            <div className="file-pill-meta">
              {fmtSize(profile.resume.size)} ·{" "}
              {(profile.resume.ext || "").toUpperCase()}
            </div>
          </div>
          <div className="file-pill-actions">
            {profile.resume?.storagePath && (
              <button
                className="icon-btn"
                title="Open"
                onClick={openResume}
                disabled={resumeBusy}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M14 3h7v7" />
                  <path d="M10 14L21 3" />
                  <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                </svg>
              </button>
            )}
            <button
              className="icon-btn"
              title="Replace"
              onClick={pickResume}
              disabled={resumeBusy}
            >
              <svg viewBox="0 0 24 24">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </button>
            <button
              className="icon-btn"
              title="Remove"
              onClick={removeResume}
              disabled={resumeBusy}
            >
              <svg viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <button
          className="btn"
          style={{
            width: "100%",
            justifyContent: "center",
            padding: 18,
            borderStyle: "dashed",
          }}
          onClick={pickResume}
          disabled={resumeBusy}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {resumeBusy ? "Uploading…" : "Upload résumé (PDF, .docx, .txt)"}
        </button>
      )}

      <SecHead
        title="Memories"
        sub={`${(profile.memories || []).length} cards`}
      />
      <div className="sec-hint">
        Modular notes that travel between interviews. Edit, add, or remove
        individually.
      </div>
      <div className="memory-list">
        {(profile.memories || []).map((mem) => (
          <MemoryCard
            key={mem.id}
            memory={mem}
            onSave={(text) => updateMemory(mem.id, text)}
            onDelete={() => deleteMemory(mem.id)}
          />
        ))}
      </div>
      <button
        className="btn btn-ghost"
        style={{ marginTop: 12 }}
        onClick={addMemory}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add memory
      </button>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <input
        className="input"
        type="text"
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SecHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="sec-head">
      <div className="sec-title">{title}</div>
      <div className="sec-sub">{sub}</div>
    </div>
  );
}

function MdCard({
  filename,
  value,
  placeholder,
  onSave,
}: {
  filename: string;
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  useEffect(() => {
    if (!editing) setDraft(value || "");
  }, [value, editing]);

  return (
    <div className="md-card">
      <div className="md-head">
        <div className="md-title">
          <span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <polyline points="14 3 14 8 19 8" />
            </svg>
          </span>
          <span>{filename}</span>
        </div>
        <div className="md-actions">
          {editing ? (
            <>
              <button
                className="btn btn-ghost"
                style={{ padding: "6px 12px" }}
                onClick={() => {
                  setEditing(false);
                  setDraft(value || "");
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ padding: "7px 14px", fontSize: 12 }}
                onClick={() => {
                  onSave(draft);
                  setEditing(false);
                }}
              >
                Save
              </button>
            </>
          ) : (
            <button
              className="btn btn-ghost"
              style={{ padding: "6px 12px" }}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
        </div>
      </div>
      <div className={`md-body${editing ? " editing" : ""}`}>
        {editing ? (
          <textarea
            className="md-edit-area"
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
        ) : value && value.trim() ? (
          <div
            className="md-rendered"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
          />
        ) : (
          <div className="md-empty">
            <div>{placeholder}</div>
            <div className="e-hint">Click Edit to add content.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryCard({
  memory,
  onSave,
  onDelete,
}: {
  memory: Memory;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(!memory.text);
  const [draft, setDraft] = useState(memory.text);

  if (editing) {
    return (
      <div className="memory-card">
        <div className="memory-meta">{fmtDateTime(memory.createdAt)}</div>
        <textarea
          className="textarea memory-edit"
          value={draft}
          placeholder="A specific, useful observation about you as a candidate."
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <div className="memory-actions" style={{ opacity: 1 }}>
          <button
            className="btn btn-ghost"
            style={{ padding: "6px 12px" }}
            onClick={() => {
              if (!memory.text) {
                onDelete();
              } else {
                setDraft(memory.text);
                setEditing(false);
              }
            }}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ padding: "6px 12px", fontSize: 12 }}
            onClick={() => {
              onSave(draft);
              if (draft.trim()) setEditing(false);
            }}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="memory-card">
      <div className="memory-head">
        <div className="memory-meta">{fmtDateTime(memory.createdAt)}</div>
        <div className="memory-actions">
          <button
            className="icon-btn"
            title="Edit"
            onClick={() => {
              setDraft(memory.text);
              setEditing(true);
            }}
          >
            <svg viewBox="0 0 24 24">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button className="icon-btn" title="Delete" onClick={onDelete}>
            <svg viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </div>
      </div>
      <div className="memory-text">{memory.text}</div>
    </div>
  );
}

function NewInterviewModal({
  store,
  profileId,
  jobId,
  type,
  notes,
  onProfile,
  onJob,
  onType,
  onNotes,
  onClose,
  onStart,
  onGotoProfiles,
  onGotoJobs,
}: {
  store: Store;
  profileId: string | null;
  jobId: string | null;
  type: InterviewType;
  notes: string;
  onProfile: (id: string) => void;
  onJob: (id: string) => void;
  onType: (t: InterviewType) => void;
  onNotes: (n: string) => void;
  onClose: () => void;
  onStart: () => void;
  onGotoProfiles: () => void;
  onGotoJobs: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="modal-title">New interview</div>
            <div className="modal-sub">
              Pick a job and an interview type. I’ll use your profile and any
              research you’ve added.
            </div>
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="modal-section">
          <div className="modal-section-label">Profile</div>
          <div className="pickset">
            {store.profiles.length === 0 ? (
              <div
                className="pickrow empty"
                onClick={onGotoProfiles}
              >
                <div className="check" />
                <div className="pickrow-body">
                  <div className="pickrow-name">
                    No profiles yet — add one
                  </div>
                  <div className="pickrow-sub">
                    Click to go to the Profiles tab and create one.
                  </div>
                </div>
              </div>
            ) : (
              store.profiles.map((p) => {
                const memCount = (p.memories || []).length;
                return (
                  <div
                    key={p.id}
                    className={`pickrow${profileId === p.id ? " active" : ""}`}
                    onClick={() => onProfile(p.id)}
                  >
                    <div className="check" />
                    <div className="pickrow-body">
                      <div className="pickrow-name">
                        {p.name || "Untitled"}
                      </div>
                      <div className="pickrow-sub">
                        {memCount} {memCount === 1 ? "memory" : "memories"}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="modal-section">
          <div className="modal-section-label">Job</div>
          <div className="pickset">
            {store.jobs.length === 0 ? (
              <div className="pickrow empty" onClick={onGotoJobs}>
                <div className="check" />
                <div className="pickrow-body">
                  <div className="pickrow-name">No jobs yet — add one</div>
                  <div className="pickrow-sub">
                    Click to go to the Jobs tab and create one.
                  </div>
                </div>
              </div>
            ) : (
              store.jobs.map((j) => (
                <div
                  key={j.id}
                  className={`pickrow${jobId === j.id ? " active" : ""}`}
                  onClick={() => onJob(j.id)}
                >
                  <div className="check" />
                  <div className="pickrow-body">
                    <div className="pickrow-name">{j.role}</div>
                    <div className="pickrow-sub">
                      {j.company} · added {fmtDate(j.createdAt)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="modal-section">
          <div className="modal-section-label">Interview type</div>
          <div className="chip-row">
            {(["hr", "hm", "other"] as InterviewType[]).map((t) => (
              <button
                key={t}
                className={`chip${type === t ? " active" : ""}`}
                onClick={() => onType(t)}
              >
                {t === "hr"
                  ? "HR screening"
                  : t === "hm"
                  ? "Hiring manager"
                  : "Other"}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-section">
          <div className="modal-section-label">
            Notes for the interviewer{" "}
            <span
              style={{
                color: "var(--muted-2)",
                textTransform: "none",
                letterSpacing: 0,
                fontFamily: '"Inter", sans-serif',
                fontSize: 11,
              }}
            >
              — optional
            </span>
          </div>
          <textarea
            className="textarea"
            value={notes}
            placeholder="Anything specific you want them to probe, format details, or topics to focus on."
            onChange={(e) => onNotes(e.target.value)}
          />
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!jobId || !profileId}
            onClick={onStart}
          >
            Start interview
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryOverlay({
  interview,
  store,
  feedbackMd,
  feedbackStatus,
  memoriesWaiting,
  memoriesStatus,
  proposedMemories,
  transcriptOpen,
  onToggleTranscript,
  onAccept,
  onReject,
  onDelete,
  onClose,
}: {
  interview: InterviewRecord;
  store: Store;
  feedbackMd: string | null;
  feedbackStatus: string;
  memoriesWaiting: boolean;
  memoriesStatus: string;
  proposedMemories: ProposedMemory[];
  transcriptOpen: boolean;
  onToggleTranscript: () => void;
  onAccept: (pm: ProposedMemory) => void;
  onReject: (pm: ProposedMemory) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const job = store.jobs.find((j) => j.id === interview.jobId);
  const typeLabel = interview.title || TYPE_LABELS[interview.type] || "Interview";
  const stamp = new Date(interview.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const hasTranscript = (interview.transcript || []).length > 0;
  const showMemoriesSection =
    memoriesWaiting || proposedMemories.length > 0;

  return (
    <div className="stage-overlay">
      <div className="stage-inner">
        <div className="stage-header">
          <button
            className="stage-back stage-back-text"
            onClick={onClose}
            aria-label="Return to interviews"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                d="M15 18l-6-6 6-6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Return to interviews</span>
          </button>
          <button
            className="btn btn-ghost"
            onClick={onDelete}
            style={{ color: "var(--danger, #d96666)" }}
          >
            Delete interview
          </button>
        </div>

        <div className="summary-hero">
          <div className="summary-kicker">
            {typeLabel}
            {job ? ` · ${job.company}` : ""} · {stamp}
          </div>
          <h2 className="summary-title">Interview wrapped.</h2>
          <p className="summary-sub">
            {feedbackMd
              ? "Review the feedback below, decide which memories to keep, and expand the transcript if you want to revisit how it went."
              : "Generating your debrief and proposed memories. You can review and accept the ones you want to keep."}
          </p>
        </div>

        <div className="summary-stats">
          <div className="stat">
            <div className="stat-label">Duration</div>
            <div className="stat-value">
              {fmtDur(interview.durationMs || 0)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Questions</div>
            <div className="stat-value">
              {interview.questions ||
                (interview.transcript ? interview.transcript.length : 0)}
            </div>
          </div>
        </div>

        <div className="summary-section">
          <div className="sec-head">
            <div className="sec-title">Feedback</div>
            <div className="sec-sub">{feedbackStatus}</div>
          </div>
          <div className="feedback-body">
            {feedbackMd ? (
              <div
                dangerouslySetInnerHTML={{ __html: renderMarkdown(feedbackMd) }}
              />
            ) : (
              <div className="feedback-loading">
                <div className="fb-shimmer w90" />
                <div className="fb-shimmer w70" />
                <div className="fb-shimmer w85" />
                <div className="fb-shimmer w50" />
                <div className="fb-shimmer w80" />
              </div>
            )}
          </div>
        </div>

        {showMemoriesSection && (
          <div className="summary-section">
            <div className="sec-head">
              <div className="sec-title">Proposed memories</div>
              <div className="sec-sub">{memoriesStatus}</div>
            </div>
            <div
              className={`proposed-memories${memoriesWaiting ? " waiting" : ""}`}
            >
              {memoriesWaiting ? (
                "Waiting on feedback…"
              ) : (
                proposedMemories.map((pm) => (
                  <div key={pm.id} className="pmem">
                    <div className="pmem-text">{pm.text}</div>
                    <div className="pmem-actions">
                      <button
                        className="pmem-btn"
                        onClick={() => onReject(pm)}
                      >
                        Skip
                      </button>
                      <button
                        className="pmem-btn accept"
                        onClick={() => onAccept(pm)}
                      >
                        Accept
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {hasTranscript && (
          <div className="summary-section">
            <button
              type="button"
              className="transcript-toggle"
              aria-expanded={transcriptOpen}
              onClick={onToggleTranscript}
            >
              <span className="sec-title">Transcript</span>
              <span className="transcript-toggle-meta">
                <span>
                  {interview.transcript.length}{" "}
                  {interview.transcript.length === 1
                    ? "message"
                    : "messages"}
                </span>
                <svg
                  className="transcript-toggle-chev"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>
            <div
              className="transcript-body"
              style={{ display: transcriptOpen ? "flex" : "none" }}
            >
              {interview.transcript.map((m, i) => {
                const isInt = m.role === "interviewer";
                return (
                  <div
                    key={i}
                    className={`tx-msg ${isInt ? "tx-int" : "tx-cand"}`}
                  >
                    <div className="tx-avatar">{isInt ? "AI" : "You"}</div>
                    <div className="tx-bubble">{m.text}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
//  NAME PROMPT MODAL  (replaces window.prompt for add profile / add job)
// ===========================================================================
function NamePromptModal({
  kind,
  onCancel,
  onSubmit,
}: {
  kind: "profile" | "job";
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const config =
    kind === "profile"
      ? {
          title: "New profile",
          sub: "Profiles hold a résumé and memories.",
          submitLabel: "Add profile",
          fields: [
            { name: "name", label: "Profile name", placeholder: "e.g. Robbie" },
          ],
        }
      : {
          title: "New job",
          sub: "Add the company and role; you can fill in posting and research after.",
          submitLabel: "Add job",
          fields: [
            { name: "company", label: "Company", placeholder: "e.g. Northwind" },
            { name: "role", label: "Role", placeholder: "e.g. Senior Product Designer" },
          ],
        };

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(config.fields.map((f) => [f.name, ""]))
  );
  const trimmed = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k, v.trim()])
      ),
    [values]
  );
  const allFilled = config.fields.every((f) => trimmed[f.name]);

  const submit = () => {
    if (!allFilled) return;
    onSubmit(trimmed);
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{config.title}</div>
            <div className="modal-sub">{config.sub}</div>
          </div>
          <button
            className="modal-close"
            onClick={onCancel}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {config.fields.map((f, i) => (
          <div key={f.name} className="modal-section">
            <div className="modal-section-label">{f.label}</div>
            <input
              className="input"
              autoFocus={i === 0}
              value={values[f.name]}
              placeholder={f.placeholder}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.name]: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") onCancel();
              }}
              style={{ width: "100%" }}
            />
          </div>
        ))}

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!allFilled}
            onClick={submit}
          >
            {config.submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
//  CONFIRM MODAL HOST  (handles askConfirm / showAlert)
// ===========================================================================
function ConfirmModalHost() {
  const [active, setActive] = useState<ActiveDialog | null>(null);

  useEffect(() => {
    dialogDispatch = (req) => setActive(req);
    return () => {
      dialogDispatch = null;
    };
  }, []);

  // Esc / Enter shortcuts and body-scroll lock while open.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!active.hideCancel) {
          active.resolve(false);
          setActive(null);
        }
      } else if (e.key === "Enter") {
        active.resolve(true);
        setActive(null);
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [active]);

  if (!active) return null;

  const cancel = () => {
    active.resolve(false);
    setActive(null);
  };
  const confirm = () => {
    active.resolve(true);
    setActive(null);
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !active.hideCancel) cancel();
      }}
    >
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <div>
            <div className="modal-title">{active.title}</div>
            {active.message && (
              <div className="modal-sub">{active.message}</div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          {!active.hideCancel ? (
            <button className="btn btn-ghost" onClick={cancel}>
              {active.cancelLabel ?? "Cancel"}
            </button>
          ) : (
            <span />
          )}
          <button
            className="btn btn-primary"
            onClick={confirm}
            autoFocus
            style={
              active.destructive
                ? {
                    background: "var(--danger, #d96666)",
                    borderColor: "var(--danger, #d96666)",
                    color: "#fff",
                  }
                : undefined
            }
          >
            {active.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
