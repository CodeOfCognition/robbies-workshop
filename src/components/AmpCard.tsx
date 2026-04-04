"use client";

interface AmpCardProps {
    modelName: string;
    size?: "sm" | "md" | "lg";
    onClick?: () => void;
}

export function AmpCard({ modelName, size = "md", onClick }: AmpCardProps) {
    const sizeClasses = {
        sm: { wrapper: "w-[56px] h-[68px]", grille: "h-[32px]", text: "text-[5px]", nameText: "text-[4.5px]", knob: "w-[5px] h-[5px]", topPad: "pt-[3px] pb-[2px]", knobGap: "gap-[2px]" },
        md: { wrapper: "w-[58px] h-[72px]", grille: "h-[32px]", text: "text-[5.5px]", nameText: "text-[5px]", knob: "w-[5px] h-[5px]", topPad: "pt-[3px] pb-[2px]", knobGap: "gap-[2px]" },
        lg: { wrapper: "w-[220px] h-[280px]", grille: "h-[140px]", text: "text-[12px]", nameText: "text-[14px]", knob: "w-[20px] h-[20px]", topPad: "pt-[12px] pb-[8px]", knobGap: "gap-[8px]" },
    };

    const s = sizeClasses[size];

    // Determine amp style based on name
    const isTweed = modelName.includes("57") || modelName.includes("BASSMAN") || modelName.includes("THRIFT") || modelName.includes("EXCELSIOR");
    const isBritish = modelName.includes("BRITISH") || modelName.includes("WATTS");
    const isModern = modelName.includes("METAL") || modelName.includes("UBER") || modelName.includes("90S");

    const cabinetColor = isTweed ? "#4a3728" : isBritish ? "#2d1f14" : isModern ? "#111111" : "#1a1a1a";
    const grilleColor = isTweed ? "#c4a76c" : isBritish ? "#8b7355" : "#d4d0c8";
    const tolex = isTweed
        ? "linear-gradient(160deg, #5a4738 0%, #4a3728 50%, #3a2718 100%)"
        : isBritish
            ? "linear-gradient(160deg, #3d2f24 0%, #2d1f14 50%, #1d0f04 100%)"
            : isModern
                ? "linear-gradient(160deg, #222 0%, #111 50%, #0a0a0a 100%)"
                : "linear-gradient(160deg, #2a2a2a 0%, #1a1a1a 50%, #0a0a0a 100%)";

    return (
        <button
            onClick={onClick}
            className={`${s.wrapper} relative flex flex-col rounded-lg overflow-hidden transition-transform active:scale-95 cursor-pointer group`}
            style={{
                background: tolex,
                boxShadow: `0 6px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)`,
                border: `1px solid rgba(255,255,255,0.06)`,
            }}
        >
            {/* Top control panel + handle */}
            <div className={`flex flex-col items-center ${s.topPad} px-[6%]`}>
                {/* Handle */}
                <div
                    className="rounded-sm mb-[2px]"
                    style={{
                        width: size === "lg" ? "40px" : size === "md" ? "20px" : "12px",
                        height: size === "lg" ? "6px" : size === "md" ? "3px" : "2px",
                        backgroundColor: cabinetColor,
                        border: "1px solid rgba(255,255,255,0.08)",
                    }}
                />
                {/* Knobs row */}
                <div className={`flex justify-center ${s.knobGap} mt-[2px]`}>
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div
                            key={i}
                            className={`${s.knob} rounded-full`}
                            style={{
                                background: "radial-gradient(circle at 35% 35%, #555 0%, #1a1a1a 70%)",
                                boxShadow: "0 1px 2px rgba(0,0,0,0.5)",
                            }}
                        />
                    ))}
                </div>
            </div>

            {/* Grille cloth */}
            <div
                className={`${s.grille} mx-[6%] rounded-sm flex items-center justify-center relative overflow-hidden`}
                style={{
                    backgroundColor: grilleColor,
                    backgroundImage: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent 1px,
            rgba(0,0,0,0.15) 1px,
            rgba(0,0,0,0.15) 2px
          ), repeating-linear-gradient(
            90deg,
            transparent,
            transparent 1px,
            rgba(0,0,0,0.08) 1px,
            rgba(0,0,0,0.08) 2px
          )`,
                    boxShadow: "inset 0 2px 8px rgba(0,0,0,0.3)",
                }}
            >
                {/* Brand logo area */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <span
                        className={`${s.nameText} italic text-white/40 font-[family-name:var(--font-body)]`}
                        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
                    >
                        {size !== "sm" ? "Fender" : ""}
                    </span>
                </div>
            </div>

            {/* Model name plate */}
            <div className="flex-1 flex items-center justify-center px-[4%]">
                <p
                    className={`${s.text} text-white/70 text-center font-[family-name:var(--font-mono)] font-bold tracking-wider leading-tight`}
                    style={{ textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}
                >
                    {modelName}
                </p>
            </div>

            {/* Hover glow */}
            <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors pointer-events-none rounded-lg" />
        </button>
    );
}
