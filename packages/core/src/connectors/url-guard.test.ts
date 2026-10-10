import { describe, expect, it } from 'vitest';
import {
  UrlNotAllowedError,
  checkConnectorUrl,
  isBlockedAddress,
  parseConnectorUrl,
} from './url-guard';

const PROD = {} as NodeJS.ProcessEnv;
const LOCAL_OK = { EDUPLUS_ALLOW_LOCAL_CONNECTORS: '1' } as NodeJS.ProcessEnv;

describe('blocked addresses', () => {
  it('refuses the cloud metadata endpoint', () => {
    // The canonical SSRF target: on AWS, GCP and Azure this hands instance
    // credentials to anything that asks.
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
  });

  it('refuses loopback, private and link-local ranges', () => {
    for (const address of [
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.1.1',
      '0.0.0.0',
      '100.64.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it('refuses IPv6 loopback, link-local and unique-local', () => {
    for (const address of ['::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1']) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('refuses an IPv4 private address wearing an IPv6 coat', () => {
    // ::ffff:127.0.0.1 would otherwise sail past every IPv4 rule.
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('refuses anything that is not an IP address at all', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('url syntax', () => {
  it('requires https in production', () => {
    expect(() => parseConnectorUrl('http://mcp.example.com/mcp', PROD)).toThrow(
      UrlNotAllowedError,
    );
    expect(() => parseConnectorUrl('https://mcp.example.com/mcp', PROD)).not.toThrow();
  });

  it('refuses credentials embedded in the URL', () => {
    expect(() => parseConnectorUrl('https://user:pass@mcp.example.com/mcp', PROD)).toThrow(
      /username and password/,
    );
  });

  it('refuses other schemes outright', () => {
    for (const raw of [
      'file:///etc/passwd',
      'gopher://example.com/',
      'ftp://example.com/',
      'javascript:alert(1)',
    ]) {
      expect(() => parseConnectorUrl(raw, PROD), raw).toThrow(UrlNotAllowedError);
    }
  });

  it('refuses a fragment, which is never sent anyway', () => {
    expect(() => parseConnectorUrl('https://mcp.example.com/mcp#x', PROD)).toThrow(/fragment/);
  });

  it('explains itself rather than saying "invalid URL"', () => {
    // Someone pasting a legitimate address needs to know what to change.
    try {
      parseConnectorUrl('http://mcp.example.com/mcp', PROD);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/https:\/\//);
    }
  });

  it('allows http on loopback only when explicitly opted in', () => {
    expect(() => parseConnectorUrl('http://localhost:9999/mcp', PROD)).toThrow();
    expect(() => parseConnectorUrl('http://localhost:9999/mcp', LOCAL_OK)).not.toThrow();
  });
});

describe('dns resolution', () => {
  it('refuses a name that resolves to loopback', async () => {
    // localhost.localdomain style names are the simple form of the attack; the
    // check is on the resolved address, so the name does not matter.
    await expect(checkConnectorUrl('https://localhost/mcp', PROD)).rejects.toThrow(
      UrlNotAllowedError,
    );
  });

  it('refuses a literal private address written straight into the URL', async () => {
    await expect(checkConnectorUrl('https://169.254.169.254/latest/meta-data/', PROD)).rejects
      .toThrow(/private or reserved/);
    await expect(checkConnectorUrl('https://10.0.0.5/mcp', PROD)).rejects.toThrow(
      /private or reserved/,
    );
  });

  it('says so when a host cannot be resolved', async () => {
    await expect(
      checkConnectorUrl('https://this-host-does-not-exist-eduplus.invalid/mcp', PROD),
    ).rejects.toThrow(/Could not resolve/);
  });

  it('pins the resolved address so it cannot be re-resolved later', async () => {
    // The pin is what closes the rebinding window: the connection is made to
    // the address that was checked, not to whatever DNS says a second later.
    const checked = await checkConnectorUrl('http://127.0.0.1:9999/mcp', LOCAL_OK);
    expect(checked.address).toBe('127.0.0.1');
    expect(checked.url.hostname).toBe('127.0.0.1');
  });
});
