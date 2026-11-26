// Re-exports exactly the Firebase functions used by src/app.js.
// Bundled into ../vendor/firebase.bundle.js by build/build-vendor.mjs.
export { initializeApp } from 'firebase/app';
export {
    getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDoc, onSnapshot, serverTimestamp
} from 'firebase/firestore';
export { getAuth, signInAnonymously, signInWithEmailAndPassword, signOut } from 'firebase/auth';
