import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { auth, db } from "./firebase.js";
import {
  doc, getDoc, getDocs, setDoc, collection, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { defaultExamConfig } from "./exams.js";

const html = htm.bind(React.createElement);
const bn2en = s => String(s || "").replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
const digits = s => bn2en(s).replace(/\D/g, "");
const toBn = n => String(n ?? "").replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);

// নম্বরের ভিত্তিতে অর্জিত গ্রেড বা মান নির্ণয়
export function calculateGrade(score, gradingList) {
  if (score == null || isNaN(score) || score === "") return { grade: "-", gpa: 0 };
  const s = Number(score);
  for (const g of gradingList) {
    if (s >= g.min && s <= g.max) {
      return { grade: g.grade, gpa: g.gpa, remark: g.remark || "" };
    }
  }
  return { grade: "-", gpa: 0 };
}

// মূল কম্পোনেন্ট: শিক্ষকদের জন্য নম্বর এন্ট্রি
export function MarksEntry({ profile }) {
  const [examConfig, setExamConfig] = useState(null);
  const [structure, setStructure] = useState([]);
  const [myAssignments, setMyAssignments] = useState([]);
  const [loading, setLoading] = useState(true);

  // সিলেকশন স্টেট
  const [examId, setExamId] = useState("");
  const [classId, setClassId] = useState("");
  const [section, setSection] = useState("");
  const [subject, setSubject] = useState("");

  // শিক্ষার্থী ও নম্বর ডাটা
  const [students, setStudents] = useState([]);
  const [marksDoc, setMarksDoc] = useState(null);
  const [scores, setScores] = useState({}); // { [sid]: { continuous, written, isAbsent } }
  const [syncStatus, setSyncStatus] = useState("synced"); // 'synced' | 'saving' | 'dirty'
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const isAdmin = profile.role === "main_admin" || profile.role === "assistant_admin";

  // ১. প্রাথমিক ডাটা লোড
  useEffect(() => {
    async function init() {
      try {
        const [eSnap, sSnap, aSnap] = await Promise.all([
          getDoc(doc(db, "config", "exams")),
          getDoc(doc(db, "config", "structure")),
          getDoc(doc(db, "config", "assignments"))
        ]);

        const eData = eSnap.exists() ? eSnap.data() : defaultExamConfig();
        setExamConfig(eData);
        if (eData.terminals && eData.terminals[0]) {
          setExamId(eData.terminals[0].id);
        }

        const sData = sSnap.exists() ? (sSnap.data().classes || []) : [];
        setStructure(sData);

        const aList = aSnap.exists() ? (aSnap.data().list || []) : [];
        if (isAdmin) {
          setMyAssignments(aList);
          if (sData[0]) {
            setClassId(sData[0].id);
            setSection(sData[0].sections[0] || "");
            setSubject(sData[0].subjects[0] || "");
          }
        } else {
          const my = aList.filter(a => a.teacherUid === auth.currentUser?.uid || a.teacherMobile === profile.mobile);
          setMyAssignments(my);
          if (my[0]) {
            setClassId(my[0].classId);
            setSection(my[0].section);
            setSubject(my[0].subject);
          }
        }
        setLoading(false);
      } catch (ex) {
        console.error(ex);
        setErr("প্রয়োজনীয় তথ্য লোড করা যায়নি।");
        setLoading(false);
      }
    }
    init();
  }, [profile]);

  // ২. শিক্ষার্থী ও নম্বর তালিকা লোড
  async function loadMarksheet() {
    if (!examId || !classId || !section || !subject) return;
    setNote("");
    setErr("");
    try {
      // শিক্ষার্থী লোড
      const q = query(collection(db, "students"), where("classId", "==", classId), where("section", "==", section));
      const stuSnap = await getDocs(q);
      const stuList = stuSnap.docs.map(d => d.data()).sort((a, b) => a.roll - b.roll);
      setStudents(stuList);

      // বিদ্যমান নম্বর ডকুমেন্ট লোড
      const docId = `${examId}_${classId}_${section}_${subject}`;
      const mSnap = await getDoc(doc(db, "marks", docId));
      if (mSnap.exists()) {
        const mData = mSnap.data();
        setMarksDoc(mData);
        setScores(mData.records || {});
      } else {
        setMarksDoc({ id: docId, status: "draft" });
        // ডিফল্ট খালি অবজেক্ট
        const initScores = {};
        stuList.forEach(s => {
          initScores[s.sid] = { continuous: "", written: "", isAbsent: false };
        });
        setScores(initScores);
      }
      setSyncStatus("synced");
    } catch (ex) {
      console.error(ex);
      setErr("নম্বর তালিকা লোড করা যায়নি।");
    }
  }

  useEffect(() => {
    loadMarksheet();
  }, [examId, classId, section, subject]);

  // ইনপুট হ্যান্ডলার
  function handleScoreChange(sid, field, val) {
    if (marksDoc && marksDoc.status === "approved") return;
    const cur = scores[sid] || { continuous: "", written: "", isAbsent: false };
    const updated = {
      ...scores,
      [sid]: { ...cur, [field]: val }
    };
    setScores(updated);
    setSyncStatus("dirty");
  }

  function handleAbsentToggle(sid, isAbsent) {
    if (marksDoc && marksDoc.status === "approved") return;
    const cur = scores[sid] || { continuous: "", written: "", isAbsent: false };
    const updated = {
      ...scores,
      [sid]: {
        ...cur,
        isAbsent,
        continuous: isAbsent ? "" : cur.continuous,
        written: isAbsent ? "" : cur.written
      }
    };
    setScores(updated);
    setSyncStatus("dirty");
  }

  // ড্রাফট সংরক্ষণ (Auto / Manual Save)
  async function saveMarks(newStatus = "draft") {
    setErr("");
    setNote("");
    setBusy(true);
    setSyncStatus("saving");

    const ratio = examConfig?.assessmentRatio || { continuous: 30, written: 70 };
    const grading = examConfig?.grading || [];
    const docId = `${examId}_${classId}_${section}_${subject}`;
    const curClass = structure.find(c => c.id === classId);

    // ক্যালকুলেটেড ডাটা প্রস্তুতকরণ
    const finalRecords = {};
    students.forEach(s => {
      const rec = scores[s.sid] || { continuous: "", written: "", isAbsent: false };
      const cont = rec.isAbsent ? 0 : (parseFloat(bn2en(rec.continuous)) || 0);
      const writ = rec.isAbsent ? 0 : (parseFloat(bn2en(rec.written)) || 0);
      const total = rec.isAbsent ? 0 : Math.round((cont + writ) * 10) / 10;
      const { grade, gpa } = rec.isAbsent ? { grade: "অনুপস্থিত", gpa: 0 } : calculateGrade(total, grading);

      finalRecords[s.sid] = {
        sid: s.sid,
        roll: s.roll,
        name: s.name,
        continuous: rec.isAbsent ? "" : rec.continuous,
        written: rec.isAbsent ? "" : rec.written,
        isAbsent: Boolean(rec.isAbsent),
        total: rec.isAbsent ? "অনুপস্থিত" : total,
        grade,
        gpa
      };
    });

    try {
      const payload = {
        id: docId,
        examId,
        classId,
        className: curClass ? curClass.name : "",
        section,
        subject,
        status: newStatus,
        ratio,
        records: finalRecords,
        updatedBy: profile.name,
        updatedAt: serverTimestamp()
      };
      if (newStatus === "submitted") {
        payload.submittedAt = serverTimestamp();
      }

      await setDoc(doc(db, "marks", docId), payload, { merge: true });
      setMarksDoc({ ...payload, status: newStatus });
      setSyncStatus("synced");
      setNote(newStatus === "submitted"
        ? "নম্বর যাচাই ও অনুমোদনের জন্য সফলভাবে জমা দেওয়া হয়েছে।"
        : "ড্রাফট সফলভাবে ক্লাউডে সংরক্ষিত হয়েছে।");
    } catch (ex) {
      console.error(ex);
      setSyncStatus("dirty");
      setErr("সংরক্ষণ করা যায়নি। ইন্টারনেট ও Rules দেখুন।");
    }
    setBusy(false);
  }

  // যাচাইয়ের জন্য ফাইনাল সাবমিট
  function handleSubmitForVerification() {
    // অসম্পূর্ণ এন্ট্রি চেক
    let incomplete = 0;
    students.forEach(s => {
      const rec = scores[s.sid];
      if (!rec || (!rec.isAbsent && (rec.continuous === "" || rec.written === ""))) {
        incomplete++;
      }
    });

    if (incomplete > 0) {
      if (!confirm(`${toBn(incomplete)} জন শিক্ষার্থীর নম্বর এখনো অসম্পূর্ণ রয়েছে। আপনি কি এভাবে জমা দিতে চান?`)) {
        return;
      }
    } else {
      if (!confirm("আপনি কি নিশ্চিত যে এই বিষয়ের নম্বর জমা দিতে চান? জমা দেওয়ার পর ফলাফল যাচাইকারী অনুমোদন করবেন।")) {
        return;
      }
    }
    saveMarks("submitted");
  }

  if (loading) return html`<p class="sub">নম্বর এন্ট্রি লোড হচ্ছে…</p>`;

  if (!isAdmin && myAssignments.length === 0) {
    return html`<div class="card" style=${{ marginTop: "14px" }}>
      <p>আপনাকে এখনো কোনো শ্রেণি বা বিষয় বরাদ্দ দেওয়া হয়নি।</p>
      <p class="sub">প্রধান অ্যাডমিন বিষয় বরাদ্দ দিলে আপনি নম্বর দিতে পারবেন।</p>
    </div>`;
  }

  const curClass = structure.find(c => c.id === classId) || structure[0];
  const maxContinuous = examConfig?.assessmentRatio?.continuous ?? 30;
  const maxWritten = examConfig?.assessmentRatio?.written ?? 70;
  const isLocked = marksDoc?.status === "submitted" || marksDoc?.status === "approved";

  return html`<div style=${{ marginTop: "14px" }}>
    <!-- ফিল্টার ও সিলেকশন হেডার -->
    <div class="card" style=${{ marginBottom: "14px" }}>
      <label style=${{ marginTop: 0 }}>পরীক্ষা নির্বাচন করুন
        <select value=${examId} onChange=${e => setExamId(e.target.value)}
          style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
          ${(examConfig?.terminals || []).map(t => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
        </select>
      </label>

      ${isAdmin
        ? html`<div style=${{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}>
            <div>
              <label style=${{ margin: "0 0 4px" }}>শ্রেণি</label>
              <select value=${classId} onChange=${e => {
                const cid = e.target.value; setClassId(cid);
                const cl = structure.find(c => c.id === cid);
                if (cl) { setSection(cl.sections[0] || ""); setSubject(cl.subjects[0] || ""); }
              }} style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                ${structure.map(c => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}
              </select>
            </div>
            <div>
              <label style=${{ margin: "0 0 4px" }}>শাখা</label>
              <select value=${section} onChange=${e => setSection(e.target.value)}
                style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                ${(curClass?.sections || []).map(s => html`<option key=${s} value=${s}>${s}</option>`)}
              </select>
            </div>
            <div style=${{ gridColumn: "span 2" }}>
              <label style=${{ margin: "0 0 4px" }}>বিষয়</label>
              <select value=${subject} onChange=${e => setSubject(e.target.value)}
                style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                ${(curClass?.subjects || []).map(sub => html`<option key=${sub} value=${sub}>${sub}</option>`)}
              </select>
            </div>
          </div>`
        : html`<label style=${{ marginTop: "10px" }}>আমার বরাদ্দকৃত বিষয়
            <select value=${`${classId}_${section}_${subject}`} onChange=${e => {
              const [cid, sec, sub] = e.target.value.split("_");
              setClassId(cid); setSection(sec); setSubject(sub);
            }} style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
              ${myAssignments.map(a => html`<option key=${a.id} value=${`${a.classId}_${a.section}_${a.subject}`}>
                ${a.className} • শাখা: ${a.section} • ${a.subject}
              </option>`)}
            </select>
          </label>`}
    </div>

    <!-- সাবজেক্ট হেডার ও স্ট্যাটাস ব্যানার -->
    <div class="card" style=${{ marginBottom: "14px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
      <div>
        <b style=${{ fontSize: "1.1rem" }}>${curClass?.name || ""} (${section}) • ${subject}</b>
        <div style=${{ fontSize: "0.85rem", color: "var(--mute)", marginTop: "2px" }}>
          পূর্ণমান ১০০ (ধারাবাহিক ${toBn(maxContinuous)} + লিখিত ${toBn(maxWritten)})
        </div>
      </div>
      <div>
        ${marksDoc?.status === "approved"
          ? html`<span class="role" style=${{ background: "var(--acc)", color: "#fff" }}>অনুমোদিত (লক করা)</span>`
          : marksDoc?.status === "submitted"
            ? html`<span class="role" style=${{ background: "#fff3cd", color: "#856404" }}>জমা দেওয়া হয়েছে</span>`
            : html`<span class="role">ড্রাফট (চলমান)</span>`}
      </div>
    </div>

    ${isLocked && html`<div style=${{ padding: "10px 14px", background: "#fff3cd", border: "1px solid #ffeeba", borderRadius: "8px", color: "#856404", marginBottom: "14px", fontSize: "0.9rem" }}>
      * এই বিষয়ের নম্বর ইতিমধ্যে জমা বা অনুমোদিত হয়েছে। তাই নম্বর লক করা রয়েছে।
    </div>`}

    <!-- শিক্ষার্থী নম্বর তালিকা -->
    <div class="card" style=${{ padding: "10px 8px" }}>
      <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", padding: "0 6px" }}>
        <b>শিক্ষার্থী তালিকা (${toBn(students.length)} জন)</b>
        <span style=${{ fontSize: "0.85rem", color: syncStatus === "saving" ? "var(--err)" : syncStatus === "dirty" ? "#e67e22" : "var(--acc)", fontWeight: 600 }}>
          ${syncStatus === "saving" ? "⏳ সিঙ্ক হচ্ছে…" : syncStatus === "dirty" ? "● পরিবর্তন অসংরক্ষিত" : "✓ ক্লাউডে সংরক্ষিত"}
        </span>
      </div>

      ${students.length === 0
        ? html`<p class="sub" style=${{ textAlign: "center", margin: "20px 0" }}>এই শ্রেণিতে কোনো শিক্ষার্থী পাওয়া যায়নি।</p>`
        : html`<div style=${{ display: "grid", gap: "10px" }}>
            ${students.map(s => {
              const rec = scores[s.sid] || { continuous: "", written: "", isAbsent: false };
              const cont = rec.isAbsent ? 0 : (parseFloat(bn2en(rec.continuous)) || 0);
              const writ = rec.isAbsent ? 0 : (parseFloat(bn2en(rec.written)) || 0);
              const total = rec.isAbsent ? "অনুপস্থিত" : Math.round((cont + writ) * 10) / 10;
              const { grade } = rec.isAbsent ? { grade: "অনুপস্থিত" } : calculateGrade(total, examConfig?.grading || []);

              return html`<div key=${s.sid} style=${{
                border: "1px solid var(--line)", borderRadius: "8px", padding: "10px",
                background: rec.isAbsent ? "#fff8f8" : "var(--bg)"
              }}>
                <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div>
                    <span style=${{ fontWeight: 700, color: "var(--acc)", marginRight: "6px" }}>রোল ${toBn(s.roll)}</span>
                    <b>${s.name}</b>
                  </div>
                  <label style=${{ display: "flex", alignItems: "center", gap: "6px", margin: 0, fontSize: "0.85rem", cursor: "pointer" }}>
                    <input type="checkbox" checked=${rec.isAbsent} disabled=${isLocked}
                      onChange=${e => handleAbsentToggle(s.sid, e.target.checked)} style=${{ width: "auto" }} />
                    <span style=${{ color: rec.isAbsent ? "var(--err)" : "var(--mute)", fontWeight: 600 }}>অনুপস্থিত</span>
                  </label>
                </div>

                <div style=${{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <div style=${{ flex: 1 }}>
                    <label style=${{ margin: "0 0 2px", fontSize: "0.78rem", color: "var(--mute)" }}>
                      ধারাবাহিক (${toBn(maxContinuous)})
                    </label>
                    <input type="tel" inputMode="numeric" value=${rec.continuous} disabled=${isLocked || rec.isAbsent}
                      placeholder="যেমন: 25"
                      onInput=${e => handleScoreChange(s.sid, "continuous", e.target.value)}
                      style=${{ padding: "8px 6px", textAlign: "center", background: "#fff", fontWeight: 600 }} />
                  </div>

                  <div style=${{ flex: 1 }}>
                    <label style=${{ margin: "0 0 2px", fontSize: "0.78rem", color: "var(--mute)" }}>
                      লিখিত (${toBn(maxWritten)})
                    </label>
                    <input type="tel" inputMode="numeric" value=${rec.written} disabled=${isLocked || rec.isAbsent}
                      placeholder="যেমন: 60"
                      onInput=${e => handleScoreChange(s.sid, "written", e.target.value)}
                      style=${{ padding: "8px 6px", textAlign: "center", background: "#fff", fontWeight: 600 }} />
                  </div>

                  <div style=${{ flex: 1, textAlign: "center", background: "#fff", padding: "6px 4px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                    <div style=${{ fontSize: "0.75rem", color: "var(--mute)" }}>মোট নম্বর</div>
                    <b style=${{ fontSize: "1.05rem", color: rec.isAbsent ? "var(--err)" : "var(--ink)" }}>
                      ${rec.isAbsent ? "অনুপস্থিত" : toBn(total)}
                    </b>
                    <div style=${{ fontSize: "0.8rem", color: "var(--acc)", fontWeight: 700 }}>${grade}</div>
                  </div>
                </div>
              </div>`;
            })}
          </div>`}

      ${err && html`<p class="err">${err}</p>`}
      ${note && html`<p class="ok">${note}</p>`}

      <!-- কন্ট্রোল বাটন -->
      ${!isLocked && students.length > 0 && html`<div style=${{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}>
        <button disabled=${busy} onClick=${() => saveMarks("draft")} style=${{ flex: 1, margin: 0 }}>
          ${busy ? "সংরক্ষণ হচ্ছে…" : "ড্রাফট সংরক্ষণ করুন"}
        </button>
        <button type="button" class="ghost" disabled=${busy} onClick=${handleSubmitForVerification}
          style=${{ flex: 1, margin: 0, borderColor: "var(--acc)", color: "var(--acc)", fontWeight: 600 }}>
          যাচাইয়ের জন্য জমা দিন
        </button>
      </div>`}
    </div>
  </div>`;
}

// ফলাফল যাচাইকারী ও প্রধান অ্যাডমিনের জন্য: যাচাই ও অনুমোদন
export function Verification({ profile }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function loadPending() {
    setLoading(true);
    try {
      const q = query(collection(db, "marks"));
      const snap = await getDocs(q);
      const docs = snap.docs.map(d => d.data());
      setList(docs);
      setLoading(false);
    } catch (ex) {
      console.error(ex);
      setLoading(false);
    }
  }

  useEffect(() => { loadPending(); }, []);

  async function updateStatus(docId, newStatus) {
    if (!confirm(newStatus === "approved"
      ? "আপনি কি এই বিষয়ের ফলাফল অনুমোদন করতে চান?"
      : "আপনি কি নম্বর তালিকাটি সংশোধনের জন্য শিক্ষকের নিকট ফেরত পাঠাতে চান?")) return;

    setBusy(true);
    try {
      await setDoc(doc(db, "marks", docId), {
        status: newStatus,
        approvedBy: profile.name,
        approvedAt: serverTimestamp()
      }, { merge: true });

      setMsg(newStatus === "approved" ? "ফলাফল সফলভাবে অনুমোদিত হয়েছে।" : "সংশোধনের জন্য ড্রাফট আকারে ফেরত পাঠানো হয়েছে।");
      loadPending();
    } catch (ex) {
      console.error(ex);
      alert("সমস্যা হয়েছে।");
    }
    setBusy(false);
  }

  if (loading) return html`<p class="sub">নম্বর তালিকা লোড হচ্ছে…</p>`;

  const pending = list.filter(m => m.status === "submitted");
  const approved = list.filter(m => m.status === "approved");
  const drafts = list.filter(m => m.status === "draft");

  return html`<div style=${{ marginTop: "14px" }}>
    ${msg && html`<p class="ok">${msg}</p>`}

    <div style=${{ fontWeight: 600, fontSize: "1.05rem", margin: "10px 0" }}>
      অনুমোদনের অপেক্ষায় (মোট: ${toBn(pending.length)} টি)
    </div>

    ${pending.length === 0
      ? html`<div class="card"><p class="sub" style=${{ margin: 0 }}>আপাতত অনুমোদনের জন্য কোনো জমা দেওয়া নম্বর নেই।</p></div>`
      : html`<div class="grid" style=${{ marginTop: 0 }}>
          ${pending.map(m => html`<div class="card" key=${m.id}>
            <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <b style=${{ fontSize: "1.1rem" }}>${m.className} (শাখা ${m.section})</b>
                <div style=${{ color: "var(--acc)", fontWeight: 600 }}>বিষয়: ${m.subject}</div>
                <div style=${{ fontSize: "0.85rem", color: "var(--mute)", marginTop: "2px" }}>
                  শিক্ষক: ${m.updatedBy || "অজ্ঞাত"} • মোট শিক্ষার্থী: ${toBn(Object.keys(m.records || {}).length)} জন
                </div>
              </div>
              <span class="role" style=${{ background: "#fff3cd", color: "#856404" }}>জমা দেওয়া</span>
            </div>

            <div style=${{ display: "flex", gap: "8px", marginTop: "14px" }}>
              <button disabled=${busy} style=${{ flex: 1, margin: 0, padding: "8px" }} onClick=${() => updateStatus(m.id, "approved")}>
                অনুমোদন করুন
              </button>
              <button type="button" class="danger" disabled=${busy} style=${{ flex: 1, margin: 0, padding: "8px" }}
                onClick=${() => updateStatus(m.id, "draft")}>
                সংশোধনে ফেরত
              </button>
            </div>
          </div>`)}
        </div>`}

    <!-- ইতিপূর্বে অনুমোদিত -->
    <div style=${{ fontWeight: 600, fontSize: "1.05rem", margin: "24px 0 10px" }}>
      অনুমোদিত বিষয়সমূহ (${toBn(approved.length)} টি)
    </div>
    <div class="grid" style=${{ marginTop: 0 }}>
      ${approved.map(m => html`<div class="item" key=${m.id} style=${{ alignItems: "center" }}>
        <div>
          <b>${m.className} (${m.section}) • ${m.subject}</b>
          <div style=${{ fontSize: "0.85rem", color: "var(--acc)" }}>অনুমোদনকারী: ${m.approvedBy || "অ্যাডমিন"}</div>
        </div>
        <span class="role" style=${{ fontSize: "0.8rem", padding: "2px 8px" }}>অনুমোদিত</span>
      </div>`)}
    </div>
  </div>`;
}
