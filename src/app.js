import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBK0XSL0_TZJjepQv87os2ikJ7Nx_smX3c",
    authDomain: "anthony-form.firebaseapp.com",
    projectId: "anthony-form",
    storageBucket: "anthony-form.firebasestorage.app",
    messagingSenderId: "803510657296",
    appId: "1:803510657296:web:2f16dd93ede50c3312c595",
    measurementId: "G-VTKZW577HP"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const appId = typeof __app_id !== 'undefined' ? __app_id : 'sma-registry-2026';
const MEMBERSHIP_FEE = 50;

let members = [];
let isAdmin = false;
let deleteId = null;
let currentUser = null;

const initAuth = async () => {
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token && __initial_auth_token.length > 10) {
            try {
                await signInWithCustomToken(auth, __initial_auth_token);
            } catch (tokenErr) {
                await signInAnonymously(auth);
            }
        } else {
            await signInAnonymously(auth);
        }
    } catch (error) {
        console.error("Critical Auth Error:", error);
    }
};

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        setupRealtimeListener();
        checkAdminStatus();
    }
});

const checkAdminStatus = () => {
    if (sessionStorage.getItem('sma_admin_session') === 'active') {
        isAdmin = true;
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }
};

const setupRealtimeListener = () => {
    if (!currentUser) return;
    const colRef = collection(db, 'artifacts', appId, 'public', 'data', 'members');
    onSnapshot(colRef, (snapshot) => {
        members = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        members.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
        if (isAdmin) renderAdminContent();
    }, (error) => {
        console.error("Firestore Error:", error);
    });
};

window.showView = (viewId) => {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(`view-${viewId}`);
    target.classList.remove('hidden');
    target.classList.add('view-transition');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.copyToClipboard = (text, label) => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast(`${label} copied to clipboard`, true);
};

window.showToast = (msg, success = true) => {
    const t = document.getElementById('toast');
    t.className = `fixed bottom-10 left-1/2 -translate-x-1/2 px-6 py-4 rounded-2xl shadow-2xl z-[5000] transition-all duration-500 flex items-center gap-3 whitespace-nowrap ${success ? 'bg-slate-900 text-white' : 'bg-rose-600 text-white'}`;
    t.innerHTML = `<i class="fa-solid ${success ? 'fa-check-circle text-emerald-400' : 'fa-circle-xmark'}"></i> <span class="text-sm font-bold">${msg}</span>`;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('toast-active'), 10);
    setTimeout(() => {
        t.classList.remove('toast-active');
        setTimeout(() => t.classList.add('hidden'), 500);
    }, 3000);
};

// Household Management Logic
window.updateRowVisibility = (select) => {
    const row = select.closest('.member-row');
    const ageSelectContainer = row.querySelector('.age-select-container');
    if (select.value === 'Parent') {
        ageSelectContainer.classList.add('hidden');
        // Ensure parent defaults to Adult in background
        ageSelectContainer.querySelector('select').value = 'Adult';
    } else {
        ageSelectContainer.classList.remove('hidden');
    }
};

window.addMemberRow = (type = 'Child', name = '', age = 'Minor') => {
    const container = document.getElementById('household-container');
    const div = document.createElement('div');
    div.className = 'member-row flex flex-col md:flex-row gap-2 items-start md:items-center mb-4 bg-white/20 p-3 rounded-2xl border border-white/30';

    const isParent = type === 'Parent';

    div.innerHTML = `
        <div class="flex gap-2 w-full md:w-auto flex-1">
            <select name="h_type" onchange="updateRowVisibility(this)" class="w-24 px-3 py-3 bg-white border-none rounded-xl text-[10px] font-black uppercase text-slate-700 outline-none">
                <option value="Child" ${type === 'Child' ? 'selected' : ''}>Child</option>
                <option value="Parent" ${isParent ? 'selected' : ''}>Parent</option>
                <option value="Other" ${type === 'Other' ? 'selected' : ''}>Other</option>
            </select>
            <input type="text" name="h_name" value="${name}" placeholder="Full Name" class="flex-1 px-4 py-3 bg-white border-none rounded-xl text-xs font-bold text-slate-700 outline-none">
        </div>
        <div class="flex gap-2 w-full md:w-auto items-center">
            <div class="age-select-container ${isParent ? 'hidden' : ''} flex-1 md:w-32">
                <select name="h_age" class="w-full px-3 py-3 bg-white border-none rounded-xl text-[10px] font-black uppercase text-slate-700 outline-none">
                    <option value="Minor" ${age === 'Minor' ? 'selected' : ''}>Minor (<18)</option>
                    <option value="Adult" ${age === 'Adult' || isParent ? 'selected' : ''}>Adult (18+)</option>
                </select>
            </div>
            <button type="button" onclick="this.closest('.member-row').remove()" class="w-10 h-10 flex items-center justify-center bg-white/50 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors">
                <i class="fa-solid fa-times"></i>
            </button>
        </div>
    `;
    container.appendChild(div);
};

window.handleSubmitConfirm = (e) => {
    e.preventDefault();
    document.getElementById('confirm-submit-modal').classList.remove('hidden');
};

window.handleFinalSubmit = async () => {
    document.getElementById('confirm-submit-modal').classList.add('hidden');
    const form = document.getElementById('registry-form');
    const btn = document.getElementById('submit-btn');
    const formData = new FormData(form);
    const memberId = document.getElementById('form-member-id').value;

    // Extract dynamic household members
    const types = formData.getAll('h_type');
    const names = formData.getAll('h_name');
    const ages = formData.getAll('h_age');

    // Logic to handle hidden inputs (Parents are always Adults)
    const householdMembers = types.map((type, i) => {
        const ageCategory = type === 'Parent' ? 'Adult' : ages[i];
        return {
            type,
            name: names[i],
            ageCategory: ageCategory
        };
    }).filter(m => m.name.trim());

    const data = {
        name: formData.get('name'),
        email: formData.get('email').toLowerCase().trim(),
        mobile: formData.get('mobile').replace(/\s/g, ''),
        profession: formData.get('profession'),
        address: formData.get('address'),
        spouse: formData.get('spouse'),
        spouseProfession: formData.get('spouseProfession'),
        householdMembers: householdMembers,
        childrenList: householdMembers.filter(m => m.type === 'Child').map(m => m.name),
        isVerifiedPaid: formData.get('paidConfirmed') === 'on',
        submittedAt: new Date().toISOString()
    };

    try {
        btn.disabled = true;
        btn.innerHTML = `<div class="loader mx-auto"></div>`;
        if (!currentUser) await initAuth();

        if (memberId) {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'members', memberId), data);
        } else {
            const col = collection(db, 'artifacts', appId, 'public', 'data', 'members');
            await addDoc(col, data);
        }

        showView('success');
        form.reset();
        document.getElementById('household-container').innerHTML = '';
        document.getElementById('form-member-id').value = '';
    } catch (err) {
        showToast("Submission failed.", false);
    } finally {
        btn.disabled = false;
        btn.innerText = memberId ? "Update Profile" : "Confirm & Register";
    }
};

window.handleLogin = async (e) => {
    e.preventDefault();
    const inputPw = document.getElementById('admin-pw').value;

    // Fetch current password from Firestore
    try {
        const configRef = doc(db, 'artifacts', appId, 'public', 'config', 'admin');
        const snap = await getDoc(configRef);
        let validPassword = 'admin123'; // Default fallback

        if (snap.exists()) {
            validPassword = snap.data().password || 'admin123';
        } else {
            // Initialize if first time
            await setDoc(configRef, { password: 'admin123' }, { merge: true });
        }

        if (inputPw === validPassword) {
            isAdmin = true;
            sessionStorage.setItem('sma_admin_session', 'active');
            document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
            showView('admin');
            renderAdminContent();
        } else {
            showToast("Incorrect Password", false);
        }
    } catch (err) {
        // Fallback for offline/no-config
        if (inputPw === 'admin123') {
            isAdmin = true;
            sessionStorage.setItem('sma_admin_session', 'active');
            showView('admin');
            renderAdminContent();
        } else {
            showToast("Access Error", false);
        }
    }
};

window.updateAdminPassword = async () => {
    const newPw = document.getElementById('new-password').value;
    if (!newPw || newPw.length < 4) {
        showToast("Minimum 4 characters", false);
        return;
    }

    try {
        if (!currentUser) await initAuth();
        const configRef = doc(db, 'artifacts', appId, 'public', 'config', 'admin');
        await setDoc(configRef, { password: newPw }, { merge: true });
        showToast("Access code updated successfully!");
        document.getElementById('new-password').value = '';
    } catch (err) {
        console.error("Password update error:", err);
        showToast("Update failed: " + (err.code || err.message), false);
    }
};

window.renderAdminContent = () => {
    const searchTerm = document.getElementById('admin-search')?.value.toLowerCase() || '';
    const filtered = members.filter(m =>
        (m.name || '').toLowerCase().includes(searchTerm) ||
        (m.mobile || '').includes(searchTerm) ||
        (m.spouse || '').toLowerCase().includes(searchTerm)
    );

    const paidCount = members.filter(m => m.isVerifiedPaid).length;
    document.getElementById('stat-total').innerText = members.length;
    document.getElementById('stat-paid').innerText = paidCount;
    document.getElementById('stat-revenue').innerText = `$${paidCount * MEMBERSHIP_FEE}`;

    const list = document.getElementById('admin-member-list');
    list.innerHTML = filtered.map(m => `
        <div class="premium-card !p-8 flex flex-col gap-6">
            <div class="flex justify-between items-start">
                <div class="flex gap-5">
                    <div>
                        <h4 class="text-xl font-black text-white leading-tight">${m.name}</h4>
                        <p class="text-[10px] text-emerald-300 font-extrabold uppercase tracking-[0.15em] mt-1">${m.profession || 'Association Member'}</p>
                    </div>
                </div>
                <button onclick="togglePaid('${m.id}', ${m.isVerifiedPaid})" class="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${m.isVerifiedPaid ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' : 'bg-amber-400 text-white shadow-lg shadow-amber-500/20'}">
                    ${m.isVerifiedPaid ? 'Verified' : 'Pending Verification'}
                </button>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-semibold text-white/70 border-y border-white/10 py-6">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                        <i class="fa-solid fa-phone text-[10px] text-emerald-300"></i>
                    </div>
                    <span class="text-white font-bold">${m.mobile}</span>
                </div>
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                        <i class="fa-solid fa-envelope text-[10px] text-emerald-300"></i>
                    </div>
                    <span class="text-white font-bold truncate">${m.email}</span>
                </div>
                <div class="flex items-start gap-3 col-span-1 md:col-span-2">
                    <div class="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-map-marker-alt text-[10px] text-emerald-300"></i>
                    </div>
                    <span class="text-white/80 leading-relaxed pt-1">${m.address || 'No Address Provided'}</span>
                </div>
            </div>

            ${m.spouse || (m.householdMembers && m.householdMembers.length > 0) ? `
                <div class="space-y-4 bg-white/5 p-5 rounded-2xl border border-white/10">
                    ${m.spouse ? `
                        <div class="flex items-center gap-3">
                            <i class="fa-solid fa-heart text-rose-400 text-xs"></i>
                            <span class="text-xs font-bold text-white">${m.spouse}</span>
                            ${m.spouseProfession ? `<span class="text-[10px] text-white/50 font-medium italic">(${m.spouseProfession})</span>` : ''}
                        </div>
                    ` : ''}
                    
                    ${m.householdMembers && m.householdMembers.length > 0 ? `
                        <div class="flex flex-wrap gap-2">
                            <i class="fa-solid fa-people-roof text-emerald-400 text-xs mt-1 mr-1"></i>
                            ${m.householdMembers.map(c => `
                                <span class="px-3 py-1 bg-white/10 text-white rounded-lg text-[10px] font-extrabold border border-white/10 flex items-center gap-2 shadow-sm">
                                    <span class="opacity-50 uppercase text-[8px] font-black">${c.type}</span> 
                                    ${c.name}
                                    <span class="w-1 h-1 bg-white/30 rounded-full"></span>
                                    <span class="text-emerald-300">${c.ageCategory === 'Adult' ? '18+' : 'Un18'}</span>
                                </span>`).join('')}
                        </div>
                    ` : ''}
                </div>
            ` : ''}

            <div class="grid grid-cols-2 gap-4 pt-2">
                <button onclick="editMember('${m.id}')" class="py-4 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500 transition-all shadow-lg">Edit Profile</button>
                <button onclick="confirmDelete('${m.id}')" class="py-4 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-500 transition-all shadow-lg">Remove</button>
            </div>
        </div>
    `).join('') || '<div class="text-center py-24 text-white/40 font-bold uppercase tracking-widest">No matching records</div>';
};


window.togglePaid = async (id, current) => {
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'members', id), { isVerifiedPaid: !current });
        showToast("Payment status updated");
    } catch (err) {
        showToast("Action restricted", false);
    }
};

window.editMember = (id) => {
    const m = members.find(x => x.id === id);
    if (!m) return;
    const f = document.getElementById('registry-form');
    document.getElementById('form-member-id').value = m.id;
    f.name.value = m.name || '';
    f.email.value = m.email || '';
    f.mobile.value = m.mobile || '';
    f.profession.value = m.profession || '';
    f.address.value = m.address || '';
    f.spouse.value = m.spouse || '';
    f.spouseProfession.value = m.spouseProfession || '';

    document.getElementById('household-container').innerHTML = '';
    if (m.householdMembers && m.householdMembers.length > 0) {
        m.householdMembers.forEach(hm => addMemberRow(hm.type, hm.name, hm.ageCategory));
    }

    document.getElementById('submit-btn').innerText = "Update Profile";
    showView('form');
};

window.confirmDelete = (id) => {
    deleteId = id;
    document.getElementById('delete-modal').classList.remove('hidden');
};

window.executeDelete = async () => {
    if (!deleteId) return;
    try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'members', deleteId));
        document.getElementById('delete-modal').classList.add('hidden');
        showToast("Member removed", false);
    } catch (err) {
        showToast("Admin access required", false);
    }
};

window.exportData = () => {
    const csv = "Name,Mobile,Email,Profession,Address,Spouse,Spouse Profession,Household,Paid\n" +
        members.map(m => {
            const householdStr = (m.householdMembers || []).map(h => `${h.type}:${h.name}(${h.ageCategory})`).join('; ');
            return `"${m.name}","${m.mobile}","${m.email}","${m.profession}","${m.address}","${m.spouse}","${m.spouseProfession}","${householdStr}",${m.isVerifiedPaid}`;
        }).join("\n");
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `SMA_Registry_2026.csv`);
    a.click();
};

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    document.getElementById('registry-form').addEventListener('submit', handleSubmitConfirm);
});
