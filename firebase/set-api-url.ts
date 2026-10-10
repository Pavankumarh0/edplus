/**
 * npm run app:url -- https://your-tunnel.ngrok-free.dev
 *
 * Writes `config/app.apiBaseUrl`, which the mobile app reads at launch to find
 * the server.
 *
 * This exists because the alternative is rebuilding and reinstalling the app
 * every time a tunnel URL changes, which during a demo is the difference
 * between a ten-second fix and a dead feature. Any signed-in user may read the
 * document — the security rules already allow that for `config/*` — and only
 * the Admin SDK may write it.
 */
import { getDb } from './lib/admin';

async function main() {
  const url = process.argv[2]?.trim();

  if (!url) {
    const current = await getDb().collection('config').doc('app').get();
    const existing = current.data()?.apiBaseUrl;
    console.log(existing ? `Currently: ${existing}` : 'No apiBaseUrl is set.');
    console.log('\nUsage: npm run app:url -- https://your-tunnel.ngrok-free.dev');
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${url}" is not a valid URL.`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('The URL must be http or https.');
  }
  // A phone on mobile data cannot reach the laptop's loopback, and Android 15
  // blocks cleartext anyway — worth saying before the demo rather than during.
  if (parsed.protocol === 'http:' && !/^(localhost|127\.|10\.|192\.168\.|172\.)/.test(parsed.hostname)) {
    console.warn('Warning: plain http to a public host will be blocked on Android.');
  }

  const apiBaseUrl = url.replace(/\/+$/, '');
  await getDb().collection('config').doc('app').set(
    { apiBaseUrl, updatedAt: new Date().toISOString() },
    { merge: true },
  );

  console.log(`config/app.apiBaseUrl = ${apiBaseUrl}`);
  console.log('Reopen the student app to pick it up — no rebuild needed.');
}

main().catch((error) => {
  console.error('\nFailed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
