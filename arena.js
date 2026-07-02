import { 
  db, 
  doc, 
  collection, 
  runTransaction, 
  serverTimestamp, 
  increment 
} from './firebase.js';

import { 
  currentUserDoc 
} from './auth.js';

import { 
  allTournaments 
} from './matches.js';

import { 
  showToast, 
  setSafeText 
} from './utils.js';

// Local operational state
let activeJoinTournament = null;

// --- MODAL CONTROLLERS & TRIGGER BINDINGS ---

/**
 * Opens the Join Battle modal, validating authentication state and resetting form fields.
 * @param {string} tournamentId - Tournament identifier
 */
window.openJoinModal = function(tournamentId) {
  if (!currentUserDoc) {
    showToast("Please login to join matches!", "error");
    
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

/**
 * Closes the Join Battle modal.
 */
window.closeJoinModal = function() {
  activeJoinTournament = null;
  const modal = document.getElementById('join-modal');
  if (modal) {
    modal.classList.add('opacity-0', 'pointer-events-none');
  }
};

/**
 * Opens the Room Credentials detail modal based on active access verification.
 * @param {string} tournamentId - Tournament identifier
 */
window.openRoomModal = function(tournamentId) {
  const tourn = allTournaments.find(t => t.id === tournamentId);
  if (!tourn) return;

  const vPanel = document.getElementById('room-content-visible');
  const hPanel = document.getElementById('room-content-hidden');

  if (!vPanel || !hPanel) return;

  if (tourn.showRoomDetails === true && tourn.roomId) {
    setSafeText('rd-id', tourn.roomId);
    setSafeText('rd-pass', tourn.roomPassword || "No Password");
    vPanel.classList.remove('hidden');
    hPanel.classList.add('hidden');
  } else {
    vPanel.classList.add('hidden');
    hPanel.classList.remove('hidden');
  }

  const modal = document.getElementById('room-details-modal');
  if (modal) {
    modal.classList.remove('opacity-0', 'pointer-events-none');
  }
};

/**
 * Closes the Room Credentials modal.
 */
window.closeRoomModal = function() {
  const modal = document.getElementById('room-details-modal');
  if (modal) {
    modal.classList.add('opacity-0', 'pointer-events-none');
  }
};

// --- TRANSACTION OPERATIONS ---

// Join Battle Form Submission Handler
const joinFormEl = document.getElementById('join-form');
if (joinFormEl) {
  joinFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeJoinTournament || !currentUserDoc) return;

    const btn = document.getElementById('join-confirm-btn');
    if (!btn) return;

    btn.disabled = true; 
    btn.innerText = "Processing...";

    const gameNameInput = document.getElementById('join-gamename');
    const uidInput = document.getElementById('join-uid');

    const gameName = gameNameInput ? gameNameInput.value.trim() : "";
    const bgmiUid = uidInput ? uidInput.value.trim() : "";

    // Exact verification structure for numeric-only UID patterns
    if (!/^\d+$/.test(bgmiUid)) {
      showToast("UID must contain only numbers.", "error");
      btn.disabled = false; 
      btn.innerText = "Confirm Join";
      return;
    }

    const fee = Number(activeJoinTournament.entryFee);

    try {
      await runTransaction(db, async (transaction) => {
        const userRef = doc(db, "users", currentUserDoc.uid);
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

        // Atomically deduct entry fee from User record
        transaction.update(userRef, { 
          wallet: nextBalance,
          walletBalance: nextBalance
        });

        // Atomically increment slots allocated in Tournament document
        transaction.update(tournRef, { joinedCount: increment(1) });

        // Register transaction debit record in Transactions database
        const txnRef = doc(collection(db, "walletTransactions"));
        transaction.set(txnRef, {
          userId: u.uid,
          type: "match_entry",
          amount: -fee,
          reason: `Joined: ${t.title}`,
          timestamp: serverTimestamp()
        });

        // Log participant data sheet
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

      showToast("Successfully joined the battle!", "success");
      window.closeJoinModal();
      window.switchView('my-matches');
    } catch (err) {
      showToast(err.message, "error");
      console.error("Match join failure:", err);
    } finally {
      btn.disabled = false; 
      btn.innerText = "Confirm Join";
    }
  });
}