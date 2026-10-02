/* =====================================================================
   firebase-sdk.js — تنها جایی که نسخهٔ Firebase نوشته می‌شود.
   برای عوض کردن نسخه، فقط عدد FIREBASE_SDK_VERSION در همین فایل را
   (در هر ۳ خط) تغییر بدهید؛ sw.js خودش این آدرس‌ها را از همین فایل
   می‌خواند و پیش‌کش می‌کند، پس دیگر لازم نیست جای دیگری عوض شود.
   نسخهٔ فعلی: 12.19.0
   ===================================================================== */
export { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
export {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
export {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, writeBatch, increment, runTransaction
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
