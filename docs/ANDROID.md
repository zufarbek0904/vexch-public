# Android-версия (Capacitor)
APK из этого репозитория без Android Studio собрать нельзя. Шаги на вашем компьютере:
1. `bun add -d @capacitor/cli && bun add @capacitor/core @capacitor/android`
2. Опубликуйте сайт и задайте адрес: `VEXCHAT_URL=https://ваш-сайт` (см. `capacitor.config.ts`).
3. `npx cap add android && npx cap sync android && npx cap open android`
4. В Android Studio: Build → Build APK(s). Для магазина — подпись ключом и AAB.
Для звонков добавьте в `AndroidManifest.xml` разрешения CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS.
Push-уведомления потребуют Firebase Cloud Messaging — в проекте пока не реализованы.
