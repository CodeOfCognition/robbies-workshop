"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
    Send,
    ChevronLeft,
    Sparkles,
    Loader2,
    Search,
    BookOpen,
    Pencil,
    X,
} from "lucide-react";
import type { Preset } from "@/lib/data";

interface ToneChatProps {
    toneId: string;
    onBack: () => void;
    onToneUpdated: (tone: Preset) => void;
}

type ContentBlock = {
    type: string;
    text?: string;
    name?: string;
    input?: unknown;
};

type ChatMessage = {
    role: "user" | "assistant";
    content: ContentBlock[];
    // Used to replace/remove optimistic entries on round-trip completion.
    optimisticId?: string;
};

const QUICK_QUESTIONS = [
    "Make this sound like Comfortably Numb",
    "Add more reverb",
    "Try a cleaner amp",
    "Dial in a bluesy drive",
];

// Small pill rendered for tool_use content blocks. The agent namespaces
// tool names (e.g. `mcp__tone__update_tone`), so we substring-match.
function ToolUsePill({ name }: { name: string }) {
    const lower = name.toLowerCase();
    let icon: React.ReactNode = null;
    let label: string | null = null;

    if (lower.includes("web_search") || lower.includes("websearch")) {
        icon = <Search className="w-3 h-3" />;
        label = "Searching the web...";
    } else if (lower.includes("get_tone")) {
        icon = <BookOpen className="w-3 h-3" />;
        label = "Reading tone settings...";
    } else if (lower.includes("update_tone")) {
        icon = <Pencil className="w-3 h-3" />;
        label = "Updating tone...";
    }

    if (!label) return null;

    return (
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--color-surface-raised)] border border-[var(--color-border)] text-[var(--color-text-dim)] text-xs">
            {icon}
            <span>{label}</span>
        </div>
    );
}

function MessageBlocks({
    content,
    role,
}: {
    content: ContentBlock[];
    role: "user" | "assistant";
}) {
    return (
        <div className="space-y-2">
            {content.map((block, i) => {
                if (block.type === "text" && block.text) {
                    if (role === "assistant") {
                        return (
                            <div
                                key={i}
                                className="chat-markdown text-sm leading-relaxed"
                            >
                                <ReactMarkdown>{block.text}</ReactMarkdown>
                            </div>
                        );
                    }
                    return (
                        <p key={i} className="text-sm">
                            {block.text}
                        </p>
                    );
                }
                if (block.type === "tool_use" && block.name) {
                    return <ToolUsePill key={i} name={block.name} />;
                }
                return null;
            })}
        </div>
    );
}

export function ToneChat({ toneId, onBack, onToneUpdated }: ToneChatProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Initial history load
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/tones/${toneId}/chat`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = (await res.json()) as {
                    messages: Array<{
                        role: "user" | "assistant";
                        content: ContentBlock[];
                        createdAt: string;
                    }>;
                };
                if (!cancelled) {
                    setMessages(
                        data.messages.map((m) => ({
                            role: m.role,
                            content: m.content,
                        }))
                    );
                }
            } catch (e) {
                console.error("Failed to load chat history:", e);
                if (!cancelled) setError("Failed to load chat history");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [toneId]);

    // Auto-scroll on new messages / sending
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, sending]);

    const sendMessage = useCallback(
        async (text: string) => {
            const trimmed = text.trim();
            if (!trimmed || sending) return;

            const optimisticId = `optimistic-${Date.now()}`;
            const optimistic: ChatMessage = {
                role: "user",
                content: [{ type: "text", text: trimmed }],
                optimisticId,
            };
            setMessages((prev) => [...prev, optimistic]);
            setInput("");
            setSending(true);
            setError(null);

            try {
                const res = await fetch(`/api/tones/${toneId}/chat`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: trimmed }),
                });
                if (!res.ok) {
                    let errText = `HTTP ${res.status}`;
                    try {
                        const errBody = await res.json();
                        if (errBody?.error) errText = errBody.error;
                    } catch {
                        // ignore
                    }
                    throw new Error(errText);
                }
                const data = (await res.json()) as {
                    messages: Array<{
                        role: "user" | "assistant";
                        content: ContentBlock[];
                    }>;
                    tone: Preset;
                };

                // Replace the optimistic message with the authoritative pair.
                setMessages((prev) => {
                    const withoutOptimistic = prev.filter(
                        (m) => m.optimisticId !== optimisticId
                    );
                    return [
                        ...withoutOptimistic,
                        ...data.messages.map((m) => ({
                            role: m.role,
                            content: m.content,
                        })),
                    ];
                });

                onToneUpdated(data.tone);
            } catch (e) {
                console.error("Failed to send message:", e);
                setMessages((prev) =>
                    prev.filter((m) => m.optimisticId !== optimisticId)
                );
                setError(
                    e instanceof Error ? e.message : "Failed to send message"
                );
            } finally {
                setSending(false);
            }
        },
        [toneId, sending, onToneUpdated]
    );

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        sendMessage(input);
    };

    const canSend = !sending && !loading && !!input.trim();

    return (
        <div className="min-h-dvh flex flex-col">
            {/* Header */}
            <header className="sticky top-0 z-10 bg-[var(--color-bg)]/95 backdrop-blur-sm border-b border-[var(--color-border)] px-4 py-4 flex items-center justify-between shrink-0">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1 text-[var(--color-text-dim)]"
                >
                    <ChevronLeft className="w-5 h-5" />
                    <span className="text-sm">Back</span>
                </button>
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <h2 className="font-[family-name:var(--font-display)] text-xl tracking-wide">
                        TONEBOT
                    </h2>
                </div>
                <div className="w-16" />
            </header>

            {/* Messages */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
            >
                {error && (
                    <div className="flex items-start justify-between gap-3 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                        <span>{error}</span>
                        <button
                            onClick={() => setError(null)}
                            className="shrink-0 text-red-300/80 active:text-red-300"
                            aria-label="Dismiss error"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {loading && (
                    <div className="flex justify-center pt-16">
                        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
                    </div>
                )}

                {!loading && messages.length === 0 && (
                    <div className="text-center pt-16 animate-fade-up">
                        <Sparkles className="w-10 h-10 mx-auto mb-4 text-purple-400/40" />
                        <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--color-text)] mb-2">
                            TONEBOT
                        </h3>
                        <p className="text-[var(--color-text-dim)] text-sm max-w-xs mx-auto mb-6">
                            Design this tone in plain English. I can swap amps,
                            wire up pedals, and chase specific song sounds.
                        </p>
                        <div className="flex flex-wrap justify-center gap-2">
                            {QUICK_QUESTIONS.map((q) => (
                                <button
                                    key={q}
                                    onClick={() => sendMessage(q)}
                                    disabled={sending || loading}
                                    className="text-xs px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-purple-500/30 hover:text-purple-300 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {!loading &&
                    messages.map((m, i) => (
                        <div
                            key={i}
                            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                            <div
                                className={`max-w-[85%] rounded-2xl px-4 py-3 ${m.role === "user"
                                    ? "bg-purple-600/20 border border-purple-500/20 text-[var(--color-text)]"
                                    : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]"
                                    }`}
                            >
                                <MessageBlocks
                                    content={m.content}
                                    role={m.role}
                                />
                            </div>
                        </div>
                    ))}

                {sending && (
                    <div className="flex justify-start">
                        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl px-4 py-3">
                            <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                        </div>
                    </div>
                )}
            </div>

            {/* Input */}
            <div className="sticky bottom-0 bg-[var(--color-bg)] border-t border-[var(--color-border)] p-4 pb-safe shrink-0">
                <form
                    onSubmit={handleSubmit}
                    className="flex items-center gap-2"
                >
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Tell TONEBOT what you want..."
                        disabled={loading}
                        className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-purple-500/50 transition-colors text-sm disabled:opacity-60"
                    />
                    <button
                        type="submit"
                        disabled={!canSend}
                        className="w-11 h-11 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0 active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </form>
            </div>
        </div>
    );
}
