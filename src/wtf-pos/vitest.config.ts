import { defineConfig } from 'vitest/config';

// The Angular unit-test builder defaults to `isolate: false`, which shares the module cache between
// spec files in a worker. Specs that vi.mock() packages (Capacitor, Firebase, SignalR, html-to-image)
// then pass or fail depending on which spec loaded the real module first. Isolate each file instead.
export default defineConfig({
  test: {
    isolate: true,
  },
});
