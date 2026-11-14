import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { auth, db } from "./firebase.js";
import {
  doc, getDoc, getDocs, setDoc, collection, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { DEFAULT_EXAMS, defaultExamConfig } from "./exams.js";

const html = htm.bind(React.createElement);
const bn2en = s => String(s || "").replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
const digits = s => bn2en(s).replace(/\D/g, "");
const toBn = n => String(n ?? "").replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);

// নম্বরের শতকরা হারের ভিত্তিতে অর্জিত গ্রেড বা মান নির্ণয়
export function calculateGrade(percent, gradingList) {
  if (percent == null || isNaN(percent) || percent === "") return { grade: "-", gpa: 0 };
  const p = Number(percent);
  for (const g of gradingList) {
    if (p >= g.min && p <= g.max) {
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
  const [examId, setExamId] = useState("ca_1_1");
  const [classId, setClassId] = useState("");
  const [section, setSection] = useState("");
  const [subject, setSubject] = useState("");

  // শিক্ষার্থী ও নম্বর ডাটা
  const [students, setStudents] = useState([]);
  const [marksDoc, setMarksDoc] = useState(null);
  const [scores, setScores] = useState({}); // { [sid]: { mark, isAbsent } }
  const [syncStatus, setSyncStatus] = useState("synced"); // 'synced' | 'saving' | 'dirty'
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const isAdmin = profile.role === "main_admin" || profile.role === "assistant_admin";

  // ১. প্রাথমিক তথ্য লোড
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

        const examsList = (eData.exams && eData.exams.length > 0) ? eData.exams : DEFAULT_EXAMS;
        if (examsList[0]) {
          setExamId(examsList[0].id);
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
        const initScores = {};
        stuList.forEach(s => {
          initScores[s.sid] = { mark: "", isAbsent: false };
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
  function handleScoreChange(sid, val) {
    if (marksDoc && marksDoc.status === "approved") return;
    const cur = scores[sid] || { mark: "", isAbsent: false };
    const updated = {
      ...scores,
      [sid]: { ...cur, mark: val }
    };
    setScores(updated);
    setSyncStatus("dirty");
  }

  function handleAbsentToggle(sid, isAbsent) {
    if (marksDoc && marksDoc.status === "approved") return;
    const cur = scores[sid] || { mark: "", isAbsent: false };
    const updated = {
      ...scores,
      [sid]: {
        ...cur,
        isAbsent,
        mark: isAbsent ? "" : cur.mark
      }
    };
    setScores(updated);
    setSyncStatus("dirty");
  }

  // ড্রাফট / ফাইনাল সেভ
  async function saveMarks(newStatus = "draft") {
    setErr("");
    setNote("");
    setBusy(true);
    setSyncStatus("saving");

    const examsList = examConfig?.exams || DEFAULT_EXAMS;
    const curExam = examsList.find(e => e.id === examId) || DEFAULT_EXAMS[0];
    const fullMarks = curExam.fullMarks || 100;
    const grading = examConfig?.grading || [];
    const docId = `${examId}_${classId}_${section}_${subject}`;
    const curClass = structure.find(c => c.id === classId);

    // ক্যালকুলেটেড ডাটা প্রস্তুতকরণ
    const finalRecords = {};
    students.forEach(s => {
      const rec = scores[s.sid] || { mark: "", isAbsent: false };
      const raw = rec.isAbsent ? 0 : (parseFloat(bn2en(rec.mark)) || 0);
      const percent = rec.isAbsent ? 0 : Math.round((raw / fullMarks) * 100 * 10) / 10;
      const { grade, gpa } = rec.isAbsent ? { grade: "অনুপস্থিত", gpa: 0 } : calculateGrade(percent, grading);

      finalRecords[s.sid] = {
        sid: s.sid,
        roll: s.roll,
        name: s.name,
        mark: rec.isAbsent ? "" : rec.mark,
        score: rec.isAbsent ? "অনুপস্থিত" : raw,
        fullMarks,
        percent: rec.isAbsent ? "অনুপস্থিত" : percent,
        isAbsent: Boolean(rec.isAbsent),
        grade,
        gpa
      };
    });

    try {
      const payload = {
        id: docId,
        examId,
        examName: curExam.name,
        phase: curExam.phase,
        type: curExam.type,
        fullMarks,
        classId,
        className: curClass ? curClass.name : "",
        section,
        subject,
        status: newStatus,
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
      setErr("সংরক্ষণ করা যায়নি: " + (ex.code || ex.message || "ইন্টারনেট ও Rules দেখুন।"));
    }
    setBusy(false);
  }

  function handleSubmitForVerification() {
    let incomplete = 0;
    students.forEach(s => {
      const rec = scores[s.sid];
      if (!rec || (!rec.isAbsent && rec.mark === "")) {
        incomplete++;
      }
    });

    if (incomplete > 0) {
      if (!confirm(`${toBn(incomplete)} জন শিক্ষার্থীর নম্বর এখনো অসম্পূর্ণ রয়েছে। আপনি কি এভাবে জমা দিতে চান?`)) {
        return;
      }
    } else {
      if (!confirm("আপনি কি নিশ্চিত যে এই মূল্যায়নের নম্বর জমা দিতে চান? জমা দেওয়ার পর ফলাফল যাচাইকারী অনুমোদন করবেন।")) {
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

  const examsList = examConfig?.exams || DEFAULT_EXAMS;
  const curExam = examsList.find(e => e.id === examId) || DEFAULT_EXAMS[0];
  const fullMarks = curExam.fullMarks || 100;
  const curClass = structure.find(c => c.id === classId) || structure[0];
  const isLocked = marksDoc?.status === "submitted" || marksDoc?.status === "approved";

  const phase1 = examsList.filter(e => e.phase === 1);
  const phase2 = examsList.filter(e => e.phase === 2);
  const phase3 = examsList.filter(e => e.phase === 3);

  return html`<div style=${{ marginTop: "14px" }}>
    <div class="card" style=${{ marginBottom: "14px" }}>
      <label style=${{ marginTop: 0 }}>মূল্যায়ন / পরীক্ষা নির্বাচন করুন
        <select value=${examId} onChange=${e => setExamId(e.target.value)}
          style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)", fontWeight: 600 }}>
          <optgroup label="১ম পর্যায়">
            ${phase1.map(e => html`<option key=${e.id} value=${e.id}>${e.name} (পূর্ণমান: ${toBn(e.fullMarks)})</option>`)}
          </optgroup>
          <optgroup label="২য় পর্যায়">
            ${phase2.map(e => html`<option key=${e.id} value=${e.id}>${e.name} (পূর্ণমান: ${toBn(e.fullMarks)})</option>`)}
          </optgroup>
          <optgroup label="৩য় পর্যায়">
            ${phase3.map(e => html`<option key=${e.id} value=${e.id}>${e.name} (পূর্ণমান: ${toBn(e.fullMarks)})</option>`)}
          </optgroup>
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

    <div class="card" style=${{ marginBottom: "14px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
      <div>
        <b style=${{ fontSize: "1.1rem" }}>${curClass?.name || ""} (${section}) • ${subject}</b>
        <div style=${{ fontSize: "0.85rem", color: "var(--mute)", marginTop: "2px" }}>
          ${curExam.name} • পূর্ণমান: <b>${toBn(fullMarks)}</b>
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
      * এই পরীক্ষার নম্বর ইতিমধ্যে জমা বা অনুমোদিত হয়েছে। তাই নম্বর লক করা রয়েছে।
    </div>`}

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
              const rec = scores[s.sid] || { mark: "", isAbsent: false };
              const raw = rec.isAbsent ? 0 : (parseFloat(bn2en(rec.mark)) || 0);
              const percent = rec.isAbsent ? 0 : Math.round((raw / fullMarks) * 100 * 10) / 10;
              const { grade } = rec.isAbsent ? { grade: "অনুপস্থিত" } : calculateGrade(percent, examConfig?.grading || []);

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

                <div style=${{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <div style=${{ flex: 2 }}>
                    <label style=${{ margin: "0 0 2px", fontSize: "0.78rem", color: "var(--mute)" }}>
                      প্রাপ্ত নম্বর (পূর্ণমান ${toBn(fullMarks)})
                    </label>
                    <input type="tel" inputMode="numeric" value=${rec.mark} disabled=${isLocked || rec.isAbsent}
                      placeholder="যেমন: ${toBn(Math.min(18, fullMarks))}"
                      onInput=${e => handleScoreChange(s.sid, e.target.value)}
                      style=${{ padding: "9px 10px", textAlign: "center", background: "#fff", fontWeight: 700, fontSize: "1.05rem" }} />
                  </div>

                  <div style=${{ flex: 1, textAlign: "center", background: "#fff", padding: "8px 6px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                    <div style=${{ fontSize: "0.75rem", color: "var(--mute)" }}>অর্জিত মান</div>
                    <div style=${{ fontSize: "0.95rem", color: rec.isAbsent ? "var(--err)" : "var(--acc)", fontWeight: 700, marginTop: "2px" }}>
                      ${grade}
                    </div>
                    ${!rec.isAbsent && rec.mark !== "" && html`
                      <div style=${{ fontSize: "0.75rem", color: "var(--mute)", marginTop: "1px" }}>
                        ${toBn(percent)}%
                      </div>
                    `}
                  </div>
                </div>
              </div>`;
            })}
          </div>`}

      ${err && html`<p class="err">${err}</p>`}
      ${note && html`<p class="ok">${note}</p>`}

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
      ? "আপনি কি এই মূল্যায়নের ফলাফল অনুমোদন করতে চান?"
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
                <b style=${{ fontSize: "1.1rem" }}>${m.examName || "মূল্যায়ন"}</b>
                <div style=${{ color: "var(--acc)", fontWeight: 600, marginTop: "2px" }}>
                  ${m.className} (${m.section}) • ${m.subject}
                </div>
                <div style=${{ fontSize: "0.85rem", color: "var(--mute)", marginTop: "2px" }}>
                  শিক্ষক: ${m.updatedBy || "অজ্ঞাত"} • পূর্ণমান: ${toBn(m.fullMarks || 100)} • শিক্ষার্থী: ${toBn(Object.keys(m.records || {}).length)} জন
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

    <div style=${{ fontWeight: 600, fontSize: "1.05rem", margin: "24px 0 10px" }}>
      অনুমোদিত বিষয়সমূহ (${toBn(approved.length)} টি)
    </div>
    <div class="grid" style=${{ marginTop: 0 }}>
      ${approved.map(m => html`<div class="item" key=${m.id} style=${{ alignItems: "center" }}>
        <div>
          <b>${m.examName || "মূল্যায়ন"} • ${m.className} (${m.section}) • ${m.subject}</b>
          <div style=${{ fontSize: "0.85rem", color: "var(--acc)" }}>অনুমোদনকারী: ${m.approvedBy || "অ্যাডমিন"}</div>
        </div>
        <span class="role" style=${{ fontSize: "0.8rem", padding: "2px 8px" }}>অনুমোদিত</span>
      </div>`)}
    </div>
  </div>`;
}
