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

  // A record of the working, not just the answer.
  //
  // Every stage here decides something on evidence — an angle from a variance
  // peak, a spacing from a histogram mode, a curve from a few hundred column
  // fits — and every one of those decisions was wrong at least once while this
  // was being built, each time with numbers that looked entirely reasonable.
  // What caught them was looking at the evidence. So the evidence is kept.
  const steps = [];
  const note = (title, detail, extra) => {
    steps.push(Object.assign({ title, detail }, extra || {}));
  };
  const snapshot = (mask, label) => {
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    const g2 = c2.getContext('2d'), im = g2.createImageData(W, H);
    for (let i = 0; i < W*H; i++) {
      const v = mask[i] ? 0 : 255;
      im.data[i*4] = v; im.data[i*4+1] = v; im.data[i*4+2] = v; im.data[i*4+3] = 255;
    }
    g2.putImageData(im, 0, 0);
    return { label, canvas: c2 };
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
  note('Staff spacing', `Walked every column and histogrammed the black and white runs. `
    + `The black mode is a printed line — ${lineH}px thick. The white mode is the gap `
    + `between two of them — ${spaceH}px. One staff space is ${spacing}px.`,
    { series: [
        { name: 'black runs (line thickness)', values: Array.from(h0.black.slice(0, Math.min(H, spacing*3))), mark: lineH },
        { name: 'white runs (gap between lines)', values: Array.from(h0.white.slice(0, Math.min(H, spacing*3))), mark: spaceH },
      ],
      images: [snapshot(ink0, 'what counts as ink')] });

  /** Least squares through a quadratic — enough for page curl, too stiff to chase a beam. */
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

  // ---- 2. Where the staff runs ---------------------------------------------
  //
  // There is no deskew step, and removing it fixed the worst bug in this file.
  //
  // A global rotation only ever existed so that a straight-line model of the
  // staff would fit. This models a curve, so it never needed one — and the
  // rotation was actively wrong twice over. The angle came from maximising the
  // variance of a sheared projection, which the black page-edge bands dominate:
  // they are horizontal, so they pull the peak toward zero, and a staff whose
  // true tilt was −1.4° was measured at −0.8°. Then it was applied with the
  // wrong sign, turning a 93px drop into a 137px one. Every number downstream
  // still looked healthy; the grid sat a space and a half off the staff at the
  // right-hand end, which only a zoomed screenshot showed.
  const c = canvasOf(0), grey = greyOf(c);
  const ink = binarise(grey, Math.max(8, Math.round(spacing*2)));

  // Score the comb against the spaces between its own lines. Measuring against
  // the paper beside the staff rewards a wider comb — its probes reach cleaner
  // margin — and that returned a stretched comb sitting a line too high.
  const half = Math.max(1, Math.round(lineH/2));
  const combScore = (x, top, sp) => {
    // The worst of the five lines, against the middling one of the four gaps.
    //
    // Averaging both terms is what put the comb a whole space below the staff
    // on a dense page: the gaps between real staff lines are full of noteheads,
    // so sliding the comb down until its gaps sample the clean paper underneath
    // *raises* an averaged score, even though only four of its five lines still
    // land on ink. Scoring the darkest-it-has-to-be — the brightest line — makes
    // that trade impossible, because the one line hanging off the staff is
    // sitting on paper and drags the whole score with it.
    let worstLine = -1e9;
    for (let k = 0; k < 5; k++) {
      const y = Math.round(top + k*sp);
      if (y - half < 0 || y + half >= H) return -1e9;
      let s = 0; for (let dy = -half; dy <= half; dy++) s += grey[(y+dy)*W+x];
      worstLine = Math.max(worstLine, s/(2*half+1));
    }
    const gaps = [];
    for (let k = 0; k < 4; k++) {
      const y = Math.round(top + (k+0.5)*sp);
      if (y < 0 || y >= H) return -1e9;
      gaps.push(grey[y*W+x]);
    }
    gaps.sort((a, b) => a - b);
    return (gaps[1] + gaps[2])/2 - worstLine;
  };

  // Choose which staff, globally, before measuring anything about it.
  //
  // Five dark lines over four light gaps is not unique on a page of music.
  // Stacked ledger lines above a high passage make one, a neighbouring system
  // caught by the crop makes one, and both score as well as the real staff in
  // the columns where they exist. Searching each column independently and
  // fitting a curve through the answers gives a curve through none of them: on
  // a real page here the per-column answers sat within 70px of each other and
  // the fitted curve still swung 230px across the width, crossing the staff
  // diagonally.
  //
  // What separates the staff from its impostors is not how good it looks in one
  // column but that it is *there in every column*. So the seed is a straight
  // tilted comb scored by its MEDIAN across columns spread over the width —
  // ledger lines score brilliantly in the few columns they occupy and nowhere
  // else, and a median cannot be moved by that. The tilt is searched too, since
  // a hand-held page is never level and a level comb would fit no staff at all.
  const probeX = [];
  for (let x = Math.round(W*0.06); x < W*0.94; x += Math.round(W/34)) probeX.push(x);
  const medianScore = (top0, slope) => {
    const vals = [];
    for (const x of probeX) vals.push(combScore(x, top0 + slope*(x - W/2), spacing));
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length/2)];
  };
  let seed = null;
  const maxSlope = 0.09;                      // about 5°, past any hand-held tilt
  const slopeStep = 2/W;                      // two pixels of rise across the page
  for (let slope = -maxSlope; slope <= maxSlope; slope += slopeStep)
    for (let top0 = 2; top0 < H - 4*spacing - 2; top0 += 1) {
      const v = medianScore(top0, slope);
      if (!seed || v > seed.v) seed = { v, top0, slope };
    }

  const probes = probeX.map((x) => ({ x, top: seed.top0 + seed.slope*(x - W/2), sp: spacing }));

  const win = spacing*0.4, step = Math.max(2, Math.round(spacing/3));

  // Start the refinement from the seed line and let it bend from there. Each
  // pass moves a column at most half a space, so a line slip stays unreachable;
  // several passes follow a page that bends much further than that.
  let topAt = (x) => seed.top0 + seed.slope*(x - W/2), spAt = () => spacing;
  let agreement = 1;
  let cols = [], kept = [], moved = null;
  for (let pass = 0; pass < 5; pass++) {
    const prev = topAt;
    cols = [];
    for (let x = 0; x < W; x += step) {
      const c0 = prev(x), s0 = spAt(x);
      let best = null;
      for (let top = c0 - win; top <= c0 + win; top += 0.25)
        for (let sp = s0 - 0.6; sp <= s0 + 0.6; sp += 0.1) {
          const v = combScore(x, top, sp);
          if (!best || v > best.v) best = { v, top, sp };
        }
      // Solid ink (a chord, a barline) and blank paper both flatten the
      // lines-versus-spaces contrast, so one threshold rules out both.
      if (best.v > 18) cols.push({ x, top: best.top, sp: best.sp });
    }
    if (cols.length < 12) break;
    let fit = quadFit(cols, 'top');
    const trimmed = cols.filter(p => Math.abs(p.top - fit(p.x)) < spacing*0.12);
    kept = trimmed.length >= 12 ? trimmed : cols;
    topAt = quadFit(kept, 'top');
    spAt = quadFit(kept, 'sp');
    // Stop when a pass stops moving the curve. Running on would only re-fit the
    // same columns, and every extra pass is another chance to drift.
    let sum = 0, n = 0;
    for (let x = 0; x < W; x += Math.round(W/40)) { sum += Math.abs(topAt(x) - prev(x)); n++; }
    moved = sum/n;
    if (moved < 0.5) break;
  }
  const lineY = (k, x) => topAt(x) + k*spAt(x);

  const combOverlay = () => {
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    const g2 = c2.getContext('2d'); g2.drawImage(c, 0, 0);
    g2.lineWidth = Math.max(1, lineH/4); g2.strokeStyle = 'rgba(215,40,40,0.85)';
    for (let k = 0; k < 5; k++) { g2.beginPath();
      for (let x = 0; x < W; x += 8) { const Y = lineY(k, x); x === 0 ? g2.moveTo(x, Y) : g2.lineTo(x, Y); }
      g2.stroke(); }
    g2.fillStyle = 'rgba(20,120,215,0.8)';
    for (const p of kept) g2.fillRect(p.x - 1, p.top - 1, 3, 3);
    return { label: 'the fitted staff, drawn back onto the page', canvas: c2 };
  };
  const residSorted = kept.map(p => Math.abs(p.top - topAt(p.x))).sort((a, b) => a - b);
  const medianResid = residSorted.length ? residSorted[Math.floor(residSorted.length/2)] : NaN;
  note('Finding the staff, without straightening the page',
    `Searched the full height of ${probes.length} columns for five dark lines separated by four `
    + `light gaps, with nothing assumed about where the staff is. That pattern wins by a wide `
    + `margin — nothing text or noteheads make comes close — so the columns can be searched `
    + `independently and still agree.\n\nThere is no rotation step. A global rotation only ever `
    + `existed so a straight-line model would fit, and this models a curve. It was also wrong `
    + `twice over: the angle came from a projection the black page edges dominate, so a −1.4° `
    + `tilt measured as −0.8°, and it was then applied with the wrong sign — turning a 93px drop `
    + `across the page into 137px.`,
    { series: [{ name: 'staff top by column, left to right', values: probes.map(p => p.top) }] });

  note('Where the staff actually runs',
    `Refined the curve at ${cols.length} columns, keeping the ${kept.length} that agree with it, `
    + `each searched only within half a space of the current fit so no column can slip onto a `
    + `neighbouring line. The staff falls ${Math.abs(+(topAt(W-40) - topAt(40)).toFixed(1))}px `
    + `${topAt(W-40) > topAt(40) ? 'lower' : 'higher'} at the right edge than the left — tilt and `
    + `curl together, which is why the grid is a curve and not five straight lines. `
    + `Spread among the kept columns ±${medianResid.toFixed(2)}px; what matters more is the `
    + `picture below, since a fit can agree beautifully with the columns it chose and still sit `
    + `off the printed staff.`,
    { images: [combOverlay()] });

  // ---- 4. Staff-line removal -----------------------------------------------
  // With the lines located exactly, take them out. Leaving them in was quietly
  // ruining every measurement made near the staff: five lines of ink cross
  // every column, so "is there anything beside this stroke?" answered about
  // 0.23 for empty paper and about 0.30 for a notehead, and no threshold
  // separates those. A pixel is deleted only where the vertical run through it
  // is line-thin — a stem or a barline crossing the line is taller than that
  // and survives, which is what keeps the strokes continuous.
  const inkBefore = ink.slice();
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

  note('Staff lines removed',
    'A pixel is deleted only where the vertical run through it is line-thin, so a stem or a '
    + 'barline crossing a line survives and stays continuous. Leaving the lines in was quietly '
    + 'ruining every measurement made near the staff: five lines of ink cross every column, so '
    + '"is there anything beside this stroke?" answered about the same for empty paper as for a '
    + 'notehead.',
    { images: [snapshot(inkBefore, 'before'), snapshot(inkNL, 'after')] });

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
  note('Barline hints',
    `${barHints.length} vertical stroke${barHints.length === 1 ? '' : 's'} span the staff top to `
    + 'bottom. Some are barlines and some are stems, and nothing in the image separates them — '
    + 'six ways of trying are written up in DECISIONS.md, and real barlines and real stems landed '
    + 'in the same range every time. These go to the model as a hint it may ignore; the ruler '
    + 'printed on each slice is how it answers.',
    { rows: barHints.map((x, i) => [`stroke ${i+1}`, `x ${x}`]) });

  const resid = kept.map(p => Math.abs(p.top - topAt(p.x))).sort((a,b)=>a-b);
  return {
    W, H, lineH, spaceH, spacing,
    probes: probes.length,
    tilt: +(((topAt(W-40) - topAt(40))/(W-80))*180/Math.PI).toFixed(2),
    cols: cols.length, kept: kept.length, of: Math.ceil(W/step),
    drift: +(topAt(W-40) - topAt(40)).toFixed(1),
    spacingLeft: +spAt(40).toFixed(2), spacingRight: +spAt(W-40).toFixed(2),
    residMedian: +(resid.length ? resid[Math.floor(resid.length/2)] : NaN).toFixed(2),
    residP90: +(resid.length ? resid[Math.floor(resid.length*0.9)] : NaN).toFixed(2),
    barX, steps,
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
