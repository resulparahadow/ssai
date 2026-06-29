// A short, bright "bing" for new-message alerts — synthesized with the Web Audio API so
// we don't ship a binary audio asset. One shared AudioContext, a quick sine sweep with a
// fast decay envelope (~0.25s).

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let unlockBound = false;

function audioContext(): AudioContext | null {
    if (typeof window === 'undefined') {
        return null;
    }

    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as AudioCtor | undefined;

    if (!Ctor) {
        return null;
    }

    ctx = ctx ?? new Ctor();

    return ctx;
}

/**
 * Browsers block audio until a user gesture. Call once on app start: the first
 * pointer/key interaction resumes the AudioContext so later bings actually play.
 */
export function unlockAudioOnGesture(): void {
    if (unlockBound || typeof window === 'undefined') {
        return;
    }

    unlockBound = true;

    const resume = () => {
        audioContext()?.resume?.();
        window.removeEventListener('pointerdown', resume);
        window.removeEventListener('keydown', resume);
    };

    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
}

/** Play a short bing at the given volume (0–1). Silently no-ops if audio is unavailable. */
export function playBing(volume = 0.5): void {
    const ac = audioContext();

    if (!ac) {
        return;
    }

    try {
        if (ac.state === 'suspended') {
            void ac.resume();
        }

        const now = ac.currentTime;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        const vol = Math.max(0.0001, Math.min(1, volume));

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now); // A5
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.06); // sweep up → bright "bing"

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(vol, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

        osc.connect(gain).connect(ac.destination);
        osc.start(now);
        osc.stop(now + 0.26);
    } catch {
        // Audio can fail (autoplay policy, no output device) — alerts shouldn't break the app.
    }
}
