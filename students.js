import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { db } from "./firebase.js";
import {
  doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch,
  collection, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const html = htm.bind(React.createElement);
const bn2en = s => String(s || "").replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
const digits = s => bn2en(s).replace(/\D/g, "");
const toBn = n => String(n ?? "").replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);

function cleanPhone(val) {
  let m = digits(val);
  if (m.startsWith("8801")) m = m.slice(2);
  return m;
}

function formatDob(val) {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  const dm = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dm) return `${dm[3]}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
  const ym = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ym) return `${ym[1]}-${ym[2].padStart(2, "0")}-${ym[3].padStart(2, "0")}`;
  return s;
}

function newId() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = "";
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return "S" + new Date().getFullYear() + s;
}

function downloadSample(className, sectionName) {
  const wsData = [
    ["রোল", "শিক্ষার্থীর নাম", "জন্মতারিখ (YYYY-MM-DD)", "অভিভাবকের মোবাইল"],
    [1, "আব্দুল্লাহ আল মামুন", "2018-01-15", "01711000000"],
    [2, "ফাতিমা আক্তার", "2018-03-22", "01811000000"],
    [3, "মোহাম্মদ রাফি", "2018-07-10", "01911000000"]
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [{ wch: 8 }, { wch: 28 }, { wch: 24 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws, "শিক্ষার্থী");
  const fileName = `শিক্ষার্থী_নমুনা_${className || "শ্রেণি"}_শাখা_${sectionName || "ক"}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

function Form({ init, classId, section, rolls, onDone, profile }) {
  const isAdmin = profile?.role === "main_admin" || profile?.role === "assistant_admin";
  const [f, setF] = useState({
    name: init?.name || "",
    roll: init?.roll ?? "",
    dob: init?.dob || "",
    gm: init?.guardianMobile || ""
  });
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault(); setErr("");
    const roll = parseInt(digits(f.roll), 10), gm = cleanPhone(f.gm);
    if (!f.name.trim()) return setErr("নাম লিখুন।");
    if (!roll || roll < 1) return setErr("সঠিক রোল নম্বর দিন।");
    if (rolls.filter(r => r.id !== init?.sid).some(r => r.roll === roll)) {
      return setErr(`রোল ${toBn(roll)} এই শাখায় আগেই আছে।`);
    }
    if (gm && !/^01\d{9}$/.test(gm)) return setErr("অভিভাবকের মোবাইল ১১ সংখ্যার হতে হবে (বা ফাঁকা রাখুন)।");
    setBusy(true);
    try {
      const sid = init?.sid || newId();
      const isNew = !init || !init.sid;
      const status = isAdmin ? "active" : (init?.status || "pending");
      const data = {
        sid,
        name: f.name.trim(),
        roll,
        dob: f.dob,
        guardianMobile: gm,
        classId,
        section,
        status,
        updatedAt: serverTimestamp()
      };
      if (isNew) {
        data.createdAt = serverTimestamp();
        data.addedBy = profile?.name || "সহকারী শিক্ষক";
        data.addedByRole = profile?.role || "teacher";
        data.addedByUid = profile?.uid || "";
      }
      if (isAdmin && init?.status === "pending") {
        data.status = "active";
        data.approvedBy = profile?.name || "প্রধান অ্যাডমিন";
        data.approvedAt = serverTimestamp();
      }
      await setDoc(doc(db, "students", sid), data, { merge: true });
      const msg = !isAdmin && isNew
        ? "নতুন শিক্ষার্থীর তথ্য যুক্ত হয়েছে। প্রধান অ্যাডমিন অনুমোদন করলে চূড়ান্ত তালিকায় সক্রিয় হবে।"
        : "শিক্ষার্থীর তথ্য সফলভাবে সংরক্ষিত হয়েছে।";
      onDone(false, msg);
    } catch (x) {
      console.error("Save student error:", x);
      if (x.code === "permission-denied") {
        setErr("Firebase Rules-এ অনুমতি নেই। Firebase Console থেকে Rules আপডেট ও Publish করুন।");
      } else {
        setErr("সংরক্ষণ হয়নি: " + (x.message || x.code || "ইন্টারনেট সংযোগ দেখুন"));
      }
      setBusy(false);
    }
  }

  async function remove() {
    if (!init || !init.sid) return;
    if (!confirm(`"${init.name}"-কে কি তালিকা থেকে স্থায়ীভাবে মুছে ফেলতে চান?`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, "students", init.sid));
      onDone(false, `"${init.name}"-কে মুছে ফেলা হয়েছে।`);
    } catch (x) {
      console.error("Delete student error:", x);
      setErr(x.code === "permission-denied"
        ? "Firebase Rules-এ অনুমতি নেই। Firebase Console থেকে Rules আপডেট করুন।"
        : "মুছে ফেলা যায়নি: " + (x.message || x.code));
      setBusy(false);
    }
  }

  return html`<form class="card" onSubmit=${save} style=${{ marginTop: "14px" }}>
    ${init && html`<p class="sub" style=${{ margin: 0 }}>Student ID: <b>${init.sid}</b></p>`}
    <label>শিক্ষার্থীর নাম<input value=${f.name} onInput=${set("name")} placeholder="যেমন: আব্দুল্লাহ আল মামুন" /></label>
    <label>রোল নম্বর<input type="tel" inputMode="numeric" value=${f.roll} onInput=${set("roll")} placeholder="যেমন: 1" /></label>
    <label>জন্মতারিখ<input type="date" value=${f.dob} onInput=${set("dob")} /></label>
    <label>অভিভাবকের মোবাইল (ঐচ্ছিক)<input type="tel" inputMode="numeric" value=${f.gm} onInput=${set("gm")} placeholder="যেমন: 01712345678" /></label>
    ${err && html`<p class="err">${err}</p>`}
    <button disabled=${busy}>${busy ? "অপেক্ষা করুন…" : (init ? "পরিবর্তন সংরক্ষণ করুন" : (isAdmin ? "শিক্ষার্থী যোগ করুন" : "শিক্ষার্থী যোগ করুন (অনুমোদনের জন্য)"))}</button>
    ${init && html`<button type="button" class="danger" style=${{ width: "100%", marginTop: "10px" }}
      disabled=${busy} onClick=${remove}>এই শিক্ষার্থীকে বাদ দিন</button>`}
    <button type="button" class="ghost" style=${{ width: "100%", marginTop: "10px" }} onClick=${() => onDone(true)}>বাতিল</button>
  </form>`;
}

function ExcelUpload({ classId, section, className, existingRolls, onDone, profile }) {
  const isAdmin = profile?.role === "main_admin" || profile?.role === "assistant_admin";
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");

  function onFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setErr("");
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const data = new Uint8Array(evt.target.result);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
        if (!raw || raw.length === 0) return setErr("ফাইলটি খালি।");

        // হেডার শনাক্তকরণ
        let headerIdx = -1;
        let colRoll = 0, colName = 1, colDob = 2, colMobile = 3;
        for (let i = 0; i < Math.min(raw.length, 6); i++) {
          const row = (raw[i] || []).map(x => String(x || "").trim().toLowerCase());
          const hasName = row.some(c => c.includes("নাম") || c.includes("name"));
          const hasRoll = row.some(c => c.includes("রোল") || c.includes("roll") || c.includes("ক্রমিক") || c.includes("sl"));
          if (hasName || hasRoll) {
            headerIdx = i;
            row.forEach((col, idx) => {
              if (col.includes("রোল") || col.includes("roll") || col.includes("ক্রমিক") || col.includes("sl")) colRoll = idx;
              else if (col.includes("নাম") || col.includes("name")) colName = idx;
              else if (col.includes("জন্ম") || col.includes("dob") || col.includes("birth")) colDob = idx;
              else if (col.includes("মোবাইল") || col.includes("ফোন") || col.includes("mobile") || col.includes("phone")) colMobile = idx;
            });
            break;
          }
        }

        const dataRows = raw.slice(headerIdx + 1);
        const seenRollsInFile = new Set();
        const parsed = [];

        for (let i = 0; i < dataRows.length; i++) {
          const r = dataRows[i];
          if (!r || r.length === 0 || r.every(c => c === "" || c == null)) continue;
          const roll = parseInt(digits(r[colRoll]), 10);
          const name = String(r[colName] || "").trim();
          const dob = formatDob(r[colDob]);
          const mobile = cleanPhone(r[colMobile]);

          let error = null;
          if (!name) {
            error = "নাম নেই";
          } else if (!roll || roll < 1) {
            error = "সঠিক রোল নেই";
          } else if (seenRollsInFile.has(roll)) {
            error = `ফাইলে রোল ${toBn(roll)} একাধিকবার আছে`;
          } else if (existingRolls.includes(roll)) {
            error = `রোল ${toBn(roll)} শাখায় আগেই আছে`;
          } else if (mobile && !/^01\d{9}$/.test(mobile)) {
            error = "মোবাইল নম্বর ১১ সংখ্যার হতে হবে";
          }

          if (roll) seenRollsInFile.add(roll);
          parsed.push({
            rowNum: i + (headerIdx + 2),
            roll: roll || "",
            name,
            dob,
            guardianMobile: mobile,
            error,
            valid: !error
          });
        }

        if (parsed.length === 0) return setErr("ফাইলে কোনো শিক্ষার্থীর তথ্য পাওয়া যায়নি।");
        const validCount = parsed.filter(p => p.valid).length;
        const errorCount = parsed.length - validCount;
        setStats({ total: parsed.length, valid: validCount, errors: errorCount });
        setItems(parsed);
      } catch (ex) {
        console.error(ex);
        setErr("Excel ফাইলটি পড়া যায়নি। ফাইলের ফরম্যাট ঠিক আছে কি না দেখুন।");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function uploadValid() {
    const validItems = items.filter(i => i.valid);
    if (validItems.length === 0) return setErr("আপলোড করার মতো কোনো সঠিক রেকর্ড নেই।");
    setBusy(true);
    setErr("");
    try {
      for (let i = 0; i < validItems.length; i += 400) {
        const chunk = validItems.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach(st => {
          const sid = newId();
          const ref = doc(db, "students", sid);
          batch.set(ref, {
            sid,
            name: st.name,
            roll: st.roll,
            dob: st.dob,
            guardianMobile: st.guardianMobile,
            classId,
            section,
            status: isAdmin ? "active" : "pending",
            addedBy: profile?.name || "সহকারী শিক্ষক",
            addedByRole: profile?.role || "teacher",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });
        await batch.commit();
      }
      const msg = !isAdmin
        ? `${toBn(validItems.length)} জন শিক্ষার্থীর তথ্য আপলোড করা হয়েছে। প্রধান অ্যাডমিন অনুমোদন করলে চূড়ান্ত তালিকায় অন্তর্ভুক্ত হবে।`
        : `${toBn(validItems.length)} জন শিক্ষার্থীর তালিকা সফলভাবে আপলোড সম্পন্ন হয়েছে।`;
      onDone(false, msg);
    } catch (ex) {
      console.error("Excel upload error:", ex);
      setErr(ex.code === "permission-denied"
        ? "Firebase Rules-এ অনুমতি নেই। Firebase Console থেকে Rules আপডেট ও Publish করুন।"
        : "সংরক্ষণ করা যায়নি: " + (ex.message || ex.code));
      setBusy(false);
    }
  }

  return html`<div class="card" style=${{ marginTop: "14px" }}>
    <h3 style=${{ margin: "0 0 10px", fontSize: "1.1rem" }}>Excel ফাইল থেকে বাল্ক আপলোড</h3>
    <p class="sub" style=${{ margin: "0 0 12px" }}>
      শ্রেণি: <b>${className}</b> | শাখা: <b>${section}</b>
    </p>

    <label style=${{ marginTop: 0 }}>Excel বা CSV ফাইল নির্বাচন করুন
      <input type="file" accept=".xlsx, .xls, .csv" onChange=${onFileChange} style=${{ marginTop: "6px" }} />
    </label>

    ${stats && html`<div style=${{ margin: "14px 0", padding: "10px 14px", background: "var(--bg)", borderRadius: "8px" }}>
      <div>মোট রেকর্ড: <b>${toBn(stats.total)}</b> জন</div>
      <div style=${{ color: "var(--acc)", fontWeight: 600 }}>সঠিক ও আপলোডযোগ্য: ${toBn(stats.valid)} জন</div>
      ${stats.errors > 0 && html`<div style=${{ color: "var(--err)", fontWeight: 600 }}>সমস্যাযুক্ত (বাদ যাবে): ${toBn(stats.errors)} জন</div>`}
    </div>`}

    ${items.length > 0 && html`<div style=${{ maxHeight: "280px", overflowY: "auto", border: "1px solid var(--line)", borderRadius: "8px", padding: "6px 10px", margin: "10px 0" }}>
      ${items.map(it => html`<div key=${it.rowNum} style=${{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "6px 0", borderBottom: "1px dashed var(--line)",
        color: it.valid ? "var(--ink)" : "var(--err)"
      }}>
        <div>
          <b>${it.roll ? toBn(it.roll) + ". " : ""}${it.name || "নামহীন"}</b>
          ${it.guardianMobile && html`<span style=${{ fontSize: "0.85rem", color: "var(--mute)", marginLeft: "6px" }}>(${it.guardianMobile})</span>`}
        </div>
        <div>
          ${it.valid
            ? html`<span style=${{ color: "var(--acc)", fontSize: "0.85rem", fontWeight: 600 }}>সঠিক</span>`
            : html`<span style=${{ color: "var(--err)", fontSize: "0.85rem", fontWeight: 600 }}>${it.error}</span>`}
        </div>
      </div>`)}
    </div>`}

    ${err && html`<p class="err">${err}</p>`}

    ${stats && stats.valid > 0 && html`<button disabled=${busy} onClick=${uploadValid}>
      ${busy ? "আপলোড হচ্ছে…" : `${toBn(stats.valid)} জন শিক্ষার্থীর তালিকা আপলোড করুন`}
    </button>`}

    <button type="button" class="ghost" style=${{ width: "100%", marginTop: "10px" }} onClick=${() => onDone(true)}>বাতিল</button>
  </div>`;
}

export function Students({ profile }) {
  const isAdmin = profile?.role === "main_admin" || profile?.role === "assistant_admin";
  const [cls, setCls] = useState(null), [classId, setClassId] = useState(""), [section, setSection] = useState("");
  const [list, setList] = useState(null), [edit, setEdit] = useState(null), [showUpload, setShowUpload] = useState(false);
  const [note, setNote] = useState("");
  const [infoMsg, setInfoMsg] = useState("");
  const [pendingList, setPendingList] = useState([]);
  const [pendingBusy, setPendingBusy] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "config", "structure")).then(s => {
      const c = s.exists() ? s.data().classes : [];
      setCls(c);
      if (c[0]) { setClassId(c[0].id); setSection(c[0].sections[0]); }
    }).catch(() => setNote("কাঠামো লোড করা যায়নি।"));
    loadPending();
  }, []);

  async function loadPending() {
    try {
      const q = query(collection(db, "students"), where("status", "==", "pending"));
      const snap = await getDocs(q);
      setPendingList(snap.docs.map(d => d.data()).sort((a, b) => (a.classId || "").localeCompare(b.classId || "") || a.roll - b.roll));
    } catch (e) {
      console.error("loadPending err:", e);
    }
  }

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

  async function approveStudent(sid) {
    setPendingBusy(true);
    setInfoMsg("");
    try {
      await setDoc(doc(db, "students", sid), {
        status: "active",
        approvedBy: profile?.name || "প্রধান অ্যাডমিন",
        approvedAt: serverTimestamp()
      }, { merge: true });
      setInfoMsg("শিক্ষার্থী সফলভাবে অনুমোদিত হয়েছে।");
      loadPending();
      load();
    } catch (e) {
      alert("অনুমোদন করা যায়নি: " + (e.message || e.code));
    }
    setPendingBusy(false);
  }

  async function approveAllPending() {
    if (pendingList.length === 0) return;
    if (!confirm(`আপনি কি অপেক্ষমাণ সকল (${toBn(pendingList.length)}) শিক্ষার্থীর ভর্তি অনুমোদন করতে চান?`)) return;
    setPendingBusy(true);
    setInfoMsg("");
    try {
      for (let i = 0; i < pendingList.length; i += 400) {
        const chunk = pendingList.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach(st => {
          batch.set(doc(db, "students", st.sid), {
            status: "active",
            approvedBy: profile?.name || "প্রধান অ্যাডমিন",
            approvedAt: serverTimestamp()
          }, { merge: true });
        });
        await batch.commit();
      }
      setInfoMsg("অপেক্ষমাণ সকল শিক্ষার্থীর ভর্তি সফলভাবে অনুমোদিত হয়েছে।");
      loadPending();
      load();
    } catch (e) {
      alert("অনুমোদন করা যায়নি: " + (e.message || e.code));
    }
    setPendingBusy(false);
  }

  async function rejectStudent(st) {
    if (!confirm(`"${st.name}"-কে কি তালিকা থেকে বাতিল ও স্থায়ীভাবে মুছে ফেলতে চান?`)) return;
    setPendingBusy(true);
    setInfoMsg("");
    try {
      await deleteDoc(doc(db, "students", st.sid));
      setInfoMsg(`"${st.name}" বাতিল ও মুছে ফেলা হয়েছে।`);
      loadPending();
      load();
    } catch (e) {
      alert("মুছে ফেলা যায়নি: " + (e.message || e.code));
    }
    setPendingBusy(false);
  }

  if (!cls) return html`<p class="sub">${note || "লোড হচ্ছে…"}</p>`;
  if (cls.length === 0) return html`<p class="sub">আগে "শ্রেণি, শাখা ও বিষয়" পাতা থেকে কাঠামো তৈরি করুন।</p>`;
  const cur = cls.find(c => c.id === classId);

  return html`<div>
    ${!isAdmin && html`<div style=${{
      background: "#e8f5e9", border: "1px solid #c8e6c9", borderRadius: "8px",
      padding: "10px 14px", marginBottom: "14px", fontSize: "0.88rem", color: "#2e7d32"
    }}>
      💡 <b>শিক্ষক প্যানেল:</b> আপনি যেকোনো শ্রেণিতে নতুন শিক্ষার্থী ভর্তি বা Excel আপলোড করতে পারবেন। নতুন শিক্ষার্থী যুক্ত করার পর প্রধান অ্যাডমিন তা অনুমোদন করবেন।
    </div>`}

    ${infoMsg && html`<p class="ok" style=${{ marginBottom: "12px" }}>${infoMsg}</p>`}

    <!-- অ্যাডমিন অনুমোদন প্যানেল (অপেক্ষমাণ শিক্ষার্থী থাকলে) -->
    ${isAdmin && pendingList.length > 0 && html`<div class="card" style=${{
      background: "#fffdf0", border: "1.5px solid #f6c026", borderRadius: "8px",
      padding: "12px 14px", marginBottom: "16px"
    }}>
      <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", borderBottom: "1px dashed #f6c026", paddingBottom: "10px", marginBottom: "10px" }}>
        <div>
          <b style=${{ color: "#856404", fontSize: "0.98rem" }}>⏳ অনুমোদনের অপেক্ষায় নতুন শিক্ষার্থী (${toBn(pendingList.length)} জন)</b>
          <div style=${{ fontSize: "0.82rem", color: "#666", marginTop: "2px" }}>শিক্ষকগণের মাধ্যমে যুক্ত করা শিক্ষার্থীদের তথ্য যাচাই করে অনুমোদন দিন।</div>
        </div>
        <button type="button" disabled=${pendingBusy} onClick=${approveAllPending}
          style=${{ width: "auto", margin: 0, padding: "6px 14px", fontSize: "0.85rem", background: "var(--acc)", color: "#fff", fontWeight: 700 }}>
          ✓ সব অনুমোদন করুন
        </button>
      </div>

      <div style=${{ display: "grid", gap: "8px" }}>
        ${pendingList.map(st => {
          const cName = cls?.find(c => c.id === st.classId)?.name || st.classId;
          return html`<div key=${st.sid} style=${{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: "#fff", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ecd99f",
            flexWrap: "wrap", gap: "8px"
          }}>
            <div>
              <b style=${{ fontSize: "0.95rem" }}>${toBn(st.roll)}. ${st.name}</b>
              <span style=${{ marginLeft: "6px", fontSize: "0.82rem", color: "var(--mute)" }}>
                [শ্রেণি: ${cName}, শাখা: ${st.section}]
              </span>
              <div style=${{ fontSize: "0.8rem", color: "#555", marginTop: "2px" }}>
                যুক্ত করেছেন: <b>${st.addedBy || "শিক্ষক"}</b> • মোবাইল: ${st.guardianMobile || "-"} • জন্ম: ${st.dob || "-"}
              </div>
            </div>
            <div style=${{ display: "flex", gap: "6px" }}>
              <button type="button" disabled=${pendingBusy} onClick=${() => approveStudent(st.sid)}
                style=${{ width: "auto", margin: 0, padding: "5px 12px", fontSize: "0.82rem", background: "var(--acc)", color: "#fff", fontWeight: 600 }}>
                ✓ অনুমোদন
              </button>
              <button type="button" class="ghost" onClick=${() => {
                setClassId(st.classId);
                setSection(st.section);
                setEdit(st);
              }} style=${{ width: "auto", margin: 0, padding: "5px 10px", fontSize: "0.82rem" }}>
                ✏️ সম্পাদনা
              </button>
              <button type="button" class="danger" disabled=${pendingBusy} onClick=${() => rejectStudent(st)}
                style=${{ width: "auto", margin: 0, padding: "5px 10px", fontSize: "0.82rem" }}>
                ✕ বাতিল
              </button>
            </div>
          </div>`;
        })}
      </div>
    </div>`}

    <label>শ্রেণি<select value=${classId} onChange=${e => {
      const c = cls.find(x => x.id === e.target.value);
      setEdit(null); setShowUpload(false);
      setClassId(c.id); setSection(c.sections[0]);
    }}>
      ${cls.map(c => html`<option value=${c.id} key=${c.id}>${c.name}</option>`)}</select></label>
    <label>শাখা<select value=${section} onChange=${e => {
      setEdit(null); setShowUpload(false);
      setSection(e.target.value);
    }}>
      ${cur.sections.map(s => html`<option key=${s}>${s}</option>`)}</select></label>

    ${edit !== null
      ? html`<${Form} key=${edit.sid || "new"} init=${edit.sid ? edit : null} classId=${classId} section=${section}
          rolls=${(list || []).map(s => ({ id: s.sid, roll: s.roll }))}
          profile=${profile}
          onDone=${(cancel, msg) => {
            setEdit(null);
            if (msg) setInfoMsg(msg);
            if (!cancel) { load(); loadPending(); }
          }} />`
      : showUpload
        ? html`<${ExcelUpload} classId=${classId} section=${section} className=${cur.name}
            existingRolls=${(list || []).map(s => s.roll)}
            profile=${profile}
            onDone=${(cancel, msg) => {
              setShowUpload(false);
              if (msg) setInfoMsg(msg);
              if (!cancel) { load(); loadPending(); }
            }} />`
        : html`<div>
            <div style=${{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
              <button type="button" style=${{ flex: "1 1 140px", margin: 0 }} onClick=${() => { setEdit({}); setInfoMsg(""); }}>
                + নতুন শিক্ষার্থী ভর্তি
              </button>
              <button type="button" class="ghost" style=${{ flex: "1 1 140px", margin: 0 }} onClick=${() => { setShowUpload(true); setInfoMsg(""); }}>
                📁 Excel আপলোড
              </button>
              <button type="button" class="ghost" style=${{ flex: "1 1 100%", margin: 0 }} onClick=${() => downloadSample(cur?.name, section)}>
                📥 নমুনা Excel ডাউনলোড
              </button>
            </div>
            ${note && html`<p class="err">${note}</p>`}
            <p class="sub" style=${{ margin: "16px 0 6px" }}>
              ${list ? `মোট ${toBn(list.length)} জন শিক্ষার্থী` : "লোড হচ্ছে…"}
            </p>
            <div class="grid" style=${{ marginTop: 0 }}>
              ${(list || []).map(s => {
                const isPending = s.status === "pending";
                return html`<div key=${s.sid} style=${{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 14px", border: "1px solid var(--line)", borderRadius: "8px",
                  background: isPending ? "#fffdf5" : "#fff", marginBottom: "8px",
                  borderLeft: isPending ? "4px solid #f6c026" : "1px solid var(--line)"
                }}>
                  <div>
                    <b>${toBn(s.roll)}. ${s.name}</b>
                    ${isPending
                      ? html`<span style=${{ background: "#fff3cd", color: "#856404", fontSize: "0.75rem", padding: "2px 8px", borderRadius: "10px", fontWeight: 700, marginLeft: "8px" }}>
                          ⏳ অনুমোদনের অপেক্ষায় (${s.addedBy || "শিক্ষক"})
                        </span>`
                      : html`<span style=${{ color: "var(--acc)", fontSize: "0.78rem", fontWeight: 600, marginLeft: "8px" }}>
                          ✓ অনুমোদিত
                        </span>`}
                    ${s.guardianMobile && html`<div style=${{ fontSize: "0.8rem", color: "var(--mute)", marginTop: "2px" }}>মোবাইল: ${s.guardianMobile}</div>`}
                  </div>
                  <div style=${{ display: "flex", gap: "6px" }}>
                    ${isAdmin && isPending && html`<button type="button" onClick=${() => approveStudent(s.sid)}
                      style=${{ width: "auto", margin: 0, padding: "5px 12px", fontSize: "0.8rem", background: "var(--acc)", color: "#fff", fontWeight: 600 }}>
                      ✓ অনুমোদন
                    </button>`}
                    <button type="button" class="ghost" onClick=${() => setEdit(s)}
                      style=${{ width: "auto", margin: 0, padding: "5px 10px", fontSize: "0.8rem" }}>
                      সম্পাদনা
                    </button>
                  </div>
                </div>`;
              })}
            </div>
          </div>`}
  </div>`;
}
