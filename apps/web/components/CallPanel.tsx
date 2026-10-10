'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallPurpose } from '@eduplus/core';
import { Badge, Button, cx } from './ui';

interface Answered {
  say: string;
  audioPath: string | null;
  language: string;
  parentName: string;
  studentFirstName: string;
  purpose: CallPurpose;
}

interface Turn {
  who: 'agent' | 'parent';
  text: string;
}

const KEYPADS: Record<string, [string, string][]> = {
  ptm: [
    ['1', 'Can attend'],
    ['2', 'Cannot attend'],
    ['9', 'Call me back'],
  ],
  absence: [
    ['1', 'Understood'],
    ['9', 'Call me back'],
  ],
  risk_update: [
    ['1', 'Understood'],
    ['9', 'Call me back'],
  ],
};

/**
 * The call, played inside the dashboard.
 *
 * Built for a live demo: the moment a call is approved this opens and the
 * parent's audio starts, with no second tab to find and no second button to
 * press. Autoplay is attempted and, if the browser blocks it, a single Play
 * button appears rather than the panel sitting silently.
 *
 * For a real Vobiz call there is nothing to play here — the phone rings — so
 * the panel polls the call record and shows what the parent did instead.
 */
export function CallPanel({
  callId,
  provider,
  onClose,
}: {
  callId: string;
  provider: 'vobiz' | 'simulated';
  onClose: () => void;
}) {
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<string>(
    provider === 'vobiz' ? 'Dialling…' : 'Connecting…',
  );
  const [outcome, setOutcome] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const play = useCallback((path: string | null) => {
    if (!path) return;
    const key = path.replace('/audio/', '').replace('.wav', '');
    const element = audioRef.current;
    if (!element) return;
    element.src = `/api/calls/${encodeURIComponent(callId)}/audio?key=${key}`;
    element.play().then(
      () => setNeedsPlay(false),
      () => setNeedsPlay(true), // autoplay blocked — offer a button instead
    );
  }, [callId]);

  // Answer immediately on open. This is what makes it feel like one click.
  useEffect(() => {
    if (provider !== 'simulated') return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/calls/${encodeURIComponent(callId)}/answer`, {
          method: 'POST',
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? 'Could not answer the call.');
        if (cancelled) return;

        setAnswered(json as Answered);
        setTurns([{ who: 'agent', text: json.say }]);
        setStatus('Connected');
        play(json.audioPath);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not answer the call.');
          setStatus('Failed');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [callId, provider, play]);

  // A real call rings a real phone, so there is nothing to play — watch the
  // record instead and report what the parent actually did.
  useEffect(() => {
    if (provider !== 'vobiz' || finished) return;

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/calls/${encodeURIComponent(callId)}`);
        if (!response.ok) return;
        const json = await response.json();

        setStatus(json.status);
        if (Array.isArray(json.transcript)) {
          setTurns(
            json.transcript.map((t: { speaker: string; text: string }) => ({
              who: t.speaker === 'parent' ? 'parent' : 'agent',
              text: t.text,
            })),
          );
        }
        if (json.parentResponse) setOutcome(json.parentResponse.replace(/_/g, ' '));
        if (json.failureReason) setError(json.failureReason);
        if (['completed', 'failed', 'no_answer', 'cancelled'].includes(json.status)) {
          setFinished(true);
        }
      } catch {
        /* keep polling; a dropped poll is not a failed call */
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [callId, provider, finished]);

  async function reply(payload: { digit?: string; said?: string }) {
    setBusy(true);
    setError(null);
    setTurns((current) => [
      ...current,
      { who: 'parent', text: payload.digit ? `pressed ${payload.digit}` : payload.said! },
    ]);

    try {
      const response = await fetch(`/api/calls/${encodeURIComponent(callId)}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'The call failed.');

      setTurns((current) => [...current, { who: 'agent', text: json.say }]);
      play(json.audioPath);
      if (json.outcome) setOutcome(json.outcome);
      if (json.finished) {
        setFinished(true);
        setStatus('Call ended');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The call failed.');
    } finally {
      setBusy(false);
    }
  }

  const keypad = answered ? (KEYPADS[answered.purpose] ?? KEYPADS.absence!) : [];

  return (
    <>
      <div className="bg-ink/30 fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label="Parent call"
        className="fixed left-1/2 top-1/2 z-50 w-[min(94vw,480px)] -translate-x-1/2 -translate-y-1/2"
      >
        <div className="bg-surface border-hairline shadow-raised overflow-hidden rounded-[var(--radius-hero)] border">
          {/* The "phone" */}
          <div className="bg-ink text-canvas px-6 py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] opacity-65">
                  {provider === 'vobiz' ? 'Outbound call · Vobiz' : 'Outbound call · simulated'}
                </p>
                <p className="mt-0.5 text-[19px] font-semibold">
                  {answered?.parentName ?? 'Parent'}
                </p>
                <p className="mt-1 text-[13px] opacity-75">
                  {status}
                  {answered ? ` · ${answered.language}` : ''}
                </p>
              </div>
              {outcome ? (
                <span className="bg-lime text-ink rounded-[var(--radius-pill)] px-3 py-1 text-[12px] font-semibold">
                  {outcome}
                </span>
              ) : null}
            </div>
          </div>

          <div className="max-h-[46vh] overflow-y-auto px-6 py-4">
            {provider === 'vobiz' && turns.length === 0 ? (
              <p className="text-body-sm text-ink-muted">
                The parent&rsquo;s phone is ringing. What they press will appear here.
              </p>
            ) : null}

            <ul className="space-y-2">
              {turns.map((turn, index) => (
                <li
                  key={index}
                  className={cx('flex', turn.who === 'parent' ? 'justify-end' : 'justify-start')}
                >
                  <span
                    className={cx(
                      'text-body-sm max-w-[88%] rounded-[var(--radius-card)] px-3 py-2',
                      turn.who === 'parent' ? 'bg-lime text-ink' : 'bg-surface-sunk',
                    )}
                  >
                    {turn.text}
                  </span>
                </li>
              ))}
            </ul>

            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio ref={audioRef} className="mt-4 w-full" controls />

            {needsPlay ? (
              <Button
                variant="secondary"
                className="mt-2 w-full"
                onClick={() => audioRef.current?.play()}
              >
                Play what the parent hears
              </Button>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="text-body-sm mt-3 rounded-[var(--radius-control)] px-3 py-2"
                style={{
                  color: 'var(--color-level-critical)',
                  background: 'var(--color-level-critical-fill)',
                }}
              >
                {error}
              </p>
            ) : null}
          </div>

          {/* Keypad — only the simulated call has one to press here. */}
          {provider === 'simulated' && answered && !finished ? (
            <div className="border-hairline border-t px-6 py-4">
              <p className="text-label text-ink-muted mb-2">Answer as the parent</p>
              <div className="grid grid-cols-3 gap-2">
                {keypad.map(([digit, label]) => (
                  <button
                    key={digit}
                    type="button"
                    disabled={busy}
                    onClick={() => void reply({ digit })}
                    className="bg-surface-sunk hover:bg-lime min-h-[56px] rounded-[var(--radius-control)] text-[17px] font-semibold transition-colors duration-150 disabled:opacity-45"
                  >
                    {digit}
                    <span className="text-ink-muted block text-[11px] font-normal">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="border-hairline flex items-center justify-between gap-3 border-t px-6 py-3">
            <span className="text-body-sm text-ink-faint">
              {finished ? 'Recorded on the student timeline.' : 'Call in progress'}
            </span>
            <Button variant={finished ? 'primary' : 'ghost'} onClick={onClose}>
              {finished ? 'Done' : 'Close'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
