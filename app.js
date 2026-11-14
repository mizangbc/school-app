import { Home } from "./pages.js?v=6";
import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, writeBatch, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const html = htm.bind(React.createElement);

// মোবাইল নম্বর -> লগইন আইডি (বাংলা সংখ্যাও চলবে)
const bn2en = s => s.replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
const cleanMobile = s => bn2en(s).replace(/\D/g, "");
const validMobile = m => /^01\d{9}$/.test(m);
const toEmail = m => `${m}@modelgps.local`;

const ERR = {
  "auth/invalid-credential": "মোবাইল নম্বর বা পাসওয়ার্ড ভুল।",
  "auth/email-already-in-use": "এই নম্বর দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে।",
  "auth/weak-password": "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন।",
  "auth/network-request-failed": "ইন্টারনেট সংযোগ নেই। সংযোগ দেখে আবার চেষ্টা করুন।",
  "auth/too-many-requests": "অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।",
  "permission-denied": "এই কাজের অনুমতি নেই।"
};
const msg = e => ERR[e.code] || "সমস্যা হয়েছে। আবার চেষ্টা করুন।";

const ROLES = {
  main_admin: "প্রধান অ্যাডমিন", assistant_admin: "সহকারী অ্যাডমিন",
  teacher: "শিক্ষক", verifier: "ফলাফল যাচাইকারী"
};
const MENU = {
  main_admin: ["শিক্ষার্থী ও Excel আপলোড", "শ্রেণি, শাখা ও বিষয়", "পরীক্ষার সেটিং", "শিক্ষক ও বরাদ্দ", "যাচাই ও অনুমোদন", "ফলাফল ও প্রকাশ", "শিক্ষাবর্ষ ও ব্যাকআপ"],
  assistant_admin: ["শিক্ষার্থী ও Excel আপলোড", "শ্রেণি, শাখা ও বিষয়", "ফলাফল দেখা"],
  teacher: ["নম্বর এন্ট্রি", "আমার বরাদ্দ"],
  verifier: ["নম্বর যাচাই ও অনুমোদন", "ফলাফল দেখা"]
};

function Field({ label, ...p }) {
  return html`<label>${label}<input ...${p} /></label>`;
}

function Login() {
  const [mobile, setMobile] = useState(""), [pw, setPw] = useState("");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function go(e) {
    e.preventDefault(); setErr("");
    const m = cleanMobile(mobile);
    if (!validMobile(m)) return setErr("১১ সংখ্যার সঠিক মোবাইল নম্বর দিন (যেমন 01712345678)।");
    setBusy(true);
    try { await signInWithEmailAndPassword(auth, toEmail(m), pw); }
    catch (x) { setErr(msg(x)); setBusy(false); }
  }
  return html`<form class="card" onSubmit=${go}>
    <${Field} label="মোবাইল নম্বর" type="tel" inputMode="numeric" value=${mobile} onInput=${e => setMobile(e.target.value)} autoComplete="username" />
    <${Field} label="পাসওয়ার্ড" type="password" value=${pw} onInput=${e => setPw(e.target.value)} autoComplete="current-password" />
    ${err && html`<p class="err">${err}</p>`}
    <button disabled=${busy}>${busy ? "অপেক্ষা করুন…" : "লগইন করুন"}</button>
  </form>`;
}

// প্রথমবার একবারই চলবে: প্রধান অ্যাডমিন তৈরি
function FirstSetup() {
  const [name, setName] = useState(""), [mobile, setMobile] = useState("");
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function go(e) {
    e.preventDefault(); setErr("");
    const m = cleanMobile(mobile);
    if (!name.trim()) return setErr("নাম লিখুন।");
    if (!validMobile(m)) return setErr("১১ সংখ্যার সঠিক মোবাইল নম্বর দিন।");
    if (pw !== pw2) return setErr("দুই পাসওয়ার্ড মেলেনি।");
    setBusy(true);
    try {
      const { user } = await createUserWithEmailAndPassword(auth, toEmail(m), pw);
      const b = writeBatch(db);
      b.set(doc(db, "users", user.uid), { name: name.trim(), mobile: m, role: "main_admin", createdAt: serverTimestamp() });
      b.set(doc(db, "settings", "init"), { done: true, createdAt: serverTimestamp() });
      await b.commit();
    } catch (x) { setErr(msg(x)); setBusy(false); }
  }
  return html`<form class="card" onSubmit=${go}>
    <p class="sub">এটি প্রথমবারের সেটআপ। এখানে যিনি অ্যাকাউন্ট খুলবেন তিনিই প্রধান অ্যাডমিন হবেন।</p>
    <${Field} label="আপনার নাম" value=${name} onInput=${e => setName(e.target.value)} />
    <${Field} label="মোবাইল নম্বর" type="tel" inputMode="numeric" value=${mobile} onInput=${e => setMobile(e.target.value)} />
    <${Field} label="পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)" type="password" value=${pw} onInput=${e => setPw(e.target.value)} autoComplete="new-password" />
    <${Field} label="পাসওয়ার্ড আবার লিখুন" type="password" value=${pw2} onInput=${e => setPw2(e.target.value)} autoComplete="new-password" />
    ${err && html`<p class="err">${err}</p>`}
    <button disabled=${busy}>${busy ? "অপেক্ষা করুন…" : "প্রধান অ্যাডমিন তৈরি করুন"}</button>
  </form>`;
}

function Dashboard({ profile }) {
  const items = MENU[profile.role] || [];
  return html`<div>
    <div class="top">
      <div><div class="brand" style=${{ margin: 0 }}>${profile.name}</div><span class="role">${ROLES[profile.role] || profile.role}</span></div>
      <button class="ghost" onClick=${() => signOut(auth)}>লগআউট</button>
    </div>
    <div class="grid">
      ${items.map(t => html`<div class="item" key=${t}><b>${t}</b><span>পরের ধাপে</span></div>`)}
    </div>
  </div>`;
}

function NoAccess() {
  return html`<div class="card"><p>আপনার অ্যাকাউন্টে এখনো কোনো ভূমিকা দেওয়া হয়নি। প্রধান অ্যাডমিনের সাথে যোগাযোগ করুন।</p>
  <button onClick=${() => signOut(auth)}>লগআউট</button></div>`;
}

function App() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => onAuthStateChanged(auth, async user => {
    setState({ loading: true });
    try {
      if (!user) {
        const init = await getDoc(doc(db, "settings", "init"));
        return setState({ screen: init.exists() ? "login" : "setup" });
      }
      // নতুন অ্যাডমিন তৈরির পর প্রোফাইল লেখা শেষ হওয়া পর্যন্ত অল্প অপেক্ষা
      let snap = await getDoc(doc(db, "users", user.uid));
      for (let i = 0; !snap.exists() && i < 4; i++) {
        await new Promise(r => setTimeout(r, 600));
        snap = await getDoc(doc(db, "users", user.uid));
      }
      setState(snap.exists() ? { screen: "home", profile: snap.data() } : { screen: "noaccess" });
    } catch (e) { setState({ screen: "error", text: msg(e) }); }
  }), []);

  if (state.loading) return html`<p class="sub">লোড হচ্ছে…</p>`;
  return html`<div>
    ${state.screen !== "home" && html`<div class="brand">স্কুল ব্যবস্থাপনা</div>
      <p class="sub">S. M. Model Govt. Primary School</p>`}
    ${state.screen === "login" && html`<${Login} />`}
    ${state.screen === "setup" && html`<${FirstSetup} />`}
    ${state.screen === "home" && html`<${Home} profile=${state.profile} />`}
    ${state.screen === "noaccess" && html`<${NoAccess} />`}
    ${state.screen === "error" && html`<p class="err">${state.text}</p>`}
  </div>`;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
