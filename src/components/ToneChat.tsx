"use client";

import { useChat } from "@ai-sdk/react";
import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Send, ChevronLeft, Sparkles, Loader2, Trash2 } from "lucide-react";

interface ToneChatProps {
    onBack: () => void;
}

function getTextContent(parts: Array<{ type: string; text?: string }>): string {
    return parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!)
        .join("");
}

export function ToneChat({ onBack }: ToneChatProps) {
    const { messages, sendMessage, setMessages, status } = useChat();
    const [input, setInput] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);
    const isLoading = status === "streaming" || status === "submitted";

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;
        sendMessage({ text: input.trim() });
        setInput("");
    };

    const handleQuickQuestion = (question: string) => {
        sendMessage({ text: question });
    };

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
                        <Sparkles className="w-10 h-10 mx-auto mb-4 text-purple-400/40" />
                        <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--color-text)] mb-2">
                            TONEBOT
                        </h3>
                        <p className="text-[var(--color-text-dim)] text-sm max-w-xs mx-auto mb-6">
                            Your Mustang Micro Plus tone expert. Ask me about amp settings, effects, or tone matching for any song.
                        </p>
                        <div className="flex flex-wrap justify-center gap-2">
                            {[
                                "What amp should I use for blues?",
                                "Help me nail the Back in Black tone",
                                "Best settings for clean jazz?",
                                "What's the difference between the British amps?",
                            ].map((q) => (
                                <button
                                    key={q}
                                    onClick={() => handleQuickQuestion(q)}
                                    className="text-xs px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-purple-500/30 hover:text-purple-300 transition-colors text-left"
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((m) => {
                    const text = getTextContent(m.parts as Array<{ type: string; text?: string }>);
                    return (
                        <div
                            key={m.id}
                            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                            <div
                                className={`max-w-[85%] rounded-2xl px-4 py-3 ${m.role === "user"
                                        ? "bg-purple-600/20 border border-purple-500/20 text-[var(--color-text)]"
                                        : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]"
                                    }`}
                            >
                                {m.role === "assistant" ? (
                                    <div className="chat-markdown text-sm leading-relaxed">
                                        <ReactMarkdown>{text}</ReactMarkdown>
                                    </div>
                                ) : (
                                    <p className="text-sm">{text}</p>
                                )}
                            </div>
                        </div>
                    );
                })}

                {isLoading && messages.length > 0 && messages[messages.length - 1]?.role === "user" && (
                    <div className="flex justify-start">
                        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl px-4 py-3">
                            <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
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
                        placeholder="Ask about tones, amps, effects..."
                        className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4 py-3 text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-purple-500/50 transition-colors text-sm"
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="w-11 h-11 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0 active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </form>
            </div>
        </div>
    );
}
