import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { auth, db } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, setDoc, writeBatch, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  DEFAULT_TERMS, DEFAULT_CLASS_RATIOS, DESCRIPTIVE_GRADES, defaultExamConfig
} from "./exams.js?v=23";

const html = htm.bind(React.createElement);

const toBn = n => {
  if (n == null || n === "" || n === "-") return n ?? "";
  if (typeof n === "number") {
    if (isNaN(n)) return "-";
    n = Number(n.toFixed(1));
  } else if (typeof n === "string") {
    const enStr = String(n).trim().replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
    if (enStr.includes(".") && /^[-+]?\d*\.?\d+$/.test(enStr)) {
      const num = parseFloat(enStr);
      if (!isNaN(num)) n = Number(num.toFixed(1));
    }
  }
  return String(n).replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);
};
const bn2en = s => String(s || "").replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
const cleanDigits = s => String(s || "").replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d)).replace(/\D/g, "");

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

  // Excel / CSV ফাইল আপলোড ও টেমপ্লেট স্টেট
  const [showExcelUpload, setShowExcelUpload] = useState(false);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadPreview, setUploadPreview] = useState(null);
  const [uploadErr, setUploadErr] = useState("");

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

  // ইনপুট হ্যান্ডলার (ধারা ১, ধারা ২, ধারাবাহিক, সামষ্টিক) - নির্ধারিত পূর্ণমানের অতিরিক্ত নম্বর প্রতিরোধ
  function handleScoreChange(sid, field, val) {
    if (marksDoc && marksDoc.status === "approved") return;
    const cur = scores[sid] || { ca1: "", ca2: "", continuous: "", terminal: "", absent: false };
    const stu = students.find(s => s.sid === sid);
    const sIdx = students.findIndex(s => s.sid === sid);

    const fieldLabels = {
      ca1: "ধারা ১",
      ca2: "ধারা ২",
      continuous: "ধারাবাহিক মূল্যায়ন",
      terminal: "সামষ্টিক মূল্যায়ন"
    };

    const maxLimits = {
      ca1: 20,
      ca2: 20,
      continuous: contFull,
      terminal: termFull
    };

    const maxAllowed = maxLimits[field] ?? 100;

    // খালি করলে ফিল্ড ক্লিয়ার হবে
    if (val === "" || val == null) {
      if (err && err.startsWith("⚠️ সতর্কবার্তা")) setErr("");
      const updatedRec = { ...cur, [field]: "" };
      if (field === "ca1" || field === "ca2") {
        const otherVal = field === "ca1" ? cur.ca2 : cur.ca1;
        const vOther = parseFloat(bn2en(otherVal));
        if (isNaN(vOther)) {
          updatedRec.continuous = "";
        } else {
          const scaled = Math.round((vOther / 40) * contFull * 10) / 10;
          updatedRec.continuous = String(scaled);
        }
      }
      const cVal = parseFloat(bn2en(updatedRec.continuous)) || 0;
      const tVal = parseFloat(bn2en(updatedRec.terminal)) || 0;
      const total = Math.round((cVal + tVal) * 10) / 10;
      updatedRec.total = total;
      const pct = totalFull > 0 ? Math.round((total / totalFull) * 100 * 10) / 10 : 0;
      updatedRec.pct = pct;
      const grading = examConfig?.grading || DESCRIPTIVE_GRADES;
      const { grade, gpa } = calculateGrade(pct, grading);
      updatedRec.grade = (updatedRec.continuous === "" && updatedRec.terminal === "") ? "-" : grade;
      updatedRec.gpa = gpa;
      setScores({ ...scores, [sid]: updatedRec });
      setSyncStatus("dirty");
      return;
    }

    const num = parseFloat(bn2en(val));
    if (isNaN(num)) {
      setErr(`⚠️ সতর্কবার্তা: ${fieldLabels[field] || field}-এ শুধু সঠিক সংখ্যা লিখুন।`);
      const el = document.getElementById(`input_${field}_${sIdx}`);
      if (el) el.value = cur[field] || "";
      return;
    }

    if (num < 0) {
      setErr(`⚠️ সতর্কবার্তা: নম্বর ০-এর কম হতে পারবে না।`);
      const el = document.getElementById(`input_${field}_${sIdx}`);
      if (el) el.value = cur[field] || "";
      return;
    }

    // নির্ধারিত পূর্ণমানের চেয়ে বেশি নম্বর দিলে আটকানো ও সতর্কবার্তা দেখানো
    if (num > maxAllowed) {
      setErr(`⚠️ সতর্কবার্তা: ${stu ? `রোল ${toBn(stu.roll)} (${stu.name}) — ` : ""}${fieldLabels[field] || field}-এ পূর্ণমান ${toBn(maxAllowed)}-এর বেশি নম্বর দেওয়া যাবে না! আপনি ${toBn(val)} লিখেছেন।`);
      const el = document.getElementById(`input_${field}_${sIdx}`);
      if (el) el.value = cur[field] || "";
      return;
    }

    // ভ্যালিড নম্বর হলে আগের সতর্কবার্তা মুছে ফেলা
    if (err && err.startsWith("⚠️ সতর্কবার্তা")) setErr("");

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
        const scaled = Math.min(contFull, Math.round((sum / 40) * contFull * 10) / 10);
        updatedRec.continuous = String(scaled);
      }
    }

    // মোট নম্বর গণনা: ধারাবাহিক + সামষ্টিক
    const cVal = parseFloat(bn2en(updatedRec.continuous)) || 0;
    const tVal = parseFloat(bn2en(updatedRec.terminal)) || 0;
    const total = Math.min(totalFull, Math.round((cVal + tVal) * 10) / 10);
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

    // নির্ধারিত পূর্ণমানের চেয়ে বেশি নম্বর থাকলে সংরক্ষণ ও জমা আটকানো
    for (const s of students) {
      const rec = scores[s.sid];
      if (!rec || rec.absent) continue;
      const ca1Val = parseFloat(bn2en(rec.ca1));
      const ca2Val = parseFloat(bn2en(rec.ca2));
      const cVal = parseFloat(bn2en(rec.continuous));
      const tVal = parseFloat(bn2en(rec.terminal));

      if (!isNaN(ca1Val) && (ca1Val > 20 || ca1Val < 0)) {
        setErr(`সংরক্ষণ করা যায়নি: রোল ${toBn(s.roll)} (${s.name})-এর ধারা ১ নম্বর (${toBn(rec.ca1)}) পূর্ণমান ২০-এর চেয়ে বেশি!`);
        return;
      }
      if (!isNaN(ca2Val) && (ca2Val > 20 || ca2Val < 0)) {
        setErr(`সংরক্ষণ করা যায়নি: রোল ${toBn(s.roll)} (${s.name})-এর ধারা ২ নম্বর (${toBn(rec.ca2)}) পূর্ণমান ২০-এর চেয়ে বেশি!`);
        return;
      }
      if (!isNaN(cVal) && (cVal > contFull || cVal < 0)) {
        setErr(`সংরক্ষণ করা যায়নি: রোল ${toBn(s.roll)} (${s.name})-এর ধারাবাহিক নম্বর (${toBn(rec.continuous)}) পূর্ণমান ${toBn(contFull)}-এর চেয়ে বেশি!`);
        return;
      }
      if (!isNaN(tVal) && (tVal > termFull || tVal < 0)) {
        setErr(`সংরক্ষণ করা যায়নি: রোল ${toBn(s.roll)} (${s.name})-এর সামষ্টিক নম্বর (${toBn(rec.terminal)}) পূর্ণমান ${toBn(termFull)}-এর চেয়ে বেশি!`);
        return;
      }
    }

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

  // ১. এই শ্রেণি ও বিষয়ের শিক্ষার্থীদের জন্য নমুনা Excel ডাউনলোড
  function handleDownloadTemplate() {
    if (!students || students.length === 0) {
      alert("এই শ্রেণিতে কোনো শিক্ষার্থী পাওয়া যায়নি।");
      return;
    }
    const headers = [
      "রোল (Roll)",
      "শিক্ষার্থীর নাম (Student Name)",
      "ধারা ১ (সর্বোচ্চ ২০)",
      "ধারা ২ (সর্বোচ্চ ২০)",
      `ধারাবাহিক (সর্বোচ্চ ${contFull})`,
      `সামষ্টিক (সর্বোচ্চ ${termFull})`,
      "অনুপস্থিত (হ্যাঁ/না)"
    ];

    const rows = students.map(s => {
      const rec = scores[s.sid] || {};
      return [
        s.roll,
        s.name,
        rec.ca1 || "",
        rec.ca2 || "",
        rec.continuous || "",
        rec.terminal || "",
        rec.absent ? "হ্যাঁ" : ""
      ];
    });

    const wsData = [headers, ...rows];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws["!cols"] = [
      { wch: 12 },
      { wch: 25 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 20 },
      { wch: 16 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, "নম্বর তালিকা");
    const safeSub = (subject || "বিষয়").replace(/[/\\?%*:|"<>]/g, "-");
    const safeCls = (curClass?.name || "শ্রেণি").replace(/[/\\?%*:|"<>]/g, "-");
    const safeTerm = (curTerm.name || "মূল্যায়ন").replace(/[/\\?%*:|"<>]/g, "-");
    const fileName = `নম্বর_${safeCls}_শাখা_${section}_${safeSub}_${safeTerm}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  // ২. Excel বা CSV ফাইল রিড ও পার্সিং
  function handleExcelFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadFileName(file.name);
    setUploadErr("");
    setUploadPreview(null);

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const data = new Uint8Array(evt.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
        if (!raw || raw.length === 0) return setUploadErr("ফাইলটি খালি।");

        // হেডার শনাক্তকরণ
        let headerIdx = -1;
        let colRoll = 0, colName = 1, colCa1 = -1, colCa2 = -1, colCont = -1, colTerm = -1, colAbsent = -1;

        for (let i = 0; i < Math.min(raw.length, 6); i++) {
          const row = (raw[i] || []).map(x => String(x || "").trim().toLowerCase());
          const hasRoll = row.some(c => c.includes("রোল") || c.includes("roll") || c.includes("ক্রমিক") || c.includes("sl"));
          const hasMarks = row.some(c => c.includes("ধারাবাহিক") || c.includes("সামষ্টিক") || c.includes("নম্বর") || c.includes("mark") || c.includes("ধারা"));
          if (hasRoll || hasMarks) {
            headerIdx = i;
            row.forEach((col, idx) => {
              if (col.includes("রোল") || col.includes("roll") || col.includes("ক্রমিক") || col.includes("sl")) colRoll = idx;
              else if (col.includes("নাম") || col.includes("name")) colName = idx;
              else if (col.includes("ধারা ১") || col.includes("ধারা-১") || col.includes("ca1") || col.includes("ca 1")) colCa1 = idx;
              else if (col.includes("ধারা ২") || col.includes("ধারা-২") || col.includes("ca2") || col.includes("ca 2")) colCa2 = idx;
              else if (col.includes("ধারাবাহিক") || col.includes("continuous") || col.includes("ca")) colCont = idx;
              else if (col.includes("সামষ্টিক") || col.includes("terminal") || col.includes("sa") || col.includes("লিখিত") || col.includes("পরীক্ষা")) colTerm = idx;
              else if (col.includes("অনুপস্থিত") || col.includes("absent")) colAbsent = idx;
            });
            break;
          }
        }

        if (headerIdx === -1) {
          headerIdx = 0;
          colRoll = 0; colName = 1; colCa1 = 2; colCa2 = 3; colCont = 4; colTerm = 5;
        }

        const dataRows = raw.slice(headerIdx + 1);
        const parsedRows = [];
        const grading = examConfig?.grading || DESCRIPTIVE_GRADES;

        for (let i = 0; i < dataRows.length; i++) {
          const r = dataRows[i];
          if (!r || r.length === 0 || r.every(c => c === "" || c == null)) continue;

          const rollStr = cleanDigits(r[colRoll]);
          const roll = parseInt(rollStr, 10);
          const name = String(r[colName] || "").trim();

          const student = students.find(s => s.roll === roll);
          if (!student) {
            parsedRows.push({
              rowNum: i + (headerIdx + 2),
              roll: roll || "",
              name: name || "অজানা শিক্ষার্থী",
              matched: false,
              error: `রোল ${toBn(roll)} এই শাখার শিক্ষার্থী তালিকায় নেই।`,
              ca1: "", ca2: "", continuous: "", terminal: "", absent: false, total: 0, pct: 0, grade: "-"
            });
            continue;
          }

          const absVal = colAbsent !== -1 ? String(r[colAbsent] || "").trim().toLowerCase() : "";
          const isAbsent = absVal === "হ্যাঁ" || absVal === "yes" || absVal === "true" || absVal === "y" || absVal === "অনুপস্থিত" || absVal === "১";

          let ca1 = colCa1 !== -1 ? String(r[colCa1] ?? "").trim() : "";
          let ca2 = colCa2 !== -1 ? String(r[colCa2] ?? "").trim() : "";
          let continuous = colCont !== -1 ? String(r[colCont] ?? "").trim() : "";
          let terminal = colTerm !== -1 ? String(r[colTerm] ?? "").trim() : "";

          let error = null;
          let vCa1 = ca1 !== "" ? parseFloat(bn2en(ca1)) : NaN;
          let vCa2 = ca2 !== "" ? parseFloat(bn2en(ca2)) : NaN;
          let vCont = continuous !== "" ? parseFloat(bn2en(continuous)) : NaN;
          let vTerm = terminal !== "" ? parseFloat(bn2en(terminal)) : NaN;

          if (!isNaN(vCa1) && (vCa1 < 0 || vCa1 > 20)) error = `ধারা ১-এ সর্বোচ্চ ২০-এর মধ্যে নম্বর দিন।`;
          if (!isNaN(vCa2) && (vCa2 < 0 || vCa2 > 20)) error = `ধারা ২-এ সর্বোচ্চ ২০-এর মধ্যে নম্বর দিন।`;

          if ((!isNaN(vCa1) || !isNaN(vCa2)) && isNaN(vCont)) {
            const sum = (isNaN(vCa1) ? 0 : vCa1) + (isNaN(vCa2) ? 0 : vCa2);
            vCont = Math.min(contFull, Math.round((sum / 40) * contFull * 10) / 10);
            continuous = String(vCont);
          }

          if (!isNaN(vCont) && (vCont < 0 || vCont > contFull)) {
            error = `ধারাবাহিক মূল্যায়নে সর্বোচ্চ ${toBn(contFull)}-এর মধ্যে নম্বর দিন।`;
          }
          if (!isNaN(vTerm) && (vTerm < 0 || vTerm > termFull)) {
            error = `সামষ্টিক মূল্যায়নে সর্বোচ্চ ${toBn(termFull)}-এর মধ্যে নম্বর দিন।`;
          }

          const cVal = isNaN(vCont) ? 0 : vCont;
          const tVal = isNaN(vTerm) ? 0 : vTerm;
          const total = Math.min(totalFull, Math.round((cVal + tVal) * 10) / 10);
          const pct = totalFull > 0 ? Math.round((total / totalFull) * 100 * 10) / 10 : 0;
          const { grade, gpa } = calculateGrade(pct, grading);

          parsedRows.push({
            rowNum: i + (headerIdx + 2),
            sid: student.sid,
            roll: student.roll,
            name: student.name,
            matched: true,
            error,
            ca1: isNaN(vCa1) ? "" : String(vCa1),
            ca2: isNaN(vCa2) ? "" : String(vCa2),
            continuous: isNaN(vCont) ? "" : String(vCont),
            terminal: isNaN(vTerm) ? "" : String(vTerm),
            absent: isAbsent,
            total,
            pct,
            grade: isAbsent ? "অনুপস্থিত" : (isNaN(vCont) && isNaN(vTerm) ? "-" : grade),
            gpa: isAbsent ? 0 : gpa
          });
        }

        if (parsedRows.length === 0) return setUploadErr("ফাইলে কোনো নম্বর বা শিক্ষার্থীর রেকর্ড পাওয়া যায়নি।");
        const validCount = parsedRows.filter(p => p.matched && !p.error).length;
        setUploadPreview({
          total: parsedRows.length,
          valid: validCount,
          rows: parsedRows
        });
      } catch (ex) {
        console.error("Excel parse error:", ex);
        setUploadErr("ফাইলটি পড়া যায়নি: " + (ex.message || "Excel ফরম্যাট সঠিক কিনা দেখুন।"));
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ৩. পার্স করা নম্বর বর্তমান শিটে বসানো
  function applyUploadedMarks() {
    if (!uploadPreview || !uploadPreview.rows) return;
    const newScores = { ...scores };
    let appliedCount = 0;

    uploadPreview.rows.forEach(r => {
      if (!r.matched || r.error) return;
      newScores[r.sid] = {
        ca1: r.ca1,
        ca2: r.ca2,
        continuous: r.continuous,
        terminal: r.terminal,
        absent: r.absent,
        total: r.total,
        pct: r.pct,
        grade: r.grade,
        gpa: r.gpa
      };
      appliedCount++;
    });

    setScores(newScores);
    setSyncStatus("dirty");
    setShowExcelUpload(false);
    setUploadPreview(null);
    setUploadFileName("");
    setNote(`✓ Excel ফাইল থেকে ${toBn(appliedCount)} জন শিক্ষার্থীর নম্বর সফলভাবে শিটে বসানো হয়েছে। নিচে "ড্রাফট সংরক্ষণ" বা "অনুমোদনের জন্য জমা দিন" বাটনে চাপুন।`);
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

    <!-- নমুনা ডাউনলোড ও এক্সেল আপলোড বোতাম -->
    <div style=${{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
      <button type="button" class="ghost" onClick=${handleDownloadTemplate}
        style=${{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.88rem", padding: "8px 14px", width: "auto", margin: 0, borderColor: "var(--acc)", color: "var(--acc)", background: "var(--acc2)", fontWeight: 600 }}>
        📥 নমুনা Excel ডাউনলোড
      </button>

      ${!isLocked && html`
        <button type="button" class="ghost" onClick=${() => { setShowExcelUpload(!showExcelUpload); setUploadPreview(null); setUploadErr(""); }}
          style=${{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.88rem", padding: "8px 14px", width: "auto", margin: 0, borderColor: "#2563eb", color: "#1d4ed8", background: "#eff6ff", fontWeight: 600 }}>
          📤 ${showExcelUpload ? "ফাইল আপলোড বন্ধ করুন" : "Excel / CSV থেকে নম্বর আপলোড"}
        </button>
      `}
    </div>

    <!-- Excel আপলোড প্যানেল -->
    ${showExcelUpload && html`<div class="card" style=${{
      background: "#f8fafc",
      border: "1.5px solid #93c5fd",
      borderRadius: "10px",
      padding: "16px",
      marginBottom: "16px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.06)"
    }}>
      <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <b style=${{ color: "#1e40af", fontSize: "1rem" }}>
          📤 Excel বা CSV ফাইল থেকে নম্বর আপলোড (${curClass?.name || "শ্রেণি"} - শাখা: ${section} - ${subject})
        </b>
        <button type="button" class="ghost" onClick=${() => { setShowExcelUpload(false); setUploadPreview(null); }}
          style=${{ width: "auto", margin: 0, padding: "2px 8px", fontSize: "0.85rem" }}>✕</button>
      </div>

      <p style=${{ fontSize: "0.86rem", color: "var(--mute)", margin: "0 0 10px", lineHeight: "1.5" }}>
        প্রথমে <b>"📥 নমুনা Excel ডাউনলোড"</b> বাটনে চাপ দিয়ে এই শ্রেণির শিক্ষার্থীদের রোল ও নামসহ তৈরি এক্সেল ফাইলটি নামিয়ে নিন। ফাইলে নম্বর লিখে এখানে আপলোড করলে সকল শিক্ষার্থীর নম্বর এক ক্লিকে শিটে বসে যাবে।
      </p>

      <label style=${{ fontWeight: 600, fontSize: "0.9rem", display: "block", marginBottom: "6px" }}>
        Excel / CSV ফাইল নির্বাচন করুন (.xlsx, .xls, .csv)
        <input type="file" accept=".xlsx, .xls, .csv" onChange=${handleExcelFileChange}
          style=${{ marginTop: "6px", background: "#fff", padding: "8px", border: "1px dashed #93c5fd" }} />
      </label>

      ${uploadErr && html`<p class="err" style=${{ margin: "8px 0" }}>${uploadErr}</p>`}

      ${uploadPreview && html`<div style=${{ marginTop: "14px" }}>
        <div style=${{ background: "#fff", padding: "10px 14px", borderRadius: "8px", border: "1px solid var(--line)", marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
          <div>
            <b>ফাইল: ${uploadFileName}</b>
            <div style=${{ fontSize: "0.85rem", color: "var(--mute)", marginTop: "2px" }}>
              মোট রেকর্ড: ${toBn(uploadPreview.total)} টি | সঠিক নম্বর পাওয়া গেছে: <b style=${{ color: "var(--acc)" }}>${toBn(uploadPreview.valid)}</b> জন
              ${(uploadPreview.total - uploadPreview.valid) > 0 ? html` | <span style=${{ color: "var(--err)" }}>ত্রুটি / অমিল: ${toBn(uploadPreview.total - uploadPreview.valid)} টি</span>` : ""}
            </div>
          </div>
          <button type="button" disabled=${uploadPreview.valid === 0} onClick=${applyUploadedMarks}
            style=${{ width: "auto", margin: 0, padding: "8px 16px", background: "var(--acc)", color: "#fff", fontWeight: 700, fontSize: "0.9rem" }}>
            ✓ নম্বর শিটে যুক্ত করুন (${toBn(uploadPreview.valid)} জন)
          </button>
        </div>

        <!-- প্রিভিউ টেবিল -->
        <div style=${{ maxHeight: "240px", overflowY: "auto", border: "1px solid var(--line)", borderRadius: "6px", background: "#fff" }}>
          <table style=${{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
            <thead>
              <tr style=${{ background: "#f1f5f9", borderBottom: "1px solid var(--line)" }}>
                <th style=${{ padding: "6px 8px" }}>রোল</th>
                <th style=${{ padding: "6px 8px" }}>নাম</th>
                <th style=${{ padding: "6px 8px", textAlign: "center" }}>ধারাবাহিক (${toBn(contFull)})</th>
                <th style=${{ padding: "6px 8px", textAlign: "center" }}>সামষ্টিক (${toBn(termFull)})</th>
                <th style=${{ padding: "6px 8px", textAlign: "center" }}>মোট (১০০)</th>
                <th style=${{ padding: "6px 8px", textAlign: "center" }}>গ্রেড</th>
                <th style=${{ padding: "6px 8px" }}>অবস্থা</th>
              </tr>
            </thead>
            <tbody>
              ${uploadPreview.rows.map(r => html`<tr key=${r.rowNum} style=${{ borderBottom: "1px solid #f1f5f9", background: r.error ? "#fef2f2" : "transparent" }}>
                <td style=${{ padding: "6px 8px", fontWeight: 600 }}>${toBn(r.roll)}</td>
                <td style=${{ padding: "6px 8px" }}>${r.name}</td>
                <td style=${{ padding: "6px 8px", textAlign: "center" }}>${r.absent ? "অনুপস্থিত" : toBn(r.continuous || "-")}</td>
                <td style=${{ padding: "6px 8px", textAlign: "center" }}>${r.absent ? "অনুপস্থিত" : toBn(r.terminal || "-")}</td>
                <td style=${{ padding: "6px 8px", textAlign: "center", fontWeight: 700 }}>${r.absent ? "-" : toBn(r.total)}</td>
                <td style=${{ padding: "6px 8px", textAlign: "center", color: r.absent ? "var(--err)" : "var(--acc)", fontWeight: 600 }}>${r.grade}</td>
                <td style=${{ padding: "6px 8px" }}>
                  ${r.error
                    ? html`<span style=${{ color: "var(--err)", fontSize: "0.78rem" }}>⚠️ ${r.error}</span>`
                    : html`<span style=${{ color: "var(--acc)", fontSize: "0.78rem", fontWeight: 600 }}>✓ সঠিক</span>`}
                </td>
              </tr>`)}
            </tbody>
          </table>
        </div>
      </div>`}
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
                    <input id=${`input_ca1_${idx}`} type="tel" inputMode="numeric" min="0" max="20" value=${rec.ca1} disabled=${isLocked || rec.absent}
                      placeholder="২০"
                      onInput=${e => handleScoreChange(s.sid, "ca1", e.target.value)}
                      onKeyDown=${e => handleKeyDown(e, idx, "ca1")}
                      onFocus=${e => e.target.select?.()}
                      style=${{ padding: "7px 4px", textAlign: "center", background: "#fff", fontWeight: 600, fontSize: "0.95rem" }} />
                  </div>

                  <div>
                    <label style=${{ margin: "0 0 2px", fontSize: "0.72rem", color: "var(--mute)" }}>ধারা ২ (২০)</label>
                    <input id=${`input_ca2_${idx}`} type="tel" inputMode="numeric" min="0" max="20" value=${rec.ca2} disabled=${isLocked || rec.absent}
                      placeholder="২০"
                      onInput=${e => handleScoreChange(s.sid, "ca2", e.target.value)}
                      onKeyDown=${e => handleKeyDown(e, idx, "ca2")}
                      onFocus=${e => e.target.select?.()}
                      style=${{ padding: "7px 4px", textAlign: "center", background: "#fff", fontWeight: 600, fontSize: "0.95rem" }} />
                  </div>

                  <div>
                    <label style=${{ margin: "0 0 2px", fontSize: "0.72rem", color: "var(--acc)", fontWeight: 600 }}>ধারা (${toBn(contFull)})</label>
                    <input id=${`input_continuous_${idx}`} type="tel" inputMode="numeric" min="0" max=${contFull} value=${rec.continuous} disabled=${isLocked || rec.absent}
                      placeholder=${toBn(contFull)}
                      onInput=${e => handleScoreChange(s.sid, "continuous", e.target.value)}
                      onKeyDown=${e => handleKeyDown(e, idx, "continuous")}
                      onFocus=${e => e.target.select?.()}
                      style=${{ padding: "7px 4px", textAlign: "center", background: "#f0f7f3", fontWeight: 700, fontSize: "0.95rem", borderColor: "var(--acc)" }} />
                  </div>

                  <div>
                    <label style=${{ margin: "0 0 2px", fontSize: "0.72rem", color: "var(--mute)" }}>সামষ্টিক (${toBn(termFull)})</label>
                    <input id=${`input_terminal_${idx}`} type="tel" inputMode="numeric" min="0" max=${termFull} value=${rec.terminal} disabled=${isLocked || rec.absent}
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
  const [expandedId, setExpandedId] = useState(null);

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

  async function approveAll() {
    const pendingDocs = list.filter(m => m.status === "submitted");
    if (pendingDocs.length === 0) return;
    if (!confirm(`আপনি কি অপেক্ষমাণ সকল (${toBn(pendingDocs.length)}) বিষয়ের ফলাফল অনুমোদন করতে চান?`)) return;

    setBusy(true);
    setMsg("");
    try {
      const batch = writeBatch(db);
      pendingDocs.forEach(m => {
        batch.set(doc(db, "marks", m.id), {
          status: "approved",
          approvedBy: profile.name,
          approvedAt: serverTimestamp()
        }, { merge: true });
      });
      await batch.commit();
      setMsg("সকল অপেক্ষমাণ বিষয়ের ফলাফল সফলভাবে অনুমোদিত হয়েছে।");
      loadPending();
    } catch (ex) {
      console.error(ex);
      alert("অনুমোদন করা যায়নি: " + (ex.message || ex.code));
    }
    setBusy(false);
  }

  if (loading) return html`<p class="sub">নম্বর তালিকা লোড হচ্ছে…</p>`;

  const pending = list.filter(m => m.status === "submitted");
  const approved = list.filter(m => m.status === "approved");

  return html`<div style=${{ marginTop: "14px" }}>
    ${msg && html`<p class="ok">${msg}</p>`}

    <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", margin: "10px 0" }}>
      <div style=${{ fontWeight: 700, fontSize: "1.05rem", color: pending.length > 0 ? "#c62828" : "var(--ink)" }}>
        🔔 অনুমোদনের অপেক্ষায় থাকা বিষয়সমূহ (মোট: ${toBn(pending.length)} টি)
      </div>
      ${pending.length > 0 && html`<button type="button" disabled=${busy} onClick=${approveAll}
        style=${{ width: "auto", margin: 0, padding: "6px 16px", background: "var(--acc)", color: "#fff", fontWeight: 700 }}>
        ✓ সকল বিষয়ের নম্বর একসাথে অনুমোদন করুন
      </button>`}
    </div>

    ${pending.length === 0
      ? html`<div class="card"><p class="sub" style=${{ margin: 0 }}>আপাতত অনুমোদনের জন্য কোনো জমা দেওয়া নম্বর নেই। সকল বিষয় অনুমোদিত রয়েছে।</p></div>`
      : html`<div class="grid" style=${{ marginTop: 0 }}>
          ${pending.map(m => {
            const isExp = expandedId === m.id;
            const recordsList = Object.values(m.records || {}).sort((a, b) => a.roll - b.roll);

            return html`<div class="card" key=${m.id} style=${{ borderLeft: "4px solid #f9a825" }}>
              <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <b style=${{ fontSize: "1.1rem" }}>${m.termName || "মূল্যায়ন"}</b>
                  <div style=${{ color: "var(--acc)", fontWeight: 700, marginTop: "2px", fontSize: "1rem" }}>
                    ${m.className} (${m.section}) • ${m.subject}
                  </div>
                  <div style=${{ fontSize: "0.85rem", color: "var(--mute)", marginTop: "2px" }}>
                    শিক্ষক: <b>${m.updatedBy || "অজ্ঞাত"}</b> • ধারাবাহিক: ${toBn(m.contFull)} + সামষ্টিক: ${toBn(m.termFull)} = ১০০
                  </div>
                </div>
                <span class="role" style=${{ background: "#fff3cd", color: "#856404", fontWeight: 700 }}>
                  ⏳ জমা দেওয়া (${toBn(recordsList.length)} জন শিক্ষার্থী)
                </span>
              </div>

              <!-- বিস্তারিত নম্বর তালিকা প্রদর্শন -->
              <div style=${{ marginTop: "10px" }}>
                <button type="button" class="ghost" onClick=${() => setExpandedId(isExp ? null : m.id)}
                  style=${{ width: "auto", margin: 0, padding: "4px 10px", fontSize: "0.8rem", color: "var(--acc)", fontWeight: 600 }}>
                  ${isExp ? "▲ নম্বর তালিকা লুকান" : "👁️ শিক্ষার্থীর নম্বর ও গ্রেড বিস্তারিত দেখুন"}
                </button>

                ${isExp && html`<div style=${{ marginTop: "10px", overflowX: "auto", maxHeight: "280px", border: "1px solid var(--line)", borderRadius: "6px" }}>
                  <table style=${{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", textAlign: "center" }}>
                    <thead>
                      <tr style=${{ background: "var(--bg)", borderBottom: "1px solid var(--line)" }}>
                        <th style=${{ padding: "6px" }}>রোল</th>
                        <th style=${{ padding: "6px", textAlign: "left" }}>শিক্ষার্থীর নাম</th>
                        <th style=${{ padding: "6px" }}>ধারাবাহিক (${toBn(m.contFull)})</th>
                        <th style=${{ padding: "6px" }}>সামষ্টিক (${toBn(m.termFull)})</th>
                        <th style=${{ padding: "6px" }}>মোট</th>
                        <th style=${{ padding: "6px" }}>গ্রেড</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${recordsList.map(r => html`<tr key=${r.sid} style=${{ borderBottom: "1px solid var(--line)", background: r.absent ? "#fff8f8" : "#fff" }}>
                        <td style=${{ padding: "5px" }}>${toBn(r.roll)}</td>
                        <td style=${{ padding: "5px", textAlign: "left", fontWeight: 600 }}>${r.name}</td>
                        <td style=${{ padding: "5px" }}>${r.absent ? "অনুপস্থিত" : toBn(r.continuous)}</td>
                        <td style=${{ padding: "5px" }}>${r.absent ? "অনুপস্থিত" : toBn(r.terminal)}</td>
                        <td style=${{ padding: "5px", fontWeight: 700 }}>${r.absent ? "অনুপস্থিত" : toBn(r.total)}</td>
                        <td style=${{ padding: "5px", fontWeight: 700, color: r.grade === "অগ্রগতি প্রয়োজন" ? "var(--err)" : "var(--acc)" }}>
                          ${r.grade}
                        </td>
                      </tr>`)}
                    </tbody>
                  </table>
                </div>`}
              </div>

              <div style=${{ display: "flex", gap: "8px", marginTop: "14px" }}>
                <button disabled=${busy} style=${{ flex: 1, margin: 0, padding: "8px", background: "var(--acc)", color: "#fff", fontWeight: 700 }}
                  onClick=${() => updateStatus(m.id, "approved")}>
                  ✓ এই বিষয়ের নম্বর অনুমোদন করুন
                </button>
                <button type="button" class="danger" disabled=${busy} style=${{ flex: 1, margin: 0, padding: "8px" }}
                  onClick=${() => updateStatus(m.id, "draft")}>
                  ↩ সংশোধনে ফেরত পাঠান
                </button>
              </div>
            </div>`;
          })}
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
