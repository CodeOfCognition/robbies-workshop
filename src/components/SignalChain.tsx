"use client";

import { EffectCategory, CATEGORY_SHORT_LABELS, CATEGORY_COLORS } from "@/lib/data";
import { PedalCard } from "./PedalCard";
import { AmpCard } from "./AmpCard";
import { Plus } from "lucide-react";

interface SignalChainProps {
    ampModel: string;
    effects: Record<EffectCategory, string | null>;
    onSlotClick: (slot: "amp" | EffectCategory) => void;
    size?: "sm" | "md";
}

const CHAIN_ORDER: EffectCategory[] = ["stompbox", "modulation"];
const CHAIN_ORDER_POST: EffectCategory[] = ["delay", "reverb"];

function EmptySlot({
    category,
    onClick,
    size = "md",
}: {
    category: EffectCategory;
    onClick: () => void;
    size?: "sm" | "md";
}) {
    const color = CATEGORY_COLORS[category];
    const sizeClasses = {
        sm: { wrapper: "w-[48px] h-[62px]", icon: "w-3 h-3", text: "text-[5px]" },
        md: { wrapper: "w-[46px] h-[60px]", icon: "w-3.5 h-3.5", text: "text-[7.5px]" },
    };
    const s = sizeClasses[size];

    return (
        <button
            onClick={onClick}
            className={`${s.wrapper} rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer group hover:border-solid`}
            style={{
                borderColor: `${color}50`,
                backgroundColor: `${color}08`,
            }}
        >
            <Plus
                className={`${s.icon} transition-colors`}
                style={{ color: `${color}80` }}
            />
            <span
                className={`${s.text} font-[family-name:var(--font-mono)] font-bold tracking-wider`}
                style={{ color: `${color}80` }}
            >
                {CATEGORY_SHORT_LABELS[category]}
            </span>
        </button>
    );
}

function EmptyAmpSlot({
    onClick,
    size = "md",
}: {
    onClick: () => void;
    size?: "sm" | "md";
}) {
    const sizeClasses = {
        sm: { wrapper: "w-[56px] h-[68px]", icon: "w-3 h-3", text: "text-[5px]" },
        md: { wrapper: "w-[58px] h-[72px]", icon: "w-4 h-4", text: "text-[7.5px]" },
    };
    const s = sizeClasses[size];

    return (
        <button
            onClick={onClick}
            className={`${s.wrapper} rounded-lg border-2 border-dashed border-[var(--color-amber)]/40 flex flex-col items-center justify-center gap-1 bg-[var(--color-amber)]/5 transition-all active:scale-95 cursor-pointer hover:border-solid hover:border-[var(--color-amber)]/60`}
        >
            <Plus className={`${s.icon} text-[var(--color-amber)]/60`} />
            <span className={`${s.text} font-[family-name:var(--font-mono)] font-bold tracking-wider text-[var(--color-amber)]/60`}>
                AMP
            </span>
        </button>
    );
}

function CableConnector({ size = "md" }: { size?: "sm" | "md" }) {
    const w = size === "sm" ? "w-[8px]" : "w-[8px]";
    return (
        <div className={`${w} flex items-center self-center`}>
            <div className="w-full h-[3px] bg-gradient-to-r from-zinc-600 via-zinc-500 to-zinc-600 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
        </div>
    );
}

function EndLabel({ label, size = "md" }: { label: string; size?: "sm" | "md" }) {
    const textSize = size === "sm" ? "text-[6px]" : "text-[9px]";
    return (
        <div className="flex items-center self-center">
            <span
                className={`${textSize} font-[family-name:var(--font-mono)] font-bold tracking-[0.2em] text-zinc-500`}
                style={{ writingMode: "vertical-lr", textOrientation: "mixed" }}
            >
                {label}
            </span>
        </div>
    );
}

export function SignalChain({ ampModel, effects, onSlotClick, size = "md" }: SignalChainProps) {
    const pedalSize = size;
    const ampSize = size;

    return (
        <div className="signal-chain-wrapper pb-2">
            <div className="flex items-center justify-center gap-0 px-1">
                <EndLabel label="INPUT" size={size} />
                <CableConnector size={size} />

                {/* Pre-amp effects */}
                {CHAIN_ORDER.map((cat) => (
                    <div key={cat} className="flex items-center">
                        {effects[cat] ? (
                            <PedalCard
                                effectName={effects[cat]!}
                                size={pedalSize}
                                onClick={() => onSlotClick(cat)}
                            />
                        ) : (
                            <EmptySlot
                                category={cat}
                                onClick={() => onSlotClick(cat)}
                                size={pedalSize}
                            />
                        )}
                        <CableConnector size={size} />
                    </div>
                ))}

                {/* AMP (center, dominant) */}
                {ampModel ? (
                    <AmpCard
                        modelName={ampModel}
                        size={ampSize}
                        onClick={() => onSlotClick("amp")}
                    />
                ) : (
                    <EmptyAmpSlot onClick={() => onSlotClick("amp")} size={ampSize} />
                )}

                {/* Post-amp effects */}
                {CHAIN_ORDER_POST.map((cat) => (
                    <div key={cat} className="flex items-center">
                        <CableConnector size={size} />
                        {effects[cat] ? (
                            <PedalCard
                                effectName={effects[cat]!}
                                size={pedalSize}
                                onClick={() => onSlotClick(cat)}
                            />
                        ) : (
                            <EmptySlot
                                category={cat}
                                onClick={() => onSlotClick(cat)}
                                size={pedalSize}
                            />
                        )}
                    </div>
                ))}

                <CableConnector size={size} />
                <EndLabel label="OUTPUT" size={size} />
            </div>
        </div>
    );
}
