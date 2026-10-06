import type { ReactNode } from 'react';
import { Platform } from 'react-native';

/**
 * Children that are present but not there while `inert` is true: out of the
 * keyboard order, the accessibility tree and the pointer, on the web.
 *
 * Native has this already in `accessibilityElementsHidden` and
 * `importantForAccessibility`, and react-native-web drops both — so a layer
 * hidden that way was still read out and still took Tab in the browser. The
 * Library's closed search field and its Clear and Cancel buttons were three
 * invisible controls on the first screen of the app (found 2026-10-05).
 * HTML `inert` is the one primitive that removes all three at once, and
 * `display: contents` keeps the wrapper out of the layout it sits in. The tab
 * scenes in `RootNavigator` were the first place it was needed.
 *
 * Use it alongside the native props, not instead of them.
 */
export function Inert({ inert, children }: { inert: boolean; children: ReactNode }) {
  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }
  return (
    <div inert={inert || undefined} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
