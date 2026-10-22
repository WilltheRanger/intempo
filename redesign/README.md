# Design prototypes

HTML prototypes of the app's screens, one phone screen (390 × 844) per
`.dc.html` file, drawn on a design canvas (`canvas.json` holds the arrangement).
The shipped screens in `mobile/src/screens/` were built from them, and code
comments cite them by file name as the design source for a layout or a piece of
copy. They are reference material: nothing here is built, shipped or tested.

Where a prototype and the app disagree, the app is the answer. Colours map to
the tokens in `mobile/src/design/`; the design laws every screen follows are in
`CLAUDE.md` §3.

Two prototypes describe a screen that no longer exists. `Today.dc.html` and
`TodayLight.dc.html` were the home screen until the Library replaced it (#178,
2026-09-30). They are kept because comments still cite them for parts that
moved elsewhere.

The prototype-only mechanics (`sessionStorage` hand-offs, `<a href>` links
between files, sample data, hidden scrollbars) were never meant to be ported.
