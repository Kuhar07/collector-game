import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyARc_n26JuSHaY7uKaXbV4uLJ9mZcs7wX4',
  authDomain: 'niop4g-sakupljac-78896.firebaseapp.com',
  projectId: 'niop4g-sakupljac-78896',
  storageBucket: 'niop4g-sakupljac-78896.firebasestorage.app',
  messagingSenderId: '721532882102',
  appId: '1:721532882102:web:894d78b0fe6abbba096a17',
  measurementId: 'G-7LY4S64KR6'
};

export const app = initializeApp(firebaseConfig);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
