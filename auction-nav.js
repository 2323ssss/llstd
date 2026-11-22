(() => {
  'use strict';

  function addLink(container, className) {
    if (!container || container.querySelector('[data-llstd-auctions]')) return;
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = '/auctions/';
    link.className = className;
    link.dataset.llstdAuctions = 'true';
    link.textContent = 'مزادات اللوحات';
    item.appendChild(link);
    container.appendChild(item);
  }

  function mountAuctionLinks() {
    const navList = document.querySelector('nav ul');
    if (navList) addLink(navList, 'l');

    const footerNav = document.querySelector('.fnav');
    if (footerNav && !footerNav.querySelector('[data-llstd-auctions]')) {
      const link = document.createElement('a');
      link.href = '/auctions/';
      link.className = 'f';
      link.dataset.llstdAuctions = 'true';
      link.textContent = 'مزادات اللوحات';
      footerNav.appendChild(link);
    }
  }

  mountAuctionLinks();
  const observer = new MutationObserver(mountAuctionLinks);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 15000);
})();
