/* Super 7 Live · Firebase settings.
   Paste the config object from the Firebase console here
   (Project settings > Your apps > SDK setup and configuration > Config).
   Leave it as null to run in LOCAL DEMO mode: everything stays inside one
   browser and the teacher and student tabs talk to each other through the
   browser only, which is enough to try the app out. */
window.S7_FIREBASE = null;
/* Example:
window.S7_FIREBASE = {
  apiKey: "AIza...",
  authDomain: "aums-super7.firebaseapp.com",
  databaseURL: "https://aums-super7-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "aums-super7",
  storageBucket: "aums-super7.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
*/
/* Teacher PIN: the teacher screen asks for this before it will control a session.
   Change it each term. Students never see this file's purpose, but anyone who
   reads the source can, so treat it as a lock on the door, not a safe. */
window.S7_TEACHER_PIN = "7777";
