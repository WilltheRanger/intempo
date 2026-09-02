import { describe, expect, it } from 'vitest';

import page from '../../public/index.html?raw';
import manifestSource from '../../public/manifest.webmanifest?raw';
import headers from '../../public/_headers?raw';

interface WebManifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: string }>;
}

const manifest = JSON.parse(manifestSource) as WebManifest;

describe('installable web app packaging', () => {
  it('advertises the manifest and iPhone home-screen mode', () => {
    expect(page).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(page).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(page).toContain('rel="apple-touch-icon" href="/app-icon.png"');
  });

  it('opens as the whole InTempo app instead of a browser bookmark', () => {
    expect(manifest.name).toBe('InTempo');
    expect(manifest.short_name).toBe('InTempo');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('keeps the install splash and browser chrome on the app background', () => {
    const htmlTheme = /name="theme-color" content="([^"]+)"/.exec(page)?.[1];
    expect(manifest.theme_color).toBe(htmlTheme);
    expect(manifest.background_color).toBe(htmlTheme);
  });

  it('provides a real PNG home-screen icon', () => {
    expect(manifest.icons).toContainEqual({
      src: '/app-icon.png',
      sizes: '1024x1024',
      type: 'image/png',
      purpose: 'any',
    });
  });
});


describe('public browser boundaries', () => {
  it('cannot be framed by another site or retargeted with a base tag', () => {
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("base-uri 'self'");
    expect(headers).toContain('X-Frame-Options: DENY');
  });

  it('keeps the scanner and recorder available only to InTempo', () => {
    expect(headers).toContain('camera=(self)');
    expect(headers).toContain('microphone=(self)');
    expect(headers).not.toContain('camera=()');
    expect(headers).not.toContain('microphone=()');
  });

  it('turns off browser capabilities the product never requests', () => {
    for (const capability of ['geolocation=()', 'payment=()', 'usb=()']) {
      expect(headers).toContain(capability);
    }
  });

  it('prevents MIME guessing and limits cross-site referrer detail', () => {
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain(
      'Referrer-Policy: strict-origin-when-cross-origin',
    );
  });
});
