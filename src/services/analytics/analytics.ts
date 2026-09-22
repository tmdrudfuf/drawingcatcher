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
  | 'judge_failed'
  | 'judge_fallback_used'
  | 'results_viewed'
  | 'characterization_started'
  | 'characterization_completed'
  | 'characterization_failed'
  | 'animation_started'
  | 'animation_completed'
  | 'animation_viewed'
  | 'winner_animation_video_available'
  | 'winner_animation_video_playback_failed'
  | 'bring_to_life_choice_viewed'
  | 'bring_to_life_characterize_selected'
  | 'bring_to_life_animate_selected'
  | 'rewarded_ad_requested'
  | 'rewarded_ad_loaded'
  | 'rewarded_ad_opened'
  | 'rewarded_ad_earned'
  | 'rewarded_ad_closed'
  | 'rewarded_ad_failed'
  | 'rewarded_ad_verified'
  | 'animation_generation_requested'
  | 'animation_generation_started'
  | 'animation_generation_processing'
  | 'animation_generation_completed'
  | 'animation_generation_failed'
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
