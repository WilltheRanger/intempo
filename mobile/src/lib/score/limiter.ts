/**
 * A look-ahead peak limiter: Listen as loud as a phone can play it, with no
 * sample past the ceiling and no distortion on the way.
 *
 * **Why not simply less gain.** A bowed string's attacks and vibrato peaks
 * stand 10–13 dB above the note they belong to, so a gain that keeps every
 * peak under full scale leaves the note itself quiet — which is where Listen
 * was, twice, by the owner's ear. The peaks are a few milliseconds long; this
 * lowers only those milliseconds, by only as much as they are over, and gives
 * the level back within a tenth of a second.
 *
 * **Why not render again at a lower gain**, which the previous version did. It
 * scaled the whole passage by its single loudest moment, and each moment over
 * the ceiling cost another pass of the passage — three or four on a long piece
 * with several forte bars, against a 30-second render deadline on a phone.
 *
 * The design is the standard one, and it is chosen for its guarantee:
 *
 * 1. For each sample, the gain that would put it exactly at the ceiling.
 * 2. The lowest of those over the next `lookahead` samples (a sliding minimum):
 *    the gain is already down when the peak arrives.
 * 3. A release: the gain rises back towards that minimum exponentially, never
 *    faster.
 * 4. A moving average over the same `lookahead`, so the way down is a ramp
 *    rather than a step.
 *
 * Every value averaged in (4) is at most the gain the delayed sample needs, so
 * their mean is too: **no output sample exceeds the ceiling**, by construction
 * rather than by tuning. The price is `lookahead` samples of delay, which the
 * caller removes by writing each output `lookahead` samples earlier.
 */
export class Limiter {
  readonly lookahead: number;
  private readonly ceiling: number;
  private readonly release: number;

  /** Input samples not yet output, and the gain each needs. */
  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private readonly need: Float64Array;
  /** Sliding minimum of `need`, as a deque of indices into the ring. */
  private readonly order: Int32Array;
  private head = 0;
  private tail = 0;
  /** The released gains averaged in step 4, and their running sum. */
  private readonly held: Float64Array;
  private sum: number;
  private previous = 1;
  private released = 1;
  private count = 0;

  constructor(
    sampleRate: number,
    ceiling: number,
    { lookaheadS = 0.008, releaseS = 0.12 } = {},
  ) {
    this.lookahead = Math.max(1, Math.round(lookaheadS * sampleRate));
    this.ceiling = ceiling;
    this.release = 1 - Math.exp(-1 / (releaseS * sampleRate));
    const size = this.lookahead + 1;
    this.left = new Float32Array(size);
    this.right = new Float32Array(size);
    this.need = new Float64Array(size);
    this.order = new Int32Array(size + 1);
    this.held = new Float64Array(this.lookahead).fill(1);
    this.sum = this.lookahead;
  }

  /**
   * Take one stereo sample in; once `lookahead` samples are in, give back the
   * sample from `lookahead` ago, limited. Returns false while filling.
   */
  push(left: number, right: number, out: [number, number]): boolean {
    const size = this.lookahead + 1;
    const at = this.count % size;
    const peak = Math.max(Math.abs(left), Math.abs(right));
    this.left[at] = left;
    this.right[at] = right;
    this.need[at] = peak > this.ceiling ? this.ceiling / peak : 1;

    // Sliding minimum over the last `size` samples: a deque of positions whose
    // needs increase from front to back.
    const capacity = this.order.length;
    while (
      this.tail !== this.head &&
      this.need[this.order[(this.tail - 1 + capacity) % capacity] % size] >= this.need[at]
    ) {
      this.tail = (this.tail - 1 + capacity) % capacity;
    }
    this.order[this.tail] = this.count;
    this.tail = (this.tail + 1) % capacity;
    while (this.order[this.head] <= this.count - size) {
      this.head = (this.head + 1) % capacity;
    }
    const lowest = this.need[this.order[this.head] % size];

    // Down at once, back up at the release rate.
    this.released =
      lowest < this.released
        ? lowest
        : this.released + (lowest - this.released) * this.release;

    const slot = this.count % this.lookahead;
    this.previous = this.held[slot];
    this.held[slot] = this.released;
    // A running sum, re-added from scratch once per window so rounding cannot
    // drift it: a sum that crept upwards would be a gain a hair too high, and
    // the guarantee below is only as good as the average it rests on.
    if (slot === this.lookahead - 1) {
      this.sum = 0;
      for (const value of this.held) this.sum += value;
    } else {
      this.sum += this.released - this.previous;
    }
    this.count += 1;

    if (this.count <= this.lookahead) {
      return false;
    }
    // The sample `lookahead` behind the newest, at the averaged gain. **Not
    // clamped**, deliberately: a clamp would hide a limiter that turned down
    // too late by clipping the peak flat, which is the distortion this exists
    // to prevent, and the tests would pass on it.
    const gain = Math.min(1, this.sum / this.lookahead);
    const from = (this.count - 1 - this.lookahead) % size;
    out[0] = this.left[from] * gain;
    out[1] = this.right[from] * gain;
    return true;
  }
}
