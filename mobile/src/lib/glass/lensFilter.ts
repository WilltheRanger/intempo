import { Platform } from 'react-native';

/**
 * The refraction half of the glass material, on the web build.
 *
 * A blur softens what is behind a surface; it never *bends* it, which is why a
 * backdrop blur reads as a frosted panel rather than as glass. This builds the
 * missing half: an SVG displacement map where every pixel inside a rim band is
 * pushed along the outward surface normal, peaking at the perimeter and falling
 * to nothing through the middle. `feDisplacementMap` then samples the backdrop
 * from that offset, which compresses a thin band of whatever lies just outside
 * the control into its edge — what a convex lens does.
 *
 * **Normalised, so one filter serves every control.** The map is generated once
 * at a fixed size and stretched to each element's box by
 * `preserveAspectRatio="none"`, so the rim band scales with the surface rather
 * than needing a filter per size. That is only true while glass surfaces stay
 * roughly bar- or capsule-shaped, which the design language requires anyway.
 *
 * **It must live in the same declaration as the blur.** Chromium resolves one
 * backdrop image per backdrop root, so a second element layered on top with its
 * own `backdrop-filter` samples the *original* content and paints a sharp copy
 * straight over the blurred one. Measured while building this: the result is a
 * bar you can read straight through. `GlassSurface` therefore composes
 * `url(#…) blur(…) saturate(…)` as a single value on a single node.
 *
 * Where `url()` in `backdrop-filter` is not drawn — Safari and Firefox both
 * drop the whole declaration — `cssLens()` returns null and the caller falls
 * back to blur alone. Safari has to be recognised by name for that: see
 * `lensRenders`.
 */

const FILTER_ID = 'intempo-glass-lens';

/** Map resolution. Bigger buys nothing: it is stretched, and it is smooth. */
const MAP_W = 320;
const MAP_H = 96;

/**
 * How wide the refracting band is, as a fraction of the shorter side.
 *
 * Small on purpose. A wide band bends content across the whole surface, which
 * reads as a warp rather than as an edge, and the middle of a control has to
 * stay a place a label can sit.
 */
const RIM_FRACTION = 0.34;

/** Peak displacement in CSS pixels. `scale` is doubled because 0.5 is centre. */
const DISPLACEMENT_PX = 26;

let cached: string | null | undefined;

/**
 * The displacement map, as a data URL.
 *
 * R carries the x offset and G the y offset, with 128 meaning "no
 * displacement". The shape is a rounded rectangle whose corner radius is half
 * its height — a capsule — because every glass surface in this app is one.
 */
function drawMap(): string {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('no 2d context');
  }
  const image = ctx.createImageData(MAP_W, MAP_H);
  const data = image.data;
  const halfW = MAP_W / 2;
  const halfH = MAP_H / 2;
  const radius = halfH;
  const band = Math.min(MAP_W, MAP_H) * RIM_FRACTION;

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const px = x + 0.5 - halfW;
      const py = y + 0.5 - halfH;
      // Signed distance to a rounded rectangle, and the outward normal with it.
      const qx = Math.abs(px) - (halfW - radius);
      const qy = Math.abs(py) - (halfH - radius);
      const ax = Math.max(qx, 0);
      const ay = Math.max(qy, 0);
      const inside = radius - (Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0));

      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(ax, ay) || 1;
        nx = (px < 0 ? -1 : 1) * (ax / len);
        ny = (py < 0 ? -1 : 1) * (ay / len);
      } else if (qx > qy) {
        nx = px < 0 ? -1 : 1;
      } else {
        ny = py < 0 ? -1 : 1;
      }

      let t = 0;
      if (inside >= 0 && inside < band) {
        const u = 1 - inside / band;
        t = u * u * (3 - 2 * u); // smoothstep, so the band has no visible seam
      }

      const i = (y * MAP_W + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(128 + nx * t * 127)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(128 + ny * t * 127)));
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/**
 * Whether this browser draws a `url()` inside `backdrop-filter`.
 *
 * **`CSS.supports` cannot answer this, and trusting it broke the bar on every
 * iPhone.** WebKit parses `url(#…)` in `backdrop-filter`, so the feature test
 * passes, and then does not render it — and because the lens has to share one
 * declaration with the blur (see above), the whole value goes with it. The
 * bottom bar on an iPhone had no blur at all: 80% tint over sharp text, so the
 * row scrolling under it read straight through the tab labels. Reported from a
 * phone on 2026-09-23, "Preferences" legible behind "Today".
 *
 * So WebKit is named. Every browser on iOS and iPadOS is WebKit whatever its
 * name, iPadOS reports a Mac, and desktop Safari is the one Safari token
 * without a Chromium or Firefox one beside it. Blur alone is the fallback,
 * which is the material this app shipped before refraction.
 */
export function lensRenders(browser: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}): boolean {
  const { userAgent, platform = '', maxTouchPoints = 0 } = browser;
  if (/iPhone|iPad|iPod/.test(userAgent)) {
    return false;
  }
  if (platform === 'MacIntel' && maxTouchPoints > 1) {
    return false;
  }
  if (/Firefox\//.test(userAgent)) {
    return false;
  }
  return !(/Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(userAgent));
}

/**
 * Adds the filter to the document once, and answers whether it can be used.
 *
 * Injected from here rather than written into `public/index.html` on purpose:
 * that file carries the boot watchdog, its inline script is content-hashed into
 * the Content-Security-Policy at build time, and `bootWatchdog.test.ts`
 * evaluates it. A decorative filter is not worth touching any of that.
 */
export function cssLens(): string | null {
  if (Platform.OS !== 'web') {
    return null;
  }
  if (cached !== undefined) {
    return cached;
  }
  try {
    if (
      typeof document === 'undefined' ||
      typeof CSS === 'undefined' ||
      typeof navigator === 'undefined' ||
      !lensRenders(navigator) ||
      // Safari parses this and does not render it, so the check is necessary
      // but not sufficient — the layer below still carries the blur alone.
      !CSS.supports('backdrop-filter', `url(#${FILTER_ID})`)
    ) {
      cached = null;
      return cached;
    }

    if (!document.getElementById(FILTER_ID)) {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.style.cssText =
        'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';

      const filter = document.createElementNS(NS, 'filter');
      filter.setAttribute('id', FILTER_ID);
      // objectBoundingBox so one filter fits every control; sRGB because the
      // default linearRGB would skew the 128 midpoint the map is built around.
      filter.setAttribute('filterUnits', 'objectBoundingBox');
      filter.setAttribute('x', '0');
      filter.setAttribute('y', '0');
      filter.setAttribute('width', '1');
      filter.setAttribute('height', '1');
      filter.setAttribute('color-interpolation-filters', 'sRGB');

      const feImage = document.createElementNS(NS, 'feImage');
      // No x/y/width/height: it then fills the filter region, which is the
      // element's box, and stretches to it.
      feImage.setAttribute('preserveAspectRatio', 'none');
      feImage.setAttribute('result', 'map');
      feImage.setAttribute('href', drawMap());

      const displace = document.createElementNS(NS, 'feDisplacementMap');
      displace.setAttribute('in', 'SourceGraphic');
      displace.setAttribute('in2', 'map');
      displace.setAttribute('scale', String(DISPLACEMENT_PX * 2));
      displace.setAttribute('xChannelSelector', 'R');
      displace.setAttribute('yChannelSelector', 'G');

      filter.appendChild(feImage);
      filter.appendChild(displace);
      svg.appendChild(filter);
      document.body.appendChild(svg);
    }
    cached = `url(#${FILTER_ID})`;
  } catch {
    // A canvas that will not draw, a document that will not take a child: the
    // material is still legible without refraction, so this never throws
    // outward.
    cached = null;
  }
  return cached;
}
