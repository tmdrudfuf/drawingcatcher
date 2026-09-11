import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { type GestureResponderEvent, PanResponder, Pressable, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors, radius } from '@/theme';

type Tool = 'pen' | 'eraser';

interface Stroke {
  d: string;
  color: string;
  width: number;
}

/** Imperative handle the drawing screen uses at submit time. */
export interface SketchCanvasHandle {
  /** Rasterise the current sketch to a base64 PNG (no data: prefix). Null on failure. */
  exportPng: () => Promise<string | null>;
}

const PEN = { color: colors.ink, width: 4 };
const ERASER = { color: '#FFFFFF', width: 24 };
const r = (n: number) => Math.round(n * 10) / 10;
const pt = (e: GestureResponderEvent) => `${r(e.nativeEvent.locationX)} ${r(e.nativeEvent.locationY)}`;

/**
 * The drawing surface — the whole "drawing library" behind one component
 * boundary (docs/TECH_STACK.md §13). Finger strokes captured with PanResponder,
 * rendered as react-native-svg paths. The in-progress stroke is the last item of
 * `strokes`, so there is a single source of truth and nothing is read from a ref
 * during render. Eraser paints in the background colour rather than doing
 * geometric hit-testing.
 *
 * Milestone 3: the parent gets a `SketchCanvasHandle` ref. `exportPng` uses
 * react-native-svg's own `toDataURL` (already a dependency — no Skia, no native
 * view-shot module, works under Expo Go). The strokes stay editable locally the
 * whole time; export is a read-only snapshot.
 */
export const SketchCanvas = forwardRef<SketchCanvasHandle>(function SketchCanvas(_props, ref) {
  const [tool, setTool] = useState<Tool>('pen');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const svgRef = useRef<React.ElementRef<typeof Svg>>(null);
  const brush = tool === 'eraser' ? ERASER : PEN;

  useImperativeHandle(ref, () => ({
    exportPng: () =>
      new Promise<string | null>((resolve) => {
        const svg = svgRef.current;
        if (!svg || typeof svg.toDataURL !== 'function') {
          resolve(null);
          return;
        }
        const settled = setTimeout(() => resolve(null), 4000);
        try {
          // No width/height options: passing layout (DIP) sizes makes
          // react-native-svg rasterise only the top-left 1/pixelRatio of the
          // sketch on high-density devices. With an explicit viewBox on <Svg>
          // (below), the default capture renders the whole canvas at native
          // resolution.
          svg.toDataURL((data: string) => {
            clearTimeout(settled);
            // Native returns bare base64; web may prepend a data: URL header.
            const comma = data.indexOf(',');
            resolve(comma >= 0 ? data.slice(comma + 1) : data);
          });
        } catch {
          clearTimeout(settled);
          resolve(null);
        }
      }),
  }));

  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      // Read the event synchronously — it is recycled before the state updater runs.
      const p = pt(e);
      setStrokes((s) => [...s, { d: `M ${p}`, ...brush }]);
    },
    onPanResponderMove: (e) => {
      const p = pt(e);
      setStrokes((s) => {
        const last = s[s.length - 1];
        if (!last) return s;
        return [...s.slice(0, -1), { ...last, d: `${last.d} L ${p}` }];
      });
    },
    onPanResponderRelease: () => {
      // Drop a stroke that was only a tap (no line segment).
      setStrokes((s) => {
        const last = s[s.length - 1];
        return last && !last.d.includes('L') ? s.slice(0, -1) : s;
      });
    },
  });

  return (
    <View style={{ flex: 1, gap: 10 }}>
      <View
        {...pan.panHandlers}
        onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        style={{
          flex: 1,
          borderWidth: 2,
          borderColor: colors.line,
          borderStyle: 'dashed',
          borderRadius: radius.md,
          backgroundColor: '#FFFFFF',
          overflow: 'hidden',
        }}
      >
        {/* Explicit viewBox pins the coordinate system to the measured touch
            area, so both on-screen render and toDataURL export cover the whole
            canvas with the original aspect ratio (no crop, no squish). */}
        <Svg
          ref={svgRef}
          style={{ flex: 1 }}
          width={size.width || undefined}
          height={size.height || undefined}
          viewBox={size.width && size.height ? `0 0 ${size.width} ${size.height}` : undefined}
        >
          {/* Controlled opaque background so the exported PNG matches the visible
              canvas and eraser (white) strokes actually read as erasure. */}
          <Rect x={0} y={0} width="100%" height="100%" fill="#FFFFFF" />
          {strokes.map((s, i) => (
            <Path
              key={i}
              d={s.d}
              stroke={s.color}
              strokeWidth={s.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        </Svg>
        {strokes.length === 0 ? (
          <Text
            style={{
              position: 'absolute',
              alignSelf: 'center',
              top: '45%',
              color: colors.faint,
              fontSize: 15,
            }}
          >
            draw here — wobbly is good
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <ToolButton label="Pen" active={tool === 'pen'} onPress={() => setTool('pen')} />
        <ToolButton label="Eraser" active={tool === 'eraser'} onPress={() => setTool('eraser')} />
        <ToolButton label="Undo" onPress={() => setStrokes((s) => s.slice(0, -1))} />
        <ToolButton label="Clear" onPress={() => setStrokes([])} />
      </View>
    </View>
  );
});

function ToolButton({
  label,
  active = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderRadius: radius.sm,
        borderColor: active ? colors.coral : colors.line,
        backgroundColor: active ? colors.coralTint : colors.card,
      }}
    >
      <Text style={{ fontWeight: '800', fontSize: 13, color: colors.ink }}>{label}</Text>
    </Pressable>
  );
}
