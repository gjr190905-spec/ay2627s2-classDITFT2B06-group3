/* The landing page shares the same responsive header as the prototype login UI. */
(function () {
  'use strict';
  const toggle = document.getElementById('mobile-menu');
  const navigation = document.getElementById('site-navigation');
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(expanded));
    navigation.classList.toggle('open', expanded);
  });
})();
