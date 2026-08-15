import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Playfair Display — the display serif (Suisse Int'l stand-in is system SF).
// Suisse Int'l is commercial (Swiss Typefaces) and can't be bundled here.
// Inter is the closest free neo-grotesque; the stack in tailwind.config.js
// prefers Suisse when a licensed copy is installed.
import "@fontsource-variable/inter";
import "@fontsource/playfair-display/400.css";
import "@fontsource/playfair-display/500.css";
import "@fontsource/playfair-display/600.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/playfair-display/400-italic.css";
import "@fontsource/playfair-display/500-italic.css";

import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
