import { useEvent } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';

export function WinnerAnimationVideo({
  uri,
  width,
  height,
  onPlaybackFailed,
}: {
  uri: string;
  width: number;
  height: number;
  onPlaybackFailed: () => void;
}) {
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const failureReportedRef = useRef(false);
  const player = useVideoPlayer({ uri }, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = true;
    videoPlayer.play();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  useEffect(() => {
    if (status !== 'error' || failureReportedRef.current) return;
    failureReportedRef.current = true;
    onPlaybackFailed();
  }, [onPlaybackFailed, status]);

  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="contain"
      playsInline
      surfaceType="textureView"
      onFirstFrameRender={() => setFirstFrameRendered(true)}
      style={{ width, height, opacity: firstFrameRendered ? 1 : 0 }}
    />
  );
}
