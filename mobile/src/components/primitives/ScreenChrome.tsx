import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * What a screen's content tells its navigation bar.
 *
 * The bar decides how it looks from two lines on the page
 * (`navigation/navigationBar.ts`): where the screen's large title ends, and
 * where a photograph at the top of it ends. Both are drawn by the screen, deep
 * inside whatever composes its head, and only `ScreenContainer` knows the
 * scroll position to compare them with — so the content reports the lines up,
 * and the container does the comparing.
 */
export interface ScreenChrome {
  /** How much of the top of the scroll view the bar covers; 0 without a bar. */
  barHeight: number;
  /** A large title's words and the line it ends on, in content points; null when it goes. */
  reportTitle(id: string, title: { text: string; bottom: number | null } | null): void;
  /** A dark band's bottom, in content points; null when it goes. */
  reportDarkGround(id: string, bottom: number | null): void;
  /** Where a view ends in the scroll content, measured now. */
  measureBottom(node: View, done: (bottom: number) => void): void;
  /** Scroll the screen back to its top: a control in the bar opening something in the content. */
  scrollToTop(): void;
}

export const ScreenChromeContext = createContext<ScreenChrome | null>(null);

/** The chrome of the screen this is drawn in, or null outside a `ScreenContainer`. */
export function useScreenChrome(): ScreenChrome | null {
  return useContext(ScreenChromeContext);
}

/**
 * A screen's large title: the serif heading that collapses into the bar.
 *
 * Wrap the heading — and only the heading — so the line it is measured to is
 * the bottom of its last line of words. `text` is what the bar shows once it
 * has gone under it, which is the title's own words; a heading built of parts
 * ("Bar 12 · 3 of 4 beats") passes the part that names the screen.
 *
 * Outside a `ScreenContainer` it is a plain view and reports to nobody.
 */
export function LargeTitle({
  text,
  children,
  style,
}: {
  text: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const chrome = useScreenChrome();
  const id = useId();
  const ref = useRef<View>(null);
  const bottom = useRef<number | null>(null);

  // The words, whenever they change: a piece's title arrives with its data.
  useEffect(() => {
    chrome?.reportTitle(id, { text, bottom: bottom.current });
  }, [chrome, id, text]);

  // And gone with the heading, so a state without one does not keep its line.
  useEffect(() => () => chrome?.reportTitle(id, null), [chrome, id]);

  function measure() {
    const node = ref.current;
    if (!chrome || !node) {
      return;
    }
    chrome.measureBottom(node, (measured) => {
      bottom.current = measured;
      chrome.reportTitle(id, { text, bottom: measured });
    });
  }

  return (
    <View ref={ref} onLayout={measure} style={style} collapsable={false}>
      {children}
    </View>
  );
}

/**
 * A dark band at the top of the content — a photograph — telling the bar
 * where it ends, so the bar stays clear and ivory until it has gone under it.
 *
 * Returns the ref and layout handler for the band's own view.
 */
export function useDarkGround(): { ref: React.RefObject<View | null>; onLayout: () => void } {
  const chrome = useScreenChrome();
  const id = useId();
  const ref = useRef<View>(null);

  useEffect(() => () => chrome?.reportDarkGround(id, null), [chrome, id]);

  function onLayout() {
    const node = ref.current;
    if (!chrome || !node) {
      return;
    }
    chrome.measureBottom(node, (bottom) => chrome.reportDarkGround(id, bottom));
  }

  return { ref, onLayout };
}
