/**
 * The icons this app draws, imported one at a time.
 *
 * **Measured: `lucide-react-native` ships 1,768 icons and this app uses 25.**
 * Importing them from the package's barrel pulls all of them into the bundle —
 * Metro does not tree-shake by default, and the package's `sideEffects: false`
 * only helps a bundler that does. Proved rather than assumed, by finding the
 * SVG path data for `banana`, `tractor`, `axe`, `wine` and `brain-cog` in the
 * shipped `index-*.js`.
 *
 * The whole icon set is **1,312 KB raw / 178 KB gzipped** in source form,
 * against a bundle that is 3,686 KB raw and **697 KB gzipped**. So roughly a
 * quarter of what every musician downloads on a first visit was icons the app
 * never draws.
 *
 * `lucide-react-native/icons/<name>` is the package's own published subpath —
 * it is in `exports`, mapped to the ESM file for `react-native` and `import`
 * and the CJS one for `require` — so this is a supported entry point rather
 * than a reach into `dist/`.
 *
 * **One module rather than 27 files doing it themselves**, because the mapping
 * from a component name to a file name is not always obvious and getting it
 * wrong is a build error at best: names are kebab-case, digits are split
 * (`Trash2` → `trash-2`), and `MoreVertical` is a deprecated alias whose file
 * is `ellipsis-vertical`. That belongs in one place.
 */
export { default as Camera } from 'lucide-react-native/icons/camera';
export { default as ChartLine } from 'lucide-react-native/icons/chart-line';
export { default as ChevronLeft } from 'lucide-react-native/icons/chevron-left';
export { default as ChevronRight } from 'lucide-react-native/icons/chevron-right';
export { default as FileMusic } from 'lucide-react-native/icons/file-music';
export { default as GripVertical } from 'lucide-react-native/icons/grip-vertical';
export { default as House } from 'lucide-react-native/icons/house';
export { default as Images } from 'lucide-react-native/icons/images';
export { default as Layers } from 'lucide-react-native/icons/layers';
export { default as Library } from 'lucide-react-native/icons/library';
export { default as Mic } from 'lucide-react-native/icons/mic';
export { default as Minus } from 'lucide-react-native/icons/minus';
// `MoreVertical` is lucide's deprecated alias for `EllipsisVertical`; the file
// is named for the new one. Kept under the old name so the call sites read as
// they did.
export { default as MoreVertical } from 'lucide-react-native/icons/ellipsis-vertical';
export { default as Pause } from 'lucide-react-native/icons/pause';
export { default as PencilLine } from 'lucide-react-native/icons/pencil-line';
export { default as Play } from 'lucide-react-native/icons/play';
export { default as Plus } from 'lucide-react-native/icons/plus';
export { default as RotateCcw } from 'lucide-react-native/icons/rotate-ccw';
export { default as Search } from 'lucide-react-native/icons/search';
export { default as Square } from 'lucide-react-native/icons/square';
export { default as Trash2 } from 'lucide-react-native/icons/trash-2';
export { default as User } from 'lucide-react-native/icons/user';
export { default as X } from 'lucide-react-native/icons/x';
export { default as Zap } from 'lucide-react-native/icons/zap';
export { default as ZapOff } from 'lucide-react-native/icons/zap-off';

/**
 * The type an icon is, for the components that take one as a prop.
 *
 * A **type-only** re-export, so it is erased and does not pull the barrel — and
 * therefore the other 1,743 icons — back into the bundle through the side door.
 */
export type { LucideIcon } from 'lucide-react-native';
