import React, { useState, useEffect } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { auth, db } from "./firebase.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { Structure } from "./structure.js?v=17";
import { Students } from "./students.js?v=17";
import { Teachers, MyAssignments } from "./teachers.js?v=17";
import { Exams } from "./exams.js?v=17";
import { MarksEntry, Verification } from "./marks.js?v=17";
import { ResultsView } from "./results.js?v=17";
import { BackupAndPromotion } from "./backup.js?v=17";

const html = htm.bind(React.createElement);
const toBn = n => String(n ?? "").replace(/\d/g, d => "০১২৩৪৫৬৭৮৯"[d]);

const st = document.createElement("style");
st.textContent = `
.go{background:var(--card);color:var(--ink);border:1px solid var(--acc);margin:0;text-align:left;display:flex;justify-content:space-between;align-items:center;width:100%}
.go span{color:var(--acc);font-weight:500}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}
.chip{background:var(--acc2);color:var(--acc);border-radius:20px;padding:3px 6px 3px 12px;font-weight:500;display:inline-flex;gap:8px;align-items:center}
.chip b{cursor:pointer;font-size:1.2rem;line-height:1;padding:0 6px}
.addrow{display:flex;gap:8px}.addrow button{margin:0}
.cls{margin-top:14px}
.danger{background:transparent;color:var(--err);border:1px solid var(--line)}
h2{font-size:1.15rem;margin:12px 0 0}
.ok{color:var(--acc);font-weight:600;margin:12px 0 0}
`;
document.head.appendChild(st);

const ROLES = { main_admin: "প্রধান অ্যাডমিন", assistant_admin: "সহকারী অ্যাডমিন", teacher: "শিক্ষক", verifier: "ফলাফল যাচাইকারী" };
const MENU = {
  main_admin: ["নম্বর এন্ট্রি", "ফলাফল ও প্রকাশ", "শিক্ষার্থী ব্যবস্থাপনা", "শ্রেণি, শাখা ও বিষয়", "পরীক্ষার সেটিং", "শিক্ষক ও বরাদ্দ", "যাচাই ও অনুমোদন", "শিক্ষাবর্ষ ও ব্যাকআপ"],
  assistant_admin: ["নম্বর এন্ট্রি", "ফলাফল দেখা", "শিক্ষার্থী ব্যবস্থাপনা", "শ্রেণি, শাখা ও বিষয়"],
  teacher: ["নম্বর এন্ট্রি", "শিক্ষার্থী ভর্তি ও তথ্য", "ফলাফল দেখা", "আমার বরাদ্দ"],
  verifier: ["নম্বর যাচাই ও অনুমোদন", "ফলাফল দেখা"]
};
const PAGES = {
  "শিক্ষার্থী ব্যবস্থাপনা": Students,
  "শিক্ষার্থী ভর্তি ও তথ্য": Students,
  "শিক্ষার্থী ও Excel আপলোড": Students,
  "শ্রেণি, শাখা ও বিষয়": Structure,
  "পরীক্ষার সেটিং": Exams,
  "শিক্ষক ও বরাদ্দ": Teachers,
  "আমার বরাদ্দ": MyAssignments,
  "নম্বর এন্ট্রি": MarksEntry,
  "যাচাই ও অনুমোদন": Verification,
  "নম্বর যাচাই ও অনুমোদন": Verification,
  "ফলাফল ও প্রকাশ": ResultsView,
  "ফলাফল দেখা": ResultsView,
  "শিক্ষাবর্ষ ও ব্যাকআপ": BackupAndPromotion
};

export function Home({ profile }) {
  const [page, setPage] = useState(null);
  const [pendingMarks, setPendingMarks] = useState([]);
  const [pendingStudents, setPendingStudents] = useState([]);
  const [showNotifDrawer, setShowNotifDrawer] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);

  const isAdmin = profile?.role === "main_admin" || profile?.role === "assistant_admin" || profile?.role === "verifier";

  async function fetchNotifications() {
    if (!isAdmin) return;
    setNotifLoading(true);
    try {
      // ১. অনুমোদনের অপেক্ষমাণ সকল বিষয়ের নম্বর (status === 'submitted')
      const mq = query(collection(db, "marks"), where("status", "==", "submitted"));
      const mSnap = await getDocs(mq);
      setPendingMarks(mSnap.docs.map(d => d.data()));

      // ২. অনুমোদনের অপেক্ষমাণ নতুন শিক্ষার্থী (status === 'pending')
      const sq = query(collection(db, "students"), where("status", "==", "pending"));
      const sSnap = await getDocs(sq);
      setPendingStudents(sSnap.docs.map(d => d.data()));
    } catch (err) {
      console.error("fetchNotifications error:", err);
    }
    setNotifLoading(false);
  }

  useEffect(() => {
    fetchNotifications();
  }, [profile?.role, page]);

  const totalPending = pendingMarks.length + pendingStudents.length;
  const Page = page && PAGES[page];
  const items = MENU[profile.role] || [];

  return html`<div>
    <!-- শীর্ষ বার -->
    <div class="top">
      <div>
        <div class="brand" style=${{ margin: 0 }}>${profile.name}</div>
        <span class="role">${ROLES[profile.role] || profile.role}</span>
      </div>
      <div style=${{ display: "flex", alignItems: "center", gap: "8px" }}>
        ${isAdmin && html`<button type="button" class="ghost" onClick=${() => setShowNotifDrawer(!showNotifDrawer)}
          style=${{
            position: "relative",
            padding: "6px 12px",
            borderRadius: "20px",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
            borderColor: totalPending > 0 ? "#f57c00" : "var(--line)",
            background: totalPending > 0 ? "#fff8e1" : "transparent",
            color: totalPending > 0 ? "#b78103" : "var(--ink)",
            display: "flex",
            alignItems: "center",
            gap: "4px"
          }}>
          <span>🔔 বিজ্ঞপ্তি</span>
          ${totalPending > 0 && html`<span style=${{
            background: "#e53935",
            color: "#fff",
            borderRadius: "10px",
            padding: "1px 7px",
            fontSize: "0.75rem",
            fontWeight: 700
          }}>
            ${toBn(totalPending)}
          </span>`}
        </button>`}
        <button class="ghost" onClick=${() => signOut(auth)}>লগআউট</button>
      </div>
    </div>

    <!-- নোটিফিকেশন ড্রয়ার / পপআপ (বিজ্ঞপ্তি বাটনে চাপলে বা পেজের ভেতরে থাকা অবস্থায়) -->
    ${isAdmin && showNotifDrawer && html`<div class="card" style=${{
      background: "#fffdf0",
      border: "1.5px solid #f6c026",
      borderRadius: "10px",
      padding: "14px 16px",
      marginTop: "12px",
      boxShadow: "0 4px 14px rgba(0,0,0,0.08)"
    }}>
      <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px dashed #f6c026", paddingBottom: "8px", marginBottom: "10px" }}>
        <b style=${{ color: "#856404", fontSize: "0.95rem" }}>
          🔔 অনুমোদনের অপেক্ষমাণ বিজ্ঞপ্তি (${toBn(totalPending)} টি)
        </b>
        <div style=${{ display: "flex", gap: "6px" }}>
          <button type="button" class="ghost" onClick=${fetchNotifications} style=${{ width: "auto", margin: 0, padding: "3px 8px", fontSize: "0.8rem" }}>🔄 রিফ্রেশ</button>
          <button type="button" class="ghost" onClick=${() => setShowNotifDrawer(false)} style=${{ width: "auto", margin: 0, padding: "3px 8px", fontSize: "0.8rem" }}>✕ বন্ধ</button>
        </div>
      </div>

      ${totalPending === 0
        ? html`<p class="sub" style=${{ margin: "4px 0", color: "var(--acc)", fontWeight: 600 }}>✓ বর্তমানে কোনো বিষয় বা শিক্ষার্থী অনুমোদনের অপেক্ষায় নেই।</p>`
        : html`<div style=${{ display: "grid", gap: "10px" }}>
            ${pendingMarks.length > 0 && html`<div>
              <div style=${{ fontSize: "0.85rem", fontWeight: 700, color: "#c62828", marginBottom: "4px" }}>
                📝 বিষয়ের নম্বর অনুমোদন (${toBn(pendingMarks.length)} টি বিষয়):
              </div>
              <div style=${{ display: "grid", gap: "6px" }}>
                ${pendingMarks.map(m => html`<div key=${m.id} style=${{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: "#fff", padding: "6px 10px", borderRadius: "6px", border: "1px solid #ffcc80"
                }}>
                  <div>
                    <b style=${{ color: "#1f7a5a" }}>${m.className} (${m.section}) • ${m.subject}</b>
                    <span style=${{ fontSize: "0.78rem", color: "var(--mute)", marginLeft: "6px" }}>[${m.termName || "মূল্যায়ন"}]</span>
                    <div style=${{ fontSize: "0.75rem", color: "#555" }}>
                      শিক্ষক: ${m.updatedBy || "অজ্ঞাত"} • শিক্ষার্থী: ${toBn(Object.keys(m.records || {}).length)} জন
                    </div>
                  </div>
                  <button type="button" onClick=${() => { setPage("যাচাই ও অনুমোদন"); setShowNotifDrawer(false); }}
                    style=${{ width: "auto", margin: 0, padding: "4px 10px", fontSize: "0.78rem", background: "var(--acc)", color: "#fff", fontWeight: 600 }}>
                    যাচাই →
                  </button>
                </div>`)}
              </div>
            </div>`}

            ${pendingStudents.length > 0 && html`<div>
              <div style=${{ fontSize: "0.85rem", fontWeight: 700, color: "#e65100", marginBottom: "4px" }}>
                🎓 নতুন শিক্ষার্থী ভর্তি অনুমোদন (${toBn(pendingStudents.length)} জন):
              </div>
              <div style=${{ display: "grid", gap: "6px" }}>
                ${pendingStudents.slice(0, 4).map(s => html`<div key=${s.sid} style=${{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: "#fff", padding: "6px 10px", borderRadius: "6px", border: "1px solid #ffe082"
                }}>
                  <div>
                    <b>রোল ${toBn(s.roll)}: ${s.name}</b>
                    <span style=${{ fontSize: "0.78rem", color: "var(--mute)", marginLeft: "6px" }}>(${s.section || "ক"})</span>
                    <div style=${{ fontSize: "0.75rem", color: "#555" }}>যুক্ত করেছেন: ${s.addedBy || "শিক্ষক"}</div>
                  </div>
                  <button type="button" onClick=${() => { setPage("শিক্ষার্থী ব্যবস্থাপনা"); setShowNotifDrawer(false); }}
                    style=${{ width: "auto", margin: 0, padding: "4px 10px", fontSize: "0.78rem", background: "#f57c00", color: "#fff", fontWeight: 600 }}>
                    অনুমোদন →
                  </button>
                </div>`)}
                ${pendingStudents.length > 4 && html`<div style=${{ textAlign: "right", fontSize: "0.8rem" }}>
                  <a href="javascript:void(0)" onClick=${() => { setPage("শিক্ষার্থী ব্যবস্থাপনা"); setShowNotifDrawer(false); }} style=${{ color: "var(--acc)", fontWeight: 600 }}>
                    এবং আরও ${toBn(pendingStudents.length - 4)} জন দেখুন…
                  </a>
                </div>`}
              </div>
            </div>`}
          </div>`}
    </div>`}

    ${Page
      ? html`<div>
          <button class="ghost" style=${{ marginTop: "16px" }} onClick=${() => { setPage(null); fetchNotifications(); }}>
            ← মূল মেনু
          </button>
          <h2>${page}</h2>
          <${Page} profile=${profile} />
        </div>`
      : html`<div>
          <!-- ড্যাশবোর্ডে সার্বিক নোটিফিকেশন কার্ড (অপেক্ষমাণ বিষয় থাকলে) -->
          ${isAdmin && totalPending > 0 && html`<div class="card" style=${{
            background: "#fffdf2",
            border: "1.5px solid #f9a825",
            borderRadius: "10px",
            padding: "14px 16px",
            marginTop: "16px",
            marginBottom: "16px"
          }}>
            <div style=${{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px dashed #f9a825", paddingBottom: "8px", marginBottom: "10px" }}>
              <div style=${{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style=${{ fontSize: "1.2rem" }}>🔔</span>
                <b style=${{ fontSize: "1rem", color: "#795548" }}>অনুমোদনের অপেক্ষমাণ বিজ্ঞপ্তি (${toBn(totalPending)} টি)</b>
              </div>
              <button type="button" class="ghost" onClick=${fetchNotifications} style=${{ width: "auto", margin: 0, padding: "4px 8px", fontSize: "0.8rem" }}>
                🔄 রিফ্রেশ
              </button>
            </div>

            <div style=${{ display: "grid", gap: "10px" }}>
              ${pendingMarks.length > 0 && html`<div>
                <div style=${{ fontSize: "0.88rem", fontWeight: 700, color: "#c62828", marginBottom: "6px" }}>
                  📝 বিষয়ের নম্বর অনুমোদন (${toBn(pendingMarks.length)} টি বিষয় জমা পড়েছে):
                </div>
                <div style=${{ display: "grid", gap: "6px" }}>
                  ${pendingMarks.map(m => html`<div key=${m.id} style=${{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: "#fff", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ffcc80",
                    flexWrap: "wrap", gap: "6px"
                  }}>
                    <div>
                      <b style=${{ color: "#1f7a5a" }}>${m.className} (${m.section}) • ${m.subject}</b>
                      <span style=${{ fontSize: "0.8rem", color: "var(--mute)", marginLeft: "8px" }}>[${m.termName || "মূল্যায়ন"}]</span>
                      <div style=${{ fontSize: "0.78rem", color: "#555", marginTop: "1px" }}>
                        জমা দিয়েছেন শিক্ষক: <b>${m.updatedBy || "শিক্ষক"}</b> • শিক্ষার্থী: ${toBn(Object.keys(m.records || {}).length)} জন
                      </div>
                    </div>
                    <button type="button" onClick=${() => setPage("যাচাই ও অনুমোদন")}
                      style=${{ width: "auto", margin: 0, padding: "5px 14px", fontSize: "0.82rem", background: "var(--acc)", color: "#fff", fontWeight: 700 }}>
                      যাচাই ও অনুমোদন করুন →
                    </button>
                  </div>`)}
                </div>
              </div>`}

              ${pendingStudents.length > 0 && html`<div>
                <div style=${{ fontSize: "0.88rem", fontWeight: 700, color: "#e65100", marginBottom: "6px" }}>
                  🎓 নতুন শিক্ষার্থী ভর্তি অনুমোদন (${toBn(pendingStudents.length)} জন অপেক্ষমাণ):
                </div>
                <div style=${{ display: "grid", gap: "6px" }}>
                  ${pendingStudents.slice(0, 3).map(s => html`<div key=${s.sid} style=${{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: "#fff", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ffe082",
                    flexWrap: "wrap", gap: "6px"
                  }}>
                    <div>
                      <b>রোল ${toBn(s.roll)}: ${s.name}</b>
                      <span style=${{ fontSize: "0.8rem", color: "var(--mute)", marginLeft: "8px" }}>(${s.section || "ক"})</span>
                      <div style=${{ fontSize: "0.76rem", color: "#666" }}>যুক্ত করেছেন: <b>${s.addedBy || "শিক্ষক"}</b></div>
                    </div>
                    <button type="button" onClick=${() => setPage("শিক্ষার্থী ব্যবস্থাপনা")}
                      style=${{ width: "auto", margin: 0, padding: "4px 12px", fontSize: "0.8rem", background: "#f57c00", color: "#fff", fontWeight: 600 }}>
                      অনুমোদন করুন →
                    </button>
                  </div>`)}
                  ${pendingStudents.length > 3 && html`<div style=${{ textAlign: "right", fontSize: "0.82rem" }}>
                    <a href="javascript:void(0)" onClick=${() => setPage("শিক্ষার্থী ব্যবস্থাপনা")} style=${{ color: "var(--acc)", fontWeight: 600 }}>
                      এবং আরও ${toBn(pendingStudents.length - 3)} জন দেখুন…
                    </a>
                  </div>`}
                </div>
              </div>`}
            </div>
          </div>`}

          <!-- মেনু গ্রিড -->
          <div class="grid" style=${{ marginTop: (isAdmin && totalPending > 0) ? "0" : "16px" }}>
            ${items.map(t => {
              if (!PAGES[t]) {
                return html`<div class="item" key=${t}><b>${t}</b><span>পরের ধাপে</span></div>`;
              }
              const isMarksVerif = t === "যাচাই ও অনুমোদন" || t === "নম্বর যাচাই ও অনুমোদন";
              const isStudentManage = t === "শিক্ষার্থী ব্যবস্থাপনা" || t === "শিক্ষার্থী ও Excel আপলোড";

              return html`<button class="go" key=${t} onClick=${() => setPage(t)}>
                <div style=${{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <b>${t}</b>
                  ${isMarksVerif && pendingMarks.length > 0 && html`<span style=${{
                    background: "#e53935",
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    fontSize: "0.75rem",
                    fontWeight: 700
                  }}>
                    ${toBn(pendingMarks.length)} টি বিষয়
                  </span>`}
                  ${isStudentManage && pendingStudents.length > 0 && html`<span style=${{
                    background: "#f57c00",
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    fontSize: "0.75rem",
                    fontWeight: 700
                  }}>
                    ${toBn(pendingStudents.length)} জন
                  </span>`}
                </div>
                <span>খুলুন</span>
              </button>`;
            })}
          </div>
        </div>`}
  </div>`;
}
