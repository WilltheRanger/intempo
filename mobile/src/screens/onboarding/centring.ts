/**
 * Centring a block on the whole screen when a footer takes the bottom of it
 * (`redesign/OnboardWelcome.dc.html`, `OnboardDone.dc.html`).
 *
 * The prototypes centre the picture and its title on the full height and lay
 * the button over the bottom. Centred instead in the space *above* the button,
 * the block sits half a footer higher than it was drawn — about 60pt on a
 * phone. Centred on the full height on a short phone, it runs into the button.
 *
 * So it is pushed down by the footer's height, which centres it on the whole
 * screen, and by less when there is not the room — never into the footer.
 */
export function centringLift(area: number, content: number, footer: number): number {
  return Math.max(0, Math.min(footer, area - content));
}
