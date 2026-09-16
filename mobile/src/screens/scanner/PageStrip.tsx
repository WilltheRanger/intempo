import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ScoreThumbnail } from '../../components/pieces/ScoreThumbnail';
import { Text } from '../../components/primitives/Text';
import { BORDER_WIDTH, colors, radii, spacing } from '../../design';
import type { CapturedPage } from '../../data/captureSession';
import { PAGE_ASPECT } from '../../lib/scan/framing';

/**
 * Tall enough to tell one page of music from another, short enough to sit in
 * the top bar without pushing the viewfinder down.
 */
const THUMB_HEIGHT = 40;
const THUMB_WIDTH = Math.round(THUMB_HEIGHT * PAGE_ASPECT);

/**
 * The height the slot keeps whether or not there is anything in it.
 *
 * The strip took the page count's place in the top bar, and the count is one
 * line of 13pt type — so a scan's first photograph would have grown the bar by
 * 22pt and pushed the frame the musician is aiming with down the screen. The
 * empty state is a line of text vertically centred in the same box.
 */
export const STRIP_HEIGHT = THUMB_HEIGHT + 8;

export interface PageStripProps {
  pages: CapturedPage[];
  /** Opens the review list, where a page can be retaken, reordered or removed. */
  onOpen: () => void;
}

/**
 * The pages taken so far, in the order they will be read.
 *
 * **The order is the one promise this flow makes and never showed.** The review
 * screen says "InTempo uploads and reads every page in this order", and until
 * this strip the viewfinder showed a single thumbnail of the most recent page —
 * so a musician shooting a six-page part had no way to know, without leaving
 * the camera, whether page four had gone in at all or landed in the right
 * place. Leaving is the expensive part: the music is on the stand and the phone
 * is lined up on it.
 *
 * **The marker is the same finding the verdict panel stated**, read back off
 * the page rather than remembered here — see `CapturedPage.reading`. A verdict
 * shown once, at the moment of the shutter, is a verdict that scrolls away
 * while someone is lining up the next page; this is what is left of it.
 *
 * **It sits in the top bar, where "3 pages" used to.** Under the frame is where
 * the app and the musician talk about the shot that was just taken, and a
 * second picture of the scan there made two subjects of one slot (§3 law 4).
 * The count it replaced said less than the strip does — a number against the
 * pages themselves, in order, with a mark on the one worth another look — which
 * is the element §3 law 10 asks to remove. Reference material rather than an
 * action, so it is allowed to sit out of the thumb zone (law 7).
 */
export function PageStrip({ pages, onOpen }: PageStripProps) {
  const scroller = useRef<ScrollView>(null);
  const count = pages.length;

  // The page just taken is the one worth seeing, and it goes on the end.
  // Keyed on the count rather than on the array so a reading landing late does
  // not yank the strip while someone is looking at page two.
  useEffect(() => {
    scroller.current?.scrollToEnd({ animated: true });
  }, [count]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.content}
    >
      {pages.map((page, index) => (
        <Pressable
          key={page.id}
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={
            page.reading && page.reading.tone === 'doubtful'
              ? `Page ${index + 1} of ${count}. ${page.reading.headline}. Review pages`
              : `Page ${index + 1} of ${count}. Review pages`
          }
          style={({ pressed }) => [styles.page, pressed && styles.pressed]}
        >
          <ScoreThumbnail source={page.source} style={styles.thumb} />
          {/*
            **A mark, not a badge.** It sits on the page it is about and says
            one thing: this one is worth a second look. The words are on the
            review screen, where there is room for them and where the controls
            that answer them are.
          */}
          {page.reading && page.reading.tone === 'doubtful' ? (
            <View style={styles.mark}>
              <Text variant="eyebrow" color="darkBg" accessibilityElementsHidden>
                !
              </Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const MARK = 16;

const styles = StyleSheet.create({
  strip: {
    // A ScrollView in a flex row takes all the width it can get and none of
    // the height unless it is told; the bar gives it both.
    flexGrow: 0,
    height: STRIP_HEIGHT,
  },
  content: {
    // Room for the mark, which sits proud of the corner it is on.
    paddingHorizontal: spacing.xs,
    gap: spacing.xs,
    alignItems: 'center',
  },
  page: {
    borderRadius: radii.sm,
    borderWidth: BORDER_WIDTH,
    borderColor: colors.onDarkMuted,
    overflow: 'visible',
  },
  thumb: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: radii.sm,
  },
  mark: {
    position: 'absolute',
    top: -MARK / 3,
    right: -MARK / 3,
    width: MARK,
    height: MARK,
    borderRadius: MARK / 2,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
