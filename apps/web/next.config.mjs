import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Secrets live in ONE file at the repo root (`.env.local`), shared by the web
 * app, the MCP server, the voice service and the seed scripts. Next only reads
 * env files from its own directory, so load the root ones here — this runs in
 * Node before the server starts, so both server code and the NEXT_PUBLIC_*
 * inlining see the values.
 *
 * Set EDUPLUS_EMULATOR=1 to layer `.env.emulator` on top and point everything
 * at the local Firebase emulators.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');

function load(file) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch (error) {
    console.warn(`[env] could not load ${file}:`, error.message);
  }
}

load('.env.local');
if (process.env.EDUPLUS_EMULATOR === '1') {
  load('.env.emulator');
  // The browser needs its own copy to point the Auth SDK at the emulator.
  process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST ??= process.env.FIREBASE_AUTH_EMULATOR_HOST;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NEXT_PUBLIC_* values are inlined into the client bundle from the env at
  // build time. Listing them explicitly here is what makes the ones we set
  // above (rather than in a .env file Next reads itself) actually reach the
  // browser — without this the Auth SDK silently talks to production while the
  // server talks to the emulator, which looks like "wrong password".
  env: {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
    NEXT_PUBLIC_AUTH_EMULATOR_HOST: process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST ?? '',
  },
  // @eduplus/core ships TypeScript source rather than a build artefact, so
  // Next compiles it as part of the app. Keeps the monorepo free of a
  // watch/build dance during development.
  transpilePackages: ['@eduplus/core'],
  experimental: {
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;
