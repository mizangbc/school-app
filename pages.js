import React, { useState } from "https://esm.sh/react@18.3.1";
import htm from "https://esm.sh/htm@3.1.1";
import { auth } from "./firebase.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { Structure } from "./structure.js?v=6";
import { Students } from "./students.js?v=6";
import { Teachers, MyAssignments } from "./teachers.js?v=6";
import { Exams } from "./exams.js?v=6";

const html = htm.bind(React.createElement);

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
  main_admin: ["শিক্ষার্থী ও Excel আপলোড", "শ্রেণি, শাখা ও বিষয়", "পরীক্ষার সেটিং", "শিক্ষক ও বরাদ্দ", "যাচাই ও অনুমোদন", "ফলাফল ও প্রকাশ", "শিক্ষাবর্ষ ও ব্যাকআপ"],
  assistant_admin: ["শিক্ষার্থী ও Excel আপলোড", "শ্রেণি, শাখা ও বিষয়", "ফলাফল দেখা"],
  teacher: ["নম্বর এন্ট্রি", "আমার বরাদ্দ"],
  verifier: ["নম্বর যাচাই ও অনুমোদন", "ফলাফল দেখা"]
};
const PAGES = {
  "শিক্ষার্থী ও Excel আপলোড": Students,
  "শ্রেণি, শাখা ও বিষয়": Structure,
  "পরীক্ষার সেটিং": Exams,
  "শিক্ষক ও বরাদ্দ": Teachers,
  "আমার বরাদ্দ": MyAssignments
};

export function Home({ profile }) {
  const [page, setPage] = useState(null);
  const Page = page && PAGES[page];
  const items = MENU[profile.role] || [];
  return html`<div>
    <div class="top">
      <div><div class="brand" style=${{ margin: 0 }}>${profile.name}</div><span class="role">${ROLES[profile.role] || profile.role}</span></div>
      <button class="ghost" onClick=${() => signOut(auth)}>লগআউট</button>
    </div>
    ${Page
      ? html`<div><button class="ghost" style=${{ marginTop: "16px" }} onClick=${() => setPage(null)}>← মেনু</button>
          <h2>${page}</h2><${Page} profile=${profile} /></div>`
      : html`<div class="grid">${items.map(t => PAGES[t]
          ? html`<button class="go" key=${t} onClick=${() => setPage(t)}><b>${t}</b><span>খুলুন</span></button>`
          : html`<div class="item" key=${t}><b>${t}</b><span>পরের ধাপে</span></div>`)}</div>`}
  </div>`;
}
