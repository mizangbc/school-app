import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { db } from "./firebase.js";
import { doc, getDoc, setDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const html = htm.bind(React.createElement);
const bn2en = s => String(s || "").replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
const digits = s => bn2en(s).replace(/\D/g, "");
const toBn = n => String(n ?? "").replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);

// ৩টি প্রান্তিক মূল্যায়ন
export const DEFAULT_TERMS = [
  { id: "term_1", name: "১ম প্রান্তিক মূল্যায়ন", phase: 1 },
  { id: "term_2", name: "২য় প্রান্তিক মূল্যায়ন", phase: 2 },
  { id: "term_3", name: "৩য় প্রান্তিক মূল্যায়ন", phase: 3 }
];

// বার্ষিক ফলাফলে প্রান্তিকসমূহের শতকরা অনুপাত (ওয়েটেজ)
export const DEFAULT_ANNUAL_WEIGHTS = [
  { phase: 1, name: "১ম প্রান্তিক", weight: 25 },
  { phase: 2, name: "২য় প্রান্তিক", weight: 25 },
  { phase: 3, name: "৩য় প্রান্তিক", weight: 50 }
];

// শ্রেণিভিত্তিক ধারাবাহিক ও সামষ্টিক অনুপাত (%)
export const DEFAULT_CLASS_RATIOS = {
  c0: { continuous: 100, terminal: 0, label: "প্রাক-প্রাথমিক" },
  c1: { continuous: 50,  terminal: 50, label: "১ম শ্রেণি" },
  c2: { continuous: 50,  terminal: 50, label: "২য় শ্রেণি" },
  c3: { continuous: 30,  terminal: 70, label: "৩য় শ্রেণি" },
  c4: { continuous: 30,  terminal: 70, label: "৪র্থ শ্রেণি" },
  c5: { continuous: 30,  terminal: 70, label: "৫ম শ্রেণি" }
};

// ১. বর্ণনামূলক মূল্যায়ন প্রিসেট (প্রাথমিক কারিকুলাম মান)
export const DESCRIPTIVE_GRADES = [
  { grade: "অতি উত্তম",        gpa: 5.0, min: 80, max: 100 },
  { grade: "উত্তম",            gpa: 4.0, min: 65, max: 79 },
  { grade: "ভালো",             gpa: 3.0, min: 50, max: 64 },
  { grade: "চলতি মান",         gpa: 2.0, min: 33, max: 49 },
  { grade: "অগ্রগতি প্রয়োজন", gpa: 0.0, min: 0,  max: 32 }
];

// ২. লেটার গ্রেড প্রিসেট
export const LETTER_GRADES = [
  { grade: "A+", gpa: 5.0, min: 80, max: 100 },
  { grade: "A",  gpa: 4.0, min: 70, max: 79 },
  { grade: "A-", gpa: 3.5, min: 60, max: 69 },
  { grade: "B",  gpa: 3.0, min: 50, max: 59 },
  { grade: "C",  gpa: 2.0, min: 40, max: 49 },
  { grade: "D",  gpa: 1.0, min: 33, max: 39 },
  { grade: "F",  gpa: 0.0, min: 0,  max: 32 }
];

export function defaultExamConfig() {
  return {
    terms: DEFAULT_TERMS,
    annualWeights: DEFAULT_ANNUAL_WEIGHTS,
    classRatios: DEFAULT_CLASS_RATIOS,
    grading: DESCRIPTIVE_GRADES,
    passMarkPercent: 33,
    displayOptions: {
      showMarks: true,
      showGrade: true,
      showGpa: false,
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
        const weightsList = (d.annualWeights && Array.isArray(d.annualWeights) && d.annualWeights.length > 0)
          ? d.annualWeights : DEFAULT_ANNUAL_WEIGHTS;
        const ratios = d.classRatios || DEFAULT_CLASS_RATIOS;
        const grades = (d.grading && Array.isArray(d.grading) && d.grading.length > 0)
          ? d.grading.map(g => ({
              grade: g.grade || "",
              gpa: g.gpa != null ? g.gpa : 0.0,
              min: g.min != null ? g.min : 0,
              max: g.max != null ? g.max : 100
            }))
          : DESCRIPTIVE_GRADES;

        setConfig({
          ...defaultExamConfig(),
          ...d,
          annualWeights: weightsList,
          classRatios: ratios,
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

  function updateClassRatio(classKey, field, val) {
    const num = parseInt(digits(val), 10) || 0;
    const cur = config.classRatios?.[classKey] || DEFAULT_CLASS_RATIOS[classKey];
    const otherField = field === "continuous" ? "terminal" : "continuous";
    const otherVal = Math.max(0, 100 - num);

    setConfig({
      ...config,
      classRatios: {
        ...(config.classRatios || DEFAULT_CLASS_RATIOS),
        [classKey]: {
          ...cur,
          [field]: num,
          [otherField]: otherVal
        }
      }
    });
  }

  function updateGrade(i, field, val) {
    const list = [...config.grading];
    list[i] = { ...list[i], [field]: val };
    setConfig({ ...config, grading: list });
  }

  function addGrade() {
    setConfig({
      ...config,
      grading: [...config.grading, { grade: "", min: 0, max: 0, gpa: 0.0 }]
    });
  }

  function removeGrade(i) {
    if (config.grading.length <= 1) {
      alert("কমপক্ষে একটি গ্রেড সারি থাকতে হবে।");
      return;
    }
    setConfig({
      ...config,
      grading: config.grading.filter((_, idx) => idx !== i)
    });
  }

  function applyPreset(preset) {
    setConfig({
      ...config,
      grading: preset.map(g => ({ ...g }))
    });
  }

  function updateDisplay(key, val) {
    setConfig({
      ...config,
      displayOptions: {
        ...(config.displayOptions || {}),
        [key]: val
      }
    });
  }

  async function save() {
    setErr("");
    setOkMsg("");

    const weights = config.annualWeights || DEFAULT_ANNUAL_WEIGHTS;
    const totalW = weights.reduce((sum, w) => sum + (parseInt(digits(w.weight), 10) || 0), 0);
    if (totalW !== 100) {
      return setErr(`প্রান্তিকসমূহের মোট ওয়েটেজ ১০০% হতে হবে (বর্তমানে মোট: ${toBn(totalW)}%)।`);
    }

    const finalGrading = (config.grading || []).map(g => ({
      grade: String(g.grade || "").trim(),
      gpa: parseFloat(g.gpa) || 0.0,
      min: parseInt(digits(g.min), 10) || 0,
      max: parseInt(digits(g.max), 10) || 0
    }));

    if (finalGrading.some(g => !g.grade)) {
      return setErr("প্রতিটি গ্রেডের নাম বা মান লিখুন।");
    }

    setBusy(true);
    try {
      await setDoc(doc(db, "config", "exams"), {
        ...config,
        grading: finalGrading,
        annualWeights: weights,
        classRatios: config.classRatios || DEFAULT_CLASS_RATIOS,
        passMarkPercent: parseInt(digits(config.passMarkPercent), 10) || 33,
        updatedAt: serverTimestamp()
      });
      setConfig({ ...config, grading: finalGrading, annualWeights: weights });
      setOkMsg("পরীক্ষার সেটিং সফলভাবে সংরক্ষণ করা হয়েছে।");
    } catch (ex) {
      console.error(ex);
      setErr("সংরক্ষণ করা যায়নি: " + (ex.code || ex.message || "ইন্টারনেট সংযোগ দেখুন।"));
    }
    setBusy(false);
  }

  if (loading) return html`<p class="sub">পরীক্ষার সেটিং লোড হচ্ছে…</p>`;
  if (!config) return html`<p class="err">${err || "সেটিং পাওয়া যায়নি।"}</p>`;

  const weights = config.annualWeights || DEFAULT_ANNUAL_WEIGHTS;
  const totalWeight = weights.reduce((sum, w) => sum + (parseInt(digits(w.weight), 10) || 0), 0);
  const ratios = config.classRatios || DEFAULT_CLASS_RATIOS;

  return html`<div style=${{ marginTop: "14px" }}>
    <div class="card" style=${{ marginBottom: "16px" }}>
      <h3 style=${{ margin: "0 0 10px", fontSize: "1.1rem" }}>১. বার্ষিক ফলাফলে প্রান্তিকসমূহের ওয়েটেজ (%)</h3>
      <p class="sub" style=${{ margin: "0 0 12px", fontSize: "0.88rem" }}>
        চূড়ান্ত বার্ষিক ফলাফলে প্রতিটি প্রান্তিকের শতকরা অনুপাত (মোট ১০০%):
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
      <h3 style=${{ margin: "0 0 8px", fontSize: "1.1rem" }}>২. শ্রেণিভিত্তিক ধারাবাহিক ও সামষ্টিক অনুপাত (%)</h3>
      <p class="sub" style=${{ margin: "0 0 14px", fontSize: "0.88rem" }}>
        সরকারি প্রাথমিক কারিকুলাম অনুযায়ী ধারাবাহিক ও প্রান্তিক লিখিত মূল্যায়নের শতকরা অনুপাত (মোট ১০০%):
      </p>

      <div style=${{ display: "grid", gap: "10px" }}>
        ${["c1", "c2", "c3", "c4", "c5", "c0"].map(ck => {
          const r = ratios[ck] || DEFAULT_CLASS_RATIOS[ck];
          return html`<div key=${ck} style=${{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "8px 12px", background: "var(--bg)", borderRadius: "8px"
          }}>
            <b>${r.label}</b>
            <div style=${{ display: "flex", alignItems: "center", gap: "12px", fontSize: "0.9rem" }}>
              <div style=${{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span>ধারাবাহিক:</span>
                <input type="tel" inputMode="numeric" value=${r.continuous}
                  onInput=${e => updateClassRatio(ck, "continuous", e.target.value)}
                  style=${{ width: "50px", padding: "5px", textAlign: "center", fontWeight: 700, background: "#fff" }} />
                <span>%</span>
              </div>
              <div style=${{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span>সামষ্টিক:</span>
                <input type="tel" inputMode="numeric" value=${r.terminal}
                  onInput=${e => updateClassRatio(ck, "terminal", e.target.value)}
                  style=${{ width: "50px", padding: "5px", textAlign: "center", fontWeight: 700, background: "#fff" }} />
                <span>%</span>
              </div>
            </div>
          </div>`;
        })}
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
          <button type="button" class="ghost" style=${{ padding: "4px 10px", fontSize: "0.85rem", width: "auto" }} onClick=${() => applyPreset(DESCRIPTIVE_GRADES)}>
            বর্ণনামূলক (অতি উত্তম, উত্তম...)
          </button>
          <button type="button" class="ghost" style=${{ padding: "4px 10px", fontSize: "0.85rem", width: "auto" }} onClick=${() => applyPreset(LETTER_GRADES)}>
            লেটার গ্রেড (A+, A...)
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
              <th style=${{ padding: "10px 8px", fontSize: "0.88rem" }}>গ্রেড / অর্জন মাত্রা</th>
              <th style=${{ padding: "10px 8px", fontSize: "0.88rem", textAlign: "center" }}>নম্বর পরিসর (%)</th>
              ${config.displayOptions?.showGpa && html`<th style=${{ padding: "10px 6px", fontSize: "0.88rem", textAlign: "center", width: "58px" }}>পয়েন্ট</th>`}
              <th style=${{ padding: "10px 4px", width: "36px" }}></th>
            </tr>
          </thead>
          <tbody>
            ${(config.grading || []).map((g, i) => html`<tr key=${i} style=${{ borderBottom: "1px solid var(--line)" }}>
              <td style=${{ padding: "8px 6px" }}>
                <input type="text" value=${g.grade} placeholder="অতি উত্তম বা A+"
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
          <span>জিপিএ (GPA) পয়েন্ট প্রদর্শন করুন</span>
        </label>
      </div>
    </div>

    ${err && html`<p class="err">${err}</p>`}
    ${okMsg && html`<p class="ok">${okMsg}</p>`}

    <button disabled=${busy} onClick=${save} style=${{ marginBottom: "20px" }}>
      ${busy ? "সংরক্ষণ হচ্ছে…" : "সেটিং সংরক্ষণ করুন"}
    </button>
  </div>`;
}
