import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { track } from '@/services/analytics/analytics';
import { resolveAdMobMode, rewardedAdUnitIdForMode } from './admobConfig';
import type {
  RewardedAdPreparationResult,
  RewardedAdProvider,
  RewardedAdResult,
  RewardedAdSsvCorrelation,
} from './RewardedAdProvider';

interface RewardedAdHandle {
  addAdEventListener(event: string, listener: () => void): () => void;
  load(): void;
  show(): Promise<void>;
}

interface RewardedAdSdk {
  createRewardedAd(correlation?: RewardedAdSsvCorrelation): RewardedAdHandle;
  events: {
    loaded: string;
    error: string;
    opened: string;
    closed: string;
    earned: string;
  };
}

interface RewardedAdRuntime {
  isSupported(): boolean;
  loadSdk(): Promise<RewardedAdSdk>;
}

interface PreparedAd {
  ad: RewardedAdHandle;
  correlationKey: string;
  loaded: boolean;
  failed: boolean;
  earned: boolean;
  showing: boolean;
  loadPromise: Promise<RewardedAdPreparationResult>;
  resolveShow?: (result: RewardedAdResult) => void;
  unsubscribe: (() => void)[];
}

function correlationKey(correlation?: RewardedAdSsvCorrelation): string {
  return JSON.stringify([
    correlation?.opaqueUserId ?? null,
    correlation?.opaqueCustomData ?? null,
  ]);
}

const nativeRuntime: RewardedAdRuntime = {
  isSupported: () => Platform.OS !== 'web' && Constants.appOwnership !== 'expo',
  loadSdk: async () => {
    const googleAds = await import('react-native-google-mobile-ads');
    await googleAds.default().initialize();
    // M4E step 3: EXPO_PUBLIC_ADMOB_MODE selects the ad unit id at runtime
    // (no rebuild needed for this half -- only the native App ID in
    // app.config.ts requires one). Fails safe to TestIds.REWARDED for any
    // absent/malformed value; see admobConfig.ts.
    const adMobMode = resolveAdMobMode();
    const adUnitId = rewardedAdUnitIdForMode(adMobMode, googleAds.TestIds.REWARDED);
    if (adMobMode === 'production') {
      // Loud and unmissable on purpose: this is the one runtime signal that
      // a REAL, revenue-bearing ad unit is about to be requested.
      console.warn(
        '[ads] EXPO_PUBLIC_ADMOB_MODE=production -- requesting the PRODUCTION rewarded ad unit, not a test ad.',
      );
    }
    return {
      createRewardedAd: (correlation) =>
        googleAds.RewardedAd.createForAdRequest(adUnitId, {
          serverSideVerificationOptions: correlation
            ? {
                userId: correlation.opaqueUserId,
                customData: correlation.opaqueCustomData,
              }
            : undefined,
        }),
      events: {
        loaded: googleAds.RewardedAdEventType.LOADED,
        error: googleAds.AdEventType.ERROR,
        opened: googleAds.AdEventType.OPENED,
        closed: googleAds.AdEventType.CLOSED,
        earned: googleAds.RewardedAdEventType.EARNED_REWARD,
      },
    };
  },
};

export class GoogleRewardedAdProvider implements RewardedAdProvider {
  private prepared: PreparedAd | null = null;
  private preparation: { correlationKey: string; promise: Promise<RewardedAdPreparationResult> } | null = null;
  private sdkPromise: Promise<RewardedAdSdk> | null = null;

  constructor(private readonly runtime: RewardedAdRuntime = nativeRuntime) {}

  prepare(correlation?: RewardedAdSsvCorrelation): Promise<RewardedAdPreparationResult> {
    if (!this.runtime.isSupported()) return Promise.resolve({ status: 'unavailable' });

    const key = correlationKey(correlation);
    if (this.prepared?.correlationKey === key && !this.prepared.failed) {
      return this.prepared.loadPromise;
    }
    if (this.preparation?.correlationKey === key) return this.preparation.promise;
    this.disposePrepared();

    const promise = this.prepareNewAd(correlation, key);
    this.preparation = { correlationKey: key, promise };
    void promise.finally(() => {
      if (this.preparation?.promise === promise) this.preparation = null;
    });
    return promise;
  }

  private async prepareNewAd(
    correlation: RewardedAdSsvCorrelation | undefined,
    key: string,
  ): Promise<RewardedAdPreparationResult> {
    try {
      this.sdkPromise ??= this.runtime.loadSdk();
      const sdk = await this.sdkPromise;
      const ad = sdk.createRewardedAd(correlation);
      let resolveLoad!: (result: RewardedAdPreparationResult) => void;
      const session: PreparedAd = {
        ad,
        correlationKey: key,
        loaded: false,
        failed: false,
        earned: false,
        showing: false,
        loadPromise: new Promise((resolve) => {
          resolveLoad = resolve;
        }),
        unsubscribe: [],
      };

      session.unsubscribe.push(
        ad.addAdEventListener(sdk.events.loaded, () => {
          session.loaded = true;
          track('rewarded_ad_loaded');
          resolveLoad({ status: 'ready' });
        }),
        ad.addAdEventListener(sdk.events.error, () => {
          session.failed = true;
          track('rewarded_ad_failed');
          resolveLoad({ status: 'error' });
          this.finishSession(session, { status: 'error', message: 'The rewarded ad could not be loaded.' });
        }),
        ad.addAdEventListener(sdk.events.opened, () => track('rewarded_ad_opened')),
        ad.addAdEventListener(sdk.events.earned, () => {
          session.earned = true;
          track('rewarded_ad_earned');
        }),
        ad.addAdEventListener(sdk.events.closed, () => {
          track('rewarded_ad_closed');
          this.finishSession(
            session,
            session.earned ? { status: 'earned' } : { status: 'closed_without_reward' },
          );
        }),
      );
      this.prepared = session;
      ad.load();
      return session.loadPromise;
    } catch {
      this.sdkPromise = null;
      this.disposePrepared();
      track('rewarded_ad_failed');
      return { status: 'error' };
    }
  }

  async show(correlation?: RewardedAdSsvCorrelation): Promise<RewardedAdResult> {
    track('rewarded_ad_requested');
    if (!this.runtime.isSupported()) return { status: 'unavailable' };

    const key = correlationKey(correlation);
    if (!this.prepared || this.prepared.correlationKey !== key) {
      const preparation = await this.prepare(correlation);
      if (preparation.status !== 'ready') {
        return preparation.status === 'error'
          ? { status: 'error', message: 'The rewarded ad could not be loaded.' }
          : { status: 'unavailable' };
      }
    }
    const session = this.prepared;
    if (!session || session.correlationKey !== key) return { status: 'unavailable' };
    if (!session.loaded || session.failed || session.showing) return { status: 'unavailable' };

    session.showing = true;
    return await new Promise<RewardedAdResult>((resolve) => {
      session.resolveShow = resolve;
      session.ad.show().catch(() => {
        track('rewarded_ad_failed');
        this.finishSession(session, { status: 'error', message: 'The rewarded ad could not be shown.' });
      });
    });
  }

  private finishSession(session: PreparedAd, result: RewardedAdResult): void {
    session.resolveShow?.(result);
    session.resolveShow = undefined;
    if (this.prepared === session) this.prepared = null;
    session.unsubscribe.forEach((unsubscribe) => unsubscribe());
    session.unsubscribe = [];
  }

  private disposePrepared(): void {
    if (!this.prepared) return;
    this.prepared.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.prepared = null;
  }
}
