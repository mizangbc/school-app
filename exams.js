import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { db } from "./firebase.js";
import { doc, getDoc, setDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const html = htm.bind(React.createElement);
const bn2en = s => String(s || "").replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
const digits = s => bn2en(s).replace(/\D/g, "");
const toBn = n => String(n ?? "").replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);

// ৯টি সুনির্দিষ্ট মূল্যায়ন তালিকা
export const DEFAULT_EXAMS = [
  // ১ম পর্যায়
  { id: "ca_1_1", name: "ধারাবাহিক মূল্যায়ন ১.১", phase: 1, type: "continuous", fullMarks: 20 },
  { id: "ca_1_2", name: "ধারাবাহিক মূল্যায়ন ১.২", phase: 1, type: "continuous", fullMarks: 20 },
  { id: "term_1", name: "প্রথম প্রান্তিক মূল্যায়ন", phase: 1, type: "terminal", fullMarks: 60 },

  // ২য় পর্যায়
  { id: "ca_2_1", name: "ধারাবাহিক মূল্যায়ন ২.১", phase: 2, type: "continuous", fullMarks: 20 },
  { id: "ca_2_2", name: "ধারাবাহিক মূল্যায়ন ২.২", phase: 2, type: "continuous", fullMarks: 20 },
  { id: "term_2", name: "দ্বিতীয় প্রান্তিক মূল্যায়ন", phase: 2, type: "terminal", fullMarks: 60 },

  // ৩য় পর্যায়
  { id: "ca_3_1", name: "ধারাবাহিক মূল্যায়ন ৩.১", phase: 3, type: "continuous", fullMarks: 20 },
  { id: "ca_3_2", name: "ধারাবাহিক মূল্যায়ন ৩.২", phase: 3, type: "continuous", fullMarks: 20 },
  { id: "term_3", name: "তৃতীয় প্রান্তিক মূল্যায়ন", phase: 3, type: "terminal", fullMarks: 60 }
];

// বার্ষিক ফলাফলে প্রান্তিকসমূহের শতকরা ওজন
export const DEFAULT_ANNUAL_WEIGHTS = [
  { phase: 1, name: "১ম প্রান্তিক সামগ্রিক", weight: 25 },
  { phase: 2, name: "২য় প্রান্তিক সামগ্রিক", weight: 25 },
  { phase: 3, name: "৩য় প্রান্তিক সামগ্রিক", weight: 50 }
];

// লেটার গ্রেড প্রিসেট
export const LETTER_GRADES = [
  { grade: "A+", gpa: 5.0, min: 80, max: 100 },
  { grade: "A",  gpa: 4.0, min: 70, max: 79 },
  { grade: "A-", gpa: 3.5, min: 60, max: 69 },
  { grade: "B",  gpa: 3.0, min: 50, max: 59 },
  { grade: "C",  gpa: 2.0, min: 40, max: 49 },
  { grade: "D",  gpa: 1.0, min: 33, max: 39 },
  { grade: "F",  gpa: 0.0, min: 0,  max: 32 }
];

// বর্ণনামূলক মূল্যায়ন প্রিসেট (প্রাথমিক কারিকুলাম)
export const DESCRIPTIVE_GRADES = [
  { grade: "অতি উত্তম",        gpa: 5.0, min: 80, max: 100 },
  { grade: "উত্তম",            gpa: 4.0, min: 65, max: 79 },
  { grade: "ভালো",             gpa: 3.0, min: 50, max: 64 },
  { grade: "চলতি মান",         gpa: 2.0, min: 33, max: 49 },
  { grade: "অগ্রগতি প্রয়োজন", gpa: 0.0, min: 0,  max: 32 }
];

export function defaultExamConfig() {
  return {
    exams: DEFAULT_EXAMS,
    annualWeights: DEFAULT_ANNUAL_WEIGHTS,
    grading: LETTER_GRADES,
    passMarkPercent: 33,
    displayOptions: {
      showMarks: true,
      showGrade: true,
      showGpa: true,
      showMeritRank: true
    }
  };
}

export function Exams() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "config", "exams")).then(s => {
      if (s.exists()) {
        const d = s.data();
        const examsList = (d.exams && Array.isArray(d.exams) && d.exams.length > 0)
          ? d.exams : DEFAULT_EXAMS;
        const weightsList = (d.annualWeights && Array.isArray(d.annualWeights) && d.annualWeights.length > 0)
          ? d.annualWeights : DEFAULT_ANNUAL_WEIGHTS;
        const grades = (d.grading && Array.isArray(d.grading) && d.grading.length > 0)
          ? d.grading.map(g => ({
              grade: g.grade || "",
              gpa: g.gpa != null ? g.gpa : 0.0,
              min: g.min != null ? g.min : 0,
              max: g.max != null ? g.max : 100
            }))
          : LETTER_GRADES;

        setConfig({
          ...defaultExamConfig(),
          ...d,
          exams: examsList,
          annualWeights: weightsList,
          grading: grades
        });
      } else {
        setConfig(defaultExamConfig());
      }
      setLoading(false);
    }).catch(e => {
      console.error(e);
      setErr("লোড করা যায়নি।");
      setLoading(false);
    });
  }, []);

  function updateAnnualWeight(phase, val) {
    const weights = (config.annualWeights || DEFAULT_ANNUAL_WEIGHTS).map(w =>
      w.phase === phase ? { ...w, weight: parseInt(digits(val), 10) || 0 } : w
    );
    setConfig({ ...config, annualWeights: weights });
  }

  function updateExamMarks(id, val) {
    const updated = (config.exams || DEFAULT_EXAMS).map(e =>
      e.id === id ? { ...e, fullMarks: parseInt(digits(val), 10) || 0 } : e
    );
    setConfig({ ...config, exams: updated });
  }

  function updateGrade(i, field, val) {
    const list = [...config.grading];
    list[i] = { ...list[i], [field]: val };
    setConfig({ ...config, grading: list });
  }

  function addGrade() {
    const list = [...config.grading];
    list.push({ grade: "", gpa: "0.0", min: "0", max: "100" });
    setConfig({ ...config, grading: list });
  }

  function removeGrade(i) {
    if (config.grading.length <= 1) {
      alert("কমপক্ষে একটি গ্রেড ধাপ থাকতে হবে।");
      return;
    }
    const list = config.grading.filter((_, idx) => idx !== i);
    setConfig({ ...config, grading: list });
  }

  function applyPreset(preset) {
    setConfig({ ...config, grading: preset.map(g => ({ ...g })) });
  }

  function updateDisplay(field, val) {
    setConfig({
      ...config,
      displayOptions: { ...config.displayOptions, [field]: val }
    });
  }

  async function handleSave() {
    setErr("");
    setOkMsg("");

    // ১. বার্ষিক ওজন যাচাই
    const weights = config.annualWeights || DEFAULT_ANNUAL_WEIGHTS;
    const totalWeight = weights.reduce((sum, w) => sum + (parseInt(digits(w.weight), 10) || 0), 0);
    if (totalWeight !== 100) {
      return setErr(`বার্ষিক ফলাফলে প্রান্তিকসমূহের মোট ওজনের যোগফল ১০০% হতে হবে (বর্তমানে আছে: ${toBn(totalWeight)}%)।`);
    }

    // ২. গ্রেডিং তালিকা যাচাই
    const finalGrading = [];
    for (let i = 0; i < config.grading.length; i++) {
      const g = config.grading[i];
      const gName = String(g.grade || "").trim();
      if (!gName) return setErr(`ক্রমিক ${toBn(i + 1)} গ্রেডের নাম ফাঁকা রাখা যাবে না।`);
      const min = parseInt(bn2en(g.min), 10);
      const max = parseInt(bn2en(g.max), 10);
      if (isNaN(min) || isNaN(max)) return setErr(`"${gName}"-এর নম্বর পরিসীমা সঠিকভাবে লিখুন।`);
      if (min > max) return setErr(`"${gName}"-এ সর্বনিম্ন নম্বর (${toBn(min)}) সর্বোচ্চ নম্বরের (${toBn(max)}) চেয়ে বেশি হতে পারবে না।`);
      finalGrading.push({
        grade: gName,
        gpa: parseFloat(bn2en(g.gpa)) || 0.0,
        min,
        max
      });
    }

    setBusy(true);
    try {
      await setDoc(doc(db, "config", "exams"), {
        ...config,
        grading: finalGrading,
        annualWeights: weights,
        passMarkPercent: parseInt(digits(config.passMarkPercent), 10) || 33,
        updatedAt: serverTimestamp()
      });
      setConfig({ ...config, grading: finalGrading, annualWeights: weights });
      setOkMsg("পরীক্ষার সেটিং সফলভাবে সংরক্ষণ করা হয়েছে।");
    } catch (ex) {
      console.error(ex);
      setErr("সংরক্ষণ করা যায়নি। ইন্টারনেট ও Rules দেখুন।");
    }
    setBusy(false);
  }

  if (loading) return html`<p class="sub">পরীক্ষার সেটিং লোড হচ্ছে…</p>`;
  if (!config) return html`<p class="err">${err || "সেটিং পাওয়া যায়নি।"}</p>`;

  const weights = config.annualWeights || DEFAULT_ANNUAL_WEIGHTS;
  const totalWeight = weights.reduce((sum, w) => sum + (parseInt(digits(w.weight), 10) || 0), 0);

  const phase1Exams = (config.exams || DEFAULT_EXAMS).filter(e => e.phase === 1);
  const phase2Exams = (config.exams || DEFAULT_EXAMS).filter(e => e.phase === 2);
  const phase3Exams = (config.exams || DEFAULT_EXAMS).filter(e => e.phase === 3);

  return html`<div style=${{ marginTop: "14px" }}>
    <div class="card" style=${{ marginBottom: "16px" }}>
      <h3 style=${{ margin: "0 0 10px", fontSize: "1.1rem" }}>১. বার্ষিক ফলাফলে প্রান্তিকসমূহের ওয়েটেজ (%)</h3>
      <p class="sub" style=${{ margin: "0 0 12px", fontSize: "0.88rem" }}>
        চূড়ান্ত বার্ষিক ফলাফল তৈরিতে প্রতিটি প্রান্তিকের শতকরা অনুপাত (মোট ১০০%):
      </p>

      ${weights.map(w => html`<div key=${w.phase} style=${{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 0", borderBottom: "1px dashed var(--line)"
      }}>
        <b>${w.name}</b>
        <div style=${{ display: "flex", alignItems: "center", gap: "4px" }}>
          <input type="tel" inputMode="numeric" value=${w.weight}
            onInput=${e => updateAnnualWeight(w.phase, e.target.value)}
            style=${{ width: "65px", padding: "6px 8px", textAlign: "center", fontWeight: 600 }} />
          <span>%</span>
        </div>
      </div>`)}

      <div style=${{ display: "flex", justifyContent: "space-between", marginTop: "10px", fontWeight: 600 }}>
        <span>মোট ওয়েটেজ:</span>
        <span style=${{ color: totalWeight === 100 ? "var(--acc)" : "var(--err)" }}>
          ${toBn(totalWeight)}% ${totalWeight === 100 ? "✓" : "(১০০% হতে হবে)"}
        </span>
      </div>
    </div>

    <div class="card" style=${{ marginBottom: "16px" }}>
      <h3 style=${{ margin: "0 0 8px", fontSize: "1.1rem" }}>২. পরীক্ষাসমূহের তালিকা ও পূর্ণমান</h3>
      <p class="sub" style=${{ margin: "0 0 14px", fontSize: "0.88rem" }}>
        প্রয়োজনে প্রতিটি ধারাবাহিক ও প্রান্তিক মূল্যায়নের পূর্ণমান পরিবর্তন করতে পারেন:
      </p>

      <div style=${{ background: "var(--bg)", padding: "10px 12px", borderRadius: "8px", marginBottom: "10px" }}>
        <b style=${{ color: "var(--acc)", fontSize: "0.95rem" }}>✦ ১ম পর্যায়</b>
        <div style=${{ marginTop: "6px", display: "grid", gap: "6px" }}>
          ${phase1Exams.map(ex => html`<div key=${ex.id} style=${{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style=${{ fontSize: "0.9rem" }}>${ex.name}</span>
            <div style=${{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style=${{ fontSize: "0.8rem", color: "var(--mute)" }}>পূর্ণমান:</span>
              <input type="tel" inputMode="numeric" value=${ex.fullMarks}
                onInput=${e => updateExamMarks(ex.id, e.target.value)}
                style=${{ width: "55px", padding: "5px 6px", textAlign: "center", background: "#fff", fontWeight: 600 }} />
            </div>
          </div>`)}
        </div>
      </div>

      <div style=${{ background: "var(--bg)", padding: "10px 12px", borderRadius: "8px", marginBottom: "10px" }}>
        <b style=${{ color: "var(--acc)", fontSize: "0.95rem" }}>✦ ২য় পর্যায়</b>
        <div style=${{ marginTop: "6px", display: "grid", gap: "6px" }}>
          ${phase2Exams.map(ex => html`<div key=${ex.id} style=${{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style=${{ fontSize: "0.9rem" }}>${ex.name}</span>
            <div style=${{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style=${{ fontSize: "0.8rem", color: "var(--mute)" }}>পূর্ণমান:</span>
              <input type="tel" inputMode="numeric" value=${ex.fullMarks}
                onInput=${e => updateExamMarks(ex.id, e.target.value)}
                style=${{ width: "55px", padding: "5px 6px", textAlign: "center", background: "#fff", fontWeight: 600 }} />
            </div>
          </div>`)}
        </div>
      </div>

      <div style=${{ background: "var(--bg)", padding: "10px 12px", borderRadius: "8px" }}>
        <b style=${{ color: "var(--acc)", fontSize: "0.95rem" }}>✦ ৩য় পর্যায়</b>
        <div style=${{ marginTop: "6px", display: "grid", gap: "6px" }}>
          ${phase3Exams.map(ex => html`<div key=${ex.id} style=${{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style=${{ fontSize: "0.9rem" }}>${ex.name}</span>
            <div style=${{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style=${{ fontSize: "0.8rem", color: "var(--mute)" }}>পূর্ণমান:</span>
              <input type="tel" inputMode="numeric" value=${ex.fullMarks}
                onInput=${e => updateExamMarks(ex.id, e.target.value)}
                style=${{ width: "55px", padding: "5px 6px", textAlign: "center", background: "#fff", fontWeight: 600 }} />
            </div>
          </div>`)}
        </div>
      </div>
    </div>

    <div class="card" style=${{ marginBottom: "16px" }}>
      <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
        <h3 style=${{ margin: 0, fontSize: "1.1rem" }}>৩. গ্রেডিং ও নম্বর পরিসর নির্ধারণ</h3>
        <button type="button" class="ghost" style=${{ width: "auto", padding: "6px 14px", fontSize: "0.88rem", color: "var(--acc)", borderColor: "var(--acc)" }} onClick=${addGrade}>
          + নতুন গ্রেড সারি যোগ
        </button>
      </div>

      <p class="sub" style=${{ margin: "0 0 10px", fontSize: "0.88rem" }}>
        বাম কলামে গ্রেডের নাম এবং ডান কলামে নম্বর পরিসর (শুরু - শেষ) সরাসরি বক্সে লিখে পরিবর্তন করুন:
      </p>

      <div style=${{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style=${{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          <span style=${{ fontSize: "0.85rem", color: "var(--mute)", fontWeight: 600 }}>প্রিসেট:</span>
          <button type="button" class="ghost" style=${{ padding: "4px 10px", fontSize: "0.85rem", width: "auto" }} onClick=${() => applyPreset(LETTER_GRADES)}>
            লেটার গ্রেড (A+, A...)
          </button>
          <button type="button" class="ghost" style=${{ padding: "4px 10px", fontSize: "0.85rem", width: "auto" }} onClick=${() => applyPreset(DESCRIPTIVE_GRADES)}>
            বর্ণনামূলক (অতি উত্তম, উত্তম...)
          </button>
        </div>

        <label style=${{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "0.85rem", background: "var(--bg)", padding: "5px 10px", borderRadius: "6px", border: "1px solid var(--line)" }}>
          <input type="checkbox" checked=${config.displayOptions?.showGpa}
            onChange=${e => updateDisplay("showGpa", e.target.checked)} style=${{ width: "auto" }} />
          <span style=${{ fontWeight: 600 }}>জিপিএ (GPA) পয়েন্ট রাখুন</span>
        </label>
      </div>

      <div style=${{ overflowX: "auto", margin: "6px 0 12px" }}>
        <table style=${{ width: "100%", borderCollapse: "collapse", minWidth: "300px" }}>
          <thead>
            <tr style=${{ background: "var(--bg)", borderBottom: "2px solid var(--line)", textAlign: "left" }}>
              <th style=${{ padding: "10px 8px", fontSize: "0.88rem" }}>গ্রেড / মান</th>
              <th style=${{ padding: "10px 8px", fontSize: "0.88rem", textAlign: "center" }}>নম্বর পরিসর (%)</th>
              ${config.displayOptions?.showGpa && html`<th style=${{ padding: "10px 6px", fontSize: "0.88rem", textAlign: "center", width: "58px" }}>পয়েন্ট</th>`}
              <th style=${{ padding: "10px 4px", width: "36px" }}></th>
            </tr>
          </thead>
          <tbody>
            ${(config.grading || []).map((g, i) => html`<tr key=${i} style=${{ borderBottom: "1px solid var(--line)" }}>
              <td style=${{ padding: "8px 6px" }}>
                <input type="text" value=${g.grade} placeholder="A+ বা অতি উত্তম"
                  onInput=${e => updateGrade(i, "grade", e.target.value)}
                  style=${{ width: "100%", padding: "8px 10px", fontWeight: 600, borderRadius: "6px", border: "1px solid var(--line)" }} />
              </td>
              <td style=${{ padding: "8px 6px" }}>
                <div style=${{ display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}>
                  <input type="number" value=${g.min} placeholder="শুরু"
                    onInput=${e => updateGrade(i, "min", e.target.value)}
                    style=${{ width: "54px", padding: "8px 4px", textAlign: "center", fontWeight: 600, borderRadius: "6px", border: "1px solid var(--line)" }} />
                  <span style=${{ color: "var(--mute)", fontWeight: 700 }}>-</span>
                  <input type="number" value=${g.max} placeholder="শেষ"
                    onInput=${e => updateGrade(i, "max", e.target.value)}
                    style=${{ width: "54px", padding: "8px 4px", textAlign: "center", fontWeight: 600, borderRadius: "6px", border: "1px solid var(--line)" }} />
                </div>
              </td>
              ${config.displayOptions?.showGpa && html`<td style=${{ padding: "8px 4px", textAlign: "center" }}>
                <input type="text" value=${g.gpa} placeholder="5.0"
                  onInput=${e => updateGrade(i, "gpa", e.target.value)}
                  style=${{ width: "50px", padding: "8px 4px", textAlign: "center", fontWeight: 600, borderRadius: "6px", border: "1px solid var(--line)" }} />
              </td>`}
              <td style=${{ padding: "8px 2px", textAlign: "center" }}>
                <button type="button" class="danger"
                  style=${{ width: "28px", height: "34px", padding: 0, margin: 0, fontSize: "1.2rem", lineHeight: 1, borderRadius: "6px" }}
                  onClick=${() => removeGrade(i)} title="মুছে ফেলুন">×</button>
              </td>
            </tr>`)}
          </tbody>
        </table>
      </div>

      <div style=${{ marginTop: "10px", padding: "10px 12px", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style=${{ fontWeight: 600, fontSize: "0.95rem" }}>ন্যূনতম পাস নম্বর (%)</span>
        <div style=${{ width: "90px" }}>
          <input type="number" value=${config.passMarkPercent ?? 33}
            onInput=${e => setConfig({ ...config, passMarkPercent: e.target.value })}
            style=${{ padding: "8px", textAlign: "center", fontWeight: 600, background: "#fff" }} />
        </div>
      </div>
    </div>

    <div class="card" style=${{ marginBottom: "16px" }}>
      <h3 style=${{ margin: "0 0 10px", fontSize: "1.1rem" }}>৪. মার্কশিট প্রদর্শন অপশন</h3>
      <div style=${{ display: "grid", gap: "8px" }}>
        <label style=${{ display: "flex", alignItems: "center", gap: "10px", margin: 0, cursor: "pointer" }}>
          <input type="checkbox" checked=${config.displayOptions?.showMarks}
            onChange=${e => updateDisplay("showMarks", e.target.checked)} style=${{ width: "auto" }} />
          <span>অর্জিত পূর্ণ নম্বর প্রদর্শন করুন</span>
        </label>
        <label style=${{ display: "flex", alignItems: "center", gap: "10px", margin: 0, cursor: "pointer" }}>
          <input type="checkbox" checked=${config.displayOptions?.showGrade}
            onChange=${e => updateDisplay("showGrade", e.target.checked)} style=${{ width: "auto" }} />
          <span>গ্রেড / অর্জন মাত্রা প্রদর্শন করুন</span>
        </label>
        <label style=${{ display: "flex", alignItems: "center", gap: "10px", margin: 0, cursor: "pointer" }}>
          <input type="checkbox" checked=${config.displayOptions?.showGpa}
            onChange=${e => updateDisplay("showGpa", e.target.checked)} style=${{ width: "auto" }} />
          <span>জিপিএ (GPA) প্রদর্শন করুন</span>
        </label>
        <label style=${{ display: "flex", alignItems: "center", gap: "10px", margin: 0, cursor: "pointer" }}>
          <input type="checkbox" checked=${config.displayOptions?.showMeritRank}
            onChange=${e => updateDisplay("showMeritRank", e.target.checked)} style=${{ width: "auto" }} />
          <span>শ্রেণি মেধা স্থান (Merit Position) প্রদর্শন করুন</span>
        </label>
      </div>
    </div>

    ${err && html`<p class="err">${err}</p>`}
    ${okMsg && html`<p class="ok">${okMsg}</p>`}

    <div style=${{ display: "flex", gap: "8px", marginTop: "14px" }}>
      <button disabled=${busy} onClick=${handleSave} style=${{ flex: 2, margin: 0 }}>
        ${busy ? "সংরক্ষণ হচ্ছে…" : "সেটিং সংরক্ষণ করুন"}
      </button>
      <button type="button" class="ghost" onClick=${() => setConfig(defaultExamConfig())} style=${{ flex: 1, margin: 0 }}>
        ডিফল্ট সেটিং
      </button>
    </div>
  </div>`;
}
