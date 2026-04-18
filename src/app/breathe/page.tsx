"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import "./breathe.css";

const SIDE_SECS = 4;
const PHASES = [
  { key: "inhale", word: "Breathe in" },
  { key: "hold1", word: "Hold" },
  { key: "exhale", word: "Breathe out" },
  { key: "hold2", word: "Hold" },
];
const PATH_LEN = 1600;
const SIDE_LEN = PATH_LEN / 4;
const CYCLE = SIDE_SECS * 4;
const SWAP_LEAD = 0.62 / SIDE_SECS;

export default function BreathePage() {
  const [durationMin, setDurationMin] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [isIdle, setIsIdle] = useState(true);

  // DOM refs
  const progressRef = useRef<SVGRectElement>(null);
  const playRingRef = useRef<SVGCircleElement>(null);
  const phaseWordARef = useRef<HTMLDivElement>(null);
  const phaseWordBRef = useRef<HTMLDivElement>(null);

  // Animation state refs
  const rafId = useRef(0);
  const startedAt = useRef(0);
  const elapsedBeforePause = useRef(0);
  const lastPhase = useRef(-1);
  const wordSlot = useRef<"A" | "B">("A");
  const pendingSwapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const durationRef = useRef(1);

  useEffect(() => {
    durationRef.current = durationMin;
  }, [durationMin]);

  // Load saved duration from localStorage
  useEffect(() => {
    try {
      const saved = parseInt(localStorage.getItem("breathe.duration") || "", 10);
      if ([1, 3, 5].includes(saved)) setDurationMin(saved);
    } catch {}
  }, []);

  // Crossfade phase word: fade current out, then fade new in
  const setPhaseWord = useCallback((text: string, immediate = false) => {
    const a = phaseWordARef.current;
    const b = phaseWordBRef.current;
    if (!a || !b) return;

    const cur = wordSlot.current === "A" ? a : b;
    const next = wordSlot.current === "A" ? b : a;

    if (cur.innerHTML === text && cur.classList.contains("show")) return;
    if (next.innerHTML === text && next.classList.contains("show")) return;

    if (pendingSwapTimer.current) {
      clearTimeout(pendingSwapTimer.current);
      pendingSwapTimer.current = null;
    }

    if (immediate || !cur.classList.contains("show")) {
      next.innerHTML = text;
      void next.offsetWidth;
      cur.classList.remove("show");
      next.classList.add("show");
      wordSlot.current = wordSlot.current === "A" ? "B" : "A";
      return;
    }

    cur.classList.remove("show");
    pendingSwapTimer.current = setTimeout(() => {
      next.innerHTML = text;
      void next.offsetWidth;
      next.classList.add("show");
      wordSlot.current = wordSlot.current === "A" ? "B" : "A";
    }, 420);
  }, []);

  const setRing = useCallback((frac: number) => {
    const len = Math.max(0, Math.min(1, frac)) * 100;
    playRingRef.current?.setAttribute(
      "stroke-dasharray",
      `${len} ${100 - len}`
    );
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setIsIdle(true);
    elapsedBeforePause.current = 0;
    cancelAnimationFrame(rafId.current);
    progressRef.current?.setAttribute(
      "stroke-dasharray",
      `0 ${PATH_LEN}`
    );
    setRing(0);
    setPhaseWord("Begin when<br>you\u2019re ready", true);
    lastPhase.current = -1;
  }, [setPhaseWord, setRing]);

  // Use refs for tick/finish to avoid circular useCallback deps
  const tickRef = useRef<(() => void) | undefined>(undefined);
  const finishRef = useRef<(() => void) | undefined>(undefined);

  finishRef.current = () => {
    runningRef.current = false;
    setIsRunning(false);
    setIsIdle(true);
    elapsedBeforePause.current = 0;
    cancelAnimationFrame(rafId.current);
    progressRef.current?.setAttribute(
      "stroke-dasharray",
      `${PATH_LEN} 0`
    );
    setRing(1);
    setPhaseWord("Well done");
    setTimeout(() => {
      if (!runningRef.current) stop();
    }, 3200);
  };

  tickRef.current = () => {
    if (!runningRef.current) return;
    const now = performance.now();
    const totalMs = durationRef.current * 60 * 1000;
    const elapsed = now - startedAt.current;
    const remaining = Math.max(0, totalMs - elapsed);
    const fracDone = Math.min(1, elapsed / totalMs);

    const tSec = (elapsed / 1000) % CYCLE;
    const phaseIdx = Math.floor(tSec / SIDE_SECS) % 4;
    const phaseProg = (tSec - phaseIdx * SIDE_SECS) / SIDE_SECS;

    const drawn = phaseIdx * SIDE_LEN + phaseProg * SIDE_LEN;
    progressRef.current?.setAttribute(
      "stroke-dasharray",
      `${drawn} ${PATH_LEN - drawn}`
    );

    let upcomingPhase = phaseIdx;
    if (phaseProg >= 1 - SWAP_LEAD) {
      upcomingPhase = (phaseIdx + 1) % 4;
    }
    if (upcomingPhase !== lastPhase.current) {
      lastPhase.current = upcomingPhase;
      setPhaseWord(PHASES[upcomingPhase].word);
    }

    setRing(fracDone);

    if (remaining <= 0) {
      finishRef.current?.();
      return;
    }
    rafId.current = requestAnimationFrame(() => tickRef.current?.());
  };

  const start = useCallback(() => {
    runningRef.current = true;
    setIsRunning(true);
    setIsIdle(false);
    startedAt.current = performance.now() - elapsedBeforePause.current;
    rafId.current = requestAnimationFrame(() => tickRef.current?.());
  }, []);

  const pause = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    elapsedBeforePause.current = performance.now() - startedAt.current;
    cancelAnimationFrame(rafId.current);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (runningRef.current) pause();
    else start();
  }, [start, pause]);

  const handleDuration = useCallback(
    (min: number) => {
      setDurationMin(min);
      try {
        localStorage.setItem("breathe.duration", String(min));
      } catch {}
      stop();
    },
    [stop]
  );

  // Spacebar to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        handlePlayPause();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handlePlayPause]);

  // Initialize on mount
  useEffect(() => {
    stop();
    return () => cancelAnimationFrame(rafId.current);
  }, [stop]);

  return (
    <div className="breathe-app min-h-dvh flex flex-col px-4 pt-safe">
      <header className="pt-12 pb-2">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/" className="p-1">
            <ChevronLeft className="w-5 h-5 text-[var(--color-text-dim)]" />
          </Link>
          <div className="breathe-dot" />
          <h1 className="breathe-title">Breathe</h1>
        </div>
        <p className="breathe-subtitle ml-[17px]">Box breathing</p>
      </header>

      <div className="breathe-durations">
        {[1, 3, 5].map((min) => (
          <button
            key={min}
            className={`breathe-chip${durationMin === min ? " active" : ""}`}
            onClick={() => handleDuration(min)}
          >
            {min} min
          </button>
        ))}
      </div>

      <div className="breathe-stage">
        <div className={`breathe-boxwrap${isIdle ? " idle" : ""}`}>
          <svg
            className="breathe-box-svg"
            viewBox="0 0 400 400"
            aria-hidden="true"
          >
            <rect
              className="breathe-track"
              x="6"
              y="6"
              width="388"
              height="388"
              rx="20"
              ry="20"
            />
            <rect
              ref={progressRef}
              className="breathe-progress"
              x="6"
              y="6"
              width="388"
              height="388"
              rx="20"
              ry="20"
              pathLength={PATH_LEN}
              strokeDasharray={`0 ${PATH_LEN}`}
            />
          </svg>

          <div className="breathe-inner">
            <div className="breathe-phase-stack">
              <div ref={phaseWordARef} className="breathe-phase-word show">
                Begin when
                <br />
                you&rsquo;re ready
              </div>
              <div ref={phaseWordBRef} className="breathe-phase-word" />
            </div>
          </div>
        </div>
      </div>

      <div className="breathe-controls">
        <button
          className={`breathe-play${isRunning ? " running" : ""}`}
          onClick={handlePlayPause}
          aria-label={isRunning ? "Pause" : isIdle ? "Start" : "Resume"}
        >
          <div className="breathe-play-bg" />
          <svg
            className="breathe-play-ring"
            viewBox="0 0 64 64"
            aria-hidden="true"
          >
            <circle
              className="breathe-play-ring-track"
              cx="32"
              cy="32"
              r="30"
            />
            <circle
              ref={playRingRef}
              className="breathe-play-ring-fill"
              cx="32"
              cy="32"
              r="30"
              pathLength={100}
              strokeDasharray="0 100"
            />
          </svg>
          <svg
            className="breathe-play-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            {isRunning ? (
              <>
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </>
            ) : (
              <path d="M8 5v14l11-7z" />
            )}
          </svg>
        </button>
      </div>
    </div>
  );
}
