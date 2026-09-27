// Sortiert die Unternehmungen nach Datum: bevorstehende/laufende aufsteigend,
// vergangene absteigend darunter. Ohne JS bleibt die Reihenfolge im HTML.
(function(){
  const liste = document.getElementById('liste');
  if(!liste) return;
  const heute = new Date();
  const iso = [heute.getFullYear(), String(heute.getMonth()+1).padStart(2,'0'),
               String(heute.getDate()).padStart(2,'0')].join('-');

  const items = Array.from(liste.querySelectorAll(':scope > li'));
  const ende = li => li.dataset.bis || li.dataset.von || '';
  const kommend = items.filter(li => ende(li) >= iso)
    .sort((a,b) => (a.dataset.von||'').localeCompare(b.dataset.von||''));
  const vergangen = items.filter(li => ende(li) < iso)
    .sort((a,b) => ende(b).localeCompare(ende(a)));

  const gruppe = text => {
    const h = document.createElement('li');
    h.className = 'u-gruppe';
    h.setAttribute('role', 'presentation');
    h.textContent = text;
    return h;
  };

  liste.replaceChildren();
  if(kommend.length){ liste.append(gruppe('Bevorstehend'), ...kommend); }
  if(vergangen.length){
    vergangen.forEach(li => li.classList.add('vergangen'));
    liste.append(gruppe('Vergangen'), ...vergangen);
  }
})();
