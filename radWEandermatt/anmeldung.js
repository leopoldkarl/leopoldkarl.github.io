// Anmeldung -> Google Form
//
// Einrichtung (einmalig):
//   1. Google Form mit genau zwei Fragen anlegen:
//        - "Vollständiger Name"          (Kurzantwort, Pflichtfeld)
//        - "Verbindliche Anmeldung"      (Kästchen, eine Option, Pflichtfeld),
//          Optionstext z. B.: Hiermit melde ich mich verbindlich an.
//      Unter Einstellungen -> Antworten: "Anmeldung erforderlich" AUS
//      (sonst nimmt Google anonyme POSTs nicht an).
//   2. Im Form-Editor: ⋮ -> "Vorab ausgefüllten Link abrufen".
//      Als Name exakt  NAME  eintragen, das Kästchen ankreuzen,
//      "Link abrufen" -> "Link kopieren".
//   3. Diesen Link unten bei PREFILL_URL einsetzen. Mehr ist nicht nötig:
//      Zieladresse und Feld-IDs werden daraus abgeleitet.
const PREFILL_URL = "https://docs.google.com/forms/d/e/1FAIpQLSc8j8eByRid_QK-dUB4blkACfyrpnaV2h-LAPcTJqz7lppWgA/viewform?usp=pp_url&entry.195101946=NAME&entry.609199978=Hiermit+melde+ich+mich+verbindlich+f%C3%BCr+das+Rad+Wochenende+Andermatt+an.";

(function(){
  const form   = document.getElementById('signup');
  const name   = document.getElementById('f-name');
  const check  = document.getElementById('f-confirm');
  const status = document.getElementById('f-status');
  const button = form.querySelector('button[type="submit"]');
  const DONE_KEY = 'radWEandermatt:angemeldet';

  function say(text, kind){
    status.textContent = text;
    status.className = 'rad-status' + (kind ? ' ' + kind : '');
  }

  // Liefert {action, nameField, confirmField, confirmValue} oder null.
  function parsePrefill(url){
    if(!url) return null;
    let u;
    try { u = new URL(url); } catch { return null; }
    if(u.hostname !== 'docs.google.com' || !/\/forms\/.+\/viewform$/.test(u.pathname)) return null;
    const entries = [...u.searchParams].filter(([k]) => /^entry\.\d+$/.test(k));
    const n = entries.find(([, v]) => v.trim().toUpperCase() === 'NAME');
    const c = entries.find(([k]) => !n || k !== n[0]);
    if(!n || !c || entries.length !== 2) return null;
    return {
      action: u.origin + u.pathname.replace(/\/viewform$/, '/formResponse'),
      nameField: n[0],
      confirmField: c[0],
      confirmValue: c[1]
    };
  }

  const cfg = parsePrefill(PREFILL_URL);

  if(!cfg){
    button.disabled = true;
    say('Die Anmeldung ist noch nicht freigeschaltet.', 'err');
    return;
  }

  try {
    if(localStorage.getItem(DONE_KEY)){
      say('Von diesem Gerät wurde bereits eine Anmeldung abgeschickt ('
          + localStorage.getItem(DONE_KEY) + '). Für eine weitere Person einfach erneut ausfüllen.', 'ok');
    }
  } catch {}

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();

    // Honeypot: stillschweigend verwerfen.
    if(form.elements.website.value) return;

    const fullName = name.value.trim().replace(/\s+/g, ' ');
    const nameOk = fullName.length >= 3 && fullName.includes(' ');
    name.setAttribute('aria-invalid', String(!nameOk));
    if(!nameOk){
      say('Bitte den vollständigen Namen (Vor- und Nachname) angeben.', 'err');
      name.focus();
      return;
    }
    if(!check.checked){
      say('Bitte die verbindliche Anmeldung bestätigen.', 'err');
      check.focus();
      return;
    }

    const body = new URLSearchParams();
    body.append(cfg.nameField, fullName);
    body.append(cfg.confirmField, cfg.confirmValue);

    button.disabled = true;
    say('Wird gesendet …');
    try {
      // Google Forms sendet keine CORS-Header: die Antwort ist "opaque",
      // ihr Status ist nicht lesbar. Erkennbar ist nur ein Netzwerkfehler.
      await fetch(cfg.action, { method: 'POST', mode: 'no-cors', body });
      say('Danke, ' + fullName + ' – deine Anmeldung ist eingegangen.', 'ok');
      try { localStorage.setItem(DONE_KEY, fullName); } catch {}
      form.reset();
    } catch {
      say('Senden fehlgeschlagen. Bitte Internetverbindung prüfen und erneut versuchen.', 'err');
    } finally {
      button.disabled = false;
    }
  });
})();
