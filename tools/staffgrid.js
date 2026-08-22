/**
 * Read a staff out of a photograph, then draw a pitch grid and a coordinate
 * ruler onto it.
 *
 * Loaded verbatim into the scan bench by `build-scan-bench.py`. Plain browser
 * JavaScript on purpose: the whole point of the bench is that it is one file
 * with no server and no install, and this has to run inside it.
 *
 * Two halves. `staffGrid` measures the page — skew, staff spacing, where the
 * five lines actually run, given that a photographed page is curved and no
 * global rotation can flatten it. `staffDraw` uses those measurements to print
 * on the image what a model would otherwise have to work out by eye: which
 * pitch each height corresponds to, and a numbered ruler for saying where
 * something is.
 *
 * Wrapped so it exports exactly two names. It is inlined into a page that has
 * its own top-level constants, and sharing a scope with them is how `LETTERS`
 * collided the first time this was built.
 */

(function (root) {
'use strict';

async function staffGrid(dataB64, opts) {
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,' + dataB64; });

  // Work at native resolution. Downscaling to 1800px first was the single
  // biggest mistake here: a printed staff line is a couple of pixels of
  // low-contrast grey, and resampling smears it into the paper. The spacing
  // search came back flat — 13.5 at the true spacing, 14.2 at a wrong one —
  // and every stage downstream inherited the error.
  const W = Math.min(img.width, opts.maxWidth || 4200);
  const H = Math.round(img.height * W / img.width);

  const canvasOf = (angleDeg) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    if (angleDeg) { g.translate(W/2, H/2); g.rotate(angleDeg*Math.PI/180); g.translate(-W/2, -H/2); }
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, W, H);
    return c;
  };
  const greyOf = (c) => {
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const g = new Float32Array(W*H);
    for (let i = 0; i < W*H; i++) g[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
    return g;
  };
  // Local-mean threshold. A photograph has a shadow gradient across it, so one
  // global cutoff turns half the page black and the other half white.
  const binarise = (grey, radius) => {
    const S = new Float64Array((W+1)*(H+1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      S[(y+1)*(W+1)+(x+1)] = grey[y*W+x] + S[y*(W+1)+(x+1)] + S[(y+1)*(W+1)+x] - S[y*(W+1)+x];
    const R = radius, ink = new Uint8Array(W*H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = Math.max(0,x-R), y0 = Math.max(0,y-R), x1 = Math.min(W,x+R+1), y1 = Math.min(H,y+R+1);
      const m = (S[y1*(W+1)+x1] - S[y0*(W+1)+x1] - S[y1*(W+1)+x0] + S[y0*(W+1)+x0]) / ((x1-x0)*(y1-y0));
      ink[y*W+x] = grey[y*W+x] < m - 10 ? 1 : 0;
    }
    return ink;
  };

  // ---- 1. Spacing, from vertical run lengths -------------------------------
  // Run lengths are decisive where brightness is not. Walk each column and
  // histogram the black and white runs: two sharp modes fall out, the thickness
  // of a printed line and the gap between two of them. Noteheads, beams and
  // text are either much taller or much rarer, so they land in the tail where
  // the mode ignores them.
  const grey0 = greyOf(canvasOf(0));
  const ink0 = binarise(grey0, Math.max(8, Math.round(H/12)));
  const runHist = (ink) => {
    const black = new Float64Array(H), white = new Float64Array(H);
    for (let x = 0; x < W; x++) {
      let v = ink[x], n = 1;
      for (let y = 1; y < H; y++) {
        const p = ink[y*W+x];
        if (p === v) { n++; continue; }
        if (n < H) (v ? black : white)[n]++;
        v = p; n = 1;
      }
    }
    return { black, white };
  };
  const modeOf = (h, lo, hi) => { let best = lo, bv = -1;
    for (let i = lo; i <= hi; i++) if (h[i] > bv) { bv = h[i]; best = i; } return best; };
  const h0 = runHist(ink0);
  const lineH = modeOf(h0.black, 1, Math.round(H/12));
  const spaceH = modeOf(h0.white, 2, Math.round(H/6));
  const spacing = lineH + spaceH;

  // ---- 2. Skew -------------------------------------------------------------
  // Shear the ink into a horizontal projection and keep the angle whose profile
  // is spikiest. Five long parallel lines are the only thing on a page that can
  // make a projection spike, so this locks onto the staff and ignores the text.
  let skew = 0, bestVar = -1;
  const skewStride = Math.max(1, Math.round(W/1200));
  for (let a = -4; a <= 4; a += 0.1) {
    const t = Math.tan(a*Math.PI/180), prof = new Float64Array(H);
    for (let y = 0; y < H; y++) { const row = y*W;
      for (let x = 0; x < W; x += skewStride) { if (!ink0[row+x]) continue;
        const yy = y + Math.round((x - W/2)*t); if (yy >= 0 && yy < H) prof[yy]++; } }
    let m = 0; for (let y = 0; y < H; y++) m += prof[y]; m /= H;
    let v = 0; for (let y = 0; y < H; y++) v += (prof[y]-m)*(prof[y]-m);
    if (v > bestVar) { bestVar = v; skew = +a.toFixed(2); }
  }

  const c = canvasOf(-skew), grey = greyOf(c), ink = binarise(grey, Math.max(8, Math.round(spacing*2)));

  // ---- 3. The staff, as one rigid comb -------------------------------------
  // Track the staff as a single object, never five independent lines. Tracking
  // lines separately is what broke first: the top line's search window
  // overlapped the tempo heading and it walked off, taking 60px of invented
  // drift with it. Sliding the whole comb lets a beam darken one line and still
  // lose to the four that disagree.
  //
  // The comb is scored against the spaces between its own lines, not against
  // the paper beside the staff. Measuring against distant paper rewards a wider
  // comb — its probes reach cleaner margin — and that returned a stretched comb
  // sitting a line too high.
  const half = Math.max(1, Math.round(lineH/2));
  const combScore = (x, top, sp) => {
    let dark = 0, light = 0;
    for (let k = 0; k < 5; k++) {
      const y = Math.round(top + k*sp);
      if (y - half < 0 || y + half >= H) return -1e9;
      let s = 0; for (let dy = -half; dy <= half; dy++) s += grey[(y+dy)*W+x];
      dark += s/(2*half+1);
    }
    for (let k = 0; k < 4; k++) {
      const y = Math.round(top + (k+0.5)*sp);
      if (y < 0 || y >= H) return -1e9;
      light += grey[y*W+x];
    }
    return light/4 - dark/5;
  };

  // With spacing known, where the staff sits is a one-dimensional question, and
  // the median across the width keeps a block of text from answering it.
  const probeX = []; for (let x = Math.round(W*0.1); x < W*0.9; x += Math.round(W/60)) probeX.push(x);
  let seed = null;
  for (let top = 2; top < H - 4*spacing - 2; top += 0.5) {
    const b = probeX.map(x => combScore(x, top, spacing)).sort((p, q) => p - q);
    const v = b[Math.floor(b.length/2)];
    if (!seed || v > seed.v) seed = { v, top, sp: spacing };
  }

  // Track per column against the seed, never against a running expectation.
  // A running expectation is free to walk, and it did: over the width it slid a
  // whole line down. Anchoring every column to the deskewed seed with a window
  // narrower than half a space makes a one-line slip unreachable by
  // construction, so residual page curl is all that is left to fit.
  const win = spacing*0.4, step = Math.max(2, Math.round(spacing/3)), cols = [];
  for (let x = 0; x < W; x += step) {
    let best = null;
    for (let top = seed.top - win; top <= seed.top + win; top += 0.25)
      for (let sp = spacing - 1.2; sp <= spacing + 1.2; sp += 0.2) {
        const v = combScore(x, top, sp);
        if (!best || v > best.v) best = { v, top, sp };
      }
    // Solid ink (a chord, a barline) and blank paper both flatten the
    // lines-versus-spaces contrast, so one threshold rules out both.
    if (best.v > 18) cols.push({ x, top: best.top, sp: best.sp });
  }

  function quadFit(pts, key) {
    let S0=0,S1=0,S2=0,S3=0,S4=0,T0=0,T1=0,T2=0;
    for (const p of pts) { const x=p.x, y=p[key], x2=x*x;
      S0++; S1+=x; S2+=x2; S3+=x2*x; S4+=x2*x2; T0+=y; T1+=x*y; T2+=x2*y; }
    const M=[[S0,S1,S2],[S1,S2,S3],[S2,S3,S4]], V=[T0,T1,T2];
    for (let i=0;i<3;i++) {
      let p=i; for (let r=i+1;r<3;r++) if (Math.abs(M[r][i])>Math.abs(M[p][i])) p=r;
      const tm=M[i]; M[i]=M[p]; M[p]=tm; const tv=V[i]; V[i]=V[p]; V[p]=tv;
      for (let r=0;r<3;r++) { if (r===i || !M[i][i]) continue;
        const f=M[r][i]/M[i][i];
        for (let q=i;q<3;q++) M[r][q]-=f*M[i][q];
        V[r]-=f*V[i]; }
    }
    const a=V[0]/(M[0][0]||1), bb=V[1]/(M[1][1]||1), cc=V[2]/(M[2][2]||1);
    return (x) => a + bb*x + cc*x*x;
  }
  // One pass of outlier rejection: fit, drop columns off the curve, refit.
  let topAt = quadFit(cols, 'top');
  const kept = cols.filter(p => Math.abs(p.top - topAt(p.x)) < spacing*0.12);
  topAt = quadFit(kept, 'top');
  const spAt = quadFit(kept, 'sp');
  const lineY = (k, x) => topAt(x) + k*spAt(x);

  // ---- 4. Staff-line removal -----------------------------------------------
  // With the lines located exactly, take them out. Leaving them in was quietly
  // ruining every measurement made near the staff: five lines of ink cross
  // every column, so "is there anything beside this stroke?" answered about
  // 0.23 for empty paper and about 0.30 for a notehead, and no threshold
  // separates those. A pixel is deleted only where the vertical run through it
  // is line-thin — a stem or a barline crossing the line is taller than that
  // and survives, which is what keeps the strokes continuous.
  const inkNL = ink.slice();
  for (let x = 0; x < W; x++) {
    for (let k = 0; k < 5; k++) {
      const cy = Math.round(lineY(k, x));
      for (let y = cy - lineH; y <= cy + lineH; y++) {
        if (y < 0 || y >= H || !ink[y*W+x]) continue;
        let a = y, b2 = y;
        while (a > 0 && ink[(a-1)*W+x]) a--;
        while (b2 < H-1 && ink[(b2+1)*W+x]) b2++;
        if (b2 - a + 1 <= lineH*1.8) inkNL[y*W+x] = 0;
      }
    }
  }

  // ---- 5. Barline hints ----------------------------------------------------
  // Advisory only, and deliberately so. Separating a barline from a stem by
  // image statistics did not work here: both are one dark vertical stroke the
  // height of the staff, connected components merge through a slur that runs
  // the whole system, and every measurement of what sits beside the stroke —
  // neighbouring ink, stroke width, overhang above and below — put real
  // barlines and real stems in the same range. Reading barlines is the one part
  // of this a vision model is genuinely reliable at, so it gets that job, and
  // these are passed along only as a hint it may ignore.
  const bridge = Math.max(2, lineH);
  const runAt = (x, y0, y1) => {
    let best = null;
    let y = Math.max(0, Math.round(y0));
    const yEnd = Math.min(H-1, Math.round(y1));
    while (y <= yEnd) {
      if (!inkNL[y*W+x]) { y++; continue; }
      const a = y; let last = y;
      while (y <= yEnd) {
        if (inkNL[y*W+x]) { last = y; y++; continue; }
        let gap = 0;
        while (y + gap <= yEnd && !inkNL[(y+gap)*W+x]) gap++;
        if (gap > bridge) break;
        y += gap;
      }
      if (!best || last - a + 1 > best.h) best = { y0: a, y1: last, h: last - a + 1 };
    }
    return best;
  };
  const strokes = [];
  for (let x = 2; x < W-2; x++) {
    const t = lineY(0, x), bo = lineY(4, x), span = bo - t;
    const r2 = runAt(x, t - spacing*0.8, bo + spacing*0.8);
    if (!r2 || r2.h < span*0.85) continue;
    if (Math.abs(r2.y0 - t) > spacing*0.6 || Math.abs(r2.y1 - bo) > spacing*0.6) continue;
    strokes.push(x);
  }
  const barHints = [];
  for (let i = 0; i < strokes.length; i++) {
    const g = [strokes[i]];
    while (i+1 < strokes.length && strokes[i+1] - strokes[i] <= Math.max(3, lineH)) { g.push(strokes[++i]); }
    barHints.push(Math.round(g.reduce((a,b)=>a+b,0)/g.length));
  }
  const barX = barHints;

  const resid = kept.map(p => Math.abs(p.top - topAt(p.x))).sort((a,b)=>a-b);
  return {
    W, H, skew, lineH, spaceH, spacing,
    seedTop: +seed.top.toFixed(1),
    cols: cols.length, kept: kept.length, of: Math.ceil(W/step),
    drift: +(topAt(W-40) - topAt(40)).toFixed(1),
    spacingLeft: +spAt(40).toFixed(2), spacingRight: +spAt(W-40).toFixed(2),
    residMedian: +(resid.length ? resid[Math.floor(resid.length/2)] : NaN).toFixed(2),
    residP90: +(resid.length ? resid[Math.floor(resid.length*0.9)] : NaN).toFixed(2),
    barX,
    _canvas: c, _topAt: topAt, _spAt: spAt, _lineY: lineY, _kept: kept,
  };
}

const LETTERS = 'CDEFGAB';
// Where the middle line of the staff sits, as a diatonic step number, per clef.
const CLEF_MIDDLE = { treble: 4*7+6, bass: 3*7+1, alto: 4*7+0, tenor: 3*7+5 };
const stepName = (st) => LETTERS[((st % 7) + 7) % 7] + Math.floor(st/7);

function staffDraw(grid, opts) {
  const { W, H, spacing, _canvas: src, _lineY: lineY, _spAt: spAt } = grid;
  const clef = opts.clef || 'bass';
  const mid = CLEF_MIDDLE[clef];
  const ledger = opts.ledger == null ? 4 : opts.ledger;

  // Diatonic step st sits (st - mid) half-spaces above the middle line.
  const yOfStep = (st, x) => lineY(2, x) - (st - mid)*(spAt(x)/2);
  const steps = [];
  for (let st = mid - 4 - ledger; st <= mid + 4 + ledger; st++) steps.push(st);

  // Ticks are numbered in staff-spaces from the left edge, so the numbers stay
  // small enough to read at a glance and mean the same thing on every crop.
  const tickEvery = spacing*2;
  const tickCount = Math.floor(W/tickEvery);

  const bandTop = (x) => yOfStep(steps[steps.length-1], x);
  const bandBot = (x) => yOfStep(steps[0], x);

  function render(x0, x1, scale, o) {
    o = o || {};
    const gutter = Math.round(spacing*1.6*scale);
    const rulerH = Math.round(spacing*1.1*scale);
    let top = Infinity, bot = -Infinity;
    for (let x = x0; x <= x1; x += 8) { top = Math.min(top, bandTop(x)); bot = Math.max(bot, bandBot(x)); }
    top = Math.max(0, top - spacing*0.3); bot = Math.min(H, bot + spacing*0.3);

    const cw = Math.round((x1-x0)*scale), ch = Math.round((bot-top)*scale);
    const c = document.createElement('canvas');
    c.width = cw + gutter*2; c.height = ch + rulerH;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, x0, top, x1-x0, bot-top, gutter, rulerH, cw, ch);

    const px = (x) => gutter + (x - x0)*scale;
    const py = (y) => rulerH + (y - top)*scale;

    // Pitch grid. The printed staff lines are traced in blue purely so a reader
    // can see at a glance whether the grid is aligned; everything the page does
    // not print is red, because that is the information being added.
    g.lineWidth = Math.max(1, scale*0.4);
    for (const st of steps) {
      const onLine = ((st - mid) % 2 === 0) && Math.abs(st - mid) <= 4;
      g.strokeStyle = onLine ? 'rgba(40,90,205,0.40)' : 'rgba(205,40,40,0.32)';
      g.setLineDash(onLine ? [] : [scale*2, scale*3]);
      g.beginPath();
      for (let x = x0; x <= x1; x += 6) {
        const Y = py(yOfStep(st, x));
        x === x0 ? g.moveTo(px(x), Y) : g.lineTo(px(x), Y);
      }
      g.stroke();
    }
    g.setLineDash([]);

    // Labels sit half a space apart, so anything bigger than half a space
    // collides with its neighbours — which it did, turning the ledger pitches
    // above and below the staff into a smear at exactly the heights hardest to
    // read off the page.
    g.font = Math.round(spacing*0.42*scale) + 'px ui-monospace, SFMono-Regular, monospace';
    g.textBaseline = 'middle';
    for (const st of steps) {
      const onLine = ((st - mid) % 2 === 0) && Math.abs(st - mid) <= 4;
      g.fillStyle = onLine ? 'rgba(30,70,190,0.95)' : 'rgba(180,25,25,0.95)';
      const label = stepName(st);
      g.textAlign = 'right'; g.fillText(label, gutter - scale*2, py(yOfStep(st, x0)));
      g.textAlign = 'left';  g.fillText(label, gutter + cw + scale*2, py(yOfStep(st, x1)));
    }

    // Ruler.
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.strokeStyle = 'rgba(20,20,20,0.55)'; g.lineWidth = Math.max(1, scale*0.35);
    g.fillStyle = 'rgba(20,20,20,0.9)';
    g.font = Math.round(spacing*0.6*scale) + 'px ui-monospace, SFMono-Regular, monospace';
    for (let t = 0; t <= tickCount; t++) {
      const x = t*tickEvery;
      if (x < x0 - tickEvery || x > x1 + tickEvery) continue;
      const X = px(x);
      if (X < 0 || X > c.width) continue;
      g.beginPath(); g.moveTo(X, rulerH*0.55); g.lineTo(X, rulerH); g.stroke();
      g.fillText(String(t), X, rulerH*0.45);
    }

    if (o.barHints) {
      g.strokeStyle = 'rgba(20,150,70,0.45)'; g.lineWidth = Math.max(1, scale*0.5);
      g.setLineDash([scale*4, scale*4]);
      for (const bx of o.barHints) {
        if (bx < x0 || bx > x1) continue;
        g.beginPath(); g.moveTo(px(bx), rulerH); g.lineTo(px(bx), c.height); g.stroke();
      }
      g.setLineDash([]);
    }
    return { canvas: c, x0, x1, scale, tickEvery, width: c.width, height: c.height };
  }

  // Pick the zoom from the output size the model will actually keep.
  //
  // Every vision API resamples what you send it — Claude to roughly 1.15
  // megapixels, Gemini to tiles — so rendering a crop at 3x and shipping a
  // 2800px image just means the provider throws the zoom away again on the far
  // side. Sizing the render to land near that ceiling is what makes the crop
  // genuinely bigger rather than nominally bigger.
  const scaleFor = (x0, x1, maxEdge) => {
    const cap = maxEdge || 1450;
    const rawW = (x1 - x0) + spacing*3.2;
    // Height matters too. Sizing from the width alone turned the last, narrow
    // tile of a system into a 1450x1223 close-up of four notes: nominally the
    // most zoomed image in the set, and the least useful.
    const rawH = spacing*(2*(ledger + 4) + 2.5);
    return Math.max(1, Math.min(6, cap/rawW, cap/rawH));
  };
  const clampTick = (t) => Math.max(0, Math.min(tickCount, t));

  return {
    tickEvery, tickCount,
    xOfTick: (t) => t*tickEvery,
    full: (o) => render(0, W, (o && o.scale) || scaleFor(0, W, (o && o.maxEdge)), o),

    // A crop is widened by a whole tick on each side so a barline sitting on
    // the boundary is never cut in half.
    tickRange: (t0, t1, o) => {
      const a = clampTick(t0 - 1)*tickEvery, b = clampTick(t1 + 1)*tickEvery;
      return render(a, b, (o && o.scale) || scaleFor(a, b, (o && o.maxEdge)), o);
    },

    // Overlapping tiles for the pass that locates barlines.
    //
    // The whole system in one image does not survive the trip: a staff is ten
    // times wider than it is tall, so a provider that resamples to a fixed
    // pixel budget hands the model a strip a few notes high. Tiles keep the
    // staff a readable height, and they overlap by a tick so a barline landing
    // on a seam is whole in at least one of them.
    tiles: (o) => {
      o = o || {};
      const per = Math.min(o.ticksPerTile || 12, tickCount);
      const over = o.overlapTicks == null ? 2 : o.overlapTicks;
      const out = [];
      for (let t = 0; t < tickCount; t += (per - over)) {
        // Pull the last tile back to full width rather than letting it trail off
        // narrow, so every tile in the set is the same size and scale.
        let t0 = t, t1 = t + per;
        if (t1 >= tickCount) { t1 = tickCount; t0 = Math.max(0, tickCount - per); }
        const a = clampTick(t0)*tickEvery, b = clampTick(t1)*tickEvery;
        out.push(Object.assign(
          render(a, b, o.scale || scaleFor(a, b, o.maxEdge), o),
          { tick0: t0, tick1: t1 }));
        if (t1 >= tickCount) break;
      }
      return out;
    },
  };
}

root.staffGrid = staffGrid;
root.staffDraw = staffDraw;
})(typeof window !== 'undefined' ? window : globalThis);
