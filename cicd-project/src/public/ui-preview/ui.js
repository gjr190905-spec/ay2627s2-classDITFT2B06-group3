/* SCRUM-24 — All-role frontend design navigation, independent of back-end and database.
 * Sample values, counts and identities come directly from the user's reference prototype.
 * This module performs NO HTTP mutations and NO writes to localStorage or PostgreSQL.
 */
(() => {
  'use strict';
  const filename = decodeURIComponent(window.location.pathname.split('/').pop() || '');
  if (filename === 'index.html' || !filename) {
    const search = document.querySelector('#ui-search');
    if (!search) return;
    const cards = [...document.querySelectorAll('.ui-card')];
    const count = document.querySelector('#ui-result-count');
    const empty = document.querySelector('#ui-no-results');
    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      let shown = 0;
      for (const card of cards) {
        card.hidden = !card.textContent.toLowerCase().includes(query) && !card.dataset.title.includes(query);
        shown += Number(!card.hidden);
      }
      for (const section of document.querySelectorAll('.ui-section')) {
        section.hidden = !section.querySelector('.ui-card:not([hidden])');
      }
      count.textContent = `${shown} of ${cards.length} screens`;
      empty.hidden = shown !== 0;
    });
    return;
  }
  const prefix = filename.split('-')[0];
  const isVendor = prefix === 'Vendor' || filename === 'Mobile-vendor-orders.html';
  const isAdmin = prefix === 'Admin' || filename === 'Mobile-admin-moderation.html';
  const isStaff = prefix === 'Staff';
  const vendorTabs = { orders: 'Vendor-orders.html', menu: 'Vendor-menu.html', scanner: 'Vendor-scanner.html', settings: 'Vendor-settings.html', feedback: 'Vendor-feedback.html' };
  const adminTabs = { overview: 'Admin-overview.html', accounts: 'Admin-accounts.html', stalls: 'Admin-stalls.html', feedback: 'Admin-feedback.html' };
  const info = { about: 'Public-about.html', help: 'Public-help.html', terms: 'Public-terms.html', privacy: 'Public-privacy.html' };
  const pages = {
    home: 'Public-home.html', explore: 'Customer-food-courts-and-stalls.html', how: 'Public-how.html',
    orders: isVendor ? vendorTabs.orders : isStaff ? 'Staff-order-history.html' : 'Customer-orders.html',
    vendor: 'Vendor-orders.html', admin: 'Admin-overview.html',
    profile: isVendor ? 'Vendor-profile.html' : isAdmin ? 'Admin-profile.html' : isStaff ? 'Staff-profile.html' : 'Student-profile.html',
    cart: 'Customer-basket-and-checkout.html', login: '../../login.html', signup: '../../signup.html',
  };
  const root = document.querySelector('#app');
  if (!root) return;
  const toast = document.createElement('aside');
  toast.className = 'ui-preview-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.hidden = true;
  const closeToast = document.createElement('button');
  closeToast.className = 'ui-preview-toast-close';
  closeToast.type = 'button';
  closeToast.setAttribute('aria-label', 'Dismiss preview notice');
  closeToast.textContent = '×';
  closeToast.addEventListener('click', () => { toast.hidden = true; });
  const msg = document.createElement('span');
  toast.append(closeToast, msg);
  document.body.appendChild(toast);
  const badge = document.createElement('span');
  badge.className = 'ui-preview-badge';
  badge.textContent = 'UI PREVIEW · SAMPLE DATA · NO DATABASE CHANGES';
  document.body.appendChild(badge);
  function notice(s) { msg.textContent = s; toast.hidden = false; }
  function navigate(s) { window.location.href = s; }
  function sample(reason) { notice(`${reason} Preview only—nothing has been submitted or saved. The feature owner must connect the frontend to a verified API and PostgreSQL.`); }

  document.addEventListener('submit', (e) => {
    if (!(e.target instanceof HTMLFormElement)) return;
    e.preventDefault();
    if (!e.target.reportValidity()) return;
    sample('Form validation completed.');
  });
  const actions = ['button[data-page]', 'button[data-info]', 'button[data-vendortab]', 'button[data-admintab]', 'button[data-action]', 'button[data-editmenu]', 'button[data-adminstall]', 'button[data-decision]', 'button[data-vendorstatus]', 'button[data-order]', 'button[data-stall]', 'button[data-court]', 'button[data-cuisine]', 'button[data-dish]', 'button[data-add]', 'button[data-court-back]', 'button[data-cartremove]', 'button[data-cartqty]', 'button[data-togglemenu]', 'button[data-status]'];
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.closest('form') && b.type === 'submit') return;
    const d = b.dataset;
    if (d.page && pages[d.page]) return navigate(pages[d.page]);
    if (d.info && info[d.info]) return navigate(info[d.info]);
    if (d.vendortab && vendorTabs[d.vendortab]) return navigate(vendorTabs[d.vendortab]);
    if (d.admintab && adminTabs[d.admintab]) return navigate(adminTabs[d.admintab]);
    if (d.editmenu) return navigate('Vendor-Edit-menu.html');
    if (d.adminstall) return navigate('Admin-Edit-stalls.html');
    if (d.stall) return navigate('Customer-stall-menu.html');
    if (d.order) {
      const views = { 1:'Customer-receipt-placed.html', 2:'Customer-receipt-preparing.html', 3:'Customer-receipt-ready-QR.html', 4:'Customer-receipt-collected-feedback.html', 5:'Customer-receipt-cancelled.html' };
      return navigate(views[Number(d.order)] || 'Customer-receipt-placed.html');
    }
    if (d.court) {
      if (d.court === '6') return navigate('Customer-FC6-filter.html');
      return sample(`Food Court ${d.court} selected.`);
    }
    if (d.courtBack) return navigate('Customer-FC6-filter.html');
    if (d.cuisine) {
      const selected = d.cuisine;
      for (const filter of document.querySelectorAll('[data-cuisine]')) filter.setAttribute('aria-pressed', String(filter.dataset.cuisine === selected));
      return sample(`${selected} filter selected.`);
    }
    if (d.dish) return navigate('Customer-customise-dish.html');
    if (d.add) return sample('Add to basket selected.');
    if (d.cartremove || d.cartqty) return sample('Basket adjustment selected.');
    if (d.decision) return sample(`Admin ${d.decision.toLowerCase()} decision selected.`);
    if (d.vendorstatus || d.status) return sample('Order status change selected.');
    if (d.togglemenu) return sample('Menu availability toggle selected.');
    const a = d.action;
    if (a === 'toggleMenu') {
      const nav = document.querySelector('.nav-links');
      if (nav) { nav.classList.toggle('open'); b.setAttribute('aria-expanded', String(nav.classList.contains('open'))); }
      return;
    }
    if (a === 'focusSearch') {
      const input = document.querySelector('input[type="search"]');
      if (input) return input.focus();
      return navigate('Customer-food-courts-and-stalls.html');
    }
    if (a === 'clearCourt') return navigate('Customer-food-courts-and-stalls.html');
    if (a === 'closeDish') return navigate('Customer-stall-menu.html');
    if (a === 'addMenu') return navigate('Vendor-Add-menu.html');
    if (a === 'adminAddStall') return navigate('Admin-Add-stalls.html');
    if (a === 'dismissModal') return navigate(isAdmin ? 'Admin-stalls.html' : 'Vendor-menu.html');
    if (a === 'dishMinus' || a === 'dishPlus' || a === 'dishAdd') return sample('Dish customisation selected.');
    if (a === 'checkout') return sample('Checkout selected.');
    if (a === 'printOrder') return window.print();
    if (a === 'logout') return sample('Logout selected. Please use the real authenticated app to revoke the session.');
    if (a === 'pickupCamera') return sample('Pickup scanner selected.');
    if (a === 'approvePickup' || a === 'declinePickup') return sample('Collection decision selected.');
    if (a === 'refreshVendor') return sample('Vendor refresh selected.');
    if (a === 'clearCart') return sample('Clear basket selected.');
    if (a) return sample(`${a} selected.`);
    if (actions.some((sel) => b.matches(sel))) return sample('Control selected.');
    // Every unused prototype button still provides visible, truthful feedback.
    return sample('Action selected.');
  });
})();
