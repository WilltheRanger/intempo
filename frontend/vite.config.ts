import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the preview from a subpath (/intempo/), so assets and
// router base come from VITE_BASE_PATH there. Unset locally → '/' as before.
// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
})
