import type { CapacitorConfig } from "@capacitor/cli";

// Android/iOS-обёртка (WebView) над опубликованным сайтом. Подробности — docs/ANDROID.md.
// Приложение загружает живой сайт, поэтому обновления выходят без пересборки APK.
const config: CapacitorConfig = {
  appId: "app.vexchat.mobile",
  appName: "VexChat",
  webDir: "public",
  server: { url: process.env.VEXCHAT_URL ?? "https://YOUR-PUBLISHED-URL.example", cleartext: false },
  android: { allowMixedContent: false },
};
export default config;
