import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wtf.pos',
  appName: 'WTF POS',
  webDir: 'dist/wtf-pos/browser',
  server: {
    androidScheme: 'http',
  },
  plugins: {
    Media: {
      androidGalleryMode: true,
    },
  },
};

export default config;
