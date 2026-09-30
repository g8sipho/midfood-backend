// Point this at wherever the MidFood backend is running.
//
// - iOS Simulator on the same Mac as the backend: http://localhost:4000
// - Android Emulator: http://10.0.2.2:4000  (10.0.2.2 is the emulator's alias for your host machine)
// - A physical phone (Expo Go) on the same Wi-Fi as your computer:
//     http://<your-computer's-LAN-IP>:4000  (e.g. http://192.168.1.42:4000)
// - A deployed backend: your real https:// URL
//
// Easiest way to find your LAN IP: run `ipconfig getifaddr en0` (Mac) or
// `ipconfig` (Windows) while the backend is running.
//
// Now pointing at the live Render deployment, so the app works over any
// internet connection, not just your home Wi-Fi. To go back to testing
// against your own machine, swap this back to the local IP line below.
// const API_BASE_URL = 'http://192.168.0.8:4000';
export const API_BASE_URL = 'https://midfood-backend.onrender.com';
