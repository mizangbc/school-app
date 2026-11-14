import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { firebaseConfig, auth, db } from "./firebase.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, getDocs, setDoc, deleteDoc, collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const html = htm.bind(React.createElement);
const bn2en = s => String(s || "").replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
const digits = s => bn2en(s).replace(/\D/g, "");
const toBn = n => String(n ?? "").replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);
const toEmail = m => `${m}@modelgps.local`;

const ROLES = {
  teacher: "শিক্ষক",
  assistant_admin: "সহকারী অ্যাডমিন",
  verifier: "ফলাফল যাচাইকারী"
};

// সহায়ক অথেনটিকেশন যাতে প্রধান অ্যাডমিন লগআউট না হন
let secondaryAuthInstance = null;
function getSecondaryAuth() {
  if (!secondaryAuthInstance) {
    const secApp = initializeApp(firebaseConfig, "SecondaryAuthApp");
    secondaryAuthInstance = getAuth(secApp);
  }
  return secondaryAuthInstance;
}

// ১. শিক্ষক ও স্টাফ ব্যবস্থাপনা (অ্যাকাউন্ট তৈরি ও তালিকা)
function StaffList({ onRefresh, users }) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState("teacher");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");

  async function handleCreate(e) {
    e.preventDefault();
    setErr("");
    setOkMsg("");
    const m = digits(mobile);
    if (!name.trim()) return setErr("শিক্ষকের নাম লিখুন।");
    if (!/^01\d{9}$/.test(m)) return setErr("১১ সংখ্যার সঠিক মোবাইল নম্বর দিন।");
    if (pw.length < 6) return setErr("পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।");

    setBusy(true);
    try {
      const secAuth = getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(secAuth, toEmail(m), pw);
      const newUid = cred.user.uid;
      await signOut(secAuth);

      // Firestore-এ প্রোফাইল সেভ
      await setDoc(doc(db, "users", newUid), {
        name: name.trim(),
        mobile: m,
        role: role,
        createdAt: serverTimestamp()
      });

      setName("");
      setMobile("");
      setPw("");
      setRole("teacher");
      setShowAdd(false);
      setOkMsg(`"${name.trim()}"-এর অ্যাকাউন্ট তৈরি হয়েছে।`);
      onRefresh();
    } catch (ex) {
      console.error(ex);
      if (ex.code === "auth/email-already-in-use") {
        setErr("এই মোবাইল নম্বর দিয়ে আগেই একটি অ্যাকাউন্ট খোলা হয়েছে।");
      } else {
        setErr("অ্যাকাউন্ট তৈরি করা যায়নি: " + (ex.message || ex.code));
      }
    }
    setBusy(false);
  }

  async function handleDelete(u) {
    if (u.role === "main_admin") {
      alert("প্রধান অ্যাডমিন অ্যাকাউন্ট মুছে ফেলা যাবে না।");
      return;
    }
    if (!confirm(`"${u.name}" (${ROLES[u.role] || u.role})-কে কি মুছে ফেলতে চান?`)) return;
    try {
      await deleteDoc(doc(db, "users", u.id));
      onRefresh();
    } catch (ex) {
      console.error(ex);
      alert("মুছে ফেলা যায়নি: " + (ex.message || ex.code));
    }
  }

  return html`<div>
    <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "14px 0" }}>
      <b>মোট শিক্ষক ও কর্মকর্তা: ${toBn(users.length)} জন</b>
      <button class="ghost" onClick=${() => setShowAdd(!showAdd)}>
        ${showAdd ? "বাতিল" : "+ নতুন শিক্ষক যোগ"}
      </button>
    </div>

    ${okMsg && html`<p class="ok">${okMsg}</p>`}

    ${showAdd && html`<form class="card" onSubmit=${handleCreate} style=${{ marginBottom: "16px" }}>
      <h3 style=${{ margin: "0 0 10px", fontSize: "1.05rem" }}>নতুন শিক্ষক বা কর্মকর্তার অ্যাকাউন্ট তৈরি</h3>
      <label>নাম
        <input value=${name} onInput=${e => setName(e.target.value)} placeholder="যেমন: মো: কামরুল হাসান" />
      </label>
      <label>মোবাইল নম্বর (লগইন আইডি হিসেবে ব্যবহৃত হবে)
        <input type="tel" inputMode="numeric" value=${mobile} onInput=${e => setMobile(e.target.value)} placeholder="01712345678" />
      </label>
      <label>পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)
        <input type="password" value=${pw} onInput=${e => setPw(e.target.value)} placeholder="পাসওয়ার্ড লিখুন" />
      </label>
      <label>দায়িত্ব / ভূমিকা
        <select value=${role} onChange=${e => setRole(e.target.value)} style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
          <option value="teacher">শিক্ষক (শুধু নম্বর এন্ট্রি)</option>
          <option value="assistant_admin">সহকারী অ্যাডমিন (শিক্ষার্থী ও কাঠামো ব্যবস্থাপনা)</option>
          <option value="verifier">ফলাফল যাচাইকারী (নম্বর যাচাই ও অনুমোদন)</option>
        </select>
      </label>
      ${err && html`<p class="err">${err}</p>`}
      <button disabled=${busy} style=${{ marginTop: "16px" }}>
        ${busy ? "অ্যাকাউন্ট তৈরি হচ্ছে…" : "অ্যাকাউন্ট সংরক্ষণ করুন"}
      </button>
    </form>`}

    <div class="grid" style=${{ marginTop: "8px" }}>
      ${users.map(u => html`<div class="item" key=${u.id} style=${{ alignItems: "center" }}>
        <div>
          <b>${u.name}</b>
          <div style=${{ fontSize: "0.85rem", color: "var(--mute)" }}>
            ${u.mobile} • <span class="role" style=${{ fontSize: "0.78rem", padding: "1px 8px" }}>${ROLES[u.role] || (u.role === "main_admin" ? "প্রধান অ্যাডমিন" : u.role)}</span>
          </div>
        </div>
        ${u.role !== "main_admin" && html`
          <button type="button" class="danger" style=${{ padding: "4px 10px", fontSize: "0.85rem", width: "auto" }}
            onClick=${() => handleDelete(u)}>বাদ দিন</button>
        `}
      </div>`)}
    </div>
  </div>`;
}

// ২. শ্রেণি ও বিষয় বরাদ্দ
function Allocations({ users, structure }) {
  const [assigns, setAssigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teacherId, setTeacherId] = useState("");
  const [classId, setClassId] = useState("");
  const [section, setSection] = useState("");
  const [subject, setSubject] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // শিক্ষক তালিকা ফিল্টার (প্রধান অ্যাডমিন ছাড়া বাকি শিক্ষক ও সহকারী অ্যাডমিন)
  const eligibleTeachers = users.filter(u => u.role === "teacher" || u.role === "assistant_admin" || u.role === "verifier");

  useEffect(() => {
    getDoc(doc(db, "config", "assignments")).then(s => {
      setAssigns(s.exists() ? (s.data().list || []) : []);
      setLoading(false);
    }).catch(e => {
      console.error(e);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (eligibleTeachers.length > 0 && !teacherId) setTeacherId(eligibleTeachers[0].id);
    if (structure.length > 0 && !classId) {
      setClassId(structure[0].id);
      setSection(structure[0].sections[0] || "");
      setSubject(structure[0].subjects[0] || "");
    }
  }, [eligibleTeachers, structure]);

  const curClass = structure.find(c => c.id === classId) || structure[0];

  async function handleAdd(e) {
    e.preventDefault();
    setErr("");
    setMsg("");
    if (!teacherId) return setErr("শিক্ষক নির্বাচন করুন।");
    if (!classId || !section) return setErr("শ্রেণি ও শাখা নির্বাচন করুন।");
    if (!subject) return setErr("বিষয় নির্বাচন করুন।");

    const t = users.find(u => u.id === teacherId);
    const existing = assigns.find(a => a.classId === classId && a.section === section && a.subject === subject);
    if (existing) {
      if (!confirm(`"${curClass.name}" শ্রেণির শাখা "${section}"-এর "${subject}" বিষয়টি বর্তমানে "${existing.teacherName}"-এর নামে বরাদ্দ আছে। পরিবর্তন করতে চান?`)) {
        return;
      }
    }

    setBusy(true);
    const updated = assigns.filter(a => !(a.classId === classId && a.section === section && a.subject === subject));
    const newEntry = {
      id: `${classId}_${section}_${subject}`,
      teacherUid: teacherId,
      teacherName: t ? t.name : "শিক্ষক",
      teacherMobile: t ? t.mobile : "",
      classId,
      className: curClass.name,
      section,
      subject,
      assignedAt: new Date().toISOString()
    };
    updated.push(newEntry);

    try {
      await setDoc(doc(db, "config", "assignments"), { list: updated, updatedAt: serverTimestamp() });
      setAssigns(updated);
      setMsg(`"${curClass.name}" শ্রেণির শাখা "${section}"-এর "${subject}" বরাদ্দ দেওয়া হয়েছে।`);
    } catch (ex) {
      console.error(ex);
      setErr("সংরক্ষণ করা যায়নি। ইন্টারনেট ও Rules দেখুন।");
    }
    setBusy(false);
  }

  async function handleRemove(id) {
    if (!confirm("এই বরাদ্দটি বাতিল করতে চান?")) return;
    const updated = assigns.filter(a => a.id !== id);
    try {
      await setDoc(doc(db, "config", "assignments"), { list: updated, updatedAt: serverTimestamp() });
      setAssigns(updated);
    } catch (ex) {
      console.error(ex);
      alert("বাতিল করা যায়নি।");
    }
  }

  if (loading) return html`<p class="sub">বরাদ্দ তালিকা লোড হচ্ছে…</p>`;
  if (structure.length === 0) return html`<p class="sub">আগে "শ্রেণি, শাখা ও বিষয়" তৈরি করুন।</p>`;
  if (eligibleTeachers.length === 0) return html`<p class="sub">আগে "শিক্ষক ও কর্মকর্তা" ট্যাব থেকে অন্তত একজন শিক্ষক যোগ করুন।</p>`;

  return html`<div>
    <form class="card" onSubmit=${handleAdd} style=${{ marginTop: "14px" }}>
      <h3 style=${{ margin: "0 0 10px", fontSize: "1.05rem" }}>নতুন বিষয় বরাদ্দ করুন</h3>
      <label>শিক্ষক
        <select value=${teacherId} onChange=${e => setTeacherId(e.target.value)} style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
          ${eligibleTeachers.map(u => html`<option key=${u.id} value=${u.id}>${u.name} (${u.mobile})</option>`)}
        </select>
      </label>

      <div style=${{ display: "flex", gap: "10px", marginTop: "10px" }}>
        <div style=${{ flex: 1 }}>
          <label style=${{ margin: "4px 0" }}>শ্রেণি</label>
          <select value=${classId} onChange=${e => {
            const cid = e.target.value;
            setClassId(cid);
            const cl = structure.find(c => c.id === cid);
            if (cl) {
              setSection(cl.sections[0] || "");
              setSubject(cl.subjects[0] || "");
            }
          }} style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
            ${structure.map(c => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}
          </select>
        </div>
        <div style=${{ flex: 1 }}>
          <label style=${{ margin: "4px 0" }}>শাখা</label>
          <select value=${section} onChange=${e => setSection(e.target.value)} style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
            ${(curClass.sections || []).map(s => html`<option key=${s} value=${s}>${s}</option>`)}
          </select>
        </div>
      </div>

      <label style=${{ marginTop: "10px" }}>বিষয়
        <select value=${subject} onChange=${e => setSubject(e.target.value)} style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
          ${(curClass.subjects || []).map(sub => html`<option key=${sub} value=${sub}>${sub}</option>`)}
        </select>
      </label>

      ${err && html`<p class="err">${err}</p>`}
      ${msg && html`<p class="ok">${msg}</p>`}

      <button disabled=${busy} style=${{ marginTop: "14px" }}>
        ${busy ? "সংরক্ষণ হচ্ছে…" : "বরাদ্দ দিন"}
      </button>
    </form>

    <div style=${{ marginTop: "18px" }}>
      <div style=${{ fontWeight: 600, fontSize: "1.05rem", margin: "14px 0 8px" }}>
        বর্তমান বরাদ্দ তালিকা (মোট: ${toBn(assigns.length)} টি)
      </div>

      ${assigns.length === 0 && html`<p class="sub">এখনো কোনো বিষয় বরাদ্দ করা হয়নি।</p>`}

      <div class="grid" style=${{ marginTop: "8px" }}>
        ${assigns.map(a => html`<div class="item" key=${a.id} style=${{ alignItems: "center" }}>
          <div>
            <b>${a.className} • শাখা: ${a.section} • ${a.subject}</b>
            <div style=${{ fontSize: "0.85rem", color: "var(--acc)", fontWeight: 500, marginTop: "2px" }}>
              শিক্ষক: ${a.teacherName}
            </div>
          </div>
          <button type="button" class="danger" style=${{ padding: "4px 10px", fontSize: "0.85rem", width: "auto" }}
            onClick=${() => handleRemove(a.id)}>বাতিল</button>
        </div>`)}
      </div>
    </div>
  </div>`;
}

// মূল এক্সপোর্ট: প্রধান অ্যাডমিন ভিউ (ট্যাবসহ)
export function Teachers() {
  const [tab, setTab] = useState("teachers");
  const [users, setUsers] = useState([]);
  const [structure, setStructure] = useState([]);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    try {
      const uSnap = await getDocs(collection(db, "users"));
      const uList = uSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setUsers(uList);

      const sSnap = await getDoc(doc(db, "config", "structure"));
      setStructure(sSnap.exists() ? (sSnap.data().classes || []) : []);
      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  if (loading) return html`<p class="sub">তথ্য লোড হচ্ছে…</p>`;

  return html`<div>
    <div style=${{ display: "flex", gap: "8px", margin: "12px 0 16px" }}>
      <button class=${tab === "teachers" ? "" : "ghost"} style=${{ flex: 1, margin: 0 }} onClick=${() => setTab("teachers")}>
        শিক্ষক ও কর্মকর্তা (${toBn(users.length)})
      </button>
      <button class=${tab === "assignments" ? "" : "ghost"} style=${{ flex: 1, margin: 0 }} onClick=${() => setTab("assignments")}>
        শ্রেণি ও বিষয় বরাদ্দ
      </button>
    </div>

    ${tab === "teachers" && html`<${StaffList} users=${users} onRefresh=${loadData} />`}
    ${tab === "assignments" && html`<${Allocations} users=${users} structure=${structure} />`}
  </div>`;
}

// ৩. শিক্ষক ভিউ: আমার বরাদ্দ ("আমার বরাদ্দ" মেনুর জন্য)
export function MyAssignments({ profile }) {
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDoc(doc(db, "config", "assignments")).then(s => {
      const all = s.exists() ? (s.data().list || []) : [];
      // এই শিক্ষকের UID বা মোবাইল দিয়ে মিলানো
      const my = all.filter(a => a.teacherUid === auth.currentUser?.uid || a.teacherMobile === profile.mobile);
      setList(my);
      setLoading(false);
    }).catch(e => {
      console.error(e);
      setLoading(false);
    });
  }, [profile]);

  if (loading) return html`<p class="sub">আপনার বরাদ্দ তালিকা লোড হচ্ছে…</p>`;

  return html`<div>
    <p class="sub" style=${{ margin: "10px 0" }}>
      স্বাগতম <b>${profile.name}</b>! আপনি নিচের শ্রেণি ও বিষয়সমূহের দায়িত্বে রয়েছেন:
    </p>

    ${(!list || list.length === 0)
      ? html`<div class="card"><p>আপনাকে এখনো কোনো শ্রেণি বা বিষয় বরাদ্দ দেওয়া হয়নি। প্রধান অ্যাডমিনের সাথে যোগাযোগ করুন।</p></div>`
      : html`<div>
          <div class="grid" style=${{ marginTop: "10px" }}>
            ${list.map(a => html`<div class="card" key=${a.id} style=${{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <b style=${{ fontSize: "1.1rem" }}>${a.className}</b>
                <div style=${{ color: "var(--mute)", marginTop: "2px" }}>শাখা: <b>${a.section}</b></div>
                <div style=${{ color: "var(--acc)", fontWeight: 600, marginTop: "4px" }}>বিষয়: ${a.subject}</div>
              </div>
              <span class="role" style=${{ padding: "4px 12px" }}>বরাদ্দকৃত</span>
            </div>`)}
          </div>
          <p class="sub" style=${{ marginTop: "16px", fontSize: "0.9rem" }}>
            * পরীক্ষার নম্বর এন্ট্রি শুরু হলে আপনি সরাসরি এই বিষয়গুলোর শিক্ষার্থীদের নম্বর দিতে পারবেন।
          </p>
        </div>`}
  </div>`;
}
