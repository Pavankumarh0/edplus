'use client';

import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { COLORS, LEVEL_PALETTE } from '@eduplus/core';

/**
 * The product loop, as a Remotion composition.
 *
 * Authored for Remotion rather than as CSS so the same source can play live in
 * the landing page through <Player> and be rendered to MP4 for a submission
 * video, with identical output. Every animation is driven by useCurrentFrame —
 * CSS transitions would not render.
 *
 * It tells the story the dashboard tells, with the real numbers from the demo
 * data: Ananya goes 100 to 36.7 after an intervention, and the verdict comes
 * from the next upload rather than from anything claiming its own success.
 */

export const LOOP_FPS = 30;
export const LOOP_DURATION = 23 * LOOP_FPS;

const SCENES = {
  upload: { from: 0, duration: 4 * LOOP_FPS },
  score: { from: 4 * LOOP_FPS, duration: 5 * LOOP_FPS },
  explain: { from: 9 * LOOP_FPS, duration: 4.5 * LOOP_FPS },
  act: { from: 13.5 * LOOP_FPS, duration: 4 * LOOP_FPS },
  proof: { from: 17.5 * LOOP_FPS, duration: 5.5 * LOOP_FPS },
};

/** Fades and lifts a scene in, then eases it out before the next begins. */
function useSceneFade(durationInFrames: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 200 } });
  const exit = interpolate(
    frame,
    [durationInFrames - 0.5 * fps, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return {
    opacity: enter * exit,
    transform: `translateY(${interpolate(enter, [0, 1], [18, 0])}px)`,
  };
}

function Stage({
  step,
  title,
  children,
  durationInFrames,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
  durationInFrames: number;
}) {
  const fade = useSceneFade(durationInFrames);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.canvas,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        padding: 56,
        justifyContent: 'center',
        ...fade,
      }}
    >
      <div style={{ fontSize: 26, color: COLORS.inkFaint, letterSpacing: 0.4 }}>{step}</div>
      <div
        style={{
          fontSize: 54,
          lineHeight: 1.15,
          fontWeight: 650,
          letterSpacing: -1.2,
          color: COLORS.ink,
          marginTop: 10,
          maxWidth: 820,
        }}
      >
        {title}
      </div>
      <div style={{ marginTop: 36 }}>{children}</div>
    </AbsoluteFill>
  );
}

/** 1 — rows of a spreadsheet landing, one after another. */
function Upload() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const rows = [
    ['1OX21IS045', 'Ananya Reddy', '17 / 45'],
    ['1OX21IS012', 'Rohan Mehta', '43 / 45'],
    ['1OX21IS023', 'Fatima Khan', '26 / 45'],
    ['1OX21IS001', 'Aarav Sharma', '41 / 45'],
  ];

  return (
    <Stage step="01" title="Three spreadsheets nobody joins up." durationInFrames={SCENES.upload.duration}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
        {rows.map((row, index) => {
          const appear = spring({
            frame: frame - index * 0.22 * fps - 0.3 * fps,
            fps,
            config: { damping: 200 },
          });
          return (
            <div
              key={row[0]}
              style={{
                display: 'flex',
                gap: 24,
                alignItems: 'center',
                padding: '14px 20px',
                background: COLORS.surface,
                border: `1px solid ${COLORS.hairline}`,
                borderRadius: 14,
                fontSize: 26,
                color: COLORS.ink,
                opacity: appear,
                transform: `translateX(${interpolate(appear, [0, 1], [-26, 0])}px)`,
              }}
            >
              <span style={{ fontFamily: 'ui-monospace, monospace', color: COLORS.inkMuted, fontSize: 22 }}>
                {row[0]}
              </span>
              <span style={{ flex: 1 }}>{row[1]}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: COLORS.inkMuted }}>{row[2]}</span>
            </div>
          );
        })}
      </div>
    </Stage>
  );
}

/** 2 — the score counts up and the level resolves. */
function Score() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({ frame: frame - 0.3 * fps, fps, config: { damping: 200 } });
  const score = Math.round(interpolate(progress, [0, 1], [0, 100]));
  const palette = LEVEL_PALETTE.critical;

  const pillIn = spring({ frame: frame - 1.6 * fps, fps, config: { damping: 200 } });

  return (
    <Stage step="02" title="A fixed rule decides who needs help." durationInFrames={SCENES.score.duration}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28 }}>
        <div
          style={{
            fontSize: 148,
            fontWeight: 700,
            letterSpacing: -5,
            lineHeight: 0.9,
            color: palette.fg,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {score}
        </div>
        <div style={{ paddingBottom: 16 }}>
          <div
            style={{
              display: 'inline-block',
              padding: '8px 18px',
              borderRadius: 999,
              background: palette.fill,
              color: palette.fg,
              border: `1px solid ${palette.fg}59`,
              fontSize: 26,
              fontWeight: 600,
              opacity: pillIn,
              transform: `scale(${interpolate(pillIn, [0, 1], [0.9, 1])})`,
            }}
          >
            {palette.label}
          </div>
          <div style={{ fontSize: 25, color: COLORS.inkMuted, marginTop: 12 }}>
            Ananya Reddy · 1OX21IS045
          </div>
        </div>
      </div>
      <div style={{ fontSize: 26, color: COLORS.inkMuted, marginTop: 26, maxWidth: 760 }}>
        Deterministic. Same data, same rules, same answer — every time.
      </div>
    </Stage>
  );
}

/** 3 — the indicator band: a number against what it is measured against. */
function Explain() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const grow = spring({ frame: frame - 0.4 * fps, fps, config: { damping: 200 } });
  const value = 37.8;
  const fill = interpolate(grow, [0, 1], [0, value]);
  const palette = LEVEL_PALETTE.critical;

  const captionIn = interpolate(frame, [1.4 * fps, 2.2 * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <Stage step="03" title="Never a number without its threshold." durationInFrames={SCENES.explain.duration}>
      <div style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, color: COLORS.ink }}>
          <span style={{ fontWeight: 500 }}>Attendance</span>
          <span style={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
            {fill.toFixed(1)}%
          </span>
        </div>

        <div
          style={{
            position: 'relative',
            height: 16,
            borderRadius: 999,
            background: COLORS.surfaceSunk,
            marginTop: 14,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${fill}%`,
              height: '100%',
              borderRadius: 999,
              background: palette.fg,
            }}
          />
        </div>

        {/* The two marks that turn a number into evidence. */}
        <div style={{ position: 'relative', height: 40, marginTop: 6 }}>
          {[
            { at: 40, label: '40', caption: 'critical' },
            { at: 90, label: '90', caption: 'target' },
          ].map((tick) => (
            <div
              key={tick.label}
              style={{
                position: 'absolute',
                left: `${tick.at}%`,
                transform: 'translateX(-50%)',
                textAlign: 'center',
                opacity: captionIn,
              }}
            >
              <div style={{ fontSize: 21, color: COLORS.inkFaint, fontVariantNumeric: 'tabular-nums' }}>
                {tick.label}
              </div>
              <div style={{ fontSize: 19, color: COLORS.inkFaint }}>{tick.caption}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 26, color: COLORS.inkMuted, marginTop: 24, opacity: captionIn }}>
          Attendance 37.8% — at or below the 40% critical floor.
        </div>
      </div>
    </Stage>
  );
}

/** 4 — a human approves; the agent only proposes. */
function Act() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const steps = [
    { label: 'Claude proposes', tone: COLORS.inkMuted },
    { label: 'A mentor approves', tone: COLORS.ink },
    { label: 'The parent is called', tone: COLORS.inkMuted },
  ];

  return (
    <Stage step="04" title="The model advises. A person decides." durationInFrames={SCENES.act.duration}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        {steps.map((step, index) => {
          const appear = spring({
            frame: frame - index * 0.5 * fps - 0.3 * fps,
            fps,
            config: { damping: 200 },
          });
          const highlighted = index === 1;
          return (
            <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div
                style={{
                  padding: '14px 22px',
                  borderRadius: 999,
                  fontSize: 27,
                  fontWeight: highlighted ? 650 : 450,
                  color: highlighted ? COLORS.ink : step.tone,
                  background: highlighted ? COLORS.lime : COLORS.surface,
                  border: `1px solid ${highlighted ? COLORS.limeEdge : COLORS.hairline}`,
                  opacity: appear,
                  transform: `scale(${interpolate(appear, [0, 1], [0.92, 1])})`,
                }}
              >
                {step.label}
              </div>
              {index < steps.length - 1 ? (
                <span style={{ color: COLORS.inkFaint, fontSize: 30, opacity: appear }}>→</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </Stage>
  );
}

/** 5 — the next upload delivers the verdict. */
function Proof() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const drop = spring({ frame: frame - 0.6 * fps, fps, config: { damping: 200 } });
  const score = interpolate(drop, [0, 1], [100, 36.7]);

  const badgeIn = spring({ frame: frame - 2.1 * fps, fps, config: { damping: 200 } });
  const level = score > 70 ? LEVEL_PALETTE.critical : LEVEL_PALETTE.watch;

  return (
    <Stage step="05" title="The next upload says whether it worked." durationInFrames={SCENES.proof.duration}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 30, flexWrap: 'wrap' }}>
        <div>
          <div
            style={{
              fontSize: 74,
              fontWeight: 650,
              color: COLORS.inkFaint,
              letterSpacing: -2,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            100
          </div>
          <div style={{ fontSize: 23, color: COLORS.inkFaint, marginTop: 4 }}>2 March</div>
        </div>

        <div style={{ fontSize: 40, color: COLORS.inkFaint, paddingBottom: 30 }}>→</div>

        <div>
          <div
            style={{
              fontSize: 126,
              fontWeight: 700,
              color: level.fg,
              letterSpacing: -4,
              lineHeight: 0.95,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {score.toFixed(1)}
          </div>
          <div style={{ fontSize: 23, color: COLORS.inkFaint, marginTop: 4 }}>2 April</div>
        </div>

        <div
          style={{
            paddingBottom: 26,
            opacity: badgeIn,
            transform: `scale(${interpolate(badgeIn, [0, 1], [0.85, 1])})`,
          }}
        >
          <span
            style={{
              padding: '10px 20px',
              borderRadius: 999,
              background: COLORS.lime,
              color: COLORS.ink,
              fontSize: 26,
              fontWeight: 650,
            }}
          >
            improved
          </span>
        </div>
      </div>

      <div style={{ fontSize: 26, color: COLORS.inkMuted, marginTop: 26, maxWidth: 820 }}>
        Measured against the snapshot frozen when the intervention began. Nothing
        marks its own homework.
      </div>
    </Stage>
  );
}

export function LoopAnimation() {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.canvas }}>
      {Object.entries(SCENES).map(([name, scene]) => (
        <Sequence key={name} from={scene.from} durationInFrames={scene.duration}>
          {name === 'upload' ? <Upload /> : null}
          {name === 'score' ? <Score /> : null}
          {name === 'explain' ? <Explain /> : null}
          {name === 'act' ? <Act /> : null}
          {name === 'proof' ? <Proof /> : null}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
