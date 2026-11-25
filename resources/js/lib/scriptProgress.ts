import type { Script, ScriptStatus } from '@/types/crm';

/** How far one fan is through a script: steps with at least one send/mark, and the first one left. */
export function scriptProgress(
    script: Script,
    status: ScriptStatus,
): {
    sent: number;
    total: number;
    nextStepId: number | null;
    sentIds: Set<number>;
} {
    const sentIds = new Set<number>();
    let nextStepId: number | null = null;

    for (const step of script.steps) {
        if ((status[step.id]?.length ?? 0) > 0) {
            sentIds.add(step.id);
        } else if (nextStepId === null) {
            nextStepId = step.id;
        }
    }

    return {
        sent: sentIds.size,
        total: script.steps.length,
        nextStepId,
        sentIds,
    };
}

/** Index of a script's Next step (the first unsent one), or null when all are sent / no status yet. */
export function nextStepIndex(
    script: Script,
    status: ScriptStatus,
): number | null {
    const next = scriptProgress(script, status).nextStepId;
    const i = script.steps.findIndex((s) => s.id === next);

    return next === null || i < 0 ? null : i;
}

/**
 * Where the PPV chip opens the Scripts panel: the remembered folder if it still has an unsent,
 * media-ready PPV step, else the first folder (array order) that does, else null. `stepIndex` is
 * that folder's first such step.
 */
export function nextPpvTarget(
    scripts: Script[],
    status: ScriptStatus,
    rememberedId: number | null,
): { scriptId: number; stepIndex: number } | null {
    const inFolder = (s: Script) => {
        const i = s.steps.findIndex(
            (st) =>
                st.kind === 'ppv' &&
                !st.needsMedia &&
                (status[st.id]?.length ?? 0) === 0,
        );

        return i < 0 ? null : { scriptId: s.id, stepIndex: i };
    };

    const remembered = scripts.find((s) => s.id === rememberedId);
    const fromRemembered = remembered ? inFolder(remembered) : null;

    if (fromRemembered) {
        return fromRemembered;
    }

    for (const s of scripts) {
        const hit = inFolder(s);

        if (hit) {
            return hit;
        }
    }

    return null;
}
