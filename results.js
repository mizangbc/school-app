import React, { useState, useEffect, useMemo } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { db } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, setDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  DEFAULT_TERMS, DEFAULT_ANNUAL_WEIGHTS, DEFAULT_CLASS_RATIOS, DESCRIPTIVE_GRADES, LETTER_GRADES
} from "./exams.js?v=14";

const html = htm.bind(React.createElement);

const toBn = n => String(n ?? "").replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);
const bn2en = s => String(s || "").replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));

export function toBnRank(n) {
  if (!n) return "-";
  const num = parseInt(n, 10);
  const suffix = {
    1: "ম", 2: "য়", 3: "য়", 4: "র্থ", 5: "ম", 6: "ষ্ঠ", 7: "ম", 8: "ম", 9: "ম", 10: "ম"
  };
  const s = suffix[num] || "তম";
  return toBn(num) + s;
}

export function getGradeInfo(pct, gradingScale = DESCRIPTIVE_GRADES) {
  if (pct == null || isNaN(pct)) return { grade: "-", gpa: 0 };
  const p = Math.round(pct * 100) / 100;
  for (const g of gradingScale) {
    const min = g.min != null ? g.min : 0;
    const max = g.max != null ? g.max : 100;
    if (p >= min && p <= max) {
      return { grade: g.grade, gpa: parseFloat(g.gpa) || 0 };
    }
  }
  return { grade: "অগ্রগতি প্রয়োজন", gpa: 0 };
}

// ১. বিষয়ভিত্তিক মূল্যায়ন রেজিস্টার (ব্যবহারকারীর প্রদানকৃত অফিসিয়াল ১৭-কলাম ছক)
function SubjectRegisterView({ students, marksDocs, curClass, section, subject, examConfig, allSubjectAverages }) {
  const grading = examConfig?.grading || DESCRIPTIVE_GRADES;
  const weights = examConfig?.annualWeights || DEFAULT_ANNUAL_WEIGHTS;
  const w1 = ((weights.find(w => w.phase === 1)?.weight ?? 25) / 100);
  const w2 = ((weights.find(w => w.phase === 2)?.weight ?? 25) / 100);
  const w3 = ((weights.find(w => w.phase === 3)?.weight ?? 50) / 100);

  // ৩টি প্রান্তিকের ডকুমেন্ট আলাদা করা
  const term1Doc = marksDocs.find(m => m.termId === "term_1" && m.subject === subject);
  const term2Doc = marksDocs.find(m => m.termId === "term_2" && m.subject === subject);
  const term3Doc = marksDocs.find(m => m.termId === "term_3" && m.subject === subject);

  const t1Records = term1Doc?.records || {};
  const t2Records = term2Doc?.records || {};
  const t3Records = term3Doc?.records || {};

  const contFull = term1Doc?.contFull || 30;
  const termFull = term1Doc?.termFull || 70;

  // প্রতিটি শিক্ষার্থীর ১৭-কলামের সারি তৈরি
  const rows = students.map(s => {
    const r1 = t1Records[s.sid] || {};
    const r2 = t2Records[s.sid] || {};
    const r3 = t3Records[s.sid] || {};

    const t1Tot = r1.absent ? 0 : (parseFloat(r1.total) || 0);
    const t2Tot = r2.absent ? 0 : (parseFloat(r2.total) || 0);
    const t3Tot = r3.absent ? 0 : (parseFloat(r3.total) || 0);

    // প্রান্তিকের গড় নম্বর (ওয়েটেজ অনুযায়ী)
    const annualAvg = Math.round(((t1Tot * w1) + (t2Tot * w2) + (t3Tot * w3)) * 10) / 10;
    const isAnyAbsent = r1.absent || r2.absent || r3.absent;

    // বিষয় গ্রেড
    const subGradeInfo = getGradeInfo(annualAvg, grading);
    const subjectGrade = isAnyAbsent && annualAvg === 0 ? "অগ্রগতি প্রয়োজন" : subGradeInfo.grade;

    // সমন্বিত গ্রেড (শিক্ষার্থীর সকল বিষয়ের সার্বিক গড় থেকে প্রাপ্ত গ্রেড)
    const stuOverall = allSubjectAverages[s.sid] || {};
    const overallGrade = stuOverall.grade || "-";

    return {
      roll: s.roll,
      name: s.name,
      sid: s.sid,
      // ১ম প্রান্তিক
      t1_ca1: r1.ca1 ?? "",
      t1_ca2: r1.ca2 ?? "",
      t1_cont: r1.absent ? "অনুপস্থিত" : (r1.continuous ?? ""),
      t1_term: r1.absent ? "অনুপস্থিত" : (r1.terminal ?? ""),
      // ২য় প্রান্তিক
      t2_ca1: r2.ca1 ?? "",
      t2_ca2: r2.ca2 ?? "",
      t2_cont: r2.absent ? "অনুপস্থিত" : (r2.continuous ?? ""),
      t2_term: r2.absent ? "অনুপস্থিত" : (r2.terminal ?? ""),
      // ৩য় প্রান্তিক
      t3_ca1: r3.ca1 ?? "",
      t3_ca2: r3.ca2 ?? "",
      t3_cont: r3.absent ? "অনুপস্থিত" : (r3.continuous ?? ""),
      t3_term: r3.absent ? "অনুপস্থিত" : (r3.terminal ?? ""),
      // চূড়ান্ত
      annualAvg,
      subjectGrade,
      overallGrade
    };
  });

  // CSV ফাইল এক্সপোর্ট (ব্যবহারকারীর হুবহু ছকে)
  function exportCsv() {
    const headerRow1 = `বিষয়: ${subject},,,,,,,,,,,,,,,,`;
    const headerRow2 = `,,১ম প্রান্তিক মূল্যায়ন,,,,২য় প্রান্তিক মূল্যায়ন,,,,৩য় প্রান্তিক মূল্যায়ন,,,,চূড়ান্ত ফলাফল,,`;
    const headerRow3 = `রোল নং,নাম,ধারা মূ-১ (২০),ধারা মূ-২ (২০),ধারাবাহিক নম্বর (${contFull}),সামষ্টিক নম্বর (${termFull}),ধারা মূ-১ (২০),ধারা মূ-২ (২০),ধারাবাহিক নম্বর (${contFull}),সামষ্টিক নম্বর (${termFull}),ধারা মূ-১ (২০),ধারা মূ-২ (২০),ধারাবাহিক নম্বর (${contFull}),সামষ্টিক নম্বর (${termFull}),প্রান্তিকের গড় নম্বর,বিষয় গ্রেড,সমন্বিত গ্রেড`;

    const dataRows = rows.map(r => [
      r.roll,
      `"${r.name}"`,
      r.t1_ca1, r.t1_ca2, r.t1_cont, r.t1_term,
      r.t2_ca1, r.t2_ca2, r.t2_cont, r.t2_term,
      r.t3_ca1, r.t3_ca2, r.t3_cont, r.t3_term,
      r.annualAvg,
      `"${r.subjectGrade}"`,
      `"${r.overallGrade}"`
    ].join(","));

    const csvContent = "\uFEFF" + [headerRow1, headerRow2, headerRow3, ...dataRows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `register_${subject}_${curClass?.name || ""}_${section}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return html`<div class="card print-area" style=${{ padding: "12px 8px" }}>
    <div class="no-print" style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
      <div>
        <b style=${{ fontSize: "1.1rem" }}>বিষয়ভিত্তিক মূল্যায়ন রেজিস্টার: ${subject}</b>
        <div style=${{ fontSize: "0.85rem", color: "var(--mute)" }}>
          শ্রেণি: ${curClass?.name || ""} (${section}) • শিক্ষার্থী: ${toBn(students.length)} জন
        </div>
      </div>
      <div style=${{ display: "flex", gap: "8px" }}>
        <button type="button" class="ghost" onClick=${exportCsv}
          style=${{ width: "auto", margin: 0, padding: "6px 14px", fontSize: "0.85rem", borderColor: "var(--acc)", color: "var(--acc)", fontWeight: 600 }}>
          📥 Excel / CSV রেজিস্টার ডাউনলোড
        </button>
        <button type="button" onClick=${() => window.print()}
          style=${{ width: "auto", margin: 0, padding: "6px 14px", fontSize: "0.85rem", background: "var(--acc)", color: "#fff" }}>
          🖨️ রেজিস্টার প্রিন্ট
        </button>
      </div>
    </div>

    <div style=${{ textAlign: "center", marginBottom: "12px", paddingBottom: "6px", borderBottom: "2px solid var(--acc)" }}>
      <div style=${{ fontSize: "1.2rem", fontWeight: 800, color: "var(--acc)" }}>এস. এম. মডেল সরকারি প্রাথমিক বিদ্যালয়</div>
      <div style=${{ fontSize: "0.88rem", color: "var(--mute)" }}>গোপালগঞ্জ সদর, গোপালগঞ্জ</div>
      <b style=${{ fontSize: "0.98rem", display: "inline-block", marginTop: "2px" }}>
        বিষয়ভিত্তিক মূল্যায়ন রেজিস্টার — ২০২৬
      </b>
      <div style=${{ fontSize: "0.85rem", marginTop: "2px" }}>
        বিষয়: <b>${subject}</b> | শ্রেণি: <b>${curClass?.name || ""}</b> | শাখা: <b>${section}</b>
      </div>
    </div>

    <div style=${{ overflowX: "auto" }}>
      <table style=${{ width: "100%", borderCollapse: "collapse", minWidth: "900px", fontSize: "0.82rem" }}>
        <thead>
          <tr style=${{ background: "var(--bg)", borderBottom: "1px solid var(--line)", textAlign: "center" }}>
            <th colSpan="2" style=${{ border: "1px solid var(--line)", padding: "6px" }}>শিক্ষার্থী</th>
            <th colSpan="4" style=${{ border: "1px solid var(--line)", padding: "6px", background: "#e8f5e9", color: "#1f7a5a" }}>১ম প্রান্তিক মূল্যায়ন</th>
            <th colSpan="4" style=${{ border: "1px solid var(--line)", padding: "6px", background: "#e3f2fd", color: "#1565c0" }}>২য় প্রান্তিক মূল্যায়ন</th>
            <th colSpan="4" style=${{ border: "1px solid var(--line)", padding: "6px", background: "#fff3e0", color: "#e65100" }}>৩য় প্রান্তিক মূল্যায়ন</th>
            <th colSpan="3" style=${{ border: "1px solid var(--line)", padding: "6px", background: "#f3e5f5", color: "#6a1b9a" }}>চূড়ান্ত ফলাফল</th>
          </tr>
          <tr style=${{ background: "#fafafa", borderBottom: "2px solid var(--line)", textAlign: "center", fontSize: "0.78rem" }}>
            <th style=${{ border: "1px solid var(--line)", padding: "6px 2px", width: "35px" }}>রোল</th>
            <th style=${{ border: "1px solid var(--line)", padding: "6px 4px", textAlign: "left", minWidth: "110px" }}>নাম</th>

            <th style=${{ border: "1px solid var(--line)", padding: "4px" }}>ধারা ১ (২০)</th>
            <th style=${{ border: "1px solid var(--line)", padding: "4px" }}>ধারা ২ (২০)</th>
            <th style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700 }}>ধারাবাহিক (${toBn(contFull)})</th>
            <th style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700 }}>সামষ্টিক (${toBn(termFull)})</th>

            <th style=${{ border: "1px solid var(--line)", padding: "4px" }}>ধারা ১ (২০)</th>
            <th style=${{ border: "1px solid var(--line)", padding: "4px" }}>ধারা ২ (২০)</th>
            <th style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700 }}>ধারাবাহিক (${toBn(contFull)})</th>
            <th style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700 }}>সামষ্টিক (${toBn(termFull)})</th>

            <th style=${{ border: "1px solid var(--line)", padding: "4px" }}>ধারা ১ (২০)</th>
            <th style=${{ border: "1px solid var(--line)", padding: "4px" }}>ধারা ২ (২০)</th>
            <th style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700 }}>ধারাবাহিক (${toBn(contFull)})</th>
            <th style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700 }}>সামষ্টিক (${toBn(termFull)})</th>

            <th style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700, background: "#f3e5f5" }}>প্রান্তিকের গড়</th>
            <th style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700, background: "#f3e5f5" }}>বিষয় গ্রেড</th>
            <th style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700, background: "#f3e5f5", color: "var(--acc)" }}>সমন্বিত গ্রেড</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => html`<tr key=${r.sid} style=${{ borderBottom: "1px solid var(--line)", textAlign: "center" }}>
            <td style=${{ border: "1px solid var(--line)", padding: "6px 2px", fontWeight: 700 }}>${toBn(r.roll)}</td>
            <td style=${{ border: "1px solid var(--line)", padding: "6px 4px", textAlign: "left", fontWeight: 600 }}>${r.name}</td>

            <td style=${{ border: "1px solid var(--line)", padding: "4px" }}>${toBn(r.t1_ca1)}</td>
            <td style=${{ border: "1px solid var(--line)", padding: "4px" }}>${toBn(r.t1_ca2)}</td>
            <td style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700, background: "#f9fcf9" }}>${toBn(r.t1_cont)}</td>
            <td style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700, background: "#f9fcf9" }}>${toBn(r.t1_term)}</td>

            <td style=${{ border: "1px solid var(--line)", padding: "4px" }}>${toBn(r.t2_ca1)}</td>
            <td style=${{ border: "1px solid var(--line)", padding: "4px" }}>${toBn(r.t2_ca2)}</td>
            <td style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700, background: "#f9fbfd" }}>${toBn(r.t2_cont)}</td>
            <td style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700, background: "#f9fbfd" }}>${toBn(r.t2_term)}</td>

            <td style=${{ border: "1px solid var(--line)", padding: "4px" }}>${toBn(r.t3_ca1)}</td>
            <td style=${{ border: "1px solid var(--line)", padding: "4px" }}>${toBn(r.t3_ca2)}</td>
            <td style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700, background: "#fdfbf9" }}>${toBn(r.t3_cont)}</td>
            <td style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700, background: "#fdfbf9" }}>${toBn(r.t3_term)}</td>

            <td style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700, background: "#faf5fb" }}>${toBn(r.annualAvg)}</td>
            <td style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 700, background: "#faf5fb" }}>${r.subjectGrade}</td>
            <td style=${{ border: "1px solid var(--line)", padding: "4px", fontWeight: 800, background: "#f3e5f5", color: "var(--acc)" }}>${r.overallGrade}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>

    <div style=${{
      display: "flex",
      justifyContent: "space-between",
      marginTop: "30px",
      paddingTop: "12px",
      borderTop: "1px dashed var(--line)",
      textAlign: "center",
      fontSize: "0.85rem",
      color: "var(--mute)"
    }}>
      <div>
        <div style=${{ borderTop: "1px solid #777", width: "130px", margin: "0 auto 4px" }}></div>
        বিষয় শিক্ষকের স্বাক্ষর
      </div>
      <div>
        <div style=${{ borderTop: "1px solid #777", width: "130px", margin: "0 auto 4px" }}></div>
        শ্রেণি শিক্ষকের স্বাক্ষর
      </div>
      <div>
        <div style=${{ borderTop: "1px solid #777", width: "130px", margin: "0 auto 4px" }}></div>
        প্রধান শিক্ষকের স্বাক্ষর ও সিল
      </div>
    </div>
  </div>`;
}

// ২. শ্রেণিভিত্তিক সামগ্রিক ফলাফল শিট (সকল বিষয় একত্রিত ট্যাবুলেশন শিট)
function ConsolidatedTabulationView({ students, marksDocs, curClass, section, subjects, examConfig, termOption, onSelectStudent }) {
  const grading = examConfig?.grading || DESCRIPTIVE_GRADES;
  const weights = examConfig?.annualWeights || DEFAULT_ANNUAL_WEIGHTS;
  const showGpa = examConfig?.displayOptions?.showGpa ?? false;

  const w1 = ((weights.find(w => w.phase === 1)?.weight ?? 25) / 100);
  const w2 = ((weights.find(w => w.phase === 2)?.weight ?? 25) / 100);
  const w3 = ((weights.find(w => w.phase === 3)?.weight ?? 50) / 100);

  // মার্কস ডকুমেন্টের ম্যাপ তৈরি: [termId_subject] -> doc
  const marksMap = {};
  (marksDocs || []).forEach(d => {
    marksMap[`${d.termId}_${d.subject}`] = d;
  });

  const studentResults = students.map(s => {
    const res = {
      sid: s.sid,
      roll: s.roll,
      name: s.name,
      subjects: {},
      totalScore: 0,
      totalFull: 0,
      pass: true
    };

    let totalGpa = 0;
    let subCount = 0;

    subjects.forEach(sub => {
      let subScore = 0;
      let isAbsent = false;

      if (termOption === "annual") {
        const m1 = marksMap[`term_1_${sub}`]?.records?.[s.sid];
        const m2 = marksMap[`term_2_${sub}`]?.records?.[s.sid];
        const m3 = marksMap[`term_3_${sub}`]?.records?.[s.sid];

        const s1 = m1 && !m1.absent ? (parseFloat(m1.total) || 0) : 0;
        const s2 = m2 && !m2.absent ? (parseFloat(m2.total) || 0) : 0;
        const s3 = m3 && !m3.absent ? (parseFloat(m3.total) || 0) : 0;

        if (m1?.absent || m2?.absent || m3?.absent) isAbsent = true;
        subScore = Math.round(((s1 * w1) + (s2 * w2) + (s3 * w3)) * 10) / 10;
      } else {
        const mRec = marksMap[`${termOption}_${sub}`]?.records?.[s.sid];
        isAbsent = !!mRec?.absent;
        subScore = (!isAbsent && mRec?.total != null) ? (parseFloat(mRec.total) || 0) : 0;
      }

      const gInfo = getGradeInfo(subScore, grading);
      if (subScore < (examConfig?.passMarkPercent ?? 33) || isAbsent) {
        res.pass = false;
      }

      res.subjects[sub] = {
        score: subScore,
        absent: isAbsent,
        grade: gInfo.grade,
        gpa: gInfo.gpa
      };

      res.totalScore += subScore;
      res.totalFull += 100;
      totalGpa += gInfo.gpa;
      subCount++;
    });

    const avgPct = res.totalFull > 0 ? (res.totalScore / res.totalFull) * 100 : 0;
    res.avgPct = Math.round(avgPct * 10) / 10;
    const overallGInfo = getGradeInfo(res.avgPct, grading);
    res.grade = res.pass ? overallGInfo.grade : "অগ্রগতি প্রয়োজন";
    res.gpa = (subCount > 0 && res.pass) ? Math.round((totalGpa / subCount) * 100) / 100 : 0.0;

    return res;
  });

  // মেধা স্থান (Rank) নির্ধারণ
  const passStudents = studentResults.filter(r => r.pass).sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.gpa !== a.gpa) return b.gpa - a.gpa;
    return a.roll - b.roll;
  });

  passStudents.forEach((r, idx) => {
    r.rank = idx + 1;
    r.rankBn = toBnRank(idx + 1);
  });

  studentResults.filter(r => !r.pass).forEach(r => {
    r.rank = null;
    r.rankBn = "-";
  });

  studentResults.sort((a, b) => a.roll - b.roll);

  return html`<div class="card print-area" style=${{ padding: "12px 8px" }}>
    <div style=${{ textAlign: "center", marginBottom: "14px", paddingBottom: "8px", borderBottom: "2px solid var(--acc)" }}>
      <div style=${{ fontSize: "1.25rem", fontWeight: 800, color: "var(--acc)" }}>এস. এম. মডেল সরকারি প্রাথমিক বিদ্যালয়</div>
      <div style=${{ fontSize: "0.9rem", color: "var(--mute)" }}>গোপালগঞ্জ সদর, গোপালগঞ্জ</div>
      <b style=${{ fontSize: "1rem", display: "inline-block", marginTop: "4px" }}>
        সামগ্রিক ফলাফল শিট ও ট্যাবুলেশন — ২০২৬
      </b>
      <div style=${{ fontSize: "0.88rem", marginTop: "2px" }}>
        শ্রেণি: <b>${curClass?.name || ""}</b> | শাখা: <b>${section}</b> | মূল্যায়ন: <b>${termOption === "annual" ? "বার্ষিক সমন্বিত ফলাফল" : DEFAULT_TERMS.find(t => t.id === termOption)?.name}</b>
      </div>
    </div>

    <div style=${{ overflowX: "auto" }}>
      <table style=${{ width: "100%", borderCollapse: "collapse", minWidth: "650px", fontSize: "0.85rem" }}>
        <thead>
          <tr style=${{ background: "var(--bg)", borderBottom: "2px solid var(--line)", textAlign: "center" }}>
            <th style=${{ padding: "8px 4px", width: "40px" }}>রোল</th>
            <th style=${{ padding: "8px 6px", textAlign: "left", minWidth: "120px" }}>শিক্ষার্থীর নাম</th>
            ${subjects.map(s => html`<th key=${s} style=${{ padding: "8px 4px", minWidth: "50px" }}>${s}</th>`)}
            <th style=${{ padding: "8px 4px", width: "55px", fontWeight: 700 }}>মোট</th>
            <th style=${{ padding: "8px 4px", width: "48px" }}>গড় %</th>
            <th style=${{ padding: "8px 4px", width: "70px", fontWeight: 700 }}>সমন্বিত গ্রেড</th>
            ${showGpa && html`<th style=${{ padding: "8px 4px", width: "45px" }}>জিপিএ</th>`}
            <th style=${{ padding: "8px 4px", width: "50px" }}>মেধা</th>
            <th class="no-print" style=${{ padding: "8px 4px", width: "65px" }}>মার্কশিট</th>
          </tr>
        </thead>
        <tbody>
          ${studentResults.map(r => html`<tr key=${r.sid} style=${{ borderBottom: "1px solid var(--line)", textAlign: "center" }}>
            <td style=${{ padding: "8px 4px", fontWeight: 700 }}>${toBn(r.roll)}</td>
            <td style=${{ padding: "8px 6px", textAlign: "left", fontWeight: 600 }}>${r.name}</td>
            ${subjects.map(sub => {
              const s = r.subjects[sub];
              return html`<td key=${sub} style=${{ padding: "8px 4px" }}>
                ${s?.absent
                  ? html`<span style=${{ color: "var(--err)", fontSize: "0.78rem" }}>অনুপস্থিত</span>`
                  : toBn(s?.score ?? 0)}
              </td>`;
            })}
            <td style=${{ padding: "8px 4px", fontWeight: 700, color: "var(--acc)" }}>${toBn(r.totalScore)}</td>
            <td style=${{ padding: "8px 4px" }}>${toBn(r.avgPct)}%</td>
            <td style=${{ padding: "8px 4px", fontWeight: 700, color: r.grade === "অগ্রগতি প্রয়োজন" ? "var(--err)" : "var(--acc)" }}>
              ${r.grade}
            </td>
            ${showGpa && html`<td style=${{ padding: "8px 4px" }}>${toBn(r.gpa.toFixed(2))}</td>`}
            <td style=${{ padding: "8px 4px", fontWeight: 700, color: "var(--acc)" }}>${r.rankBn}</td>
            <td class="no-print" style=${{ padding: "8px 4px" }}>
              <button type="button" class="ghost"
                style=${{ padding: "3px 8px", fontSize: "0.8rem", width: "auto", margin: 0 }}
                onClick=${() => onSelectStudent(r)}>
                দেখুন
              </button>
            </td>
          </tr>`)}
        </tbody>
      </table>
    </div>

    <div style=${{
      display: "flex",
      justifyContent: "space-between",
      marginTop: "30px",
      paddingTop: "12px",
      borderTop: "1px dashed var(--line)",
      textAlign: "center",
      fontSize: "0.85rem",
      color: "var(--mute)"
    }}>
      <div>
        <div style=${{ borderTop: "1px solid #777", width: "130px", margin: "0 auto 4px" }}></div>
        শ্রেণি শিক্ষকের স্বাক্ষর
      </div>
      <div>
        <div style=${{ borderTop: "1px solid #777", width: "130px", margin: "0 auto 4px" }}></div>
        ফলাফল প্রস্তুতকারীর স্বাক্ষর
      </div>
      <div>
        <div style=${{ borderTop: "1px solid #777", width: "130px", margin: "0 auto 4px" }}></div>
        প্রধান শিক্ষকের স্বাক্ষর ও সিল
      </div>
    </div>
  </div>`;
}

// ৩. ব্যক্তিগত মার্কশিট উপাদান (রিপোর্ট কার্ড)
export function MarksheetCard({ student, evalName, className, section, examConfig, onClose }) {
  const showGpa = examConfig?.displayOptions?.showGpa ?? false;
  const showMarks = examConfig?.displayOptions?.showMarks ?? true;
  const subjects = Object.keys(student.subjects || {});

  return html`<div class="marksheet-box" style=${{
    background: "#fff",
    border: "2px solid #1f7a5a",
    borderRadius: "12px",
    padding: "20px 24px",
    marginTop: "14px",
    position: "relative",
    color: "#222",
    boxShadow: "0 4px 14px rgba(0,0,0,0.08)"
  }}>
    <div class="no-print" style=${{ display: "flex", justifyContent: "space-between", marginBottom: "14px", gap: "10px", flexWrap: "wrap" }}>
      ${onClose && html`<button type="button" class="ghost" onClick=${onClose} style=${{ width: "auto", margin: 0, padding: "6px 14px" }}>
        ← তালিকায় ফিরুন
      </button>`}
      <button type="button" onClick=${() => window.print()} style=${{ width: "auto", margin: 0, padding: "6px 18px", background: "var(--acc)", color: "#fff", fontWeight: 600 }}>
        🖨️ মার্কশিট প্রিন্ট / ডাউনলোড
      </button>
    </div>

    <div style=${{ textAlign: "center", borderBottom: "2px solid #1f7a5a", paddingBottom: "12px", marginBottom: "16px" }}>
      <div style=${{ fontSize: "0.95rem", color: "#555", fontWeight: 600 }}>গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</div>
      <div style=${{ fontSize: "1.45rem", fontWeight: 800, color: "#1f7a5a", margin: "2px 0" }}>
        এস. এম. মডেল সরকারি প্রাথমিক বিদ্যালয়
      </div>
      <div style=${{ fontSize: "0.9rem", color: "#666" }}>গোপালগঞ্জ সদর, গোপালগঞ্জ | স্থাপিত: ১৯২৯ খ্রি.</div>
      <div style=${{
        display: "inline-block",
        marginTop: "8px",
        padding: "4px 16px",
        background: "#e8f5e9",
        color: "#1f7a5a",
        borderRadius: "20px",
        fontWeight: 700,
        fontSize: "1rem"
      }}>
        শিক্ষার্থীর মূল্যায়ন প্রতিবেদন ও নম্বরপত্র — ২০২৬
      </div>
    </div>

    <div style=${{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      gap: "8px",
      background: "#f8fbf9",
      padding: "12px 14px",
      borderRadius: "8px",
      marginBottom: "16px",
      border: "1px solid #e0ede6",
      fontSize: "0.92rem"
    }}>
      <div><b>শিক্ষার্থীর নাম:</b> ${student.name}</div>
      <div><b>রোল নম্বর:</b> ${toBn(student.roll)}</div>
      <div><b>শ্রেণি:</b> ${className}</div>
      <div><b>শাখা:</b> ${section}</div>
      <div><b>আইডি (SID):</b> ${student.sid}</div>
      <div><b>মূল্যায়ন:</b> ${evalName}</div>
    </div>

    <div style=${{ overflowX: "auto" }}>
      <table style=${{ width: "100%", borderCollapse: "collapse", minWidth: "480px", marginBottom: "16px" }}>
        <thead>
          <tr style=${{ background: "#e8f5e9", borderBottom: "2px solid #1f7a5a", textAlign: "left" }}>
            <th style=${{ padding: "8px 10px", fontSize: "0.9rem" }}>বিষয়</th>
            <th style=${{ padding: "8px 10px", fontSize: "0.9rem", textAlign: "center" }}>পূর্ণমান</th>
            ${showMarks && html`<th style=${{ padding: "8px 10px", fontSize: "0.9rem", textAlign: "center" }}>প্রাপ্ত নম্বর</th>`}
            <th style=${{ padding: "8px 10px", fontSize: "0.9rem", textAlign: "center" }}>শতকরা (%)</th>
            <th style=${{ padding: "8px 10px", fontSize: "0.9rem", textAlign: "center" }}>অর্জিত মান / গ্রেড</th>
            ${showGpa && html`<th style=${{ padding: "8px 10px", fontSize: "0.9rem", textAlign: "center" }}>জিপিএ</th>`}
          </tr>
        </thead>
        <tbody>
          ${subjects.map((sub, i) => {
            const s = student.subjects[sub] || {};
            return html`<tr key=${sub} style=${{ borderBottom: "1px solid #eee", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
              <td style=${{ padding: "8px 10px", fontWeight: 600 }}>${sub}</td>
              <td style=${{ padding: "8px 10px", textAlign: "center" }}>১০০</td>
              ${showMarks && html`<td style=${{ padding: "8px 10px", textAlign: "center", fontWeight: 700 }}>
                ${s.absent ? html`<span style=${{ color: "var(--err)" }}>অনুপস্থিত</span>` : toBn(s.score)}
              </td>`}
              <td style=${{ padding: "8px 10px", textAlign: "center" }}>${s.absent ? "-" : `${toBn(s.score)}%`}</td>
              <td style=${{ padding: "8px 10px", textAlign: "center", fontWeight: 700, color: s.grade === "অগ্রগতি প্রয়োজন" ? "var(--err)" : "#1f7a5a" }}>
                ${s.grade}
              </td>
              ${showGpa && html`<td style=${{ padding: "8px 10px", textAlign: "center" }}>
                ${s.absent ? "0.00" : toBn(s.gpa.toFixed(2))}
              </td>`}
            </tr>`;
          })}
        </tbody>
        <tfoot>
          <tr style=${{ background: "#f0f7f3", borderTop: "2px solid #1f7a5a", fontWeight: 700 }}>
            <td style=${{ padding: "10px" }}>সর্বমোট / গড়</td>
            <td style=${{ padding: "10px", textAlign: "center" }}>${toBn(student.totalFull)}</td>
            ${showMarks && html`<td style=${{ padding: "10px", textAlign: "center", color: "#1f7a5a" }}>${toBn(student.totalScore)}</td>`}
            <td style=${{ padding: "10px", textAlign: "center" }}>${toBn(student.avgPct)}%</td>
            <td style=${{ padding: "10px", textAlign: "center", color: student.grade === "অগ্রগতি প্রয়োজন" ? "var(--err)" : "#1f7a5a" }}>
              ${student.grade}
            </td>
            ${showGpa && html`<td style=${{ padding: "10px", textAlign: "center" }}>
              ${toBn(student.gpa.toFixed(2))}
            </td>`}
          </tr>
        </tfoot>
      </table>
    </div>

    <div style=${{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
      gap: "10px",
      background: student.pass ? "#f1f8e9" : "#ffebee",
      padding: "14px 16px",
      borderRadius: "8px",
      border: `1px solid ${student.pass ? "#c8e6c9" : "#ffcdd2"}`,
      marginBottom: "36px",
      textAlign: "center"
    }}>
      <div>
        <div style=${{ fontSize: "0.85rem", color: "#666" }}>ফলাফল</div>
        <b style=${{ fontSize: "1.1rem", color: student.pass ? "#2e7d32" : "#c62828" }}>${student.pass ? "উত্তীর্ণ" : "অকৃতকার্য"}</b>
      </div>
      <div>
        <div style=${{ fontSize: "0.85rem", color: "#666" }}>শাখা মেধা স্থান</div>
        <b style=${{ fontSize: "1.1rem", color: "#1f7a5a" }}>${student.rankBn || "-"}</b>
      </div>
      <div>
        <div style=${{ fontSize: "0.85rem", color: "#666" }}>সমন্বিত অর্জিত মান</div>
        <b style=${{ fontSize: "1.1rem" }}>${student.grade}</b>
      </div>
      ${showGpa && html`<div>
        <div style=${{ fontSize: "0.85rem", color: "#666" }}>গড় জিপিএ</div>
        <b style=${{ fontSize: "1.1rem" }}>${toBn(student.gpa.toFixed(2))}</b>
      </div>`}
    </div>

    <div style=${{
      display: "flex",
      justifyContent: "space-between",
      marginTop: "40px",
      paddingTop: "16px",
      borderTop: "1px dashed #bbb",
      textAlign: "center",
      fontSize: "0.88rem",
      color: "#555"
    }}>
      <div style=${{ flex: 1 }}>
        <div style=${{ borderTop: "1px solid #777", width: "130px", margin: "0 auto 4px" }}></div>
        শ্রেণি শিক্ষকের স্বাক্ষর
      </div>
      <div style=${{ flex: 1 }}>
        <div style=${{ borderTop: "1px solid #777", width: "130px", margin: "0 auto 4px" }}></div>
        অভিভাবকের স্বাক্ষর
      </div>
      <div style=${{ flex: 1 }}>
        <div style=${{ borderTop: "1px solid #777", width: "130px", margin: "0 auto 4px" }}></div>
        প্রধান শিক্ষকের স্বাক্ষর ও সিল
      </div>
    </div>
  </div>`;
}

// ৪. মূল ফলাফল ভিউ (রেজিস্টার, ট্যাবুলেশন শিট, মার্কশিট ও প্রকাশ)
export function ResultsView({ profile }) {
  const isAdmin = profile.role === "main_admin" || profile.role === "assistant_admin";
  const [viewMode, setViewMode] = useState("register"); // "register" | "consolidated" | "publish"

  const [structure, setStructure] = useState([]);
  const [examConfig, setExamConfig] = useState(null);
  const [publishStatus, setPublishStatus] = useState({});

  const [classId, setClassId] = useState("");
  const [section, setSection] = useState("");
  const [subject, setSubject] = useState("");
  const [termOption, setTermOption] = useState("annual"); // "annual" | "term_1" | "term_2" | "term_3"

  const [students, setStudents] = useState([]);
  const [marksDocs, setMarksDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);

  const [publishMsg, setPublishMsg] = useState("");
  const [publishBusy, setPublishBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, "config", "structure")),
      getDoc(doc(db, "config", "exams")),
      getDoc(doc(db, "config", "publish"))
    ]).then(([sSnap, eSnap, pSnap]) => {
      if (sSnap.exists() && sSnap.data().classes) {
        const cls = sSnap.data().classes;
        setStructure(cls);
        if (cls.length > 0) {
          setClassId(cls[0].id);
          setSection(cls[0].sections[0] || "");
          setSubject(cls[0].subjects[0] || "");
        }
      }
      if (eSnap.exists()) setExamConfig(eSnap.data());
      if (pSnap.exists()) setPublishStatus(pSnap.data().published || {});
    });
  }, []);

  const curClass = structure.find(c => c.id === classId);
  const subjects = curClass?.subjects || [];

  async function loadData() {
    if (!classId || !section) return;
    setLoading(true);
    setSelectedStudent(null);
    try {
      const stuQ = query(
        collection(db, "students"),
        where("classId", "==", classId),
        where("section", "==", section)
      );
      const stuSnap = await getDocs(stuQ);
      const stuList = stuSnap.docs.map(d => d.data()).sort((a, b) => a.roll - b.roll);

      const marksQ = query(
        collection(db, "marks"),
        where("classId", "==", classId),
        where("section", "==", section)
      );
      const mSnap = await getDocs(marksQ);
      const mList = mSnap.docs.map(d => d.data());

      setStudents(stuList);
      setMarksDocs(mList);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (classId && section) loadData();
  }, [classId, section]);

  // শিক্ষার্থীর সকল বিষয়ের গড় হিসাব (সমন্বিত গ্রেড নির্ধারণের জন্য)
  const allSubjectAverages = useMemo(() => {
    const map = {};
    if (students.length === 0 || subjects.length === 0) return map;

    const grading = examConfig?.grading || DESCRIPTIVE_GRADES;
    const weights = examConfig?.annualWeights || DEFAULT_ANNUAL_WEIGHTS;
    const w1 = ((weights.find(w => w.phase === 1)?.weight ?? 25) / 100);
    const w2 = ((weights.find(w => w.phase === 2)?.weight ?? 25) / 100);
    const w3 = ((weights.find(w => w.phase === 3)?.weight ?? 50) / 100);

    const mDocsByTermSub = {};
    marksDocs.forEach(d => {
      mDocsByTermSub[`${d.termId}_${d.subject}`] = d;
    });

    students.forEach(s => {
      let stuGrandTotal = 0;
      let totalFull = subjects.length * 100;
      let hasFail = false;

      subjects.forEach(sub => {
        const m1 = mDocsByTermSub[`term_1_${sub}`]?.records?.[s.sid];
        const m2 = mDocsByTermSub[`term_2_${sub}`]?.records?.[s.sid];
        const m3 = mDocsByTermSub[`term_3_${sub}`]?.records?.[s.sid];

        const s1 = m1 && !m1.absent ? (parseFloat(m1.total) || 0) : 0;
        const s2 = m2 && !m2.absent ? (parseFloat(m2.total) || 0) : 0;
        const s3 = m3 && !m3.absent ? (parseFloat(m3.total) || 0) : 0;

        const subAvg = (s1 * w1) + (s2 * w2) + (s3 * w3);
        stuGrandTotal += subAvg;

        if (subAvg < (examConfig?.passMarkPercent ?? 33) || m1?.absent || m2?.absent || m3?.absent) {
          hasFail = true;
        }
      });

      const avgPct = totalFull > 0 ? (stuGrandTotal / totalFull) * 100 : 0;
      const gInfo = getGradeInfo(avgPct, grading);
      map[s.sid] = {
        total: Math.round(stuGrandTotal * 10) / 10,
        avgPct: Math.round(avgPct * 10) / 10,
        grade: hasFail ? "অগ্রগতি প্রয়োজন" : gInfo.grade
      };
    });

    return map;
  }, [students, marksDocs, subjects, examConfig]);

  // অনলাইনে ফলাফল প্রকাশ/স্থগিত
  async function togglePublish(termKey, isPublished) {
    setPublishBusy(true);
    setPublishMsg("");
    try {
      const newStatus = { ...publishStatus, [termKey]: isPublished };
      await setDoc(doc(db, "config", "publish"), {
        published: newStatus,
        updatedAt: serverTimestamp(),
        updatedBy: profile.name
      }, { merge: true });

      setPublishStatus(newStatus);
      setPublishMsg(isPublished ? "ফলাফল সফলভাবে অনলাইনে প্রকাশ করা হয়েছে।" : "ফলাফল অপ্রকাশিত করা হয়েছে।");
    } catch (e) {
      console.error(e);
      setPublishMsg("সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।");
    }
    setPublishBusy(false);
  }

  return html`<div style=${{ marginTop: "14px" }}>
    <div class="no-print" style=${{ display: "flex", gap: "8px", borderBottom: "2px solid var(--line)", paddingBottom: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
      <button class=${viewMode === "register" ? "primary" : "ghost"}
        style=${{ width: "auto", margin: 0, padding: "8px 16px" }}
        onClick=${() => { setViewMode("register"); setSelectedStudent(null); }}>
        বিষয় রেজিস্টার (১৭ কলাম)
      </button>
      <button class=${viewMode === "consolidated" ? "primary" : "ghost"}
        style=${{ width: "auto", margin: 0, padding: "8px 16px" }}
        onClick=${() => { setViewMode("consolidated"); setSelectedStudent(null); }}>
        সামগ্রিক ট্যাবুলেশন শিট
      </button>
      ${isAdmin && html`<button class=${viewMode === "publish" ? "primary" : "ghost"}
        style=${{ width: "auto", margin: 0, padding: "8px 16px" }}
        onClick=${() => setViewMode("publish")}>
        অনলাইন প্রকাশ নিয়ন্ত্রণ
      </button>`}
    </div>

    ${viewMode === "publish" && isAdmin && html`<div class="card" style=${{ marginBottom: "16px" }}>
      <h3 style=${{ margin: "0 0 10px", fontSize: "1.1rem" }}>অনলাইনে ফলাফল প্রকাশ নিয়ন্ত্রণ</h3>
      <p class="sub" style=${{ margin: "0 0 14px", fontSize: "0.88rem" }}>
        এখানে যে প্রান্তিকের সুইচ অন করবেন, শিক্ষার্থী ও অভিভাবকরা লগইন ছাড়াই রোল নম্বর দিয়ে অনলাইন মার্কশিট দেখতে পাবেন:
      </p>

      ${publishMsg && html`<p class="ok" style=${{ marginBottom: "12px" }}>${publishMsg}</p>`}

      <div style=${{ display: "grid", gap: "10px" }}>
        ${[...DEFAULT_TERMS, { id: "annual", name: "বার্ষিক চূড়ান্ত ফলাফল" }].map(t => {
          const isPub = !!publishStatus[t.id];
          return html`<div key=${t.id} style=${{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "10px 14px", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--line)"
          }}>
            <div>
              <b style=${{ fontSize: "0.95rem" }}>${t.name}</b>
              <div style=${{ fontSize: "0.8rem", color: isPub ? "var(--acc)" : "var(--mute)" }}>
                ${isPub ? "● অনলাইনে উন্মুক্ত আছে" : "○ অপ্রকাশিত"}
              </div>
            </div>
            <button disabled=${publishBusy}
              class=${isPub ? "danger" : "ghost"}
              style=${{ width: "auto", margin: 0, padding: "6px 14px", fontSize: "0.85rem" }}
              onClick=${() => togglePublish(t.id, !isPub)}>
              ${isPub ? "বন্ধ করুন" : "প্রকাশ করুন"}
            </button>
          </div>`;
        })}
      </div>
    </div>`}

    ${(viewMode === "register" || viewMode === "consolidated") && html`<div>
      <div class="card no-print" style=${{ marginBottom: "14px" }}>
        <div style=${{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
          <div>
            <label style=${{ margin: "0 0 4px" }}>শ্রেণি</label>
            <select value=${classId} onChange=${e => {
              const cid = e.target.value; setClassId(cid);
              const cl = structure.find(c => c.id === cid);
              if (cl) {
                setSection(cl.sections[0] || "");
                setSubject(cl.subjects[0] || "");
              }
            }} style=${{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--line)" }}>
              ${structure.map(c => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}
            </select>
          </div>

          <div>
            <label style=${{ margin: "0 0 4px" }}> শাখা</label>
            <select value=${section} onChange=${e => setSection(e.target.value)}
              style=${{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--line)" }}>
              ${(curClass?.sections || []).map(s => html`<option key=${s} value=${s}>${s}</option>`)}
            </select>
          </div>

          ${viewMode === "register" && html`<div>
            <label style=${{ margin: "0 0 4px" }}>বিষয়</label>
            <select value=${subject} onChange=${e => setSubject(e.target.value)}
              style=${{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--line)", fontWeight: 600 }}>
              ${(curClass?.subjects || []).map(sub => html`<option key=${sub} value=${sub}>${sub}</option>`)}
            </select>
          </div>`}

          ${viewMode === "consolidated" && html`<div>
            <label style=${{ margin: "0 0 4px" }}>মূল্যায়ন</label>
            <select value=${termOption} onChange=${e => { setTermOption(e.target.value); setSelectedStudent(null); }}
              style=${{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--line)", fontWeight: 600 }}>
              <option value="annual">বার্ষিক সমন্বিত ফলাফল</option>
              ${DEFAULT_TERMS.map(t => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
            </select>
          </div>`}
        </div>

        <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", flexWrap: "wrap", gap: "8px" }}>
          <div style=${{ fontSize: "0.88rem", color: "var(--mute)" }}>
            শিক্ষার্থী: <b>${toBn(students.length)} জন</b> | বিষয়: <b>${toBn(subjects.length)} টি</b>
          </div>
          <button type="button" class="ghost" onClick=${loadData} style=${{ width: "auto", margin: 0, padding: "5px 12px", fontSize: "0.85rem" }}>
            🔄 রিফ্রেশ
          </button>
        </div>
      </div>

      ${loading && html`<p class="sub">ফলাফল তৈরি হচ্ছে…</p>`}

      ${selectedStudent && html`<${MarksheetCard}
        student=${selectedStudent}
        evalName=${termOption === "annual" ? "বার্ষিক সমন্বিত মূল্যায়ন" : DEFAULT_TERMS.find(t => t.id === termOption)?.name}
        className=${curClass?.name || ""}
        section=${section}
        examConfig=${examConfig}
        onClose=${() => setSelectedStudent(null)} />`}

      ${!selectedStudent && !loading && students.length > 0 && viewMode === "register" && html`<${SubjectRegisterView}
        students=${students}
        marksDocs=${marksDocs}
        curClass=${curClass}
        section=${section}
        subject=${subject}
        examConfig=${examConfig}
        allSubjectAverages=${allSubjectAverages} />`}

      ${!selectedStudent && !loading && students.length > 0 && viewMode === "consolidated" && html`<${ConsolidatedTabulationView}
        students=${students}
        marksDocs=${marksDocs}
        curClass=${curClass}
        section=${section}
        subjects=${subjects}
        examConfig=${examConfig}
        termOption=${termOption}
        onSelectStudent=${setSelectedStudent} />`}

      ${!loading && students.length === 0 && html`<div class="card">
        <p class="sub" style=${{ margin: 0 }}>এই শ্রেণির জন্য কোনো শিক্ষার্থী পাওয়া যায়নি।</p>
      </div>`}
    </div>`}
  </div>`;
}

// ৫. শিক্ষার্থী ও অভিভাবকদের জন্য উন্মুক্ত অনলাইন ফলাফল অনুসন্ধান
export function PublicResultSearch({ onBack }) {
  const [structure, setStructure] = useState([]);
  const [examConfig, setExamConfig] = useState(null);
  const [publishStatus, setPublishStatus] = useState({});

  const [classId, setClassId] = useState("");
  const [section, setSection] = useState("");
  const [termId, setTermId] = useState("annual");
  const [roll, setRoll] = useState("");
  const [secret, setSecret] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [resultData, setResultData] = useState(null);

  useEffect(() => {
    Promise.all([
      getDoc(doc(db, "config", "structure")),
      getDoc(doc(db, "config", "exams")),
      getDoc(doc(db, "config", "publish"))
    ]).then(([sSnap, eSnap, pSnap]) => {
      if (sSnap.exists() && sSnap.data().classes) {
        const cls = sSnap.data().classes;
        setStructure(cls);
        if (cls.length > 0) {
          setClassId(cls[0].id);
          setSection(cls[0].sections[0] || "");
        }
      }
      if (eSnap.exists()) setExamConfig(eSnap.data());
      if (pSnap.exists()) setPublishStatus(pSnap.data().published || {});
    });
  }, []);

  const curClass = structure.find(c => c.id === classId);
  const publishedTerms = [...DEFAULT_TERMS, { id: "annual", name: "বার্ষিক চূড়ান্ত ফলাফল" }].filter(t => publishStatus[t.id]);

  async function handleSearch(e) {
    e.preventDefault();
    setErr("");
    setResultData(null);

    const rNum = parseInt(bn2en(roll), 10);
    if (!rNum) return setErr("সঠিক রোল নম্বর লিখুন।");
    if (!publishStatus[termId]) {
      return setErr("এই মূল্যায়নের ফলাফল এখনো অনলাইনে প্রকাশিত হয়নি।");
    }

    setLoading(true);
    try {
      // শিক্ষার্থী লোড
      const stuQ = query(
        collection(db, "students"),
        where("classId", "==", classId),
        where("section", "==", section)
      );
      const stuSnap = await getDocs(stuQ);
      const st = stuSnap.docs.map(d => d.data()).find(s => parseInt(s.roll, 10) === rNum);

      if (!st) {
        setErr("এই রোল নম্বরের কোনো শিক্ষার্থী পাওয়া যায়নি। রোল ও শাখা যাচাই করুন।");
        setLoading(false);
        return;
      }

      // অভিভাবকের মোবাইল নম্বরের শেষ ৪ ডিজিট বা জন্মতারিখ মিলানোর যাচাই (ঐচ্ছিক নিরাপত্তা)
      const secTrim = bn2en(secret).trim();
      if (secTrim) {
        const phone = (st.guardianMobile || "").replace(/\D/g, "");
        const last4 = phone.slice(-4);
        const dob = (st.dob || "").replace(/\D/g, "");
        if (last4 && secTrim !== last4 && !dob.includes(secTrim)) {
          setErr("নিরাপত্তা তথ্যের (মোবাইলের শেষ ৪ ডিজিট বা জন্মতারিখ) অমিল পাওয়া গেছে।");
          setLoading(false);
          return;
        }
      }

      // নম্বর লোড
      const marksQ = query(
        collection(db, "marks"),
        where("classId", "==", classId),
        where("section", "==", section)
      );
      const mSnap = await getDocs(marksQ);
      const mList = mSnap.docs.map(d => d.data());

      const subjects = curClass?.subjects || [];
      const grading = examConfig?.grading || DESCRIPTIVE_GRADES;
      const weights = examConfig?.annualWeights || DEFAULT_ANNUAL_WEIGHTS;
      const w1 = ((weights.find(w => w.phase === 1)?.weight ?? 25) / 100);
      const w2 = ((weights.find(w => w.phase === 2)?.weight ?? 25) / 100);
      const w3 = ((weights.find(w => w.phase === 3)?.weight ?? 50) / 100);

      const mDocsMap = {};
      mList.forEach(d => { mDocsMap[`${d.termId}_${d.subject}`] = d; });

      const stuResult = {
        sid: st.sid,
        roll: st.roll,
        name: st.name,
        subjects: {},
        totalScore: 0,
        totalFull: 0,
        pass: true
      };

      let totalGpa = 0;
      subjects.forEach(sub => {
        let subScore = 0;
        let isAbsent = false;

        if (termId === "annual") {
          const m1 = mDocsMap[`term_1_${sub}`]?.records?.[st.sid];
          const m2 = mDocsMap[`term_2_${sub}`]?.records?.[st.sid];
          const m3 = mDocsMap[`term_3_${sub}`]?.records?.[st.sid];

          const s1 = m1 && !m1.absent ? (parseFloat(m1.total) || 0) : 0;
          const s2 = m2 && !m2.absent ? (parseFloat(m2.total) || 0) : 0;
          const s3 = m3 && !m3.absent ? (parseFloat(m3.total) || 0) : 0;

          if (m1?.absent || m2?.absent || m3?.absent) isAbsent = true;
          subScore = Math.round(((s1 * w1) + (s2 * w2) + (s3 * w3)) * 10) / 10;
        } else {
          const mRec = mDocsMap[`${termId}_${sub}`]?.records?.[st.sid];
          isAbsent = !!mRec?.absent;
          subScore = (!isAbsent && mRec?.total != null) ? (parseFloat(mRec.total) || 0) : 0;
        }

        const gInfo = getGradeInfo(subScore, grading);
        if (subScore < (examConfig?.passMarkPercent ?? 33) || isAbsent) {
          stuResult.pass = false;
        }

        stuResult.subjects[sub] = {
          score: subScore,
          absent: isAbsent,
          grade: gInfo.grade,
          gpa: gInfo.gpa
        };

        stuResult.totalScore += subScore;
        stuResult.totalFull += 100;
        totalGpa += gInfo.gpa;
      });

      const avgPct = stuResult.totalFull > 0 ? (stuResult.totalScore / stuResult.totalFull) * 100 : 0;
      stuResult.avgPct = Math.round(avgPct * 10) / 10;
      const overallGInfo = getGradeInfo(stuResult.avgPct, grading);
      stuResult.grade = stuResult.pass ? overallGInfo.grade : "অগ্রগতি প্রয়োজন";
      stuResult.gpa = (subjects.length > 0 && stuResult.pass) ? Math.round((totalGpa / subjects.length) * 100) / 100 : 0.0;

      setResultData({
        student: stuResult,
        evalName: termId === "annual" ? "বার্ষিক চূড়ান্ত ফলাফল" : DEFAULT_TERMS.find(t => t.id === termId)?.name || "মূল্যায়ন",
        className: curClass?.name || "",
        section: section
      });
    } catch (ex) {
      console.error(ex);
      setErr("ফলাফল লোড করতে সমস্যা হয়েছে। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।");
    }
    setLoading(false);
  }

  return html`<div style=${{ marginTop: "14px" }}>
    <div class="no-print" style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
      <button type="button" class="ghost" onClick=${onBack} style=${{ width: "auto", margin: 0, padding: "6px 14px" }}>
        ← মূল পাতায় ফিরুন
      </button>
      <div style=${{ fontSize: "0.9rem", color: "var(--acc)", fontWeight: 600 }}>অভিভাবক ও শিক্ষার্থী পোর্টাল</div>
    </div>

    ${resultData && html`<${MarksheetCard}
      student=${resultData.student}
      evalName=${resultData.evalName}
      className=${resultData.className}
      section=${resultData.section}
      examConfig=${examConfig}
      onClose=${() => setResultData(null)} />`}

    ${!resultData && html`<form class="card" onSubmit=${handleSearch}>
      <h3 style=${{ margin: "0 0 6px", fontSize: "1.2rem", textAlign: "center", color: "var(--acc)" }}>
        অনলাইন ফলাফল অনুসন্ধান
      </h3>
      <p class="sub" style=${{ margin: "0 0 16px", textAlign: "center", fontSize: "0.88rem" }}>
        শ্রেণি, শাখা ও রোল নম্বর দিয়ে ফলাফল দেখুন:
      </p>

      <label style=${{ marginTop: 0 }}>পরীক্ষা / মূল্যায়ন
        <select value=${termId} onChange=${e => setTermId(e.target.value)}
          style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)", fontWeight: 600 }}>
          ${publishedTerms.length === 0
            ? html`<option value="">বর্তমানে কোনো ফলাফল অনলাইনে প্রকাশের অপেক্ষায় রয়েছে</option>`
            : publishedTerms.map(t => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}
        </select>
      </label>

      <div style=${{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}>
        <div>
          <label style=${{ margin: "0 0 4px" }}>শ্রেণি</label>
          <select value=${classId} onChange=${e => {
            const cid = e.target.value; setClassId(cid);
            const cl = structure.find(c => c.id === cid);
            if (cl) setSection(cl.sections[0] || "");
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
      </div>

      <label style=${{ marginTop: "10px" }}>শিক্ষার্থীর রোল নম্বর
        <input type="tel" inputMode="numeric" value=${roll}
          placeholder="যেমন: ৫ বা ০৫"
          onInput=${e => setRoll(e.target.value)}
          style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)", fontWeight: 600 }} />
      </label>

      <label style=${{ marginTop: "10px" }}>অভিভাবকের মোবাইল শেষ ৪ ডিজিট (ঐচ্ছিক)
        <input type="tel" inputMode="numeric" value=${secret}
          placeholder="যেমন: ৪৩২১"
          onInput=${e => setSecret(e.target.value)}
          style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }} />
      </label>

      ${err && html`<p class="err" style=${{ marginTop: "10px" }}>${err}</p>`}

      <button disabled=${loading || publishedTerms.length === 0} style=${{ marginTop: "16px" }}>
        ${loading ? "ফলাফল অনুসন্ধান হচ্ছে…" : "ফলাফল দেখুন"}
      </button>
    </form>`}
  </div>`;
}
