import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { db } from "./firebase.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const html = htm.bind(React.createElement);

function defaults() {
  const core = ["বাংলা", "ইংরেজি", "গণিত"], rel = "ধর্ম ও নৈতিক শিক্ষা";
  const mk = (i, name, n, subjects) => ({ id: "c" + i, name, sections: ["ক", "খ", "গ"].slice(0, n), subjects });
  const up = [...core, "প্রাথমিক বিজ্ঞান", "বাংলাদেশ ও বিশ্বপরিচয়", rel];
  return [
    mk(0, "প্রাক-প্রাথমিক", 2, [...core]),
    mk(1, "প্রথম", 3, [...core, rel]), mk(2, "দ্বিতীয়", 3, [...core, rel]),
    mk(3, "তৃতীয়", 3, [...up]), mk(4, "চতুর্থ", 3, [...up]), mk(5, "পঞ্চম", 3, [...up])
  ];
}

function Tags({ items, onChange, ph }) {
  const [v, setV] = useState("");
  const add = () => { const t = v.trim(); if (t && !items.includes(t)) onChange([...items, t]); setV(""); };
  return html`<div>
    <div class="chips">${items.map(x => html`<span class="chip" key=${x}>${x}<b onClick=${() => onChange(items.filter(i => i !== x))}>×</b></span>`)}</div>
    <div class="addrow">
      <input value=${v} placeholder=${ph} onInput=${e => setV(e.target.value)}
        onKeyDown=${e => e.key === "Enter" && (e.preventDefault(), add())} />
      <button type="button" class="ghost" onClick=${add}>যোগ</button>
    </div>
  </div>`;
}

export function Structure() {
  const [cls, setCls] = useState(null), [note, setNote] = useState(""), [ok, setOk] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    getDoc(doc(db, "config", "structure"))
      .then(s => setCls(s.exists() ? s.data().classes : []))
      .catch(() => setNote("লোড করা যায়নি। ইন্টারনেট ও Rules দেখুন।"));
  }, []);
  const upd = (i, patch) => { setOk(false); setCls(cls.map((c, j) => j === i ? { ...c, ...patch } : c)); };

  async function save() {
    setNote(""); setOk(false);
    if (cls.some(c => !c.name.trim())) return setNote("প্রতিটি শ্রেণির নাম লিখুন।");
    if (cls.some(c => c.sections.length === 0)) return setNote("প্রতিটি শ্রেণিতে অন্তত একটি শাখা দিন।");
    setBusy(true);
    try { await setDoc(doc(db, "config", "structure"), { classes: cls, updatedAt: serverTimestamp() }); setOk(true); }
    catch (e) { setNote("সংরক্ষণ হয়নি। ইন্টারনেট ও Rules দেখুন।"); }
    setBusy(false);
  }

  if (!cls) return html`<p class="sub">${note || "লোড হচ্ছে…"}</p>`;
  return html`<div>
    ${cls.length === 0 && html`<p class="sub">এখনো কোনো শ্রেণি নেই। ডিফল্ট কাঠামো বসিয়ে প্রয়োজনমতো বদলান।</p>
      <button type="button" onClick=${() => setCls(defaults())}>ডিফল্ট কাঠামো বসান</button>`}
    ${cls.map((c, i) => html`<div class="card cls" key=${c.id}>
      <label>শ্রেণির নাম<input value=${c.name} onInput=${e => upd(i, { name: e.target.value })} /></label>
      <label>শাখা</label>
      <${Tags} items=${c.sections} ph="নতুন শাখার নাম" onChange=${v => upd(i, { sections: v })} />
      <label>বিষয়</label>
      <${Tags} items=${c.subjects} ph="নতুন বিষয়ের নাম" onChange=${v => upd(i, { subjects: v })} />
      <button type="button" class="danger" onClick=${() => confirm(`"${c.name}" শ্রেণিটি বাদ দেবেন?`) && (setOk(false), setCls(cls.filter((_, j) => j !== i)))}>এই শ্রেণি বাদ দিন</button>
    </div>`)}
    <button type="button" class="ghost" style=${{ marginTop: "14px", width: "100%" }}
      onClick=${() => { setOk(false); setCls([...cls, { id: "c" + Date.now(), name: "", sections: ["ক"], subjects: [] }]); }}>+ নতুন শ্রেণি</button>
    ${note && html`<p class="err">${note}</p>`}
    ${ok && html`<p class="ok">সংরক্ষণ হয়েছে।</p>`}
    ${cls.length > 0 && html`<button type="button" disabled=${busy} onClick=${save}>${busy ? "সংরক্ষণ হচ্ছে…" : "সংরক্ষণ করুন"}</button>`}
  </div>`;
}
