import React, { useState, useEffect, useMemo } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { db } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, setDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { DEFAULT_EXAMS, DEFAULT_ANNUAL_WEIGHTS, LETTER_GRADES } from "./exams.js?v=11";

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

// মূল্যায়নের সমন্বিত তালিকা (৯টি পরীক্ষা + ৩টি প্রান্তিক সার্বিক + ১টি বার্ষিক সার্বিক)
export const EVALUATION_OPTIONS = [
  // ১ম পর্যায়
  { id: "ca_1_1", name: "ধারাবাহিক মূল্যায়ন ১.১", phase: 1, isComposite: false },
  { id: "ca_1_2", name: "ধারাবাহিক মূল্যায়ন ১.২", phase: 1, isComposite: false },
  { id: "term_1", name: "প্রথম প্রান্তিক মূল্যায়ন", phase: 1, isComposite: false },
  { id: "comp_1", name: "১ম প্রান্তিক সার্বিক (সমন্বিত)", phase: 1, isComposite: true, components: ["ca_1_1", "ca_1_2", "term_1"] },

  // ২য় পর্যায়
  { id: "ca_2_1", name: "ধারাবাহিক মূল্যায়ন ২.১", phase: 2, isComposite: false },
  { id: "ca_2_2", name: "ধারাবাহিক মূল্যায়ন ২.২", phase: 2, isComposite: false },
  { id: "term_2", name: "দ্বিতীয় প্রান্তিক মূল্যায়ন", phase: 2, isComposite: false },
  { id: "comp_2", name: "২য় প্রান্তিক সার্বিক (সমন্বিত)", phase: 2, isComposite: true, components: ["ca_2_1", "ca_2_2", "term_2"] },

  // ৩য় পর্যায়
  { id: "ca_3_1", name: "ধারাবাহিক মূল্যায়ন ৩.১", phase: 3, isComposite: false },
  { id: "ca_3_2", name: "ধারাবাহিক মূল্যায়ন ৩.২", phase: 3, isComposite: false },
  { id: "term_3", name: "তৃতীয় প্রান্তিক মূল্যায়ন", phase: 3, isComposite: false },
  { id: "comp_3", name: "৩য় প্রান্তিক সার্বিক (সমন্বিত)", phase: 3, isComposite: true, components: ["ca_3_1", "ca_3_2", "term_3"] },

  // বার্ষিক
  { id: "annual", name: "বার্ষিক সমন্বিত মূল্যায়ন (ওয়েটেজ অনুযায়ী)", phase: 0, isComposite: true, isAnnual: true }
];

export function getGradeInfo(pct, gradingScale = LETTER_GRADES) {
  if (pct == null || isNaN(pct)) return { grade: "-", gpa: 0 };
  const p = Math.round(pct * 100) / 100;
  for (const g of gradingScale) {
    const min = g.min != null ? g.min : 0;
    const max = g.max != null ? g.max : 100;
    if (p >= min && p <= max) {
      return { grade: g.grade, gpa: parseFloat(g.gpa) || 0 };
    }
  }
  return { grade: "F", gpa: 0 };
}

// ফলাফল গণনার কেন্দ্রীয় ইঞ্জিন
export function calculateResults({ students, marksDocs, examConfig, subjects, evalOption }) {
  const grading = examConfig?.grading || LETTER_GRADES;
  const passMarkPct = examConfig?.passMarkPercent ?? 33;
  const annualWeights = examConfig?.annualWeights || DEFAULT_ANNUAL_WEIGHTS;
  const examsList = examConfig?.exams || DEFAULT_EXAMS;

  const marksMap = {};
  (marksDocs || []).forEach(d => {
    marksMap[`${d.examId}_${d.subject}`] = d;
  });

  const getExamFullMarks = examId => {
    const ex = examsList.find(e => e.id === examId);
    return ex ? (parseInt(ex.fullMarks, 10) || 100) : 100;
  };

  const results = students.map(student => {
    const sid = student.sid;
    const res = {
      sid,
      name: student.name,
      roll: parseInt(student.roll, 10) || 0,
      dob: student.dob || "",
      guardianMobile: student.guardianMobile || "",
      subjects: {},
      totalScore: 0,
      totalFullMarks: 0,
      pass: true
    };

    let totalGpa = 0;
    let subjectCount = 0;

    subjects.forEach(sub => {
      let subScore = 0;
      let subFull = 0;
      let isAbsent = false;

      if (evalOption.isAnnual) {
        let annualSubTotal = 0;

        [1, 2, 3].forEach(phase => {
          const wObj = annualWeights.find(w => w.phase === phase) || { weight: phase === 3 ? 50 : 25 };
          const weight = (parseFloat(wObj.weight) || 0) / 100;

          const pExams = examsList.filter(e => e.phase === phase);
          let pScore = 0;
          let pFull = 0;

          pExams.forEach(ex => {
            const mDoc = marksMap[`${ex.id}_${sub}`];
            const rec = mDoc?.records?.[sid];
            if (rec?.absent) isAbsent = true;
            pScore += (rec && !rec.absent ? (parseFloat(rec.score) || 0) : 0);
            pFull += (parseInt(ex.fullMarks, 10) || 0);
          });

          const pPct = pFull > 0 ? (pScore / pFull) * 100 : 0;
          annualSubTotal += (pPct * weight);
        });

        subScore = Math.round(annualSubTotal * 10) / 10;
        subFull = 100;
        const subPct = subScore;
        const gInfo = getGradeInfo(subPct, grading);

        if (subPct < passMarkPct || isAbsent) res.pass = false;

        res.subjects[sub] = {
          score: subScore,
          fullMarks: subFull,
          pct: subPct,
          grade: gInfo.grade,
          gpa: gInfo.gpa,
          absent: isAbsent
        };

        totalGpa += gInfo.gpa;
        subjectCount++;
        res.totalScore += subScore;
        res.totalFullMarks += subFull;

      } else if (evalOption.isComposite) {
        const compIds = evalOption.components || [];
        let compScore = 0;
        let compFull = 0;

        compIds.forEach(cId => {
          const mDoc = marksMap[`${cId}_${sub}`];
          const rec = mDoc?.records?.[sid];
          if (rec?.absent) isAbsent = true;
          compScore += (rec && !rec.absent ? (parseFloat(rec.score) || 0) : 0);
          compFull += getExamFullMarks(cId);
        });

        subScore = compScore;
        subFull = compFull || 100;
        const subPct = subFull > 0 ? (subScore / subFull) * 100 : 0;
        const gInfo = getGradeInfo(subPct, grading);

        if (subPct < passMarkPct || isAbsent) res.pass = false;

        res.subjects[sub] = {
          score: subScore,
          fullMarks: subFull,
          pct: Math.round(subPct * 10) / 10,
          grade: gInfo.grade,
          gpa: gInfo.gpa,
          absent: isAbsent
        };

        totalGpa += gInfo.gpa;
        subjectCount++;
        res.totalScore += subScore;
        res.totalFullMarks += subFull;

      } else {
        const mDoc = marksMap[`${evalOption.id}_${sub}`];
        const rec = mDoc?.records?.[sid];
        isAbsent = !!rec?.absent;
        subScore = (!isAbsent && rec?.score != null) ? (parseFloat(rec.score) || 0) : 0;
        subFull = getExamFullMarks(evalOption.id);
        const subPct = subFull > 0 ? (subScore / subFull) * 100 : 0;
        const gInfo = getGradeInfo(subPct, grading);

        if (subPct < passMarkPct || isAbsent) res.pass = false;

        res.subjects[sub] = {
          score: subScore,
          fullMarks: subFull,
          pct: Math.round(subPct * 10) / 10,
          grade: gInfo.grade,
          gpa: gInfo.gpa,
          absent: isAbsent
        };

        totalGpa += gInfo.gpa;
        subjectCount++;
        res.totalScore += subScore;
        res.totalFullMarks += subFull;
      }
    });

    const overallPct = res.totalFullMarks > 0 ? (res.totalScore / res.totalFullMarks) * 100 : 0;
    res.avgPct = Math.round(overallPct * 100) / 100;

    if (!res.pass) {
      res.gpa = 0.0;
      res.grade = "F";
      res.status = "অকৃতকার্য";
    } else {
      res.gpa = subjectCount > 0 ? Math.round((totalGpa / subjectCount) * 100) / 100 : 0;
      res.grade = getGradeInfo(res.avgPct, grading).grade;
      res.status = "উত্তীর্ণ";
    }

    return res;
  });

  const passStudents = results.filter(r => r.pass).sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.gpa !== a.gpa) return b.gpa - a.gpa;
    return a.roll - b.roll;
  });

  passStudents.forEach((r, idx) => {
    r.rank = idx + 1;
    r.rankBn = toBnRank(idx + 1);
  });

  const failStudents = results.filter(r => !r.pass).sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.roll - b.roll;
  });

  failStudents.forEach(r => {
    r.rank = null;
    r.rankBn = "-";
  });

  return results.sort((a, b) => a.roll - b.roll);
}

// ১. একক শিক্ষার্থীর মার্কশিট উপাদান (A4 প্রিন্ট ফ্রেন্ডলি)
export function MarksheetCard({ student, evalName, className, section, examConfig, onClose }) {
  const showGpa = examConfig?.displayOptions?.showGpa ?? true;
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
      <div><b> শাখা:</b> ${section}</div>
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
            <th style=${{ padding: "8px 10px", fontSize: "0.9rem", textAlign: "center" }}>গ্রেড</th>
            ${showGpa && html`<th style=${{ padding: "8px 10px", fontSize: "0.9rem", textAlign: "center" }}>জিপিএ</th>`}
          </tr>
        </thead>
        <tbody>
          ${subjects.map((sub, i) => {
            const s = student.subjects[sub] || {};
            return html`<tr key=${sub} style=${{ borderBottom: "1px solid #eee", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
              <td style=${{ padding: "8px 10px", fontWeight: 600 }}>${sub}</td>
              <td style=${{ padding: "8px 10px", textAlign: "center" }}>${toBn(s.fullMarks)}</td>
              ${showMarks && html`<td style=${{ padding: "8px 10px", textAlign: "center", fontWeight: 700 }}>
                ${s.absent ? html`<span style=${{ color: "var(--err)" }}>অনুপস্থিত</span>` : toBn(s.score)}
              </td>`}
              <td style=${{ padding: "8px 10px", textAlign: "center" }}>${s.absent ? "-" : `${toBn(s.pct)}%`}</td>
              <td style=${{ padding: "8px 10px", textAlign: "center", fontWeight: 700, color: s.grade === "F" ? "var(--err)" : "#1f7a5a" }}>
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
            <td style=${{ padding: "10px", textAlign: "center" }}>${toBn(student.totalFullMarks)}</td>
            ${showMarks && html`<td style=${{ padding: "10px", textAlign: "center", color: "#1f7a5a" }}>${toBn(student.totalScore)}</td>`}
            <td style=${{ padding: "10px", textAlign: "center" }}>${toBn(student.avgPct)}%</td>
            <td style=${{ padding: "10px", textAlign: "center", color: student.grade === "F" ? "var(--err)" : "#1f7a5a" }}>
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
        <b style=${{ fontSize: "1.1rem", color: student.pass ? "#2e7d32" : "#c62828" }}>${student.status}</b>
      </div>
      <div>
        <div style=${{ fontSize: "0.85rem", color: "#666" }}>শাখা মেধা স্থান</div>
        <b style=${{ fontSize: "1.1rem", color: "#1f7a5a" }}>${student.rankBn}</b>
      </div>
      <div>
        <div style=${{ fontSize: "0.85rem", color: "#666" }}>অর্জিত মান / গ্রেড</div>
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

// ২. ট্যাবুলেশন শিট টেবিল কম্পোনেন্ট
function TabulationTable({ calculatedResults, subjects, showGpa, curClass, section, evalOption, onSelectStudent }) {
  return html`<div class="card print-area" style=${{ padding: "12px 8px" }}>
    <div style=${{ textAlign: "center", marginBottom: "14px", paddingBottom: "8px", borderBottom: "2px solid var(--acc)" }}>
      <div style=${{ fontSize: "1.25rem", fontWeight: 800, color: "var(--acc)" }}>এস. এম. মডেল সরকারি প্রাথমিক বিদ্যালয়</div>
      <div style=${{ fontSize: "0.9rem", color: "var(--mute)" }}>গোপালগঞ্জ সদর, গোপালগঞ্জ</div>
      <b style=${{ fontSize: "1rem", display: "inline-block", marginTop: "4px" }}>
        ফলাফল বিবরণী ও ট্যাবুলেশন শিট — ২০২৬
      </b>
      <div style=${{ fontSize: "0.88rem", marginTop: "2px" }}>
        শ্রেণি: <b>${curClass?.name || ""}</b> | শাখা: <b>${section}</b> | মূল্যায়ন: <b>${evalOption.name}</b>
      </div>
    </div>

    <div style=${{ overflowX: "auto" }}>
      <table style=${{ width: "100%", borderCollapse: "collapse", minWidth: "620px", fontSize: "0.88rem" }}>
        <thead>
          <tr style=${{ background: "var(--bg)", borderBottom: "2px solid var(--line)", textAlign: "center" }}>
            <th style=${{ padding: "8px 4px", width: "42px" }}>রোল</th>
            <th style=${{ padding: "8px 6px", textAlign: "left", minWidth: "120px" }}>শিক্ষার্থীর নাম</th>
            ${subjects.map(s => html`<th key=${s} style=${{ padding: "8px 4px", minWidth: "50px" }}>${s}</th>`)}
            <th style=${{ padding: "8px 4px", width: "55px", fontWeight: 700 }}>মোট</th>
            <th style=${{ padding: "8px 4px", width: "48px" }}>গড় %</th>
            <th style=${{ padding: "8px 4px", width: "45px" }}>গ্রেড</th>
            ${showGpa && html`<th style=${{ padding: "8px 4px", width: "45px" }}>জিপিএ</th>`}
            <th style=${{ padding: "8px 4px", width: "50px" }}>মেধা</th>
            <th class="no-print" style=${{ padding: "8px 4px", width: "65px" }}>মার্কশিট</th>
          </tr>
        </thead>
        <tbody>
          ${calculatedResults.map(r => html`<tr key=${r.sid} style=${{ borderBottom: "1px solid var(--line)", textAlign: "center" }}>
            <td style=${{ padding: "8px 4px", fontWeight: 700 }}>${toBn(r.roll)}</td>
            <td style=${{ padding: "8px 6px", textAlign: "left", fontWeight: 600 }}>${r.name}</td>
            ${subjects.map(sub => {
              const s = r.subjects[sub];
              return html`<td key=${sub} style=${{ padding: "8px 4px" }}>
                ${s?.absent
                  ? html`<span style=${{ color: "var(--err)", fontSize: "0.8rem" }}>অনুপস্থিত</span>`
                  : toBn(s?.score ?? 0)}
              </td>`;
            })}
            <td style=${{ padding: "8px 4px", fontWeight: 700, color: "var(--acc)" }}>${toBn(r.totalScore)}</td>
            <td style=${{ padding: "8px 4px" }}>${toBn(r.avgPct)}%</td>
            <td style=${{ padding: "8px 4px", fontWeight: 700, color: r.grade === "F" ? "var(--err)" : "var(--ink)" }}>
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

// ৩. ফলাফল প্রকাশ ব্যবস্থাপনা কম্পোনেন্ট
function PublishTab({ publishStatus, togglePublish, publishBusy, publishMsg }) {
  const publishItems = EVALUATION_OPTIONS.filter(e => e.isComposite || e.id === "term_1" || e.id === "term_2" || e.id === "term_3");

  return html`<div class="card" style=${{ marginBottom: "16px" }}>
    <h3 style=${{ margin: "0 0 10px", fontSize: "1.1rem" }}>অনলাইনে ফলাফল প্রকাশ নিয়ন্ত্রণ</h3>
    <p class="sub" style=${{ margin: "0 0 14px", fontSize: "0.88rem" }}>
      এখানে যে মূল্যায়নের প্রকাশ সুইচ অন করবেন, শিক্ষার্থী ও অভিভাবকরা লগইন ছাড়াই রোল নম্বর দিয়ে অনলাইন মার্কশিট দেখতে পাবেন:
    </p>

    ${publishMsg && html`<p class="ok" style=${{ marginBottom: "12px" }}>${publishMsg}</p>`}

    <div style=${{ display: "grid", gap: "10px" }}>
      ${publishItems.map(e => {
        const isPub = !!publishStatus[e.id];
        return html`<div key=${e.id} style=${{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "10px 14px", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--line)"
        }}>
          <div>
            <b style=${{ fontSize: "0.95rem" }}>${e.name}</b>
            <div style=${{ fontSize: "0.8rem", color: isPub ? "var(--acc)" : "var(--mute)" }}>
              ${isPub ? "● অনলাইনে উন্মুক্ত আছে" : "○ অপ্রকাশিত"}
            </div>
          </div>
          <button disabled=${publishBusy}
            class=${isPub ? "danger" : "ghost"}
            style=${{ width: "auto", margin: 0, padding: "6px 14px", fontSize: "0.85rem" }}
            onClick=${() => togglePublish(e.id, !isPub)}>
            ${isPub ? "বন্ধ করুন" : "প্রকাশ করুন"}
          </button>
        </div>`;
      })}
    </div>
  </div>`;
}

// ৪. মূল ফলাফল ও প্রকাশ কম্পোনেন্ট (ট্যাবুলেশন শিট, মার্কশিট ও প্রকাশ নিয়ন্ত্রণ)
export function ResultsView({ profile }) {
  const isAdmin = profile.role === "main_admin" || profile.role === "assistant_admin";
  const [tab, setTab] = useState("tabulation");

  const [structure, setStructure] = useState([]);
  const [examConfig, setExamConfig] = useState(null);
  const [publishStatus, setPublishStatus] = useState({});

  const [classId, setClassId] = useState("");
  const [section, setSection] = useState("");
  const [evalId, setEvalId] = useState("annual");

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
        }
      }
      if (eSnap.exists()) setExamConfig(eSnap.data());
      if (pSnap.exists()) setPublishStatus(pSnap.data().published || {});
    });
  }, []);

  const curClass = structure.find(c => c.id === classId);
  const subjects = curClass?.subjects || [];
  const evalOption = EVALUATION_OPTIONS.find(e => e.id === evalId) || EVALUATION_OPTIONS[0];

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
      const stuList = stuSnap.docs.map(d => d.data());

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

  const calculatedResults = useMemo(() => {
    if (students.length === 0 || subjects.length === 0) return [];
    return calculateResults({
      students,
      marksDocs,
      examConfig,
      subjects,
      evalOption
    });
  }, [students, marksDocs, examConfig, subjects, evalOption]);

  async function togglePublish(eId, isPublished) {
    setPublishBusy(true);
    setPublishMsg("");
    try {
      const newStatus = { ...publishStatus, [eId]: isPublished };
      await setDoc(doc(db, "config", "publish"), {
        published: newStatus,
        updatedAt: serverTimestamp(),
        updatedBy: profile.name
      }, { merge: true });

      if (isPublished && calculatedResults.length > 0) {
        const resultDocId = `${eId}_${classId}_${section}`;
        await setDoc(doc(db, "results", resultDocId), {
          id: resultDocId,
          examId: eId,
          examName: evalOption.name,
          classId,
          className: curClass?.name || "",
          section,
          subjects,
          results: calculatedResults,
          publishedAt: serverTimestamp()
        }, { merge: true });
      }

      setPublishStatus(newStatus);
      setPublishMsg(isPublished ? "ফলাফল সফলভাবে অনলাইনে প্রকাশ করা হয়েছে।" : "ফলাফল অপ্রকাশিত করা হয়েছে।");
    } catch (e) {
      console.error(e);
      setPublishMsg("সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।");
    }
    setPublishBusy(false);
  }

  const showGpa = examConfig?.displayOptions?.showGpa ?? true;

  return html`<div style=${{ marginTop: "14px" }}>
    <div class="no-print" style=${{ display: "flex", gap: "8px", borderBottom: "2px solid var(--line)", paddingBottom: "8px", marginBottom: "14px" }}>
      <button class=${tab === "tabulation" ? "primary" : "ghost"}
        style=${{ width: "auto", margin: 0, padding: "8px 16px" }}
        onClick=${() => { setTab("tabulation"); setSelectedStudent(null); }}>
        ট্যাবুলেশন শিট ও মার্কশিট
      </button>
      ${isAdmin && html`<button class=${tab === "publish" ? "primary" : "ghost"}
        style=${{ width: "auto", margin: 0, padding: "8px 16px" }}
        onClick=${() => setTab("publish")}>
        ফলাফল প্রকাশ নিয়ন্ত্রণ
      </button>`}
    </div>

    ${tab === "publish" && isAdmin && html`<${PublishTab}
      publishStatus=${publishStatus}
      togglePublish=${togglePublish}
      publishBusy=${publishBusy}
      publishMsg=${publishMsg} />`}

    ${tab === "tabulation" && html`<div>
      <div class="card no-print" style=${{ marginBottom: "14px" }}>
        <div style=${{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
          <div>
            <label style=${{ margin: "0 0 4px" }}>শ্রেণি</label>
            <select value=${classId} onChange=${e => {
              const cid = e.target.value; setClassId(cid);
              const cl = structure.find(c => c.id === cid);
              if (cl) setSection(cl.sections[0] || "");
            }} style=${{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--line)" }}>
              ${structure.map(c => html`<option key=${c.id} value=${c.id}>${c.name}</option>`)}
            </select>
          </div>

          <div>
            <label style=${{ margin: "0 0 4px" }}>শাখা</label>
            <select value=${section} onChange=${e => setSection(e.target.value)}
              style=${{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--line)" }}>
              ${(curClass?.sections || []).map(s => html`<option key=${s} value=${s}>${s}</option>`)}
            </select>
          </div>

          <div style=${{ gridColumn: "span 2" }}>
            <label style=${{ margin: "0 0 4px" }}>মূল্যায়ন নির্বাচন</label>
            <select value=${evalId} onChange=${e => { setEvalId(e.target.value); setSelectedStudent(null); }}
              style=${{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--line)", fontWeight: 600 }}>
              <optgroup label="সমন্বিত / সামগ্রিক ফলাফল">
                ${EVALUATION_OPTIONS.filter(e => e.isComposite).map(e => html`<option key=${e.id} value=${e.id}>${e.name}</option>`)}
              </optgroup>
              <optgroup label="একক পরীক্ষাসমূহ">
                ${EVALUATION_OPTIONS.filter(e => !e.isComposite).map(e => html`<option key=${e.id} value=${e.id}>${e.name}</option>`)}
              </optgroup>
            </select>
          </div>
        </div>

        <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", flexWrap: "wrap", gap: "8px" }}>
          <div style=${{ fontSize: "0.88rem", color: "var(--mute)" }}>
            শিক্ষার্থী: <b>${toBn(students.length)} জন</b> | বিষয়: <b>${toBn(subjects.length)} টি</b>
          </div>
          <div style=${{ display: "flex", gap: "8px" }}>
            <button type="button" class="ghost" onClick=${loadData} style=${{ width: "auto", margin: 0, padding: "5px 12px", fontSize: "0.85rem" }}>
              🔄 রিফ্রেশ
            </button>
            <button type="button" onClick=${() => window.print()} style=${{ width: "auto", margin: 0, padding: "5px 14px", fontSize: "0.85rem", background: "var(--acc)", color: "#fff" }}>
              🖨️ ট্যাবুলেশন শিট প্রিন্ট
            </button>
          </div>
        </div>
      </div>

      ${loading && html`<p class="sub">ফলাফল তৈরি হচ্ছে…</p>`}

      ${selectedStudent && html`<${MarksheetCard}
        student=${selectedStudent}
        evalName=${evalOption.name}
        className=${curClass?.name || ""}
        section=${section}
        examConfig=${examConfig}
        onClose=${() => setSelectedStudent(null)} />`}

      ${!selectedStudent && !loading && calculatedResults.length > 0 && html`<${TabulationTable}
        calculatedResults=${calculatedResults}
        subjects=${subjects}
        showGpa=${showGpa}
        curClass=${curClass}
        section=${section}
        evalOption=${evalOption}
        onSelectStudent=${setSelectedStudent} />`}

      ${!loading && calculatedResults.length === 0 && html`<div class="card">
        <p class="sub" style=${{ margin: 0 }}>এই শ্রেণির জন্য এখনো কোনো শিক্ষার্থী বা নম্বর পাওয়া যায়নি।</p>
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
  const [evalId, setEvalId] = useState("annual");
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
  const publishedEvals = EVALUATION_OPTIONS.filter(e => publishStatus[e.id]);

  async function handleSearch(e) {
    e.preventDefault();
    setErr("");
    setResultData(null);

    const rNum = parseInt(bn2en(roll), 10);
    if (!rNum) return setErr("সঠিক রোল নম্বর লিখুন।");
    if (!publishStatus[evalId]) {
      return setErr("এই মূল্যায়নের ফলাফল এখনো অনলাইনে প্রকাশিত হয়নি।");
    }

    setLoading(true);
    try {
      const resultDocId = `${evalId}_${classId}_${section}`;
      const rSnap = await getDoc(doc(db, "results", resultDocId));
      if (!rSnap.exists()) {
        setErr("এই শ্রেণি ও শাখার ফলাফল এখনো অনলাইনে প্রস্তুত হয়নি।");
        setLoading(false);
        return;
      }

      const data = rSnap.data();
      const st = (data.results || []).find(r => r.roll === rNum);

      if (!st) {
        setErr("এই রোল নম্বরের কোনো ফলাফল পাওয়া যায়নি। রোল ও শাখা যাচাই করুন।");
        setLoading(false);
        return;
      }

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

      setResultData({
        student: st,
        evalName: data.examName || "মূল্যায়ন",
        className: data.className || curClass?.name || "",
        section: data.section || section
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
        শ্রেণি, শাখা ও রোল নম্বর দিয়ে মার্কশিট দেখুন:
      </p>

      <label style=${{ marginTop: 0 }}>পরীক্ষা / মূল্যায়ন
        <select value=${evalId} onChange=${e => setEvalId(e.target.value)}
          style=${{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)", fontWeight: 600 }}>
          ${publishedEvals.length === 0
            ? html`<option value="">বর্তমানে কোনো ফলাফল অনলাইনে প্রকাশের অপেক্ষায় রয়েছে</option>`
            : publishedEvals.map(e => html`<option key=${e.id} value=${e.id}>${e.name}</option>`)}
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

      <button disabled=${loading || publishedEvals.length === 0} style=${{ marginTop: "16px" }}>
        ${loading ? "ফলাফল অনুসন্ধান হচ্ছে…" : "ফলাফল দেখুন"}
      </button>
    </form>`}
  </div>`;
}
