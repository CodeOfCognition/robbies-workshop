"use client";

import { PEDAL_COLORS } from "@/lib/data";

interface PedalCardProps {
    effectName: string;
    size?: "sm" | "md" | "lg";
    onClick?: () => void;
}

export function PedalCard({ effectName, size = "md", onClick }: PedalCardProps) {
    const colors = PEDAL_COLORS[effectName] || { body: "#555", accent: "#777" };

    const sizeClasses = {
        sm: { wrapper: "w-[48px] h-[62px]", knob: "w-[7px] h-[7px]", stomp: "w-[10px] h-[10px]", text: "text-[5px]", nameText: "text-[5.5px]", knobGap: "gap-[3px]", ledSize: "w-[3px] h-[3px]" },
        md: { wrapper: "w-[46px] h-[60px]", knob: "w-[7px] h-[7px]", stomp: "w-[10px] h-[10px]", text: "text-[5px]", nameText: "text-[5.5px]", knobGap: "gap-[3px]", ledSize: "w-[3px] h-[3px]" },
        lg: { wrapper: "w-[180px] h-[260px]", knob: "w-[32px] h-[32px]", stomp: "w-[44px] h-[44px]", text: "text-[10px]", nameText: "text-[14px]", knobGap: "gap-[16px]", ledSize: "w-[6px] h-[6px]" },
    };

    const s = sizeClasses[size];

    return (
        <button
            onClick={onClick}
            className={`${s.wrapper} relative flex flex-col items-center justify-between rounded-lg overflow-hidden transition-transform active:scale-95 cursor-pointer group`}
            style={{
                background: `linear-gradient(160deg, ${colors.accent} 0%, ${colors.body} 40%, ${colors.body} 100%)`,
                boxShadow: `0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)`,
            }}
        >
            {/* Knobs area */}
            <div className={`flex flex-wrap justify-center ${s.knobGap} pt-[12%] px-[8%]`}>
                {[1, 2, 3, 4].map((i) => (
                    <div
                        key={i}
                        className={`${s.knob} rounded-full relative`}
                        style={{
                            background: "radial-gradient(circle at 35% 35%, #555 0%, #1a1a1a 70%)",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.1)",
                        }}
                    >
                        {/* Knob indicator line */}
                        <div
                            className="absolute bg-white/70 rounded-full"
                            style={{
                                width: size === "lg" ? "2px" : "1px",
                                height: size === "lg" ? "8px" : size === "md" ? "4px" : "3px",
                                top: size === "lg" ? "4px" : "2px",
                                left: "50%",
                                transform: `translateX(-50%) rotate(${(i * 73) % 360}deg)`,
                                transformOrigin: "bottom center",
                            }}
                        />
                    </div>
                ))}
            </div>

            {/* LED + Stomp */}
            <div className="flex flex-col items-center gap-[4%] pb-[8%]">
                {/* LED */}
                <div
                    className={`${s.ledSize} rounded-full`}
                    style={{
                        backgroundColor: "#f59e0b",
                        boxShadow: "0 0 6px #f59e0b, 0 0 12px rgba(245,158,11,0.3)",
                    }}
                />
                {/* Stomp button */}
                <div
                    className={`${s.stomp} rounded-full`}
                    style={{
                        background: "radial-gradient(circle at 40% 35%, #ddd 0%, #999 50%, #666 100%)",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.5), inset 0 1px 2px rgba(255,255,255,0.4)",
                    }}
                />
            </div>

            {/* Name label */}
            <div
                className="absolute bottom-[18%] left-0 right-0 text-center"
                style={{
                    textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                }}
            >
                <p className={`${s.nameText} font-bold text-white tracking-wider leading-tight font-[family-name:var(--font-mono)] px-[6%]`}>
                    {effectName}
                </p>
            </div>

            {/* Hover glow */}
            <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors pointer-events-none rounded-lg" />
        </button>
    );
}
