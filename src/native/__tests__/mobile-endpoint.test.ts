import { afterEach, describe, expect, it } from 'vitest';
import {
  computePureSha256Hex,
  isEmbeddedMobileOrigin,
  normalizeMobileServerEndpoint,
  resolveDefaultMobileServerEndpoint,
  WEB_ENDPOINT_STORAGE_KEY,
  writeStoredServerEndpoint
} from '../web-http-helpers';

describe('mobile HTTP endpoint normalization & persistence', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
    (globalThis as { localStorage?: Storage }).localStorage = originalLocalStorage;
  });

  function installMockStorageAndWindow(urlStr: string, mobileFlag = false) {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: Storage }).localStorage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: key => store.get(key) ?? null,
      key: index => Array.from(store.keys())[index] ?? null,
      removeItem: key => {
        store.delete(key);
      },
      setItem: (key, value) => {
        store.set(key, String(value));
      }
    };
    const parsed = new URL(urlStr);
    (globalThis as { window?: unknown }).window = {
      __TIDYDESK_MOBILE__: mobileFlag,
      location: {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        origin: parsed.origin
      }
    };
    return store;
  }

  it('detects embedded APK origins and avoids using localhost container URL as sync endpoint', () => {
    installMockStorageAndWindow('https://localhost/', true);
    expect(isEmbeddedMobileOrigin()).toBe(true);
    expect(resolveDefaultMobileServerEndpoint()).toBe('');

    writeStoredServerEndpoint('http://192.168.1.25:8787/');
    expect(resolveDefaultMobileServerEndpoint()).toBe('http://192.168.1.25:8787');
  });

  it('falls back to hosted LAN origin in browser PWA mode when no endpoint was saved yet', () => {
    const store = installMockStorageAndWindow('http://192.168.1.8:8787/?mode=mobile', false);
    expect(isEmbeddedMobileOrigin()).toBe(false);
    expect(resolveDefaultMobileServerEndpoint()).toBe('http://192.168.1.8:8787');
    expect(store.get(WEB_ENDPOINT_STORAGE_KEY)).toBeUndefined();
  });

  it('normalizes valid http/https server endpoints and fails loudly on missing or invalid URLs', () => {
    installMockStorageAndWindow('https://localhost/', true);
    expect(() => normalizeMobileServerEndpoint('')).toThrow(/请输入协同服务端地址/);
    expect(() => normalizeMobileServerEndpoint('ftp://192.168.1.1')).toThrow(/仅支持 http:\/\/ 或 https:\/\//);
    expect(normalizeMobileServerEndpoint(' http://192.168.1.99:8787/// ')).toBe(
      'http://192.168.1.99:8787'
    );
  });

  it('computes RFC 6234 compliant SHA-256 digests in pure JS for LAN HTTP browsers', () => {
    const enc = new TextEncoder();
    expect(computePureSha256Hex(enc.encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(computePureSha256Hex(enc.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});
