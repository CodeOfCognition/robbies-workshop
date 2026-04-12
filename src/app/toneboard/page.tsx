"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  ChevronLeft,
  Trash2,
  Zap,
  Music,
  Save,
  X,
  Guitar,
  ChevronDown,
  ChevronUp,
  ArrowLeftRight,
  Sparkles,
} from "lucide-react";
import {
  Preset,
  AMP_MODELS,
  EffectCategory,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  PEDAL_COLORS,
  getEffectsByCategory,
} from "@/lib/data";
import {
  listPresets,
  createPreset,
  updatePreset,
  deletePreset,
} from "@/lib/store";
import { SignalChain } from "@/components/SignalChain";
import { PedalCard } from "@/components/PedalCard";
import { AmpCard } from "@/components/AmpCard";
import { ToneChat } from "@/components/ToneChat";
import Link from "next/link";

type View =
  | { type: "library" }
  | { type: "editor"; presetId: string | null }
  | { type: "amp-picker" }
  | { type: "effect-picker"; category: EffectCategory }
  | { type: "chat"; presetId: string };

function blankDraft(): Preset {
  return {
    id: "",
    name: "",
    ampModel: "",
    effects: { stompbox: null, modulation: null, delay: null, reverb: null },
    createdAt: 0,
    updatedAt: 0,
  };
}

export default function App() {
  const [view, setView] = useState<View>({ type: "library" });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [draft, setDraft] = useState<Preset>(blankDraft());
  const [loaded, setLoaded] = useState(false);
  const [detailSlot, setDetailSlot] = useState<EffectCategory | null>(null);
  const [showSongInfo, setShowSongInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks whether `draft` points at a freshly-created blank row that
  // has not yet been saved by the user. On Back from the editor we
  // delete it so empty rows don't leak into the library.
  const [draftIsNew, setDraftIsNew] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listPresets();
        if (!cancelled) setPresets(list);
      } catch (e) {
        console.error("Failed to load presets:", e);
        if (!cancelled) setError("Failed to load presets");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshPresets = useCallback(async () => {
    try {
      const list = await listPresets();
      setPresets(list);
    } catch (e) {
      console.error("Failed to refresh presets:", e);
      setError("Failed to load presets");
    }
  }, []);

  const openNewPreset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await createPreset({});
      setDraft(created);
      setDraftIsNew(true);
      setShowSongInfo(false);
      setError(null);
      setView({ type: "editor", presetId: created.id });
    } catch (e) {
      console.error("Failed to create preset:", e);
      setError("Failed to create preset");
    } finally {
      setBusy(false);
    }
  };

  const openEditPreset = (p: Preset) => {
    setDraft({ ...p });
    setDraftIsNew(false);
    setShowSongInfo(!!(p.songName || p.artistName || p.notes));
    setView({ type: "editor", presetId: p.id });
  };

  // Leave the editor back to the library. If the draft is a new unsaved
  // row, delete it so cancelled creations don't leave empty rows behind.
  const leaveEditor = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (draftIsNew) {
        try {
          await deletePreset(draft.id);
        } catch (e) {
          console.error("Failed to delete empty draft:", e);
          setError("Failed to discard draft");
        }
      }
      setDraftIsNew(false);
      await refreshPresets();
      setView({ type: "library" });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!draft.ampModel) return;
    if (busy) return;
    setBusy(true);
    const name =
      draft.name.trim() ||
      (draft.songName
        ? `${draft.songName} — ${draft.ampModel}`
        : draft.ampModel);
    try {
      await updatePreset(draft.id, {
        name,
        ampModel: draft.ampModel,
        effects: draft.effects,
        songName: draft.songName,
        artistName: draft.artistName,
        notes: draft.notes,
      });
      setDraftIsNew(false);
      setError(null);
      await refreshPresets();
      setView({ type: "library" });
    } catch (e) {
      console.error("Failed to save preset:", e);
      setError("Failed to save preset");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deletePreset(draft.id);
      setDraftIsNew(false);
      setError(null);
      await refreshPresets();
      setView({ type: "library" });
    } catch (e) {
      console.error("Failed to delete preset:", e);
      setError("Failed to delete preset");
    } finally {
      setBusy(false);
    }
  };

  // Called when the tone agent updates the tone during a chat turn. Sync
  // the draft (so the editor redraws on return) and the library list (so
  // the card preview is in sync). Also surface the song info section if
  // the agent wrote any song/artist/notes fields.
  const handleToneUpdatedFromChat = useCallback((updated: Preset) => {
    setDraft((prev) =>
      prev.id === updated.id ? updated : prev
    );
    setPresets((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
    if (updated.songName || updated.artistName || updated.notes) {
      setShowSongInfo(true);
    }
    setDraftIsNew(false);
  }, []);

  const handleSlotClick = (slot: "amp" | EffectCategory) => {
    if (slot === "amp") {
      setView({ type: "amp-picker" });
    } else {
      // If the slot has an effect, show the detail overlay
      if (draft.effects[slot]) {
        setDetailSlot(slot);
      } else {
        // Empty slot — go straight to picker
        setView({ type: "effect-picker", category: slot });
      }
    }
  };

  if (!loaded) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[var(--color-bg)]">
        <Zap className="w-8 h-8 text-[var(--color-amber)] animate-pulse" />
      </div>
    );
  }

  // === CHAT VIEW ===
  if (view.type === "chat") {
    return (
      <ToneChat
        toneId={view.presetId}
        onBack={() =>
          setView({ type: "editor", presetId: view.presetId })
        }
        onToneUpdated={handleToneUpdatedFromChat}
      />
    );
  }

  // === LIBRARY VIEW ===
  if (view.type === "library") {
    return (
      <div className="min-h-dvh pb-24 px-4 pt-safe">
        <header className="pt-12 pb-6">
          <div className="flex items-center gap-3 mb-1">
            <Link href="/" className="p-1">
              <ChevronLeft className="w-5 h-5 text-[var(--color-text-dim)]" />
            </Link>
            <div className="w-2 h-2 rounded-full bg-[var(--color-amber)] led-glow" />
            <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-wide text-[var(--color-text)]">
              TONEBOARD
            </h1>
          </div>
          <p className="text-[var(--color-text-dim)] text-sm ml-5">
            Mustang Micro Plus
          </p>
        </header>

        {error && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">
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

        {presets.length === 0 ? (
          <div className="animate-fade-up mt-20 text-center">
            <Guitar className="w-16 h-16 mx-auto mb-4 text-[var(--color-text-faint)]" strokeWidth={1} />
            <p className="text-[var(--color-text-dim)] mb-1">No presets yet</p>
            <p className="text-[var(--color-text-faint)] text-sm">
              Tap + to build your first tone
            </p>
          </div>
        ) : (
          <div className="stagger space-y-3">
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => openEditPreset(p)}
                className="w-full text-left bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 active:scale-[0.98] transition-transform"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-[family-name:var(--font-mono)] text-sm font-bold text-[var(--color-text)] truncate">
                      {p.name || p.ampModel}
                    </h3>
                    {p.songName && (
                      <p className="text-xs text-[var(--color-text-dim)] mt-0.5 truncate flex items-center gap-1">
                        <Music className="w-3 h-3 shrink-0" />
                        {p.songName}
                        {p.artistName ? ` — ${p.artistName}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                {/* Mini signal chain preview */}
                <div className="flex items-center justify-center">
                  <SignalChain
                    ampModel={p.ampModel}
                    effects={p.effects}
                    onSlotClick={() => { }}
                    size="sm"
                  />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* FAB */}
        <div className="fixed bottom-6 right-6 flex flex-col gap-3">
          <button
            onClick={openNewPreset}
            disabled={busy}
            className="w-14 h-14 rounded-full bg-[var(--color-amber)] text-black flex items-center justify-center shadow-lg shadow-[var(--color-amber)]/20 active:scale-95 transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Plus className="w-6 h-6" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    );
  }

  // === AMP PICKER ===
  if (view.type === "amp-picker") {
    return (
      <div className="min-h-dvh pb-8 animate-fade-in">
        <header className="sticky top-0 z-10 bg-[var(--color-bg)]/95 backdrop-blur-sm border-b border-[var(--color-border)] px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => setView({ type: "editor", presetId: draft.id })}
            className="p-1"
          >
            <ChevronLeft className="w-5 h-5 text-[var(--color-text-dim)]" />
          </button>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-wide">
            SELECT AMP
          </h2>
        </header>
        <div className="px-4 pt-3 space-y-1.5">
          {AMP_MODELS.map((amp) => (
            <button
              key={amp.name}
              onClick={() => {
                setDraft((d) => ({ ...d, ampModel: amp.name }));
                setView({ type: "editor", presetId: draft.id });
              }}
              className={`w-full text-left px-4 py-3 rounded-lg transition-colors flex items-center justify-between gap-3 ${draft.ampModel === amp.name
                ? "bg-[var(--color-amber)]/10 border border-[var(--color-amber)]/30"
                : "bg-[var(--color-surface)] border border-transparent active:bg-[var(--color-surface-raised)]"
                }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <AmpCard modelName={amp.name} size="sm" />
                <div className="min-w-0">
                  <p
                    className={`font-[family-name:var(--font-mono)] text-sm font-bold ${draft.ampModel === amp.name
                      ? "text-[var(--color-amber)]"
                      : "text-[var(--color-text)]"
                      }`}
                  >
                    {amp.name}
                  </p>
                  {amp.description && (
                    <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
                      {amp.description}
                    </p>
                  )}
                </div>
              </div>
              {draft.ampModel === amp.name && (
                <div className="w-2 h-2 rounded-full bg-[var(--color-amber)] led-glow shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // === EFFECT PICKER ===
  if (view.type === "effect-picker") {
    const cat = view.category;
    const effects = getEffectsByCategory(cat);
    const color = CATEGORY_COLORS[cat];
    return (
      <div className="min-h-dvh pb-8 animate-fade-in">
        <header className="sticky top-0 z-10 bg-[var(--color-bg)]/95 backdrop-blur-sm border-b border-[var(--color-border)] px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => setView({ type: "editor", presetId: draft.id })}
            className="p-1"
          >
            <ChevronLeft className="w-5 h-5 text-[var(--color-text-dim)]" />
          </button>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-wide">
            {CATEGORY_LABELS[cat].toUpperCase()}
          </h2>
        </header>
        <div className="px-4 pt-3 space-y-1.5">
          {/* None option */}
          <button
            onClick={() => {
              setDraft((d) => ({
                ...d,
                effects: { ...d.effects, [cat]: null },
              }));
              setView({ type: "editor", presetId: draft.id });
            }}
            className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${draft.effects[cat] === null
              ? "bg-[var(--color-surface-raised)] border border-[var(--color-border-bright)]"
              : "bg-[var(--color-surface)] border border-transparent active:bg-[var(--color-surface-raised)]"
              }`}
          >
            <p className="font-[family-name:var(--font-mono)] text-sm text-[var(--color-text-faint)]">
              NONE
            </p>
          </button>
          {effects.map((fx) => {
            const isSelected = draft.effects[cat] === fx.name;
            const pedalColor = PEDAL_COLORS[fx.name];
            return (
              <button
                key={fx.name}
                onClick={() => {
                  setDraft((d) => ({
                    ...d,
                    effects: { ...d.effects, [cat]: fx.name },
                  }));
                  setView({ type: "editor", presetId: draft.id });
                }}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors flex items-center justify-between gap-3 ${isSelected
                  ? "border"
                  : "bg-[var(--color-surface)] border border-transparent active:bg-[var(--color-surface-raised)]"
                  }`}
                style={
                  isSelected
                    ? {
                      backgroundColor: `${color}10`,
                      borderColor: `${color}40`,
                    }
                    : {}
                }
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Mini pedal swatch */}
                  <div
                    className="w-8 h-10 rounded shrink-0"
                    style={{
                      background: pedalColor
                        ? `linear-gradient(160deg, ${pedalColor.accent}, ${pedalColor.body})`
                        : `linear-gradient(160deg, ${color}80, ${color})`,
                      boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                    }}
                  />
                  <p
                    className="font-[family-name:var(--font-mono)] text-sm font-bold"
                    style={{ color: isSelected ? color : "var(--color-text)" }}
                  >
                    {fx.name}
                  </p>
                </div>
                {isSelected && (
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      backgroundColor: color,
                      boxShadow: `0 0 6px ${color}`,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // === EDITOR VIEW ===
  const isEditing = presets.some((p) => p.id === draft.id);
  const canSave = draft.ampModel !== "";

  return (
    <div className="min-h-dvh pb-12 animate-fade-in">
      {/* Pedal Detail Overlay */}
      {detailSlot && draft.effects[detailSlot] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in"
          onClick={() => setDetailSlot(null)}
        >
          <div
            className="flex flex-col items-center gap-6 animate-zoom-in"
            onClick={(e) => e.stopPropagation()}
          >
            <PedalCard
              effectName={draft.effects[detailSlot]!}
              size="lg"
              onClick={() => setDetailSlot(null)}
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDetailSlot(null);
                  setView({ type: "effect-picker", category: detailSlot });
                }}
                className="px-5 py-2.5 rounded-lg bg-[var(--color-surface-raised)] border border-[var(--color-border-bright)] text-[var(--color-text)] font-[family-name:var(--font-mono)] text-xs flex items-center gap-2 active:scale-95 transition-transform"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                REPLACE
              </button>
              <button
                onClick={() => {
                  setDraft((d) => ({
                    ...d,
                    effects: { ...d.effects, [detailSlot]: null },
                  }));
                  setDetailSlot(null);
                }}
                className="px-5 py-2.5 rounded-lg bg-red-950/40 border border-red-900/30 text-red-400 font-[family-name:var(--font-mono)] text-xs flex items-center gap-2 active:scale-95 transition-transform"
              >
                <X className="w-3.5 h-3.5" />
                REMOVE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-10 bg-[var(--color-bg)]/95 backdrop-blur-sm border-b border-[var(--color-border)] px-4 py-4 flex items-center justify-between">
        <button
          onClick={leaveEditor}
          disabled={busy}
          className="flex items-center gap-1 text-[var(--color-text-dim)] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm">Back</span>
        </button>
        <h2 className="font-[family-name:var(--font-display)] text-xl tracking-wide">
          {draft.ampModel || (isEditing ? "EDIT PRESET" : "NEW PRESET")}
        </h2>
        <div className="w-16" />
      </header>

      <div className="px-4 pt-6 space-y-6">
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
        {/* Preset Name */}
        <div>
          <label className="block text-xs text-[var(--color-text-faint)] uppercase tracking-widest font-[family-name:var(--font-mono)] mb-2">
            Preset Name
          </label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="My Tone..."
            className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-3 text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-amber)]/50 transition-colors text-sm"
          />
        </div>

        {/* Signal Chain */}
        <div>
          <label className="block text-xs text-[var(--color-text-faint)] uppercase tracking-widest font-[family-name:var(--font-mono)] mb-3">
            Signal Chain
          </label>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
            <SignalChain
              ampModel={draft.ampModel}
              effects={draft.effects}
              onSlotClick={handleSlotClick}
              size="md"
            />
          </div>
          <p className="text-[10px] text-[var(--color-text-faint)] mt-2 text-center font-[family-name:var(--font-mono)]">
            TAP A SLOT TO CHANGE • TAP A PEDAL FOR DETAILS
          </p>
        </div>

        {/* Song Info (collapsible) */}
        <div>
          <button
            onClick={() => setShowSongInfo(!showSongInfo)}
            className="flex items-center gap-2 text-xs text-[var(--color-text-faint)] uppercase tracking-widest font-[family-name:var(--font-mono)] mb-2 w-full"
          >
            <span>Song & Notes</span>
            <span className="text-[var(--color-text-faint)] normal-case">(optional)</span>
            {showSongInfo ? (
              <ChevronUp className="w-3 h-3 ml-auto" />
            ) : (
              <ChevronDown className="w-3 h-3 ml-auto" />
            )}
          </button>
          {showSongInfo && (
            <div className="space-y-2 animate-fade-in">
              <input
                type="text"
                value={draft.songName || ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, songName: e.target.value }))
                }
                placeholder="Song name"
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-2.5 text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-amber)]/50 transition-colors text-sm"
              />
              <input
                type="text"
                value={draft.artistName || ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, artistName: e.target.value }))
                }
                placeholder="Artist"
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-2.5 text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-amber)]/50 transition-colors text-sm"
              />
              <textarea
                value={draft.notes || ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, notes: e.target.value }))
                }
                placeholder="Tone notes, guitar used, etc..."
                rows={3}
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-2.5 text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-amber)]/50 transition-colors text-sm resize-none"
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-3 pt-2">
          <button
            onClick={handleSave}
            disabled={!canSave || busy}
            className={`w-full py-3.5 rounded-xl font-[family-name:var(--font-display)] text-lg tracking-wider flex items-center justify-center gap-2 transition-all ${canSave && !busy
              ? "bg-[var(--color-amber)] text-black active:scale-[0.98]"
              : "bg-[var(--color-surface)] text-[var(--color-text-faint)] cursor-not-allowed opacity-60"
              }`}
          >
            <Save className="w-4 h-4" />
            {isEditing ? "UPDATE PRESET" : "SAVE PRESET"}
          </button>

          {isEditing && (
            <button
              onClick={handleDelete}
              disabled={busy}
              className="w-full py-3 rounded-xl border border-red-900/30 text-red-400 font-[family-name:var(--font-mono)] text-xs flex items-center justify-center gap-2 active:bg-red-950/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              DELETE PRESET
            </button>
          )}
        </div>
      </div>

      {/* Chat FAB — opens the per-tone agent conversation */}
      {draft.id && (
        <button
          onClick={() => setView({ type: "chat", presetId: draft.id })}
          className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-lg shadow-purple-600/20 active:scale-95 transition-transform"
          title="Chat with ToneBot about this tone"
        >
          <Sparkles className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
