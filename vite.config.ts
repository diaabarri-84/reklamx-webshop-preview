import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // NOTE: GEMINI_API_KEY is intentionally NOT exposed to the client bundle.
    // The key is used only server-side in server.ts; the browser talks to /api/chat.
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Split the vendor code by how often it changes and who needs it.
          // Everything landed in one 2.7 MB file before, so a customer reading
          // the front page downloaded Firebase, the charting code, the design
          // editor and the PDF renderer first, and any change to any of our own
          // code invalidated the whole thing in their cache.
          // Only libraries that nothing else imports at module scope get their
          // own chunk. Splitting React out as well looked tidier and broke the
          // site: 'vendor' initialised before the react chunk and every page
          // died on "Cannot read properties of undefined (reading
          // 'createContext')". Anything that touches React stays with it.
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('fabric')) return 'editor';       // design editor only
            // The designer's QR encoder (src/lib/designQr.ts): in 'vendor' every
            // shopper would download it to make no QR code at all.
            if (id.includes('/qrcode/')) return 'editor';
            if (id.includes('pdfjs-dist')) return 'pdf';      // artwork preview only
            // Drag and drop is the DASHBOARD's (every list he arranges); in
            // 'vendor' every shopper would download it to drag nothing.
            if (id.includes('@dnd-kit')) return 'dnd';
            // recharts drags in a dozen d3-* packages, victory-vendor, and a
            // whole Redux store. In 'vendor' they would be downloaded by every
            // SHOPPER to draw charts only the admin reports screen ever shows.
            //
            // react-redux and use-sync-external-store are deliberately NOT
            // listed: they touch React, and the comment above records what
            // happened the last time React-touching code was split away from
            // the chunk React initialises in. They are small; the 350 KB is in
            // the d3/victory half, which is inert data-shaping code.
            if (
              id.includes('recharts')
              || id.includes('/d3-')
              || id.includes('victory-vendor')
              || id.includes('@reduxjs/toolkit')
              || id.includes('/immer/')
              || id.includes('/reselect/')
              || id.includes('es-toolkit')
              || id.includes('decimal.js-light')
              || id.includes('eventemitter3')
            ) return 'charts';
            if (id.includes('@firebase') || id.includes('/firebase/')) return 'firebase';
            return 'vendor';
          },
        },
      },
      // Raised deliberately: the remaining warning would be about the vendor
      // chunk, which is as split as it usefully gets.
      chunkSizeWarningLimit: 900,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
