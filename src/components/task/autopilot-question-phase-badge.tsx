'use client';

/**
 * Autopilot question phase badge - shows current autopilot question phase (gathering/autonomous/interactive)
 *
 * Displayed near task status when autopilot is running to indicate
 * whether the agent is in question-gathering or autonomous mode.
 */

const PHASE_CONFIG: Record<string, { label: string; className: string }> = {
  gathering: {
    label: 'Asking Questions',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
  autonomous: {
    label: 'Autonomous',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
  interactive: {
    label: 'Interactive',
    className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
};

export function AutopilotQuestionPhaseBadge({ phase }: { phase: string }) {
  const config = PHASE_CONFIG[phase];
  if (!config) return null;

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}
