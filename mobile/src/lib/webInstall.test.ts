import { describe, expect, it } from 'vitest';

import page from '../../public/index.html?raw';
import manifestSource from '../../public/manifest.webmanifest?raw';

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
