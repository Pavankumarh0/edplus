'use client';

import dynamic from 'next/dynamic';
import { LOOP_DURATION, LOOP_FPS, LoopAnimation } from '../remotion/LoopAnimation';

/**
 * Plays the Remotion composition inside the landing page.
 *
 * Loaded client-side only: the Player measures itself and drives a frame clock,
 * neither of which means anything during server rendering. The fallback holds
 * the same aspect ratio so the page does not jump when it arrives.
 */
const Player = dynamic(() => import('@remotion/player').then((m) => m.Player), {
  ssr: false,
  loading: () => <div className="bg-canvas h-full w-full" />,
});

export function LoopPlayer() {
  // The Player fills the box rather than sizing itself: it has no intrinsic
  // height, so an aspect-ratio wrapper is what keeps it 16:9 at every width
  // and stops the page reflowing when the chunk arrives.
  return (
    <div className="relative aspect-[16/9] w-full">
      <Player
        component={LoopAnimation}
        durationInFrames={LOOP_DURATION}
        fps={LOOP_FPS}
        compositionWidth={1280}
        compositionHeight={720}
        style={{ width: '100%', height: '100%' }}
        autoPlay
        loop
        controls
        doubleClickToFullscreen
      />
    </div>
  );
}
