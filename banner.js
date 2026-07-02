--- START OF FILE banners.js ---
import { 
  db, 
  onSnapshot, 
  doc, 
  collection 
} from './firebase.js';

import { 
  setSafeSrc, 
  hideSkeleton 
} from './utils.js';

// Local slider state variables
let bannerSlides = [];
let currentSlideIndex = 0;
let slideInterval = null;
let touchStartX = 0;
let touchEndX = 0;
let bannersUnsubscribe = null;

/**
 * Cache-busting URL generator based on the updatedAt timestamp to prevent browser cache issues.
 * @param {string} url - The original image URL
 * @param {any} updatedAt - Timestamp or date representing the modification time
 * @returns {string} - The cache-busted URL
 */
function getBustedUrl(url, updatedAt) {
  if (!url) return '';
  let ts = Date.now();
  if (updatedAt) {
    if (typeof updatedAt.toMillis === 'function') {
      ts = updatedAt.toMillis();
    } else if (updatedAt.seconds) {
      ts = updatedAt.seconds * 1000;
    } else {
      const parsed = new Date(updatedAt).getTime();
      if (!isNaN(parsed)) ts = parsed;
    }
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}u=${ts}`;
}

/**
 * Renders the sliding banner cards inside the wrapper and dots indicator panel.
 */
function renderSlider() {
  const wrapper = document.getElementById('slider-wrapper');
  const dotsContainer = document.getElementById('slider-dots');
  const emptyState = document.getElementById('slider-empty');
  const skeleton = document.getElementById('slider-skeleton');

  if (!wrapper || !dotsContainer || !emptyState) return;

  wrapper.innerHTML = '';
  dotsContainer.innerHTML = '';
  if (skeleton) skeleton.classList.add('hidden');
  emptyState.classList.add('hidden');
  clearInterval(slideInterval);

  if (bannerSlides.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  bannerSlides.forEach((slide, idx) => {
    const slideEl = document.createElement('div');
    slideEl.className = "w-full h-full flex-shrink-0 relative overflow-hidden";
    
    const img = document.createElement('img');
    const bustedUrl = getBustedUrl(slide.imageUrl, slide.updatedAt);
    img.setAttribute("src", bustedUrl);
    img.src = bustedUrl;
    img.removeAttribute("hidden");
    img.classList.remove("hidden");
    img.style.display = "block";
    img.alt = "Arena Slide";
    img.className = "w-full h-full object-cover transition-transform duration-1000 hover:scale-105 opacity-80 hover:opacity-100";
    
    slideEl.appendChild(img);
    wrapper.appendChild(slideEl);

    const dot = document.createElement('button');
    dot.className = `w-2 h-2 rounded-full transition-all duration-300 ${idx === 0 ? 'bg-[#d4af37] w-4' : 'bg-slate-600'}`;
    dot.addEventListener('click', () => {
      goToSlide(idx);
    });
    dotsContainer.appendChild(dot);
  });

  currentSlideIndex = 0;
  updateSliderPosition();
  startAutoSlide();
}

/**
 * Updates CSS translation values and sets CSS class configurations for pagination dots.
 */
function updateSliderPosition() {
  const wrapper = document.getElementById('slider-wrapper');
  if (!wrapper) return;
  wrapper.style.transform = `translateX(-${currentSlideIndex * 100}%)`;

  const dots = document.querySelectorAll('#slider-dots button');
  dots.forEach((dot, idx) => {
    if (idx === currentSlideIndex) {
      dot.className = "w-2 h-2 rounded-full transition-all duration-300 bg-[#d4af37] w-4";
    } else {
      dot.className = "w-2 h-2 rounded-full transition-all duration-300 bg-slate-600";
    }
  });
}

/**
 * Slides navigation engine controller.
 * @param {number} idx - Sliding index index target
 */
function goToSlide(idx) {
  if (idx < 0) {
    currentSlideIndex = bannerSlides.length - 1;
  } else if (idx >= bannerSlides.length) {
    currentSlideIndex = 0;
  } else {
    currentSlideIndex = idx;
  }
  updateSliderPosition();
  startAutoSlide();
}

/**
 * Triggers automated timing translation loops.
 */
function startAutoSlide() {
  clearInterval(slideInterval);
  if (bannerSlides.length > 1) {
    slideInterval = setInterval(() => {
      currentSlideIndex = (currentSlideIndex + 1) % bannerSlides.length;
      updateSliderPosition();
    }, 4000);
  }
}

/**
 * Initializes physical swipe gesture touch trackers on sliding containers.
 */
export const initSwipeListeners = () => {
  const container = document.getElementById('banner-slider-container');
  if (container && !container.dataset.swipeBound) {
    container.dataset.swipeBound = "true";
    container.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      const threshold = 50;
      if (touchStartX - touchEndX > threshold) {
        goToSlide(currentSlideIndex + 1);
      } else if (touchEndX - touchStartX > threshold) {
        goToSlide(currentSlideIndex - 1);
      }
    }, { passive: true });
  }
};

/**
 * Sets up background streams for promotional category banners and sliders from sliderImages collection.
 */
export function initBannersSync() {
  if (bannersUnsubscribe) {
    bannersUnsubscribe();
    bannersUnsubscribe = null;
  }

  bannersUnsubscribe = onSnapshot(collection(db, "sliderImages"), (snap) => {
    const sliderOnlySlides = [];
    let soloDoc = null;
    let duoDoc = null;
    let squadDoc = null;

    snap.forEach((d) => {
      const id = d.id;
      const val = d.data();
      const imageUrl = val.imageUrl;
      const updatedAt = val.updatedAt;
      if (!imageUrl) return;

      if (id === 'soloBanner') {
        soloDoc = { id, imageUrl, updatedAt };
      } else if (id === 'duoBanner') {
        duoDoc = { id, imageUrl, updatedAt };
      } else if (id === 'squadBanner') {
        squadDoc = { id, imageUrl, updatedAt };
      } else if (id.startsWith('slider')) {
        sliderOnlySlides.push({ id, imageUrl, updatedAt });
      }
    });

    // Ensure slider slides are sorted properly sequentially by ID
    sliderOnlySlides.sort((a, b) => {
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Assign mapped image sources to target containers safely with cache-busting
    if (soloDoc) {
      const img = document.getElementById('banner-solo');
      if (img) {
        const bustedSoloUrl = getBustedUrl(soloDoc.imageUrl, soloDoc.updatedAt);
        img.setAttribute("src", bustedSoloUrl);
        img.src = bustedSoloUrl;
        img.removeAttribute("hidden");
        img.classList.remove("hidden");
        img.style.display = "block";
      }
      hideSkeleton('banner-solo-skeleton');
    }

    if (duoDoc) {
      const img = document.getElementById('banner-duo');
      if (img) {
        const bustedDuoUrl = getBustedUrl(duoDoc.imageUrl, duoDoc.updatedAt);
        img.setAttribute("src", bustedDuoUrl);
        img.src = bustedDuoUrl;
        img.removeAttribute("hidden");
        img.classList.remove("hidden");
        img.style.display = "block";
      }
      hideSkeleton('banner-duo-skeleton');
    }

    if (squadDoc) {
      const img = document.getElementById('banner-squad');
      if (img) {
        const bustedSquadUrl = getBustedUrl(squadDoc.imageUrl, squadDoc.updatedAt);
        img.setAttribute("src", bustedSquadUrl);
        img.src = bustedSquadUrl;
        img.removeAttribute("hidden");
        img.classList.remove("hidden");
        img.style.display = "block";
      }
      hideSkeleton('banner-squad-skeleton');
    }

    // Set only primary slides for presentation in the home carousel
    bannerSlides = sliderOnlySlides;

    renderSlider();
  });
}
--- END OF FILE banners.js ---