import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { db } from "./firebase.js";
import { doc, getDoc, setDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const html = htm.bind(React.createElement);
const bn2en = s => String(s || "").replace(/[০-৯]/g, d => "০১২৩৪৫৬৭৮৯".indexOf(d));
const digits = s => bn2en(s).replace(/\D/g, "");
const toBn = n => String(n ?? "").replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);

// প্রচলিত লেটার গ্রেড প্রিসেট
export const LETTER_GRADES = [
  { grade: "A+", gpa: 5.0, min: 80, max: 100, remark: "অতি উত্তম" },
  { grade: "A",  gpa: 4.0, min: 70, max: 79,  remark: "উত্তম" },
  { grade: "A-", gpa: 3.5, min: 60, max: 69,  remark: "ভালো" },
  { grade: "B",  gpa: 3.0, min: 50, max: 59,  remark: "সন্তোষজনক" },
  { grade: "C",  gpa: 2.0, min: 40, max: 49,  remark: "চলতি মান" },
  { grade: "D",  gpa: 1.0, min: 33, max: 39,  remark: "অগ্রগতি প্রয়োজন" },
  { grade: "F",  gpa: 0.0, min: 0,  max: 32,  remark: "অনুত্তীর্ণ" }
];

// বর্ণনামূলক মূল্যায়ন প্রিসেট (প্রাথমিক কারিকুলাম)
export const DESCRIPTIVE_GRADES = [
  { grade: "অতি উত্তম",         gpa: 5.0, min: 80, max: 100, remark: "সর্বোচ্চ অর্জন" },
  { grade: "উত্তম",             gpa: 4.0, min: 65, max: 79,  remark: "সন্তোষজনক অর্জন" },
  { grade: "ভালো",              gpa: 3.0, min: 50, max: 64,  remark: "উন্নতিশীল অর্জন" },
  { grade: "চলতি মান",          gpa: 2.0, min: 33, max: 49,  remark: "প্রাথমিক অর্জন" },
  { grade: "অগ্রগতি প্রয়োজন",  gpa: 0.0, min: 0,  max: 32,  remark: "বিশেষ সহায়তা প্রয়োজন" }
];

// ডিফল্ট সেটিং
export function defaultExamConfig() {
  return {
    terminals: [
      { id: "term1", name: "১ম প্রান্তিক মূল্যায়ন", active: true, weight: 25 },
      { id: "term2", name: "২য় প্রান্তিক মূল্যায়ন", active: true, weight: 25 },
      { id: "term3", name: "বার্ষিক মূল্যায়ন", active: true, weight: 50 }
    ],
    assessmentRatio: {
      continuous: 30, // ধারাবাহিক মূল্যায়ন ৩০%
      written: 70     // প্রান্তিক লিখিত পরীক্ষা ৭০%
    },
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
      setConfig(s.exists() ? s.data() : defaultExamConfig());
      setLoading(false);
    }).catch(e => {
      console.error(e);
      setErr("লোড করা যায়নি।");
      setLoading(false);
    });
  }, []);

  function updateTerminal(i, field, val) {
    const terms = [...config.terminals];
    terms[i] = { ...terms[i], [field]: val };
    setConfig({ ...config, terminals: terms });
  }

  function updateRatio(field, val) {
    const num = parseInt(digits(val), 10) || 0;
    const ratio = { ...config.assessmentRatio, [field]: num };
    if (field === "continuous") ratio.written = Math.max(0, 100 - num);
    else ratio.continuous = Math.max(0, 100 - num);
    setConfig({ ...config, assessmentRatio: ratio });
  }

  function updateGrade(i, field, val) {
    const grades = [...config.grading];
    grades[i] = { ...grades[i], [field]: val };
    setConfig({ ...config, grading: grades });
  }

  function addGrade() {
    const grades = [...config.grading];
    grades.push({
      grade: "",
      gpa: 0.0,
      min: 0,
      max: 100,
      remark: ""
    });
    setConfig({ ...config, grading: grades });
  }

  function removeGrade(i) {
    if (config.grading.length <= 1) {
      alert("কমপক্ষে একটি গ্রেড ধাপ থাকতে হবে।");
      return;
    }
    const grades = config.grading.filter((_, idx) => idx !== i);
    setConfig({ ...config, grading: grades });
  }

  function applyPreset(preset) {
    setConfig({ ...config, grading: preset });
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

    // টার্মিনাল ওজন যাচাই
    const totalWeight = config.terminals.reduce((sum, t) => sum + (parseInt(digits(t.weight), 10) || 0), 0);
    if (totalWeight !== 100) {
      return setErr(`বার্ষিক ফলাফলে সব প্রান্তিকের ওজনের মোট যোগফল ১০০% হতে হবে (বর্তমানে আছে: ${toBn(totalWeight)}%)।`);
    }

    // ধারাবাহিক ও লিখিত অনুপাত যাচাই
    const totalRatio = (config.assessmentRatio.continuous || 0) + (config.assessmentRatio.written || 0);
    if (totalRatio !== 100) {
      return setErr(`ধারাবাহিক ও লিখিত মূল্যায়নের যোগফল ১০০% হতে হবে।`);
    }

    // গ্রেডিং তালিকা যাচাই
    for (let i = 0; i < config.grading.length; i++) {
      const g = config.grading[i];
      if (!String(g.grade || "").trim()) {
        return setErr(`ক্রমিক ${toBn(i + 1)} গ্রেডের নাম বা শিরোনাম ফাঁকা রাখা যাবে না।`);
      }
      if (g.min > g.max) {
        return setErr(`"${g.grade}" গ্রেডে সর্বনিম্ন নম্বর (${toBn(g.min)}) সর্বোচ্চ নম্বরের (${toBn(g.max)}) চেয়ে বড় হতে পারে না।`);
      }
    }

    setBusy(true);
    try {
      await setDoc(doc(db, "config", "exams"), {
        ...config,
        updatedAt: serverTimestamp()
      });
      setOkMsg("পরীক্ষার সেটিং সফলভাবে সংরক্ষণ করা হয়েছে।");
    } catch (ex) {
      console.error(ex);
      setErr("সংরক্ষণ করা যায়নি। ইন্টারনেট ও Rules দেখুন।");
    }
    setBusy(false);
  }

  if (loading) return html`<p class="sub">পরীক্ষার সেটিং লোড হচ্ছে…</p>`;
  if (!config) return html`<p class="err">${err || "সেটিং পাওয়া যায়নি।"}</p>`;

  const totalTermWeight = config.terminals.reduce((sum, t) => sum + (parseInt(digits(t.weight), 10) || 0), 0);

  return html`<div style=${{ marginTop: "14px" }}>
    <!-- ১. প্রান্তিক পরীক্ষা ও বার্ষিক ওজন -->
    <div class="card" style=${{ marginBottom: "16px" }}>
      <h3 style=${{ margin: "0 0 10px", fontSize: "1.1rem" }}>১. প্রান্তিক পরীক্ষা ও বার্ষিক ওজনের হার</h3>
      <p class="sub" style=${{ margin: "0 0 12px", fontSize: "0.9rem" }}>
        বার্ষিক চূড়ান্ত ফলাফল তৈরিতে প্রতি প্রান্তিকের শতকরা ওজন (মোট ১০০%):
      </p>

      ${config.terminals.map((t, i) => html`<div key=${t.id} style=${{
        display: "flex", alignItems: "center", gap: "10px",
        padding: "8px 0", borderBottom: "1px dashed var(--line)"
      }}>
        <div style=${{ flex: 2 }}>
          <b>${t.name}</b>
        </div>
        <div style=${{ flex: 1, display: "flex", alignItems: "center", gap: "4px" }}>
          <input type="tel" inputMode="numeric" value=${t.weight}
            onInput=${e => updateTerminal(i, "weight", parseInt(digits(e.target.value), 10) || 0)}
            style=${{ padding: "6px 8px", textAlign: "center" }} />
          <span>%</span>
        </div>
      </div>`)}

      <div style=${{ display: "flex", justifyContent: "space-between", marginTop: "10px", fontWeight: 600 }}>
        <span>মোট যোগফল:</span>
        <span style=${{ color: totalTermWeight === 100 ? "var(--acc)" : "var(--err)" }}>
          ${toBn(totalTermWeight)}% ${totalTermWeight === 100 ? "✓" : "(১০০% হতে হবে)"}
        </span>
      </div>
    </div>

    <!-- ২. ধারাবাহিক ও লিখিত পরীক্ষার অনুপাত -->
    <div class="card" style=${{ marginBottom: "16px" }}>
      <h3 style=${{ margin: "0 0 10px", fontSize: "1.1rem" }}>২. ধারাবাহিক ও লিখিত মূল্যায়নের অনুপাত</h3>
      <p class="sub" style=${{ margin: "0 0 12px", fontSize: "0.9rem" }}>
        প্রতি প্রান্তিকে ১০০ নম্বরের মধ্যে ধারাবাহিক ও লিখিত পরীক্ষার বিভাজন:
      </p>

      <div style=${{ display: "flex", gap: "12px" }}>
        <div style=${{ flex: 1 }}>
          <label style=${{ marginTop: 0 }}>ধারাবাহিক মূল্যায়ন (%)</label>
          <input type="tel" inputMode="numeric" value=${config.assessmentRatio.continuous}
            onInput=${e => updateRatio("continuous", e.target.value)} />
        </div>
        <div style=${{ flex: 1 }}>
          <label style=${{ marginTop: 0 }}>প্রান্তিক লিখিত পরীক্ষা (%)</label>
          <input type="tel" inputMode="numeric" value=${config.assessmentRatio.written}
            onInput=${e => updateRatio("written", e.target.value)} />
        </div>
      </div>
      <p class="sub" style=${{ margin: "8px 0 0", fontSize: "0.85rem" }}>
        * যেমন: ধারাবাহিক ৩০% (৩০ নম্বর) + লিখিত ৭০% (৭০ নম্বর) = ১০০ পূর্ণমান।
      </p>
    </div>

    <!-- ৩. গ্রেডিং স্কেল এডিট ও কাস্টমাইজেশন -->
    <div class="card" style=${{ marginBottom: "16px" }}>
      <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <h3 style=${{ margin: 0, fontSize: "1.1rem" }}>৩. গ্রেডিং স্কেল ও নম্বর পরিসীমা</h3>
        <button type="button" class="ghost" style=${{ width: "auto", padding: "4px 10px", fontSize: "0.85rem" }} onClick=${addGrade}>
          + নতুন গ্রেড যোগ
        </button>
      </div>

      <p class="sub" style=${{ margin: "0 0 10px", fontSize: "0.85rem" }}>
        প্রয়োজনে গ্রেডের নাম (যেমন A+ বা অতি উত্তম), পয়েন্ট ও নম্বরের রেঞ্জ পরিবর্তন করুন:
      </p>

      <!-- দ্রুত প্রিসেট বোতাম -->
      <div style=${{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" }}>
        <span style=${{ fontSize: "0.85rem", color: "var(--mute)", alignSelf: "center" }}>প্রিসেট:</span>
        <button type="button" class="ghost" style=${{ padding: "3px 8px", fontSize: "0.8rem", width: "auto" }} onClick=${() => applyPreset(LETTER_GRADES)}>
          লেটার গ্রেড (A+, A...)
        </button>
        <button type="button" class="ghost" style=${{ padding: "3px 8px", fontSize: "0.8rem", width: "auto" }} onClick=${() => applyPreset(DESCRIPTIVE_GRADES)}>
          বর্ণনামূলক (অতি উত্তম, উত্তম...)
        </button>
      </div>

      <!-- গ্রেড তালিকা এডিট কার্ডসমূহ -->
      <div style=${{ display: "grid", gap: "10px" }}>
        ${config.grading.map((g, i) => html`<div key=${i} style=${{
          border: "1px solid var(--line)", borderRadius: "8px", padding: "10px",
          background: "var(--bg)"
        }}>
          <div style=${{ display: "flex", gap: "8px", alignItems: "center" }}>
            <div style=${{ flex: 2 }}>
              <label style=${{ margin: "0 0 3px", fontSize: "0.78rem", color: "var(--mute)" }}>গ্রেড / শিরোনাম</label>
              <input value=${g.grade} placeholder="যেমন: A+ বা অতি উত্তম"
                onInput=${e => updateGrade(i, "grade", e.target.value)}
                style=${{ padding: "6px 8px", fontWeight: 600, background: "#fff" }} />
            </div>
            <div style=${{ flex: 1 }}>
              <label style=${{ margin: "0 0 3px", fontSize: "0.78rem", color: "var(--mute)" }}>পয়েন্ট (GPA)</label>
              <input type="number" step="0.1" value=${g.gpa}
                onInput=${e => updateGrade(i, "gpa", parseFloat(bn2en(e.target.value)) || 0)}
                style=${{ padding: "6px 8px", textAlign: "center", background: "#fff" }} />
            </div>
            <button type="button" class="danger" style=${{ width: "auto", padding: "6px 10px", marginTop: "16px" }}
              onClick=${() => removeGrade(i)} title="এই গ্রেড বাদ দিন">×</button>
          </div>

          <div style=${{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
            <div style=${{ flex: 1 }}>
              <label style=${{ margin: "0 0 3px", fontSize: "0.78rem", color: "var(--mute)" }}>নম্বর পরিসীমা (%)</label>
              <div style=${{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input type="tel" inputMode="numeric" value=${g.min}
                  onInput=${e => updateGrade(i, "min", parseInt(digits(e.target.value), 10) || 0)}
                  style=${{ padding: "6px 6px", textAlign: "center", background: "#fff", flex: 1 }} />
                <span style=${{ fontSize: "0.85rem", color: "var(--mute)" }}>থেকে</span>
                <input type="tel" inputMode="numeric" value=${g.max}
                  onInput=${e => updateGrade(i, "max", parseInt(digits(e.target.value), 10) || 0)}
                  style=${{ padding: "6px 6px", textAlign: "center", background: "#fff", flex: 1 }} />
              </div>
            </div>
            <div style=${{ flex: 1 }}>
              <label style=${{ margin: "0 0 3px", fontSize: "0.78rem", color: "var(--mute)" }}>মন্তব্য (ঐচ্ছিক)</label>
              <input value=${g.remark || ""} placeholder="যেমন: উত্তম"
                onInput=${e => updateGrade(i, "remark", e.target.value)}
                style=${{ padding: "6px 8px", background: "#fff" }} />
            </div>
          </div>
        </div>`)}
      </div>

      <div style=${{ marginTop: "14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <label style=${{ margin: 0, fontWeight: 500 }}>পাস নম্বর (%)</label>
        <div style=${{ width: "90px" }}>
          <input type="tel" inputMode="numeric" value=${config.passMarkPercent}
            onInput=${e => setConfig({ ...config, passMarkPercent: parseInt(digits(e.target.value), 10) || 33 })}
            style=${{ padding: "6px 8px", textAlign: "center" }} />
        </div>
      </div>
    </div>

    <!-- ৪. মার্কশিট ও রেজাল্ট প্রদর্শন অপশন -->
    <div class="card" style=${{ marginBottom: "16px" }}>
      <h3 style=${{ margin: "0 0 10px", fontSize: "1.1rem" }}>৪. মার্কশিট প্রদর্শন অপশন</h3>
      <div style=${{ display: "grid", gap: "8px" }}>
        <label style=${{ display: "flex", alignItems: "center", gap: "10px", margin: 0, cursor: "pointer" }}>
          <input type="checkbox" checked=${config.displayOptions.showMarks}
            onChange=${e => updateDisplay("showMarks", e.target.checked)} style=${{ width: "auto" }} />
          <span>অর্জিত পূর্ণ নম্বর প্রদর্শন করুন</span>
        </label>
        <label style=${{ display: "flex", alignItems: "center", gap: "10px", margin: 0, cursor: "pointer" }}>
          <input type="checkbox" checked=${config.displayOptions.showGrade}
            onChange=${e => updateDisplay("showGrade", e.target.checked)} style=${{ width: "auto" }} />
          <span>গ্রেড / অর্জন মাত্রা প্রদর্শন করুন</span>
        </label>
        <label style=${{ display: "flex", alignItems: "center", gap: "10px", margin: 0, cursor: "pointer" }}>
          <input type="checkbox" checked=${config.displayOptions.showGpa}
            onChange=${e => updateDisplay("showGpa", e.target.checked)} style=${{ width: "auto" }} />
          <span>জিপিএ (GPA) প্রদর্শন করুন</span>
        </label>
        <label style=${{ display: "flex", alignItems: "center", gap: "10px", margin: 0, cursor: "pointer" }}>
          <input type="checkbox" checked=${config.displayOptions.showMeritRank}
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
