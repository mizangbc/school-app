import React, { useState } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { db } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const html = htm.bind(React.createElement);

const toBn = n => String(n ?? "").replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);

export function BackupAndPromotion({ profile }) {
  const [tab, setTab] = useState("backup"); // "backup" | "promotion"
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirmedBackup, setConfirmedBackup] = useState(false);

  // ১. সম্পূর্ণ ডেটা ব্যাকআপ ডাউনলোড (JSON)
  async function downloadFullBackup() {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const [stuSnap, cfgStruct, cfgExams, cfgAssign, cfgPub, usersSnap, marksSnap] = await Promise.all([
        getDocs(collection(db, "students")),
        getDoc(doc(db, "config", "structure")),
        getDoc(doc(db, "config", "exams")),
        getDoc(doc(db, "config", "assignments")),
        getDoc(doc(db, "config", "publish")),
        getDocs(collection(db, "users")),
        getDocs(collection(db, "marks"))
      ]);

      const backupData = {
        exportedAt: new Date().toISOString(),
        exportedBy: profile.name,
        school: "S. M. Model Govt. Primary School, Gopalganj",
        students: stuSnap.docs.map(d => d.data()),
        structure: cfgStruct.exists() ? cfgStruct.data() : null,
        examsConfig: cfgExams.exists() ? cfgExams.data() : null,
        assignments: cfgAssign.exists() ? cfgAssign.data() : null,
        publish: cfgPub.exists() ? cfgPub.data() : null,
        users: usersSnap.docs.map(d => {
          const u = d.data();
          return { uid: d.id, name: u.name, mobile: u.mobile, role: u.role };
        }),
        marks: marksSnap.docs.map(d => d.data())
      };

      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStr = new Date().toISOString().split("T")[0];
      a.href = url;
      a.download = `modelgps_full_backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setMsg("সম্পূর্ণ স্কুলের ব্যাকআপ ফাইল সফলভাবে ডাউনলোড হয়েছে। ফাইলটি কম্পিউটারে সুরক্ষিত রাখুন।");
      setConfirmedBackup(true);
    } catch (ex) {
      console.error(ex);
      setErr("ব্যাকআপ ডাউনলোডে সমস্যা হয়েছে। ইন্টারনেট সংযোগ পরীক্ষা করুন।");
    }
    setBusy(false);
  }

  // ২. শিক্ষার্থী তালিকা CSV ডাউনলোড
  async function downloadStudentCsv() {
    setBusy(true);
    setErr("");
    try {
      const stuSnap = await getDocs(collection(db, "students"));
      const list = stuSnap.docs.map(d => d.data());

      const headers = ["SID", "রোল", "নাম", "শ্রেণি", "শাখা", "অভিভাবক", "মোবাইল", "জন্মতারিখ", "লিঙ্গ"];
      const rows = list.map(s => [
        s.sid || "",
        s.roll || "",
        s.name || "",
        s.className || s.classId || "",
        s.section || "",
        s.guardian || "",
        s.guardianMobile || "",
        s.dob || "",
        s.gender || ""
      ]);

      const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.map(f => `"${String(f).replace(/"/g, '""')}"`).join(","))].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `students_modelgps_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setMsg("শিক্ষার্থী তালিকা CSV সফলভাবে ডাউনলোড হয়েছে।");
    } catch (ex) {
      console.error(ex);
      setErr("CSV তৈরিতে সমস্যা হয়েছে।");
    }
    setBusy(false);
  }

  // ৩. শিক্ষাবর্ষ প্রমোশন চালান (Pre-Primary -> c1 -> c2 -> c3 -> c4 -> c5 -> Graduated)
  async function runAnnualPromotion() {
    if (!confirmedBackup) {
      return setErr("অনুগ্রহ করে প্রমোশন চালানোর পূর্বে ব্যাকআপ ডাউনলোড নিশ্চিত করুন।");
    }

    if (!confirm("আপনি কি নিশ্চিতভাবে সকল শিক্ষার্থীর এক ধাপ উচ্চ শ্রেণিতে প্রমোশন প্রক্রিয়া সম্পন্ন করতে চান? এই কাজটির পূর্বে ব্যাকআপ রাখা জরুরি।")) {
      return;
    }

    setBusy(true);
    setErr("");
    setMsg("");

    try {
      const stuSnap = await getDocs(collection(db, "students"));
      const students = stuSnap.docs.map(d => d.data());

      const promoMap = {
        c0: { newClassId: "c1", newClassName: "প্রথম" },
        c1: { newClassId: "c2", newClassName: "দ্বিতীয়" },
        c2: { newClassId: "c3", newClassName: "তৃতীয়" },
        c3: { newClassId: "c4", newClassName: "চতুর্থ" },
        c4: { newClassId: "c5", newClassName: "পঞ্চম" },
        c5: { newClassId: "graduated", newClassName: "সমাপনী / উত্তীর্ণ প্রাক্তন" }
      };

      // Firestore ব্যাচে সেভ করা (সর্বোচ্চ ৫০০ অপারেশন প্রতি ব্যাচ)
      let batch = writeBatch(db);
      let opCount = 0;
      let promotedCount = 0;

      for (const s of students) {
        if (!s.sid || s.classId === "graduated") continue;
        const target = promoMap[s.classId];
        if (target) {
          const ref = doc(db, "students", s.sid);
          batch.update(ref, {
            classId: target.newClassId,
            className: target.newClassName,
            promotedAt: serverTimestamp(),
            prevClassId: s.classId
          });
          opCount++;
          promotedCount++;

          if (opCount === 450) {
            await batch.commit();
            batch = writeBatch(db);
            opCount = 0;
          }
        }
      }

      if (opCount > 0) {
        await batch.commit();
      }

      setMsg(`অভিনন্দন! মোট ${toBn(promotedCount)} জন শিক্ষার্থীর বার্ষিক প্রমোশন সফলভাবে সম্পন্ন হয়েছে।`);
    } catch (ex) {
      console.error(ex);
      setErr("প্রমোশন প্রক্রিয়ায় সমস্যা হয়েছে: " + (ex.message || ""));
    }
    setBusy(false);
  }

  return html`<div style=${{ marginTop: "14px" }}>
    <div style=${{ display: "flex", gap: "8px", borderBottom: "2px solid var(--line)", paddingBottom: "8px", marginBottom: "14px" }}>
      <button class=${tab === "backup" ? "primary" : "ghost"}
        style=${{ width: "auto", margin: 0, padding: "8px 16px" }}
        onClick=${() => setTab("backup")}>
        ডেটা ব্যাকআপ ডাউনলোড
      </button>
      <button class=${tab === "promotion" ? "primary" : "ghost"}
        style=${{ width: "auto", margin: 0, padding: "8px 16px" }}
        onClick=${() => setTab("promotion")}>
        শিক্ষাবর্ষ প্রমোশন
      </button>
    </div>

    ${err && html`<p class="err" style=${{ marginBottom: "12px" }}>${err}</p>`}
    ${msg && html`<p class="ok" style=${{ marginBottom: "12px" }}>${msg}</p>`}

    ${tab === "backup" && html`<div class="card">
      <h3 style=${{ margin: "0 0 8px", fontSize: "1.15rem" }}>১. সম্পূর্ণ ক্লাউড ব্যাকআপ</h3>
      <p class="sub" style=${{ margin: "0 0 16px", fontSize: "0.88rem" }}>
        বিদ্যালয়ের সমস্ত শিক্ষার্থীর তথ্য, পরীক্ষার নম্বর, কাঠামো এবং শিক্ষক তালিকা একটি একক ফাইলে ডাউনলোড করে কম্পিউটারে সংরক্ষণ করুন:
      </p>

      <button disabled=${busy} onClick=${downloadFullBackup}
        style=${{ background: "var(--acc)", color: "#fff", padding: "12px 18px", fontWeight: 700, margin: 0 }}>
        ${busy ? "ব্যাকআপ তৈরি হচ্ছে…" : "📥 সম্পূর্ণ স্কুলের ব্যাকআপ ডাউনলোড (JSON)"}
      </button>

      <div style=${{ marginTop: "16px", paddingTop: "14px", borderTop: "1px dashed var(--line)" }}>
        <button type="button" class="ghost" disabled=${busy} onClick=${downloadStudentCsv}
          style=${{ width: "100%", padding: "10px", borderColor: "var(--acc)", color: "var(--acc)", fontWeight: 600 }}>
          📊 শিক্ষার্থী তালিকা এক্সপোর্ট (Excel / CSV)
        </button>
      </div>
    </div>`}

    ${tab === "promotion" && html`<div class="card">
      <h3 style=${{ margin: "0 0 8px", fontSize: "1.15rem" }}>২. বার্ষিক শিক্ষার্থী প্রমোশন</h3>
      <p class="sub" style=${{ margin: "0 0 14px", fontSize: "0.88rem" }}>
        শিক্ষাবর্ষ শেষে এক ক্লিকে সকল শিক্ষার্থীকে পরবর্তী শ্রেণিতে উন্নীত করুন (যেমন: প্রাক-প্রাথমিক থেকে প্রথম শ্রেণি, প্রথম থেকে দ্বিতীয় শ্রেণি… এবং পঞ্চম শ্রেণি থেকে সমাপনী/প্রাক্তন)।
      </p>

      <div style=${{ background: "var(--bg)", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--line)", marginBottom: "16px", fontSize: "0.9rem" }}>
        <b style=${{ color: "var(--acc)" }}>✦ প্রমোশন প্রক্রিয়া কীভাবে কাজ করে:</b>
        <ul style=${{ margin: "8px 0 0", paddingLeft: "20px" }}>
          <li>প্রতিটি শিক্ষার্থীর স্থায়ী আইডি (SID) অপরিবর্তিত থাকবে।</li>
          <li>প্রাক-প্রাথমিক শিক্ষার্থীরা ১ম শ্রেণিতে উত্তীর্ণ হবে।</li>
          <li>১ম, ২য়, ৩য় ও ৪র্থ শ্রেণির শিক্ষার্থীরা যথাক্রমে ২য়, ৩য়, ৪র্থ ও ৫ম শ্রেণিতে উন্নীত হবে।</li>
          <li>৫ম শ্রেণির শিক্ষার্থীরা "সমাপনী / উত্তীর্ণ প্রাক্তন" মর্যাদায় সংরক্ষিত থাকবে।</li>
        </ul>
      </div>

      <label style=${{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", margin: "14px 0" }}>
        <input type="checkbox" checked=${confirmedBackup}
          onChange=${e => setConfirmedBackup(e.target.checked)}
          style=${{ width: "auto", marginTop: "4px" }} />
        <span style=${{ fontSize: "0.9rem", fontWeight: 600 }}>
          আমি বর্তমান বছরের সম্পূর্ণ ডেটা ব্যাকআপ ডাউনলোড করেছি এবং নতুন শিক্ষাবর্ষ প্রমোশন প্রক্রিয়ার জন্য প্রস্তুত।
        </span>
      </label>

      <button disabled=${busy || !confirmedBackup} onClick=${runAnnualPromotion}
        class="danger" style=${{ padding: "12px 18px", fontWeight: 700, borderColor: "var(--err)" }}>
        ${busy ? "প্রমোশন প্রক্রিয়া চলছে…" : "🚀 নতুন শিক্ষাবর্ষে প্রমোশন সম্পন্ন করুন"}
      </button>
    </div>`}
  </div>`;
}
