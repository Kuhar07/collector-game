// Prevent Firebase from detecting Electron's renderer as a Node.js environment.
delete window.module;

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyARc_n26JuSHaY7uKaXbV4uLJ9mZcs7wX4",
  authDomain: "niop4g-sakupljac-78896.firebaseapp.com",
  projectId: "niop4g-sakupljac-78896",
  storageBucket: "niop4g-sakupljac-78896.firebasestorage.app",
  messagingSenderId: "721532882102",
  appId: "1:721532882102:web:894d78b0fe6abbba096a17",
  measurementId: "G-7LY4S64KR6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// persistentLocalCache enables offline support:
// reads serve from IndexedDB cache, writes queue and sync when back online
export const db   = initializeFirestore(app, { localCache: persistentLocalCache() });
export const auth = getAuth(app);