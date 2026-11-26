import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tidydesk.mobile',
  appName: 'TidyDesk',
  webDir: '../dist-mobile',
  backgroundColor: '#0f131d',
  server: {
    androidScheme: 'http',
    cleartext: true
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#0f131d'
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f131d'
    }
  }
};

export default config;
