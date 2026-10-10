import type { CallRecord, ParentLanguage } from '@eduplus/core';

export interface PlaceCallRequest {
  callId: string;
  /** E.164, read from the student record. Never supplied by a caller. */
  to: string;
  language: ParentLanguage;
  /** Publicly reachable URL the provider fetches for call instructions. */
  answerUrl: string;
  hangupUrl: string;
  fallbackUrl?: string;
}

export interface PlaceCallResult {
  /** Provider-side identifier, e.g. a Vobiz call_uuid. */
  providerCallId: string;
  status: 'dialing' | 'queued';
}

/**
 * Telephony behind one interface, so the tier in use is an environment
 * setting rather than a code path.
 *
 * Two implementations:
 *   VobizProvider      — real PSTN calls
 *   SimulatedProvider  — a browser-based fake call driving the SAME Sarvam and
 *                        Claude pipeline, so the demo works with no phone,
 *                        no credit, and no network to a telco.
 */
export interface TelephonyProvider {
  readonly name: 'vobiz' | 'simulated';

  /** True when this provider has everything it needs to actually place a call. */
  isConfigured(): boolean;

  /** Human-readable reason when `isConfigured()` is false. */
  describeConfiguration(): string;

  placeCall(request: PlaceCallRequest): Promise<PlaceCallResult>;

  /** Best-effort hang-up. Not all providers support it mid-call. */
  endCall?(providerCallId: string): Promise<void>;
}

/** What a provider's webhook told us happened. */
export interface CallEvent {
  callId: string;
  providerCallId?: string;
  kind: 'ring' | 'answer' | 'digits' | 'speech' | 'hangup' | 'failed';
  digits?: string;
  speech?: string;
  hangupCause?: string;
  raw?: Record<string, unknown>;
}

export type CallStatusUpdate = Partial<
  Pick<CallRecord, 'status' | 'providerCallId' | 'failureReason' | 'startedAt' | 'endedAt'>
>;
