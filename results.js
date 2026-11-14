import React, { useState, useEffect, useMemo } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { db } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, setDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  DEFAULT_TERMS, DEFAULT_ANNUAL_WEIGHTS, DEFAULT_CLASS_RATIOS, DESCRIPTIVE_GRADES, LETTER_GRADES
} from "./exams.js?v=16";

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
function ConsolidatedTabulationView({ students, marksDocs, curClass, section, subjects, examConfig, termOption, onSelectStudent, onBatchPrint }) {
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

  // শাখার সব ছাত্রের ফলাফল এক্সেলে (CSV) ডাউনলোড
  function exportSectionCsv() {
    const titleRow1 = `"এস. এম. মডেল সরকারি প্রাথমিক বিদ্যালয়, গোপালগঞ্জ সদর"`;
    const titleRow2 = `"শ্রেণি: ${curClass?.name || ""}, শাখা: ${section}, শিক্ষাবর্ষ: ২০২৬, মূল্যায়ন: ${termOption === "annual" ? "বার্ষিক সমন্বিত ফলাফল" : DEFAULT_TERMS.find(t => t.id === termOption)?.name}"`;

    const subHeaders = [];
    subjects.forEach(sub => {
      subHeaders.push(`"${sub} (নম্বর)"`, `"${sub} (গ্রেড)"`);
    });

    const headerRow = [
      "রোল নং", "শিক্ষার্থীর নাম", "আইডি (SID)",
      ...subHeaders,
      "সর্বমোট নম্বর", "গড় শতাংশ (%)", "সমন্বিত গ্রেড",
      ...(showGpa ? ["জিপিএ"] : []),
      "মেধা স্থান", "ফলাফল"
    ].join(",");

    const dataRows = studentResults.map(r => {
      const subData = [];
      subjects.forEach(sub => {
        const s = r.subjects[sub];
        subData.push(s?.absent ? "অনুপস্থিত" : (s?.score ?? 0));
        subData.push(`"${s?.grade || "-"}"`);
      });
      return [
        r.roll,
        `"${r.name}"`,
        r.sid,
        ...subData,
        r.totalScore,
        r.avgPct,
        `"${r.grade}"`,
        ...(showGpa ? [r.gpa.toFixed(2)] : []),
        `"${r.rankBn || "-"}"`,
        `"${r.pass ? "উত্তীর্ণ" : "অগ্রগতি প্রয়োজন"}"`
      ].join(",");
    });

    const csvContent = "\uFEFF" + [titleRow1, titleRow2, "", headerRow, ...dataRows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tabulation_${curClass?.name || "class"}_${section}_2026.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

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

    <!-- অ্যাকশন বাটনসমূহ (এক্সেলে ডাউনলোড ও পিডিএফ প্রিন্ট) -->
    <div class="no-print" style=${{ display: "flex", gap: "8px", justifyContent: "flex-end", marginBottom: "12px", flexWrap: "wrap" }}>
      <button type="button" class="ghost" onClick=${exportSectionCsv}
        style=${{ width: "auto", margin: 0, padding: "7px 14px", fontSize: "0.85rem", fontWeight: 600 }}>
        📥 এক্সেলে ডাউনলোড (CSV)
      </button>
      <button type="button" class="ghost" onClick=${() => window.print()}
        style=${{ width: "auto", margin: 0, padding: "7px 14px", fontSize: "0.85rem", fontWeight: 600 }}>
        🖨️ ট্যাবুলেশন শিট প্রিন্ট
      </button>
      ${onBatchPrint && html`<button type="button" onClick=${onBatchPrint}
        style=${{ width: "auto", margin: 0, padding: "7px 16px", fontSize: "0.85rem", fontWeight: 700, background: "var(--acc)", color: "#fff" }}>
        🖨️ শাখার সকল অগ্রগতি পত্র প্রিন্ট (Landscape PDF)
      </button>`}
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

// ৩. অফিসিয়াল ল্যান্ডস্কেপ অগ্রগতি প্রতিবেদন ও নম্বরপত্র (ব্যবহারকারীর সংযুক্ত ছবির হুবহু সরকারি প্রাথমিক ছক)
export function OfficialLandscapeMarksheet({
  student,
  curClass,
  section,
  className,
  marksDocs = [],
  examConfig,
  allSubjectAverages = {},
  onClose,
  isBatch = false
}) {
  const grading = examConfig?.grading || DESCRIPTIVE_GRADES;
  const weights = examConfig?.annualWeights || DEFAULT_ANNUAL_WEIGHTS;
  const w1 = ((weights.find(w => w.phase === 1)?.weight ?? 25) / 100);
  const w2 = ((weights.find(w => w.phase === 2)?.weight ?? 25) / 100);
  const w3 = ((weights.find(w => w.phase === 3)?.weight ?? 50) / 100);

  const subjects = curClass?.subjects || Object.keys(student.subjects || {});

  const mDocsMap = {};
  (marksDocs || []).forEach(d => {
    mDocsMap[`${d.termId}_${d.subject}`] = d;
  });

  const firstDoc = marksDocs?.[0];
  const contFull = firstDoc?.contFull || 30;
  const termFull = firstDoc?.termFull || 70;
  const totalFull = contFull + termFull;

  let grandT1 = 0, grandT2 = 0, grandT3 = 0, grandAnnual = 0;
  const totalPossible = subjects.length * 100;

  const rows = subjects.map(sub => {
    const d1 = mDocsMap[`term_1_${sub}`];
    const d2 = mDocsMap[`term_2_${sub}`];
    const d3 = mDocsMap[`term_3_${sub}`];

    const r1 = d1?.records?.[student.sid];
    const r2 = d2?.records?.[student.sid];
    const r3 = d3?.records?.[student.sid];

    const t1_cont = r1 ? (r1.absent ? "অনুপস্থিত" : (r1.continuous !== "" ? toBn(r1.continuous) : "-")) : "-";
    const t1_term = r1 ? (r1.absent ? "অনুপস্থিত" : (r1.terminal !== "" ? toBn(r1.terminal) : "-")) : "-";
    const t1_tot = r1 ? (r1.absent ? "অনুপস্থিত" : (r1.total !== "" ? toBn(r1.total) : "-")) : "-";

    const t2_cont = r2 ? (r2.absent ? "অনুপস্থিত" : (r2.continuous !== "" ? toBn(r2.continuous) : "-")) : "-";
    const t2_term = r2 ? (r2.absent ? "অনুপস্থিত" : (r2.terminal !== "" ? toBn(r2.terminal) : "-")) : "-";
    const t2_tot = r2 ? (r2.absent ? "অনুপস্থিত" : (r2.total !== "" ? toBn(r2.total) : "-")) : "-";

    const t3_cont = r3 ? (r3.absent ? "অনুপস্থিত" : (r3.continuous !== "" ? toBn(r3.continuous) : "-")) : "-";
    const t3_term = r3 ? (r3.absent ? "অনুপস্থিত" : (r3.terminal !== "" ? toBn(r3.terminal) : "-")) : "-";
    const t3_tot = r3 ? (r3.absent ? "অনুপস্থিত" : (r3.total !== "" ? toBn(r3.total) : "-")) : "-";

    const s1 = r1 && !r1.absent ? (parseFloat(r1.total) || 0) : 0;
    const s2 = r2 && !r2.absent ? (parseFloat(r2.total) || 0) : 0;
    const s3 = r3 && !r3.absent ? (parseFloat(r3.total) || 0) : 0;

    grandT1 += s1;
    grandT2 += s2;
    grandT3 += s3;

    let annualAvg = Math.round(((s1 * w1) + (s2 * w2) + (s3 * w3)) * 10) / 10;
    if (student.subjects?.[sub]?.score != null && (!r1 && !r2 && !r3)) {
      annualAvg = student.subjects[sub].score;
    }
    grandAnnual += annualAvg;

    const isAnyAbsent = (r1 && r1.absent) || (r2 && r2.absent) || (r3 && r3.absent);
    const subGradeInfo = getGradeInfo(annualAvg, grading);
    const subjectGrade = (isAnyAbsent && annualAvg === 0) ? "অগ্রগতি প্রয়োজন" : subGradeInfo.grade;

    return {
      sub,
      t1_cont, t1_term, t1_tot,
      t2_cont, t2_term, t2_tot,
      t3_cont, t3_term, t3_tot,
      annualAvg: toBn(annualAvg),
      subjectGrade
    };
  });

  const stuOverall = allSubjectAverages?.[student.sid] || {
    grade: student.grade || "-",
    avgPct: student.avgPct || 0,
    total: student.totalScore || grandAnnual,
    rankBn: student.rankBn || "-"
  };

  const finalClassName = className || curClass?.name || "";

  return html`<div class="marksheet-box landscape-card" style=${{
    background: "#fff",
    border: "2px solid #222",
    borderRadius: "6px",
    padding: "16px 20px",
    marginTop: isBatch ? "0" : "14px",
    marginBottom: isBatch ? "20px" : "14px",
    color: "#111",
    boxShadow: isBatch ? "none" : "0 4px 14px rgba(0,0,0,0.08)"
  }}>
    ${!isBatch && html`<div class="no-print" style=${{ display: "flex", justifyContent: "space-between", marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
      ${onClose && html`<button type="button" class="ghost" onClick=${onClose} style=${{ width: "auto", margin: 0, padding: "6px 14px" }}>
        ← তালিকায় ফিরুন
      </button>`}
      <button type="button" onClick=${() => window.print()} style=${{ width: "auto", margin: 0, padding: "6px 18px", background: "var(--acc)", color: "#fff", fontWeight: 600 }}>
        🖨️ এই অগ্রগতি পত্র প্রিন্ট (Landscape PDF)
      </button>
    </div>`}

    <!-- হেডার -->
    <div style=${{ textAlign: "center", borderBottom: "1.5px solid #222", paddingBottom: "8px", marginBottom: "10px" }}>
      <div style=${{ fontSize: "0.88rem", color: "#444", fontWeight: 600 }}>গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</div>
      <div style=${{ fontSize: "1.35rem", fontWeight: 800, color: "#1f7a5a", margin: "1px 0" }}>
        এস. এম. মডেল সরকারি প্রাথমিক বিদ্যালয়
      </div>
      <div style=${{ fontSize: "0.82rem", color: "#555" }}>গোপালগঞ্জ সদর, গোপালগঞ্জ | স্থাপিত: ১৯২৯ খ্রি.</div>
      <div style=${{
        display: "inline-block",
        marginTop: "4px",
        padding: "2px 14px",
        background: "#e8f5e9",
        color: "#1f7a5a",
        borderRadius: "14px",
        fontWeight: 700,
        fontSize: "0.92rem",
        border: "1px solid #c8e6c9"
      }}>
        শিক্ষার্থীর প্রাথমিক মূল্যায়ন ও অগ্রগতি প্রতিবেদন (নম্বরপত্র) — ২০২৬
      </div>
    </div>

    <!-- শিক্ষার্থীর পরিচিতি -->
    <div style=${{
      display: "flex",
      justifyContent: "space-between",
      background: "#f8fbf9",
      padding: "6px 12px",
      borderRadius: "4px",
      marginBottom: "10px",
      border: "1px solid #dce8e1",
      fontSize: "0.86rem",
      flexWrap: "wrap",
      gap: "6px"
    }}>
      <div><b>শিক্ষার্থীর নাম:</b> ${student.name}</div>
      <div><b>রোল নম্বর:</b> ${toBn(student.roll)}</div>
      <div><b>শ্রেণি:</b> ${finalClassName}</div>
      <div><b> শাখা:</b> ${section}</div>
      <div><b>আইডি (SID):</b> ${student.sid}</div>
    </div>

    <!-- শীর্ষ একাডেমিক ছক (১৩ কলাম) -->
    <div style=${{ overflowX: "auto", marginBottom: "8px" }}>
      <table style=${{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem", border: "1.5px solid #222", textAlign: "center" }}>
        <thead>
          <tr style=${{ background: "#f0f7f3", borderBottom: "1.5px solid #222" }}>
            <th rowSpan="2" style=${{ border: "1px solid #333", padding: "4px", textAlign: "left", width: "19%", fontSize: "0.8rem" }}>বিষয় (পূর্ণমান)</th>
            <th colSpan="3" style=${{ border: "1px solid #333", padding: "4px" }}>১ম প্রান্তিক</th>
            <th colSpan="3" style=${{ border: "1px solid #333", padding: "4px" }}>২য় প্রান্তিক</th>
            <th colSpan="3" style=${{ border: "1px solid #333", padding: "4px" }}>৩য় প্রান্তিক</th>
            <th colSpan="3" style=${{ border: "1px solid #333", padding: "4px" }}>চূড়ান্ত ফলাফল</th>
          </tr>
          <tr style=${{ background: "#f7faf8", borderBottom: "1.5px solid #222", fontSize: "0.71rem" }}>
            <th style=${{ border: "1px solid #333", padding: "3px" }}>ধারা (${toBn(contFull)})</th>
            <th style=${{ border: "1px solid #333", padding: "3px" }}>সামষ্টিক (${toBn(termFull)})</th>
            <th style=${{ border: "1px solid #333", padding: "3px", fontWeight: 700 }}>মোট (${toBn(totalFull)})</th>

            <th style=${{ border: "1px solid #333", padding: "3px" }}>ধারা (${toBn(contFull)})</th>
            <th style=${{ border: "1px solid #333", padding: "3px" }}>সামষ্টিক (${toBn(termFull)})</th>
            <th style=${{ border: "1px solid #333", padding: "3px", fontWeight: 700 }}>মোট (${toBn(totalFull)})</th>

            <th style=${{ border: "1px solid #333", padding: "3px" }}>ধারা (${toBn(contFull)})</th>
            <th style=${{ border: "1px solid #333", padding: "3px" }}>সামষ্টিক (${toBn(termFull)})</th>
            <th style=${{ border: "1px solid #333", padding: "3px", fontWeight: 700 }}>মোট (${toBn(totalFull)})</th>

            <th style=${{ border: "1px solid #333", padding: "3px" }}>প্রান্তিকের গড়</th>
            <th style=${{ border: "1px solid #333", padding: "3px", fontWeight: 700 }}>বিষয় গ্রেড</th>
            <th style=${{ border: "1px solid #333", padding: "3px", fontWeight: 700 }}>সমন্বিত গ্রেড</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => html`<tr key=${r.sub} style=${{ borderBottom: "1px solid #333", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
            <td style=${{ border: "1px solid #333", padding: "4px 6px", textAlign: "left", fontWeight: 600 }}>${r.sub}</td>
            <td style=${{ border: "1px solid #333", padding: "3px" }}>${r.t1_cont}</td>
            <td style=${{ border: "1px solid #333", padding: "3px" }}>${r.t1_term}</td>
            <td style=${{ border: "1px solid #333", padding: "3px", fontWeight: 700 }}>${r.t1_tot}</td>

            <td style=${{ border: "1px solid #333", padding: "3px" }}>${r.t2_cont}</td>
            <td style=${{ border: "1px solid #333", padding: "3px" }}>${r.t2_term}</td>
            <td style=${{ border: "1px solid #333", padding: "3px", fontWeight: 700 }}>${r.t2_tot}</td>

            <td style=${{ border: "1px solid #333", padding: "3px" }}>${r.t3_cont}</td>
            <td style=${{ border: "1px solid #333", padding: "3px" }}>${r.t3_term}</td>
            <td style=${{ border: "1px solid #333", padding: "3px", fontWeight: 700 }}>${r.t3_tot}</td>

            <td style=${{ border: "1px solid #333", padding: "3px", fontWeight: 700 }}>${r.annualAvg}</td>
            <td style=${{ border: "1px solid #333", padding: "3px", fontWeight: 700, color: r.subjectGrade === "অগ্রগতি প্রয়োজন" ? "var(--err)" : "#1f7a5a" }}>${r.subjectGrade}</td>
            ${i === 0 ? html`<td rowSpan=${rows.length} style=${{
              border: "1px solid #333",
              verticalAlign: "middle",
              textAlign: "center",
              fontWeight: 800,
              fontSize: "1.05rem",
              color: stuOverall.grade === "অগ্রগতি প্রয়োজন" ? "var(--err)" : "#1f7a5a",
              background: "#fff"
            }}>
              ${stuOverall.grade}
            </td>` : null}
          </tr>`)}
        </tbody>
        <tfoot>
          <tr style=${{ borderTop: "1.5px solid #222", background: "#f0f7f3", fontWeight: 700, fontSize: "0.76rem" }}>
            <td style=${{ border: "1px solid #333", padding: "4px 6px", textAlign: "left" }}>সর্বমোট (${toBn(totalPossible)})</td>
            <td colSpan="2" style=${{ border: "1px solid #333", padding: "3px" }}>১ম প্রান্তিকে মোট:</td>
            <td style=${{ border: "1px solid #333", padding: "3px", fontWeight: 800 }}>${toBn(grandT1)}</td>

            <td colSpan="2" style=${{ border: "1px solid #333", padding: "3px" }}>২য় প্রান্তিকে মোট:</td>
            <td style=${{ border: "1px solid #333", padding: "3px", fontWeight: 800 }}>${toBn(grandT2)}</td>

            <td colSpan="2" style=${{ border: "1px solid #333", padding: "3px" }}>৩য় প্রান্তিকে মোট:</td>
            <td style=${{ border: "1px solid #333", padding: "3px", fontWeight: 800 }}>${toBn(grandT3)}</td>

            <td style=${{ border: "1px solid #333", padding: "3px", fontWeight: 800 }}>${toBn(grandAnnual)}</td>
            <td style=${{ border: "1px solid #333", padding: "3px" }}>-</td>
            <td style=${{ border: "1px solid #333", padding: "3px", fontWeight: 800, color: "#1f7a5a" }}>মেধা: ${stuOverall.rankBn || student.rankBn || "-"}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- নিচের দুটি টেবিল পাশাপাশি (ব্যক্তিগত গুণাবলী ও শিখন অর্জন) -->
    <div style=${{ display: "flex", gap: "10px", marginTop: "8px", alignItems: "stretch" }}>
      <!-- বাম কলাম: ব্যক্তিগত ও সামাজিক গুণাবলী -->
      <div style=${{ flex: 3, border: "1.5px solid #222", borderRadius: "2px" }}>
        <table style=${{ width: "100%", borderCollapse: "collapse", fontSize: "0.74rem" }}>
          <thead>
            <tr style=${{ background: "#f0f7f3", borderBottom: "1px solid #333" }}>
              <th colSpan="2" style=${{ padding: "4px 6px", textAlign: "left", fontWeight: 700 }}>ব্যক্তিগত ও সামাজিক গুণাবলী</th>
              <th colSpan="3" style=${{ padding: "4px 6px", textAlign: "right", fontSize: "0.7rem", fontWeight: 600 }}>অবস্থান: উত্তম (ক) | সন্তোষজনক (খ) | উন্নতি প্রয়োজন (গ)</th>
            </tr>
            <tr style=${{ background: "#fafafa", borderBottom: "1px solid #333", textAlign: "center", fontSize: "0.71rem" }}>
              <th style=${{ padding: "3px 4px", width: "18%", borderRight: "1px solid #333" }}>গুণাবলী</th>
              <th style=${{ padding: "3px 6px", width: "58%", borderRight: "1px solid #333" }}>বর্ণনা</th>
              <th style=${{ padding: "3px", width: "8%", borderRight: "1px solid #333" }}>১ম</th>
              <th style=${{ padding: "3px", width: "8%", borderRight: "1px solid #333" }}>২য়</th>
              <th style=${{ padding: "3px", width: "8%" }}>৩য়</th>
            </tr>
          </thead>
          <tbody>
            <tr style=${{ borderBottom: "1px solid #333" }}>
              <td style=${{ padding: "4px 6px", fontWeight: 600, borderRight: "1px solid #333", textAlign: "center" }}>সক্রিয়তা</td>
              <td style=${{ padding: "4px 6px", fontSize: "0.7rem", lineHeight: 1.25, borderRight: "1px solid #333" }}>
                শিক্ষকের নির্দেশনামতো পাঠ্যপুস্তকের কাজ/ওয়ার্কশিট সম্পন্ন করা; বাড়ির কাজ সময়মতো সম্পন্ন করা; জোড়ায়/দলগত কাজে কার্যকরভাবে অংশগ্রহণ করা; প্রশ্নোত্তর পর্বে অংশ নেওয়া ইত্যাদি
              </td>
              <td style=${{ padding: "4px", textAlign: "center", fontWeight: 700, borderRight: "1px solid #333" }}>ক</td>
              <td style=${{ padding: "4px", textAlign: "center", fontWeight: 700, borderRight: "1px solid #333" }}>ক</td>
              <td style=${{ padding: "4px", textAlign: "center", fontWeight: 700 }}>ক</td>
            </tr>
            <tr style=${{ borderBottom: "1px solid #333" }}>
              <td style=${{ padding: "4px 6px", fontWeight: 600, borderRight: "1px solid #333", textAlign: "center" }}>শৃঙ্খলা</td>
              <td style=${{ padding: "4px 6px", fontSize: "0.7rem", lineHeight: 1.25, borderRight: "1px solid #333" }}>
                বিদ্যালয়ে নিয়মিত উপস্থিত থাকা; বিদ্যালয়ের সকল নিয়ম-শৃঙ্খলা মেনে চলা; পরিষ্কার-পরিচ্ছন্ন থাকা ইত্যাদি
              </td>
              <td style=${{ padding: "4px", textAlign: "center", fontWeight: 700, borderRight: "1px solid #333" }}>ক</td>
              <td style=${{ padding: "4px", textAlign: "center", fontWeight: 700, borderRight: "1px solid #333" }}>ক</td>
              <td style=${{ padding: "4px", textAlign: "center", fontWeight: 700 }}>ক</td>
            </tr>
            <tr>
              <td style=${{ padding: "4px 6px", fontWeight: 600, borderRight: "1px solid #333", textAlign: "center" }}>আচরণ</td>
              <td style=${{ padding: "4px 6px", fontSize: "0.7rem", lineHeight: 1.25, borderRight: "1px solid #333" }}>
                শিক্ষক/বড়দের সম্মান করা; ছোটদের স্নেহ করা; অন্যের প্রতি সহানুভূতিশীল হওয়া; সহযোগিতা করা; ভুল হলে স্বীকার করা; অন্যকে কষ্ট না দেওয়া; মিলেমিশে থাকা ইত্যাদি
              </td>
              <td style=${{ padding: "4px", textAlign: "center", fontWeight: 700, borderRight: "1px solid #333" }}>ক</td>
              <td style=${{ padding: "4px", textAlign: "center", fontWeight: 700, borderRight: "1px solid #333" }}>ক</td>
              <td style=${{ padding: "4px", textAlign: "center", fontWeight: 700 }}>ক</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ডান কলাম: শিখন অর্জন ও গ্রেডিং স্কেল -->
      <div style=${{ flex: 2, border: "1.5px solid #222", borderRadius: "2px" }}>
        <table style=${{ width: "100%", height: "100%", borderCollapse: "collapse", fontSize: "0.74rem", textAlign: "center" }}>
          <thead>
            <tr style=${{ background: "#f0f7f3", borderBottom: "1px solid #333" }}>
              <th style=${{ padding: "4px 6px", borderRight: "1px solid #333", width: "35%" }}>প্রাপ্ত নম্বর</th>
              <th style=${{ padding: "4px 6px", borderRight: "1px solid #333", width: "22%" }}>গ্রেড</th>
              <th style=${{ padding: "4px 6px", width: "43%" }}>শিখন অর্জন</th>
            </tr>
          </thead>
          <tbody>
            <tr style=${{ borderBottom: "1px solid #333" }}>
              <td style=${{ padding: "4px", borderRight: "1px solid #333" }}>৮০%-১০০%</td>
              <td style=${{ padding: "4px", fontWeight: 700, borderRight: "1px solid #333" }}>A</td>
              <td style=${{ padding: "4px", fontWeight: 700, color: "#1f7a5a" }}>অতি উত্তম</td>
            </tr>
            <tr style=${{ borderBottom: "1px solid #333" }}>
              <td style=${{ padding: "4px", borderRight: "1px solid #333" }}>৬০%-৭৯%</td>
              <td style=${{ padding: "4px", fontWeight: 700, borderRight: "1px solid #333" }}>B</td>
              <td style=${{ padding: "4px", fontWeight: 700, color: "#1f7a5a" }}>উত্তম</td>
            </tr>
            <tr style=${{ borderBottom: "1px solid #333" }}>
              <td style=${{ padding: "4px", borderRight: "1px solid #333" }}>৪০%-৫৯%</td>
              <td style=${{ padding: "4px", fontWeight: 700, borderRight: "1px solid #333" }}>C</td>
              <td style=${{ padding: "4px", fontWeight: 700 }}>সন্তোষজনক</td>
            </tr>
            <tr>
              <td style=${{ padding: "4px", borderRight: "1px solid #333" }}>৪০% এর কম</td>
              <td style=${{ padding: "4px", fontWeight: 700, borderRight: "1px solid #333" }}>D</td>
              <td style=${{ padding: "4px", fontWeight: 700, color: "#c62828" }}>সহায়তা প্রয়োজন</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- স্বাক্ষর -->
    <div style=${{
      display: "flex",
      justifyContent: "space-between",
      marginTop: "18px",
      paddingTop: "6px",
      textAlign: "center",
      fontSize: "0.82rem",
      color: "#222"
    }}>
      <div style=${{ flex: 1 }}>
        <div style=${{ borderTop: "1px solid #444", width: "130px", margin: "0 auto 4px" }}></div>
        শ্রেণি শিক্ষকের স্বাক্ষর
      </div>
      <div style=${{ flex: 1 }}>
        <div style=${{ borderTop: "1px solid #444", width: "130px", margin: "0 auto 4px" }}></div>
        অভিভাবকের স্বাক্ষর
      </div>
      <div style=${{ flex: 1 }}>
        <div style=${{ borderTop: "1px solid #444", width: "130px", margin: "0 auto 4px" }}></div>
        প্রধান শিক্ষকের স্বাক্ষর ও সিল
      </div>
    </div>
  </div>`;
}

export const MarksheetCard = OfficialLandscapeMarksheet;

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
  const [batchPrintCards, setBatchPrintCards] = useState(false);

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
        onClick=${() => { setViewMode("register"); setSelectedStudent(null); setBatchPrintCards(false); }}>
        বিষয় রেজিস্টার (১৭ কলাম)
      </button>
      <button class=${viewMode === "consolidated" ? "primary" : "ghost"}
        style=${{ width: "auto", margin: 0, padding: "8px 16px" }}
        onClick=${() => { setViewMode("consolidated"); setSelectedStudent(null); setBatchPrintCards(false); }}>
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

      ${batchPrintCards && html`<div class="card" style=${{ padding: "14px", marginTop: "14px" }}>
        <div class="no-print" style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", paddingBottom: "10px", borderBottom: "2px solid var(--acc)", flexWrap: "wrap", gap: "10px" }}>
          <button type="button" class="ghost" onClick=${() => setBatchPrintCards(false)} style=${{ width: "auto", margin: 0, padding: "6px 14px" }}>
            ← ট্যাবুলেশনে ফিরুন
          </button>
          <div style=${{ fontSize: "0.9rem", color: "var(--mute)", fontWeight: 600 }}>
            মোট <b>${toBn(students.length)} জন</b> শিক্ষার্থীর অগ্রগতি পত্র (Landscape PDF)
          </div>
          <button type="button" onClick=${() => window.print()} style=${{ width: "auto", margin: 0, padding: "7px 20px", background: "var(--acc)", color: "#fff", fontWeight: 700 }}>
            🖨️ এখনই প্রিন্ট / PDF সংরক্ষণ করুন
          </button>
        </div>

        <div class="print-area">
          ${students.map(s => html`<div class="landscape-page" key=${s.sid}>
            <${OfficialLandscapeMarksheet}
              student=${s}
              curClass=${curClass}
              section=${section}
              className=${curClass?.name || ""}
              marksDocs=${marksDocs}
              examConfig=${examConfig}
              allSubjectAverages=${allSubjectAverages}
              isBatch=${true} />
          </div>`)}
        </div>
      </div>`}

      ${!batchPrintCards && selectedStudent && html`<${OfficialLandscapeMarksheet}
        student=${selectedStudent}
        curClass=${curClass}
        section=${section}
        className=${curClass?.name || ""}
        marksDocs=${marksDocs}
        examConfig=${examConfig}
        allSubjectAverages=${allSubjectAverages}
        onClose=${() => setSelectedStudent(null)} />`}

      ${!batchPrintCards && !selectedStudent && !loading && students.length > 0 && viewMode === "register" && html`<${SubjectRegisterView}
        students=${students}
        marksDocs=${marksDocs}
        curClass=${curClass}
        section=${section}
        subject=${subject}
        examConfig=${examConfig}
        allSubjectAverages=${allSubjectAverages} />`}

      ${!batchPrintCards && !selectedStudent && !loading && students.length > 0 && viewMode === "consolidated" && html`<${ConsolidatedTabulationView}
        students=${students}
        marksDocs=${marksDocs}
        curClass=${curClass}
        section=${section}
        subjects=${subjects}
        examConfig=${examConfig}
        termOption=${termOption}
        onSelectStudent=${setSelectedStudent}
        onBatchPrint=${() => setBatchPrintCards(true)} />`}

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
        section: section,
        curClass: curClass,
        marksDocs: mList
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

    ${resultData && html`<${OfficialLandscapeMarksheet}
      student=${resultData.student}
      curClass=${resultData.curClass}
      className=${resultData.className}
      section=${resultData.section}
      marksDocs=${resultData.marksDocs}
      examConfig=${examConfig}
      allSubjectAverages=${{ [resultData.student.sid]: { grade: resultData.student.grade, avgPct: resultData.student.avgPct, total: resultData.student.totalScore, rankBn: resultData.student.rankBn } }}
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
