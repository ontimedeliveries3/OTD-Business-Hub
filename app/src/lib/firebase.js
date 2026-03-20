import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: "AIzaSyAx3BRhTuBdZaZeCrTQMM642quLfT-BAGI",
  authDomain: "otd-business-hub.firebaseapp.com",
  projectId: "otd-business-hub",
  storageBucket: "otd-business-hub.firebasestorage.app",
  messagingSenderId: "508307969198",
  appId: "1:508307969198:web:ed07d1d65316cf9e17093f",
  measurementId: "G-072YEK5NH1",
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
export const db = getFirestore(app)
export const storage = getStorage(app)
export default app
