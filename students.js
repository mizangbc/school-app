import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { db } from "./firebase.js";
import { doc, getDoc, getDocs, setDoc, collection, query, where, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const html = htm.bind(React.createElement);
const bn2en = s => String(s).replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
const digits = s => bn2en(s).replace(/\D/g, "");
const toBn = n => String(n).replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);

function newId() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = "";
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return "S" + new Date().getFullYear() + s;
}

function Form({ init, classId, section, rolls, onDone }) {
  const [f, setF] = useState({ name: init?.name || "", roll: init?.roll ?? "", dob: init?.dob || "", gm: init?.guardianMobile || "" });
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault(); setErr("");
    const roll = parseInt(digits(f.roll), 10), gm = digits(f.gm);
    if (!f.name.trim()) return setErr("নাম লিখুন।");
    if (!roll || roll < 1) return setErr("সঠিক রোল নম্বর দিন।");
    if (rolls.filter(r => r.id !== init?.sid).some(r => r.roll === roll)) return setErr(`রোল ${toBn(roll)} এই শাখায় আগেই আছে।`);
    if (gm && !/^01\d{9}$/.test(gm)) return setErr("অভিভাবকের মোবাইল ১১ সংখ্যার হতে হবে (বা ফাঁকা রাখুন)।");
    setBusy(true);
    try {
      const sid = init?.sid || newId();
      const data = { sid, name: f.name.trim(), roll, dob: f.dob, guardianMobile: gm, classId, section, updatedAt: serverTimestamp() };
      if (!init) data.createdAt = serverTimestamp();
      await setDoc(doc(db, "students", sid), data, { merge: true });
      onDone();
    } catch (x) { setErr("সংরক্ষণ হয়নি। ইন্টারনেট ও Rules দেখুন।"); setBusy(false); }
  }

  return html`<form class="card" onSubmit=${save} style=${{ marginTop: "14px" }}>
    ${init && html`<p class="sub" style=${{ margin: 0 }}>Student ID: <b>${init.sid}</b></p>`}
    <label>শিক্ষার্থীর নাম<input value=${f.name} onInput=${set("name")} /></label>
    <label>রোল নম্বর<input type="tel" inputMode="numeric" value=${f.roll} onInput=${set("roll")} /></label>
    <label>জন্মতারিখ<input type="date" value=${f.dob} onInput=${set("dob")} /></label>
    <label>অভিভাবকের মোবাইল (ঐচ্ছিক)<input type="tel" inputMode="numeric" value=${f.gm} onInput=${set("gm")} /></label>
    ${err && html`<p class="err">${err}</p>`}
    <button disabled=${busy}>${busy ? "অপেক্ষা করুন…" : "সংরক্ষণ করুন"}</button>
    <button type="button" class="ghost" style=${{ width: "100%", marginTop: "10px" }} onClick=${() => onDone(true)}>বাতিল</button>
  </form>`;
}

export function Students() {
  const [cls, setCls] = useState(null), [classId, setClassId] = useState(""), [section, setSection] = useState("");
  const [list, setList] = useState(null), [edit, setEdit] = useState(null), [note, setNote] = useState("");

  useEffect(() => {
    getDoc(doc(db, "config", "structure")).then(s => {
      const c = s.exists() ? s.data().classes : [];
      setCls(c);
      if (c[0]) { setClassId(c[0].id); setSection(c[0].sections[0]); }
    }).catch(() => setNote("লোড করা যায়নি।"));
  }, []);

  async function load(cid = classId, sec = section) {
    if (!cid || !sec) return;
    setList(null);
    try {
      const q = query(collection(db, "students"), where("classId", "==", cid), where("section", "==", sec));
      const snap = await getDocs(q);
      setList(snap.docs.map(d => d.data()).sort((a, b) => a.roll - b.roll));
    } catch (e) { setNote("তালিকা লোড হয়নি।"); setList([]); }
  }
  useEffect(() => { load(); }, [classId, section]);

  if (!cls) return html`<p class="sub">${note || "লোড হচ্ছে…"}</p>`;
  if (cls.length === 0) return html`<p class="sub">আগে "শ্রেণি, শাখা ও বিষয়" পাতা থেকে কাঠামো তৈরি করুন।</p>`;
  const cur = cls.find(c => c.id === classId);

  return html`<div>
    <label>শ্রেণি<select value=${classId} onChange=${e => { const c = cls.find(x => x.id === e.target.value); setEdit(null); setClassId(c.id); setSection(c.sections[0]); }}>
      ${cls.map(c => html`<option value=${c.id} key=${c.id}>${c.name}</option>`)}</select></label>
    <label>শাখা<select value=${section} onChange=${e => { setEdit(null); setSection(e.target.value); }}>
      ${cur.sections.map(s => html`<option key=${s}>${s}</option>`)}</select></label>
    ${edit !== null
      ? html`<${Form} key=${edit.sid || "new"} init=${edit.sid ? edit : null} classId=${classId} section=${section}
          rolls=${(list || []).map(s => ({ id: s.sid, roll: s.roll }))} onDone=${cancel => { setEdit(null); if (!cancel) load(); }} />`
      : html`<div>
        <button type="button" onClick=${() => setEdit({})}>+ নতুন শিক্ষার্থী</button>
        ${note && html`<p class="err">${note}</p>`}
        <p class="sub" style=${{ margin: "16px 0 6px" }}>${list ? `মোট ${toBn(list.length)} জন` : "লোড হচ্ছে…"}</p>
        <div class="grid" style=${{ marginTop: 0 }}>
          ${(list || []).map(s => html`<button class="go" key=${s.sid} onClick=${() => setEdit(s)}>
            <b>${toBn(s.roll)}. ${s.name}</b><span>সম্পাদনা</span></button>`)}
        </div></div>`}
  </div>`;
}
