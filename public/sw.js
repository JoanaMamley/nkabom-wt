// The app's one service worker. Angular's worker caches the app shell so it opens offline
// (NKB-107); push handling for Firebase Cloud Messaging is added here by NKB-509. Keep this file
// name: changing the registered script URL strands installed copies on the old worker.
importScripts('./ngsw-worker.js');
