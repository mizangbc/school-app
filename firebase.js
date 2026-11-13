import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCqN2uC567DTWPCpJbNN19A7Qrff-vCcTQ",
  authDomain: "modelgps-management.firebaseapp.com",
  projectId: "modelgps-management",
  storageBucket: "modelgps-management.firebasestorage.app",
  messagingSenderId: "242358420856",
  appId: "1:242358420856:web:100dbcdb264667ea65348d"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// অফলাইন সাপোর্টসহ Firestore
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
