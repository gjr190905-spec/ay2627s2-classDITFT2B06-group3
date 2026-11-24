const TOKEN_KEY = 'token';
const CART_KEY = 'cart'; 
const LOGIN_PAGE = 'index.html';
const PLACEHOLDER_IMAGE = 'images/stalls/placeholder.png';

const FALLBACK_DETAILS = {
  'Our Sweet Toast': { cuisine: 'breakfast', blurb: 'Kaya toast, sandwiches, coffee and tea.' },
  'Canopy Greens': { cuisine: 'healthy-bowls', blurb: 'Build-your-own salad bowls and sides.' },
  Foodgonomy: { cuisine: 'dessert', blurb: 'Yogurt cups and parfaits with fresh toppings.' },
  'Japanese Food': { cuisine: 'japanese', blurb: 'Rice bowls, curry and udon.' },
  'Western Food': { cuisine: 'western', blurb: 'Chops, pasta, burgers and sides.' },
  'Hello Handmade Noodles': {
    cuisine: 'noodles',
    blurb: 'Handmade noodles, soups and braised dishes.',
  },
};
// Add this near the top with your other constants
const STALL_IMAGES = {
  'Our Sweet Toast':        'https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=400&h=240&fit=crop',
  'Canopy Greens':          'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=240&fit=crop',
  'Foodgonomy':             'https://images.unsplash.com/photo-1603362548634-f26e6ce7237a?w=400&h=240&fit=crop',
  'Japanese Food':          'https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=400&h=240&fit=crop',
  'Western Food':           'https://images.unsplash.com/photo-1432139509613-5c4255815697?w=400&h=240&fit=crop',
  'Hello Handmade Noodles': 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400&h=240&fit=crop',
};

const CUISINE_LABELS = {
  breakfast: 'Breakfast',
  'healthy-bowls': 'Healthy bowls',
  dessert: 'Dessert',
  japanese: 'Japanese',
  western: 'Western',
  noodles: 'Noodles',
};

// ── Page elements ────────────────────────────────────────
const courtList = document.getElementById('court-list');
const cuisineList = document.getElementById('cuisine-list');
const stallGrid = document.getElementById('stall-grid');
const stallCount = document.getElementById('stall-count');
const loadingMessage = document.getElementById('stall-loading');
const errorMessage = document.getElementById('stall-error');
const emptyMessage = document.getElementById('stall-empty');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('stall-search');
const cardTemplate = document.getElementById('stall-card-template');
const cartBadge = document.getElementById('cart-count');
const signOutButton = document.getElementById('sign-out');

let allStalls = [];
let selectedCourt = null;
let selectedCuisine = 'all';
let searchText = '';

// ── Small helpers ────────────────────────────────────────
function pluralise(count, singular, plural) {
  if (count === 1) {
    return `${count} ${singular}`;
  }
  return `${count} ${plural}`;
}

function setPressed(button, isPressed) {
  button.setAttribute('aria-pressed', String(isPressed));
}

function courtNameFor(courtNumber) {
  return `Food Court ${courtNumber}`;
}

// ── Cart badge ───────────────────────────────────────────
function getCartCount() {
  try {
    const cart = JSON.parse(localStorage.getItem(CART_KEY));
    if (!cart || !Array.isArray(cart.items)) {
      return 0;
    }
    return cart.items.reduce((total, item) => {
      if (Number.isInteger(item.quantity) && item.quantity > 0) {
        return total + item.quantity;
      }
      return total;
    }, 0);
  } catch {
    return 0;
  }
}

function showCartCount() {
  cartBadge.textContent = String(getCartCount());
}

function normaliseStall(raw) {
  const fallback = FALLBACK_DETAILS[raw.name] || {};
  const cuisine = raw.cuisine || fallback.cuisine || 'other';

  let itemCount = null;
  const parsedCount = Number(raw.itemCount);
  if (raw.itemCount !== undefined && raw.itemCount !== null && Number.isInteger(parsedCount)) {
    itemCount = parsedCount;
  }

  console.log(raw.name, STALL_IMAGES[raw.name]);
  return {
    id: raw.id,
    name: raw.name,
    courtName: raw.foodCourtName || '',
    isActive: raw.isActive !== false,
    itemCount,
    cuisine,
    cuisineLabel: CUISINE_LABELS[cuisine] || 'Other',
    blurb: raw.description || fallback.blurb || '',
    imagePath: raw.imagePath || STALL_IMAGES[raw.name] || PLACEHOLDER_IMAGE,
  };
}

// ── Filtering ────────────────────────────────────────────
function matchesFilters(stall) {
  if (selectedCourt !== null && stall.courtName !== courtNameFor(selectedCourt)) {
    return false;
  }
  if (selectedCuisine !== 'all' && stall.cuisine !== selectedCuisine) {
    return false;
  }
  if (searchText !== '') {
    const haystack = `${stall.name} ${stall.cuisineLabel} ${stall.blurb}`.toLowerCase();
    if (!haystack.includes(searchText)) {
      return false;
    }
  }
  return true;
}

// ── Rendering ────────────────────────────────────────────
function renderCourtCounts() {
  courtList.querySelectorAll('.court-card').forEach((button) => {
    const courtName = courtNameFor(button.dataset.court);
    const count = allStalls.filter((stall) => stall.courtName === courtName).length;
    button.querySelector('.court-card__count').textContent = pluralise(count, 'stall', 'stalls');
  });
}

function buildStallCard(stall) {
  const fragment = cardTemplate.content.cloneNode(true);

  const image = fragment.querySelector('.stall-card__image');
  image.addEventListener(
    'error',
    () => {
      image.src = PLACEHOLDER_IMAGE;
    },
    { once: true },
  );
  image.src = stall.imagePath;

  fragment.querySelector('.tag').textContent = stall.cuisineLabel;
  fragment.querySelector('.stall-card__name').textContent = stall.name;
  fragment.querySelector('.stall-card__blurb').textContent = stall.blurb;

  let meta = stall.courtName;
  if (stall.itemCount !== null) {
    meta = `${stall.courtName}, ${pluralise(stall.itemCount, 'item', 'items')}`;
  }
  fragment.querySelector('.stall-card__meta').textContent = meta;

  const status = fragment.querySelector('.status');
  const link = fragment.querySelector('.stall-card__link');

  if (stall.isActive) {
    status.textContent = 'Accepting orders';
    status.classList.add('status--open');
    link.href = `stall-menu.html?id=${encodeURIComponent(String(stall.id))}`;
  } else {
    status.textContent = 'Closed';
    status.classList.add('status--closed');
    link.removeAttribute('href');
    link.textContent = 'Not taking orders';
    link.classList.add('stall-card__link--disabled');
    link.setAttribute('aria-disabled', 'true');
  }

  return fragment;
}

function renderStalls() {
  const visibleStalls = allStalls.filter(matchesFilters);

  stallGrid.replaceChildren();
  visibleStalls.forEach((stall) => {
    stallGrid.appendChild(buildStallCard(stall));
  });

  stallCount.textContent = `${pluralise(visibleStalls.length, 'stall', 'stalls')} found`;
  emptyMessage.hidden = visibleStalls.length > 0;
}

// ── Loading from the API ─────────────────────────────────
async function loadStalls() {
  try {
    const response = await fetch('/stalls');
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const data = await response.json();
    allStalls = data.map(normaliseStall);

    loadingMessage.hidden = true;
    renderCourtCounts();
    renderStalls();
  } catch (error) {
    console.error(error);
    loadingMessage.hidden = true;
    stallGrid.replaceChildren();
    stallCount.textContent = '';
    errorMessage.hidden = false;
  }
}

// ── Events ───────────────────────────────────────────────
courtList.addEventListener('click', (event) => {
  const button = event.target.closest('.court-card');
  if (!button) {
    return;
  }

  if (selectedCourt === button.dataset.court) {
    selectedCourt = null;
  } else {
    selectedCourt = button.dataset.court;
  }

  courtList.querySelectorAll('.court-card').forEach((card) => {
    setPressed(card, card.dataset.court === selectedCourt);
  });
  renderStalls();
});

cuisineList.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) {
    return;
  }

  selectedCuisine = chip.dataset.cuisine;
  cuisineList.querySelectorAll('.chip').forEach((other) => {
    setPressed(other, other.dataset.cuisine === selectedCuisine);
  });
  renderStalls();
});

searchInput.addEventListener('input', () => {
  searchText = searchInput.value.trim().toLowerCase();
  renderStalls();
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  searchText = searchInput.value.trim().toLowerCase();
  renderStalls();
});

signOutButton.addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = LOGIN_PAGE;
});

// ── Start ────────────────────────────────────────────────
const startingCourt = courtList.querySelector('.court-card[aria-pressed="true"]');
if (startingCourt) {
  selectedCourt = startingCourt.dataset.court;
}

showCartCount();
loadStalls();