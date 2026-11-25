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
