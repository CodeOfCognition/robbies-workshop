"use client";

import Link from "next/link";
import { Guitar, Mic, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

const apps = [
  {
    name: "TONEBOARD",
    description: "Guitar amp preset builder",
    href: "/toneboard",
    icon: Guitar,
    color: "var(--color-amber)",
  },
  {
    name: "TRANSCRIBER",
    description: "Speech to text via Whisper",
    href: "/transcriber",
    icon: Mic,
    color: "#3b82f6",
  },
];

export default function Home() {
  return (
    <div className="min-h-dvh flex flex-col px-4 pt-safe">
      <header className="pt-12 pb-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-2 h-2 rounded-full bg-[var(--color-amber)] led-glow" />
            <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-wide text-[var(--color-text)]">
              ROB&apos;S TOOLS
            </h1>
          </div>
          <button
            onClick={() => signOut()}
            className="p-2 text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[var(--color-text-dim)] text-sm ml-5">
          Pick a tool
        </p>
      </header>

      <div className="stagger space-y-3 flex-1">
        {apps.map((app) => (
          <Link
            key={app.href}
            href={app.href}
            className="block w-full text-left bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 active:scale-[0.98] transition-transform"
          >
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${app.color}15` }}
              >
                <app.icon
                  className="w-6 h-6"
                  style={{ color: app.color }}
                />
              </div>
              <div>
                <h2 className="font-[family-name:var(--font-mono)] text-sm font-bold text-[var(--color-text)]">
                  {app.name}
                </h2>
                <p className="text-xs text-[var(--color-text-dim)] mt-0.5">
                  {app.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
