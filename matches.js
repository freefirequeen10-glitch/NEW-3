import { 
  db, 
  doc,
  collection, 
  onSnapshot,
  runTransaction,
  serverTimestamp,
  increment
} from './firebase.js';

import { 
  myParticipations, 
  renderMyMatches 
} from './history.js';

import { 
  setSafeText 
} from './utils.js';

export let allTournaments = [];
let currentMatchMode = 'All'; 
let currentMatchStatus = 'All'; 
let currentViewId = 'home';
let activeJoinTournament = null;

window.openJoinModal = function(tournamentId) {
  if (!window.currentUserDoc) {
    window.showToast("Please login to join matches!", "error");
    const appContainer = document.getElementById('app-container');
    const authContainer = document.getElementById('auth-container');
    if (appContainer) appContainer.classList.add('hidden');
    if (authContainer) authContainer.classList.remove('hidden');
    window.toggleAuthForms('login');
    return;
  }

  activeJoinTournament = allTournaments.find(t => t.id === tournamentId);
  if (!activeJoinTournament) return;

  setSafeText('join-modal-tourn-name', activeJoinTournament.title);
  setSafeText('join-modal-fee', `₹${activeJoinTournament.entryFee}`);

  const gameNameInput = document.getElementById('join-gamename');
  const uidInput = document.getElementById('join-uid');

  if (gameNameInput) gameNameInput.value = "";
  if (uidInput) uidInput.value = "";

  const modal = document.getElementById('join-modal');
  if (modal) {
    modal.classList.remove('opacity-0', 'pointer-events-none');
  }
};

window.closeJoinModal = function() {
  activeJoinTournament = null;
  const modal = document.getElementById('join-modal');
  if (modal) {
    modal.classList.add('opacity-0', 'pointer-events-none');
  }
};

const joinFormEl = document.getElementById('join-form');
if (joinFormEl) {
  joinFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeJoinTournament || !window.currentUserDoc) return;

    const btn = document.getElementById('join-confirm-btn');
    if (!btn) return;

    btn.disabled = true;
    btn.innerText = "Processing...";

    const gameNameInput = document.getElementById('join-gamename');
    const uidInput = document.getElementById('join-uid');

    const gameName = gameNameInput ? gameNameInput.value.trim() : "";
    const bgmiUid = uidInput ? uidInput.value.trim() : "";

    if (!/^\d+$/.test(bgmiUid)) {
      window.showToast("UID must contain only numbers.", "error");
      btn.disabled = false;
      btn.innerText = "Confirm Join";
      return;
    }

    const fee = Number(activeJoinTournament.entryFee);

    try {
      await runTransaction(db, async (transaction) => {
        const userRef = doc(db, "users", window.currentUserDoc.uid);
        const tournRef = doc(db, "tournaments", activeJoinTournament.id);

        const userSnap = await transaction.get(userRef);
        const tournSnap = await transaction.get(tournRef);

        if (!userSnap.exists() || !tournSnap.exists()) {
          throw new Error("Data sync error. Refetching references.");
        }

        const u = userSnap.data();
        const t = tournSnap.data();

        const currentBalance = parseFloat(u.walletBalance || u.wallet || 0);

        if (currentBalance < fee) {
          throw new Error("Insufficient wallet balance.");
        }

        const max = Number(t.maxPlayers) || 100;
        const joinedCount = Number(t.joinedCount) || 0;
        if (joinedCount >= max) {
          throw new Error("Match slots are full.");
        }

        const participantId = `${activeJoinTournament.id}_${u.uid}`;
        const partRef = doc(db, "matchParticipants", participantId);
        const partSnap = await transaction.get(partRef);

        if (partSnap.exists()) {
          throw new Error("You are already registered.");
        }

        const nextBalance = currentBalance - fee;

        transaction.update(userRef, {
          wallet: nextBalance,
          walletBalance: nextBalance
        });

        transaction.update(tournRef, { joinedCount: increment(1) });

        const txnRef = doc(collection(db, "walletTransactions"));
        transaction.set(txnRef, {
          userId: u.uid,
          type: "match_entry",
          amount: -fee,
          reason: `Joined: ${t.title}`,
          timestamp: serverTimestamp()
        });

        transaction.set(partRef, {
          userId: u.uid,
          userName: u.username,
          email: u.email,
          profilePhoto: u.profileImage || "",
          gameName: gameName,
          bgmiUid: bgmiUid,
          tournamentId: activeJoinTournament.id,
          tournamentName: t.title,
          mode: t.mode || "Solo",
          entryFee: fee,
          date: t.date || "",
          time: t.time || "",
          joinedAt: serverTimestamp(),
          status: "upcoming"
        });
      });

      window.showToast("Successfully joined the battle!", "success");
      window.closeJoinModal();
      window.switchView('my-matches');
    } catch (err) {
      window.showToast(err.message, "error");
      console.error("Match join failure:", err);
    } finally {
      btn.disabled = false;
      btn.innerText = "Confirm Join";
    }
  });
}

export function renderMatches() {
  const feed = document.getElementById('matches-feed');
  if (!feed) return;
  
  feed.innerHTML = '';

  const heroCount = document.getElementById('hero-total-count');

  let filtered = allTournaments;
  if (currentMatchMode !== 'All') {
    filtered = filtered.filter(t => t.mode === currentMatchMode);
  }
  if (currentMatchStatus !== 'All') {
    filtered = filtered.filter(t => (t.status || 'upcoming').toLowerCase() === currentMatchStatus.toLowerCase());
  }

  if (heroCount) {
    heroCount.innerText = `${filtered.length} Match${filtered.length !== 1 ? 'es' : ''}`;
  }

  if (filtered.length === 0) {
    feed.innerHTML = `
      <div class="col-span-1 md:col-span-2 flex flex-col items-center justify-center gap-3 p-12 bg-black/40 border border-purple-500/15 rounded-[24px]">
        <i class="fa-solid fa-shield-slash text-purple-400 text-3xl opacity-60"></i>
        <span class="text-sm font-semibold text-slate-400 uppercase font-grotesk tracking-widest">No Matches Live</span>
      </div>
    `;
    return;
  }

  const DEFAULT_BANNER = "https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1200&auto=format&fit=crop";

  filtered.forEach(t => {
    const max = Number(t.maxPlayers) || 100;
    const joined = Number(t.joinedCount) || 0;
    const remaining = Math.max(0, max - joined);
    const progress = Math.min(100, Math.round((joined / max) * 100));
    const status = (t.status || 'upcoming').toLowerCase();
    const mode = (t.mode || 'Solo');

    const isJoined = myParticipations.some(p => p.tournamentId === t.id);
    const bannerSrc = (t.banner && t.banner.trim() !== '') ? t.banner : DEFAULT_BANNER;

    const statusCfg = {
      live: { 
        cls: 'badge-live', 
        icon: 'fa-circle', 
        label: 'LIVE', 
        dotHtml: '<span class="live-dot" style="width:6px;height:6px;margin-right:2px;"></span>' 
      },
      upcoming: { 
        cls: 'badge-upcoming', 
        icon: 'fa-clock', 
        label: 'UPCOMING', 
        dotHtml: '' 
      },
      completed: { 
        cls: 'badge-completed', 
        icon: 'fa-circle-check', 
        label: 'COMPLETED', 
        dotHtml: '' 
      },
      cancelled: { 
        cls: 'badge-cancelled', 
        icon: 'fa-ban', 
        label: 'CANCELLED', 
        dotHtml: '' 
      },
    };
    
    const sc = statusCfg[status] || statusCfg.upcoming;

    const modeBg = { Solo: '#b8921e', Duo: '#ea580c', Squad: '#e11d48' };
    const modeColor = { Solo: '#120524', Duo: '#ffffff', Squad: '#ffffff' };

    let roomCredsHTML = '';
    if (isJoined) {
      if (t.showRoomDetails === true && t.roomId) {
        roomCredsHTML = `
          <div class="flex items-center gap-2 text-white">
            <span class="bg-purple-950/60 px-2 py-0.5 rounded text-xs font-mono border border-purple-500/20">ID: ${t.roomId}</span>
            <span class="bg-purple-950/60 px-2 py-0.5 rounded text-xs font-mono border border-purple-500/20">PW: ${t.roomPassword || "N/A"}</span>
            <button onclick="navigator.clipboard.writeText('Room ID: ${t.roomId} Pass: ${t.roomPassword || ''}'); window.showToast('Copied Credentials!', 'success');" class="text-gold hover:text-white transition-colors ml-1 text-xs">
              <i class="fa-solid fa-copy"></i>
            </button>
          </div>
        `;
      } else {
        roomCredsHTML = `
          <span class="text-[10px] text-purple-300 font-bold tracking-widest uppercase animate-pulse flex items-center gap-1">
            <i class="fa-solid fa-hourglass-half"></i> AWAITING CREDENTIALS
          </span>
        `;
      }
    } else {
      if (status === 'completed' || status === 'cancelled') {
        roomCredsHTML = `<span class="text-slate-500 text-[10px] uppercase font-bold tracking-widest font-grotesk">Room Locked</span>`;
      } else {
        roomCredsHTML = `
          <div class="flex items-center gap-2 text-slate-500 text-[10px] uppercase font-bold tracking-widest font-grotesk">
            <span>ID: HIDDEN <i class="fa-solid fa-lock text-[9px] text-red-500"></i></span>
            <span>PW: HIDDEN <i class="fa-solid fa-lock text-[9px] text-red-500"></i></span>
          </div>
        `;
      }
    }

    let actionButtonHTML = '';
    if (isJoined) {
      actionButtonHTML = `
        <button disabled class="btn-join bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]">
          JOINED ✓
        </button>
      `;
    } else if (status === 'completed') {
      actionButtonHTML = `
        <button disabled class="btn-join bg-neutral-800 text-neutral-500 border border-neutral-700/30 cursor-not-allowed text-xs">
          MATCH COMPLETED
        </button>
      `;
    } else if (status === 'cancelled') {
      actionButtonHTML = `
        <button disabled class="btn-join bg-red-950/40 text-red-400 border border-red-900/30 cursor-not-allowed text-xs">
          MATCH CANCELLED
        </button>
      `;
    } else if (remaining <= 0) {
      actionButtonHTML = `
        <button disabled class="btn-join bg-neutral-900 text-neutral-600 border border-neutral-800 cursor-not-allowed">
          SLOTS FULL
        </button>
      `;
    } else if (status === 'live') {
      actionButtonHTML = `
        <button onclick="window.openJoinModal('${t.id}')" class="btn-join bg-gradient-to-r from-green-600 to-emerald-500 hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] text-white font-rajdhani font-black">
          <span class="live-dot" style="width:7px;height:7px;"></span> JOIN MATCH — ₹${t.entryFee}
        </button>
      `;
    } else {
      actionButtonHTML = `
        <button onclick="window.openJoinModal('${t.id}')" class="btn-join bg-gradient-to-r from-gold via-gold-light to-gold-dark text-[#0f041e] hover:shadow-[0_0_20px_rgba(212,175,55,0.4)] font-rajdhani font-black">
          <i class="fa-solid fa-bolt text-xs"></i> JOIN MATCH — ₹${t.entryFee}
        </button>
      `;
    }

    const card = document.createElement('div');
    card.className = 'match-card-premium';
    card.innerHTML = `
      <div class="match-card-banner relative h-[140px] overflow-hidden flex-shrink-0 bg-cyber-velvet">
        <div class="banner-skeleton" id="bsk-${t.id}"></div>
        <img
          src="${bannerSrc}"
          alt="${t.title}"
          loading="lazy"
          class="absolute right-0 top-0 h-full w-[60%] sm:w-[50%] object-cover object-center z-0 opacity-80"
          onload="const sk=document.getElementById('bsk-${t.id}'); if(sk) sk.style.display='none';"
          onerror="this.src='${DEFAULT_BANNER}'; const sk=document.getElementById('bsk-${t.id}'); if(sk) sk.style.display='none';"
        >
        <div class="absolute inset-0 bg-gradient-to-r from-[#0a0514] via-[#0a0514]/90 to-transparent z-10"></div>
        
        <div class="absolute inset-0 p-4 flex flex-col justify-between z-20">
          <div class="flex justify-between items-start w-full">
            <span class="mode-badge inline-block px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider font-rajdhani" style="background:${modeBg[mode] || modeBg.Solo}; color:${modeColor[mode] || modeColor.Solo}; position: static; box-shadow: none;">
              ${mode}
            </span>
            <span class="status-badge ${sc.cls}" style="position: static; backdrop-filter: none;">
              ${sc.dotHtml}
              <i class="fa-solid ${sc.icon}"></i>
              ${sc.label}
            </span>
          </div>
          
          <div class="space-y-0.5">
            <h4 class="font-rajdhani font-black text-2xl tracking-wider text-white truncate drop-shadow-md leading-none">${t.title}</h4>
            <p class="text-[10px] sm:text-xs text-slate-300 font-bold tracking-wider uppercase font-grotesk flex items-center gap-1.5 mt-1">
              <i class="fa-solid fa-users text-gold"></i> ${joined} Joined
            </p>
          </div>
        </div>
      </div>

      <div class="match-card-body">
        <div class="flex items-center justify-between text-[10px] text-slate-400 font-grotesk tracking-wider uppercase">
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-calendar-days text-gold"></i> ${t.date || '—'}</span>
          <span class="flex items-center gap-1.5"><i class="fa-solid fa-clock text-gold"></i> ${t.time || '—'}</span>
        </div>

        <div class="grid grid-cols-4 gap-1.5 p-2.5 bg-black/40 border border-purple-500/10 rounded-xl text-center">
          <div>
            <span class="block text-[8px] uppercase tracking-wider text-slate-500 font-bold">Prize Pool</span>
            <span class="block font-rajdhani font-extrabold text-sm text-yellow-400">₹${t.prizePool || 0}</span>
          </div>
          <div class="border-l border-purple-500/10">
            <span class="block text-[8px] uppercase tracking-wider text-slate-500 font-bold">Per Kill</span>
            <span class="block font-rajdhani font-extrabold text-sm text-purple-400">₹${t.perKill || 0}</span>
          </div>
          <div class="border-l border-purple-500/10">
            <span class="block text-[8px] uppercase tracking-wider text-slate-500 font-bold">Entry Fee</span>
            <span class="block font-rajdhani font-extrabold text-sm text-emerald-400">₹${t.entryFee || 0}</span>
          </div>
          <div class="border-l border-purple-500/10">
            <span class="block text-[8px] uppercase tracking-wider text-slate-500 font-bold">Slots</span>
            <span class="block font-rajdhani font-extrabold text-sm text-blue-400">${max}</span>
          </div>
        </div>

        <div class="space-y-1">
          <div class="flex justify-between items-center text-[10px] font-grotesk tracking-wider text-slate-400">
            <span class="text-yellow-500 font-semibold flex items-center gap-1"><i class="fa-solid fa-users text-[8px]"></i> ${joined}/${max} Joined</span>
            <span class="${remaining <= 5 ? 'text-red-400 animate-pulse' : 'text-purple-300'} font-semibold">${remaining} Slots Left</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="h-full rounded-full bg-gradient-to-r from-purple-600 via-gold to-yellow-400 transition-all duration-500" style="width: ${progress}%"></div>
          </div>
        </div>

        <div class="bg-[#120924]/60 border border-purple-500/20 rounded-xl px-3 py-1.5 flex items-center justify-between">
          <span class="text-slate-400 font-semibold tracking-wider text-[9px] uppercase font-grotesk">Room details:</span>
          ${roomCredsHTML}
        </div>

        <div class="pt-1">
          ${actionButtonHTML}
        </div>
      </div>
    `;
    feed.appendChild(card);
  });
}

window.switchView = function(viewId, param = null) {
  if (viewId === 'home' && currentViewId === 'home') {
    window.toggleDrawer(false);
    return;
  }

  currentViewId = viewId;

  requestAnimationFrame(() => {
    const panels = document.querySelectorAll('.view-panel');
    panels.forEach(v => {
      if (!v.classList.contains('hidden')) {
        v.classList.add('hidden');
      }
    });

    const active = document.getElementById('view-' + viewId);
    if (active) {
      active.classList.remove('hidden');
    }

    const navButtons = document.querySelectorAll('.nav-mobile-btn');
    navButtons.forEach(btn => btn.classList.remove('text-gold'));

    const indexMap = { 'home': 0, 'matches': 1, 'my-matches': 2, 'wallet': 3, 'profile': 4 };
    if (indexMap[viewId] !== undefined && navButtons[indexMap[viewId]]) {
      navButtons[indexMap[viewId]].classList.add('text-gold');
    }

    if (viewId === 'matches') {
      currentMatchMode = param || 'All';
      
      const titleMap = { 
        'All': 'ALL BATTLES', 
        'Solo': 'SOLO BATTLES', 
        'Duo': 'DUO BATTLES', 
        'Squad': 'SQUAD BATTLES' 
      };
      
      setSafeText('matches-section-title', titleMap[currentMatchMode] || 'ALL BATTLES');

      currentMatchStatus = 'All';
      document.querySelectorAll('.filter-pill').forEach(btn => btn.classList.remove('pill-active'));
      const allPill = document.querySelector('.filter-pill.pill-all');
      if (allPill) allPill.classList.add('pill-active');

      renderMatches();
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
  });

  window.toggleDrawer(false);
};

window.filterMatchStatus = function(status) {
  currentMatchStatus = status;

  const pillClassMap = {
    'All': 'pill-all',
    'upcoming': 'pill-upcoming',
    'live': 'pill-live',
    'completed': 'pill-completed',
    'cancelled': 'pill-cancelled'
  };

  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.classList.remove('pill-active');
  });

  const activePillClass = pillClassMap[status];
  if (activePillClass) {
    const activePill = document.querySelector(`.filter-pill.${activePillClass}`);
    if (activePill) activePill.classList.add('pill-active');
  }

  renderMatches();
};

export function initMatchesSync() {
  onSnapshot(collection(db, "tournaments"), (snap) => {
    allTournaments = [];
    snap.forEach(d => allTournaments.push({ id: d.id, ...d.data() }));
    
    renderMatches();
    renderMyMatches();
  });
}