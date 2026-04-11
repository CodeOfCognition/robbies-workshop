"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { ChevronLeft, Music, Send, Loader2, Trash2, ChevronDown } from "lucide-react";

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    query?: string | null;
}

const QUICK_QUESTIONS = [
    "What were my top artists in 2025?",
    "How much music did I listen to last month?",
    "What's my most played song of all time?",
    "When do I listen to the most music?",
];

export default function SpotifyChat() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const sendMessage = async (text: string) => {
        if (!text.trim() || isLoading) return;

        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: "user",
            content: text.trim(),
        };

        const updatedMessages = [...messages, userMessage];
        setMessages(updatedMessages);
        setInput("");
        setIsLoading(true);

        try {
            const response = await fetch("/api/explore-music", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: updatedMessages.map((m) => ({
                        role: m.role,
                        content: m.content,
                    })),
                }),
            });

            if (!response.ok) {
                throw new Error(`Request failed: ${response.status}`);
            }

            const data = await response.json();
            const assistantMessage: Message = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: data.answer,
                query: data.query,
            };
            setMessages((prev) => [...prev, assistantMessage]);
        } catch {
            const errorMessage: Message = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: "Sorry, something went wrong. Please try again.",
            };
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        sendMessage(input);
    };

    return (
        <div className="min-h-dvh flex flex-col">
            {/* Header */}
            <header className="sticky top-0 z-10 bg-[var(--color-bg)]/95 backdrop-blur-sm border-b border-[var(--color-border)] px-4 py-4 flex items-center justify-between shrink-0">
                <Link
                    href="/"
                    className="flex items-center gap-1 text-[var(--color-text-dim)]"
                >
                    <ChevronLeft className="w-5 h-5" />
                    <span className="text-sm">Back</span>
                </Link>
                <div className="flex items-center gap-2">
                    <Music className="w-4 h-4 text-[#1DB954]" />
                    <h2 className="font-[family-name:var(--font-display)] text-xl tracking-wide">
                        CHAT WITH SPOTIFY
                    </h2>
                </div>
                <button
                    onClick={() => setMessages([])}
                    className="p-1 text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)]"
                    title="Clear chat"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </header>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {messages.length === 0 && (
                    <div className="text-center pt-16">
                        <Music className="w-10 h-10 mx-auto mb-4 text-[#1DB954]/40" />
                        <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--color-text)] mb-2">
                            CHAT WITH SPOTIFY
                        </h3>
                        <p className="text-[var(--color-text-dim)] text-sm max-w-xs mx-auto mb-6">
                            Explore your listening history. Ask about your top artists, listening trends, or anything about your music.
                        </p>
                        <div className="flex flex-wrap justify-center gap-2">
                            {QUICK_QUESTIONS.map((q) => (
                                <button
                                    key={q}
                                    onClick={() => sendMessage(q)}
                                    className="text-xs px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[#1DB954]/30 hover:text-[#1DB954] transition-colors text-left"
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((m) => (
                    <div
                        key={m.id}
                        className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                        <div
                            className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                                m.role === "user"
                                    ? "bg-[#1DB954]/15 border border-[#1DB954]/20 text-[var(--color-text)]"
                                    : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]"
                            }`}
                        >
                            {m.role === "assistant" ? (
                                <>
                                    <div className="chat-markdown text-sm leading-relaxed">
                                        <ReactMarkdown>{m.content}</ReactMarkdown>
                                    </div>
                                    {m.query && <QueryDetail query={m.query} />}
                                </>
                            ) : (
                                <p className="text-sm">{m.content}</p>
                            )}
                        </div>
                    </div>
                ))}

                {isLoading && messages.length > 0 && messages[messages.length - 1]?.role === "user" && (
                    <div className="flex justify-start">
                        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl px-4 py-3">
                            <Loader2 className="w-4 h-4 text-[#1DB954] animate-spin" />
                        </div>
                    </div>
                )}
            </div>

            {/* Input */}
            <div className="sticky bottom-0 bg-[var(--color-bg)] border-t border-[var(--color-border)] p-4 pb-safe shrink-0">
                <form onSubmit={handleSubmit} className="flex items-center gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask about your music..."
                        className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[#1DB954]/50 transition-colors text-sm"
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="w-11 h-11 rounded-xl bg-[#1DB954] text-white flex items-center justify-center shrink-0 active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </form>
            </div>
        </div>
    );
}

function QueryDetail({ query }: { query: string }) {
    const [open, setOpen] = useState(false);

    return (
        <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-1 text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] transition-colors"
            >
                <ChevronDown
                    className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
                />
                SQL Query
            </button>
            {open && (
                <pre className="mt-1 text-xs text-[var(--color-text-faint)] bg-[var(--color-bg)] rounded-lg p-2 overflow-x-auto">
                    {query}
                </pre>
            )}
        </div>
    );
}
