import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { EASE_OUT, MIN_TOUCH_TARGET, motion, pressedOpacity, spacing } from '../../design';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { Inert } from './Inert';
import { PageHeader } from './PageHeader';
import { useScreenChrome } from './ScreenChrome';
import { SearchField } from './SearchField';
import { Text } from './Text';

/** How far each layer travels as it goes. Enough to have a direction. */
const CROSSFADE_RISE = 6;

export interface SearchHeaderProps {
  /** The screen's serif title, shown when search is closed. */
  title: string;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  /**
   * Whether the field is showing. The screen holds it, because the magnifier
   * that opens it is in the navigation bar (2026-11-13), not beside the title.
   */
  open: boolean;
  /**
   * "Cancel". The screen clears the query as well as closing: leaving a
   * filter applied behind a control you just dismissed is how a library looks
   * empty for no visible reason.
   */
  onClose: () => void;
  /**
   * `onDark` when the header sits on a dark band, as the Library's does over
   * its Continue band: the title and "Cancel" in ivory. The field itself is
   * unchanged — a solid card-white field is the control §3 law 6 allows over
   * colour or a photograph, and it keeps its ink.
   */
  tone?: 'auto' | 'onDark';
}

/**
 * A screen title that becomes a search field, rather than growing one under
 * itself.
 *
 * **Two things were wrong and only one of them was the animation.** The field
 * was mounted and unmounted on a boolean — `{open ? <SearchField/> : null}` —
 * so it arrived between one frame and the next, which is what "it just pops
 * up" describes. And it arrived *below* the title, inserted into the flow, so
 * every piece on the shelf jumped down 60 points at the same instant.
 *
 * Both are answered by the same composition: the title and the field are two
 * layers of one band, and searching crossfades between them. The band keeps
 * the title's height whichever layer is showing, so nothing below it moves at
 * all — and the title is *replaced*, which is what every phone platform does
 * with a search that takes over the bar.
 *
 * **The closed layer stays in the flow at zero opacity** rather than being
 * unmounted. That is what holds the height: measuring the title to reserve its
 * space would be a second source for a number the title already knows, and it
 * would be wrong for one frame every time the title changed.
 */
export function SearchHeader({
  title,
  query,
  onQueryChange,
  placeholder,
  open,
  onClose,
  tone = 'auto',
}: SearchHeaderProps) {
  const chrome = useScreenChrome();
  const reduceMotion = useReducedMotion();

  /**
   * Which layer is showing, as a number, so both can move against it.
   *
   * `useNativeDriver` is true: opacity and transform are the only things
   * interpolated here, which is what keeps the crossfade off the JavaScript
   * thread while the keyboard is coming up — the one moment in this
   * transition when that thread is busy.
   */
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      // `base`, not `fast`: this is a band of the screen changing what it is,
      // not a control acknowledging a press. Read `EASE_OUT`'s note before
      // changing it — half of this duration is 96% of the movement.
      duration: motion.base,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();
  }, [open, progress, reduceMotion]);

  // **Back to the top as it opens.** The magnifier is in the bar, which stays
  // put, so it can be pressed from halfway down the shelf — where the field it
  // opens, at the top of the content, is out of sight.
  useEffect(() => {
    if (open) {
      chrome?.scrollToTop();
    }
  }, [chrome, open]);

  const titleLayer = {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -CROSSFADE_RISE],
        }),
      },
    ],
  };

  const searchLayer = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [CROSSFADE_RISE, 0],
        }),
      },
    ],
  };

  return (
    <View style={styles.band}>
      {/*
        The layer that sets the band's height. Hidden from touch and from the
        screen reader while it is invisible: a control that cannot be seen but
        can still be selected, and does nothing when it is, is worse than one
        that is not there.
      */}
      <Animated.View
        style={titleLayer}
        pointerEvents={open ? 'none' : 'auto'}
        accessibilityElementsHidden={open}
        importantForAccessibility={open ? 'no-hide-descendants' : 'auto'}
      >
        {/* The two props above are native-only; this is the web's (`Inert`). */}
        <Inert inert={open}>
          <PageHeader tone={tone} title={title} />
        </Inert>
      </Animated.View>

      {/*
        The field, laid over the title's own space. It takes no touches at all
        while closed, so the magnifier and the screen's action underneath it
        stay reachable through the full width of the band.
      */}
      <Animated.View
        style={[styles.searchLayer, searchLayer]}
        pointerEvents={open ? 'auto' : 'none'}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      >
        <Inert inert={!open}>
          <SearchField
            value={query}
            onChangeText={onQueryChange}
            placeholder={placeholder}
            style={styles.field}
            // Only once it is actually open: `autoFocus` on a mounted-but-hidden
            // field takes the keyboard on arrival at the screen.
            autoFocus={open}
          />
          {/*
            **A word, not a second glyph.** The magnifier turned into an X, which
            is the same control saying two different things from the same place;
            once the field has replaced the title there is room for the word that
            every platform uses here, and a word cannot be misread as "clear what
            I have typed" — which is what the X inside the field already means.
          */}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel search"
            style={({ pressed }) => [styles.cancel, pressed && styles.cancelPressed]}
          >
            <Text variant="button" color={tone === 'onDark' ? 'onDarkSecondary' : 'textSecondary'}>
              Cancel
            </Text>
          </Pressable>
        </Inert>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    // The title layer is in the flow and owns the height; the field is laid
    // over it. Nothing below this moves when search opens.
    position: 'relative',
  },
  searchLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  field: {
    flex: 1,
    // See `SearchField.input`: a flex item's CSS min-width is its content, so
    // without this the field cannot be squeezed back on the web build.
    minWidth: 0,
  },
  cancel: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  cancelPressed: {
    opacity: pressedOpacity,
  },
});
