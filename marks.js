import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { auth, db } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, setDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  DEFAULT_TERMS, DEFAULT_CLASS_RATIOS, DESCRIPTIVE_GRADES, defaultExamConfig
} from "./exams.js?v=16";

const html = htm.bind(React.createElement);

const toBn = n => String(n ?? "").replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);
const bn2en = s => String(s || "").replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));

function calculateGrade(percent, gradingScale = DESCRIPTIVE_GRADES) {
  if (percent == null || isNaN(percent)) return { grade: "-", gpa: 0 };
  const p = Math.round(percent * 100) / 100;
  for (const g of gradingScale) {
    const min = g.min != null ? g.min : 0;
    const max = g.max != null ? g.max : 100;
    if (p >= min && p <= max) {
      return { grade: g.grade, gpa: parseFloat(g.gpa) || 0 };
    }
  }
  return { grade: "অগ্রগতি প্রয়োজন", gpa: 0 };
}

export function MarksEntry({ profile }) {
  const isAdmin = profile.role === "main_admin" || profile.role === "assistant_admin";

  const [structure, setStructure] = useState([]);
  const [examConfig, setExamConfig] = useState(null);
  const [myAssignments, setMyAssignments] = useState([]);

  const [termId, setTermId] = useState("term_1");
  const [classId, setClassId] = useState("");
  const [section, setSection] = useState("");
  const [subject, setSubject] = useState("");

  const [students, setStudents] = useState([]);
  const [scores, setScores] = useState({});
  const [marksDoc, setMarksDoc] = useState(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [syncStatus, setSyncStatus] = useState("synced");

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

  // অনুপাত নির্ধারণ (যেমন: ১ম-২য় ৫০+৫০, ৩য়-৫ম ৩০+৭০)
  const ratios = examConfig?.classRatios || DEFAULT_CLASS_RATIOS;
  const curRatio = ratios[classId] || DEFAULT_CLASS_RATIOS[classId] || { continuous: 30, terminal: 70 };
  const contFull = curRatio.continuous;
  const termFull = curRatio.terminal;
  const totalFull = contFull + termFull;

  // ২. শিক্ষার্থী ও নম্বর তালিকা লোড
  async function loadMarksheet() {
    if (!termId || !classId || !section || !subject) return;
    setNote("");
    setErr("");
    try {
      const q = query(collection(db, "students"), where("classId", "==", classId), where("section", "==", section));
      const stuSnap = await getDocs(q);
      const stuList = stuSnap.docs.map(d => d.data()).sort((a, b) => a.roll - b.roll);
      setStudents(stuList);

      const docId = `${termId}_${classId}_${section}_${subject}`;
      const mSnap = await getDoc(doc(db, "marks", docId));
      if (mSnap.exists()) {
        const mData = mSnap.data();
        setMarksDoc(mData);
        setScores(mData.records || {});
      } else {
        setMarksDoc({ id: docId, status: "draft" });
        const initScores = {};
        stuList.forEach(s => {
          initScores[s.sid] = {
            ca1: "",
            ca2: "",
            continuous: "",
            terminal: "",
            total: 0,
            pct: 0,
            grade: "-",
            absent: false
          };
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
  }, [termId, classId, section, subject]);

  // ইনপুট হ্যান্ডলার (ধারা ১, ধারা ২, ধারাবাহিক, সামষ্টিক)
  function handleScoreChange(sid, field, val) {
    if (marksDoc && marksDoc.status === "approved") return;
    const cur = scores[sid] || { ca1: "", ca2: "", continuous: "", terminal: "", absent: false };
    const updatedRec = { ...cur, [field]: val };

    const grading = examConfig?.grading || DESCRIPTIVE_GRADES;

    // ধারা মূ-১ বা ধারা মূ-২ পরিবর্তন করলে স্বয়ংক্রিয়ভাবে ধারাবাহিক নির্ণয়
    if (field === "ca1" || field === "ca2") {
      const v1Raw = field === "ca1" ? val : cur.ca1;
      const v2Raw = field === "ca2" ? val : cur.ca2;
      const v1 = parseFloat(bn2en(v1Raw));
      const v2 = parseFloat(bn2en(v2Raw));

      if (!isNaN(v1) || !isNaN(v2)) {
        const sum = (isNaN(v1) ? 0 : v1) + (isNaN(v2) ? 0 : v2);
        // ৪০ থেকে contFull এ রূপান্তর (যেমন ৩০ বা ৫০)
        const scaled = Math.round((sum / 40) * contFull * 10) / 10;
        updatedRec.continuous = String(scaled);
      }
    }

    // মোট নম্বর গণনা: ধারাবাহিক + সামষ্টিক
    const cVal = parseFloat(bn2en(updatedRec.continuous)) || 0;
    const tVal = parseFloat(bn2en(updatedRec.terminal)) || 0;
    const total = Math.round((cVal + tVal) * 10) / 10;
    updatedRec.total = total;

    const pct = totalFull > 0 ? Math.round((total / totalFull) * 100 * 10) / 10 : 0;
    updatedRec.pct = pct;

    const { grade, gpa } = calculateGrade(pct, grading);
    updatedRec.grade = grade;
    updatedRec.gpa = gpa;

    setScores({ ...scores, [sid]: updatedRec });
    setSyncStatus("dirty");
  }

  function handleAbsentToggle(sid, isAbsent) {
    if (marksDoc && marksDoc.status === "approved") return;
    const cur = scores[sid] || { ca1: "", ca2: "", continuous: "", terminal: "", absent: false };
    const updated = {
      ...scores,
      [sid]: {
        ...cur,
        absent: isAbsent,
        grade: isAbsent ? "অনুপস্থিত" : cur.grade
      }
    };
    setScores(updated);
    setSyncStatus("dirty");
  }

  // কীবোর্ডে Enter বা অ্যারো কী চেপে দ্রুত পরের শিক্ষার্থীর ঘরে যাওয়া
  // কী-বোর্ড কুইক এন্ট্রি (Enter বা ArrowDown দিলে নিচে পরবর্তী শিক্ষার্থীর একই ঘরে যাবে)
  function handleKeyDown(e, idx, field) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const targetIdx = idx + 1;
      if (targetIdx < students.length) {
        const el = document.getElementById(`input_${field}_${targetIdx}`);
        if (el && !el.disabled) {
          el.focus();
          el.select?.();
          return;
        }
      } else {
        const saveBtn = document.getElementById("btn_save_draft");
        if (saveBtn) saveBtn.focus();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) {
        const el = document.getElementById(`input_${field}_${idx - 1}`);
        if (el && !el.disabled) {
          el.focus();
          el.select?.();
        }
      }
    } else if (e.key === "ArrowRight") {
      const fields = ["ca1", "ca2", "continuous", "terminal"];
      const fIdx = fields.indexOf(field);
      if (fIdx !== -1 && fIdx < fields.length - 1) {
        const el = document.getElementById(`input_${fields[fIdx + 1]}_${idx}`);
        if (el && !el.disabled) {
          e.preventDefault();
          el.focus();
          el.select?.();
        }
      }
    } else if (e.key === "ArrowLeft") {
      const fields = ["ca1", "ca2", "continuous", "terminal"];
      const fIdx = fields.indexOf(field);
      if (fIdx > 0) {
        const el = document.getElementById(`input_${fields[fIdx - 1]}_${idx}`);
        if (el && !el.disabled) {
          e.preventDefault();
          el.focus();
          el.select?.();
        }
      }
    }
  }

  // ড্রাফট / ফাইনাল সেভ
  async function saveMarks(newStatus = "draft") {
    setErr("");
    setNote("");
    setBusy(true);
    setSyncStatus("saving");

    const curTerm = DEFAULT_TERMS.find(t => t.id === termId) || DEFAULT_TERMS[0];
    const docId = `${termId}_${classId}_${section}_${subject}`;
    const curClass = structure.find(c => c.id === classId);
    const grading = examConfig?.grading || DESCRIPTIVE_GRADES;

    const finalRecords = {};
    students.forEach(s => {
      const rec = scores[s.sid] || { ca1: "", ca2: "", continuous: "", terminal: "", absent: false };
      const isAbs = !!rec.absent;
      const cVal = isAbs ? 0 : (parseFloat(bn2en(rec.continuous)) || 0);
      const tVal = isAbs ? 0 : (parseFloat(bn2en(rec.terminal)) || 0);
      const total = isAbs ? 0 : Math.round((cVal + tVal) * 10) / 10;
      const pct = isAbs ? 0 : (totalFull > 0 ? Math.round((total / totalFull) * 100 * 10) / 10 : 0);
      const { grade, gpa } = isAbs ? { grade: "অনুপস্থিত", gpa: 0 } : calculateGrade(pct, grading);

      finalRecords[s.sid] = {
        sid: s.sid,
        roll: s.roll,
        name: s.name,
        ca1: isAbs ? "" : rec.ca1,
        ca2: isAbs ? "" : rec.ca2,
        continuous: isAbs ? "অনুপস্থিত" : cVal,
        terminal: isAbs ? "অনুপস্থিত" : tVal,
        total: isAbs ? "অনুপস্থিত" : total,
        pct: isAbs ? "অনুপস্থিত" : pct,
        grade,
        gpa,
        absent: isAbs
      };
    });

    try {
      const payload = {
        id: docId,
        termId,
        termName: curTerm.name,
        phase: curTerm.phase,
        classId,
        className: curClass ? curClass.name : "",
        section,
        subject,
        contFull,
        termFull,
        totalFull,
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
      if (!rec || (!rec.absent && rec.continuous === "" && rec.terminal === "")) {
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
      <p>আপনাকে এখনো কোনো শ্রেণি বা বিষয় বরাদ্দ দেওয়া হয়নি।</p>
      <p class="sub">প্রধান অ্যাডমিন বিষয় বরাদ্দ দিলে আপনি নম্বর দিতে পারবেন।</p>
    </div>`;
  }

  const curClass = structure.find(c => c.id === classId);
  const curTerm = DEFAULT_TERMS.find(t => t.id === termId) || DEFAULT_TERMS[0];
  const isLocked = marksDoc && marksDoc.status === "approved";

  return html`<div style=${{ marginTop: "14px" }}>
    <div class="card" style=${{ marginBottom: "14px" }}>
      <label style=${{ marginTop: 0 }}>মূল্যায়ন নির্বাচন করুন
        <select value=${termId} onChange=${e => setTermId(e.target.value)}
          style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)", fontWeight: 600 }}>
          ${DEFAULT_TERMS.map(t => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
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
          ${curTerm.name} • ধারাবাহিক: <b>${toBn(contFull)}</b> + সামষ্টিক: <b>${toBn(termFull)}</b> = ১০০
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
        : html`<div style=${{ display: "grid", gap: "12px" }}>
            <div style=${{ fontSize: "0.82rem", color: "var(--acc)", background: "var(--acc2)", padding: "7px 12px", borderRadius: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>⌨️</span> <span><b>দ্রুত এন্ট্রি:</b> ধারা ১ ও ২ লিখলে ধারাবাহিক নিজে বের হবে, অথবা সরাসরি ধারাবাহিকের ঘরেও লিখতে পারেন। <b>Enter</b> চাপলে পরের ঘরে চলে যাবে।</span>
            </div>

            ${students.map((s, idx) => {
              const rec = scores[s.sid] || { ca1: "", ca2: "", continuous: "", terminal: "", total: 0, pct: 0, grade: "-", absent: false };

              return html`<div key=${s.sid} style=${{
                border: "1px solid var(--line)", borderRadius: "8px", padding: "10px 12px",
                background: rec.absent ? "#fff8f8" : "var(--bg)"
              }}>
                <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div>
                    <span style=${{ fontWeight: 700, color: "var(--acc)", marginRight: "6px" }}>রোল ${toBn(s.roll)}</span>
                    <b>${s.name}</b>
                    ${s.status === "pending" && html`<span style=${{ background: "#ffe082", color: "#856404", fontSize: "0.72rem", padding: "1px 6px", borderRadius: "8px", fontWeight: 700, marginLeft: "6px" }}>অনুমোদনের অপেক্ষায়</span>`}
                  </div>
                  <label style=${{ display: "flex", alignItems: "center", gap: "6px", margin: 0, fontSize: "0.85rem", cursor: "pointer" }}>
                    <input type="checkbox" checked=${rec.absent} disabled=${isLocked}
                      onChange=${e => handleAbsentToggle(s.sid, e.target.checked)} style=${{ width: "auto" }} />
                    <span style=${{ color: rec.absent ? "var(--err)" : "var(--mute)", fontWeight: 600 }}>অনুপস্থিত</span>
                  </label>
                </div>

                <div style=${{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(70px, 1fr))", gap: "6px", alignItems: "flex-end" }}>
                  <div>
                    <label style=${{ margin: "0 0 2px", fontSize: "0.72rem", color: "var(--mute)" }}>ধারা ১ (২০)</label>
                    <input id=${`input_ca1_${idx}`} type="tel" inputMode="numeric" value=${rec.ca1} disabled=${isLocked || rec.absent}
                      placeholder="২০"
                      onInput=${e => handleScoreChange(s.sid, "ca1", e.target.value)}
                      onKeyDown=${e => handleKeyDown(e, idx, "ca1")}
                      onFocus=${e => e.target.select?.()}
                      style=${{ padding: "7px 4px", textAlign: "center", background: "#fff", fontWeight: 600, fontSize: "0.95rem" }} />
                  </div>

                  <div>
                    <label style=${{ margin: "0 0 2px", fontSize: "0.72rem", color: "var(--mute)" }}>ধারা ২ (২০)</label>
                    <input id=${`input_ca2_${idx}`} type="tel" inputMode="numeric" value=${rec.ca2} disabled=${isLocked || rec.absent}
                      placeholder="২০"
                      onInput=${e => handleScoreChange(s.sid, "ca2", e.target.value)}
                      onKeyDown=${e => handleKeyDown(e, idx, "ca2")}
                      onFocus=${e => e.target.select?.()}
                      style=${{ padding: "7px 4px", textAlign: "center", background: "#fff", fontWeight: 600, fontSize: "0.95rem" }} />
                  </div>

                  <div>
                    <label style=${{ margin: "0 0 2px", fontSize: "0.72rem", color: "var(--acc)", fontWeight: 600 }}>ধারা (${toBn(contFull)})</label>
                    <input id=${`input_continuous_${idx}`} type="tel" inputMode="numeric" value=${rec.continuous} disabled=${isLocked || rec.absent}
                      placeholder=${toBn(contFull)}
                      onInput=${e => handleScoreChange(s.sid, "continuous", e.target.value)}
                      onKeyDown=${e => handleKeyDown(e, idx, "continuous")}
                      onFocus=${e => e.target.select?.()}
                      style=${{ padding: "7px 4px", textAlign: "center", background: "#f0f7f3", fontWeight: 700, fontSize: "0.95rem", borderColor: "var(--acc)" }} />
                  </div>

                  <div>
                    <label style=${{ margin: "0 0 2px", fontSize: "0.72rem", color: "var(--mute)" }}>সামষ্টিক (${toBn(termFull)})</label>
                    <input id=${`input_terminal_${idx}`} type="tel" inputMode="numeric" value=${rec.terminal} disabled=${isLocked || rec.absent}
                      placeholder=${toBn(termFull)}
                      onInput=${e => handleScoreChange(s.sid, "terminal", e.target.value)}
                      onKeyDown=${e => handleKeyDown(e, idx, "terminal")}
                      onFocus=${e => e.target.select?.()}
                      style=${{ padding: "7px 4px", textAlign: "center", background: "#fff", fontWeight: 700, fontSize: "0.95rem" }} />
                  </div>

                  <div style=${{ textAlign: "center", background: "#fff", padding: "6px 4px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                    <div style=${{ fontSize: "0.72rem", color: "var(--mute)" }}>মোট: <b>${toBn(rec.total)}</b></div>
                    <div style=${{ fontSize: "0.85rem", color: rec.absent ? "var(--err)" : "var(--acc)", fontWeight: 700 }}>
                      ${rec.grade}
                    </div>
                  </div>
                </div>
              </div>`;
            })}
          </div>`}

      ${err && html`<p class="err">${err}</p>`}
      ${note && html`<p class="ok">${note}</p>`}

      ${!isLocked && students.length > 0 && html`<div style=${{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}>
        <button id="btn_save_draft" disabled=${busy} onClick=${() => saveMarks("draft")} style=${{ flex: 1, margin: 0 }}>
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
                <b style=${{ fontSize: "1.1rem" }}>${m.termName || "মূল্যায়ন"}</b>
                <div style=${{ color: "var(--acc)", fontWeight: 600, marginTop: "2px" }}>
                  ${m.className} (${m.section}) • ${m.subject}
                </div>
                <div style=${{ fontSize: "0.85rem", color: "var(--mute)", marginTop: "2px" }}>
                  শিক্ষক: ${m.updatedBy || "অজ্ঞাত"} • ধারাবাহিক: ${toBn(m.contFull)} + সামষ্টিক: ${toBn(m.termFull)} = ১০০
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
          <b>${m.termName || "মূল্যায়ন"} • ${m.className} (${m.section}) • ${m.subject}</b>
          <div style=${{ fontSize: "0.85rem", color: "var(--acc)" }}>অনুমোদনকারী: ${m.approvedBy || "অ্যাডমিন"}</div>
        </div>
        <span class="role" style=${{ fontSize: "0.8rem", padding: "2px 8px" }}>অনুমোদিত</span>
      </div>`)}
    </div>
  </div>`;
}
