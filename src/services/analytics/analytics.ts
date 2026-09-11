/**
 * Milestone 1 analytics: dev-console only. A real sink is wired in Milestone 7.
 * Event names follow docs/MVP_WIREFLOW.md "Minimum Analytics Events" and
 * docs/TECH_STACK.md §14. The funnel that matters:
 *   round_started -> animation_viewed -> round_2_started
 */
export type AnalyticsEvent =
  | 'app_opened'
  | 'game_created'
  | 'game_joined'
  | 'round_started'
  | 'drawing_submitted'
  | 'judge_started'
  | 'judge_completed'
  | 'results_viewed'
  | 'characterization_started'
  | 'characterization_completed'
  | 'animation_started'
  | 'animation_completed'
  | 'animation_viewed'
  | 'next_round_pressed'
  | 'round_2_started'
  | 'game_ended'
  | 'generation_failed'
  | 'drawing_export_started'
  | 'drawing_export_completed'
  | 'drawing_upload_started'
  | 'drawing_upload_completed'
  | 'drawing_upload_failed'
  | 'remote_drawing_loaded';

export function track(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (__DEV__) {
    console.log(`[analytics] ${event}`, props ?? {});
  }
}
