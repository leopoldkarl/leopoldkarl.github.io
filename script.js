// Menü-Toggle für Mobil (einfach)
(function(){
  const btn = document.querySelector('.menu-toggle');
  const nav = document.getElementById('main-nav');
  if(!btn || !nav) return;
  btn.addEventListener('click', ()=> {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    if(nav.style.display === 'flex'){
      nav.style.display = '';
    } else {
      nav.style.display = 'flex';
      nav.style.flexDirection = 'column';
      nav.style.gap = '0.25rem';
    }
  });
})();

// Jahr im Footer
document.getElementById('year').textContent = new Date().getFullYear();
