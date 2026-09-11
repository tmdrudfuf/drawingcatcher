import { useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';

import { track } from '@/services/analytics/analytics';
import { colors, radius } from '@/theme';

type LoadState = 'idle' | 'loading' | 'loaded' | 'failed';

interface Props {
  /** Public URL or local data: URI of a real submitted drawing. Null while unavailable. */
  uri: string | null;
  size: number;
  /** For analytics latency attribution (e.g. player id or 'local'). */
  label?: string;
}

/**
 * Renders a real submitted drawing. Handles the three asset-readiness states the
 * game can be in — not-yet-available, loading, failed — without ever crashing on
 * a missing or broken URI. This is the only place screens render remote drawings.
 *
 * Pass a `key={uri}` at the call site if the URI can change while mounted so the
 * load state resets cleanly.
 */
export function RemoteDrawing({ uri, size, label }: Props) {
  const [loadState, setLoadState] = useState<LoadState>(uri ? 'loading' : 'idle');
  const startedAt = useRef<number>(0);

  const box = {
    width: size,
    height: size,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: '#FFFFFF',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    overflow: 'hidden' as const,
  };

  if (!uri) {
    return (
      <View style={[box, { borderStyle: 'dashed' }]}>
        <Text style={{ fontSize: 10, color: colors.faint, textAlign: 'center' }}>sketch{'\n'}pending</Text>
      </View>
    );
  }

  return (
    <View style={box}>
      <Image
        source={{ uri }}
        style={{ width: size, height: size }}
        resizeMode="contain"
        onLoadStart={() => {
          startedAt.current = Date.now();
        }}
        onLoad={(e) => {
          if (loadState === 'loaded') return;
          setLoadState('loaded');
          const src = e.nativeEvent?.source;
          // Exported PNG pixel size travels through the existing analytics sink
          // rather than a raw console.log — same diagnostic value, no console spam.
          track('remote_drawing_loaded', {
            label,
            latencyMs: startedAt.current ? Date.now() - startedAt.current : null,
            pngWidth: src?.width ?? null,
            pngHeight: src?.height ?? null,
          });
        }}
        onError={() => setLoadState('failed')}
      />
      {loadState === 'loading' ? (
        <Text style={{ position: 'absolute', fontSize: 10, color: colors.faint }}>loading…</Text>
      ) : null}
      {loadState === 'failed' ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF8F2' }}>
          <Text style={{ fontSize: 10, color: colors.faint, textAlign: 'center' }}>sketch{'\n'}unavailable</Text>
        </View>
      ) : null}
    </View>
  );
}
