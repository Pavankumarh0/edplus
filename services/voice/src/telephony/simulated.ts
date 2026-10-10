import type { PlaceCallRequest, PlaceCallResult, TelephonyProvider } from './types';

/**
 * A fake telephone network.
 *
 * It drives the SAME pipeline as a real call — the same approved message, the
 * same Sarvam text-to-speech, the same Claude turn, the same tool calls, the
 * same records written to Firestore. The only thing it does not do is dial a
 * PSTN number: the "parent" is a browser page at /simulator.
 *
 * This exists because a live demo over conference wifi, through a telco, to a
 * real phone, has several ways to fail that have nothing to do with whether
 * the software works. The simulator removes all of them while still
 * exercising every part we actually wrote.
 */
export class SimulatedProvider implements TelephonyProvider {
  readonly name = 'simulated' as const;

  isConfigured(): boolean {
    return true;
  }

  describeConfiguration(): string {
    return 'Simulated telephony. Calls open in the browser simulator instead of dialling.';
  }

  async placeCall(request: PlaceCallRequest): Promise<PlaceCallResult> {
    // Nothing to dial. The simulator page polls for queued calls and runs the
    // same answer/gather flow a real provider would.
    return {
      providerCallId: `sim-${request.callId}`,
      status: 'queued',
    };
  }
}
