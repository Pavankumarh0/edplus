'use client';

import { useEffect, useRef, useState } from 'react';
import { COPILOT_SUGGESTIONS } from '@eduplus/core';
import { Badge, Button, cx } from './ui';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
}

/**
 * Slide-over chat, available on every dashboard page.
 *
 * Shows which tools were called for each answer. That is not decoration: it is
 * how a mentor tells "Claude read the current snapshot" from "Claude is
 * recalling something", which is the difference between trusting the answer
 * and checking it.
 */
export function Copilot() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes, and Cmd/Ctrl+K opens — a mentor should not have to reach
  // for the mouse mid-triage.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // `key` is absent on some synthetic and IME-composition events, and on a
      // few browser autofill events. Reading it blind crashed the whole page
      // from a global listener, which is about as expensive as a missing guard
      // gets.
      const key = event.key;
      if (typeof key !== 'string') return;

      if (key === 'Escape') setOpen(false);
      if (key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const next: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(next);
    setInput('');
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'The copilot could not answer.');

      setTurns([
        ...next,
        { role: 'assistant', content: json.reply as string, toolsUsed: json.toolsUsed },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The copilot could not answer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Launcher. Bottom-right on desktop, above the mobile nav bar. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className="bg-ink text-canvas shadow-raised fixed bottom-20 right-4 z-30 flex min-h-[44px] items-center gap-2 rounded-[var(--radius-pill)] px-4 text-[14px] font-medium md:bottom-6 md:right-6"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.8-5.2A8.3 8.3 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z" />
        </svg>
        Copilot
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-ink/25"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-label="Faculty copilot"
            className="bg-canvas shadow-raised fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l border-hairline"
          >
            <header className="border-hairline flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-h2">Copilot</h2>
                <p className="text-body-sm text-ink-faint">
                  Answers from your data, with the numbers
                </p>
              </div>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {turns.length === 0 ? (
                <div>
                  <p className="text-body-sm text-ink-muted mb-3">
                    Ask about any student. Every answer is read from the live data — the copilot
                    cannot quote a number it has not just looked up.
                  </p>
                  <div className="flex flex-col gap-2">
                    {COPILOT_SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => void send(suggestion)}
                        className="border-hairline hover:bg-surface-sunk text-body-sm rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors duration-150"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {turns.map((turn, index) => (
                <div
                  key={index}
                  className={cx(turn.role === 'user' ? 'flex justify-end' : 'flex justify-start')}
                >
                  <div
                    className={cx(
                      'max-w-[88%] rounded-[var(--radius-card)] px-4 py-3',
                      turn.role === 'user'
                        ? 'bg-ink text-canvas'
                        : 'bg-surface border-hairline border',
                    )}
                  >
                    <p className="text-body-sm whitespace-pre-wrap">{turn.content}</p>
                    {turn.toolsUsed && turn.toolsUsed.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {[...new Set(turn.toolsUsed)].map((tool) => (
                          <Badge key={tool}>{tool}</Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}

              {busy ? (
                <p className="text-body-sm text-ink-faint">Looking it up…</p>
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="text-body-sm rounded-[var(--radius-control)] px-3 py-2"
                  style={{
                    color: 'var(--color-level-critical)',
                    background: 'var(--color-level-critical-fill)',
                  }}
                >
                  {error}
                </p>
              ) : null}
            </div>

            <form
              className="border-hairline border-t px-5 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                void send(input);
              }}
            >
              <label className="sr-only" htmlFor="copilot-input">
                Ask the copilot
              </label>
              <textarea
                id="copilot-input"
                ref={inputRef}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder="Why is 1OX21IS045 at risk?"
                className="border-hairline text-body w-full resize-none rounded-[var(--radius-control)] border bg-white px-3 py-2"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-body-sm text-ink-faint">Enter to send</span>
                <Button type="submit" disabled={busy || input.trim().length === 0}>
                  Ask
                </Button>
              </div>
            </form>
          </aside>
        </>
      ) : null}
    </>
  );
}
